import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { createSalesforceWorkflowState, updateSalesforceEnvironmentState, SALESFORCE_RELEASE_MODE } from '../scripts/salesforce-workflow-state.mjs';
import { openSalesforcePromotionJournal, salesforcePromotionHash as hash } from '../scripts/lib/salesforce-promotion-journal.mjs';
import { INVENTORY_BASELINE_MODE, REVIEWED_SALESFORCE_MODE, createReviewedSalesforcePlan, inventoryFromFiles, matchesSalesforceCheckpoint, parseReviewedPackage, projectedNativeInventoryHash, reviewedCheckpointInventory, verifyReviewedOrgInventory, runReviewedSalesforceRelease, assertReviewedJobReport, assertProductionAuthorization } from '../scripts/lib/salesforce-reviewed-release.mjs';
import { assertReviewedInputsUnchanged, baselineGitInventory, cliSalesforceProvider, equivalentNativeSerialization, loadReviewedSalesforcePlan, reviewedSalesforceOptions } from '../scripts/deploy-salesforce-reviewed-manifest.mjs';
import { reviewedDeveePublicationProof } from '../scripts/sync-salesforce-reviewed-repository.mjs';
import { applyReviewedPrerequisites, verifyPreBootstrapStage } from '../scripts/lib/rapid-release/salesforce-reviewed-adapter.mjs';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const fixedNow = new Date('2026-11-06T10:00:00.000Z');
const now = () => fixedNow;
const jobId = n => `0Af${String(n).padStart(12, '0')}AAA`;
const packageXml = ids => Buffer.from(`<?xml version="1.0"?><Package xmlns="http://soap.sforce.com/2006/04/metadata">${ids.map(id => {
  const [type, member] = id.split(':'); return `<types><members>${member}</members><name>${type}</name></types>`;
}).join('')}<version>65.0</version></Package>`);
const files = { 'classes/Example.cls': Buffer.from('class Example {}\n'), 'classes/Example.cls-meta.xml': Buffer.from('<ApexClass/>\n') };
const validationRuleId = 'ValidationRule:Trade_Document_Line__c.Exactly_One_Document_Parent';
const validationRulePath = 'objects/Trade_Document_Line__c/validationRules/Exactly_One_Document_Parent.validationRule-meta.xml';

