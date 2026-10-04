import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { collectBuildProvenance } from './build-provenance.mjs';
import { releaseConfigurationRevision, releaseHash, RELEASE_MAX_AGE_MS } from './release-readiness.mjs';

export const CANDIDATE_QUALITY_SHA = '6dbb83215cc5b9964dbe32a13f852e3a62e7bcc2';
export const CANDIDATE_QUALITY_MANIFEST = `.github/quality-candidates/${CANDIDATE_QUALITY_SHA}.json`;
export const CANDIDATE_QUALITY_WORKFLOW = '.github/workflows/candidate-quality.yml';
export const CANDIDATE_QUALITY_ENABLE = 'FCOS_TRUSTED_CANDIDATE_QUALITY_ENABLED';
export const CANDIDATE_QUALITY_FILENAME = 'fcos-quality-source.json';
const manifestBytes = readFileSync(new URL(`../../${CANDIDATE_QUALITY_MANIFEST}`, import.meta.url));
export const CANDIDATE_QUALITY_ADMISSION = Object.freeze(JSON.parse(manifestBytes));
export const CANDIDATE_QUALITY_MANIFEST_HASH = releaseHash(manifestBytes);
const repositoryName = fcosConnectionIdentifier('github', 'Repository');
const operator = fcosConnectionIdentifier('github', 'Required account');
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const hash = value => /^[0-9a-f]{64}$/.test(value || '');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const fresh = (value, now) => Number.isFinite(time(value)) && time(value) <= now + 30000 && now - time(value) <= RELEASE_MAX_AGE_MS;
const fail = () => { throw new Error('Trusted candidate quality evidence is unavailable or outside its reviewed scope.'); };

export const CANDIDATE_QUALITY_TEST_STEPS = Object.freeze([
  'Install locked candidate dependencies', 'Verify pinned FCUNO contract', 'Verify development controls', 'Verify compatibility',
  'Run unit tests', 'Lint candidate', 'Typecheck candidate', 'Install isolated browsers',
  'Verify desktop notification and Hedge Desk refresh races', 'Verify Nom B desktop and mobile workflows without providers',
  'Verify trader Nom B filing and interrupted upload recovery', 'Verify read-only Xero integrity reporting without providers',
  'Verify group-first People & Access without providers', 'Verify manual reconciliation approval and recovery without providers',
  'Verify Graph-only source', 'Build candidate', 'Verify performance budgets', 'Install pinned Supabase CLI',
  'Start temporary Supabase services', 'Verify complete migrations', 'Verify Missing Nom B database concurrency and recovery',
  'Verify concurrent grouped invoice preservation', 'Verify concurrent financial preview persistence',
  'Verify captured reconciliation evidence and resume isolation', 'Verify concurrent issued supplier preservation',
  'Verify concurrent issued petroleum preservation', 'Verify concurrent document field corrections',
  'Verify concurrent Group remittance payment evidence', 'Verify concurrent Nom B management and audit transitions',
  'Verify shared Xero allowance and token concurrency', 'Verify exact reconciliation approvals and atomic outcomes',
  'Stop temporary Supabase services',
]);

export function assertCandidateQualityAdmission(value = CANDIDATE_QUALITY_ADMISSION) {
  if (!exact(value, ['schemaVersion', 'candidateSha', 'branch', 'sourceDigest', 'lockSha256', 'qualityWorkflowSha256', 'qualityWorkflowBlob'])
    || value.schemaVersion !== 1 || value.candidateSha !== CANDIDATE_QUALITY_SHA
    || value.branch !== 'codex/full-release-integration-20261003' || !hash(value.sourceDigest) || !hash(value.lockSha256)
    || !hash(value.qualityWorkflowSha256) || !sha(value.qualityWorkflowBlob)) fail();
  return value;
}

export function assertCandidateQualityRun({ repository, branch, run, enabled, phase = 'completed', now = Date.now() }) {
  if (enabled !== 'true' || repository?.full_name !== repositoryName || !positive(repository.id) || repository.default_branch !== 'main'
    || repository.owner?.login !== operator || !positive(repository.owner.id) || branch?.name !== repository.default_branch
    || branch.protected !== true || !sha(branch.commit?.sha) || run?.repository?.full_name !== repositoryName
    || run.repository.id !== repository.id || run.head_repository?.full_name !== repositoryName || run.head_repository.id !== repository.id
    || run.head_branch !== branch.name || run.head_sha !== branch.commit.sha || run.event !== 'workflow_dispatch'
    || ![CANDIDATE_QUALITY_WORKFLOW, `${CANDIDATE_QUALITY_WORKFLOW}@${branch.name}`].includes(run.path)
    || !positive(run.id) || run.run_attempt !== 1 || run.actor?.login !== operator || run.actor.id !== repository.owner.id
    || run.triggering_actor?.login !== operator || run.triggering_actor.id !== repository.owner.id
    || !Number.isFinite(time(run.run_started_at)) || time(run.run_started_at) > now + 30000
    || phase === 'completed' && (run.status !== 'completed' || run.conclusion !== 'success' || !fresh(run.updated_at, now))
    || phase === 'publishing' && (run.status !== 'in_progress' || run.conclusion !== null)
    || !['completed', 'publishing'].includes(phase)) fail();
  return branch.commit.sha;
}

