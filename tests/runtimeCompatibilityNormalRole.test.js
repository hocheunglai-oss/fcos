import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMPATIBILITY_NORMAL_MODULES, compatibilityNormalRequestAllowed, assertCompatibilityNormalIdentity,
  compatibilityNormalDataLoaded, verifyRuntimeCompatibilityNormalRole, compatibilityLegacyXeroReadRequest,
  compatibilityNormalDiagnosticError, compatibilityNormalDiagnosticLine, compatibilityNormalModuleTerminalReason, createCompatibilityNormalResponseSettlement, compatibilityNormalReadResponse, createCompatibilityNormalResponseObserver } from '../scripts/runtime-compatibility-normal-role.mjs';
import { FIRST_RUNTIME_ROLLOUT, compatibilityReadOnlyGuardsVerified } from '../scripts/lib/runtime-compatibility-release.mjs';
import { verifyRuntimeCompatibility } from '../scripts/verify-runtime-compatibility.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
const url = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';

test('compatibility catalogue freezes all required old real-data paths without importing the evolving full release verifier', () => {
  assert.equal(COMPATIBILITY_NORMAL_MODULES.length, 15);
  assert.equal(COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'xero_portal').handler, 'xeroPortalReceiptsList');
  assert.equal(COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'review').workflow, true);
  const source = readFileSync(new URL('../scripts/runtime-compatibility-normal-role.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]\.\/normal-role-release\.mjs|xeroIntegrityReport/);
  assert.match(source, /baseSha: FIRST_RUNTIME_ROLLOUT.previousSha/);
  assert.match(source, /collectPreviewEmailSignerEvidence/);
  assert.match(source, /emailSigner/);
});

test('separate compatibility normal transport refuses writes, refresh, unknown APIs and foreign origins', () => {
  assert.equal(compatibilityNormalRequestAllowed({ url: `${url}/api/functions/authContext`, method: 'POST', body: {} }, url), true);
  for (const request of [
    { url: `${url}/api/functions/hedgeDeskEntity`, method: 'POST', body: { action: 'create' } },
    { url: `${url}/api/functions/hedgeDeskEntity`, method: 'POST', body: { action: 'unknown' } },
    { url: `${url}/api/functions/hedgeDeskEntity`, method: 'POST', body: { action: 'list', entity: 'Unknown' } },
    { url: `${url}/api/functions/hedgeMarkets`, method: 'POST', body: { action: 'market_report_import' } },
    { url: `${url}/api/functions/xeroPortalStatus`, method: 'POST', body: { forceRefresh: true } },
    { url: `${url}/api/functions/disputeWorkflowApprove`, method: 'POST', body: {} },
    { url: `${url}/api/functions/unknown`, method: 'POST', body: {} },
    { url: `${url}/api/functions/marketReportDriveSyncCron`, method: 'GET' },
    { url: 'https://foreign.example/collect', method: 'GET' },
    { url: `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co/auth/v1/token?grant_type=refresh_token`, method: 'POST', body: {} },
  ]) assert.equal(compatibilityNormalRequestAllowed(request, url), false);
  for (const action of ['list', 'filter', 'get', 'snapshot']) {
    for (const entity of ['PhysicalTrade', 'SwapHedge', 'MopsPrice', 'ClearingAccount', 'Invoice', 'Counterparty', 'AppConfig']) {
      const body = action === 'snapshot' ? { action } : { action, entity, ...(action === 'get' ? { id: 'actual-read-id' } : {}) };
      assert.equal(compatibilityNormalRequestAllowed({ url: `${url}/api/functions/hedgeDeskEntity`, method: 'POST', body }, url), true);
    }
  }
  assert.equal(compatibilityNormalRequestAllowed({ url: `${url}/api/functions/hedgeMarkets`, method: 'POST', body: { action: 'snapshot' } }, url), true);
  assert.equal(compatibilityNormalRequestAllowed({ url: `${url}/api/functions/xeroPortalStatus`, method: 'POST', body: {} }, url), true);
  for (const body of [{ action: 'snapshot', refresh: false }, { action: 'list', entity: 'AppConfig', params: { force_update: false } },
    { action: 'filter', entity: 'AppConfig', params: { nested: { mutation: false } } }]) {
    assert.equal(compatibilityNormalRequestAllowed({ url: `${url}/api/functions/hedgeDeskEntity`, method: 'POST', body }, url), false);
  }
  assert.equal(compatibilityLegacyXeroReadRequest('xeroPortalStatus', { forceRefresh: false }), true);
  assert.equal(compatibilityLegacyXeroReadRequest('xeroPortalReceiptsList', { limit: 50 }), true);
  assert.equal(compatibilityLegacyXeroReadRequest('xeroFinancialSyncLatest', {}), true);
  assert.equal(compatibilityLegacyXeroReadRequest('xeroFinancialMappingsGet', {}), true);
  for (const [name, body] of [['xeroFinancialMappingsGet', { forceRefresh: false }], ['xeroFinancialMappingsGet', { filters: { refresh: false } }], ['xeroPortalReceiptsList', { limit: 51 }],
    ['xeroPortalReceiptsList', { limit: 50, filters: { forceRefresh: false } }], ['xeroPortalStatus', { forceRefresh: true }],
    ['xeroPortalContactLifecycleLatest', { refresh: false }]]) assert.equal(compatibilityLegacyXeroReadRequest(name, body), false);
});

