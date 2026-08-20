import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const MAX_REPORT_BYTES = 5_000_000;
const REPORT_TYPES = new Set(['bunkerwire', 'european_marketscan']);

const SOURCE_PAGES = Object.freeze({
  MFSPD00: 1, MFSKD00: 1, WKMFA00: 1, MFZSD00: 1, MFHKD00: 1, AMFSA00: 1,
  FOFS000: 1, FOFS001: 1, FOFS002: 1,
  PUAFT00: 3, PUAFR00: 3, PUAER00: 3, BFDZA00: 3, AAXYO00: 3, AAXYS00: 3, AAXYQ00: 3, MGZSD00: 3,
  CBGAP00: 5, CB1AR00: 5, CB3AN00: 5,
  FPLSM01: 4, FPLSM02: 4, FQLSM01: 4, FQLSM02: 4, MSGSL00: 4, MSHSL00: 4,
});

const EUROPEAN_SOURCE_PAGES = Object.freeze({
  AMFSA00: 3, FOFS000: 3, FOFS001: 3, FOFS002: 3,
  FPLSM01: 4, FPLSM02: 4, FQLSM01: 4, FQLSM02: 4, MSGSL00: 4, MSHSL00: 4,
  PPXDK00: 9, POABC00: 9,
});

const DOCUMENT_SYMBOLS = Object.freeze({
  bunkerwire: [
    'MFSPD00', 'MFSKD00', 'WKMFA00', 'MFZSD00', 'MFHKD00', 'AMFSA00',
    'FOFS000', 'FOFS001', 'FOFS002', 'PUAFT00', 'PUAFR00', 'BFDZA00',
    'PUAER00', 'AAXYO00', 'AAXYS00', 'AAXYQ00', 'MGZSD00', 'CBGAP00', 'CB1AR00', 'CB3AN00',
  ],
  european_marketscan: [
    'AMFSA00', 'PPXDK00', 'POABC00', 'FOFS000', 'FOFS001', 'FOFS002',
    'FPLSM01', 'FPLSM02', 'FQLSM01', 'FQLSM02', 'MSGSL00', 'MSHSL00',
  ],
});

const SIGNED_VALUE_SYMBOLS = new Set(['FQLSM01', 'FQLSM02']);
const PRODUCT_KEYS = new Set(['vlsfo', 'hsfo380', 'lsmgo']);
const PORT_KEYS = new Set(['singapore', 'south-korea', 'south-korea-west', 'zhoushan', 'kaohsiung', 'hong-kong']);
const HISTORY_RANGES = Object.freeze({ '1w': 7, '1m': 31, '3m': 93, '6m': 186, '1y': 366 });
const BENCHMARK_SYMBOLS = Object.freeze({ vlsfo: 'AMFSA00', hsfo380: 'PPXDK00', lsmgo: 'POABC00' });
const MOPS_LEDGER_FIELDS = Object.freeze({ vlsfo: 's05', hsfo380: 's380', lsmgo: 'sgo' });
export const MOPS_SGO_BBL_PER_MT = 7.45;

function marketError(message, statusCode = 400, code = 'MARKET_INTELLIGENCE_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizedReportText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function reportDateFrom(value, filename = '') {
  const filenameMatch = String(filename).match(/(?:^|\D)(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);
  const filenameDate = filenameMatch ? `${filenameMatch[1]}-${filenameMatch[2]}-${filenameMatch[3]}` : null;
  const monthNames = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const match = String(value).match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, 'i'));
  if (!match) return filenameDate;
  const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

function detectedDocumentType(text, requested = null, filename = '') {
  if (REPORT_TYPES.has(requested)) return requested;
  const haystack = `${filename}\n${String(text).slice(0, 6000)}`.toLowerCase();
  if (/bunkerwire|bunker wire|bw_20/.test(haystack)) return 'bunkerwire';
  if (/european marketscan|eum_/.test(haystack)) return 'european_marketscan';
  return null;
}

