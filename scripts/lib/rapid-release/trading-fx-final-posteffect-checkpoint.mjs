import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../../../config/fcosConnections.js';
import { assertAuthorization, digest, isDigest, requireCondition as check, targets, validateManifest } from './contract.mjs';
import { assertBuildReceipt, assertPreBootstrapProof } from './engine.mjs';
import { DeploymentJournal, pendingOperations, validateChain } from './journal.mjs';
import { readLocalMirrorDeployments, verifyLocalMirrorReceipt } from './local-mirror-handoff.mjs';
import { assertFrozenWorkflow, nativeWorkflowPath } from './providers.mjs';

const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const botId = 41898282;
const repositoryId = 1278654816;
const journalEnvironment = 'fcos-release-journal-v1';
const journalTask = 'fcos-release-journal';
const approvalEnvironment = 'fcos-production-release';
const workflow = '.github/workflows/fcos-rapid-release.yml';
const prefixLength = 48;
const historicalDatabaseOperation = 'trading-fx-hkd-final-preview-mwf7rns1-prerequisites';
const outcome = 'trading_fx_final_package_applied_payment_grant_pending';
const pinnedProduction = Object.freeze({
  inventoryHash: '8a9c471400e28df3f03debef3aa869a47b92ebbb2587dfb8720501a0a45dad71',
  nativeProfileDigest: '928852149c11564a24dc231e0ca7efb6c94b9c4a1cdd09da90a4b79272f206e3',
  catalogDigest: 'd54fbb5847c1f2c92e0600a6255b14fedf64166a4ba2c3e2579f32c611af333e',
  catalogCount: 1364,
  baselineCatalogDigest: '61acc662a0f899fad1261722b38391cba9bb2a32dd67d0ecd7c99b16902d85e5',
  unexpectedReadGrant: Object.freeze({ field: 'Payment__c.Carrying_Adjustment_USD__c', read: true, edit: false }),
});

export const TRADING_FX_FINAL_POSTEFFECT_ORIGINAL = Object.freeze({
  runId: 43747330923,
  attempt: 1,
  releaseId: 'trading-fx-view-all-fields-ordered-recovery-pr219',
  candidateSha: 'b495d1bde6d06834c32212982c4597e20e6c7fe0',
  controllerSha: '3120ee11f952bdbf0713a700f2d24d4bba0d1532',
  dispatcherSha: '79c6b6c7ecfca46dc14963a69dcd9f6ea1262107',
  manifestHash: '2ab29a27db65afb49adfbf60f92c97c947a42ac51196dd19dd532cb3e58b9df3',
  journalHead: '3fa34cb179061cacc2b9d5a7de55e48a6874cfa13817d06d689deca12d17d459',
  journalIdentityDigest: 'c3bb010e0420d3e73f15511f2163a6eaeac4766305616b1fd72d3f07b80a34b5',
  previousId: 'dpl_EybnQs2MEgz3z2M2kJH74i9yGw38',
  previousSha: 'd2e5f1f94898ae99c6188831d071a77c337f31ae',
  stagedId: 'dpl_GGmFVdkTutP89DiM9gozzoDefEu7',
  validationJob: '0Affu000001AHobCAG',
  deploymentJob: '0Affu000001AHqDCAW',
  correctionMirrorCommit: '389f39aecc6e80da7b57f0b78a1748b456b683a8',
});

const original = TRADING_FX_FINAL_POSTEFFECT_ORIGINAL;
const data = row => row?.payload?.data;
const time = row => Date.parse(row?.created_at);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const isBot = person => person?.login === 'github-actions[bot]' && person.id === botId;
const isOwner = person => person?.login === targets().account && person.id === publication.requiredAccountId;
const same = (left, right) => digest(left ?? null) === digest(right ?? null);
const checkpointKey = (fingerprint, stage, operation) => [fingerprint, stage, operation].join(':');
const journalIdentity = row => [row.id, row.created_at, row.creator?.id, row.creator?.login, row.sha, row.ref, row.environment, row.task];
const validRecord = row => positiveId(row.id) && row.sha === original.candidateSha && row.ref === row.sha
  && row.environment === journalEnvironment && row.task === journalTask && isBot(row.creator) && Number.isFinite(time(row));
