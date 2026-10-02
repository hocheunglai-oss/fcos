import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { normalRoleReadRequest } from './lib/normal-role-read-requests.mjs';
import { createNormalRoleVerificationRoute, NORMAL_ROLE_TRANSPORT_BLOCKED_REASONS } from './lib/normal-role-verification-transport.mjs';
import { verifyCompatibilityObservationSources } from './lib/runtime-compatibility-observation.mjs';
import { canonicalFcosE2eCandidateUrl, resolveFcosE2eCandidate } from './verify-e2e-candidate.mjs';
import { collectRuntimeObservation } from './collect-preview-parity.mjs';
import { FIRST_RUNTIME_ROLLOUT, compatibilityNormalCoverageVerified, compatibilityReadOnlyGuardsVerified, compatibilityRuntimePreviewVerified } from './lib/runtime-compatibility-release.mjs';
import { verifyRuntimeCompatibility } from './verify-runtime-compatibility.mjs';

// Frozen v288 read paths for the exact reviewed read-only first rollout only.
// Never import the evolving v293 module catalogue or use this as a fallback.
// Every pass needs a successful module data response and a rendered business
// surface. Headings alone, an invented zero, and denied/unavailable data fail.
export const COMPATIBILITY_NORMAL_MODULES = Object.freeze([
  { module: 'dashboard', path: '/', handler: 'dashboardStemList', fields: ['stems'], title: /Dashboard/i },
  { module: 'markets', path: '/markets', handler: 'hedgeMarkets', fields: ['mops'], title: /Markets/i },
  { module: 'review', path: '/review', handler: 'salesforceDashboardFiltered', fields: ['recentStems'], title: /Exception Review/i, workflow: true },
  { module: 'disputes', path: '/disputes', handler: 'disputeWorkflowList', fields: ['rows'], title: /Dispute Workflow/i, workflow: true },
  { module: 'buyer_invoices', path: '/payment-collections?tab=collections', handler: 'buyerInvoiceCollectionList', fields: ['items'], title: /Payment Collections/i },
  { module: 'unofficial_compensation', path: '/unofficial-compensation', handler: 'unofficialCompensationList', fields: ['accounts'], title: /Unofficial Compensation|Agreed Compensation/i },
  { module: 'incoming_payments', path: '/payment-collections?tab=incoming', handler: 'incomingPaymentsList', fields: ['rows', 'payments'], title: /Payment Collections/i },
  { module: 'cashflow_forecast', path: '/cashflow-forecast', handler: 'cashflowForecast', fields: ['rows'], title: /Cashflow/i },
  { module: 'brokers', path: '/brokers', handler: 'salesforceBrokerRegister', fields: ['rows'], title: /Broker/i },
  { module: 'master_contracts', path: '/master-contracts', handler: 'masterContractsList', fields: ['contracts'], title: /Master Contracts/i },
  { module: 'special_terms', path: '/special-terms', handler: 'specialTermsSummaryList', fields: ['terms', 'items', 'rows'], title: /Special Terms/i },
  { module: 'hedge_desk', path: '/hedge-desk', handler: 'hedgeDeskEntity', fields: ['physicals'], title: /Hedge Desk|Position control/i },
  { module: 'xero_portal', path: '/xero-portal', handler: 'xeroPortalReceiptsList', fields: ['receipts', 'rows'], title: /Xero/i },
  { module: 'email_router', path: '/email-router', handler: 'emailRouterList', fields: ['messages', 'items'], title: /Email Router/i },
  { module: 'settings', path: '/settings?section=finance', handler: 'financeSettingsGet', fields: [], title: /Finance settings|Settings/i },
]);

