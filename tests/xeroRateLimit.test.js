import assert from 'node:assert/strict';
import test from 'node:test';
import { createXeroRequestGate, xeroRetryAfterMs, xeroRateLimitError, xeroRateLimitSnapshot } from '../api/_xeroRateLimit.js';
import { xeroAccountingFetch } from '../api/_xeroContactSync.js';
import { loadAllXeroPages, loadXeroFinancialSnapshot, loadXeroPaymentEvidence, xeroPaymentEvidenceIds, xeroFinancialRateSnapshot, assertXeroFinancialDailyReserve } from '../api/_xeroFinancialSync.js';

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

test('complete maximum-size scoped preview needs only 45 paced reads without scanning unrelated history', async () => {
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
      if (collection !== 'Contacts') assert.equal(url.searchParams.get('where'), 'Date>=DateTime(2026,01,01)');
      return json({ [collection]: page > 10 ? [] : Array.from({ length: 1000 }, (_, index) => ({
        InvoiceID: `${page}-${index}`, CreditNoteID: `${page}-${index}`, ContactID: `${page}-${index}`, PaymentID: `${page}-${index}`,
        Status: 'AUTHORISED', Type: 'ACCREC', Date: '2026-01-01',
      })) });
    },
  });
  assert.equal(requests.length, 45);
  assert.ok(now < 60000, `Pacing budget exceeded: ${now}`);
  assert.equal(snapshot.paymentReadSnapshot.invoices.length, 10000);
  assert.equal(snapshot.paymentReadSnapshot.payments.length, 10000);
  assert.equal(snapshot.documents.filter((row) => row.collection === 'Invoices').length, 10000);
  assert.equal(requests.filter((row) => row.collection === 'Invoices').length, 11);
});

test('scoped reconciliation hydrates historical invoice evidence without adding old matching candidates', async () => {
  const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  const [unpaidOld, alreadyLoaded, movedPayment, movedOld, paidOld, current, contact] = [1, 2, 3, 4, 5, 6, 7].map(id);
  const ordinary = (PaymentID, InvoiceID, date) => ({ PaymentID, PaymentType: 'ACCPAYPAYMENT', Date: date,
    Invoice: { InvoiceID, Type: 'ACCPAY', CurrencyCode: 'USD', Contact: { ContactID: contact } } });
  const calls = [];
  const snapshot = await loadXeroFinancialSnapshot({ tenantId: 'historical', accessToken: 'test' }, '2026-01-01', {
    env: {}, includePayments: true, invoiceIds: [unpaidOld, alreadyLoaded], paymentIds: [movedPayment],
    requestGate: async (_tenant, operation) => operation(),
    fetchImpl: async (value) => {
      const url = new URL(value); calls.push(url);
      if (url.pathname.endsWith(`/Payments/${movedPayment}`)) return json({ Payments: [ordinary(movedPayment, movedOld, '2025-12-31')] });
      const collection = url.pathname.split('/').at(-1);
      if (collection === 'Organisations') return json({ Organisations: [{}] });
      if (collection === 'Invoices' && url.searchParams.has('IDs')) {
        assert.deepEqual(new Set(url.searchParams.get('IDs').split(',')), new Set([unpaidOld, paidOld, movedOld]));
        return json({ Invoices: [unpaidOld, paidOld, movedOld].map((InvoiceID) => ({ InvoiceID, Date: '2025-12-31', Status: 'AUTHORISED', Type: 'ACCPAY' })) });
      }
      if (collection === 'Invoices') return json({ Invoices: [{ InvoiceID: alreadyLoaded, Date: '2026-01-01', Status: 'AUTHORISED', Type: 'ACCPAY' }] });
      if (collection === 'Payments') return json({ Payments: [ordinary(current, paidOld, '2026-01-01')] });
      return json({ [collection]: [] });
    },
  });
  assert.deepEqual(snapshot.documents.map((row) => row.id), [alreadyLoaded]);
  assert.equal(snapshot.paymentReadSnapshot.invoices.length, 4);
  assert.equal(snapshot.paymentReadSnapshot.payments.length, 2);
  assert.equal(calls.filter((url) => url.searchParams.has('IDs')).length, 1);
  assert.ok(calls.filter((url) => url.pathname.endsWith('/Invoices')).every((url) => url.searchParams.has('where') || url.searchParams.has('IDs')));
});

