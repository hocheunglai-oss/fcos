import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260830172911_fcos_fcuno_identity_federation.sql', import.meta.url);

test('FCUNO federation identity records are RLS-protected and unavailable to browser roles', async () => {
  const sql = await readFile(migration, 'utf8');
  for (const table of ['fcos_external_identity_links', 'fcos_external_identity_sync_transactions', 'fcos_external_identity_audit']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`, 'i'));
  }
  assert.match(sql, /unique \(provider, issuer, subject\)/i);
  assert.match(sql, /unique \(provider, issuer, event_id\)/i);
  assert.match(sql, /username text null/i);
  assert.match(sql, /credential_revision bigint not null/i);
  assert.match(sql, /fcos_external_identity_audit_append_only/i);
  assert.match(sql, /create trigger fcos_protect_external_identity_revision/i);
  assert.match(sql, /FCUNO identity revision cannot move backwards/i);
  assert.match(sql, /A linked FCOS authentication identity cannot be rebound/i);
  assert.match(sql, /A synchronized FCUNO identity revision is immutable/i);
  assert.match(sql, /grant select, insert on table public\.fcos_external_identity_audit to service_role/i);
  assert.doesNotMatch(sql, /grant all on table public\.fcos_external_identity_audit/i);
});
