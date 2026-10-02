import { previewEmailSignerEvidenceVerified } from './preview-email-signer.mjs';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FCOS_RELEASE_APPROVAL_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
import { PREVIEW_PARITY_POLICY } from './preview-parity.mjs';
import { assertProtectedDefault, RELEASE_REPOSITORY, readEvidenceArchive, collectVerificationEnvironmentReview } from './release-evidence.mjs';
import { releaseHash, RELEASE_MAX_AGE_MS, assertReleaseReceiptBinding } from './release-readiness.mjs';
import { executeProductionRelease } from './release-production.mjs';
import { deploymentSourceFilter, GENERATED_PROVENANCE_FILES } from './build-provenance.mjs';
import { canonicalFcosE2eCandidateUrl } from '../verify-e2e-candidate.mjs';
import { verifyCompatibilityObservationSources } from './runtime-compatibility-observation.mjs';

export const COMPATIBILITY_ENVIRONMENT = 'fcos-runtime-compatibility-release';
export const COMPATIBILITY_WORKFLOW = '.github/workflows/runtime-compatibility-release.yml';
export const COMPATIBILITY_ENABLE_VARIABLE = 'FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED';
export const COMPATIBILITY_EXCEPTION = 'previous-runtime-endpoint-absent-v1';
// This is one reviewed first-rollout proposal, never a general baseline bypass.
// A different source or Production deployment needs a separately reviewed contract.
export const FIRST_RUNTIME_ROLLOUT = Object.freeze({
  candidateSha: 'ff8859b287009e20462c5c0cceff89ae12f13010',
  previousSha: 'f3472492ff4d0b0c70248a3c8e5c0012981a94b3',
  previousDeploymentId: 'dpl_KmyVbNkg7okjW4PPjR8ZJXRz19AL',
  previousUrl: 'https://fcos-3nt36gqot-hocheunglai-6535s-projects.vercel.app',
});
export const COMPATIBILITY_READ_ONLY_GUARDS = Object.freeze(['api/_hedgeDeskService.js', 'api/_xeroPortal.js', 'api/functions/[name].js', 'api/_xeroContactSync.js', 'api/_emailRouterCore.js']);
const sha = value => /^[0-9a-f]{40}$/.test(value || '');
const hash = value => /^[0-9a-f]{64}$/.test(value || '');
const positive = value => Number.isSafeInteger(value) && value > 0;
const immutable = value => { try { return canonicalFcosE2eCandidateUrl(value) === value; } catch { return false; } };
const fresh = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000 && now - Date.parse(value) <= RELEASE_MAX_AGE_MS;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function compatibilityReadOnlyGuardsVerified(scope) {
  return scope?.schemaVersion === 1 && scope.receiptKind === 'fcos_runtime_compatibility_scope'
    && scope.scopeVerified === true && scope.productionAuthorized === false
    && scope.baseCommit === FIRST_RUNTIME_ROLLOUT.previousSha && scope.candidateCommit === FIRST_RUNTIME_ROLLOUT.candidateSha
    && Array.isArray(scope.readOnlyGuards) && scope.readOnlyGuards.length === COMPATIBILITY_READ_ONLY_GUARDS.length
    && COMPATIBILITY_READ_ONLY_GUARDS.every(path => scope.readOnlyGuards.filter(value => value === path).length === 1)
    && Array.isArray(scope.changes) && [...COMPATIBILITY_READ_ONLY_GUARDS, 'api/_hedgeDeskReadOnly.js'].every(path =>
      scope.changes.filter(row => row.path === path && sha(row.after)
        && (path === 'api/_hedgeDeskReadOnly.js' ? row.before === null : sha(row.before))).length === 1);
}

export function runtimeCompatibilityControlRevision(trustedCwd, candidateCwd) {
  const trusted = ['scripts/runtime-compatibility-release.mjs', 'scripts/lib/runtime-compatibility-release.mjs',
    'scripts/lib/runtime-compatibility.mjs', 'scripts/verify-runtime-compatibility.mjs',
    'scripts/lib/release-evidence.mjs', 'scripts/lib/release-production.mjs', 'scripts/lib/release-readiness.mjs',
    'scripts/lib/preview-parity.mjs', 'scripts/collect-preview-parity.mjs', 'scripts/lib/build-provenance.mjs',
    'config/fcosConnections.js', 'config/fcosCiIdentity.js', 'config/preview-parity-policy.json',
    COMPATIBILITY_WORKFLOW, '.github/workflows/quality.yml', '.github/workflows/authenticated-release.yml',
    '.github/workflows/normal-role-release.yml', 'scripts/normal-role-release.mjs', 'playwright.config.js',
    '.github/workflows/runtime-compatibility-normal-role.yml', 'scripts/runtime-compatibility-normal-role.mjs', 'scripts/verify-e2e-candidate.mjs',
    'scripts/lib/runtime-compatibility-observation.mjs', 'scripts/lib/normal-role-read-requests.mjs',
    'scripts/lib/normal-role-verification-transport.mjs', 'scripts/lib/preview-email-signer.mjs',
    'scripts/lib/legacy-email-baseline-proof.mjs', 'config/legacy-email-baseline-proof.json',
    'scripts/lib/preview-email-build.mjs', 'scripts/preview-email-proof-build.mjs', '.github/workflows/preview-email-proof-build.yml',
    'package.json', 'package-lock.json', 'AGENTS.md', '.codex/config.toml', '.codex/setup.mjs',
    '.codex/control-validation.mjs', '.codex/control-policy.json', '.codex/README.md'];
  const candidate = ['config/fcosConnections.js', 'config/fcosCiIdentity.js', 'vercel.json', 'package.json', 'package-lock.json',
    'AGENTS.md', '.codex/config.toml', '.codex/setup.mjs', '.codex/control-validation.mjs', '.codex/control-policy.json', '.codex/README.md'];
  const records = [];
  for (const [label, root, files] of [['trusted', trustedCwd, trusted], ['candidate', candidateCwd, candidate]]) {
    for (const file of files) {
      if (!lstatSync(join(root, file)).isFile()) throw new Error('Compatibility controls require regular reviewed files.');
      records.push([`${label}/${file}`, releaseHash(readFileSync(join(root, file)))]);
    }
  }
  return releaseHash(`fcos-runtime-compatibility-controls-v1\0${JSON.stringify(records)}`);
}

