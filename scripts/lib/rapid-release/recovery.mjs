import { assertBuildReceipt, assertPreBootstrapProof, assertSmokeProof } from './engine.mjs';
import { assertFrozenWorkflow, assertNativeQualityProducer, assertPermanentHandover, freshApprovalDisposition, nativeWorkflowPath } from './providers.mjs';
import { approvalWindowOpen, assertAuthorization, digest, requireCondition, targets } from './contract.mjs';
import { pendingOperations } from './journal.mjs';

const workflowPath = '.github/workflows/fcos-rapid-release.yml';
const environmentName = 'fcos-production-release';
const base = () => `/repos/${targets().repository}`;

export async function readRecoveryRun({ github, manifest, runId }) {
  requireCondition(Number.isSafeInteger(runId) && runId > 0, 'RECOVERY_RUN_ID_REQUIRED');
  const { user, repo } = await github.identity();
  requireCondition(user.login === targets().account && repo.owner?.id === user.id, 'RELEASE_OPERATOR_MISMATCH');
  const endpoint = `${base()}/actions/runs/${runId}`;
  const [run, enabled, pointer] = await Promise.all([
    github.read(endpoint),
    github.read(`${base()}/actions/variables/FCOS_RAPID_RELEASE_ENABLED`),
    github.read(`${base()}/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID`),
  ]);
  const manifestHash = digest(manifest);
  requireCondition(run.id === runId && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === workflowPath
    && run.repository?.id === repo.id && run.head_branch === repo.default_branch
    && run.actor?.id === user.id && run.triggering_actor?.id === user.id
    && Number.isSafeInteger(run.run_attempt) && run.run_attempt >= 1
    && new RegExp(`^FCOS rapid (release|resume) ${manifestHash} ${manifest.candidate.sha}$`).test(run.display_title),
    'WORKFLOW_IDENTITY_MISMATCH');
  requireCondition(enabled.value === 'true' && /^[1-9][0-9]*$/.test(pointer.value), 'RAPID_RELEASE_NOT_ACTIVATED');
  const [handover, branch] = await Promise.all([
    github.read(`${base()}/deployments/${pointer.value}`),
    github.read(`${base()}/branches/${encodeURIComponent(repo.default_branch)}`),
  ]);
  requireCondition(handover.id === Number(pointer.value) && branch.protected, 'RAPID_RELEASE_HANDOVER_POINTER_CHANGED');
  assertPermanentHandover(handover, manifest, user.id);
  await Promise.all([run.head_sha, branch.commit.sha].filter((value, index, all) => all.indexOf(value) === index)
    .map(dispatcherSha => assertFrozenWorkflow({ github, controllerSha: manifest.controllerSha, dispatcherSha })));
  return { run, manifestHash, endpoint, ownerId: user.id, dispatcherSha: branch.commit.sha, branch: repo.default_branch };
}

function evidence({ records, manifest }) {
  requireCondition(pendingOperations(records).length === 0, 'ORIGINAL_OPERATION_READBACK_REQUIRED');
  const event = name => records.find(row => row.payload.event === name)?.payload.data;
  const build = event('build.passed'), stage = event('stage.result'), approval = event('approval.accepted');
  requireCondition(stage?.outcome === 'applied', 'STAGED_ACCEPTANCE_REQUIRED');
  assertBuildReceipt(build, manifest);
  const staged = stage.result;
  requireCondition(staged.target === 'production' && staged.sha === manifest.candidate.sha
    && staged.buildId === build.buildId && staged.artifactDigest === build.artifactDigest
    && staged.manifestHash === digest(manifest), 'STAGED_ACCEPTANCE_CHANGED');
  return { build, staged, approval, stagedCheck: event('smoke.passed') || event('stage.pre_bootstrap_passed') };
}

export async function checkApprovalReadiness({ github, manifest, journal, runId }) {
  const native = await readRecoveryRun({ github, manifest, runId });
  const records = await journal.read();
  requireCondition(!pendingOperations(records).length, 'ORIGINAL_OPERATION_READBACK_REQUIRED');
  const saved = records.find(row => row.payload.event === 'approval.accepted')?.payload.data;
  const decision = freshApprovalDisposition({ run: native.run, manifest, saved });
  if (decision === 'reuse_original_approval') {
    assertAuthorization(saved, manifest, evidence({ records, manifest }).staged);
    return { state: decision, runId, attempt: native.run.run_attempt };
  }
  if (decision !== 'fresh') return { state: decision, runId, attempt: native.run.run_attempt };
  if (!approvalWindowOpen(native.run.created_at)) return { state: 'fresh_attempt_one_required', reason: 'review_window_expired', runId,
    attempt: native.run.run_attempt };
  const { staged, stagedCheck, approval } = evidence({ records, manifest });
  requireCondition(!approval, 'ORIGINAL_APPROVED_EXECUTION_REQUIRED');
  if (manifest.prerequisites?.plan?.deferSchemaDependentSmoke === true) assertPreBootstrapProof(stagedCheck, manifest, staged);
  else assertSmokeProof(stagedCheck, manifest, staged);
  const [jobs, gates, reviews, environment] = await Promise.all([
    github.read(`${native.endpoint}/attempts/${native.run.run_attempt}/jobs?per_page=100`),
    github.read(`${native.endpoint}/pending_deployments`),
    github.read(`${native.endpoint}/approvals`),
    github.read(`${base()}/environments/${environmentName}`),
  ]);
  const rule = environment.protection_rules?.find(item => item.type === 'required_reviewers');
  requireCondition(environment.name === environmentName && environment.can_admins_bypass === false
    && rule?.reviewers?.some(item => item.reviewer?.id === native.ownerId), 'PRODUCTION_REVIEW_PROTECTION_REQUIRED');
  requireCondition(native.run.status === 'waiting' && ['quality', 'stage-and-smoke'].every(name => jobs.jobs.some(job => job.name === name && job.conclusion === 'success'))
    && jobs.jobs.some(job => job.name === 'go-live' && job.status === 'waiting')
    && gates.length === 1 && gates[0].environment?.name === environmentName && gates[0].environment.id === environment.id
    && gates[0].current_user_can_approve === true
    && !reviews.some(row => row.state === 'approved' && row.environments?.some(env => env.id === environment.id)),
    'FRESH_NATIVE_APPROVAL_GATE_NOT_READY');
  return { state: 'ready_for_exact_approval', runId, attempt: 1, deploymentId: staged.id,
    candidateSha: manifest.candidate.sha, manifestHash: native.manifestHash, environmentId: environment.id };
}

