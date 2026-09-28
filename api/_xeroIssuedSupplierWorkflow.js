import { randomUUID } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { ISSUED_SUPPLIER_POLICY, ISSUED_PETROLEUM_POLICY, isIssuedPreservationPolicy } from '../config/xeroIssuedPreservationPolicies.js';
import { getFreshXeroConnection, xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { buildFinancialClassifications, loadSalesforceFinancialSnapshot, loadXeroFinancialSnapshot,
  loadStoredFinancialControls, toSyncItemRow, xeroFinancialRateSnapshot, assertXeroFinancialDailyReserve,
  legacyReviewFingerprint, XERO_FINANCIAL_CUTOFF, XERO_RECONCILIATION_VERSION } from './_xeroFinancialSync.js';
import { buildGroupedPreservationContext } from './_xeroGroupedPreservationAdapter.js';
import { groupedPreservationCanonical } from './_xeroGroupedPreservation.js';
import { evaluateIssuedSupplierFinancialDocument } from './_xeroIssuedSupplierPreservationAdapter.js';
import { collectIssuedSupplierFiles, collectIssuedSupplierVessels, validateIssuedSupplierPacket } from './_xeroIssuedSupplierFiles.js';
import { evaluatePetroleumFinancialDocument } from './_xeroIssuedPetroleumPreservationAdapter.js';
import { collectPetroleumPreservationScope } from './_xeroIssuedPetroleumScope.js';
import { collectIssuedPetroleumFiles, validateIssuedPetroleumPacket } from './_xeroIssuedPetroleumFiles.js';
import { persistFinancialPreview, preparePreviewPersistence, previewEvidenceHash as hash } from './_xeroPreviewPersistence.js';

const POLICIES = Object.freeze({
  [ISSUED_SUPPLIER_POLICY]: { validate: validateIssuedSupplierPacket, files: collectIssuedSupplierFiles,
    evaluate: evaluateIssuedSupplierFinancialDocument, rpc: 'link_xero_issued_supplier_document_v1',
    event: 'issued_supplier_document_preservation_linked' },
  [ISSUED_PETROLEUM_POLICY]: { validate: validateIssuedPetroleumPacket, files: collectIssuedPetroleumFiles,
    evaluate: evaluatePetroleumFinancialDocument, rpc: 'link_xero_issued_petroleum_document_v1',
    event: 'issued_petroleum_document_preservation_linked' },
});
const fail = (message, code = 'XERO_ISSUED_PRESERVATION_INVALID', status = 409) => Object.assign(new Error(message), { code, status });
const uuid = (value) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || '');
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.slice(0, 15) === b.slice(0, 15);
function packetPolicy(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)
    || Object.keys(packet).some((key) => !['records', 'policyVersion'].includes(key))) throw fail('The issued-evidence packet has an unsupported structure.');
  // Only old packets which omit the discriminator retain the trustee contract.
  const policy = Object.hasOwn(packet, 'policyVersion') ? packet.policyVersion : ISSUED_SUPPLIER_POLICY;
  if (!isIssuedPreservationPolicy(policy)) throw fail('The issued-evidence policy is not supported.');
  return policy;
}
const actorFor = (context) => {
  const actor = { id: context?.profile?.id, email: String(context?.profile?.email || '').trim().toLowerCase() };
  if (!uuid(actor.id) || !actor.email || actor.email.length > 320) throw fail('An active authenticated Finance session is required.', 'XERO_ISSUED_PRESERVATION_ACTOR_REQUIRED', 403);
  return actor;
};
const runView = (run) => ({ id: run.id, revision: run.revision, status: run.status });
const rowView = (row) => ({ id: row.id, sourceId: row.source_id, sourceNumber: row.source_document_number,
  xeroDocumentId: row.xero_document_id, xeroNumber: row.xero_payload?.invoiceNumber || '', currency: row.currency,
  total: row.source_total, status: row.status, selected: row.selected === true, blockers: row.blockers || [], fingerprint: row.source_payload?.issuedSupplierPreservation?.fingerprint });

