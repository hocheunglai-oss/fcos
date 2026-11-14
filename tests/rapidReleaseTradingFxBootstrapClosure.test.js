import assert from 'node:assert/strict';
import test from 'node:test';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';
import { failedBootstrapClosure, TRADING_FX_FAILED_BOOTSTRAP } from '../scripts/lib/rapid-release/trading-fx-failed-bootstrap-closure.mjs';

function fixture() {
  const hash = 'a'.repeat(64);
  const sha = 'b'.repeat(40);
  const runId = 123;
  const manifest = createManifest({ candidate: { sha, sourceDigest: hash, lockDigest: hash }, controllerSha: 'c'.repeat(40),
    previous: { deploymentId: 'dpl_baseline', sha: 'd'.repeat(40), schemaDigest: hash, configurationDigest: hash },
    paths: ['force-app/main/default/classes/Example.cls', 'supabase/migrations/example.sql'],
    publicEnvironment: { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(25)}` },
    releaseId: 'terminal-bootstrap-fixture', prerequisites: { adapter: 'trading-fx-prerequisites', adapterDigest: hash,
      plan: { salesforceFingerprint: hash, xeroQualificationDeploymentId: 112, xeroQualificationDigest: hash } } });
  const entry = (id, event, data) => ({
    id, creator: { id: 41898282 },
    payload: { manifestHash: digest(manifest), releaseId: manifest.releaseId, recordHash: digest(id.toString()), event, data },
  });
  const job = { id: '0Af000000000000AAA', validationId: null, packageSha256: hash, submittedAt: '2026-11-14T08:20:20.077Z' };
  const operationId = manifest.releaseId + '-prerequisites';
  const request = { planDigest: digest(manifest.prerequisites), candidateSha: sha };
  const chain = [
    entry(1, 'approval.accepted', { runId }),
    entry(2, 'prerequisites.intent', { operationId, request, requestHash: digest(request) }),
    entry(3, 'salesforce.checkpoint', { stage: 'production', operation: 'bootstrap', outcome: 'pending',
      fingerprint: hash, evidenceDigest: hash, job }),
  ];
  const report = { id: job.id, done: true, status: 'Failed', checkOnly: false, rollbackOnError: true,
    details: { componentFailures: [{ fullName: 'Fcos_Trading_FX_Setting__c' }] } };
  const orgId = '00D2x000000Ei4oEAC';
  return { chain, manifest, runId, report, expectedInventoryHash: hash, orgId,
    inventory: { orgId, inventoryHash: hash, evidenceSha256: hash }, mirrorReceipt: 304, databaseClosure: 305 };
}

test('terminal bootstrap closure seals the stopped release before releasing the other-release fence', () => {
  const input = fixture();
  const closure = failedBootstrapClosure(input);
  assert.equal(closure.expectedPreviousHash, input.chain.at(-1).payload.recordHash);
  assert.equal(closure.result.outcome, TRADING_FX_FAILED_BOOTSTRAP);
  assert.equal(closure.checkpoint.terminalOutcome, 'failed_rolled_back');
  assert.equal(closure.checkpoint.evidenceDigest, closure.result.evidenceDigest);
  const closed = [...input.chain, { payload: { event: 'prerequisites.result', data: closure.result } }];
  assert.deepEqual(pendingOperations(closed).map(row => row.event), ['salesforce.checkpoint']);
  assert.deepEqual(pendingOperations([...closed, { payload: { event: 'salesforce.checkpoint', data: closure.checkpoint } }]), []);
});

test('terminal bootstrap closure refuses changed job, approval, baseline or rollback evidence', () => {
  const input = fixture();
  for (const report of [
    { ...input.report, id: '0Af000000000001AAA' },
    { ...input.report, done: false },
    { ...input.report, rollbackOnError: false },
    { ...input.report, checkOnly: true },
    { ...input.report, status: 'Succeeded' },
  ]) assert.throws(() => failedBootstrapClosure({ ...input, report }), /TERMINAL_REPORT_REQUIRED/);
  assert.throws(() => failedBootstrapClosure({ ...input, inventory: { ...input.inventory, inventoryHash: 'f'.repeat(64) } }), /ROLLBACK_PROOF_REQUIRED/);
  assert.throws(() => failedBootstrapClosure({ ...input, runId: 456 }), /ORIGINAL_RELEASE_MISMATCH/);
  input.chain[1].payload.data.request.candidateSha = 'f'.repeat(40);
  assert.throws(() => failedBootstrapClosure(input), /ORIGINAL_RELEASE_MISMATCH/);
});

test('Trading FX only bridges the completed, unchanged manual predecessor', async () => {
  const { verifyTradingFxManualPredecessor } = await import('../scripts/lib/rapid-release/trading-fx-failed-bootstrap-closure.mjs');
  const hash = 'a'.repeat(64), previous = { previous: {
    sha: '91a5298b44c7cadb968a614ff79d3934a8f41c9c', deploymentId: 'dpl_nomination',
    schemaDigest: hash, configurationDigest: hash,
  } };
  const manifest = { candidate: { sha: 'b495d1bde6d06834c32212982c4597e20e6c7fe0' }, previous: {
    ...previous.previous, sha: 'd2e5f1f94898ae99c6188831d071a77c337f31ae', deploymentId: 'dpl_EybnQs2MEgz3z2M2kJH74i9yGw38',
  } };
  let reads = 0;
  const github = { pages: async () => { reads++; return []; } };
  const input = { manifest, previous, github, ownerId: 7 };
  await assert.rejects(verifyTradingFxManualPredecessor(input), /MANUAL_PREDECESSOR_NOT_COMPLETE/);
  assert.equal(reads, 1);
  for (const field of ['sha', 'deploymentId', 'configurationDigest', 'schemaDigest']) {
    await assert.rejects(verifyTradingFxManualPredecessor({
      ...input, manifest: { ...manifest, previous: { ...manifest.previous, [field]: 'different' } },
    }), /MANUAL_PREDECESSOR_SCOPE_CHANGED/);
  }
  assert.equal(reads, 1);
});
