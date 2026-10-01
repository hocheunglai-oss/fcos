import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isIP } from 'node:net';

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

export function verifyLocalMigrationServer({ address, databaseUrl, cwd = process.cwd(), env = process.env, runDocker } = {}) {
  const url = disposableDatabaseUrl(databaseUrl);
  if (!isIP(address || '')) throw new Error('Migration database server address could not be verified.');
  if (env.FCOS_MIGRATION_DISPOSABLE_CLUSTER !== '1') throw new Error('Migration verification requires an explicitly disposable local cluster.');
  const target = env.FCOS_MIGRATION_DOCKER_CONTAINER;
  if (!target && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return { transport: 'loopback' };
  if (!target) throw new Error('Migration verification requires a loopback server or an explicitly verified local Docker container.');
  let project;
  try {
    project = readFileSync(join(cwd, 'supabase/config.toml'), 'utf8').match(/^\s*project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*(?:#.*)?$/m)?.[1];
    if (!project) throw new Error('Local Supabase project_id is missing or invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    project = basename(cwd);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(project) || target !== `supabase_db_${project}`) throw new Error('Migration Docker container does not match the local Supabase project.');
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith('unix:///')) throw new Error('Migration verification refuses a remote Docker host.');
  const dockerEnv = { ...env }; delete dockerEnv.DOCKER_HOST; delete dockerEnv.DOCKER_CONTEXT;
  const run = runDocker || ((args, commandEnv) => execFileSync('docker', args, {
    cwd, env: commandEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 65536,
  }).trim());
  let endpoint;
  let container;
  try {
    endpoint = env.DOCKER_HOST && !env.DOCKER_CONTEXT ? env.DOCKER_HOST
      : JSON.parse(run(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], env));
    if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) throw new Error('Remote Docker endpoint.');
    // Force the verified local socket. Inspect only nonsecret identity/network
    // fields; never request Docker's environment or complete inspect output.
    const format = '{"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}';
    container = JSON.parse(run(['--host', endpoint, 'inspect', '--type', 'container', '--format', format, target], dockerEnv));
  } catch { throw new Error('Local Docker target proof could not be verified; migration verification stopped.'); }
  const port = url.port || '5432';
  const requestedHost = url.hostname.replace(/^\[|\]$/g, '');
  const bindings = container.ports?.['5432/tcp'];
  const bindingMatches = Array.isArray(bindings) && bindings.some(binding => binding.HostPort === port
    && (binding.HostIp === '0.0.0.0' || binding.HostIp === '::' || binding.HostIp === requestedHost
      || (requestedHost === 'localhost' && ['127.0.0.1', '::1'].includes(binding.HostIp))));
  const networkMatches = Object.values(container.networks || {}).some(network => network.IPAddress === address || network.GlobalIPv6Address === address);
  if (container.name !== `/${target}` || container.running !== true || container.project !== project || !bindingMatches || !networkMatches) {
    throw new Error('Database server address or published port does not match the pinned local Supabase Docker container.');
  }
  return { transport: 'local-docker', container: target, project };
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
