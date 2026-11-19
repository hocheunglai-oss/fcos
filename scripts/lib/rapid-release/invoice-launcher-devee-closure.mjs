import { digest, requireCondition as check, validateManifest } from './contract.mjs';
import { pendingOperations, validateChain } from './journal.mjs';
import { nativeWorkflowPath } from './providers.mjs';

export const originalInvoiceRun = Object.freeze({
  runId: 44541403747, actorId: 265701760, repositoryId: 1278654816, workflowActorId: 41898282,
  handoverId: 7915472399, dispatcher: '38ff6abebf634d0eee0bcfc0b551ec9c8eb57fd7',
  candidate: '79bc7db6f4140db2550d390b725409cfde733af0',
  controller: '9e5862f72ea2eb433a18043e651034eb8a16f6fd',
  manifestHash: 'bb830532de3b029888e902273d2f5335a25b6a45fe5e91df7e722682177c51bd',
  releaseId: 'rapid-79bc7db6f414-mwnkuxo7',
  oldHead: 'aa9384cc8b1f4fdafdbb692116ec9d95d0bd6e1659d8380c9da7c28601eae7a1',
  fingerprint: '6488dcebc6095c1c21cfffe53e192edff1dd6bb17ac2f0591bec1d64c0978502',
  validationId: '0AfHF000007IeZF0A0', deployId: '0AfHF000007Iefh0AC',
  validationReceiptId: 7917513839, deploymentReceiptId: 7917542647,
});
const original = originalInvoiceRun;
const expectedRecords = [
  [7915658787,'release.prepared'], [7915659130,'build.passed'], [7915664316,'stage.intent'],
  [7915667260,'stage.result'], [7915823497,'smoke.passed'], [7917394780,'approval.accepted'],
  [7917400444,'prerequisites.intent'], ...[7917431958,7917449950,7917469286,7917497224,
    7917499182,7917513839,7917538544,7917539527,7917542647,7917553220].map(id=>[id,'salesforce.checkpoint']),
  [7917553561,'obstacle.detected'],
];

export function verifyStoppedInvoiceClosure({ run, jobs, approvals, records, requests }) {
  check(run?.id === original.runId && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'failure'
    && run.actor?.id === original.actorId && run.triggering_actor?.id === original.actorId
    && run.repository?.id === original.repositoryId && run.head_sha === original.dispatcher
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml',
  'INVOICE_CLOSURE_ORIGINAL_RUN_MISMATCH');
  const goLive = jobs?.jobs?.filter(job=>job.name==='go-live');
  check(goLive?.length === 1 && goLive[0].run_id === run.id && goLive[0].run_attempt === 1
    && goLive[0].status === 'completed' && goLive[0].conclusion === 'failure',
  'INVOICE_CLOSURE_ORIGINAL_JOB_MISMATCH');

  check(Array.isArray(approvals) && approvals.filter(review => review.state === 'approved'
    && review.user?.id === original.actorId && review.user.login === 'hocheunglai-oss'
    && review.environments?.some(environment => environment.id === 23178773471
      && environment.name === 'fcos-production-release')).length === 1,
  'INVOICE_CLOSURE_ORIGINAL_APPROVAL_MISMATCH');
  const own = records.filter(record => record.payload?.releaseId === original.releaseId);
  const chain = validateChain(own,original.manifestHash,original.releaseId);
  check(chain.length === own.length && (chain.length === expectedRecords.length || chain.length === expectedRecords.length + 1),
    'INVOICE_CLOSURE_JOURNAL_LENGTH_MISMATCH');
  check(expectedRecords.every(([id,event],index) => {
    const row = chain[index];
    return row.id === id && row.payload.event === event && row.sha === original.candidate
      && row.creator?.id === original.workflowActorId && row.creator.login === 'github-actions[bot]';
  }) && chain[17].payload.recordHash === original.oldHead, 'INVOICE_CLOSURE_JOURNAL_CHANGED');
  const manifest = chain[0].payload.data.manifest;
  check(validateManifest(manifest) === original.manifestHash && manifest.controllerSha === original.controller
    && manifest.candidate.sha === original.candidate && manifest.prerequisites.plan.salesforceFingerprint === original.fingerprint,
  'INVOICE_CLOSURE_MANIFEST_MISMATCH');
  const approval = chain[5].payload.data;
  check(approval.runId === original.runId && approval.nativeReviewVerified === true && approval.reviewer === 'hocheunglai-oss'
    && approval.manifestHash === original.manifestHash, 'INVOICE_CLOSURE_ORIGINAL_APPROVAL_MISMATCH');
  const intent = chain[6].payload.data;
  const validation = chain[12].payload.data;
  const deployment = chain[15].payload.data;
  check(intent.operationId === original.releaseId + '-prerequisites'
    && validation.stage === 'devee' && validation.operation === 'validation' && validation.outcome === 'resolved'
    && validation.job?.id === original.validationId && deployment.stage === 'devee' && deployment.operation === 'deployment'
    && deployment.outcome === 'resolved' && deployment.job?.id === original.deployId && deployment.job.validationId === original.validationId
    && chain[16].payload.data.operation === 'restoration-checkpoint'
    && chain[17].payload.data.code === 'UNCLASSIFIED_RELEASE_OBSTACLE', 'INVOICE_CLOSURE_ORIGINAL_EFFECT_MISMATCH');

  check(!requests.some(row => row.payload?.manifestHash === original.manifestHash
    && row.payload?.runId === original.runId), 'INVOICE_CLOSURE_HANDOFF_HISTORY_CHANGED');
  const pending = pendingOperations(chain);
  const receipt = chain[18];
  if (receipt) {
    check(pending.length === 0 && receipt.creator?.id === original.actorId && receipt.creator.login === 'hocheunglai-oss'
      && receipt.payload.event === 'prerequisites.result' && receipt.payload.previousHash === original.oldHead
      && digest(receipt.payload.data) === digest(invoiceClosureResult(receipt.payload.data.evidenceDigest)),
    'INVOICE_CLOSURE_RECEIPT_MISMATCH');
  } else {
    check(pending.length === 1 && pending[0].event === 'prerequisites.intent' && pending[0].data.operationId === intent.operationId,
      'INVOICE_CLOSURE_PENDING_SCOPE_MISMATCH');
  }
  return { manifest, receipt, staged:chain[3].payload.data.result };
}

export function invoiceClosureResult(evidenceDigest) {
  check(typeof evidenceDigest === 'string' && /^[0-9a-f]{64}$/u.test(evidenceDigest), 'INVOICE_CLOSURE_EVIDENCE_MISMATCH');
  return { operationId:original.releaseId + '-prerequisites', outcome:'devee_verified_mirror_not_published',
    originalRunId:original.runId, salesforceFingerprint:original.fingerprint,
    deveeCheckpoints:[original.validationReceiptId, original.deploymentReceiptId], evidenceDigest };
}
