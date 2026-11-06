import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../../../config/fcosCiIdentity.js';
import { READ_ONLY_CI_HANDLERS, isReadOnlyMarketAction } from '../../../api/_readOnlyCiAccess.js';
import { canonicalFcosE2eCandidateUrl } from '../../verify-e2e-candidate.mjs';
import { candidateAuthenticationState, writePrivateE2eState, removePrivateE2eState } from '../../e2e-private-state.mjs';
import { candidateProtectionState } from '../../e2e-protection-state.mjs';
import { CI_DENIAL_PROBES } from '../../e2e-api-denials.mjs';
import { MODULE_READERS as moduleReaders, MODULE_SURFACES, NORMAL_NAVIGATION_READS, moduleReadBody, moduleReaderPayloadVerified as modulePayloadVerified } from './normal-role-readers.mjs';

const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
const canonicalOrigin = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin;
const supabaseOrigin = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
const baselineModules = ['dashboard', 'markets'];
const normalReadHandlers = new Set([...READ_ONLY_CI_HANDLERS, ...NORMAL_NAVIGATION_READS, ...Object.values(moduleReaders).map(reader => reader.path.split('/').pop())]);
const readHandlers = new Set(READ_ONLY_CI_HANDLERS);
const unsafeControl = /(?:create|update|delete|save|submit|approve|apply|sync|send|upload|execute|cancel|promote|write|mutation|refresh|reconcil|retry|resume|recover|finaliz|publish|process|rebuild|repair|reset|import|dispatch|trigger|invalidate|persist|rotate|provision)/i;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = code => Object.assign(new Error(code), { code });
function requireFact(value, code) { if (!value) throw fail(code); }
const unique = values => [...new Set(values)].sort();

function binding(manifest, staged) {
  requireFact(manifest?.targets?.repository === fcosConnectionIdentifier('github', 'Repository')
    && manifest.targets.projectId === fcosConnectionIdentifier('vercel', 'Project ID')
    && manifest.targets.teamId === fcosConnectionIdentifier('vercel', 'Team ID')
    && manifest.targets.origin === canonicalOrigin && manifest.targets.supabaseProject === fcosConnectionIdentifier('supabase', 'Project ref'), 'SMOKE_TARGET_MISMATCH');
  requireFact(/^dpl_[A-Za-z0-9]+$/.test(staged?.id || '') && staged.target === 'production'
    && staged.sha === manifest.candidate?.sha && /^[a-f0-9]{40}$/.test(staged.sha)
    && /^[a-f0-9]{64}$/.test(manifest.candidate?.sourceDigest || '')
    && staged.buildId === manifest.build?.buildId && /^[a-zA-Z0-9._:-]{1,160}$/.test(staged.buildId || ''), 'SMOKE_DEPLOYMENT_BINDING_MISMATCH');
  return canonicalFcosE2eCandidateUrl(staged.url);
}

async function publicJson(url, { fetchImpl, bypass, expectedStatus = 200 }) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit',
      headers: { accept: 'application/json', ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) }, signal: AbortSignal.timeout(20000) });
    requireFact(response.status === expectedStatus && !response.redirected && (!response.url || response.url === url), 'SMOKE_READ_RESPONSE_INVALID');
    return await response.json();
  } catch { throw fail('SMOKE_BOUND_READ_FAILED'); }
}
async function verifyIdentity(origin, manifest, fetchImpl, bypass) {
  const receipt = await publicJson(`${origin}/api/release-identity`, { fetchImpl, bypass });
  requireFact(receipt?.schemaVersion === 1 && receipt.buildId === manifest.build.buildId && receipt.commit === manifest.candidate.sha
    && receipt.sourceDigest === manifest.candidate.sourceDigest, 'SMOKE_RUNTIME_IDENTITY_MISMATCH');
  const version = await publicJson(`${origin}/app-version.json`, { fetchImpl, bypass });
  requireFact(version?.buildId === receipt.buildId && version.commit === receipt.commit
    && (version.sourceDigest || version.provenance?.sourceDigest) === receipt.sourceDigest, 'SMOKE_STATIC_RUNTIME_IDENTITY_MISMATCH');
}

