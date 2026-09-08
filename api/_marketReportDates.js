// Read-only display context; never changes publication or settlement eligibility.
export function validMarketDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isCompletedReportPair(brief) {
  const required = Number(brief?.completeness?.requiredReports || 2);
  return required >= 2 && Number(brief?.completeness?.completeReports || 0) >= required;
}

export async function readCompletedMarketBrief(client, date, { direction = 'before', upperBound = date, columns = '*' } = {}) {
  const seen = new Set();
  for (let offset = 0; ; offset += 100) {
    let query = client.from('market_intelligence_briefs').select(columns);
    if (direction === 'next') query = query.gt('report_date', date).lte('report_date', upperBound);
    else if (direction === 'previous') query = query.lt('report_date', date);
    else query = query.lte('report_date', date);
    const result = await query.order('report_date', { ascending: direction === 'next' })
      .order('revision', { ascending: false }).range(offset, offset + 99);
    if (result.error) throw Object.assign(new Error(`Market report dates could not be loaded: ${result.error.message}`), { statusCode: 502, code: 'MARKET_BRIEF_LOAD_FAILED' });
    for (const row of result.data || []) {
      if (seen.has(row.report_date)) continue;
      seen.add(row.report_date);
      if (isCompletedReportPair(row)) return row;
    }
    if ((result.data || []).length < 100) return null;
  }
}
