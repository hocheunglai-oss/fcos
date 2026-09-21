import assert from 'node:assert/strict';
import test from 'node:test';
import { createXeroRequestGate, xeroRetryAfterMs, xeroRateLimitError } from '../api/_xeroRateLimit.js';
import { xeroAccountingFetch } from '../api/_xeroContactSync.js';
import { loadAllXeroPages, loadXeroFinancialSnapshot, xeroFinancialRateSnapshot, assertXeroFinancialDailyReserve } from '../api/_xeroFinancialSync.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test('Retry-After supports seconds, zero and HTTP dates without retrying early', () => {
  const now = Date.parse('2026-09-22T00:00:00Z');
  assert.equal(xeroRetryAfterMs(new Headers({ 'Retry-After': '12.5' }), { now }), 12500);
  assert.equal(xeroRetryAfterMs(new Headers({ 'Retry-After': '0' }), { now }), 0);
  assert.equal(xeroRetryAfterMs(new Headers({ 'Retry-After': 'Tue, 22 Sep 2026 00:01:00 GMT' }), { now }), 60000);
  assert.equal(xeroRetryAfterMs(new Headers({ 'Retry-After': 'bad' }), { now, attempt: 2 }), 4000);
});

test('parallel financial page scans share one tenant pace and unrelated tenants remain independent', async () => {
  let now = 0;
  const starts = [];
  const gate = createXeroRequestGate({ now: () => now, wait: async (ms) => { now += ms; } });
  await Promise.all(Array.from({ length: 6 }, (_, index) => gate('tenant', async () => {
    starts.push([index, now]);
    return json({});
  }, { intervalMs: 1334 })));
  assert.deepEqual(starts.map((row) => row[1]), [0, 1334, 2668, 4002, 5336, 6670]);
  const before = now;
  await gate('other-tenant', async () => { assert.equal(now, before); return json({}); }, { intervalMs: 1334 });
});

test('queued requests respect tenant cooldown; a failed request does not poison the queue', async () => {
  let now = 0;
  const gate = createXeroRequestGate({ now: () => now, wait: async (ms) => { now += ms; } });
  const first = gate('tenant', async () => json({}, 429, { 'Retry-After': '30' }));
  const second = gate('tenant', async () => { assert.equal(now, 30000); return json({}); });
  await Promise.all([first, second]);
  await assert.rejects(gate('tenant', async () => { throw new Error('network'); }), /network/);
  assert.equal((await gate('tenant', async () => json({}))).status, 200);
});

test('a daily limit stops queued calls without sleeping through the daily reset', async () => {
  const gate = createXeroRequestGate({ now: () => 0, wait: async () => { throw new Error('must not wait'); } });
  await gate('tenant', async () => json({}, 429, { 'Retry-After': '3600', 'X-Rate-Limit-Problem': 'day' }));
  await assert.rejects(gate('tenant', async () => { throw new Error('must not call Xero'); }), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.details.retryAfterSeconds, 3600);
    assert.match(error.message, /daily allowance.*3600 seconds/);
    return true;
  });
});

test('read requests recover from 429 by default and preserve every paginated record', async () => {
  const calls = [];
  let limited = false;
  const result = await loadAllXeroPages({ tenantId: 'paginated', accessToken: 'test' }, '/Invoices', 'Invoices', {
    env: {},
    fetchImpl: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      calls.push(page);
      if (page === 2 && !limited) { limited = true; return json({}, 429, { 'Retry-After': '0' }); }
      assert.equal(new URL(url).searchParams.get('pageSize'), '1000');
      return json({ Invoices: page === 1 ? Array.from({ length: 1000 }, (_, id) => ({ InvoiceID: String(id) })) : [{ InvoiceID: '1000' }] });
    },
  });
  assert.equal(result.length, 1001);
  assert.equal(new Set(result.map((row) => row.InvoiceID)).size, 1001);
  assert.deepEqual(calls, [1, 2, 2]);
});