test('payment evidence IDs retain every ambiguous buyer candidate and exclude unrelated historical mappings', () => {
  const ids = xeroPaymentEvidenceIds([{ Id: 'current', STEM__c: 'stem', Supplier_Invoice__c: 'supplier' }], [
    { id: 'd1', salesforce_object: 'Invoice__c', stem_id: 'stem', xero_document_id: 'buyer-a' },
    { id: 'd2', salesforce_object: 'Invoice__c', retained_differences: { stemId: 'stem' }, xero_document_id: 'buyer-b' },
    { id: 'd3', salesforce_object: 'Supplier_Invoice__c', salesforce_id: 'supplier', xero_document_id: 'supplier-a' },
    { id: 'd4', xero_document_id: 'stored-allocation' },
    { id: 'd5', stem_id: 'unrelated', xero_document_id: 'unrelated' },
  ], [
    { salesforce_payment_id: 'current', document_mapping_id: 'd4', xero_payment_id: 'exact-payment' },
    { salesforce_payment_id: 'old-unrelated', xero_payment_id: 'old-payment' },
  ]);
  assert.deepEqual(ids.invoiceIds, ['buyer-a', 'buyer-b', 'supplier-a', 'stored-allocation']);
  assert.deepEqual(ids.paymentIds, ['exact-payment']);
});

test('missing targeted evidence remains absent and unexpected records fail closed', async () => {
  const options = { env: {}, invoices: [], payments: [], invoiceIds: ['missing'], paymentIds: ['deleted'], requestGate: async (_tenant, operation) => operation() };
  const absent = await loadXeroPaymentEvidence({ tenantId: 'missing', accessToken: 'test' }, '2026-01-01', {
    ...options, fetchImpl: async (url) => url.includes('/Payments/') ? json({}, 404) : json({ Invoices: [] }),
  });
  assert.deepEqual(absent, { invoices: [], payments: [], paymentEvidenceHolds: [] });
  await assert.rejects(loadXeroPaymentEvidence({ tenantId: 'mismatch', accessToken: 'test' }, '2026-01-01', {
    ...options, paymentIds: [], fetchImpl: async () => json({ Invoices: [{ InvoiceID: 'unrequested' }] }),
  }), (error) => error.code === 'XERO_FINANCIAL_XERO_INCOMPLETE');
});

