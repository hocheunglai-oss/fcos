import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { createSalesforceWorkflowState, updateSalesforceEnvironmentState, SALESFORCE_RELEASE_MODE } from '../scripts/salesforce-workflow-state.mjs';
import { openSalesforcePromotionJournal, salesforcePromotionHash as hash } from '../scripts/lib/salesforce-promotion-journal.mjs';
import { INVENTORY_BASELINE_MODE, REVIEWED_SALESFORCE_MODE, createReviewedSalesforcePlan, inventoryFromFiles, reviewedCheckpointInventory, runReviewedSalesforceRelease, assertReviewedJobReport, assertProductionAuthorization } from '../scripts/lib/salesforce-reviewed-release.mjs';
import { assertReviewedInputsUnchanged, baselineGitInventory, cliSalesforceProvider, loadReviewedSalesforcePlan, reviewedSalesforceOptions } from '../scripts/deploy-salesforce-reviewed-manifest.mjs';
import { reviewedDeveePublicationProof } from '../scripts/sync-salesforce-reviewed-repository.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const fixedNow = new Date('2026-11-06T10:00:00.000Z');
const now = () => fixedNow;
const jobId = n => `0Af${String(n).padStart(12, '0')}AAA`;
const packageXml = ids => Buffer.from(`<?xml version="1.0"?><Package xmlns="http://soap.sforce.com/2006/04/metadata">${ids.map(id => {
  const [type, member] = id.split(':'); return `<types><members>${member}</members><name>${type}</name></types>`;
}).join('')}<version>65.0</version></Package>`);
const files = { 'classes/Example.cls': Buffer.from('class Example {}\n'), 'classes/Example.cls-meta.xml': Buffer.from('<ApexClass/>\n') };