const normalRoleDiagnosticStages = new Set([
  'CONFIGURATION', 'SOURCE_SCOPE', 'OBSERVATION_SOURCES', 'CANDIDATE_URL', 'CANDIDATE_RESOLUTION',
  'VERSION_FETCH', 'VERSION_PARSE', 'VERSION_PROVENANCE', 'RUNTIME_OBSERVATION', 'RUNTIME_SAFETY',
  'STORAGE_STATE', 'AUTH_FETCH', 'AUTH_RESPONSE', 'IDENTITY', 'BROWSER_SETUP', 'MODULES', 'COVERAGE', 'EVIDENCE',
]);
const normalRoleDiagnosticReasons = new Set([
  'CONFIGURATION_INVALID', 'STAGE_FAILED', 'READ_ONLY_GUARD_MISSING', 'VERSION_INVALID', 'RUNTIME_SAFETY_FAILED',
  'STORAGE_INVALID', 'AUTH_RESPONSE_INVALID', 'IDENTITY_INVALID', 'BROWSER_UNAVAILABLE', 'ACCESS_MISSING',
  'MISSING_HEADING', 'MISSING_DATA', 'PAGE_ERROR', 'BLOCKED_REQUEST', 'LOGIN_REDIRECT', 'UNAVAILABLE_SURFACE',
  'MISSING_ROWS', 'EMPTY_STATE_MISSING', 'SETTINGS_FIELD_MISSING', 'WORKFLOW_MISSING', 'COVERAGE_INCOMPLETE',
  'EVIDENCE_WRITE_FAILED', 'PASS', 'NOT_REACHED',
]);

function normalRoleDiagnosticModules(moduleReasons, modules) {
  return COMPATIBILITY_NORMAL_MODULES.map(spec => {
    const saved = modules?.find(row => row?.module === spec.module && row?.handler === spec.handler)?.reason;
    const reason = moduleReasons instanceof Map ? moduleReasons.get(spec.module) : undefined;
    return { module: spec.module, handler: spec.handler,
      reason: normalRoleDiagnosticReasons.has(reason) ? reason : normalRoleDiagnosticReasons.has(saved) ? saved : 'NOT_REACHED' };
  });
}

export function normalizeCompatibilityNormalDiagnostic(input = {}) {
  const diagnostic = {
    stage: normalRoleDiagnosticStages.has(input.stage) ? input.stage : 'CONFIGURATION',
    reason: normalRoleDiagnosticReasons.has(input.reason) ? input.reason : 'STAGE_FAILED',
  };
  const spec = COMPATIBILITY_NORMAL_MODULES.find(candidate => candidate.module === input.module && candidate.handler === input.handler);
  if (spec) {
    diagnostic.module = spec.module;
    diagnostic.handler = spec.handler;
  }
  if (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) diagnostic.status = input.status;
  if (input.moduleReasons instanceof Map || Array.isArray(input.modules)) diagnostic.modules = normalRoleDiagnosticModules(input.moduleReasons, input.modules);
  if (NORMAL_ROLE_TRANSPORT_BLOCKED_REASONS.includes(input.blockedRequest)) diagnostic.blockedRequest = input.blockedRequest;
  return diagnostic;
}

export function compatibilityNormalDiagnosticError(stage, reason, details) {
  const error = new Error('Normal-role verification blocked.');
  error.normalRoleDiagnostic = normalizeCompatibilityNormalDiagnostic({ stage, reason, ...details });
  return error;
}

async function normalRoleDiagnosticStage(stage, task, reason = 'STAGE_FAILED') {
  try { return await task(); } catch (error) {
    if (error?.normalRoleDiagnostic) throw error;
    throw compatibilityNormalDiagnosticError(stage, reason);
  }
}

export function compatibilityNormalDiagnosticLine(error) {
  return JSON.stringify({ type: 'fcos_normal_role_verification_diagnostic',
    ...normalizeCompatibilityNormalDiagnostic(error?.normalRoleDiagnostic) });
}

