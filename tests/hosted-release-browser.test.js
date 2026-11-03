import { safeFailure } from '../scripts/lib/hosted-release/controller.mjs';
import { safeDiagnosticFailure, safeRuntimeLoginFailure, safeRuntimeLoginObservation, safeHostedBrowserDiagnostic, safeHostedBrowserResultFields } from '../scripts/lib/hosted-release/failure.mjs';
import { ReleaseError } from '../scripts/lib/hosted-release/json-contract.mjs';
import { restrictedBrowserReportDiagnostic, safeRestrictedBrowserDiagnostic } from '../scripts/lib/hosted-release/restricted-browser-report.mjs';
import { releaseResultSummary } from '../scripts/hosted-release.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { admitVercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { COMPATIBILITY_NORMAL_MODULES, BE6_COMPATIBILITY_NORMAL_MODULES, verifyRuntimeCompatibilityNormalRole } from '../scripts/runtime-compatibility-normal-role.mjs';
import { ORDINARY_BROWSER_CANDIDATE } from '../scripts/lib/hosted-release/browser-profile.mjs';
import { NORMAL_ROLE_MODULES } from '../scripts/normal-role-release.mjs';
import { PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID } from '../scripts/lib/preview-email-signer.mjs';
import { runHostedBrowser, loginHostedFcuno, runHostedRestrictedHarness, createHostedRuntimeTokenProvider,
  assertHostedBrowserBinding, assertHostedBrowserComposition, recheckHostedPreviewProvider, hostedBrowserLaunchEnvironment } from '../scripts/lib/hosted-release/browser.mjs';

const FROZEN = '04ee3425aac7a49089eda781eb3c976aea1f6785';
const origin = 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const digest = v => createHash('sha256').update(canonical(v)).digest('hex');
const parity = JSON.parse(readFileSync(new URL('../config/preview-parity-policy.json', import.meta.url)));
function identity(mode = 'normal_role', email = 'normal@example.invalid', role = 'finance') {
  return { user: { id: '12345678-1234-1234-1234-123456789abc', email: mode === 'restricted' ? FCOS_READ_ONLY_CI.email : email,
    active: true, read_only_ci: mode === 'restricted', user_type: mode === 'restricted' ? 'viewer' : role },
    moduleAccess: Object.fromEntries((mode === 'restricted' ? FCOS_READ_ONLY_CI.modules : COMPATIBILITY_NORMAL_MODULES.map(s => s.module)).map(m => [m, true])), capabilities: { write: false } };
}
function isolation(manifest, preview) {
  return { schemaVersion: 1, kind: 'fcos_compatibility_browser_isolation', candidateUrl: origin, candidateSha: manifest.candidate.sha,
    harnessSha: manifest.controller.sha, deploymentId: preview.id, sourceDigest: manifest.candidate.sourceSha256,
    guardian: { path: '/app-version.json', contentType: 'application/json', provenanceVerified: true, closed: true },
    backgroundSync: { excludedFeature: 'automatic_mailbox_sync', lockName: 'fcos:email-router-background-sync', mode: 'exclusive', sameContext: true, webLocks: true, broadcastChannel: true, acquiredBeforeNavigation: true,
      modules: COMPATIBILITY_NORMAL_MODULES.map(s => ({ module: s.module, before: true, after: true })), finalHeld: true, released: true },
    workspacePreferences: { handler: 'workspacePreferencesGet', initialized: true, responseVerified: true },
    telemetry: { excludedFeature: 'speed_insights', path: '/_vercel/speed-insights/script.js', method: 'GET', resourceType: 'script', noQuery: true, policy: 'abort_before_execution', abortedRequests: 0 }, blockedRequests: 0, contextClosed: true };
}
function fixture(t, mode = 'restricted') {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-hosted-browser-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const events = [], capturedAt = new Date().toISOString();
  const expectedPreview = { flags: Object.fromEntries(parity.runtimeFlags.map(k => [k, { state: 'known', value: false }])),
    safety: { readOnly: true, externalActions: Object.fromEntries(parity.externalActions.map(k => [k, false])) }, auth: {} };
  const manifest = { schemaVersion: 2, contract: 'fcos-hosted-release/v2', candidate: { sha: FROZEN, sourceSha256: 'a'.repeat(64), lockSha256: 'b'.repeat(64), configurationSha256: 'c'.repeat(64) }, controller: { sha: 'd'.repeat(40) },
    targets: { repository: fcosConnectionIdentifier('github', 'Repository'), vercelProject: fcosConnectionIdentifier('vercel', 'Project ID'), vercelTeam: fcosConnectionIdentifier('vercel', 'Team ID'),
      supabaseProject: fcosConnectionIdentifier('supabase', 'Project ref'), productionOrigin: new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin }, runtime: { expectedPreview } };
  const preview = { id: 'dpl_testPreview', url: origin, projectId: manifest.targets.vercelProject, teamId: manifest.targets.vercelTeam, sha: manifest.candidate.sha,
    state: 'READY', target: 'preview', manifestHash: digest(manifest), createdAt: Date.now() - 1000 };
  const runtime = { capturedAt, deploymentId: preview.id, sha: manifest.candidate.sha, ...expectedPreview };
  const version = { commit: manifest.candidate.sha, deploymentId: preview.id, provenance: { sourceDigest: manifest.candidate.sourceSha256, releaseEligible: true }, builtAt: capturedAt };
  const sourceReceipt = { sourceVerified: true, observationSourcesVerified: true, candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha,
    sourceDigest: manifest.candidate.sourceSha256, lockSha256: manifest.candidate.lockSha256, configurationSha256: manifest.candidate.configurationSha256, manifestHash: digest(manifest) };
  const sourceHashes = Object.fromEntries(['api/_emailRouterCore.js', 'api/_emailRouterHandlers.js', 'api/functions/[name].js'].map(p => [p, 'e'.repeat(64)]));
  const signerProof = { sourceVerified: true, candidateSha: manifest.candidate.sha, sourceDigest: manifest.candidate.sourceSha256, manifestHash: digest(manifest), sourceHashes };
  const emailSigner = { schemaVersion: 1, kind: 'fcos_preview_email_signer', probe: 'synthetic_attachment_link_v1', capturedAt, deploymentId: preview.id,
    sha: manifest.candidate.sha, sourceDigest: manifest.candidate.sourceSha256, mailboxRegistryId: PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID, result: 'pass', noAttachmentFetch: true, sourceHashes };
  const state = { origins: [{ origin, localStorage: [{ name: `sb-${fcosConnectionIdentifier('supabase', 'Project ref')}-auth-token`, value: JSON.stringify({ access_token: 'PRIVATE_NEW_TEST_TOKEN' }) }] }], cookies: [] };
  const evidence = { candidateSha: manifest.candidate.sha, harnessSha: manifest.controller.sha, deploymentId: preview.id, candidateUrl: origin,
    sourceDigest: manifest.candidate.sourceSha256, capturedAt, checks: COMPATIBILITY_NORMAL_MODULES.map(s => ({ module: s.module, role: 'finance', result: 'pass', kind: s.workflow ? 'workflow_read' : 'read', evidenceId: `test:${s.module}` })), browserIsolation: isolation(manifest, preview), emailSigner };
  const env = { FCOS_HOSTED_BROWSER_ENABLED: 'true', RUNNER_TEMP: directory, FCOS_E2E_VERCEL_BYPASS: 'z'.repeat(32),
    FCOS_NORMAL_ROLE_E2E_ENABLED: 'true', FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true', GITHUB_REPOSITORY: manifest.targets.repository,
    ...(mode === 'restricted' ? { FCOS_HOSTED_RESTRICTED_EMAIL: FCOS_READ_ONLY_CI.email, FCOS_HOSTED_RESTRICTED_PASSWORD: 'PRIVATE_TEST_PASSWORD' }
      : { FCOS_HOSTED_NORMAL_EMAIL: 'normal@example.invalid', FCOS_HOSTED_NORMAL_PASSWORD: 'PRIVATE_TEST_PASSWORD', FCOS_NORMAL_ROLE_APPROVED_EMAIL: 'normal@example.invalid', FCOS_HOSTED_NORMAL_EXPECTED_ROLE: 'finance' }) };
  const options = { manifest, preview, mode, env, verifyController: () => events.push('controller'), verifyPreview: () => { events.push('provider'); return preview; },
    fetchImpl: async () => { events.push('version'); return { ok: true, redirected: false, json: async () => version }; }, observeRuntime: async () => { events.push('runtime'); return runtime; },
    admitHostedSource: async () => { events.push('source'); return sourceReceipt; }, signerAdapter: { verifySource: async () => { events.push('signer-source'); return signerProof; }, collect: async () => emailSigner },
    prepareProtection: async ({ writeState }) => { events.push('protection'); await writeState({ state: { cookies: [], origins: [] } }); },
    login: async args => { events.push('login'); return { auth: identity(args.mode), state, token: 'PRIVATE_NEW_TEST_TOKEN' }; },
    restrictedHarness: async () => { events.push('restricted'); return { modules: ['dashboard', 'markets', 'api_denials'], actualData: true, unexpectedWrites: 0, testsPassed: 21 }; },
    normalHarness: async dependencies => { events.push('normal'); assert.equal(dependencies.signerEnabled(), true); assert.equal((await dependencies.admitHostedSource()).manifestHash, digest(manifest)); return evidence; } };
  return { directory, manifest, preview, runtime, version, evidence, sourceReceipt, signerProof, emailSigner, options, events, state };
}

