import { assertAuthorization, digest, isDigest, requireCondition, targets, validateManifest } from './contract.mjs';
import { DeploymentJournal, pendingOperations } from './journal.mjs';
import { assertBuildReceipt, assertSmokeProof } from './engine.mjs';

import { LOCAL_MIRROR_ENVIRONMENT, verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';
import { hasTradingFxSigningLocator, verifyTradingFxSigningConfig } from './trading-fx-signing-config.mjs';

export const TRADING_FX_FAILED_BOOTSTRAP = 'trading_fx_stopped_after_rolled_back_production_bootstrap';

function recordsFor(chain, event) {
  return chain.filter(row => row.payload.event === event);
}

export function failedBootstrapClosure({ chain, manifest, runId, report, inventory, expectedInventoryHash, orgId, mirrorReceipt, databaseClosure }) {
  const manifestHash = validateManifest(manifest);
  const plan = manifest.prerequisites?.plan;
  const [intent, bootstrap, ...other] = pendingOperations(chain);
  const request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
  const [intentRecord, ...otherIntents] = recordsFor(chain, 'prerequisites.intent');
  const [approvalRecord, ...otherApprovals] = recordsFor(chain, 'approval.accepted');
  requireCondition(manifest.prerequisites?.adapter === 'trading-fx-prerequisites'
    && chain.every(row => row.payload.manifestHash === manifestHash && row.payload.releaseId === manifest.releaseId
      && !/^(?:promote\.|live\.|rollback\.|release\.complete|prerequisites\.(?:result|passed|smoke_passed|database_submitting))/u.test(row.payload.event))
    && other.length === 0 && otherIntents.length === 0 && otherApprovals.length === 0
    && intent?.event === 'prerequisites.intent' && intent.data.operationId === manifest.releaseId + '-prerequisites'
    && digest(intent.data.request ?? null) === digest(request) && intent.data.requestHash === digest(request)
    && intentRecord?.creator?.id === 41898282 && approvalRecord?.creator?.id === 41898282
    && approvalRecord?.payload.data.runId === runId
    && [runId, mirrorReceipt, databaseClosure].every(value => Number.isSafeInteger(value) && value > 0),
  'TRADING_FX_FAILED_BOOTSTRAP_ORIGINAL_RELEASE_MISMATCH');
  const original = bootstrap?.data;
  requireCondition(bootstrap?.event === 'salesforce.checkpoint' && original.stage === 'production'
    && original.operation === 'bootstrap' && original.outcome === 'pending' && original.fingerprint === plan.salesforceFingerprint
    && /^0Af[A-Za-z0-9]{15}$/u.test(original.job?.id || '') && isDigest(original.job.packageSha256) && original.job.validationId === null
    && report?.id === original.job.id && report.done === true && report.status === 'Failed'
    && report.checkOnly === false && report.rollbackOnError === true,
  'TRADING_FX_FAILED_BOOTSTRAP_TERMINAL_REPORT_REQUIRED');
  const failures = [report.details?.componentFailures].flat();
  requireCondition(failures.length === 1 && failures[0]?.fullName === 'Fcos_Trading_FX_Setting__c'
    && inventory?.orgId === orgId && inventory.inventoryHash === expectedInventoryHash
    && isDigest(expectedInventoryHash) && isDigest(inventory.evidenceSha256),
  'TRADING_FX_FAILED_BOOTSTRAP_ROLLBACK_PROOF_REQUIRED');

  const evidence = { job: original.job, originalCheckpointDigest: original.evidenceDigest,
    reportDigest: digest(report), inventoryHash: inventory.inventoryHash, inventoryEvidenceDigest: inventory.evidenceSha256,
    orgId, terminalStatus: 'Failed', rollbackOnError: true };
  const evidenceDigest = digest(evidence);
  return {
    expectedPreviousHash: chain.at(-1).payload.recordHash,
    result: { operationId: intent.data.operationId, outcome: TRADING_FX_FAILED_BOOTSTRAP, originalRunId: runId,
      originalIntent: intentRecord.id, approval: approvalRecord.id, mirrorReceipt, databaseClosure,
      salesforceFingerprint: original.fingerprint, bootstrapJob: original.job.id, evidenceDigest },
    checkpoint: { ...original, outcome: 'resolved', terminalOutcome: 'failed_rolled_back', evidenceDigest, evidence },
  };
}

const positiveId = id => Number.isSafeInteger(id) && id > 0;
const same = (left, right) => digest(left ?? null) === digest(right ?? null);

// This frozen bridge admits the reviewed signing and legacy document repair.
// A different application candidate requires independently reviewed evidence.
const reviewedSuccessorSha = '90cbbf0f1786f539037851760b40421ce0fc85d9';
const originalCandidateSha = '085c7ce8663d16d808771acbbcdc981b9d736b85';

const afterManualSuccessorSha = 'b495d1bde6d06834c32212982c4597e20e6c7fe0';
const manualBaseline = {
  sha: 'd2e5f1f94898ae99c6188831d071a77c337f31ae',
  deploymentId: 'dpl_EybnQs2MEgz3z2M2kJH74i9yGw38',
  manifestHash: '98fa7ae01015ef8d4386b0baedee42acb2e016940ee4729138ba06e3e95ac947',
  releaseId: 'manual-on-demand-nomination-qualification',
  runId: 43582562872,
};

export async function verifyTradingFxManualPredecessor({ manifest, previous, github, ownerId, provider }) {
  const live = manifest.previous;
  const hasSigningConfig = hasTradingFxSigningLocator(manifest.prerequisites?.plan);
  requireCondition(manifest.candidate.sha === afterManualSuccessorSha
    && live.sha === manualBaseline.sha && live.deploymentId === manualBaseline.deploymentId
    && live.schemaDigest === previous.previous.schemaDigest
    && (hasSigningConfig || live.configurationDigest === previous.previous.configurationDigest),
  'TRADING_FX_MANUAL_PREDECESSOR_SCOPE_CHANGED');
  const journal = new DeploymentJournal({ github: { ...github, candidateSha: manualBaseline.sha },
    manifestHash: manualBaseline.manifestHash, releaseId: manualBaseline.releaseId, actorIds: [41898282] });
  const records = await journal.read();
  const expectedEvents = ['release.prepared', 'build.passed', 'stage.intent', 'stage.result', 'smoke.passed',
    'approval.accepted', 'promote.intent', 'promote.result', 'live.passed', 'release.complete'];
  requireCondition(same(records.map(row => row.payload.event), expectedEvents) && pendingOperations(records).length === 0,
    'TRADING_FX_MANUAL_PREDECESSOR_NOT_COMPLETE');
  const [prepared, build, , staged, smoke, approval, intent, promoted, observed, completed] = records;
  const manual = prepared.payload.data.manifest;
  requireCondition(validateManifest(manual) === manualBaseline.manifestHash && manual.candidate.sha === manualBaseline.sha
    && same(manual.previous, previous.previous) && manual.prerequisites === null
    && same(manual.build.publicEnvironment, manifest.build.publicEnvironment)
    && manual.candidate.lockDigest === manifest.candidate.lockDigest
    && !manual.selection.salesforce && !manual.selection.database,
  'TRADING_FX_MANUAL_PREDECESSOR_SCOPE_CHANGED');

  const stage = staged.payload.data.result;
  assertBuildReceipt(build.payload.data, manual);
  assertSmokeProof(smoke.payload.data, manual, stage);
  const runtime = observed.payload.data, stageProof = smoke.payload.data;
  const promotion = intent.payload.data;
  const request = { deploymentId: manualBaseline.deploymentId, previousDeploymentId: manual.previous.deploymentId, buildId: manual.build.buildId };
  requireCondition(staged.payload.data.outcome === 'applied' && stage.id === manualBaseline.deploymentId
    && stage.sha === manualBaseline.sha && stage.buildId === manual.build.buildId
    && stage.artifactDigest === build.payload.data.artifactDigest && stage.manifestHash === manualBaseline.manifestHash
    && stageProof.deploymentId === stage.id && stageProof.buildId === stage.buildId && stageProof.passed === true
    && stageProof.businessWrites === 0 && stageProof.normalRole === true
    && approval.payload.data.runId === manualBaseline.runId
    && promotion.operationId === manual.releaseId + '-promote'
    && promotion.requestHash === digest(request) && same(promotion.request, request)
    && promoted.payload.data.operationId === promotion.operationId && promoted.payload.data.outcome === 'applied'
    && promoted.payload.data.result.id === stage.id && promoted.payload.data.result.sha === stage.sha
    && promoted.payload.data.result.buildId === stage.buildId && promoted.payload.data.result.artifactDigest === stage.artifactDigest
    && runtime.passed === true && runtime.observationMs >= 300000 && runtime.deploymentId === stage.id
    && runtime.buildId === stage.buildId && runtime.businessWrites === 0
    && completed.payload.data.deploymentId === stage.id,
  'TRADING_FX_MANUAL_PREDECESSOR_NOT_COMPLETE');
  assertAuthorization(approval.payload.data, manual, stage, Date.parse(approval.created_at));
  const base = '/repos/' + targets().repository;
  const run = await github.read(base + '/actions/runs/' + manualBaseline.runId);
  requireCondition(run.id === manualBaseline.runId && run.repository?.full_name === targets().repository
    && run.actor?.id === ownerId && run.event === 'workflow_dispatch'
    && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && run.status === 'completed' && run.conclusion === 'success'
    && run.display_title === 'FCOS rapid resume ' + manualBaseline.manifestHash + ' ' + manualBaseline.sha,
  'TRADING_FX_MANUAL_PREDECESSOR_NOT_COMPLETE');
  if (hasSigningConfig) {
    await verifyTradingFxSigningConfig({ manifest, previous: previous.previous, github, ownerId, provider });
  }
}

export async function readFailedBootstrapSuccessor({ manifest, github, ownerId, readPostQatRecovery, provider }) {
  validateManifest(manifest);
  const next = manifest.prerequisites?.plan;
  const receiptId = next?.tradingFxFailedBootstrapReceiptId;
  requireCondition(manifest.prerequisites?.adapter === 'trading-fx-prerequisites'
    && [reviewedSuccessorSha, afterManualSuccessorSha].includes(manifest.candidate.sha) && positiveId(receiptId), 'TRADING_FX_BOOTSTRAP_SUCCESSOR_SCOPE_CHANGED');
  const base = '/repos/' + targets().repository;
  const deployment = id => github.read(base + '/deployments/' + id);
  const receipt = await deployment(receiptId);
  const event = receipt?.payload;
  const closure = event?.data;
  const owned = row => row?.creator?.id === ownerId && row.creator.login === targets().account
    && row.sha === originalCandidateSha && row.environment === 'fcos-release-journal-v1';
  requireCondition(receipt?.id === receiptId && owned(receipt) && event?.event === 'prerequisites.result'
    && closure?.outcome === TRADING_FX_FAILED_BOOTSTRAP && isDigest(closure.evidenceDigest)
    && [closure.originalRunId, closure.originalIntent, closure.approval, closure.mirrorReceipt, closure.databaseClosure].every(positiveId),
  'TRADING_FX_FAILED_BOOTSTRAP_CLOSURE_REQUIRED');
  const journal = new DeploymentJournal({ github: { ...github, candidateSha: receipt.sha },
    manifestHash: event.manifestHash, releaseId: event.releaseId, actorIds: [ownerId, 41898282] });
  const chain = await journal.read();
  const terminal = chain.at(-1);
  const stopped = chain.slice(0, -2);
  const pending = pendingOperations(stopped);
  const original = pending[1]?.data;
  const proof = terminal?.payload.data;
  const previous = stopped.find(row => row.creator.id === 41898282 && row.payload.event === 'release.prepared')?.payload.data.manifest;
  const old = previous?.prerequisites?.plan;
  requireCondition(chain.at(-2)?.id === receiptId && owned(terminal) && terminal.payload.event === 'salesforce.checkpoint'
    && original?.stage === 'production' && original.operation === 'bootstrap' && original.outcome === 'pending'
    && proof?.outcome === 'resolved' && proof.terminalOutcome === 'failed_rolled_back'
    && proof.evidenceDigest === closure.evidenceDigest && digest(proof.evidence) === closure.evidenceDigest
    && proof.evidence.terminalStatus === 'Failed' && proof.evidence.rollbackOnError === true
    && same(proof.job, original.job) && same(proof.evidence.job, original.job) && closure.bootstrapJob === original.job.id
    && proof.evidence.originalCheckpointDigest === original.evidenceDigest && isDigest(proof.evidence.reportDigest)
    && isDigest(proof.evidence.inventoryHash) && isDigest(proof.evidence.inventoryEvidenceDigest)
    && proof.fingerprint === original.fingerprint && proof.fingerprint === closure.salesforceFingerprint
    && proof.stage === original.stage && proof.operation === original.operation && pendingOperations(chain).length === 0
    && pending.length === 2 && pending[0].event === 'prerequisites.intent' && pending[0].data.operationId === closure.operationId
    && old && validateManifest(previous) === event.manifestHash && previous.candidate.sha === originalCandidateSha
    && previous.controllerSha !== manifest.controllerSha && old.salesforceFingerprint === original.fingerprint
    && previous.candidate.lockDigest === manifest.candidate.lockDigest
    && same(previous.build.publicEnvironment, manifest.build.publicEnvironment)
    && same(previous.moduleInventory, manifest.moduleInventory) && same(previous.selection, manifest.selection),
  'TRADING_FX_FAILED_BOOTSTRAP_JOURNAL_SCOPE_CHANGED');
  requireCondition(hasTradingFxSigningLocator(next), 'TRADING_FX_SIGNING_CONFIG_REQUIRED_FOR_STAGE');
  if (manifest.candidate.sha === afterManualSuccessorSha) {
    await verifyTradingFxManualPredecessor({ manifest, previous, github, ownerId, provider });
  } else {
    requireCondition(same(previous.previous, { ...manifest.previous, configurationDigest: previous.previous.configurationDigest }),
      'TRADING_FX_FAILED_BOOTSTRAP_JOURNAL_SCOPE_CHANGED');
    await verifyTradingFxSigningConfig({ manifest, previous: previous.previous, github, ownerId, provider });
  }
  const { salesforceManifestPath: _oldManifest, salesforceReviewPath: _oldReview, salesforceSourceTreeHash: oldTree,
    salesforceFingerprint: oldFingerprint, bootstrapFingerprint: oldBootstrap, tradingFxPostQatRecoveryReceiptId: oldRecovery,
    ...oldRetained } = old;
  const { salesforceManifestPath, salesforceReviewPath, salesforceSourceTreeHash, salesforceFingerprint,
    bootstrapFingerprint, tradingFxFailedBootstrapReceiptId: _receiptId,
    tradingFxSigningConfigReceiptId: _signingReceipt, tradingFxSigningConfigReceiptDigest: _signingDigest, ...nextRetained } = next;
  requireCondition(positiveId(oldRecovery) && same(oldRetained, nextRetained)
    && salesforceManifestPath === 'manifest/trading-fx-certificate-release.xml'
    && salesforceReviewPath === 'manifest/trading-fx-certificate-reviewed-release.json'
    && [[salesforceSourceTreeHash, oldTree], [salesforceFingerprint, oldFingerprint], [bootstrapFingerprint, oldBootstrap]]
      .every(([current, prior]) => isDigest(current) && current !== prior), 'TRADING_FX_BOOTSTRAP_SUCCESSOR_SCOPE_CHANGED');

  const [run, historical] = await Promise.all([
    github.read(base + '/actions/runs/' + closure.originalRunId), readPostQatRecovery(previous),
  ]);
  const staged = stopped.find(row => row.creator.id === 41898282 && row.payload.event === 'stage.result')?.payload.data.result;
  const approval = stopped.find(row => row.id === closure.approval && row.creator.id === 41898282 && row.payload.event === 'approval.accepted');
  const intent = stopped.find(row => row.id === closure.originalIntent && row.creator.id === 41898282 && row.payload.event === 'prerequisites.intent');
  const request = { planDigest: digest(previous.prerequisites), candidateSha: originalCandidateSha };
  requireCondition(intent && same(intent.payload.data, { operationId: closure.operationId, request, requestHash: digest(request) })
    && approval?.payload.data.runId === closure.originalRunId && staged?.sha === originalCandidateSha
    && run.id === closure.originalRunId && run.repository?.full_name === targets().repository && run.actor?.id === ownerId
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === '.github/workflows/fcos-rapid-release.yml'
    && run.status === 'completed' && run.conclusion === 'failure'
    && run.display_title === `FCOS rapid resume ${event.manifestHash} ${originalCandidateSha}`
    && historical?.receipt?.id === oldRecovery
    && historical.receipt.payload?.data?.databaseClosure === closure.databaseClosure
    && historical.database?.schemaDigest === manifest.previous.schemaDigest
    && isDigest(historical.database.operationDigest), 'TRADING_FX_FAILED_BOOTSTRAP_ORIGINAL_RELEASE_MISMATCH');
  assertAuthorization(approval.payload.data, previous, staged, Date.parse(approval.created_at));
  const [mirror, jobs] = await Promise.all([
    deployment(closure.mirrorReceipt), github.read(`${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`),
    assertFrozenWorkflow({ github, controllerSha: previous.controllerSha, dispatcherSha: run.head_sha }),
  ]);
  const goLive = jobs?.jobs?.filter(job => job.name === 'go-live');
  requireCondition(goLive?.length === 1 && goLive[0].status === 'completed' && goLive[0].conclusion === 'failure'
    && Date.parse(goLive[0].completed_at) <= Date.parse(receipt.created_at)
    && ownedMirror(mirror, ownerId, closure.mirrorReceipt, originalCandidateSha), 'TRADING_FX_FAILED_BOOTSTRAP_ORIGINAL_RELEASE_MISMATCH');

  const mirrorRequest = await deployment(mirror.payload.requestId);
  const nativeMirror = verifyLocalMirrorReceipt({ request: mirrorRequest.payload, requestDeployment: mirrorRequest, receiptDeployment: mirror,
    reviewed: { fingerprint: oldFingerprint, binding: { sourceTreeHash: oldTree } },
    workflowActorId: 41898282, publisherId: ownerId, now: Date.parse(mirror.created_at) });
  requireCondition(mirrorRequest.payload.runId === run.id && mirrorRequest.payload.runAttempt === run.run_attempt
    && mirrorRequest.payload.manifestHash === event.manifestHash && mirrorRequest.payload.mode === 'check'
    && nativeMirror.commit === historical.mirror.receipt.payload.proof.commit, 'TRADING_FX_FAILED_BOOTSTRAP_ORIGINAL_MIRROR_MISMATCH');
  return { previous, database: historical.database, qualificationManifest: historical.nested.prior };
}

function ownedMirror(row, ownerId, id, sha) {
  return row?.id === id && row.creator?.id === ownerId && row.creator.login === targets().account
    && row.sha === sha && row.environment === LOCAL_MIRROR_ENVIRONMENT && positiveId(row.payload?.requestId);
}
