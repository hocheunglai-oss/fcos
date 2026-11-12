import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { githubConfigDirectory } from './fcos-connections.mjs';
import { cliSalesforceProvider, loadReviewedSalesforcePlan } from './deploy-salesforce-reviewed-manifest.mjs';
import { runReviewedMirror } from './sync-salesforce-reviewed-repository.mjs';
import { assertAuthorization, digest, git, requireCondition, sourceSnapshot, targets, validateManifest } from './lib/rapid-release/contract.mjs';
import { DeploymentJournal } from './lib/rapid-release/journal.mjs';
import { assertFrozenWorkflow, assertPermanentHandover, nativeWorkflowPath } from './lib/rapid-release/providers.mjs';
import { createLocalMirrorReceipt, recordLocalMirrorDeployment, usesLocalCollaboratorMirror, verifyLocalMirrorRequest } from './lib/rapid-release/local-mirror-handoff.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const { publication } = policy;
const base = `/repos/${targets().repository}`;

function operatorGitHub() {
  const env = { ...process.env, GH_CONFIG_DIR: githubConfigDirectory(), GH_HOST: 'github.com' };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const api = (args, body) => JSON.parse(execFileSync('gh', ['api', ...args], {
    env, input: body && JSON.stringify(body), encoding: 'utf8', timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024, stdio: [body ? 'pipe' : 'ignore', 'pipe', 'ignore'],
  }));
  return {
    read: path => api([path]),
    pages: path => api(['--paginate', '--slurp', path]).flat(),
    write: (path, body) => api([path, '--method', 'POST', '--input', '-'], body),
  };
}

