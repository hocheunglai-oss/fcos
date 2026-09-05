import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { assertReleaseBrowserEnvironment, verifyReleasePreviewArtifact } from '../scripts/lib/release-environment.mjs';

const releaseSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const validEnvironment = {
  FCOS_E2E_BASE_URL: 'https://fcos-git-quality-gates-hocheunglai-6535s-projects.vercel.app/',
  FCOS_E2E_PREVIEW_SHA: releaseSha,
  FCOS_RELEASE_SHA: releaseSha,
  FCOS_E2E_STORAGE_STATE: '/tmp/fcos-e2e-release.json',
  FCOS_E2E_EMAIL: 'fcos-ci-viewer@example.test',
  FCOS_E2E_PASSWORD: 'test-only-password',
};

test('strict release browser verification accepts only a supplied preview linked to the full release SHA', () => {
  const environment = assertReleaseBrowserEnvironment(validEnvironment);
  assert.equal(environment.baseUrl, 'https://fcos-git-quality-gates-hocheunglai-6535s-projects.vercel.app');
  assert.equal(environment.previewSha, validEnvironment.FCOS_RELEASE_SHA);
});

test('strict release browser verification fails closed without renewable authentication', () => {
  const environment = { ...validEnvironment, FCOS_E2E_PASSWORD: '' };
  assert.throws(() => assertReleaseBrowserEnvironment(environment), /FCOS_E2E_PASSWORD is required/);
});

test('strict release browser verification rejects a mismatched, off-host, or unsafe preview target', () => {
  assert.throws(
    () => assertReleaseBrowserEnvironment({ ...validEnvironment, FCOS_E2E_PREVIEW_SHA: 'd'.repeat(40) }),
    /must match FCOS_RELEASE_SHA/,
  );
  assert.throws(
    () => assertReleaseBrowserEnvironment({ ...validEnvironment, FCOS_E2E_BASE_URL: 'https://fcos.fcuno.com' }),
    /FCOS Vercel preview URL/,
  );
  assert.throws(
    () => assertReleaseBrowserEnvironment({ ...validEnvironment, FCOS_E2E_BASE_URL: 'https://fcos-git-quality-gates.example.test' }),
    /FCOS Vercel preview URL/,
  );
  assert.throws(
    () => assertReleaseBrowserEnvironment({ ...validEnvironment, FCOS_E2E_BASE_URL: 'https://viewer:password@fcos-git-quality-gates-hocheunglai-6535s-projects.vercel.app/login' }),
    /no credentials, path, query, or fragment/,
  );
  assert.throws(
    () => assertReleaseBrowserEnvironment({ ...validEnvironment, FCOS_E2E_STORAGE_STATE: '/tmp/fcos-e2e/unsafe.json' }),
    /dedicated \/tmp\/fcos-e2e/,
  );
});

test('release preview artifact must be fetched without redirects and prove the deployed full commit before authentication', async () => {
  const environment = assertReleaseBrowserEnvironment(validEnvironment);
  const calls = [];
  const proof = await verifyReleasePreviewArtifact(environment, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, url: '', json: async () => ({ commit: releaseSha }) };
    },
  });
  assert.deepEqual(proof, { artifactUrl: `${environment.baseUrl}/app-version.json`, commit: releaseSha });
  assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(
    () => verifyReleasePreviewArtifact(environment, {
      fetchImpl: async () => ({ ok: true, url: '', json: async () => ({ commit: 'b'.repeat(40) }) }),
    }),
    /does not match the expected release SHA/,
  );
  await assert.rejects(
    () => verifyReleasePreviewArtifact(environment, {
      fetchImpl: async () => ({ ok: false, url: 'https://redirected.example.test/app-version.json', json: async () => ({}) }),
    }),
    /unavailable or redirected/,
  );
});

test('release command fails before running any gate when preview or authentication is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-release.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /FCOS_E2E_BASE_URL is required/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /\[release gate\]/);
});