function successfulSteps(job, required) {
  if (!Array.isArray(job.steps)) fail();
  for (const name of required) {
    const matches = job.steps.filter(row => row.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') fail();
  }
}

export function assertCandidateQualityJobs({ jobs, run, phase = 'completed', now = Date.now() }) {
  if (!exact(jobs, ['total_count', 'jobs']) || jobs.total_count !== 3 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 3
    || new Set(jobs.jobs.map(row => row.id)).size !== 3) fail();
  const selected = {};
  for (const name of ['source-verification', 'candidate-tests', 'trusted-receipt']) {
    const matches = jobs.jobs.filter(row => row.name === name);
    const job = matches[0];
    if (matches.length !== 1 || !positive(job?.id) || job.run_id !== run.id || job.run_attempt !== 1
      || job.head_sha !== run.head_sha || !Number.isFinite(time(job.started_at)) || time(job.started_at) < time(run.run_started_at)
      || time(job.started_at) > now + 30000) fail();
    if (phase === 'publishing' && name === 'trusted-receipt') {
      if (job.status !== 'in_progress' || job.conclusion !== null || job.completed_at !== null) fail();
    } else if (job.status !== 'completed' || job.conclusion !== 'success' || !Number.isFinite(time(job.completed_at))
      || time(job.completed_at) < time(job.started_at) || !fresh(job.completed_at, now)) fail();
    selected[name] = job;
  }
  const source = selected['source-verification'], tests = selected['candidate-tests'], publisher = selected['trusted-receipt'];
  if (time(source.completed_at) > time(tests.started_at) || time(tests.completed_at) > time(publisher.started_at)) fail();
  successfulSteps(source, ['Verify admitted source']);
  successfulSteps(tests, CANDIDATE_QUALITY_TEST_STEPS);
  if (phase === 'completed') successfulSteps(publisher, ['Verify source and prepare trusted receipt', 'Publish trusted exact-source artifact']);
  return { source, tests, publisher };
}

export function candidateQualityArtifactName(runId) {
  if (!positive(runId)) fail();
  return `fcos-trusted-quality-source-${CANDIDATE_QUALITY_SHA}-${runId}`;
}

export function assertCandidateQualityArtifactList(value) {
  if (!exact(value, ['total_count', 'artifacts']) || !Array.isArray(value.artifacts) || value.total_count !== value.artifacts.length
    || value.total_count > 100 || new Set(value.artifacts.map(row => row.id)).size !== value.artifacts.length) fail();
  return value.artifacts;
}

export function candidateQualitySource({ candidateCwd, trustedCwd, harnessSha, admission = CANDIDATE_QUALITY_ADMISSION }) {
  assertCandidateQualityAdmission(admission);
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  for (const cwd of [trustedCwd, candidateCwd]) if (![`https://github.com/${repositoryName}`, `https://github.com/${repositoryName}.git`].includes(git(cwd, ['remote', 'get-url', 'origin']))) fail();
  if (!sha(harnessSha) || git(trustedCwd, ['rev-parse', 'HEAD']) !== harnessSha) fail();
  const trusted = collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true });
  const candidate = collectBuildProvenance({ cwd: candidateCwd, env: { FCOS_BUILD_COMMIT_SHA: admission.candidateSha,
    FCOS_EXPECTED_SOURCE_SHA256: admission.sourceDigest }, requireClean: true });
  const workflowBytes = readFileSync(join(candidateCwd, '.github/workflows/quality.yml'));
  if (trusted.commit !== harnessSha || candidate.commit !== admission.candidateSha || candidate.sourceDigest !== admission.sourceDigest
    || releaseHash(readFileSync(join(candidateCwd, 'package-lock.json'))) !== admission.lockSha256
    || releaseHash(workflowBytes) !== admission.qualityWorkflowSha256
    || git(candidateCwd, ['rev-parse', 'HEAD:.github/workflows/quality.yml']) !== admission.qualityWorkflowBlob) fail();
  return { candidateSha: admission.candidateSha, sourceDigest: candidate.sourceDigest, lockSha256: admission.lockSha256,
    candidateWorkflowSha256: admission.qualityWorkflowSha256, manifestSha256: CANDIDATE_QUALITY_MANIFEST_HASH,
    harnessSha, harnessWorkflowSha256: releaseHash(readFileSync(join(trustedCwd, CANDIDATE_QUALITY_WORKFLOW))),
    configurationRevision: releaseConfigurationRevision(candidateCwd, trustedCwd) };
}