test('provider/artifact/runtime verification precedes either dedicated identity and temporary state is removed', async t => {
  const f = fixture(t); const result = await runHostedBrowser(f.options);
  assert.equal(result.status, 'passed'); assert.equal(result.result.identity, 'restricted');
  assert.deepEqual(f.events, ['controller', 'provider', 'version', 'runtime', 'protection', 'login', 'restricted']);
  assert.deepEqual(readdirSync(f.directory), []); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|password|access_token/);
});

test('wrong provider/manifest/source/runtime fails before protection or login; missing setup stays waiting', async t => {
  for (const change of [f => { f.preview.teamId = 'wrong'; }, f => { f.preview.manifestHash = '0'.repeat(64); }, f => { f.version.provenance.sourceDigest = '0'.repeat(64); }, f => { f.runtime.safety.readOnly = false; }]) {
    const f = fixture(t); change(f); const result = await runHostedBrowser(f.options); assert.equal(result.status, 'failed'); assert.ok(!f.events.includes('login'));
  }
  const f = fixture(t); delete f.options.env.FCOS_HOSTED_RESTRICTED_PASSWORD;
  const result = await runHostedBrowser(f.options); assert.equal(result.status, 'waiting_dependency'); assert.deepEqual(result.missing, ['fcos_hosted_restricted_renewable_credentials']); assert.ok(!f.events.includes('login'));
});

test('frozen adapter requires exact source plus signer setup; preserves all15, actual capturedAt and safe signer/isolation evidence', async t => {
  const f = fixture(t, 'normal_role'); const result = await runHostedBrowser(f.options);
  assert.equal(result.status, 'passed'); assert.equal(result.result.modules.length, 15); assert.equal(result.capturedAt, f.evidence.capturedAt);
  assert.equal(result.result.browserIsolation.backgroundSync.released, true); assert.equal(result.result.emailSigner.noAttachmentFetch, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|password|access_token/);
  const missing = fixture(t, 'normal_role'); delete missing.options.signerAdapter;
  const pending = await runHostedBrowser(missing.options); assert.equal(pending.status, 'waiting_dependency'); assert.deepEqual(pending.missing, ['frozen_04ee_signer_source_and_synthetic_probe_adapter']); assert.ok(!missing.events.includes('login'));
});

test('application normal path requires and publishes exact isolation without borrowing the compatibility profile or Xero catalogue', async t => {
  const make = () => {
    const f = fixture(t, 'normal_role'), sha = '2'.repeat(40);
    f.manifest.candidate.sha = sha; f.manifest.candidate.sourceProfile = 'application_v2';
    f.preview.sha = sha; f.preview.manifestHash = digest(f.manifest); f.runtime.sha = sha; f.version.commit = sha;
    f.evidence.candidateSha = sha; f.evidence.browserIsolation = isolation(f.manifest, f.preview);
    f.evidence.browserIsolation.backgroundSync.modules = NORMAL_ROLE_MODULES.map(s => ({ module: s.module, before: true, after: true }));
    f.evidence.checks = NORMAL_ROLE_MODULES.map(s => ({ module: s.module, role: 'finance', result: 'pass', kind: s.workflow ? 'workflow_read' : 'read' }));
    f.options.normalHarness = async dependencies => {
      assert.equal(dependencies.env.FCOS_NORMAL_ROLE_E2E_ENABLED, 'true');
      assert.equal(dependencies.env.FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED, undefined);
      assert.equal(dependencies.env.GITHUB_SHA, f.manifest.controller.sha);
      assert.equal(dependencies.admitHostedSource, undefined); assert.equal(dependencies.signerEnabled, undefined);
      return f.evidence;
    };
    return f;
  };
  const f = make(), composition = assertHostedBrowserComposition(f.manifest);
  assert.equal(composition.profile, 'application');
  assert.equal(composition.modules.find(s => s.module === 'xero_portal').handler, 'xeroIntegrityReport');
  const result = await runHostedBrowser(f.options);
  assert.equal(result.status, 'passed'); assert.equal(result.result.browserProfile, 'application');
  assert.deepEqual(result.result.browserIsolation, f.evidence.browserIsolation);
  assert.equal(result.result.modules.length, 15);
  for (const mutate of [g => { delete g.evidence.browserIsolation; },
    g => { g.evidence.browserIsolation.harnessSha = 'f'.repeat(40); },
    g => { g.evidence.browserIsolation.candidateSha = FROZEN; },
    g => { g.evidence.browserIsolation.backgroundSync.released = false; },
    g => { g.evidence.browserIsolation.backgroundSync.modules.reverse(); }]) {
    const g = make(); mutate(g); const denied = await runHostedBrowser(g.options);
    assert.equal(denied.status, 'failed'); assert.equal(denied.stage, 'browser.coverage');
  }
});

