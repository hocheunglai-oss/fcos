import { randomUUID } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { requireExternalActionGate } from './_externalActionGates.js';
import { xeroContactSyncServiceClient, getFreshXeroConnection } from './_xeroContactSync.js';
import { previewEvidenceHash, preparePreviewPersistence } from './_xeroPreviewPersistence.js';
import { issuedSupplierHash as hash, issuedSupplierSfId as sf } from './_xeroIssuedSupplierPreservation.js';
import { legacyReviewFingerprint, normalizeXeroInvoice, toSyncItemRow, XERO_FINANCIAL_CUTOFF, XERO_RECONCILIATION_VERSION } from './_xeroFinancialSync.js';
import { SUPPLIER_FINANCIAL_BUCKET_POLICY as POLICY, evaluateSupplierFinancialBucketPreservation,
  supplierFinancialBucketReview, supplierFinancialBucketApprovalMaterial } from './_xeroSupplierFinancialBucketPreservation.js';
import { collectSupplierFinancialBucket, supplierFinancialCollectionPrivateEvidence } from './_xeroSupplierFinancialBucketCollector.js';
import { persistSupplierFinancialBucketPreservation, readSupplierFinancialBucketOutcome } from './_xeroSupplierFinancialBucketPersistence.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const uuid = v => typeof v === 'string' && UUID.test(v) && v !== '00000000-0000-0000-0000-000000000000';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (message, code = 'XERO_SUPPLIER_FINANCIAL_WORKFLOW_INVALID', status = 409) => Object.assign(Error(message), { code, status });
const assert = (condition, message, code) => { if (!condition) throw fail(message, code); };
const same = (a, b) => hash(a) === hash(b);
// Normalize only typed PostgreSQL metadata, never JSON source/provider facts.
const DB_TIME_COLUMNS = new Set(['created_at', 'updated_at', 'source_snapshot_at', 'xero_snapshot_at']);
function dbInstant(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59
    || m[6] !== 'Z' && (Number(m[6].slice(1, 3)) > 23 || Number(m[6].slice(4, 6)) > 59)) return null;
  const day = Date.parse(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== m[1]) return null;
  const base = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
  return Number.isFinite(base) ? BigInt(base) * 1000n + BigInt((m[5] || '').padEnd(6, '0') || '0') : null;
}
const dbColumnSame = (key, actual, expected) => DB_TIME_COLUMNS.has(key)
  ? dbInstant(expected) !== null && dbInstant(actual) === dbInstant(expected) : same(actual, expected);
const marker = Object.freeze({ policyVersion: POLICY, proofValid: true, workflowEligible: false,
  approvalGranted: false, accepted: false, documentVerification: 'UNVERIFIED' });
const runView = r => ({ id: r.id, revision: r.revision, status: r.status });
const publicText = (v, max = 256) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
const rowView = r => ({ id: publicText(r.id), sourceId: publicText(r.source_id), sourceNumber: publicText(r.source_document_number),
  xeroDocumentId: publicText(r.xero_document_id), xeroNumber: publicText(r.xero_payload?.InvoiceNumber),
  targetTracking: (Array.isArray(r.xero_payload?.LineItems) ? r.xero_payload.LineItems.slice(0, 100) : [])
    .flatMap(line => (Array.isArray(line?.Tracking) ? line.Tracking.slice(0, 2) : [])
      .map(t => ({ lineItemId: publicText(line?.LineItemID), category: publicText(t?.Name), option: publicText(t?.Option), sourceEquivalenceEstablished: false }))),
  company: publicText(r.source_payload?.accountName), stem: publicText(r.source_payload?.stemKey || r.source_payload?.stemName),
  vessel: publicText(r.source_payload?.vesselName), invoiceDate: publicText(r.source_payload?.invoiceDate, 32),
  currency: publicText(r.currency, 3), total: typeof r.source_total === 'number' && Number.isFinite(r.source_total) ? r.source_total : null,
  status: publicText(r.status, 32), selected: r.selected === true, documentVerification: 'UNVERIFIED',
  blockers: Array.isArray(r.blockers) ? r.blockers.filter(v => typeof v === 'string').slice(0, 100).map(v => publicText(v, 512)) : [] });
