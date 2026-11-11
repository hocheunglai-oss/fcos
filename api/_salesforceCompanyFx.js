import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { loadCompanyFxRateForDate, loadCurrentCompanyFxRate } from './_companyFxRates.js';
import { currentDeploymentRequestSafety, deploymentRequestSafety } from './_deploymentReadOnly.js';
import { deploymentSafeSupabaseFetch } from './_deploymentReadOnlyFetch.js';
import { serverSupabaseConfig } from './_supabaseConfig.js';

const MAX_BODY_BYTES = 2 * 1024;
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;
const PURPOSES = new Set(['preview', 'confirmation', 'payment']);
const EVENT_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SIGNATURE_HEADERS = new Set(['x-salesforce-org-id', 'x-salesforce-event-id', 'x-salesforce-timestamp', 'x-salesforce-signature']);

function companyFxRequestError(message, status = 400, code = 'SALESFORCE_COMPANY_FX_REJECTED', expose = status < 500) {
  return Object.assign(new Error(message), { status, statusCode: status, code, expose });
}

function nonBlank(value) {
  return String(value || '').trim();
}

function headerValue(headers, name) {
  if (!headers) return '';
  const expected = name.toLowerCase();
  const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() === expected);
  return entries.length === 1 && typeof entries[0][1] === 'string' ? nonBlank(entries[0][1]) : '';
}

function validIsoDate(value) {
  const source = nonBlank(value);
  if (!ISO_DATE.test(source)) return false;
  const timestamp = new Date(`${source}T00:00:00.000+08:00`);
  return Number.isFinite(timestamp.getTime())
    && timestamp.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) === source;
}

