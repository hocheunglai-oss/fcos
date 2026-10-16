import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAdmittedSetup, prepareReleaseManifest } from './lib/hosted-release/manifest.mjs';
import { createLiveCollector } from './lib/hosted-release/live-collector.mjs';
import { fail } from './lib/hosted-release/contract.mjs';
import { assertHostedSetup, assertSourceAdmission } from './lib/hosted-release/admission.mjs';
import { readManifest, writeJson, workflowOutput } from './lib/hosted-release/session.mjs';

export async function prepareHostedManifest({ env = process.env } = {}) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'hocheunglai-oss/fcos' || env.GITHUB_REPOSITORY_ID !== '1278654816'
    || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') fail('HOSTED_MANIFEST_CONTEXT');
  const controllerDirectory = resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller'), candidateDirectory = resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate');
  const setup = JSON.parse(env.FCOS_ADMITTED_RELEASE_SETUP || '{}');
  assertAdmittedSetup({ setup, expectedSha256: env.FCOS_ADMITTED_RELEASE_SETUP_SHA256, controllerDirectory, controllerSha: env.FCOS_CONTROLLER_SHA });
  if (env.FCOS_RESUME_MANIFEST) {
    const manifest = readManifest(env.FCOS_RESUME_MANIFEST);
    if (manifest.controller.sha !== env.FCOS_CONTROLLER_SHA || manifest.candidate.sha !== env.FCOS_CANDIDATE_SHA) fail('RESUME_MANIFEST_CHANGED');
    assertHostedSetup({manifest,env});
    assertSourceAdmission({manifest,controllerDirectory,candidateDirectory});
    writeJson(env.FCOS_RELEASE_OUTPUT || 'release-manifest.json',manifest);
    workflowOutput({manifest:JSON.stringify(manifest)},env);
    return manifest;
  }
  const plan = env.FCOS_RELEASE_PLAN ? JSON.parse(env.FCOS_RELEASE_PLAN) : JSON.parse(readFileSync(env.FCOS_RELEASE_PLAN_FILE, 'utf8'));
  const manifest = await prepareReleaseManifest({ plan, setup, controllerDirectory, candidateDirectory,
    controllerSha: env.FCOS_CONTROLLER_SHA, candidateSha: env.FCOS_CANDIDATE_SHA,
    observePreviousProduction: async provisional => createLiveCollector({ session: { manifest: provisional, env }, candidateDirectory }).provider.observePreviousProduction() });
  writeJson(env.FCOS_RELEASE_OUTPUT || 'release-manifest.json', manifest);
  workflowOutput({ manifest: JSON.stringify(manifest) }, env);
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareHostedManifest().catch(error => {
  console.error(JSON.stringify({ status: 'intervention_required', code: error.code || 'MANIFEST_PREPARATION_FAILED' })); process.exitCode = 1;
});
