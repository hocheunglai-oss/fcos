import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { marketIntelligenceTradingInternals } from './_marketIntelligenceTrading.js';

const SOURCE_TYPES = new Set(['morning_indication', 'asia_moc_reference']);
const PRODUCT_KEYS = new Set(['hsfo380', 'vlsfo', 'lsmgo', 'brent', 'ice_gasoil']);
const CORE_PRODUCTS = new Set(['hsfo380', 'vlsfo', 'lsmgo']);
const PRODUCT_UNITS = Object.freeze({
  hsfo380: 'USD/MT',
  vlsfo: 'USD/MT',
  lsmgo: 'USD/BBL',
  brent: 'USD/BBL',
  ice_gasoil: 'USD/MT',
});
const PRODUCT_LABELS = Object.freeze({
  hsfo380: 'HSFO 380',
  vlsfo: 'S0.5%',
  lsmgo: 'SGO 10 ppm',
  brent: 'ICE Brent',
  ice_gasoil: 'ICE Gasoil',
});
const OFFICIAL_SYMBOLS = Object.freeze({
  hsfo380: new Set(['FPLSM01', 'FPLSM02']),
  vlsfo: new Set(['FOFS000', 'FOFS001', 'FOFS002']),
  lsmgo: new Set(['BSGSL00', 'MSGSL00', 'MSHSL00']),
});
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MONTHS = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 });

function intradayError(message, statusCode = 400, code = 'MARKET_INTRADAY_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hktParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw intradayError('Choose a valid receipt time.', 400, 'MARKET_INTRADAY_RECEIPT_INVALID');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function hktToday(value = new Date()) {
  const parts = hktParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isoDate(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized ? null : normalized;
}

function isoMonth(value) {
  const normalized = String(value || '').trim();
  const candidate = /^\d{4}-\d{2}$/.test(normalized) ? `${normalized}-01` : normalized;
  const date = isoDate(candidate);
  return date?.endsWith('-01') ? date : null;
}

function decimalPrecision(rawValue) {
  const match = String(rawValue ?? '').replaceAll(',', '').match(/\.(\d+)/);
  return Math.min(6, match?.[1]?.length || 0);
}

function numeric(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', '').replace(/[()+]/g, '').replace('−', '-'));
  return Number.isFinite(parsed) ? parsed : null;
}

function signedNumeric(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim().replaceAll(',', '').replace('−', '-');
  const negativeParentheses = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[()+]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negativeParentheses ? -Math.abs(parsed) : parsed;
}

function contractMonthFromText(value, marketDate) {
  const direct = isoMonth(value);
  if (direct) return direct;
  const text = String(value || '').trim().toLowerCase().replace(/[.,]/g, ' ');
  const match = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:[\s\/-]*((?:\d{2}|\d{4})))?\b/i);
  if (!match) return null;
  const reportYear = Number(String(marketDate).slice(0, 4));
  const reportMonth = Number(String(marketDate).slice(5, 7));
  let year = match[2] ? Number(match[2]) : reportYear;
  if (year < 100) year += 2000;
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  if (!match[2] && month < reportMonth - 6) year += 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function marketDateFromText(value, receivedAt) {
  const direct = isoDate(value);
  if (direct) return { value: direct, inferredYear: false };
  const text = String(value || '').trim();
  const parts = hktParts(receivedAt);
  const numericMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numericMatch) {
    let year = numericMatch[3] ? Number(numericMatch[3]) : Number(parts.year);
    if (year < 100) year += 2000;
    const candidate = `${year}-${String(Number(numericMatch[1])).padStart(2, '0')}-${String(Number(numericMatch[2])).padStart(2, '0')}`;
    return { value: isoDate(candidate), inferredYear: !numericMatch[3] };
  }
  const monthMatch = text.match(/\b(\d{1,2})[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:[\s-]+(\d{2,4}))?\b/i);
  if (monthMatch) {
    let year = monthMatch[3] ? Number(monthMatch[3]) : Number(parts.year);
    if (year < 100) year += 2000;
    const candidate = `${year}-${String(MONTHS[monthMatch[2].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${String(Number(monthMatch[1])).padStart(2, '0')}`;
    return { value: isoDate(candidate), inferredYear: !monthMatch[3] };
  }
  return { value: null, inferredYear: false };
}

