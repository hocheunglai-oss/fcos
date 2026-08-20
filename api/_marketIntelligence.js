import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const MAX_REPORT_BYTES = 5_000_000;
const REPORT_TYPES = new Set(['bunkerwire', 'european_marketscan']);

const SOURCE_PAGES = Object.freeze({
  MFSPD00: 1, MFSKD00: 1, WKMFA00: 1, MFZSD00: 1, AMFSA00: 1,
  FOFS000: 1, FOFS001: 1, FOFS002: 1,
  PUAFT00: 3, PUAFR00: 3, BFDZA00: 3, AAXYO00: 3, AAXYS00: 3, MGZSD00: 3,
  CBGAP00: 5, CB1AR00: 5, CB3AN00: 5,
  FPLSM01: 4, FPLSM02: 4, FQLSM01: 4, FQLSM02: 4, MSGSL00: 4, MSHSL00: 4,
});

const EUROPEAN_SOURCE_PAGES = Object.freeze({
  AMFSA00: 3, FOFS000: 3, FOFS001: 3, FOFS002: 3,
  FPLSM01: 4, FPLSM02: 4, FQLSM01: 4, FQLSM02: 4, MSGSL00: 4, MSHSL00: 4,
});

const DOCUMENT_SYMBOLS = Object.freeze({
  bunkerwire: [
    'MFSPD00', 'MFSKD00', 'WKMFA00', 'MFZSD00', 'AMFSA00',
    'FOFS000', 'FOFS001', 'FOFS002', 'PUAFT00', 'PUAFR00', 'BFDZA00',
    'AAXYO00', 'AAXYS00', 'MGZSD00', 'CBGAP00', 'CB1AR00', 'CB3AN00',
  ],
  european_marketscan: [
    'AMFSA00', 'FOFS000', 'FOFS001', 'FOFS002',
    'FPLSM01', 'FPLSM02', 'FQLSM01', 'FQLSM02', 'MSGSL00', 'MSHSL00',
  ],
});

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
  const exact = new RegExp(`${escaped}\\s+(?:\\d+(?:\\.\\d+)?\\s*-\\s*\\d+(?:\\.\\d+)?\\s+)?(\\d+(?:\\.\\d+)?)\\s+([+-]\\d+(?:\\.\\d+)?)`, 'i').exec(text);
  if (exact) return { sourceSymbol: symbol, price: Number(exact[1]), dayChange: Number(exact[2]), sourcePage: sourcePage || null };
  const posted = new RegExp(`${escaped}\\s+(\\d+(?:\\.\\d+)?)`, 'i').exec(text);
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

function decodeReport(base64) {
  if (!base64 || typeof base64 !== 'string') throw marketError('Choose a PDF report.', 400, 'MARKET_REPORT_FILE_REQUIRED');
  let buffer;
  try {
    buffer = Buffer.from(base64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
  } catch {
    throw marketError('The PDF report could not be decoded.', 400, 'MARKET_REPORT_INVALID_FILE');
  }
  if (!buffer.length || buffer.length > MAX_REPORT_BYTES) throw marketError('The PDF report must be no larger than 5 MB.', 413, 'MARKET_REPORT_TOO_LARGE');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw marketError('Only a valid PDF report can be imported.', 400, 'MARKET_REPORT_INVALID_FILE');
  return buffer;
}

export async function previewMarketReport(body = {}) {
  const buffer = decodeReport(body.fileBase64);
  let parsed;
  try {
    parsed = await pdfParse(buffer);
  } catch {
    throw marketError('The PDF text could not be read. Use an unlocked Bunkerwire or European Marketscan report.', 400, 'MARKET_REPORT_UNREADABLE');
  }
  const preview = parseMarketReportText(parsed.text, { documentType: body.documentType, filename: body.fileName });
  return {
    ...preview,
    sourceHash: createHash('sha256').update(buffer).digest('hex'),
    sourceBytes: buffer.length,
  };
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

export function buildMarketIntelligenceSnapshot(seriesRows = [], observationRows = [], { today = new Date() } = {}) {
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
      basisNote: row.basis_note,
      displayOrder: row.display_order,
      latest: latest ? { ...latest, staleDays, stale: staleDays > 3 } : null,
      history,
    };
  });
  const cargo = series.find((row) => row.marketFamily === 'cargo' && row.productKey === 'vlsfo')?.latest || null;
  const delivered = series.filter((row) => row.marketFamily === 'delivered').map((row) => ({
    ...row,
    deliveredPremium: row.productKey === 'vlsfo' && row.latest?.price != null && cargo?.price != null
      ? Number((row.latest.price - cargo.price).toFixed(3))
      : null,
  }));
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
  };
}

export async function loadMarketIntelligence(client) {
  const [seriesResult, observationsResult, importsResult] = await Promise.all([
    client.from('market_intelligence_series').select('*').eq('active', true).order('display_order'),
    client.from('market_price_observations').select('id,series_id,price_date,price,day_change,quality_status,source_page').order('price_date', { ascending: false }).limit(5000),
    client.from('market_report_imports').select('id,source_document_type,report_date,observation_count,status,created_at,actor_email').order('created_at', { ascending: false }).limit(20),
  ]);
  const error = seriesResult.error || observationsResult.error || importsResult.error;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) return { available: false, delivered: [], cargoForward: [], signals: { relativeValue: [], forwardStructure: null, vlsfoHsfoM1: null, eastWestM1: null, gasoilM1: null, alerts: [] }, imports: [] };
    throw marketError(`Market intelligence could not be loaded: ${error.message}`, 502, 'MARKET_INTELLIGENCE_LOAD_FAILED');
  }
  return { available: true, ...buildMarketIntelligenceSnapshot(seriesResult.data || [], observationsResult.data || []), imports: importsResult.data || [] };
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