export function assertRuntimeCompatibilityWorkflowIdentity(claims, repository, branch) {
  if (repository?.full_name !== RELEASE_REPOSITORY || !positive(repository.id) || !repository.default_branch
    || !sha(branch?.commit?.sha) || claims?.iss !== 'https://token.actions.githubusercontent.com'
    || claims.aud !== 'fcos-production-release' || claims.repository !== RELEASE_REPOSITORY
    || claims.repository_id !== String(repository.id)
    || claims.sub !== `repo:${RELEASE_REPOSITORY}:environment:${COMPATIBILITY_ENVIRONMENT}`
    || claims.workflow_ref !== `${RELEASE_REPOSITORY}/${COMPATIBILITY_WORKFLOW}@refs/heads/${repository.default_branch}`
    || claims.workflow_sha !== branch.commit.sha || claims.sha !== branch.commit.sha
    || claims.ref !== `refs/heads/${repository.default_branch}`) throw new Error('Compatibility preflight requires its own protected environment and workflow identity.');
  return true;
}

export function assertRuntimeCompatibilityProtection({ repository, branch, protection, environment, variables, secrets,
  run, approvals, oidcClaims, binding, now = Date.now() } = {}) {
  if (FCOS_RELEASE_APPROVAL_POLICY.mode !== 'single_operator') throw new Error('This first-rollout contract requires the reviewed single-operator policy.');
  const trusted = assertProtectedDefault(repository, branch, protection);
  assertRuntimeCompatibilityWorkflowIdentity(oidcClaims, repository, branch);
  const operator = fcosConnectionIdentifier('github', 'Required account');
  const reviewerRules = environment?.protection_rules?.filter(rule => rule.type === 'required_reviewers') || [];
  const rule = reviewerRules.length === 1 ? reviewerRules[0] : null;
  const reviewer = rule?.reviewers?.length === 1 ? rule.reviewers[0] : null;
  if (environment?.name !== COMPATIBILITY_ENVIRONMENT || !positive(environment.id) || environment.can_admins_bypass !== false
    || rule?.prevent_self_review !== false || reviewer?.type !== 'User' || !positive(reviewer.reviewer?.id)
    || reviewer.reviewer.login !== operator || environment.deployment_branch_policy?.protected_branches !== true
    || environment.deployment_branch_policy?.custom_branch_policies !== false) throw new Error('Compatibility requires a non-bypassable pinned human reviewer and protected branches.');
  const pins = {
    [COMPATIBILITY_ENABLE_VARIABLE]: 'true', FCOS_COMPATIBILITY_REVIEWED_SHA: FIRST_RUNTIME_ROLLOUT.candidateSha,
    FCOS_COMPATIBILITY_REVIEWED_HARNESS_SHA: binding?.harnessSha,
    FCOS_COMPATIBILITY_REVIEWED_SOURCE_SHA256: binding?.sourceDigest, FCOS_COMPATIBILITY_REVIEWED_LOCK_SHA256: binding?.lockHash,
    FCOS_COMPATIBILITY_REVIEWED_CONTROL_SHA256: binding?.configurationRevision,
    FCOS_COMPATIBILITY_REVIEWED_TREE_SHA256: binding?.candidateTreeHash,
    FCOS_COMPATIBILITY_PREVIOUS_DEPLOYMENT: FIRST_RUNTIME_ROLLOUT.previousDeploymentId,
    FCOS_COMPATIBILITY_PREVIOUS_SHA: FIRST_RUNTIME_ROLLOUT.previousSha, FCOS_COMPATIBILITY_PREVIOUS_URL: FIRST_RUNTIME_ROLLOUT.previousUrl,
    FCOS_COMPATIBILITY_REVIEWED_EXCEPTION: COMPATIBILITY_EXCEPTION,
  };
  if (binding?.sha !== FIRST_RUNTIME_ROLLOUT.candidateSha || binding?.harnessSha !== trusted.sha
    || ![binding.sourceDigest, binding.lockHash, binding.configurationRevision, binding.candidateTreeHash].every(hash)
    || Object.entries(pins).some(([name, value]) => variables?.variables?.filter(row => row.name === name).length !== 1
      || variables.variables.find(row => row.name === name).value !== value)
    || variables?.variables?.filter(row => row.name === 'FCOS_RELEASE_VERCEL_TOKEN_ID').length !== 1
    || !/^[A-Za-z0-9_-]{1,200}$/.test(variables.variables.find(row => row.name === 'FCOS_RELEASE_VERCEL_TOKEN_ID').value || '')) {
    throw new Error('Compatibility activation, exact source, dependency, control, tree, previous deployment and narrow exception pins are required.');
  }
  const names = secrets?.secrets?.map(row => row.name) || [];
  for (const name of ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN']) {
    if (!names.includes(name)) throw new Error('Dedicated compatibility environment credentials are unavailable.');
  }
  if (run?.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
    || run.event !== 'workflow_dispatch' || run.head_branch !== trusted.branch || run.head_sha !== trusted.sha
    || ![COMPATIBILITY_WORKFLOW, `${COMPATIBILITY_WORKFLOW}@${trusted.branch}`].includes(run.path)
    || run.status !== 'in_progress' || !positive(run.id) || run.run_attempt !== 1 || !fresh(run.run_started_at, now)
    || run.actor?.login !== operator || run.triggering_actor?.login !== operator
    || run.actor?.id !== reviewer.reviewer.id || run.triggering_actor?.id !== reviewer.reviewer.id) throw new Error('Compatibility requires the pinned human operator first run of the protected default workflow.');
  const reviews = (Array.isArray(approvals) ? approvals : []).filter(review => review.environments?.some(row => row.id === environment.id && row.name === environment.name));
  const approval = reviews.length === 1 ? reviews[0] : null;
  if (approval?.state !== 'approved' || approval.user?.id !== reviewer.reviewer.id || approval.user?.login !== operator) throw new Error('One unambiguous pinned human environment approval is required for this exact compatibility run.');
  if (oidcClaims.run_id !== String(run.id) || oidcClaims.run_attempt !== '1' || oidcClaims.event_name !== 'workflow_dispatch'
    || !Number.isFinite(oidcClaims.exp) || oidcClaims.exp * 1000 <= now) throw new Error('Signed Actions identity does not match this approved first compatibility run.');
  return { runId: run.id, environmentId: environment.id, reviewerId: approval.user.id, approvalMode: 'single_operator', harnessSha: trusted.sha };
}