test('composition exposes the exact be6 request catalogue while frozen and application contracts stay distinct', () => {
  const ordinary = assertHostedBrowserComposition({ candidate: structuredClone(ORDINARY_BROWSER_CANDIDATE) });
  assert.equal(ordinary.modules, BE6_COMPATIBILITY_NORMAL_MODULES);
  assert.equal(ordinary.modules.find(s => s.module === 'markets').handler, 'marketPulseSnapshot');
  assert.equal(ordinary.modules.find(s => s.module === 'buyer_invoices').handler, 'salesforceBuyerInvoicesDue');
  assert.equal(ordinary.modules.find(s => s.module === 'xero_portal').handler, 'xeroPortalReceiptsList');
  assert.equal(ordinary.modules.length, 15);
  const frozen = assertHostedBrowserComposition({ candidate: { sha: FROZEN } });
  assert.equal(frozen.modules, COMPATIBILITY_NORMAL_MODULES);
  assert.equal(frozen.modules.find(s => s.module === 'markets').handler, 'hedgeMarkets');
  assert.equal(frozen.modules.find(s => s.module === 'buyer_invoices').handler, 'buyerInvoiceCollectionList');
  const app = assertHostedBrowserComposition({ candidate: { sha: '2'.repeat(40), sourceProfile: 'application_v2' } });
  assert.equal(app.modules, NORMAL_ROLE_MODULES);
  assert.equal(app.modules.find(s => s.module === 'xero_portal').handler, 'xeroIntegrityReport');
  assert.throws(() => assertHostedBrowserComposition({ candidate: { ...ORDINARY_BROWSER_CANDIDATE, sourceSha256: '0'.repeat(64) } }));
});

test('missing modules, incorrect roles, failed isolation or signer token leakage cannot publish normal coverage', async t => {
  for (const change of [f => f.evidence.checks.pop(), f => { f.evidence.checks[0].role = 'administrator'; }, f => { f.evidence.browserIsolation.backgroundSync.released = false; }, f => { f.evidence.emailSigner.token = 'PRIVATE_FORBIDDEN'; }]) {
    const f = fixture(t, 'normal_role'); change(f); const result = await runHostedBrowser(f.options); assert.equal(result.status, 'failed'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|token/); assert.deepEqual(readdirSync(f.directory), []);
  }
});

test('browser jobs refuse coordinator/provider write/OIDC credentials, cross-role credentials and imported existing state', async t => {
  for (const extra of [{ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'PRIVATE_OTHER' }, { FCOS_HOSTED_VERCEL_TOKEN: 'PRIVATE_OTHER' }, { FCOS_COORDINATOR_TOKEN: 'PRIVATE_OTHER' }, { FCOS_HOSTED_NORMAL_PASSWORD: 'PRIVATE_OTHER' }, { FCOS_NORMAL_ROLE_STORAGE_STATE_BASE64: 'PRIVATE_OTHER' }]) {
    const f = fixture(t); Object.assign(f.options.env, extra); const result = await runHostedBrowser(f.options); assert.equal(result.status, 'failed'); assert.equal(f.events.length, 0); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  }
  assert.deepEqual(hostedBrowserLaunchEnvironment({ PATH: '/bin', HOME: '/tmp/user', SECRET: 'PRIVATE', FCOS_HOSTED_NORMAL_PASSWORD: 'PRIVATE' }), { PATH: '/bin', HOME: '/tmp/user' });
});

test('fixed restricted subprocess runs trusted suites with no renewable/provider credentials and no trace/screenshots', async t => {
  const f = fixture(t); const root = fileURLToPath(new URL('..', import.meta.url));
  const protectionState = { cookies: [{ name: '_vercel_jwt', value: 'PRIVATE_PROTECTION' }], origins: [] };
  const result = await runHostedRestrictedHarness({ origin, state: f.state, protectionState, directory: f.directory, controllerDirectory: root,
    env: { PATH: '/bin', HOME: '/tmp', FCOS_HOSTED_RESTRICTED_PASSWORD: 'PRIVATE', FCOS_E2E_VERCEL_BYPASS: 'PRIVATE', GH_TOKEN: 'PRIVATE' },
    run: async (program, args, opts) => {
      assert.equal(program, process.execPath); assert.equal(args[0], join(root, 'node_modules/@playwright/test/cli.js')); assert.equal(opts.shell, false);
      assert.doesNotMatch(JSON.stringify(opts.env), /PRIVATE|PASSWORD|TOKEN|BYPASS/);
      const config = readFileSync(args[args.indexOf('--config') + 1], 'utf8'); assert.match(config, /globalSetup:undefined/); assert.match(config, /screenshot:'off'/); assert.match(config, /trace:'off'/); assert.match(config, /dependencies:\[\]/);
      const actualConfig = (await import(pathToFileURL(args[args.indexOf('--config') + 1]).href)).default;
      assert.deepEqual(JSON.parse(readFileSync(actualConfig.use.storageState)), protectionState);
      assert.equal(actualConfig.projects[0].use.storageState, actualConfig.use.storageState);
      assert.notEqual(actualConfig.use.storageState, opts.env.FCOS_E2E_STORAGE_STATE);
      assert.deepEqual(JSON.parse(readFileSync(opts.env.FCOS_E2E_STORAGE_STATE)), f.state);
      for (const suite of ['workspace-smoke.spec.js', 'dashboard.spec.js', 'api-denials.spec.js']) {
        assert.match(readFileSync(join(root, 'e2e', suite), 'utf8'), /test\.use\(\{ storageState: authState \}\)/);
      }
      return { status: 0, stdout: JSON.stringify({ stats: { expected: 21, unexpected: 0, skipped: 0, flaky: 0 }, suites: ['workspace-smoke.spec.js', 'dashboard.spec.js', 'api-denials.spec.js'].map(file => ({ file })) }) };
    } });
  assert.equal(result.testsPassed, 21);
});

