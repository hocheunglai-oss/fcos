import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';
import { salesSupportRepairFields } from '../scripts/lib/rapid-release/trading-fx-sales-support-repair.mjs';
import {
  TRADING_FX_NO_EFFECT_CLOSURE_STEPS as steps,
  TRADING_FX_NO_EFFECT_ORIGINAL as original,
  assertTradingFxNoEffectPreviousAttempt,
  buildTradingFxSalesSupportNoEffectPrerequisiteResult,
  buildTradingFxSalesSupportNoEffectProfileResult,
  verifyTradingFxSalesSupportNoEffectClosureState,
  verifyTradingFxSalesSupportNoEffectReadback,
} from '../scripts/lib/rapid-release/trading-fx-sales-support-no-effect-checkpoint.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const owner = { login: targets().account, id: policy.publication.requiredAccountId };
const bot = { login: 'github-actions[bot]', id: 41898282 };
const production = fcosSalesforceEnvironment('production');
const observedAt = '2026-11-16T03:00:01.000Z';

function fixture() {
  const baseline = { sha: original.previousSha, deploymentId: original.previousId,
    configurationDigest: digest('configuration'), schemaDigest: digest('schema') };
  const inventory = { orgId: production.orgId, inventoryHash: original.inventoryHash, evidenceSha256: digest('inventory') };
  const catalog = { target: salesSupportRepairFields.map(field => ({ field, read: true, edit: false })),
    unrelatedCount: 1363, unrelatedDigest: '61acc662a0f899fad1261722b38391cba9bb2a32dd67d0ecd7c99b16902d85e5' };
  const report = {
    id: original.productionJob, status: 'Succeeded', success: true, done: true, checkOnly: false, rollbackOnError: true,
    startDate: original.productionJobStartedAt, completedDate: original.productionJobCompletedAt,
    numberComponentsTotal: 1, numberComponentsDeployed: 1, numberComponentErrors: 0, numberTestErrors: 0,
    numberTestsTotal: 0, numberTestsCompleted: 0, details: { componentSuccesses: [
      { componentType: 'Profile', fullName: 'Sales Support', fileName: 'zip/profiles/Sales Support.profile',
        success: true, created: false, deleted: false },
      { componentType: '', fullName: 'package.xml', fileName: 'zip/package.xml',
        success: true, created: false, deleted: false },
    ] },
  };
  const operation = 'sales-support-correction';
  const stage = 'production';
  const fingerprint = digest('original correction');
  const job = { id: original.productionJob, submittedAt: '2026-11-15T15:39:43.858Z', validationId: null,
    packageSha256: digest('original package') };
  const receiptId = digest({ manifestHash: original.manifestHash, runId: original.runId, fingerprint, stage,
    orgId: production.orgId, operation });
  const request = { status: 'submitting', jobId: null, validationJobId: null, submittedAt: job.submittedAt,
    packageSha256: job.packageSha256, beforeDigest: digest(catalog), receiptId };
  const records = [];
  const append = (event, data, id, creator = bot, created_at = '2026-11-15T15:40:00Z') => {
    const payload = { schemaVersion: 1, kind: 'fcos_rapid_release_event', manifestHash: original.manifestHash,
      releaseId: original.releaseId, event, data, sequence: records.length, previousHash: records.at(-1)?.payload.recordHash ?? null };
    const row = { payload: { ...payload, recordHash: digest(payload) }, id, creator, created_at,
      task: 'fcos-release-journal', environment: 'fcos-release-journal-v1', sha: original.candidateSha, ref: original.candidateSha };
    records.push(row);
    return row;
  };
  while (records.length < 5) append('obstacle.detected', {}, records.length + 100);
  const approval = append('approval.accepted', {}, 7805547474);
  const prerequisite = append('prerequisites.intent', { operationId: original.releaseId + '-prerequisites' }, 7805549413);
  while (records.length < 32) append('obstacle.detected', {}, records.length + 100);
  const pending = { fingerprint, stage, operation, outcome: 'pending' };
  const intent = append('salesforce.checkpoint', { ...pending, job: { ...job, id: null }, evidenceDigest: digest(request) }, 7805737714);
  const submitted = append('salesforce.checkpoint',
    { ...pending, job, evidenceDigest: digest({ ...request, status: 'submitted', jobId: job.id }) }, 7805738155);
  append('salesforce.checkpoint', { fingerprint, stage, operation: 'restoration-checkpoint', outcome: 'evidence' }, 7805740787);
  const head = append('obstacle.detected', {}, 7805740922);
  const checkpoint = { prior: { releaseId: original.releaseId, previous: baseline }, runId: original.runId, runAttempt: original.runAttempt,
    manifestHash: original.manifestHash, lastRecordHash: head.payload.recordHash, goLiveCompletedAt: '2026-11-15T15:40:03Z',
    approval, prerequisite, staged: { id: original.stagedId }, productionCorrection: { intent, submitted, job },
    devee: { job: { id: '0AfHF000007H5Yj0AK' } }, qat: { job: { id: '0AfBh000006k17KKAQ' } } };
  return { checkpoint, baseline, report, catalog, inventory, observedAt, records, append };
}

