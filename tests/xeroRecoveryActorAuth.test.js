import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { createXeroRecoveryActorAuthenticator } from '../scripts/lib/hosted-release/xero-recovery-actor-auth.mjs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';

const pin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const origin = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const actorId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const linkId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const subject = 'existing-fcuno-owner';
const email = 'owner@example.invalid';
const emailSha256 = createHash('sha256').update(email).digest('hex');
const base = 1_800_000_000_000;
const seconds = base / 1000;
const secret = 'test-service-role-secret-never-output';
const failure = 'XERO_RECOVERY_ACTOR_AUTH_REFUSED';
const providerKeys = await generateKeyPair('ES256');
const supabaseKeys = await generateKeyPair('ES256');
const wrongKeys = await generateKeyPair('ES256');
const providerJwk = { ...await exportJWK(providerKeys.publicKey), kid: 'owner', use: 'sig', alg: 'ES256' };
const providerJwks = { keys: [providerJwk] };
const clone = value => structuredClone(value);
const json = value => Response.json(value);
const signed = (payload, key, alg = 'ES256') => new SignJWT(payload).setProtectedHeader({ alg, kid: 'owner' }).sign(key);

async function fixture(options = {}) {
  const state = { at: base, calls: [], counts: {}, ...options.state };
  const requestController = options.requestController || new AbortController();
  const binding = { actorId, emailSha256, accessRevision: 5, ...options.binding };
  const user = { id: actorId, email, is_anonymous: false,
    identities: [{ provider: pin.oidcProvider, provider_id: subject, identity_data: { sub: subject } }], ...options.user };
  const profile = { id: actorId, email, active: true, user_type: 'administrator', access_revision: 5, ...options.profile };
  const link = { id: linkId, provider: 'fcuno', issuer: pin.issuer, subject, auth_user_id: actorId,
    source_active: true, use_fcos: true, revision: 7, credential_revision: 3, revoked_before: null,
    email, email_verified: true, ...options.link };
  const access = { user_id: actorId, access_revision: 5, privileged_access: true,
    permissions: { xero_portal: true }, capabilities: { xero_portal_manage: true }, ...options.access };
  const claims = { iss: `${origin}/auth/v1`, sub: actorId, aud: 'authenticated', role: 'authenticated', session_id: sessionId,
    is_anonymous: false, iat: seconds, exp: seconds + 3600, amr: [{ method: 'oauth', timestamp: seconds }], ...options.claims };
  const provider = { iss: pin.issuer, sub: subject, aud: pin.oidcClientId, typ: 'at+jwt', use_fcos: true,
    email_verified: true, jti: 'fresh-owner-provider-proof', identity_revision: 7, credential_revision: 3,
    iat: seconds, exp: seconds + 300, ...options.provider };
  const bearer = await signed(claims, options.supabaseSigningKey || supabaseKeys.privateKey);
  const providerAccessToken = await signed(provider, options.providerSigningKey || providerKeys.privateKey);
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const kind = u.origin === origin && u.pathname === '/auth/v1/user' ? 'user'
      : u.origin === origin && u.pathname === '/rest/v1/user_profiles' ? 'profile'
      : u.origin === origin && u.pathname === '/rest/v1/fcos_external_identity_links' ? 'link'
      : u.origin === origin && u.pathname === '/rest/v1/rpc/fcos_effective_access' ? 'access'
      : url === pin.syncJwksEndpoint ? 'jwks' : 'unexpected';
    assert.notEqual(kind, 'unexpected');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
    assert.equal(init.signal.aborted, false);
    if (kind === 'jwks') { assert.equal(init.headers.authorization, undefined); assert.equal(init.headers.apikey, undefined); }
    else {
      assert.equal(init.headers.apikey, secret);
      assert.equal(init.headers.authorization, `Bearer ${['link', 'access'].includes(kind) ? secret : bearer}`);
      assert.equal(init.headers['accept-profile'], 'public');
    }
    if (kind === 'profile') {
      assert.equal(u.searchParams.get('id'), `eq.${actorId}`); assert.equal(u.searchParams.get('limit'), '2');
      assert.equal(u.searchParams.get('select'), 'id,email,active,user_type,access_revision');
    }
    if (kind === 'link') {
      assert.equal(u.searchParams.get('auth_user_id'), `eq.${actorId}`); assert.equal(u.searchParams.get('provider'), 'eq.fcuno');
      assert.equal(u.searchParams.get('issuer'), `eq.${pin.issuer}`); assert.equal(u.searchParams.get('subject'), `eq.${user.identities[0].identity_data?.sub || user.identities[0].provider_id}`);
      assert.equal(u.searchParams.get('limit'), '2');
    }
    if (kind === 'access') assert.deepEqual([...u.searchParams], [['p_user_id', actorId]]);
    state.calls.push({ kind, url, init }); state.counts[kind] = (state.counts[kind] || 0) + 1;
    const value = clone({ user, profile: [profile], link: [link], access, jwks: providerJwks }[kind]);
    if (options.respond) {
      const changed = await options.respond({ kind, value, count: state.counts[kind], state, init, requestController });
      if (changed !== undefined) return changed;
    }
    if (kind === 'user') {
      // This local Auth-server stand-in independently verifies the actual exact
      // supplied Supabase JWT. Production calls the real pinned Auth endpoint.
      try { await jwtVerify(init.headers.authorization.slice(7), supabaseKeys.publicKey,
        { issuer: `${origin}/auth/v1`, audience: 'authenticated', currentDate: new Date(state.at) }); }
      catch { return new Response('untrusted auth data', { status: 401 }); }
    }
    return json(value);
  };
  const env = options.env || { VITE_SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: secret };
  const auth = createXeroRecoveryActorAuthenticator({ env, fetchImpl, now: () => state.at,
    ...(options.remoteJwks ? {} : { jwks: options.jwks || createLocalJWKSet(providerJwks) }) });
  return { state, binding, user, profile, link, access, bearer, providerAccessToken, auth, requestController,
    input: { bearer, providerAccessToken, actorId, binding, signal: requestController.signal } };
}

