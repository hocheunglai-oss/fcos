import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { digest, fail, sha } from './lib/hosted-release/contract.mjs';
import { assertHostedSetup, assertSourceAdmission } from './lib/hosted-release/admission.mjs';
import { githubClient } from './lib/hosted-release/github.mjs';
import { readManifest, writeJson } from './lib/hosted-release/session.mjs';
import { atReleaseBoundary, safeDiagnosticFailure } from './lib/hosted-release/failure.mjs';
import { createVercelPreviewAdmissionReader } from './lib/hosted-release/vercel.mjs';

export const DIAGNOSTIC_REF = 'refs/heads/codex/preview-admission-diagnostic-20261022';
export const DIAGNOSTIC_WORKFLOW = '.github/workflows/authenticated-release.yml';
export const DIAGNOSTIC_JOB = 'preview-admission-diagnostic';
const diagnosedControllerSha = '6a3fbd8fd05a76c052e7e380d618aedf43e5b72e';
const diagnosedCandidateSha = '2ef733d17dd12314c72971c2220b2b09903a6bf0';
const diagnosedSetupSha256 = '98d8a3dc58a0a274b0579128c36a9d224b18b1e93a03e27b61c3b451d73c5782';

/** This validates the NEW diagnostic caller. It never claims the old qualification identity. */
export async function verifyDiagnosticCaller({ env, github }) {
  const repository = fcosConnectionIdentifier('github', 'Repository');
  const actor = fcosConnectionIdentifier('github', 'Required account');
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository || env.GITHUB_REPOSITORY_ID !== '1278654816'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== DIAGNOSTIC_REF || env.GITHUB_REF_PROTECTED !== 'true'
    || env.GITHUB_RUN_ATTEMPT !== '1' || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')
    || !sha(env.GITHUB_SHA) || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
    || env.GITHUB_WORKFLOW_REF !== `${repository}/${DIAGNOSTIC_WORKFLOW}@${DIAGNOSTIC_REF}`
    || !sha(env.FCOS_DIAGNOSTIC_SOURCE_SHA) || env.GITHUB_ACTOR !== actor || !/^[1-9][0-9]*$/.test(env.GITHUB_ACTOR_ID || '')
    || env.FCOS_HOSTED_ENVIRONMENT !== 'fcos-hosted-preview' || env.FCOS_HOSTED_CREDENTIAL_CLASS !== 'preview') fail('DIAGNOSTIC_CALLER_CONTEXT', 'diagnostic.identity');
  await github.identity();
  const run = await github.read(`/repos/${repository}/actions/runs/${env.GITHUB_RUN_ID}`);
  const branchName = DIAGNOSTIC_REF.slice('refs/heads/'.length);
  const branchPath = `/repos/${repository}/branches/${encodeURIComponent(branchName)}`;
  const branch = await github.read(branchPath), protection = await github.read(`${branchPath}/protection`);
  const jobs = await github.pages(`/repos/${repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs`, 'jobs');
  const current = jobs.filter(job => job.name === DIAGNOSTIC_JOB && job.status === 'in_progress' && job.conclusion === null);
  if (run.repository?.full_name !== repository || String(run.repository?.id) !== env.GITHUB_REPOSITORY_ID
    || run.head_repository?.full_name !== repository || String(run.id) !== env.GITHUB_RUN_ID || run.head_sha !== env.GITHUB_SHA
    || run.head_branch !== branchName || run.event !== 'workflow_dispatch' || run.run_attempt !== 1
    || !['queued', 'in_progress'].includes(run.status) || run.conclusion !== null
    || ![DIAGNOSTIC_WORKFLOW, `${DIAGNOSTIC_WORKFLOW}@${branchName}`].includes(run.path)
    || run.actor?.login !== actor || String(run.actor?.id) !== env.GITHUB_ACTOR_ID
    || run.triggering_actor?.login !== actor || String(run.triggering_actor?.id) !== env.GITHUB_ACTOR_ID
    || branch.name !== branchName || branch.protected !== true || branch.commit?.sha !== env.GITHUB_SHA
    || protection.enforce_admins?.enabled !== true || protection.allow_force_pushes?.enabled !== false || protection.allow_deletions?.enabled !== false
    || current.length !== 1 || current[0].head_sha !== env.GITHUB_SHA || String(current[0].run_id) !== env.GITHUB_RUN_ID) fail('DIAGNOSTIC_CALLER_IDENTITY', 'diagnostic.identity');
  return { runId: env.GITHUB_RUN_ID, callerSha: env.GITHUB_SHA, implementationSha: env.FCOS_DIAGNOSTIC_SOURCE_SHA };
}

