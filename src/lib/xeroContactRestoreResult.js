const STATUSES = new Set(['restored', 'already_active', 'blocked', 'uncertain']);

export function canRestoreContactRow(row) {
  return Boolean(typeof row?.id === 'string' && row.id.length > 0
    && typeof row.salesforceAccountId === 'string' && row.salesforceAccountId.length > 0 && row.action === 'exception'
    && row.status === 'blocked' && row.reason === 'archived-only-match'
    && row.restoration?.eligible === true && typeof row.restoration.targetContactId === 'string'
    && row.restoration.targetContactId.length > 0);
}

export function confirmedContactRestore(data, runId, rows) {
  if (!runId || !Array.isArray(rows) || !rows.length || rows.length > 25
    || !rows.every(canRestoreContactRow) || data?.error || data?.runId !== runId || data.refreshPreview !== true
    || !Array.isArray(data.outcomes) || data.outcomes.length !== rows.length || !data.summary) return false;
  const expected = new Map(rows.map((row) => [row.id, row]));
  if (expected.size !== rows.length) return false;
  const tally = { total: rows.length, restored: 0, alreadyActive: 0, blocked: 0, uncertain: 0 };
  for (const outcome of data.outcomes) {
    const row = expected.get(outcome?.rowId);
    if (!row || !STATUSES.has(outcome.status) || outcome.salesforceAccountId !== row.salesforceAccountId
      || outcome.xeroContactId !== row.restoration.targetContactId) return false;
    expected.delete(outcome.rowId);
    tally[outcome.status === 'already_active' ? 'alreadyActive' : outcome.status] += 1;
  }
  return expected.size === 0 && Object.entries(tally).every(([key, value]) => data.summary[key] === value);
}
