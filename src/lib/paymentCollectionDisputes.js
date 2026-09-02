const NO_DISPUTE_STATUSES = new Set(['no dispute', 'no disputes']);

const KNOWN_ACTIVE_DISPUTE_STATUSES = new Set([
  'opened',
  'open - trader review',
  'pending approval',
  'revision requested',
  'rejected',
  'approved - pending accounting',
  'accounting in progress',
  'settled - ready to close',
]);

export function normalizePaymentCollectionDisputeStatus(value) {
  return String(value || '').trim();
}

export function paymentCollectionDisputeState(value) {
  const normalized = normalizePaymentCollectionDisputeStatus(value).toLowerCase();
  if (!normalized || NO_DISPUTE_STATUSES.has(normalized)) return 'none';
  if (normalized.startsWith('closed')) return 'closed';
  if (KNOWN_ACTIVE_DISPUTE_STATUSES.has(normalized)) return 'active';
  return 'issue';
}

export function hasPaymentCollectionDispute(value) {
  return paymentCollectionDisputeState(value) !== 'none';
}

export function matchesPaymentCollectionDisputeFilter(value, filter) {
  if (filter === 'with-dispute') return hasPaymentCollectionDispute(value);
  if (filter === 'no-dispute') return !hasPaymentCollectionDispute(value);
  return true;
}