test('FCOS API GET and HEAD never fall through to POST classifiers when bodies are absent or empty', () => {
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/api', '/api/functions/authContext', '/api/functions/xeroPortalStatus']) {
      assert.equal(compatibilityNormalRequestAllowed({ url: `${url}${path}`, method }, url), false);
      assert.equal(compatibilityNormalRequestAllowed({ url: `${url}${path}`, method, body: {} }, url), false);
    }
    assert.equal(compatibilityNormalRequestAllowed({ url: `${url}/assets/index-fixture.js`, method }, url), true);
  }
  const supabase = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
  for (const path of ['/auth/v1/user', '/rest/v1/profiles']) {
    assert.equal(compatibilityNormalRequestAllowed({ url: `${supabase}${path}`, method: 'GET' }, url), true);
  }
});

test('independent final five-guard source proof allows safe real reads and rejects the original unsafe candidate', async () => {
  const env = { FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true', GITHUB_REPOSITORY: fcosConnectionIdentifier('github', 'Repository'),
    GITHUB_SHA: 'a'.repeat(40), FCOS_E2E_EXPECTED_COMMIT: FIRST_RUNTIME_ROLLOUT.candidateSha, FCOS_E2E_CANDIDATE_URL: url };
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const scope = verifyRuntimeCompatibility({ cwd, baseCommit: FIRST_RUNTIME_ROLLOUT.previousSha, candidateCommit: FIRST_RUNTIME_ROLLOUT.candidateSha });
  assert.equal(compatibilityReadOnlyGuardsVerified(scope), true);
  assert.equal(scope.readOnlyGuards.length, 5);
  assert.ok(Object.values(scope.preservation).every(Boolean));
  await assert.rejects(() => verifyRuntimeCompatibilityNormalRole({ env: { ...env, FCOS_E2E_EXPECTED_COMMIT: '33d97ea74439e27128fd148df78a1e6be6a2f844' }, fetchImpl: () => assert.fail('no unsafe legacy session use') }));
  for (const file of ['api/_hedgeDeskService.js', 'api/_xeroPortal.js', 'api/functions/[name].js', 'api/_xeroContactSync.js', 'api/_emailRouterCore.js']) {
    const get = ref => execFileSync('git', ['show', `${ref}:${file}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.notEqual(get(FIRST_RUNTIME_ROLLOUT.previousSha), get(FIRST_RUNTIME_ROLLOUT.candidateSha));
    if (file.includes('hedge')) { assert.match(get(FIRST_RUNTIME_ROLLOUT.candidateSha), /expiryAutomation = isDeploymentReadOnly\(\)/); assert.match(get(FIRST_RUNTIME_ROLLOUT.candidateSha), /requireDeploymentMutationAllowed\(!isReadOnlyHedgeDeskAction\(body\)\)/); }
    else if (file.includes('ContactSync')) {
      const candidate = get(FIRST_RUNTIME_ROLLOUT.candidateSha);
      const read = candidate.indexOf('export async function getFreshXeroConnection');
      const valid = candidate.indexOf('return stored;', read), guard = candidate.indexOf('requireDeploymentMutationAllowed(true, env);', read);
      assert.ok(valid < guard && guard < candidate.indexOf('const config = xeroConfig', read) && guard < candidate.indexOf('control.claimRefresh', read));
    }
    else if (file.includes('emailRouter')) {
      const candidate = get(FIRST_RUNTIME_ROLLOUT.candidateSha);
      assert.match(candidate, /if \(!isDeploymentReadOnly\(dependencies\.env \|\| process\.env\)\) await syncEmailRouterMetadata/);
      const guard = candidate.indexOf('if (indexed && !isDeploymentReadOnly(dependencies.env || process.env)) {');
      assert.ok(guard >= 0 && guard < candidate.indexOf('const metadataJob = synchronizeEmailRouterAttachmentMetadata'));
    }
    else if (file.includes('xero')) assert.match(get(FIRST_RUNTIME_ROLLOUT.candidateSha), /if \(!isDeploymentReadOnly\(env\) && shouldRefresh/);
    else assert.match(get(FIRST_RUNTIME_ROLLOUT.candidateSha), /name === 'hedgeDeskEntity' \? !isReadOnlyHedgeDeskAction\(body\)/);
  }
  const source = readFileSync(new URL('../scripts/runtime-compatibility-normal-role.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('compatibilityReadOnlyGuardsVerified(scope)') < source.indexOf('FCOS_NORMAL_ROLE_STORAGE_STATE_BASE64, url'));
  assert.match(source, /compatibilityRuntimePreviewVerified\(runtime/);
});

test('the old immutable four-guard candidate fails source completeness and normal verification before credential access', async () => {
  const oldCandidate = 'f3d4cadfbaad7c25c83205350bb9be572493f47c';
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  assert.throws(() => verifyRuntimeCompatibility({ cwd, baseCommit: FIRST_RUNTIME_ROLLOUT.previousSha, candidateCommit: oldCandidate }), /Complete read-only/);
  assert.deepEqual(execFileSync('git', ['diff', '--name-only', oldCandidate, FIRST_RUNTIME_ROLLOUT.candidateSha], { cwd, encoding: 'utf8' }).trim().split('\n'),
    ['api/_emailRouterCore.js', 'tests/emailRouterReadOnly.test.js']);
  const env = { FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true', GITHUB_REPOSITORY: fcosConnectionIdentifier('github', 'Repository'),
    GITHUB_SHA: 'a'.repeat(40), FCOS_E2E_EXPECTED_COMMIT: oldCandidate,
    get FCOS_NORMAL_ROLE_STORAGE_STATE_BASE64() { assert.fail('old source must never read credentials'); },
  };
  await assert.rejects(() => verifyRuntimeCompatibilityNormalRole({ env, fetchImpl: () => assert.fail('old source must never use network') }),
    error => error.normalRoleDiagnostic?.stage === 'CONFIGURATION' && error.normalRoleDiagnostic?.reason === 'CONFIGURATION_INVALID');
});

test('active real identity and loaded business data are mandatory; inactive/CI/headings/null settings do not qualify', () => {
  const user = { id: '12345678-1234-1234-1234-123456789abc', email: 'approved@example.test', active: true, read_only_ci: false, user_type: 'finance' };
  assert.equal(assertCompatibilityNormalIdentity({ user, moduleAccess: { review: true } }, { approvedEmail: user.email }).role, 'finance');
  for (const changed of [{ ...user, active: false }, { ...user, read_only_ci: true }, { ...user, user_type: 'local_admin' }]) {
    assert.throws(() => assertCompatibilityNormalIdentity({ user: changed }, { approvedEmail: user.email }));
  }
  const dashboard = COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'dashboard');
  assert.equal(compatibilityNormalDataLoaded(dashboard, { heading: 'Dashboard' }).loaded, false);
  assert.deepEqual(compatibilityNormalDataLoaded(dashboard, { stems: [] }), { loaded: true, rows: 0 });
  const settings = COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'settings');
  assert.equal(compatibilityNormalDataLoaded(settings, { settings: { annualInterestRatePct: null, bankChargesUsd: { UBS: null, DBS: null } } }).loaded, false);
});

test('disabled or unprotected normal workflow and every different candidate fail before credentials or browser are used', async () => {
  const env = { FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true', GITHUB_REPOSITORY: fcosConnectionIdentifier('github', 'Repository'),
    GITHUB_SHA: 'a'.repeat(40), FCOS_E2E_EXPECTED_COMMIT: FIRST_RUNTIME_ROLLOUT.candidateSha, FCOS_E2E_CANDIDATE_URL: url };
  for (const changed of [{ ...env, FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'false' }, { ...env, GITHUB_REF_PROTECTED: 'false' },
    { ...env, FCOS_E2E_EXPECTED_COMMIT: 'f'.repeat(40) }, { ...env, GITHUB_REPOSITORY: 'fork/fcos' }]) {
    await assert.rejects(() => verifyRuntimeCompatibilityNormalRole({ env: changed, fetchImpl: () => assert.fail('no network or credential use') }));
  }
  const workflow = readFileSync(new URL('../.github/workflows/runtime-compatibility-normal-role.yml', import.meta.url), 'utf8');
  assert.match(workflow, /vars.FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED == 'true'/);
  assert.match(workflow, /environment: fcos-normal-role-verification/);
  assert.match(workflow, /deployments: read/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.doesNotMatch(workflow, /(?:contents|actions|deployments): write|working-directory: candidate/);
});

test('normal-role diagnostics contain only fixed stages, reasons, module-handler pairs, and safe status codes', () => {
  const secret = 'private-token-and-url-value';
  const modules = new Map([['dashboard', 'MISSING_DATA'], ['settings', 'SETTINGS_FIELD_MISSING'], ['review', secret]]);
  const line = compatibilityNormalDiagnosticLine({ normalRoleDiagnostic: {
    stage: 'AUTH_RESPONSE', reason: 'AUTH_RESPONSE_INVALID', module: 'dashboard', handler: 'dashboardStemList', status: 403,
    moduleReasons: modules, blockedRequest: 'NO_REDIRECT_RESPONSE', error: secret, url: `https://private.example/${secret}`,
    body: { secret }, headers: { authorization: secret }, storage: secret,
  } });
  const diagnostic = JSON.parse(line);
  assert.deepEqual(Object.keys(diagnostic), ['type', 'stage', 'reason', 'module', 'handler', 'status', 'modules', 'blockedRequest']);
  assert.equal(diagnostic.type, 'fcos_normal_role_verification_diagnostic');
  assert.equal(diagnostic.stage, 'AUTH_RESPONSE');
  assert.equal(diagnostic.reason, 'AUTH_RESPONSE_INVALID');
  assert.equal(diagnostic.status, 403);
  assert.equal(diagnostic.modules.length, COMPATIBILITY_NORMAL_MODULES.length);
  assert.deepEqual(diagnostic.modules.find(row => row.module === 'dashboard'), { module: 'dashboard', handler: 'dashboardStemList', reason: 'MISSING_DATA' });
  assert.deepEqual(diagnostic.modules.find(row => row.module === 'review'), { module: 'review', handler: 'salesforceDashboardFiltered', reason: 'NOT_REACHED' });
  assert.doesNotMatch(line, new RegExp(secret));
  assert.doesNotMatch(line, /private\.example|authorization|storage|body/i);
  const fallback = JSON.parse(compatibilityNormalDiagnosticLine({ normalRoleDiagnostic: { stage: secret, reason: secret, module: 'unknown', handler: secret, status: 999 } }));
  assert.deepEqual(fallback, { type: 'fcos_normal_role_verification_diagnostic', stage: 'CONFIGURATION', reason: 'STAGE_FAILED' });
  const rebuilt = JSON.parse(compatibilityNormalDiagnosticLine({ normalRoleDiagnostic: {
    stage: 'COVERAGE', reason: 'COVERAGE_INCOMPLETE', moduleReasons: { get: () => { throw new Error(secret); } },
    modules: [{ module: 'dashboard', handler: 'dashboardStemList', reason: 'MISSING_DATA', private: secret },
      { module: secret, handler: secret, reason: 'PASS', private: secret }],
  } }));
  assert.equal(rebuilt.modules.length, COMPATIBILITY_NORMAL_MODULES.length);
  assert.deepEqual(rebuilt.modules.find(row => row.module === 'dashboard'), { module: 'dashboard', handler: 'dashboardStemList', reason: 'MISSING_DATA' });
  assert.doesNotMatch(JSON.stringify(rebuilt), new RegExp(secret));
});

