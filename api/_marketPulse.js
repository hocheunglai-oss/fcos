import { calcMopsAverage, hktThisMonth, hktToday, latestMops } from '../src/hedge/lib/domain.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';
import { loadLatestIntradayPulse } from './_marketIntraday.js';
import { isCompletedReportPair, readCompletedMarketBrief, validMarketDate } from './_marketReportDates.js';
import { loadMarketIntelligenceHistory } from './_marketIntelligence.js';

const PRODUCTS = Object.freeze([
  { productKey: 'hsfo380', name: 'HSFO 380 MOPS', code: 'PPXDK00', field: 's380', unit: 'USD/MT', spreads: ['m1M2'] },
  { productKey: 'vlsfo', name: 'S0.5% MOPS', code: 'AMFSA00', field: 's05', unit: 'USD/MT', spreads: ['bmM1', 'm1M2'] },
  { productKey: 'lsmgo', name: 'Singapore Gasoil MOPS', code: 'POABC00', field: 'sgo', unit: 'USD/BBL', spreads: ['bmM1', 'm1M2'] },
]);
const CURVE_SYMBOLS = Object.freeze({
  hsfo380: { m1M2: ['FPLSM01', 'FPLSM02'] },
  vlsfo: { bmM1: ['FOFS000', 'FOFS001'], m1M2: ['FOFS001', 'FOFS002'] },
  lsmgo: { bmM1: ['BSGSL00', 'MSGSL00'], m1M2: ['MSGSL00', 'MSHSL00'] },
});

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
  asOfDate = null,
  singaporeDelivered = [],
} = {}) {
  const historical = asOfDate != null;
  if (historical && !validMarketDate(asOfDate)) throw pulseError('Choose a valid market report date.', 400, 'MARKET_PULSE_DATE_INVALID');
  if (historical) month = asOfDate.slice(0, 7);
  const eligibleRows = currentMonthRows.filter((row) => !historical || row.price_date <= asOfDate);
  const latest = ((!historical || latestMopsRow?.price_date <= asOfDate) && latestMopsRow?.is_estimate !== true ? latestMopsRow : null)
    || latestMops(eligibleRows.filter((row) => row.is_estimate !== true));
  if (historical && latestBrief?.report_date > asOfDate) latestBrief = null;
  if (historical && previousBrief?.report_date > asOfDate) previousBrief = null;
  const metrics = latestBrief?.deterministic_metrics || {};
  const previousMetrics = previousBrief?.deterministic_metrics || {};
  const currentBriefComplete = isCompletedReportPair(latestBrief);
  const previousBriefComplete = isCompletedReportPair(previousBrief);
  const regimeByProduct = new Map((metrics.curveRegimes || []).map((row) => [row.productKey, row]));
  const previousRegimeByProduct = new Map((previousMetrics.curveRegimes || []).map((row) => [row.productKey, row]));
  const products = PRODUCTS.map((spec) => {
    const average = calcMopsAverage(month, eligibleRows, spec.field);
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
        basis: 'Official MOPS ledger publication',
        sourceSampleCount: number(latest?.[spec.field]) == null ? 0 : 1,
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
        mode: historical ? 'reconstructed' : 'current',
        basis: historical ? 'Reconstructed weighted monthly estimate' : 'Weighted monthly estimate',
        sourceSampleCount: average.actualDays + average.estimatedDays,
        month,
        actualDays: average.actualDays,
        estimatedDays: average.estimatedDays,
        carriedDays: average.carryDays,
        countedDays: average.countedDays,
        publicationDays: average.totalDays,
      } : null,
      singaporeDelivered: singaporeDelivered.find((row) => row.productKey === spec.productKey) || null,
      curve: {
        reportDate: curveReportDate,
        status: normalizeRegime(curve?.regime),
        spreads: spec.spreads.map((key) => ({
          key,
          label: key === 'bmM1' ? 'BM − M1' : 'M1 − M2',
          value: number(curve?.[key]),
          publicationDate: curveReportDate,
          basis: 'Same-report exact-contract front minus back',
          sourceCodes: CURVE_SYMBOLS[spec.productKey][key],
          sourceSampleCount: number(curve?.[key]) == null ? 0 : 2,
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
    asOfDate: asOfDate || latestBrief?.report_date || latest?.price_date || hktToday(),
    mode: historical ? 'historical' : 'latest',
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
      monthlyEstimate: historical
        ? 'Reconstructed estimate using currently stored records dated on or before the selected report date and the existing weighted-average calculation, including carried publication days. Later corrections may be included; this is not an original point-in-time snapshot.'
        : 'Same current-month weighted-average calculation used in Markets, carrying the latest available value across remaining publication days.',
      curveDirection: 'Positive front-minus-back is backwardation; negative is contango. Missing marks remain unavailable.',
      publishedChanges: 'Latest MOPS and prompt-spread changes compare with the immediately preceding completed publication. Missing or N/A evidence remains unavailable and is never carried forward.',
    },
  };
}

async function loadUncachedMarketPulse(client, asOfDate) {
  const month = asOfDate?.slice(0, 7) || hktThisMonth();
  const boundary = asOfDate || hktToday();
  const [mopsResult, latestResult, latestBrief, intraday] = await Promise.all([
    client.from('hedge_market_prices')
      .select('price_date,s380,s05,sgo,is_estimate,verification_status')
      .gte('price_date', `${month}-01`)
      .lt('price_date', `${nextMonth(month)}-01`)
      .lte('price_date', asOfDate || `${nextMonth(month)}-01`)
      .order('price_date', { ascending: true }),
    client.from('hedge_market_prices')
      .select('price_date,s380,s05,sgo,is_estimate,verification_status')
      .eq('is_estimate', false)
      .lte('price_date', boundary)
      .order('price_date', { ascending: false })
      .limit(2),
    readCompletedMarketBrief(client, boundary, { columns: 'report_date,revision,completeness,deterministic_metrics' }),
    asOfDate ? null : loadLatestIntradayPulse(client),
  ]);
  const error = mopsResult.error || latestResult.error;
  if (error) throw pulseError(`Market Pulse could not be loaded: ${error.message}`);
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
  const deliveredDate = asOfDate || latestResult.data?.[0]?.price_date || boundary;
  const history = await loadMarketIntelligenceHistory(client, { range: '1w', endDate: deliveredDate, ports: ['singapore'], limit: 7 }, { overviewOnly: true });
  const singaporeDelivered = (history.intelligence?.delivered || []).map((row) => ({
    productKey: row.productKey, value: row.latest?.priceDate === deliveredDate ? row.latest.price : null,
    unit: row.unit, publicationDate: row.latest?.priceDate === deliveredDate ? deliveredDate : null,
    dayChange: row.latest?.priceDate === deliveredDate ? row.latest.dayChange : null,
    basis: 'Licensed delivered assessment; premium uses exact-date MOPS',
    sourceSampleCount: row.latest?.priceDate === deliveredDate && row.latest?.price != null ? 1 : 0,
    sourceCode: row.sourceSymbol, sourcePage: row.latest?.sourcePage || null,
    premium: { value: row.latest?.priceDate === deliveredDate ? row.deliveredPremium : null, date: deliveredDate },
  }));
  const result = buildMarketPulseSnapshot({
    currentMonthRows: mopsResult.data || [],
    latestMopsRow: latestResult.data?.[0] || null,
    previousMopsRow: latestResult.data?.[1] || null,
    latestBrief,
    previousBrief,
    intraday,
    month,
    asOfDate,
    singaporeDelivered,
  });
  result.warnings = [...new Set([...result.warnings, ...history.warnings.map((row) => row.message)])];
  return result;
}

export async function loadMarketPulseSnapshot(client, request = {}) {
  const asOfDate = request.asOfDate || null;
  if (asOfDate && (!validMarketDate(asOfDate) || asOfDate > hktToday())) throw pulseError('Choose a valid report date on or before today.', 400, 'MARKET_PULSE_DATE_INVALID');
  const cached = await getOrLoadRuntimeCache({
    namespace: 'market-pulse-snapshot',
    version: '5',
    accessScope: 'markets',
    apiVersion: 'supabase-market-intelligence-v1',
    payload: { month: asOfDate?.slice(0, 7) || hktThisMonth(), asOfDate, mode: asOfDate ? 'historical' : 'latest' },
    ttlSeconds: 60,
    tags: ['markets', 'hedge:markets', 'market:intelligence', 'market:pulse', 'market:intraday'],
    force: request.force === true,
    loader: () => loadUncachedMarketPulse(client, asOfDate),
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
