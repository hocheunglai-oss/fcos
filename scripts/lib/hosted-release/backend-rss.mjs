import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import pg from 'pg';
import { MIGRATION_SERVER_IDENTITY_SQL, MIGRATION_STANDARD_ROLES, validateMigrationParentProof,
  verifyLocalMigrationServer } from '../migration-verification.mjs';

export const BACKEND_RSS_ROUTE = '/v1/disposable-postgres-backend-rss';
export const BACKEND_RSS_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const BACKEND_RSS_PREFIXES = Object.freeze({ financial_preview: 'fcos_payment_ref_', checkpoint_resume: 'fcos_checkpoint_chunks_' });
export const BACKEND_IDENTITY_SQL = `select pg_backend_pid() as pid,current_database() as database,
  host(inet_server_addr()) as address,
  to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "serverStartedAt",
  to_char(backend_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "backendStartedAt"
  from pg_stat_activity where pid=pg_backend_pid()`;
const activitySql = `select pid,datname as database,usename,backend_type,
  to_char(backend_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "backendStartedAt",
  to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "serverStartedAt"
  from pg_stat_activity where pid=$1 and datname=$2`;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value) && Number.isFinite(Date.parse(value));
const sha = value => createHash('sha256').update(value).digest('hex');

export function validateBackendRssRequest(value, checkId) {
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), ['backendStartedAt','database','pid'])
    || !Number.isSafeInteger(value.pid) || value.pid <= 1 || value.pid > 2147483647
    || !BACKEND_RSS_PREFIXES[checkId] || !new RegExp(`^${BACKEND_RSS_PREFIXES[checkId]}[a-f0-9]{32}$`).test(value.database || '')
    || !timestamp(value.backendStartedAt)) throw new Error('Disposable backend identity required.');
  return value;
}

export function parseBackendRss(stdout, pid) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 32768) throw new Error('Bounded PostgreSQL process observation required.');
  const [comm, stat, ...status] = stdout.split('\n');
  if (!['postgres', '.postgres-wrapp'].includes(comm) || !stat?.startsWith(`${pid} (`)) throw new Error('PostgreSQL process identity changed.');
  const processStartedAt = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
  const rssKiB = Number(status.join('\n').match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
  if (!/^[1-9][0-9]*$/.test(processStartedAt || '') || !Number.isSafeInteger(rssKiB) || rssKiB <= 0 || rssKiB > 64 * 1024 * 1024) {
    throw new Error('Positive bounded PostgreSQL RSS required.');
  }
  return { rssKiB, processStartedAt };
}

