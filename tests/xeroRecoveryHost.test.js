import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createServer as httpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { validateOwnerReadbackResult } from '../scripts/lib/hosted-release/xero-recovery-native-relay.mjs';
import { createXeroRecoveryHost, xeroOwnerReadbackAudience } from '../scripts/lib/hosted-release/xero-recovery-host.mjs';
import { recoveryStepCanonicalJson as canonical, recoveryStepSha256 as hash, prepareXeroRecoveryStepRequest } from '../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { readXeroSharedControlFixture } from './helpers/xero-recovery-fixture.mjs';

// External Auth/JWKS/provider HTTP is synthetic; signatures and PGlite CAS
// acknowledgements are real. Fixtures do not qualify hosted credentials, current
// GitHub job status, live ingress or any proposed preservation authority.
const pin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const ORIGIN = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const PUBLIC = 'https://recovery.example.invalid';
const actorId = '20000000-0000-4000-8000-000000000002', tenantId = '10000000-0000-4000-8000-000000000001';
const owner = '30000000-0000-4000-8000-000000000003', features = '80000000-0000-4000-8000-000000000008';
const email = 'owner@example.invalid', subject = 'FIXTURE_PRIVATE_FCUNO_SUBJECT', secret = 'FIXTURE_PRIVATE_SERVICE_ROLE';
const nonce = 'fixture_native_owner_nonce_12345678';
const keys = await generateKeyPair('RS256'), fcunoKeys = await generateKeyPair('ES256'), sbKeys = await generateKeyPair('ES256');
const githubKeys = { keys: [{ ...await exportJWK(keys.publicKey), kid: 'carrier', alg: 'RS256' }] };
const fcunoJwks = { keys: [{ ...await exportJWK(fcunoKeys.publicKey), kid: 'fcuno', alg: 'ES256' }] };
const tlsDirectory = mkdtempSync(join(tmpdir(), 'xero-host-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tlsDirectory, 'key.pem'),
  '-out', join(tlsDirectory, 'cert.pem'), '-days', '1', '-subj', '/CN=recovery.example.invalid'], { stdio: 'ignore' });
const tls = { key: readFileSync(join(tlsDirectory, 'key.pem')), cert: readFileSync(join(tlsDirectory, 'cert.pem')) };
rmSync(tlsDirectory, { recursive: true, force: true });
const json = value => Response.json(value);
const safe = value => assert.doesNotMatch(JSON.stringify(value), /FIXTURE_PRIVATE_|access_token|refresh_token|authorization|providerAccessToken|bearer|client_secret/);

