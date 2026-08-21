import { calcMopsAverage, hktThisMonth, hktToday, latestMops } from '../src/hedge/lib/domain.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';
import { loadLatestIntradayPulse } from './_marketIntraday.js';

const PRODUCTS = Object.freeze([
  { productKey: 'hsfo380', name: 'HSFO 380 MOPS', code: 'PPXDK00', field: 's380', unit: 'USD/MT', spreads: ['m1M2'] },
  { productKey: 'vlsfo', name: 'S0.5% MOPS', code: 'AMFSA00', field: 's05', unit: 'USD/MT', spreads: ['bmM1', 'm1M2'] },
  { productKey: 'lsmgo', name: 'Singapore Gasoil MOPS', code: 'POABC00', field: 'sgo', unit: 'USD/BBL', spreads: ['bmM1', 'm1M2'] },
]);

function pulseError(message, statusCode = 502, code = 'MARKET_PULSE_LOAD_FAILED') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function nextMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function warningText(value) {
  if (typeof value === 'string') return value.trim();
  return String(value?.summary || value?.message || '').trim();
}

function normalizeRegime(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['backwardation', 'contango', 'flat', 'mixed'].includes(normalized) ? normalized : 'unavailable';
}

function briefPairComplete(brief) {
  if (!brief) return false;
  const required = Number(brief.completeness?.requiredReports || 2);
  return required > 0 && Number(brief.completeness?.completeReports || 0) >= required;
}

function publishedComparison(currentValue, currentDate, previousValue, previousDate, unit) {
  const current = number(currentValue);
  const previous = number(previousValue);
  const available = current != null
    && previous != null
    && Boolean(currentDate)
    && Boolean(previousDate)
    && previousDate < currentDate;
  return {
    available,
    currentValue: current,
    currentDate: currentDate || null,
    previousValue: available ? previous : null,
    previousDate: available ? previousDate : null,
    change: available ? Math.round((current - previous) * 1_000_000) / 1_000_000 : null,
    unit,
  };
}

export function buildMarketPulseSnapshot({
  currentMonthRows = [],
  latestMopsRow = null,
  previousMopsRow = null,
  latestBrief = null,
  previousBrief = null,
  intraday = null,
  generatedAt = new Date().toISOString(),
  month = hktThisMonth(),
} = {}) {
  const latest = latestMopsRow || latestMops(currentMonthRows);
  const metrics = latestBrief?.deterministic_metrics || {};
  const previousMetrics = previousBrief?.deterministic_metrics || {};
  const currentBriefComplete = briefPairComplete(latestBrief);
  const previousBriefComplete = briefPairComplete(previousBrief);
  const regimeByProduct = new Map((metrics.curveRegimes || []).map((row) => [row.productKey, row]));
  const previousRegimeByProduct = new Map((previousMetrics.curveRegimes || []).map((row) => [row.productKey, row]));
  const products = PRODUCTS.map((spec) => {
    const average = calcMopsAverage(month, currentMonthRows, spec.field);
    const curve = regimeByProduct.get(spec.productKey);
    const previousCurve = previousRegimeByProduct.get(spec.productKey);
    const latestPublicationDate = latest?.price_date || null;
    const curveReportDate = curve?.reportDate || latestBrief?.report_date || null;
    const previousCurveReportDate = previousCurve?.reportDate || previousBrief?.report_date || null;
    return {
      productKey: spec.productKey,
      productName: spec.name,
      sourceCode: spec.code,
      unit: spec.unit,
      latestMops: {
        value: number(latest?.[spec.field]),
        publicationDate: latestPublicationDate,
        estimated: latest?.is_estimate === true,
        comparison: publishedComparison(
          latest?.[spec.field],
          latestPublicationDate,
          previousMopsRow?.[spec.field],
          previousMopsRow?.price_date,
          spec.unit,
        ),
      },
      monthlyEstimate: average ? {
        value: number(average.avg),
        month,
        actualDays: average.actualDays,
        estimatedDays: average.estimatedDays,
        carriedDays: average.carryDays,
        countedDays: average.countedDays,
        publicationDays: average.totalDays,
      } : null,
      curve: {
        reportDate: curveReportDate,
        status: normalizeRegime(curve?.regime),
        spreads: spec.spreads.map((key) => ({
          key,
          label: key === 'bmM1' ? 'BM − M1' : 'M1 − M2',
          value: number(curve?.[key]),
          unit: curve?.unit || spec.unit,
          comparison: publishedComparison(
            currentBriefComplete ? curve?.[key] : null,
            curveReportDate,
            previousBriefComplete ? previousCurve?.[key] : null,
            previousCurveReportDate,
            curve?.unit || spec.unit,
          ),
        })),
      },
    };
  });
  const reportCompleteness = {
    complete: currentBriefComplete,
    completeReports: Number(latestBrief?.completeness?.completeReports || 0),
    requiredReports: Number(latestBrief?.completeness?.requiredReports || 2),
  };
  const curveCompleteness = {
    evidenceComplete: latestBrief?.completeness?.curveEvidenceComplete === true,
    numericMarks: Number(latestBrief?.completeness?.numericCurveMarks || 0),
    requiredMarks: Number(latestBrief?.completeness?.requiredCurveMarks || 8),
    publishedNa: Number(latestBrief?.completeness?.publishedNaCount || 0),
    missing: Number(latestBrief?.completeness?.missingCurveMarkCount || 0),
  };
  const warnings = [...new Set((metrics.warnings || []).map(warningText).filter(Boolean))].slice(0, 12);
  if (!latest) warnings.unshift('No MOPS publication is available.');
  if (!latestBrief) warnings.push('No completed Bunkerwire and European Marketscan report pair is available.');
  return {
    generatedAt,
    currentMonth: month,
    complete: Boolean(latest && reportCompleteness.complete),
    latestMopsPublicationDate: latest?.price_date || null,
    curveReportDate: latestBrief?.report_date || null,
    reportCompleteness,
    curveCompleteness,
    products,
    intraday,
    warnings: [...new Set(warnings)],
    methodology: {
      monthlyEstimate: 'Same current-month weighted-average calculation used in Markets, carrying the latest available value across remaining publication days.',
      curveDirection: 'Positive front-minus-back is backwardation; negative is contango. Missing marks remain unavailable.',
      publishedChanges: 'Latest MOPS and prompt-spread changes compare with the immediately preceding completed publication. Missing or N/A evidence remains unavailable and is never carried forward.',
    },
  };
}