test('restricted harness retains safe failing test locations through the hosted summary', async t => {
  const f = fixture(t), protectionState = { cookies: [], origins: [] };
  let failure;
  await assert.rejects(runHostedRestrictedHarness({ origin, state: f.state, protectionState, directory: f.directory,
    run: () => ({ status: 1, stdout: JSON.stringify({ stats: { expected: 20, unexpected: 1, skipped: 0, flaky: 0 },
      errors: [{ message: 'PRIVATE_RAW_ERROR' }], suites: [{ file: '/PRIVATE/workspace-smoke.spec.js', specs: [{ line: 43,
        title: 'PRIVATE_TEST_TITLE', tests: [{ results: [{ status: 'timedOut', error: { message: 'PRIVATE_PASSWORD' } }] }] }] }] }) }) }),
  error => { failure = error; return error.code === 'HOSTED_RESTRICTED_HARNESS_FAILED'; });
  const safe = safeHostedBrowserDiagnostic(failure);
  assert.deepEqual(safe.restrictedHarness.failedTests, [{ file: 'workspace-smoke.spec.js', line: 43, status: 'timedOut' }]);
  const result = safeHostedBrowserResultFields({ status: 'failed', errorCode: 'HOSTED_BROWSER_VERIFICATION_FAILED', ...safe });
  assert.deepEqual(result.restrictedHarness, safe.restrictedHarness);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|message|title|password/i);
});

test('restricted public state cannot be substituted with an authenticated state', async t => {
  const f = fixture(t); let spawned = false;
  await assert.rejects(runHostedRestrictedHarness({ origin, state: f.state, protectionState: f.state, directory: f.directory,
    run: () => { spawned = true; } }));
  assert.equal(spawned, false);
});

test('restricted diagnostic refuses injected data and survives malformed child suite shapes', () => {
  const summary = restrictedBrowserReportDiagnostic({ stats: {}, suites: [null, { file: {}, specs: [null, { tests: null }] }] }, null);
  assert.equal(summary.reason, 'CHILD_UNCONFIRMED');
  assert.deepEqual(summary.failedTests, []);
  assert.deepEqual(safeRestrictedBrowserDiagnostic(summary), summary);
  assert.equal(safeRestrictedBrowserDiagnostic({ ...summary, raw: 'PRIVATE_FORBIDDEN' }), undefined);
  assert.equal(safeRestrictedBrowserDiagnostic({ ...summary, failedTests: [{ file: 'PRIVATE', line: 1, status: 'failed' }] }), undefined);
  let accessed = false;
  const poisoned = { ...summary };
  Object.defineProperty(poisoned, 'reason', { enumerable: true, get() { accessed = true; return 'PRIVATE'; } });
  assert.equal(safeRestrictedBrowserDiagnostic(poisoned), undefined);
  assert.equal(accessed, false);
});

test('actual restricted harness preserves typed failures for null and malformed child output', async t => {
  for (const stdout of [null, 'null', JSON.stringify({ stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, suites: [null] }),
    JSON.stringify({ stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, suites: {} })]) {
    const f = fixture(t);
    await assert.rejects(runHostedRestrictedHarness({ origin, state: f.state, protectionState: { cookies: [], origins: [] }, directory: f.directory,
      run: () => ({ status: null, stdout }) }), error => error.code === 'HOSTED_RESTRICTED_HARNESS_FAILED'
        && safeHostedBrowserDiagnostic(error).restrictedHarness.reason === 'REPORT_UNREADABLE');
  }
});

test('readonly Vercel adapter uses only pinned GET endpoints and rejects a mismatching project before deployment lookup', async t => {
  const f = fixture(t); const calls = [];const credential=admitVercelReadFixture(f.manifest);f.preview.manifestHash=digest(f.manifest);
  const read = await recheckHostedPreviewProvider({ ...f.options, env: credential.env, fetchImpl: async (url, options) => {
    calls.push(String(url)); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return { ok: true, redirected: false, json: async () => String(url).includes('/integrations/configuration/')?credential.configuration:String(url).includes('/v9/projects/') ? { id: f.manifest.targets.vercelProject, accountId: f.manifest.targets.vercelTeam, name: 'fcos', link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos' } } : {
      id: f.preview.id, url: new URL(origin).hostname, projectId: f.preview.projectId, teamId: f.preview.teamId, readyState: 'READY', target: null, meta: { githubCommitSha: FROZEN, fcosHostedManifest: digest(f.manifest) } } };
  } });
  assert.equal(read.id, f.preview.id); assert.equal(calls.length, 4); assert.ok(calls.every(url => url.includes(f.manifest.targets.vercelTeam)));
  assert.throws(() => assertHostedBrowserBinding(f.manifest, { ...f.preview, target: 'production' }));
  let deniedCalls = 0;
  await assert.rejects(recheckHostedPreviewProvider({ ...f.options, env: credential.env, fetchImpl: async url => { deniedCalls++; return { ok: true, redirected: false, json: async () => String(url).includes('/integrations/configuration/')?credential.configuration:{ id: 'wrong' } }; } }));
  assert.equal(deniedCalls, 2);
});

function fakeLoginBrowser(auth, state, { foreign = false, cleanupFail = false, failAt = null, httpStatus = 200, responseBody = null, bodyPending = false } = {}) {
  let location = origin, fills = 0, closed = 0, waits = 0, submissions = 0;
  const waiting = new Set(), listeners = new Map(), frame = { url: () => location };
  const move = url => { location = url; listeners.get('framenavigated')?.(frame); for (const wait of waiting) if (wait.predicate(new URL(url))) { waiting.delete(wait); wait.resolve(); } };
  const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
  const request = { url: () => `${origin}/api/functions/authContext`, method: () => 'POST' };
  const response = { request: () => request, status: () => httpStatus, body: async () => bodyPending ? new Promise(() => {}) : Buffer.from(responseBody ?? JSON.stringify(auth)), json: async () => { if (failAt === 'identity') throw new SyntaxError('PRIVATE_RESPONSE_BODY'); return auth; } };
  const page = { goto: async () => { if (failAt === 'navigation') throw Error('PRIVATE_NAVIGATION_TOKEN'); move(foreign ? 'https://foreign.invalid/admin' : `${origin}/login`); }, url: () => location,
    on: (event, listener) => listeners.set(event, listener), off: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); }, mainFrame: () => frame,
    getByRole: (_, { name }) => {
      const click = async () => {
        if (name === 'Login') {
          submissions++;
          if (failAt === 'submit') throw Error('PRIVATE_SUBMIT_PASSWORD');
          if (failAt === 'submit_timeout_after_response') throw Object.assign(Error('PRIVATE_CLICK_TIMEOUT'), { name: 'TimeoutError' });
          if (failAt === 'response_timeout') { listeners.get('request')?.(request); return; }
          if (failAt === 'request_not_observed') { move(`${origin}/login?federated=1&error_description=PRIVATE_TICKET#PRIVATE_TOKEN`); return; }
          if (failAt === 'callback_off_origin') { move('https://foreign.invalid/private-path?ticket=PRIVATE_TICKET#PRIVATE_TOKEN'); return; }
        }
        move(name === 'Continue with FCUNO' ? (foreign ? location : `${issuer}/admin`) : origin);
      };
      return { click, waitFor: async () => {}, elementHandle: async () => ({ click, dispose: async () => {} }) };
    },
    getByLabel: () => ({ fill: async () => { if (failAt === 'form') throw Error('PRIVATE_FORM_EMAIL'); fills++; assert.equal(new URL(location).origin, issuer); } }),
    waitForURL: predicate => {
      waits++; if (failAt === 'callback' && waits === 2) return Promise.reject(Error('PRIVATE_CALLBACK_TICKET'));
      if (failAt === 'callback_off_origin' && waits === 2) return Promise.reject(Error('PRIVATE_CALLBACK_URL'));
      if (predicate(new URL(location))) return Promise.resolve();
      if (foreign) return Promise.reject(Error('PRIVATE_WRONG_LOCATION'));
      return new Promise((resolve, reject) => waiting.add({ predicate, resolve, reject }));
    }, waitForResponse: async () => {
      if (['response_timeout', 'request_not_observed'].includes(failAt)) throw Object.assign(new Error('PRIVATE_RESPONSE_PASSWORD'), { name: 'TimeoutError' });
      listeners.get('request')?.(request); listeners.get('response')?.(response); return response;
    } };
  const context = { newPage: async () => page, storageState: async () => state, close: async () => { closed++; for (const wait of waiting) wait.reject(Error('PRIVATE_PAGE_CLOSED')); waiting.clear(); if (cleanupFail) throw Error('PRIVATE_CLEANUP_ERROR'); } };
  return { browserType: { launch: async () => ({ newContext: async () => context, close: async () => { closed++; } }) }, counts: () => ({ fills, closed }), waits: () => waits,
    submissions: () => submissions, remainingListeners: () => listeners.size };
}

