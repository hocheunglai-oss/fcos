import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI as pin } from '../config/fcosCiIdentity.js';
import { deploymentRequestSafety, currentDeploymentRequestSafety, runWithDeploymentRequestSafety, isDeploymentReadOnly, requireDeploymentMutationAllowed } from '../api/_deploymentReadOnly.js';
import { deploymentSafeSupabaseFetch, requireDeploymentSupabaseRequestAllowed, withVerifiedFcunoSessionInsert, READ_ONLY_SUPABASE_RPCS } from '../api/_deploymentReadOnlyFetch.js';
import { externalActionGates } from '../api/_externalActionGates.js';
import { validateCiFederation } from '../api/_readOnlyCiAccess.js';
import { enforceFcunoFederatedAccess } from '../api/_fcunoIdentityFederation.js';
import { getOrLoadRuntimeCache, expireRuntimeCacheTags } from '../api/_runtimeCache.js';
import { reportSystemError } from '../api/_systemErrorNotifications.js';
import { recordWorkflowMetric } from '../api/_workflowMetrics.js';
import { syncEmailRouterMailboxIfDue, emailRouterGraphFetch } from '../api/_emailRouterCore.js';
import { getFreshXeroConnection, requestXeroToken, xeroAccountingFetch } from '../api/_xeroContactSync.js';
import { createMicrosoftGraphMailTransport } from '../api/_microsoftGraphMail.js';
import { sendGraphPurposeMail } from '../api/_graphEmail.js';
import dispatcher from '../api/functions/[name].js';
import workNotifications from '../api/work-notifications.js';
import releaseIdentity, { publicReleaseIdentity } from '../api/release-identity.js';

const canonicalHost = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).hostname;
const stagedHost = 'fcos-runtime-staged.vercel.app';
const production = { VERCEL_ENV: 'production', VERCEL: '1' };
const request = (host = stagedHost) => ({ method: 'POST', url: '/api/functions/adminUserSave', headers: { host } });
const stage = (run) => runWithDeploymentRequestSafety(request(), run, production);
const canonical = (run) => runWithDeploymentRequestSafety(request(canonicalHost), run, production);
const denied = { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' };
const supabase = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
function response() { return { statusCode: 200, headers: {}, body: null, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(body = '') { this.body = String(body); } }; }

test('staging admits only the exact one-time FCUNO proof insert inside its verified scope', () => stage(() => {
  const url = supabase + '/rest/v1/fcos_external_identity_sessions';
  const binding = { session_id: 'signed-session', provider_token_hash: 'verified-hash' };
  const init = { method: 'POST', body: JSON.stringify(binding) };
  assert.throws(() => requireDeploymentSupabaseRequestAllowed(url, init), denied);
  withVerifiedFcunoSessionInsert(binding, () => {
    for (const [target, request] of [
      [url + '?on_conflict=session_id', init],
      [supabase + '/rest/v1/user_profiles', init],
      [url, { ...init, method: 'PATCH' }],
      [url, { ...init, body: JSON.stringify({ ...binding, active: true }) }],
      [url, { ...init, headers: { prefer: 'resolution=merge-duplicates' } }],
    ]) assert.throws(() => requireDeploymentSupabaseRequestAllowed(target, request), denied);
    assert.doesNotThrow(() => requireDeploymentSupabaseRequestAllowed(url, init));
    assert.throws(() => requireDeploymentSupabaseRequestAllowed(url, init), denied);
  });
}));

test('the Supabase client can submit one scoped proof through the real fetch guard', async () => stage(async () => {
  let calls = 0;
  const binding = { session_id: 'signed-session', provider_token_hash: 'verified-hash' };
  const client = createClient(supabase, 'sb_secret_fixture', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      requireDeploymentSupabaseRequestAllowed(url, init);
      calls += 1;
      return new Response(null, { status: 201 });
    } },
  });
  const result = await withVerifiedFcunoSessionInsert(binding, async () =>
    await client.from('fcos_external_identity_sessions').insert(binding));
  assert.equal(result.error, null);
  assert.equal(calls, 1);
}));