function symbolObservation(text, symbol, documentType) {
  const sourcePage = documentType === 'european_marketscan' ? EUROPEAN_SOURCE_PAGES[symbol] : SOURCE_PAGES[symbol];
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pricePattern = SIGNED_VALUE_SYMBOLS.has(symbol) ? '[+-]?\\d+(?:\\.\\d+)?' : '\\d+(?:\\.\\d+)?';
  const exact = new RegExp(`${escaped}\\s+(?:\\d+(?:\\.\\d+)?\\s*-\\s*\\d+(?:\\.\\d+)?\\s+)?(${pricePattern})\\s+([+-]\\d+(?:\\.\\d+)?)`, 'i').exec(text);
  if (exact) return { sourceSymbol: symbol, price: Number(exact[1]), dayChange: Number(exact[2]), sourcePage: sourcePage || null };
  const posted = new RegExp(`${escaped}\\s+(${pricePattern})`, 'i').exec(text);
  if (posted) return { sourceSymbol: symbol, price: Number(posted[1]), dayChange: null, sourcePage: sourcePage || null };
  return null;
}

export function parseMarketReportText(rawText, { documentType = null, filename = '' } = {}) {
  const text = normalizedReportText(rawText);
  const type = detectedDocumentType(text, documentType, filename);
  if (!type) throw marketError('Choose whether this is Bunkerwire or European Marketscan.', 400, 'MARKET_REPORT_TYPE_REQUIRED');
  const reportDate = reportDateFrom(text, filename);
  if (!reportDate) throw marketError('The report date could not be detected.', 400, 'MARKET_REPORT_DATE_MISSING');
  const observations = DOCUMENT_SYMBOLS[type].map((symbol) => symbolObservation(text, symbol, type)).filter(Boolean);
  if (!observations.length) throw marketError('No configured market symbols were found in this report.', 400, 'MARKET_REPORT_NO_VALUES');
  const found = new Set(observations.map((row) => row.sourceSymbol));
  return {
    documentType: type,
    reportDate,
    observations,
    missingSymbols: DOCUMENT_SYMBOLS[type].filter((symbol) => !found.has(symbol)),
    observationCount: observations.length,
  };
}

function validatedReportBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!buffer.length || buffer.length > MAX_REPORT_BYTES) throw marketError('The PDF report must be no larger than 5 MB.', 413, 'MARKET_REPORT_TOO_LARGE');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw marketError('Only a valid PDF report can be imported.', 400, 'MARKET_REPORT_INVALID_FILE');
  return buffer;
}

function decodeReport(base64) {
  if (!base64 || typeof base64 !== 'string') throw marketError('Choose a PDF report.', 400, 'MARKET_REPORT_FILE_REQUIRED');
  try {
    return validatedReportBuffer(Buffer.from(base64.replace(/^data:application\/pdf;base64,/, ''), 'base64'));
  } catch (error) {
    if (error?.code) throw error;
    throw marketError('The PDF report could not be decoded.', 400, 'MARKET_REPORT_INVALID_FILE');
  }
}

export async function parseMarketReportPdf(buffer, { documentType = null, filename = '' } = {}) {
  const validated = validatedReportBuffer(buffer);
  let parsed;
  try {
    parsed = await pdfParse(validated);
  } catch {
    throw marketError('The PDF text could not be read. Use an unlocked Bunkerwire or European Marketscan report.', 400, 'MARKET_REPORT_UNREADABLE');
  }
  const preview = parseMarketReportText(parsed.text, { documentType, filename });
  return {
    ...preview,
    sourceHash: createHash('sha256').update(validated).digest('hex'),
    sourceBytes: validated.length,
  };
}

export async function previewMarketReport(body = {}) {
  return parseMarketReportPdf(decodeReport(body.fileBase64), {
    documentType: body.documentType,
    filename: body.fileName,
  });
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function daysOld(dateString, today = new Date()) {
  if (!dateString) return null;
  const then = new Date(`${dateString}T00:00:00Z`);
  return Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86_400_000));
}

function isoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw marketError('The market-history date is invalid.', 400, 'MARKET_HISTORY_DATE_INVALID');
  return date.toISOString().slice(0, 10);
}