async function fixture(t, change = {}) {
  const at = Date.now(), seconds = Math.floor(at / 1000);
  const binding = { operationId: 'a'.repeat(64), ownerThreadId: owner, tenantId, actorId, expectedVersion: 7,
    refreshLeaseId: '40000000-0000-4000-8000-000000000004', probeId: '50000000-0000-4000-8000-000000000005',
    requestId: '60000000-0000-4000-8000-000000000006', approvalSha256: 'b'.repeat(64), sourceSha256: 'c'.repeat(64), bindingSha256: 'd'.repeat(64),
    organisationIdentitySha256: null, issuedAt: at - 1000, notAfter: at + 600000, credentialPreservationCompositeApproved: true, ...change.planBinding };
  const planJson = canonical({ schemaVersion: change.planVersion || 1, kind: `fcos_xero_recovery_step_plan_v${change.planVersion || 1}`, binding });
  const caller = { ref: 'refs/heads/features', sha: 'e'.repeat(40), workflowSha: 'e'.repeat(40),
    workflowRef: 'hocheunglai-oss/fcos/.github/workflows/xero-carrier.yml@refs/heads/features',
    jobWorkflowRef: `hocheunglai-oss/fcos/.github/workflows/xero-private.yml@${'f'.repeat(40)}`, jobWorkflowSha: 'f'.repeat(40),
    runId: '123456789', environment: 'fcos-hosted-verification', subject: 'repo:hocheunglai-oss/fcos:environment:fcos-hosted-verification',
    audience: `${PUBLIC}/xero-recovery` };
  const ghClaims = { repository: 'hocheunglai-oss/fcos', repository_id: '1278654816', repository_owner: 'hocheunglai-oss',
    actor: 'hocheunglai-oss', actor_id: '265701760', ref: caller.ref, ref_type: 'branch', ref_protected: 'true', sha: caller.sha,
    workflow_sha: caller.workflowSha, workflow_ref: caller.workflowRef, job_workflow_ref: caller.jobWorkflowRef, job_workflow_sha: caller.jobWorkflowSha,
    run_id: caller.runId, run_attempt: '1', event_name: 'workflow_dispatch', runner_environment: 'github-hosted', environment: caller.environment,
    sub: caller.subject, aud: caller.audience, iss: 'https://token.actions.githubusercontent.com', iat: seconds, exp: seconds + 300, jti: 'carrier-jti', ...change.gh };
  const oidc = await new SignJWT(ghClaims).setProtectedHeader({ alg: 'RS256', kid: 'carrier' }).sign(change.ghKey || keys.privateKey);
  const sbClaims = { sub: actorId, iss: `${ORIGIN}/auth/v1`, aud: 'authenticated', role: 'authenticated',
    session_id: '90000000-0000-4000-8000-000000000009', iat: seconds, exp: seconds + 3600, amr: [{ method: 'oauth', timestamp: seconds }], ...change.sb };
  const bearer = await new SignJWT(sbClaims).setProtectedHeader({ alg: 'ES256' }).sign(sbKeys.privateKey);
  const providerAccessToken = await new SignJWT({ sub: subject, iss: pin.issuer, aud: pin.oidcClientId, typ: 'at+jwt', use_fcos: true,
    email_verified: true, identity_revision: 7, credential_revision: 3, jti: 'provider-jti', iat: seconds, exp: seconds + 300, ...change.provider })
    .setProtectedHeader({ alg: 'ES256', kid: 'fcuno' }).sign(fcunoKeys.privateKey);
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.user_profiles(id uuid primary key,active boolean,user_type text);
    grant select on public.user_profiles to service_role;
    create table public.xero_contact_sync_connections(id text primary key,tenant_id text,tenant_name text,token_version integer,
      access_token text,refresh_token text,expires_at timestamptz,scope text,updated_at timestamptz);
    alter table public.xero_contact_sync_connections enable row level security;
    alter table public.xero_contact_sync_connections force row level security;
    revoke all on public.xero_contact_sync_connections from public,anon,authenticated,service_role;
    grant select,insert,update on public.xero_contact_sync_connections to service_role;`);
  await db.exec(await readXeroSharedControlFixture());
  for (const name of ['20261018100701_xero_recovery_private_returned_token_custody.sql', '20261018103446_xero_recovery_durable_step_protocol.sql', '20261019190000_xero_recovery_v2_window.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.query("insert into public.user_profiles values($1,true,'administrator')", [actorId]);
  await db.query("insert into public.xero_contact_sync_connections values('primary',$1,'Fixture Organisation',7,'FIXTURE_PRIVATE_XERO_ACCESS','FIXTURE_PRIVATE_XERO_REFRESH',$2,'offline_access accounting.settings',null)", [tenantId, new Date(at + 3600000).toISOString()]);
  const calls = [], signals = [], diagnostics = []; let lose = change.lose, holdResolve;
  const held = new Promise(resolve => { holdResolve = resolve; });
  const sql = async (query, args, readonly = false) => {
    if (readonly) await db.exec('begin transaction read only');
    await db.exec('set role service_role');
    try { const result = await db.query(query, args); await db.exec('reset role'); if (readonly) await db.exec('commit'); return result; }
    catch (error) { if (readonly) await db.exec('rollback'); else await db.exec('reset role'); throw error; }
  };
  const fetchImpl = async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false); assert.equal(init.redirect, 'error');
    const u = new URL(url); calls.push({ path: u.pathname, method: init.method }); signals.push(init.signal);
    if (u.origin === 'https://token.actions.githubusercontent.com') {
      if (change.failKeys) throw Object.assign(Error('FIXTURE_PRIVATE_KEY_FAILURE'), {
        code: 'FIXTURE_PRIVATE_CALLER_CODE', reason: 'FIXTURE_PRIVATE_CALLER_REASON', phase: 'FIXTURE_PRIVATE_CALLER_PHASE' });
      if (change.holdKeys) { holdResolve(); return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('FIXTURE_PRIVATE_KEY_ABORT')), { once: true })); }
      assert.equal(String(url), 'https://token.actions.githubusercontent.com/.well-known/jwks'); assert.deepEqual(init.headers, { accept: 'application/json' }); return json(githubKeys); }
    if (String(url) === pin.syncJwksEndpoint) { assert.equal(init.headers.authorization, undefined); return json(fcunoJwks); }
    assert.equal(u.origin, ORIGIN); assert.equal(init.headers.apikey, secret);
    if (u.pathname === '/auth/v1/user') {
      if (change.holdAuth) { holdResolve(); return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('FIXTURE_PRIVATE_AUTH_ABORT')), { once: true })); }
      assert.equal(init.headers.authorization, `Bearer ${bearer}`);
      try { await jwtVerify(bearer, sbKeys.publicKey, { issuer: `${ORIGIN}/auth/v1`, audience: 'authenticated' }); } catch { return new Response(null, { status: 401 }); }
      return json({ id: actorId, email, identities: [{ provider: pin.oidcProvider, provider_id: subject, identity_data: { sub: subject } }], is_anonymous: false });
    }
    if (u.pathname === '/rest/v1/user_profiles') { assert.equal(init.headers.authorization, `Bearer ${bearer}`); assert.equal(u.searchParams.get('id'), `eq.${actorId}`);
      return json([{ id: actorId, email, active: true, user_type: 'administrator', access_revision: 5 }]); }
    assert.equal(init.headers.authorization, `Bearer ${secret}`);
    if (u.pathname === '/rest/v1/fcos_external_identity_links') { assert.equal(u.searchParams.get('auth_user_id'), `eq.${actorId}`); return json([{ id: '70000000-0000-4000-8000-000000000007',
      provider: 'fcuno', issuer: pin.issuer, subject, auth_user_id: actorId, source_active: true, use_fcos: true, revision: 7, credential_revision: 3,
      revoked_before: null, email, email_verified: true }]); }
    if (u.pathname === '/rest/v1/rpc/fcos_effective_access') { assert.equal(u.searchParams.get('p_user_id'), actorId);
      return json({ user_id: actorId, access_revision: 5, privileged_access: true, permissions: { xero_portal: true }, capabilities: { xero_portal_manage: true } }); }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const name = u.pathname.slice('/rest/v1/rpc/'.length);
      assert.ok(['xero_recovery_step_claim', 'xero_recovery_step_complete', 'xero_recovery_step_readback', 'xero_shared_status', 'xero_recovery_custody_prepare'].includes(name));
      const args = init.method === 'GET' ? Object.fromEntries(u.searchParams) : JSON.parse(init.body);
      const names = Object.keys(args); names.forEach(name => assert.match(name, /^p_[a-z0-9_]+$/));
      const values = Object.values(args).map(value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
      let result;
      try { result = (await sql(`select public.${name}(${names.map((name, index) => `${name}=>$${index + 1}`).join(',')}) as result`, values, init.method === 'GET')).rows[0].result; }
      catch (error) { diagnostics.push({ name, code: error.code, detail: String(error.message).replace(/FIXTURE_PRIVATE_[A-Z_]+/g, 'fixture') }); return new Response(JSON.stringify({ error: 'fixture SQL rejection' }), { status: 409, headers: { 'content-type': 'application/json' } }); }
      if (change.hold === name) { holdResolve(); return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('FIXTURE_PRIVATE_CANCELLED')), { once: true })); }
      if (lose === name) { lose = null; throw Error('FIXTURE_PRIVATE_UNCERTAIN_ACK'); }
      return json(result);
    }
    const table = u.pathname.slice('/rest/v1/'.length), select = u.searchParams.get('select');
    assert.ok(['xero_contact_sync_connections', 'xero_token_refresh_leases', 'xero_shared_probe_grants', 'xero_shared_requests', 'xero_recovery_token_custody'].includes(table));
    const columns = select.split(','); columns.forEach(column => assert.match(column, /^[a-z0-9_]+$/));
    const where = [], values = [];
    for (const [key, expression] of u.searchParams) {
      if (['select', 'limit'].includes(key)) continue;
      assert.match(key, /^[a-z0-9_]+$/);
      if (expression === 'is.null') where.push(`${key} is null`);
      else { const split = expression.indexOf('.'), op = expression.slice(0, split); assert.ok(['eq', 'gt', 'like'].includes(op));
        values.push(op === 'like' ? expression.slice(split + 1).replaceAll('*', '%') : expression.slice(split + 1));
        where.push(`${key} ${op === 'eq' ? '=' : op === 'gt' ? '>' : 'like'} $${values.length}`); }
    }
    return json((await sql(`select ${select} from public.${table} where ${where.join(' and ')} limit 2`, values)).rows);
  };
  const options = { planJson, actorBinding: { actorId, emailSha256: hash(email), accessRevision: 5 },
    ownership: { featuresOwnerThreadId: features, historicalOwnerThreadIds: [owner], approvalSha256: binding.approvalSha256, sourceSha256: binding.sourceSha256, controllerSha: caller.jobWorkflowSha },
    caller, publicOrigin: PUBLIC, requestNonceSha256: hash(nonce),
    privateEnvironment: { VITE_SUPABASE_URL: ORIGIN, SUPABASE_SERVICE_ROLE_KEY: secret, XERO_CLIENT_ID: 'fixture-client', XERO_CLIENT_SECRET: 'FIXTURE_PRIVATE_CLIENT_SECRET' }, fetchImpl, ...(change.now === undefined ? {} : { now: change.now }) };
  const handler = createXeroRecoveryHost(options);
  const server = createServer({ ...tls, maxHeaderSize: 65536 }, handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const headers = { host: new URL(PUBLIC).host, authorization: `Bearer ${oidc}`, 'x-fcos-owner-bearer': bearer,
    'x-fcos-provider-access-token': providerAccessToken, 'x-fcos-recovery-nonce': nonce };
  const send = ({ method = 'POST', raw = prepareXeroRecoveryStepRequest({ planJson, step: 'preflight', submissionId: randomUUID(), previousResultSha256: null }).requestJson,
    path = '/xero-recovery', extra = {}, omit = [] } = {}) => new Promise((resolve, reject) => {
    const h = { ...headers, ...(method === 'POST' ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}), ...extra };
    omit.forEach(key => delete h[key]);
    const request = httpsRequest({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: h, rejectUnauthorized: false }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { const body = JSON.parse(Buffer.concat(chunks)); safe(body); resolve({ status: response.statusCode, headers: response.headers, body }); });
    });
    request.on('error', reject); request.end(method === 'POST' ? raw : undefined);
  });
  return { db, options, handler, server, send, headers, calls, signals, held, planJson, binding, diagnostics,
    request: (step = 'preflight', previousResultSha256 = null) => prepareXeroRecoveryStepRequest({ planJson, step, submissionId: randomUUID(), previousResultSha256 }).requestJson };
}

test('physical TLS entrypoint uses real actor/SQL/native modules; normal request end never aborts following calls', async t => {
  const f = await fixture(t), first = await f.send({extra:{'x-vercel-protection-bypass':'FIXTURE_PRIVATE_BYPASS'}});
  assert.equal(first.status, 200, canonical({ calls: f.calls, diagnostics: f.diagnostics })); assert.equal(first.headers['cache-control'], 'no-store');
  assert.equal(first.body.step, 'preflight'); assert.equal(first.body.nextStep, 'custodyPrepare');
  assert.equal(first.body.qualificationAccepted, false); assert.equal(first.body.executionAuthorityGranted, false);
  const next = await f.send({ raw: f.request('custodyPrepare', first.body.resultSha256) });
  assert.equal(next.status, 200); assert.equal(next.body.nextStep, 'sessionVerify');
  assert.equal((await f.db.query('select state from public.xero_recovery_token_custody')).rows[0].state, 'prepared');
  const before = f.calls.length, readback = await f.send({ method: 'GET' });
  assert.equal(readback.status, 200); assert.equal(readback.body.state, 'ready');
  assert.equal(f.calls.slice(before).filter(call => call.path.endsWith('xero_recovery_step_readback')).length, 1);
  assert.equal(f.calls.slice(before).filter(call => call.method === 'POST').length, 0);
  assert.equal((await f.db.query('select count(*)::int n from public.xero_recovery_step_acknowledgements')).rows[0].n, 2);
});

test('missing authentication, wrong nonce/URL/body and duplicate headers cause zero external actions', async t => {
  const logs = []; t.mock.method(console, 'error', value => logs.push(JSON.parse(value)));
  const f = await fixture(t);
  for (const input of [{ omit: ['authorization'] }, { omit: ['x-fcos-owner-bearer'] }, { omit: ['x-fcos-provider-access-token'] },
    { extra: { 'x-fcos-recovery-nonce': 'wrong_nonce_12345678' } }, { path: '/xero-recovery?plan=other' },
    { extra: { 'content-type': 'text/plain' } }, { extra: { 'x-fcos-owner-bearer': [f.headers['x-fcos-owner-bearer'], f.headers['x-fcos-owner-bearer']] } },
    { raw: f.request().replace('"planSha256":"', '"planSha256":"f') }, { raw: f.request() + ' ' }]) {
    assert.equal((await f.send(input)).status, 403);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.send({ method: 'GET', extra: { 'content-type': 'application/json' } })).status, 403);
  assert.deepEqual(logs.map(({ phase, reason }) => [phase, reason]), [
    ...Array.from({ length: 3 }, () => ['request_credentials', 'credential_shape_refused']),
    ['request_credentials', 'nonce_mismatch'], ['request_transport', 'path_mismatch'],
    ['request_body', 'body_headers_refused'], ['request_headers', 'duplicate_header'],
    ['request_binding', 'request_binding_refused'], ['request_binding', 'request_binding_refused'],
    ['request_body', 'body_headers_refused'],
  ]);
  for (const log of logs) {
    assert.deepEqual(Object.keys(log).sort(), ['httpStatus', 'kind', 'ownerReadbackRequired', 'phase', 'reason', 'retryable']);
    assert.equal(log.kind, 'fcos_xero_recovery_host_failure_v1'); assert.equal(log.httpStatus, 403);
    assert.equal(log.ownerReadbackRequired, false); assert.equal(log.retryable, false); safe(log);
    for (const value of [...Object.values(f.headers), f.options.caller.ref, f.options.caller.subject, PUBLIC]) assert.equal(JSON.stringify(log).includes(value), false);
  }
  for (const table of ['xero_recovery_step_operations', 'xero_recovery_step_attempts', 'xero_shared_probe_grants'])
    assert.equal((await f.db.query(`select count(*)::int n from public.${table}`)).rows[0].n, 0);
  assert.equal((await f.db.query('select token_version from public.xero_contact_sync_connections')).rows[0].token_version, 7);
});

test('runtime diagnostics never copy external exception text, code or caller-selected diagnostic fields', async t => {
  const logs = []; t.mock.method(console, 'error', value => logs.push(JSON.parse(value)));
  const f = await fixture(t, { failKeys: true });
  assert.equal((await f.send()).status, 403);
  assert.deepEqual(logs, [{ kind: 'fcos_xero_recovery_host_failure_v1', phase: 'github_jwks',
    reason: 'phase_failed', httpStatus: 403, ownerReadbackRequired: false, retryable: false }]);
  safe(logs); assert.deepEqual(f.calls.map(call => call.path), ['/.well-known/jwks']);
  assert.equal((await f.db.query('select count(*)::int n from public.xero_recovery_step_attempts')).rows[0].n, 0);
});

test('signed wrong GitHub run/workflow/actor/branch/environment claims cannot reach owner or CAS', async t => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock });
  const original = JSON.parse(Buffer.from(f.headers.authorization.split('.')[1], 'base64url'));
  clock = original.iat * 1000;
  // All claims are evaluated at one explicit host time. Wall-clock time spent
  // on earlier TLS requests must not turn iat+31 into the allowed+30 boundary.
  for (const patch of [{ run_id: '999' }, { actor_id: '1' }, { repository_id: '7' }, { repository: 'other/fcos' }, { ref_protected: 'false' },
    { ref: 'refs/heads/main' }, { sha: '0'.repeat(40) }, { job_workflow_sha: '0'.repeat(40) }, { workflow_ref: 'wrong' },
    { run_attempt: '2' }, { runner_environment: 'self-hosted' }, { event_name: 'push' }, { environment: 'fcos-production-release' }, { aud: 'fcos-production-release' },
    { sub: 'repo:hocheunglai-oss/fcos:environment:fcos-production-release' }, { iss: 'https://wrong.invalid' },
    { exp: original.iat - 1 }, { exp: original.iat + 301 }, { iat: original.iat + 31 }, { jti: '' }]) {
    const token = await new SignJWT({ ...original, ...patch }).setProtectedHeader({ alg: 'RS256', kid: 'carrier' }).sign(keys.privateKey);
    assert.equal((await f.send({ extra: { authorization: `Bearer ${token}` } })).status, 403, `Signed GitHub claim patch: ${Object.keys(patch).join(',')}`);
  }
  const pieces = f.headers.authorization.slice(7).split('.');
  const payload = JSON.parse(Buffer.from(pieces[1], 'base64url'));
  pieces[1] = Buffer.from(JSON.stringify({ ...payload, forged: true })).toString('base64url');
  assert.equal((await f.send({ extra: { authorization: `Bearer ${pieces.join('.')}` } })).status, 403);
  assert.ok(f.calls.every(call => call.path === '/.well-known/jwks'));
});

test('same signed GitHub token crosses only the existing31-to30-second future-iat boundary', async t => {
  const logs = []; t.mock.method(console, 'error', value => logs.push(JSON.parse(value)));
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock });
  const original = JSON.parse(Buffer.from(f.headers.authorization.split('.')[1], 'base64url'));
  clock = original.iat * 1000;
  const claims = { ...original, iat: original.iat + 31 };
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'carrier' }).sign(keys.privateKey);
  assert.equal(claims.jti, original.jti);
  assert.equal((await f.send({ extra: { authorization: `Bearer ${token}` } })).status, 403);
  assert.equal(logs.at(-1).phase, 'github_claims'); assert.equal(logs.at(-1).reason, 'issued_at_refused');
  assert.ok(f.calls.every(call => call.path === '/.well-known/jwks'));
  clock += 1000;
  const accepted = await f.send({ extra: { authorization: `Bearer ${token}` } });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.step, 'preflight');
  assert.equal(accepted.body.nextStep, 'custodyPrepare');
  assert.equal(accepted.body.executionAuthorityGranted, false);
  const before = f.calls.length;
  const wrongRun = await new SignJWT({ ...claims, run_id: '999' }).setProtectedHeader({ alg: 'RS256', kid: 'carrier' }).sign(keys.privateKey);
  assert.equal((await f.send({ extra: { authorization: `Bearer ${wrongRun}` } })).status, 403);
  assert.equal(logs.at(-1).reason, 'run_or_audience_mismatch'); safe(logs);
  assert.ok(f.calls.slice(before).every(call => call.path === '/.well-known/jwks'));
});

test('actual own actor mismatch is denied before durable action claim', async t => {
  const f = await fixture(t, { sb: { sub: features } });
  assert.equal((await f.send()).status, 503);
  assert.equal(f.calls.some(call => call.path.endsWith('xero_recovery_step_claim')), false);
});

test('lost native complete acknowledgement preserves SQL outcome and only fresh GET readback can proceed', async t => {
  const f = await fixture(t, { lose: 'xero_recovery_step_complete' });
  assert.equal((await f.send()).status, 503);
  const before = f.calls.length;
  assert.equal((await f.send()).status, 403); assert.equal(f.calls.length, before);
  const saved = await f.send({ method: 'GET' }); assert.equal(saved.status, 200); assert.equal(saved.body.state, 'ready');
  assert.equal(saved.body.nextStep, 'custodyPrepare'); assert.equal(saved.body.executionAuthorityGranted, false);
  assert.equal((await f.db.query('select count(*)::int n from public.xero_recovery_step_acknowledgements')).rows[0].n, 1);
});

test('physical socket cancellation after claim blocks all ordinary following calls and preserves submitted_unknown', async t => {
  const f = await fixture(t, { hold: 'xero_recovery_step_claim' });
  const raw = f.request();
  const request = httpsRequest({ hostname: '127.0.0.1', port: f.server.address().port, path: '/xero-recovery', method: 'POST', rejectUnauthorized: false,
    headers: { ...f.headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } });
  request.on('error', () => {}); request.end(raw); await f.held;
  const before = f.calls.length; request.destroy();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.calls.length, before); assert.equal(f.signals.at(-1).aborted, true);
  const saved = await f.send({ method: 'GET' }); assert.equal(saved.status, 200); assert.equal(saved.body.state, 'submitted_unknown');
  assert.equal(saved.body.nextStep, null);
});

test('constructor rejects changed compiled authority/source and raw HTTP cannot claim verified HTTPS', async t => {
  const f = await fixture(t);
  for (const change of [options => { options.ownership.sourceSha256 = '0'.repeat(64); }, options => { options.ownership.approvalSha256 = '0'.repeat(64); },
    options => { options.actorBinding.actorId = features; }, options => { options.ownership.historicalOwnerThreadIds = [features]; },
    options => { options.caller.jobWorkflowSha = '0'.repeat(40); }, options => { options.caller.environment = 'fcos-production-release'; }]) {
    const options = { ...f.options, actorBinding: { ...f.options.actorBinding }, ownership: { ...f.options.ownership }, caller: { ...f.options.caller } };
    change(options); assert.throws(() => createXeroRecoveryHost(options), { code: 'XERO_RECOVERY_HOST_CONSTRUCTION_REFUSED' });
  }
  const server = httpServer(f.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: '/xero-recovery', method: 'GET',
      headers: { ...f.headers, 'x-forwarded-proto': 'https' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(result, 403); assert.equal(f.calls.length, 0);
});


test('physical incomplete request body has a finite deadline and cannot trigger any authentication action', async t => {
  const f = await fixture(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  let request;
  try {
    f.server.once('request', () => t.mock.timers.tick(10001));
    const status = await new Promise((resolve, reject) => {
      request = httpsRequest({ hostname: '127.0.0.1', port: f.server.address().port, path: '/xero-recovery', method: 'POST', rejectUnauthorized: false,
        headers: { ...f.headers, 'content-type': 'application/json', 'content-length': '100' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.write('{');
    });
    assert.equal(status, 403); assert.equal(f.calls.length, 0);
  } finally { t.mock.timers.reset(); request?.destroy(); }
});

test('canonical JWKS read has a finite deadline and cannot continue to actor admission after expiry', async t => {
  const logs = []; t.mock.method(console, 'error', value => logs.push(JSON.parse(value)));
  const f = await fixture(t, { holdKeys: true }); t.mock.timers.enable({ apis: ['setTimeout'] });
  // Exercise a dependency-owned timeout signal, not only waitFor's fallback
  // timer. Its TimeoutError name is classified; no exception text is logged.
  t.mock.method(AbortSignal, 'timeout', ms => { const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('FIXTURE_PRIVATE_TIMEOUT', 'TimeoutError')), ms); return c.signal; });
  try {
    const pending = f.send(); await f.held; t.mock.timers.tick(15001);
    const result = await pending; assert.equal(result.status, 403);
    assert.deepEqual(f.calls.map(call => call.path), ['/.well-known/jwks']);
    assert.equal(f.signals[0].aborted, true);
    assert.equal(logs.at(-1).phase, 'github_jwks'); assert.equal(logs.at(-1).reason, 'dependency_timeout'); safe(logs);
  } finally { t.mock.timers.reset(); }
});


test('carrier expiration during owner verification aborts ordinary calls before any CAS claim', async t => {
  const f = await fixture(t, { holdAuth: true, gh: { exp: Math.floor(Date.now() / 1000) + 10 } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = f.send(); await f.held; t.mock.timers.tick(10001);
    assert.equal((await pending).status, 503);
    assert.equal(f.calls.some(call => call.path.endsWith('xero_recovery_step_claim')), false);
    assert.equal(f.signals.at(-1).aborted, true);
  } finally { t.mock.timers.reset(); }
});

test('verified Supabase session expiry during held SQL claim cancels ordinary continuation and preserves durable unknown', async t => {
  const f = await fixture(t, { hold: 'xero_recovery_step_claim', sb: { exp: Math.floor(Date.now() / 1000) + 10 } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = f.send(); await f.held;
    assert.equal(f.calls.filter(call => call.path === '/auth/v1/user').length, 2);
    const before = f.calls.length;
    t.mock.timers.tick(10001);
    assert.equal(f.signals.at(-1).aborted, true);
    const result = await pending;
    assert.equal(result.status, 503); assert.equal(result.body.ownerReadbackRequired, true); assert.equal(result.body.retryable, false);
    assert.equal(f.calls.length, before);
    assert.equal(f.calls.some(call => call.path.endsWith('xero_shared_status') || call.path.endsWith('xero_recovery_step_complete')), false);
    const saved = (await f.db.query('select public.xero_recovery_step_readback($1,$2) as result', [f.binding.operationId, hash(f.planJson)])).rows[0].result;
    assert.equal(saved.state, 'submitted_unknown'); assert.equal(saved.nextStep, null);
    assert.equal((await f.db.query('select count(*)::int n from public.xero_recovery_step_acknowledgements')).rows[0].n, 0);
    assert.equal((await f.send()).status, 403); assert.equal(f.calls.length, before);
  } finally { t.mock.timers.reset(); }
});

for(const lost of ['xero_recovery_step_complete','xero_recovery_step_claim'])test(`separate signed owner reader after lost ${lost} can GET original SQL state and never POST`,async t=>{
  const f=await fixture(t,{lose:lost});assert.equal((await f.send()).status,503);
  const original=JSON.parse(Buffer.from(f.headers.authorization.split('.')[1],'base64url')),planSha256=hash(f.planJson),aud=xeroOwnerReadbackAudience(PUBLIC,f.options.caller.runId,planSha256);
  const sign=patch=>new SignJWT({...original,run_id:'987654321',aud,...patch}).setProtectedHeader({alg:'RS256',kid:'carrier'}).sign(keys.privateKey);
  const reader=await sign({});let before=f.calls.length;
  assert.equal((await f.send({extra:{authorization:`Bearer ${reader}`}})).status,403);assert.equal(f.calls.slice(before).some(c=>c.method==='POST'),false);
  for(const patch of [{aud:f.options.caller.audience},{aud:aud.replace(planSha256,'0'.repeat(64))},{run_id:f.options.caller.runId},{actor_id:'1'},{sha:'0'.repeat(40)},{job_workflow_sha:'0'.repeat(40)},{run_attempt:'2'}]){
    before=f.calls.length;assert.equal((await f.send({method:'GET',extra:{authorization:`Bearer ${await sign(patch)}`}})).status,403);assert.equal(f.calls.slice(before).some(c=>c.path.endsWith('xero_recovery_step_readback')),false);
  }
  before=f.calls.length;const result=await f.send({method:'GET',extra:{authorization:`Bearer ${reader}`}});assert.equal(result.status,200);assert.equal(result.body.state,lost.endsWith('_claim')?'submitted_unknown':'ready');
  assert.equal(validateOwnerReadbackResult(result.body,{plan:JSON.parse(f.planJson),planSha256}).state,result.body.state);assert.equal(result.body.operationId,f.binding.operationId);assert.equal(result.body.planSha256,planSha256);assert.equal(result.body.executionAuthorityGranted,false);
  assert.ok(f.calls.slice(before).every(c=>c.method==='GET'));assert.equal(f.calls.slice(before).filter(c=>c.path.endsWith('xero_recovery_step_readback')).length,1);
  assert.equal((await f.send()).status,403); // stopped original POST stays stopped
});


test('physical v2 TLS host admits its original plan after minute15 with fresh real JWTs and actual SQL', async t => {
  const at = Date.now(), f = await fixture(t, { planVersion: 2, planBinding: { issuedAt: at - 901000, notAfter: at + 899000 } });
  const result = await f.send(); assert.equal(result.status, 200);
  assert.equal(result.body.step, 'preflight'); assert.equal(result.body.nextStep, 'custodyPrepare');
  assert.equal(f.calls.filter(c => c.path === '/rest/v1/rpc/xero_recovery_step_claim').length, 1);
  assert.equal(f.calls.filter(c => c.path === '/rest/v1/rpc/xero_recovery_step_complete').length, 1);
  assert(f.calls.every(c => !c.path.includes('Organisations') && !c.path.includes('/connect/token')));
  const rows = (await f.db.query('select plan_json from public.xero_recovery_step_operations')).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].plan_json, f.planJson);
  assert.equal(JSON.parse(rows[0].plan_json).binding.issuedAt, at - 901000);
});
