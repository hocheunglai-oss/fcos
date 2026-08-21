import { createHash } from 'node:crypto';
import {
  evaluateCurveShadow,
  exactOutrightForContract,
  manualFallbackExpiry,
  projectedMopsSettlement,
  sameSnapshotSignals,
  shiftContractMonth,
} from '../shared/plattsMarketModel.js';
import { marketPublicationEligible, nextMarketPublicationDate } from './_marketIntelligence.js';
import { mopsMonthInputFingerprint } from './_hedgeMops.js';

const PRODUCTS = Object.freeze(['hsfo380', 'vlsfo', 'lsmgo']);
const PRODUCT_UNITS = Object.freeze({ hsfo380: 'USD/MT', vlsfo: 'USD/MT', lsmgo: 'USD/BBL' });
const PRODUCT_SESSIONS = Object.freeze({ hsfo380: 'london_moc', vlsfo: 'asia_moc', lsmgo: 'london_moc' });
const REQUIRED_CURVE_TENORS = Object.freeze({ hsfo380: ['M1', 'M2'], vlsfo: ['BM', 'M1', 'M2'], lsmgo: ['BM', 'M1', 'M2'] });
const FORWARD_SYMBOL_PRODUCTS = Object.freeze({
  FPLSM01: 'hsfo380', FPLSM02: 'hsfo380',
  FOFS000: 'vlsfo', FOFS001: 'vlsfo', FOFS002: 'vlsfo',
  BSGSL00: 'lsmgo', MSGSL00: 'lsmgo', MSHSL00: 'lsmgo',
});
const MARKET_FAMILIES = new Set(['delivered', 'cargo', 'forward', 'context', 'compliance']);
const SGO_BBL_PER_MT = 7.45;
const RANGES = Object.freeze({ '1w': 7, '1m': 31, '3m': 93, '6m': 186, '1y': 366 });
const DEFAULT_RULES = Object.freeze({
  enabled: true,
  outrightFloorUsdMt: 10,
  spreadFloorUsdMt: 5,
  gasoilFloorUsdBbl: 1,
  percentile: 0.95,
  lookbackDays: 60,
  minimumSamples: 20,
  curveDeadbandUsdMt: 2,
  curveDeadbandUsdBbl: 0.25,
});
const DRIVER_TAGS = new Set(['availability', 'inventories', 'demand', 'delivery_lead_time', 'barge_congestion', 'weather', 'refinery_outage', 'flows_arbitrage', 'freight', 'sanctions', 'regulation', 'geopolitics']);
const PORT_KEYS = new Set(['singapore', 'south-korea', 'south-korea-west', 'zhoushan', 'kaohsiung', 'hong-kong', 'global']);
const HORIZONS = new Set(['intraday', 'prompt', 'week', 'month', 'quarter', 'unclear']);

