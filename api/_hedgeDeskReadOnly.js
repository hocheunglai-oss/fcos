// Snapshot reads skip expiry using trusted server deployment configuration.
const READ_ACTIONS = new Set(['list', 'filter', 'get', 'snapshot']);

export function isReadOnlyHedgeDeskAction(body = {}) {
  return READ_ACTIONS.has(String(body?.action || 'list'));
}
