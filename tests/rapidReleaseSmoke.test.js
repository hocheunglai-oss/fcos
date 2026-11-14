import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { APP_MODULES } from '../src/lib/authModules.js';
import { MODULE_READERS, MODULE_SURFACES, moduleReadBody, moduleReaderPayloadVerified } from '../scripts/lib/rapid-release/normal-role-readers.mjs';
import { FCOS_READ_ONLY_CI as ci } from '../config/fcosCiIdentity.js';
import { diagnoseStagedSmoke, runPreBootstrapSmoke, runStagedSmoke, observeLive, stagedBrowserRequestAllowed, TRADING_FX_STAGED_DENIAL_HANDLERS } from '../scripts/lib/rapid-release/smoke.mjs';

const origin = 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app';
const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
const liveOrigin = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin;
const supabase = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const manifest = (selection = {}) => ({
  targets: { repository: fcosConnectionIdentifier('github', 'Repository'), projectId: fcosConnectionIdentifier('vercel', 'Project ID'),
    teamId: fcosConnectionIdentifier('vercel', 'Team ID'), origin: liveOrigin, supabaseProject: fcosConnectionIdentifier('supabase', 'Project ref') },
  candidate: { sha: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) }, build: { buildId: 'build-fixture-1' },
  selection: { modules: ['dashboard', 'markets'], normalRole: false, ...selection },
});
const staged = { id: 'dpl_fixtureOne', target: 'production', sha: 'a'.repeat(40), buildId: 'build-fixture-1', url: origin };
const env = { FCOS_AUTH_E2E_ENABLED: 'true', FCOS_E2E_EMAIL: ci.email, FCOS_E2E_PASSWORD: 'PRIVATE_CI_FIXTURE',
  FCOS_RAPID_NORMAL_EMAIL: 'normal@example.invalid', FCOS_RAPID_NORMAL_PASSWORD: 'PRIVATE_NORMAL_FIXTURE',
  FCOS_NORMAL_ROLE_APPROVED_EMAIL: 'normal@example.invalid', FCOS_HOSTED_NORMAL_EXPECTED_ROLE: 'manager' };
const jsonResponse = (url, body, status = 200) => ({ url, status, ok: status >= 200 && status < 300, redirected: false, json: async () => body });
function publicFetch({ mismatch = false, calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/release-identity')) return jsonResponse(url, { schemaVersion: 1, buildId: mismatch ? 'wrong' : staged.buildId, commit: staged.sha, sourceDigest: 'b'.repeat(64) });
    if (url.endsWith('/app-version.json')) return jsonResponse(url, { buildId: staged.buildId, commit: staged.sha, sourceDigest: 'b'.repeat(64) });
    return jsonResponse(url, { error: 'Sign-in required.', code: 'FCOS_REQUEST_REJECTED' }, 401);
  };
}

const readPayloads = {
  dashboard: { complete: true, financials: [] },
  markets: { complete: true, reportCompleteness: { complete: true }, asOfDate: '2026-11-06', products: ['hsfo380', 'vlsfo', 'lsmgo'].map(productKey => ({ productKey, latestMops: { value: 1 } })) },
  review: { recentStems: [] }, disputes: { rows: [] },
  buyer_invoices: { rows: [], today: '2026-11-06', dueThrough: '2026-12-06', daysAhead: 30 },
  unofficial_compensation: { accounts: [] }, incoming_payments: { rows: [], schemaWarnings: [] }, cashflow_forecast: { rows: [] },
  pnl: { rows: [{ id: 'fixture-stem' }], totals: { count: 1 } }, brokers: { rows: [] },
  buyers_administrator: { accounts: [], users: [] }, master_contracts: { contracts: [] }, special_terms: { terms: [] },
  hedge_desk: { ...Object.fromEntries(['physicals', 'swaps', 'mops', 'clearing', 'counterparties', 'invoices', 'auditLogs'].map(key => [key, []])), capabilities: {}, expiryAutomation: { status: 'not_run', reason: 'deployment_read_only', readOnly: true } },
  email_router: { mailbox: { id: 'fixture-mailbox' }, destinations: [], groups: [] },
  settings: { settings: { revision: 1, annualInterestRatePct: 3, bankChargesUsd: { UBS: 1, DBS: 2 } } },
  admin: { users: [{ id: 'fixture-user' }], modules: [{ id: 'dashboard' }], userTypes: [{ id: 'general_manager' }], typePermissions: {} },
  xero_portal: { xero: { configured: true, connected: true }, externalActions: { xero: { enabled: false } } },
};