function fixture({ bootstrap = false, level = 'RunLocalTests', inventoryBaseline = false } = {}) {
  const baselineInventory = inventoryFromFiles(files);
  const finalFiles = { ...files, 'classes/Example.cls': Buffer.from('class Example { String value; }\n') };
  const componentIds = ['ApexClass:Example'];
  if (bootstrap) {
    finalFiles['objects/Demo__c/fields/Value__c.field-meta.xml'] = Buffer.from('<CustomField/>\n');
    finalFiles['permissionsets/Reviewed.permissionset-meta.xml'] = Buffer.from('<PermissionSet/>\n');
    componentIds.push('CustomField:Demo__c.Value__c', 'PermissionSet:Reviewed');
  }
  const finalInventory = inventoryFromFiles(finalFiles), manifestBytes = packageXml(componentIds);
  let baselineWorkflow = createSalesforceWorkflowState({ sourceTreeHash: baselineInventory.sourceTreeHash, now: fixedNow });
  const reports = new Map();
  const makeReport = (id, validation, { zero = false, date = fixedNow.toISOString() } = {}) => ({
    id, status: 'Succeeded', done: true, success: true, checkOnly: validation, rollbackOnError: true,
    numberComponentErrors: 0, numberTestErrors: 0, numberComponentsDeployed: 1, numberComponentsTotal: 1,
    numberTestsCompleted: zero ? 0 : 2, numberTestsTotal: zero ? 0 : 2, completedDate: date,
    details: { componentSuccesses: componentIds.map(id => { const [componentType, fullName] = id.split(':'); return { componentType, fullName, success: true }; }),
      runTestResult: { successes: [{ name: 'ExampleTest', methodName: 'works' }], codeCoverageWarnings: [] } },
  });
  for (const [index, environment] of policy.environments.entries()) {
    const validationId = jobId(index * 2 + 1), deploymentId = jobId(index * 2 + 2);
    const common = { status: 'Succeeded', sourceTreeHash: baselineInventory.sourceTreeHash, releaseMode: SALESFORCE_RELEASE_MODE,
      deploymentScope: 'force-app/main/default', testLevel: 'RunLocalTests', completedAt: '2026-11-01T00:00:00.000Z' };
    baselineWorkflow = updateSalesforceEnvironmentState(baselineWorkflow, environment.key, {
      validation: { ...common, jobId: validationId, checkOnly: true },
      deployment: { ...common, jobId: deploymentId, validationJobId: validationId, checkOnly: false },
    });
    reports.set(validationId, makeReport(validationId, true)); reports.set(deploymentId, makeReport(deploymentId, false));
  }
  const bootstrapIds = componentIds.filter(id => !id.startsWith('Apex'));
  const bootstrapBytes = bootstrap ? packageXml(bootstrapIds) : null;
  const review = { schemaVersion: 1, releaseMode: REVIEWED_SALESFORCE_MODE, sourceTreeHash: finalInventory.sourceTreeHash,
    manifestSha256: hash(manifestBytes), baselineCommit: 'a'.repeat(40), baselineSourceTreeHash: baselineInventory.sourceTreeHash,
    baselineInventoryHash: baselineInventory.inventoryHash, baselineWorkflowPath: 'proof/baseline.json',
    components: componentIds.map(id => ({ id, files: id === 'ApexClass:Example' ? Object.keys(files) : id.startsWith('CustomField:') ? ['objects/Demo__c/fields/Value__c.field-meta.xml'] : ['permissionsets/Reviewed.permissionset-meta.xml'], dependsOn: [] })),
    dependencyReview: { complete: true, reviewer: 'reviewer', evidence: 'reviewed source dependency inventory' },
    testPlan: { level, tests: level === 'RunSpecifiedTests' ? ['ExampleTest'] : [], minimumTests: 1 },
    permissionSets: bootstrap ? ['Reviewed'] : [],
    ...(bootstrap ? { bootstrap: { manifestPath: 'manifest/bootstrap.xml', sha256: hash(bootstrapBytes), components: bootstrapIds, permissionSets: ['Reviewed'] } } : {}),
  };
  if (inventoryBaseline) { review.baselineMode = INVENTORY_BASELINE_MODE; delete review.baselineWorkflowPath; baselineWorkflow = null; }
  const inputs = { review, manifestBytes, bootstrapBytes, baselineWorkflow, baselineInventory, finalInventory, policy };
  const plan = createReviewedSalesforcePlan(inputs);
  const directory = mkdtempSync(path.join(tmpdir(), 'fcos-reviewed-sf-'));
  let journal = openSalesforcePromotionJournal({ directory, binding: plan.binding, now });
  const calls = [], assignments = new Set(), checkpoints = [];
  const orgInventories = new Map(policy.environments.map(environment => [environment.key, structuredClone(baselineInventory)]));
  let sequence = 100;
  const provider = {
    async verifyInventory(environment, expected) { calls.push(['inventory', environment.key, expected.expectedInventoryHash]);
      const actual = orgInventories.get(environment.key);
      return { orgId: environment.orgId, sourceTreeHash: actual.sourceTreeHash || null, inventoryHash: actual.inventoryHash, verifiedAt: fixedNow.toISOString(), evidenceSha256: 'a'.repeat(64),
        verificationMethod: 'metadata-api-owned-tree-inventory', scope: 'force-app/main/default', observedInventory: structuredClone(actual.files),
        identity: { alias: environment.alias, orgId: environment.orgId, isSandbox: environment.isSandbox, username: environment.username || 'production@example.invalid', connectedStatus: 'Connected' } }; },
    async verifyIdentity(environment) { calls.push(['identity', environment.key]); },
    async report(environment, id) { calls.push(['report', environment.key, id]); return reports.get(id); },
    async validate(environment) { const id = jobId(++sequence); calls.push(['validate', environment.key, id]); reports.set(id, makeReport(id, true)); return { id }; },
    async deploy(environment, validationId) { const id = jobId(++sequence); calls.push(['deploy', environment.key, validationId, id]); reports.set(id, makeReport(id, false)); orgInventories.set(environment.key, structuredClone(finalInventory)); return { id }; },
    async bootstrap(environment) { const id = jobId(++sequence); calls.push(['bootstrap', environment.key, id]);
      const report = makeReport(id, false, { zero: true });
      report.details.componentSuccesses = bootstrapIds.map(id => { const [componentType, fullName] = id.split(':'); return { componentType, fullName, success: true }; });
      reports.set(id, report); orgInventories.set(environment.key, reviewedCheckpointInventory(plan, { bootstrap: { status: 'Succeeded' } })); return { id }; },
    async permissionAssigned(environment, name) { calls.push(['permission-read', environment.key, name]); return assignments.has(`${environment.key}:${name}`); },
    async assignPermission(environment, name) { calls.push(['permission-write', environment.key, name]); assignments.add(`${environment.key}:${name}`); },
    async mirror(action, { deveeDeployment }) {
      calls.push(['mirror', action]);
      return { releaseMode: REVIEWED_SALESFORCE_MODE, sourceTreeHash: plan.binding.sourceTreeHash, sourceEnvironment: 'devee', sourceDeploymentJobId: deveeDeployment.jobId,
        repository: policy.publication.repository, account: policy.publication.requiredAccount, branch: 'codex/verified', commit: 'b'.repeat(40),
        pullRequest: { number: 123, state: 'OPEN', isDraft: true, baseRefName: policy.publication.defaultBranch, headRefName: 'codex/verified', headRefOid: 'b'.repeat(40) } };
    },
  };
  const ownership = { async assert(binding) { calls.push(['ownership', binding.stage, binding.operation]); return { ...binding, receiptId: 'external-lease-1', expiresAt: '2026-11-07T00:00:00.000Z' }; } };
  const externalJournal = { async checkpoint(event) { checkpoints.push(structuredClone(event)); } };
  const authorization = { productionMutation: true, fingerprint: plan.fingerprint, manifestSha256: plan.binding.manifestSha256,
    sourceTreeHash: plan.binding.sourceTreeHash, orgIds: plan.binding.orgIds, authorizedBy: 'user', evidence: 'exact release approval', expiresAt: '2026-11-07T00:00:00.000Z' };
  return { plan, inputs, provider, reports, calls, assignments, checkpoints, orgInventories, ownership, externalJournal, authorization, directory,
    get journal() { return journal; }, makeReport,
    reopen() { journal.close(); journal = openSalesforcePromotionJournal({ directory, binding: plan.binding, now }); },
    run(mode, extra = {}) { return runReviewedSalesforceRelease({ plan, mode, policy, journal, provider, ownership, externalJournal,
      now, assertUnchanged: async () => {}, ...extra }); },
    cleanup() { journal.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('reviewed manifest binds actual baseline inventory, delta component/dependency coverage and test plan', () => {
  const f = fixture();
  try {
    const corrupt = change => { const input = { ...f.inputs, review: structuredClone(f.inputs.review), baselineWorkflow: structuredClone(f.inputs.baselineWorkflow),
      baselineInventory: structuredClone(f.inputs.baselineInventory), finalInventory: structuredClone(f.inputs.finalInventory) }; change(input); return () => createReviewedSalesforcePlan(input); };
    assert.throws(corrupt(x => { x.review.components = []; }), /coverage/);
    assert.throws(corrupt(x => { x.review.components[0].dependsOn = ['ApexClass:Missing']; }), /Dependency/);
    assert.throws(corrupt(x => { x.review.dependencyReview.complete = false; }), /dependency review/);
    assert.throws(corrupt(x => { x.review.baselineInventoryHash = 'c'.repeat(64); }), /baseline/);
    assert.throws(corrupt(x => { x.baselineWorkflow.environments.qat.deployment.sourceTreeHash = 'c'.repeat(64); }), /Baseline qat/);
    assert.throws(corrupt(x => { x.review.permissionSets = ['Unrelated']; }), /Permissions/);
    assert.throws(corrupt(x => { x.review.testPlan.minimumTests = 0; }), /positive test/);
    assert.throws(corrupt(x => { x.finalInventory.files['classes/Uncovered.cls'] = { sha256: 'c'.repeat(64), size: 1 }; }), /missing manifest coverage/);
    assert.throws(corrupt(x => { x.baselineInventory.files['classes/Deleted.cls'] = { sha256: 'd'.repeat(64), size: 1 }; }), /Destructive/);
    assert.equal(f.plan.binding.releaseMode, REVIEWED_SALESFORCE_MODE);
    assert.notEqual(f.plan.binding.releaseMode, SALESFORCE_RELEASE_MODE);
  } finally { f.cleanup(); }
});

test('prepare then apply consumes exact saved Production validation without another submission', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.run('apply', { authorization: f.authorization }), /successful prepare checkpoint/);
    assert.equal(f.calls.length, 0);
    const prepared = await f.run('prepare');
    assert.equal(prepared.productionValidation, 'Succeeded');
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 3);
    assert.deepEqual(f.calls.filter(call => call[0] === 'deploy').map(call => call[1]), ['devee', 'qat']);
    const productionValidation = f.journal.state.stages.production.validation.jobId;
    const completedAt = f.journal.state.stages.devee.deployment.completedAt;
    f.reopen();
    const applied = await f.run('apply', { authorization: f.authorization });
    assert.equal(applied.mode, 'applied');
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 3);
    assert.equal(f.calls.find(call => call[0] === 'deploy' && call[1] === 'production')[2], productionValidation);
    assert.equal(f.journal.state.stages.devee.deployment.completedAt, completedAt);
    assert.equal(f.journal.state.stages.devee.deployment.verifiedAt, fixedNow.toISOString());
    assert.ok(f.calls.findIndex(call => call[0] === 'mirror') < f.calls.findIndex(call => call[0] === 'validate' && call[1] === 'qat'));
    const publication = f.journal.state.stages.shared_mirror.publication;
    assert.equal(publication.status, 'Succeeded');
    assert.equal(publication.receiptId, 'external-lease-1');
    assert.ok(f.checkpoints.some(event => event.operation === 'deployment' && event.record.status === 'submitting' && event.stage === 'production'));
  } finally { f.cleanup(); }
});