async function denied(f, input = f.input) {
  await assert.rejects(f.auth.authenticate(input), error => {
    assert.equal(error.message, failure); assert.equal(error.code, failure);
    assert.deepEqual(Object.keys(error), ['code']);
    for (const sensitive of [secret, f.bearer, f.providerAccessToken, email, subject]) {
      assert.equal(String(error.stack).includes(sensitive), false);
      assert.equal(JSON.stringify(error).includes(sensitive), false);
    }
    return true;
  });
}

test('existing owner requires real getUser, signed FCUNO proof, own RLS profile and both current access grants', async () => {
  for (const role of ['administrator', 'general_manager']) {
    const f = await fixture({ profile: { user_type: role }, remoteJwks: true });
    const actor = await f.auth.authenticate(f.input);
    assert.deepEqual(Object.keys(actor), ['id', 'active', 'role', 'readOnlyCi', 'workspace', 'xeroPortalManage', 'capturedAt', 'sourceBinding']);
    assert.equal(actor.id, actorId); assert.equal(actor.active, true); assert.equal(actor.role, role);
    assert.equal(actor.readOnlyCi, false); assert.equal(actor.workspace, true); assert.equal(actor.xeroPortalManage, true);
    assert.equal(actor.capturedAt, base); assert.ok(Object.isFrozen(actor)); assert.ok(Object.isFrozen(actor.sourceBinding));
    assert.deepEqual(f.state.calls.map(call => call.kind), ['user', 'jwks', 'profile', 'link', 'access', 'user', 'profile', 'link', 'access']);
    assert.equal(new Set(f.state.calls.map(call => call.init.signal)).size, 1);
    assert.equal(f.state.calls[0].init.signal.aborted, true);
    assert.notEqual(f.state.calls[0].init.signal, f.requestController.signal);
    assert.equal(f.requestController.signal.aborted, false);
    assert.equal(actor.sourceBinding.proofMode, 'fresh_provider_jwt_no_session_write');
    assert.equal(actor.sourceBinding.atomicSnapshot, false); assert.equal(actor.sourceBinding.accessRevision, 5);
    assert.equal(actor.sourceBinding.identityRevision, 7); assert.equal(actor.sourceBinding.credentialRevision, 3);
    assert.equal(actor.sourceBinding.issuer, pin.issuer); assert.equal(actor.sourceBinding.clientId, pin.oidcClientId);
    assert.equal(actor.sourceBinding.emailSha256, emailSha256);
    assert.equal(actor.sourceBinding.sessionIdSha256, createHash('sha256').update(sessionId).digest('hex'));
    for (const sensitive of [secret, f.bearer, f.providerAccessToken, email, subject, sessionId]) assert.equal(JSON.stringify(actor).includes(sensitive), false);
  }
});

