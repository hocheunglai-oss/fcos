import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { TLSSocket } from 'node:tls';
import { createRequire } from 'node:module';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { openPinnedDatabase, isNativeDelegatedConnection, assertPinnedDatabaseIdentity,
  DatabaseCredentialOutcomeUnknown, DELEGATED_DATABASE_IDENTITY_SQL } from '../scripts/lib/rapid-release/database-connection.mjs';

const CA = "-----BEGIN CERTIFICATE-----\nMIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL\nBQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l\ndyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh\nc2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow\nazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD\nYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug\nUm9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW\nQyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q\nDmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2\nGtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi\ncvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4\nO4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt\nNaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX\nuXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt\naUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU\ntVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b\nVW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6\njB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx\nCea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2\nCMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P\no/bKiIz+Fq8=\n-----END CERTIFICATE-----\n";
const TOKEN = 'DUMMY_ONLY_management_token_not_a_credential';
const PASSWORD = 'DUMMY_ONLY_issued_password_not_a_credential';
const PROJECT = fcosConnectionIdentifier('supabase', 'Project ref');
const HOST = fcosConnectionIdentifier('supabase', 'Database session host');
const BASE = `https://api.supabase.com/v1/projects/${PROJECT}`;
const NOW = Date.now();
let sequence = 0;
const clone = value => structuredClone(value);
const role = () => ({ login_role: 'cli_login_postgres', can_login: true, is_superuser: false,
  inherits: false, creates_roles: false, creates_databases: false, replicates: false, bypasses_rls: false,
  memberships: [{ role: 'postgres', grantor: 'supabase_admin', set: true, inherit: false, admin: false }] });
const identity = () => ({ ...role(), session_user: 'cli_login_postgres', current_user: 'postgres', database: 'postgres',
  read_only: 'on', server_now_ms: NOW, role_valid_until_ms: NOW + 300000 });
function response(url, data, status = 200) {
  const result = new Response(JSON.stringify(data), { status });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

function fixture(options = {}) {
  let clock = NOW;
  const calls = { fetch: [], queries: [], clients: [], begin: [], received: [], complete: [], uncertain: [] };
  const intentId = `fixture_intent_${++sequence}`;
  const store = {
    async begin(request) {
      calls.begin.push(request);
      return { state: 'fresh', intentId, requestDigest: request.requestDigest,
        preflight: { projectRef: PROJECT, observedAtMs: clock, role: role() }, ...options.intent };
    },
    async complete(receipt) { calls.complete.push(receipt); if (options.completeError) throw new Error(PASSWORD); },
    async received(receipt) {calls.received.push(receipt);},
    async uncertain(receipt) { calls.uncertain.push(receipt); },
  };
  class Client extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.password = config.password;
      this.connectionParameters = { password: config.password };
      const stream = new TLSSocket();
      stream.authorized = options.tlsAuthorized !== false;
      stream.servername = options.servername || HOST;
      this.connection = { stream: options.fakeStream || stream };
      if (options.fakeStream) stream.destroy();
      calls.clients.push(this);
    }
    async connect() { if (options.connectError) throw options.connectError;if(options.connectHook)await options.connectHook(); }
    async query(sql) {
      calls.queries.push(sql);
      if (options.queryImpl) return options.queryImpl(sql);
      return { rows: sql === DELEGATED_DATABASE_IDENTITY_SQL ? [options.identity || identity()] : [] };
    }
    async end() { this._ending = true; this.connection.stream.destroy?.(); this.emit('end'); }
  }
  const fetchImpl = async (url, init) => {
    calls.fetch.push({ url, init });
    if (init.method === 'GET') {
      if (options.getError) throw options.getError;
      return response(options.getUrl || url, options.project || { id: PROJECT, name: 'FCOS', organization_id: 'yxyxcenpgqutvoctrdkj', status: 'ACTIVE_HEALTHY' });
    }
    if (options.postError) throw options.postError;
    return response(options.postUrl || url, options.issuance || { role: 'cli_login_postgres', password: PASSWORD, ttl_seconds: 300 }, options.postStatus || 201);
  };
  const args = { credential: { kind: 'supabase_management', token: TOKEN }, caFile: '/dummy/public-project-ca.crt',
    intentStore: store, deps: { now: () => clock, fetchImpl, Client, readFile: () => Buffer.from(CA) } };
  return { args, calls, store, intentId, advance: ms => { clock += ms; } };
}

