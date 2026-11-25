import { digest, requireCondition as check, validateManifest } from './contract.mjs';
import { pendingOperations, validateChain } from './journal.mjs';
import { nativeWorkflowPath } from './providers.mjs';

export const originalKoreaDeskRun = Object.freeze({
  "runId": 45565625886,
  "attempt": 2,
  "actorId": 265701760,
  "repositoryId": 1278654816,
  "workflowActorId": 41898282,
  "handoverId": 8050766310,
  "dispatcher": "5b74503a9419f7532719ac925dc1a509488349ab",
  "candidate": "c5d547ed27991afdece13680515d975fcf5146fb",
  "controller": "d144d9feb6b00c5fbdae02194428fe16b706a376",
  "manifestHash": "86735b077ee3222b6aab7ab1f2574b3f4cd1100cf37fbccd44055b0ed5be7b43",
  "releaseId": "korea-desk-atomic-stem-maintenance-c5d547ed",
  "oldHead": "47b9e8126c40490fec91504b6b0800a046d8a7ebd11a21995b343786bc640c13",
  "fingerprint": "9891624f3ae092acc432a0273c2eb3a79238f5f6f85f41e5507002aba39b43f0",
  "validationId": "0AfHF000007KDgE0AW",
  "deployId": "0AfHF000007KK3N0AW",
  "restorationId": "0AfHF000007KIxe0AG",
  "validationReceiptId": 8051239532,
  "deploymentReceiptId": 8051253648
});
const original = originalKoreaDeskRun;
const expectedRecords = [
  [8050836724, "release.prepared"],
  [8050837008, "build.passed"],
  [8050841028, "stage.intent"],
  [8050842357, "stage.result"],
  [8050944214, "smoke.passed"],
  [8050996040, "approval.accepted"],
  [8051000201, "prerequisites.intent"],
  [8051000679, "obstacle.detected"],
  [8051180146, "salesforce.checkpoint"],
  [8051188855, "salesforce.checkpoint"],
  [8051199076, "salesforce.checkpoint"],
  [8051212028, "salesforce.checkpoint"],
  [8051212852, "salesforce.checkpoint"],
  [8051239532, "salesforce.checkpoint"],
  [8051250858, "salesforce.checkpoint"],
  [8051251595, "salesforce.checkpoint"],
  [8051253648, "salesforce.checkpoint"],
  [8051260399, "salesforce.checkpoint"],
];

