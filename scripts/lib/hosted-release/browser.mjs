import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, request } from '@playwright/test';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../../../config/fcosCiIdentity.js';
import { canonicalFcosE2eCandidateUrl } from '../../verify-e2e-candidate.mjs';
import { candidateAuthenticationState } from '../../e2e-private-state.mjs';
import { prepareCandidateProtection } from '../../e2e-protection-state.mjs';
import { collectRuntimeObservation } from '../../collect-preview-parity.mjs';
import { assertNormalRoleIdentity, NORMAL_ROLE_MODULES, verifyNormalRoleRelease } from '../../normal-role-release.mjs';
import { COMPATIBILITY_NORMAL_MODULES, verifyRuntimeCompatibilityNormalRole } from '../../runtime-compatibility-normal-role.mjs';
import { PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID } from '../preview-email-signer.mjs';
import { compatibilityBrowserIsolationVerified } from '../compatibility-browser-isolation.mjs';
import { createVercelIntegrationReader } from './vercel-read-auth.mjs';
import { legacyRuntimeLoginFailureCode } from './legacy-hosted-runtime-login.mjs';
import { ReleaseError } from './json-contract.mjs';
import { atReleaseBoundary, boundaryFailure, RUNTIME_LOGIN_ERROR_CODES } from './failure.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FROZEN = '04ee3425aac7a49089eda781eb3c976aea1f6785';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export class HostedBrowserSetupError extends Error {
  constructor(input) { super('Hosted browser setup is incomplete.'); this.input = input; }
}
function setup(input) { throw new HostedBrowserSetupError(input); }
function requireFact(value) { if (!value) throw new Error('Hosted browser binding or coverage failed.'); }
const fresh = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 30000 && now - Date.parse(value) <= 1800000;

export function assertHostedBrowserBinding(manifest, preview) {
  const deployment = preview?.deployment || preview;
  requireFact(manifest?.schemaVersion === 2 && manifest.contract === 'fcos-hosted-release/v2'
    && SHA.test(manifest.candidate?.sha || '') && SHA.test(manifest.controller?.sha || '')
    && ['sourceSha256', 'lockSha256', 'configurationSha256'].every(k => HASH.test(manifest.candidate[k] || ''))
    && manifest.targets?.repository === fcosConnectionIdentifier('github', 'Repository')
    && manifest.targets.vercelProject === fcosConnectionIdentifier('vercel', 'Project ID')
    && manifest.targets.vercelTeam === fcosConnectionIdentifier('vercel', 'Team ID')
    && manifest.targets.supabaseProject === fcosConnectionIdentifier('supabase', 'Project ref')
    && manifest.targets.productionOrigin === new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin
    && deployment?.projectId === manifest.targets.vercelProject && deployment.teamId === manifest.targets.vercelTeam
    && deployment.sha === manifest.candidate.sha && deployment.state === 'READY' && deployment.target === 'preview'
    && /^dpl_[A-Za-z0-9]+$/.test(deployment.id || '') && deployment.manifestHash === digest(manifest)
    && (!deployment.sourceSha256 || deployment.sourceSha256 === manifest.candidate.sourceSha256));
  requireFact(canonicalFcosE2eCandidateUrl(deployment.url) === deployment.url);
  return deployment;
}