const actorFor = ctx => {
  const actor = { id: ctx?.profile?.id, email: String(ctx?.profile?.email || '').trim().toLowerCase() };
  assert(uuid(actor.id) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email) && actor.email.length <= 254,
    'A current authenticated Finance session is required.');
  return actor;
};
async function one(query) {
  const r = await query.maybeSingle();
  assert(!r?.error && plain(r?.data), 'Exact saved financial workflow evidence is unavailable.');
  return r.data;
}

function scopeFor(scope) {
  assert(plain(scope) && Object.keys(scope).sort().join(',') === 'campaignId,caseIds,expectedRevision'
    && uuid(scope.campaignId) && Number.isSafeInteger(scope.expectedRevision) && scope.expectedRevision > 0
    && Array.isArray(scope.caseIds) && scope.caseIds.length > 0 && scope.caseIds.length <= 25
    && scope.caseIds.every(id => typeof id === 'string' && id === id.trim() && id.length > 0 && id.length <= 256)
    && new Set(scope.caseIds).size === scope.caseIds.length,
  'Select 1–25 distinct exact saved campaign cases and the current revision.');
  return structuredClone(scope);
}

// Only a server-created WeakMap capture is accepted. HTTP callers supply scope,
// never evidence, freshness flags, permission decisions or a posting payload.
async function current(scope, actor, deps) {
  const connection = deps.connection || await (deps.getConnection || getFreshXeroConnection)(deps.client, { env: deps.env || process.env, fetchImpl: deps.fetchImpl });
  const collection = await (deps.collectFinancial || collectSupplierFinancialBucket)(scope, { ...deps, connection });
  const capture = (deps.privateFinancialEvidence || supplierFinancialCollectionPrivateEvidence)(collection);
  assert(collection?.policyVersion === POLICY && collection.complete === true && collection.actorId === actor.id
    && uuid(collection.tenantId) && HASH.test(collection.scopeFingerprint || '')
    && collection.approvalGranted === false && collection.financialWrites === 0 && plain(capture)
    && plain(capture.scopeMaterial) && hash(capture.scopeMaterial) === collection.scopeFingerprint
    && capture.scopeMaterial.campaignId === scope.campaignId && capture.scopeMaterial.expectedRevision === scope.expectedRevision
    && same(capture.scopeMaterial.caseIds, scope.caseIds)
    && Array.isArray(capture.inputs) && capture.inputs.length === scope.caseIds.length
    && Array.isArray(capture.sources) && capture.sources.length === capture.inputs.length
    && Array.isArray(capture.targets) && capture.targets.length === capture.inputs.length
    && Array.isArray(collection.cases) && collection.cases.length === capture.inputs.length
    && Number.isFinite(Date.parse(collection.observation?.endedAt))
    && Date.now() - Date.parse(collection.observation.endedAt) >= 0
    && Date.now() - Date.parse(collection.observation.endedAt) <= 300_000,
  'The complete current server financial observation is unavailable.');
  const seenSource = new Set(), seenTarget = new Set();
  const rows = capture.inputs.map((input, i) => {
    const source = capture.sources[i], target = capture.targets[i], c = collection.cases[i];
    assert(c.caseId === scope.caseIds[i] && source?.salesforceObject === 'Supplier_Invoice__c' && sf(source.salesforceId) === sf(input.source?.parent?.Id)
      && sf(c.sourceId) === sf(source.salesforceId) && source.xeroType === 'ACCPAY' && source.currency === 'USD'
      && uuid(target?.InvoiceID) && c.targetId?.toLowerCase() === target.InvoiceID.toLowerCase()
      && target.Type === 'ACCPAY' && input.tenantId === collection.tenantId
      && same(source, input.source.sourcePayload) && same(target, input.target)
      && !seenSource.has(sf(source.salesforceId)) && !seenTarget.has(target.InvoiceID.toLowerCase()),
    'Current source/target originals differ from the exact selected scope.');
    seenSource.add(sf(source.salesforceId)); seenTarget.add(target.InvoiceID.toLowerCase());
    const proof = evaluateSupplierFinancialBucketPreservation(input);
    const legacy = legacyReviewFingerprint(source, normalizeXeroInvoice(target));
    const reviewFingerprint = proof.proofValid ? hash({ scope: collection.scopeFingerprint,
      approvalMaterial: supplierFinancialBucketApprovalMaterial(proof.evidence, proof.localClaimScope), legacyReviewFingerprint: legacy }) : null;
    const review = proof.proofValid ? supplierFinancialBucketReview(proof, { reviewFingerprint, legacyReviewFingerprint: legacy }) : null;
    assert(!proof.proofValid || review, 'The financial review could not be independently derived.');
    return { source, target, review, blockers: proof.blockers.map(b => `${b.code}: ${b.path}`) };
  });
  return { collection, capture, rows };
}

