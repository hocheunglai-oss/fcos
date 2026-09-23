import { createHash, randomUUID } from 'node:crypto';
import { confirmedPaymentValues, matchPaymentResponses, paymentConfirmationErrors } from './_xeroPaymentIdentity.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const failure = (message, code = 'XERO_PAYMENT_CONFIRMATION_UNCERTAIN', status = 409) => Object.assign(new Error(message), { code, status });
const storageFailure = () => failure('The durable payment posting record could not be saved or verified.', 'XERO_PAYMENT_POSTING_STORAGE_FAILED', 503);
function canonicalPaymentId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value)) throw failure('The exact Salesforce payment identity is invalid.', 'XERO_PAYMENT_SOURCE_ID_INVALID');
  // Server-fetched Salesforce Ids are authoritative; 15 and 18 character encodings identify the same case-sensitive record.
  return value.slice(0, 15);
}
export const paymentPostingKey = (tenantId, paymentId) => `payment-post:${hash([String(tenantId).toLowerCase(), canonicalPaymentId(paymentId)])}`;
const journal = (claim) => claim?.control_totals?.paymentPosting;

export async function loadPaymentPostingClaims(client, tenantId, paymentIds) {
  if (!uuid(tenantId)) throw failure('A verified Xero tenant is required.', 'XERO_PAYMENT_TENANT_INVALID');
  const ids = [...new Set(paymentIds)]; const canonicalIds = new Set(ids.map(canonicalPaymentId)); const seen = new Set(); const claims = new Map();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const keys = ids.slice(offset, offset + 200).map((id) => paymentPostingKey(tenantId, id));
    const result = await client.from('xero_financial_sync_runs').select('*').eq('mode', 'payment_apply').in('idempotency_key', keys);
    if (result.error || !Array.isArray(result.data)) throw storageFailure();
    for (const claim of result.data) {
      const saved = journal(claim);
      if (!saved || String(saved.tenantId).toLowerCase() !== tenantId.toLowerCase() || !canonicalIds.has(saved.paymentId)
        || claim.idempotency_key !== paymentPostingKey(tenantId, saved.paymentId) || seen.has(saved.paymentId)) throw storageFailure();
      seen.add(saved.paymentId);
      for (const id of ids.filter((id) => canonicalPaymentId(id) === saved.paymentId)) claims.set(id, claim);
    }
  }
  return claims;
}

export function paymentClaimEvidenceIds(claims) {
  return [...new Set([...claims.values()].flatMap((claim) => journal(claim)?.observedPaymentIds || []).filter(uuid))];
}

export function reviewPaymentPostingClaim(row, claim, payment) {
  if (!claim) {
    if (row.acceptedReference === true) return { ...row, action: 'blocked', status: 'blocked', proposedPayment: null,
      acceptedReference: false, reviewRequired: false,
      blockers: [...row.blockers, 'The saved reference-only payment link is missing its durable posting barrier. Finance must resolve the original link before further action.'],
      blockerCodes: [...row.blockerCodes, 'finance_exception'] };
    return row;
  }
  const saved = journal(claim);
  if (saved?.state === 'reference_linked') {
    const retained = saved.reviewed;
    if (claim.status === 'completed' && row.action === 'payment_link' && row.status === 'protected'
      && row.acceptedReference === true && !row.blockers.length && row.proposedPayment === null
      && retained?.sourceFingerprint === row.sourceFingerprint
      && retained.referenceReviewFingerprint === row.referenceReviewFingerprint
      && retained.xeroPaymentId === row.xeroPaymentId && saved.confirmedPaymentId === payment?.PaymentID
      && retained.documentMappingId === row.documentMappingId && retained.bankAccountId === payment?.Account?.AccountID) {
      return { ...row, paymentPostingClaimId: claim.id };
    }
    return { ...row, action: 'blocked', status: 'blocked', proposedPayment: null, acceptedReference: false,
      reviewRequired: false, blockers: [...row.blockers, 'The saved reference-only payment link changed. Review its original identity and evidence; no replacement payment will be posted.'],
      blockerCodes: [...row.blockerCodes, 'finance_exception'], paymentPostingClaimId: claim.id };
  }
  const errors = row.action === 'payment_link' && ['eligible', 'protected'].includes(row.status) && saved?.reviewed
    && saved.reviewed.sourceFingerprint === row.sourceFingerprint
    ? paymentConfirmationErrors(saved.reviewed, payment || {}, saved.confirmedPaymentId) : ['A previous posting attempt has no exact, current, confirmed Xero payment.'];
  if (!errors.length) return { ...row, paymentPostingClaimId: claim.id, confirmedPayment: confirmedPaymentValues(payment) };
  const message = `${claim.error_message || 'A previous payment posting result is unresolved.'} Refresh the payment check and resolve its exact Xero outcome before another posting.`;
  return { ...row, action: 'blocked', status: 'blocked', proposedPayment: null,
    blockers: [...row.blockers, ...errors, message], blockerCodes: [...row.blockerCodes, ...errors.map(() => 'finance_exception'), 'finance_exception'],
    reviewFingerprint: hash([row.reviewFingerprint, claim.id, claim.status, errors]), paymentPostingClaimId: claim.id };
}

