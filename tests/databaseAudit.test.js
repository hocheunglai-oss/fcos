import test from 'node:test';
import assert from 'node:assert/strict';
import { runDatabaseAudit, DATABASE_AUDIT_QUERY } from '../scripts/fcos-database-audit.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
const runtime = { credentialAvailable: true, env: { SUPABASE_ACCESS_TOKEN: 'test-only-not-a-credential' } };
test('database audit verifies exact project before fixed read-only catalog query and redacts auth config', async () => {
  const calls = [];
  const result = await runDatabaseAudit({ runtime, fetcher: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/projects') ? [{ id: fcosConnectionIdentifier('supabase', 'Project ref'), name: 'FCOS' }]
      : url.endsWith('/config/auth') ? { password_hibp_enabled: false, smtp_pass: 'not-to-return' } : [{ table_name: 'cashflow_bank_accounts', rls_enabled: true }] };
  } });
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /database\/query\/read-only$/);
  assert.equal(JSON.parse(calls[1].options.body).query, DATABASE_AUDIT_QUERY);
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(result.readOnly, true);
  assert.equal(JSON.stringify(result).includes('not-to-return'), false);
});
test('wrong project or failed authentication stops before database requests', async () => {
  let count = 0;
  await assert.rejects(runDatabaseAudit({ runtime, fetcher: async () => { count++; return { ok: true, json: async () => [{ id: 'other', name: 'FCOS' }] }; } }), /identity/);
  assert.equal(count, 1);
  await assert.rejects(runDatabaseAudit({ runtime: { credentialAvailable: false }, fetcher: () => { throw new Error('must not request'); } }), /authorization/);
});