// Every prerequisite remains mandatory except the separately approved absence
// of the endpoint on this one previous Production deployment.
export function runtimeCompatibilityRequirements() {
  const requirement = (id, phase, mustProve) => ({ id, phase, exceptionAllowed: false, mustProve });
  return [
    requirement('source', 'before_staging', ['immutable exact candidate/base Git trees', 'independently recomputed additive scope', 'clean candidate and trusted checkout', 'source, lock, control and tree SHA256 pins']),
    requirement('protection', 'before_staging_and_domains', ['protected current main and trusted required checks', 'pinned human first-run environment approval', 'cryptographically verified exact Actions workflow identity', 'dedicated credentials and all independently reviewed pins']),
    requirement('vercel', 'before_staging_and_domains', ['canonical account/team/project/repository', 'OWNER membership and exact dedicated team token metadata', 'disabled automatic Git deployment, domain assignment and deploy hooks']),
    requirement('deployments', 'before_staging_and_domains', ['exact unchanged previous Production ID/SHA/immutable URL', 'distinct READY Git-linked candidate Preview', 'candidate artifact source digest and clean build receipt']),
    requirement('quality', 'before_staging_and_domains', ['only the exact pinned base/candidate pair with byte-identical original quality workflows', 'every original named upstream job succeeded on the exact tested source tree and remains fresh by actual completion time', 'protected compatibility archive binds source, lock, harness and upstream job proof; reread original metadata and archive']),
    requirement('restricted_ui', 'before_staging_and_domains', ['fresh successful protected-main restricted browser artifact', 'exact candidate URL/SHA and trusted harness SHA', 'existing authenticated regressions, including preserved mobile behavior']),
    requirement('normal_ui', 'before_staging_and_domains', ['separate approved active real identity', 'exact deployment/source-bound artifact and archive digest', 'independent immutable exact five-file guard and four-read-action helper proof before credentials; verified read-only snapshots suppress expiry, status suppresses refresh, mappings uses only a valid stored Xero session without token renewal, and Email Router list/detail suppress metadata persistence', ...PREVIEW_PARITY_POLICY.requiredModules.map(name => `${name}: real data loaded and authorized read verified${PREVIEW_PARITY_POLICY.workflowModules.includes(name) ? ', read workflow verified' : ''}`)]),
    requirement('environment', 'before_staging_and_domains', ['complete immutable deployed environment key inventory and freshness', 'all discovered switches classified by reviewed protected-main policy', 'exact approved non-secret parity and intentional differences', 'opaque values remain unknown until independent safe proof']),
    requirement('compiled_flags', 'before_staging_and_domains', PREVIEW_PARITY_POLICY.compiledFlags.map(key => `${key}: executed assets, approved settings and preserved baseline agree`)),
    requirement('runtime', 'before_staging_and_domains', ['candidate Preview read-only and every external action disabled', ...PREVIEW_PARITY_POLICY.runtimeFlags.map(key => `${key}: known effective value with reviewed baseline proof`), ...PREVIEW_PARITY_POLICY.requiredAuth.map(name => `${name}: independently authenticated existing session and pinned target; no refresh`)]),
    { id: 'previous_runtime_endpoint', phase: 'before_staging', exceptionAllowed: true, mustProve: ['only this exact previous deployment and additive candidate', 'previous immutable Git tree has no endpoint', 'independent credential-free absence readback', 'exception separately pinned and approved; never fabricate previous runtime authentication or flags'] },
    requirement('staged_production', 'before_domains', ['durable deployment intent before --prod --skip-domain', 'operation-bound distinct READY Production build and exact receipt', 'Production effective flags, safety and authenticated providers independently verified', 'unchanged previous Production and refreshed approval/owner token/source before domains']),
    requirement('domain_readback', 'after_domains', ['durable domain assignment intent', 'uncertain outcomes read back without retry', 'exact public artifact and runtime readback', 'record previous deployment for separately authorized rollback']),
  ];
}

