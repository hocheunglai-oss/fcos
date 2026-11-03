import test from 'node:test';
import assert from 'node:assert/strict';
import { publicApiErrorPayload } from '../api/_publicApiError.js';
import { xeroRateLimitError } from '../api/_xeroRateLimit.js';
import { assertXeroFinancialDailyReserve, xeroFinancialRateSnapshot } from '../api/_xeroFinancialSync.js';

test('public API errors redact unexpected server messages and retain request references', () => {
  assert.deepEqual(publicApiErrorPayload(new Error('database credential leaked'), 500, 'request-1'), {
    error: 'FCOS could not complete this operation. Use the request reference when reporting the problem.',
    message: 'FCOS could not complete this operation. Use the request reference when reporting the problem.',
    code: 'FCOS_INTERNAL_ERROR',
    requestId: 'request-1',
  });
});

test('Xero daily reset reaches the client through the public 429 boundary without exposing other details', () => {
  const now = Date.parse('2026-09-23T01:00:00Z');
  const headers = new Headers({ 'X-Rate-Limit-Problem': 'day', 'Retry-After': '3600', 'X-DayLimit-Remaining': '0' });
  const error = xeroRateLimitError(headers, { now });
  error.details.token = 'private';
  error.details.rateLimit.accessToken = 'private';
  const result = publicApiErrorPayload(error, 429, 'request-rate');
  assert.equal(result.details.rateLimit.dayResetAt, '2026-09-23T02:00:00.000Z');
  assert.equal(result.details.rateLimit.dayRemaining, 0);
  assert.equal(result.details.token, undefined);
  assert.equal(result.details.rateLimit.accessToken, undefined);
  let reserveError;
  try { assertXeroFinancialDailyReserve(xeroFinancialRateSnapshot(headers, {}, { now })); } catch (failure) { reserveError = failure; }
  const reserve = publicApiErrorPayload(reserveError, 429, 'request-reserve');
  assert.equal(reserve.details.rateLimit.dayResetAt, result.details.rateLimit.dayResetAt);
  assert.equal(reserve.details.reserve, 200);
});

test('only recognised Xero 429 errors expose allowlisted quota details', () => {
  const details = { retryAt: 'bad', rateLimit: { dayRemaining: Infinity, observedAt: 'secret', rateLimitProblem: 'secret', retryAt: null } };
  const error = Object.assign(new Error('Rate limited'), { code: 'XERO_CONTACT_SYNC_RATE_LIMITED', details });
  assert.deepEqual(publicApiErrorPayload(error, 429, 'request').details, { rateLimit: {} });
  assert.equal(publicApiErrorPayload({ ...error, code: 'OTHER_RATE_LIMIT' }, 429, 'request').details, undefined);
  assert.equal(publicApiErrorPayload(error, 500, 'request').details, undefined);
  assert.deepEqual(publicApiErrorPayload({ ...error, details: null }, 429, 'request').details, { rateLimit: {} });
});

test('public API errors clone conflict details and retain the compatibility current field', () => {
  const details = { current: { revision: 3 } };
  const result = publicApiErrorPayload(Object.assign(new Error('Reload first.'), { code: 'stale write', details }), 409, 'request-2');
  details.current.revision = 4;
  assert.equal(result.error, 'Reload first.');
  assert.equal(result.code, 'STALE_WRITE');
  assert.equal(result.details.current.revision, 3);
  assert.equal(result.current.revision, 4);
});
