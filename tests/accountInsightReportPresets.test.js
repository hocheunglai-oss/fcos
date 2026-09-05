import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { listAccountInsightReportPresets, saveAccountInsightReportPreset } from '../api/_accountInsightReportPresets.js';

const USER = '11111111-1111-4111-8111-111111111111';
const PRESET = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const profile = { id: USER, active: true };
const config = { audience: 'buyer', sections: ['profile', 'stems'], columns: ['stem', 'currency', 'invoice'], depth: 'detail', includeExpected: false, includeCharts: true };
const migrationUrl = new URL('../supabase/migrations/20260905102212_account_insight_report_presets.sql', import.meta.url);

function saveContext(result = { data: { id: PRESET, owner_user_id: USER, scope: 'personal', name: 'My report', configuration: config, revision: 1, archived_at: null, updated_at: '2026-09-05T00:00:00Z' }, error: null }) {
  const calls = [];
  return { calls, profile, client: { async rpc(name, args) { calls.push({ name, args }); return result; } } };
}

test('preset saves validate presentation-only config before the RPC and require an explicit non-null audience', async () => {
  for (const configuration of [{ ...config, audience: null }, (() => { const value = { ...config }; delete value.audience; return value; })(), { ...config, selectedStemIds: ['leak'] }]) {
    const context = saveContext();
    await assert.rejects(saveAccountInsightReportPreset(context, { scope: 'personal', name: 'My report', configuration, expectedRevision: 0, idempotencyKey: REQUEST }), (error) => error.status === 400 && error.code === 'ACCOUNT_INSIGHT_PRESET');
    assert.equal(context.calls.length, 0);
  }
});

test('personal save sends the active owner, revision, and content-bound idempotency evidence atomically', async () => {
  const context = saveContext();
  const result = await saveAccountInsightReportPreset(context, { scope: 'personal', name: 'My report', configuration: config, expectedRevision: 0, idempotencyKey: REQUEST });
  assert.equal(result.preset.ownerUserId, USER);
  assert.equal(context.calls.length, 1);
  const call = context.calls[0];
  assert.equal(call.name, 'save_account_insight_report_preset');
  assert.equal(call.args.p_actor_user_id, USER); assert.equal(call.args.p_expected_revision, 0); assert.equal(call.args.p_idempotency_key, REQUEST);
  assert.match(call.args.p_request_hash, /^[a-f0-9]{64}$/); assert.deepEqual(call.args.p_configuration, config);
});

test('company writes require the server-provided GM/admin capability and stale revisions map to a reload conflict', async () => {
  const denied = saveContext();
  await assert.rejects(saveAccountInsightReportPreset(denied, { scope: 'company', name: 'Company', configuration: config, expectedRevision: 0, idempotencyKey: REQUEST }), (error) => error.status === 403);
  assert.equal(denied.calls.length, 0);
  const stale = saveContext({ data: null, error: { code: '40001' } });
  await assert.rejects(saveAccountInsightReportPreset(stale, { id: PRESET, scope: 'company', name: 'Company', configuration: config, expectedRevision: 1, idempotencyKey: REQUEST }, { manageCompanyPresets: true }), (error) => error.status === 409 && /Reload/.test(error.message));
});

test('listing is bounded and filters service-role results to owner personal rows plus company rows', async () => {
  const calls = [];
  const query = { select() { return this; }, is() { return this; }, or(value) { calls.push(['or', value]); return this; }, order() { return this; }, async limit(value) { calls.push(['limit', value]); return { data: [], error: null }; } };
  const result = await listAccountInsightReportPresets({ profile, client: { from(table) { calls.push(['from', table]); return query; } } });
  assert.deepEqual(result, { presets: [] });
  assert.deepEqual(calls, [['from', 'account_insight_report_presets'], ['or', `owner_user_id.eq.${USER},scope.eq.company`], ['limit', 501]]);
});

test('migration keeps tables, audit events, RLS, grants, owner checks, company GM/admin checks, stale revisions, and idempotency service-only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of ['account_insight_report_presets', 'account_insight_report_preset_events']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(sql, /revoke all on public\.account_insight_report_presets, public\.account_insight_report_preset_events from public, anon, authenticated/i);
  assert.match(sql, /unique\(actor_user_id,idempotency_key\)/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /v_current\.owner_user_id <> p_actor_user_id/i);
  assert.match(sql, /v_profile\.user_type = 'administrator'/i);
  assert.match(sql, /v_profile\.user_type = 'general_manager'/i);
  assert.match(sql, /p_expected_revision is distinct from v_current\.revision/i);
  assert.match(sql, /v_event\.request_hash <> p_request_hash/i);
  assert.match(sql, /not coalesce\(p_configuration->>'audience' = any/i);
  assert.match(sql, /only presentation choices may be saved/i);
  assert.doesNotMatch(sql, /detailSelection/i);
  assert.match(sql, /revoke all on function public\.save_account_insight_report_preset[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.save_account_insight_report_preset[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete) on public\.account_insight_report_presets to authenticated/i);
});