test('exact provider delegation uses durable intent, pinned TLS and native role readback', async () => {
  const f = fixture();
  const { db, connection } = await openPinnedDatabase(f.args);
  try {
    assert.equal(isNativeDelegatedConnection(connection), true);
    assert.equal(connection.user, `cli_login_postgres.${PROJECT}`);
    assert.equal(connection.authentication.issuer, 'https://api.supabase.com');
    assert.equal(connection.authentication.projectRef, PROJECT);
    assert.equal(connection.authentication.intentId, f.intentId);
    assert.equal(db.config.host, HOST);
    assert.equal(db.config.port, 5432);
    assert.equal(db.config.ssl.servername, HOST);
    assert.equal(db.config.ssl.rejectUnauthorized, true);
    assert.equal(Object.hasOwn(db.config, 'options'), false);
    assert.equal(db.password, null);
    assert.equal(db.connectionParameters.password, null);
    assert.deepEqual(f.calls.fetch.map(call => [call.url, call.init.method]), [[BASE, 'GET'], [`${BASE}/cli/login-role`, 'POST']]);
    assert.deepEqual(JSON.parse(f.calls.fetch[1].init.body), { read_only: false });
    assert.equal(f.calls.fetch.every(call => call.init.redirect === 'error'), true);
    assert.deepEqual(f.calls.queries, ['SET SESSION ROLE postgres', 'BEGIN READ ONLY', DELEGATED_DATABASE_IDENTITY_SQL, 'ROLLBACK']);
    assert.equal(f.calls.complete.length, 1);
    assert.equal(f.calls.uncertain.length, 0);
    const receipts = JSON.stringify([f.calls.begin, f.calls.complete, connection]);
    assert.equal(receipts.includes(TOKEN), false);
    assert.equal(receipts.includes(PASSWORD), false);
    const row = identity();
    assert.equal(assertPinnedDatabaseIdentity(row, connection, { readOnly: true }), row);
    assert.equal(row.session_user, 'cli_login_postgres');
    assert.equal(row.current_user, 'postgres');
  } finally { await db.end(); }
  assert.equal(isNativeDelegatedConnection(connection), false);
});

test('missing durable callbacks, unknown credential or bad CA refuses before provider/SQL', async () => {
  for (const change of [{ intentStore: {} }, { credential: { kind: 'url', token: TOKEN } },
    { credential: { kind: 'supabase_management', token: TOKEN, projectRef: 'other' } },
    { deps: { readFile: () => Buffer.from('DUMMY_ONLY_wrong_CA') } }]) {
    const f = fixture();
    const args = { ...f.args, ...change, deps: { ...f.args.deps, ...change.deps } };
    await assert.rejects(openPinnedDatabase(args));
    assert.equal(f.calls.fetch.length, 0);
    assert.equal(f.calls.queries.length, 0);
  }
});

test('wrong project, name, state or Management issuer refuses before intent/POST/SQL', async () => {
  const project = { id: PROJECT, name: 'FCOS', organization_id: 'yxyxcenpgqutvoctrdkj', status: 'ACTIVE_HEALTHY' };
  for (const change of [{ project: { ...project, id: 'other' } }, { project: { ...project, name: 'other' } },
    { project: { ...project, status: 'INACTIVE' } }, { getUrl: 'https://other.invalid/project' }]) {
    const f = fixture(change);
    await assert.rejects(openPinnedDatabase(f.args), /SUPABASE_(?:PROJECT_IDENTITY|MANAGEMENT_ISSUER)_MISMATCH/);
    assert.equal(f.calls.fetch.length, 1);
    assert.equal(f.calls.begin.length, 0);
    assert.equal(f.calls.clients.length, 0);
    assert.equal(f.calls.queries.length, 0);
  }
});