// These fixtures substitute Vercel's routing Host, live identity-link reads and
// provider transports. They do not claim actual Vercel/Supabase authentication.
test('Production routing uses exact Host authority, with malformed and spoofed authorities failing closed', () => {
  assert.equal(deploymentRequestSafety(request(canonicalHost), production).readOnly, false);
  for (const req of [request(), request(undefined), { headers: {} }, request(`${canonicalHost}:443`),
    request(`${canonicalHost}.evil.example`), request(`${canonicalHost},${stagedHost}`), request([canonicalHost]),
    { ...request(), headers: { host: stagedHost, 'x-forwarded-host': canonicalHost } },
    { ...request(canonicalHost), headers: { host: canonicalHost, 'x-forwarded-host': stagedHost } },
    { ...request(canonicalHost), headers: { host: canonicalHost, Host: canonicalHost } },
    { ...request(canonicalHost), rawHeaders: ['Host', canonicalHost, 'Host', canonicalHost] },
    { ...request(canonicalHost), url: `https://${stagedHost}/api/functions/adminUserSave` }]) {
    assert.equal(deploymentRequestSafety(req, production).readOnly, true, JSON.stringify(req));
  }
  assert.equal(deploymentRequestSafety(request(canonicalHost), { VERCEL_ENV: 'preview' }).readOnly, true);
  assert.equal(isDeploymentReadOnly(production), true, 'no request authority cannot establish live write access');
});