async function storedRows(client, runId) {
  const result = await client.from('xero_financial_sync_items').select('*').eq('run_id', runId).order('row_index').limit(26);
  if (result.error || !Array.isArray(result.data) || !result.data.length || result.data.length > 25) throw fail('The exact preservation review could not be loaded.');
  return result.data;
}

const documentIdentity = (sourceId, targetId) => `${sourceId.slice(0, 15)}:${targetId.toLowerCase()}`;
function savedRequests(run, rows, descriptor, policy) {
  if (run.control_totals?.workflowSnapshot?.expectedItemCount !== rows.length
    || new Set(rows.map((row) => row.id)).size !== rows.length
    || rows.some((row, index) => !uuid(row.id) || row.row_index !== index)
    || run.source_fingerprint !== hash(rows.map((row) => row.source_payload))
    || run.xero_fingerprint !== hash(rows.map((row) => row.xero_payload))) throw fail('The original preservation review scope changed.');
  const requests = descriptor.validate({ policyVersion: policy, records: rows.map((row) => row.source_payload?.issuedSupplierRequest) });
  if (rows.some((row, index) => row.source_object !== 'Supplier_Invoice__c'
    || row.source_payload?.issuedSupplierPreservation?.policyVersion !== policy
    || !sameId(row.source_id, requests[index].sourceId) || !sameId(row.source_payload.salesforceId, row.source_id)
    || !uuid(row.xero_document_id) || !uuid(row.xero_payload?.id)
    || row.xero_document_id.toLowerCase() !== requests[index].xeroDocumentId.toLowerCase()
    || row.xero_payload.id.toLowerCase() !== row.xero_document_id.toLowerCase())) throw fail('The original preservation document identities changed.');
  return requests;
}