async function audit(client, claim, actor, outcome, code = null) {
  const saved = journal(claim);
  const result = await client.from('xero_financial_audit_events').insert({ run_id: claim.id, event_type: 'payment_posting', outcome,
    actor_id: actor.id, actor_email: actor.email, record_counts: { payments: 1 }, error_code: code,
    fingerprints: { tenantId: saved.tenantId, paymentId: saved.paymentId, source: saved.reviewed.sourceFingerprint,
      review: saved.reviewed.reviewFingerprint, idempotencyKey: claim.idempotency_key, paymentPosting: saved } });
  if (result.error) throw storageFailure();
}

async function claimPayment(client, tenantId, row, actor) {
  const now = new Date().toISOString();
  const claim = { id: randomUUID(), mode: 'payment_apply', status: 'processing', idempotency_key: paymentPostingKey(tenantId, row.salesforcePaymentId),
    source_fingerprint: row.sourceFingerprint, control_totals: { paymentPosting: { tenantId, paymentId: canonicalPaymentId(row.salesforcePaymentId), reviewed: row, state: 'intent' } },
    created_by: actor.id, created_by_email: actor.email, reviewed_by: actor.id, reviewed_by_email: actor.email,
    reviewed_at: now, created_at: now, updated_at: now };
  // INSERT, never upsert: the database's unique key is the cross-request posting barrier.
  const result = await client.from('xero_financial_sync_runs').insert(claim);
  if (result.error?.code === '23505') return null;
  if (result.error) throw storageFailure();
  await audit(client, claim, actor, 'intent');
  return claim;
}

async function finishClaim(client, claim, actor, state, message, observedPaymentIds, confirmedPaymentId = null) {
  const saved = { ...journal(claim), state, observedPaymentIds, ...(confirmedPaymentId ? { confirmedPaymentId } : {}) };
  const values = { status: state === 'confirmed' ? 'completed' : 'failed', control_totals: { paymentPosting: saved },
    error_code: state === 'confirmed' ? null : 'XERO_PAYMENT_CONFIRMATION_UNCERTAIN', error_message: message,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const result = await client.from('xero_financial_sync_runs').update(values).eq('id', claim.id).eq('idempotency_key', claim.idempotency_key).select('id').maybeSingle();
  if (result.error || result.data?.id !== claim.id) throw storageFailure();
  Object.assign(claim, values);
  await audit(client, claim, actor, state, values.error_code);
}

export async function resolvePaymentPostingClaim(client, claim, payment, actor) {
  const saved = journal(claim);
  if (['confirmed', 'reference_linked'].includes(saved?.state)) return;
  if (!saved?.reviewed || paymentConfirmationErrors(saved.reviewed, payment || {}, saved.confirmedPaymentId).length) throw failure('The reread payment does not confirm the original posting.');
  await finishClaim(client, claim, actor, 'confirmed', null, [payment.PaymentID], payment.PaymentID);
}

export async function postReviewedPaymentBatch(rows, { client, connection, actor, accountingFetch, options = {} }) {
  if (!uuid(connection.tenantId)) throw failure('A verified Xero tenant is required.', 'XERO_PAYMENT_TENANT_INVALID');
  const claims = []; const outcomes = [];
  // Complete every intent and audit before the provider write; any storage error prevents this whole batch.
  for (const row of rows) {
    const claim = await claimPayment(client, connection.tenantId, row, actor);
    if (claim) claims.push({ row, claim });
    else outcomes.push({ salesforcePaymentId: row.salesforcePaymentId, status: 'failed', reviewRequired: true,
      errors: ['This Salesforce payment has already been attempted. Refresh the payment check and verify its current Xero outcome; it will not be posted again.'] });
  }
  if (!claims.length) return outcomes;
  let response; let transportUnknown = false;
  try {
    response = await accountingFetch(connection, '/Payments?summarizeErrors=false', { ...options, method: 'POST',
      body: { Payments: claims.map(({ row }) => row.proposedPayment) },
      idempotencyKey: `fcos-payment-${hash(claims.map(({ claim }) => claim.idempotency_key).sort()).slice(0, 40)}`, retryOnRateLimit: false });
  } catch { transportUnknown = true; }
  const observedIds = [...new Set((Array.isArray(response?.Payments) ? response.Payments : []).map((item) => item?.PaymentID).filter(uuid))];
  const confirmations = matchPaymentResponses(claims.map(({ row }) => row), response?.Payments);
  for (const [index, { row, claim }] of claims.entries()) {
    const { response: actual, errors: matchErrors } = confirmations[index];
    const errors = transportUnknown ? ['The Xero request ended without a confirmed response. Its write outcome is unknown; verify it in a fresh payment check.']
      : [...matchErrors, ...paymentConfirmationErrors(row, actual)];
    if (errors.length) {
      await finishClaim(client, claim, actor, 'uncertain', errors.join(' '), observedIds);
      outcomes.push({ salesforcePaymentId: row.salesforcePaymentId, status: 'failed', reviewRequired: true, errors });
      continue;
    }
    const result = await client.from('xero_financial_payment_mappings').upsert({
      salesforce_payment_id: row.salesforcePaymentId, salesforce_payment_name: row.salesforcePaymentName,
      document_mapping_id: row.documentMappingId, source_fingerprint: row.sourceFingerprint, ...confirmedPaymentValues(actual),
      status: 'applied', exception_reason: null, last_reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'salesforce_payment_id' });
    if (result.error) throw storageFailure();
    await finishClaim(client, claim, actor, 'confirmed', null, [actual.PaymentID], actual.PaymentID);
    outcomes.push({ salesforcePaymentId: row.salesforcePaymentId, xeroPaymentId: actual.PaymentID, status: 'applied' });
  }
  return outcomes;
}