export function compatibilityRuntimePreviewVerified(runtime, candidate, now = Date.now()) {
  const flags = PREVIEW_PARITY_POLICY.runtimeFlags, actions = PREVIEW_PARITY_POLICY.externalActions;
  return !!runtime && runtime.deploymentId === candidate?.id && runtime.sha === candidate?.sha && fresh(runtime.capturedAt, now)
    && runtime.safety?.readOnly === true && exactKeys(runtime.flags, flags)
    && flags.every(key => runtime.flags[key]?.state === 'known' && typeof runtime.flags[key].value === 'boolean')
    && exactKeys(runtime.safety.externalActions, actions) && actions.every(key => runtime.safety.externalActions[key] === false);
}

export function compatibilityNormalCoverageVerified(record) {
  return Array.isArray(record?.checks) && PREVIEW_PARITY_POLICY.requiredModules.every(module => record.checks.some(row => row.module === module
    && PREVIEW_PARITY_POLICY.normalRoles.includes(row.role) && row.result === 'pass'
    && (PREVIEW_PARITY_POLICY.workflowModules.includes(module) ? row.kind === 'workflow_read' : ['read', 'workflow_read'].includes(row.kind))
    && typeof row.evidenceId === 'string' && row.evidenceId.trim()));
}

export function assertCompatibilityNormalArtifact({ repository, branch, protection, run, artifact, archive, payload, binding, now = Date.now() }) {
  const trusted = assertProtectedDefault(repository, branch, protection);
  const path = '.github/workflows/runtime-compatibility-normal-role.yml';
  if (run?.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
    || run.head_branch !== trusted.branch || run.head_sha !== trusted.sha || ![path, `${path}@${trusted.branch}`].includes(run.path)
    || run.event !== 'workflow_dispatch' || run.conclusion !== 'success' || run.status !== 'completed' || !positive(run.id) || !fresh(run.updated_at, now)
    || artifact?.name !== `fcos-compatibility-normal-role-evidence-${FIRST_RUNTIME_ROLLOUT.candidateSha}` || artifact.expired !== false
    || !positive(artifact.id) || artifact.workflow_run?.id !== run.id || artifact.workflow_run.head_sha !== trusted.sha
    || artifact.digest !== `sha256:${releaseHash(archive)}` || payload?.schemaVersion !== 1 || payload.baseSha !== FIRST_RUNTIME_ROLLOUT.previousSha
    || payload.candidateSha !== FIRST_RUNTIME_ROLLOUT.candidateSha || binding?.sha !== FIRST_RUNTIME_ROLLOUT.candidateSha
    || payload.candidateUrl !== binding.candidateUrl || payload.deploymentId !== binding.deploymentId || payload.sourceDigest !== binding.sourceDigest
    || payload.harnessSha !== trusted.sha || !fresh(payload.capturedAt, now) || !compatibilityNormalCoverageVerified(payload)
    || payload.checks.some(row => Object.keys(row || {}).some(key => !['module', 'role', 'result', 'kind', 'evidenceId'].includes(key)))) throw new Error('Dedicated compatibility normal-role workflow, archive, exact source or real-data coverage proof failed.');
  if (payload.emailSigner !== undefined) previewEmailSignerEvidenceVerified(payload.emailSigner,
    { deployment: { id: binding.deploymentId, sha: binding.sha }, sourceDigest: binding.sourceDigest, now });
  return { ...binding, kind: 'normal_role', runId: run.id, artifactId: artifact.id, archiveDigest: releaseHash(archive),
    harnessSha: trusted.sha, capturedAt: payload.capturedAt, checks: payload.checks,
    ...(payload.emailSigner !== undefined ? { emailSigner: payload.emailSigner } : {}) };
}

export async function collectCompatibilityNormalEvidence({ reads, binding, now = Date.now(), unpack = readEvidenceArchive }) {
  const repository = reads.json(`repos/${RELEASE_REPOSITORY}`);
  const branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
  const protection = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
  assertProtectedDefault(repository, branch, protection);
  const runs = reads.json(`repos/${RELEASE_REPOSITORY}/actions/workflows/runtime-compatibility-normal-role.yml/runs?event=workflow_dispatch&status=success&per_page=100`).workflow_runs || [];
  for (const run of runs) {
    if (run.head_sha !== branch.commit.sha || !fresh(run.updated_at, now)) continue;
    const artifacts = reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts || [];
    const artifact = artifacts.find(row => row.name === `fcos-compatibility-normal-role-evidence-${binding.sha}` && row.expired === false);
    if (!artifact) continue;
    collectVerificationEnvironmentReview({ reads, run, kind: 'normal_role' });
    const archive = reads.archive(`repos/${RELEASE_REPOSITORY}/actions/artifacts/${artifact.id}/zip`);
    return assertCompatibilityNormalArtifact({ repository, branch, protection, run, artifact, archive,
      payload: unpack(archive, 'fcos-normal-role-evidence.json'), binding, now });
  }
  throw new Error('Fresh dedicated real normal-role compatibility evidence is unavailable.');
}