test('factory reads only approved Supabase environment names and forces canonical federation despite disabled app flags', async () => {
  const reads = [];
  const env = new Proxy({ VITE_SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: secret,
    FCOS_ENABLE_FCUNO_FEDERATION: 'false', FCUNO_IDENTITY_ISSUER: 'https://attacker.invalid' }, {
    get(target, field) { reads.push(field); return target[field]; },
  });
  const f = await fixture({ env }); await f.auth.authenticate(f.input);
  assert.deepEqual(reads, ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  for (const bad of [{ VITE_SUPABASE_URL: 'https://other.supabase.co', SUPABASE_SERVICE_ROLE_KEY: secret },
    { VITE_SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: '' },
    { VITE_SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: 'secret\nvalue' },
    { SUPABASE_URL: origin, SUPABASE_SECRET_KEY: secret }]) {
    assert.throws(() => createXeroRecoveryActorAuthenticator({ env: bad }), { message: failure, code: failure });
  }
  for (const invalid of [null, true, [], { permissions: () => ({ xero_portal: true }) }]) {
    assert.throws(() => createXeroRecoveryActorAuthenticator(invalid), { message: failure, code: failure });
  }
});

test('immutable plan binding is exact, hashes normalized email, and is captured before awaiting transport', async () => {
  const cases = [input => { input.actorId = otherId; }, input => { input.binding.actorId = otherId; },
    input => { input.binding.emailSha256 = '0'.repeat(64); }, input => { input.binding.accessRevision = '5'; },
    input => { input.binding.accessRevision = 0; }, input => { input.binding.extra = true; }, input => { input.jwks = providerJwks; }];
  for (const change of cases) { const f = await fixture(); change(f.input); await denied(f); }
  const f = await fixture({ user: { email: ' OWNER@EXAMPLE.INVALID ' }, profile: { email: 'OWNER@EXAMPLE.INVALID' }, link: { email: 'Owner@Example.Invalid' } });
  assert.equal((await f.auth.authenticate(f.input)).id, actorId);
  const invalidInput = await fixture();
  for (const invalid of [null, {}, []]) await denied(invalidInput, invalid);
  await assert.rejects(invalidInput.auth.authenticate(), { message: failure, code: failure });
  let reads = 0;
  const getter = await fixture(); Object.defineProperty(getter.input.binding, 'actorId', { enumerable: true, get() { reads++; return actorId; } });
  await denied(getter); assert.equal(reads, 0); assert.equal(getter.state.calls.length, 0);
  const mutation = await fixture({ respond({ kind, count }) { if (kind === 'user' && count === 1) {
    mutation.input.actorId = otherId; mutation.input.binding.actorId = otherId; mutation.input.binding.accessRevision = 99;
  } } });
  assert.equal((await mutation.auth.authenticate(mutation.input)).sourceBinding.accessRevision, 5);
});

test('Supabase actual user validation rejects wrong signature, actor, identity and reserved CI before authority reads', async () => {
  for (const options of [{ supabaseSigningKey: wrongKeys.privateKey }, { user: { id: otherId } }, { user: { email: 'other@example.invalid' } },
    { user: { is_anonymous: true } }, { user: { identities: [] } },
    { user: { identities: [{ provider: 'custom:fcuno', provider_id: subject, identity_data: { sub: 'different' } }] } },
    { user: { identities: [{ provider: 'custom:fcuno', provider_id: subject }, { provider: 'custom:fcuno', provider_id: subject }] } },
    { user: { email: FCOS_READ_ONLY_CI.email } },
    { user: { identities: [{ provider: FCOS_READ_ONLY_CI.provider, provider_id: FCOS_READ_ONLY_CI.subject, identity_data: { sub: FCOS_READ_ONLY_CI.subject } }] } }]) {
    const f = await fixture(options); await denied(f); assert.deepEqual(f.state.calls.map(call => call.kind), ['user']);
  }
});

test('only a current genuine OAuth Supabase session is admissible, including refresh/MFA without a new primary method', async () => {
  const patches = [{ iss: 'https://wrong.invalid/auth/v1' }, { sub: otherId }, { session_id: '' }, { session_id: 'not-a-uuid' },
    { role: 'service_role' }, { aud: 'anon' }, { is_anonymous: true }, { exp: seconds - 1 }, { exp: seconds },
    { iat: seconds + 61 }, { iat: '1800000000' }, { iat: 0 }, { amr: [] },
    { amr: [{ method: 'password', timestamp: seconds }] }, { amr: [{ method: 'token_refresh', timestamp: seconds }] },
    { amr: [{ method: 'oauth', timestamp: seconds }, { method: 'password', timestamp: seconds }] },
    { amr: [{ method: 'oauth', timestamp: seconds }, { method: 'oauth', timestamp: seconds }] },
    { amr: [{ method: 'oauth', timestamp: String(seconds) }] }, { amr: [{ method: 'oauth', timestamp: 0 }] },
    { amr: [{ method: 'oauth', timestamp: seconds + 61 }] }, { amr: [null] }];
  for (const claims of patches) { const f = await fixture({ claims }); await denied(f); }
  const f = await fixture({ claims: { aud: ['authenticated'], amr: [{ method: 'oauth', timestamp: seconds - 10 },
    { method: 'totp', timestamp: seconds }, { method: 'token_refresh', timestamp: seconds }] } });
  assert.equal((await f.auth.authenticate(f.input)).sourceBinding.authenticatedAt, base - 10_000);
});

test('FCUNO proof is independently signed for pinned audience/issuer and exact fresh access/session claims every time', async () => {
  const patches = [{ iss: 'https://wrong.invalid' }, { aud: 'other-client' }, { sub: 'other-subject' }, { typ: 'id+jwt' },
    { use_fcos: false }, { email_verified: false }, { jti: '' }, { jti: 'x'.repeat(501) },
    { identity_revision: 8 }, { identity_revision: 0 }, { identity_revision: '7' }, { credential_revision: 4 },
    { credential_revision: 0 }, { credential_revision: '3' }, { nbf: seconds + 61 }, { exp: undefined }, { iat: undefined },
    { jti: undefined }, { exp: seconds - 1 }, { exp: seconds },
    { exp: seconds + 301 }, { iat: seconds + 61 }, { iat: 0 }, { iat: '1800000000' },
    { iat: seconds - 301, exp: seconds + 1 }, { email: 'different@example.invalid' }];
  for (const provider of patches) { const f = await fixture({ provider }); await denied(f); }
  const wrong = await fixture({ providerSigningKey: wrongKeys.privateKey }); await denied(wrong);
  const authLater = await fixture({ claims: { iat: seconds + 60, amr: [{ method: 'oauth', timestamp: seconds + 60 }] },
    provider: { iat: seconds - 1, exp: seconds + 299 } }); await denied(authLater);
  const noProof = await fixture(); noProof.input.providerAccessToken = ''; await denied(noProof); assert.equal(noProof.state.calls.length, 0);
  const hmac = await fixture(); hmac.input.providerAccessToken = await signed({ ...clone(patches[0]), sub: subject }, new Uint8Array(32), 'HS256'); await denied(hmac);
});

test('current link must already belong to actor with matching identity/credential revisions above revocation floor', async () => {
  const patches = [{ auth_user_id: null }, { auth_user_id: otherId }, { source_active: false }, { use_fcos: false },
    { provider: 'other' }, { issuer: 'https://wrong.invalid' }, { subject: 'other-subject' }, { email: 'other@example.invalid' },
    { email_verified: false }, { revision: 8 }, { revision: '7' }, { credential_revision: 4 },
    { revoked_before: 'invalid' }, { revoked_before: new Date(base).toISOString() },
    { revoked_before: new Date(base + 1000).toISOString() }];
  for (const link of patches) { const f = await fixture({ link }); await denied(f); }
  const refreshed = await fixture({ claims: { amr: [{ method: 'oauth', timestamp: seconds - 3600 }] },
    link: { revoked_before: new Date(base - 10_000).toISOString() } });
  await denied(refreshed); // Fresh token iat never substitutes for original OAuth authentication.
  const providerRevoked = await fixture({ claims: { amr: [{ method: 'oauth', timestamp: seconds }] },
    provider: { iat: seconds - 10, exp: seconds + 290 }, link: { revoked_before: new Date(base - 5000).toISOString() } });
  await denied(providerRevoked);
});

test('profile/role and effective group permission denial cannot be bypassed by caller or administrator label', async () => {
  for (const profile of [{ active: false }, { id: otherId }, { email: 'other@example.invalid' }, { user_type: 'finance' },
    { user_type: 'viewer' }, { access_revision: 6 }, { access_revision: '5' }]) {
    const f = await fixture({ profile }); await denied(f);
  }
  for (const access of [{ user_id: otherId }, { access_revision: 6 }, { access_revision: '5' }, { privileged_access: false },
    { permissions: { xero_portal: false } }, { permissions: {} }, { permissions: { xero_portal: 'true' } },
    { capabilities: { xero_portal_manage: false } }, { capabilities: {} }, { capabilities: { xero_portal_manage: 1 } }]) {
    const f = await fixture({ access }); await denied(f);
  }
  for (const kind of ['profile', 'link', 'access']) {
    for (const replacement of [[], null, [{ id: actorId }, { id: actorId }]]) {
      const f = await fixture({ respond: x => x.kind === kind ? json(replacement) : undefined }); await denied(f);
    }
  }
  const rls = await fixture({ respond: ({ kind }) => kind === 'profile' ? new Response('RLS denied', { status: 403 }) : undefined });
  await denied(rls); assert.deepEqual(rls.state.calls.map(call => call.kind), ['user', 'profile']);
});

test('final boundary rechecks user, link, profile and current projection and rejects observed drift without retry', async () => {
  for (const [target, mutate] of [
    ['user', value => { value.identities[0].provider_id = 'changed'; value.identities[0].identity_data.sub = 'changed'; }],
    ['profile', value => { value[0].user_type = 'general_manager'; }],
    ['link', value => { value[0].source_active = false; }],
    ['link', value => { value[0].revoked_before = new Date(base).toISOString(); }],
    ['access', value => { value.capabilities.xero_portal_manage = false; }],
    ['access', value => { value.access_revision++; }],
  ]) {
    const f = await fixture({ respond({ kind, count, value }) { if (kind === target && count === 2) { mutate(value); return json(value); } } });
    await denied(f); assert.equal(f.state.counts[target], 2);
  }
});

test('transport rejects redirects, wrong URLs/types, non-success/error bodies, malformed and oversized responses', async () => {
  const responses = [() => new Response('secret body', { status: 401 }),
    () => Response.redirect('https://attacker.invalid', 302),
    () => { const r = json({}); Object.defineProperty(r, 'redirected', { value: true }); return r; },
    () => { const r = json({}); Object.defineProperty(r, 'url', { value: 'https://attacker.invalid' }); return r; },
    () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{bad json', { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '-1' } }),
    () => new Response(' '.repeat(65_537), { headers: { 'content-type': 'application/json' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(40_000)); controller.close(); } }),
      { headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of responses) {
    const f = await fixture({ respond: () => response() }); await denied(f); assert.equal(f.state.calls.length, 1);
  }
  for (const keys of [{ keys: [] }, { keys: [{ ...providerJwk, d: 'private' }] }, { keys: [{ ...providerJwk, crv: 'P-384' }] },
    { keys: Array(9).fill(providerJwk) }, { keys: [{ ...providerJwk, x: 'bad' }] }]) {
    const f = await fixture({ remoteJwks: true, respond: ({ kind }) => kind === 'jwks' ? json(keys) : undefined }); await denied(f);
  }
});

test('one 15 second deadline covers fetch and streamed bodies even when injected clock is frozen', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const body of [false, true]) {
      let observedSignal;
      const f = await fixture({ respond({ init }) { observedSignal = init.signal;
        return body ? new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }),
          { headers: { 'content-type': 'application/json' } }) : new Promise(() => {}); } });
      const pending = denied(f);
      await new Promise(resolve => queueMicrotask(resolve));
      t.mock.timers.tick(15_000);
      await pending;
      assert.equal(observedSignal.aborted, true); assert.equal(f.state.calls.length, 1);
    }
  } finally { t.mock.timers.reset(); }
});

