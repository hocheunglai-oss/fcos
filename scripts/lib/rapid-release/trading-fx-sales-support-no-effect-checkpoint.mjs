import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { assertAuthorization, digest, isDigest, requireCondition as check, targets, validateManifest } from './contract.mjs';
import { assertBuildReceipt, assertPreBootstrapProof } from './engine.mjs';
import { pendingOperations, validateChain } from './journal.mjs';
import { verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';
import { salesSupportRepairFields, salesSupportRepairPackage } from './trading-fx-sales-support-repair.mjs';

const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const production = fcosSalesforceEnvironment('production');
const ownerId = publication.requiredAccountId;
const botId = 41898282;
const repositoryId = 1278654816;
const environment = 'fcos-release-journal-v1';
const task = 'fcos-release-journal';
const approvalEnvironment = 'fcos-production-release';
const operation = 'sales-support-correction';
const outcome = 'succeeded_without_effect';
const stopped = 'trading_fx_stopped_after_ineffective_production_profile_correction';
const prefixLength = 36;
const original = {
  runId: 43717634836,
  runAttempt: 1,
  releaseId: 'trading-fx-profile-ordered-recovery-pr217',
  candidateSha: 'b495d1bde6d06834c32212982c4597e20e6c7fe0',
  controllerSha: '0d64dd594815e6d9dcff5933876355c904dfb858',
  dispatcherSha: '3ac1dbf7f5b7110736a08afaa9847d91125a9827',
  manifestHash: 'dd453ffd01c5cde405ab1b3c16b14f881ff5f75eb7093d2b7bd01c0f2e2108d5',
  headHash: '42d3436ac294982c6a71caa0096938be77718866918683b76315c11b6cfdf70b',
  identityDigest: '02f286293875cc1390b6ff355555bfd68a86d6df6812f3a10731e6bf998eb5df',
  workflow: '.github/workflows/fcos-rapid-release.yml',
  stagedId: 'dpl_8SMLgTSVLVCuWMHsqxUQrctCjgNX',
  previousId: 'dpl_EybnQs2MEgz3z2M2kJH74i9yGw38',
  previousSha: 'd2e5f1f94898ae99c6188831d071a77c337f31ae',
  handoverId: 7803879034,
  inventoryHash: 'c4a0115c5fabfe2a833e0bb8f866f6f9f6613f4f200139d1eaca67a9c119888b',
  productionJob: '0Affu000001AGpJCAW',
  productionJobStartedAt: '2026-11-15T15:39:46.000Z',
  productionJobCompletedAt: '2026-11-15T15:39:49.000Z',
};
const mirrorPins = [
  { mode: 'publish', sequence: 1, requestId: 7805659707, receiptId: 7805688017 },
  { mode: 'check', sequence: 2, requestId: 7805707494, receiptId: 7805731234 },
];
const mirrorCommit = 'f0f243d0e2daef159f990bcbecca2f86eb313d9e';
const jobPins = [
  ['devee', '0AfHF000007H5Yj0AK', 24, 7805645125],
  ['qat', '0AfBh000006k17KKAQ', 29, 7805697307],
  ['production', original.productionJob, 32, 7805738155],
];
const preimage = {
  target: salesSupportRepairFields.map(field => ({ field, read: true, edit: false })),
  unrelatedCount: 1363,
  unrelatedDigest: '61acc662a0f899fad1261722b38391cba9bb2a32dd67d0ecd7c99b16902d85e5',
};

export const TRADING_FX_NO_EFFECT_ORIGINAL = Object.freeze(original);
export const TRADING_FX_NO_EFFECT_CLOSURE_STEPS = Object.freeze({
  job: 'close-ineffective-profile-correction',
  profile: 'Append original Salesforce job outcome',
  prerequisites: 'Append original prerequisite outcome',
});
const data = row => row?.payload?.data;
const time = row => Date.parse(row?.created_at);
const same = (left, right) => digest(left ?? null) === digest(right ?? null);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const isOwner = person => person?.id === ownerId && person.login === targets().account;
const isBot = person => person?.id === botId && person.login === 'github-actions[bot]';
const isEvent = (row, event, id) => row?.payload?.event === event && (id === undefined || row.id === id);
const journalIdentity = row => [row.id, row.created_at, row.creator?.id, row.creator?.login, row.sha, row.ref, row.environment, row.task];
const nativeRecord = row => positiveId(row.id) && row.sha === original.candidateSha && row.ref === row.sha
  && row.environment === environment && row.task === task && Number.isFinite(time(row));

function verifyCorrectionCheckpoint(chain, [stage, id, start, finalId], fingerprint, packageSha256) {
  const [intent, submitted, resolved] = chain.slice(start, start + (stage === 'production' ? 2 : 3));
  const job = data(submitted)?.job;
  const matches = (row, expectedOutcome) => isEvent(row, 'salesforce.checkpoint') && data(row)?.stage === stage
    && data(row).operation === operation && data(row).fingerprint === fingerprint && data(row).outcome === expectedOutcome;
  check(matches(intent, 'pending') && matches(submitted, 'pending') && job?.id === id
    && job.validationId === null && job.packageSha256 === packageSha256
    && Math.abs(time(intent) - Date.parse(job.submittedAt)) < 2000 && same(data(intent).job, { ...job, id: null })
    && (resolved ? resolved.id === finalId && matches(resolved, 'resolved') && same(data(resolved).job, job) : submitted.id === finalId),
  'TRADING_FX_NO_EFFECT_ORIGINAL_JOB_CHANGED');
  return { intent, submitted, resolved, job };
}

function verifyMirror({ pair, pin, before, after, binding, repair, devee }) {
  const { request, receipt } = pair;
  const payload = request?.payload;
  check(request?.id === pin.requestId && receipt?.id === pin.receiptId && isBot(request.creator) && isOwner(receipt.creator)
    && payload?.mode === pin.mode && payload.sequence === pin.sequence && payload.manifestHash === original.manifestHash
    && payload.runId === original.runId && payload.runAttempt === original.runAttempt && payload.candidateSha === original.candidateSha
    && payload.controllerSha === original.controllerSha && payload.correctionSourceSha === repair.sourceCommit
    && payload.deveeOrgId === fcosSalesforceEnvironment('devee').orgId && payload.deploymentJobId === devee.job.id
    && payload.validationJobId === null && payload.intentHash === data(binding).evidenceDigest
    && time(request) >= Math.max(time(binding), time(before)) && time(receipt) <= time(after),
  'TRADING_FX_NO_EFFECT_MIRROR_CHANGED');
  const proof = verifyLocalMirrorReceipt({ request: payload, requestDeployment: request, receiptDeployment: receipt,
    reviewed: { fingerprint: repair.correctionFingerprint, binding: { sourceTreeHash: repair.sourceTreeHash } },
    workflowActorId: botId, publisherId: ownerId, now: time(receipt) });
  check(proof.commit === mirrorCommit && proof.pullRequest.number === 9, 'TRADING_FX_NO_EFFECT_MIRROR_CHANGED');
  return proof;
}

function verifyOriginalRun({ run, jobs, reviews, chain }) {
  const approval = chain[5];
  check(run?.id === original.runId && run.run_attempt === original.runAttempt && run.repository?.id === repositoryId
    && run.repository.full_name === targets().repository && isOwner(run.actor) && isOwner(run.triggering_actor)
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === original.workflow && run.head_branch === 'main'
    && run.head_sha === original.dispatcherSha && run.status === 'completed' && run.conclusion === 'failure'
    && run.display_title === `FCOS rapid resume ${original.manifestHash} ${original.candidateSha}`
    && data(approval)?.runId === run.id && data(approval).approvedAt === run.created_at
    && Array.isArray(reviews) && reviews.some(review => review.state === 'approved' && isOwner(review.user)
      && review.environments?.some(item => item.id === 23178773471 && item.name === approvalEnvironment)),
  'TRADING_FX_NO_EFFECT_NATIVE_APPROVAL_CHANGED');
  const expected = [
    ['quality', 132822495779, 'success'],
    ['stage-and-smoke', 132822693351, 'success'],
    ['go-live', 132824589778, 'failure'],
  ];
  check(jobs?.jobs?.length === expected.length && expected.every(([name, id, conclusion]) => {
    const job = jobs.jobs.find(row => row.name === name && row.id === id);
    return job?.run_id === original.runId && job.run_attempt === original.runAttempt && job.status === 'completed'
      && job.conclusion === conclusion && Date.parse(job.completed_at) >= Date.parse(job.started_at);
  }), 'TRADING_FX_NO_EFFECT_ORIGINAL_RUN_NOT_TERMINAL');
  const staging = jobs.jobs.find(job => job.name === 'stage-and-smoke');
  const goLive = jobs.jobs.find(job => job.name === 'go-live');
  check(Date.parse(staging.completed_at) >= time(chain[4]) && Date.parse(goLive.started_at) <= time(approval)
    && Date.parse(goLive.completed_at) >= time(chain.at(-1)),
  'TRADING_FX_NO_EFFECT_ORIGINAL_RUN_NOT_TERMINAL');
  return goLive.completed_at;
}

export function verifyTradingFxSalesSupportNoEffectCheckpoint({ records, run, jobs, reviews, mirrors }) {
  const chain = validateChain(records, original.manifestHash, original.releaseId);
  check(chain.length === prefixLength && records.length === chain.length && chain.every(row => isBot(row.creator) && nativeRecord(row))
    && chain.at(-1).payload.recordHash === original.headHash && digest(chain.map(journalIdentity)) === original.identityDigest,
  'TRADING_FX_NO_EFFECT_ORIGINAL_JOURNAL_CHANGED');
  const [prepared, build, , stageResult, staging, approval, prerequisite] = chain;
  const prior = data(prepared).manifest;
  const plan = prior?.prerequisites?.plan;
  const repair = plan?.salesSupportRepair;
  check(validateManifest(prior) === original.manifestHash && prior.candidate.sha === original.candidateSha
    && prior.controllerSha === original.controllerSha && prior.previous.sha === original.previousSha
    && prior.previous.deploymentId === original.previousId && prior.prerequisites.adapter === 'trading-fx-prerequisites'
    && plan.tradingFxProductionBootstrapRecoveryReceiptId === 7803270077 && isDigest(repair?.correctionFingerprint)
    && isEvent(approval, 'approval.accepted', 7805547474) && isEvent(prerequisite, 'prerequisites.intent', 7805549413),
  'TRADING_FX_NO_EFFECT_ORIGINAL_MANIFEST_CHANGED');
  const staged = data(stageResult).result;
  check(staged?.id === original.stagedId && data(stageResult).outcome === 'applied', 'TRADING_FX_NO_EFFECT_STAGE_CHANGED');
  assertBuildReceipt(data(build), prior);
  assertPreBootstrapProof(data(staging), prior, staged);
  assertAuthorization(data(approval), prior, staged, time(approval));
  const goLiveCompletedAt = verifyOriginalRun({ run, jobs, reviews, chain });
  const { profileDigest, manifestDigest } = salesSupportRepairPackage();
  check(repair.profileDigest === profileDigest && repair.manifestDigest === manifestDigest, 'TRADING_FX_NO_EFFECT_PACKAGE_CHANGED');
  const packageSha256 = digest({ profileDigest, manifestDigest });
  const [devee, qat, productionCorrection] = jobPins.map(pin => verifyCorrectionCheckpoint(chain, pin, repair.correctionFingerprint, packageSha256));
  const expectedPending = [prerequisite, productionCorrection.submitted].map(row => ({ event: row.payload.event, data: data(row) }));
  check(same(pendingOperations(chain), expectedPending), 'TRADING_FX_NO_EFFECT_PENDING_OPERATIONS_CHANGED');
  const [intent, published] = [chain[27], chain[28]];
  check(same(data(published).mirror, { commit: mirrorCommit, pullRequest: 9 }), 'TRADING_FX_NO_EFFECT_MIRROR_CHANGED');
  const proof = verifyMirror({ pair: mirrors[0], pin: mirrorPins[0], before: devee.resolved, after: published, binding: intent, repair, devee });
  const checked = verifyMirror({ pair: mirrors[1], pin: mirrorPins[1], before: qat.resolved,
    after: productionCorrection.intent, binding: published, repair, devee });
  check(same(proof, checked) && time(published) <= time(qat.intent), 'TRADING_FX_NO_EFFECT_MIRROR_CHANGED');
  return { prior, manifestHash: original.manifestHash, runId: original.runId, runAttempt: original.runAttempt, staged, approval,
    prerequisite, lastRecordHash: original.headHash, devee, qat, productionCorrection, mirror: checked, goLiveCompletedAt };
}

// The actual target catalog reconstructs both archived intent digests. This
// binds the post-job readback to the original pre-provider snapshot and owner.
function verifyOriginalPreimage(checkpoint, catalogDigest) {
  const { intent, submitted, job } = checkpoint.productionCorrection;
  const { fingerprint, stage } = data(submitted);
  const receiptId = digest({ manifestHash: checkpoint.manifestHash, runId: checkpoint.runId,
    fingerprint, stage, orgId: production.orgId, operation });
  const request = { status: 'submitting', jobId: null, validationJobId: null, submittedAt: job.submittedAt,
    packageSha256: job.packageSha256, beforeDigest: catalogDigest, receiptId };
  check(digest(request) === data(intent).evidenceDigest
    && digest({ ...request, status: 'submitted', jobId: job.id }) === data(submitted).evidenceDigest,
  'TRADING_FX_NO_EFFECT_ORIGINAL_PREIMAGE_CHANGED');
  return receiptId;
}

export function verifyTradingFxSalesSupportNoEffectReadback({ checkpoint, baseline, report, catalog, inventory, observedAt }) {
  const components = report?.details?.componentSuccesses;
  const names = Array.isArray(components) && components.map(entry => ({
    type: entry.componentType, name: entry.fullName, file: entry.fileName, success: entry.success,
    created: entry.created, deleted: entry.deleted,
  }));
  const expectedComponents = [
    { type: 'Profile', name: 'Sales Support', file: 'zip/profiles/Sales Support.profile', success: true, created: false, deleted: false },
    { type: '', name: 'package.xml', file: 'zip/package.xml', success: true, created: false, deleted: false },
  ];
  const noRows = rows => rows == null || Array.isArray(rows) && rows.length === 0;
  check(report?.id === original.productionJob && report.done === true && report.success === true && report.status === 'Succeeded'
    && report.checkOnly === false && report.rollbackOnError === true && report.startDate === original.productionJobStartedAt
    && report.completedDate === original.productionJobCompletedAt && report.numberComponentsTotal === 1
    && report.numberComponentsDeployed === 1 && report.numberComponentErrors === 0 && report.numberTestErrors === 0
    && report.numberTestsTotal === 0 && report.numberTestsCompleted === 0 && noRows(report.details?.componentFailures)
    && noRows(report.details?.runTestResult?.codeCoverageWarnings) && names?.length === 2
    && expectedComponents.every(component => names.some(entry => same(entry, component))),
  'TRADING_FX_NO_EFFECT_ORIGINAL_REPORT_CHANGED');
  check(same(catalog, preimage), 'TRADING_FX_NO_EFFECT_CURRENT_GRANTS_CHANGED');
  const evidence = {
    orgId: inventory?.orgId, providerStatus: report.status, reportDigest: digest(report), completedAt: report.completedDate,
    catalogDigest: digest(catalog), targetReads: catalog.target.length, targetEdits: 0,
    unrelatedCount: catalog.unrelatedCount, unrelatedDigest: catalog.unrelatedDigest,
    inventoryHash: inventory?.inventoryHash, inventoryEvidenceDigest: inventory?.evidenceSha256,
    baseline, handoverId: original.handoverId, observedAt,
  };
  assertReadbackEvidence(checkpoint, evidence);
  return evidence;
}

function assertReadbackEvidence(checkpoint, evidence) {
  check(evidence?.orgId === production.orgId && evidence.providerStatus === 'Succeeded'
    && isDigest(evidence.reportDigest) && evidence.completedAt === original.productionJobCompletedAt
    && evidence.catalogDigest === digest(preimage) && evidence.targetReads === preimage.target.length
    && evidence.targetEdits === 0 && evidence.unrelatedCount === preimage.unrelatedCount && evidence.unrelatedDigest === preimage.unrelatedDigest
    && evidence.inventoryHash === original.inventoryHash && isDigest(evidence.inventoryEvidenceDigest)
    && same(evidence.baseline, checkpoint.prior.previous) && evidence.handoverId === original.handoverId
    && Number.isFinite(Date.parse(evidence.observedAt)) && Date.parse(evidence.observedAt) >= Date.parse(checkpoint.goLiveCompletedAt),
  'TRADING_FX_NO_EFFECT_READBACK_REQUIRED');
  return verifyOriginalPreimage(checkpoint, evidence.catalogDigest);
}

export function buildTradingFxSalesSupportNoEffectProfileResult({ checkpoint, evidence }) {
  const ownershipReceipt = assertReadbackEvidence(checkpoint, evidence);
  const { submitted, intent, job } = checkpoint.productionCorrection;
  const proof = { ...evidence, originalRunId: checkpoint.runId, originalRunAttempt: checkpoint.runAttempt,
    originalIntent: intent.id, originalSubmission: submitted.id, ownershipReceipt,
    originalIntentDigest: data(intent).evidenceDigest, originalSubmissionDigest: data(submitted).evidenceDigest,
    originalJournalHead: checkpoint.lastRecordHash };
  return { fingerprint: data(submitted).fingerprint, stage: 'production', operation, job,
    outcome: 'resolved', terminalOutcome: outcome, reportDigest: evidence.reportDigest, evidence: proof, evidenceDigest: digest(proof) };
}

export function buildTradingFxSalesSupportNoEffectPrerequisiteResult({ checkpoint, profileReceipt }) {
  assertProfileReceipt(checkpoint, profileReceipt);
  const evidence = {
    originalRunId: checkpoint.runId, originalRunAttempt: checkpoint.runAttempt, originalIntent: checkpoint.prerequisite.id,
    approval: checkpoint.approval.id, originalJournalHead: checkpoint.lastRecordHash, stagedDeploymentId: checkpoint.staged.id,
    correctionJob: checkpoint.productionCorrection.job.id, correctionReceipt: profileReceipt.id,
    correctionRecordHash: profileReceipt.payload.recordHash, correctionEvidenceDigest: data(profileReceipt).evidenceDigest,
    deveeCorrectionJob: checkpoint.devee.job.id, qatCorrectionJob: checkpoint.qat.job.id,
    mirrorPublicationReceipt: mirrorPins[0].receiptId, mirrorCheckReceipt: mirrorPins[1].receiptId,
  };
  return { operationId: data(checkpoint.prerequisite).operationId, outcome: stopped, ...evidence, evidenceDigest: digest(evidence) };
}

function assertProfileReceipt(checkpoint, receipt) {
  const evidence = data(receipt)?.evidence;
  check(receipt && nativeRecord(receipt) && isOwner(receipt.creator) && isEvent(receipt, 'salesforce.checkpoint')
    && receipt.payload.previousHash === checkpoint.lastRecordHash && Date.parse(evidence?.observedAt) <= time(receipt) + 1000
    && time(receipt) >= Date.parse(checkpoint.goLiveCompletedAt) && time(receipt) - Date.parse(evidence?.observedAt) < 180000,
  'TRADING_FX_NO_EFFECT_PROFILE_RECEIPT_CHANGED');
  const { originalRunId, originalRunAttempt, originalIntent, originalSubmission, ownershipReceipt,
    originalIntentDigest, originalSubmissionDigest, originalJournalHead, ...readback } = evidence;
  check(same(data(receipt), buildTradingFxSalesSupportNoEffectProfileResult({ checkpoint, evidence: readback })),
    'TRADING_FX_NO_EFFECT_PROFILE_RECEIPT_CHANGED');
}

export function verifyTradingFxSalesSupportNoEffectClosureState({ checkpoint, records }) {
  const chain = validateChain(records, checkpoint.manifestHash, checkpoint.prior.releaseId);
  const [profileReceipt, receipt, ...extra] = chain.slice(prefixLength);
  check(chain.length === records.length && chain[prefixLength - 1]?.payload.recordHash === checkpoint.lastRecordHash
    && new Set(chain.map(row => row.id)).size === chain.length && extra.length === 0,
  'TRADING_FX_NO_EFFECT_CLOSURE_CHANGED');
  if (profileReceipt) assertProfileReceipt(checkpoint, profileReceipt);
  if (receipt) {
    check(nativeRecord(receipt) && isOwner(receipt.creator) && isEvent(receipt, 'prerequisites.result')
      && time(receipt) >= time(profileReceipt) && pendingOperations(chain).length === 0
      && same(data(receipt), buildTradingFxSalesSupportNoEffectPrerequisiteResult({ checkpoint, profileReceipt })),
    'TRADING_FX_NO_EFFECT_CLOSURE_CHANGED');
  } else if (profileReceipt) {
    check(same(pendingOperations(chain), [{ event: 'prerequisites.intent', data: data(checkpoint.prerequisite) }]),
      'TRADING_FX_NO_EFFECT_CLOSURE_CHANGED');
  }
  return { checkpoint, profileReceipt, receipt };
}

export function assertTradingFxNoEffectPreviousAttempt({ previous, runId, runAttempt, profileReceipt }) {
  const [job] = previous.jobs ?? [];
  const steps = TRADING_FX_NO_EFFECT_CLOSURE_STEPS;
  const skipped = name => job?.steps?.find(step => step.name === name)?.conclusion === 'skipped';
  check(previous.jobs?.length === 1 && job.name === steps.job && job.run_id === runId
    && job.run_attempt === runAttempt && job.status === 'completed' && skipped(steps.prerequisites)
    && (profileReceipt || skipped(steps.profile)), 'TRADING_FX_NO_EFFECT_ACKNOWLEDGEMENT_UNCERTAIN');
}

export async function readTradingFxSalesSupportNoEffectClosureState({ github }) {
  const repo = `/repos/${targets().repository}`;
  const runPath = `${repo}/actions/runs/${original.runId}`;
  const [records, run, jobs, reviews, ...mirrors] = await Promise.all([
    github.pages(`${repo}/deployments?environment=${environment}&sha=${original.candidateSha}&per_page=100`),
    github.read(runPath),
    github.read(`${runPath}/attempts/${original.runAttempt}/jobs?per_page=100`),
    github.read(`${runPath}/approvals`),
    ...mirrorPins.map(async pin => {
      const [request, receipt] = await Promise.all([pin.requestId, pin.receiptId].map(id => github.read(`${repo}/deployments/${id}`)));
      return { request, receipt };
    }),
  ]);
  const own = records.filter(row => row.payload?.releaseId === original.releaseId);
  const checkpoint = verifyTradingFxSalesSupportNoEffectCheckpoint({
    records: own.filter(row => row.payload.sequence < prefixLength), run, jobs, reviews, mirrors,
  });
  await assertFrozenWorkflow({ github, controllerSha: original.controllerSha, dispatcherSha: original.dispatcherSha });
  return verifyTradingFxSalesSupportNoEffectClosureState({ checkpoint, records: own });
}

export async function readTradingFxSalesSupportNoEffectClosure({ github, receiptId }) {
  check(positiveId(receiptId), 'TRADING_FX_NO_EFFECT_CLOSURE_REQUIRED');
  const { checkpoint, receipt } = await readTradingFxSalesSupportNoEffectClosureState({ github });
  check(receipt?.id === receiptId, 'TRADING_FX_NO_EFFECT_CLOSURE_REQUIRED');
  return { checkpoint, receipt };
}