// Fixtures replace browser/provider transports. They simulate the app-owned
// bootstrap response and actual response events; they never establish live proof.
function browserFixture({ badIdentity = false, badRead = false, badDenial = false, unexpected = false, missingModule = false, background = false, optionalRequest = null, badPayload = false, badDesktop = false, deniedModule = null, role = 'manager', companyFxRows = undefined, supplierBoundaryRegression = null, groupedBoundaryRegression = false, groupedDesktopMissing = false, tradingFxRouteRegression = false, tradingFxActionVisible = false, existingDraftActionVisible = false, existingDraftRouteRegression = false, marketReadTimeouts = 0, marketResponseStatus = 200, moduleReadTimeouts = {} } = {}) {
  const observations = { launches: [], reads: [], contextsClosed: 0, browsersClosed: 0, nativeAborts: 0 };
  const remainingTimeouts = { ...moduleReadTimeouts };
  const browserFactory = async options => {
    observations.launches.push(options);
    let routeHandler, pausedHandler, websocketHandler, location = 'about:blank', email = '', password = '';
    const responseWaiters = [], urlWaiters = [];
    const changeLocation = value => { location = value; for (const waiter of urlWaiters.splice(0)) { if (waiter.predicate(new URL(location))) waiter.resolve(); else urlWaiters.push(waiter); } };
    const requestOf = (url, method = 'GET', body = {}, type = 'fetch') => ({ url: () => url, method: () => method,
      resourceType: () => type, postData: () => JSON.stringify(body), headers: () => ({ 'content-type': 'application/json' }), frame: () => ({ page: () => page }) });
    const emit = response => { for (const waiter of responseWaiters.splice(0)) { if (waiter.predicate(response)) waiter.resolve(response); else responseWaiters.push(waiter); } };
    const auth = () => email === ci.email ? { user: { email, user_type: 'viewer', active: true, read_only_ci: true },
      moduleAccess: { dashboard: true, markets: true, settings: false }, capabilities: { write: false } } : {
      user: { id: '11111111-1111-4111-8111-111111111111', email, user_type: badIdentity ? 'administrator' : role, active: true, read_only_ci: false },
      moduleAccess: { ...Object.fromEntries(APP_MODULES.map(({ id }) => [id, true])), markets: !missingModule }, capabilities: { write: false },
    };
    const apiResponse = (url, body, status = 200, request = requestOf(url, 'POST')) => ({ url: () => url, status: () => status,
      request: () => request, json: async () => body, finished: async () => null, dispose: async () => {} });
    const simulate = async request => {
      if (pausedHandler) await pausedHandler({ requestId: 'fixture-request', request: { url: request.url(), method: request.method(), postData: request.postData(), headers: request.headers() }, resourceType: request.resourceType() });
      const route = { request: () => request,
        continue: async () => {},
        abort: async () => { throw Object.assign(Error('PRIVATE_REQUEST_DETAIL'), { code: 'FIXTURE_NETWORK_ABORT' }); },
        fulfill: async ({ response }) => emit(response),
        fetch: async (overrides = {}) => {
          const url = overrides.url || request.url();
          observations.reads.push({ url, method: overrides.method || request.method(), body: overrides.postData, timeout: overrides.timeout });
          if (url.endsWith('/authContext')) return apiResponse(url, auth(), 200, request);
          if (url.endsWith('/companyFxHistoryGet')) return apiResponse(url, { canSave: true, rows: companyFxRows });
          if (groupedBoundaryRegression && url.endsWith('/xeroFinancialDocumentPreservationRun')) return apiResponse(url, {});
          if (tradingFxRouteRegression && email !== ci.email && url.endsWith('/xeroNativeDocumentApply')) return apiResponse(url, {});
          if (existingDraftRouteRegression && url.endsWith('/xeroExistingDraftAuthorisationApply')) return apiResponse(url, {});
          const supplierAction = /\/xeroSupplierFinancialBucket(Read|Preview|Apply)$/.exec(url)?.[1];
          if (supplierAction) {
            const restricted = email === ci.email;
            if (supplierBoundaryRegression === (restricted ? 'restricted' : 'normal') + supplierAction) return apiResponse(url, {});
            if (supplierAction === 'Read') return restricted
              ? apiResponse(url, { code: 'FCOS_CI_READ_ONLY' }, 403)
              : apiResponse(url, { code: 'XERO_SUPPLIER_FINANCIAL_WORKFLOW_INVALID' }, 409);
            return apiResponse(url, { code: 'FCOS_DEPLOYMENT_READ_ONLY' }, 403);
          }
          const module = Object.keys(MODULE_READERS).find(key => url.endsWith(MODULE_READERS[key].path));
          if (module && remainingTimeouts[module] > 0) {
            remainingTimeouts[module]--;
            throw Object.assign(Error('PRIVATE_FIXTURE_TIMEOUT'), { name: 'TimeoutError' });
          }
          if (module) return apiResponse(url, badPayload ? {} : readPayloads[module], module === deniedModule ? 403 : 200);
          return apiResponse(url, { code: 'FCOS_DEPLOYMENT_READ_ONLY' }, badDenial ? 200 : 403);
        },
      };
      await routeHandler(route);
    };
    const locator = (role, name) => ({
      first() { return this; },
      getByRole: childRole => {
        if (childRole === 'status' && name === 'Existing draft status authorisation') return {
          filter({ hasText }) {
            assert.match('Draft authorisation is disabled on this deployment.', hasText);
            return { async waitFor({ state }) { assert.equal(state, 'visible'); } };
          },
        };
        return { count: async () => name === 'Existing draft status authorisation'
          ? Number(existingDraftActionVisible) : Number(tradingFxActionVisible) };
      },
      waitFor: async () => {
        if (groupedDesktopMissing && name === 'Preserve verified documents') throw Error('MISSING_PRESERVATION_CONTROL');
      },
      fill: async value => { if (name === 'Username') email = value; if (name === 'Password') password = value; },
      click: async () => {
        if (name === 'Receipts' || name === 'Accounting') return;
        if (name === 'Run') { emit(apiResponse(`${origin}/api/functions/stemPnl`, readPayloads.pnl)); return; }
        if (name === 'Continue with FCUNO') { changeLocation(`${issuer}/admin`); return; }
        assert.equal(name, 'Login');
        assert.ok(password.startsWith('PRIVATE_'));
        if (unexpected) await pausedHandler({ requestId: 'unexpected-redirect', request: { url: 'https://unexpected.invalid/collect', method: 'POST', headers: {}, postData: '{}' }, resourceType: 'fetch' });
        if (optionalRequest) await pausedHandler({ requestId: 'optional-read', request: optionalRequest, resourceType: optionalRequest.type || 'XHR' });
        if (background && email !== ci.email) await pausedHandler({ requestId: 'automatic-mailbox-sync', request: { url: `${origin}/api/email-router-background-sync`, method: 'POST', headers: {}, postData: '{}' }, resourceType: 'fetch' });
        await simulate(requestOf(`${origin}/api/functions/authContext`, 'POST'));
        changeLocation(`${origin}/`);
      },
    });
    const page = {
      url: () => location,
      on: () => {},
      waitForLoadState: async () => {}, waitForFunction: async () => {},
      locator: selector => ({ or() { return this; }, count: async () => badDesktop ? 0 : 1, first() { return this; }, waitFor: async () => { if (badDesktop) throw Error('MISSING_DESKTOP_SURFACE'); }, innerText: async () => badDesktop ? 'Something went wrong' : 'Verified fixture business surface' }),
      getByText: () => ({ first() { return this; }, waitFor: async () => { if (badDesktop) throw Error('MISSING_DESKTOP_SURFACE'); } }),
      getByRole: (role, options) => locator(role, options.name),
      getByLabel: name => locator('label', name),
      waitForURL: predicate => new Promise(resolve => { if (location !== 'about:blank' && predicate(new URL(location))) resolve(); else urlWaiters.push({ predicate, resolve }); }),
      waitForResponse: predicate => new Promise((resolve, reject) => responseWaiters.push({ predicate, resolve, reject })),
      goto: async url => {
        changeLocation(url);
        if (new URL(url).pathname === '/login') return;
        const handler = new URL(url).pathname === '/' ? 'dashboardSummary' : new URL(url).pathname === '/markets' ? 'marketPulseSnapshot' : null;
        if (handler === 'marketPulseSnapshot') {
          observations.marketNavigations = (observations.marketNavigations || 0) + 1;
          if (observations.marketNavigations <= marketReadTimeouts) {
            responseWaiters.shift().reject(Object.assign(new Error('PRIVATE_FIXTURE_TIMEOUT'), { name: 'TimeoutError' }));
            return;
          }
        }
        if (handler) emit(apiResponse(`${origin}/api/functions/${handler}`, badPayload ? {} : handler === 'dashboardSummary'
          ? { complete: true, financials: [] }
          : { complete: true, reportCompleteness: { complete: true }, asOfDate: '2026-11-06', products: ['hsfo380', 'vlsfo', 'lsmgo'].map(productKey => ({ productKey, latestMops: { value: 1 } })) }, badRead ? 503 : handler === 'marketPulseSnapshot' ? marketResponseStatus : 200));
      },
    };
    const context = {
      route: async (_pattern, handler) => { routeHandler = handler; },
      routeWebSocket: async (_pattern, handler) => { websocketHandler = handler; assert.equal(typeof websocketHandler, 'function'); },
      newPage: async () => page,
      newCDPSession: async () => ({ on: (_name, handler) => { pausedHandler = handler; }, send: async command => { if (command === 'Fetch.failRequest') observations.nativeAborts++; } }),
      storageState: async () => ({ cookies: [], origins: [{ origin, localStorage: [{ name: 'opaque-fixture', value: 'opaque-fixture-state' }] }] }),
      close: async () => { observations.contextsClosed++; },
    };
    return { newContext: async config => { assert.equal(config.serviceWorkers, 'block'); return context; }, close: async () => { observations.browsersClosed++; } };
  };
  return { browserFactory, observations };
}
const request = (url, method = 'GET', body = {}, type = 'fetch', headers = {}) => ({ url: () => url, method: () => method, postData: () => JSON.stringify(body), resourceType: () => type, headers: () => headers });