function fixture({ bootstrap = false, level = 'RunLocalTests', inventoryBaseline = false, validationRule = false, asymmetric = false, nativeRaw = false } = {}) {
  const baselineInventory = inventoryFromFiles(files);
  const finalFiles = { ...files, 'classes/Example.cls': Buffer.from('class Example { String value; }\n') };
  const componentIds = ['ApexClass:Example'];
  if (bootstrap) {
    finalFiles['objects/Demo__c/fields/Value__c.field-meta.xml'] = Buffer.from('<CustomField/>\n');
    finalFiles['permissionsets/Reviewed.permissionset-meta.xml'] = Buffer.from('<PermissionSet/>\n');
    componentIds.push('CustomField:Demo__c.Value__c', 'PermissionSet:Reviewed');
  }
  if (validationRule) {
    finalFiles[validationRulePath] = Buffer.from('<ValidationRule/>\n');
    componentIds.push(validationRuleId);
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
    reports.set(validationId, makeReport(validationId, true)); reports.set(deploymentId, makeReport(deploymentId, false, { zero: true }));
  }
  const bootstrapIds = componentIds.filter(id => !id.startsWith('Apex') && id !== validationRuleId);
  const bootstrapBytes = bootstrap ? packageXml(bootstrapIds) : null;
  const componentPaths = {
    'ApexClass:Example': Object.keys(files),
    'CustomField:Demo__c.Value__c': ['objects/Demo__c/fields/Value__c.field-meta.xml'],
    'PermissionSet:Reviewed': ['permissionsets/Reviewed.permissionset-meta.xml'],
    [validationRuleId]: [validationRulePath],
  };
  const review = { schemaVersion: 1, releaseMode: REVIEWED_SALESFORCE_MODE, sourceTreeHash: finalInventory.sourceTreeHash,
    manifestSha256: hash(manifestBytes), baselineCommit: 'a'.repeat(40), baselineSourceTreeHash: baselineInventory.sourceTreeHash,
    baselineInventoryHash: baselineInventory.inventoryHash, baselineWorkflowPath: 'proof/baseline.json',
    components: componentIds.map(id => ({ id, files: componentPaths[id], dependsOn: [] })),
    dependencyReview: { complete: true, reviewer: 'reviewer', evidence: 'reviewed source dependency inventory' },
    testPlan: { level, tests: level === 'RunSpecifiedTests' ? ['ExampleTest'] : [], minimumTests: 1 },
    permissionSets: bootstrap ? ['Reviewed'] : [],
    ...(bootstrap ? { bootstrap: { manifestPath: 'manifest/bootstrap.xml', sha256: hash(bootstrapBytes), components: bootstrapIds, permissionSets: ['Reviewed'] } } : {}),
  };
  if (inventoryBaseline) { review.baselineMode = INVENTORY_BASELINE_MODE; delete review.baselineWorkflowPath; baselineWorkflow = null; }
  if (nativeRaw) {
    const raw = source => inventoryFromFiles({ ...source, 'profiles/Example.profile-meta.xml': Buffer.from('<Profile/>\r\n') });
    const before = raw(files), after = raw(finalFiles);
    const descriptor = ({ files, inventoryHash }) => ({ files, inventoryHash });
    review.nativeInventories = Object.fromEntries(policy.environments.map(({ key, orgId }) =>
      [key, { orgId, baseline: descriptor(before), final: descriptor(after) }]));
    const retrieval = { path: 'stable.xml', sha256: hash(packageXml(['Profile:Example'])),
      apex: { path: 'apex.xml', sha256: hash(packageXml(componentIds)) } };
    review.inventoryManifests = { [before.inventoryHash]: retrieval, [after.inventoryHash]: retrieval };
  }
  let orgBaselineInventories;
  if (asymmetric) {
    const [field, permission] = bootstrapIds;
    orgBaselineInventories = {
      devee: inventoryFromFiles({ ...files, [componentPaths[field][0]]: finalFiles[componentPaths[field][0]] }),
      qat: inventoryFromFiles({ ...files, [componentPaths[permission][0]]: finalFiles[componentPaths[permission][0]] }),
      production: baselineInventory,
    };
    review.orgBaselines = Object.fromEntries(policy.environments.map(({ key, orgId }, index) => {
      const { sourceTreeHash, inventoryHash } = orgBaselineInventories[key];
      return [key, { orgId, commit: String(index + 1).repeat(40), sourceTreeHash, inventoryHash }];
    }));
  }
  const inputs = { review, manifestBytes, bootstrapBytes, baselineWorkflow, baselineInventory, orgBaselineInventories, finalInventory, policy };
  const plan = createReviewedSalesforcePlan(inputs);
  const directory = mkdtempSync(path.join(tmpdir(), 'fcos-reviewed-sf-'));
  let journal = openSalesforcePromotionJournal({ directory, binding: plan.binding, now });
  const calls = [], assignments = new Set(), checkpoints = [];
  const orgInventories = new Map(policy.environments.map(({ key }) => [key, structuredClone(reviewedCheckpointInventory(plan, {}, key))]));
  let sequence = 100;
  const provider = {
    async verifyInventory(environment, expected) { calls.push(['inventory', environment.key, expected.expectedInventoryHash]);
      const actual = orgInventories.get(environment.key);
      return { orgId: environment.orgId, sourceTreeHash: actual.sourceTreeHash || null, inventoryHash: actual.inventoryHash, verifiedAt: fixedNow.toISOString(), evidenceSha256: 'a'.repeat(64),
        verificationMethod: actual.nativeExport ? 'metadata-api-reviewed-native-byte-inventory' : 'metadata-api-owned-tree-inventory',
        scope: 'force-app/main/default', observedInventory: structuredClone(actual.files),
        ...(actual.nativeExport ? { nativeSourceTreeHash: 'd'.repeat(64), apexProjectionVerified: actual.verifyApexProjection === true } : {}),
        ...(actual.absentComponents ? { absentComponents: actual.absentComponents, absenceVerificationMethod: 'native-metadata-catalog',
          absenceEvidenceSha256: 'b'.repeat(64) } : {}),
        identity: { alias: environment.alias, orgId: environment.orgId, isSandbox: environment.isSandbox, username: environment.username || 'production@example.invalid', connectedStatus: 'Connected' } }; },
    async verifyIdentity(environment) { calls.push(['identity', environment.key]); },
    async report(environment, id) { calls.push(['report', environment.key, id]); return reports.get(id); },
    async validate(environment) { const id = jobId(++sequence); calls.push(['validate', environment.key, id]); reports.set(id, makeReport(id, true)); return { id }; },
    async deploy(environment, validationId) {
      const id = jobId(++sequence);
      calls.push(['deploy', environment.key, validationId, id]);
      reports.set(id, makeReport(id, false, { zero: true }));
      orgInventories.set(environment.key, structuredClone(reviewedCheckpointInventory(plan, { deployment: { status: 'Succeeded' } }, environment.key)));
      return { id };
    },
    async bootstrap(environment) { const id = jobId(++sequence); calls.push(['bootstrap', environment.key, id]);
      const report = makeReport(id, false, { zero: true });
      report.details.componentSuccesses = bootstrapIds.map(id => { const [componentType, fullName] = id.split(':'); return { componentType, fullName, success: true }; });
      reports.set(id, report); orgInventories.set(environment.key, reviewedCheckpointInventory(plan, { bootstrap: { status: 'Succeeded' } }, environment.key)); return { id }; },
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

test('reviewed validation rules require exact source and positive test proof in the full package', () => {
  const f = fixture({ bootstrap: true, validationRule: true });
  try {
    assert.ok(f.plan.manifest.includes(validationRuleId));
    assert.ok(f.plan.changedFiles.includes(validationRulePath));
    assert.ok(!f.plan.review.bootstrap.components.includes(validationRuleId));
    const mismatched = { ...f.inputs, review: structuredClone(f.inputs.review) };
    mismatched.review.components.find(({ id }) => id === validationRuleId).files = ['classes/Example.cls'];
    assert.throws(() => createReviewedSalesforcePlan(mismatched), /Incorrect component file\/dependency coverage/);
    const bootstrapComponents = [...f.plan.review.bootstrap.components, validationRuleId];
    const bootstrapBytes = packageXml(bootstrapComponents);
    const review = { ...f.inputs.review, bootstrap: {
      ...f.inputs.review.bootstrap, components: bootstrapComponents, sha256: hash(bootstrapBytes),
    } };
    assert.throws(() => createReviewedSalesforcePlan({ ...f.inputs, review, bootstrapBytes }), /only reviewed schema\/permission/);
    const environment = policy.environments[0], id = jobId(99);
    const report = f.makeReport(id, true);
    const intent = { environment, jobId: id, validation: true, testPlan: f.plan.binding.testPlan, expectedComponents: f.plan.manifest };
    assert.equal(assertReviewedJobReport(report, intent).apexTestProof, true);
    report.details.componentSuccesses = report.details.componentSuccesses.filter(({ componentType }) => componentType !== 'ValidationRule');
    assert.throws(() => assertReviewedJobReport(report, intent), /missing reviewed manifest component coverage/);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});

test('reviewed Trading FX UI metadata binds exact page, permission, action and layout files', () => {
  const f = fixture({ bootstrap: true, inventoryBaseline: true });
  try {
    const extra = {
      'ApexPage:NativeInvoice': ['pages/NativeInvoice.page', 'pages/NativeInvoice.page-meta.xml'],
      'CustomPermission:NativeInvoice': ['customPermissions/NativeInvoice.customPermission-meta.xml'],
      'QuickAction:Invoice__c.Finalize': ['quickActions/Invoice__c.Finalize.quickAction-meta.xml'],
      'Layout:Invoice__c-Invoice Layout': ['layouts/Invoice__c-Invoice Layout.layout-meta.xml'],
    };
    const finalInventory = inventoryFromFiles({ ...files, ...Object.fromEntries(
      [...f.plan.changedFiles, ...Object.values(extra).flat()].map(name => [name, Buffer.from('<changed/>\n')]),
    ) });
    const manifestBytes = packageXml([...f.plan.manifest, ...Object.keys(extra)]);
    const review = { ...f.inputs.review, manifestSha256: hash(manifestBytes), sourceTreeHash: finalInventory.sourceTreeHash,
      components: [...f.inputs.review.components, ...Object.entries(extra).map(([id, paths]) => ({ id, files: paths, dependsOn: [] }))],
      inventoryCatalogControls: { production: ['QuickAction:Account.Child_Account', 'CustomPermission:ExistingPermission'] } };
    const input = { ...f.inputs, review, manifestBytes, finalInventory };
    const plan = createReviewedSalesforcePlan(input);
    assert.ok(Object.keys(extra).every(id => plan.manifest.includes(id) && !plan.review.bootstrap.components.includes(id)));
    assert.throws(() => createReviewedSalesforcePlan({ ...input, review: { ...review,
      inventoryCatalogControls: { production: ['CustomPermission:NativeInvoice'] } } }), /exact independent metadata members/);
    const page = review.components.find(({ id }) => id === 'ApexPage:NativeInvoice');
    page.files = [page.files[0]];
    assert.throws(() => createReviewedSalesforcePlan(input), /Incorrect component file\/dependency coverage for ApexPage/);
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

test('restores the exact deferred Production preparation without repeating a completed bootstrap', async () => {
  const f = fixture({ bootstrap: true });
  try {
    await f.run('prepare');
    const original = f.journal.state.stages.production.preparation;
    const preparation = { status: original.status, bootstrapSha256: original.bootstrapSha256, recordedAt: original.recordedAt };
    const evidence = { fingerprint: f.plan.fingerprint, stage: 'production', operation: 'preparation',
      outcome: 'evidence', evidenceDigest: digest(original), preparation };
    f.externalJournal.readCheckpoints = async () => [evidence];
    delete f.journal.state.stages.production.preparation;
    f.calls.length = 0;
    preparation.bootstrapSha256 = 'f'.repeat(64);
    await assert.rejects(f.run('apply', { authorization: f.authorization }), /successful prepare checkpoint/);
    assert.deepEqual(f.calls, []);
    preparation.bootstrapSha256 = original.bootstrapSha256;
    await assert.rejects(f.run('apply'), /Production mutation requires/);
    assert.deepEqual(f.calls, []);

    f.provider.prepareValidation = (environment) => {
      assert.equal(environment.key, 'production');
      throw Error('local validation preparation interrupted');
    };
    await assert.rejects(f.run('apply', { authorization: f.authorization }), /local validation preparation interrupted/);
    const bootstrapId = f.journal.state.stages.production.bootstrap.jobId;
    assert.ok(bootstrapId);
    assert.equal(f.journal.state.stages.production.validation, undefined);
    delete f.journal.state.stages.production.preparation;
    delete f.provider.prepareValidation;
    f.calls.length = 0;
    await f.run('apply', { authorization: f.authorization });
    assert.deepEqual(f.journal.state.stages.production.preparation, {
      ...original, originalRecordedAt: original.recordedAt, recoveredEvidenceDigest: evidence.evidenceDigest,
    });
    assert.equal(f.checkpoints.filter(row => row.operation === 'preparation').length, 1);
    assert.equal(f.journal.state.stages.production.bootstrap.jobId, bootstrapId);
    assert.ok(f.calls.some(call => call[0] === 'report' && call[2] === bootstrapId));
    assert.ok(!f.calls.some(call => call[0] === 'bootstrap'));
    assert.deepEqual(f.calls.filter(call => call[0] === 'validate').map(call => call[1]), ['production']);
    assert.deepEqual(f.calls.filter(call => call[0] === 'deploy').map(call => call[1]), ['production']);
  } finally { f.cleanup(); }
});

test('per-org baselines are checked before mutation and schema overlays preserve the exact remaining absences', async () => {
  const f = fixture({ bootstrap: true, inventoryBaseline: true, asymmetric: true, validationRule: true });
  try {
    const environmentKeys = policy.environments.map(({ key }) => key);
    const initial = environmentKeys.map(key => reviewedCheckpointInventory(f.plan, {}, key));
    assert.equal(new Set(initial.map(item => item.inventoryHash)).size, 3);
    assert.deepEqual(initial.map(item => item.absentComponents), [
      ['PermissionSet:Reviewed', validationRuleId],
      ['CustomField:Demo__c.Value__c', validationRuleId],
      ['CustomField:Demo__c.Value__c', 'PermissionSet:Reviewed', validationRuleId],
    ]);
    const afterBootstrap = reviewedCheckpointInventory(f.plan, { bootstrap: { status: 'Succeeded' } }, 'devee');
    assert.deepEqual(afterBootstrap.absentComponents, [validationRuleId]);
    const verifyInventory = f.provider.verifyInventory;
    f.provider.verifyInventory = async (environment, input) => {
      const receipt = await verifyInventory(environment, input);
      if (environment.key === 'production') delete receipt.absentComponents;
      return receipt;
    };
    await assert.rejects(f.run('prepare'), /lacks native evidence for the exact absent reviewed components/);
    assert.deepEqual(f.calls, [
      ...environmentKeys.map(key => ['identity', key]),
      ...environmentKeys.map((key, index) => ['inventory', key, initial[index].inventoryHash]),
    ]);
    f.provider.verifyInventory = verifyInventory;
    const prepared = await f.run('prepare');
    assert.equal(prepared.productionValidation, 'deferred-until-authorized-bootstrap');
    assert.deepEqual(f.calls.filter(([operation]) => operation === 'bootstrap').map(([, key]) => key), ['devee', 'qat']);
    await f.run('apply', { authorization: f.authorization });
    assert.deepEqual(f.calls.filter(([operation]) => operation === 'bootstrap').map(([, key]) => key), environmentKeys);
  } finally { f.cleanup(); }
});

test('per-org baselines reject a substituted org, removal, and a partially present reviewed component', () => {
  const f = fixture({ bootstrap: true, inventoryBaseline: true, asymmetric: true });
  try {
    const inputs = structuredClone(f.inputs);
    inputs.manifestBytes = f.inputs.manifestBytes;
    inputs.bootstrapBytes = f.inputs.bootstrapBytes;
    inputs.review.orgBaselines.qat.orgId = inputs.review.orgBaselines.devee.orgId;
    assert.throws(() => createReviewedSalesforcePlan(inputs), /qat baseline Git tree or pinned org/);
    inputs.review.orgBaselines.qat = { ...f.inputs.review.orgBaselines.qat };
    const inventory = inventoryFromFiles({ ...files, 'objects/Unrelated__c/Unrelated__c.object-meta.xml': Buffer.from('<CustomObject/>') });
    inputs.orgBaselineInventories.qat = inventory;
    Object.assign(inputs.review.orgBaselines.qat, { inventoryHash: inventory.inventoryHash, sourceTreeHash: inventory.sourceTreeHash });
    assert.throws(() => createReviewedSalesforcePlan(inputs), /qat baseline would require metadata removal/);
    const partial = inventoryFromFiles({ 'classes/Example.cls': files['classes/Example.cls'] });
    inputs.orgBaselineInventories.qat = partial;
    Object.assign(inputs.review.orgBaselines.qat, { inventoryHash: partial.inventoryHash, sourceTreeHash: partial.sourceTreeHash });
    assert.throws(() => createReviewedSalesforcePlan(inputs), /qat baseline has a partially present reviewed component/);
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

test('native Apex checkpoints carry through DEVEE publication while the mirror remains bound to LF source', async () => {
  const f = fixture({ inventoryBaseline: true, nativeRaw: true });
  try {
    assert.equal((await f.run('prepare')).productionValidation, 'Succeeded');
    const input = { plan: f.plan, state: f.journal.state, policy, provider: f.provider, assertUnchanged: async () => {}, now };
    const proof = await reviewedDeveePublicationProof(input);
    assert.equal(proof.sourceTreeHash, f.plan.finalInventory.sourceTreeHash);
    assert.equal(proof.nativeInventoryHash, f.plan.nativeInventories.devee.final.inventoryHash);
    assert.notEqual(proof.nativeInventoryHash, f.plan.finalInventory.inventoryHash);
    assert.equal(proof.nativeSourceTreeHash, 'd'.repeat(64));
    assert.equal(proof.verifiedAt, fixedNow.toISOString());
    const verify = f.provider.verifyInventory;
    f.provider.verifyInventory = async (...args) => ({ ...await verify(...args), apexProjectionVerified: false });
    await assert.rejects(reviewedDeveePublicationProof(input), /requires current native owned-tree file evidence/);
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

test('hosted stage derives its bootstrap binding from the reviewed tracked candidate files before opening a browser', async () => {
  const f = fixture({ bootstrap: true, inventoryBaseline: true });
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-stage-bootstrap-'));
  const run = args => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (name, bytes) => {
    const file = path.join(cwd, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  const commit = message => {
    run(['add', '.']);
    run(['-c', 'user.name=Offline Test', '-c', 'user.email=offline@example.invalid', 'commit', '-qm', message]);
  };
  try {
    run(['init', '--quiet']);
    for (const [name, bytes] of Object.entries(files)) write(`force-app/main/default/${name}`, bytes);
    commit('baseline');
    const baselineCommit = run(['rev-parse', 'HEAD']);
    const review = { ...f.inputs.review, baselineCommit };
    write('sfdx-project.json', JSON.stringify({ namespace: '', packageDirectories: [{ path: 'force-app', default: true }] }));
    write('force-app/main/default/objects/Demo__c/fields/Value__c.field-meta.xml', '<CustomField/>\n');
    commit('sandbox baseline');
    const sandboxCommit = run(['rev-parse', 'HEAD']);
    review.orgBaselines = Object.fromEntries(policy.environments.map(({ key, orgId }) => {
      const sha = key === 'production' ? baselineCommit : sandboxCommit;
      const { sourceTreeHash, inventoryHash } = baselineGitInventory(cwd, sha);
      return [key, { orgId, commit: sha, sourceTreeHash, inventoryHash }];
    }));
    write('force-app/main/default/classes/Example.cls', 'class Example { String value; }\n');
    write('force-app/main/default/permissionsets/Reviewed.permissionset-meta.xml', '<PermissionSet/>\n');
    write('manifest/release.xml', f.inputs.manifestBytes);
    write('manifest/bootstrap.xml', f.inputs.bootstrapBytes);
    write('manifest/review.json', JSON.stringify(review));
    commit('candidate');
    const reviewed = loadReviewedSalesforcePlan({ cwd, manifestPath: 'manifest/release.xml', reviewPath: 'manifest/review.json', policy });
    assert.notEqual(reviewed.orgBaselineInventories.devee.inventoryHash, reviewed.orgBaselineInventories.production.inventoryHash);
    assert.equal(reviewed.orgBaselineInventories.devee, reviewed.orgBaselineInventories.qat);
    const plan = { backwardCompatible: true, deferSchemaDependentSmoke: true, deferredModules: ['hedge_desk'],
      salesforceManifestPath: 'manifest/release.xml', salesforceReviewPath: 'manifest/review.json',
      salesforceFingerprint: reviewed.fingerprint, salesforceSourceTreeHash: reviewed.binding.sourceTreeHash,
      bootstrapFingerprint: digest({ salesforceFingerprint: reviewed.fingerprint, bootstrapSha256: reviewed.binding.bootstrapSha256 }) };
    const input = { plan, salesforceCandidateDirectory: cwd, staged: {},
      manifest: { targets: targets(), selection: { salesforce: true, modules: ['hedge_desk'] }, prerequisites: { plan } } };
    await assert.rejects(verifyPreBootstrapStage({ ...input, plan: { ...plan, bootstrapFingerprint: 'f'.repeat(64) } }), /SALESFORCE_HOSTED_BOOTSTRAP_PLAN_MISMATCH/);
    await assert.rejects(verifyPreBootstrapStage(input), /SMOKE_DEPLOYMENT_BINDING_MISMATCH/);
    const approval = { manifestHash: digest(input.manifest), nativeReviewVerified: true, reviewer: targets().account };
    const apply = { ...input, approval, env: {}, salesforce: {
      journal: { readCheckpoints: async () => { throw Error('Unexpected checkpoint read'); } },
      ownership: { assert: async () => { throw Error('Unexpected ownership claim'); } },
    } };
    await assert.rejects(applyReviewedPrerequisites({ ...apply, approval: { ...approval, nativeReviewVerified: false } }), /SALESFORCE_HOSTED_REVIEW_REQUIRED/);
    await assert.rejects(applyReviewedPrerequisites({ ...apply, plan: { ...plan, deferSchemaDependentSmoke: false } }), /SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED/);
    await assert.rejects(applyReviewedPrerequisites({ ...apply, plan: { ...plan, bootstrapFingerprint: 'f'.repeat(64) } }), /SALESFORCE_HOSTED_BOOTSTRAP_PLAN_MISMATCH/);
    await assert.rejects(applyReviewedPrerequisites(apply), /SALESFORCE_HOSTED_RUNNER_REQUIRED/);
    const { deferredModules, ...fullPlanFields } = plan;
    assert.deepEqual(deferredModules, ['hedge_desk']);
    const fullPlan = { ...fullPlanFields, deferSchemaDependentSmoke: false };
    const fullManifest = { ...apply.manifest, prerequisites: { plan: fullPlan } };
    const fullApply = { ...apply, plan: fullPlan, manifest: fullManifest, approval: { ...approval, manifestHash: digest(fullManifest) } };
    await assert.rejects(applyReviewedPrerequisites({ ...fullApply, approval }), /SALESFORCE_HOSTED_REVIEW_REQUIRED/);
    await assert.rejects(applyReviewedPrerequisites({ ...fullApply, plan: { ...fullPlan, bootstrapFingerprint: undefined } }), /SALESFORCE_HOSTED_BOOTSTRAP_PLAN_MISMATCH/);
    await assert.rejects(verifyPreBootstrapStage({ ...input, plan: fullPlan }), /SALESFORCE_HOSTED_BOOTSTRAP_PLAN_REQUIRED/);
    await assert.rejects(applyReviewedPrerequisites(fullApply), /SALESFORCE_HOSTED_RUNNER_REQUIRED/);
    run(['rm', '--cached', 'manifest/bootstrap.xml']);
    await assert.rejects(verifyPreBootstrapStage(input), /ls-files/);
  } finally {
    f.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
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
      expectedInventoryHash: expected.inventoryHash, expectedSourceTreeHash: expected.sourceTreeHash,
      expectedAbsentComponents: ['ApexClass:Missing'] };
    let retrievedProject, changed = false, retrieves = 0, displayCalls = 0, catalogCalls = 0;
    const provider = cliSalesforceProvider({ cwd, run(program, args, project) {
      assert.equal(program, 'sf');
      assert.equal(args[args.indexOf('--target-org') + 1], environment.alias);
      if (args[0] === 'org') {
        displayCalls++;
        return { id: environment.orgId, username: environment.username, connectedStatus: 'Connected' };
      }
      if (args[0] === 'data') {
        const query = args[args.indexOf('--query') + 1];
        if (query.includes('FROM Organization')) return { records: [{ Id: environment.orgId, IsSandbox: environment.isSandbox }] };
        assert.ok(args.includes('--use-tooling-api'));
        assert.match(query, /FROM ApexClass.*'Example','Missing'/u);
        catalogCalls++;
        return { totalSize: 1, done: true, records: [{ Name: 'Example' }] };
      }
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
    assert.deepEqual(receipt.absentComponents, input.expectedAbsentComponents);
    assert.match(receipt.absenceEvidenceSha256, /^[a-f0-9]{64}$/u);
    assert.equal(catalogCalls, 1);
    assert.equal(displayCalls, 2);
    assert.throws(() => readFileSync(path.join(retrievedProject, 'inventory.xml')), { code: 'ENOENT' });

    changed = true;
    assert.throws(() => provider.verifyInventory(environment, input), /differs from the exact reviewed inventory/);
    assert.throws(() => readFileSync(path.join(retrievedProject, 'inventory.xml')), { code: 'ENOENT' });
    descriptor.sha256 = '0'.repeat(64);
    assert.throws(() => provider.verifyInventory(environment, input), /manifest digest mismatch/);
    assert.equal(retrieves, 2);
    assert.equal(catalogCalls, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('native bootstrap stages only exact reviewed files in a temporary project', () => {
  const f = fixture({ bootstrap: true, validationRule: true });
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-bootstrap-fixture-'));
  const field = 'objects/Demo__c/fields/Value__c.field-meta.xml';
  const permission = 'permissionsets/Reviewed.permissionset-meta.xml';
  const source = path.join(cwd, policy.publication.sourceRoot);
  const fieldSource = "<CustomField><defaultValue>false</defaultValue><description> </description><label>Party's field</label></CustomField>\n";
  f.plan.finalInventory.files[field] = { sha256: hash(Buffer.from(fieldSource)), size: Buffer.byteLength(fieldSource) };
  try {
    for (const [name, bytes] of Object.entries({
      [field]: fieldSource,
      [permission]: '<PermissionSet/>\n',
      'objects/Demo__c/Demo__c.object-meta.xml': '<CustomObject><actionOverrides/></CustomObject>\n',
      [validationRulePath]: '<ValidationRule/>\n',
    })) {
      const file = path.join(source, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    mkdirSync(path.join(cwd, 'manifest'));
    const manifest = path.join(cwd, 'manifest/bootstrap.xml');
    writeFileSync(manifest, f.inputs.bootstrapBytes);
    let submittedProject, unexpectedChild = false, expandedParent = false;
    let roundTripField = fieldSource.replaceAll('><', '>\n  <').replace("Party's", 'Party&apos;s');
    const provider = cliSalesforceProvider({ cwd, run(program, args, project) {
      assert.equal(program, 'sf');
      if (args[1] === 'convert') {
        const output = args[args.indexOf('--output-dir') + 1];
        if (args[2] === 'source') {
          mkdirSync(path.join(output, 'objects'), { recursive: true });
          mkdirSync(path.join(output, 'permissionsets'));
          writeFileSync(path.join(output, 'package.xml'), f.inputs.bootstrapBytes);
          writeFileSync(path.join(output, 'objects/Demo__c.object'),
            `<CustomObject><fields><fullName>Value__c</fullName></fields>${expandedParent ? '<actionOverrides/>' : ''}</CustomObject>\n`);
          writeFileSync(path.join(output, 'permissionsets/Reviewed.permissionset'), '<PermissionSet/>\n');
        } else {
          assert.equal(args[2], 'mdapi');
          const root = path.join(output, 'main/default');
          for (const name of [field, permission]) {
            const dest = path.join(root, name);
            mkdirSync(path.dirname(dest), { recursive: true });
            const bytes = readFileSync(path.join(project, policy.publication.sourceRoot, name));
            writeFileSync(dest, name === field && roundTripField !== undefined ? roundTripField : bytes);
          }
          writeFileSync(path.join(root, 'objects/Demo__c/Demo__c.object-meta.xml'),
            '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>\n');
          if (unexpectedChild) {
            const dest = path.join(root, 'objects/Demo__c/validationRules/Unreviewed.validationRule-meta.xml');
            mkdirSync(path.dirname(dest), { recursive: true });
            writeFileSync(dest, '<ValidationRule/>\n');
          }
        }
        return {};
      }
      assert.deepEqual(args.slice(0, 3), ['project', 'deploy', 'start']);
      assert.equal(args[args.indexOf('--test-level') + 1], 'NoTestRun');
      assert.equal(args[args.indexOf('--target-org') + 1], policy.environments[0].alias);
      assert.notEqual(project, cwd);
      assert.ok(!args.includes('--single-package'));
      const converted = args[args.indexOf('--metadata-dir') + 1];
      assert.deepEqual(readFileSync(path.join(converted, 'package.xml')), f.inputs.bootstrapBytes);
      const staged = path.join(project, policy.publication.sourceRoot);
      assert.equal(readFileSync(path.join(staged, field), 'utf8'), fieldSource);
      assert.equal(readFileSync(path.join(staged, permission), 'utf8'), '<PermissionSet/>\n');
      assert.throws(() => readFileSync(path.join(staged, 'objects/Demo__c/Demo__c.object-meta.xml')), { code: 'ENOENT' });
      assert.throws(() => readFileSync(path.join(staged, validationRulePath)), { code: 'ENOENT' });
      submittedProject = project;
      return { id: jobId(99) };
    } });
    const prepared = provider.prepareBootstrap(policy.environments[0], f.plan);
    try {
      assert.equal(submittedProject, undefined);
      assert.deepEqual(prepared.submit(), { id: jobId(99) });
    } finally { prepared.cleanup(); }
    assert.throws(() => readFileSync(path.join(submittedProject, 'bootstrap.xml')), { code: 'ENOENT' });
    unexpectedChild = true;
    assert.throws(() => provider.prepareBootstrap(policy.environments[0], f.plan), /expanded outside reviewed source/);
    unexpectedChild = false;
    expandedParent = true;
    assert.throws(() => provider.prepareBootstrap(policy.environments[0], f.plan), /expanded outside reviewed source/);
    expandedParent = false;
    roundTripField = fieldSource.replace('false', 'true');
    assert.throws(() => provider.prepareBootstrap(policy.environments[0], f.plan), /definition differs from reviewed source/);
    roundTripField = fieldSource.replace('> </description>', '></description>');
    assert.throws(() => provider.prepareBootstrap(policy.environments[0], f.plan), /definition differs from reviewed source/);
    writeFileSync(path.join(source, field), 'changed');
    assert.throws(() => provider.prepareBootstrap(policy.environments[0], f.plan), /bootstrap source changed/);
    writeFileSync(manifest, 'changed');
    assert.throws(() => provider.prepareBootstrap(policy.environments[0], f.plan), /bootstrap manifest changed/);
  } finally {
    f.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('failed local bootstrap preparation leaves no uncertain provider intent', async () => {
  const f = fixture({ bootstrap: true });
  try {
    f.provider.prepareBootstrap = () => { throw new Error('Invalid local bootstrap package'); };
    await assert.rejects(f.run('prepare'), /Invalid local bootstrap package/);
    assert.equal(f.journal.state.stages.devee?.bootstrap, undefined);
    assert.ok(!f.checkpoints.some(({ operation }) => operation === 'bootstrap'));
    assert.ok(!f.calls.some(([operation]) => operation === 'bootstrap'));
  } finally { f.cleanup(); }
});

test('native validation submits only the verified metadata package with the reviewed test arguments', () => {
  const f = fixture({ level: 'RunSpecifiedTests' });
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-validation-fixture-'));
  const selected = { ...files, 'classes/Example.cls': Buffer.from('class Example { String value; }\n') };
  const put = (root, name, bytes) => {
    const destination = path.join(root, name);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  };
  let payload, submits = 0;
  try {
    for (const [name, bytes] of Object.entries(selected)) put(cwd, `${policy.publication.sourceRoot}/${name}`, bytes);
    put(cwd, 'manifest.xml', f.inputs.manifestBytes);
    const provider = cliSalesforceProvider({ cwd, run(_program, args, project) {
      if (args[1] === 'convert') {
        const output = args[args.indexOf('--output-dir') + 1];
        if (args[2] === 'source') {
          payload = output;
          put(output, 'package.xml', f.inputs.manifestBytes);
        }
        const root = args[2] === 'source' ? output : path.join(output, 'main/default');
        for (const [name, bytes] of Object.entries(selected)) put(root, name, bytes);
        return {};
      }
      submits++;
      assert.deepEqual(args.slice(0, 3), ['project', 'deploy', 'validate']);
      assert.equal(args[args.indexOf('--metadata-dir') + 1], payload);
      assert.equal(args[args.indexOf('--test-level') + 1], 'RunSpecifiedTests');
      assert.equal(args[args.indexOf('--tests') + 1], 'ExampleTest');
      assert.ok(!args.includes('--single-package') && !args.includes('--manifest'));
      assert.notEqual(project, cwd);
      return { id: jobId(98) };
    } });
    const plan = { ...f.plan, manifestPath: 'manifest.xml' };
    const prepared = provider.prepareValidation(policy.environments[0], plan);
    try {
      assert.match(prepared.packageSha256, /^[a-f0-9]{64}$/u);
      assert.deepEqual(prepared.submit(), { id: jobId(98) });
      put(payload, 'classes/Example.cls', 'unexpected source');
      assert.throws(() => prepared.submit(), /package changed before submission/);
      assert.equal(submits, 1);
    } finally { prepared.cleanup(); }
  } finally {
    f.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('schema bootstrap accepts the native blank-typed package.xml descriptor only at the package root', () => {
  const f = fixture({ bootstrap: true });
  const environment = policy.environments[0], id = jobId(110);
  const expectedComponents = f.plan.review.bootstrap.components;
  const successes = expectedComponents.map(component => {
    const [componentType, fullName] = component.split(':');
    return { componentType, fullName, success: true };
  });
  const descriptor = { componentType: '', fullName: 'package.xml', fileName: 'zip/package.xml', success: true };
  const proof = f.makeReport(id, false);
  const intent = { environment, jobId: id, bootstrap: true, expectedComponents, testPlan: { level: 'NoTestRun' } };
  const report = { ...proof, numberTestsTotal: 0, numberTestsCompleted: 0,
    details: { componentSuccesses: [...successes, descriptor] } };
  try {
    assert.equal(assertReviewedJobReport(report, intent).testExecution, 'schema-only-bootstrap');
    for (const invalid of [
      { ...descriptor, fileName: 'zip/classes/Unreviewed.cls' },
      { ...descriptor, fullName: 'Unreviewed' },
      { ...descriptor, success: false },
    ]) {
      assert.throws(() => assertReviewedJobReport({ ...report, details: { componentSuccesses: [...successes, invalid] } }, intent),
        /unexpected non-schema component/);
    }
  } finally { f.cleanup(); }
});

test('validation conversion failure leaves no submission intent and resume keeps the original verified package receipt', async () => {
  const f = fixture();
  let conversions = 0;
  const validate = f.provider.validate;
  try {
    f.provider.prepareValidation = () => { throw new Error('Offline package verification failed'); };
    await assert.rejects(f.run('prepare'), /Offline package verification failed/);
    assert.ok(!f.checkpoints.some(({ operation }) => operation === 'validation'));
    f.provider.prepareValidation = environment => {
      conversions++;
      return { packageSha256: 'a'.repeat(64), submit: () => {
        assert.equal(f.journal.state.stages[environment.key].validation.packageSha256, 'a'.repeat(64));
        return validate(environment);
      }, cleanup() {} };
    };
    await f.run('prepare');
    assert.equal(conversions, 3);
    await f.run('apply', { authorization: f.authorization });
    assert.equal(conversions, 3);
  } finally { f.cleanup(); }
});

test('reviewed layouts and inventory profiles allow exact names with spaces', () => {
  const members = ['Layout:Invoice__c-Invoice Layout', 'Profile:Sales Support'];
  const manifest = packageXml(members).toString('utf8');
  assert.deepEqual(parseReviewedPackage(manifest, { inventory: true }), members);
  assert.deepEqual(parseReviewedPackage(packageXml([members[0]]).toString('utf8')), [members[0]]);
  assert.throws(() => parseReviewedPackage(manifest), /unsupported Salesforce members/);
  assert.throws(() => parseReviewedPackage(packageXml(['Profile:Sales *']).toString('utf8'), { inventory: true }), /Wildcards/);
  assert.throws(() => parseReviewedPackage(packageXml(['ApexClass:Example Class']).toString('utf8'), { inventory: true }), /unsupported Salesforce members/);
});

test('hosted recovery refuses a fresh runner with unresolved durable provider history', async () => {
  const f = fixture();
  try {
    f.externalJournal.readCheckpoints = async () => [{ fingerprint: f.plan.fingerprint, stage: 'devee',
      operation: 'validation', outcome: 'pending', job: { id: jobId(1) } }];
    await assert.rejects(f.run('prepare'), /reconcile the original checkpoint/);
    assert.deepEqual(f.calls, []);
  } finally {
    f.cleanup();
  }
});

test('fresh hosted recovery reads completed permission assignments and preserves their original prestate', async () => {
  const f = fixture({ bootstrap: true });
  try {
    f.assignments.add('qat:Reviewed');
    await f.run('prepare');
    const entries = ['devee', 'qat'].map(stage => {
      const operation = 'permission:Reviewed';
      const { name, orgId, prestate } = f.journal.state.stages[stage][operation];
      delete f.journal.state.stages[stage][operation];
      return { fingerprint: f.plan.fingerprint, stage, operation, outcome: 'resolved',
        evidenceDigest: 'a'.repeat(64), permission: { name, orgId, prestate } };
    });
    f.externalJournal.readCheckpoints = async () => entries;
    f.calls.length = 0;
    f.checkpoints.length = 0;
    await f.run('prepare');
    assert.deepEqual(entries.map(({ stage, operation }) => {
      const record = f.journal.state.stages[stage][operation];
      return [record.prestate, record.addedByRelease];
    }), [[false, true], [true, false]]);
    for (const entry of entries) {
      const record = f.journal.state.stages[entry.stage][entry.operation];
      assert.equal(matchesSalesforceCheckpoint(record, entry), true);
      assert.equal(matchesSalesforceCheckpoint(record, { ...entry, evidenceDigest: 'b'.repeat(64) }), false);
      assert.equal(matchesSalesforceCheckpoint(record, { ...entry, permission: { ...entry.permission, prestate: !record.prestate } }), false);
    }
    f.reopen();
    await f.run('prepare');
    assert.ok(!f.calls.some(([action]) => ['bootstrap', 'permission-write', 'validate', 'deploy'].includes(action)));
    assert.ok(!f.checkpoints.some(({ operation }) => operation === 'permission:Reviewed'));
  } finally { f.cleanup(); }
});

test('hosted permission recovery fences ambiguous locators and provider drift', async () => {
  const f = fixture({ bootstrap: true });
  try {
    const operation = 'permission:Reviewed';
    const entry = { fingerprint: f.plan.fingerprint, stage: 'devee', operation,
      outcome: 'resolved', evidenceDigest: 'a'.repeat(64),
      permission: { name: 'Reviewed', orgId: f.plan.binding.orgIds.devee, prestate: false } };
    for (const invalid of [{ ...entry, permission: undefined }, { ...entry, outcome: 'pending' },
      { ...entry, permission: { ...entry.permission, orgId: f.plan.binding.orgIds.qat } }]) {
      f.externalJournal.readCheckpoints = async () => [invalid];
      await assert.rejects(f.run('prepare'), /reconcile the original checkpoint/);
      assert.deepEqual(f.calls, []);
    }
    f.externalJournal.readCheckpoints = async () => [entry];
    await assert.rejects(f.run('prepare'), /previously verified permission assignment drifted/);
    assert.deepEqual(f.calls, [['identity', 'devee'], ['permission-read', 'devee', 'Reviewed']]);
    assert.equal(f.journal.state.stages.devee?.[operation], undefined);
  } finally { f.cleanup(); }
});

test('fresh hosted runner verifies and reuses a known durable validation job', async () => {
  const f = fixture();
  try {
    const id = jobId(19);
    f.reports.set(id, f.makeReport(id, true));
    f.externalJournal.readCheckpoints = async () => [{ fingerprint: f.plan.fingerprint, stage: 'devee',
      operation: 'validation', outcome: 'pending', job: { id, validationId: null, submittedAt: fixedNow.toISOString() } }];
    f.provider.reconcile = async (org, jobId, { operation }) => ({
      fingerprint: f.plan.fingerprint, orgId: org.orgId, jobId, operation,
      sourceTreeHash: f.plan.binding.sourceTreeHash, manifestSha256: f.plan.binding.manifestSha256,
      evidenceSha256: 'b'.repeat(64), verifiedAt: fixedNow.toISOString(),
    });
    await f.run('prepare');
    assert.equal(f.journal.state.stages.devee.validation.jobId, id);
    assert.ok(f.calls.some(call => call[0] === 'report' && call[2] === id));
    assert.ok(!f.calls.some(call => call[0] === 'validate' && call[1] === 'devee'));
  } finally {
    f.cleanup();
  }
});

test('missing local mirror receipt can only be recovered at the original verified draft head', async () => {
  const f = fixture();
  try {
    await f.run('prepare');
    delete f.journal.state.stages.shared_mirror.publication;
    const mirror = { commit: 'c'.repeat(40), pullRequest: 123 };
    f.externalJournal.readCheckpoints = async () => [{ fingerprint: f.plan.fingerprint, stage: 'shared_mirror',
      operation: 'publication', outcome: 'resolved', mirror }];
    f.calls.length = 0;
    await assert.rejects(f.run('prepare'), /differs from the original durable publication/);
    assert.deepEqual(f.calls.filter(call => call[0] === 'mirror'), [['mirror', 'check']]);
    mirror.commit = 'b'.repeat(40);
    f.calls.length = 0;
    await f.run('prepare');
    assert.equal(f.journal.state.stages.shared_mirror.publication.result.commit, mirror.commit);
    assert.ok(!f.calls.some(call => call[0] === 'mirror' && call[1] === 'publish'));
  } finally {
    f.cleanup();
  }
});

test('recovers missing completed preparation only for its exact saved Production validation', async () => {
  const f = fixture();
  try {
    await f.run('prepare');
    const original = f.journal.state.stages.production.validation.jobId;
    delete f.journal.state.stages.production.preparation;
    const preparation = { validationJobId: jobId(99) };
    f.externalJournal.readCheckpoints = async () => [{ fingerprint: f.plan.fingerprint, stage: 'production',
      operation: 'preparation', outcome: 'evidence', preparation }];
    f.calls.length = 0;
    await assert.rejects(f.run('apply', { authorization: f.authorization }), /successful prepare checkpoint/);
    assert.deepEqual(f.calls, []);
    preparation.validationJobId = original;
    await assert.rejects(f.run('apply'), /Production mutation requires/);
    assert.deepEqual(f.calls, []);
    await f.run('apply', { authorization: f.authorization });
    assert.equal(f.journal.state.stages.production.preparation.validationJobId, original);
    assert.ok(f.calls.some(call => call[0] === 'deploy' && call[1] === 'production' && call[2] === original));
    assert.ok(!f.calls.some(call => call[0] === 'validate'));
  } finally {
    f.cleanup();
  }
});

test('native byte checkpoints pin each org and permit only reviewed Apex changes', () => {
  const f = fixture({ inventoryBaseline: true });
  try {
    const extra = 'lwc/Unrelated/Unrelated.js';
    const reviewed = (apex, outside = 'retained\r\n') => inventoryFromFiles({
      ...files, 'classes/Example.cls': Buffer.from(apex), [extra]: Buffer.from(outside),
    });
    const baseline = reviewed('class Example {}\r\n');
    const final = reviewed('class Example { String value; }\r\n');
    const descriptor = inv => ({ files: inv.files, inventoryHash: inv.inventoryHash });
    const review = { ...f.inputs.review,
      inventoryManifests: Object.fromEntries([baseline, final].map(inv =>
        [inv.inventoryHash, { path: 'inventory.xml', sha256: hash(packageXml(['Profile:Example'])),
          apex: { path: 'apex.xml', sha256: hash(packageXml(['ApexClass:Example'])) } }])),
      nativeInventories: Object.fromEntries(policy.environments.map(({ key, orgId }) =>
        [key, { orgId, baseline: descriptor(baseline), final: descriptor(final) }])) };
    const inputs = { ...f.inputs, review };
    const plan = createReviewedSalesforcePlan(inputs);
    assert.equal(plan.binding.sourceTreeHash, f.plan.binding.sourceTreeHash);
    assert.notEqual(plan.fingerprint, f.plan.fingerprint);
    assert.equal(reviewedCheckpointInventory(plan, {}, 'devee').inventoryHash, baseline.inventoryHash);
    const end = reviewedCheckpointInventory(plan, { deployment: { status: 'Succeeded' } }, 'qat');
    assert.equal(end.inventoryHash, final.inventoryHash);
    assert.equal(end.nativeExport, true);
    assert.equal(end.verifyApexProjection, true);
    assert.equal(end.sourceTreeHash, undefined);

    const altered = structuredClone(review);
    const drift = reviewed('class Example { String value; }\r\n', 'different\r\n');
    altered.nativeInventories.qat.final = descriptor(drift);
    altered.inventoryManifests[drift.inventoryHash] = review.inventoryManifests[final.inventoryHash];
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: altered }), /outside the reviewed Apex package/);
    altered.nativeInventories.qat.final = descriptor(final);
    altered.inventoryManifests[final.inventoryHash].path = 'different.xml';
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: altered }), /stable native retrieval manifest changes/);
    altered.inventoryManifests[final.inventoryHash].path = 'inventory.xml';
    altered.nativeInventories.qat.orgId = policy.environments[0].orgId;
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: altered }), /wrong pinned org/);
  } finally { f.cleanup(); }
});

test('mixed native checkpoints pin exact org paths and preserve untouched bytes across bootstrap and final', async () => {
  const f = fixture({ bootstrap: true, inventoryBaseline: true, validationRule: true });
  try {
    const [apex, field, permission, rule] = f.inputs.review.components;
    const fieldXml = '<CustomField><required>false</required></CustomField>\n';
    const initial = { ...files, 'classes/Example.cls': Buffer.from('class Example {}\r\n') };
    const intermediate = { ...initial, [field.files[0]]: Buffer.from(fieldXml),
      [permission.files[0]]: Buffer.from('<PermissionSet/>\r\n') };
    const final = { ...intermediate, 'classes/Example.cls': Buffer.from('class Example { String value; }\r\n'),
      [rule.files[0]]: Buffer.from('<ValidationRule/>\r\n') };
    const descriptor = entries => {
      const { files, inventoryHash } = inventoryFromFiles(entries);
      return { files, inventoryHash };
    };
    const baseline = descriptor(initial), bootstrap = descriptor(intermediate), complete = descriptor(final);
    const pin = (entry, ids) => [entry.inventoryHash, { path: 'inventory.xml', sha256: hash(packageXml(['Profile:Example'])),
      metadata: { path: 'components.xml', sha256: hash(packageXml(ids)) } }];
    const review = { ...f.inputs.review,
      nativeInventories: Object.fromEntries(policy.environments.map(({ key, orgId }) => [key, { orgId, baseline, bootstrap, final: complete }])),
      inventoryManifests: Object.fromEntries([pin(baseline, [apex.id]), pin(bootstrap, [apex.id, field.id, permission.id]),
        pin(complete, [apex.id, field.id, permission.id, rule.id])]) };
    const inputs = { ...f.inputs, review };
    const plan = createReviewedSalesforcePlan(inputs);
    assert.doesNotThrow(() => createReviewedSalesforcePlan({ ...inputs,
      review: { ...review, nativeCustomFieldFalseFlags: { [field.files[0]]: ['required'] } } }));
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs,
      review: { ...review, nativeCustomObjectDefaults: { [field.files[0]]: ['enableFeeds'] } } }), /exact reviewed bootstrap object paths/);
    for (const allowances of [{ [permission.files[0]]: ['required'] }, { [field.files[0]]: ['defaultValue'] },
      { [field.files[0]]: ['required', 'required'] }]) {
      assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: { ...review, nativeCustomFieldFalseFlags: allowances } }),
        /exact reviewed bootstrap field paths/);
    }
    const environment = policy.environments[0];
    const checkpoint = reviewedCheckpointInventory(plan, { bootstrap: { status: 'Succeeded' } }, environment.key);
    assert.equal(checkpoint.inventoryHash, bootstrap.inventoryHash);
    assert.deepEqual(checkpoint.projectionPaths, [...field.files, ...permission.files].sort());
    assert.deepEqual(checkpoint.absentComponents, [rule.id]);
    assert.equal(reviewedCheckpointInventory(plan, { deployment: { status: 'Succeeded' } }, environment.key).inventoryHash, complete.inventoryHash);
    const drift = descriptor({ ...intermediate, 'classes/Example.cls': Buffer.from('class Example { Integer unintended; }') });
    const changed = { ...review, nativeInventories: { ...review.nativeInventories,
      qat: { ...review.nativeInventories.qat, bootstrap: drift } },
      inventoryManifests: { ...review.inventoryManifests, [drift.inventoryHash]: review.inventoryManifests[bootstrap.inventoryHash] } };
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: changed }), /outside the reviewed transition/);
    const missing = descriptor({ ...initial, [field.files[0]]: Buffer.from(fieldXml) });
    changed.nativeInventories.qat.bootstrap = missing;
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: changed }), /exact owned paths/);
    let projection, permissionGrantEvidenceSha256;
    const provider = { verifyInventory(_environment, request) {
      assert.deepEqual(request.projectionPaths, checkpoint.projectionPaths);
      return { orgId: environment.orgId, identity: { alias: environment.alias, orgId: environment.orgId,
        isSandbox: environment.isSandbox, username: environment.username, connectedStatus: 'Connected' },
        sourceTreeHash: null, inventoryHash: checkpoint.inventoryHash, verifiedAt: now().toISOString(), evidenceSha256: 'a'.repeat(64),
        nativeSourceTreeHash: 'b'.repeat(64), observedInventory: checkpoint.files,
        verificationMethod: 'metadata-api-reviewed-native-byte-inventory', scope: 'force-app/main/default',
        verifiedProjectionPaths: projection, permissionSets: ['Reviewed'], permissionGrantEvidenceSha256, absentComponents: [rule.id], absenceVerificationMethod: 'native-metadata-catalog',
        absenceEvidenceSha256: 'c'.repeat(64) };
    } };
    await assert.rejects(verifyReviewedOrgInventory({ provider, environment, plan, expected: checkpoint, now }), /requires current native/);
    projection = checkpoint.projectionPaths;
    await assert.rejects(verifyReviewedOrgInventory({ provider, environment, plan, expected: checkpoint, now }), /lacks exact native PermissionSet grant evidence/);
    permissionGrantEvidenceSha256 = 'd'.repeat(64);
    await verifyReviewedOrgInventory({ provider, environment, plan, expected: checkpoint, now });

    const afterBootstrap = [...field.files, ...permission.files].sort();
    const afterFinal = f.inputs.review.components.flatMap(component => component.files).sort();
    const projected = (entries, paths) => {
      const pinned = inventoryFromFiles(Object.fromEntries(Object.entries(entries).filter(([name]) => !paths.includes(name)))).files;
      return { projected: true, files: pinned, inventoryHash: projectedNativeInventoryHash(pinned, paths) };
    };
    const projectedBootstrap = projected(intermediate, afterBootstrap), projectedFinal = projected(final, afterFinal);
    const projectedReview = { ...review,
      nativeInventories: Object.fromEntries(policy.environments.map(({ key, orgId }) =>
        [key, { orgId, baseline, bootstrap: projectedBootstrap, final: projectedFinal }])),
      inventoryManifests: { ...review.inventoryManifests,
        [projectedBootstrap.inventoryHash]: review.inventoryManifests[bootstrap.inventoryHash],
        [projectedFinal.inventoryHash]: review.inventoryManifests[complete.inventoryHash] } };
    const projectedPlan = createReviewedSalesforcePlan({ ...inputs, review: projectedReview });
    const projectedCheckpoint = reviewedCheckpointInventory(projectedPlan, { bootstrap: { status: 'Succeeded' } }, environment.key);
    assert.equal(projectedCheckpoint.projectedNativeInventory, true);
    assert.deepEqual(projectedCheckpoint.files, baseline.files);
    assert.notEqual(projectedCheckpoint.inventoryHash, bootstrap.inventoryHash);
    const unprojectedFinal = structuredClone(projectedReview);
    unprojectedFinal.nativeInventories.qat.final = complete;
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: unprojectedFinal }), /matching post-write checkpoint modes/);
    let observedFiles = bootstrap.files;
    const projectedProvider = { async verifyInventory(org, request) {
      assert.equal(request.projectedNativeInventory, true);
      const receipt = await provider.verifyInventory(org, request);
      return { ...receipt, inventoryHash: projectedCheckpoint.inventoryHash, observedInventory: observedFiles,
        observedNativeInventoryHash: hash(observedFiles) };
    } };
    const checkProjected = () => verifyReviewedOrgInventory({ provider: projectedProvider, environment,
      plan: projectedPlan, expected: projectedCheckpoint, now });
    await checkProjected();
    observedFiles = drift.files;
    await assert.rejects(checkProjected(), /requires current native/);
    observedFiles = missing.files;
    await assert.rejects(checkProjected(), /requires current native/);

    const contextFile = 'objects/Demo__c/fields/Unowned__c.field-meta.xml';
    const contextBytes = Buffer.from('<CustomField/>');
    const contextBaseline = descriptor({ ...initial, [contextFile]: contextBytes });
    const contextBootstrap = projected({ ...intermediate, [contextFile]: contextBytes }, afterBootstrap);
    const contextFinal = projected({ ...final, [contextFile]: contextBytes }, afterFinal);
    const contextReview = { ...projectedReview,
      nativeInventoryContext: Object.fromEntries(policy.environments.map(({ key }) => [key, [contextFile]])),
      nativeInventories: Object.fromEntries(policy.environments.map(({ key, orgId }) =>
        [key, { orgId, baseline: contextBaseline, bootstrap: contextBootstrap, final: contextFinal }])),
      inventoryManifests: { ...projectedReview.inventoryManifests,
        [contextBaseline.inventoryHash]: review.inventoryManifests[baseline.inventoryHash],
        [contextBootstrap.inventoryHash]: review.inventoryManifests[bootstrap.inventoryHash],
        [contextFinal.inventoryHash]: review.inventoryManifests[complete.inventoryHash] } };
    const contextPlan = createReviewedSalesforcePlan({ ...inputs, review: contextReview });
    const contextEnd = reviewedCheckpointInventory(contextPlan, { deployment: { status: 'Succeeded' } }, environment.key);
    assert.deepEqual(contextEnd.files[contextFile], contextBaseline.files[contextFile]);
    assert.ok(!contextEnd.projectionPaths.includes(contextFile));
    const changedContext = projected({ ...final, [contextFile]: Buffer.from('<CustomField><required>true</required></CustomField>') }, afterFinal);
    const contextDrift = structuredClone(contextReview);
    contextDrift.nativeInventories.qat.final = changedContext;
    contextDrift.inventoryManifests[changedContext.inventoryHash] = review.inventoryManifests[complete.inventoryHash];
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: contextDrift }), /outside the reviewed transition/);
    contextDrift.nativeInventoryContext.qat = [field.files[0]];
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: contextDrift }), /exact unowned object XML paths/);

    const installed = descriptor({ ...initial, [field.files[0]]: Buffer.from(fieldXml) });
    const preinstalledReview = { ...projectedReview,
      nativeInventories: { ...projectedReview.nativeInventories, devee: {
        ...projectedReview.nativeInventories.devee, baseline: installed, presentComponents: [apex.id, field.id],
      } },
      inventoryManifests: { ...projectedReview.inventoryManifests, [installed.inventoryHash]: {
        ...review.inventoryManifests[baseline.inventoryHash], metadata: { path: 'baseline-metadata.xml', sha256: hash(packageXml([apex.id, field.id])) },
      } } };
    const installedPlan = createReviewedSalesforcePlan({ ...inputs, review: preinstalledReview });
    const initialCheckpoint = reviewedCheckpointInventory(installedPlan, {}, 'devee');
    assert.deepEqual(initialCheckpoint.absentComponents, [permission.id, rule.id].sort());
    assert.equal(initialCheckpoint.inventoryHash, installed.inventoryHash);
    assert.ok(!Object.hasOwn(installedPlan.baselineInventory.files, field.files[0]));
    preinstalledReview.nativeInventories.devee.presentComponents = [field.id];
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: preinstalledReview }), /omits an already-owned reviewed component/);
    preinstalledReview.nativeInventories.devee.presentComponents = [apex.id, 'CustomField:Demo__c.Unreviewed__c'];
    assert.throws(() => createReviewedSalesforcePlan({ ...inputs, review: preinstalledReview }), /exact already-present reviewed components/);
  } finally { f.cleanup(); }
});

