import test from 'node:test';
import assert from 'node:assert/strict';
import { sfRequest, sfQuery } from '../api/_salesforce.js';
import { salesforceReadRetryDelay } from '../api/_salesforceReadRetry.js';
import { runWithRequestTelemetry, currentRequestTelemetry } from '../api/_requestTelemetry.js';

const originalFetch = globalThis.fetch;
const envNames = ['SALESFORCE_ACCESS_TOKEN', 'SALESFORCE_INSTANCE_URL', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN', 'SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY'];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
test.beforeEach(() => {
  for (const name of envNames) delete process.env[name];
  process.env.SALESFORCE_ACCESS_TOKEN = 'test-token';
  process.env.SALESFORCE_INSTANCE_URL = 'https://example.my.salesforce.com';
});
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const unavailable = () => new Response('<html>Temporarily unavailable</html>', { status: 503 });

test('transient read retries are bounded and respect Retry-After without shortening it', () => {
  for (const method of ['GET', 'HEAD']) for (const status of [429, 502, 503, 504]) {
    assert.equal(salesforceReadRetryDelay({ method, status, attempt: 0 }), 250);
    assert.equal(salesforceReadRetryDelay({ method, status, attempt: 1 }), 500);
    assert.equal(salesforceReadRetryDelay({ method, status, attempt: 2 }), null);
  }
  assert.equal(salesforceReadRetryDelay({ method: 'GET', status: 503, attempt: 0, retryAfter: '1' }), 1000);
  assert.equal(salesforceReadRetryDelay({ method: 'GET', status: 503, attempt: 0, retryAfter: '120' }), null);
  assert.equal(salesforceReadRetryDelay({ method: 'GET', status: 503, attempt: 0, retryAfter: 'Wed, 16 Sep 2026 08:00:01 GMT', now: Date.parse('2026-09-16T08:00:00Z') }), 1000);
});

test('temporary Salesforce outage recovers and records each actual read', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? unavailable() : json({ records: [{ Id: 'row' }] });
  await runWithRequestTelemetry({ handler: 'test' }, async () => {
    assert.deepEqual(await sfRequest('/query/?q=SELECT+Id+FROM+Account'), { records: [{ Id: 'row' }] });
    assert.equal(currentRequestTelemetry().salesforce.quotaCalls, 2);
    assert.equal(currentRequestTelemetry().salesforce.rows, 1);
  });
  assert.equal(calls, 2);
});

test('persistent outage fails after three reads with a stable query-free error', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return unavailable(); };
  await assert.rejects(sfRequest('/query/?q=SELECT+PrivateFinancialField+FROM+Account'), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, 'SALESFORCE_HTTP_503');
    assert.doesNotMatch(error.message, /PrivateFinancialField|query|Account/);
    return true;
  });
  assert.equal(calls, 3);
});

test('pagination retries only the failed page and retains the complete result', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (urls.length === 1) return json({ records: [{ Id: 'first' }], done: false, nextRecordsUrl: '/services/data/v67.0/query/next' });
    if (urls.length === 2) return unavailable();
    return json({ records: [{ Id: 'second' }], done: true });
  };
  const { records } = await sfQuery('SELECT Id FROM Account');
  assert.deepEqual(records.map((record) => record.Id), ['first', 'second']);
  assert.equal(urls.length, 3);
  assert.equal(urls[1], urls[2]);
});

test('transient retry budget is not reset by expired-session recovery', async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 2 ? json([{ errorCode: 'INVALID_SESSION_ID', message: 'Expired' }], 401) : unavailable();
  await assert.rejects(sfRequest('/query/?q=SELECT+Id+FROM+Account'), { status: 503 });
  assert.equal(calls, 4);
});

test('writes and read-only POST requests are never replayed for transient errors', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return unavailable(); };
    // readOnly bypasses the external-action gate in this isolated mock only.
    await assert.rejects(sfRequest('/sobjects/Test', { method, body: {}, readOnly: true }), { status: 503 });
    assert.equal(calls, 1);
  }
});

test('permanent Salesforce errors retain their message and are not retried', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return json([{ errorCode: 'INVALID_FIELD', message: 'No such field' }], 400); };
  await assert.rejects(sfRequest('/query/?q=bad'), { status: 400, code: 'INVALID_FIELD', message: 'No such field' });
  assert.equal(calls, 1);
});

test('long provider backoff fails without an early retry', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('Busy', { status: 429, headers: { 'retry-after': '60' } }); };
  await assert.rejects(sfRequest('/query/?q=example'), { status: 429 });
  assert.equal(calls, 1);
});