test('controller handover verifies normal-role access with no application changes', async () => {
  const fixture = browserFixture();
  const proof = await runStagedSmoke({ manifest: manifest({ modules: [] }), staged, env,
    fetchImpl: publicFetch(), browserFactory: fixture.browserFactory, requireNormalRole: true });
  assert.equal(proof.normalRole, true);
  assert.deepEqual(proof.normalRoleEvidence.modules, ['dashboard', 'markets']);
  assert.equal(proof.businessWrites, 0);
  await assert.rejects(runStagedSmoke({ manifest: manifest({ modules: [] }), staged,
    env: { ...env, FCOS_RAPID_NORMAL_PASSWORD: '' }, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory,
    requireNormalRole: true }), { code: 'NORMAL_ROLE_COVERAGE_MISSING' });
});

test('restricted smoke proves actual browser reads and API/UI denials without widening CI coverage', async () => {
  const fixture = browserFixture(), calls = [];
  const proof = await runStagedSmoke({ manifest: manifest(), staged, env: { ...env, VERCEL_TOKEN: 'PRIVATE_ADMIN_TOKEN' }, fetchImpl: publicFetch({ calls }), browserFactory: fixture.browserFactory });
  assert.equal(proof.passed, true);
  assert.equal(proof.businessWrites, 0);
  assert.equal(proof.login, true);
  assert.equal(proof.restrictedAccess, true);
  assert.deepEqual(proof.modules, ['dashboard', 'markets']);
  assert.equal(proof.normalRole, undefined);
  assert.equal(proof.restrictedEvidence.denialReceipts.length, 14);
  assert.equal(fixture.observations.contextsClosed, 1);
  assert.equal(fixture.observations.browsersClosed, 1);
  assert.equal(fixture.observations.launches[0].env.VERCEL_TOKEN, undefined);
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(proof).includes('PRIVATE_'), false);
});

test('Markets retries one missing read on the same pinned read-only page', async () => {
  const fixture = browserFixture({ marketReadTimeouts: 1 });
  const proof = await runStagedSmoke({ manifest: manifest(), staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory });
  assert.deepEqual(proof.modules, ['dashboard', 'markets']);
  assert.equal(proof.businessWrites, 0);
  assert.equal(fixture.observations.marketNavigations, 2);
  assert.equal(fixture.observations.contextsClosed, 1);
});

test('Markets fails after two read timeouts and does not retry an HTTP rejection', async () => {
  for (const [options, code, navigations] of [
    [{ marketReadTimeouts: 2 }, 'SMOKE_BASELINE_RESPONSE_TIMEOUT', 2],
    [{ marketResponseStatus: 503 }, 'SMOKE_MODULE_READ_FAILED', 1],
  ]) {
    const fixture = browserFixture(options);
    await assert.rejects(runStagedSmoke({ manifest: manifest(), staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory }),
      { code, smokeModule: 'markets', smokeSurface: 'read' });
    assert.equal(fixture.observations.marketNavigations, navigations);
    assert.equal(fixture.observations.contextsClosed, 1);
  }
});

