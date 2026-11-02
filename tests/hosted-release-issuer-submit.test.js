import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { createHostedIssuerSubmitObserver, loginHostedFcuno } from '../scripts/lib/hosted-release/browser.mjs';
import { ReleaseError } from '../scripts/lib/hosted-release/json-contract.mjs';
import { safeRuntimeIssuerSubmit, safeDiagnosticFailure, safeHostedBrowserDiagnostic,
  safeHostedBrowserResultFields } from '../scripts/lib/hosted-release/failure.mjs';

const contract = JSON.parse(readFileSync(new URL('./fixtures/hosted-issuer-public-contract.json', import.meta.url)));
const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const request = (url = `${issuer}/api/admin/login`, method = 'POST') => ({ url: () => url, method: () => method,
  postData: () => assert.fail('Never inspect a private submission body') });
const response = (status, body, req = request()) => ({ request: () => req, status: () => status,
  body: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
const accepted = { success: true, user: { username: 'PRIVATE_TEST_USER', resetRequired: false } };

test('exact public form and API contract distinguishes reset and preserves the issuer masking limitation', async () => {
  assert.equal(contract.repositoryCommit, 'a26850dbaabc94db2caef68938041308b5d8838b');
  assert.equal(contract.repositoryEqualsDeployedSourceClaimed, false);
  assert.match(contract.handler, /fetch\("\/api\/admin\/login"/);
  assert.match(contract.handler, /JSON.stringify\(\{ username, password \}\)/);
  assert.match(contract.handler, /data.user\?\.resetRequired !== true/);
  assert.match(contract.credentialLookup, /\.eq\("username", normaliseUsername\(username\)\)/);
  assert.match(contract.credentialFailureMask, /if \(!process.env.SUPABASE_SERVICE_ROLE_KEY\) return null/);
  assert.match(contract.credentialFailureMask, /catch \{\s*return null/);
  assert.doesNotMatch(contract.handler, /mfa|two.factor|otp/i);
  const source = contract.loginRoute.slice(contract.loginRoute.indexOf('export async function POST'))
    .replace('export async function POST(request: Request)', 'async function POST(request)');
  const run = validateAdminCredentials => vm.runInNewContext(`${source}; POST`, {
    validateAdminCredentials, setAdminSession: async () => {}, browserSessionActorKey: () => 'PRIVATE_ACTOR',
    NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, body }) }, Error,
  })({ json: async () => ({ username: 'PRIVATE_TEST_USER', password: 'PRIVATE_TEST_PASSWORD' }) });
  // The actual source maps both explicit credential rejection and the lookup's
  // unavailable/configuration null result to the same response. No reset claim.
  for (const validate of [async () => null, async () => undefined]) {
    const r = await run(validate);
    assert.equal(r.status, 401); assert.equal(r.body.message, 'Invalid username or password.');
  }
  assert.equal((await run(async () => { throw Error('PRIVATE_INTERNAL'); })).status, 500);
});

test('observer accepts only the exact issuer POST, never a query, foreign URL or request body', async () => {
  const observer = createHostedIssuerSubmitObserver({ issuer });
  for (const req of [request(`${issuer}/api/admin/login?token=PRIVATE`), request('https://foreign.invalid/api/admin/login'),
    request(`${issuer}/api/admin/login`, 'GET'), request('https://PRIVATE@fcuno.com/api/admin/login')]) {
    observer.request(req); observer.response(response(401, { success: false, message: 'Invalid username or password.' }, req));
  }
  await observer.drain(); assert.equal(observer.snapshot().requestObserved, false);
  observer.request(request()); observer.response(response(401, { success: false, message: 'Invalid username or password.', token: 'PRIVATE' }));
  await observer.drain(); assert.equal(observer.snapshot().responseCode, 'CREDENTIALS_REJECTED');
  assert.doesNotMatch(JSON.stringify(observer.snapshot()), /PRIVATE|password|token/);
});

test('closed response codes preserve reset, secure-session refusal, unknown challenge and private/internal errors', async () => {
  for (const [status, body, expected, terminal] of [
    [200, { success: true, user: { resetRequired: true } }, 'PASSWORD_RESET_REQUIRED', 'RUNTIME_LOGIN_PASSWORD_RESET_REQUIRED'],
    [200, accepted, 'LOGIN_ACCEPTED', undefined],
    [503, { success: false, message: 'Unable to create a secure admin session. Please try again.' }, 'SESSION_UNAVAILABLE', 'RUNTIME_LOGIN_ISSUER_REFUSED'],
    [401, { success: false, message: 'PRIVATE_UNKNOWN' }, 'HTTP_REFUSED', 'RUNTIME_LOGIN_ISSUER_REFUSED'],
    [200, { mfaRequired: true, privateChallenge: 'PRIVATE' }, 'RESPONSE_UNRECOGNIZED', 'RUNTIME_LOGIN_ISSUER_REFUSED'],
    [200, 'PRIVATE_NON_JSON', 'RESPONSE_UNREADABLE', undefined],
    [200, 'x'.repeat(8193), 'RESPONSE_UNREADABLE', undefined],
  ]) {
    const events = [], o = createHostedIssuerSubmitObserver({ issuer, onTerminal: code => events.push(code) });
    o.response(response(status, body)); await o.drain();
    assert.equal(o.snapshot().responseCode, expected); assert.deepEqual(events, terminal ? [terminal] : []);
    assert.doesNotMatch(JSON.stringify(o.snapshot()), /PRIVATE|"password"|mfaRequired|privateChallenge/i);
  }
  const o = createHostedIssuerSubmitObserver({ issuer });
  o.response({ ...response(500, null), body: () => assert.fail('Never read an arbitrary internal exception') });
  await o.drain(); assert.equal(o.snapshot().responseCode, 'HTTP_REFUSED');
});

function joinedLogin({ status = 401, body = { success: false, message: 'Invalid username or password.' },
  continuation = 'OIDC', transport = false, hydrated = true, valid = true, bootstrap = false, scriptError = false } = {}) {
  const page = new EventEmitter(), form = new EventTarget();
  form.elements = [{ willValidate: true, validity: { valid } }];
  let location, closed = 0, submits = 0, issuerRequests = 0, fills = 0, authWait;
  const frame = { url: () => location };
  const returnTo = '/api/oidc/authorize?state=PRIVATE_STATE&code_challenge=PRIVATE_PKCE';
  const initial = `${issuer}/admin${continuation === 'MISSING' ? '' : `?returnTo=${encodeURIComponent(continuation === 'OIDC' ? returnTo : 'https://foreign.invalid/?ticket=PRIVATE')}`}`;
  const window = { location: {}, confirm: () => assert.fail('No credential/reset action') };
  const move = url => { location = url; const parsed = new URL(url); Object.assign(window.location,
    { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search }); page.emit('framenavigated', frame); };
  window.location.reload = () => {};
  window.location.assign = target => {
    assert.equal(target, returnTo);
    if (!bootstrap) return;
    move(origin);
    const req = request(`${origin}/api/functions/authContext`), auth = { user: { email: FCOS_READ_ONLY_CI.email,
      active: true, read_only_ci: true, user_type: 'viewer' }, moduleAccess: { dashboard: true, markets: true }, capabilities: { write: false } };
    const res = { request: () => req, status: () => 200, json: async () => auth };
    page.emit('request', req); page.emit('response', res); authWait.resolve(res);
  };
  const bubbleListeners = [];
  const sandbox = { window, document: { querySelector: selector => selector === 'form.fc-admin-login-form' ? form : null,
    addEventListener: (event, callback) => { assert.equal(event, 'submit'); bubbleListeners.push(callback); } },
    queueMicrotask, URL, URLSearchParams };
  const normalizer = vm.runInNewContext(`const p='https://spc.fcuno.com/api/spc/fcuno-login'; ${contract.deployedReturnToNormalizer}; u`, { URL });
  // Execute the inspected issuer's actual form handler, removing only its TS
  // parameter annotation. HTTP/OAuth/session persistence are explicit doubles.
  const handle = vm.runInNewContext(`(${contract.handler.replace('event: React.FormEvent<HTMLFormElement>', 'event')})`, {
    window, URLSearchParams, activeRef: { current: true }, username: FCOS_READ_ONLY_CI.email, password: 'PRIVATE_TEST_PASSWORD',
    setSubmitting: () => {}, setMessage: () => {}, primeAdminClientSessionCache: () => {}, normaliseOidcAuthorizeReturnTo: normalizer,
    fetch: async (url, options) => {
      issuerRequests++; assert.equal(url, '/api/admin/login'); assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.equal(options.body, JSON.stringify({ username: FCOS_READ_ONLY_CI.email, password: 'PRIVATE_TEST_PASSWORD' }));
      const req = request(); page.emit('request', req);
      if (transport) { page.emit('requestfailed', req); throw Error('PRIVATE_TRANSPORT'); }
      page.emit('response', response(status, body, req));
      return { ok: status >= 200 && status < 300, json: async () => body };
    },
  });
  page.url = () => location; page.mainFrame = () => frame;
  page.goto = async () => move(initial);
  page.evaluate = async (fn, arg) => vm.runInNewContext(`(${fn.toString()})(argument)`, { ...sandbox, argument: arg });
  page.getByLabel = () => ({ fill: async () => { fills++; } });
  page.getByRole = () => ({ click: async () => {
    submits++; if (scriptError) page.emit('pageerror', Error('PRIVATE_SCRIPT'));
    if (!valid) return;
    const event = new Event('submit', { cancelable: true }); form.dispatchEvent(event);
    const work = hydrated ? handle(event) : undefined;
    for (const callback of bubbleListeners) callback(event);
    await work;
  } });
  page.waitForURL = async predicate => { assert.equal(predicate(new URL(location)), true); };
  page.waitForResponse = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(Error('PRIVATE_TIMEOUT'), { name: 'TimeoutError' })), 30);
    authWait = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: () => { clearTimeout(timer); reject(Error('PRIVATE_CLOSED')); } };
  });
  const context = { newPage: async () => page, storageState: async () => ({ cookies: [], origins: [{ origin, localStorage: [] }] }),
    close: async () => { closed++; authWait?.reject(); } };
  const browserType = { launch: async () => ({ newContext: async () => context, close: async () => { closed++; } }) };
  return { run: () => loginHostedFcuno({ origin, credentials: { email: FCOS_READ_ONLY_CI.email, password: 'PRIVATE_TEST_PASSWORD' },
    mode: 'restricted', protectionState: {}, browserType }),
    counts: () => ({ closed, submits, issuerRequests, fills, listeners: page.eventNames().length }) };
}