async function currentEvidence(records, dependencies, rate, policy) {
  const descriptor = POLICIES[policy];
  const { env = process.env, fetchImpl = fetch, client = xeroContactSyncServiceClient(env),
    getConnection = getFreshXeroConnection, loadSalesforce = loadSalesforceFinancialSnapshot,
    loadXero = loadXeroFinancialSnapshot, collectFiles = descriptor.files,
    collectVessels = collectIssuedSupplierVessels, loadControls = loadStoredFinancialControls,
    collectPetroleumScope = collectPetroleumPreservationScope } = dependencies;
  const connection = await getConnection(client, { env, fetchImpl });
  const onResponse = ({ headers }) => {
    Object.assign(rate, xeroFinancialRateSnapshot(headers, rate));
    assertXeroFinancialDailyReserve(rate, env);
  };
  // These adapters only read providers. No accounting mutation client is imported.
  // Verify the pinned Salesforce organisation and exact native documents first.
  const files = await collectFiles({ policyVersion: policy, records }, { tenantId: connection.tenantId });
  const [salesforce, xero, stored, vessels] = await Promise.all([
    loadSalesforce(XERO_FINANCIAL_CUTOFF), loadXero(connection, XERO_FINANCIAL_CUTOFF, { env, fetchImpl, onResponse }),
    loadControls(client), policy === ISSUED_SUPPLIER_POLICY ? collectVessels(XERO_FINANCIAL_CUTOFF) : Promise.resolve(new Map()),
  ]);
  if (!uuid(connection.tenantId) || xero.tenantId !== connection.tenantId) throw fail('The current Xero organisation differs from the reviewed scope.');
  const built = buildFinancialClassifications(salesforce, xero, stored, { postingMode: 'draft' });
  for (const source of built.sources) {
    const row = vessels.get(source.salesforceId);
    source.issuedSupplierVessel = row && sameId(row.stemId, source.stemId) ? row.vessel : null;
    // Trustee extras carry Supplier__c. Petroleum delivery lines instead carry
    // Original_Supplier__c, verified against their exact parent by the dedicated
    // fresh raw-scope adapter; the ordinary snapshot does not select that field.
    if (policy === ISSUED_SUPPLIER_POLICY && source.salesforceObject === 'Supplier_Invoice__c') {
      const children = [...salesforce.lines, ...salesforce.extras].filter((child) => sameId(child.Supplier_Invoice__c, source.salesforceId));
      if (children.length !== 1 || children.some((child) => child.Cancelled__c !== false || !sameId(child.STEM__c, source.stemId)
        || !sameId(child.Supplier__c, source.accountId))) source.blockers.push('Exact current child, supplier and STEM associations are required for preservation.');
    }
  }
  const context = buildGroupedPreservationContext(salesforce, xero, stored, built.sources);
  context.documents = [...xero.documents, ...(xero.inactiveDocuments || [])];
  if (policy === ISSUED_PETROLEUM_POLICY) context.petroleum = await collectPetroleumScope({ records, connection,
    salesforce, xero, sources: built.sources, stored }, { env, fetchImpl, onResponse });
  const stemIds = [...new Set(built.sources.filter((s) => records.some((r) => sameId(r.sourceId, s.salesforceId))).map((s) => s.stemId))];
  const disputes = stemIds.length ? await client.from('dispute_beta_cases').select('stem_id,workflow_status').in('stem_id', stemIds) : { data: [] };
  if (disputes.error) throw fail('Current dispute evidence is unavailable.');
  const rows = records.map((request) => {
    const source = built.sources.find((s) => sameId(s.salesforceId, request.sourceId));
    const target = context.documents.find((d) => d.id?.toLowerCase() === request.xeroDocumentId.toLowerCase());
    if (!source || source.salesforceObject !== 'Supplier_Invoice__c' || !target) throw fail('A requested source or existing Xero bill is outside the complete current scope.');
    const result = descriptor.evaluate(source, target, context, files.get(request.sourceId));
    const blockers = (result.blockers || []).map((b) => `${b.code || 'EVIDENCE'}: ${b.message}`);
    if ((disputes.data || []).some((d) => sameId(d.stem_id, source.stemId) && !['closed', 'resolved', 'cancelled'].includes(String(d.workflow_status).toLowerCase()))) blockers.push('An unresolved dispute affects this STEM.');
    const eligible = result.eligible && !blockers.length;
    const summary = { policyVersion: policy, eligible, accepted: false, requiresExplicitReview: true, fingerprint: result.fingerprint || null,
      evidenceFingerprint: result.evidenceFingerprint || null };
    const reviewed = { ...source, action: eligible ? 'protected_legacy' : 'blocked', status: eligible ? 'eligible' : 'blocked',
      blockers, warnings: ['Existing Xero bill details will be preserved. This action only records a verified link.'],
      xero: target, proposedPayload: null, differences: built.rows.find((r) => sameId(r.salesforceId, source.salesforceId))?.differences || [],
      reviewRequired: true, acceptedLegacy: false, issuedSupplierPreservation: summary };
    const reviewFingerprint = hash({ source: source.sourceFingerprint, xero: target, summary, differences: reviewed.differences, blockers });
    return { reviewed, proof: result.evidence, reviewFingerprint, request };
  });
  return { rows, tenantId: connection.tenantId };
}

