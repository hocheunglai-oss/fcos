import { readFileSync } from 'node:fs';
import { TLSSocket } from 'node:tls';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { digest, requireCondition, targets } from './contract.mjs';

// Supabase CLI v2.113.0 / 03880bb15379c308a73b078d98780eef1eb1bd63:
// internal/utils/flags/db_url.go initLoginRole/initPoolerLogin; connect.go SET_SESSION_ROLE.
// https://supabase.com/docs/reference/api/v1-create-login-role (role,password,ttl_seconds).
const ISSUER = 'https://api.supabase.com';
const LOGIN_ROLE = 'cli_login_postgres';
const CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const MAX_TTL_SECONDS = 3600; // Local authority ceiling, not an assertion of provider TTL.
const proofByConnection = new WeakMap();
const attemptedIntents = new Set();
const check = requireCondition;
const fail = code => Object.assign(new Error(code), { code });
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const finiteTime = value => typeof value === 'number' && Number.isFinite(value);
const OWNED_CODES = new Set(['SUPABASE_MANAGEMENT_CREDENTIAL_REQUIRED', 'PINNED_DATABASE_CA_REQUIRED',
  'DURABLE_DATABASE_CREDENTIAL_INTENT_REQUIRED', 'PINNED_DATABASE_TARGET_MISMATCH', 'PINNED_DATABASE_CA_MISMATCH',
  'SUPABASE_PROJECT_IDENTITY_UNAVAILABLE', 'SUPABASE_PROJECT_IDENTITY_MISMATCH', 'SUPABASE_MANAGEMENT_ISSUER_MISMATCH',
  'SUPABASE_MANAGEMENT_RESPONSE_INVALID', 'DURABLE_DATABASE_CREDENTIAL_INTENT_REFUSED',
  'EXISTING_MANAGED_DATABASE_ROLE_REQUIRED', 'PINNED_DATABASE_TLS_REQUIRED',
  'PINNED_DELEGATED_DATABASE_IDENTITY_MISMATCH', 'PINNED_DELEGATED_DATABASE_EXPIRY_MISMATCH',
  'PINNED_DELEGATED_DATABASE_CONNECTION_REQUIRED']);

export const DELEGATED_DATABASE_IDENTITY_SQL = `select session_user,current_user,current_database() as database,
 current_setting('transaction_read_only') as read_only,
 extract(epoch from clock_timestamp())::float8*1000 as server_now_ms,
 r.rolname as login_role,r.rolcanlogin as can_login,r.rolsuper as is_superuser,
 r.rolinherit as inherits,r.rolcreaterole as creates_roles,r.rolcreatedb as creates_databases,
 r.rolreplication as replicates,r.rolbypassrls as bypasses_rls,
 extract(epoch from r.rolvaliduntil)::float8*1000 as role_valid_until_ms,
 (select coalesce(jsonb_agg(jsonb_build_object('role',p.rolname,'grantor',g.rolname,
  'set',m.set_option,'inherit',m.inherit_option,'admin',m.admin_option) order by p.rolname),'[]'::jsonb)
  from pg_auth_members m join pg_roles p on p.oid=m.roleid
  join pg_roles g on g.oid=m.grantor where m.member=r.oid) as memberships
 from pg_roles r where r.rolname=session_user`;
// For the trusted intent store's BEFORE-issuance native readback, where the
// existing connection may authenticate as postgres instead of the CLI role.
export const MANAGED_DATABASE_ROLE_SQL = DELEGATED_DATABASE_IDENTITY_SQL.replace('r.rolname=session_user', "r.rolname='cli_login_postgres'");

function managedRole(facts) {
  return facts?.login_role === LOGIN_ROLE && facts.can_login === true
    && ['is_superuser', 'inherits', 'creates_roles', 'creates_databases', 'replicates', 'bypasses_rls'].every(key => facts[key] === false)
    && Array.isArray(facts.memberships) && facts.memberships.length === 1
    && facts.memberships[0]?.role === 'postgres' && facts.memberships[0].grantor === 'supabase_admin'
    && facts.memberships[0].set === true && facts.memberships[0].inherit === false && facts.memberships[0].admin === false;
}
export { managedRole as isManagedDatabaseRole };

