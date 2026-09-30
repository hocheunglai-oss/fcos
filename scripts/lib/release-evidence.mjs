import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { releaseHash, RELEASE_MAX_AGE_MS } from './release-readiness.mjs';

export const RELEASE_REPOSITORY = fcosConnectionIdentifier('github', 'Repository');
export const PRODUCTION_ENVIRONMENT = 'fcos-production-release';
export const PRODUCTION_WORKFLOW = '.github/workflows/production-release.yml';
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const hash = value => /^[0-9a-f]{64}$/.test(value || '');
const fresh = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000 && now - Date.parse(value) <= RELEASE_MAX_AGE_MS;

export function assertProtectedDefault(repository, branch, protection) {
  if (repository?.full_name !== RELEASE_REPOSITORY || !repository.default_branch || branch?.name !== repository.default_branch
    || branch?.protected !== true || !sha(branch.commit?.sha)
    || protection?.enforce_admins?.enabled !== true
    || Number(protection?.required_pull_request_reviews?.required_approving_review_count) < 1
    || protection?.required_pull_request_reviews?.dismiss_stale_reviews !== true) throw new Error('The pinned default branch must have independently verified review and administrator protections.');
  return { branch: repository.default_branch, sha: branch.commit.sha };
}

export function assertTrustedArtifact({ repository, branch, protection, run, artifact, archive, payload, kind, binding, now = Date.now() }) {
  const trusted = assertProtectedDefault(repository, branch, protection);
  const workflow = kind === 'normal_role' ? '.github/workflows/normal-role-release.yml' : '.github/workflows/authenticated-release.yml';
  const prefix = kind === 'normal_role' ? 'fcos-normal-role-evidence' : 'fcos-ci-evidence';
  if (!['normal_role', 'restricted_browser'].includes(kind) || run?.repository?.full_name !== RELEASE_REPOSITORY
    || run?.head_repository?.full_name !== RELEASE_REPOSITORY || run?.head_branch !== trusted.branch || run?.head_sha !== trusted.sha
    || ![workflow, `${workflow}@${trusted.branch}`].includes(run?.path) || run?.event !== 'workflow_dispatch'
    || run?.conclusion !== 'success' || run?.status !== 'completed' || !positive(run.id) || !fresh(run.updated_at, now)
    || artifact?.name !== `${prefix}-${binding.sha}` || artifact.expired !== false || !positive(artifact.id)
    || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== trusted.sha
    || artifact.digest !== `sha256:${releaseHash(archive)}` || payload?.candidateSha !== binding.sha
    || payload.candidateUrl !== binding.candidateUrl || payload.harnessSha !== trusted.sha) throw new Error('Trusted workflow artifact identity, freshness, or archive integrity failed.');
  if (kind === 'normal_role' && (payload.schemaVersion !== 1 || payload.deploymentId !== binding.deploymentId
    || payload.sourceDigest !== binding.sourceDigest || !fresh(payload.capturedAt, now) || !Array.isArray(payload.checks)
    || payload.checks.some(row => Object.keys(row || {}).some(key => !['module', 'role', 'result', 'kind', 'evidenceId'].includes(key))))) throw new Error('Normal-role coverage must bind the exact deployment and source digest.');
  return { ...binding, kind, runId: run.id, artifactId: artifact.id, archiveDigest: releaseHash(archive), harnessSha: trusted.sha,
    capturedAt: kind === 'normal_role' ? payload.capturedAt : run.updated_at,
    ...(kind === 'normal_role' ? { checks: payload.checks } : {}) };
}

// Adapter receives a verified, target-locked CLI runtime. Requests are fixed GETs;
// callers cannot override endpoints, account, repository, or methods.
export function githubReleaseReads(runtime, { cwd = process.cwd(), execute = execFileSync } = {}) {
  const cli = (endpoint, binary = false) => {
    if (!endpoint.startsWith(`repos/${RELEASE_REPOSITORY}/`) && endpoint !== `repos/${RELEASE_REPOSITORY}` && endpoint !== 'user') throw new Error('Release GitHub endpoint is outside the pinned repository.');
    try { return execute(runtime.command, ['api', endpoint, '--method', 'GET', ...(runtime.injectedArgs || [])], {
      cwd, env: runtime.env, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
      ...(binary ? {} : { encoding: 'utf8' }), stdio: ['ignore', 'pipe', 'pipe'],
    }); } catch { throw new Error('Pinned GitHub release read failed; private diagnostics suppressed.'); }
  };
  return { json: endpoint => JSON.parse(cli(endpoint)), archive: endpoint => cli(endpoint, true) };
}