test('normal-role proof requires a fresh real identity response and selected authenticated read receipts', async () => {
  const fixture = browserFixture({ background: true });
  const proof = await runStagedSmoke({ manifest: manifest({ normalRole: true, modules: ['settings'] }), staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory });
  assert.equal(proof.normalRole, true);
  assert.equal(proof.normalRoleEvidence.role, 'manager');
  assert.equal(proof.normalRoleEvidence.excludedBackgroundSync, 1);
  assert.ok(proof.normalRoleEvidence.excludedFeatures.includes('automatic_mailbox_sync'));
  assert.deepEqual(proof.normalRoleEvidence.modules, ['dashboard', 'markets', 'settings']);
  assert.deepEqual(proof.normalRoleEvidence.reads.find(read => read.module === 'settings'), { module: 'settings', path: '/api/functions/financeSettingsGet', status: 200, authenticated: true, dataVerified: true, surface: 'authenticated_read_api', coverage: 'finance_configuration_read' });
  assert.equal(proof.normalRoleEvidence.denialReceipts[0].code, 'FCOS_DEPLOYMENT_READ_ONLY');
  assert.equal(proof.normalRoleEvidence.desktopChecks[0].module, 'settings');
  assert.equal(fixture.observations.launches.length, 2);
  assert.equal(fixture.observations.contextsClosed, 2);
  assert.deepEqual(proof.restrictedEvidence.modules, ['dashboard', 'markets']);
});

test('pre-bootstrap smoke runs the guarded browser for every non-deferred module', async () => {
  const fingerprint = 'c'.repeat(64);
  const candidate = { ...manifest({ salesforce: true, normalRole: true, modules: ['dashboard', 'markets', 'settings', 'hedge_desk'] }),
    prerequisites: { plan: { deferSchemaDependentSmoke: true, bootstrapFingerprint: fingerprint, deferredModules: ['hedge_desk'] } } };
  const fixture = browserFixture({ deniedModule: 'hedge_desk' });
  const options = { manifest: candidate, staged, env: { ...env, FCOS_RAPID_NORMAL_REQUIRED_MODULES: 'hedge_desk' },
    fetchImpl: publicFetch(), browserFactory: fixture.browserFactory };
  await assert.rejects(runPreBootstrapSmoke(options, 'd'.repeat(64)), { code: 'PREBOOTSTRAP_STAGE_PROOF_REQUIRED' });
  assert.equal(fixture.observations.launches.length, 0);
  const proof = await runPreBootstrapSmoke(options, fingerprint);
  assert.equal(proof.mode, 'pre_bootstrap');
  assert.equal(proof.businessWrites, 0);
  assert.deepEqual(proof.completedModules, ['dashboard', 'markets', 'settings']);
  assert.deepEqual(proof.deferredChecks, ['hedge_desk']);
  assert.equal(fixture.observations.contextsClosed, 2);
  await assert.rejects(runStagedSmoke(options));
});

test('missing normal-role credentials and unknown readers fail before any credential-bearing browser starts', async () => {
  let calls = 0;
  const noCalls = async () => { calls++; throw Error('must not start'); };
  for (const [candidate, variables, code] of [
    [manifest({ normalRole: true }), { ...env, FCOS_RAPID_NORMAL_PASSWORD: '' }, 'NORMAL_ROLE_COVERAGE_MISSING'],
    [manifest({ normalRole: true, modules: ['unreviewed_module'] }), env, 'MODULE_SAFE_READER_COVERAGE_MISSING'],
    [manifest({ normalRole: false, modules: ['settings'] }), env, 'NORMAL_ROLE_COVERAGE_MISSING'],
  ]) await assert.rejects(runStagedSmoke({ manifest: candidate, staged, env: variables, fetchImpl: noCalls, browserFactory: noCalls }), { code });
  assert.equal(calls, 0);
});

test('wrong normal role, missing module access, failed reads and failed API denials never produce passing proof', async () => {
  for (const patch of [{ badIdentity: true }, { missingModule: true }, { badRead: true }, { badPayload: true }, { badDenial: true }, { unexpected: true }]) {
    const fixture = browserFixture(patch);
    await assert.rejects(runStagedSmoke({ manifest: manifest({ normalRole: true }), staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory }));
    assert.equal(fixture.observations.contextsClosed, fixture.observations.launches.length);
    assert.equal(fixture.observations.browsersClosed, fixture.observations.launches.length);
    if (patch.unexpected) assert.equal(fixture.observations.nativeAborts, 1);
  }
});

test('target and embedded identity mismatches fail before authentication without echoing secrets', async () => {
  const fixture = browserFixture();
  await assert.rejects(runStagedSmoke({ manifest: manifest(), staged: { ...staged, url: liveOrigin }, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory }), /immutable/);
  await assert.rejects(runStagedSmoke({ manifest: manifest(), staged, env, fetchImpl: publicFetch({ mismatch: true }), browserFactory: fixture.browserFactory }), { code: 'SMOKE_RUNTIME_IDENTITY_MISMATCH' });
  await assert.rejects(runStagedSmoke({ manifest: manifest(), staged, env, fetchImpl: async () => { throw Error('PRIVATE_CREDENTIAL'); }, browserFactory: fixture.browserFactory }), error => !error.message.includes('PRIVATE_CREDENTIAL'));
  assert.equal(fixture.observations.launches.length, 0);
});

test('browser policy admits only pinned login and reviewed reads, blocking provider writes, refresh, unknown RPC and business controls', () => {
  const policy = { origin, credentials: { email: ci.email, password: 'fixture' } };
  for (const req of [request(`${supabase}/auth/v1/user`), request(`${issuer}/api/admin/session`),
    request(`${issuer}/api/admin/login`, 'POST', { username: ci.email, password: 'fixture' }),
    request(`${origin}/api/functions/authContext`, 'POST'),
    request(`${origin}/api/work-notifications`, 'POST', { limit: 40, state: 'active', source: 'all' }, 'fetch', { 'x-fcos-function-name': 'workNotificationsList' }), request(`${origin}/api/functions/hedgeMarkets`, 'POST', { action: 'snapshot' })]) {
    assert.equal(stagedBrowserRequestAllowed(req, policy), true, req.url());
  }
  for (const req of [request(`${supabase}/auth/v1/token?grant_type=refresh_token`, 'POST'),
    request(`${supabase}/rest/v1/user_profiles`, 'POST'), request(`${supabase}/rest/v1/rpc/fcos_effective_access`, 'POST'),
    request(`${supabase}/storage/v1/object/bucket/file`, 'PUT'), request(`${issuer}/api/admin/password-reset`, 'POST'),
    request(`${issuer}/api/admin/login`, 'POST', { username: ci.email, password: 'different' }),
    request(`${origin}/api/functions/futureRead`, 'POST'), request(`${origin}/api/functions/dashboardSummary`, 'POST', { sync: true }),
    request(`${origin}/api/functions/hedgeMarkets`, 'POST', { action: 'save_spreads' }), request(`${liveOrigin}/api/functions/authContext`, 'POST'),
    request('https://unexpected.invalid/collect', 'POST')]) {
    assert.equal(stagedBrowserRequestAllowed(req, policy), false, req.url());
  }
});