test('first inventory-baseline release prepares without any historical full-suite jobs', async () => {
  const f = fixture({ inventoryBaseline: true });
  try {
    for (let id = 1; id <= 6; id++) f.reports.delete(jobId(id));
    assert.equal(f.plan.binding.baselineMode, INVENTORY_BASELINE_MODE);
    assert.equal(f.plan.binding.baselineJobs, null);
    assert.equal((await f.run('prepare')).productionValidation, 'Succeeded');
    const firstSubmission = f.calls.findIndex(call => call[0] === 'validate');
    assert.deepEqual(f.calls.slice(0, firstSubmission).filter(call => call[0] === 'inventory').slice(0, 3).map(call => call[1]), ['devee', 'qat', 'production']);
    assert.equal(f.calls.filter(call => call[0] === 'report' && Number(call[2].slice(3, 15)) <= 6).length, 0);
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 3);
    assert.deepEqual(f.calls.filter(call => call[0] === 'deploy').map(call => call[1]), ['devee', 'qat']);
    const proof = await reviewedDeveePublicationProof({ plan: f.plan, state: f.journal.state, policy, provider: f.provider, assertUnchanged: async () => {}, now });
    assert.equal(proof.proofKind, 'verified-native-inventory-plus-covered-manifest');
    assert.equal(proof.baselineMode, INVENTORY_BASELINE_MODE);
    assert.equal(f.calls.filter(call => call[0] === 'report' && Number(call[2].slice(3, 15)) <= 6).length, 0);
  } finally { f.cleanup(); }
});