// This optional default performs only pinned GETs using a separately provisioned read token.
// A trusted workflow may instead inject an independently authenticated provider-proof reader.
export async function recheckHostedPreviewProvider({ manifest, preview, env, fetchImpl = fetch }) {
  if (!env.FCOS_HOSTED_VERCEL_READ_TOKEN) setup('vercel_readonly_metadata_credential');
  const reader=createVercelIntegrationReader({manifest,env,fetchImpl});
  const api=path=>reader.get(path);
  const project = await api(`/v9/projects/${manifest.targets.vercelProject}`);
  requireFact(project.id === manifest.targets.vercelProject && project.accountId === manifest.targets.vercelTeam
    && project.name === fcosConnectionIdentifier('vercel', 'Project') && project.link?.type === 'github'
    && `${project.link.org}/${project.link.repo}` === manifest.targets.repository);
  const current = await api(`/v13/deployments/${preview.id}`);
  const proof = { id: current.id, url: `https://${current.url}`, projectId: current.projectId, teamId: current.teamId || project.accountId,
    sha: current.meta?.githubCommitSha, sourceSha256: current.meta?.fcosSourceSha256,
    state: current.readyState, target: current.target || 'preview', manifestHash: current.meta?.fcosHostedManifest, createdAt: current.createdAt };
  assertHostedBrowserBinding(manifest, proof);
  requireFact(proof.id === preview.id && proof.url === preview.url);
  return proof;
}

export function assertHostedBrowserCredentialBoundary(env, mode) {
  const forbidden = ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'FCOS_HOSTED_VERCEL_TOKEN', 'VERCEL_TOKEN', 'VERCEL_OIDC_TOKEN',
    'GH_TOKEN', 'GITHUB_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'SF_ACCESS_TOKEN'];
  requireFact(!forbidden.some(key => env[key]) && !Object.keys(env).some(k => /COORDINATOR.*(?:TOKEN|SECRET)|PRODUCTION.*(?:TOKEN|SECRET|PASSWORD)/.test(k) && env[k]));
  requireFact(!env.FCOS_NORMAL_ROLE_STORAGE_STATE_BASE64); // Never import an existing user session.
  const other = mode === 'restricted' ? ['FCOS_HOSTED_NORMAL_EMAIL', 'FCOS_HOSTED_NORMAL_PASSWORD'] : ['FCOS_HOSTED_RESTRICTED_EMAIL', 'FCOS_HOSTED_RESTRICTED_PASSWORD'];
  requireFact(!other.some(k => env[k]) && !env.FCOS_HOSTED_RUNTIME_EMAIL && !env.FCOS_HOSTED_RUNTIME_PASSWORD);
}

function credentialsFromEnvironment(env, mode) {
  const prefix = mode === 'restricted' ? 'FCOS_HOSTED_RESTRICTED' : 'FCOS_HOSTED_NORMAL';
  const email = env[`${prefix}_EMAIL`]?.trim().toLowerCase(), password = env[`${prefix}_PASSWORD`];
  if (!email || !password) setup(`${prefix.toLowerCase()}_renewable_credentials`);
  if (mode === 'restricted') requireFact(email === FCOS_READ_ONLY_CI.email);
  else {
    if (!env.FCOS_NORMAL_ROLE_APPROVED_EMAIL || !env.FCOS_HOSTED_NORMAL_EXPECTED_ROLE) setup('normal_role_approved_email_and_existing_role');
    requireFact(email !== FCOS_READ_ONLY_CI.email && email === env.FCOS_NORMAL_ROLE_APPROVED_EMAIL.toLowerCase());
  }
  return { email, password, expectedRole: mode === 'normal_role' ? env.FCOS_HOSTED_NORMAL_EXPECTED_ROLE : 'viewer' };
}

export function assertHostedBrowserIdentity(auth, { mode, credentials }) {
  if (mode === 'normal_role' || mode === 'runtime') {
    const identity = assertNormalRoleIdentity(auth, { approvedEmail: credentials.email });
    requireFact(identity.role === credentials.expectedRole && (mode === 'runtime'
      ? ['administrator', 'general_manager'].includes(identity.role)
      : NORMAL_ROLE_MODULES.every(spec => identity.moduleAccess[spec.module] === true)));
    return identity;
  }
  const user = auth?.user, allowed = Object.entries(auth?.moduleAccess || {}).filter(([, value]) => value === true).map(([key]) => key).sort();
  requireFact(user?.email?.toLowerCase() === FCOS_READ_ONLY_CI.email && user.active === true && user.read_only_ci === true && user.user_type === 'viewer'
    && canonical(allowed) === canonical([...FCOS_READ_ONLY_CI.modules].sort())
    && Object.keys(auth.capabilities || {}).length > 0 && Object.values(auth.capabilities).every(value => value === false));
  return { role: 'viewer', moduleAccess: auth.moduleAccess };
}