test('fresh existing platform-managed membership is mandatory before issuance', async () => {
  for (const preflight of [undefined, { projectRef: 'other', observedAtMs: NOW, role: role() },
    { projectRef: PROJECT, observedAtMs: NOW - 60001, role: role() },
    { projectRef: PROJECT, observedAtMs: NOW, role: { ...role(), is_superuser: true } },
    { projectRef: PROJECT, observedAtMs: NOW, role: { ...role(), memberships: [{ ...role().memberships[0], grantor: 'postgres' }] } }]) {
    const f = fixture({ intent: { preflight } });
    await assert.rejects(openPinnedDatabase(f.args), /EXISTING_MANAGED_DATABASE_ROLE_REQUIRED/);
    assert.equal(f.calls.fetch.filter(call => call.init.method === 'POST').length, 0);
    assert.equal(f.calls.queries.length, 0);
  }
});

test('unknown issuance acknowledgement stays pending and does not retry', async () => {
  for (const options of [{ postError: new Error(TOKEN + PASSWORD) }, { postStatus: 500 },
    { issuance: { role: 'cli_login_other', password: PASSWORD, ttl_seconds: 300 } },
    { issuance: { role: 'cli_login_postgres', password: PASSWORD, ttl_seconds: 0 } },
    { issuance: { role: 'cli_login_postgres', password: PASSWORD, ttl_seconds: '300' } },
    { issuance: { role: 'cli_login_postgres', password: PASSWORD, ttl_seconds: 3601 } },
    { postUrl: 'https://other.invalid/cli/login-role' }]) {
    const f = fixture(options);
    await assert.rejects(openPinnedDatabase(f.args), error => error instanceof DatabaseCredentialOutcomeUnknown
      && error.uncertain && error.intentId === f.intentId && !String(error).includes(TOKEN) && !String(error).includes(PASSWORD));
    assert.equal(f.calls.fetch.filter(call => call.init.method === 'POST').length, 1);
    assert.equal(f.calls.uncertain.length, 1);
    assert.equal(f.calls.clients.length, 0);
    assert.equal(f.calls.queries.length, 0);
    await assert.rejects(openPinnedDatabase(f.args), /DURABLE_DATABASE_CREDENTIAL_INTENT_REFUSED/);
    assert.equal(f.calls.fetch.filter(call => call.init.method === 'POST').length, 1);
  }
});

test('issuer acknowledgement retains ownership until the native connection qualifies',async()=>{
 let release,entered;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const f=fixture({connectHook:async()=>{entered();await gate;}}),pending=openPinnedDatabase(f.args);
 await waiting;assert.equal(f.calls.received.length,1);assert.equal(f.calls.complete.length,0);
 release();const opened=await pending;assert.equal(f.calls.complete.length,1);await opened.db.end();
 const failed=fixture({completeError:true});
 await assert.rejects(openPinnedDatabase(failed.args),DatabaseCredentialOutcomeUnknown);
 assert.equal(failed.calls.fetch.filter(call=>call.init.method==='POST').length,1);
 assert.equal(failed.calls.uncertain.length,1);assert.equal(failed.calls.clients[0]._ending,true);
});

test('TLS authorization requires the actual native TLS socket before any SQL', async () => {
  for (const change of [{ tlsAuthorized: false }, { servername: 'other.invalid' },
    { fakeStream: { authorized: true, encrypted: true, servername: HOST, destroyed: false } }]) {
    const f = fixture(change);
    await assert.rejects(openPinnedDatabase(f.args), /PINNED_DATABASE_TLS_REQUIRED/);
    assert.equal(f.calls.queries.length, 0);
    assert.equal(f.calls.clients[0]._ending, true);
  }
});

