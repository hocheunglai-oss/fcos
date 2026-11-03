import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { isDeepStrictEqual } from 'node:util';

export const MIGRATION_PARENT_PROOF_PATH = '/controller/output/disposable-migration-server.json';
export const MIGRATION_STANDARD_ROLES = Object.freeze(['anon', 'authenticated', 'authenticator', 'postgres', 'service_role']);
export const MIGRATION_SERVER_IDENTITY_SQL = `select host(inet_server_addr()) as address, current_database() as database,
  current_setting('data_directory') as "dataDirectory",
  to_char(pg_postmaster_start_time() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "serverStartedAt",
  (select system_identifier::text from pg_control_system()) as "systemIdentifier",
  current_user as "currentUser", session_user as "sessionUser", current_setting('role',true) as "roleSetting"`;

const exactObject = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const identityKeys = ['address', 'database', 'dataDirectory', 'serverStartedAt', 'systemIdentifier', 'currentUser', 'sessionUser', 'roleSetting'];

/** The fixed controller mount is the trust boundary, not arbitrary environment JSON. */
export function isReadOnlyMigrationProofMount(mountInfo) {
  if (typeof mountInfo !== 'string') return false;
  const decode = value => value.replace(/\\(040|011|012|134)/g, (_match, code) => String.fromCharCode(Number.parseInt(code, 8)));
  const covering = mountInfo.split('\n').flatMap(line => {
    const fields = line.split(' - ')[0].split(' ');
    if (fields.length < 6) return [];
    const target = decode(fields[4]);
    return MIGRATION_PARENT_PROOF_PATH === target || MIGRATION_PARENT_PROOF_PATH.startsWith(`${target}/`)
      ? [{ target, readOnly: fields[5].split(',').includes('ro') }] : [];
  }).sort((a, b) => b.target.length - a.target.length);
  const mount = covering[0];
  return Boolean(mount && (mount.target === '/controller' || mount.target.startsWith('/controller/')) && mount.readOnly);
}

export function loadMigrationParentProof({ env = process.env } = {}) {
  if (env.FCOS_MIGRATION_PARENT_PROOF_FILE !== MIGRATION_PARENT_PROOF_PATH
    || !/^[a-f0-9]{64}$/.test(env.FCOS_MIGRATION_PARENT_PROOF_SHA256 || '')) {
    throw new Error('A fixed hash-bound controller migration proof is required.');
  }
  try {
    const stat = lstatSync(MIGRATION_PARENT_PROOF_PATH);
    if (process.platform !== 'linux' || !stat.isFile() || stat.isSymbolicLink() || stat.size > 32768
      || (stat.mode & 0o222) !== 0 || realpathSync(MIGRATION_PARENT_PROOF_PATH) !== MIGRATION_PARENT_PROOF_PATH
      || !isReadOnlyMigrationProofMount(readFileSync('/proc/self/mountinfo', 'utf8'))) throw new Error();
    const bytes = readFileSync(MIGRATION_PARENT_PROOF_PATH);
    if (migrationSha256(bytes) !== env.FCOS_MIGRATION_PARENT_PROOF_SHA256) throw new Error();
    return JSON.parse(bytes);
  } catch { throw new Error('The read-only controller migration proof could not be verified.'); }
}

export function validateMigrationParentProof(proof, { identity, databaseUrl, projectId, controllerSha, candidateSha, roles } = {}) {
  const url = disposableDatabaseUrl(databaseUrl);
  const target = { hostname: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username), database: decodeURIComponent(url.pathname.slice(1)) };
  const validIdentity = exactObject(identity, identityKeys) && isIP(identity.address || '')
    && identity.database === 'postgres' && identity.currentUser === 'postgres' && identity.sessionUser === 'postgres' && identity.roleSetting === 'none'
    && typeof identity.dataDirectory === 'string' && identity.dataDirectory.startsWith('/') && !/[\0\r\n]/.test(identity.dataDirectory) && !identity.dataDirectory.split('/').includes('..')
    && typeof identity.serverStartedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(identity.serverStartedAt) && Number.isFinite(Date.parse(identity.serverStartedAt))
    && typeof identity.systemIdentifier === 'string' && /^[1-9][0-9]{0,19}$/.test(identity.systemIdentifier);
  if (!exactObject(proof, ['kind', 'schemaVersion', 'projectId', 'container', 'url', 'identity', 'roles', 'source'])
    || proof.kind !== 'fcos_disposable_migration_parent_proof_v1' || proof.schemaVersion !== 1 || projectId !== 'fcos' || proof.projectId !== projectId
    || !exactObject(proof.container, ['name', 'id']) || proof.container.name !== 'supabase_db_fcos' || !/^[a-f0-9]{64}$/.test(proof.container.id || '')
    || !exactObject(proof.url, ['hostname', 'port', 'username', 'database']) || !isDeepStrictEqual(proof.url, target)
    || !isDeepStrictEqual(target, { hostname: '127.0.0.1', port: 54322, username: 'postgres', database: 'postgres' })
    || !validIdentity || !isDeepStrictEqual(proof.identity, identity)
    || !Array.isArray(roles) || !isDeepStrictEqual([...roles].sort(), MIGRATION_STANDARD_ROLES) || !isDeepStrictEqual(proof.roles, MIGRATION_STANDARD_ROLES)
    || !exactObject(proof.source, ['controllerSha', 'candidateSha']) || !/^[a-f0-9]{40}$/.test(controllerSha || '') || !/^[a-f0-9]{40}$/.test(candidateSha || '')
    || proof.source.controllerSha !== controllerSha || proof.source.candidateSha !== candidateSha) {
    throw new Error('The controller migration proof does not match this disposable server and source binding.');
  }
  return { transport: 'trusted-parent-docker', container: proof.container.name, containerId: proof.container.id, project: projectId };
}

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

