import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createNormalRoleVerificationRoute, stripNormalRoleProtectionHeaders } from '../scripts/lib/normal-role-verification-transport.mjs';
import { compatibilityNormalRequestAllowed } from '../scripts/runtime-compatibility-normal-role.mjs';
import { normalRoleRequestAllowed } from '../scripts/normal-role-release.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const supabase = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const bypass = 'offline-normal-role-bypass-fixture';
const incoming = { 'X-Vercel-Protection-Bypass': 'incoming-foreign-bypass', 'X-Vercel-Set-Bypass-Cookie': 'true',
  authorization: 'Bearer offline-existing-user-fixture', 'content-type': 'application/json' };

function fixture({ url = `${origin}/api/functions/authContext`, method = 'POST', body = {}, status = 200,
  responseUrl = url, requestHeaders = incoming, responseHeaders = { 'content-type': 'application/json' }, fetchError } = {}) {
  const calls = [], forwarded = [];
  const response = { status: () => status, url: () => responseUrl, headers: () => responseHeaders };
  const route = {
    request: () => ({ url: () => url, method: () => method, headers: () => requestHeaders,
      postDataJSON: () => { if (body === undefined) throw new Error('No JSON body'); return body; } }),
    fetch: async options => {
      calls.push({ kind: 'fetch', url, options });
      // Emulate the dangerous default: following a redirect forwards the
      // overridden authentication headers. The fix must prevent this call.
      if (status >= 300 && status < 400 && options.maxRedirects !== 0) forwarded.push(options.headers);
      if (fetchError) throw new Error(fetchError);
      return response;
    },
    continue: async options => { calls.push({ kind: 'continue', options }); },
    fulfill: async options => { calls.push({ kind: 'fulfill', options }); },
    abort: async () => { calls.push({ kind: 'abort' }); },
  };
  return { calls, forwarded, route, response };
}

async function run(f, requestAllowed = compatibilityNormalRequestAllowed, secret = bypass) {
  let blocked = 0;
  await createNormalRoleVerificationRoute({ origin, protectionBypass: secret, requestAllowed,
    onBlockedMutation: () => { blocked += 1; } })(f.route);
  return blocked;
}

test('both protection headers are stripped case-insensitively without modifying ordinary headers', () => {
  assert.deepEqual(stripNormalRoleProtectionHeaders(incoming), {
    authorization: incoming.authorization, 'content-type': 'application/json',
  });
  assert.equal(incoming['X-Vercel-Set-Bypass-Cookie'], 'true');
});

test('Preview uses one no-redirect fetch and fulfills the actual response without protection control headers', async () => {
  const f = fixture({ responseHeaders: { 'X-Vercel-Protection-Bypass': bypass, 'X-Vercel-Set-Bypass-Cookie': 'true',
    'content-type': 'application/json', 'x-business-header': 'preserved' } });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'fulfill']);
  const sent = f.calls[0].options;
  assert.equal(sent.maxRedirects, 0); assert.equal(sent.timeout, 20000);
  assert.equal(sent.headers['x-vercel-protection-bypass'], bypass);
  assert.equal(sent.headers['x-vercel-set-bypass-cookie'], undefined);
  assert.equal(sent.headers.authorization, incoming.authorization);
  assert.equal(f.calls[1].options.response, f.response);
  assert.deepEqual(f.calls[1].options.headers, { 'content-type': 'application/json', 'x-business-header': 'preserved' });
});

test('reviewed foreign reads preserve their own auth but never receive the Preview bypass or follow redirects', async () => {
  const f = fixture({ url: `${supabase}/auth/v1/user`, method: 'GET', body: undefined });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'fulfill']);
  assert.equal(f.calls[0].options.maxRedirects, 0);
  assert.equal(f.calls[0].options.headers.authorization, incoming.authorization);
  assert.equal(f.calls[0].options.headers['x-vercel-protection-bypass'], undefined);
  assert.equal(f.calls[0].options.headers['x-vercel-set-bypass-cookie'], undefined);
});

test('Preview and reviewed foreign redirects abort before any redirected request or browser fulfillment', async () => {
  for (const url of [`${origin}/`, `${supabase}/auth/v1/user`]) {
    for (const status of [301, 302, 303, 307, 308]) {
      const f = fixture({ url, method: 'GET', body: undefined, status, responseHeaders: { location: 'https://foreign.example/collect' } });
      assert.equal(await run(f), 1);
      assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'abort']);
      assert.equal(f.forwarded.length, 0);
    }
  }
});

