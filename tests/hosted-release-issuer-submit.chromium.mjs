import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { chromium } from '@playwright/test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { loginHostedFcuno, hostedBrowserLaunchEnvironment } from '../scripts/lib/hosted-release/browser.mjs';
import { safeHostedBrowserDiagnostic } from '../scripts/lib/hosted-release/failure.mjs';

// Explicit local browser fixture; the ordinary unit job needs no browser install.
// Mandatory hosted browser qualification remains separate and unchanged.
const contract = JSON.parse(readFileSync(new URL('./fixtures/hosted-issuer-public-contract.json', import.meta.url)));
const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';

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
