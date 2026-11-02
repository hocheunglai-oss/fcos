import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { chromium } from '@playwright/test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { createHostedIssuerSubmitObserver, loginHostedFcuno, hostedBrowserLaunchEnvironment } from '../scripts/lib/hosted-release/browser.mjs';
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

test('real isolated Chromium executes the public form handler with all HTTP/OAuth replaced by local routes', async t => {
  const ownedBrowsers = [];
  t.after(async () => { for (const browser of ownedBrowsers) if (browser.isConnected()) await browser.close(); });
  const auth = { user: { email: FCOS_READ_ONLY_CI.email, active: true, read_only_ci: true, user_type: 'viewer' },
    moduleAccess: { dashboard: true, markets: true }, capabilities: { write: false } };
  for (const scenario of ['rejected', 'reset', 'accepted', 'unhandled']) {
    const calls = [], lifecycle = [], unexpected = [];
    let loginSent = false;
    const target = '/api/oidc/authorize?state=PRIVATE_STATE&code_challenge=PRIVATE_PKCE';
    const destination = `${issuer}/admin?returnTo=${encodeURIComponent(target)}`;
    const body = scenario === 'rejected' ? { success: false, message: 'Invalid username or password.' }
      : scenario === 'unknown-challenge' ? { mfaRequired: true, challenge: 'PRIVATE' }
      : { success: true, user: { username: FCOS_READ_ONLY_CI.email, resetRequired: scenario === 'reset' } };
    const script = `let username='',password=''; const activeRef={current:true};
      const setSubmitting=()=>{},setMessage=()=>{},primeAdminClientSessionCache=()=>{};
      const p='https://spc.fcuno.com/api/spc/fcuno-login'; ${contract.deployedReturnToNormalizer};
      const normaliseOidcAuthorizeReturnTo=u;
      ${contract.handler.replace('event: React.FormEvent<HTMLFormElement>', 'event')};
      fetch('/api/admin/session').then(()=>{
        document.body.innerHTML='<form class="fc-admin-login-form"><label>Username<input required autocomplete="username"></label><label>Password<input required type="password" autocomplete="current-password"></label><button type="submit">Login</button></form>';
        const form=document.querySelector('form');const inputs=form.querySelectorAll('input');
        inputs[0].addEventListener('input',e=>{username=e.target.value});
        inputs[1].addEventListener('input',e=>{password=e.target.value});
        ${scenario === 'unhandled' ? '' : "form.addEventListener('submit',handleLogin);"}
      });`;
    assert.doesNotThrow(() => new vm.Script(script));
    const browserType = { launch: async options => {
      // This ephemeral test browser has no user's profile/session and no
      // provider-bound credentials. Every HTTP request is fulfilled or aborted.
      const browser = await chromium.launch({ ...options, env: hostedBrowserLaunchEnvironment({ PATH: process.env.PATH, HOME: process.env.HOME }) });
      ownedBrowsers.push(browser);
      const newContext = browser.newContext.bind(browser), close = browser.close.bind(browser);
      browser.close = async () => { lifecycle.push('browser.close'); await close(); };
      browser.newContext = async contextOptions => {
        const context = await newContext(contextOptions), newPage = context.newPage.bind(context), closeContext = context.close.bind(context);
        await context.setOffline(true); // Route fulfillment works; any escaped request cannot use the network.
        context.close = async () => { lifecycle.push('context.close'); await closeContext(); };
        context.newPage = async () => {
          const page = await newPage(), wait = page.waitForResponse.bind(page);
          page.waitForResponse = (predicate, options) => wait(predicate, { ...options, timeout: 1000 });
          const locator = page.locator.bind(page);
          page.locator = (...args) => {
            const result = locator(...args), waitFor = result.waitFor.bind(result);
            result.waitFor = options => waitFor({ ...options, timeout: 1000 });
            return result;
          };
          return page;
        };
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url()); calls.push(`${req.method()} ${url.origin}${url.pathname}`);
          if (url.origin === origin && url.pathname === '/login' && !url.search)
            return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(destination)})</script>` });
          if (url.origin === issuer && url.pathname === '/admin' && req.method() === 'GET')
            return route.fulfill({ contentType: 'text/html', body: scenario === 'reset' && loginSent
              ? '<section aria-label="Change password"><h1>Change your password</h1></section>'
              : `<div class="fc-admin-loading">Loading...</div><script>${script}</script>` });
          if (url.origin === issuer && url.pathname === '/api/admin/session' && req.method() === 'GET')
            return route.fulfill({ contentType: 'application/json', body: '{"authenticated":false}' });
          if (url.origin === issuer && url.pathname === '/api/admin/login' && req.method() === 'POST') {
            loginSent = true;
            // Only synthetic fixture credentials are inspected here. Runtime
            // observer tests separately forbid all request-body inspection.
            assert.deepEqual(req.postDataJSON(), { username: FCOS_READ_ONLY_CI.email, password: 'PRIVATE_TEST_PASSWORD' });
            return route.fulfill({ status: scenario === 'rejected' ? 401 : 200, contentType: 'application/json', body: JSON.stringify(body) });
          }
          if (url.origin === issuer && url.pathname === '/api/oidc/authorize')
            return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(`${origin}/login?federated=1`)})</script>` });
          if (url.origin === origin && url.pathname === '/login' && url.search === '?federated=1')
            return route.fulfill({ contentType: 'text/html', body: `<script>localStorage.setItem('local-fixture','true');fetch('/api/functions/authContext',{method:'POST'}).then(()=>history.replaceState(null,'','/'));</script>` });
          if (url.origin === origin && url.pathname === '/api/functions/authContext' && req.method() === 'POST')
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(auth) });
          await route.abort();
          if (url.pathname !== '/favicon.ico') unexpected.push(`${req.method()} ${url.origin}${url.pathname}`);
        });
        return context;
      };
      return browser;
    } };
    const run = () => loginHostedFcuno({ origin, credentials: { email: FCOS_READ_ONLY_CI.email, password: 'PRIVATE_TEST_PASSWORD' },
      mode: 'restricted', protectionState: {}, browserType });
    if (scenario === 'accepted') assert.equal((await run()).auth.user.read_only_ci, true);
    else await assert.rejects(run(), error => {
      const diagnostic = safeHostedBrowserDiagnostic(error), d = diagnostic.issuerSubmit;
      assert.equal(d.requestObserved, scenario !== 'unhandled', JSON.stringify({ scenario, diagnostic, calls, unexpected }));
      assert.equal(d.submitEventObserved, true); assert.equal(d.submitHandlerObserved, scenario !== 'unhandled');
      assert.equal(d.formState, 'VALID'); assert.equal(d.continuation, 'OIDC');
      if (scenario === 'reset') {
        assert.ok(d.responseCode === 'PASSWORD_RESET_REQUIRED' || d.formChallenge === 'PASSWORD_RESET_REQUIRED');
        assert.equal(diagnostic.diagnosticCode, 'RUNTIME_LOGIN_PASSWORD_RESET_REQUIRED');
      } else assert.equal(d.responseCode, { rejected: 'CREDENTIALS_REJECTED', unhandled: 'UNOBSERVED' }[scenario]);
      assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE|Invalid username|mfaRequired|"password"/); return true;
    });
    assert.equal(calls.filter(call => call === `POST ${issuer}/api/admin/login`).length, scenario === 'unhandled' ? 0 : 1);
    assert.ok(!calls.some(call => /change-password|logout/.test(call)));
    assert.deepEqual(unexpected, []);
    assert.deepEqual(lifecycle, ['context.close', 'browser.close']);
  }
});