// The pinned legacy quality workflow has no source archive and checks out a PR
// merge ref. This one-pair collector proves the actual tested tree from its
// trusted checkout log and preserves every original named job. Neither run
// head_sha alone nor a newly uploaded artifact can rejuvenate stale job results.
export function compatibilityUpstreamQuality({ reads, cwd, runId, binding, now = Date.now() }) {
  if (!positive(runId) || binding?.sha !== FIRST_RUNTIME_ROLLOUT.candidateSha) throw new Error('Exact compatibility quality run required.');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['rev-parse', `${FIRST_RUNTIME_ROLLOUT.previousSha}:.github/workflows/quality.yml`])
    !== git(['rev-parse', `${binding.sha}:.github/workflows/quality.yml`])) throw new Error('Original quality workflow differs from the reviewed baseline.');
  const run = reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${runId}`);
  if (run?.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
    || run.event !== 'pull_request' || run.head_sha !== binding.sha || run.id !== runId || !positive(run.run_attempt)
    || !['.github/workflows/quality.yml', `.github/workflows/quality.yml@${run.head_branch}`].includes(run.path)
    || run.status !== 'completed' || run.conclusion !== 'success' || !fresh(run.updated_at, now)) throw new Error('Original exact candidate quality run is not current successful repository evidence.');
  const listing = reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
  const jobs = listing.jobs;
  if (!Array.isArray(jobs) || listing.total_count !== jobs.length || jobs.length !== FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.length
    || FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.some(name => jobs.filter(job => job.name === name).length !== 1)
    || jobs.some(job => !positive(job.id) || job.status !== 'completed' || job.conclusion !== 'success' || !fresh(job.completed_at, now))) {
    throw new Error('Every original quality job needs one current successful actual completion; missing, stale, duplicate or failed jobs cannot qualify.');
  }
  const code = jobs.find(job => job.name === 'code-and-database');
  const log = reads.archive(`repos/${RELEASE_REPOSITORY}/actions/jobs/${code.id}/logs`).toString('utf8');
  const start = log.indexOf('Run actions/checkout@v4'), end = log.indexOf('Run actions/setup-node@v4', start + 1);
  if (start < 0 || end <= start || end - start > 300000) throw new Error('Bounded original checkout log proof unavailable.');
  const checkout = log.slice(start, end), matches = [...checkout.matchAll(/\[command\][^\n]*git log -1 --format=['"]?%H['"]?[^\n]*\n[^\n]*?\b([0-9a-f]{40})\b/g)];
  if (matches.length !== 1) throw new Error('Original tested checkout SHA is ambiguous or unobserved.');
  const testedSha = matches[0][1], tested = reads.json(`repos/${RELEASE_REPOSITORY}/git/commits/${testedSha}`);
  const candidateTreeSha = git(['rev-parse', `${binding.sha}^{tree}`]);
  if (tested.sha !== testedSha || tested.tree?.sha !== candidateTreeSha) throw new Error('Original quality tests did not execute the exact compatibility source tree.');
  const summary = jobs.map(job => ({ id: job.id, name: job.name, completedAt: job.completed_at, conclusion: job.conclusion })).sort((a, b) => a.name.localeCompare(b.name));
  return { upstreamRunId: runId, upstreamRunAttempt: run.run_attempt, testedSha, testedTreeSha: candidateTreeSha,
    jobsDigest: releaseHash(JSON.stringify(summary)), completedAt: summary.map(job => job.completedAt).sort()[0] };
}

export async function collectCompatibilityQualityEvidence({ reads, cwd, binding, now = Date.now(), unpack = readEvidenceArchive }) {
  const repository = reads.json(`repos/${RELEASE_REPOSITORY}`), branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
  const protection = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`);
  const trusted = assertProtectedDefault(repository, branch, protection);
  const runs = reads.json(`repos/${RELEASE_REPOSITORY}/actions/workflows/runtime-compatibility-release.yml/runs?event=workflow_dispatch&status=success&per_page=100`).workflow_runs || [];
  for (const run of runs) {
    if (run.head_sha !== trusted.sha || !fresh(run.updated_at, now)) continue;
    const artifact = (reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts || [])
      .find(row => row.name === `fcos-compatibility-quality-source-${binding.sha}` && row.expired === false);
    if (!artifact) continue;
    const archive = reads.archive(`repos/${RELEASE_REPOSITORY}/actions/artifacts/${artifact.id}/zip`), payload = unpack(archive, 'fcos-quality-source.json');
    if (run.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
      || run.head_branch !== trusted.branch || ![COMPATIBILITY_WORKFLOW, `${COMPATIBILITY_WORKFLOW}@${trusted.branch}`].includes(run.path)
      || run.event !== 'workflow_dispatch' || run.status !== 'completed' || run.conclusion !== 'success'
      || artifact.workflow_run?.id !== run.id || artifact.workflow_run.head_sha !== trusted.sha || !positive(artifact.id)
      || artifact.digest !== `sha256:${releaseHash(archive)}` || payload.schemaVersion !== 1 || payload.baseSha !== FIRST_RUNTIME_ROLLOUT.previousSha
      || payload.candidateSha !== binding.sha || payload.sourceDigest !== binding.sourceDigest || payload.lockSha256 !== binding.lockHash
      || payload.harnessSha !== trusted.sha || !fresh(payload.capturedAt, now)) throw new Error('Dedicated protected compatibility quality artifact provenance failed.');
    const upstream = compatibilityUpstreamQuality({ reads, cwd, runId: payload.upstreamRunId, binding, now });
    if (Object.entries(upstream).some(([key, value]) => payload[key] !== value)) throw new Error('Original quality results changed or the archived exact-source proof was forged.');
    return { ...binding, result: 'success', runId: run.id, artifactId: artifact.id, archiveDigest: releaseHash(archive), capturedAt: upstream.completedAt };
  }
  throw new Error('Protected archive-backed compatibility quality evidence unavailable.');
}