function rowProduct(line) {
  const normalized = String(line || '').toLowerCase();
  if (/\b180\s*(?:cst)?\b/.test(normalized)) return 'ignored_180';
  if (/\b(?:380|hsfo)\b/.test(normalized)) return 'hsfo380';
  if (/\b(?:m?0\.5%?|vlsfo)\b/.test(normalized)) return 'vlsfo';
  if (/\b(?:sgo|go\s*10\s*ppm|gasoil\s*10\s*ppm)\b/.test(normalized)) return 'lsmgo';
  if (/\bbrent\b/.test(normalized)) return 'brent';
  if (/\bice\s*gasoil\b/.test(normalized)) return 'ice_gasoil';
  return null;
}

function withoutProductToken(line, productKey) {
  const patterns = {
    hsfo380: /\b(?:380(?:\s*cst)?|hsfo(?:\s*380)?)\b/i,
    vlsfo: /\b(?:m?0\.5%?|vlsfo)\b/i,
    lsmgo: /\b(?:sgo|go\s*10\s*ppm|gasoil\s*10\s*ppm)\b/i,
    brent: /\bbrent\b/i,
    ice_gasoil: /\bice\s*gasoil\b/i,
  };
  return String(line || '').replace(patterns[productKey], ' ');
}

function normalizeObservation(row, sourceType, marketDate, itemOrder = 1) {
  const productKey = String(row?.productKey || '').trim().toLowerCase();
  if (!PRODUCT_KEYS.has(productKey)) throw intradayError(`Row ${itemOrder}: choose a supported product.`, 400, 'MARKET_INTRADAY_PRODUCT_INVALID');
  const quoteState = String(row?.quoteState || '').trim().toLowerCase();
  const allowedStates = sourceType === 'morning_indication' ? ['last_close', 'current_indication'] : ['moc_reference'];
  if (!allowedStates.includes(quoteState)) throw intradayError(`Row ${itemOrder}: the quote state does not match the source.`, 400, 'MARKET_INTRADAY_QUOTE_STATE_INVALID');
  const contractMonth = contractMonthFromText(row?.contractMonth || row?.contractMonthText, marketDate);
  if (!contractMonth) throw intradayError(`Row ${itemOrder}: enter an exact contract month.`, 400, 'MARKET_INTRADAY_CONTRACT_MONTH_REQUIRED');
  const unit = String(row?.unit || PRODUCT_UNITS[productKey]).trim().toUpperCase();
  if (unit !== PRODUCT_UNITS[productKey]) throw intradayError(`Row ${itemOrder}: ${PRODUCT_LABELS[productKey]} must use ${PRODUCT_UNITS[productKey]}.`, 400, 'MARKET_INTRADAY_UNIT_INVALID');
  const price = numeric(row?.price);
  if (price == null || price <= 0) throw intradayError(`Row ${itemOrder}: enter a positive price.`, 400, 'MARKET_INTRADAY_PRICE_REQUIRED');
  const reportedChange = signedNumeric(row?.reportedChange);
  const precision = Number.isInteger(Number(row?.decimalPrecision))
    ? Math.min(6, Math.max(0, Number(row.decimalPrecision)))
    : decimalPrecision(row?.price);
  return { itemOrder, productKey, productLabel: PRODUCT_LABELS[productKey], quoteState, contractMonth, unit, price, reportedChange, decimalPrecision: precision };
}