test('request scopes are immutable and isolated across simultaneous requests and continuations', async () => {
  let continueStage;
  const held = new Promise(resolve => { continueStage = resolve; });
  const readOnly = stage(async () => {
    const policy = currentDeploymentRequestSafety();
    assert.equal(Object.isFrozen(policy), true);
    assert.throws(() => { policy.readOnly = false; }, TypeError);
    await held;
    assert.equal(isDeploymentReadOnly({}), true);
    assert.throws(() => requireDeploymentMutationAllowed(true, {}), denied);
    assert.ok(Object.values(externalActionGates({ FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' })).every(gate => !gate.enabled));
  });
  await canonical(async () => {
    assert.equal(isDeploymentReadOnly(), false);
    assert.doesNotThrow(() => requireDeploymentMutationAllowed(true));
    continueStage();
    await Promise.resolve();
    assert.equal(isDeploymentReadOnly(), false);
  });
  await readOnly;
  assert.equal(currentDeploymentRequestSafety(), null);
});

test('all dispatcher mutations, mixed actions and cron routes stop before auth, body reads or provider calls on staged Production', async () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    for (const name of ['adminUserSave', 'missingNomBReminderCron', 'marketReportDriveSyncCron', 'outstandingBuyerInvoicesEmailCron', 'emailRouterMaintenanceCron']) {
      let bodyReads = 0;
      const req = { ...request(), url: `/api/functions/${name}`, get body() { bodyReads++; throw Error('body must not be parsed'); } };
      const res = response();
      await dispatcher(req, res);
      assert.equal(res.statusCode, 403, name);
      assert.equal(JSON.parse(res.body).code, denied.code);
      assert.equal(bodyReads, 0);
    }
    const mixed = response();
    await dispatcher({ ...request(), url: '/api/functions/hedgeMarkets', body: { action: 'future_write' } }, mixed);
    assert.equal(mixed.statusCode, 403);
    const standalone = response();
    await workNotifications({ ...request(), url: '/api/work-notifications' }, standalone);
    assert.equal(standalone.statusCode, 403);
    for (const host of [stagedHost, canonicalHost]) {
      for (const name of ['salesforceDocumentDownload', 'dashboardAccountInsightExport', 'specialTermsPdfExport', 'specialTermsDocumentExport']) {
        const res = response();
        await dispatcher({ method: 'GET', headers: { host }, url: `/api/functions/${name}` }, res);
        assert.equal(res.statusCode, 401, `${host}/${name}: read export still requires authentication`);
      }
    }
    const res = response();
    await workNotifications({ ...request(canonicalHost), url: '/api/work-notifications' }, res);
    assert.equal(res.statusCode, 401, 'canonical mutation reaches normal auth');
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous;
  }
});

test('privileged Supabase transport denies every write, arbitrary RPC and storage capability before fetch', async () => stage(async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try {
    for (const [path, method, headers] of [
      ['/rest/v1/user_profiles', 'POST'], ['/rest/v1/user_profiles?id=eq.test', 'PATCH'], ['/rest/v1/user_profiles', 'DELETE'],
      ['/rest/v1/rpc/save_user_navigation_preferences', 'POST'], ['/rest/v1/rpc/save_user_navigation_preferences', 'GET'],
      ['/rest/v1/rpc/fcos_effective_access', 'POST', { 'content-profile': 'other_schema' }],
      ['/storage/v1/object/bucket/file', 'POST'], ['/storage/v1/object/bucket/file', 'DELETE'],
      ['/storage/v1/object/sign/bucket/file', 'POST'], ['/storage/v1/object/upload/sign/bucket/file', 'POST'],
      ['/auth/v1/admin/users', 'POST'], ['/auth/v1/token?grant_type=refresh_token', 'POST'],
    ]) assert.throws(() => deploymentSafeSupabaseFetch(`${supabase}${path}`, { method, headers }), denied);
    assert.throws(() => deploymentSafeSupabaseFetch('https://another-project.supabase.co/rest/v1/user_profiles'), denied);
    assert.equal(calls, 0);
    await deploymentSafeSupabaseFetch(`${supabase}/auth/v1/user`, { method: 'GET' });
    await deploymentSafeSupabaseFetch(`${supabase}/rest/v1/user_profiles?select=id`, { method: 'GET' });
    for (const rpc of READ_ONLY_SUPABASE_RPCS) await deploymentSafeSupabaseFetch(`${supabase}/rest/v1/rpc/${rpc}`, { method: 'POST' });
    assert.equal(calls, 5);
  } finally { globalThis.fetch = original; }
}));

test('safe read RPCs are an exact allowlist of SQL STABLE functions and every service client uses the barrier', async () => {
  assert.deepEqual(READ_ONLY_SUPABASE_RPCS, ['fcos_effective_access', 'dashboard_ai_usage_summary', 'load_work_notification_snapshot']);
  const sql = (await Promise.all((await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).map(name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')))).join('\n');
  for (const rpc of READ_ONLY_SUPABASE_RPCS) assert.match(sql, new RegExp(`function public\\.${rpc}\\([\\s\\S]*?language sql\\s+stable`, 'i'));
  const apiFiles = (await readdir(new URL('../api/', import.meta.url), { recursive: true })).filter(name => name.endsWith('.js'));
  for (const name of apiFiles) {
    const source = await readFile(new URL(`../api/${name}`, import.meta.url), 'utf8');
    if (/\bcreateClient\(/.test(source)) assert.match(source, /deploymentSafeSupabaseFetch/, name);
    if (!name.split('/').pop().startsWith('_')) assert.match(source, /withDeploymentRequestSafety|authenticatedFunction/, name);
  }
  const safety = await readFile(new URL('../api/_deploymentReadOnly.js', import.meta.url), 'utf8');
  assert.doesNotMatch(safety, /process\.env(?:\.[a-zA-Z0-9_]+|\[[^\]]+\])\s*=/);
});

test('staged reads suppress persistent cache writes, invalidation, metrics, errors and background email sync', async () => stage(async () => {
  let writes = 0;
  const forbidden = () => { writes++; throw Error('write must never start'); };
  const cacheAdapter = { get: async () => ({ value: 'stale', expiresAt: 1 }), set: forbidden, delete: forbidden, expireTags: forbidden };
  const result = await getOrLoadRuntimeCache({ namespace: 'stage-test', ttlSeconds: 10, loader: async () => 'read-result', cacheAdapter });
  assert.equal(result.value, 'read-result');
  assert.equal(result.cache.status, 'bypass');
  assert.equal((await expireRuntimeCacheTags(['live-data'], { cacheAdapter })).status, 'bypass');
  const client = { from: forbidden, rpc: forbidden };
  assert.equal((await reportSystemError(client, { status: 500, handler: 'dashboardSummary', environment: production })).recorded, false);
  assert.equal((await recordWorkflowMetric(client, {})).recorded, false);
  assert.equal((await syncEmailRouterMailboxIfDue({ client, mailbox: {} })).reason, 'deployment_read_only');
  await assert.rejects(emailRouterGraphFetch('/users/a/messages/id', { method: 'PATCH' }), denied);
  await assert.rejects(sendGraphPurposeMail({ client, purposeKey: 'payment_reminders', message: {} }), { code: 'EXTERNAL_ACTION_GATE_DISABLED' });
  assert.equal(writes, 0);
}));

test('a staged cache load cannot join or invalidate a concurrent canonical load', async () => {
  let releaseLive;
  const held = new Promise(resolve => { releaseLive = resolve; });
  const values = [];
  const cacheAdapter = { get: async () => null, set: async (_key, entry) => { values.push(entry.value); } };
  const options = { namespace: 'isolated-stage-live-cache', ttlSeconds: 10, cacheAdapter };
  const live = canonical(() => getOrLoadRuntimeCache({ ...options, loader: async () => { await held; return 'canonical'; } }));
  const staged = await stage(() => getOrLoadRuntimeCache({ ...options, loader: async () => 'staged' }));
  assert.equal(staged.value, 'staged');
  releaseLive();
  assert.equal((await live).value, 'canonical');
  assert.deepEqual(values, ['canonical']);
});

test('a mail transport cached during canonical access rechecks staged authority before sending', async () => {
  let calls = 0;
  const transport = await canonical(() => createMicrosoftGraphMailTransport({ tenantId: 'fixture-tenant', clientId: 'fixture-client', mailbox: 'fixture@example.com' }, {
    oidcTokenProvider: async () => 'fixture-assertion',
    fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ access_token: 'fixture-token' }) }; },
  }));
  assert.equal(calls, 1);
  await stage(() => assert.rejects(transport.sendMail({ to: 'fixture@example.com', subject: 'fixture' }), { code: 'EXTERNAL_ACTION_GATE_DISABLED' }));
  assert.equal(calls, 1);
});

