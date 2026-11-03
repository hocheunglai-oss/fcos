// Positive action allowlist. Snapshot reads are safe only because the service
// skips expiry reconciliation using trusted server deployment configuration.
const READ_ACTIONS = new Set(['list', 'filter', 'get', 'snapshot']);

export function isReadOnlyHedgeDeskAction(body = {}) {
  return READ_ACTIONS.has(String(body?.action || 'list'));
}