test('fresh FCUNO login only fills pinned issuer and yields candidate-only new state; foreign issuer fails before password entry', async t => {
  const f = fixture(t, 'normal_role'); const browser = fakeLoginBrowser(identity(), { ...f.state, cookies: [{ domain: new URL(origin).hostname, name: '_vercel_jwt' }, { domain: 'foreign.invalid', name: 'issuer' }] });
  const login = await loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: browser.browserType });
  assert.equal(login.token, 'PRIVATE_NEW_TEST_TOKEN'); assert.equal(login.state.cookies.length, 1); assert.deepEqual(browser.counts(), { fills: 2, closed: 2 });
  const foreign = fakeLoginBrowser(identity(), f.state, { foreign: true });
  await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: foreign.browserType }), error => error.code === 'RELEASE_BOUNDARY_FAILED' && error.boundary === 'runtime.login.issuer');
  assert.deepEqual(foreign.counts(), { fills: 0, closed: 2 });
  const cleanup = fakeLoginBrowser(identity(), f.state, { cleanupFail: true });
  await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: cleanup.browserType }), error => error.code === 'RELEASE_BOUNDARY_FAILED' && error.boundary === 'runtime.login.cleanup');
  assert.deepEqual(cleanup.counts(), { fills: 2, closed: 2 });
});

test('separate runtime token provider verifies target before login and refuses non-admin or CI identities', async t => {
  const f = fixture(t); const events = [];
  const env = { FCOS_HOSTED_RUNTIME_EMAIL: 'runtime@example.invalid', FCOS_HOSTED_RUNTIME_PASSWORD: 'PRIVATE_RUNTIME', FCOS_HOSTED_RUNTIME_EXPECTED_ROLE: 'administrator' };
  const provider = createHostedRuntimeTokenProvider({ env, verifyTarget: async ({ origin: target, deployment }) => { events.push('verify'); return { verified: true, origin: target, deploymentId: deployment.id, sha: deployment.sha, sourceSha256: 'a'.repeat(64) }; },
    login: async () => { events.push('login'); return { auth: identity('runtime', 'runtime@example.invalid', 'administrator'), token: 'PRIVATE_RUNTIME_TOKEN' }; } });
  assert.equal(await provider({ origin, deployment: f.preview }), 'PRIVATE_RUNTIME_TOKEN'); assert.deepEqual(events, ['verify', 'login']);
  const denied = createHostedRuntimeTokenProvider({ env, verifyTarget: async () => ({ verified: false }), login: () => assert.fail('no private login') });
  await assert.rejects(denied({ origin, deployment: f.preview }));
  for (const auth of [identity('runtime', 'runtime@example.invalid', 'finance'), { ...identity('runtime', 'runtime@example.invalid', 'administrator'), user: { ...identity('runtime', 'runtime@example.invalid', 'administrator').user, read_only_ci: true } }]) {
    const wrong = createHostedRuntimeTokenProvider({ env, verifyTarget: async () => ({ verified: true, origin, deploymentId: f.preview.id, sha: f.preview.sha, sourceSha256: 'a'.repeat(64) }), login: async () => ({ auth, token: 'PRIVATE_WRONG' }) });
    await assert.rejects(wrong({ origin, deployment: f.preview }));
  }
});

test('actual frozen harness accepts trusted source seams without legacy GitHub lookup while preserving runtime safety before browser launch', async t => {
  const f = fixture(t, 'normal_role'); let launches = 0;
  await assert.rejects(verifyRuntimeCompatibilityNormalRole({ env: { ...f.options.env, GITHUB_SHA: f.manifest.controller.sha, FCOS_E2E_EXPECTED_COMMIT: FROZEN, FCOS_E2E_CANDIDATE_URL: origin },
    admitHostedSource: async () => f.sourceReceipt, resolveCandidate: async () => ({ commit: FROZEN }), observeRuntime: async () => f.runtime,
    authenticate: async () => ({ state: f.state, token: 'PRIVATE_NEW_TEST_TOKEN' }), signerEnabled: () => true, collectSigner: async () => f.emailSigner,
    fetchImpl: async url => ({ ok: true, redirected: false, json: async () => String(url).endsWith('app-version.json') ? f.version : String(url).endsWith('workspacePreferencesGet') ? { preferences: { initialized: true } } : identity() }),
    browserType: { launch: async () => { launches++; throw Error('OFFLINE_BROWSER_BOUNDARY'); } }, writeEvidence: () => assert.fail('no partial proof') }),
    error => error.normalRoleDiagnostic?.stage === 'BROWSER_SETUP');
  assert.equal(launches, 1);
});


test('runtime token provider preserves only fixed login phases, never raw private diagnostics', async t => {
  const f = fixture(t);
  const env = { FCOS_HOSTED_RUNTIME_EMAIL: 'runtime@example.invalid', FCOS_HOSTED_RUNTIME_PASSWORD: 'PRIVATE_RUNTIME', FCOS_HOSTED_RUNTIME_EXPECTED_ROLE: 'administrator' };
  const verifyTarget = async () => ({ verified: true, origin, deploymentId: f.preview.id, sha: f.preview.sha, sourceSha256: 'a'.repeat(64) });
  for (const [code, expected] of [['LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED', 'LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED'], ['PRIVATE_PASSWORD', 'Hosted runtime identity verification failed.'], ['LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED_PRIVATE', 'Hosted runtime identity verification failed.']]) {
    const provider = createHostedRuntimeTokenProvider({ env, verifyTarget, login: async () => { throw Object.assign(Error('PRIVATE_PASSWORD_AND_URL'), { code }); } });
    await assert.rejects(provider({ origin, deployment: f.preview }), error => error.message === expected && !String(error.stack).includes('PRIVATE_PASSWORD_AND_URL'));
  }
});


