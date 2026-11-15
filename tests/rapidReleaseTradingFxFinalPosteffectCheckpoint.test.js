import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { createLocalMirrorRequest, createLocalMirrorReceipt, LOCAL_MIRROR_ENVIRONMENT } from '../scripts/lib/rapid-release/local-mirror-handoff.mjs';
import {
  appendTradingFxFinalPosteffect, buildTradingFxFinalPosteffectClosure, deriveTradingFxFinalPosteffectSalesforce,
  readTradingFxFinalPosteffectCheckpoint, readTradingFxFinalPosteffectClosed, TRADING_FX_FINAL_POSTEFFECT_ORIGINAL as original,
} from '../scripts/lib/rapid-release/trading-fx-final-posteffect-checkpoint.mjs';
import { REVIEWED_SALESFORCE_MODE } from '../scripts/lib/salesforce-reviewed-release.mjs';

const normalFingerprint = digest('original review');
const correctionFingerprint = digest('Sales Support');
const manifest = {
  previous: { deploymentId: original.previousId, sha: original.previousSha },
  prerequisites: { plan: { salesforceFingerprint: normalFingerprint, salesforceSourceTreeHash: digest('original tree'),
    salesSupportRepair: { correctionFingerprint, sourceTreeHash: digest('corrected tree') } } },
};
const operations = ['bootstrap', 'validation', 'deployment', 'permission:Fcos_Trading_FX_Data'];
const productionEvidence = {
  orgId: fcosSalesforceEnvironment('production').orgId,
  inventoryHash: '8a9c471400e28df3f03debef3aa869a47b92ebbb2587dfb8720501a0a45dad71',
  nativeProfileDigest: '928852149c11564a24dc231e0ca7efb6c94b9c4a1cdd09da90a4b79272f206e3',
  catalogDigest: 'd54fbb5847c1f2c92e0600a6255b14fedf64166a4ba2c3e2579f32c611af333e',
  catalogCount: 1364,
  baselineCatalogDigest: '61acc662a0f899fad1261722b38391cba9bb2a32dd67d0ecd7c99b16902d85e5',
  unexpectedReadGrant: { field: 'Payment__c.Carrying_Adjustment_USD__c', read: true, edit: false },
  targetReadGrants: 0,
  viewAllFieldsEnabled: 0,
  inventoryEvidenceDigest: digest('native inventory'),
  validationReportDigest: digest('native validation'),
  deploymentReportDigest: digest('native deployment'),
  databaseOperation: { operationId: 'trading-fx-hkd-final-preview-mwf7rns1-prerequisites', evidenceDigest: digest('database'),
    verified: true, intentRecorded: true },
};
const sampleEvidence = verified => ({ ...productionEvidence, observedAt: new Date().toISOString(), baseline: verified.manifest.previous });

function projectedCheckpoints() {
  const checkpoints = new Map();
  const set = (fingerprint, stage, operation) => {
    const key = `${fingerprint}:${stage}:${operation}`;
    checkpoints.set(key, { payload: { data: { fingerprint, stage, operation, outcome: 'resolved', evidenceDigest: digest(key) } } });
  };
  for (const stage of ['devee', 'qat', 'production']) {
    for (const operation of operations) set(normalFingerprint, stage, operation);
    set(correctionFingerprint, stage, 'sales-support-correction');
  }
  set(normalFingerprint, 'shared_mirror', 'publication');
  set(correctionFingerprint, 'shared_mirror', 'publication');
  return checkpoints;
}

test('retains both exact mirror fingerprints and every resolved provider operation', () => {
  const checkpoints = projectedCheckpoints();
  const scoped = deriveTradingFxFinalPosteffectSalesforce({ manifest, checkpoints });
  assert.equal(scoped.completedOperations.length, 17);
  assert.equal(new Set(scoped.completedOperations.map(row => row.operationId)).size, 17);
  const mirror = name => scoped.completedOperations.find(row => row.operationId === 'salesforce:shared_mirror:' + name);
  assert.equal(mirror('publication').evidenceDigest, digest(normalFingerprint + ':shared_mirror:publication'));
  assert.equal(mirror('sales-support-correction').evidenceDigest, digest(correctionFingerprint + ':shared_mirror:publication'));
  assert.equal(scoped.salesforce.correction.fingerprint, correctionFingerprint);
  assert.equal(Object.hasOwn(scoped.salesforce, 'fingerprint'), false);
  checkpoints.delete(correctionFingerprint + ':production:sales-support-correction');
  assert.throws(() => deriveTradingFxFinalPosteffectSalesforce({ manifest, checkpoints }), /CHECKPOINT_REQUIRED/u);
});