function uniqueRows(rows) {
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.productKey}:${row.quoteState}:${row.contractMonth}`;
    if (seen.has(key)) throw intradayError(`Duplicate ${row.productLabel} ${row.quoteState} ${row.contractMonth.slice(0, 7)} row.`, 400, 'MARKET_INTRADAY_DUPLICATE_ROW');
    seen.add(key);
  }
  return rows;
}

export function parseMarketIntradayText(text, { receivedAt = new Date().toISOString() } = {}) {
  const source = String(text || '');
  if (!source.trim() || source.length > MAX_TEXT_CHARS) throw intradayError('Paste a market reference of 20,000 characters or fewer.', 400, 'MARKET_INTRADAY_TEXT_INVALID');
  const dateCandidate = marketDateFromText(source, receivedAt);
  const marketDate = dateCandidate.value;
  const warnings = [];
  if (!marketDate) warnings.push('Market date was not detected. Enter it before confirmation.');
  if (dateCandidate.inferredYear) warnings.push(`The year ${String(receivedAt).slice(0, 4)} was inferred from the receipt time. Review it before confirmation.`);
  const ignoredRows = [];
  const parsed = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const productKey = rowProduct(line);
    if (productKey === 'ignored_180') {
      ignoredRows.push({ label: '180 CST', reason: '180 CST is outside the configured FCOS intraday market set.' });
      continue;
    }
    if (!productKey) continue;
    const contractText = line.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:[\s\/-]*(?:\d{2}|\d{4}))?\b/i)?.[0];
    const valueText = withoutProductToken(line.replace(contractText, ' '), productKey);
    const candidates = [...valueText.matchAll(/[+−-]?\(?\d[\d,]*(?:\.\d+)?\)?/g)].map((match) => match[0]);
    const priceText = candidates[0];
    const changeText = candidates[1];
    if (!contractText || numeric(priceText) == null) continue;
    parsed.push({ productKey, quoteState: 'moc_reference', contractMonthText: contractText, unit: PRODUCT_UNITS[productKey], price: numeric(priceText), reportedChange: signedNumeric(changeText), decimalPrecision: decimalPrecision(priceText) });
  }
  const observations = marketDate ? uniqueRows(parsed.map((row, index) => normalizeObservation(row, 'asia_moc_reference', marketDate, index + 1))) : parsed;
  if (!observations.length) warnings.push('No supported MOC rows were detected. Add or correct rows before confirmation.');
  return { sourceType: 'asia_moc_reference', marketDate, observations, ignoredRows, warnings, requiresReview: true };
}

function previewSecret(env = process.env) {
  const secret = String(env.MARKET_INTRADAY_PREVIEW_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (secret.length < 32) throw intradayError('Intraday review signing is not configured.', 503, 'MARKET_INTRADAY_PREVIEW_SECRET_MISSING');
  return secret;
}

function signPreview(payload, secret, now = Date.now()) {
  const encoded = Buffer.from(JSON.stringify({ ...payload, issuedAt: now, expiresAt: now + PREVIEW_TTL_MS })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`market-intraday-preview-v1:${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPreview(token, secret, now = Date.now()) {
  const [encoded, signature, ...rest] = String(token || '').split('.');
  if (!encoded || !signature || rest.length) throw intradayError('The intraday review is invalid. Reopen the source.', 409, 'MARKET_INTRADAY_PREVIEW_INVALID');
  const expected = createHmac('sha256', secret).update(`market-intraday-preview-v1:${encoded}`).digest('base64url');
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) throw intradayError('The intraday review is invalid. Reopen the source.', 409, 'MARKET_INTRADAY_PREVIEW_INVALID');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()); } catch { throw intradayError('The intraday review is invalid. Reopen the source.', 409, 'MARKET_INTRADAY_PREVIEW_INVALID'); }
  if (!Number.isFinite(payload?.expiresAt) || payload.expiresAt <= now) throw intradayError('The intraday review expired. Reopen the source.', 409, 'MARKET_INTRADAY_PREVIEW_EXPIRED');
  return payload;
}

function validImageBuffer(buffer, mimeType) {
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  return false;
}