export async function xeroFinancialDocumentPreservationPreview(body = {}, dependencies = {}) {
  const { env = process.env, client = xeroContactSyncServiceClient(env), accessContext } = dependencies;
  const actor = actorFor(accessContext);
  const policy = packetPolicy(body.packet);
  const records = POLICIES[policy].validate(body.packet);
  const rate = {};
  const current = await currentEvidence(records, { ...dependencies, client }, rate, policy);
  const now = new Date().toISOString(); const id = randomUUID();
  const items = current.rows.map(({ reviewed, proof, request, reviewFingerprint }, index) => {
    const item = toSyncItemRow(reviewed, id, index, now);
    // Normal preview serialization deliberately drops groupedAccounting. Retain
    // only the original raw line needed by the new trustee rounding SQL guard.
    if (policy === ISSUED_SUPPLIER_POLICY && proof?.accounting?.source?.lines?.[0]?.centRounding) {
      const { id, quantity, unitAmount, lineAmount } = reviewed.groupedAccounting.lines[0];
      item.source_payload.issuedSupplierRoundingSource = { id, quantity, unitAmount, lineAmount };
    }
    item.source_payload.issuedSupplierRequest = request;
    item.source_payload.issuedSupplierReviewFingerprint = reviewFingerprint;
    return item;
  });
  const summary = { total: items.length, eligible: items.filter((r) => r.status === 'eligible').length, blocked: items.filter((r) => r.status === 'blocked').length };
  const run = { id, idempotency_key: `preview:${id}`, mode: 'preview', status: 'building', cutoff_date: XERO_FINANCIAL_CUTOFF,
    source_snapshot_at: now, xero_snapshot_at: now, source_fingerprint: hash(items.map((i) => i.source_payload)),
    xero_fingerprint: hash(items.map((i) => i.xero_payload)), control_totals: { postingMode: 'draft', preservationPolicy: policy,
      workflowSnapshot: { reconciliationVersion: XERO_RECONCILIATION_VERSION, checkedAt: now } }, classification_summary: summary,
    rate_limit_snapshot: rate, revision: 1, created_by: actor.id, created_by_email: actor.email, created_at: now, updated_at: now };
  const saved = await persistFinancialPreview(client, preparePreviewPersistence(run, items, { tenantId: current.tenantId,
    salesforceOrgId: fcosSalesforceEnvironment('production').orgId, includePayments: false, inputEvidenceHash: hash(current.rows) }));
  const persisted = saved.reused ? await storedRows(client, saved.run.id) : items.map((i) => ({ ...i, id: saved.identities.get(i.row_key) }));
  return { run: runView(saved.run), rows: persisted.map(rowView), summary, rateLimit: rate, financialWrites: 0 };
}