const runPath = () => `/repos/${targets().repository}/actions/runs/${original.runId}`;

function verifyOriginalRun({ run, jobs, reviews, records }) {
  const approvalRecord = records[5];
  const expectedJobs = [
    ['quality', 132913413657, 'success'],
    ['stage-and-smoke', 132913626963, 'success'],
    ['go-live', 132915631802, 'failure'],
  ];
  const finalReviews = reviews?.filter(review => review.state === 'approved'
    && review.environments?.some(item => item.id === 23178773471 && item.name === approvalEnvironment));
  check(run?.id === original.runId && run.run_attempt === original.attempt && run.repository?.id === repositoryId
    && run.repository.full_name === targets().repository && isOwner(run.actor) && isOwner(run.triggering_actor)
    && run.event === 'workflow_dispatch' && nativeWorkflowPath(run) === workflow && run.head_branch === 'main'
    && run.head_sha === original.dispatcherSha && run.status === 'completed' && run.conclusion === 'failure'
    && run.display_title === `FCOS rapid resume ${original.manifestHash} ${original.candidateSha}`
    && data(approvalRecord)?.runId === run.id && data(approvalRecord).approvedAt === run.created_at
    && finalReviews?.length === 1 && isOwner(finalReviews[0].user),
  'TRADING_FX_FINAL_POSTEFFECT_ORIGINAL_REVIEW_CHANGED');
  check(jobs?.jobs?.length === expectedJobs.length && expectedJobs.every(([name, id, conclusion]) => {
    const job = jobs.jobs.find(row => row.name === name && row.id === id);
    return job?.run_id === original.runId && job.run_attempt === original.attempt && job.status === 'completed'
      && job.conclusion === conclusion && Date.parse(job.completed_at) >= Date.parse(job.started_at);
  }), 'TRADING_FX_FINAL_POSTEFFECT_ORIGINAL_JOBS_CHANGED');
  const staging = jobs.jobs.find(job => job.name === 'stage-and-smoke');
  const goLive = jobs.jobs.find(job => job.name === 'go-live');
  check(Date.parse(staging.completed_at) >= time(records[4]) && Date.parse(goLive.started_at) <= time(approvalRecord)
    && Date.parse(goLive.completed_at) >= time(records[prefixLength - 1]),
  'TRADING_FX_FINAL_POSTEFFECT_ORIGINAL_JOBS_CHANGED');
  return goLive.completed_at;
}

function verifyMirrorHistory({ mirrors, manifest, records }) {
  const repair = manifest.prerequisites.plan.salesSupportRepair;
  const deveeJob = data(records[26]).job.id;
  const context = { fingerprint: repair.correctionFingerprint, binding: { sourceTreeHash: repair.sourceTreeHash } };
  const pins = [
    { receiptId: 7810458626, requestId: 7810427304, sequence: 1, mode: 'publish', binding: records[27], before: records[26], after: records[28] },
    { receiptId: 7810512558, sequence: 2, mode: 'check', binding: records[28], before: records[31], after: records[32] },
  ];
  return pins.map(({ receiptId, requestId, sequence, mode, binding, before, after }) => {
    const receipt = mirrors.find(row => row.id === receiptId);
    const request = mirrors.find(row => row.id === receipt?.payload?.requestId);
    const payload = request?.payload;
    check(positiveId(request?.id) && (requestId === undefined || request.id === requestId)
      && isBot(request.creator) && isOwner(receipt?.creator)
      && payload?.mode === mode && payload.sequence === sequence && payload.manifestHash === original.manifestHash
      && payload.runId === original.runId && payload.runAttempt === original.attempt && payload.candidateSha === original.candidateSha
      && payload.controllerSha === original.controllerSha && payload.correctionSourceSha === repair.sourceCommit
      && payload.deveeOrgId === fcosSalesforceEnvironment('devee').orgId && payload.deploymentJobId === deveeJob
      && payload.validationJobId === null && payload.intentHash === data(binding).evidenceDigest
      && time(request) >= Math.max(time(binding), time(before)) && time(receipt) <= time(after),
    'TRADING_FX_FINAL_POSTEFFECT_HISTORICAL_MIRROR_CHANGED');
    const proof = verifyLocalMirrorReceipt({ request: payload, requestDeployment: request, receiptDeployment: receipt, reviewed: context,
      workflowActorId: botId, publisherId: publication.requiredAccountId, now: time(receipt) });
    check(proof.commit === original.correctionMirrorCommit && proof.pullRequest.number === 9,
      'TRADING_FX_FINAL_POSTEFFECT_HISTORICAL_MIRROR_CHANGED');
    return receipt;
  });
}