export function compatibilityLegacyXeroReadRequest(name, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) return false;
  const keys = Object.keys(body);
  if (name === 'xeroPortalStatus') return keys.length === 0 || keys.length === 1 && keys[0] === 'forceRefresh' && body.forceRefresh === false;
  if (name === 'xeroPortalReceiptsList') return keys.length === 0 || keys.length === 1 && keys[0] === 'limit' && Number.isSafeInteger(body.limit) && body.limit > 0 && body.limit <= 50;
  return ['xeroPortalContactLifecycleLatest', 'xeroPortalContactAutoCreateLatest', 'xeroFinancialSyncLatest', 'xeroFinancialMappingsGet'].includes(name) && keys.length === 0;
}

export function compatibilityNormalRequestAllowed({ url, method, body }, origin) {
  let target;
  try { target = new URL(url); } catch { return false; }
  const supabaseOrigin = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
  if (method === 'GET' || method === 'HEAD') {
    if (target.origin === supabaseOrigin) return /^\/auth\/v1\/user$/.test(target.pathname)
      || /^\/rest\/v1\/[A-Za-z][A-Za-z0-9_]*$/.test(target.pathname);
    if (target.origin !== origin) return false;
    // GET alone is not read authority: cron and other APIs can have side effects.
    if (target.pathname !== '/api' && !target.pathname.startsWith('/api/')) return true;
    return false;
  } else if (method !== 'POST') return false;
  if (target.origin !== origin || !target.pathname.startsWith('/api/functions/')) return false;
  const name = target.pathname.slice('/api/functions/'.length);
  if (!/^[A-Za-z][A-Za-z0-9]+$/.test(name)) return false;
  return normalRoleReadRequest(name, body) || compatibilityLegacyXeroReadRequest(name, body);
}

export function assertCompatibilityNormalIdentity(auth, { approvedEmail } = {}) {
  const user = auth?.user;
  if (!approvedEmail || approvedEmail.toLowerCase() === FCOS_READ_ONLY_CI.email || user?.email?.toLowerCase() !== approvedEmail.toLowerCase()
    || user?.read_only_ci !== false || user?.active !== true || !/^[0-9a-f-]{36}$/.test(user.id || '')
    || !['normal', 'general_manager', 'administrator', 'manager', 'finance', 'operations', 'interoffice', 'viewer'].includes(user.user_type)) throw new Error('Normal-role verification requires the existing approved active non-CI identity, independently read from FCOS.');
  return { role: user.user_type, moduleAccess: auth.moduleAccess || {} };
}

export function compatibilityNormalDataLoaded(spec, payload) {
  const data = payload?.data ?? payload;
  if (!data || typeof data !== 'object' || data.error || data.cancelled || data.status === 'unavailable') return { loaded: false, rows: null };
  const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
  if (spec.module === 'settings') return { loaded: Boolean(data.settings && numeric(data.settings.annualInterestRatePct)
    && numeric(data.settings.bankChargesUsd?.UBS) && numeric(data.settings.bankChargesUsd?.DBS)), rows: null };
  for (const key of spec.fields) if (Array.isArray(data[key])) return { loaded: true, rows: data[key].length };
  return { loaded: false, rows: null };
}

function compatibilityNormalStorage(source, origin) {
  let state;
  try { state = JSON.parse(Buffer.from(source || '', 'base64').toString('utf8')); } catch { throw compatibilityNormalDiagnosticError('STORAGE_STATE', 'STORAGE_INVALID'); }
  if (!Array.isArray(state.origins) || !Array.isArray(state.cookies) || state.origins.some(entry => entry.origin !== origin)
    || state.cookies.some(cookie => cookie.domain?.replace(/^\./, '') !== new URL(origin).hostname)) throw compatibilityNormalDiagnosticError('STORAGE_STATE', 'STORAGE_INVALID');
  const key = `sb-${fcosConnectionIdentifier('supabase', 'Project ref')}-auth-token`;
  const entry = state.origins.find(item => item.origin === origin)?.localStorage?.find(item => item.name === key);
  let token;
  try { token = JSON.parse(entry.value).access_token; } catch { token = undefined; /* STORAGE_INVALID stays blocked. */ }
  if (!token || typeof token !== 'string') throw compatibilityNormalDiagnosticError('STORAGE_STATE', 'STORAGE_INVALID');
  return { state, token };
}