test('initial protected-harness failures identify a constant stage without invoking fetch or emitting private values', async () => {
  const secret = 'private-normal-role-secret';
  await assert.rejects(() => verifyRuntimeCompatibilityNormalRole({ env: { FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: secret },
    fetchImpl: () => assert.fail('disabled verification must not fetch') }), error => {
    const diagnostic = JSON.parse(compatibilityNormalDiagnosticLine(error));
    assert.deepEqual(diagnostic, { type: 'fcos_normal_role_verification_diagnostic', stage: 'CONFIGURATION', reason: 'CONFIGURATION_INVALID' });
    assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(secret));
    return true;
  });
});

test('diagnostic error lifecycle retains the rebuilt safe module catalogue through final emission', () => {
  const error = compatibilityNormalDiagnosticError('COVERAGE', 'COVERAGE_INCOMPLETE', { moduleReasons: new Map([
    ['dashboard', 'MISSING_DATA'], ['settings', 'SETTINGS_FIELD_MISSING'], ['review', 'WORKFLOW_MISSING'],
  ]) });
  const diagnostic = JSON.parse(compatibilityNormalDiagnosticLine(error));
  assert.equal(diagnostic.stage, 'COVERAGE');
  assert.equal(diagnostic.reason, 'COVERAGE_INCOMPLETE');
  assert.equal(diagnostic.modules.length, COMPATIBILITY_NORMAL_MODULES.length);
  assert.deepEqual(diagnostic.modules.find(row => row.module === 'dashboard'), { module: 'dashboard', handler: 'dashboardStemList', reason: 'MISSING_DATA' });
  assert.deepEqual(diagnostic.modules.find(row => row.module === 'review'), { module: 'review', handler: 'salesforceDashboardFiltered', reason: 'WORKFLOW_MISSING' });
  assert.deepEqual(diagnostic.modules.find(row => row.module === 'markets'), { module: 'markets', handler: 'hedgeMarkets', reason: 'NOT_REACHED' });
});