test('historical invoice batches keep UUID query strings within the provider limit and retain every record', async () => {
  const invoiceIds = Array.from({ length: 121 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
  let calls = 0;
  const result = await loadXeroPaymentEvidence({ tenantId: 'batch', accessToken: 'test' }, '2026-01-01', {
    env: {}, invoices: [], payments: [], invoiceIds, requestGate: async (_tenant, operation) => operation(),
    fetchImpl: async (value) => {
      const url = new URL(value); calls += 1;
      assert.ok(url.search.length < 2048);
      return json({ Invoices: url.searchParams.get('IDs').split(',').map((InvoiceID) => ({ InvoiceID })) });
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.invoices.map((row) => row.InvoiceID), invoiceIds);
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

test('daily reset uses Xero seconds or HTTP date and survives the reserve error envelope', () => {
  const now = Date.parse('2026-09-23T01:30:00Z');
  for (const retry of ['5400', 'Wed, 23 Sep 2026 03:00:00 GMT']) {
    const headers = new Headers({ 'X-Rate-Limit-Problem': 'day', 'X-DayLimit-Remaining': '0', 'Retry-After': retry });
    const rate = xeroFinancialRateSnapshot(headers, {}, { now });
    assert.equal(rate.dayResetAt, '2026-09-23T03:00:00.000Z');
    assert.equal(rate.observedAt, '2026-09-23T01:30:00.000Z');
    assert.equal(rate.retryAfterSeconds, 5400);
    assert.equal(xeroRateLimitError(headers, { now }).details.rateLimit.dayResetAt, rate.dayResetAt);
    assert.throws(() => assertXeroFinancialDailyReserve(rate), (error) => {
      assert.equal(error.details.rateLimit.dayResetAt, rate.dayResetAt);
      assert.equal(error.details.rateLimit.dayRemaining, 0);
      return error.code === 'XERO_FINANCIAL_DAILY_RESERVE';
    });
  }
});

test('a minute limit, local reserve or invalid header cannot invent a daily reset', () => {
  const now = Date.parse('2026-09-23T01:30:00Z');
  for (const headers of [
    { 'X-Rate-Limit-Problem': 'minute', 'Retry-After': '60' },
    { 'X-DayLimit-Remaining': '199' },
    { 'Retry-After': '60' },
    ...['', 'bad', '-1', '1e100'].map((value) => ({ 'X-Rate-Limit-Problem': 'day', 'Retry-After': value })),
  ]) assert.equal(xeroRateLimitSnapshot(new Headers(headers), {}, { now }).dayResetAt, null);
  for (const value of ['bad', '-1', '1e100']) {
    const error = xeroRateLimitError(new Headers({ 'X-Rate-Limit-Problem': 'day', 'Retry-After': value }), { now });
    assert.equal(error.details.retryAt, null);
    assert.match(error.message, /after the daily allowance resets/);
  }
});

test('new observations never slide an old reset deadline or retain an expired window', () => {
  const now = Date.parse('2026-09-23T01:30:00Z');
  const first = xeroRateLimitSnapshot(new Headers({ 'X-Rate-Limit-Problem': 'day', 'Retry-After': '3600', 'X-DayLimit-Remaining': '0' }), {}, { now });
  const later = xeroRateLimitSnapshot(new Headers(), first, { now: now + 120000 });
  assert.equal(later.dayResetAt, first.dayResetAt);
  assert.equal(later.retryAfterSeconds, null);
  assert.equal(later.retryAt, null);
  const missingTiming = xeroRateLimitSnapshot(new Headers({ 'X-Rate-Limit-Problem': 'day' }), first, { now: now + 120000 });
  assert.equal(missingTiming.dayResetAt, first.dayResetAt);
  const elapsed = xeroRateLimitSnapshot(new Headers({ 'X-DayLimit-Remaining': '950' }), later, { now: now + 3600001 });
  assert.equal(elapsed.dayResetAt, null);
  assert.equal(elapsed.dayRemaining, 950);
  const restoredEarly = xeroRateLimitSnapshot(new Headers({ 'X-DayLimit-Remaining': '950' }), first, { now: now + 120000 });
  assert.equal(restoredEarly.dayResetAt, null);
});

test('queued daily errors retain the original provider deadline', async () => {
  let now = Date.parse('2026-09-23T01:30:00Z');
  const gate = createXeroRequestGate({ now: () => now, wait: async () => { throw new Error('must not wait'); } });
  await gate('daily-display', async () => json({}, 429, { 'X-Rate-Limit-Problem': 'day', 'Retry-After': '3600' }));
  now += 120125;
  await assert.rejects(gate('daily-display', async () => { throw new Error('must not call Xero'); }), (error) => {
    assert.equal(error.details.rateLimit.dayResetAt, '2026-09-23T02:30:00.000Z');
    assert.equal(error.details.retryAt, error.details.rateLimit.dayResetAt);
    assert.equal(error.details.rateLimit.retryAfterSeconds, 3480);
    return true;
  });
});