function intelligenceError(message, statusCode = 400, code = 'MARKET_INTELLIGENCE_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isoDate(value = null) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : value.slice(0, 10);
  }
  const date = value == null ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isoMonth(value) {
  const month = String(value || '').slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function dateBefore(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function reviewedPublicationDays(contractMonth, assessmentSession = 'asia_moc') {
  const month = isoMonth(contractMonth);
  if (!month || marketPublicationEligible(`${month}-01`, assessmentSession) == null) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 1));
  const cursor = new Date(Date.UTC(year, monthNumber - 1, 1));
  const days = [];
  while (cursor < end) {
    const day = cursor.toISOString().slice(0, 10);
    if (marketPublicationEligible(day, assessmentSession) === true) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function latestReviewedPublicationDate(asOfDate, assessmentSession) {
  const date = isoDate(asOfDate);
  if (!date || marketPublicationEligible(date, assessmentSession) == null) return null;
  const cursor = new Date(`${date}T00:00:00Z`);
  for (let attempts = 0; attempts < 16; attempts += 1) {
    const candidate = cursor.toISOString().slice(0, 10);
    if (marketPublicationEligible(candidate, assessmentSession) === true) return candidate;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return null;
}

async function loadSettlementEvidence(client, asOfDate, requestedMonths = []) {
  const currentMonth = asOfDate.slice(0, 7);
  const previousMonth = shiftContractMonth(currentMonth, -1);
  const verificationMonths = [...new Set([previousMonth, currentMonth, ...(requestedMonths || []).map(isoMonth)].filter(Boolean))];
  const earliestMonth = verificationMonths.sort()[0] || currentMonth;
  const [actualResult, verificationResult] = await Promise.all([
    client.from('hedge_market_prices')
      .select('price_date,s380,s05,sgo,is_estimate,verification_status')
      .gte('price_date', `${earliestMonth}-01`)
      .lte('price_date', asOfDate)
      .eq('is_estimate', false)
      .order('price_date', { ascending: true }),
    client.from('hedge_mops_month_verifications')
      .select('contract_month,calculated_snapshot,input_fingerprint,verified_at,revision')
      .in('contract_month', verificationMonths),
  ]);
  const error = actualResult.error || verificationResult.error;
  if (error) throw intelligenceError(`Projected MOPS settlement evidence could not be loaded: ${error.message}`, 502, 'MARKET_SETTLEMENT_EVIDENCE_LOAD_FAILED');
  return { actuals: actualResult.data || [], verifications: verificationResult.data || [] };
}

function projectedSettlementRows({ asOfDate, products, snapshot, fallbacks, actuals, verifications, shadow, requestedMonths = [] }) {
  const currentMonth = asOfDate.slice(0, 7);
  const previousMonth = shiftContractMonth(currentMonth, -1);
  const fieldByProduct = { hsfo380: 's380', vlsfo: 's05', lsmgo: 'sgo' };
  const approvedByMonth = new Map((verifications || []).map((row) => [row.contract_month, row]));
  const rows = [];
  for (const product of products) {
    const field = fieldByProduct[product];
    const publicationSession = PRODUCT_SESSIONS[product];
    const closedMonths = [...new Set([previousMonth, ...(requestedMonths || []).map(isoMonth).filter((month) => month && month < currentMonth)])].sort();
    for (const closedMonth of closedMonths) {
      const closedVerification = approvedByMonth.get(closedMonth);
      const currentFingerprint = mopsMonthInputFingerprint(closedMonth, actuals || []);
      const verificationCurrent = Boolean(closedVerification?.input_fingerprint
        && currentFingerprint
        && closedVerification.input_fingerprint === currentFingerprint);
      const closedCandidate = verificationCurrent
        ? projectedMopsSettlement({
          contractMonth: closedMonth,
          asOfDate,
          approvedActualAverage: closedVerification?.calculated_snapshot?.[field],
        })
        : { available: false, reason: closedVerification ? 'closed_month_verification_stale' : 'closed_month_not_approved' };
      const closedPublicationDays = reviewedPublicationDays(closedMonth, publicationSession) || [];
      const actualByDate = new Map((actuals || []).filter((row) => String(row.price_date).slice(0, 7) === closedMonth).map((row) => [row.price_date, number(row[field])]));
      const points = closedCandidate.available ? closedPublicationDays.map((priceDate) => ({ priceDate, value: actualByDate.get(priceDate) ?? null, source: 'approved_actual' })).filter((point) => point.value != null) : [];
      const closed = closedCandidate.available && points.length !== closedPublicationDays.length
        ? { available: false, reason: 'closed_month_publication_points_incomplete' }
        : closedCandidate;
      rows.push({
        productKey: product,
        contractMonth: closedMonth,
        unit: PRODUCT_UNITS[product],
        period: 'closed',
        ...closed,
        evidenceRevision: closedVerification?.revision || null,
        verificationCurrent,
        points,
        authorizedForValuation: closed.available && points.length === closedPublicationDays.length,
      });
    }

    const productPublicationDays = reviewedPublicationDays(currentMonth, publicationSession);
    const balanceAssessmentDate = latestReviewedPublicationDate(asOfDate, publicationSession);
    const bm = snapshot.find((row) => row.productKey === product
      && row.tenor === 'BM'
      && String(row.contractMonth).slice(0, 7) === currentMonth
      && row.unit === PRODUCT_UNITS[product]
      && (row.qualityStatus === 'authorized_fallback'
        ? row.reportDate <= asOfDate && row.expiresOn > asOfDate
        : row.qualityStatus === 'verified' && row.reportDate === balanceAssessmentDate));
    const current = productPublicationDays && balanceAssessmentDate ? projectedMopsSettlement({
      contractMonth: currentMonth,
      asOfDate: balanceAssessmentDate,
      publicationDays: productPublicationDays,
      actuals: (actuals || []).map((row) => ({ date: row.price_date, value: row[field], isEstimate: row.is_estimate })),
      balanceMonthValue: bm?.value,
    }) : { available: false, reason: 'publication_calendar_unavailable' };
    const currentActualByDate = new Map((actuals || []).filter((row) => String(row.price_date).slice(0, 7) === currentMonth).map((row) => [row.price_date, number(row[field])]));
    const currentPoints = current.available ? productPublicationDays.map((priceDate) => priceDate < balanceAssessmentDate
      ? { priceDate, value: currentActualByDate.get(priceDate) ?? null, source: 'verified_actual' }
      : { priceDate, value: bm.value, source: bm.qualityStatus === 'authorized_fallback' ? 'authorized_manual_fallback' : 'balance_month_projection' }) : [];
    rows.push({
      productKey: product,
      contractMonth: currentMonth,
      unit: PRODUCT_UNITS[product],
      period: 'current',
      ...current,
      assessmentDate: balanceAssessmentDate,
      sourceObservationId: bm?.id || null,
      points: currentPoints,
      authorizedForValuation: current.available && shadow?.cutoverApproved === true,
    });

    const futureMonths = [...new Set([
      ...snapshot
        .filter((row) => row.productKey === product && String(row.contractMonth).slice(0, 7) > currentMonth)
        .map((row) => String(row.contractMonth).slice(0, 7)),
      ...(requestedMonths || []).map(isoMonth).filter((month) => month && month > currentMonth),
    ])].sort();
    for (const contractMonth of futureMonths) {
      const outright = exactOutrightForContract({
        product,
        contractMonth,
        asOfDate,
        observations: snapshot.filter((row) => row.qualityStatus === 'verified'),
        fallbacks: (fallbacks || []).map((row) => ({
          id: row.id,
          product: row.product_key,
          contractMonth: row.contract_month,
          unit: row.unit,
          outrightValue: row.outright_value,
          asOfDate: row.as_of_date,
          expiresOn: row.expires_on,
          status: row.status,
        })),
      });
      const futurePublicationDays = reviewedPublicationDays(contractMonth, publicationSession);
      const future = futurePublicationDays ? outright : { available: false, reason: 'publication_calendar_unavailable' };
      const points = future.available
        ? futurePublicationDays.map((priceDate) => ({ priceDate, value: future.value, source: future.source }))
        : [];
      rows.push({
        productKey: product,
        contractMonth,
        unit: PRODUCT_UNITS[product],
        period: 'future',
        ...future,
        points,
        authorizedForValuation: outright.available && shadow?.cutoverApproved === true,
      });
    }
  }
  return rows;
}

async function allRows(makeQuery, { pageSize = 1000, maximum = 30_000 } = {}) {
  const rows = [];
  for (let offset = 0; offset < maximum; offset += pageSize) {
    const result = await makeQuery().range(offset, offset + pageSize - 1);
    if (result.error) throw intelligenceError(`Market intelligence could not be loaded: ${result.error.message}`, 502, 'MARKET_INTELLIGENCE_LOAD_FAILED');
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) return rows;
  }
  throw intelligenceError('Market intelligence is incomplete. Narrow the requested period.', 409, 'MARKET_INTELLIGENCE_SCOPE_INCOMPLETE');
}

function normalizeProducts(products) {
  const selected = Array.isArray(products) ? products : products == null ? PRODUCTS : [products];
  const values = [...new Set(selected.map((value) => String(value || '').toLowerCase()).filter((value) => PRODUCTS.includes(value)))];
  if (!values.length) throw intelligenceError('Choose at least one supported product.', 400, 'MARKET_INTELLIGENCE_PRODUCT_REQUIRED');
  return PRODUCTS.filter((product) => values.includes(product));
}

function canonicalProduct(value) {
  const product = String(value || '').toLowerCase();
  return PRODUCTS.includes(product) ? product : null;
}

function seriesProduct(series, observation = null) {
  return canonicalProduct(observation?.basis_metadata?.productKey)
    || FORWARD_SYMBOL_PRODUCTS[String(series?.source_symbol || '').toUpperCase()]
    || canonicalProduct(series?.basis_metadata?.productKey)
    || canonicalProduct(series?.product_key);
}

function seriesMarketFamily(series, observation = null) {
  const observed = String(observation?.basis_metadata?.marketFamily || '').toLowerCase();
  if (MARKET_FAMILIES.has(observed)) return observed;
  const configured = String(series?.market_family || '').toLowerCase();
  return MARKET_FAMILIES.has(configured) ? configured : null;
}

function observationProjection(row, series, report) {
  return {
    id: row.id,
    seriesId: row.series_id,
    reportId: report?.id || row.import_id,
    sourceHash: report?.source_hash || row.source_hash,
    reportDate: row.price_date,
    productKey: seriesProduct(series, row),
    contractMonth: row.contract_month,
    printedContractMonth: row.printed_contract_month,
    tenor: String(row.tenor || series?.tenor || '').toUpperCase(),
    value: number(row.price),
    dayChange: number(row.day_change),
    unit: row.observation_unit || series?.unit,
    sourceSymbol: series?.source_symbol,
    sourcePage: row.source_page,
    qualityStatus: row.quality_status,
    assessmentSession: row.assessment_session || series?.assessment_session,
    marketFamily: seriesMarketFamily(series, row),
    portKey: row.basis_metadata?.portKey || series?.port_key || null,
    portLabel: series?.port_label || null,
    productLabel: series?.product_label || null,
    settlementBasis: row.basis_metadata?.settlementBasis || series?.basis_metadata?.settlementBasis || null,
    source: report?.source_document_type || null,
    publicationEligible: row.basis_metadata?.publicationEligible !== false,
  };
}

async function loadCurveRows(client, { startDate, endDate }) {
  const [seriesResult, imports, observations, fallbacksResult, shadowResult, shadowControlResult] = await Promise.all([
    client.from('market_intelligence_series').select('id,market_family,port_key,port_label,product_key,product_label,source_symbol,unit,tenor,assessment_session,basis_metadata').eq('active', true),
    allRows(() => client.from('market_report_imports').select('id,source_hash,source_document_type,report_date').gte('report_date', startDate).lte('report_date', endDate).order('report_date', { ascending: true })),
    allRows(() => client.from('market_price_observations').select('id,series_id,import_id,price_date,price,day_change,quality_status,source_hash,source_page,contract_month,printed_contract_month,tenor,observation_unit,assessment_session,basis_metadata').gte('price_date', startDate).lte('price_date', endDate).order('price_date', { ascending: true })),
    client.from('market_forward_fallback_marks').select('id,product_key,contract_month,unit,outright_value,as_of_date,status,expires_on,revision').eq('status', 'active').gt('expires_on', endDate).order('as_of_date', { ascending: false }),
    client.from('market_curve_shadow_runs').select('publication_date,product_key,contract_month,unit,comparison_count,mean_signed_variance,mean_absolute_variance,maximum_absolute_variance,reviewed_at').gte('publication_date', startDate).lte('publication_date', endDate).order('publication_date', { ascending: true }),
    client.from('market_curve_shadow_control').select('minimum_publication_days,cutover_approved,reviewed_at,revision').eq('id', 'company').maybeSingle(),
  ]);
  const error = seriesResult.error || fallbacksResult.error || shadowResult.error || shadowControlResult.error;
  if (error) throw intelligenceError(`Market intelligence could not be loaded: ${error.message}`, 502, 'MARKET_INTELLIGENCE_LOAD_FAILED');
  const seriesById = new Map((seriesResult.data || []).map((row) => [row.id, row]));
  const importsById = new Map(imports.map((row) => [row.id, row]));
  return {
    observations: observations.map((row) => observationProjection(row, seriesById.get(row.series_id), importsById.get(row.import_id)))
      .filter((row) => row.publicationEligible && row.qualityStatus === 'verified'),
    fallbacks: fallbacksResult.data || [],
    shadowRows: shadowResult.data || [],
    shadowControl: shadowControlResult.data || { minimum_publication_days: 10, cutover_approved: false, revision: 0 },
  };
}

function snapshotSignals(rows) {
  if (!rows.length) return null;
  const normalized = rows.map((row) => ({ ...row, product: row.productKey, reportId: rows[0].reportId, sourceHash: rows[0].sourceHash }));
  const signal = sameSnapshotSignals(normalized);
  if (!signal.complete) return null;
  return signal;
}

function curveSnapshot(observations, asOfDate, products) {
  const latestByProductSession = new Map();
  for (const row of observations) {
    if (!products.includes(row.productKey) || row.marketFamily !== 'forward' || row.reportDate > asOfDate) continue;
    const key = `${row.productKey}:${row.assessmentSession}`;
    if (!latestByProductSession.has(key) || latestByProductSession.get(key) < row.reportDate) latestByProductSession.set(key, row.reportDate);
  }
  return observations
    .filter((row) => row.marketFamily === 'forward' && products.includes(row.productKey))
    .filter((row) => latestByProductSession.get(`${row.productKey}:${row.assessmentSession}`) === row.reportDate)
    .sort((left, right) => PRODUCTS.indexOf(left.productKey) - PRODUCTS.indexOf(right.productKey) || String(left.contractMonth).localeCompare(String(right.contractMonth)) || left.tenor.localeCompare(right.tenor));
}

function fallbackTenor(asOfDate, contractMonth) {
  const asOf = new Date(`${String(asOfDate).slice(0, 7)}-01T00:00:00Z`);
  const contract = new Date(`${String(contractMonth).slice(0, 7)}-01T00:00:00Z`);
  const offset = (contract.getUTCFullYear() - asOf.getUTCFullYear()) * 12 + contract.getUTCMonth() - asOf.getUTCMonth();
  return offset === 0 ? 'BM' : offset === 1 ? 'M1' : offset === 2 ? 'M2' : 'OTHER';
}

function applyActiveFallbacks(snapshot, fallbacks, asOfDate, products) {
  const rows = [...snapshot];
  for (const fallback of fallbacks || []) {
    if (!products.includes(fallback.product_key) || fallback.status !== 'active' || fallback.as_of_date > asOfDate || fallback.expires_on <= asOfDate) continue;
    if (rows.some((row) => row.productKey === fallback.product_key && String(row.contractMonth).slice(0, 7) === String(fallback.contract_month).slice(0, 7))) continue;
    rows.push({
      id: fallback.id,
      reportId: null,
      sourceHash: null,
      reportDate: fallback.as_of_date,
      productKey: fallback.product_key,
      contractMonth: fallback.contract_month,
      printedContractMonth: null,
      tenor: fallbackTenor(asOfDate, fallback.contract_month),
      value: number(fallback.outright_value),
      dayChange: null,
      unit: fallback.unit,
      sourceSymbol: null,
      sourcePage: null,
      qualityStatus: 'authorized_fallback',
      assessmentSession: fallback.product_key === 'vlsfo' ? 'asia_moc' : 'london_moc',
      marketFamily: 'forward',
      settlementBasis: 'outright',
      source: 'manual_fallback',
      expiresOn: fallback.expires_on,
    });
  }
  return rows.sort((left, right) => PRODUCTS.indexOf(left.productKey) - PRODUCTS.indexOf(right.productKey) || String(left.contractMonth).localeCompare(String(right.contractMonth)));
}

function historySignals(observations, products) {
  const byImport = new Map();
  for (const row of observations) {
    if (!products.includes(row.productKey) || !['forward', 'context'].includes(row.marketFamily)) continue;
    const list = byImport.get(row.reportId) || [];
    list.push(row);
    byImport.set(row.reportId, list);
  }
  const history = [];
  const signals = [];
  const contexts = { eastWest: [], gasoilEfs: [], iceBrent: [], iceLsgo: [] };
  const outrightHistory = [];
  for (const rows of byImport.values()) {
    const forward = rows.filter((row) => row.marketFamily === 'forward');
    outrightHistory.push(...forward.map((row) => ({ observationId: row.id, seriesId: row.seriesId, reportId: row.reportId, sourceHash: row.sourceHash, sourcePage: row.sourcePage, date: row.reportDate, productKey: row.productKey, contractMonth: row.contractMonth, tenor: row.tenor, value: row.value, dayChange: row.dayChange, unit: row.unit, sourceSymbol: row.sourceSymbol, assessmentSession: row.assessmentSession })));
    const curve = snapshotSignals(forward);
    if (curve) {
      for (const product of products) {
        const value = curve.products?.[product];
        if (!value || (value.bmM1 == null && value.m1M2 == null)) continue;
        history.push({ date: rows[0].reportDate, productKey: product, unit: PRODUCT_UNITS[product], bmM1: value.bmM1, m1M2: value.m1M2, headlineSlope: value.bmM1 ?? value.m1M2, regime: value.regime, sourceRefs: forward.filter((item) => item.productKey === product).map((item) => ({ reportId: item.reportId, reportDate: item.reportDate, seriesId: item.seriesId, sourceHash: item.sourceHash, sourcePage: item.sourcePage, page: item.sourcePage, sourceSymbol: item.sourceSymbol })) });
      }
      for (const tenor of ['m1', 'm2']) if (curve.crossGrade?.[tenor] != null) signals.push({ date: rows[0].reportDate, type: 'vlsfo_hsfo_cross_grade', tenor: tenor.toUpperCase(), value: curve.crossGrade[tenor], unit: 'USD/MT' });
    }
    for (const row of rows.filter((item) => item.marketFamily === 'context')) {
      const point = { date: row.reportDate, contractMonth: row.contractMonth, tenor: row.tenor, value: row.value, unit: row.unit, sourceSymbol: row.sourceSymbol };
      if (row.settlementBasis === 'east_west_spread') contexts.eastWest.push(point);
      else if (row.settlementBasis === 'gasoil_efs') contexts.gasoilEfs.push(point);
      else if (row.settlementBasis === 'ice_brent') contexts.iceBrent.push(point);
      else if (/ice_lsgo/.test(row.settlementBasis || '')) contexts.iceLsgo.push(point);
    }
  }
  history.sort((a, b) => a.date.localeCompare(b.date) || PRODUCTS.indexOf(a.productKey) - PRODUCTS.indexOf(b.productKey));
  signals.sort((a, b) => a.date.localeCompare(b.date));
  outrightHistory.sort((a, b) => a.date.localeCompare(b.date) || String(a.sourceSymbol).localeCompare(String(b.sourceSymbol)));
  return { history, signals, contexts, outrightHistory };
}

function physicalMetrics(observations, asOfDate, products) {
  const rows = observations.filter((row) => row.reportDate === asOfDate && products.includes(row.productKey));
  const portDislocations = [];
  const physicalPaperSignals = [];
  const premiumMoves = [];
  for (const productKey of products) {
    const assessed = rows.filter((row) => row.productKey === productKey && row.marketFamily === 'delivered' && row.assessmentSession !== 'posted');
    if (assessed.length >= 2) {
      const ordered = [...assessed].sort((a, b) => a.value - b.value);
      portDislocations.push({ productKey, lowPort: ordered[0].portLabel || ordered[0].portKey || ordered[0].sourceSymbol, lowPortSymbol: ordered[0].sourceSymbol, highPort: ordered.at(-1).portLabel || ordered.at(-1).portKey || ordered.at(-1).sourceSymbol, highPortSymbol: ordered.at(-1).sourceSymbol, dispersion: number((ordered.at(-1).value - ordered[0].value).toFixed(3)), unit: 'USD/MT', sampleCount: assessed.length, sourceRefs: [ordered[0], ordered.at(-1)].map((item) => ({ reportId: item.reportId, reportDate: item.reportDate, seriesId: item.seriesId, sourceHash: item.sourceHash, sourcePage: item.sourcePage, page: item.sourcePage, sourceSymbol: item.sourceSymbol })) });
    }
    const physicalMoves = assessed.map((row) => row.dayChange).filter((value) => value != null);
    const benchmark = rows.find((row) => row.productKey === productKey && row.marketFamily === 'cargo');
    if (benchmark?.dayChange != null) {
      const benchmarkMoveUsdMt = productKey === 'lsmgo' ? benchmark.dayChange * SGO_BBL_PER_MT : benchmark.dayChange;
      for (const row of assessed.filter((item) => item.dayChange != null)) {
        const evidenceRefs = [row, benchmark].map((item) => ({ reportId: item.reportId, reportDate: item.reportDate, seriesId: item.seriesId, sourceHash: item.sourceHash, sourcePage: item.sourcePage, page: item.sourcePage, sourceSymbol: item.sourceSymbol }));
        premiumMoves.push({ productKey, portSymbol: row.sourceSymbol, date: asOfDate, change: number((row.dayChange - benchmarkMoveUsdMt).toFixed(3)), unit: 'USD/MT', reportId: row.reportId, seriesId: row.seriesId, sourceHash: row.sourceHash, sourcePage: row.sourcePage, evidenceRefs, evidenceHash: hash(evidenceRefs) });
      }
    }
    const paper = rows.find((row) => row.productKey === productKey && row.marketFamily === 'forward' && row.tenor === 'M1');
    if (!physicalMoves.length || paper?.dayChange == null) {
      physicalPaperSignals.push({ productKey, state: 'unavailable', reportDate: asOfDate });
      continue;
    }
    const physicalMove = physicalMoves.reduce((sum, value) => sum + value, 0) / physicalMoves.length;
    const paperMoveUsdMt = productKey === 'lsmgo' ? paper.dayChange * SGO_BBL_PER_MT : paper.dayChange;
    const physicalMaterial = Math.abs(physicalMove) >= 10;
    const paperMaterial = Math.abs(paperMoveUsdMt) >= (productKey === 'lsmgo' ? SGO_BBL_PER_MT : 10);
    physicalPaperSignals.push({
      productKey,
      reportDate: asOfDate,
      physicalMove: number(physicalMove.toFixed(3)),
      paperMove: number(paperMoveUsdMt.toFixed(3)),
      unit: 'USD/MT',
      originalPaperMove: productKey === 'lsmgo' ? paper.dayChange : null,
      originalPaperUnit: productKey === 'lsmgo' ? 'USD/BBL' : null,
      conversionFactor: productKey === 'lsmgo' ? SGO_BBL_PER_MT : null,
      state: physicalMaterial && paperMaterial ? (Math.sign(physicalMove) === Math.sign(paperMoveUsdMt) ? 'confirmed' : 'divergent') : 'inconclusive',
      sourceRefs: [...assessed, paper].map((item) => ({ reportId: item.reportId, reportDate: item.reportDate, seriesId: item.seriesId, sourceHash: item.sourceHash, sourcePage: item.sourcePage, page: item.sourcePage, sourceSymbol: item.sourceSymbol })),
    });
  }
  return { portDislocations, physicalPaperSignals, premiumMoves };
}

function shadowProjection(rows, control) {
  const minimum = Number(control?.minimum_publication_days || 10);
  const grouped = new Map();
  for (const row of rows || []) {
    const key = `${row.product_key}:${row.contract_month}:${row.unit}`;
    const list = grouped.get(key) || [];
    list.push({ publicationDate: row.publication_date, product: row.product_key, contractMonth: row.contract_month, unit: row.unit, legacyValue: 0, curveValue: number(row.mean_signed_variance), complete: Number(row.comparison_count) > 0 && number(row.mean_absolute_variance) != null && number(row.maximum_absolute_variance) != null, comparisonCount: Number(row.comparison_count || 0), meanSignedVariance: number(row.mean_signed_variance), meanAbsoluteVariance: number(row.mean_absolute_variance), maximumAbsoluteVariance: number(row.maximum_absolute_variance) });
    grouped.set(key, list);
  }
  const scopes = [...grouped.entries()].map(([scope, comparisons]) => {
    const sorted = comparisons.map((row) => row.publicationDate).sort();
    const expectedPublicationDays = [];
    if (sorted.length) {
      const cursor = new Date(`${sorted[0]}T00:00:00Z`);
      const end = sorted.at(-1);
      while (cursor.toISOString().slice(0, 10) <= end) {
        const date = cursor.toISOString().slice(0, 10);
        const session = comparisons[0].product === 'vlsfo' ? 'asia_moc' : 'london_moc';
        if (marketPublicationEligible(date, session) === true) expectedPublicationDays.push(date);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    const state = evaluateCurveShadow(comparisons, minimum, { expectedPublicationDays });
    const comparisonCount = comparisons.reduce((sum, row) => sum + row.comparisonCount, 0);
    const varianceComplete = comparisons.every((row) => row.meanSignedVariance != null && row.meanAbsoluteVariance != null && row.maximumAbsoluteVariance != null);
    const weighted = (field) => varianceComplete && comparisonCount ? comparisons.reduce((sum, row) => sum + Number(row[field]) * row.comparisonCount, 0) / comparisonCount : null;
    const identity = comparisons[0];
    return {
      scope,
      productKey: identity.product,
      contractMonth: isoMonth(identity.contractMonth),
      unit: identity.unit,
      assessmentSession: PRODUCT_SESSIONS[identity.product],
      reviewedThrough: sorted.at(-1) || null,
      ...state,
      comparisonCount,
      meanSignedVariance: weighted('meanSignedVariance'),
      meanAbsoluteVariance: weighted('meanAbsoluteVariance'),
      maximumAbsoluteVariance: varianceComplete && comparisons.length ? Math.max(...comparisons.map((row) => row.maximumAbsoluteVariance)) : null,
    };
  });
  return {
    status: scopes.length && scopes.every((row) => row.status === 'ready_for_variance_review') ? 'ready_for_variance_review' : 'shadowing',
    publicationDayCount: scopes.length ? Math.min(...scopes.map((row) => row.publicationDayCount)) : 0,
    minimumPublicationDays: minimum,
    comparisonCount: (rows || []).reduce((sum, row) => sum + Number(row.comparison_count || 0), 0),
    varianceMetricsAvailable: scopes.length > 0 && scopes.every((row) => row.meanSignedVariance != null && row.meanAbsoluteVariance != null && row.maximumAbsoluteVariance != null),
    cutoverApproved: control?.cutover_approved === true && Boolean(control?.reviewed_at),
    cutoverRevision: Number(control?.revision || 0),
    reviewedAt: control?.reviewed_at || null,
    scopes,
  };
}

function companyShadowProjection(observations, fallbacks, shadowRows, control, asOfDate) {
  const companySnapshot = applyActiveFallbacks(curveSnapshot(observations, asOfDate, PRODUCTS), fallbacks, asOfDate, PRODUCTS);
  const completeness = curveCompleteness(companySnapshot, PRODUCTS, asOfDate);
  const requiredScopes = requiredCurveShadowScopes({ asOfDate, snapshot: companySnapshot, sessionFreshness: completeness.sessionFreshness }, PRODUCTS);
  const requiredKeys = new Set(requiredScopes.map((scope) => `${scope.productKey}:${scope.contractMonth}-01:${scope.unit}`));
  return shadowProjection((shadowRows || []).filter((row) => requiredKeys.has(`${row.product_key}:${row.contract_month}:${row.unit}`)), control);
}

function curveCompleteness(snapshot, products, asOfDate) {
  const sessionFreshness = Object.fromEntries(products.map((product) => {
    const expectedPublicationDate = latestReviewedPublicationDate(asOfDate, PRODUCT_SESSIONS[product]);
    const latestObservationDate = snapshot.filter((row) => row.productKey === product && row.qualityStatus === 'verified').map((row) => row.reportDate).sort().at(-1) || null;
    return [product, {
      assessmentSession: PRODUCT_SESSIONS[product],
      expectedPublicationDate,
      latestObservationDate,
      state: !expectedPublicationDate ? 'calendar_unavailable' : latestObservationDate === expectedPublicationDate ? (expectedPublicationDate === asOfDate ? 'same_day' : 'current_prior_session') : 'stale',
    }];
  }));
  const missing = products.flatMap((product) => REQUIRED_CURVE_TENORS[product]
    .filter((tenor) => !snapshot.some((row) => row.productKey === product && row.tenor === tenor && row.reportDate === sessionFreshness[product].expectedPublicationDate))
    .map((tenor) => ({ product, tenor, expectedPublicationDate: sessionFreshness[product].expectedPublicationDate })));
  return { complete: missing.length === 0, missing, sessionFreshness };
}

export async function loadMarketIntelligenceCurve(client, request = {}) {
  const products = normalizeProducts(request.products);
  const range = RANGES[request.range] ? request.range : '3m';
  const asOfDate = isoDate(request.asOfDate || new Date());
  if (!asOfDate) throw intelligenceError('The market as-of date is invalid.', 400, 'MARKET_INTELLIGENCE_DATE_INVALID');
  const startDate = dateBefore(asOfDate, RANGES[range] - 1);
  const requestedMonths = request.contractMonths || (request.contractMonth ? [request.contractMonth] : []);
  const [rows, settlementEvidence] = await Promise.all([
    loadCurveRows(client, { startDate, endDate: asOfDate }),
    loadSettlementEvidence(client, asOfDate, requestedMonths),
  ]);
  const snapshot = applyActiveFallbacks(curveSnapshot(rows.observations, asOfDate, products), rows.fallbacks, asOfDate, products);
  const derived = historySignals(rows.observations, products);
  const physical = physicalMetrics(rows.observations, asOfDate, products);
  const physicalDates = [...new Set(rows.observations.filter((row) => products.includes(row.productKey)).map((row) => row.reportDate))];
  const premiumMoveHistory = physicalDates.flatMap((date) => physicalMetrics(rows.observations, date, products).premiumMoves);
  const fallbackRevisions = Object.fromEntries((rows.fallbacks || []).map((row) => [`${row.product_key}:${String(row.contract_month).slice(0, 7)}`, Number(row.revision || 0)]));
  const completeness = curveCompleteness(snapshot, products, asOfDate);
  const shadow = companyShadowProjection(rows.observations, rows.fallbacks, rows.shadowRows, rows.shadowControl, asOfDate);
  const projectedSettlements = projectedSettlementRows({
    asOfDate,
    products,
    snapshot,
    fallbacks: rows.fallbacks,
    actuals: settlementEvidence.actuals,
    verifications: settlementEvidence.verifications,
    shadow,
    requestedMonths,
  });
  return {
    available: true,
    asOfDate,
    range,
    products,
    complete: completeness.complete,
    snapshot,
    history: derived.history,
    signals: derived.signals,
    contexts: derived.contexts,
    outrightHistory: derived.outrightHistory,
    portDislocations: physical.portDislocations,
    physicalPaperSignals: physical.physicalPaperSignals,
    premiumMoves: physical.premiumMoves,
    premiumMoveHistory,
    warnings: completeness.missing.map(({ product, tenor, expectedPublicationDate }) => `${product.toUpperCase()} ${tenor} is missing from the expected ${expectedPublicationDate || 'reviewed-calendar'} report snapshot.`),
    sessionFreshness: completeness.sessionFreshness,
    fallbackRevision: null,
    fallbackRevisions,
    projectedSettlements,
    valuationMode: shadow.cutoverApproved ? 'platts_curve_active' : 'legacy_active_curve_shadow',
    shadow,
  };
}

export async function loadGovernedMarketValuation(client, request = {}) {
  const requestedProduct = request.productKey ? String(request.productKey).toLowerCase() : null;
  const requestedMonth = request.contractMonth ? isoMonth(request.contractMonth) : null;
  if ((request.productKey && !PRODUCTS.includes(requestedProduct)) || (request.contractMonth && !requestedMonth)) {
    throw intelligenceError('Choose a supported product and exact contract month.', 400, 'MARKET_VALUATION_SCOPE_INVALID');
  }
  const controlResult = await client.from('market_curve_shadow_control')
    .select('cutover_approved,reviewed_at,revision')
    .eq('id', 'company')
    .maybeSingle();
  if (controlResult.error) throw intelligenceError(`Curve cutover state could not be loaded: ${controlResult.error.message}`, 502, 'MARKET_CURVE_CUTOVER_LOAD_FAILED');
  if (controlResult.data?.cutover_approved !== true || !controlResult.data?.reviewed_at) {
    return {
      available: false,
      mode: 'legacy_active_curve_shadow',
      reason: 'curve_cutover_not_approved',
      asOfDate: isoDate(request.asOfDate || new Date()),
      settlements: [],
      shadow: {
        cutoverApproved: false,
        cutoverRevision: Number(controlResult.data?.revision || 0),
        reviewedAt: controlResult.data?.reviewed_at || null,
      },
    };
  }
  const curve = await loadMarketIntelligenceCurve(client, {
    ...request,
    range: '1w',
    products: requestedProduct ? [requestedProduct] : request.products,
    contractMonths: requestedMonth ? [requestedMonth] : request.contractMonths,
  });
  const settlements = curve.projectedSettlements.filter((row) => (!requestedProduct || row.productKey === requestedProduct)
    && (!requestedMonth || row.contractMonth === requestedMonth));
  const unavailable = settlements.filter((row) => !row.available);
  const valuationPoints = settlements.flatMap((row) => (row.points || []).map((point) => ({ ...point, productKey: row.productKey, contractMonth: row.contractMonth, unit: row.unit, period: row.period })));
  return {
    available: settlements.length > 0 && unavailable.length === 0,
    mode: 'platts_curve_active',
    reason: unavailable.length ? 'governed_settlement_unavailable' : null,
    asOfDate: curve.asOfDate,
    settlements,
    valuationPoints,
    unavailable: unavailable.map((row) => ({ productKey: row.productKey, contractMonth: row.contractMonth, reason: row.reason })),
    cutoverRevision: curve.shadow.cutoverRevision,
    reviewedAt: curve.shadow.reviewedAt,
  };
}

function rulesProjection(row = {}) {
  return {
    enabled: row.enabled ?? DEFAULT_RULES.enabled,
    outrightFloorUsdMt: number(row.outright_floor_usd_mt) ?? DEFAULT_RULES.outrightFloorUsdMt,
    spreadFloorUsdMt: number(row.spread_floor_usd_mt) ?? DEFAULT_RULES.spreadFloorUsdMt,
    gasoilFloorUsdBbl: number(row.gasoil_floor_usd_bbl) ?? DEFAULT_RULES.gasoilFloorUsdBbl,
    percentile: number(row.percentile) ?? DEFAULT_RULES.percentile,
    lookbackDays: Number(row.lookback_days || DEFAULT_RULES.lookbackDays),
    minimumSamples: Number(row.minimum_samples || DEFAULT_RULES.minimumSamples),
    curveDeadbandUsdMt: number(row.curve_deadband_usd_mt) ?? DEFAULT_RULES.curveDeadbandUsdMt,
    curveDeadbandUsdBbl: number(row.curve_deadband_usd_bbl) ?? DEFAULT_RULES.curveDeadbandUsdBbl,
  };
}

export async function getMarketIntelligenceAlertRules(client) {
  const [rulesResult, eventsResult] = await Promise.all([
    client.from('market_intelligence_alert_rules').select('*').eq('id', 'company').single(),
    client.from('market_intelligence_alert_events').select('id,report_date,alert_type,severity,title,message,created_at').order('created_at', { ascending: false }).limit(30),
  ]);
  const error = rulesResult.error || eventsResult.error;
  if (error) throw intelligenceError(`Market alert rules could not be loaded: ${error.message}`, 502, 'MARKET_ALERT_RULES_LOAD_FAILED');
  return { rules: rulesProjection(rulesResult.data), revision: Number(rulesResult.data?.revision || 0), events: eventsResult.data || [] };
}

function validatedRules(input = {}) {
  const rules = { ...DEFAULT_RULES, ...input };
  if (typeof rules.enabled !== 'boolean') throw intelligenceError('Alert enabled must be true or false.');
  for (const key of ['outrightFloorUsdMt', 'spreadFloorUsdMt', 'gasoilFloorUsdBbl', 'curveDeadbandUsdMt', 'curveDeadbandUsdBbl']) {
    if (number(rules[key]) == null || Number(rules[key]) < 0) throw intelligenceError(`${key} must be zero or greater.`);
    rules[key] = Number(rules[key]);
  }
  rules.percentile = Number(rules.percentile);
  rules.lookbackDays = Number(rules.lookbackDays);
  rules.minimumSamples = Number(rules.minimumSamples);
  if (rules.percentile < 0.5 || rules.percentile > 1) throw intelligenceError('Percentile must be expressed as a decimal from 0.5 to 1.');
  if (!Number.isInteger(rules.lookbackDays) || rules.lookbackDays < 20 || rules.lookbackDays > 366) throw intelligenceError('Alert lookback must be between 20 and 366 days.');
  if (!Number.isInteger(rules.minimumSamples) || rules.minimumSamples < 5 || rules.minimumSamples > 500) throw intelligenceError('Minimum samples must be between 5 and 500.');
  return rules;
}

export async function saveMarketIntelligenceAlertRules(client, profile, payload = {}) {
  const rules = validatedRules(payload.rules);
  const expectedRevision = Number(payload.expectedRevision);
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw intelligenceError('The current alert-rule revision is required.', 409, 'MARKET_ALERT_RULES_STALE');
  if (idempotencyKey.length < 16) throw intelligenceError('A valid idempotency key is required.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  const requestHash = hash({ rules, expectedRevision });
  const result = await client.rpc('save_market_intelligence_alert_rules', {
    p_expected_revision: expectedRevision,
    p_settings: rules,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  });
  if (result.error) throw intelligenceError(`Market alert rules could not be saved: ${result.error.message}`, /STALE/.test(result.error.message || '') ? 409 : 502, /STALE/.test(result.error.message || '') ? 'MARKET_ALERT_RULES_STALE' : 'MARKET_ALERT_RULES_SAVE_FAILED');
  return { rules: rulesProjection(result.data), revision: Number(result.data?.revision || expectedRevision + 1), events: [], replayed: result.data?.replayed === true };
}

function requiredCurveShadowScopes(curve, products = PRODUCTS) {
  const scopes = [];
  for (const productKey of products) for (const tenor of REQUIRED_CURVE_TENORS[productKey]) {
    const expectedPublicationDate = curve.sessionFreshness?.[productKey]?.expectedPublicationDate
      || latestReviewedPublicationDate(curve.asOfDate, PRODUCT_SESSIONS[productKey]);
    const row = (curve.snapshot || []).find((candidate) => candidate.productKey === productKey
      && candidate.tenor === tenor
      && candidate.qualityStatus === 'verified'
      && candidate.reportDate === expectedPublicationDate
      && candidate.marketFamily === 'forward'
      && candidate.settlementBasis === 'outright'
      && candidate.unit === PRODUCT_UNITS[productKey]);
    if (!row || !isoMonth(row.contractMonth)) return [];
    scopes.push({
      productKey,
      contractMonth: isoMonth(row.contractMonth),
      unit: PRODUCT_UNITS[productKey],
      assessmentSession: PRODUCT_SESSIONS[productKey],
      reviewedThrough: row.reportDate,
    });
  }
  return scopes.sort((left, right) => `${left.productKey}:${left.contractMonth}`.localeCompare(`${right.productKey}:${right.contractMonth}`));
}

export async function saveMarketCurveShadowCutover(client, profile, payload = {}) {
  const approved = payload.approved === true;
  const expectedRevision = Number(payload.expectedRevision);
  const reason = String(payload.reason || '').trim();
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw intelligenceError('The current curve cutover revision is required.', 409, 'MARKET_CURVE_CUTOVER_STALE');
  if (reason.length < 8 || reason.length > 1000) throw intelligenceError('A concise variance-review reason is required.');
  if (idempotencyKey.length < 16) throw intelligenceError('A valid idempotency key is required.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  const curve = await loadMarketIntelligenceCurve(client, { range: '1m', products: PRODUCTS });
  const requiredScopes = requiredCurveShadowScopes(curve);
  const requiredScopeCount = Object.values(REQUIRED_CURVE_TENORS).reduce((sum, tenors) => sum + tenors.length, 0);
  if (approved && (!curve.complete || requiredScopes.length !== requiredScopeCount)) throw intelligenceError('Every latest required product and contract month must have a verified exact outright before cutover.', 409, 'MARKET_CURVE_SHADOW_INCOMPLETE');
  const request = { approved, expectedRevision, reviewHash: hash(reason), requiredScopes };
  const result = await client.rpc('save_market_curve_shadow_cutover', {
    p_expected_revision: expectedRevision,
    p_approved: approved,
    p_review_hash: request.reviewHash,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_idempotency_key: idempotencyKey,
    p_request_hash: hash(request),
    p_required_scopes: requiredScopes.map((scope) => ({
      product_key: scope.productKey,
      contract_month: scope.contractMonth,
      unit: scope.unit,
      assessment_session: scope.assessmentSession,
      reviewed_through: scope.reviewedThrough,
    })),
  });
  if (result.error) throw intelligenceError(`Curve cutover review could not be saved: ${result.error.message}`, /STALE|INCOMPLETE/.test(result.error.message || '') ? 409 : 502, /STALE/.test(result.error.message || '') ? 'MARKET_CURVE_CUTOVER_STALE' : /INCOMPLETE/.test(result.error.message || '') ? 'MARKET_CURVE_SHADOW_INCOMPLETE' : 'MARKET_CURVE_CUTOVER_SAVE_FAILED');
  return { approved: result.data?.cutover_approved === true, revision: Number(result.data?.revision || expectedRevision + 1), reviewedAt: result.data?.reviewed_at || null, replayed: result.data?.replayed === true };
}

export async function saveMarketForwardFallback(client, profile, payload = {}) {
  const productKey = String(payload.productKey || '').toLowerCase();
  const contractMonth = isoMonth(payload.contractMonth);
  const unit = String(payload.unit || '').toUpperCase();
  const outrightValue = number(payload.outrightValue);
  const asOfDate = isoDate(payload.asOfDate);
  const sourceNote = String(payload.sourceNote || '').trim();
  const reason = String(payload.reason || '').trim();
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  const expectedRevision = payload.expectedRevision == null ? null : Number(payload.expectedRevision);
  if (!PRODUCTS.includes(productKey) || PRODUCT_UNITS[productKey] !== unit || !contractMonth || !asOfDate || outrightValue == null || outrightValue <= 0) throw intelligenceError('Enter a supported product, exact contract month, unit, and positive outright value.');
  if (contractMonth < asOfDate.slice(0, 7)) throw intelligenceError('A manual fallback cannot change a closed contract month.', 409, 'MARKET_FALLBACK_CLOSED_MONTH');
  if (sourceNote.length < 3 || sourceNote.length > 500 || reason.length < 3 || reason.length > 1000) throw intelligenceError('A concise source note and mandatory reason are required.');
  if (idempotencyKey.length < 16) throw intelligenceError('A valid idempotency key is required.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  const session = productKey === 'vlsfo' ? 'asia_moc' : 'london_moc';
  const nextPublicationDate = nextMarketPublicationDate(asOfDate, session);
  const nextContractRollDate = nextMarketPublicationDate(asOfDate, session, { afterMonthBoundary: true });
  if (!nextPublicationDate || !nextContractRollDate) throw intelligenceError('No approved publication calendar is configured for this fallback date.', 409, 'MARKET_PUBLICATION_CALENDAR_UNAVAILABLE');
  const expiry = manualFallbackExpiry({ asOfDate, contractMonth }, { nextPublicationDate, nextContractRollDate, today: asOfDate });
  if (!expiry.expiresOn) throw intelligenceError('The fallback expiry could not be resolved.', 409, 'MARKET_FALLBACK_EXPIRY_UNAVAILABLE');
  const currentCurve = await loadMarketIntelligenceCurve(client, { asOfDate, products: [productKey], range: '1m' });
  if (currentCurve.snapshot.some((row) => row.qualityStatus === 'verified' && String(row.contractMonth).slice(0, 7) === contractMonth)) {
    throw intelligenceError('A verified exact-contract outright already exists in the latest report snapshot.', 409, 'MARKET_FALLBACK_VERIFIED_OUTRIGHT_EXISTS');
  }
  const request = { productKey, contractMonth: `${contractMonth}-01`, unit, outrightValue, asOfDate, sourceNote, reasonHash: hash(reason), expiresOn: expiry.expiresOn, expectedRevision };
  const requestHash = hash(request);
  const result = await client.rpc('save_market_forward_fallback', {
    p_idempotency_key: idempotencyKey,
    p_product_key: productKey,
    p_contract_month: `${contractMonth}-01`,
    p_unit: unit,
    p_outright_value: outrightValue,
    p_as_of_date: asOfDate,
    p_source_note: sourceNote,
    p_reason_hash: request.reasonHash,
    p_expires_on: expiry.expiresOn,
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_request_hash: requestHash,
  });
  if (result.error) throw intelligenceError(`The forward fallback could not be saved: ${result.error.message}`, /STALE|CONFLICT/.test(result.error.message || '') ? 409 : 502, /STALE/.test(result.error.message || '') ? 'MARKET_FALLBACK_STALE' : 'MARKET_FALLBACK_SAVE_FAILED');
  return { fallback: { ...result.data, productKey, contractMonth: `${contractMonth}-01`, unit, outrightValue, asOfDate, expiresOn: result.data?.expiresOn || expiry.expiresOn }, curve: await loadMarketIntelligenceCurve(client, { asOfDate, products: [productKey], range: '3m' }) };
}

function itemProjection(row) {
  return {
    kind: row.item_kind,
    title: row.title,
    summary: row.summary,
    driverTags: row.driver_tags || [],
    direction: row.direction,
    confidence: number(row.confidence),
    productKey: row.product_key,
    portKey: row.port_key,
    horizon: row.horizon,
    sourceRefs: row.source_refs || [],
    numericFacts: row.numeric_facts || [],
  };
}

function latestBriefsByReportDate(rows = [], limit = 3) {
  const latest = [];
  const seenDates = new Set();
  for (const row of rows || []) {
    if (!row?.report_date || seenDates.has(row.report_date)) continue;
    seenDates.add(row.report_date);
    latest.push(row);
    if (latest.length === limit) break;
  }
  return latest;
}

async function briefAtOrBefore(client, date) {
  const result = await client.from('market_intelligence_briefs')
    .select('*')
    .lte('report_date', date)
    .order('report_date', { ascending: false })
    .order('revision', { ascending: false })
    .limit(1);
  if (result.error) throw intelligenceError(`Market brief could not be loaded: ${result.error.message}`, 502, 'MARKET_BRIEF_LOAD_FAILED');
  return result.data?.[0] || null;
}

async function adjacentBriefDate(client, date, direction, upperBound) {
  let query = client.from('market_intelligence_briefs').select('report_date,revision');
  if (direction === 'previous') {
    query = query.lt('report_date', date).order('report_date', { ascending: false });
  } else {
    query = query.gt('report_date', date).lte('report_date', upperBound).order('report_date', { ascending: true });
  }
  const result = await query.order('revision', { ascending: false }).limit(1);
  if (result.error) throw intelligenceError(`Market brief navigation could not be loaded: ${result.error.message}`, 502, 'MARKET_BRIEF_LOAD_FAILED');
  return result.data?.[0]?.report_date || null;
}

async function curveAvailabilityForBrief(client, brief, curve) {
  const reportIds = (brief.source_refs || []).map((row) => row.reportId).filter(Boolean);
  const [seriesResult, availabilityResult] = await Promise.all([
    client.from('market_intelligence_series').select('id,product_key,source_symbol,tenor,unit,assessment_session,market_family,basis_metadata').eq('active', true),
    reportIds.length
      ? client.from('market_report_series_availability').select('import_id,series_id,availability_status,source_page,contract_month,printed_contract_month,tenor,observation_unit,assessment_session,basis_metadata').in('import_id', reportIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = seriesResult.error || availabilityResult.error;
  if (error) throw intelligenceError(`Market curve availability could not be loaded: ${error.message}`, 502, 'MARKET_BRIEF_LOAD_FAILED');
  const seriesById = new Map((seriesResult.data || []).map((row) => [row.id, row]));
  const reportById = new Map((brief.source_refs || []).map((row) => [row.reportId, row]));
  const exactRows = (curve.snapshot || []).filter((row) => row.reportDate === brief.report_date && row.qualityStatus === 'verified');
  const availabilityByKey = new Map();
  for (const row of availabilityResult.data || []) {
    const series = seriesById.get(row.series_id);
    const productKey = seriesProduct(series, { basis_metadata: row.basis_metadata });
    const tenor = String(row.tenor || series?.tenor || '').toUpperCase();
    if (seriesMarketFamily(series, row) !== 'forward'
      || !productKey
      || !REQUIRED_CURVE_TENORS[productKey]?.includes(tenor)) continue;
    const key = `${productKey}:${tenor}`;
    const current = availabilityByKey.get(key);
    if (!current || row.availability_status === 'published_na') {
      availabilityByKey.set(key, {
        productKey,
        tenor,
        status: row.availability_status,
        sourceSymbol: series?.source_symbol || null,
        sourcePage: row.source_page,
        contractMonth: row.contract_month,
        unit: row.observation_unit || series?.unit || PRODUCT_UNITS[productKey],
        documentType: reportById.get(row.import_id)?.documentType || null,
      });
    }
  }
  const marks = PRODUCTS.flatMap((productKey) => REQUIRED_CURVE_TENORS[productKey].map((tenor) => {
    const numeric = exactRows.find((row) => row.productKey === productKey && row.tenor === tenor);
    if (numeric) return {
      productKey, tenor, status: 'numeric', value: numeric.value, unit: numeric.unit,
      sourceSymbol: numeric.sourceSymbol, sourcePage: numeric.sourcePage,
      contractMonth: numeric.contractMonth, documentType: numeric.source,
    };
    return availabilityByKey.get(`${productKey}:${tenor}`) || {
      productKey, tenor, status: 'not_detected', value: null, unit: PRODUCT_UNITS[productKey],
      sourceSymbol: null, sourcePage: null, contractMonth: null, documentType: null,
    };
  }));
  const numericCount = marks.filter((row) => row.status === 'numeric').length;
  const publishedNaCount = marks.filter((row) => row.status === 'published_na').length;
  const missingCount = marks.length - numericCount - publishedNaCount;
  return {
    requiredCount: marks.length,
    numericCount,
    publishedNaCount,
    missingCount,
    complete: missingCount === 0,
    marks,
  };
}

function isLegacyCurveMissingWarning(value) {
  const text = typeof value === 'string' ? value : value?.summary;
  return / is missing from the expected .* report snapshot\.$/i.test(String(text || ''));
}

function availabilityWarning(row) {
  const label = `${row.productKey.toUpperCase()} ${row.tenor}`;
  if (row.status === 'published_na') return `${label} was published N/A${row.documentType === 'european_marketscan' ? ' in European Marketscan' : ''}${row.sourcePage ? ` page ${row.sourcePage}` : ''}.`;
  return `${label} was not detected in the completed report pair.`;
}

function uniqueBriefWarnings(curveCoverage, storedWarnings = []) {
  const authoritative = curveCoverage.marks
    .filter((row) => row.status === 'published_na' || row.status === 'not_detected')
    .map(availabilityWarning);
  const retained = (storedWarnings || []).filter((warning) => !isLegacyCurveMissingWarning(warning)
    && !/ was (?:published N\/A|not detected in the completed report pair)/i.test(String(warning)));
  return [...new Set([...authoritative, ...retained])];
}

export async function loadMarketIntelligenceBrief(client, request = {}) {
  const today = isoDate(new Date());
  const requestedDate = request.date == null || request.date === '' ? today : isoDate(request.date);
  if (!requestedDate) throw intelligenceError('The requested market brief date is invalid.', 400, 'MARKET_INTELLIGENCE_DATE_INVALID');
  const requestedBoundary = requestedDate > today ? today : requestedDate;
  const [brief, latestBrief] = await Promise.all([
    briefAtOrBefore(client, requestedBoundary),
    briefAtOrBefore(client, today),
  ]);
  if (!brief) return {
    available: false,
    requestedDate,
    displayedDate: null,
    latestAvailableDate: latestBrief?.report_date || null,
    previousAvailableDate: null,
    nextAvailableDate: null,
    fallbackApplied: false,
    asOfDate: null,
    completeness: { complete: false, completeReports: 0, requiredReports: 2 },
    reportCompleteness: { complete: false, completeReports: 0, requiredReports: 2 },
    curveCoverage: { requiredCount: 8, numericCount: 0, publishedNaCount: 0, missingCount: 8, complete: false, marks: [] },
    curveRegimes: [], materialChanges: [], portDislocations: [], physicalPaperSignals: [], drivers: [], risks: [],
    warnings: ['No completed Bunkerwire and European Marketscan report pair is available.'],
    shadow: { status: 'shadowing', cutoverApproved: false },
  };
  const [itemsResult, curve, recentBriefsResult, previousAvailableDate, nextAvailableDate] = await Promise.all([
    client.from('market_intelligence_brief_items').select('*').eq('brief_id', brief.id).order('item_order'),
    loadMarketIntelligenceCurve(client, { asOfDate: brief.report_date, range: '3m' }),
    client.from('market_intelligence_briefs').select('id,report_date,revision').lt('report_date', brief.report_date).order('report_date', { ascending: false }).order('revision', { ascending: false }).limit(20),
    adjacentBriefDate(client, brief.report_date, 'previous', today),
    adjacentBriefDate(client, brief.report_date, 'next', today),
  ]);
  if (itemsResult.error || recentBriefsResult.error) throw intelligenceError(`Market brief items could not be loaded: ${(itemsResult.error || recentBriefsResult.error).message}`, 502, 'MARKET_BRIEF_LOAD_FAILED');
  const curveCoverage = await curveAvailabilityForBrief(client, brief, curve);
  const items = (itemsResult.data || []).map(itemProjection);
  const byKind = (kind) => items.filter((row) => row.kind === kind);
  const metrics = brief.deterministic_metrics || {};
  const aiDrivers = byKind('driver');
  const recentBriefs = latestBriefsByReportDate(recentBriefsResult.data || [], 3);
  const recentIds = recentBriefs.map((row) => row.id);
  let historicalDriverRows = [];
  if (recentIds.length) {
    const historyResult = await client.from('market_intelligence_brief_items').select('brief_id,title,driver_tags,direction,product_key,port_key,horizon,source_refs').in('brief_id', recentIds).eq('item_kind', 'driver');
    if (!historyResult.error) historicalDriverRows = historyResult.data || [];
  }
  const driverSignatures = (row) => (row.driverTags || row.driver_tags || []).map((tag) => `${tag}|${row.productKey || row.product_key || ''}|${row.portKey || row.port_key || ''}|${row.horizon || ''}|${row.direction || ''}`);
  const priorBriefsBySignature = new Map();
  for (const row of historicalDriverRows) for (const signature of driverSignatures(row)) {
    const existing = priorBriefsBySignature.get(signature) || { ids: new Set(), row };
    const ids = existing.ids;
    ids.add(row.brief_id);
    priorBriefsBySignature.set(signature, { ids, row });
  }
  const currentSignatures = new Set(aiDrivers.flatMap(driverSignatures));
  const consecutivePriorIds = recentIds.slice(0, 2);
  const wasConsecutive = (signature) => consecutivePriorIds.length === 2
    && consecutivePriorIds.every((briefId) => priorBriefsBySignature.get(signature)?.ids.has(briefId));
  const persistent = aiDrivers.filter((row) => driverSignatures(row).some(wasConsecutive));
  const emerging = aiDrivers.filter((row) => !persistent.includes(row));
  const fading = [...priorBriefsBySignature.entries()]
    .filter(([signature]) => wasConsecutive(signature) && !currentSignatures.has(signature))
    .map(([signature, value]) => {
      const tag = signature.split('|')[0];
      return { kind: 'driver', title: `${tag.replaceAll('_', ' ')} fading`, summary: 'This previously persistent validated driver was not present in the latest complete paired report.', driverTags: [tag], direction: value.row.direction || 'unclear', confidence: 1, productKey: value.row.product_key || null, portKey: value.row.port_key || null, horizon: value.row.horizon || 'unclear', sourceRefs: value.row.source_refs || [] };
    });
  return {
    available: true,
    requestedDate,
    displayedDate: brief.report_date,
    latestAvailableDate: latestBrief?.report_date || brief.report_date,
    previousAvailableDate,
    nextAvailableDate,
    fallbackApplied: requestedDate !== brief.report_date,
    fallbackMessage: requestedDate !== brief.report_date
      ? `Reports for the requested date are not available. Showing the latest completed report: ${brief.report_date}.`
      : null,
    asOfDate: brief.report_date,
    asOfAt: brief.as_of_at,
    completeness: brief.completeness,
    reportCompleteness: {
      complete: Number(brief.completeness?.completeReports || 0) >= Number(brief.completeness?.requiredReports || 2),
      completeReports: Number(brief.completeness?.completeReports || 0),
      requiredReports: Number(brief.completeness?.requiredReports || 2),
      reportTypes: brief.completeness?.reportTypes || [],
    },
    curveCoverage,
    curveRegimes: metrics.curveRegimes || byKind('curve_regime'),
    materialChanges: metrics.materialChanges || byKind('material_change'),
    portDislocations: metrics.portDislocations || byKind('port_dislocation'),
    physicalPaperSignals: metrics.physicalPaperSignals || byKind('physical_paper'),
    drivers: { emerging, persistent, fading },
    risks: [...(metrics.risks || []), ...byKind('risk')].filter((row) => !isLegacyCurveMissingWarning(row)),
    warnings: uniqueBriefWarnings(curveCoverage, metrics.warnings || byKind('data_quality').map((row) => row.summary)),
    sourceRefs: brief.source_refs || [],
    shadow: curve.shadow,
  };
}

function companyNamesInText(text) {
  const source = String(text || '');
  const allCaps = source.match(/\b(?:[A-Z][A-Z&.'-]*\s+){1,6}(?:LTD|LIMITED|PTE|LLC|INC|CORP|CORPORATION|TRADING)\b/g) || [];
  const properCase = source.match(/\b(?:[A-Z][A-Za-z&.'-]*\s+){1,6}(?:Ltd|Limited|Pte|LLC|Inc|Corp|Corporation|Trading)\b/g) || [];
  return [...new Set([...allCaps, ...properCase])];
}

function normalizedSourceText(contexts = []) {
  const driverTerms = /availab|inventor|demand|lead time|congestion|weather|refiner|outage|arbitrage|freight|sanction|regulat|geopolit|supply|flow/i;
  const participantSection = /market on close|moc participants?|bids? and offers?|trades? heard/i;
  const pages = [];
  let remaining = 24_000;
  for (const context of contexts) for (const page of context.pages || context.commentaryContext || []) {
    if (remaining <= 0) break;
    const fullSource = String(page.text || '').replace(/\s+/g, ' ').trim();
    const participantIndex = fullSource.search(participantSection);
    const source = participantIndex >= 0 ? fullSource.slice(0, participantIndex).trim() : fullSource;
    if (!source) continue;
    const sentences = source.split(/(?<=[.!?])\s+/).filter((sentence) => driverTerms.test(sentence) && !participantSection.test(sentence) && companyNamesInText(sentence).length === 0);
    if (!sentences.length) continue;
    const selected = [];
    let pageCharacters = 0;
    for (const sentence of sentences) {
      if (sentence.length > 1800 || pageCharacters + sentence.length > 6000 || sentence.length > remaining) continue;
      selected.push(sentence);
      pageCharacters += sentence.length + 1;
      remaining -= sentence.length + 1;
    }
    if (selected.length) pages.push({ reportId: context.reportId || null, sourceHash: context.sourceHash, page: Number(page.page), text: selected.join(' ') });
  }
  return pages;
}

function participantNamesFromContexts(contexts = []) {
  return [...new Set((contexts || []).flatMap((context) => (context.pages || context.commentaryContext || []).flatMap((page) => companyNamesInText(page.text))).map((name) => name.toLowerCase()))];
}

function containsLongVerbatim(summary, sourceText) {
  const words = String(summary || '').toLowerCase().match(/[a-z0-9%.-]+/g) || [];
  const normalizedSource = (String(sourceText || '').toLowerCase().match(/[a-z0-9%.-]+/g) || []).join(' ');
  for (let index = 0; index <= words.length - 8; index += 1) if (normalizedSource.includes(words.slice(index, index + 8).join(' '))) return true;
  return false;
}

function normalizedObservationEvidence(rows = []) {
  return (rows || []).map((row) => ({
    sourceHash: String(row.sourceHash || row.source_hash || '').toLowerCase(),
    page: Number(row.page ?? row.sourcePage ?? row.source_page),
    symbol: String(row.symbol || row.sourceSymbol || row.source_symbol || '').toUpperCase(),
    value: number(row.value ?? row.price),
  })).filter((row) => /^[a-f0-9]{64}$/.test(row.sourceHash)
    && Number.isInteger(row.page) && row.page > 0
    && /^[A-Z0-9]{5,12}$/.test(row.symbol)
    && row.value != null);
}

function factHasEvidence(fact, pages, observationEvidence = []) {
  const page = pages.find((row) => row.sourceHash === fact.sourceHash && row.page === Number(fact.page));
  const expected = Number(String(fact.value || '').replace(/%$/, ''));
  const symbol = String(fact.symbol || '').toUpperCase();
  if (!page || !Number.isFinite(expected) || !/^[A-Z0-9]{5,12}$/.test(symbol)) return false;
  return normalizedObservationEvidence(observationEvidence).some((row) => row.sourceHash === fact.sourceHash
    && row.page === Number(fact.page)
    && row.symbol === symbol
    && row.value === expected);
}

function narrativeNumericValues(text) {
  const matches = String(text || '').matchAll(/(?<![A-Za-z0-9.])(?:[$€£]\s*)?([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*%|\s*\/\s*[A-Za-z]+)?(?![A-Za-z0-9]|\.\d)/g);
  return [...matches].map((match) => Number(match[1].replaceAll(',', ''))).filter(Number.isFinite);
}

function validateAiItems(items, pages, observationEvidence = [], prohibitedParticipantNames = []) {
  const sourceText = pages.map((row) => String(row.text || '').replace(/\s+/g, ' ')).join(' ').toLowerCase();
  const participantNames = [...new Set([
    ...prohibitedParticipantNames.map((name) => String(name).toLowerCase()),
    ...pages.flatMap((row) => companyNamesInText(row.text)).map((name) => name.toLowerCase()),
  ])];
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!['driver', 'risk'].includes(item?.kind) || typeof item?.title !== 'string' || typeof item?.summary !== 'string') return false;
    if (containsLongVerbatim(`${item.title} ${item.summary}`, sourceText)) return false;
    if (participantNames.some((name) => `${item.title} ${item.summary}`.toLowerCase().includes(name))) return false;
    if (!(item.driverTags || []).every((tag) => DRIVER_TAGS.has(tag))) return false;
    if (!(item.sourceRefs || []).length || !(item.sourceRefs || []).every((ref) => pages.some((page) => page.sourceHash === ref.sourceHash && page.page === Number(ref.page)))) return false;
    if (!(item.numericFacts || []).every((fact) => factHasEvidence(fact, pages, observationEvidence))) return false;
    const numericTokens = narrativeNumericValues(`${item.title} ${item.summary}`);
    const factValues = new Set((item.numericFacts || []).map((fact) => Number(String(fact.value).replaceAll(',', '').replace(/%$/, ''))).filter(Number.isFinite));
    return numericTokens.every((token) => factValues.has(token));
  }).map((item) => ({
    kind: item.kind,
    title: item.title.slice(0, 160),
    summary: item.summary.slice(0, 1200),
    driverTags: item.driverTags || [],
    direction: ['supportive', 'bearish', 'mixed', 'neutral', 'unclear'].includes(item.direction) ? item.direction : 'unclear',
    confidence: Math.min(1, Math.max(0, number(item.confidence) ?? 0)),
    productKey: PRODUCTS.includes(item.productKey) ? item.productKey : null,
    portKey: PORT_KEYS.has(item.portKey) ? item.portKey : null,
    horizon: HORIZONS.has(item.horizon) ? item.horizon : 'unclear',
    sourceRefs: (item.sourceRefs || []).map((ref) => ({ sourceHash: String(ref.sourceHash || '').toLowerCase(), page: Number(ref.page) })).filter((ref) => /^[a-f0-9]{64}$/.test(ref.sourceHash) && Number.isInteger(ref.page) && pages.some((page) => page.sourceHash === ref.sourceHash && page.page === ref.page)),
    numericFacts: (item.numericFacts || []).map((fact) => ({ sourceHash: String(fact.sourceHash || '').toLowerCase(), page: Number(fact.page), value: String(fact.value || '').slice(0, 40), symbol: String(fact.symbol || '').toUpperCase() })).filter((fact) => factHasEvidence(fact, pages, observationEvidence)),
  }));
}

export async function generateMarketCommentaryItems(contexts = [], dependencies = {}) {
  const pages = normalizedSourceText(contexts);
  const observationEvidence = normalizedObservationEvidence(dependencies.observationEvidence);
  const prohibitedParticipantNames = participantNamesFromContexts(contexts);
  const apiKey = String(dependencies.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || !pages.length) return { status: 'unavailable', modelId: null, items: [] };
  const model = String(dependencies.model || process.env.OPENAI_MARKET_INTELLIGENCE_MODEL || 'gpt-5-mini');
  try {
    const itemProperties = {
      kind: { type: 'string', enum: ['driver', 'risk'] },
      title: { type: 'string' },
      summary: { type: 'string' },
      driverTags: { type: 'array', items: { type: 'string', enum: [...DRIVER_TAGS] } },
      direction: { type: 'string', enum: ['supportive', 'bearish', 'mixed', 'neutral', 'unclear'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      productKey: { type: ['string', 'null'] },
      portKey: { type: ['string', 'null'] },
      horizon: { type: ['string', 'null'] },
      sourceRefs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceHash', 'page'], properties: { sourceHash: { type: 'string' }, page: { type: 'integer', minimum: 1 } } } },
      numericFacts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceHash', 'page', 'value', 'symbol'], properties: { sourceHash: { type: 'string' }, page: { type: 'integer', minimum: 1 }, value: { type: 'string' }, symbol: { type: 'string' } } } },
    };
    const response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 3500,
        input: [{ role: 'system', content: 'Return JSON only. Paraphrase bunker-market drivers and risks. Never quote, recommend trades, name market participants, or invent numbers. Every number needs an exact deterministic sourceHash, page, symbol, and value observation.' }, { role: 'user', content: JSON.stringify({ pages: pages.map((row) => ({ sourceHash: row.sourceHash, page: row.page, text: row.text })), observations: observationEvidence }) }],
        text: {
          format: {
            type: 'json_schema',
            name: 'market_brief_items',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['items'],
              properties: {
                items: {
                  type: 'array',
                  maxItems: 20,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: Object.keys(itemProperties),
                    properties: itemProperties,
                  },
                },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) return { status: 'failed', modelId: model, items: [] };
    const data = await response.json();
    const text = data.output_text || data.output?.flatMap((row) => row.content || []).find((row) => row.type === 'output_text')?.text;
    const items = validateAiItems(JSON.parse(text || '{}').items, pages, observationEvidence, prohibitedParticipantNames);
    return { status: items.length ? 'completed' : 'invalid', modelId: model, items };
  } catch {
    return { status: 'failed', modelId: model, items: [] };
  }
}

function deterministicBriefMetrics(curve) {
  const latest = new Map();
  for (const row of (curve.history || []).filter((item) => item.date <= curve.asOfDate)) latest.set(row.productKey, row);
  const curveRegimes = PRODUCTS.map((productKey) => {
    const row = latest.get(productKey);
    if (!row) return { productKey, regime: 'unavailable', bmM1: null, m1M2: null, headlineSlope: null, unit: PRODUCT_UNITS[productKey], reportDate: null, freshness: 'missing', sourceRefs: [] };
    const freshness = curve.sessionFreshness?.[productKey];
    if (!freshness?.expectedPublicationDate || row.date !== freshness.expectedPublicationDate) return { productKey, regime: 'unavailable', priorRegime: row.regime, bmM1: null, m1M2: null, headlineSlope: null, unit: row.unit, reportDate: row.date, freshness: 'stale', sourceRefs: row.sourceRefs || [] };
    return { productKey, regime: row.regime, bmM1: row.bmM1, m1M2: row.m1M2, headlineSlope: row.headlineSlope, unit: row.unit, reportDate: row.date, freshness: freshness.state, sourceRefs: row.sourceRefs || [] };
  });
  const materialChanges = (curve.snapshot || []).filter((row) => row.reportDate === curve.asOfDate && row.dayChange != null && Math.abs(row.dayChange) >= (row.unit === 'USD/BBL' ? 1 : 10)).map((row) => ({ productKey: row.productKey, tenor: row.tenor, contractMonth: row.contractMonth, change: row.dayChange, unit: row.unit, sourceSymbol: row.sourceSymbol, sourceRefs: [{ reportId: row.reportId, reportDate: row.reportDate, seriesId: row.seriesId, sourceHash: row.sourceHash, sourcePage: row.sourcePage, page: row.sourcePage, sourceSymbol: row.sourceSymbol }] }));
  return { curveRegimes, materialChanges, portDislocations: curve.portDislocations || [], physicalPaperSignals: curve.physicalPaperSignals || [], risks: curve.warnings.map((summary) => ({ title: 'Data quality', summary })), warnings: curve.warnings };
}

function deterministicBriefItems(metrics) {
  return [
    ...metrics.curveRegimes.map((row) => ({ kind: 'curve_regime', title: `${row.productKey.toUpperCase()} curve`, summary: `${row.regime} based on the exact same eligible report snapshot.`, driverTags: [], direction: 'neutral', confidence: 1, productKey: row.productKey, portKey: null, horizon: 'prompt', sourceRefs: row.sourceRefs || [], numericFacts: [] })),
    ...metrics.materialChanges.map((row) => ({ kind: 'material_change', title: `${row.productKey.toUpperCase()} ${row.tenor} daily move`, summary: `The verified outright moved materially in ${row.unit}.`, driverTags: [], direction: row.change > 0 ? 'supportive' : 'bearish', confidence: 1, productKey: row.productKey, portKey: null, horizon: 'intraday', sourceRefs: row.sourceRefs || [], numericFacts: [] })),
    ...metrics.portDislocations.map((row) => ({ kind: 'port_dislocation', title: `${row.productKey.toUpperCase()} assessed-port dispersion`, summary: `Same-date assessed ports show a material ${row.unit} dispersion.`, driverTags: [], direction: 'mixed', confidence: 1, productKey: row.productKey, portKey: null, horizon: 'intraday', sourceRefs: row.sourceRefs || [], numericFacts: [] })),
    ...metrics.physicalPaperSignals.filter((row) => row.state !== 'unavailable').map((row) => ({ kind: 'physical_paper', title: `${row.productKey.toUpperCase()} physical versus paper`, summary: `Same-date physical and paper moves are ${row.state}.`, driverTags: [], direction: row.state === 'confirmed' ? 'neutral' : row.state === 'divergent' ? 'mixed' : 'unclear', confidence: 1, productKey: row.productKey, portKey: null, horizon: 'intraday', sourceRefs: row.sourceRefs || [], numericFacts: [] })),
    ...metrics.risks.map((row) => ({ kind: 'data_quality', title: row.title, summary: row.summary, driverTags: [], direction: 'unclear', confidence: 1, productKey: null, portKey: null, horizon: 'unclear', sourceRefs: [], numericFacts: [] })),
  ];
}

function configuredAlertThreshold(history, floor, minimumSamples, percentile) {
  const values = (history || []).map((value) => Math.abs(Number(value))).filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length < minimumSamples) return Number(floor);
  return Math.max(Number(floor), values[Math.max(0, Math.ceil(values.length * percentile) - 1)]);
}

async function publishAlert(client, payload) {
  const result = await client.rpc('publish_market_intelligence_alert', payload);
  if (result.error) throw intelligenceError(`Market alert could not be stored: ${result.error.message}`, 502, 'MARKET_ALERT_SAVE_FAILED');
  return result.data?.created === true;
}

export async function publishMarketDataQualityAlert(client, { reportDate = null, reportId = null, seriesId = null, code, title, message, severity = 'warning', evidence = {} } = {}) {
  const rules = await getMarketIntelligenceAlertRules(client);
  const dedupeKey = hash({ reportId, seriesId, reportDate, code, severity, ruleVersion: rules.revision }).slice(0, 64);
  const created = await publishAlert(client, {
    p_dedupe_key: dedupeKey,
    p_report_id: reportId,
    p_report_date: reportDate,
    p_series_id: seriesId,
    p_rule_version: rules.revision,
    p_alert_type: String(code || 'data_quality').toLowerCase().slice(0, 80),
    p_severity: severity,
    p_title: String(title || 'Market data quality warning').slice(0, 200),
    p_message: String(message || 'Market data requires review.').slice(0, 600),
    p_evidence_metadata: evidence,
  });
  return { created };
}

export async function scanExpectedMarketSessions(client, { now = new Date() } = {}) {
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) throw intelligenceError('The market-session scan time is invalid.');
  const reportDate = timestamp.toISOString().slice(0, 10);
  const utcHour = timestamp.getUTCHours();
  const dueSessions = [
    { session: 'asia_moc', cutoffHourUtc: 12, requiredReportTypes: ['bunkerwire', 'european_marketscan'] },
    { session: 'london_moc', cutoffHourUtc: 20, requiredReportTypes: ['european_marketscan'] },
  ].filter((row) => utcHour >= row.cutoffHourUtc && marketPublicationEligible(reportDate, row.session) === true);
  let published = 0;
  const results = [];
  for (const due of dueSessions) {
    const [reportsResult, observationsResult] = await Promise.all([
      client.from('market_report_imports')
        .select('id,source_document_type,source_hash')
        .eq('report_date', reportDate)
        .eq('status', 'completed')
        .in('source_document_type', due.requiredReportTypes),
      client.from('market_price_observations')
        .select('id,series_id,import_id,price_date')
        .eq('price_date', reportDate)
        .eq('assessment_session', due.session)
        .eq('quality_status', 'verified')
        .limit(1),
    ]);
    const error = reportsResult.error || observationsResult.error;
    if (error) throw intelligenceError(`Expected market sessions could not be scanned: ${error.message}`, 502, 'MARKET_SESSION_SCAN_FAILED');
    const reports = reportsResult.data || [];
    const presentTypes = new Set(reports.map((row) => row.source_document_type));
    const missingTypes = due.requiredReportTypes.filter((type) => !presentTypes.has(type));
    if (missingTypes.length) {
      const alert = await publishMarketDataQualityAlert(client, {
        reportDate,
        reportId: reports[0]?.id || null,
        code: `MISSING_${due.session.toUpperCase()}_REPORT`,
        title: `${due.session === 'asia_moc' ? 'Asia' : 'London'} market report is missing`,
        message: 'The expected licensed report was not available after the controlled assessment-session cutoff.',
        severity: 'critical',
        evidence: { assessmentSession: due.session, missingReportTypes: missingTypes },
      });
      if (alert.created) published += 1;
      results.push({ assessmentSession: due.session, status: 'missing_report', missingReportTypes: missingTypes });
      continue;
    }
    if (!(observationsResult.data || []).length) {
      const alert = await publishMarketDataQualityAlert(client, {
        reportDate,
        reportId: reports[0]?.id || null,
        code: `STALE_${due.session.toUpperCase()}_SESSION`,
        title: `${due.session === 'asia_moc' ? 'Asia' : 'London'} market session is stale`,
        message: 'The expected report exists but has no verified publication-eligible observations for this assessment session.',
        severity: 'critical',
        evidence: { assessmentSession: due.session },
      });
      if (alert.created) published += 1;
      results.push({ assessmentSession: due.session, status: 'stale' });
      continue;
    }
    results.push({ assessmentSession: due.session, status: 'complete' });
  }
  return { reportDate, evaluated: dueSessions.length, published, sessions: results };
}

async function publishNumericAlerts(client, reportDate, rules, ruleVersion, curve, aiItems = []) {
  if (!rules.enabled) return { evaluated: 0, published: 0 };
  const currentRows = (curve.history || []).filter((row) => row.date === reportDate);
  let published = 0;
  for (const row of currentRows) {
    const unitFloor = row.unit === 'USD/BBL' ? rules.gasoilFloorUsdBbl : rules.spreadFloorUsdMt;
    for (const [metric, value] of [['bm_m1', row.bmM1], ['m1_m2', row.m1M2]]) {
      if (value == null) continue;
      const series = curve.history.filter((item) => item.productKey === row.productKey && item.unit === row.unit && item.date <= reportDate).sort((a, b) => a.date.localeCompare(b.date));
      const index = series.findIndex((item) => item.date === reportDate);
      const field = metric === 'bm_m1' ? 'bmM1' : 'm1M2';
      const previous = index > 0 ? series[index - 1]?.[field] : null;
      if (previous == null) continue;
      const move = value - previous;
      const priorLevels = series.filter((item) => item.date < reportDate && item.date >= dateBefore(reportDate, rules.lookbackDays)).map((item) => item[field]).filter((item) => item != null);
      const priorMoves = priorLevels.slice(1).map((level, levelIndex) => level - priorLevels[levelIndex]);
      const threshold = configuredAlertThreshold(priorMoves, unitFloor, rules.minimumSamples, rules.percentile);
      if (Math.abs(move) < threshold) continue;
      const lineage = row.sourceRefs?.[0] || {};
      const dedupeKey = hash({ reportId: lineage.reportId, seriesId: lineage.seriesId, reportDate, product: row.productKey, metric, ruleVersion, severity: 'warning' }).slice(0, 64);
      if (await publishAlert(client, { p_dedupe_key: dedupeKey, p_report_id: lineage.reportId || null, p_report_date: reportDate, p_series_id: lineage.seriesId || null, p_rule_version: ruleVersion, p_alert_type: 'curve_move', p_severity: 'warning', p_title: `${row.productKey.toUpperCase()} curve move`, p_message: `${metric.toUpperCase()} daily move exceeded its adaptive ${row.unit} threshold.`, p_evidence_metadata: { metric, sampleCount: priorMoves.length, threshold, move, unit: row.unit, sourceHash: lineage.sourceHash, sourcePage: lineage.sourcePage } })) published += 1;
    }
  }
  for (const row of (curve.outrightHistory || []).filter((item) => item.date === reportDate && item.dayChange != null)) {
    const prior = (curve.outrightHistory || []).filter((item) => item.productKey === row.productKey && item.tenor === row.tenor && item.unit === row.unit && item.assessmentSession === row.assessmentSession && item.date < reportDate && item.date >= dateBefore(reportDate, rules.lookbackDays)).map((item) => item.dayChange).filter((item) => item != null);
    const floor = row.unit === 'USD/BBL' ? rules.gasoilFloorUsdBbl : rules.outrightFloorUsdMt;
    const threshold = configuredAlertThreshold(prior, floor, rules.minimumSamples, rules.percentile);
    if (Math.abs(row.dayChange) < threshold) continue;
    const dedupeKey = hash({ reportId: row.reportId, seriesId: row.seriesId, reportDate, symbol: row.sourceSymbol, type: 'outright_move', ruleVersion }).slice(0, 64);
    if (await publishAlert(client, { p_dedupe_key: dedupeKey, p_report_id: row.reportId || null, p_report_date: reportDate, p_series_id: row.seriesId || null, p_rule_version: ruleVersion, p_alert_type: 'outright_move', p_severity: 'warning', p_title: `${row.productKey.toUpperCase()} outright move`, p_message: `${row.tenor} moved beyond its adaptive ${row.unit} threshold.`, p_evidence_metadata: { sourceHash: row.sourceHash, sourcePage: row.sourcePage, sourceSymbol: row.sourceSymbol, sampleCount: prior.length, threshold, move: row.dayChange, unit: row.unit } })) published += 1;
  }
  for (const row of curve.premiumMoves || []) {
    const prior = (curve.premiumMoveHistory || []).filter((item) => item.productKey === row.productKey && item.portSymbol === row.portSymbol && item.date < reportDate && item.date >= dateBefore(reportDate, rules.lookbackDays)).map((item) => item.change);
    const threshold = configuredAlertThreshold(prior, rules.outrightFloorUsdMt, rules.minimumSamples, rules.percentile);
    if (Math.abs(row.change) < threshold) continue;
    const dedupeKey = hash({ reportId: row.reportId, seriesId: row.seriesId, reportDate, product: row.productKey, port: row.portSymbol, type: 'premium_move', evidenceHash: row.evidenceHash, ruleVersion }).slice(0, 64);
    if (await publishAlert(client, { p_dedupe_key: dedupeKey, p_report_id: row.reportId || null, p_report_date: reportDate, p_series_id: row.seriesId || null, p_rule_version: ruleVersion, p_alert_type: 'premium_move', p_severity: 'warning', p_title: `${row.productKey.toUpperCase()} delivered premium move`, p_message: `An exact-date delivered premium moved beyond its adaptive USD/MT threshold.`, p_evidence_metadata: { evidenceHash: row.evidenceHash, evidenceRefs: row.evidenceRefs, portSymbol: row.portSymbol, sampleCount: prior.length, threshold, move: row.change, unit: row.unit } })) published += 1;
  }
  for (const product of PRODUCTS) {
    const series = (curve.history || []).filter((row) => row.productKey === product && row.date <= reportDate).sort((a, b) => a.date.localeCompare(b.date));
    const last = series.slice(-3);
    const deadband = PRODUCT_UNITS[product] === 'USD/BBL' ? rules.curveDeadbandUsdBbl : rules.curveDeadbandUsdMt;
    if (last.length === 3 && last[2].date === reportDate && last[1].regime === last[2].regime && last[0].regime !== last[2].regime && ['backwardation', 'contango'].includes(last[2].regime) && Math.abs(last[1].headlineSlope || 0) > deadband && Math.abs(last[2].headlineSlope || 0) > deadband) {
      const lineage = last[2].sourceRefs?.[0] || {};
      const dedupeKey = hash({ reportId: lineage.reportId, seriesId: lineage.seriesId, reportDate, product, type: 'regime_flip', regime: last[2].regime, ruleVersion }).slice(0, 64);
      if (await publishAlert(client, { p_dedupe_key: dedupeKey, p_report_id: lineage.reportId || null, p_report_date: reportDate, p_series_id: lineage.seriesId || null, p_rule_version: ruleVersion, p_alert_type: 'curve_regime_flip', p_severity: 'warning', p_title: `${product.toUpperCase()} curve regime changed`, p_message: `Two complete reports confirm a ${last[2].regime} regime outside the deadband.`, p_evidence_metadata: { sourceHash: lineage.sourceHash, sourcePage: lineage.sourcePage, regime: last[2].regime, reportCount: 2, deadband, unit: last[2].unit } })) published += 1;
    }
  }
  for (const warning of curve.warnings || []) {
    const dedupeKey = hash({ reportDate, type: 'data_quality', warning, ruleVersion }).slice(0, 64);
    if (await publishAlert(client, { p_dedupe_key: dedupeKey, p_report_id: null, p_report_date: reportDate, p_series_id: null, p_rule_version: ruleVersion, p_alert_type: 'data_quality', p_severity: 'warning', p_title: 'Market data is incomplete', p_message: String(warning).slice(0, 600), p_evidence_metadata: { code: 'INCOMPLETE_LATEST_SNAPSHOT' } })) published += 1;
  }
  for (const item of aiItems.filter((row) => row.confidence >= 0.8 && row.driverTags.some((tag) => ['weather', 'refinery_outage', 'sanctions', 'geopolitics'].includes(tag)))) {
    const lineage = item.sourceRefs?.[0] || {};
    const dedupeKey = hash({ reportId: lineage.reportId, reportDate, type: 'disruption_driver', title: item.title, ruleVersion }).slice(0, 64);
    if (await publishAlert(client, { p_dedupe_key: dedupeKey, p_report_id: lineage.reportId || null, p_report_date: reportDate, p_series_id: null, p_rule_version: ruleVersion, p_alert_type: 'disruption_driver', p_severity: 'warning', p_title: item.title, p_message: item.summary, p_evidence_metadata: { sourceHash: lineage.sourceHash, sourcePage: lineage.page, confidence: item.confidence, driverTags: item.driverTags } })) published += 1;
  }
  return { evaluated: currentRows.length + (curve.outrightHistory || []).filter((row) => row.date === reportDate).length, published };
}

async function legacyShadowComparisons(client, reportDate, curve) {
  const [settingsResult, priceResult] = await Promise.all([
    client.from('hedge_settings').select('value').eq('key', 'fwd_spreads').maybeSingle(),
    client.from('hedge_market_prices').select('price_date,s380,s05,sgo').eq('is_estimate', false).lte('price_date', reportDate).order('price_date', { ascending: false }).limit(1),
  ]);
  if (settingsResult.error || priceResult.error || !priceResult.data?.[0]) return [];
  const adjustments = settingsResult.data?.value || {};
  const actual = priceResult.data[0];
  const field = { hsfo380: 's380', vlsfo: 's05', lsmgo: 'sgo' };
  return (curve.snapshot || []).filter((row) => row.qualityStatus === 'verified' && ['BM', 'M1', 'M2'].includes(row.tenor)).map((row) => {
    const base = number(actual[field[row.productKey]]);
    const adjustment = number(adjustments[field[row.productKey]]);
    return base == null || adjustment == null ? null : { productKey: row.productKey, contractMonth: row.contractMonth, legacyValue: base + adjustment, curveValue: row.value };
  }).filter(Boolean);
}

async function loadDeterministicAiObservationEvidence(client, importIds, sourceRefs) {
  if (!(importIds || []).length) return [];
  const [seriesResult, observationsResult] = await Promise.all([
    client.from('market_intelligence_series').select('id,source_symbol').eq('active', true),
    client.from('market_price_observations')
      .select('import_id,series_id,price,source_page,quality_status,basis_metadata')
      .in('import_id', importIds)
      .eq('quality_status', 'verified'),
  ]);
  if (seriesResult.error || observationsResult.error) {
    throw intelligenceError(`Deterministic AI evidence could not be loaded: ${(seriesResult.error || observationsResult.error).message}`, 502, 'MARKET_AI_EVIDENCE_LOAD_FAILED');
  }
  const symbolBySeries = new Map((seriesResult.data || []).map((row) => [row.id, row.source_symbol]));
  const hashByImport = new Map((sourceRefs || []).map((row) => [row.reportId, row.sourceHash]));
  return normalizedObservationEvidence((observationsResult.data || [])
    .filter((row) => row.basis_metadata?.publicationEligible !== false)
    .map((row) => ({
      sourceHash: hashByImport.get(row.import_id),
      page: row.source_page,
      symbol: symbolBySeries.get(row.series_id),
      value: row.price,
    })));
}

function shadowScopeKey(row = {}) {
  return [
    isoDate(row.publication_date || row.publicationDate),
    String(row.product_key || row.productKey || '').trim().toLowerCase(),
    isoMonth(row.contract_month || row.contractMonth),
    String(row.unit || '').trim().toUpperCase(),
  ].join(':');
}

export async function processMarketIntelligenceDate(client, { reportDate, commentaryContexts = [], legacyComparisons = [], publishAlerts = true, recordShadow = true, reconcileDerived = false, forceDeterministicRevision = false } = {}) {
  const date = isoDate(reportDate);
  if (!date) throw intelligenceError('A valid report date is required.');
  const reportsResult = await client.from('market_report_imports').select('id,source_hash,source_document_type,report_date').eq('report_date', date).in('source_document_type', ['bunkerwire', 'european_marketscan']).eq('status', 'completed');
  if (reportsResult.error) throw intelligenceError(`Market reports could not be reconciled: ${reportsResult.error.message}`, 502, 'MARKET_BRIEF_RECONCILIATION_FAILED');
  const types = new Set((reportsResult.data || []).map((row) => row.source_document_type));
  if (!types.has('bunkerwire') || !types.has('european_marketscan')) {
    const alert = publishAlerts ? await publishMarketDataQualityAlert(client, { reportDate: date, code: 'MISSING_REPORT_PAIR', title: 'Market report pair is incomplete', message: 'Bunkerwire and European Marketscan are both required before daily intelligence is derived.', evidence: { presentTypes: [...types].sort() } }) : { created: false };
    return { status: 'waiting_for_pair', reportDate: date, briefItemCount: 0, alertsPublished: alert.created ? 1 : 0, shadowRecorded: 0 };
  }
  const importIds = (reportsResult.data || []).map((row) => row.id);
  const conflictsResult = await client.from('market_observation_evidence').select('id,conflict_code').in('import_id', importIds).eq('disposition', 'quarantined').limit(100);
  if (conflictsResult.error) throw intelligenceError(`Market evidence could not be reconciled: ${conflictsResult.error.message}`, 502, 'MARKET_BRIEF_RECONCILIATION_FAILED');
  if ((conflictsResult.data || []).some((row) => row.conflict_code !== 'NON_PUBLICATION_DAY_REPRINT')) {
    const alert = publishAlerts ? await publishMarketDataQualityAlert(client, { reportDate: date, code: 'PAIRED_REPORT_CONFLICT', title: 'Paired market reports conflict', message: 'Conflicting price or contract evidence was quarantined and the daily brief was withheld.', severity: 'critical', evidence: { conflictCount: conflictsResult.data.length } }) : { created: false };
    return { status: 'conflict', reportDate: date, briefItemCount: 0, alertsPublished: alert.created ? 1 : 0, shadowRecorded: 0 };
  }
  const sourceRefs = (reportsResult.data || []).map((row) => ({ reportId: row.id, reportDate: row.report_date, sourceHash: row.source_hash, documentType: row.source_document_type }))
    .sort((left, right) => left.documentType.localeCompare(right.documentType) || left.sourceHash.localeCompare(right.sourceHash));
  const sourceHash = hash(sourceRefs.map((row) => `${row.documentType}:${row.sourceHash}`).sort().join('|'));
  const fallbackExpiryResult = await client.rpc('expire_market_forward_fallbacks_for_report', { p_report_date: date });
  if (fallbackExpiryResult.error) throw intelligenceError(`Verified-report fallback expiry could not be reconciled: ${fallbackExpiryResult.error.message}`, 502, 'MARKET_FALLBACK_EXPIRY_RECONCILIATION_FAILED');
  const [curve, deterministicObservationEvidence] = await Promise.all([
    loadMarketIntelligenceCurve(client, { asOfDate: date, products: PRODUCTS, range: '3m' }),
    loadDeterministicAiObservationEvidence(client, importIds, sourceRefs),
  ]);
  const curveCoverage = await curveAvailabilityForBrief(client, { report_date: date, source_refs: sourceRefs }, curve);
  const availabilityWarnings = curveCoverage.marks
    .filter((row) => row.status === 'published_na' || row.status === 'not_detected')
    .map(availabilityWarning);
  const baseMetrics = deterministicBriefMetrics(curve);
  const deterministicMetrics = {
    ...baseMetrics,
    risks: (baseMetrics.risks || []).filter((row) => !isLegacyCurveMissingWarning(row)),
    curveCoverage,
    warnings: uniqueBriefWarnings(curveCoverage, [...availabilityWarnings, ...(baseMetrics.warnings || [])]),
  };
  const deterministicItems = deterministicBriefItems(deterministicMetrics);
  let reusedBrief = null;
  let ai = null;
  if (reconcileDerived || forceDeterministicRevision) {
    const briefResult = await client.from('market_intelligence_briefs').select('id,source_hash,revision,ai_status,model_id').eq('report_date', date).order('revision', { ascending: false }).limit(1);
    if (briefResult.error) throw intelligenceError(`Derived brief reconciliation state could not be loaded: ${briefResult.error.message}`, 502, 'MARKET_BRIEF_RECONCILIATION_FAILED');
    reusedBrief = briefResult.data?.[0] || null;
    if (reusedBrief) {
      const itemsResult = await client.from('market_intelligence_brief_items').select('*').eq('brief_id', reusedBrief.id).in('item_kind', ['driver', 'risk']).order('item_order');
      if (itemsResult.error) throw intelligenceError(`Derived brief items could not be reconciled: ${itemsResult.error.message}`, 502, 'MARKET_BRIEF_RECONCILIATION_FAILED');
      ai = { status: reusedBrief.ai_status || 'reused', modelId: reusedBrief.model_id || null, items: (itemsResult.data || []).map(itemProjection) };
    }
  }
  if (!ai) {
    const commentaryTypes = new Set((commentaryContexts || []).map((row) => row.documentType));
    ai = commentaryTypes.has('bunkerwire') && commentaryTypes.has('european_marketscan')
      ? await generateMarketCommentaryItems(commentaryContexts, { observationEvidence: deterministicObservationEvidence })
      : { status: 'unavailable', modelId: null, items: [] };
  }
  const completeness = {
    complete: types.size === 2,
    completeReports: types.size,
    requiredReports: 2,
    reportTypes: [...types].sort(),
    curveNumericComplete: curveCoverage.numericCount === curveCoverage.requiredCount,
    curveEvidenceComplete: curveCoverage.complete,
    numericCurveMarks: curveCoverage.numericCount,
    requiredCurveMarks: curveCoverage.requiredCount,
    publishedNaCount: curveCoverage.publishedNaCount,
    missingCurveMarkCount: curveCoverage.missingCount,
    warningCount: deterministicMetrics.warnings.length,
  };
  const rulesState = await getMarketIntelligenceAlertRules(client);
  const reportIdByHash = new Map(sourceRefs.map((row) => [row.sourceHash, row.reportId]));
  const aiAlertItems = ai.items.map((item) => ({ ...item, sourceRefs: (item.sourceRefs || []).map((ref) => ({ ...ref, reportId: reportIdByHash.get(ref.sourceHash) || null })) }));
  const alerts = publishAlerts ? await publishNumericAlerts(client, date, rulesState.rules, rulesState.revision, curve, aiAlertItems) : { evaluated: 0, published: 0 };
  let shadowRecorded = 0;
  const shadowComparisons = recordShadow
    ? ((legacyComparisons || []).length ? legacyComparisons : await legacyShadowComparisons(client, date, curve))
    : [];
  const existingShadowScopes = new Set();
  if (reconcileDerived && shadowComparisons.length) {
    const existingShadowResult = await client.from('market_curve_shadow_runs')
      .select('publication_date,product_key,contract_month,unit')
      .eq('publication_date', date);
    if (existingShadowResult.error) {
      throw intelligenceError(`Existing curve shadow evidence could not be loaded: ${existingShadowResult.error.message}`, 502, 'MARKET_CURVE_SHADOW_LOAD_FAILED');
    }
    for (const row of existingShadowResult.data || []) existingShadowScopes.add(shadowScopeKey(row));
  }
  for (const comparison of shadowComparisons) {
    if (!PRODUCTS.includes(comparison.productKey) || !isoMonth(comparison.contractMonth) || number(comparison.legacyValue) == null || number(comparison.curveValue) == null) continue;
    const unit = PRODUCT_UNITS[comparison.productKey];
    if (existingShadowScopes.has(shadowScopeKey({
      publication_date: date,
      product_key: comparison.productKey,
      contract_month: `${isoMonth(comparison.contractMonth)}-01`,
      unit,
    }))) continue;
    const signedVariance = Number(comparison.curveValue) - Number(comparison.legacyValue);
    const result = await client.rpc('record_market_curve_shadow', {
      p_publication_date: date,
      p_product_key: comparison.productKey,
      p_contract_month: `${isoMonth(comparison.contractMonth)}-01`,
      p_unit: unit,
      p_comparison_count: 1,
      p_legacy_value_hash: hash(comparison.legacyValue),
      p_curve_value_hash: hash(comparison.curveValue),
      p_variance_hash: hash(signedVariance),
      p_mean_signed_variance: signedVariance,
      p_mean_absolute_variance: Math.abs(signedVariance),
      p_maximum_absolute_variance: Math.abs(signedVariance),
    });
    if (!result.error) shadowRecorded += 1;
    else throw intelligenceError(`Curve shadow evidence could not be stored: ${result.error.message}`, 502, 'MARKET_CURVE_SHADOW_SAVE_FAILED');
  }
  if (forceDeterministicRevision && reusedBrief) {
    const save = await client.rpc('revise_market_intelligence_brief', {
      p_report_date: date,
      p_source_hash: sourceHash,
      p_as_of_at: new Date().toISOString(),
      p_completeness: completeness,
      p_deterministic_metrics: deterministicMetrics,
      p_ai_status: 'reused',
      p_model_id: ai.modelId,
      p_source_refs: sourceRefs,
      p_items: [...deterministicItems, ...ai.items],
      p_expected_revision: Number(reusedBrief.revision),
    });
    if (save.error) throw intelligenceError(`Market brief revision could not be stored: ${save.error.message}`, /STALE|SOURCE_CHANGED/.test(save.error.message || '') ? 409 : 502, 'MARKET_BRIEF_REVISION_FAILED');
  } else if (!reusedBrief) {
    const save = await client.rpc('save_market_intelligence_brief', { p_report_date: date, p_source_hash: sourceHash, p_as_of_at: new Date().toISOString(), p_completeness: completeness, p_deterministic_metrics: deterministicMetrics, p_ai_status: ai.status, p_model_id: ai.modelId, p_source_refs: sourceRefs, p_items: [...deterministicItems, ...ai.items] });
    if (save.error) throw intelligenceError(`Market brief could not be stored: ${save.error.message}`, 502, 'MARKET_BRIEF_SAVE_FAILED');
  }
  return { status: 'completed', reportDate: date, briefItemCount: deterministicItems.length + ai.items.length, aiStatus: ai.status, alertsPublished: alerts.published, shadowRecorded, reconciled: Boolean(reusedBrief), revised: Boolean(forceDeterministicRevision && reusedBrief), curveCoverage };
}

export const marketIntelligenceTradingInternals = Object.freeze({
  normalizeProducts,
  curveSnapshot,
  historySignals,
  physicalMetrics,
  shadowProjection,
  rulesProjection,
  validatedRules,
  validateAiItems,
  requiredCurveShadowScopes,
  projectedSettlementRows,
  reviewedPublicationDays,
  latestReviewedPublicationDate,
  curveCompleteness,
  companyShadowProjection,
  isoDate,
  latestBriefsByReportDate,
  seriesProduct,
  shadowScopeKey,
  seriesMarketFamily,
  observationProjection,
  curveAvailabilityForBrief,
  isLegacyCurveMissingWarning,
  uniqueBriefWarnings,
  publishNumericAlerts,
  hash,
});
