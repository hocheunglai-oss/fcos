import { createHash } from 'node:crypto';
import { GROUP_REMITTANCE_BANK_POLICY, validateGroupRemittanceBankEvidence } from './_xeroGroupRemittanceBankEvidence.js';
import { issuedSupplierCanonical as canonical, issuedSupplierSfId as sfId } from './_xeroIssuedSupplierPreservation.js';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  && value !== '00000000-0000-0000-0000-000000000000';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (message, code = 'XERO_GROUP_PAYMENT_INVALID', status = 400) => Object.assign(new Error(message), { code, status });
export const hasGroupBankSourceEvidence = row => Object.hasOwn(row || {}, 'bankSourceEvidence');
export const groupBankProofMatches = (left, right) => {
  if (!hasGroupBankSourceEvidence(left) && !hasGroupBankSourceEvidence(right)) return true;
  try { return validatedGroupPaymentRow(left).bankSourceEvidence.fingerprint === validatedGroupPaymentRow(right).bankSourceEvidence.fingerprint
    && canonical(left.bankSourceEvidence) === canonical(right.bankSourceEvidence); } catch { return false; }
};

// Validate embedded raw facts again at the server persistence boundary. The caller
// has separately reread current Salesforce/Xero facts and enforced Finance gates.
export function validatedGroupPaymentRow(row, { requireTarget = false } = {}) {
  const proof = row?.bankSourceEvidence;
  const selectedId = sfId(row?.salesforcePaymentId);
  const selected = Array.isArray(proof?.source?.allocations) ? proof.source.allocations.find(item => item?.Id === selectedId) : null;
  const verified = validateGroupRemittanceBankEvidence(selected, proof);
  const document = row?.documentMappingSnapshot || row?.retainedReferenceEvidence?.documentMapping;
  const bank = row?.bankMappingSnapshot || row?.retainedReferenceEvidence?.bankMapping;
  if (!verified.eligible || proof.policyVersion !== GROUP_REMITTANCE_BANK_POLICY || !selectedId
    || !uuid(row.documentMappingId) || !uuid(row.bankAccountId) || (requireTarget && !uuid(row.xeroPaymentId))
    || row.salesforcePaymentName !== selected.Name || typeof row.amount !== 'number' || !Number.isFinite(row.amount)
    || row.amount !== Number(selected.Amount__c) || row.paymentDate !== selected.Date__c || row.currency !== proof.currency
    || !fingerprint(row.sourceFingerprint) || !object(document) || document.id !== row.documentMappingId
    || !uuid(document.xero_document_id) || !uuid(document.xero_contact_id)
    || !object(bank) || !uuid(bank.id) || bank.enabled !== true || bank.xero_bank_account_id !== row.bankAccountId
    || typeof bank.salesforce_bank_name !== 'string'
    || bank.salesforce_bank_name.trim().replace(/\s+/g, ' ').toUpperCase() !== proof.bank.trim().replace(/\s+/g, ' ').toUpperCase()) {
    throw failure('Complete, unchanged Group bank-source, document and approved bank evidence is required.');
  }
  const inventory = proof.source.buyerDocumentInventories.find(item => item.stemId === selected.STEM__c);
  const invoice = inventory?.records.filter(item => item.Proforma__c === false && item.Deprecated__c === false);
  if (document.salesforce_object !== 'Invoice__c' || document.xero_document_type !== 'ACCREC'
    || invoice?.length !== 1 || sfId(document.salesforce_id) !== invoice[0].Id
    || sfId(document.retained_differences?.accountId) !== selected.Account__c
    || sfId(document.retained_differences?.stemId) !== selected.STEM__c) {
    throw failure('The selected Group allocation must retain its own exact debtor and source invoice mapping.');
  }
  return { ...row, bankSourceEvidence: JSON.parse(canonical(proof)),
    documentMappingSnapshot: structuredClone(document), bankMappingSnapshot: structuredClone(bank) };
}