export function deriveTradingFxFinalPosteffectSalesforce({ manifest, checkpoints }) {
  const plan = manifest.prerequisites.plan;
  const repair = plan.salesSupportRepair;
  const operations = ['bootstrap', 'validation', 'deployment', 'permission:Fcos_Trading_FX_Data'];
  const resolved = (fingerprint, stage, operation, operationId = `salesforce:${stage}:${operation}`) => {
    const row = data(checkpoints.get(checkpointKey(fingerprint, stage, operation)));
    check(row?.fingerprint === fingerprint && row.stage === stage && row.operation === operation && row.outcome === 'resolved'
      && isDigest(row.evidenceDigest), 'TRADING_FX_FINAL_POSTEFFECT_CHECKPOINT_REQUIRED');
    return { operationId, evidenceDigest: row.evidenceDigest, verified: true, intentRecorded: true };
  };
  const finalCheckpoints = ['devee', 'qat', 'production'].flatMap(stage =>
    operations.map(operation => resolved(plan.salesforceFingerprint, stage, operation)));
  return {
    salesforce: { order: 'devee-mirror-qat-production', mirrorVerified: true, sourceTreeHash: plan.salesforceSourceTreeHash,
      correction: { fingerprint: repair.correctionFingerprint,
        sourceTreeHash: repair.sourceTreeHash, order: 'devee-mirror-qat-production' } },
    completedOperations: [
      ...finalCheckpoints, resolved(plan.salesforceFingerprint, 'shared_mirror', 'publication'),
      resolved(repair.correctionFingerprint, 'devee', 'sales-support-correction'),
      resolved(repair.correctionFingerprint, 'shared_mirror', 'publication', 'salesforce:shared_mirror:sales-support-correction'),
      resolved(repair.correctionFingerprint, 'qat', 'sales-support-correction'),
      resolved(repair.correctionFingerprint, 'production', 'sales-support-correction'),
    ],
  };
}

export function buildTradingFxFinalPosteffectClosure({ verified, evidence }) {
  const { manifest, records, goLiveCompletedAt, staged } = verified;
  const { observedAt, inventoryEvidenceDigest, validationReportDigest, deploymentReportDigest, databaseOperation } = evidence;
  const normalizedDatabaseOperation = { operationId: historicalDatabaseOperation, evidenceDigest: databaseOperation?.evidenceDigest,
    verified: true, intentRecorded: true };
  const normalizedEvidence = { observedAt, baseline: manifest.previous, orgId: fcosSalesforceEnvironment('production').orgId,
    inventoryEvidenceDigest, validationReportDigest, deploymentReportDigest, targetReadGrants: 0, viewAllFieldsEnabled: 0,
    ...pinnedProduction, databaseOperation: normalizedDatabaseOperation };
  check(same(evidence, normalizedEvidence) && [inventoryEvidenceDigest, validationReportDigest, deploymentReportDigest, databaseOperation?.evidenceDigest].every(isDigest)
    && Number.isFinite(Date.parse(observedAt)) && new Date(observedAt).toISOString() === observedAt
    && Date.parse(observedAt) >= Date.parse(goLiveCompletedAt),
  'TRADING_FX_FINAL_POSTEFFECT_NATIVE_READBACK_REQUIRED');

  const { salesforce, completedOperations } = deriveTradingFxFinalPosteffectSalesforce(verified);
  const proof = {
    originalRunId: original.runId, originalAttempt: original.attempt, originalJournalHead: original.journalHead, manifestHash: original.manifestHash,
    originalIntentId: records[6].id, originalApprovalId: records[5].id, stageReceiptId: records[4].id, stagedDeploymentId: staged.id,
    stagedArtifactDigest: staged.artifactDigest, validationJobId: original.validationJob, validationReceiptId: records[41].id,
    deploymentJobId: original.deploymentJob, deploymentReceiptId: records[45].id,
    salesforce, completedOperations, evidence: normalizedEvidence,
  };
  return { state: outcome, ...proof, evidenceDigest: digest(proof) };
}

