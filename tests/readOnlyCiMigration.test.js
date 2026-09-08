import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('browser-role cleanup preserves existing RLS reads and performs no data mutation', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260906161240_restrict_browser_role_admin_grants.sql', import.meta.url), 'utf8');
  assert.match(sql, /^begin;/);
  assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated;/);
  assert.match(sql, /grant select on table[\s\S]*to authenticated;/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated;/);
  assert.match(sql, /to service_role;/);
  assert.doesNotMatch(sql, /\b(insert into|update public\.|delete from|drop table|disable row level security|grant all)\b/i);
});

test('the disposable database release gate verifies CI grants on empty and upgrade fixtures', async () => {
  const verify = await readFile(new URL('../scripts/verify-migrations.mjs', import.meta.url), 'utf8');
  assert.match(verify, /'20260906161240_restrict_browser_role_admin_grants.sql'/);
  for (const evidence of ['administration RLS retained', 'browser administration writes denied',
    'existing RLS-filtered browser reads retained', 'service-role administration retained',
    'internal helpers are not browser RPCs', 'service-role internal helper execution retained']) {
    assert.ok(verify.includes(evidence));
  }
});
