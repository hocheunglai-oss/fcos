import { createHash } from 'node:crypto';
import { copyPaidSupplierProofJson as copyJson } from './_xeroPaidSupplierProofJson.js';
import { issuedSupplierCanonical as canonical, issuedSupplierHash as hash, issuedSupplierSfId as sf } from './_xeroIssuedSupplierPreservation.js';
import { supplierFinancialSignedCents as cents } from './_xeroSupplierFinancialBucketPreservation.js';
import { accountingProductCents } from './_xeroAccountingLineCents.js';
import { aggregateSupplierCalendarDate as calendar } from './_xeroAggregateSupplierDates.js';
import { accountingPayload } from './_xeroDocumentSafety.js';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

export const EXISTING_DRAFT_AUTHORISATION_POLICY = 'authorise_existing_xero_drafts_v1';
export const EXISTING_DRAFT_AUTHORISATION_RECEIPT = 'existing_draft_status_authorisation_receipt_v1';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const EXISTING_DRAFT_AUTHORISATION_PROVENANCE = freeze({
  selectionFileSha256: '6230b2578549e33b67555931391e9cdd943d5134377eebc357e2b0e46b1e7a24',
  selectionSha256: 'b3414d1d6f3bfe9e8c17e515d04ecbbe9cb216dac2bb2ec1ee4da30a53dd8506',
  humanApprovalSha256: 'f6ec43c03822df879641eabbfd98d1340841ef5f102bc2e720a0576ea273d004',
});
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const uuid = v => typeof v === 'string' && UUID.test(v) && v !== '00000000-0000-0000-0000-000000000000';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const equal = (a, b) => canonical(a) === canonical(b);
const exactKeys = (v, keys) => plain(v) && equal(Object.keys(v).sort(), [...keys].sort());
const utf8Hash = v => createHash('sha256').update(v, 'utf8').digest('hex');
// Opaque hashes bind exact privately approved {tenantId,record} leaves.
// Business records, provider IDs and amounts remain in private runtime storage.
const APPROVED_LEAVES = Object.freeze([
  "809651dd3b1ee7b74b926ea401c25f8411819d49d6caa7f217d6a83e744f059b",
  "347cb7f65822ec77eb841239bac810a29ab3f83c1ead80b3bb576599a20bfd51",
  "c77a2166311b5b1216cce78107ac82775fad9c0618f4e0ab68b9d13d2480caf5",
  "d089da4702acf51833aa2dcccd59b6fc173a0c5cd679c18da53cfc9c2aa710a1",
  "fec6f28482c0cf3b8cdf74a0dae1be42bb81671be2b27b481bdb9858a5b3b111",
  "411f5d6c5e23fe59558101e33790ea157335ea021e7c18b2c10137cf79f094a0",
  "faa7333b07e0048308000799341393dcabdc1991ca656d37501c6bbfe34c45a5",
  "9be7a9f62dd4840cdcb105bd970307aa8e65e93e83801be1da3058497f189264",
  "067513544589c14577a09faaed9b54ffe45f3545b3ac655739cc8ee3da6d730e",
  "a6d6cc8d95eff36942730fea81c29384b6f83b766a156829819c67ee8e07bab7",
  "1d46c43a3c6166cf57f95e0945a2ee0d3d4527ba052eb03b0a5d3904abc12a44",
  "e0c8381158462f659efa67c44a938f866c4d479070b8afc93b0cbf99c1ac2037",
  "95ad07fc7de1622a4a5d0be0df863f6ef75fd98cd2d3f051f43a8f53aa68eb9c",
  "607bf69e18d131797eeed2e3e0f1b8f043d815088ea7727a57914ac48bc88da8",
  "24519e2b9f1adebc887c1d66febebe8bc101a5de9ef7eab0e3bada06926c22af",
  "73f1dc2d7b8432d2bf1fae138c3cf753bda5085872b8ec760917b8935487fa87",
  "8ec2aaf2f4968edb7d13c1180add629f8b6a96aa7614bab16d0686afb5030f09",
  "e14bbb70ef94cff90b9aeabb04d2ddc9eb93f49dc6d8527e0f46d71989825925",
  "b02510361f1bed431baa4b6a86672525a5d0be73e23db247e62c3af5f8b5d46a",
  "779b809858862e3b69baba6e922e97a6cca361d1c6cd9c25ac8246adf802df6d",
  "70c06a9e53bb9e9b01703bc4bc2423ff554a2ff11196044690b822c2bb36a85d",
  "6a0d579a93f0d6730e9d9e231641b5de0fb64c9e08d8629dad71a0676844a0d9",
  "46daea265967c9050a19b88a7193222fccb631ff8009a74c59c5b036882431ce",
  "1f778ff2fa76a8a629013d2187540c3b22c25a0f59f5e8f28f932c3b9c9c146f",
  "57f1eb6f5c0e62944dbfb5904e9def86eb3f88a79f9059a82990f2804915220c",
  "f5117caa36f90e2574d0e9d00c55e6bf904d1598befca5bed7e26fd4081e6f46",
  "8246d09f8e8119b04754b5c02fc6526bd47e29d8f7868a85960b72d7c7caa44d",
  "c33ecec19045768c2948418764bd2909ea939eb479eb5425ff46260384b6a188",
  "0e0f44c9bf3561e4d79053e454b2f81e14efb551cd4c53cb1d5db81547dc1db3",
  "28efd46c94906be69fba1c0d047f12f9b60ccd087483fed1948fa2c83feffb59",
  "5660c0a10d87a567dc801f904b6b1309a583c613e279a8844d6eb80ced6af0e6",
  "6a502a19d86155e8dd2c85c0d2670a5e5a823103cbfffb61b1429014ac7ad122",
  "9be8db264a9d17b496df9addf037fba36f0a1e0857fa809ec5c5eece76e09f74",
  "a7eb61603d8b2e32c9ec087093799cdfe6bd3ce7c9f394f266ce0dcc9d1e52ce",
  "07e1ab535495de50d0e7aa69e3d4c2334b3060bd6e3e9de5c8652f906194a6a1",
  "29233f1ff50bd2670dbbc9344dd338a9ac7a125a0061632d5afa6c167de85662",
  "5b0713e0bd4e2c74fde2386953806b1634c7df06738b2760ef174450d181a967",
  "657c3941f7b4b2991ece4627d81ed849449126b752261e9a739a6055ab7a85c6",
  "7bef7c049b993583e235ca566c1a4b7dd93e475b19c8db3e25b6a1cc45567099",
  "2bd8d04c574cda5b00bfd6156d1909305d11a093fed05c664077b3134a70e50e",
  "45a59a50a2ef4fbc7840c8a837bd96316021585ef54fd02dd5d6862513036d13",
  "4de511c1721a49128d0a2434d7658ba5b7ec84d20dec9c46e52b962de121c446",
  "5fc27546e1d4907ebfee44da6f3a836e232421a014ef9b3086f6f79f9d7d784f",
  "8b198e5c642f4ac40b9e2f295815a8f5cb3dcdf359340f11446f39375bce280b",
  "fc669436be630c8371b7d3b213f2f4bd67cd4f24d468d46769f904755f49141f",
  "73adbc47aaea51c005b1d4e425ff19985d09b46229ad324eed13f3b85f1cc2c0",
  "9304b212cb318fca1a7c921764841d05f57eace2bb51ad7ed15cbbb70e9dad65",
  "9bb04cf4d02bb417266cc7b3fef05c20a93d4bc3eccdf8b5520ea11dc5243dcc",
  "9c3922cde20f8473c039cb720fe83391afa2628dee242b3d7b6ab58aa2f26a72",
  "896f50054100933dd381a58f4febdd0e30c56fdba3053bd3f42402e5ed4df581",
  "f55d4beff997567846476ab96e920a431486a0317d93f3ab04b6d5073eee40de",
  "6fe04ddd5c593f0c688c2268859dec491eaab78f9932216499972fc4257192d2",
  "ce7e58585336cef590b5409ec57f3d1ceee1d71001c665691d798725438e5e19",
  "9a22df82b6f3716322fbde8685cce1cebf45bfe64329d5b76d223c28274c2358"
]);
function approvedRecord(selection, tenantId) {
  const record = selection?.record;
  return exactKeys(record, ['sourceObject', 'sourceId', 'targetId', 'rawTargetSha256', 'currency', 'total', 'beforeStatus', 'afterStatus', 'accountCodes', 'taxTypes'])
    && ['Invoice__c', 'Supplier_Invoice__c'].includes(record.sourceObject) && sf(record.sourceId) && uuid(record.targetId)
    && HASH.test(record.rawTargetSha256 || '') && record.currency === 'USD' && cents(record.total) > 0n
    && record.beforeStatus === 'DRAFT' && record.afterStatus === 'AUTHORISED'
    && equal(record.accountCodes, [record.sourceObject === 'Invoice__c' ? '41100' : '51100']) && equal(record.taxTypes, ['NONE'])
    && uuid(tenantId) && APPROVED_LEAVES.includes(hash({ tenantId, record })) ? record : null;
}
// The approved review's historical hashes used Python ensure_ascii=True.
// Keep that domain separate from new UTF-8 evidence hashes; no raw fact changes.
export function existingDraftApprovedTargetCanonical(value) {
  return canonical(copyJson(value)).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export const existingDraftApprovedTargetHash = v => utf8Hash(existingDraftApprovedTargetCanonical(v));
export const existingDraftAuthorisationCanonical = v => canonical(copyJson(v));
export const existingDraftAuthorisationHash = v => utf8Hash(existingDraftAuthorisationCanonical(v));
const protectedTarget = v => Object.fromEntries(Object.entries(v).filter(([k]) => !['Status', 'UpdatedDateUTC', 'UpdatedDateUTCString'].includes(k)));

function updateTime(row) {
  const hasRaw = Object.hasOwn(row, 'UpdatedDateUTC'), hasIso = Object.hasOwn(row, 'UpdatedDateUTCString');
  if (!hasRaw && !hasIso) return null;
  let raw = null, iso = null;
  if (hasRaw) {
    const m = typeof row.UpdatedDateUTC === 'string' && /^\/Date\((-?(?:0|[1-9]\d*))(?:[+-]0000)?\)\/$/.exec(row.UpdatedDateUTC);
    if (!m || m[0] !== row.UpdatedDateUTC) return false;
    raw = Number(m[1]); if (!Number.isSafeInteger(raw) || raw < -62135596800000 || raw > 253402300799999) return false;
  }
  if (hasIso) {
    const value = row.UpdatedDateUTCString;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
    iso = Date.parse(value);
    if (!Number.isFinite(iso) || new Date(iso).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) return false;
  }
  if (raw !== null && iso !== null && Math.floor(raw / 1000) !== Math.floor(iso / 1000)) return false;
  return raw ?? iso;
}
function errorFree(v) {
  return plain(v) && ['HasErrors', 'HasValidationErrors', 'IsDeleted'].every(k => !Object.hasOwn(v, k) || v[k] === false)
    && (!Object.hasOwn(v, 'ValidationErrors') || Array.isArray(v.ValidationErrors) && v.ValidationErrors.length === 0);
}
function refundFree(v) {
  if (!v || typeof v !== 'object') return true;
  return Object.entries(v).every(([k, child]) => !['Refunds', 'AmountRefunded'].includes(k) && refundFree(child));
}
// Explicit approved fields must remain equal. A detail Contact may expand the
// collection Contact, but no approved Contact field may silently contradict it.
function approvedSubset(approved, fresh) {
  if (Array.isArray(approved)) return Array.isArray(fresh) && approved.length === fresh.length && approved.every((v, i) => approvedSubset(v, fresh[i]));
  if (plain(approved)) return plain(fresh) && Object.entries(approved).every(([k, v]) => Object.hasOwn(fresh, k) && approvedSubset(v, fresh[k]));
  return equal(approved, fresh);
}
function headerAndLines(target, type, total) {
  if (!errorFree(target) || !errorFree(target.Contact) || !refundFree(target) || target.Type !== type || !uuid(target.InvoiceID)
    || !uuid(target.Contact.ContactID) || target.CurrencyCode !== 'USD' || cents(target.CurrencyRate) !== 100n
    || !['NoTax', 'Exclusive'].includes(target.LineAmountTypes) || target.IsDiscounted !== false || cents(target.Total) !== total
    || cents(target.SubTotal) !== total || cents(target.TotalTax) !== 0n || total === null || total <= 0n
    || !calendar(target, 'Date') || !calendar(target, 'DueDate') || updateTime(target) === false
    || cents(target.AmountPaid) !== 0n || cents(target.AmountCredited) !== 0n || cents(target.AmountDue) !== total
    || ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].some(k => !Array.isArray(target[k]) || target[k].length)
    || Object.hasOwn(target, 'FullyPaidOnDate') || Object.hasOwn(target, 'SentToContact') && target.SentToContact !== false
    || Object.hasOwn(target, 'RoundingAmount') && cents(target.RoundingAmount) !== 0n
    || Object.hasOwn(target, 'EnteredTotal') && cents(target.EnteredTotal) !== total
    || !Array.isArray(target.LineItems) || target.LineItems.length < 1 || target.LineItems.length > 100) return null;
  const buckets = new Map(); const ids = new Set(); let sum = 0n;
  for (const line of target.LineItems) {
    const amount = cents(line.LineAmount);
    if (!errorFree(line) || !uuid(line.LineItemID) || ids.has(line.LineItemID) || amount === null || amount === 0n
      || typeof line.AccountCode !== 'string' || !line.AccountCode || line.TaxType !== 'NONE' || cents(line.TaxAmount) !== 0n
      || Object.hasOwn(line, 'DiscountRate') && cents(line.DiscountRate) !== 0n
      || Object.hasOwn(line, 'DiscountAmount') && cents(line.DiscountAmount) !== 0n
      || accountingProductCents(line.Quantity, line.UnitAmount) !== amount) return null;
    ids.add(line.LineItemID); sum += amount; const key = `${line.AccountCode}|NONE|USD`; buckets.set(key, (buckets.get(key) || 0n) + amount);
  }
  return sum === total ? [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => [key, amount.toString()]) : null;
}