test('whole-auth clock budget, rollback and mid-read token expiry fail closed with no retries', async () => {
  for (const update of [state => { state.at += 2000; }, state => { state.at--; }]) {
    const f = await fixture({ respond({ state }) { update(state); } }); await denied(f);
    assert.ok(f.state.calls.length <= 8);
  }
  const f = await fixture({ provider: { exp: seconds + 5 }, respond({ state }) { state.at += 1000; } }); await denied(f);
});

test('every failure has one fixed safe code, without transport/JWT/row diagnostics or credentials', async () => {
  const f = await fixture({ respond() { throw new Error(`${secret} ${email} ${subject}`); } }); await denied(f);
  const badJwks = await fixture({ jwks() { throw Object.assign(new Error(`${secret} ${email}`), { code: secret }); } }); await denied(badJwks);
  const badClock = await fixture();
  const auth = createXeroRecoveryActorAuthenticator({ env: { VITE_SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: secret },
    now() { throw new Error(secret); }, fetchImpl() { throw new Error(secret); } });
  await denied({ ...badClock, auth });
});


test('real host lifecycle signal is required and pre-abort causes no reads or key verification', async () => {
  for (const signal of [undefined, null, {}, { aborted: false }, AbortSignal.abort(new Error(secret))]) {
    const f = await fixture(); f.input.signal = signal;
    await denied(f); assert.equal(f.state.calls.length, 0);
  }
  const absent = await fixture(); delete absent.input.signal;
  await denied(absent); assert.equal(absent.state.calls.length, 0);
  const f = await fixture(); f.requestController.abort(new Error(secret));
  await denied(f); assert.equal(f.state.calls.length, 0);
});