test('wrong response URLs and unsupported response statuses cannot produce normal-role coverage', async () => {
  for (const settings of [{ responseUrl: 'https://foreign.example/collect' }, { responseUrl: `${origin}/other` },
    { status: 0 }, { status: 199 }, { status: 304 }, { status: 600 }, { status: '200' }]) {
    const f = fixture(settings);
    assert.equal(await run(f), 1);
    assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'abort']);
  }
});

test('real HTTP denial/error responses remain observable and are never replaced with successful data', async () => {
  for (const status of [401, 403, 404, 500, 503]) {
    const f = fixture({ status });
    assert.equal(await run(f), 0);
    assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'fulfill']);
    assert.equal(f.calls[1].options.response.status(), status);
  }
});

test('a missing bypass never forwards an incoming credential as a substitute', async () => {
  const f = fixture();
  assert.equal(await run(f, compatibilityNormalRequestAllowed, ''), 0);
  assert.equal(f.calls[0].options.headers['x-vercel-protection-bypass'], undefined);
});

test('both existing read policies still deny API GET/HEAD, mutations, refresh, unknown handlers and foreign hosts before fetch', async () => {
  const denied = [
    { url: `${origin}/api/functions/authContext`, method: 'GET', body: undefined },
    { url: `${origin}/api/functions/authContext`, method: 'HEAD', body: {} },
    { url: `${origin}/api/marketReportDriveSyncCron`, method: 'GET', body: undefined },
    { url: `${origin}/api/functions/hedgeDeskEntity`, method: 'POST', body: { action: 'create' } },
    { url: `${origin}/api/functions/disputeWorkflowApprove`, method: 'POST', body: {} },
    { url: `${origin}/api/functions/unknownHandler`, method: 'POST', body: {} },
    { url: `${supabase}/auth/v1/token?grant_type=refresh_token`, method: 'POST', body: {} },
    { url: 'https://foreign.example/collect', method: 'GET', body: undefined },
  ];
  for (const policy of [compatibilityNormalRequestAllowed, normalRoleRequestAllowed]) {
    for (const request of denied) {
      const f = fixture(request);
      assert.equal(await run(f, policy), ['GET', 'HEAD'].includes(request.method) ? 0 : 1);
      assert.deepEqual(f.calls.map(call => call.kind), ['abort']);
    }
    const f = fixture({ url: `${origin}/api/functions/hedgeDeskEntity`, body: { action: 'snapshot' } });
    assert.equal(await run(f, policy), 0);
    assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'fulfill']);
  }
});

test('credential URL parameters and userinfo are refused without fetching or exposing diagnostics', async () => {
  for (const url of [`${origin}/?X-Vercel-Protection-Bypass=${bypass}`, `${origin}/?x-vercel-set-bypass-cookie=true`,
    `${origin.replace('https://', `https://user:${bypass}@`)}/`]) {
    const f = fixture({ url, method: 'GET', body: undefined });
    assert.equal(await run(f), 1);
    assert.deepEqual(f.calls.map(call => call.kind), ['abort']);
  }
  const f = fixture({ fetchError: `private failure ${bypass} ${incoming.authorization}` });
  assert.equal(await run(f), 1);
  assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'abort']);
});

test('both verifiers use the shared transport and both reviewed control digests include it', () => {
  for (const file of ['runtime-compatibility-normal-role.mjs', 'normal-role-release.mjs']) {
    const source = readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
    assert.match(source, /context\.route\('\*\*\/\*', createNormalRoleVerificationRoute\(/);
    assert.doesNotMatch(source, /route\.continue|extraHTTPHeaders/);
  }
  for (const file of ['runtime-compatibility-release.mjs', 'release-readiness.mjs']) {
    const source = readFileSync(new URL(`../scripts/lib/${file}`, import.meta.url), 'utf8');
    assert.match(source, /'scripts\/lib\/normal-role-verification-transport\.mjs'/);
  }
});


test('native repeated Set-Cookie fields survive fulfillment without parsing or protection leakage', async () => {
  const cookie = 'offline-first=fixture; Secure; HttpOnly\noffline-second=; Max-Age=0';
  const responseHeaders = { 'set-cookie': cookie, 'X-Vercel-Protection-Bypass': bypass, 'X-Vercel-Set-Bypass-Cookie': 'true' };
  const f = fixture({ responseHeaders });
  assert.equal(await run(f), 0);
  assert.deepEqual(f.calls.map(call => call.kind), ['fetch', 'fulfill']);
  assert.deepEqual(f.calls[1].options.headers, { 'set-cookie': cookie });
  assert.equal(responseHeaders['X-Vercel-Protection-Bypass'], bypass);
});
