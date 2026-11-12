import { xeroPrepaymentEvidenceFingerprint as hash } from './_xeroPrepaymentCurrency.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SOURCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const ACTION_IDENTITIES = {
  create: ['xeroBankTransactionId', 'xeroPrepaymentId'],
  allocate: ['xeroPrepaymentId', 'xeroAllocationId'],
  reverse: ['xeroPrepaymentId', 'xeroAllocationId'],
  refund: ['xeroPrepaymentId', 'xeroPaymentId'],
};

function fail(message, code = 'XERO_PREPAYMENT_INVALID') {
  throw Object.assign(new Error(message), { code, status: 409 });
}

function matchesOperation(operation, body, tenantId, actorId) {
  const request = operation?.request_evidence;
  return Boolean(request && operation.operation_id === body.operationId && operation.tenant_id === tenantId
    && operation.actor_id === actorId && operation.source_id === body.sourceId && operation.action === body.action
    && operation.review_hash === body.reviewFingerprint && request.reviewFingerprint === operation.review_hash
    && request.sourceId === operation.source_id && request.action === operation.action
    && request.sourceFingerprint === operation.source_hash && request.cashEventId === operation.cash_event_id
    && operation.request_hash === hash(request));
}

function eligible(review, body) {
  return review?.status === 'eligible' && review.sourceId === body.sourceId && review.action === body.action
    && review.reviewFingerprint === body.reviewFingerprint && SOURCE_ID.test(review.cashEventId || '')
    && SHA256.test(review.sourceFingerprint || '') && review.proposal && typeof review.proposal === 'object';
}

async function appliedResult(operation, settle, kind, fail) {
  if (!operation.send_started_at || !operation.response_evidence) {
    fail(`The stored ${kind} receipt is incomplete.`, 'UNKNOWN');
  }
  await settle(operation);
  return { operationId: operation.operation_id, status: 'applied', result: operation.response_evidence };
}

const prepaymentExecution = {
  kind: 'prepayment', prefix: 'XERO_PREPAYMENT', matchesOperation, eligible, identities: ACTION_IDENTITIES,
  claimFields: (body, review) => ({
    cashEventId: review.cashEventId, sourceKind: ['create', 'refund'].includes(body.action) ? 'cash_event' : 'cash_allocation',
    sourceId: body.sourceId, action: body.action, sourceHash: review.sourceFingerprint, reviewHash: review.reviewFingerprint,
    nativeAmount: review.nativeAmount,
  }),
  unknownFields: (row) => ({
    xeroBankTransactionId: row.xero_bank_transaction_id, xeroPrepaymentId: row.xero_prepayment_id,
    xeroAllocationId: row.xero_allocation_id, xeroPaymentId: row.xero_payment_id,
  }),
};

const creditExecution = {
  kind: 'credit allocation', prefix: 'XERO_CREDIT_ALLOCATION', identities: { credit_allocate: ['xeroAllocationId'] },
  matchesOperation(operation, body, tenantId, actorId) {
    const request = operation?.request_evidence;
    return Boolean(request && operation.operation_id === body.operationId && operation.tenant_id === tenantId
      && operation.reviewed_by === actorId && request.creditId === body.sourceId && request.action === body.action
      && request.reviewFingerprint === body.reviewFingerprint && operation.credit_mapping_id === request.creditMappingId
      && operation.invoice_mapping_id === request.invoiceMappingId && operation.request_hash === hash(request));
  },
  eligible: (review, body) => review?.status === 'eligible' && review.creditId === body.sourceId
    && review.action === body.action && review.reviewFingerprint === body.reviewFingerprint
    && UUID.test(review.creditMappingId || '') && UUID.test(review.invoiceMappingId || '') && review.proposal,
  claimFields: (_body, review) => ({ creditMappingId: review.creditMappingId, nativeAmount: review.amount }),
  unknownFields: () => ({}),
};

export function executeXeroPrepayment(body, options) {
  return executeJournaledAllocation(body, options, prepaymentExecution);
}

export function executeXeroCreditAllocation(body, options) {
  return executeJournaledAllocation({ ...body, sourceId: body?.creditId, action: 'credit_allocate' }, options, creditExecution);
}

