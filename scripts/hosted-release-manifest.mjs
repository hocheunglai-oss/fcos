import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAdmittedSetup, prepareReleaseManifest } from './lib/hosted-release/manifest.mjs';
import { createLiveCollector } from './lib/hosted-release/live-collector.mjs';
import { digest, fail, releaseTargets, sha } from './lib/hosted-release/contract.mjs';
import { assertHostedController, assertHostedSetup, assertSourceAdmission } from './lib/hosted-release/admission.mjs';
import { githubClient, validateQualificationRun } from './lib/hosted-release/github.mjs';
import { readManifest, writeJson, workflowOutput } from './lib/hosted-release/session.mjs';

/** Runs before candidate checkout/private provider inputs in the qualification bootstrap. */
export async function validateHostedDispatch({ env = process.env, createGithub = githubClient } = {}) {
  if (!sha(env.FCOS_CANDIDATE_SHA)) fail('CANDIDATE_BINDING');
  const controllerDirectory = resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller');
  const setup = JSON.parse(env.FCOS_ADMITTED_RELEASE_SETUP || '{}');
  assertAdmittedSetup({ setup, expectedSha256: env.FCOS_ADMITTED_RELEASE_SETUP_SHA256, controllerDirectory, controllerSha: env.FCOS_CONTROLLER_SHA });
  const resumed = env.FCOS_RESUME_MANIFEST ? readManifest(env.FCOS_RESUME_MANIFEST) : null;
  const plan = resumed || (env.FCOS_RELEASE_PLAN ? JSON.parse(env.FCOS_RELEASE_PLAN) : JSON.parse(readFileSync(env.FCOS_RELEASE_PLAN_FILE, 'utf8')));
  const mode = resumed ? resumed.executionMode : plan.executionMode || (plan.stage === 'qualification' ? 'qualification' : 'release');
  if (!['compatibility', 'application', 'qualification'].includes(plan.stage)
    || (plan.stage === 'qualification') !== (mode === 'qualification') || !['release', 'qualification'].includes(mode)) fail('MANIFEST_SCHEMA');
  const manifest = resumed || { stage: plan.stage, executionMode: mode, candidate: { sha: env.FCOS_CANDIDATE_SHA },
    controller: { sha: env.FCOS_CONTROLLER_SHA }, setupSha256: digest(setup), epoch: setup.epoch, targets: releaseTargets(),
    verification: setup.verification, ...(setup.dependencies ? { dependencies: setup.dependencies } : {}),
    ...(plan.stage === 'qualification' && setup.qualificationSource ? { qualificationSource: setup.qualificationSource } : {}) };
  if (manifest.controller.sha !== env.FCOS_CONTROLLER_SHA || manifest.candidate.sha !== env.FCOS_CANDIDATE_SHA) fail('RESUME_MANIFEST_CHANGED');
  assertHostedController({ controllerDirectory, controllerSha: env.FCOS_CONTROLLER_SHA, manifest, env });
  assertHostedSetup({ manifest, env });
  if (manifest.qualificationSource) {
    const github = createGithub({ token: env.FCOS_HOSTED_GITHUB_READ_TOKEN || env.GITHUB_TOKEN, repositoryId: env.GITHUB_REPOSITORY_ID });
    await github.identity();
    const run = await github.read(`/repos/${manifest.targets.repository}/actions/runs/${env.GITHUB_RUN_ID}`);
    await validateQualificationRun({ github, source: manifest.qualificationSource, run, env });
  }
  return { setup, plan, resumed, controllerDirectory };
}

export async function prepareHostedManifest({ env = process.env, validateDispatchOnly = false, createGithub = githubClient,
  prepareManifest = prepareReleaseManifest } = {}) {
  const { setup, plan, resumed, controllerDirectory } = await validateHostedDispatch({ env, createGithub });
  if (validateDispatchOnly) return { status: 'passed', phase: 'dispatch.admission', executionMode: plan.stage === 'qualification' ? 'qualification' : 'release' };
  const candidateDirectory = resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate');
  if (resumed) {
    assertSourceAdmission({ manifest: resumed, controllerDirectory, candidateDirectory });
    writeJson(env.FCOS_RELEASE_OUTPUT || 'release-manifest.json', resumed);
    workflowOutput({ manifest: JSON.stringify(resumed) }, env);
    return resumed;
  }
  const manifest = await prepareManifest({ plan, setup, controllerDirectory, candidateDirectory,
    controllerSha: env.FCOS_CONTROLLER_SHA, candidateSha: env.FCOS_CANDIDATE_SHA,
    observePreviousProduction: async provisional => createLiveCollector({ session: { manifest: provisional, env }, candidateDirectory }).provider.observePreviousProduction() });
  writeJson(env.FCOS_RELEASE_OUTPUT || 'release-manifest.json', manifest);
  workflowOutput({ manifest: JSON.stringify(manifest) }, env);
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dispatchOnly = process.argv.includes('--validate-dispatch-only');
  prepareHostedManifest({ validateDispatchOnly: dispatchOnly }).then(result => { if (dispatchOnly) console.log(JSON.stringify(result)); }).catch(error => {
    console.error(JSON.stringify({ status: 'intervention_required', code: error.code || 'MANIFEST_PREPARATION_FAILED' })); process.exitCode = 1;
  });
}
