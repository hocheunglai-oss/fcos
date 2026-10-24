import test from 'node:test';
import assert from 'node:assert/strict';
import { createXeroRecoveryStepResources } from '../scripts/lib/hosted-release/xero-recovery-step-actions.mjs';
import { recoveryStepCanonicalJson as json, recoveryStepSha256 as sha, prepareXeroRecoveryStepRequest } from '../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';
const T = Date.parse('2026-10-18T11:00:00Z'), iso = ms => new Date(ms).toISOString();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const binding = () => ({ operationId: sha('operation'), ownerThreadId: id(1), tenantId: id(2), actorId: id(3), expectedVersion: 449,
  refreshLeaseId: id(4), probeId: id(5), requestId: id(6), approvalSha256: sha('approval'), sourceSha256: sha('source'), bindingSha256: sha('binding'),
  organisationIdentitySha256: null, issuedAt: T, notAfter: T + 900000, credentialPreservationCompositeApproved: true });
const environment = { SUPABASE_URL: 'https://pjforfvchygdyqfcgpmw.supabase.co', SUPABASE_SECRET_KEY: 'test-server-secret',
  XERO_CLIENT_ID: 'test-client-id', XERO_CLIENT_SECRET: 'test-client-secret' };
function fixture(step, checkpoint = {}, options = {}) {
  const b = { ...binding(), ...options.binding }, planJson = json({ schemaVersion: 1, kind: 'fcos_xero_recovery_step_plan_v1', binding: b });
  const request = prepareXeroRecoveryStepRequest({ planJson, step, submissionId: id(30), previousResultSha256: step === 'preflight' ? null : sha('previous-result') });
  const requests = []; let clock = T; const controller = new AbortController();
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init) => {
    const u = new URL(url), body = init.body && init.headers['content-type'] === 'application/json' ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    if (options.fetchOverride) { const result = await options.fetchOverride({ url, init, body, u, response, controller }); if (result) return result; }
    if (u.pathname.endsWith('/xero_recovery_step_claim')) return response({ operationId: b.operationId, planSha256: request.planSha256, requestSha256: request.requestSha256,
      step, submissionId: id(30), decision: 'execute', state: 'submitted_unknown', nextStep: null, lastResultSha256: null, checkpoint });
    if (u.pathname.endsWith('/xero_contact_sync_connections')) return response([{ id: 'primary', tenant_id: b.tenantId, tenant_name: 'Original Organisation', token_version: options.version || 449,
      expires_at: iso(options.expiry || T + 3600000), access_token: 'test-private-access', refresh_token: 'test-private-refresh', scope: 'stored-scope' }]);
    if (u.pathname.endsWith('/xero_shared_status')) return response({ tenantId: b.tenantId, reserve: 200, minuteLimit: 45, inFlightLimit: 2, inFlight: 0,
      reservedCalls: 0, unresolvedWrites: 0, minuteCalls: 0, availableCalls: options.available ?? 200, retryAt: options.retryAt || null,
      allowanceKnown: true, spendableCalls: 0, rateLimit: { observedAt: iso(T) } });
    if (u.pathname.endsWith('/xero_token_refresh_leases') && step === 'tokenRenewAndCapture') return response([{ tenant_id: b.tenantId, lease_id: b.refreshLeaseId, expected_version: b.expectedVersion, state: 'refreshing', expires_at: iso(T + 90000), ...options.lease }]);
    if (['/xero_token_refresh_leases', '/xero_shared_probe_grants', '/xero_shared_requests', '/xero_recovery_token_custody'].some(p => u.pathname.endsWith(p))) return response([]);
    if (u.pathname.endsWith('/xero_recovery_custody_prepare')) return response({ operationId: b.operationId, state: 'prepared' });
    if (u.pathname.endsWith('/xero_refresh_claim')) return response({ state: options.refreshState || 'claimed', leaseId: b.refreshLeaseId });
    if (u.pathname.endsWith('/connect/token')) {
      if (options.expireDuringToken) clock = b.notAfter + 1;
      return response({ access_token: 'test-returned-access', refresh_token: 'test-returned-refresh', expires_in: 1800 });
    }
    if (u.pathname.endsWith('/xero_recovery_custody_capture')) return response({ operationId: b.operationId, state: 'captured' });
    if (u.pathname.endsWith('/xero_recovery_custody_finish')) return response({ operationId: b.operationId, state: 'finished', tokenVersion: 450 });
    if (u.pathname.endsWith('/xero_shared_authorize_probe')) return response({ id: b.probeId, tenant_id: b.tenantId, actor_id: b.actorId,
      consumed_at: null, not_before: body.p_not_before, expires_at: iso(T + 300000) });
    if (u.pathname.endsWith('/xero_shared_admit')) return response({ requestId: b.requestId, tenantId: b.tenantId, deadlineAt: iso(T + 120000) });
    if (u.pathname.endsWith('/Organisations')) return response({ Organisations: [{ OrganisationID: id(90), Name: 'Original Organisation', OrganisationStatus: options.orgStatus || 'ACTIVE' }] });
    if (u.pathname.endsWith('/xero_shared_observe')) return response({ recorded: true });
    throw Error('UNEXPECTED_FIXTURE_REQUEST');
  };
  const resources = createXeroRecoveryStepResources({ planJson, privateEnvironment: { ...environment, ...options.environment }, fetchImpl, now: () => clock,
    rateSnapshot: () => ({ dayRemaining: 999, rateLimitProblem: null, retryAfterSeconds: null, retryAt: null, dayResetAt: null, observedAt: iso(T) }) });
  const claim = () => resources.store.claim({ planJson, planSha256: request.planSha256, requestJson: request.requestJson, requestSha256: request.requestSha256, signal: controller.signal });
  return { resources, requests, b, request, claim, controller, execute: async () => resources.execute({ step, checkpoint, claim: await claim(), signal: controller.signal }) };
}

