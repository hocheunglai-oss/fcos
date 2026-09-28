import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readSavedXeroAllowance } from '../api/_xeroSavedAllowance.js';
import { xeroFinancialSyncLatest } from '../api/_xeroFinancialSync.js';
import { latestXeroDailyAllowance } from '../src/lib/xeroDailyAllowance.js';

const tenant = '00000000-0000-4000-8000-000000000001';
const time = '2026-09-28T08:44:00.000Z';
function fixture({ rate = { observedAt: time, dayRemaining: 30, dayResetAt: null }, responseTenant = tenant, fail = false, connected = true } = {}) {
  const calls = [];
  const client = createClient('https://fixture.invalid', 'fixture-key', { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (input, options) => {
      const url = new URL(input); calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) });
      assert.equal(options.method, 'GET');
      if (url.pathname.endsWith('/xero_contact_sync_connections')) {
        assert.equal(url.searchParams.get('select'), 'tenant_id');
        assert.equal(url.searchParams.get('id'), 'eq.primary');
        return Response.json(connected ? [{ tenant_id: tenant }] : []);
      }
      if (url.pathname.endsWith('/xero_financial_audit_events')) {
        assert.equal(url.searchParams.get('fingerprints->>tenantId'), `eq.${tenant}`);
        assert.equal(url.searchParams.get('order'), 'rate_limit_snapshot->>observedAt.desc.nullslast');
        assert.equal(url.searchParams.get('limit'), '1');
        if (fail) return Response.json({ message: 'Private database error' }, { status: 403 });
        return Response.json(rate ? [{ fingerprints: { tenantId: responseTenant }, rate_limit_snapshot: rate }] : []);
      }
      assert.ok(url.pathname.endsWith('/xero_financial_sync_runs'));
      return Response.json([]);
    },
  } });
  return { client, calls };
}

test('restores newest tenant-bound saved allowance using observation-time ordering without Xero calls', async () => {
  const f = fixture();
  const result = await readSavedXeroAllowance(f.client, { now: Date.parse(time) });
  assert.equal(result.rateLimit.dayRemaining, 30);
  assert.equal(result.rateLimit.dayResetAt, null);
  assert.equal(f.calls.length, 2);
  assert.equal(latestXeroDailyAllowance({ dayRemaining: 60, observedAt: '2026-09-28T07:51:00.000Z' }, result).dayRemaining, 30);
});

test('latest financial response exposes saved quota even without an ordinary preview', async () => {
  const f = fixture();
  const result = await xeroFinancialSyncLatest({}, { client: f.client });
  assert.equal(result.preview, null);
  assert.equal(result.rateLimit.dayRemaining, 30);
  assert.equal(f.calls.length, 3);
});

test('disconnected and no-audit cases do not invent allowance or reset time', async () => {
  const disconnected = fixture({ connected: false });
  assert.deepEqual(await readSavedXeroAllowance(disconnected.client), {});
  assert.equal(disconnected.calls.length, 1);
  assert.deepEqual(await readSavedXeroAllowance(fixture({ rate: null }).client), {});
});

for (const [name, overrides] of [
  ['wrong tenant', { responseTenant: '00000000-0000-4000-8000-000000000099' }],
  ['negative allowance', { rate: { observedAt: time, dayRemaining: -1 } }],
  ['fractional allowance', { rate: { observedAt: time, dayRemaining: 1.5 } }],
  ['future observation', { rate: { observedAt: '2099-09-28T08:44:00.000Z', dayRemaining: 999 } }],
  ['malformed reset', { rate: { observedAt: time, dayRemaining: 30, dayResetAt: 'tomorrow' } }],
  ['storage failure', { fail: true }],
]) test(`${name} cannot replace known allowance or expose private errors`, async () => {
  const result = await readSavedXeroAllowance(fixture(overrides).client, { now: Date.parse(time) });
  assert.deepEqual(result, { allowanceAuditUnavailable: true });
  assert.ok(!JSON.stringify(result).includes('Private'));
});

test('zero remaining and actual provider retry/reset deadlines are preserved literally', async () => {
  const rate = { observedAt: time, dayRemaining: 0, rateLimitProblem: 'day', retryAfterSeconds: 3600,
    retryAt: '2026-09-28T09:44:00.000Z', dayResetAt: '2026-09-28T09:44:00.000Z', privatePayload: 'must-not-leak' };
  const result = await readSavedXeroAllowance(fixture({ rate }).client, { now: Date.parse(time) });
  const { privatePayload: _private, ...expected } = rate;
  assert.deepEqual(result.rateLimit, expected);
});
