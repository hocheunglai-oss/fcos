import { copyPaidSupplierProofJson } from './_xeroPaidSupplierProofJson.js';
import { issuedSupplierCanonical as canonical, issuedSupplierHash as hash, issuedSupplierSfId as sf } from './_xeroIssuedSupplierPreservation.js';
import { SUPPLIER_FINANCIAL_BUCKET_POLICY as POLICY, evaluateSupplierFinancialBucketPreservation,
  supplierFinancialBucketReview } from './_xeroSupplierFinancialBucketPreservation.js';

export const SUPPLIER_FINANCIAL_BUCKET_RECEIPT = 'supplier_financial_bucket_link_receipt_v1';
const EVENT = 'supplier_financial_bucket_document_linked';
const RPC = 'link_xero_financial_bucket_document_v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const uuid = v => typeof v === 'string' && UUID.test(v) && v !== '00000000-0000-0000-0000-000000000000' ? v.toLowerCase() : null;
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const same = (a, b) => canonical(a) === canonical(b);
const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v)
  && same(Object.keys(v).sort(), [...expected].sort());
const REVIEW_KEYS = Object.freeze(['policyVersion', 'fingerprint', 'evidenceFingerprint', 'approvalMaterialHash', 'reviewFingerprint',
  'legacyReviewFingerprint', 'evidence', 'accountingCanonical', 'evidenceCanonical', 'localClaimScope', 'localClaimScopeCanonical']);
const STRINGS = Object.freeze(['accountingCanonical', 'evidenceCanonical', 'localClaimScopeCanonical']);
const RECEIPT_KEYS = Object.freeze(['policyVersion', 'receiptContract', 'fingerprint', 'approvalMaterialHash', 'previewEvidenceFingerprint',
  'executionEvidenceFingerprint', 'originalReview', 'previewReviewHash', 'executionReviewHash', 'ledgerPaymentProofFingerprint',
  'documentVerification', 'financialWrites', 'acceptance']);
const RESULT_KEYS = Object.freeze(['id', 'status', 'xeroDocumentId', 'mappingId', 'policyVersion', 'receiptContract', 'fingerprint',
  'approvalMaterialHash', 'previewEvidenceFingerprint', 'executionEvidenceFingerprint', 'ledgerPaymentProofFingerprint',
  'documentVerification', 'financialWrites', 'alreadyLinked']);
const marker = Object.freeze({ policyVersion: POLICY, proofValid: true, workflowEligible: false, approvalGranted: false,
  accepted: false, documentVerification: 'UNVERIFIED' });
const failure = (code, status = 409) => Object.assign(Error(code), { code, status });
const requireThat = (ok, code = 'SUPPLIER_FINANCIAL_REVIEW_INVALID') => { if (!ok) throw failure(code); };