function assertClosure(verified, result) {
  check(result?.evidence && same(result, buildTradingFxFinalPosteffectClosure({ verified, evidence: result.evidence })),
    'TRADING_FX_FINAL_POSTEFFECT_RESULT_CHANGED');
}

function readClosedSuffix(verified, records, result) {
  const closure = records[prefixLength];
  if (!closure) return null;
  const stored = data(closure)?.result;
  check(closure.payload.event === 'prerequisites.result' && closure.payload.previousHash === original.journalHead
    && time(closure) >= Date.parse(verified.goLiveCompletedAt) && Date.parse(stored?.evidence?.observedAt) <= time(closure) + 999
    && same(data(closure), { operationId: verified.operationId, outcome: 'closed', result: stored })
    && (result === undefined || same(stored, result)) && !pendingOperations(records).length,
  'TRADING_FX_FINAL_POSTEFFECT_CLOSURE_CHANGED');
  assertClosure(verified, stored);
  return { closure, result: stored };
}

export function verifyTradingFxFinalPosteffectCheckpoint({ records, run, jobs, reviews, mirrors }) {
  const chain = validateChain(records, original.manifestHash, original.releaseId);
  const prefix = chain.slice(0, prefixLength);
  check(chain.length === records.length && [prefixLength, prefixLength + 1].includes(chain.length)
    && new Set(chain.map(row => row.id)).size === chain.length && chain.every(validRecord)
    && prefix.at(-1).payload.recordHash === original.journalHead && digest(prefix.map(journalIdentity)) === original.journalIdentityDigest,
  'TRADING_FX_FINAL_POSTEFFECT_ORIGINAL_JOURNAL_CHANGED');
  const [prepared, build, , stage, staging, accepted, intent] = prefix;
  const manifest = data(prepared).manifest;
  const staged = data(stage).result;
  const approval = data(accepted);
  const plan = manifest.prerequisites.plan;
  const operationId = `${manifest.releaseId}-prerequisites`;
  const request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
  check(validateManifest(manifest) === original.manifestHash && manifest.candidate.sha === original.candidateSha
    && manifest.controllerSha === original.controllerSha && manifest.previous.sha === original.previousSha
    && manifest.previous.deploymentId === original.previousId && manifest.prerequisites.adapter === 'trading-fx-prerequisites'
    && plan.salesSupportRepair.viewAllFieldsCorrection === true && staged?.id === original.stagedId && data(stage).outcome === 'applied'
    && accepted.payload.event === 'approval.accepted' && intent.payload.event === 'prerequisites.intent'
    && same(data(intent), { operationId, requestHash: digest(request), request }),
  'TRADING_FX_FINAL_POSTEFFECT_ORIGINAL_MANIFEST_CHANGED');
  assertBuildReceipt(data(build), manifest);
  assertPreBootstrapProof(data(staging), manifest, staged);
  assertAuthorization(approval, manifest, staged, time(accepted));
  const goLiveCompletedAt = verifyOriginalRun({ run, jobs, reviews, records: prefix });
  const checkpoints = new Map(prefix.filter(row => row.payload.event === 'salesforce.checkpoint')
    .map(row => {
      const { fingerprint, stage, operation } = data(row);
      return [checkpointKey(fingerprint, stage, operation), row];
    }));
  check(same(pendingOperations(prefix), [{ event: 'prerequisites.intent', data: data(intent) }])
    && data(prefix[41]).job.id === original.validationJob && data(prefix[45]).job.id === original.deploymentJob
    && data(prefix[45]).job.validationId === original.validationJob && data(prefix[45]).outcome === 'resolved',
  'TRADING_FX_FINAL_POSTEFFECT_PENDING_OPERATION_CHANGED');
  const verified = { manifest, approval, staged, records: chain, checkpoints, goLiveCompletedAt, operationId,
    chainHead: chain.at(-1).payload.recordHash, mirrorReceipts: verifyMirrorHistory({ mirrors, manifest, records: prefix }) };
  const closed = readClosedSuffix(verified, chain);
  return { ...verified, ...(closed ? { closed } : {}) };
}