async function extractMorningImage(buffer, mimeType, { apiKey, model, fetchImpl, safetyIdentifier }) {
  if (!apiKey) throw intradayError('Morning image extraction is not configured.', 503, 'MARKET_INTRADAY_OPENAI_KEY_MISSING');
  const schema = {
    type: 'object', additionalProperties: false, required: ['marketDateText', 'observations', 'ignoredRows', 'warnings'], properties: {
      marketDateText: { type: ['string', 'null'] },
      observations: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['sourceLabel', 'productKey', 'quoteState', 'contractMonthText', 'priceText', 'reportedChangeText', 'unit'], properties: {
        sourceLabel: { type: 'string' }, productKey: { type: 'string', enum: [...PRODUCT_KEYS] }, quoteState: { type: 'string', enum: ['last_close', 'current_indication'] }, contractMonthText: { type: 'string' }, priceText: { type: 'string' }, reportedChangeText: { type: ['string', 'null'] }, unit: { type: 'string', enum: ['USD/MT', 'USD/BBL'] },
      } } },
      ignoredRows: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['label', 'reason'], properties: { label: { type: 'string' }, reason: { type: 'string' } } } },
      warnings: { type: 'array', maxItems: 20, items: { type: 'string' } },
    },
  };
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model, store: false, max_output_tokens: 2500, reasoning: { effort: 'low' }, safety_identifier: safetyIdentifier,
        input: [{ role: 'system', content: [{ type: 'input_text', text: 'Extract the market table exactly. Do not infer missing prices, changes, units, dates, or contracts. Ignore every 180 CST row and report it in ignoredRows. Use hsfo380 for 380 CST, vlsfo for M0.5/0.5%, lsmgo for GO 10ppm, brent for Brent, and ice_gasoil for ICE Gasoil. A Last Crude/Gasoil Close row is last_close; Current and swaps-indication rows are current_indication. Return strings at displayed precision. Brent and SGO use USD/BBL; all other configured products use USD/MT.' }] }, { role: 'user', content: [{ type: 'input_image', image_url: `data:${mimeType};base64,${buffer.toString('base64')}` }, { type: 'input_text', text: 'Extract this reviewed morning paper indication.' }] }],
        text: { format: { type: 'json_schema', name: 'market_intraday_image_preview', strict: true, schema } },
      }),
    });
  } catch {
    throw intradayError('Morning image extraction is temporarily unavailable.', 503, 'MARKET_INTRADAY_VISION_UNAVAILABLE');
  }
  if (!response.ok) throw intradayError('Morning image extraction is temporarily unavailable.', 503, 'MARKET_INTRADAY_VISION_FAILED');
  const payload = await response.json();
  const output = payload.output_text || payload.output?.flatMap((row) => row.content || []).find((row) => row.type === 'output_text')?.text;
  try { return JSON.parse(output || '{}'); } catch { throw intradayError('The image extraction response could not be reviewed.', 502, 'MARKET_INTRADAY_VISION_INVALID'); }
}

export async function previewMarketIntradaySnapshot(profile, body = {}, dependencies = {}) {
  const sourceType = String(body.sourceType || '').trim();
  if (!SOURCE_TYPES.has(sourceType)) throw intradayError('Choose Morning image or MOC reference.', 400, 'MARKET_INTRADAY_SOURCE_REQUIRED');
  const receivedAt = new Date(body.receivedAt || dependencies.now || Date.now()).toISOString();
  let preview;
  let sourceHash;
  if (sourceType === 'asia_moc_reference') {
    const sourceText = String(body.text || '');
    preview = parseMarketIntradayText(sourceText, { receivedAt });
    sourceHash = hash(Buffer.from(sourceText, 'utf8'));
  } else {
    const mimeType = String(body.mimeType || '').toLowerCase();
    const encoded = String(body.imageBase64 || '');
    if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16) throw intradayError('Choose an image no larger than 5 MB.', 413, 'MARKET_INTRADAY_IMAGE_TOO_LARGE');
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES || !validImageBuffer(buffer, mimeType)) throw intradayError('Choose a valid PNG, JPEG or WebP image no larger than 5 MB.', 400, 'MARKET_INTRADAY_IMAGE_INVALID');
    const extracted = await extractMorningImage(buffer, mimeType, {
      apiKey: String(dependencies.apiKey || process.env.OPENAI_API_KEY || '').trim(),
      model: String(dependencies.model || process.env.OPENAI_MARKET_INTRADAY_MODEL || 'gpt-5-mini'),
      fetchImpl: dependencies.fetchImpl || fetch,
      safetyIdentifier: hash(String(profile?.id || profile?.email || 'market-user')),
    });
    const dateCandidate = marketDateFromText(extracted.marketDateText, receivedAt);
    const warnings = [...(extracted.warnings || [])];
    if (!dateCandidate.value) warnings.push('Market date was not detected. Enter it before confirmation.');
    if (dateCandidate.inferredYear) warnings.push(`The year ${hktParts(receivedAt).year} was inferred from the receipt time. Review it before confirmation.`);
    const ignored180 = (extracted.observations || []).filter((row) => /\b180\s*(?:cst)?\b/i.test(String(row.sourceLabel || '')));
    const extractedRows = (extracted.observations || []).filter((row) => !/\b180\s*(?:cst)?\b/i.test(String(row.sourceLabel || '')));
    const observations = dateCandidate.value ? uniqueRows(extractedRows.map((row, index) => normalizeObservation({ ...row, contractMonth: row.contractMonthText, price: row.priceText, reportedChange: row.reportedChangeText, decimalPrecision: decimalPrecision(row.priceText) }, sourceType, dateCandidate.value, index + 1))) : extractedRows;
    preview = { sourceType, marketDate: dateCandidate.value, observations, ignoredRows: [...(extracted.ignoredRows || []), ...ignored180.map(() => ({ label: '180 CST', reason: '180 CST is outside the configured FCOS intraday market set.' }))], warnings, requiresReview: true };
    sourceHash = hash(buffer);
  }
  const token = signPreview({ sourceType, sourceHash, actorId: profile.id, receivedAt }, previewSecret(dependencies.env));
  return { ...preview, receivedAt, sourceHash, previewToken: token, rawSourceStored: false };
}