// The wire review repeats canonical strings. Its distinct 4 MB transport bound
// does not enlarge the 1 MB bound on original evidence or local claim scope.
function copyTransportJson(value) {
  let nodes = 0; const visiting = new Set();
  const walk = (v, depth) => {
    if (++nodes > 100_000 || depth > 24) throw failure('SUPPLIER_FINANCIAL_TRANSPORT_BOUND');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)) return v;
    if (typeof v !== 'object' || visiting.has(v) || Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype))
      throw failure('SUPPLIER_FINANCIAL_TRANSPORT_JSON_INVALID');
    visiting.add(v); const descriptors = Object.getOwnPropertyDescriptors(v), own = Reflect.ownKeys(descriptors), array = Array.isArray(v), out = array ? [] : {};
    if (own.some(k => typeof k !== 'string') || array && own.length !== v.length + 1) throw failure('SUPPLIER_FINANCIAL_TRANSPORT_JSON_INVALID');
    for (const k of own) {
      if (array && k === 'length') continue;
      const d = descriptors[k];
      if (!Object.hasOwn(d, 'value') || !d.enumerable || array && (!/^(?:0|[1-9]\d*)$/.test(k) || Number(k) >= v.length))
        throw failure('SUPPLIER_FINANCIAL_TRANSPORT_JSON_INVALID');
      Object.defineProperty(out, k, { value: walk(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    visiting.delete(v); return out;
  };
  const copied = walk(value, 0);
  requireThat(copied && typeof copied === 'object' && !Array.isArray(copied)
    && Buffer.byteLength(JSON.stringify(copied)) <= 4_000_000, 'SUPPLIER_FINANCIAL_TRANSPORT_BOUND');
  return copied;
}

function validateReview(value) {
  const r = copyTransportJson(value); requireThat(keys(r, REVIEW_KEYS));
  let originals;
  try { originals = copyPaidSupplierProofJson({ evidence: r.evidence, localClaimScope: r.localClaimScope }); }
  catch { throw failure('SUPPLIER_FINANCIAL_ORIGINAL_EVIDENCE_BOUND'); }
  const a = originals.evidence?.accounting;
  requireThat(a && r.policyVersion === POLICY);
  const proof = evaluateSupplierFinancialBucketPreservation({ policyVersion: POLICY, tenantId: a.tenantId, source: a.source,
    target: a.target, identity: a.identity, organisation: a.organisation, productMappings: a.productMappings,
    accountTax: a.accountTax, sourceDependencies: a.sourceDependencies,
    ...(a.settlement?.status === 'PAID' ? { ledgerPaymentEvidence: {
      payments: a.settlement.ledgerPaymentProof?.evidence?.originals?.payments,
      accounts: a.settlement.ledgerPaymentProof?.evidence?.originals?.accounts } } : {}) });
  const derived = supplierFinancialBucketReview(proof, { reviewFingerprint: r.reviewFingerprint, legacyReviewFingerprint: r.legacyReviewFingerprint });
  requireThat(derived && same(derived, r)); return freeze(r);
}

// Compare PostgreSQL timestamptz values without discarding microseconds.
function instant(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59) return null;
  const day = Date.parse(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== m[1]) return null;
  if (m[6] !== 'Z' && (Number(m[6].slice(1, 3)) > 23 || Number(m[6].slice(4, 6)) > 59)) return null;
  const base = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
  return Number.isFinite(base) ? BigInt(base) * 1000n + BigInt((m[5] || '').padEnd(6, '0') || '0') : null;
}

function context(args) {
  const runId = uuid(args?.runId), itemId = uuid(args?.itemId), tenantId = uuid(args?.tenantId), actorId = uuid(args?.actor?.id);
  const email = args?.actor?.email;
  requireThat(runId && itemId && tenantId && actorId && Number.isSafeInteger(args.expectedRunRevision) && args.expectedRunRevision > 0
    && instant(args.expectedItemUpdatedAt) !== null && typeof email === 'string' && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), 'SUPPLIER_FINANCIAL_ACCEPTANCE_INVALID');
  const preview = validateReview(args.previewReview), review = validateReview(args.review);
  requireThat(same(preview, review), 'SUPPLIER_FINANCIAL_PREVIEW_EXECUTION_CHANGED');
  requireThat(review.evidence.accounting.tenantId === tenantId && review.localClaimScope.tenantId === tenantId, 'SUPPLIER_FINANCIAL_TENANT_MISMATCH');
  return freeze({ runId, itemId, tenantId, runRevision: args.expectedRunRevision, itemUpdatedAt: args.expectedItemUpdatedAt,
    actorId, actorEmail: email.trim().toLowerCase(), review, preview });
}
const ledgerFingerprint = c => c.review.evidence.accounting.settlement.ledgerPaymentProof?.fingerprint ?? null;
const expectedResult = (c, mappingId, alreadyLinked) => ({ id: c.itemId, status: 'linked', xeroDocumentId: c.review.evidence.accounting.targetId,
  mappingId, policyVersion: POLICY, receiptContract: SUPPLIER_FINANCIAL_BUCKET_RECEIPT, fingerprint: c.review.fingerprint,
  approvalMaterialHash: c.review.approvalMaterialHash, previewEvidenceFingerprint: c.preview.evidenceFingerprint,
  executionEvidenceFingerprint: c.review.evidenceFingerprint, ledgerPaymentProofFingerprint: ledgerFingerprint(c),
  documentVerification: 'UNVERIFIED', financialWrites: 0, alreadyLinked });

function validateResult(value, c) {
  const r = copyTransportJson(value);
  requireThat(keys(r, RESULT_KEYS) && uuid(r.mappingId) && typeof r.alreadyLinked === 'boolean'
    && same(r, expectedResult(c, r.mappingId, r.alreadyLinked)), 'SUPPLIER_FINANCIAL_DURABLE_RESULT_MISMATCH');
  return r;
}