/** Cross the durable send boundary once. All continuations use the original operation. */
async function executeJournaledAllocation(body, {
  tenantId, actorId, ledger, loadReview, readOutcome, send, audit = async () => {}, recoveryOnly = false,
  prepareSend = async () => {}, settle = async () => {},
}, contract) {
  const { kind, prefix } = contract;
  const reject = (message, code = 'INVALID') => fail(message, `${prefix}_${code}`);
  if (body?.reviewed !== true || !UUID.test(body.operationId || '') || !SOURCE_ID.test(body.sourceId || '')
    || !Object.hasOwn(contract.identities, body.action) || !SHA256.test(body.reviewFingerprint || '')
    || !UUID.test(tenantId || '') || !UUID.test(actorId || '')) {
    reject(`Explicitly review one ${kind} operation.`);
  }
  const key = { tenantId, operationId: body.operationId };
  const matches = (row) => contract.matchesOperation(row, body, tenantId, actorId);
  let operation = await ledger.get(key);
  let claimed = false;
  if (!operation) {
    if (recoveryOnly) reject(`The original ${kind} operation was not found.`, 'OPERATION_MISMATCH');
    const review = await loadReview(body);
    if (!contract.eligible(review, body)) reject(`The ${kind} changed after review. Refresh and review again.`, 'STALE');
    const claim = await ledger.claim({
      ...key, ...contract.claimFields(body, review), requestHash: hash(review), requestEvidence: review,
      currency: review.currency, accountingUsd: review.accountingUsd,
      invoiceMappingId: review.invoiceMappingId || null, actorId,
    });
    operation = claim?.operation;
    claimed = claim?.claimed === true;
  }
  if (!matches(operation)) reject('This operation belongs to different reviewed evidence.', 'OPERATION_MISMATCH');
  const confirmed = (row) => appliedResult(row, settle, kind, reject);
  if (operation.status === 'applied') return confirmed(operation);
  if (operation.status === 'cancelled_before_send') {
    reject('This operation was cancelled before sending. Review a new operation.', 'CANCELLED');
  }
  const request = operation.request_evidence;
  const operationKey = { ...key, requestHash: operation.request_hash };
  const auditEvent = (phase, code = null) => audit({ event: `${kind.replace(' ', '_')}_${phase}`, operationId: key.operationId, requestHash: operationKey.requestHash, code });
  const readOriginal = async () => {
    const current = await ledger.get(key);
    if (!matches(current) || current.request_hash !== operationKey.requestHash) {
      reject(`The original ${kind} operation could not be verified.`, 'UNKNOWN');
    }
    return current;
  };

  if (claimed && operation.status === 'processing' && !operation.send_started_at) {
    try {
      const fresh = await loadReview(body, { ignoreOperationId: key.operationId });
      if (!contract.eligible(fresh, body) || hash(fresh) !== operationKey.requestHash) {
        reject('Financial evidence changed before sending.', 'STALE');
      }
      await auditEvent('reviewed');
      await prepareSend(operation);
    } catch (error) {
      let cancelled;
      try {
        const acknowledgement = await ledger.cancel({ ...operationKey, responseEvidence: { code: error.code || `${prefix}_PRE_SEND_FAILED` } });
        cancelled = acknowledgement?.operation;
      } catch { /* Check the original operation below. */ }
      if (!matches(cancelled) || cancelled.status !== 'cancelled_before_send'
        || cancelled.request_hash !== operationKey.requestHash) cancelled = await readOriginal();
      if (cancelled.status !== 'cancelled_before_send') reject(`The original ${kind} cancellation could not be verified.`, 'UNKNOWN');
      reject('No request was sent. Refresh and review a new operation.', 'CANCELLED');
    }

    let marker;
    try { marker = await ledger.markSent(operationKey); } catch { /* Only an exact acknowledgement grants send authority. */ }
    if (marker?.marked === true && matches(marker.operation) && marker.operation.status === 'processing'
      && marker.operation.send_started_at && marker.operation.request_hash === operationKey.requestHash) {
      operation = marker.operation;
      try { await send(request.proposal, key.operationId, operation); } catch { /* Resolve through original-operation readback. */ }
    } else {
      operation = await readOriginal();
    }
  }

  if (operation.status === 'applied') return confirmed(operation);
  if (!operation.send_started_at) reject(`The original ${kind} has no confirmed send marker.`, 'UNSENT');

  try {
    const outcome = await readOutcome(request, operation);
    const identities = outcome?.identities;
    const identityFields = contract.identities[body.action];
    if (!identities || Object.keys(identities).length !== identityFields.length
      || !identityFields.every((field) => typeof identities[field] === 'string' && UUID.test(identities[field]))) {
      reject(`The ${kind} readback did not identify an exact provider operation.`, 'UNKNOWN');
    }
    const saved = await ledger.finish({ ...operationKey, ...identities, status: 'applied', responseEvidence: outcome });
    if (!matches(saved?.operation) || saved.operation.status !== 'applied'
      || saved.operation.request_hash !== operationKey.requestHash || hash(saved.operation.response_evidence) !== hash(outcome)) {
      reject(`The ${kind} finish acknowledgement could not be verified.`, 'UNKNOWN');
    }
    await auditEvent('reconciled').catch(() => {});
    return confirmed(saved.operation);
  } catch (error) {
    let persisted;
    try { persisted = await readOriginal(); } catch { /* Preserve the original journal for recovery. */ }
    if (persisted?.status === 'applied') return confirmed(persisted);
    const code = error.code || `${prefix}_UNKNOWN`;
    if (persisted?.send_started_at && (claimed || persisted.status !== 'processing')) {
      await ledger.finish({ ...operationKey, ...contract.unknownFields(persisted), status: 'unknown', responseEvidence: { code } }).catch(() => {});
    }
    await auditEvent('uncertain', code).catch(() => {});
    reject('The outcome needs reconciliation. Recovery reads the original Xero operation.', 'UNKNOWN');
  }
}
