import { qualificationSourceBinding } from '../../../config/hostedReleaseQualification.js';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { digest, fail, validateManifest } from './contract.mjs';
import { assertHostedController, assertHostedSetup, assertSourceAdmission } from './admission.mjs';
import { atReleaseBoundary } from './failure.mjs';
import { createCoordinatorClient } from './coordinator-client.mjs';
import { githubClient, requestGitHubIdentity, validateHostedIdentity, validateQualificationRun } from './github.mjs';
import { acquireCurrentHostedJob } from './current-job-visibility.mjs';

export function readManifest(value) {
  if (typeof value !== 'string' || value.length > 131072) fail('MANIFEST_INPUT');
  let manifest; try { manifest = JSON.parse(value); } catch { fail('MANIFEST_JSON'); }
  validateManifest(manifest); return manifest;
}
export function writeJson(file, value) {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
export function workflowOutput(values, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-z_]+$/.test(key) || /[\r\n]/.test(String(value))) fail('WORKFLOW_OUTPUT');
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${String(value)}\n`);
  }
}
export async function hostedSession({ manifest, candidateDirectory, controllerDirectory, env = process.env, jobName, requireOidc = true, deadlineEpochMs, signal }) {
  atReleaseBoundary('session.controller', () => assertHostedController({ controllerDirectory, controllerSha: manifest.controller.sha, manifest, env }));
  atReleaseBoundary('session.setup', () => assertHostedSetup({ manifest, env }));
  const admission = atReleaseBoundary('session.source', () => assertSourceAdmission({ manifest, candidateDirectory, controllerDirectory }));
  return atReleaseBoundary('session.github', async () => {
  const github = githubClient({ token: env.FCOS_HOSTED_GITHUB_READ_TOKEN || env.GITHUB_TOKEN, repositoryId: env.GITHUB_REPOSITORY_ID });
  await atReleaseBoundary('session.github', () => github.identity());
  const run = await github.read(`/repos/${manifest.targets.repository}/actions/runs/${env.GITHUB_RUN_ID}`);
  const qualificationSource = qualificationSourceBinding(manifest);
  if (qualificationSource) await validateQualificationRun({ github, source: qualificationSource, run, env });
  const job = await acquireCurrentHostedJob({ github, repository: manifest.targets.repository, run, jobName, env, qualificationSource,
    qualificationRunVerified: Boolean(qualificationSource), deadlineEpochMs, signal });
  const observationEnv = { ...env, FCOS_VERIFIED_JOB_ID: String(job.id) };
  if (!requireOidc) return { manifest, admission, github, env: observationEnv, binding: { releaseId: manifest.releaseId, manifestHash: digest(manifest) } };
  const identity = await atReleaseBoundary('session.identity', () => requestGitHubIdentity({ env }));
  await validateHostedIdentity(identity, { controllerSha: manifest.controller.sha, repositoryId: env.GITHUB_REPOSITORY_ID,
    runId: env.GITHUB_RUN_ID, qualificationSource, environment: env.FCOS_HOSTED_ENVIRONMENT || undefined });
  const coordinator = createCoordinatorClient({ url: env.FCOS_HOSTED_COORDINATOR_URL, epoch: manifest.epoch,
    owner: { kind: 'release', id: 'features' }, tokenProvider: () => requestGitHubIdentity({ env }) });
  return { manifest, admission, github, coordinator, env: observationEnv, binding: { releaseId: manifest.releaseId, manifestHash: digest(manifest) } };
  });
}
export function manifestFromFile(file) { return readManifest(readFileSync(file, 'utf8')); }
