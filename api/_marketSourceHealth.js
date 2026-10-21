const SECONDARY_MOPS_SYMBOLS = Object.freeze(['AMFSA00', 'PPXDK00', 'POABC00']);

function affectedSecondarySeries(code) {
  const normalized = String(code || '').toUpperCase();
  return SECONDARY_MOPS_SYMBOLS.filter((symbol) => normalized.includes(symbol));
}

export function secondaryMopsFailureMessage(code) {
  const affected = affectedSecondarySeries(code);
  const series = affected.length ? affected.join(', ') : 'one or more required series (AMFSA00, PPXDK00 (HSFO 380), POABC00)';
  if (String(code || '').startsWith('MARKET_SECONDARY_CSV_EMPTY_SERIES')) return `The secondary CSV has no usable values for ${series}. Re-export the affected CLOSE series with historical prices, then replace the incomplete CSV in the approved Drive root. Existing verified prices remain available.`;
  if (String(code || '').startsWith('MARKET_SECONDARY_CSV_INCOMPLETE_ROWS')) return `The secondary CSV has incomplete required price triples affecting ${series}. Re-export complete AMFSA00, PPXDK00 and POABC00 CLOSE rows, then replace the incomplete CSV. Existing verified prices remain available.`;
  if (String(code || '').startsWith('MARKET_SECONDARY_CSV_VALUE_INVALID')) return `The secondary CSV has invalid positive numeric CLOSE values affecting ${series}. Correct the affected rows and replace the invalid CSV. Existing verified prices remain available.`;
  if (code === 'MARKET_SECONDARY_CSV_DATE_INVALID') return 'The secondary CSV has missing or invalid publication dates. Correct the DATE or TIMESTAMP rows before replacing the CSV. Existing verified prices remain available.';
  if (code === 'MARKET_SECONDARY_CSV_HISTORY_INSUFFICIENT') return 'The secondary CSV has fewer than 20 complete publication dates. Re-export matching historical CLOSE prices for AMFSA00, PPXDK00 and POABC00. Existing verified prices remain available.';
  if (code === 'MARKET_SECONDARY_HISTORY_VERIFICATION_FAILED') return 'The secondary CSV failed comparison with verified history. Review its dates, units and prices before replacing the source export. Existing verified prices remain available.';
  return 'The secondary CSV could not be validated or imported. Review the source export; existing verified prices remain available.';
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function secondaryCoverage(row) {
  if (!row) return null;
  return {
    sourceRowCount: finiteCount(row.source_row_count),
    comparisonDateCount: finiteCount(row.comparison_date_count),
    publishedDateCount: finiteCount(row.published_date_count),
    matchedDateCount: finiteCount(row.matched_date_count),
    conflictDateCount: finiteCount(row.conflict_date_count),
  };
}

function secondaryCoverageMessage(coverage) {
  if (!coverage) return 'No verified import is available.';
  const parts = [
    coverage.sourceRowCount == null ? null : `${coverage.sourceRowCount} complete source dates`,
    coverage.comparisonDateCount == null ? null : `${coverage.comparisonDateCount} compared with verified history`,
    coverage.publishedDateCount == null ? null : `${coverage.publishedDateCount} published`,
    coverage.matchedDateCount == null ? null : `${coverage.matchedDateCount} already matched`,
    coverage.conflictDateCount == null ? null : `${coverage.conflictDateCount} retained as conflicts`,
  ].filter(Boolean);
  return parts.length ? `Last successful import coverage: ${parts.join(', ')}.` : 'Last verified import shown.';
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
      client.from('market_mops_secondary_imports')
        .select('id,created_at,status,source_row_count,comparison_date_count,published_date_count,matched_date_count,conflict_date_count')
        .in('status', ['completed', 'completed_with_conflicts'])
        .order('created_at', { ascending: false }).limit(1),
    ]);
    if (runs.error || imports.some((result) => result.error)) throw new Error('unavailable');
    const run = runs.data?.[0];
    const secondary = imports[2].data?.[0];
    let secondaryPublicationDate = null;
    if (secondary?.id) {
      const evidence = await client.from('market_mops_secondary_evidence')
        .select('report_date').eq('import_id', secondary.id).eq('outcome', 'published')
        .order('report_date', { ascending: false }).limit(1);
      if (evidence.error) throw new Error('unavailable');
      secondaryPublicationDate = evidence.data?.[0]?.report_date || null;
    }
    const secondaryFailed = run?.status === 'failed' && String(run.error_code || '').startsWith('MARKET_SECONDARY_');
    const lastAttempt = run ? {
      status: run.status,
      startedAt: run.started_at || null,
      completedAt: run.completed_at || null,
      errorCode: run.error_code || null,
      message: run.status === 'failed'
        ? secondaryFailed ? secondaryMopsFailureMessage(run.error_code) : 'The latest source sync failed. Existing verified imports remain available.'
        : null,
    } : null;
    const runStartedAt = Date.parse(run?.started_at || '');
    const stale = !run || !Number.isFinite(runStartedAt) || now.getTime() - runStartedAt > 2 * 60 * 60 * 1000;
    const secondaryFailure = secondaryFailed ? {
      code: run.error_code,
      message: secondaryMopsFailureMessage(run.error_code),
      affectedSeries: affectedSecondarySeries(run.error_code),
      attemptedAt: run.started_at || null,
    } : null;
    const pdfSources = ['Bunkerwire', 'European Marketscan'].map((label, index) => {
      const row = imports[index].data?.[0];
      return {
        key: ['bunkerwire', 'european_marketscan'][index],
        label,
        status: row ? 'available' : 'unavailable',
        lastSuccessAt: row?.created_at || null,
        lastPublicationDate: row?.report_date || null,
        message: row ? 'Last verified import shown.' : 'No verified import is available.',
      };
    });
    const coverage = secondaryCoverage(secondary);
    const secondaryHasConflicts = (coverage?.conflictDateCount || 0) > 0 || secondary?.status === 'completed_with_conflicts';
    const sources = [...pdfSources, {
      key: 'secondary_mops_csv',
      label: 'Secondary MOPS CSV',
      status: secondaryFailed || secondaryHasConflicts ? 'warning' : secondary ? 'available' : 'unavailable',
      lastSuccessAt: secondary?.created_at || null,
      lastPublicationDate: secondaryPublicationDate,
      successfulImportStatus: secondary?.status || null,
      coverage,
      lastAttemptError: secondaryFailure,
      message: secondaryCoverageMessage(coverage),
    }];
    return {
      checkedAt,
      lastRunAt: run?.started_at || null,
      lastAttempt,
      status: stale || run?.status === 'failed' || sources.some((row) => row.status !== 'available') ? 'warning' : run?.status === 'running' ? 'running' : 'available',
      message: stale ? 'The last recorded sync check is overdue.' : secondaryFailed ? 'The latest secondary CSV attempt needs attention. The last successful import and its publication coverage remain listed below.' : run?.status === 'failed' ? 'The latest source sync failed. Existing verified imports are shown below.' : 'Current source import status.',
      sources,
    };
  } catch {
    return { checkedAt, status: 'unavailable', message: 'Source status is temporarily unavailable. Market prices retain their own publication dates.', sources: [] };
  }
}