test('actual joined login stops on observed issuer refusal/reset/transport with one submit and full cleanup', async () => {
  for (const [options, code, responseCode] of [
    [{}, 'RUNTIME_LOGIN_ISSUER_REFUSED', 'CREDENTIALS_REJECTED'],
    [{ status: 200, body: { success: true, user: { resetRequired: true } } }, 'RUNTIME_LOGIN_PASSWORD_RESET_REQUIRED', 'PASSWORD_RESET_REQUIRED'],
    [{ transport: true }, 'RUNTIME_LOGIN_ISSUER_TRANSPORT', 'UNOBSERVED'],
  ]) {
    const f = joinedLogin(options);
    await assert.rejects(f.run(), error => {
      assert.equal(error.code, code); const d = safeHostedBrowserDiagnostic(error);
      assert.equal(d.issuerSubmit.responseCode, responseCode); assert.equal(d.issuerSubmit.continuation, 'OIDC');
      assert.equal(d.issuerSubmit.submitEventObserved, true); assert.equal(d.issuerSubmit.submitHandlerObserved, true);
      assert.doesNotMatch(JSON.stringify(d), /PRIVATE|password|Invalid username/);
      const envelope = { status: 'failed', errorCode: 'HOSTED_BROWSER_VERIFICATION_FAILED', ...d };
      assert.deepEqual(safeHostedBrowserResultFields(envelope).issuerSubmit, d.issuerSubmit); return true;
    });
    assert.deepEqual(f.counts(), { closed: 2, submits: 1, issuerRequests: 1, fills: 2, listeners: 0 });
  }
});