function marketTimestamp(sourceType, marketDate, receivedAt) {
  if (sourceType === 'asia_moc_reference') return `${marketDate}T16:30:00+08:00`;
  return receivedAt;
}

export async function saveMarketIntradaySnapshot(client, profile, body = {}, dependencies = {}) {
  const token = verifyPreview(body.previewToken, previewSecret(dependencies.env));
  if (token.actorId !== profile.id) throw intradayError('This intraday review belongs to another user.', 403, 'MARKET_INTRADAY_PREVIEW_ACTOR_MISMATCH');
  const sourceType = String(body.sourceType || token.sourceType || '');
  if (sourceType !== token.sourceType || !SOURCE_TYPES.has(sourceType)) throw intradayError('The reviewed source type changed. Reopen it.', 409, 'MARKET_INTRADAY_SOURCE_CHANGED');
  const marketDate = isoDate(body.marketDate);
  if (!marketDate) throw intradayError('Enter an exact market date before confirmation.', 400, 'MARKET_INTRADAY_MARKET_DATE_REQUIRED');
  const receivedAt = new Date(body.receivedAt || token.receivedAt).toISOString();
  const observations = uniqueRows((body.observations || []).map((row, index) => normalizeObservation(row, sourceType, marketDate, index + 1)));
  if (!observations.length || observations.length > 50) throw intradayError('Review at least one supported price and no more than 50.', 400, 'MARKET_INTRADAY_OBSERVATIONS_REQUIRED');
  const payload = { sourceType, marketDate, receivedAt, sourceHash: token.sourceHash, supersedesSnapshotId: body.supersedesSnapshotId || null, observations: observations.map(({ productLabel, ...row }) => row) };
  const payloadHash = hash(JSON.stringify(payload));
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 200) throw intradayError('A valid idempotency key is required.', 400, 'MARKET_INTRADAY_IDEMPOTENCY_REQUIRED');
  const result = await client.rpc('save_market_intraday_snapshot', {
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_source_type: sourceType,
    p_market_date: marketDate,
    p_market_at: marketTimestamp(sourceType, marketDate, receivedAt),
    p_received_at: receivedAt,
    p_source_hash: token.sourceHash,
    p_supersedes_snapshot_id: body.supersedesSnapshotId || null,
    p_observations: payload.observations,
    p_actor_user_id: profile.id,
    p_actor_email: String(profile.email || '').toLowerCase(),
  });
  if (result.error) throw intradayError(`The provisional snapshot could not be saved: ${result.error.message}`, 409, 'MARKET_INTRADAY_SAVE_FAILED');
  return { ...result.data, timeline: await loadMarketIntradayTimeline(client, { date: marketDate }) };
}

function latestSnapshots(rows) {
  const byType = new Map();
  for (const row of rows || []) if (!byType.has(row.source_type)) byType.set(row.source_type, row);
  return [...byType.values()];
}