export function readEvidenceArchive(archive, filename, { execute = execFileSync } = {}) {
  if (!Buffer.isBuffer(archive) || archive.length < 1 || archive.length > 2 * 1024 * 1024
    || !['fcos-ci-evidence.json', 'fcos-normal-role-evidence.json', 'fcos-quality-source.json'].includes(filename)) throw new Error('Evidence archive is unavailable or exceeds the size limit.');
  const directory = mkdtempSync(join(tmpdir(), 'fcos-release-evidence-'));
  try {
    const path = join(directory, 'evidence.zip');
    writeFileSync(path, archive, { mode: 0o600, flag: 'wx' });
    const files = execute('unzip', ['-Z1', path], { encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n');
    if (files.length !== 1 || files[0] !== filename) throw new Error('Evidence archive must contain exactly its expected JSON file.');
    return JSON.parse(execute('unzip', ['-p', path, filename], { encoding: 'utf8', timeout: 5000, maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { throw new Error('Evidence archive content validation failed.'); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function collectTrustedReleaseEvidence({ reads, binding, now = Date.now(), unpack = readEvidenceArchive } = {}) {
  const records = [], blockers = [];
  const repository = reads.json(`repos/${RELEASE_REPOSITORY}`);
  const branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
  const protection = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
  assertProtectedDefault(repository, branch, protection);
  for (const kind of ['restricted_browser', 'normal_role']) {
    try {
      const workflow = kind === 'normal_role' ? 'normal-role-release.yml' : 'authenticated-release.yml';
      const prefix = kind === 'normal_role' ? 'fcos-normal-role-evidence' : 'fcos-ci-evidence';
      const runs = reads.json(`repos/${RELEASE_REPOSITORY}/actions/workflows/${workflow}/runs?event=workflow_dispatch&status=success&per_page=100`).workflow_runs || [];
      let record;
      for (const run of runs) {
        if (run.head_sha !== branch.commit.sha || !fresh(run.updated_at, now)) continue;
        const artifacts = reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts || [];
        const artifact = artifacts.find(row => row.name === `${prefix}-${binding.sha}` && row.expired === false);
        if (!artifact) continue;
        const archive = reads.archive(`repos/${RELEASE_REPOSITORY}/actions/artifacts/${artifact.id}/zip`);
        const payload = unpack(archive, kind === 'normal_role' ? 'fcos-normal-role-evidence.json' : 'fcos-ci-evidence.json');
        record = assertTrustedArtifact({ repository, branch, protection, run, artifact, archive, payload, kind, binding, now });
        break;
      }
      if (!record) throw new Error('missing');
      records.push(record);
    } catch { blockers.push({ code: 'TRUSTED_EVIDENCE_UNAVAILABLE', scope: kind }); }
  }
  let quality = null;
  try {
    const runs = reads.json(`repos/${RELEASE_REPOSITORY}/actions/workflows/quality.yml/runs?status=success&per_page=100`).workflow_runs || [];
    const run = runs.find(row => row.repository?.full_name === RELEASE_REPOSITORY && row.head_repository?.full_name === RELEASE_REPOSITORY
      && (row.head_sha === binding.sha || row.event === 'pull_request' && row.pull_requests?.some(pr => pr.head?.sha === binding.sha))
      && row.conclusion === 'success' && row.status === 'completed'
      && ['.github/workflows/quality.yml', `.github/workflows/quality.yml@${branch.name}`].includes(row.path) && fresh(row.updated_at, now));
    if (run) {
      const content = ref => reads.json(`repos/${RELEASE_REPOSITORY}/contents/.github/workflows/quality.yml?ref=${ref}`);
      const deployed = content(branch.commit.sha), candidate = content(binding.sha);
      if (deployed.encoding !== 'base64' || candidate.encoding !== 'base64'
        || releaseHash(Buffer.from(deployed.content, 'base64')) !== releaseHash(Buffer.from(candidate.content, 'base64'))) throw new Error('Untrusted quality workflow');
      const artifacts = reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts || [];
      const artifact = artifacts.find(row => row.name === `fcos-quality-source-${binding.sha}` && row.expired === false);
      if (!artifact || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha) throw new Error('Quality source artifact missing');
      const archive = reads.archive(`repos/${RELEASE_REPOSITORY}/actions/artifacts/${artifact.id}/zip`);
      const payload = unpack(archive, 'fcos-quality-source.json');
      if (artifact.digest !== `sha256:${releaseHash(archive)}` || payload.schemaVersion !== 1
        || payload.candidateSha !== binding.sha || payload.lockSha256 !== binding.lockHash || !fresh(payload.capturedAt, now)) throw new Error('Quality source artifact binding');
      quality = { ...binding, runId: run.id, artifactId: artifact.id, archiveDigest: releaseHash(archive), result: 'success', capturedAt: payload.capturedAt };
    }
  } catch { /* Missing exact-head proof is a blocker, never a local override. */ }
  return { records, blockers, quality };
}

export function assertProductionProtection({ repository, branch, protection, environment, variables, secrets, run, approvals, oidcClaims, expectedCommit, sourceDigest, configurationRevision, now = Date.now(), approvalRequired = true } = {}) {
  const trusted = assertProtectedDefault(repository, branch, protection);
  const reviewers = environment?.protection_rules?.find(rule => rule.type === 'required_reviewers');
  const allowed = reviewers?.reviewers?.filter(row => row.type === 'User' && positive(row.reviewer?.id)) || [];
  if (environment?.name !== PRODUCTION_ENVIRONMENT || !positive(environment.id) || environment.can_admins_bypass !== false
    || reviewers?.prevent_self_review !== true || !allowed.length || environment.deployment_branch_policy?.protected_branches !== true
    || environment.deployment_branch_policy?.custom_branch_policies !== false) throw new Error('Production requires non-bypassable human review and protected-branch environment restrictions.');
  const variable = name => variables?.variables?.find(row => row.name === name)?.value;
  if (variable('FCOS_PRODUCTION_RELEASE_ENABLED') !== 'true' || variable('FCOS_REVIEWED_RELEASE_SHA') !== expectedCommit
    || variable('FCOS_REVIEWED_SOURCE_SHA256') !== sourceDigest || variable('FCOS_REVIEWED_CONFIGURATION_SHA256') !== configurationRevision
    || !sha(expectedCommit) || !hash(sourceDigest) || !hash(configurationRevision)) throw new Error('Production activation and reviewed candidate configuration are not independently pinned.');
  const names = secrets?.secrets?.map(row => row.name) || [];
  for (const name of ['FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN']) if (!names.includes(name)) throw new Error('Required dedicated Production environment credentials are unavailable.');
  if (!approvalRequired) return trusted;
  if (run?.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY || run.event !== 'workflow_dispatch'
    || run.head_branch !== trusted.branch || run.head_sha !== trusted.sha || ![PRODUCTION_WORKFLOW, `${PRODUCTION_WORKFLOW}@${trusted.branch}`].includes(run.path)
    || run.status !== 'in_progress' || !positive(run.id) || run.run_attempt !== 1 || !fresh(run.run_started_at, now)) throw new Error('Execution requires the first current run of the protected default-branch release workflow.');
  const reviews = (Array.isArray(approvals) ? approvals : []).filter(review => review.environments?.some(env => env.id === environment.id && env.name === environment.name));
  // Review history has no documented ordering or approval timestamp. A first
  // attempt must have one unambiguous environment review, never array-order trust.
  const approval = reviews.length === 1 ? reviews[0] : null;
  if (approval?.state !== 'approved' || !allowed.some(row => row.reviewer.id === approval.user?.id)
    || approval.user?.id === run.actor?.id || approval.user?.id === run.triggering_actor?.id) throw new Error('One unambiguous independent configured human review must approve this exact workflow run.');
  if (oidcClaims?.iss !== 'https://token.actions.githubusercontent.com' || oidcClaims.aud !== 'fcos-production-release'
    || oidcClaims.repository !== RELEASE_REPOSITORY || oidcClaims.repository_id !== String(repository.id)
    || oidcClaims.sub !== `repo:${RELEASE_REPOSITORY}:environment:${PRODUCTION_ENVIRONMENT}`
    || oidcClaims.workflow_ref !== `${RELEASE_REPOSITORY}/${PRODUCTION_WORKFLOW}@refs/heads/${trusted.branch}`
    || oidcClaims.workflow_sha !== trusted.sha || oidcClaims.sha !== trusted.sha || oidcClaims.ref !== `refs/heads/${trusted.branch}`
    || oidcClaims.run_id !== String(run.id) || oidcClaims.run_attempt !== '1' || oidcClaims.event_name !== 'workflow_dispatch'
    || !Number.isFinite(oidcClaims.exp) || oidcClaims.exp * 1000 <= now) throw new Error('Signed Actions identity does not match the protected approved release job.');
  return { ...trusted, runId: run.id, environmentId: environment.id, reviewerId: approval.user.id };
}