function localMigrationProject(cwd, env) {
  const pinnedProject = env.FCOS_MIGRATION_PROJECT_ID;
  if (pinnedProject !== undefined && (typeof pinnedProject !== 'string' || !/^[A-Za-z0-9_-]+$/.test(pinnedProject))) {
    throw new Error('The explicit local migration project ID is invalid.');
  }
  let project;
  try {
    project = readFileSync(join(cwd, 'supabase/config.toml'), 'utf8').match(/^\s*project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*(?:#.*)?$/m)?.[1];
    if (!project) throw new Error('Local Supabase project_id is missing or invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    project = pinnedProject;
    if (!project) throw new Error('FCOS_MIGRATION_PROJECT_ID is required when the local Supabase configuration is absent.');
  }
  if (pinnedProject !== undefined && pinnedProject !== project) throw new Error('The explicit migration project does not match the local Supabase project.');
  return project;
}

export function verifyLocalMigrationServer({ address, databaseUrl, cwd = process.cwd(), env = process.env, runDocker, identity, roles } = {}) {
  const url = disposableDatabaseUrl(databaseUrl);
  if (!isIP(address || '')) throw new Error('Migration database server address could not be verified.');
  if (env.FCOS_MIGRATION_DISPOSABLE_CLUSTER !== '1') throw new Error('Migration verification requires an explicitly disposable local cluster.');
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith('unix:///')) throw new Error('Migration verification refuses a remote Docker host.');
  const target = env.FCOS_MIGRATION_DOCKER_CONTAINER;
  if (env.FCOS_MIGRATION_PARENT_PROOF_FILE !== undefined || env.FCOS_MIGRATION_PARENT_PROOF_SHA256 !== undefined) {
    const project = localMigrationProject(cwd, env), proof = loadMigrationParentProof({ env });
    if (target !== 'supabase_db_fcos' || identity?.address !== address) throw new Error('The controller migration proof target does not match the requested server.');
    return { ...validateMigrationParentProof(proof, { identity, databaseUrl, projectId: project,
      controllerSha: env.FCOS_CONTROLLER_SHA, candidateSha: env.FCOS_CANDIDATE_SHA, roles }), proofSha256: env.FCOS_MIGRATION_PARENT_PROOF_SHA256 };
  }
  if (!target && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return { transport: 'loopback' };
  if (!target) throw new Error('Migration verification requires a loopback server or an explicitly verified local Docker container.');
  const project = localMigrationProject(cwd, env);
  if (!/^[A-Za-z0-9_-]+$/.test(project) || target !== `supabase_db_${project}`) throw new Error('Migration Docker container does not match the local Supabase project.');
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
    const format = '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}';
    container = JSON.parse(run(['--host', endpoint, 'inspect', '--type', 'container', '--format', format, target], dockerEnv));
  } catch { throw new Error('Local Docker target proof could not be verified; migration verification stopped.'); }
  const port = url.port || '5432';
  const requestedHost = url.hostname.replace(/^\[|\]$/g, '');
  const bindings = container.ports?.['5432/tcp'];
  const bindingMatches = Array.isArray(bindings) && bindings.some(binding => binding.HostPort === port
    && (binding.HostIp === '0.0.0.0' || binding.HostIp === '::' || binding.HostIp === requestedHost
      || (requestedHost === 'localhost' && ['127.0.0.1', '::1'].includes(binding.HostIp))));
  const networkMatches = Object.values(container.networks || {}).some(network => network.IPAddress === address || network.GlobalIPv6Address === address);
  if (!/^[a-f0-9]{64}$/.test(container.id || '') || container.name !== `/${target}` || container.running !== true || container.project !== project || !bindingMatches || !networkMatches) {
    throw new Error('Database server address or published port does not match the pinned local Supabase Docker container.');
  }
  return { transport: 'local-docker', container: target, containerId: container.id, project, endpoint };
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