// Each consequential boundary reads the same independently verified archives.
// Completion timestamps are part of the binding and cannot be renewed locally.
export function assertCompatibilityEvidenceReadback(original, refreshed, now = Date.now()) {
  const fields = ['sha', 'sourceDigest', 'lockHash', 'configurationRevision', 'deploymentId', 'candidateUrl',
    'runId', 'artifactId', 'archiveDigest', 'capturedAt', 'harnessSha', 'kind', 'result'];
  const bound = value => Object.fromEntries(fields.map(key => [key, value?.[key]]));
  if (!fresh(original?.quality?.capturedAt, now) || !fresh(refreshed?.quality?.capturedAt, now)
    || original.quality.result !== 'success' || refreshed.quality.result !== 'success'
    || releaseHash(JSON.stringify(bound(original.quality))) !== releaseHash(JSON.stringify(bound(refreshed.quality)))) throw new Error('Quality evidence changed or expired at approval boundary.');
  for (const kind of ['restricted_browser', 'normal_role']) {
    const before = original?.evidence?.filter(row => row.kind === kind), after = refreshed?.evidence?.filter(row => row.kind === kind);
    if (before?.length !== 1 || after?.length !== 1 || !fresh(before[0].capturedAt, now) || !fresh(after[0].capturedAt, now)
      || releaseHash(JSON.stringify(bound(before[0]))) !== releaseHash(JSON.stringify(bound(after[0])))
      || kind === 'normal_role' && (!compatibilityNormalCoverageVerified(after[0])
        || JSON.stringify(before[0].emailSigner) !== JSON.stringify(after[0].emailSigner))) throw new Error('UI archive binding, completion freshness or real coverage changed.');
  }
  return true;
}

/** Sanitized informational receipt, assembled only by the protected collector.
 * Execution always recollects live authority; no receipt file is accepted.
 */