/** Private snapshot proof only. Trusted acquisition, current SQL claims, actor
 * authority and workflow admission remain independent server responsibilities.
 * Even a valid pure result never grants approval or executable authority. */
export function evaluateExistingDraftAuthorisationEvidence(input) {
  const blockers = []; const check = (ok, code) => { if (!ok && !blockers.includes(code)) blockers.push(code); return Boolean(ok); };
  const out = evidence => freeze({ policyVersion: EXISTING_DRAFT_AUTHORISATION_POLICY, proofValid: Boolean(evidence) && !blockers.length,
    workflowEligible: false, approvalGranted: false, financialWrites: 0, documentVerification: 'UNVERIFIED',
    evidence: evidence || null, fingerprint: evidence && !blockers.length ? hash(evidence) : null,
    payload: evidence && !blockers.length ? { Invoices: [{ InvoiceID: evidence.before.InvoiceID, Status: 'AUTHORISED' }] } : null, blockers });
  let e; try { e = copyJson(input); } catch { check(false, 'DRAFT_JSON_INVALID_OR_BOUND'); return out(null); }
  try {
    if (!check(exactKeys(e, ['policyVersion', 'selection', 'source', 'reviewedTarget', 'before', 'expectedAfter', 'current']), 'DRAFT_ENVELOPE_INVALID')) return out(null);
    const source = e.source, current = e.current, record = approvedRecord(e.selection, current?.tenantId);
    check(e.policyVersion === EXISTING_DRAFT_AUTHORISATION_POLICY && record && exactKeys(e.selection, ['selectionFileSha256', 'selectionSha256', 'humanApprovalSha256', 'record'])
      && equal(e.selection, { ...EXISTING_DRAFT_AUTHORISATION_PROVENANCE, record }), 'DRAFT_APPROVED_SELECTION_CHANGED');
    if (!record || !plain(source) || !plain(current) || !plain(e.before) || !plain(e.reviewedTarget)) return out(null);
    const type = record.sourceObject === 'Invoice__c' ? 'ACCREC' : 'ACCPAY', total = cents(record.total);
    check(existingDraftApprovedTargetHash(e.reviewedTarget) === record.rawTargetSha256 && e.reviewedTarget.Status === 'DRAFT'
      && updateTime(e.reviewedTarget) !== false && approvedSubset(protectedTarget(e.reviewedTarget), protectedTarget(e.before)), 'DRAFT_APPROVED_ORIGINAL_CHANGED');
    check(e.before.Status === 'DRAFT' && equal(e.expectedAfter, { ...e.before, Status: 'AUTHORISED' }), 'DRAFT_STATUS_TRANSITION_INVALID');
    const targetBuckets = headerAndLines(e.before, type, total);
    check(targetBuckets !== null, 'DRAFT_TARGET_FINANCIAL_OR_SETTLEMENT_HELD');
    check(source.salesforceObject === record.sourceObject && sf(source.salesforceId) === sf(record.sourceId) && source.xeroType === type
      && source.xeroCollection === 'Invoices' && source.documentKind === (type === 'ACCREC' ? 'buyer_invoice' : 'supplier_bill')
      && source.currency === 'USD' && source.postingMode === 'draft' && cents(source.total) === total && cents(source.signedTotal) === total
      && sf(source.accountId)?.startsWith('001') && sf(source.stemId)?.startsWith('a0H') && source.contactId === e.before.Contact?.ContactID
      && HASH.test(source.sourceFingerprint || '') && HASH.test(source.financialFingerprint || '')
      && Array.isArray(source.blockers) && source.blockers.length === 0, 'DRAFT_SOURCE_IDENTITY_OR_HEADER_HELD');
    // FinancialSync derives this legacy financial hash before adding the separate
    // document-field projection. Bind that original formula, while E retains all fields.
    check(hash(accountingPayload(source)) === source.financialFingerprint, 'DRAFT_BUILDER_FINANCIAL_FINGERPRINT_CHANGED');
    const sourceBuckets = new Map(); const sourceIds = new Set(); let sourceTotal = 0n;
    check(Array.isArray(source.lines) && source.lines.length > 0 && source.lines.length <= 100, 'DRAFT_SOURCE_LINES_HELD');
    for (const line of Array.isArray(source.lines) ? source.lines : []) {
      const amount = accountingProductCents(line.quantity, line.unitAmount), id = sf(line.sourceId);
      check(id && !sourceIds.has(id) && amount !== null && amount !== 0n && record.accountCodes.includes(line.accountCode)
        && line.taxType === 'NONE', 'DRAFT_SOURCE_LINES_HELD');
      if (amount !== null) { sourceTotal += amount; const key = `${line.accountCode}|NONE|USD`; sourceBuckets.set(key, (sourceBuckets.get(key) || 0n) + amount); }
      sourceIds.add(id);
    }
    const sb = [...sourceBuckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => [key, amount.toString()]);
    check(sourceTotal === total && targetBuckets !== null && equal(sb, targetBuckets), 'DRAFT_FINANCIAL_BUCKET_MISMATCH');
    check(exactKeys(current, ['tenantId', 'orgId', 'observedAt', 'sourceSnapshotHash', 'controlSnapshotHash', 'identitySnapshotHash',
      'organisation', 'sourceEvidence', 'controls', 'identity', 'receipts']) && uuid(current.tenantId)
      && sf(current.orgId) === sf(fcosSalesforceEnvironment('production').orgId) && typeof current.observedAt === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(current.observedAt)
      && Number.isFinite(Date.parse(current.observedAt)) && new Date(current.observedAt).toISOString() === current.observedAt
      && plain(current.sourceEvidence) && plain(current.controls) && plain(current.identity) && plain(current.receipts)
      && hash(current.sourceEvidence) === current.sourceSnapshotHash && hash(current.controls) === current.controlSnapshotHash
      && hash(current.identity) === current.identitySnapshotHash, 'DRAFT_CURRENT_CAPTURE_BINDING_INVALID');
    const organisation = current.organisation;
    check(errorFree(organisation) && organisation.OrganisationID === current.tenantId && organisation.BaseCurrency === 'USD'
      && organisation.OrganisationStatus === 'ACTIVE', 'DRAFT_ORGANISATION_HELD');
    for (const field of ['PeriodLockDate', 'EndOfYearLockDate']) if (plain(organisation) && Object.hasOwn(organisation, field) && organisation[field] !== null) {
      const lock = calendar({ Date: organisation[field] }, 'Date');
      check(lock && calendar(e.before, 'Date') > lock, 'DRAFT_LOCK_DATE_HELD');
    }
    const mappings = current.controls?.documentMappings;
    const match = Array.isArray(mappings) ? mappings.filter(m => m.salesforce_object === record.sourceObject && sf(m.salesforce_id) === sf(record.sourceId)
      && m.xero_document_id === record.targetId) : [];
    check(match.length === 1 && uuid(match[0]?.id) && match[0].document_kind === source.documentKind
      && match[0].xero_document_type === type && match[0].xero_contact_id === source.contactId && match[0].xero_status === 'DRAFT'
      && HASH.test(match[0].source_fingerprint || '') && HASH.test(match[0].financial_fingerprint || '')
      && mappings.filter(m => m.xero_document_id === record.targetId || m.salesforce_object === record.sourceObject && sf(m.salesforce_id) === sf(record.sourceId)).length === 1,
    'DRAFT_MAPPING_CHANGED_OR_CONFLICTING');
    return out(blockers.length ? null : e);
  } catch { check(false, 'DRAFT_EVIDENCE_INCOMPLETE'); return out(null); }
}