test('accepted issuer login still needs the real candidate bootstrap and identity checks', async () => {
  const f = joinedLogin({ status: 200, body: accepted, bootstrap: true });
  const r = await f.run(); assert.equal(r.auth.user.read_only_ci, true); assert.equal(r.token, undefined);
  assert.deepEqual(f.counts(), { closed: 2, submits: 1, issuerRequests: 1, fills: 2, listeners: 0 });
  for (const continuation of ['OIDC', 'MISSING', 'REJECTED']) {
    const g = joinedLogin({ status: 200, body: accepted, continuation });
    await assert.rejects(g.run(), error => {
      const d = safeHostedBrowserDiagnostic(error); assert.equal(d.diagnosticCode, 'RUNTIME_LOGIN_RESPONSE_UNOBSERVED');
      assert.equal(d.issuerSubmit.responseCode, 'LOGIN_ACCEPTED'); assert.equal(d.issuerSubmit.continuation, continuation);
      assert.equal(d.runtimeLoginObservation.authContextRequestObserved, false); return true;
    });
    assert.equal(g.counts().issuerRequests, 1); assert.equal(g.counts().closed, 2);
  }
});

test('hydration/unhandled submit, validation and script failures remain observed facts, never credential diagnoses', async () => {
  for (const options of [{ hydrated: false }, { valid: false }, { hydrated: false, scriptError: true }]) {
    const f = joinedLogin(options);
    await assert.rejects(f.run(), error => {
      const d = safeHostedBrowserDiagnostic(error); assert.equal(d.diagnosticCode, 'RUNTIME_LOGIN_RESPONSE_UNOBSERVED');
      assert.equal(d.issuerSubmit.responseCode, 'UNOBSERVED'); assert.equal(d.issuerSubmit.requestObserved, false);
      assert.equal(d.issuerSubmit.formState, options.valid === false ? 'INVALID' : 'VALID');
      assert.equal(d.issuerSubmit.submitEventObserved, options.valid !== false);
      assert.equal(d.issuerSubmit.submitHandlerObserved, options.valid === false ? null : false);
      assert.equal(d.issuerSubmit.scriptErrorObserved, options.scriptError === true); return true;
    });
    assert.equal(f.counts().issuerRequests, 0); assert.equal(f.counts().closed, 2);
  }
});