export function createRuntimeCompatibilityPreflight({ binding, scope, protection, provider, candidate, previous, trustedEvidence = [], quality,
  runtime, endpointAbsence, parity, readiness, collectionBlockers = [], now = Date.now() } = {}) {
  const blockers = [];
  const fail = (code, scope, resolution) => blockers.push({ code, scope, resolution });
  const checks = {};
  checks.source = binding?.sha === FIRST_RUNTIME_ROLLOUT.candidateSha && sha(binding.harnessSha)
    && [binding.sourceDigest, binding.lockHash, binding.configurationRevision, binding.candidateTreeHash].every(hash)
    && scope?.scopeVerified === true && scope.productionAuthorized === false && scope.baseCommit === FIRST_RUNTIME_ROLLOUT.previousSha
    && scope.candidateCommit === binding.sha && scope.candidateTreeHash === binding.candidateTreeHash;
  if (!checks.source) fail('EXACT_ADDITIVE_SCOPE_REQUIRED', 'source', 'Recompute the exact candidate/base scope and clean source, lock and control hashes from immutable Git objects.');
  checks.readOnlySourceGuards = compatibilityReadOnlyGuardsVerified(scope);
  if (!checks.readOnlySourceGuards) fail('EXACT_READ_ONLY_GUARD_SCOPE_REQUIRED', 'source', 'Independently prove all five exact reviewed guard transformations, including suppression of Email Router metadata persistence, and the exact read-action helper from immutable Git before credentials or staging.');
  checks.protection = positive(protection?.runId) && positive(protection.environmentId) && positive(protection.reviewerId)
    && protection.approvalMode === 'single_operator' && protection.harnessSha === binding?.harnessSha;
  if (!checks.protection) fail('COMPATIBILITY_ENVIRONMENT_APPROVAL_REQUIRED', 'protection', 'Install the reviewed workflow on protected main; separately approve exact environment setup, reviewed pins and dedicated credentials, then approve the first exact run.');
  checks.vercel = provider?.identityVerified === true && provider.targetPin === 'verified' && provider.deploymentCreate === 'verified'
    && provider.projectId === fcosConnectionIdentifier('vercel', 'Project ID') && provider.teamId === fcosConnectionIdentifier('vercel', 'Team ID');
  if (!checks.vercel) fail('VERCEL_RELEASE_AUTHORITY_REQUIRED', 'vercel', 'Verify dedicated OWNER/team token metadata and separately approve disabling automatic domain assignment, Production Git deployment and deploy hooks.');
  checks.previous = previous?.id === FIRST_RUNTIME_ROLLOUT.previousDeploymentId && previous.sha === FIRST_RUNTIME_ROLLOUT.previousSha
    && previous.url === FIRST_RUNTIME_ROLLOUT.previousUrl && previous.target === 'production' && previous.state === 'READY';
  if (!checks.previous) fail('EXACT_PREVIOUS_PRODUCTION_REQUIRED', 'deployments', 'Freshly verify current project Production still equals the exact pinned previous deployment and public commit.');
  checks.candidate = /^dpl_[A-Za-z0-9]+$/.test(candidate?.id || '') && candidate.id !== previous?.id && candidate.sha === binding?.sha
    && immutable(candidate.url) && candidate.url === binding?.candidateUrl && candidate.target === 'preview' && candidate.state === 'READY'
    && candidate.sourceDigest === binding?.sourceDigest;
  if (!checks.candidate) fail('EXACT_READY_PREVIEW_REQUIRED', 'deployments', 'Verify exact immutable Git-linked READY Preview metadata and a clean source-bound artifact receipt.');
  const bound = record => !!record && !!binding && record.sha === binding.sha && record.sourceDigest === binding.sourceDigest && record.lockHash === binding.lockHash
    && record.configurationRevision === binding?.configurationRevision && record.deploymentId === candidate?.id && record.candidateUrl === candidate?.url
    && positive(record.runId) && positive(record.artifactId) && hash(record.archiveDigest) && fresh(record.capturedAt, now);
  checks.quality = bound(quality) && quality.result === 'success';
  if (!checks.quality) fail('EXACT_QUALITY_ARTIFACT_REQUIRED', 'quality', 'Collect fresh protected exact-source quality evidence with verified archive digest and exact dependency lock binding.');
  for (const kind of ['restricted_browser', 'normal_role']) {
    const matching = trustedEvidence.filter(row => row.kind === kind && bound(row) && row.harnessSha === binding?.harnessSha);
    checks[kind] = matching.length === 1 && (kind !== 'normal_role' || compatibilityNormalCoverageVerified(matching[0]));
    if (!checks[kind]) fail(kind === 'normal_role' ? 'REAL_NORMAL_UI_COVERAGE_REQUIRED' : 'TRUSTED_RESTRICTED_UI_REQUIRED', kind,
      kind === 'normal_role' ? 'Collect exact-bound protected normal-role evidence for real module data and authorized read workflows; headings alone do not qualify.' : 'Collect fresh successful protected restricted browser evidence for the exact candidate and harness.');
  }
  checks.previewRuntimeSafety = compatibilityRuntimePreviewVerified(runtime, candidate, now);
  if (!checks.previewRuntimeSafety) fail('KNOWN_PREVIEW_RUNTIME_SAFETY_REQUIRED', 'runtime', 'Use an existing approved session to observe every effective flag and confirm read-only Preview with all external actions disabled.');
  checks.previousEndpointAbsent = endpointAbsence?.deploymentId === FIRST_RUNTIME_ROLLOUT.previousDeploymentId
    && endpointAbsence.sha === FIRST_RUNTIME_ROLLOUT.previousSha && endpointAbsence.url === FIRST_RUNTIME_ROLLOUT.previousUrl
    && endpointAbsence.sourceAbsent === true && endpointAbsence.httpStatus === 404 && fresh(endpointAbsence.capturedAt, now);
  if (!checks.previousEndpointAbsent) fail('PREVIOUS_ENDPOINT_ABSENCE_PROOF_REQUIRED', 'previous_runtime_endpoint', 'Verify absence from the exact previous immutable Git tree and credential-free endpoint readback.');
  checks.parity = parity?.pass === true && Array.isArray(parity.blockers) && !parity.blockers.length
    && parity.binding?.sha === binding?.sha && parity.binding?.sourceDigest === binding?.sourceDigest
    && parity.binding?.lockHash === binding?.lockHash && parity.binding?.configurationRevision === binding?.configurationRevision
    && parity.binding?.deploymentId === candidate?.id && parity.binding?.candidateUrl === candidate?.url && fresh(parity.capturedAt, now);
  if (!checks.parity) fail('INDEPENDENT_COMPATIBILITY_PARITY_REQUIRED', 'parity', 'Collect complete exact deployed environment, source-verified baseline configuration, compiled assets and independent existing provider sessions; unknown evidence cannot pass.');
  try {
    assertReleaseReceiptBinding(readiness, { sha: binding?.sha, sourceDigest: binding?.sourceDigest, lockHash: binding?.lockHash,
      configurationRevision: binding?.configurationRevision, deploymentId: candidate?.id, url: candidate?.url }, { now });
    checks.releaseReadiness = readiness.previousProduction.deploymentId === FIRST_RUNTIME_ROLLOUT.previousDeploymentId
      && readiness.previousProduction.sha === FIRST_RUNTIME_ROLLOUT.previousSha && readiness.previousProduction.url === FIRST_RUNTIME_ROLLOUT.previousUrl;
  } catch { checks.releaseReadiness = false; }
  if (!checks.releaseReadiness) fail('INDEPENDENT_RELEASE_READINESS_REQUIRED', 'readiness', 'Satisfy the unchanged standard source, quality, trusted browser, parity, freshness and exact-candidate readiness validator.');
  for (const blocker of collectionBlockers) if (/^[A-Z][A-Z0-9_]{0,95}$/.test(blocker?.code || '') && /^[a-zA-Z0-9_.-]{1,160}$/.test(blocker?.scope || '')) {
    fail(blocker.code, blocker.scope, 'Recollect this prerequisite through the pinned read-only provider after the exact reviewed setup is available.');
  }
  const safeBinding = binding ? Object.fromEntries(['sha', 'harnessSha', 'sourceDigest', 'lockHash', 'configurationRevision', 'candidateTreeHash', 'candidateUrl'].map(key => [key,
    ['sha', 'harnessSha'].includes(key) ? sha(binding[key]) ? binding[key] : null : key === 'candidateUrl' ? candidate?.url === binding[key] && checks.candidate ? binding[key] : null : hash(binding[key]) ? binding[key] : null])) : null;
  return { schemaVersion: 1, receiptKind: 'fcos_runtime_compatibility_preflight', capturedAt: new Date(now).toISOString(), binding: safeBinding,
    previousProduction: FIRST_RUNTIME_ROLLOUT, checks, requirements: runtimeCompatibilityRequirements(), blockers,
    proposedException: { code: COMPATIBILITY_EXCEPTION, endpointAbsenceObserved: checks.previousEndpointAbsent, environmentPinAndApprovalObserved: checks.protection,
      appliesOnlyTo: 'previous_runtime_endpoint', permittedCandidateSha: FIRST_RUNTIME_ROLLOUT.candidateSha,
      permittedPreviousDeploymentId: FIRST_RUNTIME_ROLLOUT.previousDeploymentId, runtimeValuesFabricated: false },
    candidate: readiness?.candidate ? Object.fromEntries(['sha', 'sourceDigest', 'lockHash', 'configurationRevision', 'deploymentId', 'url'].map(key => [key, readiness.candidate[key]])) : null,
    ready: blockers.length === 0 && Object.values(checks).every(value => value === true), productionAuthorized: false, mutations: 0, executorImplemented: true,
    limitation: 'First-rollout consistency evidence is not authority. The protected executor recollects human approval and provider capability before each consequential boundary. Missing evidence remains unknown.' };
}

