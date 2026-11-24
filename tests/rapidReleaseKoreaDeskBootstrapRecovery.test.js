import assert from 'node:assert/strict';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { koreaDeskBootstrap as original, koreaDeskBootstrapClosure, verifyKoreaDeskDeveeBootstrap } from
  '../scripts/lib/rapid-release/salesforce-reviewed-adapter.mjs';

const environment = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce').environments[0];

test('Korea Desk bootstrap recovery verifies the exact changed job without a second submission', async () => {
  const expectedComponents = [
    ['CustomField', 'STEM__c.Korea_Desk_Member__c', true],
    ['CustomField', 'STEM__c.Korea_Desk__c', true],
    ['CustomObject', 'STEM__c', false],
    ['PermissionSet', 'FCOS_Korea_Desk_Editor', true],
    ['PermissionSet', 'FCOS_Korea_Desk_Reader', true],
  ];
  const history = { job: { id: original.jobId, validationId: null, submittedAt: original.submittedAt,
    packageSha256: original.packageSha256 }, completedAt: '2026-11-24T11:47:08Z' };
  const inventoryHash = 'a'.repeat(64);
  const reviewed = {
    fingerprint: original.fingerprint, binding: { sourceTreeHash: original.sourceTreeHash },
    review: { bootstrap: { components: expectedComponents.map(([type, name]) => type + ':' + name) } },
    nativeInventories: { devee: { bootstrap: { files: {}, inventoryHash } } },
  };
  const successes = expectedComponents.map(([componentType, fullName, created]) =>
    ({ componentType, fullName, created, changed: true, deleted: false, success: true }));
  const descriptor = { componentType: '', fullName: 'package.xml', fileName: 'zip/package.xml', success: true };
  const report = { id: original.jobId, status: 'Succeeded', success: true, done: true, checkOnly: false, rollbackOnError: true,
    numberComponentsTotal: 5, numberComponentsDeployed: 5, numberTestsTotal: 0, numberTestsCompleted: 0,
    completedDate: '2026-11-24T11:46:40.000Z', details: { componentSuccesses: [...successes, descriptor] } };
  const now = () => new Date('2026-11-24T11:50:00Z');
  let convertedHash = original.packageSha256;
  let nativeInventoryHash = inventoryHash;
  const provider = {
    verifyIdentity(org) { assert.equal(org.orgId, environment.orgId); },
    prepareBootstrap(org) {
      assert.equal(org.orgId, environment.orgId);
      return { packageSha256: convertedHash, cleanup() {}, submit() { assert.fail('bootstrap was submitted again'); } };
    },
    report(org, jobId) {
      assert.equal(org.orgId, environment.orgId);
      assert.equal(jobId, original.jobId);
      return report;
    },
    verifyInventory(org, expected) {
      assert.equal(org.orgId, environment.orgId);
      assert.equal(expected.expectedInventoryHash, inventoryHash);
      return { orgId: org.orgId, sourceTreeHash: null, inventoryHash: nativeInventoryHash,
        observedNativeInventoryHash: 'b'.repeat(64), evidenceSha256: 'c'.repeat(64), verifiedAt: now().toISOString() };
    },
  };
  const input = { history, reviewed, provider, now };
  assert.equal((await verifyKoreaDeskDeveeBootstrap(input)).proof.jobId, original.jobId);
  convertedHash = 'f'.repeat(64);
  await assert.rejects(verifyKoreaDeskDeveeBootstrap(input), /KOREA_DESK_BOOTSTRAP_PACKAGE_CHANGED/);
  convertedHash = original.packageSha256;
  successes[2].changed = false;
  await assert.rejects(verifyKoreaDeskDeveeBootstrap(input), /KOREA_DESK_BOOTSTRAP_EFFECT_CHANGED/);
  successes[2].changed = true;
  report.details.componentSuccesses.push({ ...successes[0] });
  await assert.rejects(verifyKoreaDeskDeveeBootstrap(input), /KOREA_DESK_BOOTSTRAP_EFFECT_CHANGED/);
  report.details.componentSuccesses.pop();
  nativeInventoryHash = 'f'.repeat(64);
  await assert.rejects(verifyKoreaDeskDeveeBootstrap(input), /Current Salesforce org inventory receipt/);
});

test('Korea Desk closure keeps the completed bootstrap visible and closes only its original prerequisite', () => {
  const evidence = Object.fromEntries(['alias', 'deveeInventory', 'deveeReport', 'deveeObservedInventory', 'qatInventory',
    'productionInventory'].map(name => [name, 'a'.repeat(64)]));
  evidence.observedAt = '2026-11-24T11:50:00Z';
  const result = koreaDeskBootstrapClosure(evidence);
  assert.equal(result.outcome, 'devee_bootstrap_verified_before_promotion');
  assert.equal(result.originalBootstrapCheckpoint, original.checkpointId);
  assert.equal(result.originalSalesforceJobId, original.jobId);
  assert.equal(result.operationId, original.releaseId + '-prerequisites');
  assert.throws(() => koreaDeskBootstrapClosure({ ...evidence, qatInventory: null }), /CLOSURE_EVIDENCE_INVALID/);
});