test('issuer diagnostics reject private extras, inconsistent fields, unknown errors and changing accessors', () => {
  const v = createHostedIssuerSubmitObserver({ issuer }).snapshot();
  for (const patch of [{ token: 'PRIVATE' }, { requestObserved: 'true' }, { httpStatus: 401 }, { responseCode: 'MFA_REQUIRED' },
    { submitHandlerObserved: true }, { continuation: 'https://private.invalid/?token=PRIVATE' },
    { responseObserved: true }, { requestFailed: true }]) assert.equal(safeRuntimeIssuerSubmit({ ...v, ...patch }), undefined);
  let reads = 0; const changing = { ...v, get requestObserved() { return reads++ === 0 ? false : 'PRIVATE'; } };
  assert.deepEqual(safeRuntimeIssuerSubmit(changing), v); assert.equal(reads, 1);
  for (const error of [new Error('PRIVATE'), new ReleaseError('PRIVATE_UNKNOWN', 'runtime.login.submit', 'PRIVATE', { issuerSubmit: v }),
    new ReleaseError('RELEASE_BOUNDARY_FAILED', 'browser.normal', 'PRIVATE', { issuerSubmit: v })])
    assert.equal(safeDiagnosticFailure(error).issuerSubmit, undefined);
  const typed = new ReleaseError('RUNTIME_LOGIN_ISSUER_REFUSED', 'runtime.login.submit', 'PRIVATE', { issuerSubmit: v });
  assert.deepEqual(safeDiagnosticFailure(typed).issuerSubmit, v);
});

test('pending issuer body is bounded and a closed observer cannot publish a later private result', async () => {
  const o = createHostedIssuerSubmitObserver({ issuer });
  o.response({ ...response(200, null), body: async () => new Promise(() => {}) });
  await o.drain(); assert.equal(o.snapshot().responseCode, 'RESPONSE_UNREADABLE');
  const before = o.snapshot(); o.close(); o.request(request()); o.failed(request()); o.pageError();
  o.response(response(401, { message: 'PRIVATE' })); await o.drain(); assert.deepEqual(o.snapshot(), before);
});
