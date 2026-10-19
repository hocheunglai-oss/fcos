// Test-only derivative of the existing physical TLS/PGlite host fixture.
// Real host/actor/protocol/SQL implementations; only external HTTP is synthetic.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { createXeroRecoveryHost } from '../../scripts/lib/hosted-release/xero-recovery-host.mjs';
import { recoveryStepCanonicalJson as canonical, recoveryStepSha256 as hash, prepareXeroRecoveryStepRequest } from '../../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { readXeroSharedControlFixture } from './xero-recovery-fixture.mjs';

// External Auth/JWKS/provider HTTP is synthetic; signatures and PGlite CAS
// acknowledgements are real. Fixtures do not qualify hosted credentials, current
// GitHub job status, live ingress or any proposed preservation authority.
const pin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const ORIGIN = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const PUBLIC = 'https://fixed.vercel.app';
const actorId = '20000000-0000-4000-8000-000000000002', tenantId = '10000000-0000-4000-8000-000000000001';
const owner = '30000000-0000-4000-8000-000000000003', features = '01a0f08b-7fcb-7870-9edc-343e16052b62';
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

export async function createJoinedHostFixture(t, change = {}) {
  const at = Date.now(), seconds = Math.floor(at / 1000);
  const binding = { operationId: 'a'.repeat(64), ownerThreadId: owner, tenantId, actorId, expectedVersion: 7,
    refreshLeaseId: '40000000-0000-4000-8000-000000000004', probeId: '50000000-0000-4000-8000-000000000005',
    requestId: '60000000-0000-4000-8000-000000000006', approvalSha256: 'b'.repeat(64), sourceSha256: 'c'.repeat(64), bindingSha256: 'd'.repeat(64),
    organisationIdentitySha256: null, issuedAt: at - 1000, notAfter: at + (change.planVersion === 2 ? 1799000 : 600000), credentialPreservationCompositeApproved: true, ...change.planBinding };
  if (change.planVersion === 3) { delete binding.issuedAt; delete binding.notAfter; Object.assign(binding, { preparedAt: at - 3600000, armBefore: at + 600000, absoluteNotAfter: at + 3600000, executionWindowMs: 1800000 }); }
  const planJson = canonical({ schemaVersion: change.planVersion || 1, kind: `fcos_xero_recovery_step_plan_v${change.planVersion || 1}`, binding });
  const caller = { ref: 'refs/heads/codex/joined-carrier', sha: 'e'.repeat(40), workflowSha: 'e'.repeat(40),
    workflowRef: 'hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@refs/heads/codex/joined-carrier',
    jobWorkflowRef: `hocheunglai-oss/fcos/.github/workflows/hosted-xero-recovery-carrier.yml@${'f'.repeat(40)}`, jobWorkflowSha: 'f'.repeat(40),
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
  for (const name of ['20261018100701_xero_recovery_private_returned_token_custody.sql', '20261018103446_xero_recovery_durable_step_protocol.sql', '20261019190000_xero_recovery_v2_window.sql', '20261020140000_xero_recovery_v3_late_arm.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
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
    privateEnvironment: { VITE_SUPABASE_URL: ORIGIN, SUPABASE_SERVICE_ROLE_KEY: secret, XERO_CLIENT_ID: 'fixture-client', XERO_CLIENT_SECRET: 'FIXTURE_PRIVATE_CLIENT_SECRET' }, fetchImpl };
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
  return { db, options, handler, server, send, headers, calls, signals, held, planJson, binding, diagnostics, at, email, subject, nonce, secret, githubKeys,
    request: (step = 'preflight', previousResultSha256 = null) => prepareXeroRecoveryStepRequest({ planJson, step, submissionId: randomUUID(), previousResultSha256 }).requestJson };
}
