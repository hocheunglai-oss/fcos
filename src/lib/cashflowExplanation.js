export function cashflowExplanation(row = {}) {
  if (row.modelLevel === 'Contractual due date') return {
    confidence: 'Scheduled',
    reason: 'Uses the contractual supplier due date. This is a planned payment date, not proof that cash will leave the bank on that day.',
  };
  const count = Number(row.sampleCount || 0);
  return { confidence: row.confidence || 'Unavailable', reason: count > 0
    ? `Uses ${row.modelLevel || 'payment history'} with ${count} paid invoice samples and a predicted delay of ${Number(row.predictedDelayDays || 0)} days after the due date. The result is an estimate.`
    : 'No eligible payment-history samples were available for this model. The forecast uses the configured fallback; receipt timing is uncertain.' };
}

export function changedCashflowRows(before = [], after = []) {
  const previous = new Map(before.map((row) => [row.id, row]));
  return after.flatMap((row) => {
    const old = previous.get(row.id);
    if (!old) return [];
    const changes = ['forecastDate', 'amount', 'currency', 'predictedDelayDays', 'modelLevel', 'sampleCount', 'holidayAdjustment']
      .filter((field) => String(old[field] ?? '') !== String(row[field] ?? ''));
    return changes.length ? [{ id: row.id, name: row.stemName || row.counterparty, changes, beforeDate: old.forecastDate, afterDate: row.forecastDate }] : [];
  });
}