test('actual login boundaries retain only fixed stages and close both resources after private failures', async t => {
  const f = fixture(t, 'normal_role');
  for (const [failAt, boundary] of [['navigation','runtime.login.navigation'],['form','runtime.login.form'],['submit','runtime.login.submit'],['identity','runtime.login.identity']]) {
    const browser = fakeLoginBrowser(identity(), f.state, { failAt });
    await assert.rejects(loginHostedFcuno({ origin, mode:'normal_role', credentials:{ email:'normal@example.invalid',password:'PRIVATE_TEST',expectedRole:'finance' }, protectionState:{},browserType:browser.browserType }), error => {
      assert.equal(error.code,'RELEASE_BOUNDARY_FAILED'); assert.equal(error.boundary,boundary);
      assert.equal(JSON.stringify(error).includes('PRIVATE'),false); assert.equal(String(error.stack).includes('PRIVATE'),false); return true;
    });
    assert.equal(browser.counts().closed,2);
  }
});

test('runtime target recheck preserves its closed boundary and cannot reach login on failure', async t => {
  const f=fixture(t);let logins=0;
  const provider=createHostedRuntimeTokenProvider({env:{FCOS_HOSTED_RUNTIME_EMAIL:'runtime@example.invalid',FCOS_HOSTED_RUNTIME_PASSWORD:'PRIVATE_RUNTIME',FCOS_HOSTED_RUNTIME_EXPECTED_ROLE:'administrator'},
    verifyTarget:async()=>{throw Error('PRIVATE_PROVIDER_RESPONSE');},login:async()=>{logins++;}});
  await assert.rejects(provider({origin,deployment:f.preview}),error=>error.code==='RELEASE_BOUNDARY_FAILED'&&error.boundary==='runtime.identity.target'&&!JSON.stringify(error).includes('PRIVATE'));
  assert.equal(logins,0);
});


// Login.jsx may replace the manual button with its automatic FCUNO redirect.
// This browser double models navigation separately from a document-bound click.
function issuerArrivalBrowser(auth, state, scenario) {
  const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
  let location = origin, fills = 0, closed = 0, manualClicks = 0, disposed = 0;
  const pending = new Set();
  const move = url => { location = url; for (const wait of pending) if (wait.predicate(new URL(url))) { pending.delete(wait); wait.resolve(); } };
  const detached = () => Object.assign(new Error('SYNTHETIC_DOCUMENT_DETACHED'), { name: 'TimeoutError' });
  const manual = async () => {
    manualClicks++;
    if (scenario === 'automatic-before-button' || scenario === 'automatic-during-click') { move(`${issuer}/admin`); throw detached(); }
    move(`${issuer}/admin`);
  };
  const page = {
    goto: async () => move(scenario === 'already-arrived' ? `${issuer}/admin` : scenario === 'wrong-issuer' ? 'https://foreign.invalid/admin' : `${origin}/login`),
    url: () => location,
    getByRole: (_, { name }) => name === 'Continue with FCUNO' ? {
      click: manual,
      waitFor: async () => {
        if (scenario === 'automatic-before-button') { move(`${issuer}/admin`); throw detached(); }
        if (scenario === 'timeout') throw detached();
      },
      elementHandle: async () => ({ click: manual, dispose: async () => { disposed++; } }),
    } : { click: async () => move(origin) },
    getByLabel: () => ({ fill: async () => { assert.equal(location, `${issuer}/admin`); fills++; } }),
    waitForURL: predicate => {
      if (predicate(new URL(location))) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const wait = { predicate, resolve, reject }; pending.add(wait);
        if (scenario === 'timeout' || scenario === 'wrong-issuer') queueMicrotask(() => { pending.delete(wait); reject(detached()); });
      });
    },
    waitForResponse: async () => ({ status: () => 200, json: async () => auth }),
  };
  const context = { newPage: async () => page, storageState: async () => state, close: async () => { closed++; for (const wait of pending) wait.reject(detached()); pending.clear(); } };
  return { browserType: { launch: async () => ({ newContext: async () => context, close: async () => { closed++; } }) }, counts: () => ({ fills, closed, manualClicks, disposed }) };
}

for (const [scenario, title] of [
  ['automatic-before-button', 'automatic navigation before the button appears'],
  ['automatic-during-click', 'automatic navigation while the old document click detaches'],
  ['already-arrived', 'already arrived issuer without another click'],
  ['manual', 'manual document-bound click'],
]) test(`issuer arrival accepts ${title}`, async t => {
  const f = fixture(t, 'normal_role'), browser = issuerArrivalBrowser(identity(), f.state, scenario);
  const result = await loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: browser.browserType });
  assert.equal(result.token, 'PRIVATE_NEW_TEST_TOKEN');
  assert.equal(browser.counts().fills, 2); assert.equal(browser.counts().closed, 2);
  assert.equal(browser.counts().manualClicks, ['manual', 'automatic-during-click'].includes(scenario) ? 1 : 0);
  assert.equal(browser.counts().disposed, ['manual', 'automatic-during-click'].includes(scenario) ? 1 : 0);
});
for (const scenario of ['wrong-issuer', 'timeout']) test(`issuer arrival refuses ${scenario} before credentials and closes both resources`, async t => {
  const f = fixture(t, 'normal_role'), browser = issuerArrivalBrowser(identity(), f.state, scenario);
  await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: browser.browserType }), error => {
    assert.equal(error.code, 'RELEASE_BOUNDARY_FAILED'); assert.equal(error.boundary, 'runtime.login.issuer');
    assert.equal(JSON.stringify(error).includes('PRIVATE'), false); assert.equal(String(error.stack).includes('PRIVATE'), false); return true;
  });
  assert.equal(browser.counts().fills, 0); assert.equal(browser.counts().closed, 2); assert.equal(browser.counts().manualClicks, 0);
});