async function arriveAtHostedIssuer(page, origin, issuer) {
  const atIssuer = () => {
    try { const url = new URL(page.url()); return url.origin === issuer && url.pathname === '/admin'; }
    catch { return false; }
  };
  if (atIssuer()) return;
  // Login.jsx can automatically redirect while its manual button disappears.
  // Observe arrival first; an optional click stays bound to the old document.
  let arrived = false;
  const arrival = page.waitForURL(url => url.origin === issuer && url.pathname === '/admin', { timeout: 30000 })
    .then(() => { arrived = true; });
  const manual = (async () => {
    const button = page.getByRole('button', { name: 'Continue with FCUNO', exact: true });
    await button.waitFor({ state: 'visible', timeout: 30000 });
    if (arrived || atIssuer()) return;
    const originalLogin = () => {
      const url = new URL(page.url());
      requireFact(url.origin === origin && url.pathname === '/login' && !url.searchParams.has('federated'));
    };
    originalLogin();
    const element = await button.elementHandle({ timeout: 1000 });
    requireFact(element);
    try {
      if (!arrived && !atIssuer()) { originalLogin(); await element.click({ timeout: 5000 }); }
    } finally { await element.dispose().catch(() => {}); }
    await arrival;
  })().catch(() => arrival);
  await Promise.race([arrival, manual]);
  requireFact(atIssuer());
}

// Fresh dedicated test login only. Browser state remains opaque and candidate-scoped;
// the existing normal-role harness consumes its newly issued bearer only in memory.
export async function loginHostedFcuno({ origin, credentials, mode, protectionState, browserType = chromium, launchEnvironment = hostedBrowserLaunchEnvironment() }) {
  const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
  let browser, context;
  try {
    browser = await atReleaseBoundary('runtime.login.browser', () => browserType.launch({ headless: true, env: launchEnvironment }));
    context = await atReleaseBoundary('runtime.login.context', () => browser.newContext({ storageState: protectionState, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }));
    const page = await context.newPage();
    await atReleaseBoundary('runtime.login.navigation', () => page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 }));
    await atReleaseBoundary('runtime.login.issuer', () => arriveAtHostedIssuer(page, origin, issuer));
    const issuerLocation = () => { const url = new URL(page.url()); requireFact(url.origin === issuer && url.pathname === '/admin'); };
    await atReleaseBoundary('runtime.login.form', async () => {
      issuerLocation(); await page.getByLabel('Username', { exact: true }).fill(credentials.email);
      issuerLocation(); await page.getByLabel('Password', { exact: true }).fill(credentials.password);
      issuerLocation();
    });
    const [response] = await atReleaseBoundary('runtime.login.submit', () => Promise.all([
      page.waitForResponse(res => res.url() === `${origin}/api/functions/authContext` && res.request().method() === 'POST', { timeout: 60000 }),
      page.getByRole('button', { name: 'Login', exact: true }).click(),
    ]));
    await atReleaseBoundary('runtime.login.identity', async () => {
      const httpStatus = response.status();
      if (httpStatus === 200) return;
      requireFact(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599);
      let errorCode = 'UNCLASSIFIED', diagnosticTimer;
      try {
        const bytes = await Promise.race([response.body(), new Promise((_, reject) => {
          diagnosticTimer = setTimeout(() => reject(new Error('RUNTIME_LOGIN_DIAGNOSTIC_TIMEOUT')), 1000);
        })]);
        if (bytes.length <= 8192) {
          const code = JSON.parse(bytes.toString('utf8'))?.code;
          if (RUNTIME_LOGIN_ERROR_CODES.includes(code)) errorCode = code;
        }
      } catch { /* Unknown/private response content stays redacted. */ }
      finally { clearTimeout(diagnosticTimer); }
      let observedOrigin = null, pathname = null;
      try {
        const location = new URL(page.url());
        if ([origin, issuer].includes(location.origin)) {
          observedOrigin = location.origin;
          if (['/', '/login', '/admin'].includes(location.pathname)) pathname = location.pathname;
        }
      } catch { /* No raw navigation value leaves this process. */ }
      throw new ReleaseError('RUNTIME_LOGIN_AUTH_CONTEXT_HTTP', 'runtime.login.identity',
        'Inspect the bound authentication response and configuration; do not replay the consumed runtime request.',
        { runtimeLogin: { httpStatus, errorCode, origin: observedOrigin, pathname } });
    });
    await atReleaseBoundary('runtime.login.callback', () => page.waitForURL(url => url.origin === origin && !/\/login(?:\?|$)/.test(url.pathname), { timeout: 30000 }));
    requireFact(response.status() === 200 && new URL(page.url()).origin === origin);
    const auth = await atReleaseBoundary('runtime.login.identity', () => response.json());
    atReleaseBoundary('runtime.login.identity', () => assertHostedBrowserIdentity(auth, { mode, credentials }));
    const state = candidateAuthenticationState(await context.storageState(), origin);
    let token;
    if (mode !== 'restricted') {
      const name = `sb-${fcosConnectionIdentifier('supabase', 'Project ref')}-auth-token`;
      const item = state.origins.find(o => o.origin === origin)?.localStorage?.find(v => v.name === name);
      try { token = JSON.parse(item.value).access_token; } catch { /* Missing new auth session stays blocked. */ }
      requireFact(typeof token === 'string' && token.length > 0);
    }
    return { state, token, auth };
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new Error('Dedicated hosted FCUNO login failed.');
  }
  finally {
    let cleanupFailed = false;
    try { await context?.close(); } catch { cleanupFailed = true; }
    try { await browser?.close(); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw boundaryFailure(null, 'runtime.login.cleanup');
  }
}

