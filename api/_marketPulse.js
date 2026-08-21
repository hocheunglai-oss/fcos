import { calcMopsAverage, hktThisMonth, hktToday, latestMops } from '../src/hedge/lib/domain.js';
import { tradingViewIndicativeBrent } from '../shared/brentMarketModel.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';

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

export function buildMarketPulseSnapshot({
  currentMonthRows = [],
  latestMopsRow = null,
  latestBrief = null,
  generatedAt = new Date().toISOString(),
  month = hktThisMonth(),
} = {}) {
  const latest = latestMopsRow || latestMops(currentMonthRows);
  const metrics = latestBrief?.deterministic_metrics || {};
  const regimeByProduct = new Map((metrics.curveRegimes || []).map((row) => [row.productKey, row]));
  const products = PRODUCTS.map((spec) => {
    const average = calcMopsAverage(month, currentMonthRows, spec.field);
    const curve = regimeByProduct.get(spec.productKey);
    return {
      productKey: spec.productKey,
      productName: spec.name,
      sourceCode: spec.code,
      unit: spec.unit,
      latestMops: {
        value: number(latest?.[spec.field]),
        publicationDate: latest?.price_date || null,
        estimated: latest?.is_estimate === true,
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
        reportDate: curve?.reportDate || latestBrief?.report_date || null,
        status: normalizeRegime(curve?.regime),
        spreads: spec.spreads.map((key) => ({
          key,
          label: key === 'bmM1' ? 'BM − M1' : 'M1 − M2',
          value: number(curve?.[key]),
          unit: curve?.unit || spec.unit,
        })),
      },
    };
  });
  const reportCompleteness = {
    complete: Number(latestBrief?.completeness?.completeReports || 0) >= Number(latestBrief?.completeness?.requiredReports || 2),
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
    warnings: [...new Set(warnings)],
    brent: tradingViewIndicativeBrent(),
    methodology: {
      monthlyEstimate: 'Same current-month weighted-average calculation used in Markets, carrying the latest available value across remaining publication days.',
      curveDirection: 'Positive front-minus-back is backwardation; negative is contango. Missing marks remain unavailable.',
    },
  };
}

async function loadUncachedMarketPulse(client) {
  const month = hktThisMonth();
  const [mopsResult, latestResult, briefResult] = await Promise.all([
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
      .limit(1),
    client.from('market_intelligence_briefs')
      .select('report_date,revision,completeness,deterministic_metrics')
      .lte('report_date', hktToday())
      .order('report_date', { ascending: false })
      .order('revision', { ascending: false })
      .limit(1),
  ]);
  const error = mopsResult.error || latestResult.error || briefResult.error;
  if (error) throw pulseError(`Market Pulse could not be loaded: ${error.message}`);
  return buildMarketPulseSnapshot({
    currentMonthRows: mopsResult.data || [],
    latestMopsRow: latestResult.data?.[0] || null,
    latestBrief: briefResult.data?.[0] || null,
    month,
  });
}

export async function loadMarketPulseSnapshot(client, request = {}) {
  const cached = await getOrLoadRuntimeCache({
    namespace: 'market-pulse-snapshot',
    version: '1',
    accessScope: 'markets',
    apiVersion: 'supabase-market-intelligence-v1',
    payload: { month: hktThisMonth() },
    ttlSeconds: 60,
    tags: ['markets', 'hedge:markets', 'market:intelligence', 'market:pulse'],
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