test('host cancellation gates every next authority read and canonical JWKS GET without retry', async () => {
  for (const [target, targetCount] of [['user', 1], ['jwks', 1], ['profile', 1], ['link', 1], ['access', 1],
    ['user', 2], ['profile', 2], ['link', 2], ['access', 2]]) {
    let signal;
    const f = await fixture({ remoteJwks: true, respond({ kind, count, value, init, requestController }) {
      if (kind === target && count === targetCount) {
        signal = init.signal;
        requestController.abort(new Error(secret));
        return json(value);
      }
    } });
    await denied(f);
    assert.equal(signal.aborted, true);
    assert.equal(f.state.calls.at(-1).kind, target);
    assert.equal(f.state.counts[target], targetCount);
    // Let already-started promise continuations settle; none may dispatch a read.
    const completed = f.state.calls.length;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.calls.length, completed);
    assert.equal(new Set(f.state.calls.map(call => call.init.signal)).size, 1);
  }
});

test('mid-fetch host cancellation returns immediately even if transport ignores abort and later settles', async () => {
  for (const target of ['user', 'jwks', 'link']) {
    let release, reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const f = await fixture({ remoteJwks: true, respond({ kind, value }) {
      if (kind === target) { reached(); return new Promise(resolve => { release = () => resolve(json(value)); }); }
    } });
    const pending = denied(f);
    await waiting;
    f.requestController.abort(new Error(secret));
    await pending; // Must not wait for the stuck fetch or the 15 second budget.
    const calls = f.state.calls.length;
    assert.equal(f.state.calls.at(-1).init.signal.aborted, true);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.calls.length, calls);
  }
});

