import { assertAuthorization, digest, requireCondition as check, targets, validateManifest } from './contract.mjs';
import { assertSmokeProof } from './engine.mjs';
import { DeploymentJournal, pendingOperations } from './journal.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';
import { verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';

const ownerId = 265701760;
const workflowActorId = 41898282;
export const koreaDeskOriginal = Object.freeze({
  runId: 45454505129, jobId: 138669893839, candidate: '528459f39ef9a6e17b39379432a6716cc7449739',
  manifestHash: '1b889041f70c1f909dd2e205b416968cc09fa3716839a73d1a199dfa5b428000',
  releaseId: 'korea-desk-salesforce-qat-fixture-528459f3-binding',
  controller: 'bc9cc9219e012849fe139b2d9e750e3beb4ba449', dispatcher: '2a703e6c7cd3c532e69cfaa87346d4c89e648581',
  head: 'e6129551cbfd601e93e608fbb183fe07bd126551601b1401945e17765e2f81b6',
  mirrorReceiptId: 8037212722, mirrorRequestId: 8037175270,
  mirrorCommit: '819ee9bf6313fe198ee917b07ac23e339b62a9f0', mirrorPullRequest: 9,
});

const operations = [
  [8036885273, 'devee', 'bootstrap', '0AfHF000007KAgj0AG'],
  [8037109114, 'devee', 'validation', '0AfHF000007KA0o0AG'],
  [8037138771, 'devee', 'deployment', '0AfHF000007KAlZ0AW', '0AfHF000007KA0o0AG'],
  [8037250487, 'qat', 'bootstrap', '0AfBh000006mXKnKAM'],
  [8037532265, 'qat', 'validation', '0AfBh000006mWYQKA2'],
  [8037562681, 'qat', 'deployment', '0AfBh000006mXavKAE', '0AfBh000006mWYQKA2'],
  [8037669609, 'production', 'bootstrap', '0Affu000001BfKDCA0'],
];
const permissions = [
  [8036907160, 'devee', 'FCOS_Korea_Desk_Editor'], [8036910228, 'devee', 'FCOS_Korea_Desk_Reader'],
  [8037268867, 'qat', 'FCOS_Korea_Desk_Editor'], [8037272199, 'qat', 'FCOS_Korea_Desk_Reader'],
];
const isOwner = user => user?.id === ownerId && user.login === targets().account;
const isDigest = value => /^[a-f0-9]{64}$/u.test(value || '');
const same = (a, b) => digest(a) === digest(b);
const data = row => row.payload.data;

export async function readKoreaDeskBuyerHistoryBoundary({ github, requireReceipt }) {
  const old = koreaDeskOriginal;
  const repo = '/repos/' + targets().repository;
  const runPath = repo + '/actions/runs/' + old.runId;
  const journal = new DeploymentJournal({ github: Object.assign(Object.create(github), { candidateSha: old.candidate }),
    actorIds: [workflowActorId, ownerId], releaseId: old.releaseId, manifestHash: old.manifestHash });
  const [run, jobs, approvals, chain, mirrorReceipt, mirrorRequest] = await Promise.all([
    github.read(runPath), github.read(runPath + '/attempts/1/jobs?per_page=100'), github.read(runPath + '/approvals'),
    journal.read(), github.read(repo + '/deployments/' + old.mirrorReceiptId), github.read(repo + '/deployments/' + old.mirrorRequestId),
    assertFrozenWorkflow({ github, controllerSha: old.controller, dispatcherSha: old.dispatcher }),
  ]);
  check(run.id === old.runId && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'failure'
    && run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.head_sha === old.dispatcher
    && run.repository?.id === 1278654816 && isOwner(run.actor) && isOwner(run.triggering_actor)
    && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && run.display_title === 'FCOS rapid release ' + old.manifestHash + ' ' + old.candidate,
  'KOREA_BUYER_HISTORY_ORIGINAL_RUN_CHANGED');
  const goLive = jobs.jobs?.find(job => job.name === 'go-live');
  check(jobs.total_count === 3 && jobs.jobs.length === 3 && goLive?.id === old.jobId
    && goLive.run_id === old.runId && goLive.run_attempt === 1
    && goLive?.status === 'completed' && goLive?.conclusion === 'failure'
    && ['quality', 'stage-and-smoke'].every(name => jobs.jobs.some(job => job.name === name && job.conclusion === 'success')),
  'KOREA_BUYER_HISTORY_ORIGINAL_JOB_CHANGED');
  check(approvals.filter(review => review.state === 'approved' && isOwner(review.user)
    && review.environments?.some(environment => environment.id === 23178773471 && environment.name === 'fcos-production-release')).length === 1,
  'KOREA_BUYER_HISTORY_ORIGINAL_APPROVAL_CHANGED');
  const prefix = chain.slice(0, 45);
  check(prefix.length === 45 && prefix.every(row => row.creator?.id === workflowActorId)
    && prefix.at(-1).id === 8037681058 && prefix.at(-1).payload.recordHash === old.head
    && prefix.at(-2).id === 8037680534 && prefix[6].id === 8036815476,
  'KOREA_BUYER_HISTORY_ORIGINAL_JOURNAL_CHANGED');
  const event = (id, name) => {
    const row = prefix.find(item => item.id === id);
    check(row?.payload.event === name, 'KOREA_BUYER_HISTORY_ORIGINAL_JOURNAL_CHANGED');
    return row;
  };
  const manifest = data(event(8036531495, 'release.prepared')).manifest;
  check(validateManifest(manifest) === old.manifestHash && manifest.candidate.sha === old.candidate
    && manifest.controllerSha === old.controller && manifest.selection.salesforce === true
    && manifest.selection.database === false && manifest.authorization.financialAuthority === false,
  'KOREA_BUYER_HISTORY_ORIGINAL_MANIFEST_CHANGED');
  const staged = data(event(8036541349, 'stage.result')).result;
  assertSmokeProof(data(event(8036703792, 'smoke.passed')), manifest, staged);
  const approval = data(event(8036808999, 'approval.accepted'));
  check(approval.runId === old.runId, 'KOREA_BUYER_HISTORY_ORIGINAL_APPROVAL_CHANGED');
  assertAuthorization(approval, manifest, staged, Date.parse(prefix[6].created_at));
  check(same(pendingOperations(prefix), [{ event: 'prerequisites.intent', data: data(prefix[6]) }]),
    'KOREA_BUYER_HISTORY_ORIGINAL_PENDING_CHANGED');
  const fingerprint = manifest.prerequisites.plan.salesforceFingerprint;
  const checkpoint = (id, stage, operation) => {
    const row = event(id, 'salesforce.checkpoint');
    const value = data(row);
    check(value.stage === stage && value.operation === operation && value.fingerprint === fingerprint
      && value.outcome === 'resolved' && isDigest(value.evidenceDigest), 'KOREA_BUYER_HISTORY_ORIGINAL_CHECKPOINT_CHANGED');
    return row;
  };
  const salesforceOperations = operations.map(([id, stage, operation, jobId, validationId = null]) => {
    const resolved = checkpoint(id, stage, operation), job = data(resolved).job;
    check(job?.id === jobId && job.validationId === validationId
      && (operation === 'deployment' || isDigest(job.packageSha256)), 'KOREA_BUYER_HISTORY_ORIGINAL_SALESFORCE_JOB_CHANGED');
    return { stage, operation, resolved, job };
  });
  const permissionReceipts = permissions.map(([id, stage, name]) => checkpoint(id, stage, 'permission:' + name));
  check(!prefix.some(row => row.payload.event.startsWith('promote.') || row.payload.event === 'prerequisites.passed'
    || row.payload.event === 'salesforce.checkpoint' && data(row).stage === 'production'
      && !['inventory-checkpoint', 'preparation', 'bootstrap', 'restoration-checkpoint'].includes(data(row).operation)),
  'KOREA_BUYER_HISTORY_ORIGINAL_PRODUCTION_CHANGED');
  const mirrorCheckpoint = checkpoint(8037221438, 'shared_mirror', 'publication');
  const mirror = data(mirrorCheckpoint).mirror;
  const request = mirrorRequest.payload, receipt = mirrorReceipt.payload;
  check(mirrorRequest.id === old.mirrorRequestId && mirrorRequest.creator?.id === workflowActorId
    && request?.kind === 'fcos_local_mirror_request' && request.mode === 'publish' && request.manifestHash === old.manifestHash
    && request.fingerprint === fingerprint && request.runId === old.runId && request.candidateSha === old.candidate
    && mirrorReceipt.id === old.mirrorReceiptId && isOwner(mirrorReceipt.creator)
    && receipt?.kind === 'fcos_local_mirror_receipt' && receipt.requestId === mirrorRequest.id
    && receipt.proofDigest === digest(receipt.proof) && receipt.proof?.commit === old.mirrorCommit
    && mirror.commit === old.mirrorCommit && mirror.pullRequest === old.mirrorPullRequest
    && same(data(checkpoint(8037626279, 'shared_mirror', 'publication')).mirror, mirror),
  'KOREA_BUYER_HISTORY_ORIGINAL_MIRROR_CHANGED');
  const closure = chain[45];
  if (requireReceipt) {
    check(chain.length === 46 && closure?.id === requireReceipt && isOwner(closure.creator)
      && closure.payload.event === 'prerequisites.result' && closure.payload.previousHash === old.head
      && data(closure).outcome === 'korea_desk_production_bootstrap_verified_buyer_history_only_pending'
      && data(closure).operationId === data(prefix[6]).operationId && data(closure).originalRunId === old.runId
      && data(closure).trackingScope === 'korea-desk-only' && data(closure).productionBootstrap === salesforceOperations.at(-1).job.id
      && data(closure).mirrorCommit === old.mirrorCommit && isDigest(data(closure).evidenceDigest)
      && pendingOperations(chain).length === 0, 'KOREA_BUYER_HISTORY_CLOSURE_REQUIRED');
  } else {
    check(chain.length === 45, 'KOREA_BUYER_HISTORY_ORIGINAL_CLOSURE_ALREADY_RECORDED');
  }
  return { journal, manifest, staged, closure, intent: data(prefix[6]), salesforceOperations,
    permissions: permissionReceipts, mirror: { receipt: mirrorReceipt, checkpoint: mirrorCheckpoint } };
}

export async function readKoreaDeskBuyerHistoryRecovery({ manifest, github }) {
  const { koreaDeskBuyerHistoryReceiptId: receiptId } = manifest.prerequisites.plan;
  check(Number.isSafeInteger(receiptId) && receiptId > 0, 'KOREA_BUYER_HISTORY_CLOSURE_REQUIRED');
  const recovery = await readKoreaDeskBuyerHistoryBoundary({ github, requireReceipt: receiptId });
  const original = recovery.manifest;
  const candidate = structuredClone(manifest);
  delete candidate.prerequisites.plan.koreaDeskBuyerHistoryReceiptId;
  candidate.controllerSha = original.controllerSha;
  candidate.releaseId = original.releaseId;
  candidate.prerequisites.adapterDigest = original.prerequisites.adapterDigest;
  check(manifest.releaseId !== original.releaseId && manifest.controllerSha !== original.controllerSha
    && validateManifest(candidate) === koreaDeskOriginal.manifestHash, 'KOREA_BUYER_HISTORY_SUCCESSOR_CHANGED');
  return recovery;
}

export function verifyKoreaDeskBuyerHistoryCompletion({ recovery, records, requests, reviewed, manifest, run }) {
  const sequence = row => row.payload.sequence;
  const approved = records.find(row => row.payload.event === 'approval.accepted' && data(row).runId === run.id);
  const prerequisites = records.find(row => row.payload.event === 'prerequisites.passed');
  check(recovery?.closure?.id === manifest.prerequisites.plan.koreaDeskBuyerHistoryReceiptId && approved && prerequisites,
    'KOREA_BUYER_HISTORY_COMPLETION_SCOPE_CHANGED');
  const checkpoints = records.filter(row => row.payload.event === 'salesforce.checkpoint'
    && data(row).fingerprint === reviewed.fingerprint);
  const resolved = (stage, operation) => checkpoints.filter(row =>
    data(row).stage === stage && data(row).operation === operation && data(row).outcome === 'resolved');
  const scopedJob = (stage, operation, expected) => {
    const rows = resolved(stage, operation);
    const job = expected ?? data(rows[0] || { payload: { data: {} } }).job;
    check(job?.id && rows.length && rows.every(row => same(data(row).job, job)),
      'KOREA_BUYER_HISTORY_COMPLETED_JOB_CHANGED');
    return rows.at(-1);
  };
  for (const { stage, operation, job } of recovery.salesforceOperations) scopedJob(stage, operation, job);
  const prodValidation = scopedJob('production', 'validation'), prodDeployment = scopedJob('production', 'deployment');
  check(data(prodDeployment).job.validationId === data(prodValidation).job.id, 'KOREA_BUYER_HISTORY_PRODUCTION_LINK_CHANGED');
  const corrections = ['devee', 'qat', 'production'].map(stage => {
    const rows = resolved(stage, 'buyer-history-correction');
    check(rows.length === 1 && data(rows[0]).job?.id && isDigest(data(rows[0]).job.packageSha256)
      && data(prerequisites).completedOperations?.some(item => item.operationId === `salesforce:${stage}:buyer-history-correction`
        && item.evidenceDigest === data(rows[0]).evidenceDigest && item.verified && item.intentRecorded),
    'KOREA_BUYER_HISTORY_COMPLETED_CORRECTION_REQUIRED');
    const intent = checkpoints.filter(row => data(row).stage === stage && data(row).operation === 'buyer-history-correction'
      && data(row).outcome === 'pending' && data(row).job?.id === null);
    check(intent.length === 1 && sequence(approved) < sequence(intent[0]) && sequence(intent[0]) < sequence(rows[0])
      && data(intent[0]).job.packageSha256 === data(rows[0]).job.packageSha256, 'KOREA_BUYER_HISTORY_CORRECTION_INTENT_CHANGED');
    return rows[0];
  });
  check([...corrections, prodValidation, prodDeployment, prerequisites].every((row, i, list) =>
    i === 0 || sequence(list[i - 1]) < sequence(row)), 'KOREA_BUYER_HISTORY_CORRECTION_ORDER_CHANGED');
  const mirror = data(recovery.mirror.checkpoint).mirror;
  const publications = resolved('shared_mirror', 'publication');
  check(publications.length >= 4 && publications.every(row => same(data(row).mirror, mirror)),
    'KOREA_BUYER_HISTORY_COMPLETED_MIRROR_CHANGED');
  const verified = publications.slice(1).map((publication, index) => {
    const previous = publications[index];
    const matches = requests.filter(row => row.creator?.id === workflowActorId && row.payload?.kind === 'fcos_local_mirror_request'
      && row.payload.manifestHash === digest(manifest) && row.payload.controllerSha === manifest.controllerSha
      && row.payload.runId === run.id && Number.isSafeInteger(row.payload.runAttempt)
      && row.payload.runAttempt > 0 && row.payload.runAttempt <= run.run_attempt && row.payload.mode === 'check'
      && row.payload.intentHash === data(previous).evidenceDigest
      && Date.parse(row.created_at) >= Date.parse(previous.created_at)
      && Date.parse(row.created_at) <= Date.parse(publication.created_at));
    let verifiedCount = 0;
    for (const request of matches) {
      const receipts = requests.filter(row => row.creator?.id === ownerId && row.payload?.kind === 'fcos_local_mirror_receipt'
        && row.payload.requestId === request.id && Date.parse(row.created_at) <= Date.parse(publication.created_at));
      check(receipts.length <= 1, 'KOREA_BUYER_HISTORY_CURRENT_MIRROR_RECEIPT_REQUIRED');
      for (const receipt of receipts) {
        const proof = verifyLocalMirrorReceipt({ request: request.payload, requestDeployment: request,
          receiptDeployment: receipt, reviewed, workflowActorId, publisherId: ownerId, now: Date.parse(receipt.created_at) });
        check(proof.commit === mirror.commit && proof.pullRequest.number === mirror.pullRequest, 'KOREA_BUYER_HISTORY_COMPLETED_MIRROR_CHANGED');
        verifiedCount++;
      }
    }
    check(verifiedCount > 0, 'KOREA_BUYER_HISTORY_CURRENT_MIRROR_RECEIPT_REQUIRED');
    return publication;
  });
  check(verified.some(row => sequence(corrections[0]) < sequence(row) && sequence(row) < sequence(corrections[1]))
    && verified.some(row => sequence(corrections[1]) < sequence(row) && sequence(row) < sequence(corrections[2]))
    && verified.some(row => sequence(prodDeployment) < sequence(row)), 'KOREA_BUYER_HISTORY_COMPLETED_MIRROR_ORDER_CHANGED');
  return { validationId: data(scopedJob('devee', 'validation')).job.id, deploymentId: data(scopedJob('devee', 'deployment')).job.id,
    mirror, productionJob: data(prodDeployment).job };
}