async function main() {
  const [manifestFile, candidateDirectory, requestNumber, recovery] = process.argv.slice(2);
  const requestId = Number(requestNumber);
  requireCondition(process.argv.length <= 6 && manifestFile && candidateDirectory
    && /^[1-9][0-9]*$/u.test(requestNumber || '') && Number.isSafeInteger(requestId)
    && (recovery === undefined || recovery === '--readback'), 'USAGE_MANIFEST_CANDIDATE_REQUEST_ID_OPTIONAL_READBACK');
  requireCondition(process.env.GITHUB_ACTIONS !== 'true', 'LOCAL_MIRROR_REQUIRES_OPERATOR_HOST');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const manifestHash = validateManifest(manifest);
  const plan = manifest.prerequisites?.plan;
  requireCondition(usesLocalCollaboratorMirror(manifest)
    && git(process.cwd(), ['rev-parse', 'HEAD']) === manifest.controllerSha
    && !git(process.cwd(), ['status', '--porcelain', '--untracked-files=normal']), 'LOCAL_MIRROR_CONTROLLER_MISMATCH');
  const cwd = resolve(candidateDirectory);
  const source = sourceSnapshot(cwd);
  requireCondition(source.sha === manifest.candidate.sha && source.sourceDigest === manifest.candidate.sourceDigest
    && source.lockDigest === manifest.candidate.lockDigest, 'LOCAL_MIRROR_CANDIDATE_MISMATCH');
  const reviewed = loadReviewedSalesforcePlan({ cwd, policy, manifestPath: plan.salesforceManifestPath, reviewPath: plan.salesforceReviewPath });
  requireCondition(reviewed.fingerprint === plan.salesforceFingerprint && reviewed.binding.sourceTreeHash === plan.salesforceSourceTreeHash,
    'LOCAL_MIRROR_REVIEWED_SOURCE_MISMATCH');

  const github = { ...operatorGitHub(), candidateSha: manifest.candidate.sha };
  const [operator, bot, repo, nativeRequest] = await Promise.all([
    github.read('/user'), github.read('/users/github-actions%5Bbot%5D'), github.read(base), github.read(`${base}/deployments/${requestId}`),
  ]);
  requireCondition(operator.id === publication.requiredAccountId && operator.login === publication.requiredAccount
    && bot.login === 'github-actions[bot]' && repo.id === 1278654816 && repo.owner?.id === operator.id
    && repo.full_name === targets().repository && repo.permissions?.admin === true && repo.default_branch === 'main' && !repo.archived,
  'LOCAL_MIRROR_GITHUB_IDENTITY_MISMATCH');
  const request = nativeRequest.payload;
  requireCondition(nativeRequest.id === requestId && request?.manifestHash === manifestHash && request.controllerSha === manifest.controllerSha
    && request.candidateSha === manifest.candidate.sha && request.fingerprint === reviewed.fingerprint
    && request.sourceTreeHash === reviewed.binding.sourceTreeHash && request.deveeOrgId === reviewed.binding.orgIds.devee
    && ['publish', 'check', 'recover'].includes(request.mode), 'LOCAL_MIRROR_REQUEST_SCOPE_MISMATCH');
  verifyLocalMirrorRequest({ request, requestDeployment: nativeRequest, workflowActorId: bot.id });

  const runPath = `${base}/actions/runs/${request.runId}`;
  const journal = new DeploymentJournal({ github, actorIds: [bot.id, operator.id], releaseId: manifest.releaseId, manifestHash });
  const [run, environment, reviews, enabled, pointer] = await Promise.all([
    github.read(runPath), github.read(`${base}/environments/fcos-production-release`), github.read(`${runPath}/approvals`),
    github.read(`${base}/actions/variables/FCOS_RAPID_RELEASE_ENABLED`),
    github.read(`${base}/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID`),
  ]);
  requireCondition(run.id === request.runId && run.run_attempt === request.runAttempt && run.repository?.id === repo.id
    && run.actor?.id === operator.id && run.event === 'workflow_dispatch' && run.head_branch === repo.default_branch
    && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && new RegExp(`^FCOS rapid (release|resume) ${manifestHash} ${manifest.candidate.sha}$`, 'u').test(run.display_title)
    && enabled.value === 'true' && /^[1-9][0-9]*$/u.test(pointer.value)
    && environment.name === 'fcos-production-release' && environment.can_admins_bypass === false
    && environment.protection_rules?.some(rule => rule.type === 'required_reviewers'
      && rule.reviewers?.some(({ reviewer }) => reviewer?.id === operator.id))
    && reviews.some(review => review.state === 'approved' && review.user?.id === operator.id
      && review.environments?.some(item => item.id === environment.id && item.name === environment.name)),
  'LOCAL_MIRROR_PROTECTED_REVIEW_REQUIRED');
  await assertFrozenWorkflow({ github, controllerSha: manifest.controllerSha, dispatcherSha: run.head_sha });
  assertPermanentHandover(await github.read(`${base}/deployments/${pointer.value}`), manifest, operator.id);

  const chain = await journal.read();
  const event = name => chain.find(record => record.creator?.id === bot.id && record.payload.event === name)?.payload.data;
  const staged = event('stage.result')?.result;
  const approval = assertAuthorization(event('approval.accepted'), manifest, staged);
  requireCondition(approval.runId === request.runId && event('prerequisites.intent'), 'LOCAL_MIRROR_RELEASE_JOURNAL_REQUIRED');
  await journal.assertNoUnresolvedOtherRelease();

  const checkpoints = chain.filter(record => record.creator?.id === bot.id && record.payload.event === 'salesforce.checkpoint'
    && record.payload.data.fingerprint === reviewed.fingerprint).map(record => record.payload.data);
  const latest = (stage, operation) => checkpoints.findLast(item => item.stage === stage && item.operation === operation);
  const validation = latest('devee', 'validation');
  const deployment = latest('devee', 'deployment');
  const mirror = latest('shared_mirror', 'publication');
  requireCondition(validation?.outcome === 'resolved' && validation.job?.id === request.validationJobId
    && deployment?.outcome === 'resolved' && deployment.job?.id === request.deploymentJobId
    && deployment.job.validationId === request.validationJobId && mirror?.evidenceDigest === request.intentHash
    && mirror.outcome === (request.mode === 'check' ? 'resolved' : 'pending'), 'LOCAL_MIRROR_ORIGINAL_CHECKPOINT_REQUIRED');
  const live = await fetch(`${targets().origin}/app-version.json`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000) });
  requireCondition(live.ok && (await live.json()).commit === manifest.previous.sha, 'LOCAL_MIRROR_PRODUCTION_BASELINE_CHANGED');

  const receipt = { fingerprint: reviewed.fingerprint, stage: 'devee', orgId: request.deveeOrgId,
    operation: 'shared-publication', expiresAt: request.expiresAt,
    receiptId: digest({ manifestHash, runId: request.runId, fingerprint: reviewed.fingerprint, stage: 'devee',
      orgId: request.deveeOrgId, operation: 'shared-publication' }) };
  const assertCurrent = async () => {
    verifyLocalMirrorRequest({ request, requestDeployment: nativeRequest, workflowActorId: bot.id });
    const [currentRun, jobs, currentPointer] = await Promise.all([
      github.read(runPath), github.read(`${runPath}/attempts/${request.runAttempt}/jobs?per_page=100`),
      github.read(`${base}/actions/variables/FCOS_RAPID_RELEASE_HANDOVER_ID`),
    ]);
    requireCondition(currentRun.status === 'in_progress' && currentRun.run_attempt === request.runAttempt
      && currentPointer.value === pointer.value && jobs.jobs?.some(job => job.name === 'go-live' && job.status === 'in_progress'),
    'LOCAL_MIRROR_HOSTED_LEASE_ENDED');
    return receipt;
  };
  const claimRef = suffix => {
    const ref = `refs/tags/fcos-local-mirror/${manifestHash}/${suffix}`;
    const claim = github.write(`${base}/git/refs`, { ref, sha: manifest.candidate.sha });
    requireCondition(claim.ref === ref && claim.object?.sha === manifest.candidate.sha, 'LOCAL_MIRROR_CLAIM_ACK_UNCERTAIN');
  };
  const mode = !recovery && request.mode === 'publish' ? 'publish' : 'check';
  if (mode === 'check' && request.mode !== 'check') {
    const claim = github.read(`${base}/git/ref/tags/fcos-local-mirror/${manifestHash}/publication`);
    requireCondition(claim.object?.sha === manifest.candidate.sha, 'LOCAL_MIRROR_ORIGINAL_CLAIM_REQUIRED');
  }
  if (mode === 'publish') {
    await assertCurrent();
    // GitHub creates a new ref atomically. An existing ref or unknown reply
    // leaves this operation readback-only on every operator host.
    claimRef('publication');
  }

  const jobState = id => ({ jobId: id, status: 'Succeeded', fingerprint: reviewed.fingerprint, orgId: request.deveeOrgId });
  const state = {
    fingerprint: reviewed.fingerprint, binding: reviewed.binding,
    stages: {
      devee: {
        validation: jobState(request.validationJobId),
        deployment: { ...jobState(request.deploymentJobId), validationJobId: request.validationJobId },
      },
      shared_mirror: {
        publication: { status: 'submitting', receiptId: receipt.receiptId, receiptExpiresAt: receipt.expiresAt },
      },
    },
  };
  const provider = cliSalesforceProvider({ cwd, policy });
  await assertCurrent();
  const report = await runReviewedMirror({ mode, cwd, plan: reviewed, state, policy, provider, ownership: { assert: assertCurrent } });
  requireCondition(request.mode !== 'check' || (mirror.mirror?.commit === report.commit && mirror.mirror?.pullRequest === report.pullRequest.number),
    'LOCAL_MIRROR_HEAD_CHANGED');
  await assertCurrent();
  const payload = createLocalMirrorReceipt({ request, requestId, reviewed, report });
  let readbackOnly = false;
  try { claimRef(`receipt-${requestId}`); }
  catch { readbackOnly = true; }
  const result = await recordLocalMirrorDeployment({ github, candidateSha: request.candidateSha, actorId: operator.id, payload, readbackOnly });
  console.log(JSON.stringify({ requestId, receiptId: result.id, commit: report.commit, pullRequest: report.pullRequest.number }));
}

main().catch(error => {
  console.error(/^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'LOCAL_MIRROR_STOPPED_CHECK_NATIVE_STATE');
  process.exitCode = 1;
});