export function verifyStoppedKoreaDeskClosure({ run, jobs, approvals, records, requests }) {
  check(run?.id === original.runId && run.run_attempt === original.attempt && run.status === 'completed' && run.conclusion === 'failure'
    && run.actor?.id === original.actorId && run.triggering_actor?.id === original.actorId
    && run.repository?.id === original.repositoryId && run.head_sha === original.dispatcher
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml',
  'KOREA_MAINTENANCE_CLOSURE_ORIGINAL_RUN_MISMATCH');
  const goLive = jobs?.jobs?.filter(job=>job.name==='go-live' && job.run_attempt === original.attempt);
  check(goLive?.length === 1 && goLive[0].run_id === run.id && goLive[0].run_attempt === original.attempt
    && goLive[0].status === 'completed' && goLive[0].conclusion === 'failure',
  'KOREA_MAINTENANCE_CLOSURE_ORIGINAL_JOB_MISMATCH');

  const comment = 'Codex submitted the user’s exact approval from this chat for run 45565625886, attempt 2, commit c5d547ed and verified deployment dpl_CL95bmxryVUqku5Eq8guv8Bsa3qa.';
  check(Array.isArray(approvals) && approvals.filter(review => review.state === 'approved' && review.comment === comment
    && review.user?.id === original.actorId && review.user.login === 'hocheunglai-oss'
    && review.environments?.some(environment => environment.id === 23178773471
      && environment.name === 'fcos-production-release')).length === 1,
  'KOREA_MAINTENANCE_CLOSURE_ORIGINAL_APPROVAL_MISMATCH');
  const own = records.filter(record => record.payload?.releaseId === original.releaseId);
  const chain = validateChain(own,original.manifestHash,original.releaseId);
  check(chain.length === own.length && (chain.length === expectedRecords.length || chain.length === expectedRecords.length + 1),
    'KOREA_MAINTENANCE_CLOSURE_JOURNAL_LENGTH_MISMATCH');
  check(expectedRecords.every(([id,event],index) => {
    const row = chain[index];
    return row.id === id && row.payload.event === event && row.sha === original.candidate
      && row.creator?.id === original.workflowActorId && row.creator.login === 'github-actions[bot]';
  }) && chain[17].payload.recordHash === original.oldHead, 'KOREA_MAINTENANCE_CLOSURE_JOURNAL_CHANGED');
  const manifest = chain[0].payload.data.manifest;
  check(validateManifest(manifest) === original.manifestHash && manifest.controllerSha === original.controller
    && manifest.candidate.sha === original.candidate && manifest.prerequisites.plan.salesforceFingerprint === original.fingerprint,
  'KOREA_MAINTENANCE_CLOSURE_MANIFEST_MISMATCH');
  const approval = chain[5].payload.data;
  check(approval.runId === original.runId && approval.nativeReviewVerified === true && approval.reviewer === 'hocheunglai-oss'
    && approval.manifestHash === original.manifestHash, 'KOREA_MAINTENANCE_CLOSURE_ORIGINAL_APPROVAL_MISMATCH');
  const intent = chain[6].payload.data;
  const validation = chain.find(row=>row.id===original.validationReceiptId).payload.data;
  const deployment = chain.find(row=>row.id===original.deploymentReceiptId).payload.data;
  check(intent.operationId === original.releaseId + '-prerequisites'
    && validation.stage === 'devee' && validation.operation === 'validation' && validation.outcome === 'resolved'
    && validation.job?.id === original.validationId && deployment.stage === 'devee' && deployment.operation === 'deployment'
    && deployment.outcome === 'resolved' && deployment.job?.id === original.deployId && deployment.job.validationId === original.validationId
    && chain[17].payload.data.operation === 'restoration-checkpoint'
    && chain[7].payload.data.code === 'UNCLASSIFIED_RELEASE_OBSTACLE', 'KOREA_MAINTENANCE_CLOSURE_ORIGINAL_EFFECT_MISMATCH');

  check(!requests.some(row => row.payload?.manifestHash === original.manifestHash
    && row.payload?.runId === original.runId), 'KOREA_MAINTENANCE_CLOSURE_HANDOFF_HISTORY_CHANGED');
  const pending = pendingOperations(chain);
  const receipt = chain[18];
  if (receipt) {
    check(pending.length === 0 && receipt.creator?.id === original.actorId && receipt.creator.login === 'hocheunglai-oss'
      && receipt.payload.event === 'prerequisites.result' && receipt.payload.previousHash === original.oldHead
      && digest(receipt.payload.data) === digest(koreaDeskClosureResult(receipt.payload.data.evidenceDigest)),
    'KOREA_MAINTENANCE_CLOSURE_RECEIPT_MISMATCH');
  } else {
    check(pending.length === 1 && pending[0].event === 'prerequisites.intent' && pending[0].data.operationId === intent.operationId,
      'KOREA_MAINTENANCE_CLOSURE_PENDING_SCOPE_MISMATCH');
  }
  return { manifest, receipt, staged:chain[3].payload.data.result };
}

export function koreaDeskClosureResult(evidenceDigest) {
  check(typeof evidenceDigest === 'string' && /^[0-9a-f]{64}$/u.test(evidenceDigest), 'KOREA_MAINTENANCE_CLOSURE_EVIDENCE_MISMATCH');
  return { operationId:original.releaseId + '-prerequisites', outcome:'devee_restored_mirror_not_published',
    originalRunId:original.runId, salesforceFingerprint:original.fingerprint,
    deveeCheckpoints:[original.validationReceiptId, original.deploymentReceiptId], restorationId:original.restorationId, evidenceDigest };
}
