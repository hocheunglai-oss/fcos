import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { assertReleaseBrowserEnvironment, verifyReleasePreviewArtifact } from '../scripts/lib/release-environment.mjs';
import { verifyRelease } from '../scripts/verify-release.mjs';

const releaseSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const candidateUrl = 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app';
const validEnvironment = {
  FCOS_E2E_CANDIDATE_URL: candidateUrl,
  FCOS_E2E_EXPECTED_COMMIT: releaseSha,
  FCOS_E2E_STATE_DIR: '/tmp/fcos-e2e-release-test',
  FCOS_E2E_STORAGE_STATE: '/tmp/fcos-e2e-release-test/auth.json',
  FCOS_E2E_PROTECTION_STATE: '/tmp/fcos-e2e-release-test/protection.json',
  FCOS_AUTH_E2E_ENABLED: 'true',
  FCOS_E2E_EMAIL: FCOS_READ_ONLY_CI.email,
  FCOS_E2E_PASSWORD: 'test-only-password',
  FCOS_E2E_VERCEL_BYPASS: 'a'.repeat(32),
  GITHUB_TOKEN: 'test-only-read-token',
};

test('strict release accepts the same exact candidate and private-state contract as the trusted harness', () => {
  const environment = assertReleaseBrowserEnvironment(validEnvironment);
  assert.equal(environment.candidateUrl, candidateUrl);
  assert.equal(environment.expectedCommit, releaseSha);
  assert.equal(environment.storageState, validEnvironment.FCOS_E2E_STORAGE_STATE);
  for (const key of ['FCOS_E2E_PASSWORD', 'FCOS_E2E_VERCEL_BYPASS', 'GITHUB_TOKEN', 'FCOS_AUTH_E2E_ENABLED']) {
    assert.throws(() => assertReleaseBrowserEnvironment({ ...validEnvironment, [key]: '' }));
  }
  assert.throws(() => assertReleaseBrowserEnvironment({ ...validEnvironment, FCOS_E2E_EMAIL: 'ordinary-viewer@example.test' }), /pinned read-only/);
});

test('strict release rejects mutable targets, divergent URLs, legacy inputs and unsafe state paths', () => {
  for (const target of ['https://fcos.fcuno.com', 'https://fcos-git-main-hocheunglai-6535s-projects.vercel.app', `${candidateUrl}/`, `${candidateUrl}/login`, 'https://foreign.example']) {
    assert.throws(() => assertReleaseBrowserEnvironment({ ...validEnvironment, FCOS_E2E_CANDIDATE_URL: target }));
  }
  for (const fields of [
    { FCOS_E2E_BASE_URL: 'https://foreign.example' },
    { FCOS_E2E_EXPECTED_COMMIT: releaseSha.toUpperCase() },
    { FCOS_E2E_STATE_DIR: '/tmp' },
    { FCOS_E2E_STORAGE_STATE: '/tmp/fcos-e2e-release.json' },
    { FCOS_E2E_PROTECTION_STATE: validEnvironment.FCOS_E2E_STORAGE_STATE },
    { FCOS_E2E_CANDIDATE_URL: undefined, FCOS_E2E_BASE_URL: candidateUrl },
    { FCOS_E2E_EXPECTED_COMMIT: undefined, FCOS_E2E_PREVIEW_SHA: releaseSha, FCOS_RELEASE_SHA: releaseSha },
  ]) assert.throws(() => assertReleaseBrowserEnvironment({ ...validEnvironment, ...fields }));
});

function providerFetch(calls, { deploymentSha = releaseSha, artifactSha = releaseSha, creator = 'vercel[bot]' } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    const body = url.includes('/deployments?')
      ? [{ id: 7, sha: deploymentSha, environment: 'Preview', creator: { login: creator } }]
      : url.includes('/statuses?')
        ? [{ state: 'success', creator: { login: creator }, environment_url: candidateUrl }]
        : { commit: artifactSha };
    return { ok: true, url, json: async () => body };
  };
}

