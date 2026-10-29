import assert from 'node:assert/strict';
import test from 'node:test';
import {
  XERO_ALLOWANCE_TIME_ZONE,
  formatXeroAllowanceCountdown,
  formatXeroAllowanceDate,
  latestXeroDailyAllowance,
} from '../src/lib/xeroDailyAllowance.js';
import { publicApiErrorPayload } from '../api/_publicApiError.js';
import { xeroRateLimitError } from '../api/_xeroRateLimit.js';

test('selects the newest rate snapshot and does not let an older saved preview overwrite an error', () => {
  const current = latestXeroDailyAllowance(null, { details: {
    rateLimit: { dayRemaining: 12, observedAt: '2026-09-23T08:30:00Z', rateLimitProblem: 'daily', retryAfterSeconds: 90, dayResetAt: '2026-09-23T08:31:30Z' },
  } });
  const selected = latestXeroDailyAllowance(current, { preview: { run: {
    rateLimit: { dayRemaining: 20, observedAt: '2026-09-23T08:00:00Z' },
  } } });
  assert.deepEqual(selected, current);
  assert.equal(selected.dayResetAt, '2026-09-23T08:31:30Z');
  const unknown = latestXeroDailyAllowance(selected, { rateLimit: { dayRemaining: 0, observedAt: '2026-09-23T08:30:30Z', rateLimitProblem: 'day' } });
  assert.equal(unknown.dayResetAt, null);
});

test('uses receipt time for legacy rate-limit error details but never invents a daily reset', () => {
  const selected = latestXeroDailyAllowance(
    { dayRemaining: 40, observedAt: '2026-09-23T08:00:00Z' },
    { details: { rateLimitProblem: 'daily', retryAt: '2026-09-23T09:00:00Z', retryAfterSeconds: 3600 } },
    { receivedAt: '2026-09-23T08:15:00Z' },
  );
  assert.equal(selected.observedAt, '2026-09-23T08:15:00Z');
  assert.equal(selected.dayRemaining, null);
  assert.equal(selected.dayResetAt, '2026-09-23T09:00:00Z');
});

test('trusts a canonical reset but never treats a minute Retry-After as a daily reset', () => {
  const daily = latestXeroDailyAllowance(null, { rateLimit: {
    dayRemaining: 0, observedAt: '2026-09-23T08:00:00Z', rateLimitProblem: 'day',
    retryAfterSeconds: 65, retryAt: '2026-09-23T08:01:05Z', dayResetAt: '2026-09-23T08:01:05Z',
  } });
  assert.equal(daily.dayResetAt, '2026-09-23T08:01:05Z');
  const retained = latestXeroDailyAllowance(null, { rateLimit: { ...daily, rateLimitProblem: 'minute' } });
  assert.equal(retained.dayResetAt, daily.dayResetAt);
  const minute = latestXeroDailyAllowance(null, { rateLimit: {
    observedAt: '2026-09-23T08:02:00Z', rateLimitProblem: 'minute', retryAt: '2026-09-23T08:03:00Z', retryAfterSeconds: 60,
  } });
  assert.equal(minute.dayResetAt, null);
  const cleared = latestXeroDailyAllowance(null, { rateLimit: { rateLimitProblem: 'day', dayResetAt: null, retryAt: '2026-09-23T09:00:00Z' } });
  assert.equal(cleared.dayResetAt, null);
});

test('keeps missing counts unknown and prefers the canonical public error snapshot over flat compatibility details', () => {
  const now = Date.parse('2026-09-23T01:00:00Z');
  const error = xeroRateLimitError(new Headers({
    'X-Rate-Limit-Problem': 'day', 'Retry-After': '3600', 'X-DayLimit-Remaining': '0',
  }), { now });
  const payload = publicApiErrorPayload(error, 429, 'request-rate');
  const snapshot = latestXeroDailyAllowance(null, payload, { receivedAt: '2026-09-23T01:00:01Z' });
  assert.equal(snapshot.dayRemaining, 0);
  assert.equal(snapshot.observedAt, '2026-09-23T01:00:00.000Z');
  assert.equal(snapshot.dayResetAt, '2026-09-23T02:00:00.000Z');
  assert.equal(latestXeroDailyAllowance(null, { rateLimit: { dayRemaining: null, observedAt: null } }).dayRemaining, null);
});

test('formats exact seconds and missing or elapsed countdowns', () => {
  const resetAt = '2026-09-23T08:01:05Z';
  assert.equal(formatXeroAllowanceCountdown(resetAt, Date.parse('2026-09-23T08:00:00Z')), '1m 5s');
  assert.equal(formatXeroAllowanceCountdown(resetAt, Date.parse(resetAt)), null);
  assert.equal(formatXeroAllowanceCountdown(null, Date.parse(resetAt)), null);
  assert.equal(formatXeroAllowanceCountdown(resetAt, Date.parse('2026-09-23T08:01:04.500Z')), '1s');
});

test('formats the authoritative date in Hong Kong time in both languages', () => {
  assert.equal(XERO_ALLOWANCE_TIME_ZONE, 'Asia/Hong_Kong');
  const english = formatXeroAllowanceDate('2026-09-23T08:01:05Z', 'en');
  const chinese = formatXeroAllowanceDate('2026-09-23T08:01:05Z', 'zh-Hant');
  assert.match(english, /23.*2026.*4:01:05\s*pm/i);
  assert.match(chinese, /2026.*9.*23.*下午4:01:05/);
  assert.equal(formatXeroAllowanceDate(null), null);
});