test('all-org inventory preflight rejects stale, wrong-org, mismatched or hash-only evidence before any write', async () => {
  const f = fixture({ inventoryBaseline: true });
  try {
    const original = f.provider.verifyInventory;
    for (const corrupt of [
      receipt => { receipt.verifiedAt = '2026-11-01T00:00:00.000Z'; },
      receipt => { receipt.inventoryHash = 'e'.repeat(64); },
      receipt => { receipt.identity.orgId = 'wrong-org'; },
      receipt => { receipt.observedInventory = {}; },
      receipt => { delete receipt.observedInventory; receipt.nativeVerified = true; },
      receipt => { receipt.verificationMethod = 'caller-json-assertion'; },
    ]) {
      f.provider.verifyInventory = async (environment, expected) => {
        const receipt = await original(environment, expected);
        if (environment.key === 'production') corrupt(receipt);
        return receipt;
      };
      await assert.rejects(f.run('prepare'), /inventory|native/i);
      assert.equal(f.calls.filter(call => ['validate', 'deploy', 'bootstrap', 'permission-write'].includes(call[0])).length, 0);
    }
  } finally { f.cleanup(); }
});

test('inventory-baseline resume verifies final upstream trees and untouched Production without resubmission', async () => {
  const f = fixture({ inventoryBaseline: true });
  try {
    await f.run('prepare');
    const originalTime = f.journal.state.stages.devee.deployment.completedAt;
    f.reopen(); f.calls.length = 0;
    assert.equal((await f.run('apply', { authorization: f.authorization })).mode, 'applied');
    const inventories = f.calls.filter(call => call[0] === 'inventory').slice(0, 3);
    assert.deepEqual(inventories.map(call => [call[1], call[2]]), [
      ['devee', f.plan.finalInventory.inventoryHash], ['qat', f.plan.finalInventory.inventoryHash], ['production', f.plan.baselineInventory.inventoryHash],
    ]);
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 0);
    assert.deepEqual(f.calls.filter(call => call[0] === 'deploy').map(call => call[1]), ['production']);
    assert.equal(f.calls.filter(call => call[0] === 'report' && Number(call[2].slice(3, 15)) <= 6).length, 0);
    assert.equal(f.journal.state.stages.devee.deployment.completedAt, originalTime);
  } finally { f.cleanup(); }
});

test('inventory baseline resumes the actual intermediate bootstrap tree without another bootstrap', async () => {
  const f = fixture({ inventoryBaseline: true, bootstrap: true });
  try {
    const original = f.provider.report;
    let interrupted = false;
    f.provider.report = async (environment, id) => {
      if (environment.key === 'devee' && f.reports.get(id)?.checkOnly && Number(id.slice(3, 15)) > 100 && !interrupted) { interrupted = true; throw new Error('validation poll interrupted'); }
      return original(environment, id);
    };
    await assert.rejects(f.run('prepare'), /validation poll interrupted/);
    const intermediate = reviewedCheckpointInventory(f.plan, f.journal.state.stages.devee);
    f.reopen(); f.calls.length = 0;
    await f.run('prepare');
    assert.equal(f.calls.find(call => call[0] === 'inventory' && call[1] === 'devee')[2], intermediate.inventoryHash);
    assert.equal(f.calls.filter(call => call[0] === 'bootstrap' && call[1] === 'devee').length, 0);
    assert.equal(f.calls.filter(call => call[0] === 'validate' && call[1] === 'devee').length, 0);
  } finally { f.cleanup(); }
});

test('authorization and external ownership fail closed before Production writes', async () => {
  const f = fixture();
  try {
    await f.run('prepare');
    await assert.rejects(f.run('apply'), /Production mutation/);
    assert.equal(f.calls.filter(call => call[0] === 'deploy' && call[1] === 'production').length, 0);
    await assert.rejects(f.run('apply', { authorization: { ...f.authorization, manifestSha256: 'd'.repeat(64) } }), /Production mutation/);
    await assert.rejects(f.run('apply', { ownership: null }), /external release ownership/);
    await assert.rejects(f.run('apply', { authorization: f.authorization, ownership: { assert: async () => ({ receiptId: 'unbound' }) } }), /ownership receipt/);
    assert.equal(f.calls.filter(call => call[0] === 'deploy' && call[1] === 'production').length, 0);
  } finally { f.cleanup(); }
});