test('release requires independent newest Preview provenance before checking candidate-controlled metadata', async () => {
  const environment = assertReleaseBrowserEnvironment(validEnvironment);
  const calls = [];
  const proof = await verifyReleasePreviewArtifact(environment, { fetchImpl: providerFetch(calls), maxWaitMs: 0 });
  assert.equal(proof.commit, releaseSha);
  assert.equal(proof.githubDeploymentId, 7);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    if (call.url.startsWith('https://api.github.com/')) {
      assert.equal(call.options.headers.authorization, `Bearer ${validEnvironment.GITHUB_TOKEN}`);
      assert.equal(call.options.headers['x-vercel-protection-bypass'], undefined);
    } else {
      assert.equal(call.url, `${candidateUrl}/app-version.json`);
      assert.equal(call.options.headers.authorization, undefined);
      assert.equal(call.options.headers['x-vercel-protection-bypass'], validEnvironment.FCOS_E2E_VERCEL_BYPASS);
    }
  }
  for (const settings of [{ deploymentSha: 'b'.repeat(40) }, { creator: 'other-bot' }]) {
    const rejectedCalls = [];
    await assert.rejects(() => verifyReleasePreviewArtifact(environment, { fetchImpl: providerFetch(rejectedCalls, settings), maxWaitMs: 0 }), /No successful immutable/);
    assert.equal(rejectedCalls.length, 1, 'unverified candidate must never receive the bypass');
  }
  await assert.rejects(() => verifyReleasePreviewArtifact(environment, { fetchImpl: providerFetch([], { artifactSha: 'b'.repeat(40) }), maxWaitMs: 0 }), /commit does not match/);
  await assert.rejects(() => verifyReleasePreviewArtifact(environment, { fetchImpl: async () => { throw new Error(validEnvironment.GITHUB_TOKEN); } }), error => !error.message.includes(validEnvironment.GITHUB_TOKEN));
});

const proof = { candidateUrl, commit: releaseSha };

test('release gates scope credentials, enforce strict checks, and always clean private browser state on browser failure', async () => {
  const calls = [];
  const lifecycle = [];
  await assert.rejects(() => verifyRelease({
    environment: validEnvironment,
    checkedOutCommit: () => releaseSha,
    verify: async () => proof,
    prepare: async options => { lifecycle.push('prepare'); assert.equal(options.dependencies.allowExisting, false); },
    cleanup: async () => { lifecycle.push('cleanup'); },
    run: (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return { status: args.includes('test:e2e') ? 1 : 0 };
    },
  }), /Read-only browser smoke tests/);
  assert.deepEqual(lifecycle, ['prepare', 'cleanup']);
  const browser = calls.at(-1);
  assert.equal(browser.env.FCOS_E2E_EXPECTED_COMMIT, releaseSha);
  assert.equal(browser.env.FCOS_E2E_BASE_URL, candidateUrl);
  assert.equal(browser.env.FCOS_E2E_PROTECTION_STATE, validEnvironment.FCOS_E2E_PROTECTION_STATE);
  assert.equal(browser.env.FCOS_REQUIRE_AUTH_E2E, '1');
  assert.ok(browser.args.includes('--trace=off'));
  for (const call of calls.slice(0, -1)) {
    for (const key of ['FCOS_E2E_PASSWORD', 'FCOS_E2E_VERCEL_BYPASS', 'GITHUB_TOKEN']) assert.equal(call.env[key], undefined);
  }
  assert.equal(calls.find(call => call.args.includes('verify:migrations')).env.FCOS_REQUIRE_LIVE_MIGRATION_CHECK, '1');
  assert.equal(calls.find(call => call.args.includes('verify:performance')).env.FCOS_REQUIRE_SERVER_BUNDLES, '1');
  assert.ok(calls.some(call => call.args.includes('verify:compatibility')));
});

test('release fails before any command or state creation on mismatched checkout or unverified provenance', async () => {
  const unexpected = () => assert.fail('must not execute');
  await assert.rejects(() => verifyRelease({ environment: validEnvironment, checkedOutCommit: () => 'b'.repeat(40), verify: unexpected, run: unexpected, prepare: unexpected }), /checkout must match/);
  await assert.rejects(() => verifyRelease({ environment: validEnvironment, checkedOutCommit: () => releaseSha, verify: async () => { throw new Error('unverified'); }, run: unexpected, prepare: unexpected }), /unverified/);
  const result = spawnSync(process.execPath, ['scripts/verify-release.mjs'], { cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FCOS_E2E_CANDIDATE_URL is required/);
  assert.doesNotMatch(result.stdout, /\[release gate\]/);
});