export async function planReleaseRecovery({ github, manifest, journal, provider, readCompatibility, runId, buildRunId }) {
  const native = await readRecoveryRun({ github, manifest, runId });
  requireCondition(native.run.status === 'completed' && ['failure', 'cancelled', 'timed_out'].includes(native.run.conclusion),
    'RECOVERY_RUN_NOT_TERMINAL');
  const records = await journal.read();
  const { build, staged, approval, stagedCheck } = evidence({ records, manifest });
  requireCondition(!approval && !records.some(row => /^(promote|prerequisites|rollback)\./.test(row.payload.event)
    || row.payload.event === 'release.complete'), 'ORIGINAL_APPROVED_EXECUTION_REQUIRED');
  requireCondition(Number.isSafeInteger(buildRunId) && buildRunId > 0, 'PRIOR_QUALITY_ARTIFACT_REQUIRED');
  const producer = `${base()}/actions/runs/${buildRunId}`;
  const [qualityRun, jobs, artifacts, observed, live] = await Promise.all([
    github.read(producer),
    github.read(`${producer}/jobs?filter=all&per_page=100`),
    github.read(`${producer}/artifacts?per_page=100`),
    provider.ready(staged.id),
    readCompatibility({ manifest }),
  ]);
  const workflow = await assertFrozenWorkflow({ github, controllerSha: manifest.controllerSha, dispatcherSha: qualityRun.head_sha });
  assertNativeQualityProducer(qualityRun, jobs, manifest, workflow);
  requireCondition(qualityRun.id === buildRunId && qualityRun.actor?.id === native.ownerId, 'PRIOR_NATIVE_QUALITY_REQUIRED');
  const archives = artifacts.artifacts.filter(item => item.name === `rapid-build-${buildRunId}` && item.expired === false);
  requireCondition(archives.length === 1 && archives[0].workflow_run?.id === buildRunId
    && /^sha256:[a-f0-9]{64}$/.test(archives[0].digest), 'PRIOR_QUALITY_ARTIFACT_REQUIRED');
  requireCondition(observed.id === staged.id && observed.state === 'READY' && observed.target === staged.target
    && observed.sha === staged.sha && observed.buildId === build.buildId && observed.artifactDigest === build.artifactDigest
    && observed.manifestHash === native.manifestHash, 'STAGED_ACCEPTANCE_CHANGED');
  requireCondition(live.sha === manifest.previous.sha && live.currentDeploymentId === manifest.previous.deploymentId
    && live.configurationDigest === manifest.previous.configurationDigest && live.schemaDigest === manifest.previous.schemaDigest,
    'PRODUCTION_BASELINE_CHANGED');
  if (stagedCheck) {
    if (stagedCheck.mode === 'pre_bootstrap') assertPreBootstrapProof(stagedCheck, manifest, staged);
    else assertSmokeProof(stagedCheck, manifest, staged);
  }
  const active = await Promise.all(['fcos-rapid-release.yml','fcos-rapid-handover.yml'].map(name =>
    github.read(`${base()}/actions/workflows/${name}/runs?event=workflow_dispatch&per_page=100`)));
  requireCondition(active.every(page => page.workflow_runs.every(run => run.status === 'completed')), 'COMPETING_RELEASE_RUN');
  await journal.assertNoUnresolvedOtherRelease();
  return { state: 'fresh_attempt_one_required', previousRunId: runId, originalBuildRunId: buildRunId,
    candidateSha: manifest.candidate.sha, manifestHash: native.manifestHash, dispatcherSha: native.dispatcherSha,
    deploymentId: staged.id, artifactDigest: build.artifactDigest, artifactId: archives[0].id, archiveDigest: archives[0].digest,
    retainedSmoke: Boolean(stagedCheck),
    request: { ref: native.branch, inputs: { mode: 'resume', candidate_sha: manifest.candidate.sha,
      resume_build_run_id: String(buildRunId), manifest_json: JSON.stringify(manifest), manifest_hash: native.manifestHash } },
    dispatched: false, requiresExactApproval: true };
}
