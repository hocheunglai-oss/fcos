import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { admitVercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { COMPATIBILITY_NORMAL_MODULES, verifyRuntimeCompatibilityNormalRole } from '../scripts/runtime-compatibility-normal-role.mjs';
import { PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID } from '../scripts/lib/preview-email-signer.mjs';
import { runHostedBrowser, loginHostedFcuno, runHostedRestrictedHarness, createHostedRuntimeTokenProvider,
  assertHostedBrowserBinding, recheckHostedPreviewProvider, hostedBrowserLaunchEnvironment } from '../scripts/lib/hosted-release/browser.mjs';

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
  const result = await runHostedRestrictedHarness({ origin, state: f.state, directory: f.directory, controllerDirectory: root,
    env: { PATH: '/bin', HOME: '/tmp', FCOS_HOSTED_RESTRICTED_PASSWORD: 'PRIVATE', FCOS_E2E_VERCEL_BYPASS: 'PRIVATE', GH_TOKEN: 'PRIVATE' },
    run: (program, args, opts) => {
      assert.equal(program, process.execPath); assert.equal(args[0], join(root, 'node_modules/@playwright/test/cli.js')); assert.equal(opts.shell, false);
      assert.doesNotMatch(JSON.stringify(opts.env), /PRIVATE|PASSWORD|TOKEN|BYPASS/);
      const config = readFileSync(args[args.indexOf('--config') + 1], 'utf8'); assert.match(config, /globalSetup:undefined/); assert.match(config, /screenshot:'off'/); assert.match(config, /trace:'off'/); assert.match(config, /dependencies:\[\]/);
      return { status: 0, stdout: JSON.stringify({ stats: { expected: 21, unexpected: 0, skipped: 0, flaky: 0 }, suites: ['workspace-smoke.spec.js', 'dashboard.spec.js', 'api-denials.spec.js'].map(file => ({ file })) }) };
    } });
  assert.equal(result.testsPassed, 21);
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

function fakeLoginBrowser(auth, state, { foreign = false, cleanupFail = false } = {}) {
  let location = origin, fills = 0, closed = 0;
  const issuer = new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin;
  const response = { status: () => 200, json: async () => auth };
  const page = { goto: async () => { location = foreign ? 'https://foreign.invalid/admin' : `${origin}/login`; }, url: () => location,
    getByRole: (_, { name }) => ({ click: async () => { location = name === 'Continue with FCUNO' ? (foreign ? location : `${issuer}/admin`) : origin; } }),
    getByLabel: () => ({ fill: async () => { fills++; assert.equal(new URL(location).origin, issuer); } }),
    waitForURL: async predicate => { if (!predicate(new URL(location))) throw Error('PRIVATE_WRONG_LOCATION'); }, waitForResponse: async () => response };
  const context = { newPage: async () => page, storageState: async () => state, close: async () => { closed++; if (cleanupFail) throw Error('PRIVATE_CLEANUP_ERROR'); } };
  return { browserType: { launch: async () => ({ newContext: async () => context, close: async () => { closed++; } }) }, counts: () => ({ fills, closed }) };
}

test('fresh FCUNO login only fills pinned issuer and yields candidate-only new state; foreign issuer fails before password entry', async t => {
  const f = fixture(t, 'normal_role'); const browser = fakeLoginBrowser(identity(), { ...f.state, cookies: [{ domain: new URL(origin).hostname, name: '_vercel_jwt' }, { domain: 'foreign.invalid', name: 'issuer' }] });
  const login = await loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: browser.browserType });
  assert.equal(login.token, 'PRIVATE_NEW_TEST_TOKEN'); assert.equal(login.state.cookies.length, 1); assert.deepEqual(browser.counts(), { fills: 2, closed: 2 });
  const foreign = fakeLoginBrowser(identity(), f.state, { foreign: true });
  await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: foreign.browserType }), /Dedicated hosted FCUNO login failed/);
  assert.deepEqual(foreign.counts(), { fills: 0, closed: 2 });
  const cleanup = fakeLoginBrowser(identity(), f.state, { cleanupFail: true });
  await assert.rejects(loginHostedFcuno({ origin, mode: 'normal_role', credentials: { email: 'normal@example.invalid', password: 'PRIVATE_TEST', expectedRole: 'finance' }, protectionState: {}, browserType: cleanup.browserType }), /browser cleanup failed/);
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