function safeBody(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => safeBody(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key)
    && !unsafeControl.test(key.replace(/[^a-z0-9]/gi, '')) && safeBody(item, depth + 1));
}
function bodyOf(request) { try { return JSON.parse(request.postData() || '{}'); } catch { return null; } }
// Protected harness policy is independent of candidate dispatch metadata. The
// two issuer auth routes are the pinned FCUNO source's existing login contract.
export function stagedBrowserRequestAllowed(request, { origin, credentials, normal = false }) {
  try {
    const url = new URL(request.url()), method = request.method(), type = request.resourceType();
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname.includes('%')) return false;
    const staticResource = ['script', 'stylesheet', 'image', 'font'].includes(type);
    if (url.origin === origin) {
      if (url.pathname.startsWith('/api/functions/')) {
        const name = url.pathname.split('/').pop(), body = bodyOf(request);
        if (name === 'hedgeDeskEntity') return normal && method === 'POST' && !url.search && exactKeys(body, ['action']) && body.action === 'snapshot';
        if (normal && name === 'xeroPortalStatus' && exactKeys(body, ['forceRefresh'])) return method === 'POST' && !url.search && body.forceRefresh === false;
        return method === 'POST' && !url.search && safeBody(body)
          && ((normal ? normalReadHandlers : readHandlers).has(name) || name === 'hedgeMarkets' && isReadOnlyMarketAction(body));
      }
      if (url.pathname === '/api/work-notifications') {
        const headers = Object.fromEntries(Object.entries(request.headers()).map(([key, value]) => [key.toLowerCase(), value]));
        const body = bodyOf(request);
        return method === 'POST' && !url.search && headers['x-fcos-function-name'] === 'workNotificationsList'
          && exactKeys(body, ['limit', 'state', 'source']) && Number.isSafeInteger(body.limit) && body.limit >= 10 && body.limit <= 100
          && body.state === 'active' && body.source === 'all';
      }
      if (url.pathname.startsWith('/api/')) return method === 'GET' && url.pathname === '/api/release-identity' && !url.search;
      const loginQuery = url.pathname === '/login' && url.search === '?federated=1';
      if (normal && type === 'document' && Object.values(MODULE_SURFACES).some(surface => `${url.pathname}${url.search}` === surface.route)) return method === 'GET';
      return method === 'GET' && (!url.search || loginQuery) && (type === 'document' && ['/', '/login', '/markets', '/settings', '/email-router'].includes(url.pathname)
        || staticResource && /^\/(?:assets\/|favicon\.|manifest\.)/.test(url.pathname)
        || ['/app-version.json', '/manifest.json'].includes(url.pathname));
    }
    if (url.origin === issuer) {
      if (url.pathname === '/api/admin/login') {
        const body = bodyOf(request);
        return method === 'POST' && ['fetch', 'xhr'].includes(type) && !url.search && exactKeys(body, ['username', 'password'])
          && body.username === credentials.email && body.password === credentials.password;
      }
      if (url.pathname === '/api/admin/session') return method === 'GET' && ['fetch', 'xhr'].includes(type) && !url.search;
      return method === 'GET' && (type === 'document' && ['/admin', '/api/oidc/authorize'].includes(url.pathname)
        || staticResource && /^(?:\/(?:assets\/|_next\/static\/|favicon\.)|\/[^?]+\.(?:png|svg|jpg|webp|woff2?|css|js|ico)$)/.test(url.pathname));
    }
    if (url.origin === supabaseOrigin) {
      if (method === 'OPTIONS' && url.pathname === '/auth/v1/user' && !url.search) {
        const headers = Object.fromEntries(Object.entries(request.headers()).map(([key, value]) => [key.toLowerCase(), value]));
        const requested = String(headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        return headers.origin === origin && headers['access-control-request-method'] === 'GET' && requested.length > 0
          && requested.every(value => ['apikey', 'authorization', 'x-client-info', 'x-supabase-api-version'].includes(value));
      }
      if (method !== 'GET') return false; // Includes every RPC, write and refresh token exchange.
      if (url.pathname === '/auth/v1/user') return !url.search;
      if (url.pathname === '/auth/v1/authorize') return url.searchParams.get('provider') === FCOS_READ_ONLY_CI.provider
        && url.searchParams.get('redirect_to') === `${origin}/login?federated=1`;
      return url.pathname === '/auth/v1/callback';
    }
    return false;
  } catch { return false; }
}

