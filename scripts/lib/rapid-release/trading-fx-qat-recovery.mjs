import { assertAuthorization, digest, isDigest, isSha, requireCondition, targets, validateManifest } from './contract.mjs';
import { DeploymentJournal, pendingOperations } from './journal.mjs';

const botId = 41898282;
const journalEnvironment = 'fcos-release-journal-v1';
const stoppedOutcome = 'trading_fx_stopped_qat_validation_failed_with_verified_partial_effects';
const fixturePath = 'force-app/main/default/classes/FcosTradeDocumentLineSharingTest.cls';
const reviewedPaths = [fixturePath, 'manifest/trading-fx-post-nomination-reviewed-release.json'];
const positiveId = id => Number.isSafeInteger(id) && id > 0;

export async function readTradingFxQatRecovery({ manifest, github, receiptId, ownerId, readOriginalRecovery }) {
  requireCondition(positiveId(receiptId) && typeof readOriginalRecovery === 'function', 'TRADING_FX_QAT_RECOVERY_LOCATOR_INVALID');
  const endpoint = '/repos/' + targets().repository;
  const receipt = await github.read(endpoint + '/deployments/' + receiptId);
  const event = receipt?.payload;
  const closure = event?.data;
  requireCondition(receipt?.id === receiptId && receipt.creator?.id === ownerId && receipt.creator.login === targets().account
    && receipt.environment === journalEnvironment && isSha(receipt.sha) && receipt.sha !== manifest.candidate.sha
    && event?.event === 'prerequisites.result' && event.releaseId !== manifest.releaseId && closure?.outcome === stoppedOutcome
    && isDigest(closure.evidenceDigest) && [closure.originalRunId, closure.originalIntent, closure.databaseClosure, closure.mirrorReceipt].every(positiveId),
  'TRADING_FX_QAT_CLOSURE_REQUIRED');

  const journal = new DeploymentJournal({ github: { ...github, candidateSha: receipt.sha }, actorIds: [ownerId, botId],
    manifestHash: event.manifestHash, releaseId: event.releaseId });
  const chain = await journal.read();
  const botEvent = name => chain.find(record => record.creator.id === botId && record.payload.event === name);
  const prior = botEvent('release.prepared')?.payload.data.manifest;
  const originalIntent = botEvent('prerequisites.intent');
  const originalApproval = botEvent('approval.accepted');
  const staged = botEvent('stage.result')?.payload.data.result;
  const pending = pendingOperations(chain.slice(0, -1));
  const requested = { planDigest: digest(prior?.prerequisites ?? null), candidateSha: receipt.sha };
  const oldPlan = prior?.prerequisites?.plan;
  const nextPlan = manifest.prerequisites.plan;
  requireCondition(chain.at(-1)?.id === receiptId && chain.at(-1).payload.recordHash === event.recordHash
    && pendingOperations(chain).length === 0 && pending.length === 1 && pending[0].event === 'prerequisites.intent'
    && originalIntent?.id === closure.originalIntent && originalIntent.payload.data.operationId === closure.operationId
    && originalIntent.payload.data.requestHash === digest(requested)
    && digest(originalIntent.payload.data.request) === digest(requested)
    && originalApproval?.payload.data.runId === closure.originalRunId && staged?.sha === receipt.sha
    && prior && validateManifest(prior) === event.manifestHash && prior.candidate.sha === receipt.sha
    && prior.controllerSha !== manifest.controllerSha && prior.prerequisites.adapter === manifest.prerequisites.adapter
    && digest(prior.previous) === digest(manifest.previous) && prior.candidate.lockDigest === manifest.candidate.lockDigest
    && digest(oldPlan.migrations) === digest(nextPlan.migrations)
    && oldPlan.tradingFxRecoveryReceiptId === closure.databaseClosure
    && oldPlan.mirrorPublication === 'local-collaborator' && nextPlan.mirrorPublication === oldPlan.mirrorPublication
    && oldPlan.salesforceManifestPath === nextPlan.salesforceManifestPath && oldPlan.salesforceReviewPath === nextPlan.salesforceReviewPath
    && digest(oldPlan.deferredModules) === digest(nextPlan.deferredModules) && nextPlan.backwardCompatible === true
    && chain.every(({ payload }) => !/^(?:promote\.|rollback\.|live\.|release\.complete|prerequisites\.(?:passed|database_submitting))/u.test(payload.event)
      && (payload.event !== 'salesforce.checkpoint' || payload.data.stage !== 'production' || payload.data.outcome === 'evidence')),
  'TRADING_FX_QAT_ORIGINAL_OPERATION_REQUIRED');
  assertAuthorization(originalApproval.payload.data, prior, staged, Date.parse(originalApproval.created_at));

  const compare = await github.read(endpoint + '/compare/' + receipt.sha + '...' + manifest.candidate.sha);
  requireCondition(compare?.status === 'ahead' && compare.merge_base_commit?.sha === receipt.sha
    && Array.isArray(compare.files) && digest(compare.files.map(file => file.filename).sort()) === digest([...reviewedPaths].sort())
    && compare.files.every(file => file.status === 'modified'), 'TRADING_FX_QAT_SUCCESSOR_SCOPE_CHANGED');

  const checkpoints = new Map(chain.filter(row => row.creator.id === botId && row.payload.event === 'salesforce.checkpoint')
    .map(row => [row.payload.data.stage + ':' + row.payload.data.operation, row]));
  const get = (key, id) => {
    const checkpoint = checkpoints.get(key);
    const data = checkpoint?.payload.data;
    requireCondition(data?.outcome === 'resolved' && data.fingerprint === oldPlan.salesforceFingerprint
      && isDigest(data.evidenceDigest) && (id === undefined || data.job?.id === id)
      && checkpoint.payload.sequence > originalIntent.payload.sequence, 'TRADING_FX_QAT_ORIGINAL_CHECKPOINT_REQUIRED');
    return checkpoint;
  };
  const devee = get('devee:bootstrap');
  const mirror = get('shared_mirror:publication');
  const qat = get('qat:bootstrap', closure.qatBootstrapJob);
  const failed = get('qat:validation', closure.qatFailedValidationJob);
  const permissions = ['devee', 'qat'].map(stage => get(stage + ':permission:Fcos_Trading_FX_Data'));
  requireCondition(isDigest(devee.payload.data.job?.packageSha256) && isDigest(qat.payload.data.job?.packageSha256)
    && devee.payload.sequence < mirror.payload.sequence && mirror.payload.sequence < qat.payload.sequence
    && qat.payload.sequence < failed.payload.sequence && !checkpoints.has('qat:deployment'), 'TRADING_FX_QAT_CHECKPOINT_ORDER_CHANGED');
  const mirrorReceipt = await github.read(endpoint + '/deployments/' + closure.mirrorReceipt);
  requireCondition(mirrorReceipt?.id === closure.mirrorReceipt && mirrorReceipt.creator?.id === ownerId
    && mirrorReceipt.sha === receipt.sha && mirrorReceipt.payload?.kind === 'fcos_local_mirror_receipt'
    && mirrorReceipt.payload.proof?.commit === mirror.payload.data.mirror?.commit, 'TRADING_FX_QAT_ORIGINAL_MIRROR_REQUIRED');
  const mirrorRequest = await github.read(endpoint + '/deployments/' + mirrorReceipt.payload.requestId);
  requireCondition(mirrorRequest?.id === mirrorReceipt.payload.requestId && mirrorRequest.creator?.id === botId
    && mirrorRequest.sha === receipt.sha && mirrorRequest.payload?.kind === 'fcos_local_mirror_request'
    && mirrorRequest.payload.runId === closure.originalRunId && mirrorRequest.payload.manifestHash === event.manifestHash
    && digest(mirrorRequest.payload) === mirrorReceipt.payload.requestHash
    && digest(mirrorReceipt.payload.proof) === mirrorReceipt.payload.proofDigest,
  'TRADING_FX_QAT_ORIGINAL_MIRROR_REQUIRED');
  const original = await readOriginalRecovery(prior);
  requireCondition(original.receipt.id === closure.databaseClosure
    && original.database.schemaDigest === manifest.previous.schemaDigest, 'TRADING_FX_QAT_ORIGINAL_DATABASE_REQUIRED');
  return { receipt, prior, database: original.database, bootstrap: [devee, qat], failedQatValidation: failed, permissions };
}
