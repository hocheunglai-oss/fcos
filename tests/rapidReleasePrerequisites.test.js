import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { createManifest, digest, sourceSnapshot, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { applyReviewedPrerequisites as applySalesforce, reconcileHostedSalesforceJob, recoverReviewedDeveeBootstrap } from '../scripts/lib/rapid-release/salesforce-reviewed-adapter.mjs';
import { verifyBeforeBootstrap, runPrerequisites } from '../scripts/lib/rapid-release/prerequisites.mjs';
function fixture({ salesforce = false } = {}) {
 const directory=mkdtempSync(join(tmpdir(),'rapid-prerequisite-')),source='// Tracked, reviewed adapter fixture.\n',h='b'.repeat(64);
 const git=(args,cwd=directory)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);
 mkdirSync(join(directory,'scripts'));mkdirSync(join(directory,'config'));
 writeFileSync(join(directory,'scripts/adapter.mjs'),source);
 writeFileSync(join(directory,'config/rapid-release-adapters.json'),JSON.stringify({schemaVersion:1,adapters:[{id:'schema-fixture',status:'qualified',sourceDigest:digest(Buffer.from(source)),salesforce,database:!salesforce,supportsDeferredStage:true,path:'scripts/adapter.mjs'}]}));
 git(['add','.']);git(['commit','-m','fixture']);
 let candidate={sha:'a'.repeat(40),sourceDigest:h,lockDigest:h};
 const candidateDirectory=join(directory,'candidate');
 if (salesforce) {
  mkdirSync(candidateDirectory);
  git(['init'],candidateDirectory);
  git(['remote','add','origin',`https://github.com/${targets().repository}.git`],candidateDirectory);
  writeFileSync(join(candidateDirectory,'package-lock.json'),'{}');
  git(['add','.'],candidateDirectory);
  git(['-c','user.email=fixture@example.invalid','-c','user.name=Fixture','commit','-m','candidate'],candidateDirectory);
  candidate=sourceSnapshot(candidateDirectory);
 }
 const manifest=createManifest({candidate,controllerSha:git(['rev-parse','HEAD']),previous:{deploymentId:'dpl_old',sha:'d'.repeat(40),configurationDigest:h,schemaDigest:h},paths:salesforce?['force-app/main/default/classes/Example.cls']:['supabase/migrations/20990101000000_fixture.sql'],
 publicEnvironment:{VITE_SUPABASE_URL:`https://${targets().supabaseProject}.supabase.co`,VITE_SUPABASE_PUBLISHABLE_KEY:`sb_publishable_${'p'.repeat(25)}`},releaseId:'rapid-schema-fixture',
 prerequisites:{adapter:'schema-fixture',adapterDigest:digest(Buffer.from(source)),plan:salesforce?{salesforceFingerprint:h,salesforceSourceTreeHash:h}:{deferSchemaDependentSmoke:true,bootstrapFingerprint:h,deferredModules:['hedge_desk']}}});
 const staged={id:'dpl_new',buildId:manifest.build.buildId};
 const proof={passed:true,mode:'pre_bootstrap',deploymentId:staged.id,buildId:staged.buildId,manifestHash:digest(manifest),isolationVerified:true,businessWrites:0,normalRole:true,
  completedChecks:['runtime_identity','authenticated_login','authentication_denials','request_isolation'],deferredChecks:['hedge_desk'],
  completedModules:manifest.selection.modules.filter(module=>module!=='hedge_desk'),bootstrapFingerprint:h};
 const approval={manifestHash:digest(manifest),candidateSha:manifest.candidate.sha,buildId:staged.buildId,deploymentId:staged.id,previousDeploymentId:'dpl_old',environment:'fcos-production-release',reviewer:targets().account,nativeReviewVerified:true,runId:1,approvedAt:new Date().toISOString()};
 return{directory,candidateDirectory,manifest,staged,proof,approval,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
test('deferred schema evidence must bind the actual verified bootstrap, never substitute the planned fingerprint',async()=>{
 const f=fixture();try{
  await assert.rejects(verifyBeforeBootstrap({manifest:f.manifest,staged:f.staged,controllerDirectory:f.directory,load:async()=>({verifyPreBootstrapStage:async()=>({...f.proof,bootstrapFingerprint:'f'.repeat(64)})})}),/PREBOOTSTRAP_STAGE_PROOF_REQUIRED/);
  const proof=await verifyBeforeBootstrap({manifest:f.manifest,staged:f.staged,controllerDirectory:f.directory,load:async()=>({verifyPreBootstrapStage:async()=>f.proof})});
  assert.equal(proof.mode,'pre_bootstrap');assert.deepEqual(proof.deferredChecks,['hedge_desk']);
  assert.deepEqual(proof.completedModules,f.proof.completedModules);
  for (const invalid of [
    { deferredChecks: ['hedge_desk', 'dashboard'] },
    { deferredChecks: ['hedge_desk', 'hedge_desk'] },
    { completedModules: f.proof.completedModules.slice(1) },
    { normalRole: false },
    { completedChecks: ['runtime_identity', 'authentication_denials'] },
  ]) {
    await assert.rejects(verifyBeforeBootstrap({manifest:f.manifest,staged:f.staged,controllerDirectory:f.directory,
      load:async()=>({verifyPreBootstrapStage:async()=>({...f.proof,...invalid})})}),/PREBOOTSTRAP_STAGE_PROOF_REQUIRED/);
  }
 }finally{f.cleanup();}
});
test('qualified prerequisite results publish typed recovery receipts and keep private evidence private',async()=>{
 const f=fixture();try{
  const result=await runPrerequisites({manifest:f.manifest,staged:f.staged,approval:f.approval,controllerDirectory:f.directory,
   load:async()=>({applyReviewedPrerequisites:async()=>({passed:true,manifestHash:digest(f.manifest),backwardCompatible:true,
    completedOperations:[{operationId:'schema-bootstrap-1',verified:true,intentRecorded:true,evidenceDigest:'e'.repeat(64),customerPayments:'PRIVATE_EVIDENCE'}],
    database:{destructiveRollback:false,readbackVerified:true,customerPayments:'PRIVATE_EVIDENCE'},financialRecords:'PRIVATE_EVIDENCE'})})});
  assert.equal(result.completedOperations.length,1);assert.equal(JSON.stringify(result).includes('PRIVATE_EVIDENCE'),false);
 }finally{f.cleanup();}
});


test('Salesforce prerequisite binds per-operation ownership to the protected run and exact plan', async () => {
  const f = fixture({ salesforce: true });
  const calls = [];
  const provider = {
    async verifyApproval() { calls.push('review'); },
    async assertOwnership({ phase }) { assert.equal(phase, 'prerequisites'); calls.push('ownership'); },
  };
  const journal = {
    async assertNoUnresolvedOtherRelease() { calls.push('prior-operations'); },
    async checkpoint(event) { calls.push(event); },
    async readSalesforceCheckpoints(fingerprint) { return [{ fingerprint, stage: 'devee', operation: 'validation' }]; },
  };
  try {
    const { salesforceFingerprint, salesforceSourceTreeHash } = f.manifest.prerequisites.plan;
    const org = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce').environments[0];
    const binding = { fingerprint: salesforceFingerprint, stage: org.key, orgId: org.orgId, operation: 'shared-publication' };
    const load = async () => ({ async applyReviewedPrerequisites({ salesforce, salesforceCandidateDirectory }) {
      assert.ok(salesforceCandidateDirectory.endsWith('/candidate'));
      await assert.rejects(salesforce.ownership.assert({ ...binding, orgId: 'wrong-org' }), /OPERATION_MISMATCH/);
      assert.equal(calls.length, 0);
      const first = await salesforce.ownership.assert(binding);
      const second = await salesforce.ownership.assert(binding);
      assert.deepEqual(calls, ['review', 'prior-operations', 'ownership', 'review', 'prior-operations', 'ownership']);
      assert.equal(first.receiptId, second.receiptId);
      assert.ok(Date.parse(first.expiresAt) > Date.now());
      const event = { fingerprint: salesforceFingerprint, stage: 'shared_mirror', operation: 'publication', record: { status: 'submitting' } };
      assert.throws(() => salesforce.journal.checkpoint({ ...event, fingerprint: 'c'.repeat(64) }), /OPERATION_MISMATCH/);
      assert.deepEqual(await salesforce.journal.readCheckpoints(), [{ fingerprint: salesforceFingerprint, stage: 'devee', operation: 'validation' }]);
      await salesforce.journal.checkpoint(event);
      assert.deepEqual(calls.at(-1), event);
      return { passed: true, manifestHash: digest(f.manifest), backwardCompatible: true, completedOperations: [],
        salesforce: { order: 'devee-mirror-qat-production', mirrorVerified: true, sourceTreeHash: salesforceSourceTreeHash, fingerprint: salesforceFingerprint } };
    } });
    const input = { manifest: f.manifest, staged: f.staged, approval: f.approval,
      controllerDirectory: f.directory, journal, provider, load };
    const env = { FCOS_RAPID_SALESFORCE_CANDIDATE: f.candidateDirectory };
    await assert.rejects(runPrerequisites({ ...input, env: {} }), /SALESFORCE_CANDIDATE_SOURCE_REQUIRED/);
    const lockfile = join(f.candidateDirectory, 'package-lock.json');
    writeFileSync(lockfile, '{"changed":true}');
    await assert.rejects(runPrerequisites({ ...input, env }), /SOURCE_BYTES_CHANGED/);
    assert.equal(calls.length, 0);
    writeFileSync(lockfile, '{}');
    const result = await runPrerequisites({ ...input, env });
    assert.equal(result.salesforce.mirrorVerified, true);
  } finally { f.cleanup(); }
});

test('hosted Salesforce adapter refuses unreviewed input and metadata outside the owned package', async () => {
  const f = fixture({ salesforce: true });
  try {
    const input = { manifest: f.manifest, approval: f.approval, plan: { backwardCompatible: true },
      salesforceCandidateDirectory: f.candidateDirectory,
      salesforce: { journal: { async readCheckpoints() { throw new Error('unexpected journal read'); } },
        ownership: { async assert() { throw new Error('unexpected ownership assertion'); } } } };
    await assert.rejects(applySalesforce({ ...input, approval: {} }), /SALESFORCE_HOSTED_REVIEW_REQUIRED/);
    writeFileSync(join(f.candidateDirectory, 'sfdx-project.json'), JSON.stringify({
      namespace: '', packageDirectories: [{ path: '../other', default: true }],
    }));
    await assert.rejects(applySalesforce(input), /SALESFORCE_HOSTED_PROJECT_SCOPE_INVALID/);
  } finally {
    f.cleanup();
  }
});

test('hosted Salesforce recovery requires the acknowledged original job and its exact provider report', async () => {
  const environment = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce').environments[0];
  const jobId = '0AfHF00000700KB0AY', submittedAt = '2026-11-08T12:00:00.000Z';
  const fingerprint = 'b'.repeat(64);
  const reviewed = { fingerprint, manifest: ['ApexClass:Example'],
    binding: { sourceTreeHash: 'c'.repeat(64), manifestSha256: 'd'.repeat(64),
      testPlan: { level: 'RunLocalTests', minimumTests: 1 } } };
  const checkpoint = { fingerprint, stage: environment.key, operation: 'validation', outcome: 'pending',
    job: { id: jobId, validationId: null, submittedAt }, evidenceDigest: 'e'.repeat(64) };
  const report = { id: jobId, status: 'Succeeded', success: true, done: true, checkOnly: true, rollbackOnError: true,
    numberComponentsTotal: 1, numberComponentsDeployed: 1, numberTestsTotal: 1, numberTestsCompleted: 1,
    completedDate: '2026-11-08T12:01:00.000Z',
    details: { componentSuccesses: [{ componentType: 'ApexClass', fullName: 'Example', success: true }] } };
  let reads = 0;
  const provider = { async verifyIdentity(org) { assert.equal(org.orgId, environment.orgId); },
    async report() { reads++; return report; } };
  const input = { environment, jobId, reviewed, operation: 'validation', submittedAt, validationJobId: null, provider,
    journal: { async readCheckpoints() { return [checkpoint]; } }, now: () => new Date('2026-11-08T12:02:00.000Z') };
  await assert.rejects(reconcileHostedSalesforceJob({ ...input, jobId: '0AfHF00000702c50AA' }), /ORIGINAL_JOB_REQUIRED/);
  assert.equal(reads, 0);
  assert.equal((await reconcileHostedSalesforceJob(input)).jobId, jobId);
  checkpoint.job.packageSha256 = 'a'.repeat(64);
  await assert.rejects(reconcileHostedSalesforceJob(input), /ORIGINAL_JOB_REQUIRED/);
  input.packageSha256 = checkpoint.job.packageSha256;
  assert.equal((await reconcileHostedSalesforceJob(input)).jobId, jobId);
  report.checkOnly = false;
  await assert.rejects(reconcileHostedSalesforceJob(input), /all-or-none proof/);
});

test('hosted bootstrap recovery proves the exact original schema job without submitting again', async () => {
  const { environments } = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');
  const jobId = '0AfHF00000700KB0AY', submittedAt = '2026-11-08T12:00:00.000Z';
  const fingerprint = 'b'.repeat(64);
  const component = 'CustomField:Demo__c.Value__c';
  const reviewed = { fingerprint, manifest: ['ApexClass:Example', component], review: { bootstrap: { components: [component] } },
    binding: { sourceTreeHash: 'c'.repeat(64), manifestSha256: 'd'.repeat(64), bootstrapSha256: 'f'.repeat(64),
      testPlan: { level: 'RunLocalTests', minimumTests: 1 } } };
  for (const environment of [environments[0], environments.at(-1)]) {
    const checkpoint = { fingerprint, stage: environment.key, operation: 'bootstrap', outcome: 'pending',
      job: { id: jobId, validationId: null, submittedAt }, evidenceDigest: 'e'.repeat(64) };
    const count = environment.isSandbox ? 0 : 1;
    const report = { id: jobId, status: 'Succeeded', success: true, done: true, checkOnly: false, rollbackOnError: true,
      numberComponentsTotal: 1, numberComponentsDeployed: 1, numberTestsTotal: count, numberTestsCompleted: count,
      completedDate: '2026-11-08T12:01:00.000Z',
      details: { componentSuccesses: [{ componentType: 'CustomField', fullName: 'Demo__c.Value__c', success: true }] } };
    let reads = 0;
    const provider = { async verifyIdentity(org) { assert.equal(org.orgId, environment.orgId); },
      async report(org, id) { assert.equal(org.orgId, environment.orgId); assert.equal(id, jobId); reads++; return report; } };
    const input = { environment, jobId, reviewed, operation: 'bootstrap', submittedAt, validationJobId: null, provider,
      journal: { async readCheckpoints() { return [checkpoint]; } }, now: () => new Date('2026-11-08T12:02:00.000Z') };
    await assert.rejects(reconcileHostedSalesforceJob({ ...input, reviewed: { ...reviewed, review: {} } }), /RECOVERY_SCOPE_INVALID/);
    await assert.rejects(reconcileHostedSalesforceJob({ ...input, jobId: '0AfHF00000702c50AA' }), /ORIGINAL_JOB_REQUIRED/);
    assert.equal(reads, 0);
    assert.equal((await reconcileHostedSalesforceJob(input)).operation, 'bootstrap');
    assert.equal(reads, 1);
    report.details.componentSuccesses.push({ componentType: 'ApexClass', fullName: 'Example', success: true });
    await assert.rejects(reconcileHostedSalesforceJob(input), /unexpected non-schema component/);
  }
});

test('a successor adopts the exact successful DEVEE bootstrap only with its native receipt and current inventory', async () => {
  const policy = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');
  const environment = policy.environments[0];
  const jobId = '0AfHF00000700KB0AY', submittedAt = '2026-11-08T12:00:00.000Z';
  const candidate = 'a'.repeat(40), fingerprint = 'b'.repeat(64), packageSha256 = 'c'.repeat(64);
  const inventoryHash = 'd'.repeat(64), component = 'CustomField:Demo__c.Value__c';
  const now = () => new Date('2026-11-08T12:02:00.000Z');
  const reviewed = { fingerprint, review: { bootstrap: { components: [component] } },
    binding: { sourceTreeHash: 'e'.repeat(64), manifestSha256: 'f'.repeat(64) },
    nativeInventories: { devee: { bootstrap: { files: {}, inventoryHash } } } };
  const job = { id: jobId, validationId: null, submittedAt, packageSha256 };
  const context = { sha: candidate, environment: 'fcos-release-journal-v1' };
  const payload = { kind: 'fcos_rapid_release_event', event: 'salesforce.checkpoint', releaseId: 'original',
    manifestHash: '1'.repeat(64) };
  const data = { fingerprint, stage: 'devee', operation: 'bootstrap', job, evidenceDigest: '2'.repeat(64) };
  const original = { ...context, id: 8, creator: { id: 41898282, login: 'github-actions[bot]' },
    payload: { ...payload, data: { ...data, outcome: 'pending' } } };
  const receipt = { ...context, id: 9, creator: { id: policy.publication.requiredAccountId, login: policy.publication.requiredAccount },
    payload: { ...payload, data: { ...data, outcome: 'resolved', result: 'succeeded_no_change', originalCheckpoint: original.id } } };
  const field = { componentType: 'CustomField', fullName: 'Demo__c.Value__c', changed: false, success: true };
  const report = { id: jobId, status: 'Succeeded', success: true, done: true, checkOnly: false, rollbackOnError: true,
    numberComponentsTotal: 1, numberComponentsDeployed: 1, numberTestsTotal: 0, numberTestsCompleted: 0,
    completedDate: '2026-11-08T12:01:00.000Z',
    details: { componentSuccesses: [field, { componentType: '', fullName: 'package.xml', fileName: 'zip/package.xml', success: true }] } };
  let reads = 0, observedHash = inventoryHash, convertedHash = packageSha256;
  const provider = {
    prepareBootstrap(org) {
      assert.equal(org.orgId, environment.orgId);
      return { packageSha256: convertedHash, submit() { assert.fail('bootstrap was resubmitted'); }, cleanup() {} };
    },
    async verifyIdentity(org) { assert.equal(org.orgId, environment.orgId); },
    async report(org, id) { assert.equal(org.orgId, environment.orgId); assert.equal(id, jobId); reads++; return report; },
    async verifyInventory(org, { expectedInventoryHash }) {
      assert.equal(org.orgId, environment.orgId);
      assert.equal(expectedInventoryHash, inventoryHash);
      return { orgId: org.orgId, inventoryHash: observedHash, sourceTreeHash: null, verifiedAt: now().toISOString(), evidenceSha256: '3'.repeat(64) };
    },
  };
  const input = { adoption: { receiptId: receipt.id, jobId }, manifest: { candidate: { sha: candidate } },
    reviewed, provider, github: { async read(path) { return path.endsWith('/9') ? receipt : original; } }, now };
  const accepted = await recoverReviewedDeveeBootstrap(input);
  assert.equal(accepted.jobId, jobId);
  assert.equal(accepted.packageSha256, packageSha256);
  assert.equal(reads, 1);
  receipt.creator.id = 41898282;
  await assert.rejects(recoverReviewedDeveeBootstrap(input), /BOOTSTRAP_RECEIPT_REQUIRED/);
  receipt.creator.id = policy.publication.requiredAccountId;
  original.payload.data.job = { ...job, packageSha256: '9'.repeat(64) };
  await assert.rejects(recoverReviewedDeveeBootstrap(input), /BOOTSTRAP_ORIGINAL_REQUIRED/);
  original.payload.data.job = job;
  convertedHash = '9'.repeat(64);
  await assert.rejects(recoverReviewedDeveeBootstrap(input), /BOOTSTRAP_PACKAGE_CHANGED/);
  convertedHash = packageSha256;
  field.changed = true;
  await assert.rejects(recoverReviewedDeveeBootstrap(input), /BOOTSTRAP_NO_CHANGE_REQUIRED/);
  field.changed = false;
  observedHash = '9'.repeat(64);
  await assert.rejects(recoverReviewedDeveeBootstrap(input), /inventory receipt is absent, stale, or differs/);
});

test('hosted quick-deploy recovery verifies its original positive validation checkpoint', async () => {
  const environment = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce').environments[0];
  const validationJobId = '0AfHF00000700KB0AY', jobId = '0AfHF00000702c50AA';
  const submittedAt = '2026-11-08T12:01:00.000Z', fingerprint = 'b'.repeat(64);
  const reviewed = { fingerprint, manifest: ['ApexClass:Example'], binding: {
    sourceTreeHash: 'c'.repeat(64), manifestSha256: 'd'.repeat(64), testPlan: { level: 'RunLocalTests', minimumTests: 1 },
  } };
  const deployment = { id: jobId, status: 'Succeeded', success: true, done: true, checkOnly: false, rollbackOnError: true,
    numberComponentsTotal: 1, numberComponentsDeployed: 1, numberTestsTotal: 0, numberTestsCompleted: 0,
    completedDate: '2026-11-08T12:02:00.000Z',
    details: { componentSuccesses: [{ componentType: 'ApexClass', fullName: 'Example', success: true }] } };
  const validation = { ...deployment, id: validationJobId, checkOnly: true, numberTestsTotal: 1, numberTestsCompleted: 1,
    completedDate: '2026-11-08T12:00:00.000Z' };
  const common = { fingerprint, stage: environment.key, evidenceDigest: 'e'.repeat(64), outcome: 'resolved' };
  const checkpoints = [{ ...common, operation: 'deployment', job: { id: jobId, validationId: validationJobId, submittedAt } }];
  const provider = { async verifyIdentity() {}, async report(_env, id) { return id === jobId ? deployment : validation; } };
  const input = { environment, jobId, reviewed, operation: 'deployment', submittedAt, validationJobId, provider,
    journal: { async readCheckpoints() { return checkpoints; } }, now: () => new Date('2026-11-08T12:03:00.000Z') };
  await assert.rejects(reconcileHostedSalesforceJob(input), /ORIGINAL_VALIDATION_REQUIRED/);
  checkpoints.push({ ...common, operation: 'validation', job: { id: validationJobId, validationId: null } });
  assert.equal((await reconcileHostedSalesforceJob(input)).jobId, jobId);
  validation.numberTestsTotal = validation.numberTestsCompleted = 0;
  await assert.rejects(reconcileHostedSalesforceJob(input), /positive test execution/);
});