export function buildExistingDraftAuthorisationEvidence(input) {
  let value; try { value = copyJson(input); } catch { return evaluateExistingDraftAuthorisationEvidence(null); }
  if (!exactKeys(value, ['selection', 'source', 'reviewedTarget', 'before', 'current'])) return evaluateExistingDraftAuthorisationEvidence(null);
  return evaluateExistingDraftAuthorisationEvidence({ policyVersion: EXISTING_DRAFT_AUTHORISATION_POLICY, ...value, expectedAfter: { ...value.before, Status: 'AUTHORISED' } });
}

export function classifyExistingDraftAuthorisationReadback({ evidence, observed }) {
  const proof = evaluateExistingDraftAuthorisationEvidence(evidence);
  const result = (status, reason) => freeze({ status, reason, financialWrites: 0, resendAllowed: false });
  if (!proof.proofValid) return result('uncertain', 'ORIGINAL_DRAFT_EVIDENCE_HELD');
  let after; try { after = copyJson(observed); } catch { return result('uncertain', 'DRAFT_READBACK_UNAVAILABLE_OR_BOUND'); }
  const e = proof.evidence, beforeTime = updateTime(e.before), afterTime = updateTime(after);
  if (afterTime === false || beforeTime !== null && (afterTime === null || afterTime < beforeTime)
    || !headerAndLines(after, e.before.Type, cents(e.before.Total)) || !equal(protectedTarget(e.before), protectedTarget(after)))
    return result('uncertain', 'DRAFT_PRESERVATION_READBACK_CHANGED');
  if (after.Status === 'AUTHORISED') return result('confirmed', 'DRAFT_STATUS_ONLY_READBACK_CONFIRMED');
  if (after.Status === 'DRAFT') return result('unchanged', 'DRAFT_UNCHANGED_REQUIRES_DURABLE_REQUEST_DIAGNOSIS');
  return result('uncertain', 'DRAFT_READBACK_STATUS_HELD');
}