test('schema prepare stops before Production bootstrap and exact apply authorizes bootstrap and permissions', async () => {
  const f = fixture({ bootstrap: true });
  try {
    const prepared = await f.run('prepare');
    assert.equal(prepared.productionValidation, 'deferred-until-authorized-bootstrap');
    assert.deepEqual(f.calls.filter(call => call[0] === 'bootstrap').map(call => call[1]), ['devee', 'qat']);
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 2);
    await assert.rejects(f.run('apply'), /Production mutation/);
    assert.equal(f.calls.filter(call => call[0] === 'bootstrap' && call[1] === 'production').length, 0);
    await f.run('apply', { authorization: f.authorization });
    assert.equal(f.calls.filter(call => call[0] === 'bootstrap').length, 3);
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 3);
    const permission = f.journal.state.stages.production['permission:Reviewed'];
    assert.equal(permission.prestate, false);
    assert.equal(permission.addedByRelease, true);
    assert.equal(f.journal.state.stages.production.bootstrap.tests, '0/0');
    assert.equal(f.journal.state.stages.production.bootstrap.apexTestProof, false);
    assert.equal(f.journal.state.stages.production.validation.apexTestProof, true);
    assert.equal(f.journal.state.stages.production.validation.testPlan.level, 'RunLocalTests');
  } finally { f.cleanup(); }
});

test('permission assignment resumes by readback without repeating an uncertain write', async () => {
  const f = fixture({ bootstrap: true });
  try {
    const original = f.provider.assignPermission;
    let attempts = 0;
    f.provider.assignPermission = async (environment, name) => {
      if (environment.key === 'devee') {
        attempts += 1;
        throw new Error('Lost permission response');
      }
      return original(environment, name);
    };

    await assert.rejects(f.run('prepare'), /Lost permission response/);
    f.reopen();
    await assert.rejects(f.run('prepare'), /Permission assignment remains uncertain/);
    assert.equal(attempts, 1);

    f.assignments.add('devee:Reviewed');
    await f.run('prepare');
    assert.equal(attempts, 1);
    const saved = f.journal.state.stages.devee['permission:Reviewed'];
    assert.equal(saved.status, 'Succeeded');
    assert.equal(saved.addedByRelease, true);
    assert.equal(saved.receiptId, 'external-lease-1');
  } finally { f.cleanup(); }
});

test('a saved permission result must reach the durable journal before promotion resumes', async () => {
  const f = fixture({ bootstrap: true });
  try {
    const checkpoint = f.externalJournal.checkpoint;
    let unavailable = true;
    f.externalJournal.checkpoint = async event => {
      if (event.stage === 'devee' && event.operation === 'permission:Reviewed' && event.record.status === 'Succeeded' && unavailable) {
        throw new Error('Durable checkpoint unavailable');
      }
      return checkpoint(event);
    };

    await assert.rejects(f.run('prepare'), /Durable checkpoint unavailable/);
    const saved = structuredClone(f.journal.state.stages.devee['permission:Reviewed']);
    assert.equal(saved.status, 'Succeeded');
    f.reopen();
    await assert.rejects(f.run('prepare'), /Durable checkpoint unavailable/);
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 0);
    assert.equal(f.calls.filter(call => call[0] === 'permission-write' && call[1] === 'devee').length, 1);

    unavailable = false;
    await f.run('prepare');
    assert.ok(f.checkpoints.some(event => event.stage === 'devee' && event.operation === 'permission:Reviewed'
      && JSON.stringify(event.record) === JSON.stringify(saved)));
    assert.equal(f.calls.filter(call => call[0] === 'permission-write' && call[1] === 'devee').length, 1);
  } finally { f.cleanup(); }
});

test('crash after submission without job ID never blindly resubmits', async () => {
  const f = fixture();
  try {
    const original = f.provider.validate;
    f.provider.validate = async environment => { await original(environment); throw new Error('connection lost after submit'); };
    await assert.rejects(f.run('prepare'), /connection lost/);
    assert.equal(f.journal.state.stages.devee.validation.status, 'submitting');
    f.reopen(); f.provider.validate = original;
    await assert.rejects(f.run('prepare'), /owner readback\/reconciliation/);
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 1);
  } finally { f.cleanup(); }
});

test('crash after durable returned ID resumes that job and preserves successful upstream stages', async () => {
  const f = fixture();
  try {
    const original = f.provider.report;
    let crashed = false;
    f.provider.report = async (environment, id) => {
      if (environment.key === 'qat' && Number(id.slice(3, 15)) > 100 && !crashed) { crashed = true; throw new Error('poll interrupted'); }
      return original(environment, id);
    };
    await assert.rejects(f.run('prepare'), /poll interrupted/);
    const qatId = f.journal.state.stages.qat.validation.jobId;
    f.reopen();
    await f.run('prepare');
    assert.equal(f.journal.state.stages.qat.validation.jobId, qatId);
    assert.equal(f.calls.filter(call => call[0] === 'validate' && call[1] === 'devee').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'validate' && call[1] === 'qat').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'deploy' && call[1] === 'devee').length, 1);
  } finally { f.cleanup(); }
});