// Compute the old deployment digest from immutable Git blobs, using the same
// unchanged source-upload rules. Neither a local baseline checkout nor arbitrary
// code from the candidate is executed in the credential-bearing harness.
export function immutableCompatibilityBaseline({ cwd, trustedCwd }) {
  const git = (args, options = {}) => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  const base = FIRST_RUNTIME_ROLLOUT.previousSha, candidate = FIRST_RUNTIME_ROLLOUT.candidateSha;
  const blob = (ref, file) => git(['rev-parse', `${ref}:${file}`]).toString('utf8').trim();
  const pure = verifyCompatibilityObservationSources({ cwd, baseSha: base, candidateSha: candidate });
  if (releaseHash(readFileSync(join(trustedCwd, 'scripts/lib/runtime-compatibility-observation.mjs'))) !== pure.helperRevision
    || blob(base, '.vercelignore') !== blob(candidate, '.vercelignore')) throw new Error('Reviewed pure collector or unchanged baseline source-upload rules required.');
  const included = deploymentSourceFilter(cwd), digest = createHash('sha256').update('fcos-vercel-source-v1\0');
  const rows = git(['ls-tree', '-rz', base]).toString('utf8').split('\0').filter(Boolean).map(row => {
    const separator = row.indexOf('\t'), [mode, type, oid] = row.slice(0, separator).split(' ');
    return { path: row.slice(separator + 1), mode, type, oid };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (rows.some(row => row.type !== 'blob' || !['100644', '100755'].includes(row.mode))) throw new Error('Baseline source contains an unsupported path.');
  const selected = rows.filter(row => !GENERATED_PROVENANCE_FILES.has(row.path) && included(row.path));
  // One bounded Git batch avoids a process and whole-tree reread per source file.
  const blobs = git(['cat-file', '--batch'], { input: `${selected.map(row => row.oid).join('\n')}\n` });
  let offset = 0;
  for (const row of selected) {
    const end = blobs.indexOf(10, offset), header = blobs.subarray(offset, end).toString('utf8').split(' ');
    const length = Number(header[2]);
    if (end < offset || header[0] !== row.oid || header[1] !== 'blob' || !Number.isSafeInteger(length) || length < 0 || end + length + 1 >= blobs.length) throw new Error('Immutable baseline Git batch binding failed.');
    const data = blobs.subarray(end + 1, end + length + 1); offset = end + length + 2;
    digest.update(`${row.path}\0${row.mode === '100755' ? 'executable' : 'regular'}\0${data.length}\0`).update(data).update('\0');
  }
  if (offset !== blobs.length) throw new Error('Unexpected immutable baseline batch data.');
  return { sha: base, sourceDigest: digest.digest('hex'), helperSourceVerified: pure.sourceVerified, helperRevision: pure.helperRevision, declarationsSha256: pure.declarationsSha256,
    observationKind: 'independent_provider_probe_and_verified_deployment_configuration' };
}

export async function executeRuntimeCompatibilityRelease({ preflight, readiness, authority, ...adapters } = {}) {
  if (preflight?.schemaVersion !== 1 || preflight.receiptKind !== 'fcos_runtime_compatibility_preflight'
    || preflight.ready !== true || preflight.productionAuthorized !== false || preflight.blockers?.length
    || !fresh(preflight.capturedAt, Date.now())
    || preflight.binding?.sha !== FIRST_RUNTIME_ROLLOUT.candidateSha || preflight.proposedException?.appliesOnlyTo !== 'previous_runtime_endpoint'
    || preflight.proposedException.endpointAbsenceObserved !== true || preflight.proposedException.environmentPinAndApprovalObserved !== true
    || !Object.values(preflight.checks || {}).length || Object.values(preflight.checks).some(value => value !== true)) throw new Error('Complete independently collected first-rollout prerequisites are required before any mutation.');
  assertReleaseReceiptBinding(readiness, { sha: preflight.binding.sha, sourceDigest: preflight.binding.sourceDigest,
    lockHash: preflight.binding.lockHash, configurationRevision: preflight.binding.configurationRevision,
    deploymentId: preflight.candidate.deploymentId, url: preflight.candidate.url });
  if (readiness.previousProduction.deploymentId !== FIRST_RUNTIME_ROLLOUT.previousDeploymentId
    || readiness.previousProduction.sha !== FIRST_RUNTIME_ROLLOUT.previousSha || readiness.previousProduction.url !== FIRST_RUNTIME_ROLLOUT.previousUrl) throw new Error('First-rollout previous Production binding changed.');
  // Use the unchanged durable staging state machine. Adapters re-read the exact
  // compatibility environment approval, token metadata, configuration and source.
  const checkedAuthority = async () => {
    if (!fresh(preflight.capturedAt, Date.now())) throw new Error('First-rollout preflight expired at approval boundary.');
    assertReleaseReceiptBinding(readiness, { sha: preflight.binding.sha, sourceDigest: preflight.binding.sourceDigest,
      lockHash: preflight.binding.lockHash, configurationRevision: preflight.binding.configurationRevision,
      deploymentId: preflight.candidate.deploymentId, url: preflight.candidate.url });
    return authority();
  };
  return executeProductionRelease({ readiness, authority: checkedAuthority, ...adapters });
}
