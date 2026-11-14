import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';
import {
  handleSalesforceCompanyFx,
  parseSalesforceCompanyFxPayload,
  salesforceCompanyFxSignature,
  verifySalesforceCompanyFxRequest,
} from '../api/_salesforceCompanyFx.js';

const env = {
  FCOS_ENABLE_SALESFORCE_COMPANY_FX: 'true',
  SALESFORCE_COMPANY_FX_SIGNING_SECRET: 'company-fx-test-secret',
  SALESFORCE_COMPANY_FX_ENVIRONMENT: 'production',
};
const now = Date.parse('2026-09-10T12:00:30.000Z');

function signedHeaders({ body = '{"purpose":"preview"}', eventId = 'event-1', timestamp = '2026-09-10T12:00:00.000Z', orgId = '00D2x000000Ei4oEAC', secret = env.SALESFORCE_COMPANY_FX_SIGNING_SECRET } = {}) {
  return {
    'x-salesforce-org-id': orgId,
    'x-salesforce-event-id': eventId,
    'x-salesforce-timestamp': timestamp,
    'x-salesforce-signature': `sha256=${salesforceCompanyFxSignature({ secret, timestamp, requestId: eventId, rawBody: body })}`,
  };
}

function response() {
  const headers = new Map();
  return {
    headers,
    statusCode: null,
    payload: null,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value) { this.payload = JSON.parse(value); },
  };
}

function request(body, headers = signedHeaders({ body })) {
  return { method: 'POST', headers: { host: 'fcos.fcuno.com', ...headers }, body };
}

const currentRate = { usdHkdRate: '7.840000', revision: 8, rateId: 'rate-current', effectiveAt: '2026-09-10T12:00:00.000Z' };

test('verification pins the configured Salesforce org and detects tampered raw bytes', () => {
  const body = '{"purpose":"preview"}';
  assert.equal(verifySalesforceCompanyFxRequest({ headers: signedHeaders({ body }), rawBody: body, env, now }).environment.key, 'production');
  assert.throws(
    () => verifySalesforceCompanyFxRequest({ headers: signedHeaders({ body, orgId: '00D000000000000AAA' }), rawBody: body, env, now }),
    (error) => error.code === 'SALESFORCE_COMPANY_FX_ORG_MISMATCH' && error.status === 403,
  );
  assert.throws(
    () => verifySalesforceCompanyFxRequest({ headers: signedHeaders({ body }), rawBody: '{"purpose":"payment"}', env, now }),
    (error) => error.code === 'SALESFORCE_COMPANY_FX_INVALID_SIGNATURE',
  );
  assert.throws(
    () => verifySalesforceCompanyFxRequest({ headers: signedHeaders({ body, timestamp: '2026-09-10T12:06:00.001Z' }), rawBody: body, env, now }),
    (error) => error.code === 'SALESFORCE_COMPANY_FX_STALE_TIMESTAMP',
  );
  assert.throws(
    () => verifySalesforceCompanyFxRequest({ headers: signedHeaders({ body }), rawBody: body, env: { SALESFORCE_COMPANY_FX_SIGNING_SECRET: 'x' }, now }),
    (error) => error.code === 'SALESFORCE_COMPANY_FX_ENVIRONMENT_INVALID' && error.status === 500,
  );
});

test('strict payload contracts prohibit today fallback and cross-purpose fields', () => {
  assert.deepEqual(parseSalesforceCompanyFxPayload('{"purpose":"preview"}'), { purpose: 'preview', paymentDate: null, reviewedRateId: null });
  assert.deepEqual(parseSalesforceCompanyFxPayload('{"purpose":"payment","paymentDate":"2026-09-10"}'), { purpose: 'payment', paymentDate: '2026-09-10', reviewedRateId: null });
  assert.throws(() => parseSalesforceCompanyFxPayload('{"purpose":"payment"}'), /paymentDate/);
  assert.throws(() => parseSalesforceCompanyFxPayload('{"purpose":"confirmation"}'), /reviewedRateId/);
  assert.throws(() => parseSalesforceCompanyFxPayload('{"purpose":"preview","other":true}'), /unexpected field/);
  assert.throws(() => parseSalesforceCompanyFxPayload('{"purpose":"payment","paymentDate":"2026-02-30"}'), /valid paymentDate/);
});

