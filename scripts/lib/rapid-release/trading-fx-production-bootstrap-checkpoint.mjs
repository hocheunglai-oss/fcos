import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertAuthorization, digest, isDigest, requireCondition, targets, validateManifest } from './contract.mjs';
import { assertBuildReceipt, assertPreBootstrapProof } from './engine.mjs';
import { pendingOperations, validateChain } from './journal.mjs';
import { verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';

const salesforce = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const ownerId = salesforce.publication.requiredAccountId;
const botId = 41898282;
const repositoryId = 1278654816;
const environment = 'fcos-release-journal-v1';
const workflowPath = '.github/workflows/fcos-rapid-release.yml';
const permissionName = 'Fcos_Trading_FX_Data';
const checkpointLength = 41;
export const TRADING_FX_PRODUCTION_BOOTSTRAP_STOPPED = 'trading_fx_stopped_after_successful_production_bootstrap_with_verified_partial_effects';
// Canonical digest of the reviewed Production inventory delta, native profile
// grants, and exact RecordType projection reports from the stopped attempt.
export const TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST = '0f9c7fc66c73dabaf626141a2816e07ff09f4c2e363bdaa49897760f5245e982';
const expected = {
  runId: 43623944312, runAttempt: 2, releaseId: 'trading-fx-signed-after-manual-43620608639',
  manifestHash: 'c2d77a57ca70d953b19bb3605e52afe306a99971461b79d26e45e697a6aa2fad',
  candidateSha: 'b495d1bde6d06834c32212982c4597e20e6c7fe0',
  controllerSha: 'd7e269328d399967aaa09be51406c9b7cc4a43d6',
  fingerprint: 'c13101bbdc7796ec98e22b0b0848c25c03bbace805c33d4c139e7871645314c3',
  sourceTreeHash: 'd9b6781881a241020eac6e1dc51071037a2574ae6d742e5f5e440108e411f72c',
  stagedId: 'dpl_336J8sRxvjqBMtvdX9rsa11VTDfq',
  terminalRecordHash: 'e3be5c7cc15f14bc669684201679a592ba2dd62fad6fc7d38fe78d83b9724938',
};
const bootstrapPackage = '20bbcfd77480512d71cfdbfdcfe24ab527163a86588b1c927cc98a8723174401';
const validationPackage = '748bf0f976017fbe0512d2a380c0743bbd865e20c15271e3a5abe5f05c243afd';
const jobPins = [
  [11, 'devee', 'bootstrap', '0AfHF000007Gz1u0AC', null, bootstrapPackage],
  [16, 'devee', 'validation', '0AfHF000007GzDB0A0', null, validationPackage],
  [19, 'devee', 'deployment', '0AfHF000007GzJd0AK', '0AfHF000007GzDB0A0'],
  [24, 'qat', 'bootstrap', '0AfBh000006jzIPKAY', null, bootstrapPackage],
  [29, 'qat', 'validation', '0AfBh000006jzK1KAI', null, validationPackage],
  [32, 'qat', 'deployment', '0AfBh000006jyZGKAY', '0AfBh000006jzK1KAI'],
  [37, 'production', 'bootstrap', '0Affu000001AFzhCAG', null, bootstrapPackage],
];
const mirrorPins = [
  { mode: 'publish', sequence: 1, requestId: 7800593130, receiptId: 7800615157 },
  { mode: 'check', sequence: 2, requestId: 7800733557, receiptId: 7800752026 },
];
const data = row => row?.payload?.data;
const time = row => Date.parse(row?.created_at);
const same = (left, right) => digest(left ?? null) === digest(right ?? null);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const isOwner = person => person?.id === ownerId && person.login === targets().account;
const isBot = person => person?.id === botId && person.login === 'github-actions[bot]';
const orgId = stage => salesforce.environments.find(item => item.key === stage).orgId;
const event = (row, name, id) => row?.payload?.event === name && (id === undefined || row.id === id);
const isCheckpoint = (row, stage, operation, outcome) => event(row, 'salesforce.checkpoint')
  && data(row)?.fingerprint === expected.fingerprint && isDigest(data(row).evidenceDigest)
  && data(row).stage === stage && data(row).operation === operation && data(row).outcome === outcome;

function journalIdentityDigest(records) {
  return digest(records.map(row => [row.id, row.created_at, row.creator?.id, row.creator?.login, row.sha, row.environment]));
}

function verifyMirror({ pair, pin, manifestHash, intent, checkpoint, after, jobs }) {
  const { request, receipt } = pair ?? {};
  const payload = request?.payload;
  requireCondition(request?.id === pin.requestId && receipt?.id === pin.receiptId
    && isBot(request.creator) && isOwner(receipt.creator) && payload?.mode === pin.mode && payload.sequence === pin.sequence
    && payload.manifestHash === manifestHash && payload.runId === expected.runId && payload.runAttempt === expected.runAttempt
    && payload.candidateSha === expected.candidateSha && payload.controllerSha === expected.controllerSha
    && payload.deveeOrgId === orgId('devee') && payload.validationJobId === jobs[1].job.id && payload.deploymentJobId === jobs[2].job.id
    && payload.intentHash === data(intent).evidenceDigest && time(request) >= Math.max(time(intent), time(after))
    && time(receipt) <= time(checkpoint), 'TRADING_FX_PRODUCTION_BOOTSTRAP_MIRROR_CHANGED');
  const proof = verifyLocalMirrorReceipt({ request: payload, requestDeployment: request, receiptDeployment: receipt,
    reviewed: { fingerprint: expected.fingerprint, binding: { sourceTreeHash: expected.sourceTreeHash } },
    workflowActorId: botId, publisherId: ownerId, now: time(receipt) });
  requireCondition(same(data(checkpoint).mirror, { commit: proof.commit, pullRequest: proof.pullRequest.number }),
    'TRADING_FX_PRODUCTION_BOOTSTRAP_MIRROR_CHANGED');
  return { request, receipt, checkpoint, proof };
}

// Structural validation for an authenticated journal prefix. The native reader below also
// pins the historic manifest and prefix hashes and checks the dispatcher workflow blob.
export function verifyTradingFxProductionBootstrapCheckpoint({ originalManifest, run, jobs, reviews, records, mirrorPublication, mirrorCheck }) {
  const prior = originalManifest;
  const manifestHash = validateManifest(prior);
  const plan = prior.prerequisites?.plan;
  requireCondition(prior.releaseId === expected.releaseId && prior.candidate.sha === expected.candidateSha
    && prior.controllerSha === expected.controllerSha && prior.prerequisites?.adapter === 'trading-fx-prerequisites'
    && plan?.salesforceFingerprint === expected.fingerprint && plan.salesforceSourceTreeHash === expected.sourceTreeHash
    && plan.mirrorPublication === 'local-collaborator' && plan.backwardCompatible === true
    && prior.selection.salesforce === true && prior.selection.database === true,
  'TRADING_FX_PRODUCTION_BOOTSTRAP_MANIFEST_CHANGED');

  const chain = validateChain(records, manifestHash, prior.releaseId);
  requireCondition(records.length === checkpointLength && chain.length === records.length
    && new Set(chain.map(row => row.id)).size === chain.length
    && chain.every((row, index) => isBot(row.creator) && row.sha === prior.candidate.sha
      && row.environment === environment && positiveId(row.id)
      && Number.isFinite(time(row)) && (!index || time(chain[index - 1]) <= time(row))),
  'TRADING_FX_PRODUCTION_BOOTSTRAP_JOURNAL_CHANGED');
  const [prepared, build, stageIntent, stageResult, staging, approval, prerequisite] = chain;
  requireCondition(event(prepared, 'release.prepared', 7791612280) && same(data(prepared).manifest, prior)
    && event(build, 'build.passed', 7791612459) && event(stageIntent, 'stage.intent', 7791616629)
    && event(stageResult, 'stage.result', 7791618227) && event(staging, 'stage.pre_bootstrap_passed', 7791692066)
    && event(approval, 'approval.accepted', 7800347765) && event(prerequisite, 'prerequisites.intent', 7800349222)
    && event(chain[7], 'obstacle.detected', 7800353081), 'TRADING_FX_PRODUCTION_BOOTSTRAP_SEQUENCE_CHANGED');

  assertBuildReceipt(data(build), prior);
  const staged = data(stageResult).result;
  const stageOperation = `${prior.releaseId}-stage`;
  const stageRequest = { buildId: prior.build.buildId, artifactDigest: data(build).artifactDigest, candidateSha: prior.candidate.sha,
    previousDeploymentId: prior.previous.deploymentId, target: 'production', skipDomain: true };
  requireCondition(same(data(stageIntent), { operationId: stageOperation, requestHash: digest(stageRequest), request: stageRequest })
    && data(stageResult).operationId === stageOperation && data(stageResult).outcome === 'applied'
    && staged?.id === expected.stagedId && staged.operationId === stageOperation && staged.sha === prior.candidate.sha
    && staged.manifestHash === manifestHash && staged.buildId === prior.build.buildId
    && staged.artifactDigest === data(build).artifactDigest && staged.target === 'production',
  'TRADING_FX_PRODUCTION_BOOTSTRAP_STAGE_CHANGED');
  assertPreBootstrapProof(data(staging), prior, staged);
  assertAuthorization(data(approval), prior, staged, time(approval));

  const operationId = `${prior.releaseId}-prerequisites`;
  const request = { planDigest: digest(prior.prerequisites), candidateSha: prior.candidate.sha };
  const pending = pendingOperations(chain);
  requireCondition(same(data(prerequisite), { operationId, requestHash: digest(request), request })
    && same(pending, [{ event: 'prerequisites.intent', data: data(prerequisite) }]),
  'TRADING_FX_PRODUCTION_BOOTSTRAP_PREREQUISITE_CHANGED');

  const { runId, runAttempt } = expected;
  requireCondition(run?.id === runId && run.run_attempt === runAttempt && run.repository?.id === repositoryId
    && run.repository.full_name === targets().repository && isOwner(run.actor) && isOwner(run.triggering_actor)
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === workflowPath
    && run.display_title === `FCOS rapid release ${manifestHash} ${prior.candidate.sha}`
    && run.status === 'completed' && run.conclusion === 'failure'
    && data(approval).runId === runId && data(approval).approvedAt === run.created_at
    && Array.isArray(reviews) && reviews.some(review => review.state === 'approved' && isOwner(review.user)
      && review.environments?.some(item => item.id === 23178773471 && item.name === data(approval).environment)),
  'TRADING_FX_PRODUCTION_BOOTSTRAP_NATIVE_APPROVAL_CHANGED');
  const ended = chain.at(-1);
  const phases = [['quality', 'success'], ['stage-and-smoke', 'success'], ['go-live', 'failure']];
  requireCondition(jobs?.jobs?.length === phases.length && phases.every(([name, conclusion]) => {
    const matches = jobs.jobs.filter(job => job.name === name);
    const [job] = matches;
    return matches.length === 1 && job.run_id === runId && job.run_attempt === runAttempt && job.status === 'completed'
      && job.conclusion === conclusion && Date.parse(job.completed_at) >= Date.parse(job.started_at)
      && (name !== 'stage-and-smoke' || Date.parse(job.completed_at) >= time(staging))
      && (name !== 'go-live' || Date.parse(job.started_at) <= time(chain[8]) && Date.parse(job.completed_at) >= time(ended));
  }), 'TRADING_FX_PRODUCTION_BOOTSTRAP_TERMINAL_RUN_REQUIRED');

  const salesforceOperations = jobPins.map(([start, stage, operation, id, validationId, packageSha256]) => {
    const [intent, submitted, resolved] = chain.slice(start, start + 3);
    const job = data(resolved)?.job;
    requireCondition(isCheckpoint(intent, stage, operation, 'pending') && isCheckpoint(submitted, stage, operation, 'pending')
      && isCheckpoint(resolved, stage, operation, 'resolved') && job?.id === id && job.validationId === validationId
      && job.packageSha256 === packageSha256 && Math.abs(time(intent) - Date.parse(job.submittedAt)) < 2000
      && same(data(submitted).job, job) && same(data(intent).job, { ...job, id: null }),
    'TRADING_FX_PRODUCTION_BOOTSTRAP_JOB_CHANGED');
    return { stage, operation, job, intent, submitted, resolved };
  });

  const permissions = [['devee', 14], ['qat', 27]].map(([stage, index]) => {
    const operation = `permission:${permissionName}`;
    const [readback, assignment] = chain.slice(index, index + 2);
    requireCondition(isCheckpoint(readback, stage, operation, 'evidence') && isCheckpoint(assignment, stage, operation, 'resolved')
      && same(data(assignment).permission, { name: permissionName, orgId: orgId(stage), prestate: true }),
    'TRADING_FX_PRODUCTION_BOOTSTRAP_PERMISSION_CHANGED');
    return assignment;
  });
  const [mirrorIntent, published, checked, preparation] = [chain[22], chain[23], chain[35], chain[36]];
  requireCondition(['devee', 'qat', 'production'].every((stage, index) => isCheckpoint(chain[8 + index], stage, 'inventory-checkpoint', 'evidence'))
    && isCheckpoint(mirrorIntent, 'shared_mirror', 'publication', 'pending')
    && isCheckpoint(published, 'shared_mirror', 'publication', 'resolved')
    && isCheckpoint(checked, 'shared_mirror', 'publication', 'resolved')
    && isCheckpoint(preparation, 'production', 'preparation', 'evidence')
    && data(preparation).preparation?.status === 'awaiting-authorized-bootstrap'
    && isCheckpoint(ended, 'production', 'restoration-checkpoint', 'evidence') && ended.id === 7800779913,
  'TRADING_FX_PRODUCTION_BOOTSTRAP_SEQUENCE_CHANGED');
  const publication = verifyMirror({ pair: mirrorPublication, pin: mirrorPins[0], manifestHash, intent: mirrorIntent,
    checkpoint: published, after: salesforceOperations[2].resolved, jobs: salesforceOperations });
  const check = verifyMirror({ pair: mirrorCheck, pin: mirrorPins[1], manifestHash, intent: published,
    checkpoint: checked, after: salesforceOperations[5].resolved, jobs: salesforceOperations });
  requireCondition(same(publication.proof, check.proof), 'TRADING_FX_PRODUCTION_BOOTSTRAP_MIRROR_CHANGED');

  return {
    prior, manifestHash, runId, runAttempt, salesforceOperations, permissions, mirror: { publication, check },
    staged, staging, historicalApproval: approval, prerequisite, prerequisiteIntentId: prerequisite.id,
    lastRecord: ended, lastRecordHash: ended.payload.recordHash, journalIdentityDigest: journalIdentityDigest(chain),
    goLiveCompletedAt: jobs.jobs.find(job => job.name === 'go-live').completed_at,
    nextSalesforcePhase: 'production-restoration-and-permission-readback',
  };
}

// This closes only the original prerequisite fence. It neither reports an
// applied release nor grants authority to continue Production writes.
export function buildTradingFxProductionBootstrapClosure({ checkpoint, productionPreimageEvidenceDigest }) {
  const { prior, manifestHash, runId, runAttempt, salesforceOperations, mirror, historicalApproval, prerequisite,
    lastRecord, lastRecordHash, staged } = checkpoint;
  const production = salesforceOperations?.at(-1);
  const operationId = data(prerequisite)?.operationId;
  requireCondition(manifestHash === validateManifest(prior) && prior.releaseId === expected.releaseId
    && prior.candidate.sha === expected.candidateSha && prior.controllerSha === expected.controllerSha
    && runId === expected.runId && runAttempt === expected.runAttempt
    && event(prerequisite, 'prerequisites.intent', 7800349222) && operationId === `${prior.releaseId}-prerequisites`
    && event(historicalApproval, 'approval.accepted', 7800347765) && staged?.id === expected.stagedId
    && isCheckpoint(lastRecord, 'production', 'restoration-checkpoint', 'evidence')
    && lastRecord.id === 7800779913 && isDigest(lastRecordHash) && lastRecordHash === lastRecord.payload.recordHash
    && isDigest(checkpoint.journalIdentityDigest)
    && isCheckpoint(production?.resolved, 'production', 'bootstrap', 'resolved')
    && production.resolved.id === 7800775625 && data(production.resolved).job?.id === jobPins.at(-1)[3]
    && mirror?.publication?.receipt?.id === mirrorPins[0].receiptId && mirror?.check?.receipt?.id === mirrorPins[1].receiptId,
  'TRADING_FX_PRODUCTION_BOOTSTRAP_CLOSURE_CHECKPOINT_CHANGED');
  requireCondition(productionPreimageEvidenceDigest === TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST,
    'TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_REQUIRED');
  const evidence = {
    originalRunId: runId, originalRunAttempt: runAttempt, originalIntent: prerequisite.id, approval: historicalApproval.id,
    originalJournalHead: lastRecordHash, originalJournalIdentityDigest: checkpoint.journalIdentityDigest, stagedDeploymentId: staged.id,
    bootstrapJob: data(production.resolved).job.id, bootstrapCheckpoint: production.resolved.id, restorationCheckpoint: lastRecord.id,
    salesforceFingerprint: expected.fingerprint, salesforceSourceTreeHash: expected.sourceTreeHash,
    mirrorPublicationReceipt: mirror.publication.receipt.id, mirrorCheckReceipt: mirror.check.receipt.id,
    productionPreimageEvidenceDigest,
  };
  return {
    expectedPreviousHash: lastRecordHash,
    result: { operationId, outcome: TRADING_FX_PRODUCTION_BOOTSTRAP_STOPPED, ...evidence, evidenceDigest: digest(evidence) },
  };
}

export function verifyTradingFxProductionBootstrapClosure({ checkpoint, records, receiptId }) {
  requireCondition(positiveId(receiptId) && records.length === checkpointLength + 1, 'TRADING_FX_PRODUCTION_BOOTSTRAP_CLOSURE_REQUIRED');
  const chain = validateChain(records, checkpoint.manifestHash, checkpoint.prior.releaseId);
  const closure = chain.at(-1);
  const prefix = chain.slice(0, -1);
  const prefixEnd = chain.at(-2);
  const { result, expectedPreviousHash } = buildTradingFxProductionBootstrapClosure({
    checkpoint, productionPreimageEvidenceDigest: TRADING_FX_PRODUCTION_BOOTSTRAP_PREIMAGE_DIGEST,
  });
  requireCondition(chain.length === records.length && prefixEnd?.id === checkpoint.lastRecord.id
    && journalIdentityDigest(prefix) === checkpoint.journalIdentityDigest
    && prefixEnd.payload.recordHash === expectedPreviousHash && event(closure, 'prerequisites.result', receiptId)
    && !prefix.some(row => row.id === receiptId) && isOwner(closure.creator)
    && closure.environment === environment && closure.task === 'fcos-release-journal'
    && closure.sha === expected.candidateSha && closure.ref === expected.candidateSha
    && time(closure) >= Math.max(time(prefixEnd), Date.parse(checkpoint.goLiveCompletedAt))
    && closure.payload.previousHash === expectedPreviousHash && same(data(closure), result)
    && pendingOperations(chain).length === 0, 'TRADING_FX_PRODUCTION_BOOTSTRAP_CLOSURE_CHANGED');
  return closure;
}

async function readNativeCheckpoint({ github, originalManifest, allowClosure = false }) {
  const repo = `/repos/${targets().repository}`;
  const nativeRun = `${repo}/actions/runs/${expected.runId}`;
  const [records, run, jobs, reviews, ...pairs] = await Promise.all([
    github.pages(`${repo}/deployments?environment=${environment}&sha=${expected.candidateSha}&per_page=100`),
    github.read(nativeRun),
    github.read(`${nativeRun}/attempts/${expected.runAttempt}/jobs?per_page=100`),
    github.read(`${nativeRun}/approvals`),
    ...mirrorPins.map(async pin => {
      const [request, receipt] = await Promise.all([github.read(`${repo}/deployments/${pin.requestId}`), github.read(`${repo}/deployments/${pin.receiptId}`)]);
      return { request, receipt };
    }),
  ]);
  const own = records.filter(row => row.payload?.releaseId === expected.releaseId);
  const original = data(own.find(row => row.id === 7791612280))?.manifest;
  requireCondition(original && digest(original) === expected.manifestHash
    && (originalManifest === undefined || same(original, originalManifest)), 'TRADING_FX_PRODUCTION_BOOTSTRAP_MANIFEST_CHANGED');
  const prefix = allowClosure ? own.filter(row => row.payload.sequence < checkpointLength) : own;
  const checkpoint = verifyTradingFxProductionBootstrapCheckpoint({
    originalManifest: original, records: prefix, run, jobs, reviews, mirrorPublication: pairs[0], mirrorCheck: pairs[1],
  });
  requireCondition(checkpoint.lastRecordHash === expected.terminalRecordHash, 'TRADING_FX_PRODUCTION_BOOTSTRAP_JOURNAL_CHANGED');
  await assertFrozenWorkflow({ github, controllerSha: expected.controllerSha, dispatcherSha: run.head_sha });
  return { checkpoint, records: own };
}

export async function readTradingFxProductionBootstrapCheckpoint({ github, originalManifest }) {
  const { checkpoint } = await readNativeCheckpoint({ github, originalManifest });
  return checkpoint;
}

export async function readTradingFxProductionBootstrapClosure({ github, receiptId }) {
  requireCondition(positiveId(receiptId), 'TRADING_FX_PRODUCTION_BOOTSTRAP_CLOSURE_REQUIRED');
  const { checkpoint, records } = await readNativeCheckpoint({ github, allowClosure: true });
  const receipt = verifyTradingFxProductionBootstrapClosure({ checkpoint, records, receiptId });
  return { checkpoint, receipt };
}

export async function readTradingFxProductionBootstrapClosureState({ github }) {
  const { checkpoint, records } = await readNativeCheckpoint({ github, allowClosure: true });
  const suffix = records.filter(row => row.payload.sequence >= checkpointLength);
  if (!suffix.length) return { checkpoint };
  requireCondition(suffix.length === 1, 'TRADING_FX_PRODUCTION_BOOTSTRAP_CLOSURE_CHANGED');
  return { checkpoint, receipt: verifyTradingFxProductionBootstrapClosure({ checkpoint, records, receiptId: suffix[0].id }) };
}