export function createCandidateQualityReceipt({ source, repository, branch, run, jobs, enabled, artifacts, now = Date.now() }) {
  assertCandidateQualityRun({ repository, branch, run, enabled, phase: 'publishing', now });
  const { tests } = assertCandidateQualityJobs({ jobs, run, phase: 'publishing', now });
  if (assertCandidateQualityArtifactList(artifacts).some(row => row.name === candidateQualityArtifactName(run.id))) fail();
  if (!exact(source, ['candidateSha', 'sourceDigest', 'lockSha256', 'candidateWorkflowSha256', 'manifestSha256',
    'harnessSha', 'harnessWorkflowSha256', 'configurationRevision']) || source.candidateSha !== CANDIDATE_QUALITY_SHA || source.harnessSha !== branch.commit.sha
    || source.sourceDigest !== CANDIDATE_QUALITY_ADMISSION.sourceDigest || source.lockSha256 !== CANDIDATE_QUALITY_ADMISSION.lockSha256
    || source.candidateWorkflowSha256 !== CANDIDATE_QUALITY_ADMISSION.qualityWorkflowSha256
    || source.manifestSha256 !== CANDIDATE_QUALITY_MANIFEST_HASH || !hash(source.configurationRevision) || !hash(source.harnessWorkflowSha256)) fail();
  return { schemaVersion: 2, receiptKind: 'fcos_trusted_candidate_quality', ...source, runId: run.id, runAttempt: 1,
    testJobId: tests.id, capturedAt: tests.completed_at, publishedAt: new Date(now).toISOString() };
}

export function assertCandidateQualityArtifact({ repository, branch, run, jobs, enabled, artifacts, artifact, archive, payload,
  binding, manifestHash, harnessWorkflowHash, now = Date.now() }) {
  assertCandidateQualityRun({ repository, branch, run, enabled, now });
  const { tests, publisher } = assertCandidateQualityJobs({ jobs, run, now });
  const matching = assertCandidateQualityArtifactList(artifacts).filter(row => row.name === candidateQualityArtifactName(run.id));
  if (matching.length !== 1 || matching[0].id !== artifact?.id || artifact.expired !== false || !positive(artifact.id)
    || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== branch.commit.sha
    || artifact.digest !== `sha256:${releaseHash(archive)}` || !Number.isFinite(time(artifact.created_at))
    || time(artifact.created_at) < time(publisher.started_at) || time(artifact.created_at) > time(publisher.completed_at)
    || !exact(payload, ['schemaVersion', 'receiptKind', 'candidateSha', 'sourceDigest', 'lockSha256', 'candidateWorkflowSha256',
      'manifestSha256', 'harnessSha', 'harnessWorkflowSha256', 'configurationRevision', 'runId', 'runAttempt', 'testJobId', 'capturedAt', 'publishedAt'])
    || payload.schemaVersion !== 2 || payload.receiptKind !== 'fcos_trusted_candidate_quality'
    || payload.candidateSha !== CANDIDATE_QUALITY_SHA || binding?.sha !== CANDIDATE_QUALITY_SHA
    || payload.sourceDigest !== CANDIDATE_QUALITY_ADMISSION.sourceDigest || payload.sourceDigest !== binding.sourceDigest
    || payload.lockSha256 !== CANDIDATE_QUALITY_ADMISSION.lockSha256 || payload.lockSha256 !== binding.lockHash
    || payload.candidateWorkflowSha256 !== CANDIDATE_QUALITY_ADMISSION.qualityWorkflowSha256
    || manifestHash !== CANDIDATE_QUALITY_MANIFEST_HASH || payload.manifestSha256 !== manifestHash
    || !hash(harnessWorkflowHash) || payload.harnessWorkflowSha256 !== harnessWorkflowHash
    || payload.harnessSha !== branch.commit.sha || payload.configurationRevision !== binding.configurationRevision
    || !hash(payload.configurationRevision) || payload.runId !== run.id || payload.runAttempt !== 1 || payload.testJobId !== tests.id
    || payload.capturedAt !== tests.completed_at || !fresh(payload.capturedAt, now) || !fresh(payload.publishedAt, now)
    || time(payload.publishedAt) < time(publisher.started_at) || time(payload.publishedAt) > time(artifact.created_at) + 1000) fail();
  return { ...binding, runId: run.id, artifactId: artifact.id, archiveDigest: releaseHash(archive), result: 'success', capturedAt: payload.capturedAt };
}