test('uncertain quick deployment resumes only after source-bound owner reconciliation', async () => {
  const f = fixture();
  try {
    const original = f.provider.deploy;
    f.provider.deploy = async (...args) => { await original(...args); throw new Error('quick submit disconnected'); };
    await assert.rejects(f.run('prepare'), /quick submit disconnected/);
    const submittedId = f.calls.find(call => call[0] === 'deploy')[3];
    f.reopen(); f.provider.deploy = original;
    await assert.rejects(f.run('prepare'), /uncertain submission/);
    assert.equal(f.calls.filter(call => call[0] === 'deploy').length, 1);
    f.provider.reconcile = async () => ({});
    await assert.rejects(f.run('prepare', { reconcile: { 'devee.deployment': submittedId } }), /does not bind/);
    f.provider.reconcile = async (environment, id, { operation, plan }) => ({ fingerprint: plan.fingerprint, orgId: environment.orgId,
      jobId: id, operation, sourceTreeHash: plan.binding.sourceTreeHash, manifestSha256: plan.binding.manifestSha256,
      evidenceSha256: 'e'.repeat(64), verifiedAt: fixedNow.toISOString() });
    await f.run('prepare', { reconcile: { 'devee.deployment': submittedId } });
    assert.equal(f.journal.state.stages.devee.deployment.jobId, submittedId);
    assert.equal(f.calls.filter(call => call[0] === 'deploy' && call[1] === 'devee').length, 1);
  } finally { f.cleanup(); }
});

test('unknown or drifted current org inventory prevents incremental writes', async () => {
  const f = fixture();
  try {
    const original = f.provider.verifyInventory;
    f.provider.verifyInventory = undefined;
    await assert.rejects(f.run('prepare'), /Current Salesforce org inventory verification/);
    f.provider.verifyInventory = async (...args) => ({ ...await original(...args), inventoryHash: 'd'.repeat(64) });
    await assert.rejects(f.run('prepare'), /inventory receipt/);
    assert.equal(f.calls.filter(call => ['validate', 'deploy', 'bootstrap'].includes(call[0])).length, 0);
    f.provider.verifyInventory = original;
    await f.run('prepare');
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 3);
  } finally { f.cleanup(); }
});

test('only confirmed failed or expired current validation gets a replacement and all attempts remain', async () => {
  const f = fixture();
  try {
    await f.run('prepare');
    const oldId = f.journal.state.stages.production.validation.jobId;
    f.reports.set(oldId, { ...f.reports.get(oldId), completedDate: '2026-10-20T00:00:00.000Z' });
    await f.run('apply', { authorization: f.authorization, replaceValidation: ['production'] });
    assert.notEqual(f.journal.state.stages.production.validation.jobId, oldId);
    assert.equal(f.journal.state.stages.production.validation.attempts[0].jobId, oldId);
    assert.equal(f.journal.state.stages.production.validation.attempts[0].status, 'Expired');
    assert.equal(f.calls.filter(call => call[0] === 'validate' && call[1] === 'devee').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'validate' && call[1] === 'qat').length, 1);
  } finally { f.cleanup(); }
  const g = fixture();
  try {
    await g.run('prepare');
    await assert.rejects(g.run('apply', { authorization: g.authorization, replaceValidation: ['production'] }), /confirmed failed/);
    assert.equal(g.calls.filter(call => call[0] === 'validate').length, 3);
  } finally { g.cleanup(); }
});

test('failed validation requires explicit replacement; unknown status does not allow replacement', async () => {
  const f = fixture();
  try {
    await f.run('prepare');
    const oldId = f.journal.state.stages.production.validation.jobId;
    f.reports.set(oldId, { ...f.reports.get(oldId), status: 'Failed', success: false });
    await assert.rejects(f.run('apply', { authorization: f.authorization }), /Failed/);
    await f.run('apply', { authorization: f.authorization, replaceValidation: ['production'] });
    assert.equal(f.journal.state.stages.production.validation.attempts[0].status, 'Failed');
  } finally { f.cleanup(); }
  const g = fixture();
  try {
    await g.run('prepare');
    const id = g.journal.state.stages.production.validation.jobId;
    g.reports.set(id, { ...g.reports.get(id), status: 'Unknown' });
    await assert.rejects(g.run('apply', { authorization: g.authorization, replaceValidation: ['production'] }), /confirmed failed/);
  } finally { g.cleanup(); }
});

test('source mismatch and failed durable checkpoint prevent any provider submission', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.run('prepare', { assertUnchanged: async () => { throw new Error('source changed'); } }), /source changed/);
    assert.equal(f.calls.filter(call => ['validate', 'deploy', 'bootstrap'].includes(call[0])).length, 0);
    await assert.rejects(f.run('prepare', { externalJournal: { checkpoint: async () => { throw new Error('durable journal unavailable'); } } }), /durable journal/);
    assert.equal(f.calls.filter(call => call[0] === 'validate').length, 0);
    await assert.rejects(f.run('prepare'), /uncertain submission/);
  } finally { f.cleanup(); }
});