function monthOffset(baseMonth, candidateMonth) {
  const [baseYear, base] = baseMonth.slice(0, 7).split('-').map(Number);
  const [year, month] = candidateMonth.slice(0, 7).split('-').map(Number);
  return (year - baseYear) * 12 + month - base;
}

function structureForSnapshot(snapshot, observations) {
  const byProduct = new Map();
  for (const row of observations) {
    if (!CORE_PRODUCTS.has(row.product_key)) continue;
    const offsets = byProduct.get(row.product_key) || new Map();
    offsets.set(monthOffset(snapshot.market_date, row.contract_month), row);
    byProduct.set(row.product_key, offsets);
  }
  return [...byProduct.entries()].map(([productKey, rows]) => {
    const bm = rows.get(0); const m1 = rows.get(1); const m2 = rows.get(2);
    return {
      productKey, productLabel: PRODUCT_LABELS[productKey], unit: PRODUCT_UNITS[productKey],
      bmM1: bm && m1 ? Number(bm.price) - Number(m1.price) : null,
      m1M2: m1 && m2 ? Number(m1.price) - Number(m2.price) : null,
    };
  });
}

function exactMovements(morningRows, mocRows) {
  const morning = new Map(morningRows.filter((row) => row.quote_state === 'current_indication').map((row) => [`${row.product_key}:${row.contract_month}:${row.unit}`, row]));
  return mocRows.map((row) => {
    const match = morning.get(`${row.product_key}:${row.contract_month}:${row.unit}`);
    return { productKey: row.product_key, productLabel: PRODUCT_LABELS[row.product_key], contractMonth: row.contract_month, unit: row.unit, morningPrice: match ? Number(match.price) : null, mocPrice: Number(row.price), movement: match ? Number(row.price) - Number(match.price) : null, available: Boolean(match) };
  });
}

async function provisionalEstimates(client, snapshots, observations) {
  const candidates = observations.filter((row) => CORE_PRODUCTS.has(row.product_key) && monthOffset(snapshots.find((snapshot) => snapshot.id === row.snapshot_id)?.market_date || '', row.contract_month) === 0);
  if (!candidates.length) return [];
  const earliest = candidates.map((row) => row.contract_month).sort()[0];
  const latestDate = snapshots.map((row) => row.market_date).sort().at(-1);
  const result = await client.from('hedge_market_prices').select('price_date,s380,s05,sgo,is_estimate').gte('price_date', earliest).lt('price_date', latestDate).eq('is_estimate', false).order('price_date');
  if (result.error) return [];
  const field = { hsfo380: 's380', vlsfo: 's05', lsmgo: 'sgo' };
  return candidates.map((row) => {
    const snapshot = snapshots.find((item) => item.id === row.snapshot_id);
    const days = marketIntelligenceTradingInternals.reviewedPublicationDays(row.contract_month, 'asia_moc');
    if (!days) return { snapshotId: snapshot.id, productKey: row.product_key, available: false, reason: 'Publication calendar unavailable' };
    const actualDays = days.filter((day) => day < snapshot.market_date);
    const remainingDays = days.filter((day) => day >= snapshot.market_date);
    const actualValues = actualDays.map((day) => result.data.find((item) => item.price_date === day)?.[field[row.product_key]]).map(Number).filter(Number.isFinite);
    if (actualValues.length !== actualDays.length || !remainingDays.length) return { snapshotId: snapshot.id, productKey: row.product_key, available: false, reason: 'Complete prior publication history is unavailable' };
    const value = (actualValues.reduce((sum, item) => sum + item, 0) + Number(row.price) * remainingDays.length) / days.length;
    return { snapshotId: snapshot.id, productKey: row.product_key, productLabel: PRODUCT_LABELS[row.product_key], unit: row.unit, available: true, value, actualDays: actualDays.length, provisionalDays: remainingDays.length, contractMonth: row.contract_month };
  });
}

function reconciliationProjection(rows) {
  const latest = new Map();
  for (const row of rows || []) if (!latest.has(row.intraday_observation_id)) latest.set(row.intraday_observation_id, row);
  return latest;
}