test('the terminal reason binds the confirmed grant, original Production jobs and exact historical database operation', () => {
  const verified = { manifest, checkpoints: projectedCheckpoints(),
    goLiveCompletedAt: '2026-01-01T00:00:00.000Z', staged: { id: original.stagedId, artifactDigest: digest('stage') },
    records: Array.from({ length: 48 }, (_, index) => ({ id: 1 + index })) };
  const evidence = sampleEvidence(verified);
  const closure = buildTradingFxFinalPosteffectClosure({ verified, evidence });
  const { state, evidenceDigest, ...body } = closure;
  assert.equal(state, 'trading_fx_final_package_applied_payment_grant_pending');
  assert.equal(evidenceDigest, digest(body));
  assert.equal(closure.validationJobId, original.validationJob);
  assert.equal(closure.deploymentJobId, original.deploymentJob);
  assert.equal(closure.originalIntentId, 7);
  assert.equal(closure.completedOperations.length, 17);
  for (const changed of [
    { unexpectedReadGrant: { ...evidence.unexpectedReadGrant, edit: true } },
    { targetReadGrants: 1 },
    { viewAllFieldsEnabled: 1 },
    { catalogCount: 1363 },
    { catalogDigest: digest('another catalog') },
    { inventoryHash: digest('another inventory') },
    { baseline: { ...evidence.baseline, sha: original.candidateSha } },
    { inventoryEvidenceDigest: 'provider raw response' },
    { databaseOperation: { ...evidence.databaseOperation, operationId: 'new submission' } },
    { databaseOperation: { ...evidence.databaseOperation, verified: false } },
    { observedAt: '2025-12-31T00:00:00.000Z' },
  ]) assert.throws(() => buildTradingFxFinalPosteffectClosure({ verified, evidence: { ...evidence, ...changed } }),
    /NATIVE_READBACK_REQUIRED/u);
});

const archive = process.env.FCOS_TRADING_FX_FINAL_POSTEFFECT_TEST_JOURNAL;
const workflow = '.github/workflows/fcos-rapid-release.yml';
const { publication } = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const owner = { id: publication.requiredAccountId, login: targets().account };
const bot = { id: 41898282, login: 'github-actions[bot]' };
const repo = { id: 1278654816, full_name: targets().repository, owner, default_branch: 'main', archived: false };

function mockArchive() {
  const records = JSON.parse(readFileSync(archive));
  const manifest = records[0].payload.data.manifest;
  const acceptance = records[5].payload.data;
  const repair = manifest.prerequisites.plan.salesSupportRepair;
  const deveeOrg = fcosSalesforceEnvironment('devee');
  const jobId = records[26].payload.data.job.id;
  const reviewed = { fingerprint: repair.correctionFingerprint,
    binding: { sourceTreeHash: repair.sourceTreeHash, orgIds: { devee: deveeOrg.orgId } } };
  const mirrorCommit = original.correctionMirrorCommit;
  const mirrorBranch = 'reviewed-draft';
  const report = { releaseMode: REVIEWED_SALESFORCE_MODE, sourceTreeHash: repair.sourceTreeHash, sourceEnvironment: 'devee',
    sourceDeploymentJobId: jobId, repository: publication.repository, account: targets().account,
    branch: mirrorBranch, commit: mirrorCommit, pullRequest: { number: 9, state: 'OPEN', isDraft: true,
      baseRefName: publication.defaultBranch, headRefName: mirrorBranch, headRefOid: mirrorCommit } };
  const mirrorPair = (requestId, receiptId, mode, sequence, boundIndex, boundaryIndex) => {
    const createdAt = Date.parse(records[boundaryIndex].created_at) + 2000;
    const native = (id, creator, payload, timestamp) => ({
      id, creator, payload, sha: original.candidateSha, environment: LOCAL_MIRROR_ENVIRONMENT, created_at: new Date(timestamp).toISOString(),
    });
    const request = createLocalMirrorRequest({ manifest, approval: acceptance, reviewed,
      deployment: { status: 'Succeeded', fingerprint: repair.correctionFingerprint, orgId: deveeOrg.orgId,
        jobId, validationJobId: null },
      intentHash: records[boundIndex].payload.data.evidenceDigest, runAttempt: original.attempt, mode, sequence,
      now: createdAt, expiresAt: new Date(createdAt + 60_000).toISOString() });
    return [native(requestId, bot, request, createdAt), native(receiptId, owner,
      createLocalMirrorReceipt({ request, requestId, reviewed, report }), createdAt + 1000)];
  };
  const mirrors = [
    ...mirrorPair(7810427304, 7810458626, 'publish', 1, 27, 27),
    ...mirrorPair(7810499901, 7810512558, 'check', 2, 28, 31),
  ];
  const run = { id: original.runId, run_attempt: original.attempt, repository: repo, actor: owner, triggering_actor: owner,
    event: 'workflow_dispatch', path: workflow + '@main', head_branch: 'main', head_sha: original.dispatcherSha,
    status: 'completed', conclusion: 'failure', created_at: acceptance.approvedAt,
    display_title: `FCOS rapid resume ${original.manifestHash} ${original.candidateSha}` };
  const nativeJob = (name, id, conclusion, started_at, completed_at) => ({
    name, id, conclusion, started_at, completed_at, run_id: original.runId, run_attempt: original.attempt, status: 'completed',
  });
  const jobs = { jobs: [
    nativeJob('quality', 132913413657, 'success', records[0].created_at, records[1].created_at),
    nativeJob('stage-and-smoke', 132913626963, 'success', records[2].created_at, records[4].created_at),
    nativeJob('go-live', 132915631802, 'failure', records[4].created_at, records[47].created_at),
  ] };
  const reviews = [{ state: 'approved', user: owner, environments: [{ id: 23178773471, name: 'fcos-production-release' }] }];
  let writes = 0;
  const state = { loseAcknowledgement: false, refuseWrite: false, writer: bot };
  const base = `/repos/${targets().repository}/actions/runs/${original.runId}`;
  const github = {
    candidateSha: original.candidateSha,
    identity: async () => ({ user: state.writer, repo }),
    async read(path) {
      if (path.includes('/contents/')) return { type: 'file', sha: '1'.repeat(40) };
      if (path === base) return run;
      if (path === base + '/attempts/1/jobs?per_page=100') return jobs;
      if (path === base + '/approvals') return reviews;
      assert.fail('Unexpected native read');
    },
    pages: async path => structuredClone(path.includes(LOCAL_MIRROR_ENVIRONMENT) ? mirrors : records),
    async write(path, request) {
      ++writes;
      assert.equal(path, `/repos/${targets().repository}/deployments`);
      assert.equal(request.ref, original.candidateSha);
      assert.equal(request.payload.event, 'prerequisites.result');
      assert.equal(request.payload.previousHash, original.journalHead);
      assert.equal(request.payload.data.outcome, 'closed');
      if (state.refuseWrite) throw new Error('Unknown write outcome');
      records.push({
        id: 7810999001, ref: request.ref, sha: request.ref, environment: request.environment, task: request.task,
        creator: state.writer, payload: request.payload, created_at: new Date().toISOString(),
      });
      if (state.loseAcknowledgement) throw new Error('Lost original acknowledgement');
    },
  };
  return { github, records, mirrors, state, run, reviews, jobs, writes: () => writes };
}