function credentialsFor(env, normal) {
  if (!normal) {
    requireFact(env.FCOS_AUTH_E2E_ENABLED === 'true' && String(env.FCOS_E2E_EMAIL || '').trim().toLowerCase() === FCOS_READ_ONLY_CI.email
      && typeof env.FCOS_E2E_PASSWORD === 'string' && env.FCOS_E2E_PASSWORD.length > 0, 'GOVERNED_CI_CREDENTIALS_MISSING');
    return { email: FCOS_READ_ONLY_CI.email, password: env.FCOS_E2E_PASSWORD, role: 'viewer' };
  }
  const email = String(env.FCOS_RAPID_NORMAL_EMAIL || '').trim().toLowerCase();
  const approved = String(env.FCOS_RAPID_NORMAL_APPROVED_EMAIL || env.FCOS_NORMAL_ROLE_APPROVED_EMAIL || '').trim().toLowerCase();
  const role = env.FCOS_RAPID_NORMAL_EXPECTED_ROLE || env.FCOS_HOSTED_NORMAL_EXPECTED_ROLE;
  requireFact(email && email !== FCOS_READ_ONLY_CI.email && email === approved && typeof env.FCOS_RAPID_NORMAL_PASSWORD === 'string'
    && env.FCOS_RAPID_NORMAL_PASSWORD.length > 0 && typeof role === 'string' && /^[a-z_]{2,40}$/.test(role), 'NORMAL_ROLE_COVERAGE_MISSING');
  return { email, password: env.FCOS_RAPID_NORMAL_PASSWORD, role };
}
function assertIdentity(auth, credentials, normal, modules) {
  const user = auth?.user;
  requireFact(user?.active === true && String(user.email || '').toLowerCase() === credentials.email && user.user_type === credentials.role, 'SMOKE_AUTHORIZATION_IDENTITY_MISMATCH');
  if (normal) requireFact(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id || '')
    && user.read_only_ci === false && modules.every(module => auth.moduleAccess?.[module] === true), 'NORMAL_ROLE_MODULE_COVERAGE_MISSING');
  else {
    const allowed = Object.entries(auth.moduleAccess || {}).filter(([, value]) => value === true).map(([module]) => module).sort();
    requireFact(user.read_only_ci === true && JSON.stringify(allowed) === JSON.stringify([...FCOS_READ_ONLY_CI.modules].sort())
      && Object.keys(auth.capabilities || {}).length > 0 && Object.values(auth.capabilities).every(value => value === false), 'SMOKE_CI_SCOPE_MISMATCH');
  }
}
const cleanLaunchEnvironment = env => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'DISPLAY', 'XAUTHORITY', 'PLAYWRIGHT_BROWSERS_PATH']
  .filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));