function validateReceipt(value, c) {
  const r = copyTransportJson(value);
  requireThat(keys(r, RECEIPT_KEYS) && keys(r.originalReview, REVIEW_KEYS.filter(k => !STRINGS.includes(k))), 'SUPPLIER_FINANCIAL_RECEIPT_INVALID');
  const projection = r.originalReview, reconstructed = validateReview({ ...projection,
    accountingCanonical: canonical({ policyVersion: projection.policyVersion, accounting: projection.evidence?.accounting }),
    evidenceCanonical: canonical(projection.evidence), localClaimScopeCanonical: canonical(projection.localClaimScope) });
  const a = r.acceptance;
  requireThat(same(reconstructed, c.review) && r.previewReviewHash === hash(c.preview) && r.executionReviewHash === hash(c.review)
    && r.policyVersion === POLICY && r.receiptContract === SUPPLIER_FINANCIAL_BUCKET_RECEIPT && r.fingerprint === c.review.fingerprint
    && r.approvalMaterialHash === c.review.approvalMaterialHash && r.previewEvidenceFingerprint === c.preview.evidenceFingerprint
    && r.executionEvidenceFingerprint === c.review.evidenceFingerprint && r.ledgerPaymentProofFingerprint === ledgerFingerprint(c)
    && r.documentVerification === 'UNVERIFIED' && r.financialWrites === 0
    && keys(a, ['runId', 'itemId', 'runRevision', 'itemUpdatedAt', 'actorId', 'actorEmail'])
    && a.runId === c.runId && a.itemId === c.itemId && a.runRevision === c.runRevision
    && instant(a.itemUpdatedAt) !== null && instant(a.itemUpdatedAt) === instant(c.itemUpdatedAt)
    && a.actorId === c.actorId && a.actorEmail === c.actorEmail, 'SUPPLIER_FINANCIAL_RECEIPT_MISMATCH');
  return r;
}

async function singleton(query) {
  const response = await query;
  requireThat(response && !response.error && Array.isArray(response.data) && response.data.length === 1, 'SUPPLIER_FINANCIAL_READBACK_INCOMPLETE');
  return copyTransportJson(response.data[0]);
}
async function recover(client, c) {
  requireThat(typeof client.from === 'function', 'SUPPLIER_FINANCIAL_READBACK_UNAVAILABLE');
  const a = c.review.evidence.accounting;
  const reads = await Promise.allSettled([
    () => singleton(client.from('xero_financial_sync_items').select('id,run_id,source_object,source_id,source_type,proposed_action,status,selected,source_payload,proposed_payload,xero_document_id,xero_document_status,mutation_attempts,updated_at').eq('id', c.itemId).eq('run_id', c.runId).limit(2)),
    () => singleton(client.from('xero_financial_document_mappings').select('id,salesforce_object,salesforce_id,document_kind,xero_document_type,xero_document_id,xero_contact_id,xero_status,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences').eq('xero_document_type', 'ACCPAY').eq('xero_document_id', a.targetId).limit(2)),
    () => singleton(client.from('xero_financial_audit_events').select('id,run_id,event_type,outcome,actor_id,actor_email,record_counts,fingerprints').eq('run_id', c.runId).eq('event_type', EVENT).eq('fingerprints->>itemId', c.itemId).limit(2)),
  ].map(read => Promise.resolve().then(read)));
  requireThat(reads.every(r => r.status === 'fulfilled'), 'SUPPLIER_FINANCIAL_READBACK_INCOMPLETE');
  const [item, mapping, audit] = reads.map(r => r.value);
  const receipt = validateReceipt(mapping.retained_differences?.financialBucketPreservation, c);
  const baseSource = Object.fromEntries(Object.entries(item.source_payload || {}).filter(([k]) => !['supplierFinancialReview', 'supplierFinancialPreservation'].includes(k)));
  requireThat(item.id === c.itemId && item.run_id === c.runId && item.source_object === 'Supplier_Invoice__c'
    && item.source_id === a.source.sourcePayload.salesforceId && item.source_type === 'supplier_bill' && item.proposed_action === 'protected_legacy'
    && item.status === 'linked' && item.selected === true && Object.hasOwn(item, 'proposed_payload') && item.proposed_payload === null
    && item.mutation_attempts === 0 && item.xero_document_id === a.targetId && item.xero_document_status === a.target.Status
    && instant(item.updated_at) !== null && instant(item.updated_at) >= instant(c.itemUpdatedAt)
    && same(item.source_payload?.supplierFinancialReview, c.review) && same(item.source_payload?.supplierFinancialPreservation, marker)
    && same(baseSource, a.source.sourcePayload), 'SUPPLIER_FINANCIAL_ITEM_READBACK_MISMATCH');
  requireThat(uuid(mapping.id) && mapping.salesforce_object === 'Supplier_Invoice__c' && sf(mapping.salesforce_id) === a.sourceId
    && mapping.salesforce_id === a.source.sourcePayload.salesforceId && mapping.document_kind === 'supplier_bill'
    && mapping.xero_document_type === 'ACCPAY' && mapping.xero_document_id === a.targetId && mapping.xero_contact_id === a.contactId
    && mapping.xero_status === a.target.Status && mapping.source_fingerprint === a.sourceFingerprint && mapping.financial_fingerprint === a.financialFingerprint
    && mapping.protected_legacy === true, 'SUPPLIER_FINANCIAL_MAPPING_READBACK_MISMATCH');
  requireThat(audit.run_id === c.runId && audit.event_type === EVENT && audit.outcome === 'success' && audit.actor_id === c.actorId
    && audit.actor_email === c.actorEmail && same(audit.record_counts, { linked: 1, applied: 0, financialWrites: 0 })
    && keys(audit.fingerprints, ['tenantId', 'itemId', 'mappingId', 'financialBucketPreservation'])
    && audit.fingerprints.tenantId === c.tenantId && audit.fingerprints.itemId === c.itemId && audit.fingerprints.mappingId === mapping.id
    && same(audit.fingerprints.financialBucketPreservation, receipt), 'SUPPLIER_FINANCIAL_AUDIT_READBACK_MISMATCH');
  return expectedResult(c, mapping.id, true);
}