test('direct action invocation or reconstructed claim JSON cannot replace actual one-use native claim', async () => {
  const f = fixture('custodyPrepare');
  await assert.rejects(f.resources.execute({ step: 'custodyPrepare', checkpoint: {}, claim: {}, signal: f.controller.signal })); assert.equal(f.requests.length, 0);
  const claim = await f.claim(); const count = f.requests.length;
  await assert.rejects(f.resources.execute({ step: 'custodyPrepare', checkpoint: {}, claim: structuredClone(claim), signal: f.controller.signal })); assert.equal(f.requests.length, count);
  assert.deepEqual(await f.resources.execute({ step: 'custodyPrepare', checkpoint: {}, claim, signal: f.controller.signal }), { state: 'prepared' });
  const after = f.requests.length;
  await assert.rejects(f.resources.execute({ step: 'custodyPrepare', checkpoint: {}, claim, signal: f.controller.signal })); assert.equal(f.requests.length, after);
});

test('preflight reads only scoped metadata, preserves reserve, and never loads access/refresh tokens', async () => {
  const f = fixture('preflight'); const result = await f.execute();
  assert.equal(result.tokenVersion, 449); assert.equal(result.renewalRequired, false); assert.equal(result.observedAt, iso(T));
  const query = new URL(f.requests.find(r => r.url.includes('xero_contact_sync_connections')).url);
  assert(!query.searchParams.get('select').includes('access_token')); assert(!query.searchParams.get('select').includes('refresh_token'));
  assert.equal(f.resources.metrics().accountingGets, 0); assert.equal(f.resources.metrics().oauthPosts, 0);
});

for (const options of [{ available: 199 }, { retryAt: iso(T + 5000) }]) test(`shared hold ${JSON.stringify(options)} starts no provider request`, async () => {
  const f = fixture('preflight', {}, options); await assert.rejects(f.execute());
  assert.equal(f.resources.metrics().oauthPosts, 0); assert.equal(f.resources.metrics().accountingGets, 0);
});

test('any prior current approval/grant outcome is held without renewal or probe', async () => {
  const f = fixture('preflight', {}, { fetchOverride: ({ u, response }) => u.pathname.endsWith('/xero_shared_probe_grants') && u.searchParams.has('reason')
    ? response([{ id: id(55) }]) : null });
  await assert.rejects(f.execute()); assert.equal(f.resources.metrics().oauthPosts, 0);
});

