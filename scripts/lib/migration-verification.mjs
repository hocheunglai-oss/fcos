import { createHash } from 'node:crypto';

export function migrationSha256(sql) { return createHash('sha256').update(sql).digest('hex'); }

export function planMigrationVerification(migrations, baseline) {
  const names = migrations.map(item => item.name);
  if (!names.length || names.some(name => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name))) throw new Error('Invalid or missing Supabase migration filenames.');
  if (new Set(names.map(name => name.slice(0, 14))).size !== names.length) throw new Error('Duplicate migration timestamps.');
  if (baseline?.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(baseline.commit || '') || !Array.isArray(baseline.migrations) || !baseline.migrations.length) throw new Error('A recorded release baseline and migration digest ledger are required.');
  const recorded = new Map();
  for (const item of baseline.migrations) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(item.name || '') || !/^[0-9a-f]{64}$/.test(item.sha256 || '') || recorded.has(item.name)) throw new Error('Invalid baseline migration ledger.');
    recorded.set(item.name, item.sha256);
  }
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  for (const [name, expected] of recorded) {
    const actual = ordered.find(item => item.name === name);
    if (!actual || migrationSha256(actual.sql) !== expected) throw new Error(`Recorded baseline migration was removed or changed: ${name}`);
  }
  const boundary = [...recorded.keys()].sort().at(-1);
  const pending = ordered.filter(item => !recorded.has(item.name));
  if (pending.some(item => item.name <= boundary)) throw new Error('Pending migration predates the recorded release baseline; use a new chronological migration.');
  return { baseline: ordered.filter(item => recorded.has(item.name)), pending, ordered, baselineCommit: baseline.commit, baselineVersion: baseline.version };
}

export function disposableDatabaseUrl(databaseUrl) {
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('A valid disposable local PostgreSQL URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.search || url.hash || !url.username || !url.pathname || url.pathname === '/') {
    throw new Error('Migration verification requires a loopback PostgreSQL URL without connection overrides.');
  }
  return url;
}

// Only migration-facing platform contracts are bootstrapped. Real Supabase Auth,
// Storage and REST integration remain the authenticated release harness's scope.
export const LOCAL_PLATFORM_FIXTURE_SQL = `
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
grant usage on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres, service_role;
`;