export async function xeroFinancialDocumentPreservationRun(body = {}, dependencies = {}) {
  const { env = process.env, client = xeroContactSyncServiceClient(env), accessContext } = dependencies;
  requireExternalActionGate('xero_financial_sync', env);
  const actor = actorFor(accessContext);
  const ids = body.selectedItemIds;
  if (!uuid(body.runId) || !Number.isSafeInteger(body.revision) || body.reviewed !== true
    || !Array.isArray(ids) || !ids.length || ids.length > 25 || !ids.every(uuid) || new Set(ids).size !== ids.length) throw fail('Select and review the exact verified preservation rows.');
  const saved = await client.from('xero_financial_sync_runs').select('*').eq('id', body.runId).maybeSingle();
  const run = saved.data;
  const policy = run?.control_totals?.preservationPolicy;
  if (saved.error || !run || !isIssuedPreservationPolicy(policy)) throw fail('This is not a supported issued-supplier preservation review.');
  const descriptor = POLICIES[policy];
  let rows = await storedRows(client, run.id);
  const selected = rows.filter((r) => ids.includes(r.id));
  if (selected.length !== ids.length || selected.some((r) => r.proposed_action !== 'protected_legacy'
    || r.source_payload?.issuedSupplierPreservation?.policyVersion !== policy || r.blockers?.length
    || Object.keys(r.proposed_payload || {}).length || r.mutation_attempts > 0)) throw fail('The selection contains an unverified or accounting-write row.');
  if (run.status === 'completed' && run.reviewed_by === actor.id && run.reviewed_by_email === actor.email
    && rows.filter((r) => r.selected).length === ids.length && selected.every((r) => r.selected && r.status === 'linked')) {
    const [mappings, audits] = await Promise.all([
      client.from('xero_financial_document_mappings').select('*').in('xero_document_id', selected.map((r) => r.xero_document_id)),
      client.from('xero_financial_audit_events').select('*').eq('run_id', run.id).eq('event_type', descriptor.event),
    ]);
    if (mappings.error || audits.error || !Array.isArray(mappings.data) || !Array.isArray(audits.data)) throw fail('The completed link receipts could not be verified.');
    for (const row of selected) {
      const matches = mappings.data.filter((m) => sameId(m.salesforce_id, row.source_id) && m.xero_document_id === row.xero_document_id);
      const mapping = matches[0]; const receipt = mapping?.retained_differences?.issuedSupplierPreservation;
      const audit = audits.data.filter((a) => a.fingerprints?.itemId === row.id && a.fingerprints?.mappingId === mapping?.id);
      if (matches.length !== 1 || mapping.protected_legacy !== true || receipt?.acceptance?.runId !== run.id
        || receipt.acceptance.itemId !== row.id || receipt.acceptance.actorId !== actor.id || receipt.acceptance.actorEmail !== actor.email
        || mapping.salesforce_object !== row.source_object || mapping.xero_document_type !== 'ACCPAY'
        || mapping.xero_contact_id !== row.xero_payload.contactId || mapping.xero_document_number !== row.xero_payload.invoiceNumber
        || mapping.source_fingerprint !== row.source_payload.sourceFingerprint || mapping.financial_fingerprint !== row.source_payload.financialFingerprint
        || !receipt.reviewedXero || hash(receipt.reviewedXero) !== hash(row.xero_payload)
        || !receipt.evidence
        || receipt.fingerprint !== row.source_payload.issuedSupplierPreservation.fingerprint || receipt.evidenceFingerprint !== hash(receipt.evidence)
        || receipt.policyVersion !== policy || receipt.evidence.policyVersion !== policy
        || receipt.fingerprint !== hash({ policyVersion: policy, accounting: receipt.evidence?.accounting }) || audit.length !== 1
        || audit[0].outcome !== 'success' || audit[0].actor_id !== actor.id || audit[0].record_counts?.financialWrites !== 0
        || !audit[0].fingerprints?.issuedSupplierPreservation
        || hash(audit[0].fingerprints.issuedSupplierPreservation) !== hash(receipt)) throw fail('A completed preservation link is missing its matching immutable audit receipt.');
    }
    return { run: runView(run), outcomes: selected.map((r) => ({ id: r.id, status: 'linked', xeroDocumentId: r.xero_document_id, alreadyLinked: true })), financialWrites: 0 };
  }
  const resumable = run.status === 'authorised' && run.reviewed_by === actor.id && run.reviewed_by_email === actor.email
    && rows.filter((r) => r.selected).length === ids.length && selected.every((r) => r.selected && r.status === 'selected');
  if ((!resumable && (run.status !== 'ready_for_review' || rows.some((r) => r.selected))) || run.revision !== body.revision) throw fail('This review has already started or changed. Inspect its saved outcome before trying again.');
  savedRequests(run, rows, descriptor, policy);
  const approved = resumable ? { data: run } : await client.rpc('authorise_xero_financial_sync_run_v1', { p_run_id: run.id, p_expected_revision: run.revision,
    p_selected_item_ids: ids, p_actor_id: actor.id, p_actor_email: actor.email });
  if (approved.error || !approved.data) throw fail('The preservation selection changed before it could be recorded.');
  const started = await client.rpc('start_xero_financial_sync_run_v1', { p_run_id: run.id, p_expected_revision: approved.data.revision });
  if (started.error || !started.data) throw fail('Another document batch is processing, or this review changed. The selected records remain saved.');
  const rate = {}; const outcomes = []; let localCommitPending = false;
  const finish = async (status, error = null) => client.rpc('finish_xero_financial_sync_run_v1', {
    p_run_id: run.id, p_status: status, p_expected_revision: started.data.revision,
    p_classification_summary: { total: ids.length, linked: outcomes.length, financialWrites: 0 }, p_rate_limit_snapshot: rate,
    p_error_code: error?.code || null, p_error_message: error?.message || null });
  try {
    const fullScope = await storedRows(client, run.id);
    const requests = savedRequests(run, fullScope, descriptor, policy);
    rows = fullScope.filter((r) => r.selected);
    if (rows.length !== ids.length || rows.some((r) => !ids.includes(r.id) || r.status !== 'selected')) throw fail('The selected preservation scope changed.');
    // The proof includes collection coverage for the original preview cohort.
    // Selection changes the link set, never the evidence collection scope.
    const expected = new Map(requests.map((request) => [documentIdentity(request.sourceId, request.xeroDocumentId), hash(request)]));
    const current = await currentEvidence(requests, { ...dependencies, client }, rate, policy);
    if (current.tenantId !== run.control_totals.workflowSnapshot.tenantId) throw fail('The reviewed Xero organisation changed.');
    const currentByIdentity = new Map();
    for (const latest of current.rows) {
      const sourceId = latest.reviewed?.salesforceId; const targetId = latest.reviewed?.xero?.id;
      if (!sameId(sourceId, latest.request?.sourceId) || !uuid(targetId)
        || targetId.toLowerCase() !== latest.request?.xeroDocumentId?.toLowerCase()) throw fail('The current preservation document identities changed.');
      const key = documentIdentity(sourceId, targetId);
      if (currentByIdentity.has(key) || expected.get(key) !== hash(latest.request)) throw fail('The current preservation review scope changed.');
      currentByIdentity.set(key, latest);
    }
    if (currentByIdentity.size !== expected.size) throw fail('The current preservation review scope is incomplete.');
    // Recheck the entire selected cohort before any local link is committed.
    for (const row of rows) {
      const latest = currentByIdentity.get(documentIdentity(row.source_id, row.xero_document_id));
      if (!latest || latest.reviewed.status !== 'eligible' || latest.reviewFingerprint !== row.source_payload.issuedSupplierReviewFingerprint) throw fail(`${row.source_document_number}: the issued evidence or accounting review changed. Create a fresh preservation preview.`);
    }
    for (const row of rows) {
      const { reviewed, proof, reviewFingerprint } = currentByIdentity.get(documentIdentity(row.source_id, row.xero_document_id));
      const summary = reviewed.issuedSupplierPreservation;
      localCommitPending = true;
      const result = await client.rpc(descriptor.rpc, { p_run_id: run.id,
        p_expected_run_revision: started.data.revision, p_item_id: row.id, p_expected_item_updated_at: row.updated_at,
        p_tenant_id: current.tenantId, p_actor_id: actor.id, p_actor_email: actor.email,
        p_review: { policyVersion: policy, fingerprint: summary.fingerprint, evidenceFingerprint: summary.evidenceFingerprint,
          reviewFingerprint, legacyReviewFingerprint: legacyReviewFingerprint(reviewed, reviewed.xero), evidence: proof,
          accountingCanonical: groupedPreservationCanonical({ policyVersion: policy, accounting: proof.accounting }),
          evidenceCanonical: groupedPreservationCanonical(proof) } });
      if (result.error) { localCommitPending = !result.error.code; throw fail('The preservation transaction was not confirmed. Inspect the saved link before retrying.'); }
      if (result.data?.id !== row.id || result.data?.status !== 'linked' || result.data?.xeroDocumentId !== row.xero_document_id) throw fail('The preservation transaction returned an unexpected identity.');
      localCommitPending = false;
      outcomes.push(result.data);
    }
    const finished = await finish('completed');
    if (finished.error || !finished.data) throw fail('The links were saved, but the final run status requires inspection.');
    return { run: runView(finished.data), outcomes, financialWrites: 0, rateLimit: rate };
  } catch (error) {
    // An uncertain local RPC stays processing until its durable outcome is inspected.
    if (!localCommitPending) await finish(outcomes.length ? 'partial' : 'failed', error).catch(() => null);
    throw error;
  }
}