test('reports require actual positive requested tests, all-or-none success and valid coverage', () => {
  const f = fixture({ level: 'RunSpecifiedTests' });
  try {
    const id = jobId(10), environment = policy.environments[2];
    const check = report => assertReviewedJobReport(report, { environment, jobId: id, validation: true, testPlan: f.plan.binding.testPlan });
    assert.throws(() => check(f.makeReport(id, true, { zero: true })), /positive test execution/);
    assert.throws(() => check({ ...f.makeReport(id, true), rollbackOnError: false }), /all-or-none/);
    const missing = f.makeReport(id, true); missing.details.runTestResult.successes = [];
    assert.throws(() => check(missing), /Specified Salesforce tests/);
    const warnings = f.makeReport(id, true); warnings.details.runTestResult.codeCoverageWarnings = [{ message: 'coverage gap' }];
    assert.throws(() => check(warnings), /coverage warnings/);
    assert.equal(check(f.makeReport(id, true)).tests, '2/2');
    assert.throws(() => assertReviewedJobReport({ ...f.makeReport(id, true), details: { componentSuccesses: [] } },
      { environment, jobId: id, validation: true, testPlan: f.plan.binding.testPlan, expectedComponents: f.plan.manifest }), /manifest component coverage/);
    assert.throws(() => assertProductionAuthorization({ ...f.authorization, expiresAt: '2026-11-05T00:00:00.000Z' }, f.plan, fixedNow), /unexpired/);
    assert.throws(() => assertReviewedJobReport(f.makeReport(id, false), { environment, jobId: id, testPlan: { level: 'NoTestRun', tests: [], minimumTests: 1 } }), /confined/);
  } finally { f.cleanup(); }
});

test('mirror rejects changed/non-draft PR heads and records safe reverse restoration checkpoint', async () => {
  const f = fixture({ bootstrap: true });
  try {
    const original = f.provider.mirror;
    f.provider.mirror = async (...args) => { const proof = await original(...args); proof.pullRequest.headRefOid = 'c'.repeat(40); return proof; };
    await assert.rejects(f.run('prepare'), /exact open draft PR head/);
    assert.equal(f.calls.filter(call => call[0] === 'validate' && call[1] === 'qat').length, 0);
    const checkpoint = f.journal.state.stages.production['restoration-checkpoint'];
    assert.equal(checkpoint.status, 'review-required');
    assert.deepEqual(checkpoint.reverseOrder.map(entry => entry.environment), ['devee']);
    assert.deepEqual(checkpoint.reverseOrder[0].permissions, ['Reviewed']);
    f.provider.mirror = original;
    await f.run('prepare');
    assert.equal(f.calls.filter(call => call[0] === 'mirror' && call[1] === 'publish').length, 1);
    assert.ok(f.calls.some(call => call[0] === 'mirror' && call[1] === 'check'));
  } finally { f.cleanup(); }
});

test('incremental DEVEE publication rechecks actual baseline and delta jobs without forging complete-tree proof', async () => {
  const f = fixture();
  try {
    await f.run('prepare');
    const proof = await reviewedDeveePublicationProof({ plan: f.plan, state: f.journal.state, policy, provider: f.provider, assertUnchanged: async () => {}, now });
    assert.equal(proof.releaseMode, REVIEWED_SALESFORCE_MODE);
    assert.equal(proof.proofKind, 'verified-complete-baseline-plus-covered-manifest');
    const changed = structuredClone(f.journal.state); changed.stages.devee.deployment.validationJobId = jobId(999);
    await assert.rejects(reviewedDeveePublicationProof({ plan: f.plan, state: changed, policy, provider: f.provider, assertUnchanged: async () => {} }), /verified DEVEE/);
  } finally { f.cleanup(); }
});

test('CLI has one explicit reviewed entrypoint and requires an ownership adapter', () => {
  assert.throws(() => reviewedSalesforceOptions([]), /Usage/);
  assert.throws(() => reviewedSalesforceOptions(['prepare', '--manifest', 'manifest/a.xml', '--review', 'review.json']), /--adapter is required/);
  assert.throws(() => reviewedSalesforceOptions(['prepare', '--manifest', 'manifest/a.xml', '--review', 'review.json', '--adapter', 'adapter.mjs', '--authorization', 'yes.json']), /Prepare does not accept/);
  assert.equal(reviewedSalesforceOptions(['apply', '--manifest', 'manifest/a.xml', '--review', 'review.json', '--adapter', 'adapter.mjs']).mode, 'apply');
});