test('actual FCUNO non200 response stops before callback wait and emits only closed diagnostics', async t => {
  const f = fixture(t, 'normal_role');
  for (const [responseBody, errorCode] of [[JSON.stringify({ code: 'FCUNO_IDENTITY_CONFIG_MISSING', error: 'PRIVATE_RESPONSE', user: 'PRIVATE_USER' }), 'FCUNO_IDENTITY_CONFIG_MISSING'],
    [JSON.stringify({ code: 'PRIVATE_CODE', ticket: 'PRIVATE_TICKET' }), 'UNCLASSIFIED'],
    ['PRIVATE_MALFORMED', 'UNCLASSIFIED'], ['P'.repeat(8193), 'UNCLASSIFIED']]) {
    const browser = fakeLoginBrowser(identity(), f.state, { httpStatus: 503, responseBody });
    await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE', expectedRole: 'finance' }, protectionState: {}, browserType: browser.browserType }), error => {
      assert.equal(error.code, 'RUNTIME_LOGIN_AUTH_CONTEXT_HTTP'); assert.equal(error.boundary, 'runtime.login.identity');
      for (const report of [safeFailure(error), safeDiagnosticFailure(error)]) {
        assert.deepEqual(report.runtimeLogin, { httpStatus: 503, errorCode, origin, pathname: '/' });
        assert.doesNotMatch(JSON.stringify(report), /PRIVATE|ticket|password|user:/);
      }
      return true;
    });
    assert.equal(browser.waits(), 1); assert.equal(browser.counts().closed, 2);
  }
});

test('200 callback failure keeps callback boundary and rejects unsafe diagnostic shapes', async t => {
  const f = fixture(t, 'normal_role'), browser = fakeLoginBrowser(identity(), f.state, { failAt: 'callback' });
  await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE', expectedRole: 'finance' }, protectionState: {}, browserType: browser.browserType }), error => {
    assert.equal(error.boundary, 'runtime.login.callback'); assert.equal(safeFailure(error).runtimeLogin, undefined); return true;
  });
  const good = { httpStatus: 503, errorCode: 'UNCLASSIFIED', origin, pathname: '/login' };
  for (const patch of [{ httpStatus: 200 }, { errorCode: 'PRIVATE' }, { origin: origin + '?ticket=PRIVATE' }, { origin: 'https://foreign.invalid' }, { pathname: '/private/USER' }, { ticket: 'PRIVATE' }])
    assert.equal(safeRuntimeLoginFailure({ ...good, ...patch }), undefined);
  assert.equal(browser.counts().closed, 2);
});


test('hosted browser report and public summary keep only closed login stage diagnostics', async t => {
  const cases = [
    {
      error: Object.assign(new ReleaseError('RUNTIME_LOGIN_AUTH_CONTEXT_HTTP', 'runtime.login.identity',
        'Inspect the bound authentication response and configuration; do not replay the consumed runtime request.',
        { runtimeLogin: { httpStatus: 401, errorCode: 'UNCLASSIFIED', origin, pathname: '/login' } }),
      { boundary: 'runtime.login.identity' }),
      expected: { diagnosticCode: 'RUNTIME_LOGIN_AUTH_CONTEXT_HTTP', stage: 'runtime.login.identity',
        runtimeLogin: { httpStatus: 401, errorCode: 'UNCLASSIFIED', origin, pathname: '/login' } },
    },
    {
      error: Object.assign(new ReleaseError('RELEASE_BOUNDARY_FAILED', 'runtime.login.callback',
        'Inspect the fixed boundary and retained sanitized diagnostic. Read the journal before any consequential operation.'),
      { boundary: 'runtime.login.callback' }),
      expected: { diagnosticCode: 'RELEASE_BOUNDARY_FAILED', stage: 'runtime.login.callback' },
    },
    {
      error: Object.assign(new ReleaseError('RELEASE_BOUNDARY_FAILED', 'runtime.login.identity',
        'Inspect the fixed boundary and retained sanitized diagnostic. Read the journal before any consequential operation.'),
      { boundary: 'runtime.login.identity' }),
      expected: { diagnosticCode: 'RELEASE_BOUNDARY_FAILED', stage: 'runtime.login.identity' },
    },
  ];
  for (const { error, expected } of cases) {
    const f = fixture(t, 'normal_role');
    f.options.login = async () => { throw error; };
    const result = await runHostedBrowser(f.options);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'HOSTED_BROWSER_VERIFICATION_FAILED');
    assert.equal(result.diagnosticCode, expected.diagnosticCode);
    assert.equal(result.stage, expected.stage);
    assert.deepEqual(result.runtimeLogin, expected.runtimeLogin);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|ticket|password/);
    assert.deepEqual(releaseResultSummary(result), {
      status: 'failed', phase: undefined, missing: undefined,
      errorCode: 'HOSTED_BROWSER_VERIFICATION_FAILED', ...expected,
    });
  }
});

test('restricted submit timeout means response unobserved, with no invalid-password claim or new request', async t => {
  const f = fixture(t), browser = fakeLoginBrowser(identity('restricted'), f.state, { failAt: 'response_timeout' });
  f.options.login = args => loginHostedFcuno({ ...args, browserType: browser.browserType });
  const result = await runHostedBrowser(f.options);
  assert.equal(result.stage, 'runtime.login.submit'); assert.equal(result.diagnosticCode, 'RUNTIME_LOGIN_RESPONSE_UNOBSERVED');
  assert.equal(result.loginOutcome, 'AUTH_CONTEXT_RESPONSE_NOT_OBSERVED');
  assert.equal(releaseResultSummary(result).loginOutcome, result.loginOutcome);
  assert.deepEqual(result.runtimeLoginObservation, { clickCompleted: true, authContextRequestObserved: true,
    authContextResponseObserved: false, authContextHttpStatus: null,
    navigationMilestones: ['candidate_login', 'issuer_login'], finalLocation: 'issuer_login' });
  assert.deepEqual(releaseResultSummary(result).runtimeLoginObservation, result.runtimeLoginObservation);
  assert.equal(browser.submissions(), 1); assert.equal(browser.remainingListeners(), 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|password|invalid.credentials/i);
  assert.deepEqual(browser.counts(), { fills: 2, closed: 2 });
});

test('plain hosted browser failure retains a fixed boundary without private error text', async t => {
  const f = fixture(t, 'normal_role');
  f.options.login = async () => { throw new Error('PRIVATE_PASSWORD https://issuer.invalid/admin?ticket=PRIVATE'); };
  const result = await runHostedBrowser(f.options);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'HOSTED_BROWSER_VERIFICATION_FAILED');
  assert.equal(result.stage, 'browser.login');
  assert.equal(result.diagnosticCode, 'RELEASE_BOUNDARY_FAILED');
  assert.equal(result.runtimeLogin, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|ticket|password|issuer\.invalid/);
  assert.deepEqual(releaseResultSummary(result), {
    status: 'failed', phase: undefined, missing: undefined, errorCode: 'HOSTED_BROWSER_VERIFICATION_FAILED',
    stage: 'browser.login', diagnosticCode: 'RELEASE_BOUNDARY_FAILED',
  });
});

