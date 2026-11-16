import { digest, requireCondition as check, validateManifest } from './contract.mjs';
import { pendingOperations, validateChain } from './journal.mjs';
import { nativeWorkflowPath } from './providers.mjs';

export const originalEditorsRun = Object.freeze({
  runId: 43841507494, actorId: 265701760, repositoryId: 1278654816, workflowActorId: 41898282,
  handoverId: 7817408887, dispatcher: '059fa6dcfb589fa46549d8de86afcec12409cee6',
  candidate: 'c3ec760e0360f7347e04e89a2311650c728c099a',
  controller: '5686a6c1f307e06ca15db72cdbd6d533a858d449',
  manifestHash: '2807821da3243f81222f8ef1de419f4ac639e5faa127386732f4d24317ec2e3c',
  releaseId: 'editors-c3ec760e-invoice-approval',
  oldHead: 'd1802160693569ed19f557e16b14cd7a7a920926c07bdd8e28fe1434cfdb950e',
  fingerprint: 'ac54d30c31d716d55470c402d5c0b1fe33210319e8672f96999151026ab4d7f7',
  validationId: '0AfHF000007HM050AG', deployId: '0AfHF000007HMPt0AO', desktopRequestId: 7821007842,
});
const original = originalEditorsRun;
const expectedRecords = [
  [7820423259,'release.prepared'], [7820423569,'build.passed'], [7820427490,'stage.intent'],
  [7820429608,'stage.result'], [7820552280,'smoke.passed'], [7820671485,'approval.accepted'],
  [7820675329,'prerequisites.intent'], ...[7820695491,7820707178,7820719206,7820737112,
    7820738281,7820932858,7820950849,7820952077,7820996993,7821219325].map(id=>[id,'salesforce.checkpoint']),
  [7821219713,'obstacle.detected'],
];

export function verifyStoppedEditorsClosure({ run, jobs, records, requests }) {
  check(run?.id === original.runId && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'failure'
    && run.actor?.id === original.actorId && run.triggering_actor?.id === original.actorId
    && run.repository?.id === original.repositoryId && run.head_sha === original.dispatcher
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml',
  'EDITORS_CLOSURE_ORIGINAL_RUN_MISMATCH');
  const goLive = jobs?.jobs?.filter(job=>job.name==='go-live');
  check(goLive?.length === 1 && goLive[0].run_id === run.id && goLive[0].run_attempt === 1
    && goLive[0].status === 'completed' && goLive[0].conclusion === 'failure',
  'EDITORS_CLOSURE_ORIGINAL_JOB_MISMATCH');

  const own = records.filter(record => record.payload?.releaseId === original.releaseId);
  const chain = validateChain(own,original.manifestHash,original.releaseId);
  check(chain.length === own.length && (chain.length === expectedRecords.length || chain.length === expectedRecords.length + 1),
    'EDITORS_CLOSURE_JOURNAL_LENGTH_MISMATCH');
  check(expectedRecords.every(([id,event],index) => {
    const row = chain[index];
    return row.id === id && row.payload.event === event && row.sha === original.candidate
      && row.creator?.id === original.workflowActorId && row.creator.login === 'github-actions[bot]';
  }) && chain[17].payload.recordHash === original.oldHead, 'EDITORS_CLOSURE_JOURNAL_CHANGED');
  const manifest = chain[0].payload.data.manifest;
  check(validateManifest(manifest) === original.manifestHash && manifest.controllerSha === original.controller
    && manifest.candidate.sha === original.candidate && manifest.prerequisites.plan.salesforceFingerprint === original.fingerprint,
  'EDITORS_CLOSURE_MANIFEST_MISMATCH');
  const approval = chain[5].payload.data;
  check(approval.runId === original.runId && approval.nativeReviewVerified === true && approval.reviewer === 'hocheunglai-oss'
    && approval.manifestHash === original.manifestHash, 'EDITORS_CLOSURE_ORIGINAL_APPROVAL_MISMATCH');
  const intent = chain[6].payload.data;
  const validation = chain[12].payload.data;
  const deployment = chain[15].payload.data;
  check(intent.operationId === original.releaseId + '-prerequisites'
    && validation.stage === 'devee' && validation.operation === 'validation' && validation.outcome === 'resolved'
    && validation.job?.id === original.validationId && deployment.stage === 'devee' && deployment.operation === 'deployment'
    && deployment.outcome === 'resolved' && deployment.job?.id === original.deployId && deployment.job.validationId === original.validationId
    && chain[16].payload.data.operation === 'restoration-checkpoint'
    && chain[17].payload.data.code === 'DEVEE_DESKTOP_EVIDENCE_WINDOW_ENDED', 'EDITORS_CLOSURE_ORIGINAL_EFFECT_MISMATCH');

  check(requests.length === 1, 'EDITORS_CLOSURE_HANDOFF_HISTORY_CHANGED');
  const [request] = requests;
  const p = request.payload;
  check(request.id === original.desktopRequestId && request.sha === original.candidate
    && request.creator?.id === original.workflowActorId && p?.kind === 'fcos_devee_desktop_request'
    && p.runId === original.runId && p.runAttempt === 1 && p.manifestHash === original.manifestHash
    && p.deploymentJobId === original.deployId && p.validationJobId === original.validationId
    && Date.parse(request.created_at) < Date.parse(p.expiresAt) && Date.parse(p.expiresAt) <= Date.parse(goLive[0].completed_at),
  'EDITORS_CLOSURE_EXPIRED_DESKTOP_REQUEST_MISMATCH');
  const pending = pendingOperations(chain);
  const receipt = chain[18];
  if (receipt) {
    check(pending.length === 0 && receipt.creator?.id === original.actorId && receipt.creator.login === 'hocheunglai-oss'
      && receipt.payload.event === 'prerequisites.result' && receipt.payload.previousHash === original.oldHead
      && digest(receipt.payload.data) === digest(editorsClosureResult(receipt.payload.data.evidenceDigest)),
    'EDITORS_CLOSURE_RECEIPT_MISMATCH');
  } else {
    check(pending.length === 1 && pending[0].event === 'prerequisites.intent' && pending[0].data.operationId === intent.operationId,
      'EDITORS_CLOSURE_PENDING_SCOPE_MISMATCH');
  }
  return { manifest, receipt, staged:chain[3].payload.data.result, desktopRequestDigest:digest(p) };
}

export function editorsClosureResult(evidenceDigest) {
  check(typeof evidenceDigest === 'string' && /^[0-9a-f]{64}$/u.test(evidenceDigest), 'EDITORS_CLOSURE_EVIDENCE_MISMATCH');
  return { operationId:original.releaseId + '-prerequisites', outcome:'editors_devee_retained_no_production_effect',
    originalRunId:original.runId, originalDesktopRequestId:original.desktopRequestId,
    originalDeveeValidationId:original.validationId, originalDeveeDeploymentId:original.deployId,
    restorationCheckpointId:7821219325, evidenceDigest, deveeRestorationPending:true };
}