export async function loadMarketIntradayTimeline(client, body = {}) {
  const date = isoDate(body.date) || hktToday();
  const [snapshotResult, adjacentResult] = await Promise.all([
    client.from('market_intraday_snapshots').select('*').eq('market_date', date).order('revision', { ascending: false }).order('created_at', { ascending: false }),
    client.from('market_intraday_snapshots').select('market_date').order('market_date', { ascending: false }).limit(1000),
  ]);
  if (snapshotResult.error || adjacentResult.error) throw intradayError('Intraday market history could not be loaded.', 502, 'MARKET_INTRADAY_TIMELINE_FAILED');
  const snapshots = latestSnapshots(snapshotResult.data || []);
  const snapshotIds = snapshots.map((row) => row.id);
  let observations = [];
  let reconciliations = [];
  if (snapshotIds.length) {
    const [observationResult, reconciliationResult] = await Promise.all([
      client.from('market_intraday_observations').select('*').in('snapshot_id', snapshotIds).order('item_order'),
      client.from('market_intraday_reconciliations').select('*').in('intraday_observation_id', (await client.from('market_intraday_observations').select('id').in('snapshot_id', snapshotIds)).data?.map((row) => row.id) || []).order('created_at', { ascending: false }),
    ]);
    if (observationResult.error || reconciliationResult.error) throw intradayError('Intraday market evidence could not be loaded.', 502, 'MARKET_INTRADAY_TIMELINE_FAILED');
    observations = observationResult.data || [];
    reconciliations = reconciliationResult.data || [];
  }
  const reconciliationByObservation = reconciliationProjection(reconciliations);
  const snapshotProjection = snapshots.map((snapshot) => ({
    id: snapshot.id, sourceType: snapshot.source_type, marketDate: snapshot.market_date, marketAt: snapshot.market_at, receivedAt: snapshot.received_at, revision: Number(snapshot.revision), actorEmail: snapshot.actor_email,
    observations: observations.filter((row) => row.snapshot_id === snapshot.id).map((row) => ({
      id: row.id, productKey: row.product_key, productLabel: PRODUCT_LABELS[row.product_key], quoteState: row.quote_state, contractMonth: row.contract_month, unit: row.unit, price: Number(row.price), reportedChange: row.reported_change == null ? null : Number(row.reported_change), decimalPrecision: Number(row.decimal_precision), reconciliation: reconciliationByObservation.get(row.id) || null,
    })),
  }));
  const morning = snapshotProjection.find((row) => row.sourceType === 'morning_indication');
  const moc = snapshotProjection.find((row) => row.sourceType === 'asia_moc_reference');
  const availableDates = [...new Set((adjacentResult.data || []).map((row) => row.market_date))].sort();
  const position = availableDates.indexOf(date);
  return {
    displayedDate: date,
    previousDate: position > 0 ? availableDates[position - 1] : availableDates.filter((value) => value < date).at(-1) || null,
    nextDate: position >= 0 && position < availableDates.length - 1 ? availableDates[position + 1] : availableDates.find((value) => value > date) || null,
    snapshots: snapshotProjection,
    morningToMoc: morning && moc ? exactMovements(morning.observations.map((row) => ({ ...row, product_key: row.productKey, quote_state: row.quoteState, contract_month: row.contractMonth })), moc.observations.map((row) => ({ ...row, product_key: row.productKey, contract_month: row.contractMonth }))) : [],
    structures: snapshotProjection.flatMap((snapshot) => structureForSnapshot({ id: snapshot.id, market_date: snapshot.marketDate }, snapshot.observations.map((row) => ({ ...row, product_key: row.productKey, contract_month: row.contractMonth, price: row.price }))).map((row) => ({ ...row, snapshotId: snapshot.id, sourceType: snapshot.sourceType }))),
    provisionalEstimates: await provisionalEstimates(client, snapshots, observations),
    methodology: 'Provisional paper references are reviewed inputs only. Official MOPS, alerts and hedge valuation are unchanged.',
  };
}