test('handler returns only an immutable snapshot and keeps responses uncacheable', async () => {
  const body = '{"purpose":"payment","paymentDate":"2026-09-10"}';
  const res = response();
  let requestedDate = null;
  await handleSalesforceCompanyFx(request(body), res, {
    env, now, client: {},
    loadCurrentRate: async () => { throw new Error('must not load current rate for payment'); },
    loadRateForDate: async (_client, date) => { requestedDate = date; return currentRate; },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(requestedDate, '2026-09-10');
  assert.deepEqual(res.payload.rate, currentRate);
});

test('confirmation rejects a changed reviewed rate and missing history fails closed', async () => {
  const body = '{"purpose":"confirmation","reviewedRateId":"rate-reviewed"}';
  const changed = response();
  await handleSalesforceCompanyFx(request(body), changed, { env, now, client: {}, loadCurrentRate: async () => currentRate });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.payload.code, 'SALESFORCE_COMPANY_FX_RATE_CHANGED');

  const preview = response();
  await handleSalesforceCompanyFx(request('{"purpose":"preview"}'), preview, {
    env, now, client: {},
    loadCurrentRate: async () => { const error = new Error('no history'); error.status = 503; error.code = 'COMPANY_FX_RATE_UNAVAILABLE'; throw error; },
  });
  assert.equal(preview.statusCode, 503);
  assert.equal(preview.payload.code, 'COMPANY_FX_RATE_UNAVAILABLE');
  assert.doesNotMatch(preview.payload.error, /no history/i);
});

test('handler rejects methods, parsed bodies, and oversized signed requests before storage', async () => {
  const methodRes = response();
  await handleSalesforceCompanyFx({ ...request(''), method: 'GET' }, methodRes, { env, now, client: {} });
  assert.equal(methodRes.statusCode, 405);
  assert.equal(methodRes.headers.get('cache-control'), 'no-store');

  const parsed = response();
  await handleSalesforceCompanyFx(request({ purpose: 'preview' }, signedHeaders()), parsed, { env, now, client: {} });
  assert.equal(parsed.statusCode, 400);
  assert.equal(parsed.payload.code, 'SALESFORCE_COMPANY_FX_RAW_BODY_REQUIRED');

  const large = 'x'.repeat(2049);
  const tooLarge = response();
  await handleSalesforceCompanyFx(request(large), tooLarge, { env, now, client: {} });
  assert.equal(tooLarge.statusCode, 413);
});

test('disabled, noncanonical and explicitly read-only requests stop before reading the body', async () => {
  const scenarios = [
    [env, 'fcos-stage.vercel.app'],
    [{ ...env, VERCEL_ENV: 'preview' }, 'fcos.fcuno.com'],
    [{ ...env, FCOS_ENABLE_READ_ONLY_CI: 'true' }, 'fcos.fcuno.com'],
    [{ ...env, FCOS_ENABLE_SALESFORCE_COMPANY_FX: 'false' }, 'fcos.fcuno.com'],
  ];
  for (const [runtime, host] of scenarios) {
    const req = { method: 'POST', headers: { host } };
    let reads = 0;
    Object.defineProperty(req, 'body', { get() { reads += 1; } });
    const res = response();
    await handleSalesforceCompanyFx(req, res, { env: runtime, now });
    assert.equal(res.statusCode, 404);
    assert.equal(reads, 0);
  }
});

test('duplicate signature headers and authenticated invalid UTF-8 fail closed', async () => {
  const duplicate = request('{"purpose":"preview"}');
  const signature = duplicate.headers['x-salesforce-signature'];
  duplicate.rawHeaders = ['X-Salesforce-Signature', signature, 'x-salesforce-signature', signature];
  const duplicateResponse = response();
  await handleSalesforceCompanyFx(duplicate, duplicateResponse, { env, now });
  assert.equal(duplicateResponse.statusCode, 401);
  assert.equal(duplicateResponse.payload.code, 'SALESFORCE_COMPANY_FX_DUPLICATE_HEADER');

  const invalidBody = Buffer.concat([Buffer.from('{"purpose":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  const invalidResponse = response();
  await handleSalesforceCompanyFx(request(invalidBody), invalidResponse, { env, now });
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(invalidResponse.payload.code, 'SALESFORCE_COMPANY_FX_INVALID_JSON');
});

test('streamed signed bytes survive chunking and the outer request scope takes precedence', async () => {
  const body = Buffer.from(' { "purpose": "preview" }\n');
  const dependencies = { env, now, client: {}, loadCurrentRate: async () => currentRate };
  const req = Object.assign(Readable.from([body.subarray(0, 11), body.subarray(11)]), {
    method: 'POST',
    headers: request(body).headers,
  });
  Object.defineProperty(req, 'body', { get() { throw new Error('the lazy body accessor must never run'); } });
  const streamed = response();
  await handleSalesforceCompanyFx(req, streamed, dependencies);
  assert.equal(streamed.statusCode, 200);
  assert.deepEqual(streamed.payload.rate, currentRate);

  const canonicalRequest = request(body);
  const staged = response();
  await runWithDeploymentRequestSafety(canonicalRequest,
    () => handleSalesforceCompanyFx(canonicalRequest, staged, dependencies), { VERCEL_ENV: 'preview' });
  assert.equal(staged.statusCode, 404);
});

test('certificate mode verifies exact signed bytes and refuses legacy authentication', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const body = '{"purpose":"preview"}';
  const headers = signedHeaders({ body });
  const signed = Buffer.from(`${headers['x-salesforce-timestamp']}.${headers['x-salesforce-event-id']}.${body}`);
  const signature = sign('RSA-SHA256', signed, privateKey).toString('base64');
  const runtime = { ...env, SALESFORCE_COMPANY_FX_SIGNING_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) };
  const request = { headers: { ...headers, 'x-salesforce-signature': 'rsa-sha256=' + signature }, rawBody: body, env: runtime, now };
  assert.equal(verifySalesforceCompanyFxRequest(request).environment.key, 'production');
  assert.throws(() => verifySalesforceCompanyFxRequest({ ...request, rawBody: body + ' ' }), { code: 'SALESFORCE_COMPANY_FX_INVALID_SIGNATURE' });
  assert.throws(() => verifySalesforceCompanyFxRequest({ ...request, headers }), { code: 'SALESFORCE_COMPANY_FX_INVALID_SIGNATURE' });
  assert.throws(() => verifySalesforceCompanyFxRequest({ ...request, env: {
    ...runtime, SALESFORCE_COMPANY_FX_SIGNING_PUBLIC_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  } }), { code: 'SALESFORCE_COMPANY_FX_PUBLIC_KEY_INVALID' });
});