function identity(tenantId, actor) {
  if (!uuid(tenantId) || !uuid(actor?.id) || typeof actor?.email !== 'string' || !actor.email.trim()) {
    throw failure('A verified tenant and Finance actor are required.');
  }
  return { p_tenant_id: tenantId.toLowerCase(), p_actor_id: actor.id, p_actor_email: actor.email.trim().toLowerCase() };
}
async function rpc(client, name, params) {
  let result;
  try { result = await client.rpc(name, params); } catch {
    throw failure('Group payment persistence was interrupted. Refresh durable state before retrying.', 'XERO_GROUP_PAYMENT_CONFIRMATION_UNCERTAIN', 503);
  }
  if (result?.error) {
    const conflict = ['23505', '40001', 'P0001'].includes(result.error.code);
    throw failure(conflict ? 'Group payment ownership or reviewed evidence changed. Refresh before retrying.' : 'Group payment evidence could not be saved.',
      conflict ? 'XERO_GROUP_PAYMENT_CONFLICT' : 'XERO_GROUP_PAYMENT_STORAGE_FAILED', conflict ? 409 : 503);
  }
  return result?.data;
}
export async function persistReviewedGroupPaymentLinks(client, { tenantId, rows, actor } = {}) {
  const params = identity(tenantId, actor);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 25) throw failure('Review one to 25 exact Group payment links.');
  const reviewed = rows.map(row => {
    const checked = validatedGroupPaymentRow(row, { requireTarget: true });
    return Object.fromEntries(['salesforcePaymentId','salesforcePaymentName','documentMappingId','xeroPaymentId','bankAccountId',
      'amount','currency','paymentDate','sourceFingerprint','bankSourceEvidence','documentMappingSnapshot','bankMappingSnapshot'].map(key => [key, checked[key]]));
  });
  if (new Set(reviewed.map(row => sfId(row.salesforcePaymentId))).size !== rows.length
    || new Set(reviewed.map(row => row.xeroPaymentId.toLowerCase())).size !== rows.length) throw failure('Each source and target payment must appear once.');
  const data = await rpc(client, 'link_xero_group_payments_v1', { ...params, p_rows: reviewed });
  if (!Array.isArray(data?.outcomes) || data.outcomes.length !== rows.length
    || data.outcomes.some(outcome => !object(outcome))
    || new Set(data.outcomes.map(row => row.salesforcePaymentId)).size !== rows.length
    || data.outcomes.some(outcome => !reviewed.some(row => row.salesforcePaymentId === outcome.salesforcePaymentId && row.xeroPaymentId === outcome.xeroPaymentId)
      || outcome.status !== 'linked' || typeof outcome.alreadyLinked !== 'boolean' || !uuid(outcome.mappingId) || !uuid(outcome.paymentPostingClaimId))) {
    throw failure('The Group link outcome was not confirmed. Refresh durable state.', 'XERO_GROUP_PAYMENT_CONFIRMATION_UNCERTAIN', 503);
  }
  return { outcomes: data.outcomes, summary: { linked: rows.length, failed: 0, alreadyLinked: data.outcomes.filter(row => row.alreadyLinked).length } };
}
export async function claimReviewedGroupPayment(client, tenantId, row, actor) {
  const checked = validatedGroupPaymentRow(row);
  const selected = checked.bankSourceEvidence.source.allocations.find(item => item.Id === checked.bankSourceEvidence.selectedPaymentId);
  const proposed = { Invoice: { InvoiceID: checked.documentMappingSnapshot.xero_document_id },
    Account: { AccountID: checked.bankAccountId }, Amount: checked.amount, Date: checked.paymentDate,
    Reference: selected.Reference__c || selected.Name };
  if (checked.action !== 'payment_apply' || checked.status !== 'eligible' || checked.type !== 'Receivable'
    || !Array.isArray(checked.blockers) || checked.blockers.length || !fingerprint(checked.reviewFingerprint)
    || canonical(checked.proposedPayment) !== canonical(proposed)) {
    throw failure('The Group posting payload must be the exact freshly reviewed allocation.');
  }
  const data = await rpc(client, 'claim_xero_group_payment_v1', { ...identity(tenantId, actor), p_row: checked });
  if (data?.alreadyClaimed === true && data.claim === null) return null;
  const claim = data?.claim;
  const expected = `payment-post:${hash([tenantId.toLowerCase(), sfId(row.salesforcePaymentId)])}`;
  if (data?.alreadyClaimed !== false || !uuid(claim?.id) || claim.idempotency_key !== expected || claim.status !== 'processing'
    || claim.control_totals?.paymentPosting?.state !== 'intent'
    || canonical(claim.control_totals.paymentPosting.reviewed) !== canonical(checked) || !groupBankProofMatches(claim.control_totals.paymentPosting.reviewed, checked)) {
    throw failure('The Group payment intent was not confirmed.', 'XERO_GROUP_PAYMENT_CONFIRMATION_UNCERTAIN', 503);
  }
  return claim;
}
export async function finishReviewedGroupPayment(client, claim, actor, state, message, observedPaymentIds, confirmedValues = null) {
  const tenantId = claim?.control_totals?.paymentPosting?.tenantId;
  const data = await rpc(client, 'finish_xero_group_payment_v1', { ...identity(tenantId, actor), p_claim_id: claim.id,
    p_state: state, p_message: message, p_observed_ids: observedPaymentIds, p_confirmed: confirmedValues });
  if (!uuid(data?.claim?.id) || data.claim.id !== claim.id || data.claim.idempotency_key !== claim.idempotency_key
    || data.claim.source_fingerprint !== claim.source_fingerprint
    || data.claim.control_totals?.paymentPosting?.tenantId !== tenantId
    || data.claim.control_totals?.paymentPosting?.state !== state
    || canonical(data.claim.control_totals.paymentPosting.reviewed) !== canonical(claim.control_totals.paymentPosting.reviewed)
    || !groupBankProofMatches(claim.control_totals.paymentPosting.reviewed, data.claim.control_totals.paymentPosting.reviewed)) {
    throw failure('The Group payment result was not confirmed.', 'XERO_GROUP_PAYMENT_CONFIRMATION_UNCERTAIN', 503);
  }
  Object.assign(claim, data.claim);
}