test('staged version polling permits only the observed cache-busting GET', () => {
  const policy = { origin, credentials: { email: ci.email, password: 'fixture' } };
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/app-version.json?t=1794025900000`), policy), true);
  for (const [query, method] of [['t=1794025900000&extra=1', 'GET'], ['t=abc', 'GET'], ['t=1794025900000', 'POST']]) {
    assert.equal(stagedBrowserRequestAllowed(request(`${origin}/app-version.json?${query}`, method), policy), false);
  }
});

test('issuer prefetch is blocked and reported, while a lookalike write fails the smoke', async () => {
  const optionalRequest = { url: `${issuer}/admin?_rsc=ab123`, method: 'GET', headers: {} };
  const fixture = browserFixture({ optionalRequest });
  const proof = await runStagedSmoke({ manifest: manifest(), staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory });
  assert.ok(proof.restrictedEvidence.excludedFeatures.includes('issuer_prefetch'));
  assert.equal(fixture.observations.nativeAborts, 1);
  const unsafe = browserFixture({ optionalRequest: { ...optionalRequest, method: 'POST' } });
  await assert.rejects(runStagedSmoke({ manifest: manifest(), staged, env, fetchImpl: publicFetch(), browserFactory: unsafe.browserFactory }),
    { code: 'SMOKE_BROWSER_NETWORK_OR_RUNTIME_FAILURE' });
});

test('the deployed issuer image optimization request is excluded without reaching the network', async () => {
  const optionalRequest = { url: `${issuer}/_next/image?url=%2Flogo.png&w=128&q=75&dpl=fixture`, method: 'GET', type: 'Image', headers: {} };
  const fixture = browserFixture({ optionalRequest });
  const proof = await runStagedSmoke({ manifest: manifest(), staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory });
  assert.ok(proof.restrictedEvidence.excludedFeatures.includes('issuer_images'));
  assert.equal(fixture.observations.nativeAborts, 1);
});

test('incoming payment verification distinguishes the sign advisory from missing schema', () => {
  const advisory = 'Supplier-invoice-linked negative payments are classified as supplier refunds. Confirm if Salesforce uses the opposite sign.';
  assert.equal(moduleReaderPayloadVerified('incoming_payments', { rows: [], schemaWarnings: [advisory] }), true);
  assert.equal(moduleReaderPayloadVerified('incoming_payments', {
    rows: [], schemaWarnings: [advisory, 'No amount-like field was found on Payment__c.'],
  }), false);
  assert.equal(moduleReaderPayloadVerified('incoming_payments', { schemaWarnings: [advisory] }), false);
  assert.equal(moduleReaderPayloadVerified('brokers', { rows: [], schemaWarnings: [advisory] }), false);
});

test('Xero status accepts the staged refresh refusal only when every action is disabled by the stage fence', () => {
  const xero = { configured: true, connected: true, refreshError: 'This verification environment permits read-only operations.' };
  const gate = { enabled: false, control: 'deployment_read_only' };
  const verified = (status, action) => moduleReaderPayloadVerified('xero_portal', {
    xero: status, externalActions: { action },
  });
  assert.equal(verified(xero, gate), true);
  assert.equal(verified({ ...xero, refreshError: 'Unexpected token failure' }, gate), false);
  assert.equal(verified(xero, { ...gate, enabled: true }), false);
  assert.equal(verified(xero, { ...gate, control: 'emergency_kill_switch' }), false);
});

test('five-minute live observation checks native-bound receipt, static identity and anonymous affected read gates only', async () => {
  let time = 0; const sleeps = [], calls = [];
  const proof = await observeLive({ manifest: manifest({ modules: ['settings'] }), staged, durationMs: 300000, fetchImpl: publicFetch({ calls }), now: () => time,
    sleep: async ms => { sleeps.push(ms); time += ms; } });
  assert.equal(proof.passed, true);
  assert.equal(proof.observationMs, 300000);
  assert.equal(proof.samples, 11);
  assert.equal(proof.authenticatedDataCoverage, false);
  assert.equal(proof.protectionBypassUsed, false);
  assert.deepEqual(proof.readProbes.map(probe => probe.module), ['dashboard', 'markets', 'settings']);
  assert.ok(sleeps.every(ms => ms <= 30000));
  assert.ok(calls.every(call => call.url.startsWith(liveOrigin) && call.options.method === 'GET' && call.options.credentials === 'omit' && !call.options.headers.authorization && !call.options.headers['x-vercel-protection-bypass']));
});

test('live observation rejects shortened windows, identity drift, auth bypass and nonadvancing clocks', async () => {
  await assert.rejects(observeLive({ manifest: manifest(), staged, durationMs: 299999 }), { code: 'LIVE_OBSERVATION_DURATION_INVALID' });
  await assert.rejects(observeLive({ manifest: manifest(), staged, fetchImpl: publicFetch({ mismatch: true }) }), { code: 'SMOKE_RUNTIME_IDENTITY_MISMATCH' });
  await assert.rejects(observeLive({ manifest: manifest(), staged, fetchImpl: async (url, options) => url.includes('/api/functions/') ? jsonResponse(url, {}, 200) : publicFetch()(url, options), now: () => 0, sleep: async () => {} }), { code: 'SMOKE_BOUND_READ_FAILED' });
  await assert.rejects(observeLive({ manifest: manifest(), staged, fetchImpl: publicFetch(), now: () => 0, sleep: async () => {} }), { code: 'LIVE_OBSERVATION_CLOCK_NOT_ADVANCING' });
});

test('trusted smoke uses opaque private state and every-hop interception without token extraction or tracing', async () => {
  const source = await readFile(new URL('../scripts/lib/rapid-release/smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /candidateAuthenticationState/);
  assert.match(source, /writePrivateE2eState/);
  assert.match(source, /removePrivateE2eState/);
  assert.match(source, /Fetch\.requestPaused/);
  assert.match(source, /routeWebSocket/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|access_token|\.tracing|\.screenshot|recordVideo|console\./);
});

test('all maintained modules require actual read contracts and affected desktop surfaces with approved GM identity', async () => {
  const modules = APP_MODULES.map(({ id }) => id), fixture = browserFixture({ role: 'general_manager' });
  const proof = await runStagedSmoke({ manifest: manifest({ normalRole: true, modules }), staged,
    env: { ...env, FCOS_HOSTED_NORMAL_EXPECTED_ROLE: 'general_manager' }, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory });
  assert.deepEqual(proof.normalRoleEvidence.requiredModules, [...modules].sort());
  assert.deepEqual(proof.normalRoleEvidence.modules, [...modules].sort());
  assert.equal(proof.normalRoleEvidence.desktopChecks.length, modules.length - 2);
  for (const { module, businessSurface, rendered } of proof.normalRoleEvidence.desktopChecks) {
    assert.ok(MODULE_SURFACES[module]); assert.equal(businessSurface, true); assert.equal(rendered, true);
  }
  const hedge = fixture.observations.reads.find(read => read.url.endsWith('/hedgeDeskEntity'));
  assert.deepEqual(JSON.parse(hedge.body), { action: 'snapshot' });
  const pnl = fixture.observations.reads.find(read => read.url.endsWith('/stemPnl'));
  assert.equal(JSON.parse(pnl.body).limit, 1);
  assert.equal(proof.normalRoleEvidence.reads.find(read => read.module === 'hedge_desk').coverage, 'book_snapshot_read');
  assert.equal(JSON.stringify(proof).includes('fixture-stem'), false);
});

test('denied module reads, heading-only pages, unsafe snapshots and partial data never prove coverage', async () => {
  for (const options of [{ badDesktop: true }, { deniedModule: 'settings' }]) {
    const fixture = browserFixture(options);
    const run = runStagedSmoke({ manifest: manifest({ normalRole: true, modules: [options.badDesktop ? 'brokers' : 'settings'] }), staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory });
    if (options.badDesktop) await assert.rejects(run, { code: 'SMOKE_MODULE_DESKTOP_CONTENT_MISSING' });
    else await assert.rejects(run);
    assert.equal(fixture.observations.contextsClosed, fixture.observations.launches.length);
  }
  const hedge = structuredClone(readPayloads.hedge_desk); delete hedge.expiryAutomation;
  assert.equal(moduleReaderPayloadVerified('hedge_desk', hedge), false);
  assert.equal(moduleReaderPayloadVerified('incoming_payments', { rows: [], schemaWarnings: ['not queryable'] }), false);
  assert.equal(moduleReaderPayloadVerified('pnl', { rows: [], totals: { count: 1 } }), false);
  let calls = 0; const noCall = async () => { calls++; };
  await assert.rejects(runStagedSmoke({ manifest: manifest({ normalRole: true, modules: ['admin'] }), staged, env, fetchImpl: noCall, browserFactory: noCall }), { code: 'NORMAL_ROLE_ADMIN_REQUIRES_APPROVED_GM' });
  await assert.rejects(runStagedSmoke({ manifest: manifest({ normalRole: true, modules: ['future_module'] }), staged, env, fetchImpl: noCall, browserFactory: noCall }), error => error.code === 'MODULE_SAFE_READER_COVERAGE_MISSING' && error.missingModules.includes('future_module'));
  assert.equal(calls, 0);
});

test('normal-only snapshot and saved Xero reads keep all mutation selectors and direct provider routes denied', () => {
  const normal = { origin, credentials: { email: env.FCOS_RAPID_NORMAL_EMAIL, password: 'fixture' }, normal: true };
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/hedgeDeskEntity`, 'POST', { action: 'snapshot' }), normal), true);
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/hedgeDeskEntity`, 'POST', { action: 'snapshot' }), { ...normal, normal: false }), false);
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/hedgeDeskEntity`, 'POST',
    { action: 'list', entity: 'AppConfig', sort: '-created_date', limit: 1000 }), normal), true);
  for (const body of [{ action: 'list', entity: 'PhysicalTrade' }, { action: 'snapshot', force: false }, { action: 'snapshot', entity: 'Invoice' }, { action: 'save' }])
    assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/hedgeDeskEntity`, 'POST', body), normal), false);
  const detail = { contractId: '26de2e57-7d65-49ed-a91f-ed97d9ba169a', includeLive: true, force: false };
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/masterContractDetail`, 'POST', detail), normal), true);
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/masterContractDetail`, 'POST', { ...detail, force: true }), normal), false);
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/xeroFinancialSyncLatest`, 'POST', {}), normal), true);
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/xeroFinancialMappingsGet`, 'POST', {}), normal), false);
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/xeroPortalStatus`, 'POST', { forceRefresh: false }), normal), true);
  assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/xeroPortalStatus`, 'POST', { forceRefresh: true }), normal), false);
  for (const handler of ['xeroPortalContactLifecyclePreview', 'xeroPortalReceiptSync', 'paymentCollectionsReconcile', 'workspacePreferencesSave'])
    assert.equal(stagedBrowserRequestAllowed(request(`${origin}/api/functions/${handler}`, 'POST'), normal), false);
  for (const url of [`${supabase}/rest/v1/rpc/unreviewed_read`, `${supabase}/storage/v1/object/sign/private`, 'https://api.xero.com/api.xro/2.0/Invoices'])
    assert.equal(stagedBrowserRequestAllowed(request(url, 'POST'), normal), false);
});

test('reviewed registry has genuine response contracts and deterministic bounded read bodies for every maintained ID', () => {
  assert.deepEqual(Object.keys(MODULE_READERS).sort(), APP_MODULES.map(({ id }) => id).sort());
  for (const module of Object.keys(MODULE_READERS)) {
    assert.equal(moduleReaderPayloadVerified(module, readPayloads[module]), true, module);
    for (const data of [{}, { error: 'denied' }, { status: 'unavailable' }, { complete: false }, null])
      assert.equal(moduleReaderPayloadVerified(module, data), false, `${module}: invalid response`);
  }
  const m = { createdAt: '2026-11-06T00:00:00.000Z' };
  assert.deepEqual(moduleReadBody('pnl', m), { dateWindows: [{ startDate: '2026-10-07', endDate: '2026-11-06' }], limit: 1 });
  assert.deepEqual(moduleReadBody('incoming_payments', m), { dateFrom: '2026-11-06', dateTo: '2026-11-06', limit: 100 });
  assert.deepEqual(moduleReadBody('hedge_desk', m), { action: 'snapshot' });
});

test('candidate-declared module paths must match source-reviewed desktop routes before any credentialed browser', async () => {
  const candidate = manifest({ normalRole: true, modules: ['settings'] });
  candidate.moduleInventory = APP_MODULES.map(({ id, path }) => ({ id, path }));
  const fixture = browserFixture();
  await runStagedSmoke({ manifest: candidate, staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory });
  let calls = 0; const noCall = async () => { calls++; throw Error('must not start'); };
  for (const inventory of [candidate.moduleInventory.map(entry => entry.id === 'settings' ? { ...entry, path: '/new-settings' } : entry),
    candidate.moduleInventory.filter(entry => entry.id !== 'settings'), [...candidate.moduleInventory, candidate.moduleInventory[0]]]) {
    await assert.rejects(runStagedSmoke({ manifest: { ...candidate, moduleInventory: inventory }, staged, env, fetchImpl: noCall, browserFactory: noCall }), { code: 'SMOKE_MODULE_PATH_BINDING_MISMATCH' });
  }
  assert.equal(calls, 0);
});

test('diagnostic records subsequent module outcomes after a denied read without granting release proof', async () => {
  const { browserFactory, observations } = browserFixture({ deniedModule: 'review' });
  const report = await diagnoseStagedSmoke({
    manifest: manifest({ modules: ['review', 'settings'], normalRole: true }),
    staged, env, fetchImpl: publicFetch(), browserFactory,
  });
  assert.equal(report.passed, false);
  assert.deepEqual(report.outcomes.map(({ module, surface, passed }) => [module, surface, passed]), [
    ['review', 'read', false], ['settings', 'read', true],
    ['review', 'desktop', true], ['settings', 'desktop', true],
  ]);
  assert.equal(observations.contextsClosed, 2);
});

test('native smoke identifies the reviewed module and surface that failed', async () => {
  const { browserFactory, observations } = browserFixture({ deniedModule: 'review' });
  await assert.rejects(runStagedSmoke({
    manifest: manifest({ modules: ['review', 'settings'], normalRole: true }),
    staged, env, fetchImpl: publicFetch(), browserFactory,
  }), { code: 'SMOKE_AUTHENTICATED_READ_FAILED', smokeModule: 'review', smokeSurface: 'read' });
  assert.equal(observations.contextsClosed, 2);
});

test('Cashflow Forecast replays only a fetch timeout and retains the same authenticated read', async () => {
  const run = (module, fixture) => runStagedSmoke({
    manifest: manifest({ modules: [module], normalRole: true }),
    staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory,
  });
  const reads = (module, fixture) => fixture.observations.reads.filter(item => item.url.endsWith(MODULE_READERS[module].path));
  const transient = browserFixture({ moduleReadTimeouts: { cashflow_forecast: 1 } });
  const proof = await run('cashflow_forecast', transient);
  const attempts = reads('cashflow_forecast', transient);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(attempts[0].timeout, 45000);
  assert.equal(proof.normalRoleEvidence.reads.find(item => item.module === 'cashflow_forecast').transportRetries, 1);
  assert.equal(proof.businessWrites, 0);
  for (const [module, options, count] of [
    ['cashflow_forecast', { moduleReadTimeouts: { cashflow_forecast: 2 } }, 2],
    ['cashflow_forecast', { deniedModule: 'cashflow_forecast' }, 1],
    ['review', { moduleReadTimeouts: { review: 1 } }, 1],
  ]) {
    const fixture = browserFixture(options);
    await assert.rejects(run(module, fixture), { code: 'SMOKE_AUTHENTICATED_READ_FAILED', smokeModule: module, smokeSurface: 'read' });
    assert.equal(reads(module, fixture).length, count);
    assert.ok(reads(module, fixture).every(read => read.timeout === (module === 'cashflow_forecast' ? 45000 : 20000)));
  }
});


test('Company FX history smoke runs only after its prerequisite and verifies seeded read and write denial', async () => {
  const candidate = { ...manifest({ normalRole: true, modules: ['incoming_payments'] }),
    prerequisites: { adapter: 'company-fx-history', plan: { historySmoke: true } } };
  const variables = { ...env, FCOS_HOSTED_NORMAL_EXPECTED_ROLE: 'general_manager' };
  const seeded = [{ rateId: 'synthetic-rate', revision: 4, effectiveAt: '2026-11-10T00:00:00Z', usdHkdRate: 7.84, reason: 'PRIVATE_FIXTURE_REASON' }];
  const fixture = browserFixture({ role: 'general_manager', companyFxRows: seeded });
  const options = { manifest: candidate, staged, env: variables, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory };
  const before = await runStagedSmoke(options);
  assert.equal(before.companyFxHistory, undefined);
  assert.equal(fixture.observations.reads.filter(row => row.url.includes('/companyFxHistory')).length, 0);
  const after = await runStagedSmoke({ ...options, afterPrerequisites: true });
  assert.deepEqual(after.companyFxHistory, { readVerified: true, writeDenied: true });
  assert.equal(JSON.stringify(after).includes('PRIVATE_FIXTURE_REASON'), false);
  assert.deepEqual(fixture.observations.reads.filter(row => row.url.includes('/companyFxHistory'))
    .map(row => [new URL(row.url).pathname, row.body]), [
    ['/api/functions/companyFxHistoryGet', '{}'], ['/api/functions/companyFxHistorySave', '{}'],
  ]);
  const incomplete = browserFixture({ role: 'general_manager', companyFxRows: [] });
  await assert.rejects(runStagedSmoke({ ...options, afterPrerequisites: true, browserFactory: incomplete.browserFactory }),
    { code: 'SMOKE_COMPANY_FX_HISTORY_READ_FAILED' });
});

test('supplier bucket smoke covers both identities with empty bodies before and after prerequisites', async () => {
  const candidate = { ...manifest({ normalRole: true, modules: ['xero_portal'] }),
    prerequisites: { adapter: 'supplier-bucket-migrations' } };
  const fixture = browserFixture();
  const options = { manifest: candidate, staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory };
  for (const afterPrerequisites of [false, true]) {
    const result = await runStagedSmoke({ ...options, afterPrerequisites });
    assert.deepEqual(result.supplierBucket, { restrictedVerified: true, normalVerified: true });
    assert.equal(result.businessWrites, 0);
  }
  const requests = fixture.observations.reads.filter(row => row.url.includes('/xeroSupplierFinancialBucket'));
  assert.equal(requests.length, 12);
  assert.ok(requests.every(({ body, method }) => body === '{}' && method === 'POST'));
  for (const supplierBoundaryRegression of ['restrictedRead', 'normalRead', 'normalApply', 'normalPreview']) {
    await assert.rejects(runStagedSmoke({ ...options, browserFactory: browserFixture({ supplierBoundaryRegression }).browserFactory }),
      { code: 'SMOKE_SUPPLIER_BUCKET_ROUTE_BOUNDARY_FAILED' });
  }
  await assert.rejects(runStagedSmoke({ ...options, manifest: { ...candidate, selection: { ...candidate.selection, normalRole: false,
    modules: ['dashboard'] } } }), { code: 'SMOKE_SUPPLIER_BUCKET_NORMAL_ROLE_REQUIRED' });
});

test('grouped petroleum requires both staged write denials and the desktop preservation control', async () => {
  const candidate = { ...manifest({ normalRole: true, modules: ['xero_portal'] }),
    prerequisites: { adapter: 'grouped-petroleum-migration' } };
  const fixture = browserFixture();
  const options = { manifest: candidate, staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory };
  for (const afterPrerequisites of [false, true]) {
    const result = await runStagedSmoke({ ...options, afterPrerequisites });
    assert.deepEqual(result.groupedPetroleum, { restrictedVerified: true, normalVerified: true, desktopVerified: true });
    assert.equal(result.businessWrites, 0);
  }
  const calls = fixture.observations.reads.filter(row => row.url.includes('/xeroFinancialDocumentPreservation'));
  assert.equal(calls.length, 8);
  assert.ok(calls.every(({ body, method }) => body === '{}' && method === 'POST'));
  await assert.rejects(runStagedSmoke({ ...options, browserFactory: browserFixture({ groupedBoundaryRegression: true }).browserFactory }),
    { code: 'SMOKE_GROUPED_PETROLEUM_WRITE_NOT_DENIED' });
  await assert.rejects(runStagedSmoke({ ...options, browserFactory: browserFixture({ groupedDesktopMissing: true }).browserFactory }),
    { code: 'SMOKE_GROUPED_PETROLEUM_DESKTOP_MISSING' });
});

test('Trading FX verifies fixed Finance route denials and the inactive desktop panel before and after prerequisites', async () => {
  const bootstrapFingerprint = 'c'.repeat(64);
  const candidate = { ...manifest({ normalRole: true, modules: ['xero_portal', 'buyer_invoices'], database: true, salesforce: true }),
    prerequisites: { adapter: 'trading-fx-prerequisites', plan: {
      deferSchemaDependentSmoke: true, deferredModules: ['buyer_invoices'], bootstrapFingerprint,
    } } };
  const fixture = browserFixture();
  const options = { manifest: candidate, staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory };
  const before = await runPreBootstrapSmoke(options, bootstrapFingerprint);
  const after = await runStagedSmoke({ ...options, afterPrerequisites: true });
  const proof = { restrictedVerified: true, normalVerified: true, desktopVerified: true };
  assert.deepEqual(before.tradingFx, proof);
  assert.deepEqual(after.tradingFx, proof);
  assert.equal(after.businessWrites, 0);
  const calls = fixture.observations.reads.filter(({ url }) => TRADING_FX_STAGED_DENIAL_HANDLERS.includes(url.split('/').at(-1)));
  assert.equal(calls.length, 4 * TRADING_FX_STAGED_DENIAL_HANDLERS.length);
  assert.ok(calls.every(({ body, method }) => body === '{}' && method === 'POST'));
  await assert.rejects(runPreBootstrapSmoke({ ...options, browserFactory: browserFixture({ tradingFxRouteRegression: true }).browserFactory },
    bootstrapFingerprint), { code: 'SMOKE_TRADING_FX_ROUTE_NOT_DENIED' });
  await assert.rejects(runStagedSmoke({ ...options, browserFactory: browserFixture({ tradingFxActionVisible: true }).browserFactory }),
    { code: 'SMOKE_TRADING_FX_DESKTOP_ACTION_VISIBLE' });
});

test('existing draft smoke requires the held desktop and denies each execution route for both roles', async () => {
  const candidate = { ...manifest({ normalRole: true, modules: ['xero_portal'] }),
    prerequisites: { adapter: 'existing-draft-migrations' } };
  const fixture = browserFixture();
  const options = { manifest: candidate, staged, env, fetchImpl: publicFetch(), browserFactory: fixture.browserFactory };
  const result = await runStagedSmoke(options);
  assert.deepEqual(result.existingDraft, { restrictedVerified: true, normalVerified: true, desktopHeldVerified: true });
  assert.equal(result.businessWrites, 0);
  const calls = fixture.observations.reads.filter(({ url }) => url.includes('/xeroExistingDraftAuthorisation'));
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ body, method }) => body === '{}' && method === 'POST'));
  await assert.rejects(runStagedSmoke({ ...options, browserFactory: browserFixture({ existingDraftActionVisible: true }).browserFactory }),
    { code: 'SMOKE_EXISTING_DRAFT_DESKTOP_ACTION_VISIBLE' });
  await assert.rejects(runStagedSmoke({ ...options, browserFactory: browserFixture({ existingDraftRouteRegression: true }).browserFactory }),
    { code: 'SMOKE_EXISTING_DRAFT_ROUTE_NOT_DENIED' });
});