test('new denied-request diagnostics keep only bounded fixed categories without URLs, bodies or selectors', () => {
  const secret = 'private-request-selector-and-token';
  const diagnostic = JSON.parse(compatibilityNormalDiagnosticLine({ normalRoleDiagnostic: { stage: 'MODULES', reason: 'BLOCKED_REQUEST', deniedRequests: [
    { category: 'BACKGROUND_SYNC', method: 'POST', resourceType: 'fetch', count: 2, url: secret, body: secret, functionName: secret, headers: secret },
    { category: 'AUTH_REFRESH', method: 'POST', resourceType: 'xhr', count: 1 },
    { category: secret, method: 'POST', resourceType: 'fetch', count: 1 },
    { category: 'UNKNOWN', method: secret, resourceType: 'fetch', count: 1 },
    { category: 'UNKNOWN', method: 'GET', resourceType: 'script', count: 1001 },
  ] } }));
  assert.deepEqual(diagnostic.deniedRequests, [{ category: 'BACKGROUND_SYNC', method: 'POST', resourceType: 'fetch', count: 2 },
    { category: 'AUTH_REFRESH', method: 'POST', resourceType: 'xhr', count: 1 }]);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|selector|token|url|body|headers/);
});


test('late page errors, escaped mutations and failed cleanup withdraw previously successful module coverage', () => {
  assert.equal(compatibilityNormalModuleTerminalReason(), null);
  const failures = [];
  assert.equal(compatibilityNormalModuleTerminalReason({ failures }), null);
  failures.push('PAGE_ERROR');
  assert.equal(compatibilityNormalModuleTerminalReason({ failures }), 'PAGE_ERROR');
  assert.equal(compatibilityNormalModuleTerminalReason({ reason: 'MISSING_ROWS', failures }), 'PAGE_ERROR');
  assert.equal(compatibilityNormalModuleTerminalReason({ blocked: true }), 'BLOCKED_REQUEST');
  assert.equal(compatibilityNormalModuleTerminalReason({ closeFailed: true }), 'UNAVAILABLE_SURFACE');
  assert.equal(compatibilityNormalModuleTerminalReason({ reason: 'MISSING_ROWS' }), 'MISSING_ROWS');
});