function profileFixture() {
  const f = fixture();
  const evidence = verifyTradingFxSalesSupportNoEffectReadback(f);
  const data = buildTradingFxSalesSupportNoEffectProfileResult({ checkpoint: f.checkpoint, evidence });
  const profileReceipt = f.append('salesforce.checkpoint', data, 800, owner, '2026-11-16T03:00:20Z');
  return { ...f, evidence, profileReceipt };
}

test('the original no-effect readback closes the original two pending operations in order', () => {
  const f = profileFixture();
  assert.equal(pendingOperations(f.records.slice(0, -1)).length, 2);
  assert.equal(pendingOperations(f.records).length, 1);
  const { checkpoint, profileReceipt } = verifyTradingFxSalesSupportNoEffectClosureState(f);
  assert.equal(profileReceipt.payload.data.job.id, original.productionJob);
  assert.equal(profileReceipt.payload.data.terminalOutcome, 'succeeded_without_effect');
  assert.equal(profileReceipt.payload.data.evidence.originalSubmission, 7805738155);
  assert.equal(profileReceipt.payload.data.evidence.targetReads, 23);
  assert.equal(profileReceipt.payload.data.evidence.targetEdits, 0);
  assert.equal(profileReceipt.payload.data.evidence.unrelatedCount, 1363);
  const stopped = buildTradingFxSalesSupportNoEffectPrerequisiteResult({ checkpoint, profileReceipt });
  const receipt = f.append('prerequisites.result', stopped, 801, owner, '2026-11-16T03:00:25Z');
  assert.equal(receipt.payload.data.originalIntent, 7805549413);
  assert.equal(receipt.payload.data.correctionReceipt, profileReceipt.id);
  assert.equal(receipt.payload.data.mirrorPublicationReceipt, 7805688017);
  assert.equal(receipt.payload.data.mirrorCheckReceipt, 7805731234);
  assert.equal(stopped.outcome, 'trading_fx_stopped_after_ineffective_production_profile_correction');
  assert.equal(stopped.result, undefined);
  assert.equal(verifyTradingFxSalesSupportNoEffectClosureState(f).receipt, receipt);
  assert.equal(pendingOperations(f.records).length, 0);
});

test('readback refuses changed provider job, metadata scope, current grants, inventory, alias and original ownership', () => {
  for (const [change, error] of [
    [f => { f.report.id = '0Affu000001OTHERAB'; }, /ORIGINAL_REPORT_CHANGED/],
    [f => { f.report.details.componentSuccesses[0].deleted = true; }, /ORIGINAL_REPORT_CHANGED/],
    [f => { f.report.details.componentFailures = [{}]; }, /ORIGINAL_REPORT_CHANGED/],
    [f => { f.catalog.target[0].read = false; }, /CURRENT_GRANTS_CHANGED/],
    [f => { f.catalog.target[0].edit = true; }, /CURRENT_GRANTS_CHANGED/],
    [f => { f.catalog.unrelatedDigest = digest('drift'); }, /CURRENT_GRANTS_CHANGED/],
    [f => { f.inventory.inventoryHash = digest('different owned tree'); }, /READBACK_REQUIRED/],
    [f => { f.baseline = { ...f.baseline, deploymentId: original.stagedId }; }, /READBACK_REQUIRED/],
    [f => { f.observedAt = '2026-11-15T15:39:00Z'; }, /READBACK_REQUIRED/],
    [f => { f.checkpoint.productionCorrection.intent.payload.data.evidenceDigest = digest('different owner'); }, /ORIGINAL_PREIMAGE_CHANGED/],
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => verifyTradingFxSalesSupportNoEffectReadback(f), error);
  }
});