/** Parent only: the candidate receives numeric metrics, never Docker access or raw /proc files. */
export async function startBackendRssTransport({ controllerDirectory, controllerSha, candidateSha, checkId, proofSha256,
  client = new pg.Client({ connectionString: BACKEND_RSS_URL, connectionTimeoutMillis: 5000, query_timeout: 1500 }),
  verifyServer = verifyLocalMigrationServer, execute = promisify(execFile), now = Date.now } = {}) {
  if (!BACKEND_RSS_PREFIXES[checkId] || !/^[a-f0-9]{64}$/.test(proofSha256 || '')) throw new Error('Trusted RSS parent context required.');
  const file = join(realpathSync(controllerDirectory), 'output/disposable-migration-server.json');
  const stat = lstatSync(file), bytes = readFileSync(file);
  if (realpathSync(file) !== file || !stat.isFile() || stat.isSymbolicLink() || stat.size > 32768 || (stat.mode & 0o222) !== 0 || sha(bytes) !== proofSha256) {
    throw new Error('Physical read-only RSS server proof required.');
  }
  const proof = JSON.parse(bytes);
  let server;
  try {
    await client.connect();
    const identity = (await client.query(MIGRATION_SERVER_IDENTITY_SQL)).rows[0];
    const roles = (await client.query('select rolname from pg_roles where rolname=any($1::text[]) order by rolname', [MIGRATION_STANDARD_ROLES])).rows.map(row => row.rolname);
    validateMigrationParentProof(proof, { identity, roles, databaseUrl: BACKEND_RSS_URL, projectId: 'fcos', controllerSha, candidateSha });
    const transport = verifyServer({ address: identity.address, databaseUrl: BACKEND_RSS_URL,
      cwd: join(controllerDirectory, 'output/disposable-migration-project'), env: { ...process.env,
        FCOS_MIGRATION_DISPOSABLE_CLUSTER: '1', FCOS_MIGRATION_PROJECT_ID: 'fcos', FCOS_MIGRATION_DOCKER_CONTAINER: 'supabase_db_fcos',
        FCOS_MIGRATION_PARENT_PROOF_FILE: undefined, FCOS_MIGRATION_PARENT_PROOF_SHA256: undefined } });
    if (transport.transport !== 'local-docker' || transport.containerId !== proof.container.id || !transport.endpoint?.startsWith('unix:///')) {
      throw new Error('RSS container identity changed.');
    }
    const starts = new Map(); let busy = false;
    const activity = async value => {
      const row = (await client.query(activitySql, [value.pid, value.database])).rows[0];
      if (!row || row.usename !== 'postgres' || row.backend_type !== 'client backend'
        || row.backendStartedAt !== value.backendStartedAt || row.serverStartedAt !== proof.identity.serverStartedAt) throw new Error('RSS backend changed.');
    };
    server = createServer(async (request, response) => {
      const refuse = () => { response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end('{"error":"RSS_OBSERVATION_REFUSED"}'); };
      if (busy || request.method !== 'GET' || request.headers['content-length'] || request.headers['transfer-encoding'] || request.url.length > 512) return refuse();
      busy = true;
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname !== BACKEND_RSS_ROUTE || url.searchParams.size !== 3) throw new Error();
        const value = validateBackendRssRequest({ pid: Number(url.searchParams.get('pid')), database: url.searchParams.get('database'), backendStartedAt: url.searchParams.get('backendStartedAt') }, checkId);
        if ([...url.searchParams.keys()].some(key => !['pid','database','backendStartedAt'].includes(key))) throw new Error();
        await activity(value);
        const observed = await execute('docker', ['--host', transport.endpoint, 'exec', proof.container.id, 'cat',
          `/proc/${value.pid}/comm`, `/proc/${value.pid}/stat`, `/proc/${value.pid}/status`], {
          encoding: 'utf8', timeout: 1500, maxBuffer: 32768, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
        const metric = parseBackendRss(observed.stdout, value.pid);
        await activity(value);
        const original = starts.get(value.pid);
        if (original && !isDeepStrictEqual(original, { backendStartedAt: value.backendStartedAt, processStartedAt: metric.processStartedAt })) throw new Error();
        starts.set(value.pid, { backendStartedAt: value.backendStartedAt, processStartedAt: metric.processStartedAt });
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ kind: 'fcos_disposable_backend_rss_v1', ...value, ...metric, observedAt: new Date(now()).toISOString(),
          checkId, source: proof.source, proofSha256 }));
      } catch { refuse(); }
      finally { busy = false; }
    });
    server.requestTimeout = 2500; server.headersTimeout = 2500; server.keepAliveTimeout = 2500;
    server.maxConnections = 4; server.maxRequestsPerSocket = 64;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { dockerEndpoint: transport.endpoint, env: { FCOS_HOSTED_CHECK_EXECUTION: '1', FCOS_BACKEND_RSS_ENDPOINT: `http://127.0.0.1:${server.address().port}${BACKEND_RSS_ROUTE}`,
      FCOS_BACKEND_RSS_CHECK_ID: checkId, FCOS_MIGRATION_PARENT_PROOF_FILE: '/controller/output/disposable-migration-server.json',
      FCOS_MIGRATION_PARENT_PROOF_SHA256: proofSha256, FCOS_CONTROLLER_SHA: controllerSha, FCOS_CANDIDATE_SHA: candidateSha },
    close: async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await client.end(); } };
  } catch (error) { server?.close(); await client.end().catch(() => {}); throw error; }
}