if (archive) {
  test('the native 48-record prefix binds the exact terminal run, both historical mirrors and the final job IDs', async () => {
    const native = mockArchive();
    const verified = await readTradingFxFinalPosteffectCheckpoint(native);
    assert.equal(verified.records.length, 48);
    assert.equal(verified.chainHead, original.journalHead);
    assert.equal(verified.approval.runId, original.runId);
    assert.equal(verified.mirrorReceipts.length, 2);
    for (const mutate of [
      mock => { mock.run.run_attempt = 2; },
      mock => { mock.jobs.jobs[2].id += 1; },
      mock => { mock.reviews[0].user = bot; },
      mock => { mock.records[45].creator = owner; },
      mock => { mock.records.push(mock.records.at(-1)); },
      mock => { mock.mirrors[3].creator = bot; },
    ]) {
      const invalid = mockArchive();
      mutate(invalid);
      await assert.rejects(readTradingFxFinalPosteffectCheckpoint(invalid));
      assert.equal(invalid.writes(), 0);
    }
  });

  test('a lost acknowledgement reads the original closed result once and the exact successor can read it', async () => {
    const native = mockArchive();
    const verified = await readTradingFxFinalPosteffectCheckpoint(native);
    const result = buildTradingFxFinalPosteffectClosure({ verified, evidence: sampleEvidence(verified) });
    native.state.loseAcknowledgement = true;
    const request = { github: native.github, verified, result };
    const closure = await appendTradingFxFinalPosteffect(request);
    assert.equal(closure.closure.payload.data.outcome, 'closed');
    assert.equal(native.writes(), 1);
    assert.deepEqual(await appendTradingFxFinalPosteffect({ ...request, readbackOnly: true }), closure);
    assert.deepEqual((await readTradingFxFinalPosteffectClosed(native)).closed, closure);
    assert.equal(native.writes(), 1);
    const conflicting = buildTradingFxFinalPosteffectClosure({ verified,
      evidence: { ...result.evidence, deploymentReportDigest: digest('conflicting report') } });
    await assert.rejects(appendTradingFxFinalPosteffect({ ...request, result: conflicting }), /CLOSURE_CHANGED/u);
    assert.equal(native.writes(), 1);
  });

  test('unobserved writes, missing closure and the wrong actor preserve the original pending intent', async () => {
    const native = mockArchive();
    const verified = await readTradingFxFinalPosteffectCheckpoint(native);
    const request = { github: native.github, verified,
      result: buildTradingFxFinalPosteffectClosure({ verified, evidence: sampleEvidence(verified) }) };
    await assert.rejects(readTradingFxFinalPosteffectClosed(native), /CLOSURE_REQUIRED/u);
    native.state.writer = owner;
    await assert.rejects(appendTradingFxFinalPosteffect(request), /BOT_REQUIRED/u);
    assert.equal(native.writes(), 0);
    native.state.writer = bot;
    native.state.refuseWrite = true;
    await assert.rejects(appendTradingFxFinalPosteffect(request), /ACK_UNCERTAIN/u);
    await assert.rejects(appendTradingFxFinalPosteffect({ ...request, readbackOnly: true }), /ACK_UNCERTAIN/u);
    assert.equal(native.writes(), 1);
    assert.equal(native.records.length, 48);
  });
}