test('complete maximum-size preview needs only 45 paced reads and retains historical invoices for payments', async () => {
  let now = 0;
  const requestGate = createXeroRequestGate({ now: () => now, wait: async (ms) => { now += ms; } });
  const requests = [];
  const snapshot = await loadXeroFinancialSnapshot({ tenantId: 'complete', accessToken: 'test' }, '2026-01-01', {
    includePayments: true, env: {}, requestGate,
    fetchImpl: async (value) => {
      const url = new URL(value);
      const collection = url.pathname.split('/').at(-1);
      const page = Number(url.searchParams.get('page'));
      requests.push({ collection, page });
      if (collection === 'Organisations') return json({ Organisations: [{}] });
      assert.equal(url.searchParams.get('pageSize'), '1000');
      return json({ [collection]: page > 10 ? [] : Array.from({ length: 1000 }, (_, index) => ({
        InvoiceID: `${page}-${index}`, CreditNoteID: `${page}-${index}`, ContactID: `${page}-${index}`, PaymentID: `${page}-${index}`,
        Status: 'AUTHORISED', Type: 'ACCREC', Date: collection === 'Invoices' && page === 1 ? '2025-12-31' : '2026-01-01',
      })) });
    },
  });
  assert.equal(requests.length, 45);
  assert.ok(now < 60000, `Pacing budget exceeded: ${now}`);
  assert.equal(snapshot.paymentReadSnapshot.invoices.length, 10000);
  assert.equal(snapshot.paymentReadSnapshot.payments.length, 10000);
  assert.equal(snapshot.documents.filter((row) => row.collection === 'Invoices').length, 9000);
  assert.equal(requests.filter((row) => row.collection === 'Invoices').length, 11);
});

test('unknown daily reset has no invented retry timestamp and allows a bounded later probe', async () => {
  let now = 0;
  const headers = new Headers({ 'X-Rate-Limit-Problem': 'day' });
  const first = xeroRateLimitError(headers, { now });
  assert.equal(first.details.retryAt, null);
  assert.equal(first.details.retryAfterSeconds, null);
  const gate = createXeroRequestGate({ now: () => now, wait: async () => { throw new Error('must not wait'); } });
  await gate('tenant', async () => json({}, 429, headers));
  await assert.rejects(gate('tenant', async () => { throw new Error('must not probe immediately'); }), (error) => error.status === 429 && error.details.retryAt === null);
  now = 60000;
  assert.equal((await gate('tenant', async () => json({}))).status, 200);
});

test('large scans fail explicitly without silently truncating the financial population', async () => {
  await assert.rejects(loadAllXeroPages({ tenantId: 'oversized', accessToken: 'test' }, '/Invoices', 'Invoices', {
    env: {}, requestGate: async (_tenant, operation) => operation(),
    fetchImpl: async () => json({ Invoices: Array.from({ length: 1000 }, () => ({ InvoiceID: 'test' })) }),
  }), (error) => error.code === 'XERO_FINANCIAL_XERO_INCOMPLETE');
});

test('daily, long and exhausted rate limits return actionable errors without unsafe replays', async () => {
  for (const [headers, options, expectedCalls] of [
    [{ 'Retry-After': '3600', 'X-Rate-Limit-Problem': 'day' }, { method: 'GET' }, 1],
    [{ 'Retry-After': '120' }, { method: 'GET' }, 1],
    [{ 'Retry-After': '0' }, { method: 'GET' }, 4],
    [{ 'Retry-After': '0' }, { method: 'POST', body: { Invoices: [] } }, 1],
  ]) {
    let calls = 0;
    await assert.rejects(xeroAccountingFetch({ tenantId: 'test', accessToken: 'test' }, '/Invoices', {
      ...options, env: {}, fetchImpl: async () => { calls += 1; return json({}, 429, headers); },
    }), (error) => error.status === 429 && error.code === 'XERO_CONTACT_SYNC_RATE_LIMITED' && /retry/.test(error.message));
    assert.equal(calls, expectedCalls);
  }
});

test('explicit write retries retain the same idempotency key and body', async () => {
  const requests = [];
  await xeroAccountingFetch({ tenantId: 'test', accessToken: 'test' }, '/Invoices', {
    method: 'POST', retryOnRateLimit: true, idempotencyKey: 'same-approved-batch', body: { Invoices: [{ InvoiceID: 'test' }] }, env: {},
    fetchImpl: async (_url, options) => { requests.push(options); return requests.length === 1 ? json({}, 429, { 'Retry-After': '0' }) : json({ Invoices: [] }); },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.equal(requests[0].body, requests[1].body);
});

test('missing quota headers remain unknown and cannot falsely exhaust the daily reserve', () => {
  const rate = xeroFinancialRateSnapshot(new Headers());
  assert.equal(rate.dayRemaining, undefined);
  assert.doesNotThrow(() => assertXeroFinancialDailyReserve(rate));
  assert.equal(xeroFinancialRateSnapshot(new Headers(), { dayRemaining: 800 }).dayRemaining, 800);
  assert.throws(() => assertXeroFinancialDailyReserve(xeroFinancialRateSnapshot(new Headers({ 'X-DayLimit-Remaining': '0' }))), /daily allowance reserve/);
  assert.match(xeroRateLimitError(new Headers({ 'X-Rate-Limit-Problem': 'day' })).message, /after the daily allowance resets/);
});
