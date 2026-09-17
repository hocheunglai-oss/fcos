export function secondaryMopsFailureMessage(code) {
  if (code === 'MARKET_SECONDARY_CSV_EMPTY_SERIES') return 'The secondary CSV has a required price column with no usable values. Re-export AMFSA00, PPXDK00 (HSFO 380) and POABC00 CLOSE with historical prices, then replace the incomplete CSV in the approved Drive root. Existing verified prices remain available.';
  if (code === 'MARKET_SECONDARY_CSV_HISTORY_INSUFFICIENT') return 'The secondary CSV has fewer than 20 complete publication dates. Re-export matching historical CLOSE prices for AMFSA00, PPXDK00 and POABC00. Existing verified prices remain available.';
  if (code === 'MARKET_SECONDARY_HISTORY_VERIFICATION_FAILED') return 'The secondary CSV failed comparison with verified history. Review its dates, units and prices before replacing the source export.';
  return 'The secondary CSV could not be validated or imported. Review the source export; existing verified prices remain available.';
}

// Persisted operational status only: never call Drive or another provider when a
// trader opens Markets. A failure here must not hide the market observations.
export async function loadMarketSourceHealth(client, { now = new Date() } = {}) {
  const checkedAt = now.toISOString();
  try {
    const [runs, ...imports] = await Promise.all([
      client.from('market_report_sync_runs').select('status,error_code,started_at,completed_at').order('started_at', { ascending: false }).limit(1),
      ...['bunkerwire', 'european_marketscan'].map((type) => client.from('market_report_imports')
        .select('report_date,created_at').eq('source_document_type', type).eq('status', 'completed')
        .order('report_date', { ascending: false }).limit(1)),
      client.from('market_mops_secondary_imports').select('created_at,status').order('created_at', { ascending: false }).limit(1),
    ]);
    if (runs.error || imports.some((result) => result.error)) throw new Error('unavailable');
    const run = runs.data?.[0];
    const secondaryFailed = run?.status === 'failed' && String(run.error_code || '').startsWith('MARKET_SECONDARY_');
    const stale = !run || now.getTime() - Date.parse(run.started_at) > 2 * 60 * 60 * 1000;
    const sources = ['Bunkerwire', 'European Marketscan', 'Secondary MOPS CSV'].map((label, index) => {
      const row = imports[index].data?.[0];
      const failed = secondaryFailed && index === 2;
      return {
        key: ['bunkerwire', 'european_marketscan', 'secondary_mops_csv'][index], label,
        status: failed ? 'warning' : row ? 'available' : 'unavailable',
        lastSuccessAt: row?.created_at || null,
        lastPublicationDate: row?.report_date || null,
        message: failed ? secondaryMopsFailureMessage(run.error_code) : row ? 'Last verified import shown.' : 'No verified import is available.',
      };
    });
    return {
      checkedAt, lastRunAt: run?.started_at || null,
      status: stale || run?.status === 'failed' || sources.some((row) => row.status === 'unavailable') ? 'warning' : run?.status === 'running' ? 'running' : 'available',
      message: stale ? 'The last recorded sync check is overdue.' : secondaryFailed ? 'Secondary CSV needs attention; verified PDF imports are listed separately.' : run?.status === 'failed' ? 'The latest source sync failed. Existing verified imports are shown below.' : 'Current source import status.',
      sources,
    };
  } catch {
    return { checkedAt, status: 'unavailable', message: 'Source status is temporarily unavailable. Market prices retain their own publication dates.', sources: [] };
  }
}
