import { paymentPostingKey } from './_xeroPaymentPosting.js';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  && value !== '00000000-0000-0000-0000-000000000000';
const fingerprint = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (message, code = 'XERO_PAYMENT_REFERENCE_LINK_INVALID', status = 400) => Object.assign(new Error(message), { code, status });

function reviewedRow(row) {
  if (!object(row) || !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(row.salesforcePaymentId || '')
    || typeof row.salesforcePaymentName !== 'string' || !row.salesforcePaymentName.trim()
    || ![row.documentMappingId, row.xeroPaymentId, row.bankAccountId].every(uuid)
    || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0 || row.amount >= 1e14
    || !/^[A-Z]{3}$/.test(row.currency || '') || !/^\d{4}-\d{2}-\d{2}$/.test(row.paymentDate || '')
    || !Number.isFinite(Date.parse(`${row.paymentDate}T00:00:00Z`))
    || new Date(`${row.paymentDate}T00:00:00Z`).toISOString().slice(0, 10) !== row.paymentDate
    || !fingerprint(row.sourceFingerprint) || !fingerprint(row.referenceReviewFingerprint)
    || !object(row.retainedReferenceEvidence) || !Object.keys(row.retainedReferenceEvidence).length) {
    throw failure('Complete, freshly reviewed payment-reference evidence is required.');
  }
  const evidence = JSON.stringify(row.retainedReferenceEvidence);
  if (Buffer.byteLength(evidence, 'utf8') > 65536) throw failure('Payment-reference evidence exceeds its bounded review size.');
  // Only immutable persistence inputs cross the RPC boundary. No provider payload can be posted here.
  return {
    salesforcePaymentId: row.salesforcePaymentId, salesforcePaymentName: row.salesforcePaymentName,
    documentMappingId: row.documentMappingId.toLowerCase(), xeroPaymentId: row.xeroPaymentId.toLowerCase(),
    bankAccountId: row.bankAccountId.toLowerCase(), amount: row.amount, currency: row.currency, paymentDate: row.paymentDate,
    sourceFingerprint: row.sourceFingerprint, referenceReviewFingerprint: row.referenceReviewFingerprint,
    retainedReferenceEvidence: JSON.parse(evidence),
  };
}

// Matching, permission/gate checks and fresh provider reads belong to the caller.
// This function is solely an all-or-none local identity/evidence persistence boundary.
export async function persistReviewedPaymentReferenceLinks(client, { tenantId, rows, actor } = {}) {
  if (!uuid(tenantId) || !Array.isArray(rows) || rows.length < 1 || rows.length > 25
    || !uuid(actor?.id) || typeof actor?.email !== 'string' || !actor.email.trim()) {
    throw failure('A verified tenant, Finance actor and one to 25 reviewed links are required.');
  }
  const reviewed = rows.map(reviewedRow);
  if (new Set(reviewed.map((row) => row.salesforcePaymentId.slice(0, 15))).size !== reviewed.length
    || new Set(reviewed.map((row) => row.xeroPaymentId)).size !== reviewed.length) {
    throw failure('Each Salesforce and Xero payment must appear exactly once in the reviewed batch.');
  }
  let response;
  try {
    response = await client.rpc('link_xero_payment_references_v1', {
      p_tenant_id: tenantId.toLowerCase(),
      p_rows: reviewed.map((row) => ({ ...row, idempotencyKey: paymentPostingKey(tenantId, row.salesforcePaymentId) })),
      p_actor_id: actor.id, p_actor_email: actor.email.trim().toLowerCase(),
    });
  } catch {
    throw failure('The payment-reference persistence response was interrupted. Refresh its durable state before retrying.',
      'XERO_PAYMENT_REFERENCE_LINK_CONFIRMATION_UNCERTAIN', 503);
  }
  const { data, error } = response || {};
  if (error) {
    const conflict = ['23505', '40001', 'P0001'].includes(error.code);
    throw failure(conflict ? 'Payment ownership or reviewed evidence changed. Refresh before linking; no batch links were saved.'
      : 'The reviewed payment-reference batch could not be saved. Refresh its durable state before retrying.',
    conflict ? 'XERO_PAYMENT_REFERENCE_LINK_CONFLICT' : 'XERO_PAYMENT_REFERENCE_LINK_STORAGE_FAILED', conflict ? 409 : 503);
  }
  const outcomes = data?.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length !== reviewed.length
    || outcomes.some((row) => !object(row))
    || new Set(outcomes.map((row) => row.salesforcePaymentId)).size !== reviewed.length
    || outcomes.some((outcome) => !reviewed.some((row) => row.salesforcePaymentId === outcome.salesforcePaymentId
      && row.xeroPaymentId === outcome.xeroPaymentId) || outcome.status !== 'linked'
      || typeof outcome.alreadyLinked !== 'boolean' || !uuid(outcome.mappingId) || !uuid(outcome.paymentPostingClaimId))) {
    throw failure('The payment-reference persistence result was not confirmed. Refresh its durable state before retrying.',
      'XERO_PAYMENT_REFERENCE_LINK_CONFIRMATION_UNCERTAIN', 503);
  }
  return { outcomes, summary: { linked: outcomes.length, failed: 0, alreadyLinked: outcomes.filter((row) => row.alreadyLinked).length } };
}