export function assertDiagnosticSources({ manifest, candidateDirectory, controllerDirectory, diagnosticDirectory, env }) {
  if (manifest.controller.sha !== diagnosedControllerSha || manifest.candidate.sha !== diagnosedCandidateSha
    || manifest.setupSha256 !== diagnosedSetupSha256 || !sha(env.FCOS_DIAGNOSTIC_SOURCE_SHA)) fail('DIAGNOSTIC_SOURCE_BINDING', 'diagnostic.source');
  const git = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8',
    env: { PATH: env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const [directory, expected] of [[controllerDirectory, manifest.controller.sha], [diagnosticDirectory, env.FCOS_DIAGNOSTIC_SOURCE_SHA]]) {
    if (git(directory, ['rev-parse', 'HEAD']) !== expected || git(directory, ['status', '--porcelain', '--untracked-files=no'])) fail('DIAGNOSTIC_CHECKOUT_CHANGED', 'diagnostic.source');
  }
  return assertSourceAdmission({ manifest, candidateDirectory, controllerDirectory });
}

export async function previewAdmissionDiagnostic({ env = process.env, fetchImpl = fetch, execute = execFileSync } = {}) {
  const boundaries = [], observe = boundary => { if (boundaries.at(-1) !== boundary) boundaries.push(boundary); };
  let binding;
  try {
    const manifest = atReleaseBoundary('diagnostic.setup', () => readManifest(env.FCOS_RELEASE_MANIFEST), observe);
    const github = githubClient({ token: env.FCOS_HOSTED_GITHUB_READ_TOKEN || env.GITHUB_TOKEN, repositoryId: env.GITHUB_REPOSITORY_ID, fetchImpl });
    const caller = await atReleaseBoundary('diagnostic.identity', () => verifyDiagnosticCaller({ env, github }), observe);
    const candidateDirectory = resolve(env.FCOS_CANDIDATE_DIRECTORY || 'candidate');
    const controllerDirectory = resolve(env.FCOS_CONTROLLER_DIRECTORY || 'controller');
    // The executing file's checkout is authoritative; an environment path cannot substitute code.
    const diagnosticDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
    atReleaseBoundary('diagnostic.source', () => assertDiagnosticSources({ manifest, candidateDirectory, controllerDirectory, diagnosticDirectory, env }), observe);
    atReleaseBoundary('diagnostic.setup', () => assertHostedSetup({ manifest, env }), observe);
    binding = { ...caller, diagnosedControllerSha: manifest.controller.sha, candidateSha: manifest.candidate.sha,
      setupSha256: manifest.setupSha256, manifestHash: digest(manifest) };
    const reader = createVercelPreviewAdmissionReader({ manifest, candidateDirectory, env, fetchImpl, execute, observeBoundary: observe });
    await reader.admit();
    return { kind: 'fcos_preview_admission_diagnostic_v1', status: 'admission_passed', releaseAdmission: false,
      providerSubmissionStarted: false, binding, boundaries };
  } catch (error) {
    return { kind: 'fcos_preview_admission_diagnostic_v1', ...safeDiagnosticFailure(error), releaseAdmission: false,
      providerSubmissionStarted: false, ...(binding ? { binding } : {}), boundaries };
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const report = await previewAdmissionDiagnostic();
  // Only fixed boundaries, controlled error codes and public source identifiers are persisted.
  writeJson(process.env.FCOS_RELEASE_OUTPUT || 'preview-admission-diagnostic.json', report);
  console.log(JSON.stringify(report));
  if (report.status !== 'admission_passed') process.exitCode = 1;
}