test('refresh claim busy/uncertain is terminal for that action, without token POST or cleanup', async () => {
  for (const refreshState of ['busy', 'uncertain', 'revoked', 'changed']) {
    const f = fixture('refreshClaim', {}, { refreshState }); await assert.rejects(f.execute());
    assert.equal(f.resources.metrics().oauthPosts, 0); assert(!f.requests.some(r => /fail|release|reconnect/.test(r.url)));
  }
});

test('one token POST immediately captures exact five private fields before a sanitized action acknowledgement', async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }); const result = await f.execute();
  assert.deepEqual(result, { state: 'captured' }); assert.equal(f.resources.metrics().oauthPosts, 1); assert.equal(f.resources.metrics().accountingGets, 0);
  const capture = f.requests.find(r => r.url.endsWith('/xero_recovery_custody_capture'));
  assert.deepEqual(Object.keys(capture.body.p_connection).sort(), ['tenantId', 'accessToken', 'refreshToken', 'expiresAt', 'scope'].sort());
  assert.equal(capture.body.p_connection.refreshToken, 'test-returned-refresh'); assert.equal(capture.body.p_connection.scope, 'stored-scope');
  assert(!JSON.stringify(result).includes('test-returned')); assert(!f.requests.some(r => r.url.endsWith('/xero_recovery_custody_finish')));
});

test('already-started preservation unit can capture after deadline only; no extra action starts', async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }, { expireDuringToken: true });
  assert.deepEqual(await f.execute(), { state: 'captured' });
  assert.equal(f.requests.filter(r => r.url.endsWith('/xero_recovery_custody_capture')).length, 1);
  assert(!f.requests.some(r => r.url.endsWith('/xero_recovery_custody_finish')));
});

test('lost token response never retries, captures, marks failure or loads a second credential', async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }, { fetchOverride: ({ url }) => { if (url.endsWith('/connect/token')) throw Error('PRIVATE_ERROR'); } });
  await assert.rejects(f.execute(), e => !JSON.stringify(e).includes('PRIVATE_ERROR'));
  assert.equal(f.resources.metrics().oauthPosts, 1); assert(!f.requests.some(r => r.url.endsWith('/xero_recovery_custody_capture')));
  assert(!f.requests.some(r => /fail|release|reconnect/.test(r.url)));
});

test('unknown capture is one attempt and never calls finish or second token POST', async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }, { fetchOverride: ({ url, response }) => url.endsWith('/xero_recovery_custody_capture')
    ? response({ error: 'test-private-driver-message' }, 503) : null });
  await assert.rejects(f.execute()); assert.equal(f.resources.metrics().oauthPosts, 1);
  assert.equal(f.requests.filter(r => r.url.endsWith('/xero_recovery_custody_capture')).length, 1);
  assert(!f.requests.some(r => r.url.endsWith('/xero_recovery_custody_finish')));
});

test('probe admission uses only exact GET Organisations, no budget or financial mutation', async () => {
  const f = fixture('probeAdmission', { sessionVerify: { tokenVersion: 449 } }); const result = await f.execute();
  assert.equal(result.deadlineAt, iso(T + 120000));
  const body = f.requests.find(r => r.url.endsWith('/xero_shared_admit')).body;
  assert.equal(body.p_method, 'GET'); assert.equal(body.p_resource_key, 'Organisations'); assert.equal(body.p_budget_id, null);
});

test('quota GET is one exact tenant-bound request; identity stays observation and never assumes OrganisationID equals tenant', async () => {
  const f = fixture('organisationsGet', { sessionVerify: { tokenVersion: 449 }, probeAdmission: { deadlineAt: iso(T + 10000) } });
  const result = await f.execute(); assert.equal(result.status, 200); assert.equal(result.storedTenantNameMatches, true);
  assert.equal(f.resources.metrics().accountingGets, 1);
  const req = f.requests.find(r => r.url.endsWith('/Organisations'));
  assert.equal(req.init.headers['xero-tenant-id'], f.b.tenantId); assert.equal(req.init.method, 'GET');
  assert(!JSON.stringify(result).includes('test-private-access')); assert(!f.requests.some(r => r.url.endsWith('/xero_shared_observe')));
});