function validateSaved(run, items, actor) {
  const state = run.control_totals?.supplierFinancialWorkflow, snap = run.control_totals?.workflowSnapshot;
  assert(run.mode === 'preview' && run.control_totals?.preservationPolicy === POLICY && run.created_by === actor.id
    && run.created_by_email === actor.email && snap?.complete === true && snap.includePayments === false
    && snap.reconciliationVersion === XERO_RECONCILIATION_VERSION && plain(state) && uuid(snap.tenantId)
    && HASH.test(state.scopeFingerprint || '') && Array.isArray(items) && items.length > 0 && items.length <= 25
    && items.length === snap.expectedItemCount && items.length === state.scope.caseIds.length
    && new Set(items.map(r => r.id)).size === items.length
    && run.source_fingerprint === previewEvidenceHash(items.map(r => r.source_payload))
    && run.xero_fingerprint === previewEvidenceHash(items.map(r => r.xero_payload))
    && items.every((r, i) => uuid(r.id) && r.run_id === run.id && r.row_index === i && r.proposed_payload === null
      && r.mutation_attempts === 0 && r.source_object === 'Supplier_Invoice__c'),
  'The owned original financial preview changed.');
  scopeFor(state.scope);
  return state;
}
async function saved(client, runId, actor) {
  const run = await one(client.from('xero_financial_sync_runs').select('*').eq('id', runId));
  const response = await client.from('xero_financial_sync_items').select('*').eq('run_id', run.id).order('row_index').limit(26);
  assert(!response.error, 'Saved financial rows are unavailable.');
  const state = validateSaved(run, response.data, actor);
  return { run, items: response.data, state };
}
function transitionMatches(before, after, status, actor) {
  return plain(after) && after.id === before.id && after.status === status && after.revision === before.revision + 1
    && after.reviewed_by === actor.id && after.reviewed_by_email === actor.email && Number.isFinite(Date.parse(after.reviewed_at))
    && ['mode', 'source_fingerprint', 'xero_fingerprint', 'created_by', 'created_by_email', 'cutoff_date', 'control_totals']
      .every(key => same(before[key], after[key]));
}