test('baseline inventory uses two bulk Git reads and preserves binary bytes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fcos-sf-baseline-'));
  const run = args => { const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  try {
    run(['init', '--quiet']);
    mkdirSync(path.join(directory, 'force-app/main/default/staticresources'), { recursive: true });
    const bytes = Buffer.from([0, 255, 254, 128, 13, 0, 10]);
    writeFileSync(path.join(directory, 'force-app/main/default/staticresources/Test.resource'), bytes);
    run(['add', '.']); run(['-c', 'user.name=Offline Test', '-c', 'user.email=offline@example.invalid', 'commit', '-qm', 'baseline']);
    const inventory = baselineGitInventory(directory, run(['rev-parse', 'HEAD']));
    assert.deepEqual(inventory, inventoryFromFiles({ 'staticresources/Test.resource': bytes }));
    assert.equal(readFileSync(path.join(directory, 'force-app/main/default/staticresources/Test.resource')).equals(bytes), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('inventory baseline loads from the exact Git tree without a deployment-proof file', () => {
  const f = fixture({ inventoryBaseline: true }), directory = mkdtempSync(path.join(tmpdir(), 'fcos-native-baseline-'));
  const run = args => { const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  try {
    run(['init', '--quiet']);
    mkdirSync(path.join(directory, 'force-app/main/default/classes'), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(directory, 'force-app/main/default', name), bytes);
    run(['add', '.']); run(['-c', 'user.name=Offline Test', '-c', 'user.email=offline@example.invalid', 'commit', '-qm', 'baseline']);
    const review = { ...f.inputs.review, baselineCommit: run(['rev-parse', 'HEAD']) };
    writeFileSync(path.join(directory, 'force-app/main/default/classes/Example.cls'), 'class Example { String value; }\n');
    writeFileSync(path.join(directory, 'package.xml'), f.inputs.manifestBytes);
    writeFileSync(path.join(directory, 'review.json'), JSON.stringify(review));
    const loaded = loadReviewedSalesforcePlan({ cwd: directory, manifestPath: 'package.xml', reviewPath: 'review.json', policy });
    assert.equal(loaded.binding.baselineMode, INVENTORY_BASELINE_MODE);
    assert.equal(loaded.baselineWorkflowAbsolute, null);
    assertReviewedInputsUnchanged(loaded, { cwd: directory, policy });
  } finally { f.cleanup(); rmSync(directory, { recursive: true, force: true }); }
});

test('native inventory retrieval binds manifest, org, and observed bytes and removes temporary source', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-inventory-fixture-'));
  try {
    const environment = policy.environments[0];
    const expected = inventoryFromFiles(files);
    const manifest = packageXml(['ApexClass:Example']);
    writeFileSync(path.join(cwd, 'inventory.xml'), manifest);
    writeFileSync(path.join(cwd, 'sfdx-project.json'), '{}');
    const descriptor = { path: 'inventory.xml', sha256: hash(manifest) };
    const input = { plan: { review: { inventoryManifests: { [expected.inventoryHash]: descriptor } } },
      expectedInventoryHash: expected.inventoryHash, expectedSourceTreeHash: expected.sourceTreeHash };
    let retrievedProject, changed = false, retrieves = 0, displayCalls = 0;
    const provider = cliSalesforceProvider({ cwd, run(program, args, project) {
      assert.equal(program, 'sf');
      assert.equal(args[args.indexOf('--target-org') + 1], environment.alias);
      if (args[0] === 'org') {
        displayCalls++;
        return { id: environment.orgId, username: environment.username, connectedStatus: 'Connected' };
      }
      if (args[0] === 'data') return { records: [{ Id: environment.orgId, IsSandbox: environment.isSandbox }] };
      assert.deepEqual(args.slice(0, 3), ['project', 'retrieve', 'start']);
      assert.notEqual(project, cwd);
      assert.deepEqual(readFileSync(args[args.indexOf('--manifest') + 1]), manifest);
      retrievedProject = project;
      retrieves++;
      mkdirSync(path.join(project, 'retrieved/classes'));
      for (const [name, bytes] of Object.entries(files)) {
        writeFileSync(path.join(project, 'retrieved', name), changed ? 'different' : bytes);
      }
      return { id: '09SHF000002gTFl2AM', status: 'Succeeded', done: true, success: true };
    } });

    const receipt = provider.verifyInventory(environment, input);
    assert.equal(receipt.sourceTreeHash, expected.sourceTreeHash);
    assert.deepEqual(receipt.observedInventory, expected.files);
    assert.equal(receipt.identity.orgId, environment.orgId);
    assert.equal(displayCalls, 2);
    assert.throws(() => readFileSync(path.join(retrievedProject, 'inventory.xml')), { code: 'ENOENT' });

    changed = true;
    assert.throws(() => provider.verifyInventory(environment, input), /differs from the exact reviewed inventory/);
    assert.throws(() => readFileSync(path.join(retrievedProject, 'inventory.xml')), { code: 'ENOENT' });
    descriptor.sha256 = '0'.repeat(64);
    assert.throws(() => provider.verifyInventory(environment, input), /manifest digest mismatch/);
    assert.equal(retrieves, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