function nativeTls(db, host) {
  const stream = db?.connection?.stream;
  return stream instanceof TLSSocket && stream.encrypted === true && stream.authorized === true
    && stream.servername === host && !stream.destroyed;
}

export function isNativeDelegatedConnection(connection) {
  const proof = connection && typeof connection === 'object' ? proofByConnection.get(connection) : null;
  return Boolean(proof?.active && proof.now() < proof.expiresAt && nativeTls(proof.db, connection.host)
    && proof.db.connection.stream === proof.stream && !proof.db._ending);
}

export function assertPinnedDatabaseIdentity(identity, connection, { readOnly = true } = {}) {
  check(typeof readOnly === 'boolean' && isNativeDelegatedConnection(connection), 'PINNED_DELEGATED_DATABASE_CONNECTION_REQUIRED');
  check(identity?.session_user === LOGIN_ROLE && identity.current_user === 'postgres' && identity.database === 'postgres'
    && identity.read_only === (readOnly ? 'on' : 'off'), 'PINNED_DELEGATED_DATABASE_IDENTITY_MISMATCH');
  return identity; // Preserve the actual native login/effective identities.
}

export class DatabaseCredentialOutcomeUnknown extends Error {
  constructor(intentId, requestDigest) {
    super('SUPABASE_LOGIN_ROLE_OUTCOME_UNKNOWN');
    this.name = 'DatabaseCredentialOutcomeUnknown';
    this.code = 'SUPABASE_LOGIN_ROLE_OUTCOME_UNKNOWN';
    this.uncertain = true;
    this.intentId = intentId;
    this.requestDigest = requestDigest;
  }
}

async function responseJson(response, url) {
  check(response?.url === url && response.redirected === false, 'SUPABASE_MANAGEMENT_ISSUER_MISMATCH');
  check(response.body?.getReader, 'SUPABASE_MANAGEMENT_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let bytes;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      check(size <= 16384, 'SUPABASE_MANAGEMENT_RESPONSE_INVALID');
      chunks.push(Buffer.from(item.value));
    }
    bytes = Buffer.concat(chunks);
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw fail('SUPABASE_MANAGEMENT_RESPONSE_INVALID'); }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    bytes?.fill(0);
    try { await reader.cancel(); } catch { /* No provider error text is retained. */ }
  }
}

function secretBytes(value) {
  check(typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array, 'SUPABASE_MANAGEMENT_CREDENTIAL_REQUIRED');
  const bytes = Buffer.from(value);
  if (!bytes.length || bytes.length > 8192 || bytes.some(byte => byte < 33 || byte > 126)) {
    bytes.fill(0);
    throw fail('SUPABASE_MANAGEMENT_CREDENTIAL_REQUIRED');
  }
  return bytes;
}

/**
 * intentStore is trusted controller code, never a manifest/provider callback.
 * begin(request) durably reserves a UNIQUE fresh intent and obtains a fresh
 * project-bound native managed-role readback BEFORE permitting issuance.
 * It returns {state:'fresh',intentId,requestDigest,preflight:{projectRef,observedAtMs,role}}.
 * complete(receipt) persists nonsecret acknowledgement; uncertain(receipt) keeps
 * the original operation pending. Neither receives a token or password.
 * Test dependencies are functions/classes supplied only by trusted code.
 */