function normalizedSignature(value) {
  const match = nonBlank(value).match(/^sha256=([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : '';
}

function timingSafeHexEqual(actual, expected) {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function currentNow(now) {
  const value = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(Number(value))) throw new Error('A finite clock is required.');
  return Number(value);
}

export function configuredSalesforceCompanyFxEnvironment(env = process.env) {
  const key = nonBlank(env.SALESFORCE_COMPANY_FX_ENVIRONMENT).toLowerCase();
  if (!['devee', 'qat', 'production'].includes(key)) {
    throw companyFxRequestError('SALESFORCE_COMPANY_FX_ENVIRONMENT must be configured as devee, qat, or production.', 500, 'SALESFORCE_COMPANY_FX_ENVIRONMENT_INVALID', false);
  }
  return fcosSalesforceEnvironment(key);
}

export function salesforceCompanyFxSignature({ secret, timestamp, requestId, rawBody }) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${requestId}.`)
    .update(rawBody)
    .digest('hex');
}

export function verifySalesforceCompanyFxRequest({ headers, rawBody, env = process.env, now = Date.now }) {
  const secret = nonBlank(env.SALESFORCE_COMPANY_FX_SIGNING_SECRET);
  if (!secret) {
    throw companyFxRequestError('SALESFORCE_COMPANY_FX_SIGNING_SECRET is not configured.', 500, 'SALESFORCE_COMPANY_FX_SECRET_MISSING', false);
  }
  const environment = configuredSalesforceCompanyFxEnvironment(env);
  const orgId = headerValue(headers, 'x-salesforce-org-id');
  const requestId = headerValue(headers, 'x-salesforce-event-id');
  const timestamp = headerValue(headers, 'x-salesforce-timestamp');
  const signature = normalizedSignature(headerValue(headers, 'x-salesforce-signature'));
  const timestampMs = Date.parse(timestamp);

  if (orgId !== environment.orgId) {
    throw companyFxRequestError('Salesforce org ID is not allowed.', 403, 'SALESFORCE_COMPANY_FX_ORG_MISMATCH');
  }
  if (!EVENT_ID.test(requestId)) {
    throw companyFxRequestError('Salesforce event ID is missing or invalid.', 401, 'SALESFORCE_COMPANY_FX_EVENT_ID_INVALID');
  }
  if (!Number.isFinite(timestampMs) || Math.abs(currentNow(now) - timestampMs) > MAX_REQUEST_AGE_MS) {
    throw companyFxRequestError('Salesforce request timestamp is missing or stale.', 401, 'SALESFORCE_COMPANY_FX_STALE_TIMESTAMP');
  }
  const expected = salesforceCompanyFxSignature({ secret, timestamp, requestId, rawBody });
  if (!timingSafeHexEqual(signature, expected)) {
    throw companyFxRequestError('Salesforce request signature is invalid.', 401, 'SALESFORCE_COMPANY_FX_INVALID_SIGNATURE');
  }
  return { environment, orgId, requestId, timestamp };
}

export async function readSalesforceCompanyFxRawBody(req) {
  const contentLength = Number(headerValue(req?.headers, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw companyFxRequestError('Salesforce company FX request is too large.', 413, 'SALESFORCE_COMPANY_FX_REQUEST_TOO_LARGE');
  }
  // Reading Vercel's lazy req.body accessor can consume the signed byte stream.
  const suppliedBody = req && Object.getOwnPropertyDescriptor(req, 'body')?.value;
  if (typeof suppliedBody === 'string' || Buffer.isBuffer(suppliedBody)) {
    const rawBody = Buffer.isBuffer(suppliedBody) ? suppliedBody : Buffer.from(suppliedBody, 'utf8');
    if (rawBody.length > MAX_BODY_BYTES) {
      throw companyFxRequestError('Salesforce company FX request is too large.', 413, 'SALESFORCE_COMPANY_FX_REQUEST_TOO_LARGE');
    }
    return rawBody;
  }
  if (suppliedBody && typeof suppliedBody === 'object') {
    throw companyFxRequestError('Salesforce company FX requests require an unparsed raw JSON body.', 400, 'SALESFORCE_COMPANY_FX_RAW_BODY_REQUIRED');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      throw companyFxRequestError('Salesforce company FX request is too large.', 413, 'SALESFORCE_COMPANY_FX_REQUEST_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

export function parseSalesforceCompanyFxPayload(rawBody) {
  let body;
  try { body = JSON.parse(Buffer.isBuffer(rawBody) ? new TextDecoder('utf-8', { fatal: true }).decode(rawBody) : rawBody); } catch {
    throw companyFxRequestError('Salesforce company FX request must contain valid JSON.', 400, 'SALESFORCE_COMPANY_FX_INVALID_JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw companyFxRequestError('Salesforce company FX request must be a JSON object.', 400, 'SALESFORCE_COMPANY_FX_INVALID_PAYLOAD');
  }
  const keys = Object.keys(body);
  if (keys.some((key) => !['purpose', 'paymentDate', 'reviewedRateId'].includes(key))) {
    throw companyFxRequestError('Salesforce company FX request contains an unexpected field.', 400, 'SALESFORCE_COMPANY_FX_UNEXPECTED_FIELD');
  }
  const purpose = nonBlank(body.purpose);
  if (!PURPOSES.has(purpose)) {
    throw companyFxRequestError('Salesforce company FX request purpose is invalid.', 400, 'SALESFORCE_COMPANY_FX_PURPOSE_INVALID');
  }
  const paymentDate = body.paymentDate == null ? '' : nonBlank(body.paymentDate);
  const reviewedRateId = body.reviewedRateId == null ? '' : nonBlank(body.reviewedRateId);
  if (purpose === 'preview' && (paymentDate || reviewedRateId)) {
    throw companyFxRequestError('Preview requests cannot include payment or review fields.', 400, 'SALESFORCE_COMPANY_FX_PURPOSE_FIELDS_INVALID');
  }
  if (purpose === 'confirmation') {
    if (!reviewedRateId || paymentDate) {
      throw companyFxRequestError('Confirmation requests require reviewedRateId and cannot include paymentDate.', 400, 'SALESFORCE_COMPANY_FX_PURPOSE_FIELDS_INVALID');
    }
  }
  if (purpose === 'payment') {
    if (!paymentDate || reviewedRateId || !validIsoDate(paymentDate)) {
      throw companyFxRequestError('Payment requests require a valid paymentDate and cannot include reviewedRateId.', 400, 'SALESFORCE_COMPANY_FX_PURPOSE_FIELDS_INVALID');
    }
  }
  return { purpose, paymentDate: paymentDate || null, reviewedRateId: reviewedRateId || null };
}

function serviceClient(env) {
  const configuration = serverSupabaseConfig(env);
  if (!configuration.configured) {
    throw companyFxRequestError('Server-side FX storage is not configured.', 500, 'SALESFORCE_COMPANY_FX_STORAGE_NOT_CONFIGURED', false);
  }
  return createClient(configuration.url, configuration.key, {
    global: { fetch: deploymentSafeSupabaseFetch },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sendJson(res, payload, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function publicError(error, requestId) {
  const status = Number(error?.status || error?.statusCode || 500);
  return {
    ok: false,
    error: status < 500 || error?.expose === true
      ? String(error?.message || 'Salesforce company FX request was rejected.')
      : 'Salesforce company FX request could not be completed. Use the request reference when reporting the problem.',
    code: String(error?.code || 'SALESFORCE_COMPANY_FX_INTERNAL_ERROR').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 100),
    requestId: requestId || null,
  };
}

export async function handleSalesforceCompanyFx(req, res, {
  client = null,
  env = process.env,
  now = Date.now,
  loadCurrentRate = loadCurrentCompanyFxRate,
  loadRateForDate = loadCompanyFxRateForDate,
} = {}) {
  let requestId = null;
  try {
    const scope = currentDeploymentRequestSafety() || deploymentRequestSafety(req, env);
    if (env.FCOS_ENABLE_SALESFORCE_COMPANY_FX !== 'true' || !scope.canonical || scope.readOnly) {
      return sendJson(res, { ok: false, error: 'Company FX callback is unavailable.', code: 'SALESFORCE_COMPANY_FX_UNAVAILABLE' }, 404);
    }
    const eventId = headerValue(req?.headers, 'x-salesforce-event-id');
    requestId = EVENT_ID.test(eventId) ? eventId : null;
    if (req?.method !== 'POST') {
      return sendJson(res, { ok: false, error: 'Method not allowed.', code: 'SALESFORCE_COMPANY_FX_METHOD_NOT_ALLOWED', requestId: requestId || null }, 405);
    }
    const seen = new Set();
    for (let index = 0; index < (req.rawHeaders || []).length; index += 2) {
      const name = req.rawHeaders[index].toLowerCase();
      if (!SIGNATURE_HEADERS.has(name)) continue;
      if (seen.has(name)) throw companyFxRequestError('Duplicate Salesforce signature headers.', 401, 'SALESFORCE_COMPANY_FX_DUPLICATE_HEADER');
      seen.add(name);
    }
    const rawBody = await readSalesforceCompanyFxRawBody(req);
    const verified = verifySalesforceCompanyFxRequest({ headers: req.headers, rawBody, env, now });
    const payload = parseSalesforceCompanyFxPayload(rawBody);
    const storage = client || serviceClient(env);
    const rate = payload.purpose === 'payment'
      ? await loadRateForDate(storage, payload.paymentDate)
      : await loadCurrentRate(storage);
    if (payload.purpose === 'confirmation' && rate.rateId !== payload.reviewedRateId) {
      throw companyFxRequestError('The reviewed company FX rate changed. Preview the current rate before confirming.', 409, 'SALESFORCE_COMPANY_FX_RATE_CHANGED');
    }
    return sendJson(res, {
      ok: true,
      purpose: payload.purpose,
      environment: verified.environment.key,
      rate,
      requestId: verified.requestId,
    });
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 500);
    return sendJson(res, publicError(error, requestId), status >= 400 && status < 600 ? status : 500);
  }
}

export const salesforceCompanyFxInternals = {
  MAX_BODY_BYTES,
  MAX_REQUEST_AGE_MS,
  companyFxRequestError,
  parseSalesforceCompanyFxPayload,
  timingSafeHexEqual,
  validIsoDate,
};