export async function runHostedRestrictedHarness({ origin, state, directory, controllerDirectory = ROOT, env = process.env, run = spawnSync }) {
  const statePath = join(directory, 'restricted-auth.json'), configPath = join(directory, 'restricted.config.mjs');
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  const configUrl = pathToFileURL(join(controllerDirectory, 'playwright.config.js')).href;
  writeFileSync(configPath, `import base from ${JSON.stringify(configUrl)}; const desktop=base.projects.find(p=>p.name==='desktop-chrome'); export default {...base,globalSetup:undefined,testDir:${JSON.stringify(join(controllerDirectory, 'e2e'))},testMatch:['**/workspace-smoke.spec.js','**/dashboard.spec.js','**/api-denials.spec.js'],reporter:[['json']],forbidOnly:true,retries:0,webServer:undefined,use:{...base.use,baseURL:${JSON.stringify(origin)},storageState:${JSON.stringify(statePath)},trace:'off',screenshot:'off',video:'off',serviceWorkers:'block'},projects:[{...desktop,dependencies:[],use:{...desktop.use,storageState:${JSON.stringify(statePath)},trace:'off',screenshot:'off',video:'off'}}]};\n`, { mode: 0o600, flag: 'wx' });
  const childEnv = { PATH: env.PATH, HOME: env.HOME, CI: 'true', FCOS_REQUIRE_AUTH_E2E: '1', FCOS_E2E_BASE_URL: origin,
    FCOS_E2E_STORAGE_STATE: statePath, ...(env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: env.PLAYWRIGHT_BROWSERS_PATH } : {}) };
  const result = await run(process.execPath, [join(controllerDirectory, 'node_modules/@playwright/test/cli.js'), 'test', '--config', configPath, '--trace=off'],
    { cwd: controllerDirectory, env: childEnv, shell: false, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60 * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
  let report; try { report = JSON.parse(result.stdout); } catch { throw new Error('Restricted browser report is unavailable.'); }
  requireFact(result.status === 0 && report.stats?.expected > 0 && report.stats.unexpected === 0 && report.stats.skipped === 0 && report.stats.flaky === 0);
  const files = new Set((report.suites || []).map(suite => String(suite.file || suite.title).split('/').at(-1)));
  requireFact(['workspace-smoke.spec.js', 'dashboard.spec.js', 'api-denials.spec.js'].every(name => files.has(name)));
  return { modules: ['dashboard', 'markets', 'api_denials'], actualData: true, unexpectedWrites: 0, testsPassed: report.stats.expected };
}

export function hostedBrowserLaunchEnvironment(env = process.env) {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'DISPLAY', 'XAUTHORITY', 'PLAYWRIGHT_BROWSERS_PATH'];
  return Object.fromEntries(allowed.filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
}
function isolatedBrowserType(browserType, env) {
  return { async launch(options) {
    const browser = await browserType.launch({ ...options, env: hostedBrowserLaunchEnvironment(env) });
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async contextOptions => {
      const context = await newContext(contextOptions), close = context.close.bind(context);
      context.close = async () => {
        try { await close(); } catch { await browser.close().catch(() => {}); throw new Error('Hosted browser context cleanup failed.'); }
      };
      return context;
    };
    return browser;
  } };
}

/** Dedicated hosted diagnostic identity only; returns an in-memory token to the trusted
 * runtime collector. verifyTarget must establish exact provider/source authority first.
 */
export function createHostedRuntimeTokenProvider({ env = process.env, verifyTarget, browserType = chromium, login = loginHostedFcuno } = {}) {
  return async ({ origin, deployment, protectionState }) => {
    try {
      if (typeof verifyTarget !== 'function') setup('runtime_identity_verified_target');
      requireFact(!env.FCOS_HOSTED_NORMAL_EMAIL && !env.FCOS_HOSTED_NORMAL_PASSWORD
        && !env.FCOS_HOSTED_RESTRICTED_EMAIL && !env.FCOS_HOSTED_RESTRICTED_PASSWORD);
      const proof = await atReleaseBoundary('runtime.identity.target', () => verifyTarget({ origin, deployment }));
      requireFact(proof?.verified === true && proof.origin === origin && proof.deploymentId === deployment?.id
        && proof.sha === deployment.sha && SHA.test(proof.sha || '') && HASH.test(proof.sourceSha256 || ''));
      requireFact(origin === new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin || canonicalFcosE2eCandidateUrl(origin) === origin);
      const email = env.FCOS_HOSTED_RUNTIME_EMAIL?.trim().toLowerCase(), password = env.FCOS_HOSTED_RUNTIME_PASSWORD;
      if (!email || !password) setup('hosted_runtime_renewable_credentials');
      const expectedRole = env.FCOS_HOSTED_RUNTIME_EXPECTED_ROLE;
      if (!['administrator', 'general_manager'].includes(expectedRole)) setup('runtime_identity_approved_existing_admin_role');
      requireFact(email !== FCOS_READ_ONLY_CI.email);
      const credentials = { email, password, expectedRole };
      const authenticated = await login({ origin, credentials, mode: 'runtime', protectionState,
        browserType: isolatedBrowserType(browserType, env) });
      assertHostedBrowserIdentity(authenticated.auth, { mode: 'runtime', credentials });
      requireFact(typeof authenticated.token === 'string' && authenticated.token.length > 0);
      return authenticated.token;
    } catch (error) {
      if (error instanceof HostedBrowserSetupError || error instanceof ReleaseError) throw error;
      const code = legacyRuntimeLoginFailureCode(error);
      if (code) throw Object.assign(new Error(code), { code });
      throw new Error('Hosted runtime identity verification failed.');
    }
  };
}

export function sanitiseHostedSignerEvidence(value, { manifest, deployment, sourceProof, now = Date.now() }) {
  const keys = ['schemaVersion', 'kind', 'probe', 'capturedAt', 'deploymentId', 'sha', 'sourceDigest', 'mailboxRegistryId', 'result', 'noAttachmentFetch', 'sourceHashes'];
  requireFact(value && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k))
    && value.schemaVersion === 1 && value.kind === 'fcos_preview_email_signer' && value.probe === 'synthetic_attachment_link_v1'
    && value.deploymentId === deployment.id && value.sha === manifest.candidate.sha && value.sourceDigest === manifest.candidate.sourceSha256
    && value.mailboxRegistryId === PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID && value.result === 'pass' && value.noAttachmentFetch === true
    && fresh(value.capturedAt, now) && canonical(value.sourceHashes) === canonical(sourceProof.sourceHashes)
    && Object.keys(value.sourceHashes || {}).length === 3 && Object.values(value.sourceHashes).every(v => HASH.test(v)));
  return Object.fromEntries(keys.map(k => [k, value[k]]));
}