export async function verifyRuntimeCompatibilityNormalRole({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_REPOSITORY !== fcosConnectionIdentifier('github', 'Repository') || env.FCOS_E2E_EXPECTED_COMMIT !== FIRST_RUNTIME_ROLLOUT.candidateSha || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || '')) throw compatibilityNormalDiagnosticError('CONFIGURATION', 'CONFIGURATION_INVALID');
  const scope = await normalRoleDiagnosticStage('SOURCE_SCOPE', () => verifyRuntimeCompatibility({ cwd: fileURLToPath(new URL('..', import.meta.url)),
    baseCommit: FIRST_RUNTIME_ROLLOUT.previousSha, candidateCommit: FIRST_RUNTIME_ROLLOUT.candidateSha }));
  if (!compatibilityReadOnlyGuardsVerified(scope)) throw compatibilityNormalDiagnosticError('SOURCE_SCOPE', 'READ_ONLY_GUARD_MISSING');
  await normalRoleDiagnosticStage('OBSERVATION_SOURCES', () => verifyCompatibilityObservationSources({ cwd: fileURLToPath(new URL('..', import.meta.url)),
    baseSha: FIRST_RUNTIME_ROLLOUT.previousSha, candidateSha: FIRST_RUNTIME_ROLLOUT.candidateSha }));
  const url = await normalRoleDiagnosticStage('CANDIDATE_URL', () => canonicalFcosE2eCandidateUrl(env.FCOS_E2E_CANDIDATE_URL));
  const verified = await normalRoleDiagnosticStage('CANDIDATE_RESOLUTION', () => resolveFcosE2eCandidate({ candidateUrl: url, expectedCommit: env.FCOS_E2E_EXPECTED_COMMIT,
    githubToken: env.GITHUB_TOKEN, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS, fetchImpl, maxWaitMs: 0 }));
  const versionResponse = await normalRoleDiagnosticStage('VERSION_FETCH', () => fetchImpl(`${url}/app-version.json`, { redirect: 'error',
    headers: env.FCOS_E2E_VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.FCOS_E2E_VERCEL_BYPASS } : {}, signal: AbortSignal.timeout(20000) }));
  const version = await normalRoleDiagnosticStage('VERSION_PARSE', () => versionResponse.json());
  const versionStatus = Number.isInteger(versionResponse.status) ? versionResponse.status : undefined;
  if (!versionResponse.ok || versionResponse.redirected || version.commit !== verified.commit || !version.deploymentId
    || !/^[0-9a-f]{64}$/.test(version.provenance?.sourceDigest || '') || version.provenance.releaseEligible !== true) throw compatibilityNormalDiagnosticError('VERSION_PROVENANCE', 'VERSION_INVALID', { status: versionStatus });
  const runtime = await normalRoleDiagnosticStage('RUNTIME_OBSERVATION', () => collectRuntimeObservation({ url, deployment: { id: version.deploymentId, url, sha: verified.commit, createdAt: version.builtAt },
    sourceDigest: version.provenance.sourceDigest, token: env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS, fetchImpl }));
  if (!compatibilityRuntimePreviewVerified(runtime, { id: version.deploymentId, sha: verified.commit })) throw compatibilityNormalDiagnosticError('RUNTIME_SAFETY', 'RUNTIME_SAFETY_FAILED');
  const { state, token } = await normalRoleDiagnosticStage('STORAGE_STATE', () => compatibilityNormalStorage(env.FCOS_NORMAL_ROLE_STORAGE_STATE_BASE64, url), 'STORAGE_INVALID');
  const response = await normalRoleDiagnosticStage('AUTH_FETCH', () => fetchImpl(`${url}/api/functions/authContext`, { method: 'POST', body: '{}', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
      ...(env.FCOS_E2E_VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.FCOS_E2E_VERCEL_BYPASS } : {}) } }));
  const authStatus = Number.isInteger(response.status) ? response.status : undefined;
  if (!response.ok || response.redirected) throw compatibilityNormalDiagnosticError('AUTH_RESPONSE', 'AUTH_RESPONSE_INVALID', { status: authStatus });
  const auth = await normalRoleDiagnosticStage('IDENTITY', () => response.json(), 'IDENTITY_INVALID');
  const identity = await normalRoleDiagnosticStage('IDENTITY', () => assertCompatibilityNormalIdentity(auth, { approvedEmail: env.FCOS_NORMAL_ROLE_APPROVED_EMAIL }), 'IDENTITY_INVALID');
  let browser, context;
  const checks = [];
  const moduleReasons = new Map();
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    let blockedMutations = 0;
    let lastBlockedRequest;
    await context.route('**/*', createNormalRoleVerificationRoute({ origin: url, protectionBypass: env.FCOS_E2E_VERCEL_BYPASS,
      requestAllowed: compatibilityNormalRequestAllowed, onBlockedMutation: reason => {
        blockedMutations += 1;
        if (NORMAL_ROLE_TRANSPORT_BLOCKED_REASONS.includes(reason)) lastBlockedRequest = reason;
      } }));
    for (const spec of COMPATIBILITY_NORMAL_MODULES) {
      if (identity.moduleAccess[spec.module] !== true) {
        moduleReasons.set(spec.module, 'ACCESS_MISSING');
        continue;
      }
      let page, moduleReason, navigationLoaded = false, headingLoaded = false, checkAdded = false;
      const responses = [], failures = [];
      let reviewWorkflowLoaded = false;
      const mutationStart = blockedMutations;
      const blockReason = () => blockedMutations !== mutationStart ? 'BLOCKED_REQUEST' : null;
      const failModule = reason => { if (!moduleReason) moduleReason = reason; };
      try {
        page = await context.newPage();
        page.on('pageerror', () => failures.push('PAGE_ERROR'));
        page.on('response', async res => {
          let pathname;
          try { pathname = new URL(res.url()).pathname; } catch { failures.push('UNAVAILABLE_SURFACE'); return; }
          if (spec.module === 'review' && pathname === '/api/functions/exceptionReviewWorkflowList') {
            try { const data = await res.json(); reviewWorkflowLoaded = res.ok() && !data.error && data.byStemId !== null
              && typeof data.byStemId === 'object' && !Array.isArray(data.byStemId) && Array.isArray(data.ownerOptions); } catch { /* WORKFLOW_MISSING is emitted only if no later valid response qualifies. */ }
          }
          if (pathname !== `/api/functions/${spec.handler}`) return;
          try { if (res.ok()) responses.push(compatibilityNormalDataLoaded(spec, await res.json())); } catch { failures.push('MISSING_DATA'); }
        });
        await page.goto(`${url}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        navigationLoaded = true;
        await page.getByRole('heading', { name: spec.title }).first().waitFor({ timeout: 30000 });
        headingLoaded = true;
        const deadline = Date.now() + 30000;
        while (!responses.some(item => item.loaded) && Date.now() < deadline) await page.waitForTimeout(250);
        const loaded = responses.find(item => item.loaded);
        if (blockReason()) { failModule(blockReason()); continue; }
        if (failures.length) { failModule(failures[0]); continue; }
        if (!loaded) { failModule('MISSING_DATA'); continue; }
        if (/\/login(?:\?|$)/.test(page.url())) { failModule('LOGIN_REDIRECT'); continue; }
        const body = await page.locator('body').innerText();
        if (/Access denied/i.test(body)) { failModule('ACCESS_MISSING'); continue; }
        if (/Something went wrong|temporarily unavailable|could not (?:load|read|verify)|Unavailable/i.test(body)) { failModule('UNAVAILABLE_SURFACE'); continue; }
        if (spec.module === 'settings') {
          if (!await page.getByLabel(/Annual interest rate/i).count()) { failModule('SETTINGS_FIELD_MISSING'); continue; }
        } else if (loaded.rows === 0) {
          if (!/No (?:records|rows|items|invoices|payments|receipts|messages|contracts|terms|trades|positions|data|STEMs|matching|Dispute Workflow)/i.test(body)) { failModule('EMPTY_STATE_MISSING'); continue; }
        } else if (!await page.locator('table tbody tr').count()) { failModule('MISSING_ROWS'); continue; }
        if (spec.workflow) {
          if (spec.module === 'review') {
            // Exercise read-only queue scope and confirm workflow state remains
            // rendered after filtering; no Save/Approve/Settle control is used.
            await page.getByRole('button', { name: 'All', exact: true }).click();
            if (blockReason()) { failModule(blockReason()); continue; }
            if (!await page.locator('table tbody tr').count() && !/No .*found|No .*match/i.test(await page.locator('body').innerText())) { failModule('WORKFLOW_MISSING'); continue; }
            if (!reviewWorkflowLoaded || !responses.some(item => item.loaded)) { failModule('WORKFLOW_MISSING'); continue; }
          } else if (!/Workflow|Next owner/i.test(body) || loaded.rows === 0) { failModule('WORKFLOW_MISSING'); continue; }
        }
        checks.push({ module: spec.module, role: identity.role, result: 'pass', kind: spec.workflow ? 'workflow_read' : 'read',
          evidenceId: `compatibility-normal-role:${env.GITHUB_RUN_ID}:${spec.module}` });
        checkAdded = true;
      } catch { failModule(blockReason() || (navigationLoaded ? (headingLoaded ? 'UNAVAILABLE_SURFACE' : 'MISSING_HEADING') : 'UNAVAILABLE_SURFACE')); }
      finally {
        try { if (page) await page.close(); } catch {
          failModule('UNAVAILABLE_SURFACE');
          if (checkAdded) checks.pop();
        }
        moduleReasons.set(spec.module, moduleReason || 'PASS');
      }
    }
    if (blockedMutations) throw compatibilityNormalDiagnosticError('MODULES', 'BLOCKED_REQUEST', { moduleReasons, blockedRequest: lastBlockedRequest });
  } catch (error) {
    if (error?.normalRoleDiagnostic) throw error;
    throw compatibilityNormalDiagnosticError('BROWSER_SETUP', 'BROWSER_UNAVAILABLE', { moduleReasons });
  } finally {
    await normalRoleDiagnosticStage('BROWSER_SETUP', () => context?.close(), 'BROWSER_UNAVAILABLE');
    await normalRoleDiagnosticStage('BROWSER_SETUP', () => browser?.close(), 'BROWSER_UNAVAILABLE');
  }
  const evidence = { schemaVersion: 1, baseSha: FIRST_RUNTIME_ROLLOUT.previousSha, candidateSha: verified.commit, candidateUrl: url, deploymentId: version.deploymentId,
    sourceDigest: version.provenance.sourceDigest, harnessSha: env.GITHUB_SHA, capturedAt: new Date().toISOString(), checks };
  if (!compatibilityNormalCoverageVerified({ checks }) || checks.length !== COMPATIBILITY_NORMAL_MODULES.length) throw compatibilityNormalDiagnosticError('COVERAGE', 'COVERAGE_INCOMPLETE', { moduleReasons });
  if (!env.RUNNER_TEMP) throw compatibilityNormalDiagnosticError('EVIDENCE', 'EVIDENCE_WRITE_FAILED', { moduleReasons });
  await normalRoleDiagnosticStage('EVIDENCE', () => writeFileSync(join(env.RUNNER_TEMP, 'fcos-normal-role-evidence.json'), `${JSON.stringify(evidence)}\n`, { mode: 0o600, flag: 'wx' }), 'EVIDENCE_WRITE_FAILED');
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRuntimeCompatibilityNormalRole().then(result => console.log(`Verified ${result.checks.length} normal-role read workflows for ${result.candidateSha}.`))
    .catch(error => { console.error(compatibilityNormalDiagnosticLine(error)); process.exitCode = 1; });
}