test('Xero token renewal and durable accounting admission are rejected before leases or provider calls', async () => stage(async () => {
  let writes = 0;
  const forbidden = () => { writes++; throw Error('provider or control must not start'); };
  const stored = { tenant_id: 'tenant', token_version: 1, access_token: 'fixture', refresh_token: 'fixture', expires_at: '2000-01-01T00:00:00Z' };
  const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: stored }) };
  await assert.rejects(getFreshXeroConnection({ from: () => q }, { sharedControl: { claimRefresh: forbidden } }), denied);
  await assert.rejects(requestXeroToken({}, new URLSearchParams(), forbidden), denied);
  await assert.rejects(xeroAccountingFetch({}, '/Invoices', { fetchImpl: forbidden }), denied);
  assert.equal(writes, 0);
}));

test('the reserved CI principal is admitted only by trusted read-only scope with existing signed-link entitlement', async () => {
  const authUser = { id: '11111111-1111-4111-8111-111111111111', email: pin.email, identities: [{ provider: pin.provider, identity_data: { sub: pin.subject } }] };
  const profile = { id: authUser.id, email: pin.email, active: false, user_type: 'viewer' };
  const link = { id: 'fixture-link', auth_user_id: authUser.id, email: pin.email, email_verified: true, source_active: true, use_fcos: true };
  const input = { authUser, profile, link, issuer: pin.issuer, subject: pin.subject, env: {} };
  stage(() => assert.equal(validateCiFederation(input), true));
  canonical(() => assert.throws(() => validateCiFederation(input), { code: 'FCOS_CI_IDENTITY_NOT_READY' }));
  runWithDeploymentRequestSafety({ headers: {} }, () => assert.throws(() => validateCiFederation(input), { code: 'FCOS_CI_IDENTITY_NOT_READY' }), production);
  let writes = 0;
  const client = { from(table) { const q = { select() { return q; }, eq() { return q; }, update() { writes++; throw Error('binding forbidden'); }, upsert() { writes++; throw Error('provisioning forbidden'); }, maybeSingle: async () => ({ data: table === 'fcos_external_identity_links' ? { ...link, auth_user_id: null } : profile }) }; return q; } };
  const seconds = Math.floor(Date.now() / 1000);
  // This fixture substitutes Supabase's already-verified bearer, not FCUNO provider proof.
  const claims = { sub: authUser.id, session_id: '22222222-2222-4222-8222-222222222222', iat: seconds,
    amr: [{ method: 'oauth', timestamp: seconds }] };
  const accessToken = `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
  await stage(() => assert.rejects(enforceFcunoFederatedAccess({ client, authUser, profile, accessToken, env: { FCOS_ENABLE_FCUNO_FEDERATION: 'true', FCUNO_IDENTITY_ISSUER: pin.issuer } }), denied));
  assert.equal(writes, 0);
  assert.equal(profile.active, false);
});

test('release identity returns only embedded nonsecret receipt fields without any provider call', async () => {
  const receipt = { buildId: 'build-123', commit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), secret: 'do-not-expose', env: { token: 'do-not-expose' } };
  assert.deepEqual(publicReleaseIdentity(receipt), { schemaVersion: 1, buildId: 'build-123', commit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) });
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw Error('identity endpoint must not contact providers'); };
  try {
    const res = response();
    await releaseIdentity({ ...request(), method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(JSON.parse(res.body)).sort(), ['schemaVersion', 'buildId', 'commit', 'sourceDigest'].sort());
    assert.equal(res.headers['cache-control'], 'no-store');
    const rejected = response();
    await releaseIdentity(request(), rejected);
    assert.equal(rejected.statusCode, 405);
  } finally { globalThis.fetch = original; }
});