async function installGate(context, policy, onAuthRequest) {
  let page, gateFailed = false, blocked = 0, excludedTelemetry = 0, excludedBackgroundSync = 0;
  const allowed = request => {
    try {
      const url = new URL(request.url());
      if (url.origin === policy.origin && url.pathname === '/_vercel/speed-insights/script.js' && request.method() === 'GET') { excludedTelemetry++; return false; }
      if (policy.normal && url.origin === policy.origin && url.pathname === '/api/email-router-background-sync' && !url.search
        && request.method() === 'POST' && exactKeys(bodyOf(request), [])) { excludedBackgroundSync++; return false; }
      if (stagedBrowserRequestAllowed(request, policy)) return true;
    } catch { /* Only fixed failure labels leave the harness. */ }
    blocked++; return false;
  };
  await context.route('**/*', async route => {
    let ownPage = false;
    try { ownPage = Boolean(page && route.request().frame().page() === page); } catch { /* Worker/popup requests are refused. */ }
    if (!ownPage || !allowed(route.request())) return route.abort('blockedbyclient');
    if (route.request().url() === `${policy.origin}/api/functions/authContext` && route.request().method() === 'POST' && await onAuthRequest(route)) return;
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => { blocked++; socket.close({ code: 1008, reason: 'Read-only release verification' }); });
  page = await context.newPage();
  page.on('pageerror', () => { gateFailed = true; });
  const native = await context.newCDPSession(page);
  native.on('Fetch.requestPaused', async event => {
    const request = { url: () => event.request.url, method: () => event.request.method, headers: () => event.request.headers,
      postData: () => event.request.postData, resourceType: () => String(event.resourceType).toLowerCase() };
    const permitted = allowed(request);
    try { await native.send(permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest', permitted ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: 'BlockedByClient' }); }
    catch { gateFailed = true; await context.close().catch(() => {}); }
  });
  await native.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return { page, assertHealthy: () => requireFact(!gateFailed && blocked === 0, 'SMOKE_BROWSER_NETWORK_OR_RUNTIME_FAILURE'),
    summary: () => ({ blockedRequests: blocked, excludedTelemetry, excludedBackgroundSync,
      excludedFeatures: ['speed_insights', ...(excludedBackgroundSync ? ['automatic_mailbox_sync'] : [])] }) };
}
async function routeRead(route, origin, path, body, expectedStatus = 200) {
  let response;
  try {
    response = await route.fetch({ url: `${origin}${path}`, method: 'POST', postData: JSON.stringify(body), maxRedirects: 0, maxRetries: 0, timeout: 20000 });
    requireFact(response.url() === `${origin}${path}` && response.status() === expectedStatus, 'SMOKE_AUTHENTICATED_READ_FAILED');
    const data = await response.json();
    requireFact(data && typeof data === 'object' && !data.error, 'SMOKE_AUTHENTICATED_READ_FAILED');
    return { response: data, receipt: { path, status: expectedStatus, authenticated: true } };
  } catch { throw fail('SMOKE_AUTHENTICATED_READ_FAILED'); }
  finally { await response?.dispose(); }
}
async function denialProbes(route, origin) {
  const receipts = [];
  for (const probe of CI_DENIAL_PROBES) {
    let response;
    try {
      response = await route.fetch({ url: `${origin}${probe.path}`, method: 'POST', postData: JSON.stringify(probe.body), maxRedirects: 0, maxRetries: 0, timeout: 10000 });
      const body = await response.json();
      requireFact(response.url() === `${origin}${probe.path}` && response.status() === 403
        && ['FCOS_CI_READ_ONLY', 'FCOS_DEPLOYMENT_READ_ONLY'].includes(body?.code), 'SMOKE_RESTRICTED_ACCESS_NOT_PROVEN');
      receipts.push({ path: probe.path, status: 403, code: body.code });
    } catch { throw fail('SMOKE_RESTRICTED_ACCESS_NOT_PROVEN'); }
    finally { await response?.dispose(); }
  }
  return receipts;
}

async function verifyModuleDesktop({ page, origin, module }) {
  const spec = MODULE_SURFACES[module];
  requireFact(spec, 'MODULE_DESKTOP_COVERAGE_MISSING');
  await page.goto(`${origin}${spec.route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  requireFact(page.url() === `${origin}${spec.route}`, 'SMOKE_CANDIDATE_NAVIGATION_CHANGED');
  await page.getByRole('heading', { name: spec.heading }).first().waitFor({ state: 'visible', timeout: 30000 });
  if (spec.readControl) {
    const [response] = await Promise.all([
      page.waitForResponse(value => value.url() === `${origin}${moduleReaders[module].path}` && value.request().method() === 'POST', { timeout: 45000 }),
      page.getByRole('button', { name: spec.readControl, exact: true }).click(),
    ]);
    requireFact(response.status() === 200 && await response.finished() === null
      && modulePayloadVerified(module, await response.json()), 'SMOKE_MODULE_READ_FAILED');
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await page.waitForFunction(() => !/\b(?:loading|fetching|preparing)\b/i.test(document.body.innerText), undefined, { timeout: 30000 });
  if (module === 'settings') await page.getByLabel(/Annual interest rate/i).waitFor({ state: 'visible', timeout: 30000 });
  else if (module === 'xero_portal') await page.locator('dl dd').first().waitFor({ state: 'visible', timeout: 30000 });
  else {
    const surface = page.locator('table, [role="table"], [role="grid"]');
    // No heading-only success: require an actual table/grid or an explicit
    // business empty state. A loading/default uninitialized panel is not proof.
    if (!await surface.count()) {
      await page.getByText(/No (?:records|rows|items|invoices|payments|receipts|messages|contracts|terms|trades|positions|data|STEMs|matching|Accounts|Dispute Workflow|forecast rows)(?:\b)/i).first()
        .waitFor({ state: 'visible', timeout: 30000 });
    } else await surface.first().waitFor({ state: 'visible', timeout: 30000 });
  }
  const body = await page.locator('body').innerText();
  requireFact(!/Access denied|Something went wrong|temporarily unavailable|could not (?:load|read|verify)|No validator data loaded|Loading Hedge Desk/i.test(body), 'SMOKE_MODULE_DESKTOP_INCOMPLETE');
  return { module, route: spec.route, rendered: true, dataSource: moduleReaders[module].path, businessSurface: true,
    ...(spec.readControl ? { readControl: spec.readControl } : {}) };
}

async function browserRun({ origin, manifest, credentials, normal, modules, env, browserFactory }) {
  let browser, context, privateEnv, cleanupFailed = false;
  let denialReceipts = [], extraReads = [], desktopChecks = [], authProbed = false, probeError, rejectProbe;
  const probeFailure = new Promise((_, reject) => { rejectProbe = reject; });
  probeFailure.catch(() => {});
  try {
    const directory = await mkdtemp(join(env.RUNNER_TEMP || tmpdir(), 'fcos-rapid-smoke-'));
    privateEnv = { FCOS_E2E_STATE_DIR: directory, FCOS_E2E_STORAGE_STATE: join(directory, 'auth.json'), FCOS_E2E_PROTECTION_STATE: join(directory, 'protection.json') };
    browser = await browserFactory({ headless: true, env: cleanLaunchEnvironment(env) });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', baseURL: origin });
    if (env.FCOS_E2E_VERCEL_BYPASS) {
      const url = `${origin}/app-version.json`;
      const response = await context.request.get(url, { headers: { 'x-vercel-protection-bypass': env.FCOS_E2E_VERCEL_BYPASS, 'x-vercel-set-bypass-cookie': 'true' }, maxRedirects: 0, timeout: 20000 });
      requireFact(response.url() === url && response.status() === 307 && response.headers().location === '/app-version.json', 'SMOKE_PROTECTION_BOOTSTRAP_FAILED');
      await writePrivateE2eState({ env: privateEnv, path: privateEnv.FCOS_E2E_PROTECTION_STATE,
        state: candidateProtectionState(await context.storageState(), origin) });
      await response.dispose();
    }
    const gate = await installGate(context, { origin, credentials, normal }, async route => {
      if (authProbed) return false;
      authProbed = true;
      let actual;
      try {
        actual = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20000 });
        requireFact(actual.url() === `${origin}/api/functions/authContext` && actual.status() === 200, 'SMOKE_LOGIN_NOT_PROVEN');
        const authorization = await actual.json();
        assertIdentity(authorization, credentials, normal, modules);
        requireFact(!normal || authorization.workspacePreferences?.initialized !== false, 'NORMAL_ROLE_PREFERENCES_REQUIRE_INITIALIZATION');
        if (!normal) denialReceipts = await denialProbes(route, origin);
        else {
          // No bearer extraction: all reads inherit this app-owned request in
          // memory. Only fixed source-reviewed read endpoints/body shapes pass.
          const mutation = CI_DENIAL_PROBES[0];
          let denial;
          try {
            denial = await route.fetch({ url: `${origin}${mutation.path}`, method: 'POST', postData: '{}', maxRedirects: 0, maxRetries: 0, timeout: 10000 });
            requireFact(denial.url() === `${origin}${mutation.path}` && denial.status() === 403 && (await denial.json()).code === 'FCOS_DEPLOYMENT_READ_ONLY', 'SMOKE_NORMAL_MUTATION_NOT_DENIED');
            denialReceipts = [{ path: mutation.path, status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' }];
          } finally { await denial?.dispose(); }
          for (const module of modules.filter(value => !baselineModules.includes(value))) {
            const reader = moduleReaders[module];
            const result = await routeRead(route, origin, reader.path, moduleReadBody(module, manifest));
            requireFact(modulePayloadVerified(module, result.response), 'SMOKE_MODULE_PAYLOAD_INCOMPLETE');
            extraReads.push({ module, ...result.receipt, dataVerified: true, surface: 'authenticated_read_api', coverage: reader.coverage });
          }
        }
        await route.fulfill({ response: actual });
      } catch (error) { probeError = error; rejectProbe(error); await route.abort('blockedbyclient'); }
      finally { await actual?.dispose(); }
      return true;
    });
    const page = gate.page;
    await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (new URL(page.url()).origin !== issuer) {
      const button = page.getByRole('button', { name: 'Continue with FCUNO', exact: true });
      await Promise.race([page.waitForURL(url => url.origin === issuer, { timeout: 30000 }),
        button.waitFor({ state: 'visible', timeout: 30000 }).then(async () => {
          if (new URL(page.url()).origin === origin) await button.click();
          await page.waitForURL(url => url.origin === issuer, { timeout: 30000 });
        })]);
    }
    const atIssuer = () => requireFact(new URL(page.url()).origin === issuer && new URL(page.url()).pathname === '/admin', 'SMOKE_PINNED_ISSUER_REQUIRED');
    atIssuer(); await page.getByLabel('Username', { exact: true }).fill(credentials.email);
    atIssuer(); await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    atIssuer();
    const [authResponse] = await Promise.all([
      Promise.race([page.waitForResponse(response => response.url() === `${origin}/api/functions/authContext` && response.request().method() === 'POST', { timeout: 90000 }), probeFailure]),
      page.getByRole('button', { name: 'Login', exact: true }).click(),
    ]);
    await page.waitForURL(url => url.origin === origin && url.pathname !== '/login', { timeout: 30000 });
    requireFact(authResponse.status() === 200 && authProbed && !probeError, probeError?.code || 'SMOKE_LOGIN_NOT_PROVEN');
    assertIdentity(await authResponse.json(), credentials, normal, modules);
    await writePrivateE2eState({ env: privateEnv, path: privateEnv.FCOS_E2E_STORAGE_STATE, state: candidateAuthenticationState(await context.storageState(), origin) });
    const reads = [...extraReads];
    for (const module of baselineModules) {
      const reader = moduleReaders[module];
      const [response] = await Promise.all([
        page.waitForResponse(value => value.url() === `${origin}${reader.path}` && value.request().method() === 'POST', { timeout: 45000 }),
        page.goto(`${origin}${reader.route}`, { waitUntil: 'domcontentloaded', timeout: 45000 }),
      ]);
      requireFact(response.status() === 200 && await response.finished() === null, 'SMOKE_MODULE_READ_FAILED');
      const data = await response.json();
      requireFact(modulePayloadVerified(module, data), 'SMOKE_MODULE_PAYLOAD_INCOMPLETE');
      await page.getByRole('heading', { level: 1, name: reader.heading, exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
      requireFact(new URL(page.url()).origin === origin, 'SMOKE_CANDIDATE_NAVIGATION_CHANGED');
      reads.push({ module, path: reader.path, status: 200, authenticated: true, dataVerified: true, surface: 'browser' });
    }
    if (normal) for (const module of modules.filter(value => !baselineModules.includes(value))) {
      desktopChecks.push(await verifyModuleDesktop({ page, origin, module }));
    }
    if (!normal) {
      for (const route of ['/settings', '/email-router']) {
        await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.getByRole('heading', { name: /^Access denied$/i }).waitFor({ state: 'visible', timeout: 10000 });
      }
      requireFact(denialReceipts.length === CI_DENIAL_PROBES.length, 'SMOKE_RESTRICTED_ACCESS_NOT_PROVEN');
    }
    gate.assertHealthy();
    return { role: credentials.role, requiredModules: unique(modules), modules: unique(reads.map(read => read.module)), reads, desktopChecks, denialReceipts,
      ...gate.summary(), candidateSha: manifest.candidate.sha };
  } catch (error) {
    throw fail(probeError?.code || (/^(?:SMOKE_|NORMAL_ROLE_)[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'SMOKE_BROWSER_VERIFICATION_FAILED'));
  } finally {
    try { await context?.close(); } catch { cleanupFailed = true; }
    try { await browser?.close(); } catch { cleanupFailed = true; }
    try { if (privateEnv) await removePrivateE2eState({ env: privateEnv }); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw fail('SMOKE_PRIVATE_STATE_OR_BROWSER_CLEANUP_FAILED');
  }
}

export async function runStagedSmoke({ manifest, staged, env = process.env, fetchImpl = fetch, browserFactory } = {}) {
  const origin = binding(manifest, staged);
  const selected = unique(manifest.selection?.modules || []);
  const expanded = String(env.FCOS_RAPID_NORMAL_REQUIRED_MODULES || '').split(',').map(value => value.trim()).filter(Boolean);
  const normalModules = unique([...baselineModules, ...selected, ...expanded]);
  const missingModules = normalModules.filter(module => !Object.hasOwn(moduleReaders, module));
  if (missingModules.length) throw Object.assign(fail('MODULE_SAFE_READER_COVERAGE_MISSING'), { missingModules });
  if (manifest.moduleInventory !== undefined) {
    requireFact(Array.isArray(manifest.moduleInventory), 'SMOKE_MODULE_PATH_BINDING_MISMATCH');
    const entries = manifest.moduleInventory;
    requireFact(new Set(entries.map(entry => entry?.id)).size === entries.length, 'SMOKE_MODULE_PATH_BINDING_MISMATCH');
    for (const module of normalModules) {
      const reviewed = module === 'settings' ? ['/settings', '/settings?section=finance']
        : [moduleReaders[module].route || MODULE_SURFACES[module]?.route];
      requireFact(entries.some(entry => entry?.id === module && reviewed.includes(entry.path)), 'SMOKE_MODULE_PATH_BINDING_MISMATCH');
    }
  }

  requireFact([...selected, ...expanded].every(module => baselineModules.includes(module)) || manifest.selection?.normalRole === true, 'NORMAL_ROLE_COVERAGE_MISSING');
  const ci = credentialsFor(env, false);
  const normal = manifest.selection?.normalRole === true ? credentialsFor(env, true) : null;
  requireFact(!normalModules.includes('admin') || normal?.role === 'general_manager', 'NORMAL_ROLE_ADMIN_REQUIRES_APPROVED_GM');
  requireFact(!env.FCOS_E2E_VERCEL_BYPASS || /^[a-zA-Z0-9]{32}$/.test(env.FCOS_E2E_VERCEL_BYPASS), 'SMOKE_PROTECTION_CREDENTIAL_INVALID');
  await verifyIdentity(origin, manifest, fetchImpl, env.FCOS_E2E_VERCEL_BYPASS);
  const launch = browserFactory || (async options => (await import('@playwright/test')).chromium.launch(options));
  const restricted = await browserRun({ origin, manifest, credentials: ci, normal: false, modules: baselineModules, env, browserFactory: launch });
  const ordinary = normal ? await browserRun({ origin, manifest, credentials: normal, normal: true, modules: normalModules, env, browserFactory: launch }) : null;
  return { passed: true, deploymentId: staged.id, buildId: staged.buildId, login: true, restrictedAccess: true, businessWrites: 0,
    modules: unique([...restricted.modules, ...(ordinary?.modules || [])]), restrictedEvidence: restricted,
    ...(ordinary ? { normalRole: true, normalRoleEvidence: ordinary } : {}) };
}

export async function observeLive({ manifest, staged, durationMs = 300000, fetchImpl = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  binding(manifest, staged);
  requireFact(Number.isFinite(durationMs) && durationMs >= 300000 && durationMs <= 3600000, 'LIVE_OBSERVATION_DURATION_INVALID');
  const modules = unique([...baselineModules, ...(manifest.selection?.modules || [])]);
  requireFact(modules.every(module => Object.hasOwn(moduleReaders, module)), 'MODULE_SAFE_READER_COVERAGE_MISSING');
  const started = now(); let last = started, samples = 0;
  requireFact(Number.isFinite(started), 'LIVE_OBSERVATION_CLOCK_INVALID');
  const probes = [];
  while (true) {
    requireFact(samples <= Math.ceil(durationMs / 30000) + 1, 'LIVE_OBSERVATION_CLOCK_NOT_ADVANCING');
    await verifyIdentity(canonicalOrigin, manifest, fetchImpl);
    for (const module of modules) {
      const path = moduleReaders[module].path;
      // Anonymous GETs exercise only the read route's authentication boundary;
      // no session, new private data, Xero admission or credential refresh occurs.
      await publicJson(`${canonicalOrigin}${path}`, { fetchImpl, expectedStatus: 401 });
      if (!samples) probes.push({ module, path, status: 401, authenticationRequired: true });
    }
    samples++;
    const observed = now();
    requireFact(Number.isFinite(observed) && observed >= last, 'LIVE_OBSERVATION_CLOCK_INVALID');
    last = observed;
    if (observed - started >= durationMs) break;
    await sleep(Math.min(30000, durationMs - (observed - started)));
  }
  return { passed: true, deploymentId: staged.id, buildId: staged.buildId, observationMs: last - started, samples,
    businessWrites: 0, authenticatedDataCoverage: false, readProbes: probes, protectionBypassUsed: false };
}