export async function readTradingFxFinalPosteffectCheckpoint({ github }) {
  assertGitHubTarget(github);
  const endpoint = runPath();
  const [records, run, jobs, reviews, mirrors] = await Promise.all([
    readRawJournal(github), github.read(endpoint), github.read(`${endpoint}/attempts/${original.attempt}/jobs?per_page=100`),
    github.read(`${endpoint}/approvals`), readLocalMirrorDeployments(github, original.candidateSha),
  ]);
  const verified = verifyTradingFxFinalPosteffectCheckpoint({ records, run, jobs, reviews, mirrors });
  await assertFrozenWorkflow({ github, controllerSha: original.controllerSha, dispatcherSha: original.dispatcherSha });
  return verified;
}

export async function readTradingFxFinalPosteffectClosed({ github }) {
  const verified = await readTradingFxFinalPosteffectCheckpoint({ github });
  check(verified.closed, 'TRADING_FX_FINAL_POSTEFFECT_CLOSURE_REQUIRED');
  return verified;
}

function assertGitHubTarget(github) {
  check(github?.candidateSha === original.candidateSha, 'TRADING_FX_FINAL_POSTEFFECT_GITHUB_TARGET_CHANGED');
}

async function readRawJournal(github) {
  const path = `/repos/${targets().repository}/deployments?environment=${journalEnvironment}&sha=${original.candidateSha}&per_page=100`;
  return (await github.pages(path)).filter(row => row.payload?.releaseId === original.releaseId);
}

export async function appendTradingFxFinalPosteffect({ github, verified, result, readbackOnly = false }) {
  assertGitHubTarget(github);
  const { user, repo } = await github.identity();
  check(isBot(user) && repo?.id === repositoryId && repo.full_name === targets().repository
    && isOwner(repo.owner) && repo.default_branch === 'main' && repo.archived === false,
  'TRADING_FX_FINAL_POSTEFFECT_BOT_REQUIRED');
  const current = await readTradingFxFinalPosteffectCheckpoint({ github });
  check(current.operationId === verified.operationId && same(current.manifest, verified.manifest)
    && same(current.approval, verified.approval) && same(current.staged, verified.staged)
    && verified.records?.[prefixLength - 1]?.payload.recordHash === original.journalHead,
  'TRADING_FX_FINAL_POSTEFFECT_ORIGINAL_JOURNAL_CHANGED');
  assertClosure(current, result);
  const existing = readClosedSuffix(current, current.records, result);
  if (existing) return existing;
  check(!readbackOnly, 'TRADING_FX_FINAL_POSTEFFECT_ACK_UNCERTAIN');
  const age = Date.now() - Date.parse(result.evidence.observedAt);
  check(age >= -30_000 && age <= 300_000, 'TRADING_FX_FINAL_POSTEFFECT_READBACK_STALE');

  const journal = new DeploymentJournal({ github, releaseId: original.releaseId, manifestHash: original.manifestHash, actorIds: [botId] });
  try {
    await journal.append('prerequisites.result', { operationId: current.operationId, outcome: 'closed', result },
      { expectedPreviousHash: original.journalHead });
  } catch { /* Reconcile only the original append. */ }
  const raw = await readRawJournal(github);
  const chain = validateChain(raw, original.manifestHash, original.releaseId);
  check(chain.length === raw.length && [prefixLength, prefixLength + 1].includes(chain.length)
    && new Set(chain.map(row => row.id)).size === chain.length && chain.every(validRecord)
    && chain[prefixLength - 1].payload.recordHash === original.journalHead
    && digest(chain.slice(0, prefixLength).map(journalIdentity)) === original.journalIdentityDigest,
  'TRADING_FX_FINAL_POSTEFFECT_ORIGINAL_JOURNAL_CHANGED');
  const saved = readClosedSuffix(current, chain, result);
  check(saved, 'TRADING_FX_FINAL_POSTEFFECT_ACK_UNCERTAIN');
  return saved;
}