for (const orgStatus of ['INACTIVE', 'UNKNOWN']) test(`OrganisationStatus ${orgStatus} cannot relax ACTIVE`, async () => {
  const f = fixture('organisationsGet', { sessionVerify: { tokenVersion: 449 }, probeAdmission: { deadlineAt: iso(T + 10000) } }, { orgStatus });
  await assert.rejects(f.execute()); assert.equal(f.resources.metrics().accountingGets, 1);
});

test('expired original admission deadline blocks accounting GET despite valid global operation', async () => {
  const f = fixture('organisationsGet', { sessionVerify: { tokenVersion: 449 }, probeAdmission: { deadlineAt: iso(T - 1) } });
  await assert.rejects(f.execute()); assert.equal(f.resources.metrics().accountingGets, 0);
});

test('stored response observation uses existing shared controller only', async () => {
  const observation = { status: 200, snapshot: { dayRemaining: 999 } };
  const f = fixture('probeObservation', { organisationsGet: observation });
  assert.deepEqual(await f.execute(), { recorded: true });
  const body = f.requests.find(r => r.url.endsWith('/xero_shared_observe')).body;
  assert.deepEqual(body.p_snapshot, observation.snapshot); assert.equal(body.p_request_id, f.b.requestId);
  assert.equal(f.resources.metrics().accountingGets, 0);
});

test('all native requests forbid redirect/retry and use a bounded cancellation signal', async () => {
  const f = fixture('preflight'); await f.execute();
  for (const request of f.requests) { assert.equal(request.init.redirect, 'error'); assert.equal(request.init.cache, 'no-store'); assert(request.init.signal instanceof AbortSignal); }
});

for (const lease of [{ expires_at: iso(T - 1) }, { state: 'uncertain' }, { state: 'revoked' }, { lease_id: id(77) }, { expected_version: 450 }]) test(`fresh token dispatch refuses changed refresh lease ${JSON.stringify(lease)}`, async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }, { lease });
  await assert.rejects(f.execute()); assert.equal(f.resources.metrics().oauthPosts, 0);
  assert(!f.requests.some(r => r.url.endsWith('/xero_recovery_custody_capture')));
});

test('cancellation during primary dependency read prevents refresh lease read and token POST', async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }, { fetchOverride: ({ u, response, controller }) => {
    if (u.pathname.endsWith('/xero_contact_sync_connections')) { controller.abort(); return response([]); } return null;
  } });
  await assert.rejects(f.execute()); assert.equal(f.resources.metrics().oauthPosts, 0);
  assert(!f.requests.some(r => r.url.includes('xero_token_refresh_leases')));
});

test('cancellation at refreshed lease read prevents not-yet-started token POST', async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }, { fetchOverride: ({ u, response, controller }) => {
    if (u.pathname.endsWith('/xero_token_refresh_leases')) { controller.abort(); return response([]); } return null;
  } });
  await assert.rejects(f.execute()); assert.equal(f.resources.metrics().oauthPosts, 0);
});

test('already-dispatched token unit preserves ONE capture after cancellation; never finish or probe', async () => {
  const f = fixture('tokenRenewAndCapture', { preflight: { renewalRequired: true } }, { fetchOverride: ({ u, response, controller }) => {
    if (u.pathname.endsWith('/connect/token')) { controller.abort(); return response({ access_token: 'test-returned-access', refresh_token: 'test-returned-refresh', expires_in: 1800 }); } return null;
  } });
  assert.deepEqual(await f.execute(), { state: 'captured' });
  assert.equal(f.resources.metrics().oauthPosts, 1); assert.equal(f.requests.filter(r => r.url.endsWith('/xero_recovery_custody_capture')).length, 1);
  assert(!f.requests.some(r => /finish|observe|Organisations/.test(r.url)));
});

test('ignored late dependency response after abort does not start another HTTP request', async () => {
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  const f = fixture('preflight', {}, { fetchOverride: ({ u }) => {
    if (u.pathname.endsWith('/xero_contact_sync_connections')) { entered(); return new Promise(resolve => { release = resolve; }); } return null;
  } });
  const execution = f.execute(); await started; f.controller.abort(); await assert.rejects(execution);
  const count = f.requests.length; release(new Response('[]', { headers: { 'content-type': 'application/json' } }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, count); assert.equal(f.resources.metrics().oauthPosts, 0);
});
