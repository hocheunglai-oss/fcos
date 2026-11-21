import { fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { assertAuthorization, digest, isDigest, isSha, requireCondition as check, targets, validateManifest } from './contract.mjs';
import { assertSmokeProof } from './engine.mjs';
import { pendingOperations, validateChain } from './journal.mjs';
import { readLocalMirrorDeployments, readLocalMirrorStage, verifyLocalMirrorReceipt,
  verifyLocalMirrorRequest } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';

export const editorsClosureWorkflow = '.github/workflows/fcos-rapid-editors-production-validation-closure.yml';
export const editorsClosureTitle = 'Close stopped FCOS Editors Production validation';
export const editorsClosureJob = 'close-editors-production-validation';
export const editorsClosureEnvironment = Object.freeze({ id: 23178773471, name: 'fcos-production-release' });
export const editorsClosureOutcome = 'stopped_editors_production_validation_complete';
export const originalEditorsProductionValidation = Object.freeze({
  originalRunId: 44820425871, continuationRunId: 44851357194, actorId: 265701760, workflowActorId: 41898282,
  repositoryId: 1278654816, handoverId: 7918894051,
  dispatcher: 'a8c3043690d9f374a88d21156c5eb8a564a255dc', controller: '208a0fdd36565fbb247860ad4f368565f929c0db',
  candidate: '4590ba170ea2ffac5ecd7d741b1913091b865560', releaseId: 'rapid-4590ba170ea2-mwpdycg4',
  manifestHash: 'e1116d926f64bd81b6ddd0e577d9b19a6f973c4c93473501d471f59bc1496550',
  originalHead: 'b2bb16450dcaf5100a41347c1f9c9bf8d4605f77067c632d546f78da798c2ae9',
  oldHead: 'e49fa8b5ad3b32cc8c052281552d9b38480994078e08af15c61f6fef75bfddfc',
  fingerprint: 'ecb061e10b2fa072107ba4ebce2b1a6ff1872e42d28ceda406151c05d1cb29a1',
  sourceTreeHash: '9702b4d59a2ae42c4efcc9677d2176e770dd99eeb366b3de830144dd36260140',
  packageSha256: 'f274d788ab35997cc7a06963b10a4a9c9bab00ee886ef3ff4dab6904008ee328',
  stagedDeploymentId: 'dpl_4kiJmq2uEZzCgY6j7vktoui5hS7x',
  stagedArtifactDigest: '970ac81c8a0ab745dffab0e7e380399b28389aaef9af62a161f02bd3013cb444',
  deveeValidationJobId: '0AfHF000007J8nR0AS', deveeDeploymentJobId: '0AfHF000007J8qf0AC',
  qatValidationJobId: '0AfBh000006lkaDKAQ', qatDeploymentJobId: '0AfBh000006lkbpKAA',
  productionValidationJobId: '0Affu000001BAhpCAG',
  mirrorCommit: '283425f01af3bc9ddb839d2b5c68edd634bd832e', mirrorPullRequest: 9,
  mirrorPublishRequestId: 7956255009, mirrorReceiptId: 7956278754,
  mirrorVerifiedCheckRequestId: 7956440722, mirrorVerifiedCheckReceiptId: 7956460612, mirrorRequestId: 7956784449,
});
const original = originalEditorsProductionValidation;
const repoPath = '/repos/' + targets().repository;
const journalEnvironment = 'fcos-release-journal-v1';
const operationId = original.releaseId + '-prerequisites';
const originalApprovalReceiptId = 7956086286;
const continuedApprovalReceiptId = 7956743076;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const date = value => Date.parse(value);
const same = (left, right) => digest(left) === digest(right);
export const isEditorsClosureOwner = person => person?.id === original.actorId && person.login === targets().account;
const isWorkflow = person => person?.id === original.workflowActorId && person.login === 'github-actions[bot]';
const isTargetRun = run => run?.run_attempt === 1 && run.event === 'workflow_dispatch' && run.head_branch === 'main'
  && run.repository?.id === original.repositoryId && run.repository.full_name === targets().repository
  && isEditorsClosureOwner(run.actor) && isEditorsClosureOwner(run.triggering_actor);
const approvalMatches = review => review?.environments?.some(environment => environment.id === editorsClosureEnvironment.id
  && environment.name === editorsClosureEnvironment.name);

export function assertEditorsClosureApproval(approvals) {
  const reviews = Array.isArray(approvals) && approvals.filter(approvalMatches);
  check(reviews?.length === 1 && reviews[0].state === 'approved' && isEditorsClosureOwner(reviews[0].user),
    'EDITORS_CLOSURE_NATIVE_APPROVAL_MISMATCH');
}

function verifyHistoricalAttempt({ run, jobs, approvals }, { runId, mode, conclusion, jobIds }) {
  check(isTargetRun(run) && run.id === runId && run.status === 'completed' && run.conclusion === conclusion
    && run.head_sha === original.dispatcher && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && run.display_title === `FCOS rapid ${mode} ${original.manifestHash} ${original.candidate}`,
  'EDITORS_CLOSURE_ORIGINAL_RUN_MISMATCH');
  check(jobs?.total_count === 3 && jobs.jobs?.length === 3 && ['quality', 'stage-and-smoke', 'go-live'].every((name, i) =>
    jobs.jobs.filter(job => job.name === name && job.id === jobIds[i] && job.run_id === run.id && job.run_attempt === 1
      && job.status === 'completed' && job.conclusion === (name === 'go-live' ? conclusion : 'success')
      && date(run.created_at) <= date(job.started_at) && date(job.started_at) <= date(job.completed_at)).length === 1),
  'EDITORS_CLOSURE_ORIGINAL_JOBS_MISMATCH');
  assertEditorsClosureApproval(approvals);
  return jobs.jobs.find(job => job.name === 'go-live');
}

const historyIds = [7953090470, 7953090657, 7953094609, 7953097906, 7953207791, originalApprovalReceiptId, 7956088761,
  7956098288, 7956103409, 7956110932, 7956120004, 7956120665, 7956228597, 7956236762, 7956237188, 7956238524,
  7956248879, 7956252198, 7956281788, 7956289916, 7956290744, 7956422447, 7956430825, 7956431326, 7956432780,
  7956464170, 7956474530, 7956475280, continuedApprovalReceiptId, 7956753055, 7956758557, 7956763302, 7956768560,
  7956771900, 7956781947, 7956839045];
const historyEvents = ['release.prepared', 'build.passed', 'stage.intent', 'stage.result', 'smoke.passed', 'approval.accepted',
  'prerequisites.intent', ...Array(21).fill('salesforce.checkpoint'), 'approval.reconfirmed', ...Array(6).fill('salesforce.checkpoint'),
  'obstacle.detected'];
const checkpointKeys = ['devee:validation', 'devee:deployment', 'shared_mirror:publication', 'qat:validation', 'qat:deployment',
  'production:validation'];

function historicalCheckpoints(chain) {
  const index = [12, 15, 18, 21, 24, 33];
  const resolvedIds = [original.deveeValidationJobId, original.deveeDeploymentJobId, null,
    original.qatValidationJobId, original.qatDeploymentJobId, original.productionValidationJobId];
  const validationIds = [null, original.deveeValidationJobId, null, null, original.qatValidationJobId, null];
  return Object.fromEntries(checkpointKeys.map((key, i) => {
    const row = chain[index[i]];
    const data = row.payload.data;
    check(`${data.stage}:${data.operation}` === key && data.outcome === 'resolved' && data.fingerprint === original.fingerprint
      && isDigest(data.evidenceDigest), 'EDITORS_CLOSURE_SALESFORCE_CHECKPOINT_MISMATCH');
    if (data.operation === 'publication') {
      check(same(data.mirror, { commit: original.mirrorCommit, pullRequest: original.mirrorPullRequest })
        && same(chain[25].payload.data.mirror, data.mirror), 'EDITORS_CLOSURE_MIRROR_CHECKPOINT_MISMATCH');
    } else {
      check(data.job?.id === resolvedIds[i] && data.job.validationId === validationIds[i]
        && (data.operation !== 'validation' || data.job.packageSha256 === original.packageSha256),
      'EDITORS_CLOSURE_SALESFORCE_JOB_MISMATCH');
    }
    return [key, row];
  }));
}

function verifyMirrorHistory({ requests, chain, goLive, continuation }) {
  const scoped = requests.filter(row => row.payload?.manifestHash === original.manifestHash
    || row.payload?.kind === 'fcos_local_mirror_receipt' && [original.mirrorPublishRequestId,
      original.mirrorVerifiedCheckRequestId, original.mirrorRequestId].includes(row.payload.requestId));
  check(scoped.length === 5, 'EDITORS_CLOSURE_MIRROR_HISTORY_MISMATCH');
  const mirror = { request: scoped.find(row => row.id === original.mirrorPublishRequestId),
    receipt: scoped.find(row => row.id === original.mirrorReceiptId),
    verifiedCheckRequest: scoped.find(row => row.id === original.mirrorVerifiedCheckRequestId),
    verifiedCheckReceipt: scoped.find(row => row.id === original.mirrorVerifiedCheckReceiptId),
    continuedRequest: scoped.find(row => row.id === original.mirrorRequestId) };
  const reviewed = { fingerprint: original.fingerprint, binding: { sourceTreeHash: original.sourceTreeHash } };
  const [first, recheck, continued] = [mirror.request, mirror.verifiedCheckRequest, mirror.continuedRequest];
  const specs = [[first, original.originalRunId, 'publish', 1, date(chain[17].created_at),
    date(chain[18].created_at)], [recheck, original.originalRunId, 'check', 2, date(chain[24].created_at), date(chain[25].created_at)],
    [continued, original.continuationRunId, 'check', 1, date(chain[34].created_at), date(continuation.completed_at)]];
  for (const [row, runId, mode, sequence, earliest, latest] of specs) {
    const p = row?.payload;
    check(p?.runId === runId && p.runAttempt === 1 && p.mode === mode && p.sequence === sequence
      && p.candidateSha === original.candidate && p.controllerSha === original.controller
      && p.fingerprint === original.fingerprint && p.sourceTreeHash === original.sourceTreeHash
      && p.deveeOrgId === fcosSalesforceEnvironment('devee').orgId && p.deploymentJobId === original.deveeDeploymentJobId
      && p.validationJobId === original.deveeValidationJobId && isDigest(p.intentHash)
      && row.ref === original.candidate && row.task === 'fcos-local-mirror-handoff' && isWorkflow(row.creator)
      && earliest <= date(row.created_at) && date(row.created_at) <= latest, 'EDITORS_CLOSURE_MIRROR_REQUEST_MISMATCH');
  }
  check(date(continued.payload.expiresAt) <= date(continuation.completed_at)
    && date(recheck.payload.expiresAt) < date(goLive.completed_at), 'EDITORS_CLOSURE_MIRROR_WINDOW_MISMATCH');
  verifyLocalMirrorRequest({ request: continued.payload, requestDeployment: continued,
    workflowActorId: original.workflowActorId, now: date(continued.created_at) });
  const verifyReceipt = (requestDeployment, receiptDeployment, checkpoint) => {
    check(isEditorsClosureOwner(receiptDeployment?.creator) && receiptDeployment.ref === original.candidate
      && receiptDeployment.task === 'fcos-local-mirror-handoff'
      && date(receiptDeployment.created_at) <= date(checkpoint.created_at), 'EDITORS_CLOSURE_MIRROR_RECEIPT_MISMATCH');
    const proof = verifyLocalMirrorReceipt({ request: requestDeployment.payload, requestDeployment, receiptDeployment, reviewed,
      workflowActorId: original.workflowActorId, publisherId: original.actorId, now: date(receiptDeployment.created_at) });
    check(proof.commit === original.mirrorCommit && proof.pullRequest.number === original.mirrorPullRequest,
      'EDITORS_CLOSURE_MIRROR_RECEIPT_MISMATCH');
    return proof;
  };
  const firstProof = verifyReceipt(first, mirror.receipt, chain[18]);
  check(same(firstProof, verifyReceipt(recheck, mirror.verifiedCheckReceipt, chain[25])), 'EDITORS_CLOSURE_MIRROR_RECEIPT_MISMATCH');
  return mirror;
}

export function editorsProductionValidationClosureResult({ evidenceDigest, closureRunId }) {
  check(isDigest(evidenceDigest) && positiveId(closureRunId), 'EDITORS_CLOSURE_EVIDENCE_MISMATCH');
  return { operationId, outcome: editorsClosureOutcome, closureRunId, evidenceDigest, originalHead: original.oldHead,
    originalRunId: original.originalRunId, continuationRunId: original.continuationRunId,
    approvalReceiptIds: [originalApprovalReceiptId, continuedApprovalReceiptId],
    stagedDeploymentId: original.stagedDeploymentId, salesforceFingerprint: original.fingerprint,
    salesforceSourceTreeHash: original.sourceTreeHash, mirrorRequestId: original.mirrorRequestId,
    mirrorReceiptId: original.mirrorReceiptId, mirrorCommit: original.mirrorCommit,
    deveeValidationJobId: original.deveeValidationJobId, deveeDeploymentJobId: original.deveeDeploymentJobId,
    qatValidationJobId: original.qatValidationJobId, qatDeploymentJobId: original.qatDeploymentJobId,
    productionValidationJobId: original.productionValidationJobId, productionDeploySubmitted: false, promotionSubmitted: false };
}

export function verifyStoppedEditorsProductionValidation({ originalAttempt, continuedAttempt, records, requests }) {
  const goLive = verifyHistoricalAttempt(originalAttempt, { runId: original.originalRunId, mode: 'release', conclusion: 'cancelled',
    jobIds: [136579609717, 136583344538, 136587464377] });
  const continuation = verifyHistoricalAttempt(continuedAttempt, { runId: original.continuationRunId, mode: 'resume', conclusion: 'failure',
    jobIds: [136683213619, 136683430049, 136683912866] });
  check(date(goLive.completed_at) < date(continuedAttempt.run.created_at), 'EDITORS_CLOSURE_ORIGINAL_RUN_ORDER_MISMATCH');
  const own = records.filter(row => row.payload?.releaseId === original.releaseId);
  const chain = validateChain(own, original.manifestHash, original.releaseId);
  check(chain.length === own.length && [historyIds.length, historyIds.length + 1].includes(chain.length)
    && chain.every(row => row.sha === original.candidate && row.ref === original.candidate
      && row.environment === journalEnvironment && row.task === 'fcos-release-journal')
    && historyIds.every((id, index) => chain[index].id === id && chain[index].payload.event === historyEvents[index]
      && isWorkflow(chain[index].creator))
    && chain[27].payload.recordHash === original.originalHead && chain[35].payload.recordHash === original.oldHead,
  'EDITORS_CLOSURE_JOURNAL_MISMATCH');
  const manifest = chain[0].payload.data.manifest;
  const plan = manifest?.prerequisites?.plan;
  check(validateManifest(manifest) === original.manifestHash && manifest.candidate.sha === original.candidate
    && manifest.controllerSha === original.controller && manifest.selection.salesforce && !manifest.selection.database
    && plan.salesforceFingerprint === original.fingerprint && plan.salesforceSourceTreeHash === original.sourceTreeHash,
  'EDITORS_CLOSURE_MANIFEST_MISMATCH');
  const staged = readLocalMirrorStage(chain[3], { manifest, workflowActorId: original.workflowActorId });
  check(staged.id === original.stagedDeploymentId && staged.artifactDigest === original.stagedArtifactDigest,
    'EDITORS_CLOSURE_STAGE_MISMATCH');
  assertSmokeProof(chain[4].payload.data, manifest, staged);
  for (const [row, attempt, job] of [[chain[5], originalAttempt, goLive], [chain[28], continuedAttempt, continuation]]) {
    const time = date(row.created_at);
    const approval = assertAuthorization(row.payload.data, manifest, staged, time);
    check(approval.runId === attempt.run.id && approval.approvedAt === attempt.run.created_at
      && date(job.started_at) <= time && time <= date(job.completed_at), 'EDITORS_CLOSURE_APPROVAL_BINDING_MISMATCH');
  }
  const request = { candidateSha: original.candidate, planDigest: digest(manifest.prerequisites) };
  const intent = chain[6].payload.data;
  check(same(intent, { operationId, request, requestHash: digest(request) })
    && chain[27].payload.data.outcome === 'pending' && same(chain[27].payload.data.job, chain[33].payload.data.job)
    && date(chain[27].created_at) <= date(goLive.completed_at) && date(chain[33].created_at) >= date(continuation.started_at)
    && date(chain[35].created_at) <= date(continuation.completed_at)
    && chain[35].payload.data.code === 'UNCLASSIFIED_RELEASE_OBSTACLE', 'EDITORS_CLOSURE_PREREQUISITE_BOUNDARY_MISMATCH');
  const checkpoints = historicalCheckpoints(chain);
  const mirror = verifyMirrorHistory({ requests, chain, goLive, continuation });
  const pending = pendingOperations(chain);
  const receipt = chain[historyIds.length];
  if (receipt) {
    check(pending.length === 0 && isEditorsClosureOwner(receipt.creator) && receipt.payload.event === 'prerequisites.result'
      && receipt.payload.previousHash === original.oldHead && date(receipt.created_at) >= date(continuation.completed_at)
      && same(receipt.payload.data, editorsProductionValidationClosureResult(receipt.payload.data)), 'EDITORS_CLOSURE_RECEIPT_MISMATCH');
  } else {
    check(pending.length === 1 && pending[0].event === 'prerequisites.intent' && same(pending[0].data, intent),
      'EDITORS_CLOSURE_PENDING_SCOPE_MISMATCH');
  }
  return { manifest, receipt, staged, checkpoints, mirror };
}

function readAttempt(github, id) {
  const runPath = `${repoPath}/actions/runs/${id}`;
  return Promise.all([github.read(runPath), github.read(runPath + '/attempts/1/jobs?per_page=100'), github.read(runPath + '/approvals')])
    .then(([run, jobs, approvals]) => ({ run, jobs, approvals }));
}

async function verifyNativeClosureRun(github, receipt) {
  const { run, jobs, approvals } = await readAttempt(github, receipt.payload.data.closureRunId);
  const job = jobs?.jobs?.[0];
  check(isTargetRun(run) && run.id === receipt.payload.data.closureRunId && run.status === 'completed' && run.conclusion === 'success'
    && nativeWorkflowPath(run) === editorsClosureWorkflow && run.display_title === editorsClosureTitle && isSha(run.head_sha)
    && jobs.total_count === 1 && jobs.jobs.length === 1 && job?.name === editorsClosureJob && job.run_id === run.id && job.run_attempt === 1
    && job.status === 'completed' && job.conclusion === 'success'
    && date(job.started_at) <= date(receipt.created_at) && date(receipt.created_at) <= date(job.completed_at),
  'EDITORS_CLOSURE_NATIVE_RECEIPT_RUN_MISMATCH');
  assertEditorsClosureApproval(approvals);
}

export async function readStoppedEditorsProductionValidation({ github, currentClosureRunId }) {
  const [originalAttempt, continuedAttempt, records, requests] = await Promise.all([
    readAttempt(github, original.originalRunId), readAttempt(github, original.continuationRunId),
    github.pages(`${repoPath}/deployments?environment=${journalEnvironment}&sha=${original.candidate}&per_page=100`),
    readLocalMirrorDeployments(github, original.candidate),
    assertFrozenWorkflow({ github, controllerSha: original.controller, dispatcherSha: original.dispatcher }),
  ]);
  const closure = verifyStoppedEditorsProductionValidation({ originalAttempt, continuedAttempt, records, requests });
  if (closure.receipt && closure.receipt.payload.data.closureRunId !== currentClosureRunId) {
    await verifyNativeClosureRun(github, closure.receipt);
  }
  return closure;
}
