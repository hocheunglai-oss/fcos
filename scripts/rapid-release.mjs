#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createManifest, changedPaths, digest, git, requireCondition, sourceSnapshot, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { assertBuildArtifact, qualityAndBuild } from './lib/rapid-release/build.mjs';
import { DeploymentJournal, pendingOperations } from './lib/rapid-release/journal.mjs';
import { improvementSummary } from './lib/rapid-release/learning.mjs';
import { handleReleaseObstacle } from './lib/rapid-release/improvement-runtime.mjs';
import { stageRelease, promoteRelease, phaseResult } from './lib/rapid-release/engine.mjs';
import { githubClient, nativeApproval, verifyExecution, vercelProvider } from './lib/rapid-release/providers.mjs';
import { runPrerequisites } from './lib/rapid-release/prerequisites.mjs';
import { nativeCompatibilityReader } from './lib/rapid-release/compatibility.mjs';

const read = path => JSON.parse(readFileSync(resolve(path), 'utf8'));
const write = (path, value) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); };
function options(args) {
  const [command = 'status', ...rest] = args, opts = {};
  const allowed = new Set(['manifest', 'candidate', 'controller', 'baseline', 'public-environment', 'output', 'build', 'artifact-directory', 'incident', 'registry', 'approach', 'prerequisites']);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '');
    requireCondition(rest[index]?.startsWith('--') && allowed.has(key) && !opts[key] && rest[index + 1] && !rest[index + 1].startsWith('--'), 'CLI_OPTION_INVALID');
    opts[key] = rest[index + 1];
  }
  return { command, opts };
}
async function context(manifest, env) {
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha });
  const identity = await github.identity();
  const operator = await github.read(`/repos/${targets().repository}`);
  requireCondition(operator.full_name === targets().repository, 'GITHUB_TARGET_MISMATCH');
  const actorIds = [identity.user.id];
  if (identity.user.login !== targets().account) {
    const run = await github.read(`/repos/${targets().repository}/actions/runs/${env.GITHUB_RUN_ID}`);
    requireCondition(run.actor?.login === targets().account, 'RELEASE_OPERATOR_MISMATCH'); actorIds.push(run.actor.id);
  }
  return { github, journal: new DeploymentJournal({ github, actorIds, releaseId: manifest.releaseId, manifestHash: digest(manifest) }) };
}
async function rapidReleaseCommand(argv, env, runtime) {
  const { command, opts } = options(argv), controller = resolve(opts.controller || process.cwd());
  Object.assign(runtime, { phase: command, controllerDirectory: controller, opts });
  if (command === 'baseline') {
    requireCondition(opts.output, 'BASELINE_OUTPUT_REQUIRED');
    const provider = vercelProvider({ env });
    const current = await provider.currentProduction();
    const receipt = await nativeCompatibilityReader({ provider, env })({ manifest: {}, previous: { deploymentId: current.id } });
    write(opts.output, { deploymentId: current.id, sha: current.sha, configurationDigest: receipt.configurationDigest, schemaDigest: receipt.schemaDigest });
    return { state: 'baseline_collected', deploymentId: current.id, sha: current.sha, observedAt: receipt.observedAt };
  }
  if (command === 'prepare') {
    requireCondition(opts.candidate && opts.baseline && opts['public-environment'] && opts.output, 'PREPARE_ARGUMENTS_REQUIRED');
    const candidate = resolve(opts.candidate), baseline = read(opts.baseline);
    const manifest = createManifest({ candidate: sourceSnapshot(candidate), controllerSha: git(controller, ['rev-parse', 'HEAD']), previous: baseline,
      paths: changedPaths(candidate, baseline.sha), publicEnvironment: read(opts['public-environment']), prerequisites: opts.prerequisites ? read(opts.prerequisites) : null,
      releaseId: `rapid-${sourceSnapshot(candidate).sha.slice(0,12)}-${Date.now().toString(36)}` });
    write(opts.output, manifest); return { state: 'prepared', releaseId: manifest.releaseId, selection: manifest.selection, manifestHash: digest(manifest) };
  }
  if (command === 'handover-audit') {
    const pointer = env.FCOS_CANONICAL_RELEASE_STATE;
    requireCondition(pointer && existsSync(pointer), 'CANONICAL_RELEASE_STATE_REQUIRED');
    const state = read(pointer);
    return { state: 'handover_required', productionAuthority: false, currentNavigationDigest: digest(state),
      checkpointPath: state.implementationCheckpointPath, ownedCleanupOutstanding: state.currentOwnedCleanupOutstanding ?? null,
      required: ['fresh original-owner native coordinator readback', 'inventory and retirement of every old writer',
        'deployment-event subscriber review', 'exact controller hosted qualification', 'genuine protected final setup decision'],
      historicalUnknownsPreserved: true };
  }
  requireCondition(opts.manifest, 'MANIFEST_PATH_REQUIRED'); const manifest = read(opts.manifest); validateManifest(manifest);
  runtime.manifest = manifest;
  if (command === 'quality') {
    requireCondition(opts.candidate && opts.output, 'QUALITY_ARGUMENTS_REQUIRED');
    const result = qualityAndBuild({ manifest, controllerDirectory: controller, candidateDirectory: resolve(opts.candidate), env });
    write(opts.output, result); return result;
  }
  const { github, journal } = await context(manifest, env);
  runtime.journal = journal;
  if (command === 'status') {
    const records = await journal.read(); return { releaseId: manifest.releaseId, events: records.length,
      pending: pendingOperations(records), latest: records.at(-1)?.payload.event || 'not_started', improvements: improvementSummary(records) };
  }
  if (command === 'repair') {
    requireCondition(opts.incident, 'OBSTACLE_FILE_REQUIRED');
    const incident = read(opts.incident);
    runtime.phase = incident.phase;
    runtime.provider = vercelProvider({ manifest, github, env });
    return handleReleaseObstacle({ ...runtime, error: { code: incident.code },
      registry: read(opts.registry || join(controller, 'config/rapid-release-learning.json')) });
  }
  requireCondition(['stage', 'promote', 'resume'].includes(command), 'CLI_COMMAND_INVALID');
  await verifyExecution({ github, manifest, env, phase: command });
  const provider = vercelProvider({ manifest, github, env, outputDirectory: opts['artifact-directory'] && resolve(opts['artifact-directory']) });
  runtime.provider = provider;
  const { runStagedSmoke, observeLive } = await import('./lib/rapid-release/smoke.mjs');
  const smoke = values => runStagedSmoke({ ...values, env });
  const records = await journal.read(), staged = phaseResult(records, 'stage')?.result;
  const compatibility = await nativeCompatibilityReader({ provider, env })({ manifest });
  requireCondition(compatibility.currentDeploymentId === manifest.previous.deploymentId || staged?.id === compatibility.currentDeploymentId,
    'PRODUCTION_BASELINE_CHANGED');
  requireCondition(compatibility.configurationDigest === manifest.previous.configurationDigest
    && (records.some(record => record.payload.event === 'prerequisites.passed') || compatibility.schemaDigest === manifest.previous.schemaDigest), 'BASELINE_NATIVE_FINGERPRINT_CHANGED');
  let result;
  if (command === 'stage' || command === 'resume' && !staged) {
    requireCondition(opts.build && opts['artifact-directory'], 'STAGE_ARTIFACT_REQUIRED');
    const build = read(opts.build); assertBuildArtifact(resolve(opts['artifact-directory']), build, manifest);
    const jobs = await github.read(`/repos/${targets().repository}/actions/runs/${env.GITHUB_RUN_ID}/jobs?per_page=100`);
    requireCondition(jobs.jobs?.some(job => job.name === 'quality' && job.conclusion === 'success'), 'NATIVE_QUALITY_JOB_REQUIRED');
    result = await stageRelease({ manifest, journal, provider, build, smoke });
  } else {
    requireCondition(staged, 'STAGED_DEPLOYMENT_REQUIRED');
    const approval = await nativeApproval({ github, manifest, staged, env });
    result = await promoteRelease({ manifest, journal, provider, approval, smoke,
      observe: values => observeLive({ ...values, env }),
      prerequisites: values => runPrerequisites({ ...values, staged, journal, controllerDirectory: controller, env }) });
  }
  if (opts.output) write(opts.output, result);
  return result;
}
export async function rapidReleaseMain(argv, env = process.env) {
  const runtime = {}, started = Date.now();
  try {
    const result = await rapidReleaseCommand(argv, env, runtime);
    if (result.waiting && runtime.manifest) result.improvement = await handleReleaseObstacle({ ...runtime,
      phase: result.operationId?.endsWith('-stage') ? 'stage' : runtime.phase,
      error: { code: result.code }, elapsedMs: Date.now() - started,
      registry: read(join(runtime.controllerDirectory, 'config/rapid-release-learning.json')) });
    if (['quality', 'stage'].includes(runtime.phase) && Date.now() - started > 900000 && runtime.manifest)
      result.performanceReview = await handleReleaseObstacle({ ...runtime, error: { code: 'PHASE_PERFORMANCE_BUDGET_EXCEEDED' },
        elapsedMs: Date.now() - started, registry: read(join(runtime.controllerDirectory, 'config/rapid-release-learning.json')) });
    return result;
  } catch (error) {
    if (runtime.manifest) {
      try {
        const improvement = await handleReleaseObstacle({ ...runtime, error, elapsedMs: Date.now() - started,
          registry: read(join(runtime.controllerDirectory, 'config/rapid-release-learning.json')) });
        return { state: 'checkpoint_preserved', waiting: true, code: improvement.incident.code, improvement };
      } catch { /* Capture failure must preserve the original error and checkpoint. */ }
    }
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rapidReleaseMain(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (['intervention_required', 'rolled_back'].includes(result.state) || result.waiting) process.exitCode = 1;
  }).catch(error => {
    // Provider text is untrusted and may contain private data. Emit only owned error codes.
    const code = /^[A-Z][A-Z0-9_]{0,120}$/.test(error.code || error.message) ? error.code || error.message : 'RAPID_RELEASE_FAILED';
    console.error(JSON.stringify({ state: 'checkpoint_preserved', code })); process.exitCode = 1;
  });
}