test('credential-free Chromium isolation is mandatory after install and before the live credential-bearing verifier', () => {
  const workflow = readFileSync(new URL('../.github/workflows/runtime-compatibility-normal-role.yml', import.meta.url), 'utf8');
  const install = workflow.indexOf('npx playwright install --with-deps chromium');
  const integration = workflow.indexOf('node --test tests/compatibility-browser-isolation.chromium.mjs');
  const live = workflow.indexOf('run: node scripts/runtime-compatibility-normal-role.mjs');
  assert.ok(install < integration && integration < live);
  const step = workflow.slice(workflow.lastIndexOf('      - name:', integration), workflow.indexOf('      - name:', integration));
  assert.doesNotMatch(step, /env:|secrets\.|continue-on-error|if:/);
  const unit = readFileSync(new URL('./compatibility-browser-isolation.test.js', import.meta.url), 'utf8');
  assert.doesNotMatch(unit, /chromium\.launch|before\(async/);
});


test('deferred relevant JSON rejection after page closure withdraws an earlier real-data pass', async () => {
  const tracker = createCompatibilityNormalResponseSettlement({ timeoutMs: 1000 }), failures = [];
  let rejectJson, closed = false;
  const json = new Promise((_, reject) => { rejectJson = reject; });
  tracker.track(json.catch(() => { failures.push('MISSING_DATA'); }));
  assert.equal(compatibilityNormalModuleTerminalReason({ failures }), null, 'earlier data/UI was tentatively successful');
  closed = true;
  setImmediate(() => { assert.equal(closed, true); rejectJson(new Error('private deferred response content')); });
  await tracker.settle();
  assert.equal(compatibilityNormalModuleTerminalReason({ failures }), 'MISSING_DATA');
});

test('hung or rejected relevant JSON observers fail the short settlement deadline with safe fixed reason', async () => {
  const hung = createCompatibilityNormalResponseSettlement({ timeoutMs: 20 });
  hung.track(new Promise(() => {}));
  await assert.rejects(() => hung.settle(), error => error.message === 'MISSING_DATA');
  const rejected = createCompatibilityNormalResponseSettlement({ timeoutMs: 1000 });
  rejected.track(Promise.reject(new Error('private malformed response')));
  await assert.rejects(() => rejected.settle(), error => error.message === 'MISSING_DATA');
});


test('deferred fulfilled but invalid review-workflow JSON withdraws tentative workflow coverage after settlement', async () => {
  const tracker = createCompatibilityNormalResponseSettlement({ timeoutMs: 1000 });
  let resolveJson, reviewWorkflowLoaded = true;
  const json = new Promise(resolve => { resolveJson = resolve; });
  tracker.track(json.then(data => { reviewWorkflowLoaded = !data.error && data.byStemId !== null
    && typeof data.byStemId === 'object' && !Array.isArray(data.byStemId) && Array.isArray(data.ownerOptions); }));
  assert.equal(compatibilityNormalModuleTerminalReason({ workflowRequired: true, workflowLoaded: reviewWorkflowLoaded }), null);
  setImmediate(() => resolveJson({ byStemId: null, ownerOptions: [] }));
  await tracker.settle();
  assert.equal(compatibilityNormalModuleTerminalReason({ workflowRequired: true, workflowLoaded: reviewWorkflowLoaded }), 'WORKFLOW_MISSING');
  assert.equal(compatibilityNormalModuleTerminalReason({ failures: ['MISSING_DATA'], workflowRequired: true, workflowLoaded: false }), 'MISSING_DATA');
});


test('reviewed Exception Review and master detail shapes pass while aliases, extra controls and reconcile never do', () => {
  const review = { mode: 'exception_review', trendYear: 2026, dateBasis: 'exception_schedule', dateWindows: [{ startDate: '2026-10-01', endDate: '2026-10-31' }] };
  const master = { contractId: '12345678-1234-4234-8234-123456789abc', includeLive: true, force: false };
  const allowed = (name, body) => compatibilityNormalRequestAllowed({ url: `${url}/api/functions/${name}`, method: 'POST', body }, url);
  assert.equal(allowed('salesforceDashboardFiltered', review), true);
  assert.equal(allowed('masterContractDetail', master), true);
  assert.equal(allowed('masterContractDetail', { ...master, includeLive: false }), true);
  for (const body of [
    { ...review, Mode: 'exception_review' }, { ...review, mode: 'apply' }, { ...review, action: 'list' },
    { ...review, trendYear: '2026' }, { ...review, dateBasis: 'dashboard' }, { ...review, dateWindows: [] },
    { ...review, dateWindows: Array(37).fill(review.dateWindows[0]) },
    { ...review, dateWindows: [{ startDate: '2026-02-30', endDate: '2026-10-31' }] },
    { ...review, dateWindows: [{ startDate: '2026-10-31', endDate: '2026-10-01' }] },
    { ...review, dateWindows: [{ startDate: '2020-01-01', endDate: '2026-10-31' }] },
    { ...review, dateWindows: [{ ...review.dateWindows[0], mode: 'exception_review' }] },
    { ...review, dateWindows: [{ ...review.dateWindows[0], force_refresh: false }] },
  ]) assert.equal(allowed('salesforceDashboardFiltered', body), false);
  assert.equal(allowed('dashboardStemList', review), false, 'selector exemption cannot cross handlers');
  for (const body of [{ ...master, force: true }, { ...master, force: undefined }, { ...master, contractId: 'bad' },
    { ...master, contractId: '12345678-1234-1234-1234-123456789abc' }, { ...master, includeLive: 'true' },
    { ...master, mode: 'list' }, { ...master, options: { refresh: false } }, { ...master, force_update: false },
    { contractId: master.contractId, includeLive: true, Force: false }]) assert.equal(allowed('masterContractDetail', body), false);
  for (const body of [{ force: false }, { force: true }, {}]) assert.equal(allowed('paymentCollectionsReconcile', body), false);
});

const moduleSpec = module => COMPATIBILITY_NORMAL_MODULES.find(row => row.module === module);

test('module response diagnostics distinguish HTTP, JSON, shape, absent and pending outcomes without leaking private data', async () => {
  const secret = 'private-email-address-subject-id-url-token';
  const spec = moduleSpec('email_router');
  const outcomes = [
    await compatibilityNormalReadResponse(spec, { ok: () => false, json: () => assert.fail('non-2xx does not need a private body') }),
    await compatibilityNormalReadResponse(spec, { ok: () => true, json: async () => { throw new Error(secret); } }),
    await compatibilityNormalReadResponse(spec, { ok: () => true, json: async () => ({ error: secret, messages: [] }) }),
  ];
  assert.deepEqual(outcomes.map(row => row.reason), ['DATA_NON_2XX', 'DATA_JSON_FAILURE', 'DATA_SHAPE_REJECTED']);
  assert.deepEqual(await compatibilityNormalReadResponse(spec, { ok: () => true, json: async () => ({ messages: [{ id: secret, subject: secret }] }) }), { loaded: true, rows: 1 });
  for (const reason of [...outcomes.map(row => row.reason), 'DATA_NO_RESPONSE', 'DATA_DEADLINE']) {
    const line = compatibilityNormalDiagnosticLine(compatibilityNormalDiagnosticError('MODULES', reason, { module: spec.module, handler: spec.handler, body: secret, error: secret }));
    assert.equal(JSON.parse(line).reason, reason);
    assert.doesNotMatch(line, new RegExp(secret));
    assert.equal(compatibilityNormalModuleTerminalReason({ failures: [reason] }), reason);
    assert.equal(compatibilityNormalModuleTerminalReason({ failures: [reason], blocked: true }), 'BLOCKED_REQUEST');
  }
  const source = readFileSync(new URL('../scripts/runtime-compatibility-normal-role.mjs', import.meta.url), 'utf8');
  assert.ok(source.lastIndexOf('if (blockedMutations) throw') > source.indexOf('await context?.close()'), 'late mutation denial after cleanup stays fatal');
  assert.match(source, /checks.length !== COMPATIBILITY_NORMAL_MODULES.length/);
});


test('actual workflow response observer keeps invalid then valid and valid then late invalid completions fatal', async () => {
  const spec = moduleSpec('review');
  const valid = { byStemId: {}, ownerOptions: [] };
  for (const invalid of [null, { byStemId: null, ownerOptions: [] }, { byStemId: {}, ownerOptions: 'bad' }, { ...valid, error: 'private-workflow-subject-token' }]) {
    for (const invalidFirst of [true, false]) {
      const failures = [], responses = [], settlement = createCompatibilityNormalResponseSettlement({ timeoutMs: 1000 });
      const observer = createCompatibilityNormalResponseObserver(spec, settlement, responses, failures);
      let finishFirst, finishLast;
      const first = new Promise(resolve => { finishFirst = resolve; });
      const last = new Promise(resolve => { finishLast = resolve; });
      const response = json => ({ url: () => 'https://offline.invalid/api/functions/exceptionReviewWorkflowList', ok: () => true, json: () => json });
      observer.observe(response(first)); observer.observe(response(last));
      finishFirst(invalidFirst ? invalid : valid);
      await new Promise(resolve => setImmediate(resolve));
      if (!invalidFirst) assert.equal(observer.state.workflowLoaded, true, 'earlier pass is tentative');
      // Mirror page-close settlement: the last JSON resolves after cleanup starts.
      setImmediate(() => finishLast(invalidFirst ? valid : invalid));
      await settlement.settle();
      assert.ok(failures.includes('DATA_SHAPE_REJECTED'));
      assert.equal(compatibilityNormalModuleTerminalReason({ failures, workflowRequired: true, workflowLoaded: observer.state.workflowLoaded }), 'DATA_SHAPE_REJECTED');
      const diagnostic = compatibilityNormalDiagnosticLine(compatibilityNormalDiagnosticError('MODULES', 'DATA_SHAPE_REJECTED', { module: spec.module, handler: spec.handler }));
      assert.doesNotMatch(diagnostic, /private-workflow/);
    }
  }
});