test('submit click timeout after observed auth response does not claim response was unobserved', async t => {
  const f=fixture(t), browser=fakeLoginBrowser(identity('restricted'),f.state,{failAt:'submit_timeout_after_response'});
  f.options.login=args=>loginHostedFcuno({...args,browserType:browser.browserType});
  const result=await runHostedBrowser(f.options);
  assert.equal(result.stage,'runtime.login.submit');assert.equal(result.diagnosticCode,'RELEASE_BOUNDARY_FAILED');assert.equal(result.loginOutcome,undefined);
  assert.deepEqual(result.runtimeLoginObservation, { clickCompleted: false, authContextRequestObserved: true,
    authContextResponseObserved: true, authContextHttpStatus: 200,
    navigationMilestones: ['candidate_login', 'issuer_login'], finalLocation: 'issuer_login' });
  assert.equal(browser.submissions(),1);assert.equal(browser.remainingListeners(),0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
});

test('missing bootstrap request differs from missing response and callback queries stay private', async t => {
  const f=fixture(t),browser=fakeLoginBrowser(identity('restricted'),f.state,{failAt:'request_not_observed'});
  f.options.login=args=>loginHostedFcuno({...args,browserType:browser.browserType});
  const result=await runHostedBrowser(f.options);
  assert.equal(result.stage,'runtime.login.submit');assert.equal(result.diagnosticCode,'RUNTIME_LOGIN_RESPONSE_UNOBSERVED');
  assert.deepEqual(result.runtimeLoginObservation,{clickCompleted:true,authContextRequestObserved:false,
    authContextResponseObserved:false,authContextHttpStatus:null,
    navigationMilestones:['candidate_login','issuer_login','candidate_callback'],finalLocation:'candidate_callback'});
  assert.deepEqual(releaseResultSummary(result).runtimeLoginObservation,result.runtimeLoginObservation);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|federated|error_description|ticket|access_token/);
  assert.equal(browser.submissions(),1);assert.equal(browser.remainingListeners(),0);assert.deepEqual(browser.counts(),{fills:2,closed:2});
});

test('off-origin callback fails existing fence and retains only other navigation class', async t => {
  const f=fixture(t),browser=fakeLoginBrowser(identity('restricted'),f.state,{failAt:'callback_off_origin'});
  f.options.login=args=>loginHostedFcuno({...args,browserType:browser.browserType});
  const result=await runHostedBrowser(f.options);
  assert.equal(result.stage,'runtime.login.callback');assert.equal(result.status,'failed');
  assert.equal(result.runtimeLoginObservation.finalLocation,'other');
  assert.deepEqual(result.runtimeLoginObservation.navigationMilestones,['candidate_login','issuer_login','other']);
  assert.equal(result.runtimeLoginObservation.clickCompleted,true);assert.equal(result.runtimeLoginObservation.authContextHttpStatus,200);
  assert.doesNotMatch(JSON.stringify(result),/foreign|private-path|PRIVATE_|ticket|https:/);
  assert.equal(browser.submissions(),1);assert.equal(browser.remainingListeners(),0);assert.deepEqual(browser.counts(),{fills:2,closed:2});
});

test('unreadable observed status remains null and cleanup failure retains safe observations', async t => {
  for(const options of [{httpStatus:0},{cleanupFail:true}]){
    const f=fixture(t),browser=fakeLoginBrowser(identity('restricted'),f.state,options);
    f.options.login=args=>loginHostedFcuno({...args,browserType:browser.browserType});
    const result=await runHostedBrowser(f.options);
    assert.equal(result.status,'failed');assert.equal(result.stage,options.cleanupFail?'runtime.login.cleanup':'runtime.login.identity');
    assert.equal(result.runtimeLoginObservation.authContextResponseObserved,true);
    assert.equal(result.runtimeLoginObservation.authContextHttpStatus,options.cleanupFail?200:null);
    assert.equal(browser.submissions(),1);assert.equal(browser.remainingListeners(),0);assert.deepEqual(browser.counts(),{fills:2,closed:2});
  }
});

test('login observation sanitizer rejects arbitrary or inconsistent data and requires known typed login failure',()=>{
  const value={clickCompleted:false,authContextRequestObserved:false,authContextResponseObserved:false,authContextHttpStatus:null,
    navigationMilestones:['issuer_login'],finalLocation:'issuer_login'};
  const valid=safeRuntimeLoginObservation(value);assert.deepEqual(valid,value);assert.notEqual(valid.navigationMilestones,value.navigationMilestones);
  let reads=0;const changing={...value,get clickCompleted(){return reads++===0?false:'PRIVATE_CHANGED_VALUE';}};
  assert.deepEqual(safeRuntimeLoginObservation(changing),value);assert.equal(reads,1);
  for(const bad of [{...value,rawUrl:'PRIVATE_TICKET'},{...value,authContextHttpStatus:200},{...value,authContextHttpStatus:0},
    {...value,clickCompleted:'true'},{...value,navigationMilestones:['https://private.invalid/?token=PRIVATE']},
    {...value,finalLocation:'candidate_app'},{...value,navigationMilestones:['issuer_login','issuer_login']}]) assert.equal(safeRuntimeLoginObservation(bad),undefined);
  const detail={runtimeLoginObservation:value};
  const typed=new ReleaseError('RELEASE_BOUNDARY_FAILED','runtime.login.submit','LOCAL',detail);
  assert.deepEqual(safeDiagnosticFailure(typed).runtimeLoginObservation,value);
  assert.deepEqual(safeHostedBrowserDiagnostic(typed).runtimeLoginObservation,value);
  assert.equal(safeHostedBrowserDiagnostic({code:typed.code,phase:typed.phase,detail}).runtimeLoginObservation,undefined);
  assert.equal(safeHostedBrowserDiagnostic(new ReleaseError('PRIVATE_UNKNOWN','runtime.login.submit','LOCAL',detail)).runtimeLoginObservation,undefined);
  assert.equal(safeHostedBrowserDiagnostic(new ReleaseError('RELEASE_BOUNDARY_FAILED','browser.normal','LOCAL',detail)).runtimeLoginObservation,undefined);
  const envelope={status:'failed',errorCode:'HOSTED_BROWSER_VERIFICATION_FAILED',diagnosticCode:typed.code,stage:typed.phase,runtimeLoginObservation:value};
  assert.deepEqual(safeHostedBrowserResultFields(envelope).runtimeLoginObservation,value);
  assert.equal(safeHostedBrowserResultFields({...envelope,diagnosticCode:'PRIVATE_UNKNOWN'}).runtimeLoginObservation,undefined);
  assert.equal(safeHostedBrowserResultFields({...envelope,runtimeLoginObservation:{...value,cookie:'PRIVATE'}}).runtimeLoginObservation,undefined);
});

test('non200 diagnostic body cannot strand login cleanup beyond its bounded read', async t => {
  const f = fixture(t, 'normal_role'), browser = fakeLoginBrowser(identity(), f.state, { httpStatus: 503, bodyPending: true });
  await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE', expectedRole: 'finance' }, protectionState: {}, browserType: browser.browserType }), error => {
    assert.equal(safeFailure(error).runtimeLogin.errorCode, 'UNCLASSIFIED'); return true;
  });
  assert.equal(browser.waits(), 1); assert.equal(browser.counts().closed, 2);
});