export async function supplierFinancialBucketPreview(body = {}, deps = {}) {
  const actor = actorFor(deps.accessContext), client = deps.client || xeroContactSyncServiceClient(deps.env || process.env);
  const scope = scopeFor(body); const observed = await current(scope, actor, { ...deps, client });
  const at = new Date().toISOString(), id = randomUUID();
  const items = observed.rows.map((entry, i) => {
    const reviewed = { ...entry.source, action: entry.review ? 'protected_legacy' : 'blocked', status: entry.review ? 'eligible' : 'blocked',
      blockers: entry.blockers, warnings: ['Local link only. Xero financial details are preserved; PDF verification is deferred.'],
      xero: normalizeXeroInvoice(entry.target), proposedPayload: null, differences: [] };
    const item = toSyncItemRow(reviewed, id, i, at);
    item.source_payload = { ...structuredClone(entry.source), ...(entry.review ? { supplierFinancialReview: entry.review, supplierFinancialPreservation: marker } : {}) };
    item.xero_payload = structuredClone(entry.target); item.proposed_payload = null; item.mutation_attempts = 0;
    return item;
  });
  const summary = { total: items.length, eligible: items.filter(r => r.status === 'eligible').length,
    blocked: items.filter(r => r.status === 'blocked').length, financialWrites: 0 };
  const run = { id, idempotency_key: `preview:${id}`, mode: 'preview', status: 'building', revision: 1,
    cutoff_date: XERO_FINANCIAL_CUTOFF, source_snapshot_at: at, xero_snapshot_at: at,
    source_fingerprint: previewEvidenceHash(items.map(r => r.source_payload)), xero_fingerprint: previewEvidenceHash(items.map(r => r.xero_payload)),
    control_totals: { postingMode: 'draft', preservationPolicy: POLICY,
      workflowSnapshot: { reconciliationVersion: XERO_RECONCILIATION_VERSION, checkedAt: at },
      supplierFinancialWorkflow: { scope, scopeFingerprint: observed.collection.scopeFingerprint } },
    classification_summary: summary, rate_limit_snapshot: observed.collection.observation.forecast || {},
    created_by: actor.id, created_by_email: actor.email, created_at: at, updated_at: at };
  const parameters = preparePreviewPersistence(run, items, { tenantId: observed.collection.tenantId, includePayments: false,
    salesforceOrgId: fcosSalesforceEnvironment('production').orgId, inputEvidenceHash: hash({ scope, items }) });
  assert(Buffer.byteLength(JSON.stringify(parameters)) <= 4_000_000,
    'The full evidence exceeds this preview size. Select a smaller cohort; no evidence was truncated.', 'XERO_SUPPLIER_FINANCIAL_PREVIEW_TOO_LARGE');
  // One atomic publisher call. A lost response is read back; no blind retry.
  let response;
  try { response = await client.rpc('persist_xero_supplier_financial_preview_v1', parameters); } catch { response = null; }
  const persisted = await saved(client, id, actor);
  const payloadHash = hash({ run: parameters.p_run, items: parameters.p_items, reviewIdentity: parameters.p_review_identity });
  const expectedControls = { ...parameters.p_run.control_totals, workflowSnapshot: {
    ...parameters.p_run.control_totals.workflowSnapshot, financialPreviewPayloadHash: payloadHash } };
  const event = await client.from('xero_financial_audit_events').select('*').eq('run_id', id).eq('event_type', 'supplier_financial_preview_published').limit(2);
  assert(!event.error && event.data?.length === 1 && event.data[0].outcome === 'success'
    && event.data[0].actor_id === actor.id && event.data[0].actor_email === actor.email
    && same(event.data[0].fingerprints, { payloadHash, reviewIdentity: parameters.p_review_identity })
    && persisted.run.control_totals.workflowSnapshot.financialPreviewPayloadHash === payloadHash
    && same(persisted.run.control_totals, expectedControls)
    && Object.entries(parameters.p_run).filter(([key]) => !['status', 'control_totals'].includes(key))
      .every(([key, value]) => dbColumnSame(key, persisted.run[key], value))
    && persisted.items.length === items.length && items.every((item, i) => Object.entries(item).every(([key, value]) => dbColumnSame(key, persisted.items[i][key], value)))
    && persisted.run.status === 'ready_for_review'
    && (!response?.data || response.data.run?.id === id), 'The exact preview outcome remains uncertain. Do not retry.', 'XERO_SUPPLIER_FINANCIAL_PREVIEW_UNCERTAIN');
  return { run: runView(persisted.run), rows: persisted.items.map(rowView), summary, financialWrites: 0,
    documentVerification: 'UNVERIFIED', rateLimit: observed.collection.observation.forecast };
}