async function loadUncachedMarketPulse(client) {
  const month = hktThisMonth();
  const [mopsResult, latestResult, briefResult, intraday] = await Promise.all([
    client.from('hedge_market_prices')
      .select('price_date,s380,s05,sgo,is_estimate,verification_status')
      .gte('price_date', `${month}-01`)
      .lt('price_date', `${nextMonth(month)}-01`)
      .order('price_date', { ascending: true }),
    client.from('hedge_market_prices')
      .select('price_date,s380,s05,sgo,is_estimate,verification_status')
      .eq('is_estimate', false)
      .lte('price_date', hktToday())
      .order('price_date', { ascending: false })
      .limit(2),
    client.from('market_intelligence_briefs')
      .select('report_date,revision,completeness,deterministic_metrics')
      .lte('report_date', hktToday())
      .order('report_date', { ascending: false })
      .order('revision', { ascending: false })
      .limit(1),
    loadLatestIntradayPulse(client),
  ]);
  const error = mopsResult.error || latestResult.error || briefResult.error;
  if (error) throw pulseError(`Market Pulse could not be loaded: ${error.message}`);
  const latestBrief = briefResult.data?.[0] || null;
  let previousBrief = null;
  if (latestBrief?.report_date) {
    const previousBriefResult = await client.from('market_intelligence_briefs')
      .select('report_date,revision,completeness,deterministic_metrics')
      .lt('report_date', latestBrief.report_date)
      .order('report_date', { ascending: false })
      .order('revision', { ascending: false })
      .limit(1);
    if (previousBriefResult.error) throw pulseError(`Market Pulse comparison could not be loaded: ${previousBriefResult.error.message}`);
    previousBrief = previousBriefResult.data?.[0] || null;
  }
  return buildMarketPulseSnapshot({
    currentMonthRows: mopsResult.data || [],
    latestMopsRow: latestResult.data?.[0] || null,
    previousMopsRow: latestResult.data?.[1] || null,
    latestBrief,
    previousBrief,
    intraday,
    month,
  });
}

export async function loadMarketPulseSnapshot(client, request = {}) {
  const cached = await getOrLoadRuntimeCache({
    namespace: 'market-pulse-snapshot',
    version: '4',
    accessScope: 'markets',
    apiVersion: 'supabase-market-intelligence-v1',
    payload: { month: hktThisMonth() },
    ttlSeconds: 60,
    tags: ['markets', 'hedge:markets', 'market:intelligence', 'market:pulse', 'market:intraday'],
    force: request.force === true,
    loader: () => loadUncachedMarketPulse(client),
  });
  return {
    ...cached.value,
    meta: {
      cache: cached.cache?.status || null,
      cachedAt: cached.cache?.fetchedAt || null,
      ttlSeconds: 60,
      redacted: true,
    },
  };
}