test('stopped readback requires both exact owner records and rejects wrong ordering and an unexpected tail', () => {
  const wrongActor = profileFixture();
  wrongActor.profileReceipt.creator = bot;
  assert.throws(() => verifyTradingFxSalesSupportNoEffectClosureState(wrongActor), /PROFILE_RECEIPT_CHANGED/);
  const stale = profileFixture();
  stale.profileReceipt.created_at = '2026-11-16T03:03:03Z';
  assert.throws(() => verifyTradingFxSalesSupportNoEffectClosureState(stale), /PROFILE_RECEIPT_CHANGED/);
  const wrongOrder = fixture();
  wrongOrder.append('prerequisites.result', { operationId: wrongOrder.checkpoint.prerequisite.payload.data.operationId },
    801, owner, '2026-11-16T03:00:25Z');
  assert.throws(() => verifyTradingFxSalesSupportNoEffectClosureState(wrongOrder), /PROFILE_RECEIPT_CHANGED/);
  const applied = profileFixture();
  const stopped = buildTradingFxSalesSupportNoEffectPrerequisiteResult(applied);
  applied.append('prerequisites.result', { ...stopped, outcome: 'applied' }, 801, owner, '2026-11-16T03:00:25Z');
  assert.throws(() => verifyTradingFxSalesSupportNoEffectClosureState(applied), /CLOSURE_CHANGED/);
  const unexpected = profileFixture();
  const result = buildTradingFxSalesSupportNoEffectPrerequisiteResult(unexpected);
  unexpected.append('prerequisites.result', result, 801, owner, '2026-11-16T03:00:25Z');
  unexpected.append('promote.intent', { operationId: 'forbidden' }, 802, bot, '2026-11-16T03:00:30Z');
  assert.throws(() => verifyTradingFxSalesSupportNoEffectClosureState(unexpected), /CLOSURE_CHANGED/);
});

test('rerun accepts only skipped appends or an exact existing profile receipt', () => {
  const runId = 2, runAttempt = 1;
  const previous = (profile, prerequisites) => ({ jobs: [{ run_id: runId, run_attempt: runAttempt, name: steps.job,
    status: 'completed', steps: [{ name: steps.profile, conclusion: profile }, { name: steps.prerequisites, conclusion: prerequisites }] }] });
  const check = (profile, prerequisites, profileReceipt) => assertTradingFxNoEffectPreviousAttempt({
    previous: previous(profile, prerequisites), runId, runAttempt, profileReceipt,
  });
  const { profileReceipt } = profileFixture();
  check('skipped', 'skipped');
  check('failure', 'skipped', profileReceipt);
  assert.throws(() => check('failure', 'skipped'), /ACKNOWLEDGEMENT_UNCERTAIN/);
  assert.throws(() => check('success', 'failure', profileReceipt), /ACKNOWLEDGEMENT_UNCERTAIN/);
  assert.throws(() => check('skipped', undefined), /ACKNOWLEDGEMENT_UNCERTAIN/);
});

test('protected workflow keeps provider credentials out of the append steps', () => {
  const workflow = readFileSync(new URL('../.github/workflows/fcos-rapid-trading-fx-sales-support-no-effect-closure.yml', import.meta.url), 'utf8');
  const profile = workflow.indexOf(steps.profile);
  const prerequisites = workflow.indexOf(steps.prerequisites);
  assert.ok(profile > 0 && prerequisites > profile);
  assert.match(workflow, /environment: fcos-production-release/u);
  assert.match(workflow, /group: fcos-production-release\s+cancel-in-progress: false/u);
  assert.match(workflow, /github\.ref_protected/u);
  assert.match(workflow.slice(0, profile), /FCOS_RAPID_READONLY_DATABASE_URL/u);
  assert.doesNotMatch(workflow.slice(profile), /FCOS_RAPID_DATABASE|VERCEL_TOKEN|SALESFORCE/u);
});