export async function openPinnedDatabase({ credential, caFile, intentStore, deps = {} } = {}) {
  check(credential?.kind === 'supabase_management' && Object.keys(credential).every(key => ['kind', 'token'].includes(key)), 'SUPABASE_MANAGEMENT_CREDENTIAL_REQUIRED');
  check(typeof caFile === 'string' && caFile.length > 0, 'PINNED_DATABASE_CA_REQUIRED');
  check(['begin', 'complete', 'uncertain'].every(key => typeof intentStore?.[key] === 'function'), 'DURABLE_DATABASE_CREDENTIAL_INTENT_REQUIRED');
  const now = deps.now || Date.now;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const projectRef = targets().supabaseProject;
  const host = fcosConnectionIdentifier('supabase', 'Database session host');
  check(fcosConnectionIdentifier('supabase', 'Database session user') === `postgres.${projectRef}`, 'PINNED_DATABASE_TARGET_MISMATCH');
  let ca;
  try { ca = (deps.readFile || readFileSync)(caFile); } catch { throw fail('PINNED_DATABASE_CA_REQUIRED'); }
  check((Buffer.isBuffer(ca) || typeof ca === 'string') && digest(ca) === CA_SHA256, 'PINNED_DATABASE_CA_MISMATCH');
  const token = secretBytes(credential.token);
  let password;
  let db;
  let connection;
  let transaction = false;
  let nativeFailed = false;
  try {
    const projectUrl = `${ISSUER}/v1/projects/${projectRef}`;
    let response;
    try { response = await fetchImpl(projectUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token.toString('utf8')}`, Accept: 'application/json' } }); }
    catch { throw fail('SUPABASE_PROJECT_IDENTITY_UNAVAILABLE'); }
    check(response.status === 200, 'SUPABASE_PROJECT_IDENTITY_UNAVAILABLE');
    const project = await responseJson(response, projectUrl);
    check(project.id === projectRef && project.name === fcosConnectionIdentifier('supabase', 'Project name')
      && project.status === 'ACTIVE_HEALTHY' && typeof project.organization_id === 'string'
      && /^[a-z0-9]{20}$/.test(project.organization_id), 'SUPABASE_PROJECT_IDENTITY_MISMATCH');
    const url = `${projectUrl}/cli/login-role`;
    const request = Object.freeze({ operation: 'supabase_cli_login_role', issuer: ISSUER, projectRef,
      organizationId: project.organization_id, host, port: 5432, database: 'postgres', role: LOGIN_ROLE,
      method: 'POST', path: `/v1/projects/${projectRef}/cli/login-role`, body: Object.freeze({ read_only: false }) });
    const requestDigest = digest(request);
    let intent;
    try { intent = await intentStore.begin(Object.freeze({ ...request, requestDigest })); }
    catch { throw fail('DURABLE_DATABASE_CREDENTIAL_INTENT_REFUSED'); }
    check(intent?.state === 'fresh' && safeId(intent.intentId) && intent.requestDigest === requestDigest
      && !attemptedIntents.has(intent.intentId), 'DURABLE_DATABASE_CREDENTIAL_INTENT_REFUSED');
    check(intent.preflight?.projectRef === projectRef && finiteTime(intent.preflight.observedAtMs)
      && now() - intent.preflight.observedAtMs >= 0 && now() - intent.preflight.observedAtMs <= 60000
      && managedRole(intent.preflight.role), 'EXISTING_MANAGED_DATABASE_ROLE_REQUIRED');
    attemptedIntents.add(intent.intentId);
    const issuedAt = now();
    let issuance;
    const uncertain = async () => {
      const receipt = Object.freeze({ intentId: intent.intentId, requestDigest, outcome: 'unknown', projectRef, code: 'SUPABASE_LOGIN_ROLE_OUTCOME_UNKNOWN' });
      try { await intentStore.uncertain(receipt); } catch { /* The durable original intent remains pending. */ }
      throw new DatabaseCredentialOutcomeUnknown(intent.intentId, requestDigest);
    };
    try {
      response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
        Authorization: `Bearer ${token.toString('utf8')}`, Accept: 'application/json', 'Content-Type': 'application/json',
      }, body: JSON.stringify(request.body) });
      if (response.status !== 201) return await uncertain();
      issuance = await responseJson(response, url);
      if (!issuance || Object.keys(issuance).sort().join(',') !== 'password,role,ttl_seconds'
        || issuance.role !== LOGIN_ROLE || typeof issuance.password !== 'string' || !issuance.password.length
        || Buffer.byteLength(issuance.password) > 4096 || /[\0\r\n]/.test(issuance.password)
        || !Number.isSafeInteger(issuance.ttl_seconds) || issuance.ttl_seconds < 1 || issuance.ttl_seconds > MAX_TTL_SECONDS) return await uncertain();
      password = Buffer.from(issuance.password, 'utf8');
      delete issuance.password;
      const receipt = Object.freeze({ intentId: intent.intentId, requestDigest, outcome: 'received', issuer: ISSUER,
        projectRef, role: LOGIN_ROLE, ttlSeconds: issuance.ttl_seconds, issuedAtMs: issuedAt,
        expiresAtMs: issuedAt + issuance.ttl_seconds * 1000 });
      check(now() < receipt.expiresAtMs, 'SUPABASE_LOGIN_ROLE_EXPIRED');
      await intentStore.complete(receipt);
    } catch (error) {
      if (error instanceof DatabaseCredentialOutcomeUnknown) throw error;
      return await uncertain();
    }
    token.fill(0);
    const Client = deps.Client || (await import('pg')).Client;
    db = new Client({ host, port: 5432, user: `${LOGIN_ROLE}.${projectRef}`, database: 'postgres',
      password: password.toString('utf8'), ssl: { ca, rejectUnauthorized: true, servername: host },
      connectionTimeoutMillis: 10000, query_timeout: 10000, application_name: 'fcos-pinned-native-release' });
    const invalidate = () => {
      nativeFailed = true;
      const proof = connection && proofByConnection.get(connection);
      if (proof) proof.active = false;
    };
    db.on?.('error', invalidate);
    db.on?.('end', invalidate);
    await db.connect();
    password.fill(0);
    db.password = null;
    if (db.connectionParameters) db.connectionParameters.password = null;
    check(!nativeFailed && nativeTls(db, host), 'PINNED_DATABASE_TLS_REQUIRED');
    await db.query('SET SESSION ROLE postgres');
    await db.query('BEGIN READ ONLY');
    transaction = true;
    const result = await db.query(DELEGATED_DATABASE_IDENTITY_SQL);
    const identity = result.rows?.length === 1 ? result.rows[0] : null;
    check(identity?.session_user === LOGIN_ROLE && identity.current_user === 'postgres'
      && identity.database === 'postgres' && identity.read_only === 'on' && managedRole(identity), 'PINNED_DELEGATED_DATABASE_IDENTITY_MISMATCH');
    check(finiteTime(identity.server_now_ms) && finiteTime(identity.role_valid_until_ms)
      && identity.role_valid_until_ms > identity.server_now_ms
      && identity.role_valid_until_ms - identity.server_now_ms <= issuance.ttl_seconds * 1000 + 30000, 'PINNED_DELEGATED_DATABASE_EXPIRY_MISMATCH');
    const expiresAt = Math.min(issuedAt + issuance.ttl_seconds * 1000,
      now() + identity.role_valid_until_ms - identity.server_now_ms);
    check(now() < expiresAt && !nativeFailed, 'PINNED_DELEGATED_DATABASE_EXPIRY_MISMATCH');
    await db.query('ROLLBACK');
    transaction = false;
    connection = Object.freeze({ host, port: 5432, user: `${LOGIN_ROLE}.${projectRef}`, database: 'postgres',
      ssl: Object.freeze({ ca, rejectUnauthorized: true }), authentication: Object.freeze({
        kind: 'supabase_management_delegated', issuer: ISSUER, projectRef, organizationId: project.organization_id,
        loginRole: LOGIN_ROLE, effectiveRole: 'postgres', expiresAtMs: expiresAt,
        nativeRoleValidUntilMs: identity.role_valid_until_ms, intentId: intent.intentId, requestDigest,
      }) });
    proofByConnection.set(connection, { active: true, db, stream: db.connection.stream, expiresAt, now });
    assertPinnedDatabaseIdentity(identity, connection, { readOnly: true });
    return { db, connection };
  } catch (error) {
    if (transaction) { try { await db.query('ROLLBACK'); } catch { /* No retry. */ } }
    if (db) { try { await db.end(); } catch { /* No raw provider error escapes. */ } }
    if (error instanceof DatabaseCredentialOutcomeUnknown) throw error;
    const code = OWNED_CODES.has(error?.code) ? error.code : 'PINNED_DATABASE_CONNECTION_FAILED';
    throw fail(code);
  } finally {
    token.fill(0);
    password?.fill(0);
    if (db) {
      db.password = null;
      if (db.connectionParameters) db.connectionParameters.password = null;
    }
  }
}