test('native login/effective role/membership/expiry cannot be rewritten or widened', async () => {
  for (const patch of [{ session_user: 'postgres' }, { session_user: 'cli_login_other' }, { current_user: 'supabase_admin' },
    { database: 'other' }, { read_only: 'off' }, { inherits: true }, { creates_roles: true },
    { memberships: [{ ...role().memberships[0], set: false }] }, { memberships: [{ ...role().memberships[0], inherit: true }] },
    { role_valid_until_ms: NOW - 1 }, { role_valid_until_ms: NOW + 400000 }, { role_valid_until_ms: Infinity }]) {
    const f = fixture({ identity: { ...identity(), ...patch } });
    await assert.rejects(openPinnedDatabase(f.args), /PINNED_DELEGATED_DATABASE_(?:IDENTITY|EXPIRY)_MISMATCH/);
    assert.equal(f.calls.queries.at(-1), 'ROLLBACK');
    assert.equal(f.calls.clients[0]._ending, true);
  }
});

test('JSON flags, copied objects and arbitrary CLI-login URLs have no native proof', async () => {
  const f = fixture();
  const { db, connection } = await openPinnedDatabase(f.args);
  try {
    for (const fake of [clone(connection), { ...connection }, { nativeDelegated: true },
      { url: `postgres://cli_login_postgres.${PROJECT}@${HOST}:5432/postgres` }]) {
      assert.equal(isNativeDelegatedConnection(fake), false);
      assert.throws(() => assertPinnedDatabaseIdentity(identity(), fake), /PINNED_DELEGATED_DATABASE_CONNECTION_REQUIRED/);
    }
    assert.throws(() => assertPinnedDatabaseIdentity({ ...identity(), session_user: 'postgres' }, connection), /IDENTITY_MISMATCH/);
    assert.throws(() => assertPinnedDatabaseIdentity(identity(), connection, { readOnly: false }), /IDENTITY_MISMATCH/);
    f.advance(300000);
    assert.equal(isNativeDelegatedConnection(connection), false);
  } finally { await db.end(); }
});

test('native connection failure invalidates proof and raw provider code/message never escapes', async () => {
  const f = fixture();
  const { db, connection } = await openPinnedDatabase(f.args);
  db.emit('error', new Error(PASSWORD));
  assert.equal(isNativeDelegatedConnection(connection), false);
  await db.end();
  const failed = fixture({ connectError: Object.assign(new Error(PASSWORD), { code: 'PINNED_DUMMY_SECRET_NOT_OWNED' }) });
  await assert.rejects(openPinnedDatabase(failed.args), error => error.code === 'PINNED_DATABASE_CONNECTION_FAILED'
    && !String(error).includes(TOKEN) && !String(error).includes(PASSWORD) && !error.cause);
});

test('real PostgreSQL catalog/session role semantics qualify without identity substitution', async () => {
  const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
  const native = new PGlite();
  try {
    await native.exec(`create role supabase_admin superuser;
      create role cli_login_postgres login nosuperuser noinherit nocreaterole nocreatedb noreplication nobypassrls valid until '${new Date(NOW + 300000).toISOString()}';
      grant postgres to supabase_admin with admin true;
      grant postgres to cli_login_postgres with inherit false, set true, admin false granted by supabase_admin;
      set session authorization cli_login_postgres;`);
    const f = fixture({ queryImpl: sql => native.query(sql) });
    const { db, connection } = await openPinnedDatabase(f.args);
    try {
      assert.equal(isNativeDelegatedConnection(connection), true);
      await native.query('BEGIN READ ONLY');
      const row = (await native.query(DELEGATED_DATABASE_IDENTITY_SQL)).rows[0];
      assert.equal(assertPinnedDatabaseIdentity(row, connection, { readOnly: true }), row);
      assert.equal(row.session_user, 'cli_login_postgres');
      assert.equal(row.current_user, 'postgres');
      assert.equal(row.memberships[0].grantor, 'supabase_admin');
      await native.query('ROLLBACK');
    } finally { await db.end(); }
  } finally { await native.close(); }
});