/** getCurrent is a server-owned callback returning originals from its own
 * complete private capture; no HTTP evidence, completeness or approval flags. */
export function createExistingDraftAuthorisationPolicy({ getCurrent, selectionFileText, approvalFileText } = {}) {
  if (typeof getCurrent !== 'function' || typeof selectionFileText !== 'string' || typeof approvalFileText !== 'string'
    || utf8Hash(selectionFileText) !== EXISTING_DRAFT_AUTHORISATION_PROVENANCE.selectionFileSha256
    || utf8Hash(approvalFileText) !== EXISTING_DRAFT_AUTHORISATION_PROVENANCE.humanApprovalSha256) throw Error('DRAFT_TRUSTED_POLICY_CONFIGURATION_HELD');
  const privateSelection = copyJson(JSON.parse(selectionFileText));
  return Object.freeze({ async prepare(request) {
    const value = copyJson(request);
    const record = privateSelection.records?.find(r => r.targetId === value.targetId);
    const selection = { ...EXISTING_DRAFT_AUTHORISATION_PROVENANCE, record };
    if (!exactKeys(value, ['targetId']) || !approvedRecord(selection, privateSelection.tenantId)) throw Error('DRAFT_APPROVED_REQUEST_HELD');
    const capture = await getCurrent(freeze({ targetId: value.targetId, record, selection }));
    const proof = buildExistingDraftAuthorisationEvidence({ ...capture, selection });
    if (!proof.proofValid || proof.evidence.before.InvoiceID !== value.targetId) throw Error('DRAFT_CURRENT_ADMISSION_HELD');
    return proof;
  } });
}