export async function runHostedBrowser({ manifest, preview, mode, env = process.env, fetchImpl = fetch,
  controllerDirectory = ROOT, verifyPreview = recheckHostedPreviewProvider, verifyController = ({ manifest, controllerDirectory }) => {
    requireFact(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: controllerDirectory, encoding: 'utf8' }).trim() === manifest.controller.sha
      && !execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: controllerDirectory, encoding: 'utf8' }).trim());
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: controllerDirectory, encoding: 'utf8' }).trim();
    requireFact([`https://github.com/${manifest.targets.repository}`, `https://github.com/${manifest.targets.repository}.git`, `git@github.com:${manifest.targets.repository}.git`].includes(remote));
  }, observeRuntime = collectRuntimeObservation, getCredentials = credentialsFromEnvironment, login = loginHostedFcuno,
  browserType = chromium, requestType = request, prepareProtection = prepareCandidateProtection,
  restrictedHarness = runHostedRestrictedHarness, normalHarness, admitHostedSource, signerAdapter, now = () => new Date(),
} = {}) {
  const checkId = mode === 'restricted' ? 'restricted_browser' : 'normal_role';
  const base = { schemaVersion: 2, kind: 'fcos_hosted_browser_raw', checkId, id: checkId,
    manifestHash: manifest ? digest(manifest) : undefined, candidateSha: manifest?.candidate?.sha, controllerSha: manifest?.controller?.sha };
  let directory;
  try {
    requireFact(['restricted', 'normal_role'].includes(mode)); assertHostedBrowserCredentialBoundary(env, mode);
    if (env.FCOS_HOSTED_BROWSER_ENABLED !== 'true') setup('hosted_browser_enabled');
    const deployment = assertHostedBrowserBinding(manifest, preview);
    await verifyController({ manifest, controllerDirectory });
    const provider = await verifyPreview({ manifest, preview: deployment, env, fetchImpl });
    assertHostedBrowserBinding(manifest, provider); requireFact(provider.id === deployment.id && provider.url === deployment.url);
    const response = await fetchImpl(`${deployment.url}/app-version.json`, { redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: env.FCOS_E2E_VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.FCOS_E2E_VERCEL_BYPASS } : {} });
    requireFact(response.ok && !response.redirected && (!response.url || response.url === `${deployment.url}/app-version.json`));
    const version = await response.json();
    requireFact(version.commit === manifest.candidate.sha && version.deploymentId === deployment.id
      && version.provenance?.sourceDigest === manifest.candidate.sourceSha256 && version.provenance.releaseEligible === true);
    const runtime = await observeRuntime({ url: deployment.url, deployment, sourceDigest: manifest.candidate.sourceSha256,
      token: env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS, fetchImpl, now: now().getTime() });
    requireFact(runtime && fresh(runtime.capturedAt, now().getTime()) && runtime.deploymentId === deployment.id && runtime.sha === manifest.candidate.sha
      && runtime.safety?.readOnly === true && Object.values(runtime.safety.externalActions || {}).length > 0
      && Object.values(runtime.safety.externalActions).every(v => v === false)
      && canonical({ flags: runtime.flags, safety: runtime.safety, auth: runtime.auth }) === canonical(manifest.runtime.expectedPreview));
    let sourceReceipt, signerProof;
    if (mode === 'normal_role' && manifest.candidate.sha === FROZEN) {
      if (typeof admitHostedSource !== 'function') setup('frozen_04ee_source_and_observation_admission');
      sourceReceipt = await admitHostedSource({ manifest, preview: deployment, version, runtime });
      requireFact(sourceReceipt?.sourceVerified === true && sourceReceipt.observationSourcesVerified === true
        && sourceReceipt.candidateSha === manifest.candidate.sha && sourceReceipt.controllerSha === manifest.controller.sha
        && sourceReceipt.sourceDigest === manifest.candidate.sourceSha256 && sourceReceipt.lockSha256 === manifest.candidate.lockSha256
        && sourceReceipt.configurationSha256 === manifest.candidate.configurationSha256 && sourceReceipt.manifestHash === digest(manifest));
      if (!signerAdapter || typeof signerAdapter.verifySource !== 'function' || typeof signerAdapter.collect !== 'function') setup('frozen_04ee_signer_source_and_synthetic_probe_adapter');
      signerProof = await signerAdapter.verifySource({ manifest, preview: deployment, sourceReceipt });
      requireFact(signerProof?.sourceVerified === true && signerProof.candidateSha === manifest.candidate.sha
        && signerProof.sourceDigest === manifest.candidate.sourceSha256 && signerProof.manifestHash === digest(manifest)
        && canonical(Object.keys(signerProof.sourceHashes || {}).sort()) === canonical(['api/_emailRouterCore.js', 'api/_emailRouterHandlers.js', 'api/functions/[name].js'])
        && Object.values(signerProof.sourceHashes).every(v => HASH.test(v)));
    }
    const credentials = await getCredentials(env, mode);
    requireFact(credentials && credentials.email && credentials.password);
    if (!env.FCOS_E2E_VERCEL_BYPASS) setup('preview_protection_access');
    directory = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'fcos-hosted-browser-'));
    const privateEnv = { FCOS_REQUIRE_AUTH_E2E: '1', FCOS_E2E_BASE_URL: deployment.url, FCOS_E2E_EXPECTED_COMMIT: manifest.candidate.sha,
      FCOS_E2E_VERCEL_BYPASS: env.FCOS_E2E_VERCEL_BYPASS, FCOS_E2E_STATE_DIR: directory,
      FCOS_E2E_STORAGE_STATE: join(directory, 'auth.json'), FCOS_E2E_PROTECTION_STATE: join(directory, 'protection.json') };
    let protectionState;
    await prepareProtection({ env: privateEnv, request: requestType, verify: async () => ({ commit: manifest.candidate.sha, candidateUrl: deployment.url }),
      writeState: async ({ state }) => { protectionState = state; } });
    requireFact(protectionState);
    const protectedBrowserType = isolatedBrowserType(browserType, env);
    const authenticated = await login({ origin: deployment.url, credentials, mode, protectionState, browserType: protectedBrowserType });
    const identity = assertHostedBrowserIdentity(authenticated.auth, { mode, credentials });
    let result, capturedAt;
    if (mode === 'restricted') {
      result = await restrictedHarness({ origin: deployment.url, state: authenticated.state, directory, controllerDirectory, env });
      requireFact(result.actualData === true && result.unexpectedWrites === 0
        && canonical([...result.modules].sort()) === canonical(['api_denials', 'dashboard', 'markets']));
      requireFact(Number.isSafeInteger(result.testsPassed) && result.testsPassed > 0);
      result = { identity: 'restricted', modules: ['dashboard', 'markets', 'api_denials'], actualData: true, unexpectedWrites: 0, testsPassed: result.testsPassed }; capturedAt = now().toISOString();
    } else {
      const frozen = manifest.candidate.sha === FROZEN;
      const harness = normalHarness || (frozen ? verifyRuntimeCompatibilityNormalRole : verifyNormalRoleRelease);
      const harnessEnv = { ...env, GITHUB_SHA: manifest.controller.sha, FCOS_E2E_CANDIDATE_URL: deployment.url,
        FCOS_E2E_EXPECTED_COMMIT: manifest.candidate.sha, FCOS_NORMAL_ROLE_APPROVED_EMAIL: credentials.email, RUNNER_TEMP: directory };
      const evidence = await harness({ env: harnessEnv, fetchImpl, browserType: protectedBrowserType,
        resolveCandidate: async () => ({ commit: manifest.candidate.sha, candidateUrl: deployment.url }), observeRuntime: async () => runtime,
        authenticate: async () => ({ state: authenticated.state, token: authenticated.token }), writeEvidence: async () => {},
        ...(frozen ? { admitHostedSource: async () => sourceReceipt, signerEnabled: () => true,
          collectSigner: async options => signerAdapter.collect({ ...options, manifest, sourceProof: signerProof }) } : {}) });
      const modules = frozen ? COMPATIBILITY_NORMAL_MODULES : NORMAL_ROLE_MODULES;
      requireFact(evidence.candidateSha === manifest.candidate.sha && evidence.harnessSha === manifest.controller.sha
        && evidence.deploymentId === deployment.id && evidence.sourceDigest === manifest.candidate.sourceSha256
        && evidence.candidateUrl === deployment.url && fresh(evidence.capturedAt, now().getTime())
        && Array.isArray(evidence.checks) && evidence.checks.length === 15 && new Set(evidence.checks.map(c => c.module)).size === 15
        && modules.every(spec => evidence.checks.some(c => c.module === spec.module && c.role === identity.role && c.result === 'pass'
          && c.kind === (spec.workflow ? 'workflow_read' : 'read'))));
      if (frozen) requireFact(compatibilityBrowserIsolationVerified(evidence.browserIsolation, { candidateUrl: deployment.url, sha: manifest.candidate.sha,
          harnessSha: manifest.controller.sha, deploymentId: deployment.id, sourceDigest: manifest.candidate.sourceSha256 }, modules.map(s => s.module)));
      capturedAt = evidence.capturedAt;
      result = { identity: 'normal_role', role: identity.role, modules: evidence.checks.map(c => c.module), actualData: true, unexpectedWrites: 0,
        ...(frozen ? { browserIsolation: evidence.browserIsolation, emailSigner: sanitiseHostedSignerEvidence(evidence.emailSigner, { manifest, deployment, sourceProof: signerProof, now: now().getTime() }) } : {}) };
    }
    return { ...base, status: 'passed', deploymentId: deployment.id, candidateUrl: deployment.url, sourceSha256: manifest.candidate.sourceSha256,
      inputsSha256: digest({ manifestHash: digest(manifest), deploymentId: deployment.id, source: manifest.candidate.sourceSha256, mode,
        provider: { projectId: provider.projectId, teamId: provider.teamId, sha: provider.sha, manifestHash: provider.manifestHash },
        runtime: { capturedAt: runtime.capturedAt, flags: runtime.flags, safety: runtime.safety, auth: runtime.auth },
        sourceReceipt: sourceReceipt ? { sourceDigest: sourceReceipt.sourceDigest, lockSha256: sourceReceipt.lockSha256, configurationSha256: sourceReceipt.configurationSha256 } : null,
        signerSourceHashes: signerProof?.sourceHashes || null }),
      capturedAt, completedAt: capturedAt, result };
  } catch (error) {
    return { ...base, status: error instanceof HostedBrowserSetupError ? 'waiting_dependency' : 'failed',
      ...(error instanceof HostedBrowserSetupError ? { missing: [error.input] } : { errorCode: 'HOSTED_BROWSER_VERIFICATION_FAILED' }),
      capturedAt: now().toISOString(), completedAt: now().toISOString() };
  } finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
}