export async function reconcileMarketIntradayDate(client, marketDate, actor = {}) {
  const date = isoDate(marketDate);
  if (!date) return { insertedCount: 0 };
  const snapshotsResult = await client.from('market_intraday_snapshots').select('id,source_type,revision').eq('market_date', date).order('revision', { ascending: false });
  if (snapshotsResult.error || !(snapshotsResult.data || []).length) return { insertedCount: 0 };
  const snapshotIds = latestSnapshots(snapshotsResult.data).map((row) => row.id);
  const [intradayResult, officialResult] = await Promise.all([
    client.from('market_intraday_observations').select('*').in('snapshot_id', snapshotIds).in('product_key', [...CORE_PRODUCTS]),
    client.from('market_price_observations').select('id,series_id,price_date,price,source_hash,contract_month,observation_unit,quality_status,series:market_intelligence_series!inner(source_symbol,product_key,basis_metadata)').eq('price_date', date).eq('quality_status', 'verified'),
  ]);
  if (intradayResult.error || officialResult.error) return { insertedCount: 0 };
  const rows = [];
  for (const provisional of intradayResult.data || []) {
    const official = (officialResult.data || []).find((candidate) => {
      const series = candidate.series;
      const productKey = series?.basis_metadata?.productKey || series?.product_key;
      return productKey === provisional.product_key && OFFICIAL_SYMBOLS[provisional.product_key]?.has(series?.source_symbol) && candidate.contract_month === provisional.contract_month && String(candidate.observation_unit || '').toUpperCase() === provisional.unit;
    });
    const precision = Number(provisional.decimal_precision);
    const roundedProvisional = Number(Number(provisional.price).toFixed(precision));
    const roundedOfficial = official ? Number(Number(official.price).toFixed(precision)) : null;
    const status = !official ? 'official_mark_unavailable' : roundedOfficial === roundedProvisional ? 'matched' : 'revised_by_official';
    const keyBasis = `${provisional.id}:${date}:${official?.id || 'unavailable'}:${status}`;
    rows.push({ reconciliationKey: hash(keyBasis), intradayObservationId: provisional.id, officialObservationId: official?.id || null, status, officialReportDate: date, officialPrice: official ? Number(official.price) : null, difference: official ? Number(official.price) - Number(provisional.price) : null, unit: provisional.unit, officialSourceHash: official?.source_hash || null });
  }
  if (!rows.length) return { insertedCount: 0 };
  const result = await client.rpc('record_market_intraday_reconciliations', { p_rows: rows, p_actor_user_id: actor.id || null, p_actor_email: String(actor.email || 'market-sync@fcos.internal').toLowerCase() });
  if (result.error) throw intradayError(`Intraday reconciliation could not be recorded: ${result.error.message}`, 502, 'MARKET_INTRADAY_RECONCILIATION_FAILED');
  return result.data;
}

export async function loadLatestIntradayPulse(client) {
  const snapshotResult = await client.from('market_intraday_snapshots').select('*').lte('market_date', hktToday()).order('market_date', { ascending: false }).order('received_at', { ascending: false }).order('revision', { ascending: false }).limit(20);
  if (snapshotResult.error) throw intradayError('Provisional Market Pulse could not be loaded.', 502, 'MARKET_INTRADAY_PULSE_FAILED');
  const snapshot = snapshotResult.data?.[0] || null;
  if (!snapshot) return null;
  const observationResult = await client.from('market_intraday_observations').select('*').eq('snapshot_id', snapshot.id).order('item_order');
  if (observationResult.error) throw intradayError('Provisional Market Pulse could not be loaded.', 502, 'MARKET_INTRADAY_PULSE_FAILED');
  return {
    provisional: true,
    sourceType: snapshot.source_type,
    sourceLabel: snapshot.source_type === 'asia_moc_reference' ? 'Asia MOC reference · provisional' : 'Morning indication · provisional',
    marketDate: snapshot.market_date,
    marketAt: snapshot.market_at,
    receivedAt: snapshot.received_at,
    observations: (observationResult.data || []).filter((row) => row.quote_state !== 'last_close').map((row) => ({ productKey: row.product_key, productLabel: PRODUCT_LABELS[row.product_key], contractMonth: row.contract_month, unit: row.unit, price: Number(row.price), reportedChange: row.reported_change == null ? null : Number(row.reported_change), quoteState: row.quote_state })),
    officialMopsUnchanged: true,
  };
}

export const marketIntradayInternals = Object.freeze({ normalizeObservation, parseMarketIntradayText, marketDateFromText, contractMonthFromText, signPreview, verifyPreview, exactMovements, structureForSnapshot, PRODUCT_UNITS });