// Additional trust route, never a relaxation of the existing PR workflow byte
// equality route. The caller has already asserted full default-branch protection.
export async function collectCandidateQuality({ reads, repository, branch, binding, unpack, now = Date.now() }) {
  assertCandidateQualityAdmission();
  if (binding?.sha !== CANDIDATE_QUALITY_SHA || binding.sourceDigest !== CANDIDATE_QUALITY_ADMISSION.sourceDigest
    || binding.lockHash !== CANDIDATE_QUALITY_ADMISSION.lockSha256 || !hash(binding.configurationRevision)) fail();
  const variable = await reads.json(`repos/${repositoryName}/actions/variables/${CANDIDATE_QUALITY_ENABLE}`);
  if (variable.name !== CANDIDATE_QUALITY_ENABLE || variable.value !== 'true') fail();
  const content = async (path, ref) => {
    const row = await reads.json(`repos/${repositoryName}/contents/${path}?ref=${ref}`);
    if (row.type !== 'file' || row.path !== path || row.encoding !== 'base64' || typeof row.content !== 'string' || !sha(row.sha)) fail();
    return { hash: releaseHash(Buffer.from(row.content, 'base64')), blob: row.sha };
  };
  const manifest = await content(CANDIDATE_QUALITY_MANIFEST, branch.commit.sha);
  const harness = await content(CANDIDATE_QUALITY_WORKFLOW, branch.commit.sha);
  const candidateWorkflow = await content('.github/workflows/quality.yml', CANDIDATE_QUALITY_SHA);
  const lock = await content('package-lock.json', CANDIDATE_QUALITY_SHA);
  const candidateRef = await reads.json(`repos/${repositoryName}/git/ref/heads/${encodeURIComponent(CANDIDATE_QUALITY_ADMISSION.branch)}`);
  if (manifest.hash !== CANDIDATE_QUALITY_MANIFEST_HASH || candidateWorkflow.hash !== CANDIDATE_QUALITY_ADMISSION.qualityWorkflowSha256
    || candidateWorkflow.blob !== CANDIDATE_QUALITY_ADMISSION.qualityWorkflowBlob || lock.hash !== CANDIDATE_QUALITY_ADMISSION.lockSha256
    || candidateRef.ref !== `refs/heads/${CANDIDATE_QUALITY_ADMISSION.branch}`
    || candidateRef.object?.type !== 'commit' || candidateRef.object.sha !== CANDIDATE_QUALITY_SHA) fail();
  const list = await reads.json(`repos/${repositoryName}/actions/workflows/candidate-quality.yml/runs?event=workflow_dispatch&status=success&per_page=100`);
  if (!Array.isArray(list.workflow_runs) || list.workflow_runs.length > 100) fail();
  for (const run of list.workflow_runs) {
    if (run.head_sha !== branch.commit.sha || !fresh(run.updated_at, now)) continue;
    try {
      assertCandidateQualityRun({ repository, branch, run, enabled: variable.value, now });
      const jobs = await reads.json(`repos/${repositoryName}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`);
      const artifacts = await reads.json(`repos/${repositoryName}/actions/runs/${run.id}/artifacts?per_page=100`);
      const matches = assertCandidateQualityArtifactList(artifacts).filter(row => row.name === candidateQualityArtifactName(run.id));
      if (matches.length !== 1) fail();
      const artifact = matches[0];
      const archive = await reads.archive(`repos/${repositoryName}/actions/artifacts/${artifact.id}/zip`);
      const payload = unpack(archive, CANDIDATE_QUALITY_FILENAME);
      const result = assertCandidateQualityArtifact({ repository, branch, run, jobs, enabled: variable.value, artifacts, artifact, archive, payload,
        binding, manifestHash: manifest.hash, harnessWorkflowHash: harness.hash, now });
      const latest = await reads.json(`repos/${repositoryName}/branches/${encodeURIComponent(repository.default_branch)}`);
      const stillEnabled = await reads.json(`repos/${repositoryName}/actions/variables/${CANDIDATE_QUALITY_ENABLE}`);
      if (latest.name !== branch.name || latest.protected !== true || latest.commit?.sha !== branch.commit.sha
        || stillEnabled.name !== CANDIDATE_QUALITY_ENABLE || stillEnabled.value !== 'true') fail();
      return result;
    } catch { /* Another run never overrides a failed binding or stale original proof. */ }
  }
  fail();
}