test('host abort cancels a pending streamed body and cannot proceed to another credentialed GET', async () => {
  let reached, bodyCancelled = 0;
  const waiting = new Promise(resolve => { reached = resolve; });
  const f = await fixture({ respond() {
    return new Response(new ReadableStream({ pull() { reached(); return new Promise(() => {}); },
      cancel() { bodyCancelled++; } }), { headers: { 'content-type': 'application/json' } });
  } });
  const pending = denied(f); await waiting;
  f.requestController.abort(new Error(secret));
  await pending;
  assert.equal(bodyCancelled, 1); assert.equal(f.state.calls.length, 1);
});

test('injected verification cannot cancel crypto but cancellation prevents completion and all later reads', async () => {
  let release, reached;
  const waiting = new Promise(resolve => { reached = resolve; });
  const f = await fixture({ jwks() { reached(); return new Promise(resolve => { release = () => resolve(providerKeys.publicKey); }); } });
  const pending = denied(f); await waiting;
  f.requestController.abort(new Error(secret));
  await pending;
  assert.deepEqual(f.state.calls.map(call => call.kind), ['user']);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.state.calls.map(call => call.kind), ['user']);
});


test('service-only fixed effective-access GET follows verified own identity while own profile keeps actor bearer', async () => {
  let profileReads = 0, accessReads = 0;
  const f = await fixture({ respond({ kind, init, state }) {
    if (kind === 'profile') {
      profileReads++;
      // Model the real own-row RLS transport: no service bearer substitutes for
      // the actor when reading the profile that establishes this boundary.
      if (init.headers.authorization !== `Bearer ${f.bearer}`) return new Response('own profile denied', { status: 403 });
    }
    if (kind === 'access') {
      accessReads++;
      // Model the native RPC EXECUTE ACL: authenticated cannot execute it.
      if (init.headers.authorization !== `Bearer ${secret}`) return new Response('RPC execute denied', { status: 403 });
      assert.equal(state.counts.profile, accessReads);
      assert.equal(state.counts.link, accessReads);
      assert.equal(state.counts.user, accessReads);
      assert.deepEqual([...new URL(state.calls.at(-1).url).searchParams], [['p_user_id', actorId]]);
    }
  } });
  const actor = await f.auth.authenticate(f.input);
  assert.equal(profileReads, 2); assert.equal(accessReads, 2);
  assert.equal(actor.id, actorId); assert.equal(actor.sourceBinding.accessRevision, 5);
  assert.equal(actor.workspace, true); assert.equal(actor.xeroPortalManage, true);
  for (const access of [{ user_id: otherId }, { access_revision: 6 }, { permissions: { xero_portal: false } },
    { capabilities: { xero_portal_manage: false } }]) {
    const deniedProjection = await fixture({ access }); await denied(deniedProjection);
    assert.equal(deniedProjection.state.counts.access, 1);
  }
});

test('host cancellation between owned-link response and service RPC dispatch prevents that RPC', async () => {
  const f = await fixture({ respond({ kind, value, requestController }) {
    if (kind === 'link') {
      queueMicrotask(() => requestController.abort(new Error(secret)));
      return json(value);
    }
  } });
  await denied(f);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.state.calls.map(call => call.kind), ['user', 'profile', 'link']);
  assert.equal(f.state.counts.access, undefined);
});
