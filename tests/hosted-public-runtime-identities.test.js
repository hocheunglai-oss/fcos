import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReleaseManifest } from '../scripts/lib/hosted-release/manifest.mjs';
import { digest, releaseTargets } from '../scripts/lib/hosted-release/contract.mjs';
import { assertPublicRuntimeIdentityPrerequisites } from '../scripts/lib/hosted-release/public-runtime-identities.mjs';

test('application Preview requires its own public identity binding without silently enrolling into the compatibility profile', () => {
  assert.throws(() => assertPublicRuntimeIdentityPrerequisites({
    candidate: { sha: 'f'.repeat(40), sourceProfile: 'application_v2' }, verification: {},
  }), { code: 'SOURCE_API_GRAPH_IDENTITY_REQUIRED' });
  assert.deepEqual(assertPublicRuntimeIdentityPrerequisites({
    candidate: { sha: 'f'.repeat(40), sourceProfile: 'frozen_04ee' }, verification: {},
  }), {});
});

test('ordinary detached Preview identity prerequisites stop manifest acquisition before the first provider observation', async () => {
  const sha = 'be6daf6162480ca77ec8d4f04fe5aaa5b228a22c', controllerSha = 'a'.repeat(40);
  const setup = { schemaVersion: 2, controllerSha, targetsSha256: digest(releaseTargets()), epoch: 1,
    probeProtocol: 'xero_metered_v1', verification: { vercelSourceTransport: 'fcos_source_api_archive_v1' } };
  const options = { setup, controllerSha, candidateSha: sha,
    plan: { schemaVersion: 2, stage: 'compatibility', runtime: { probeProtocol: 'xero_metered_v1' } },
    collectSource: () => ({ candidate: { sha, sourceProfile: 'compat_runtime_ordinary_admission_20261025' }, controller: {}, checks: [] }) };
  let observations = 0;
  const observePreviousProduction = async () => { observations++; throw new Error('LOCAL_OBSERVATION_REACHED'); };
  await assert.rejects(prepareReleaseManifest({ ...options, observePreviousProduction }), { code: 'SOURCE_API_GRAPH_IDENTITY_REQUIRED' });
  assert.equal(observations, 0);
  setup.verification.publicPreviewRuntimeIdentityEnvironment = { FCOS_MICROSOFT_CLIENT_SECRET: 'PRIVATE_SENTINEL' };
  await assert.rejects(prepareReleaseManifest({ ...options, observePreviousProduction }), { code: 'PUBLIC_RUNTIME_IDENTITY_INPUT' });
  assert.equal(observations, 0);
  setup.verification.publicPreviewRuntimeIdentityEnvironment = {
    FCOS_MICROSOFT_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    FCOS_MICROSOFT_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  };
  await assert.rejects(prepareReleaseManifest({ ...options, observePreviousProduction }), /LOCAL_OBSERVATION_REACHED/);
  assert.equal(observations, 1);
});