test('mixed native readback verifies reviewed definition content even when raw hashes match', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-native-metadata-fixture-'));
  try {
    const environment = policy.environments[0];
    const field = 'objects/Demo__c/fields/Value__c.field-meta.xml';
    const xml = content => `<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">${content}</CustomField>\n`;
    const source = { [field]: Buffer.from(xml('<required>false</required>')) };
    const stable = { 'profiles/Example.profile-meta.xml': Buffer.from('<Profile/>\r\n') };
    const shellPath = 'objects/Demo__c/Demo__c.object-meta.xml';
    const shell = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>\n');
    const stableObject = Buffer.from('<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"><label>Demo</label></CustomObject>');
    stable[shellPath] = stableObject;
    let extraMetadata = { [shellPath]: shell };
    let nativeField = Buffer.from(xml('\r\n  <required>false</required>\r\n').replace(/(?<!\r)\n/gu, '\r\n'));
    const metadata = packageXml(['CustomField:Demo__c.Value__c']);
    const manifest = packageXml(['Profile:Example', 'CustomObject:Demo__c']);
    const target = path.join(cwd, policy.publication.sourceRoot, field);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source[field]);
    writeFileSync(path.join(cwd, 'inventory.xml'), manifest);
    writeFileSync(path.join(cwd, 'metadata.xml'), metadata);
    writeFileSync(path.join(cwd, 'sfdx-project.json'), '{}');
    const provider = cliSalesforceProvider({ cwd, run(_program, args, project) {
      if (args[0] === 'org') return { id: environment.orgId, username: environment.username, connectedStatus: 'Connected' };
      if (args[0] === 'data') return { records: [{ Id: environment.orgId, IsSandbox: environment.isSandbox }] };
      const directory = args[args.indexOf('--output-dir') + 1];
      const returned = directory === 'metadata' ? { [field]: nativeField, ...extraMetadata } : stable;
      for (const [name, bytes] of Object.entries(returned)) {
        const destination = path.join(project, directory, name);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, bytes);
      }
      return { id: '09SHF000002gTFl2AM', status: 'Succeeded', done: true, success: true };
    } });
    const input = () => {
      const { inventoryHash } = inventoryFromFiles({ ...stable, [field]: nativeField });
      return { plan: { finalInventory: inventoryFromFiles(source), review: {
        components: [{ id: 'CustomField:Demo__c.Value__c', files: [field] }],
        inventoryManifests: { [inventoryHash]: { path: 'inventory.xml', sha256: hash(manifest),
          metadata: { path: 'metadata.xml', sha256: hash(metadata) } } },
      } }, expectedInventoryHash: inventoryHash, nativeExport: true, nativeBootstrap: true, projectionPaths: [field] };
    };
    const receipt = provider.verifyInventory(environment, input());
    assert.deepEqual(receipt.verifiedProjectionPaths, [field]);
    assert.deepEqual(receipt.supplementalObjectShells, { [shellPath]: { sha256: hash(shell), size: shell.length } });
    assert.equal(receipt.observedInventory[shellPath].sha256, hash(stableObject));
    stable[field] = nativeField;
    assert.deepEqual(provider.verifyInventory(environment, input()).supplementalDuplicates, [field]);
    stable[field] = Buffer.from(xml('<required>true</required>'));
    assert.throws(() => provider.verifyInventory(environment, input()), /conflicting bytes for reviewed field/);
    delete stable[field];
    extraMetadata = { [shellPath]: stableObject };
    assert.throws(() => provider.verifyInventory(environment, input()), /unexpected nonempty object descriptor/);
    extraMetadata = { 'objects/Unreviewed__c/Unreviewed__c.object-meta.xml': shell };
    assert.throws(() => provider.verifyInventory(environment, input()), /unexpected path set/);
    extraMetadata = { [shellPath]: shell, [validationRulePath]: Buffer.from('<ValidationRule/>') };
    assert.throws(() => provider.verifyInventory(environment, input()), /unexpected path set/);
    extraMetadata = { [shellPath]: shell };
    const exact = input();
    const pinned = inventoryFromFiles(stable).files;
    const projectedHash = projectedNativeInventoryHash(pinned, [field]);
    const projected = { ...exact, projectedNativeInventory: true, expectedInventory: pinned, expectedInventoryHash: projectedHash };
    projected.plan.review.inventoryManifests[projectedHash] = exact.plan.review.inventoryManifests[exact.expectedInventoryHash];
    const projectedReceipt = provider.verifyInventory(environment, projected);
    assert.equal(projectedReceipt.inventoryHash, projectedHash);
    assert.equal(projectedReceipt.observedNativeInventoryHash, exact.expectedInventoryHash);
    nativeField = Buffer.from(xml('<required>false</required>'));
    const equivalentReceipt = provider.verifyInventory(environment, projected);
    assert.notEqual(equivalentReceipt.observedNativeInventoryHash, projectedReceipt.observedNativeInventoryHash);
    assert.equal(equivalentReceipt.inventoryHash, projectedHash);
    const profile = Object.keys(stable)[0];
    stable[profile] = Buffer.from('<Profile><custom>true</custom></Profile>');
    assert.throws(() => provider.verifyInventory(environment, projected), /differs from the exact reviewed inventory/);
    stable[profile] = Buffer.from('<Profile/>\r\n');
    nativeField = Buffer.from(xml('<required>true</required>'));
    assert.throws(() => provider.verifyInventory(environment, input()), /Native metadata projection differs/);
    assert.throws(() => provider.verifyInventory(environment, projected), /Native metadata projection differs/);
    const checkWithFlags = flags => {
      const checkpoint = input();
      checkpoint.plan.review.nativeCustomFieldFalseFlags = { [field]: flags };
      return provider.verifyInventory(environment, checkpoint);
    };
    nativeField = Buffer.from(xml('<required>false</required><trackHistory>false</trackHistory>'));
    assert.deepEqual(checkWithFlags(['trackHistory']).verifiedProjectionPaths, [field]);
    assert.throws(() => checkWithFlags(['required', 'trackHistory']), /Native CustomField serialization differs/);
    for (const variation of ['<trackHistory>true</trackHistory>', '<trackHistory>false</trackHistory><trackHistory>false</trackHistory>',
      '<trackHistory>false</trackHistory><defaultValue>false</defaultValue>']) {
      nativeField = Buffer.from(xml('<required>false</required>' + variation));
      assert.throws(() => checkWithFlags(['trackHistory']), /Native CustomField serialization differs/);
    }
    source[field] = Buffer.from(xml('<required>false</required><trackHistory>false</trackHistory>'));
    writeFileSync(target, source[field]);
    nativeField = source[field];
    assert.deepEqual(checkWithFlags(['trackHistory']).verifiedProjectionPaths, [field]);
    nativeField = Buffer.from(xml('<required>false</required><trackHistory>true</trackHistory>'));
    assert.throws(() => checkWithFlags(['trackHistory']), /Native CustomField serialization differs/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('native CustomObject serialization compares only reviewed default values and preserves the name field', () => {
  const xml = content => `<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">${content}</CustomObject>`;
  const name = '<displayFormat>FX-{000000}</displayFormat><label>FX Number</label><type>AutoNumber</type>';
  const source = xml(`<nameField>${name}</nameField><sharingModel>Private</sharingModel>`);
  const observed = xml(`<compactLayoutAssignment>SYSTEM</compactLayoutAssignment><nameField>${name}<trackHistory>false</trackHistory></nameField><sharingModel>Private</sharingModel>`);
  const defaults = [['compactLayoutAssignment', 'SYSTEM'], ['nameField.trackHistory', 'false']];
  const check = (native, expected = source) => equivalentNativeSerialization(expected, native, 'CustomObject', defaults);
  assert.equal(check(observed), true);
  assert.equal(check(source), true);
  assert.equal(check(observed.replace('SYSTEM', 'CustomLayout')), false);
  assert.equal(check(observed.replace('<trackHistory>false', '<trackHistory>true')), false);
  assert.equal(check(observed.replace('<nameField>', '<nameField><trackHistory>false</trackHistory>')), false);
  assert.equal(check(observed.replace('FX-{000000}', 'OTHER-{000000}')), false);
  assert.equal(check(observed.replace('Private', 'ReadWrite')), false);
  assert.equal(check(observed.replace('FX Number', 'Renamed')), false);
  assert.equal(check(observed, source.replace('<nameField>', '<nameField><trackHistory>false</trackHistory>')), false);
  const actions = ['Accept', 'CancelEdit', 'Clone', 'Delete', 'Edit', 'List', 'New', 'SaveEdit', 'Tab', 'View'];
  const defaultActions = actions.flatMap(action => ['', 'Large', 'Small'].map(factor =>
    `<actionOverrides><actionName>${action}</actionName>${factor ? `<formFactor>${factor}</formFactor>` : ''}<type>Default</type></actionOverrides>`));
  const withActions = (entries, layouts = '<searchLayouts/>') =>
    observed.replace('<nameField>', entries.join('') + layouts + '<nameField>');
  const checkDefaults = native => equivalentNativeSerialization(source, native, 'CustomObject',
    [...defaults, ['actionOverrides', 'standard-actions'], ['searchLayouts', 'empty']]);
  assert.equal(checkDefaults(withActions(defaultActions)), true);
  assert.equal(checkDefaults(withActions(defaultActions.slice(1))), false);
  assert.equal(checkDefaults(withActions([...defaultActions.slice(1), defaultActions[1]])), false);
  assert.equal(checkDefaults(withActions(defaultActions).replace('<type>Default', '<type>LightningComponent')), false);
  assert.equal(checkDefaults(withActions(defaultActions, '<searchLayouts><searchResultsAdditionalFields>Name</searchResultsAdditionalFields></searchLayouts>')), false);
});

test('native PermissionSet projection requires the full grants even when its XML export is scoped', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-native-permission-fixture-'));
  try {
    const environment = policy.environments[0];
    const name = 'Reviewed';
    const file = `permissionsets/${name}.permissionset-meta.xml`;
    const root = content => `<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata"><label>Reviewed</label>${content}</PermissionSet>`;
    const source = root('<fieldPermissions><editable>false</editable><field>Account.Example__c</field><readable>true</readable></fieldPermissions>');
    let native = root('');
    const target = path.join(cwd, policy.publication.sourceRoot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
    const metadata = packageXml(['PermissionSet:Reviewed']);
    const manifest = packageXml(['Profile:Example']);
    writeFileSync(path.join(cwd, 'inventory.xml'), manifest);
    writeFileSync(path.join(cwd, 'metadata.xml'), metadata);
    writeFileSync(path.join(cwd, 'sfdx-project.json'), '{}');
    const parentId = '0PS000000000001AAA';
    const expectedGrant = { ParentId: parentId, SobjectType: 'Account', Field: 'Account.Example__c', PermissionsEdit: false, PermissionsRead: true };
    let fieldRows = [expectedGrant];
    let incomplete = false;
    let catalogReads = 0;
    const provider = cliSalesforceProvider({ cwd, run(_program, args, project) {
      if (args[0] === 'org') return { id: environment.orgId, username: environment.username, connectedStatus: 'Connected' };
      if (args[0] === 'data') {
        const query = args[args.indexOf('--query') + 1];
        if (query.includes(' FROM Organization ')) return { records: [{ Id: environment.orgId, IsSandbox: environment.isSandbox }] };
        assert.equal(args[args.indexOf('--api-version') + 1], '67.0');
        catalogReads++;
        let records = [];
        if (query.includes(' FROM PermissionSet ')) records = [{ Id: parentId, Name: name, IsOwnedByProfile: false, NamespacePrefix: null }];
        if (query.includes(' FROM FieldPermissions ')) records = fieldRows;
        return { records, totalSize: records.length, done: !incomplete };
      }
      const directory = args[args.indexOf('--output-dir') + 1];
      const destination = path.join(project, directory, directory === 'metadata' ? file : 'profiles/Example.profile-meta.xml');
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, directory === 'metadata' ? native : '<Profile/>');
      return { id: '09SHF000002gTFl2AM', status: 'Succeeded', done: true, success: true };
    } });
    const input = () => {
      const { inventoryHash } = inventoryFromFiles({ [file]: Buffer.from(native), 'profiles/Example.profile-meta.xml': Buffer.from('<Profile/>') });
      return { plan: { finalInventory: inventoryFromFiles({ [file]: Buffer.from(source) }), review: {
        components: [{ id: 'PermissionSet:Reviewed', files: [file] }],
        inventoryManifests: { [inventoryHash]: { path: 'inventory.xml', sha256: hash(manifest),
          metadata: { path: 'metadata.xml', sha256: hash(metadata) } } },
      } }, expectedInventoryHash: inventoryHash, nativeExport: true, nativeBootstrap: true, projectionPaths: [file] };
    };
    const verify = () => provider.verifyInventory(environment, input());
    const receipt = verify();
    assert.deepEqual(receipt.permissionSets, [name]);
    assert.match(receipt.permissionGrantEvidenceSha256, /^[a-f0-9]{64}$/u);
    assert.equal(catalogReads, 3);
    fieldRows = [];
    assert.throws(verify, /catalog differs.*Account.Example__c/);
    fieldRows = [expectedGrant, { ...expectedGrant, Field: 'Account.Unreviewed__c' }];
    assert.throws(verify, /catalog differs.*Account.Unreviewed__c/);
    fieldRows = [{ ...expectedGrant, PermissionsEdit: true }];
    assert.throws(verify, /catalog differs.*Account.Example__c/);
    fieldRows = [expectedGrant];
    incomplete = true;
    assert.throws(verify, /catalog response is incomplete/);
    incomplete = false;
    native = root('<userPermissions><enabled>true</enabled><name>ModifyAllData</name></userPermissions>');
    assert.throws(verify, /differs from the reviewed non-grant definition/);
    native = root('<fieldPermissions><editable>true</editable><field>Account.Example__c</field><readable>true</readable></fieldPermissions>');
    assert.throws(verify, /unexpected exported fieldPermissions/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('native Apex readback checks exact raw bytes and equivalence to the reviewed LF source', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-native-apex-fixture-'));
  try {
    const environment = policy.environments[0];
    const manifest = packageXml(['Profile:Example']);
    const apex = packageXml(['ApexClass:Example']);
    const sourceRoot = path.join(cwd, policy.publication.sourceRoot);
    mkdirSync(path.join(sourceRoot, 'classes'), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(sourceRoot, name), bytes);
    writeFileSync(path.join(cwd, 'inventory.xml'), manifest);
    writeFileSync(path.join(cwd, 'apex.xml'), apex);
    writeFileSync(path.join(cwd, 'sfdx-project.json'), '{}');
    let raw = { ...files, 'classes/Example.cls': Buffer.from('class Example {}\r\n'),
      'profiles/Example.profile-meta.xml': Buffer.from('<Profile/>\r\n') };
    const provider = cliSalesforceProvider({ cwd, run(_program, args, project) {
      if (args[0] === 'org') return { id: environment.orgId, username: environment.username, connectedStatus: 'Connected' };
      if (args[0] === 'data') return { records: [{ Id: environment.orgId, IsSandbox: environment.isSandbox }] };
      const directory = args[args.indexOf('--output-dir') + 1];
      for (const [name, bytes] of Object.entries(raw)) {
        if (name.startsWith('classes/') !== (directory === 'apex')) continue;
        const destination = path.join(project, directory, name);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, bytes);
      }
      return { id: '09SHF000002gTFl2AM', status: 'Succeeded', done: true, success: true };
    } });
    const input = () => {
      const inv = inventoryFromFiles(raw);
      return { plan: { finalInventory: inventoryFromFiles(files), review: {
        components: [{ id: 'ApexClass:Example', files: Object.keys(files) }],
        inventoryManifests: { [inv.inventoryHash]: { path: 'inventory.xml', sha256: hash(manifest), apex: { path: 'apex.xml', sha256: hash(apex) } } },
      } }, expectedInventoryHash: inv.inventoryHash, expectedSourceTreeHash: null, nativeExport: true, verifyApexProjection: true };
    };
    const exact = input();
    const receipt = provider.verifyInventory(environment, exact);
    assert.equal(receipt.verificationMethod, 'metadata-api-reviewed-native-byte-inventory');
    assert.equal(receipt.apexProjectionVerified, true);
    assert.equal(receipt.sourceTreeHash, null);
    assert.equal(receipt.nativeSourceTreeHash, inventoryFromFiles(raw).sourceTreeHash);
    assert.throws(() => provider.verifyInventory(environment, { ...exact, nativeExport: false }), /must use LF/);
    raw = { ...raw, 'classes/Example.cls': Buffer.from('class Example { Integer unreviewed; }\r\n') };
    assert.throws(() => provider.verifyInventory(environment, exact), /differs from the exact reviewed inventory/);
    assert.throws(() => provider.verifyInventory(environment, input()), /Native Apex projection differs/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});


test('zero-test quick deploy requires native positive validation for the exact linked package', () => {
  const f = fixture({ level: 'RunSpecifiedTests' });
  try {
    const id = jobId(10), validationId = jobId(9), environment = policy.environments[0];
    const testPlan = f.plan.binding.testPlan, expectedComponents = f.plan.manifest;
    const deployment = f.makeReport(id, false, { zero: true });
    const check = quickValidation => assertReviewedJobReport(deployment, { environment, jobId: id, testPlan, expectedComponents, quickValidation });
    assert.throws(() => check(), /exact successful validation/);
    assert.throws(() => check({ id: validationId, report: f.makeReport(jobId(8), true) }), /all-or-none/);
    assert.throws(() => check({ id: validationId, report: f.makeReport(validationId, true, { zero: true }) }), /positive test execution/);
    assert.throws(() => check({ id: validationId, report: f.makeReport(validationId, true, { date: '2026-11-07T10:00:00Z' }) }), /predates/);
    const nativeValidation = f.makeReport(validationId, true);
    const proof = check({ id: validationId, report: nativeValidation });
    assert.equal(proof.tests, '0/0');
    assert.equal(proof.apexTestProof, true);
    assert.equal(proof.validationJobId, validationId);
    assert.equal(proof.validationReportSha256, hash(nativeValidation));
  } finally { f.cleanup(); }
});

test('mixed native readback allows one terminal newline difference in LWC JavaScript and templates only', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'fcos-native-lwc-fixture-'));
  const environment = policy.environments[0];
  const component = 'LightningComponentBundle:examplePanel';
  const js = 'lwc/examplePanel/examplePanel.js';
  const html = 'lwc/examplePanel/examplePanel.html';
  const css = 'lwc/examplePanel/examplePanel.css';
  const source = {
    [js]: Buffer.from('export default class ExamplePanel {}\n'),
    [html]: Buffer.from('<template><div>Example</div></template>\n'),
    [css]: Buffer.from('div { color: black; }\n'),
  };
  const stable = { 'profiles/Example.profile-meta.xml': Buffer.from('<Profile/>') };
  const native = { ...source, [js]: source[js].subarray(0, -1), [html]: source[html].subarray(0, -1) };
  const manifest = packageXml(['Profile:Example']);
  const supplemental = packageXml([component]);
  const projectionPaths = Object.keys(source).sort();
  const expectedInventory = inventoryFromFiles(stable).files;
  const expectedInventoryHash = projectedNativeInventoryHash(expectedInventory, projectionPaths);
  const write = (root, files) => {
    for (const [name, bytes] of Object.entries(files)) {
      const file = path.join(root, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
  };
  try {
    write(path.join(cwd, policy.publication.sourceRoot), source);
    write(cwd, { 'inventory.xml': manifest, 'metadata.xml': supplemental, 'sfdx-project.json': '{}' });
    const provider = cliSalesforceProvider({ cwd, run(_program, args, project) {
      if (args[0] === 'org') return { id: environment.orgId, username: environment.username, connectedStatus: 'Connected' };
      if (args[0] === 'data') return { records: [{ Id: environment.orgId, IsSandbox: environment.isSandbox }] };
      const directory = args[args.indexOf('--output-dir') + 1];
      write(path.join(project, directory), directory === 'metadata' ? native : stable);
      return { id: '09SHF000002gTFl2AM', status: 'Succeeded', done: true, success: true };
    } });
    const request = { plan: { finalInventory: inventoryFromFiles(source), review: {
      components: [{ id: component, files: projectionPaths }],
      inventoryManifests: { [expectedInventoryHash]: { path: 'inventory.xml', sha256: hash(manifest),
        metadata: { path: 'metadata.xml', sha256: hash(supplemental) } } },
    } }, expectedInventory, expectedInventoryHash, nativeExport: true, nativeBootstrap: true, projectedNativeInventory: true,
    projectionPaths };
    assert.deepEqual(provider.verifyInventory(environment, request).verifiedProjectionPaths, projectionPaths);
    for (const [name, invalid] of [[js, 'export default class OtherPanel {}'], [html, '<template><div>Other</div></template>'],
      [html, source[html].toString() + '\n'], [css, source[css].toString().slice(0, -1)]]) {
      const before = native[name];
      native[name] = Buffer.from(invalid);
      assert.throws(() => provider.verifyInventory(environment, request), /Native metadata projection differs/);
      native[name] = before;
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