/** Service-only transport. The trusted lifecycle supplies fresh current material
 * and exact human run approval; SQL owns revision, approval and durable locks.
 * This module performs one local link RPC, no provider or accounting writes.
 * Raw reviews/readbacks stay private; errors and results expose no originals.
 */
export async function persistSupplierFinancialBucketPreservation(client, args) {
  const c = context(args);
  requireThat(client && typeof client.rpc === 'function', 'SUPPLIER_FINANCIAL_SERVICE_CLIENT_REQUIRED');
  let response;
  try { response = await client.rpc(RPC, { p_run_id: c.runId, p_expected_run_revision: c.runRevision, p_item_id: c.itemId,
    p_expected_item_updated_at: c.itemUpdatedAt, p_tenant_id: c.tenantId, p_review: c.review, p_actor_id: c.actorId, p_actor_email: c.actorEmail }); }
  catch { response = null; }
  if (response?.error && ['40001', '42501', '23505', '22023', '22P02', 'P0001', '55P03'].includes(response.error.code))
    throw failure('SUPPLIER_FINANCIAL_LINK_REJECTED');
  let result, recovered = false;
  if (response && !response.error) { try { result = validateResult(response.data, c); } catch { /* Unknown durable outcome requires readback. */ } }
  if (!result) {
    try { result = await recover(client, c); recovered = true; }
    catch { throw failure('SUPPLIER_FINANCIAL_LINK_OUTCOME_UNCERTAIN', 503); }
  }
  return freeze({ ...result, recovered, linked: 1, applied: 0, financialWrites: 0 });
}

/** Recovery of an already processing/completed owned item is read-only. The
 * lifecycle supplies the original acceptance revision/time from its stored
 * compact receipt; exact readback checks them against the owned run/item/actor
 * and original preview. Advanced current revision/time cannot replace them.
 */
export async function readSupplierFinancialBucketOutcome(client, args) {
  const c = context(args);
  let result;
  try { result = await recover(client, c); }
  catch { throw failure('SUPPLIER_FINANCIAL_LINK_OUTCOME_UNCERTAIN', 503); }
  return freeze({ ...result, recovered: true, linked: 1, applied: 0, financialWrites: 0 });
}