export async function supplierFinancialBucketRead(body = {}, deps = {}) {
  assert(plain(body) && Object.keys(body).join(',') === 'runId' && uuid(body.runId), 'An exact financial review ID is required.');
  const actor = actorFor(deps.accessContext), client = deps.client || xeroContactSyncServiceClient(deps.env || process.env);
  const result = await saved(client, body.runId, actor);
  return { run: runView(result.run), rows: result.items.map(rowView), financialWrites: 0, documentVerification: 'UNVERIFIED' };
}

export async function supplierFinancialBucketApply(body = {}, deps = {}) {
  requireExternalActionGate('xero_financial_sync', deps.env || process.env);
  const actor = actorFor(deps.accessContext), client = deps.client || xeroContactSyncServiceClient(deps.env || process.env);
  assert(plain(body) && Object.keys(body).sort().join(',') === 'reviewed,revision,runId,selectedItemIds'
    && uuid(body.runId) && Number.isSafeInteger(body.revision) && body.revision > 0 && body.reviewed === true
    && Array.isArray(body.selectedItemIds) && body.selectedItemIds.length > 0 && body.selectedItemIds.length <= 25
    && body.selectedItemIds.every(uuid) && new Set(body.selectedItemIds).size === body.selectedItemIds.length,
  'Review the exact financial link selection and revision.');
  let loaded = await saved(client, body.runId, actor), run = loaded.run;
  const ids = body.selectedItemIds, selected = loaded.items.filter(r => ids.includes(r.id));
  assert(selected.length === ids.length && selected.every(r => r.proposed_action === 'protected_legacy' && !r.blockers.length && r.source_payload.supplierFinancialReview), 'Held rows cannot be applied.');
  const selectedExactly = () => loaded.items.filter(r => r.selected).length === ids.length && selected.every(r => r.selected);
  const finish = async (status, outcomes, error = null) => {
    const r = await client.rpc('finish_xero_financial_sync_run_v1', { p_run_id: run.id, p_expected_revision: run.revision,
      p_status: status, p_classification_summary: { total: ids.length, linked: outcomes.length, financialWrites: 0 },
      p_rate_limit_snapshot: {}, p_error_code: error?.code || null, p_error_message: error?.message || null });
    assert(!r.error && transitionMatches(run, r.data, status, actor), 'The durable financial run outcome remains uncertain.'); return r.data;
  };
  if (['processing', 'completed', 'partial'].includes(run.status)) {
    assert(run.revision === body.revision && run.reviewed_by === actor.id && run.reviewed_by_email === actor.email && selectedExactly(), 'Saved approval or current revision changed.');
    const outcomes = [];
    for (const row of selected) {
      assert(row.status === 'linked', 'An interrupted outcome requires readback; unconfirmed rows were not retried.', 'XERO_SUPPLIER_FINANCIAL_OUTCOME_PENDING');
      const mapping = await one(client.from('xero_financial_document_mappings').select('*').eq('salesforce_object', row.source_object).eq('salesforce_id', row.source_id));
      const receipt = mapping.retained_differences?.financialBucketPreservation;
      const a = receipt?.acceptance;
      assert(a?.runId === run.id && a.itemId === row.id && a.actorId === actor.id && a.actorEmail === actor.email, 'Original durable acceptance is unavailable.');
      outcomes.push(await readSupplierFinancialBucketOutcome(client, { runId: run.id, expectedRunRevision: a.runRevision,
        itemId: row.id, expectedItemUpdatedAt: a.itemUpdatedAt, tenantId: run.control_totals.workflowSnapshot.tenantId,
        previewReview: row.source_payload.supplierFinancialReview, review: row.source_payload.supplierFinancialReview, actor }));
    }
    if (run.status === 'partial') {
      const resumed = await client.rpc('start_xero_financial_sync_run_v1', { p_run_id: run.id, p_expected_revision: run.revision });
      assert(!resumed.error && transitionMatches(run, resumed.data, 'processing', actor), 'Recovered local run status changed.');
      run = resumed.data;
    }
    if (run.status !== 'completed') run = await finish('completed', outcomes);
    return { run: runView(run), outcomes, financialWrites: 0 };
  }
  assert(run.revision === body.revision && ['ready_for_review', 'authorised'].includes(run.status)
    && (run.status === 'ready_for_review' ? loaded.items.every(r => !r.selected) : run.reviewed_by === actor.id && run.reviewed_by_email === actor.email && selectedExactly()), 'Saved revision or exact approval changed.');
  // Recollect the complete bounded original cohort before any local link write.
  const fresh = await current(loaded.state.scope, actor, { ...deps, client });
  assert(fresh.collection.scopeFingerprint === loaded.state.scopeFingerprint, 'Campaign identity scope changed.');
  for (let i = 0; i < loaded.items.length; i++) {
    const row = loaded.items[i], now = fresh.rows[i], previous = row.source_payload.supplierFinancialReview;
    assert(sf(row.source_id) === sf(now.source.salesforceId) && row.xero_document_id === now.target.InvoiceID
      && same(row.xero_payload, now.target) && (previous ? same(previous, now.review)
        : !now.review && same(row.blockers, now.blockers) && same(row.source_payload, now.source)),
    'Financial evidence changed. Create a fresh review; independent cohorts can continue.');
  }
  if (run.status === 'ready_for_review') {
    const r = await client.rpc('authorise_xero_financial_sync_run_v1', { p_run_id: run.id, p_expected_revision: run.revision,
      p_selected_item_ids: ids, p_actor_id: actor.id, p_actor_email: actor.email });
    assert(!r.error && transitionMatches(run, r.data, 'authorised', actor), 'The exact financial approval could not be confirmed.'); run = r.data;
  }
  const start = await client.rpc('start_xero_financial_sync_run_v1', { p_run_id: run.id, p_expected_revision: run.revision });
  assert(!start.error && transitionMatches(run, start.data, 'processing', actor), 'Another accounting writer or stale revision prevents this run.'); run = start.data;
  loaded = await saved(client, run.id, actor);
  const outcomes = []; let uncertain = false;
  try {
    const chosen = loaded.items.filter(r => r.selected);
    assert(chosen.length === ids.length && chosen.every(r => ids.includes(r.id) && r.status === 'selected'), 'Selected financial rows changed.');
    for (const row of chosen) {
      const index = loaded.items.findIndex(r => r.id === row.id);
      uncertain = true;
      try {
        outcomes.push(await persistSupplierFinancialBucketPreservation(client, { runId: run.id, expectedRunRevision: run.revision,
          itemId: row.id, expectedItemUpdatedAt: row.updated_at, tenantId: fresh.collection.tenantId,
          previewReview: row.source_payload.supplierFinancialReview, review: fresh.rows[index].review, actor }));
        uncertain = false;
      } catch (error) {
        // Before-RPC validation and atomic SQL rejection prove no write. Unknown
        // outcomes retain the writer barrier and require exact readback.
        const definite = new Set(['SUPPLIER_FINANCIAL_LINK_REJECTED', 'SUPPLIER_FINANCIAL_ACCEPTANCE_INVALID',
          'SUPPLIER_FINANCIAL_REVIEW_INVALID', 'SUPPLIER_FINANCIAL_TRANSPORT_BOUND', 'SUPPLIER_FINANCIAL_TRANSPORT_JSON_INVALID',
          'SUPPLIER_FINANCIAL_ORIGINAL_EVIDENCE_BOUND', 'SUPPLIER_FINANCIAL_PREVIEW_EXECUTION_CHANGED',
          'SUPPLIER_FINANCIAL_TENANT_MISMATCH', 'SUPPLIER_FINANCIAL_SERVICE_CLIENT_REQUIRED']);
        if (definite.has(error?.code)) uncertain = false;
        throw error;
      }
    }
    uncertain = true; run = await finish('completed', outcomes); uncertain = false;
    return { run: runView(run), outcomes, financialWrites: 0, documentVerification: 'UNVERIFIED' };
  } catch (error) {
    if (!uncertain) await finish(outcomes.length ? 'partial' : 'failed', outcomes, error).catch(() => null);
    throw error;
  }
}