function dateBefore(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function rounded(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

export function calculateMarketHorizonStats(points = [], endDate = isoDate(), horizons = { '1w': 7, '1m': 31, '3m': 93 }) {
  return Object.fromEntries(Object.entries(horizons).map(([key, days]) => {
    const start = dateBefore(endDate, days - 1);
    const rows = points
      .filter((row) => row.date >= start && row.date <= endDate && Number.isFinite(Number(row.spread)))
      .sort((left, right) => left.date.localeCompare(right.date));
    const values = rows.map((row) => Number(row.spread));
    return [key, {
      startDate: start,
      endDate,
      matchedSamples: values.length,
      average: values.length ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      low: values.length ? rounded(Math.min(...values)) : null,
      high: values.length ? rounded(Math.max(...values)) : null,
      movement: values.length > 1 ? rounded(values.at(-1) - values[0]) : null,
    }];
  }));
}

function benchmarkSeriesForProduct(seriesRows, productKey) {
  return seriesRows.find((row) => row.market_family === 'cargo'
    && row.product_key === productKey
    && row.source_symbol === BENCHMARK_SYMBOLS[productKey]);
}

function benchmarkUsdMt(series, price) {
  if (price == null) return null;
  return rounded(Number(price) * Number(series?.usd_mt_factor || (series?.source_symbol === 'POABC00' ? MOPS_SGO_BBL_PER_MT : 1)));
}

function spreadHistoryFor(deliveredSeries, benchmarkSeries, bySeries) {
  if (!deliveredSeries || !benchmarkSeries) return [];
  const benchmarks = new Map((bySeries.get(benchmarkSeries.id) || []).map((row) => [row.priceDate, row]));
  return (bySeries.get(deliveredSeries.id) || [])
    .map((row) => {
      const benchmark = benchmarks.get(row.priceDate);
      const mopsUsdMt = benchmarkUsdMt(benchmarkSeries, benchmark?.price);
      return mopsUsdMt == null || row.price == null ? null : {
        date: row.priceDate,
        delivered: row.price,
        mops: mopsUsdMt,
        spread: rounded(row.price - mopsUsdMt),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function buildMarketIntelligenceSnapshot(seriesRows = [], observationRows = [], { today = new Date(), conflicts = [] } = {}) {
  const bySeries = new Map();
  for (const row of observationRows) {
    const list = bySeries.get(row.series_id) || [];
    list.push({
      id: row.id,
      priceDate: row.price_date,
      price: numeric(row.price),
      dayChange: numeric(row.day_change),
      qualityStatus: row.quality_status,
      sourcePage: row.source_page,
    });
    bySeries.set(row.series_id, list);
  }
  const series = seriesRows.map((row) => {
    const history = (bySeries.get(row.id) || []).sort((left, right) => String(left.priceDate).localeCompare(String(right.priceDate)));
    const latest = history.at(-1) || null;
    const staleDays = daysOld(latest?.priceDate, today);
    return {
      id: row.id,
      marketFamily: row.market_family,
      portKey: row.port_key,
      portLabel: row.port_label,
      productKey: row.product_key,
      productLabel: row.product_label,
      aliasLabel: row.alias_label,
      sourceSymbol: row.source_symbol,
      sourceName: row.source_name,
      sourceType: row.source_type,
      currencyCode: row.currency_code,
      unit: row.unit,
      valueKind: row.value_kind || 'absolute',
      benchmarkLabel: row.benchmark_label || null,
      usdMtFactor: numeric(row.usd_mt_factor) || 1,
      basisNote: row.basis_note,
      displayOrder: row.display_order,
      latest: latest ? { ...latest, staleDays, stale: staleDays > 3 } : null,
      history,
    };
  });
  const delivered = series.filter((row) => row.marketFamily === 'delivered').map((row) => {
    const rawDelivered = seriesRows.find((entry) => entry.id === row.id);
    const rawBenchmark = benchmarkSeriesForProduct(seriesRows, row.productKey);
    const benchmark = series.find((entry) => entry.id === rawBenchmark?.id);
    const spreadHistory = spreadHistoryFor(rawDelivered, rawBenchmark, bySeries);
    const latestSpread = spreadHistory.at(-1) || null;
    const endDate = row.latest?.priceDate || isoDate(today);
    return {
      ...row,
      benchmark: benchmark ? {
        id: benchmark.id,
        label: benchmark.benchmarkLabel || benchmark.productLabel,
        sourceSymbol: benchmark.sourceSymbol,
        sourceUnit: benchmark.unit,
        usdMtFactor: benchmark.usdMtFactor,
      } : null,
      deliveredPremium: latestSpread && row.latest?.priceDate === latestSpread.date ? latestSpread.spread : null,
      latestSpread,
      spreadHistory,
      horizonStats: calculateMarketHorizonStats(spreadHistory, endDate),
    };
  });
  const relativeValue = ['vlsfo', 'hsfo380', 'lsmgo'].map((productKey) => {
    const values = delivered.filter((row) => row.productKey === productKey && row.latest?.price != null);
    if (!values.length) return { productKey, available: false };
    const ordered = [...values].sort((left, right) => left.latest.price - right.latest.price);
    return {
      productKey,
      available: true,
      cheapest: { portKey: ordered[0].portKey, portLabel: ordered[0].portLabel, price: ordered[0].latest.price },
      mostExpensive: { portKey: ordered.at(-1).portKey, portLabel: ordered.at(-1).portLabel, price: ordered.at(-1).latest.price },
      spread: Number((ordered.at(-1).latest.price - ordered[0].latest.price).toFixed(3)),
    };
  });
  const forward = series.filter((row) => row.marketFamily === 'forward');
  const value = (productKey) => forward.find((row) => row.productKey === productKey)?.latest?.price ?? null;
  const bm = value('vlsfo-bm');
  const m1 = value('vlsfo-m1');
  const m2 = value('vlsfo-m2');
  const hsfoM1 = value('hsfo380-m1');
  const forwardStructure = bm == null || m1 == null ? null : {
    label: bm > m1 ? 'Backwardation' : bm < m1 ? 'Contango' : 'Flat',
    bmM1: Number((bm - m1).toFixed(3)),
    m1M2: m2 == null ? null : Number((m1 - m2).toFixed(3)),
  };
  const alerts = [
    ...delivered.filter((row) => row.sourceType === 'unavailable').map((row) => `${row.portLabel} ${row.productLabel}: no exact series configured.`),
    ...delivered.filter((row) => row.latest?.stale).map((row) => `${row.portLabel} ${row.productLabel}: ${row.latest.staleDays} days old.`),
    ...delivered.filter((row) => row.sourceType === 'posted').map((row) => `${row.portLabel} ${row.productLabel}: posted price, not a delivered assessment.`),
    ...conflicts.map((row) => `${row.priceDate || 'Unknown date'} ${row.sourceSymbol || 'market observation'}: conflicting report values were quarantined.`),
  ];
  return {
    delivered,
    cargoForward: series.filter((row) => row.marketFamily !== 'delivered'),
    signals: {
      relativeValue,
      forwardStructure,
      vlsfoHsfoM1: m1 == null || hsfoM1 == null ? null : Number((m1 - hsfoM1).toFixed(3)),
      eastWestM1: value('east-west-m1'),
      gasoilM1: value('gasoil-m1'),
      alerts,
    },
    conflicts,
  };
}

export async function loadMarketIntelligence(client) {
  const historyStart = dateBefore(isoDate(), HISTORY_RANGES['3m'] + 7);
  const [seriesResult, observationsResult, importsResult, conflictsResult, syncRunsResult, publicationsResult] = await Promise.all([
    client.from('market_intelligence_series').select('*').eq('active', true).order('display_order'),
    client.from('market_price_observations').select('id,series_id,price_date,price,day_change,quality_status,source_page').gte('price_date', historyStart).order('price_date', { ascending: true }).limit(5000),
    client.from('market_report_imports').select('id,source_document_type,report_date,observation_count,status,mops_publication_status,created_at,actor_email').order('created_at', { ascending: false }).limit(20),
    client.from('market_observation_evidence').select('id,series_id,price_date,conflict_code,created_at').eq('disposition', 'quarantined').order('created_at', { ascending: false }).limit(50),
    client.from('market_report_sync_runs').select('status,discovered_count,skipped_count,imported_count,failed_count,deferred_count,error_code,started_at,completed_at').order('started_at', { ascending: false }).limit(1),
    client.from('market_mops_publications').select('report_date,outcome,conflict_code,created_at').order('report_date', { ascending: false }).limit(20),
  ]);
  const error = seriesResult.error || observationsResult.error || importsResult.error || conflictsResult.error || syncRunsResult.error || publicationsResult.error;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) return { available: false, delivered: [], cargoForward: [], signals: { relativeValue: [], forwardStructure: null, vlsfoHsfoM1: null, eastWestM1: null, gasoilM1: null, alerts: [] }, imports: [] };
    throw marketError(`Market intelligence could not be loaded: ${error.message}`, 502, 'MARKET_INTELLIGENCE_LOAD_FAILED');
  }
  const seriesById = new Map((seriesResult.data || []).map((row) => [row.id, row]));
  const conflicts = (conflictsResult.data || []).map((row) => ({
    id: row.id,
    priceDate: row.price_date,
    sourceSymbol: seriesById.get(row.series_id)?.source_symbol || null,
    conflictCode: row.conflict_code,
    createdAt: row.created_at,
  }));
  return {
    available: true,
    ...buildMarketIntelligenceSnapshot(seriesResult.data || [], observationsResult.data || [], { conflicts }),
    imports: importsResult.data || [],
    automation: {
      latestSync: syncRunsResult.data?.[0] || null,
      recentMopsPublications: publicationsResult.data || [],
      conflictCount: conflicts.length,
    },
  };
}

function normalizedSelection(value, allowed, fallback) {
  const values = Array.isArray(value) ? value : value == null ? fallback : [value];
  const selected = [...new Set(values.map((entry) => String(entry || '').trim()).filter((entry) => allowed.has(entry)))];
  if (!selected.length) throw marketError('Choose at least one available market series.', 400, 'MARKET_HISTORY_SELECTION_REQUIRED');
  return selected;
}

async function loadCanonicalObservations(client, seriesIds, startDate, endDate) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client
      .from('market_price_observations')
      .select('id,series_id,price_date,price,day_change,quality_status,source_page')
      .in('series_id', seriesIds)
      .gte('price_date', startDate)
      .lte('price_date', endDate)
      .order('price_date', { ascending: true })
      .range(offset, offset + 999);
    if (result.error) throw marketError(`Market history could not be loaded: ${result.error.message}`, 502, 'MARKET_HISTORY_LOAD_FAILED');
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) break;
  }
  return rows;
}

export function buildMarketHistoryResponse(seriesRows = [], observationRows = [], ledgerRows = [], conflictRows = [], request = {}) {
  const range = HISTORY_RANGES[request.range] ? request.range : '3m';
  const mode = request.mode === 'spread' ? 'spread' : 'price';
  const includeMops = request.includeMops !== false;
  const endDate = request.endDate || isoDate();
  const startDate = dateBefore(endDate, HISTORY_RANGES[range] - 1);
  const products = normalizedSelection(request.products, PRODUCT_KEYS, [...PRODUCT_KEYS]);
  const availablePortKeys = new Set(seriesRows.filter((row) => row.market_family === 'delivered').map((row) => row.port_key));
  const allowedPorts = new Set([...PORT_KEYS].filter((key) => availablePortKeys.has(key)));
  const ports = normalizedSelection(request.ports, allowedPorts, [...allowedPorts]);
  const cursor = request.cursor == null || request.cursor === '' ? null : String(request.cursor);
  if (cursor && !/^\d{4}-\d{2}-\d{2}$/.test(cursor)) throw marketError('The market-history cursor is invalid.', 400, 'MARKET_HISTORY_CURSOR_INVALID');
  const dateLimit = Math.min(Math.max(Number(request.limit) || 400, 7), 400);
  const seriesById = new Map(seriesRows.map((row) => [row.id, row]));
  const bySeries = new Map();
  for (const row of observationRows) {
    const list = bySeries.get(row.series_id) || [];
    list.push({
      id: row.id,
      date: row.price_date,
      price: numeric(row.price),
      dayChange: numeric(row.day_change),
      qualityStatus: row.quality_status,
      sourcePage: row.source_page,
    });
    bySeries.set(row.series_id, list);
  }
  const allDates = [...new Set(observationRows.map((row) => row.price_date))]
    .filter((date) => date >= startDate && date <= endDate && (!cursor || date > cursor))
    .sort();
  const selectedDates = allDates.slice(0, dateLimit);
  const selectedDateSet = new Set(selectedDates);
  const nextCursor = allDates.length > selectedDates.length ? selectedDates.at(-1) : null;
  const ledgerByDate = new Map((ledgerRows || []).map((row) => [row.price_date, row]));
  const mismatchKeys = new Set();
  const warnings = [];

  const panels = products.map((productKey) => {
    const benchmarkSeries = seriesRows.find((row) => row.market_family === 'cargo'
      && row.product_key === productKey
      && row.source_symbol === BENCHMARK_SYMBOLS[productKey]);
    const ledgerField = MOPS_LEDGER_FIELDS[productKey];
    const benchmarkPoints = (bySeries.get(benchmarkSeries?.id) || [])
      .filter((row) => selectedDateSet.has(row.date))
      .map((row) => {
        const ledger = ledgerByDate.get(row.date);
        const ledgerValue = ledger && !ledger.is_estimate ? numeric(ledger[ledgerField]) : null;
        const mismatch = ledgerValue != null && Math.abs(ledgerValue - row.price) > 0.0005;
        if (mismatch) mismatchKeys.add(`${productKey}:${row.date}`);
        return {
          ...row,
          sourceValue: row.price,
          usdMt: benchmarkUsdMt(benchmarkSeries, row.price),
          ledgerValue,
          ledgerVerified: ledgerValue != null && !mismatch,
          mismatch,
        };
      });
    const benchmarkByDate = new Map(benchmarkPoints.map((row) => [row.date, row]));
    const deliveredSeries = seriesRows
      .filter((row) => row.market_family === 'delivered' && row.product_key === productKey && ports.includes(row.port_key))
      .sort((left, right) => Number(left.display_order || 0) - Number(right.display_order || 0));
    const portSeries = deliveredSeries.map((series) => {
      const points = (bySeries.get(series.id) || [])
        .filter((row) => selectedDateSet.has(row.date))
        .map((row) => {
          const benchmark = benchmarkByDate.get(row.date);
          const spread = benchmark && !benchmark.mismatch && benchmark.usdMt != null && row.price != null
            ? rounded(row.price - benchmark.usdMt)
            : null;
          return {
            date: row.date,
            delivered: row.price,
            mops: benchmark?.usdMt ?? null,
            spread,
            sourcePage: row.sourcePage,
            suppressionReason: benchmark?.mismatch ? 'MOPS_LEDGER_VALUE_MISMATCH' : benchmark ? null : 'MOPS_DATE_MISSING',
          };
        });
      const spreadPoints = points.filter((row) => row.spread != null);
      return {
        id: series.id,
        portKey: series.port_key,
        portLabel: series.port_label,
        sourceSymbol: series.source_symbol,
        sourceType: series.source_type,
        basisNote: series.basis_note,
        available: series.source_type !== 'unavailable',
        points,
        horizonStats: calculateMarketHorizonStats(spreadPoints, endDate),
      };
    });
    return {
      productKey,
      productLabel: seriesRows.find((row) => row.market_family === 'delivered' && row.product_key === productKey)?.product_label || productKey,
      benchmark: benchmarkSeries ? {
        id: benchmarkSeries.id,
        label: benchmarkSeries.benchmark_label || benchmarkSeries.product_label,
        sourceSymbol: benchmarkSeries.source_symbol,
        sourceUnit: benchmarkSeries.unit,
        usdMtFactor: numeric(benchmarkSeries.usd_mt_factor) || 1,
        points: includeMops ? benchmarkPoints : [],
      } : null,
      series: portSeries,
    };
  });

  for (const key of mismatchKeys) {
    const [productKey, date] = key.split(':');
    warnings.push({
      code: 'MOPS_LEDGER_VALUE_MISMATCH',
      productKey,
      date,
      message: `${date} ${BENCHMARK_SYMBOLS[productKey]} differs from the authoritative FCOS MOPS ledger. The affected spread is suppressed.`,
    });
  }
  for (const conflict of conflictRows || []) {
    const series = seriesById.get(conflict.series_id);
    warnings.push({
      code: conflict.conflict_code || 'SAME_DATE_SOURCE_VALUE_MISMATCH',
      productKey: series?.product_key || null,
      date: conflict.price_date,
      message: `${conflict.price_date} ${series?.source_symbol || 'market observation'} has conflicting report evidence and remains quarantined.`,
    });
  }

  const returnedPoints = panels.reduce((sum, panel) => sum + panel.series.reduce((subtotal, series) => subtotal + series.points.length, 0) + (panel.benchmark?.points.length || 0), 0);
  const matchedSpreads = panels.reduce((sum, panel) => sum + panel.series.reduce((subtotal, series) => subtotal + series.points.filter((row) => row.spread != null).length, 0), 0);
  return {
    range,
    mode,
    includeMops,
    startDate,
    endDate,
    products,
    ports,
    panels,
    coverage: {
      returnedDates: selectedDates.length,
      returnedPoints,
      matchedSpreads,
      suppressedMismatches: mismatchKeys.size,
      complete: nextCursor == null,
    },
    warnings,
    page: { cursor, nextCursor, limit: dateLimit, complete: nextCursor == null },
  };
}

export async function loadMarketIntelligenceHistory(client, body = {}) {
  const range = HISTORY_RANGES[body.range] ? body.range : '3m';
  const endDate = body.endDate ? String(body.endDate) : isoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw marketError('Choose a valid market-history end date.', 400, 'MARKET_HISTORY_DATE_INVALID');
  const startDate = dateBefore(endDate, HISTORY_RANGES[range] - 1);
  const seriesResult = await client.from('market_intelligence_series').select('*').eq('active', true).order('display_order');
  if (seriesResult.error) throw marketError(`Market history series could not be loaded: ${seriesResult.error.message}`, 502, 'MARKET_HISTORY_LOAD_FAILED');
  const products = normalizedSelection(body.products, PRODUCT_KEYS, [...PRODUCT_KEYS]);
  const availablePorts = new Set((seriesResult.data || []).filter((row) => row.market_family === 'delivered').map((row) => row.port_key));
  const ports = normalizedSelection(body.ports, availablePorts, [...availablePorts]);
  const selectedSeries = (seriesResult.data || []).filter((row) => (
    (row.market_family === 'delivered' && products.includes(row.product_key) && ports.includes(row.port_key))
    || (row.market_family === 'cargo' && products.includes(row.product_key) && BENCHMARK_SYMBOLS[row.product_key] === row.source_symbol)
  ));
  const seriesIds = selectedSeries.map((row) => row.id);
  const [observationRows, ledgerResult, conflictsResult] = await Promise.all([
    loadCanonicalObservations(client, seriesIds, startDate, endDate),
    client.from('hedge_market_prices').select('price_date,s380,s05,sgo,is_estimate').gte('price_date', startDate).lte('price_date', endDate).order('price_date'),
    client.from('market_observation_evidence').select('series_id,price_date,conflict_code').in('series_id', seriesIds).eq('disposition', 'quarantined').gte('price_date', startDate).lte('price_date', endDate).order('price_date').limit(1000),
  ]);
  const error = ledgerResult.error || conflictsResult.error;
  if (error) throw marketError(`Market history validation could not be loaded: ${error.message}`, 502, 'MARKET_HISTORY_LOAD_FAILED');
  return buildMarketHistoryResponse(seriesResult.data || [], observationRows, ledgerResult.data || [], conflictsResult.data || [], { ...body, range, endDate, products, ports });
}

export async function importMarketReport(client, profile, body = {}) {
  if (body.entitlementConfirmed !== true) throw marketError('Confirm that FCOS is licensed to store the selected report data.', 400, 'MARKET_REPORT_ENTITLEMENT_REQUIRED');
  const preview = await previewMarketReport(body);
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 200) throw marketError('A valid idempotency key is required.', 400, 'MARKET_REPORT_IDEMPOTENCY_REQUIRED');
  const result = await client.rpc('save_market_report_import', {
    p_idempotency_key: idempotencyKey,
    p_source_document_type: preview.documentType,
    p_source_hash: preview.sourceHash,
    p_report_date: preview.reportDate,
    p_observations: preview.observations,
    p_actor_user_id: profile.id,
    p_actor_email: String(profile.email || '').toLowerCase(),
  });
  if (result.error) throw marketError(`The market report could not be imported: ${result.error.message}`, 502, 'MARKET_REPORT_IMPORT_FAILED');
  return { ...result.data, preview };
}

export const marketReportLimits = Object.freeze({ maxBytes: MAX_REPORT_BYTES });
