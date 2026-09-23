const DECISIONS = new Set(['verified_xero_only', 'revoked']);
const REPAIR_STATUSES = new Set(['created', 'already_exists', 'blocked', 'uncertain']);

export function confirmedContactIdentitySave(data, request) {
  const decision = data?.decision;
  return Boolean(data?.refreshPreview === true && decision && DECISIONS.has(decision.decision)
    && decision.tenant_id === request.tenantId && decision.contact_id === request.contactId
    && decision.decision === request.decision && decision.fingerprint === request.expectedFingerprint
    && Number.isInteger(decision.revision) && decision.revision === request.expectedRevision + 1
    && typeof decision.actor_id === 'string' && decision.actor_id.length > 0
    && typeof decision.actor_email === 'string' && decision.actor_email.length > 0);
}

export function confirmedContactRepair(data, runId, rowIds) {
  if (data?.runId !== runId || data.refreshPreview !== true || !Array.isArray(data.outcomes)
    || data.outcomes.length !== rowIds.length || !data.summary) return false;
  const expected = new Set(rowIds);
  const tally = { total: rowIds.length, created: 0, existing: 0, blocked: 0, uncertain: 0 };
  for (const outcome of data.outcomes) {
    if (!expected.delete(outcome?.rowId) || !REPAIR_STATUSES.has(outcome.status)) return false;
    tally[outcome.status === 'already_exists' ? 'existing' : outcome.status] += 1;
  }
  return expected.size === 0 && Object.entries(tally).every(([key, value]) => data.summary[key] === value);
}
