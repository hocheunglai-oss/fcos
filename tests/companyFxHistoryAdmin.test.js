import assert from 'node:assert/strict';
import test from 'node:test';
import { listCompanyFxHistory, saveHistoricalCompanyFxRate } from '../api/_companyFxHistoryAdmin.js';
import { runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';

const actor = '1ecfd6d1-f4e5-4e37-b68e-e07a34d21d5e';
const inputs = { effectiveDate: '2026-09-10', usdHkdRate: '7.812346', reason: 'Approved historical rate' };

function context(role, { generalManager = false, duplicate = false } = {}) {
  const calls = [];
  const profile = { id: actor, user_type: role, active: true };
  const row = { id: 'historical-rate', effective_at: '2026-09-09T16:00:00.000Z', rate: '7.812346',
    settings_revision: null, reason: inputs.reason, recorded_at: '2026-09-11T02:00:00.000Z' };
  const data = {
    variable_charge_settings: { usd_hkd_rate: 7.84, revision: 3 },
    collaboration_roles: generalManager ? [{ user_id: actor }] : [],
    user_profiles: profile,
    company_fx_rate_history: [row],
  };
  const client = {
    from(table) {
      calls.push(['from', table]);
      const chain = {
        select(columns) { calls.push(['select', table, columns]); return chain; },
        eq() { return chain; },
        order() { return chain; },
        async limit(limit) { calls.push(['limit', limit]); return { data: data[table], error: null }; },
        async maybeSingle() { return { data: data[table], error: null }; },
        insert(value) { calls.push(['insert', table, value]); return chain; },
        async single() { return duplicate ? { data: null, error: { code: '23505' } } : { data: row, error: null }; },
        then(resolve, reject) { return Promise.resolve({ data: data[table], error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
  return { client, profile, calls };
}

test('rate history remains restricted to administrators and the active General Manager', async () => {
  const employee = context('employee');
  await assert.rejects(listCompanyFxHistory({}, employee), { status: 403 });
  await assert.rejects(saveHistoricalCompanyFxRate(inputs, employee), { status: 403 });
  assert.equal(employee.calls.some(call => call[1] === 'company_fx_rate_history'), false);
  for (const permitted of [context('administrator'), context('general_manager', { generalManager: true })]) {
    const result = await listCompanyFxHistory({}, permitted);
    assert.equal(result.rows[0].rateId, 'historical-rate');
    assert.equal(result.rows[0].usdHkdRate, 7.812346);
    assert.equal(Object.hasOwn(result.rows[0], 'actorUserId'), false);
    assert.ok(permitted.calls.some(call => call[0] === 'limit' && call[1] === 100));
  }
});

test('historical rates record exact decimal, Hong Kong midnight and the authenticated actor', async () => {
  const admin = context('administrator');
  const result = await saveHistoricalCompanyFxRate({ ...inputs, actorUserId: 'ignored' }, admin);
  assert.equal(result.row.rateId, 'historical-rate');
  assert.deepEqual(admin.calls.find(call => call[0] === 'insert'), ['insert', 'company_fx_rate_history', {
    pair: 'USD/HKD', rate: '7.812346', effective_at: '2026-09-09T16:00:00.000Z', settings_revision: null,
    actor_user_id: actor, reason: inputs.reason,
  }]);
  await assert.rejects(saveHistoricalCompanyFxRate(inputs, context('administrator', { duplicate: true })), { status: 409 });
});

test('staging denies history writes before any storage and rejects invalid history inputs', async () => {
  const admin = context('administrator');
  await runWithDeploymentRequestSafety({ headers: { host: 'fcos-stage.vercel.app' } }, () =>
    assert.rejects(saveHistoricalCompanyFxRate(inputs, admin), { code: 'FCOS_DEPLOYMENT_READ_ONLY' }), { VERCEL_ENV: 'production' });
  assert.equal(admin.calls.length, 0);
  for (const patch of [{ effectiveDate: '2026-02-30' }, { effectiveDate: '2099-01-01' }, { usdHkdRate: '7.8123456' }, { reason: 'x' }]) {
    await assert.rejects(saveHistoricalCompanyFxRate({ ...inputs, ...patch }, admin), { status: 400 });
  }
  assert.equal(admin.calls.some(call => call[0] === 'insert'), false);
});
