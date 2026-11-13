import assert from 'node:assert/strict';
import test from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { promoteRelease } from '../scripts/lib/rapid-release/engine.mjs';
import { MemoryJournal } from '../scripts/lib/rapid-release/journal.mjs';
import { reviewedMigrationAdapter } from '../scripts/lib/rapid-release/reviewed-migration-adapter.mjs';
import { recoverTradingFxDeveePromotion } from '../scripts/lib/rapid-release/salesforce-reviewed-adapter.mjs';
import { readTradingFxRecovery } from '../scripts/lib/rapid-release/trading-fx-adapter.mjs';

const policy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const owner = { id: policy.publication.requiredAccountId, login: targets().account };
const bot = { id: 41898282, login: 'github-actions[bot]' };
const stageTime = '2026-11-08T12:00:00.000Z';
const historicalTime = '2026-11-08T12:05:00.000Z';
const schemaBefore = 'a'.repeat(64);
const schemaAfter = 'b'.repeat(64);
const hash = 'c'.repeat(64);
const permission = 'Fcos_Trading_FX_Data';
const jobIds = ['0AfHF000007Gb9F0AS', '0AfHF000007GbCT0A0', '0AfHF000007GbKX0A0'];
const operations = ['bootstrap', 'validation', 'deployment'];
const migrationPath = 'supabase/migrations/20990101000000_fixture.sql';
const migrationBytes = Buffer.from('select 1;\n');
const migrations = [{ path: migrationPath, digest: digest(migrationBytes) }];
const workflowPaths = ['api/_xeroNativeDocumentActions.js'];
const basePlan = { migrations, salesforceFingerprint: hash, mirrorPublication: 'local-collaborator',
  xeroQualificationDeploymentId: 25, xeroQualificationDigest: hash };
const originalOperationId = 'trading-fx-original-prerequisites';

function createRelease({ successor = false, plan, configurationDigest = hash, sourceDigest = hash } = {}) {
  const prerequisites = { adapter: 'trading-fx-prerequisites', adapterDigest: successor ? schemaAfter : hash,
    plan: plan ?? (successor ? { ...basePlan, tradingFxRecoveryReceiptId: 11 } : basePlan) };
  return createManifest({
    candidate: { sha: 'c'.repeat(40), sourceDigest, lockDigest: hash },
    controllerSha: (successor ? 'b' : 'a').repeat(40),
    previous: { sha: 'd'.repeat(40), deploymentId: 'dpl_previous', configurationDigest, schemaDigest: successor ? schemaAfter : schemaBefore },
    paths: [...workflowPaths, 'force-app/main/default/classes/Example.cls', migrationPath],
    publicEnvironment: { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`,
      VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(25)}` },
    releaseId: successor ? 'trading-fx-recovery' : 'trading-fx-original', prerequisites, now: stageTime,
  });
}

function staged(manifest) {
  return { id: 'dpl_staged', sha: manifest.candidate.sha, buildId: manifest.build.buildId, manifestHash: digest(manifest),
    artifactDigest: hash, state: 'READY', target: 'production' };
}

function approve(manifest, approvedAt = stageTime) {
  return { manifestHash: digest(manifest), nativeReviewVerified: true, candidateSha: manifest.candidate.sha,
    buildId: manifest.build.buildId, deploymentId: staged(manifest).id, previousDeploymentId: manifest.previous.deploymentId,
    environment: 'fcos-production-release', reviewer: owner.login, runId: 34, approvedAt };
}

function history({ addMirror = false, closureCreator = owner, closurePatch = {}, markerPatch = {}, lateRun = false,
  downstream = false, alteredPermission = false } = {}) {
  const prior = createRelease();
  const operationId = originalOperationId;
  const request = { planDigest: digest(prior.prerequisites), candidateSha: prior.candidate.sha };
  const operationDigest = digest({ manifestHash: digest(prior), operationId, request });
  const records = [];
  const append = (id, event, data, creator = bot) => {
    const previousHash = records.at(-1)?.payload.recordHash ?? null;
    const content = { kind: 'fcos_rapid_release_event', schemaVersion: 1, manifestHash: digest(prior),
      releaseId: prior.releaseId, sequence: records.length, previousHash, event, data };
    const record = { id, creator, sha: prior.candidate.sha, environment: 'fcos-release-journal-v1', created_at: historicalTime,
      payload: { ...content, recordHash: digest(content) } };
    records.push(record);
    return record;
  };
  append(1, 'release.prepared', { manifest: prior });
  append(2, 'stage.intent', { operationId: `${prior.releaseId}-stage` });
  append(3, 'stage.result', { operationId: `${prior.releaseId}-stage`, outcome: 'applied', result: staged(prior) });
  append(4, 'approval.accepted', approve(prior, lateRun ? '2026-11-07T01:00:00.000Z' : stageTime));
  append(5, 'prerequisites.intent', { operationId, requestHash: digest(request), request });
  append(6, 'prerequisites.database_submitting', { operationId, operationDigest, ...markerPatch });
  operations.forEach((operation, index) => append(7 + index, 'salesforce.checkpoint', {
    stage: 'devee', operation, outcome: 'resolved', fingerprint: hash, evidenceDigest: hash,
    job: { id: jobIds[index], validationId: index === 2 ? jobIds[1] : null,
      submittedAt: `2026-11-08T12:0${index}:00.000Z`, ...(index < 2 ? { packageSha256: hash } : {}) },
  }));
  append(10, 'salesforce.checkpoint', { stage: 'devee', operation: 'permission:' + permission, outcome: 'resolved',
    fingerprint: alteredPermission ? schemaAfter : hash, evidenceDigest: hash,
    permission: { name: permission, orgId: policy.environments[0].orgId, prestate: false } });
  if (downstream) append(12, 'salesforce.checkpoint', { stage: 'qat', operation: 'bootstrap', outcome: 'resolved' });
  const closure = append(11, 'prerequisites.result', { operationId, outcome: 'trading_fx_database_and_devee_complete_mirror_not_started',
    originalRunId: 34, salesforceFingerprint: hash, databaseSubmissionId: 6, databaseSchemaDigest: schemaAfter,
    deveeCheckpoints: [7, 8, 9], deveePermissionCheckpoints: [10], evidenceDigest: hash, ...closurePatch }, closureCreator);
  const github = () => ({
    async read(endpoint) { return records.find(record => endpoint.endsWith('/' + record.id)); },
    async pages(endpoint) {
      if (endpoint.includes('fcos-release-mirror-handoff-v1')) return addMirror ? [{ payload: { manifestHash: digest(prior) } }] : [];
      assert.ok(endpoint.includes('fcos-release-journal-v1'));
      return records;
    },
  });
  return { operationDigest, closure, github };
}

const readRecovery = (fixture, manifest = createRelease({ successor: true })) => readTradingFxRecovery({
  manifest, plan: manifest.prerequisites.plan, env: { GITHUB_TOKEN: 'fixture-only' },
}, { github: fixture.github });

test('Trading FX successor reads the exact historical database submission and original DEVEE checkpoints', async () => {
  const fixture = history();
  const recovery = await readRecovery(fixture);
  assert.deepEqual(recovery.database, { operationId: originalOperationId, operationDigest: fixture.operationDigest,
    baselineSchemaDigest: schemaBefore, schemaDigest: schemaAfter });
  assert.deepEqual(recovery.jobs.map(record => record.payload.data.job.id), jobIds);
  assert.equal(recovery.permissions[0].payload.data.permission.prestate, false);
  assert.equal(recovery.receipt.id, fixture.closure.id);
});

test('Trading FX recovery refuses different authority, candidate, baseline, scope, receipt, provider history, or operation', async () => {
  for (const [options, code] of [
    [{ closureCreator: bot }, 'TRADING_FX_RECOVERY_CLOSURE_REQUIRED'],
    [{ closurePatch: { databaseSchemaDigest: schemaBefore } }, 'TRADING_FX_RECOVERY_CLOSURE_REQUIRED'],
    [{ closurePatch: { originalRunId: 35 } }, 'TRADING_FX_RECOVERY_ORIGINAL_APPROVAL_REQUIRED'],
    [{ addMirror: true }, 'TRADING_FX_RECOVERY_ORIGINAL_OPERATION_REQUIRED'],
    [{ downstream: true }, 'TRADING_FX_RECOVERY_ORIGINAL_OPERATION_REQUIRED'],
    [{ markerPatch: { operationDigest: schemaAfter } }, 'TRADING_FX_RECOVERY_ORIGINAL_OPERATION_REQUIRED'],
    [{ lateRun: true }, 'EXACT_PRODUCTION_AUTHORIZATION_REQUIRED'],
    [{ alteredPermission: true }, 'TRADING_FX_RECOVERY_DEVEE_CHECKPOINTS_REQUIRED'],
    [{ closurePatch: { deveeCheckpoints: [7, 9, 8] } }, 'TRADING_FX_RECOVERY_DEVEE_CHECKPOINTS_REQUIRED'],
    [{ closurePatch: { deveePermissionCheckpoints: [] } }, 'TRADING_FX_RECOVERY_DEVEE_CHECKPOINTS_REQUIRED'],
  ]) await assert.rejects(readRecovery(history(options)), { code });
  for (const change of [{ sourceDigest: schemaAfter }, { configurationDigest: schemaAfter },
    { plan: { ...basePlan, tradingFxRecoveryReceiptId: 11, xeroQualificationDigest: schemaAfter } }]) {
    await assert.rejects(readRecovery(history(), createRelease({ successor: true, ...change })), { code: 'TRADING_FX_RECOVERY_MANIFEST_CHANGED' });
  }
});

test('Trading FX migration recovery only reads the original operation and never falls back to applying', async () => {
  const manifest = createRelease({ successor: true });
  const plan = manifest.prerequisites.plan;
  const approval = approve(manifest);
  const manifestHash = digest(manifest);
  const { database } = await readRecovery(history(), manifest);
  const journal = new MemoryJournal();
  await journal.append('approval.accepted', approval);
  const operationId = `${manifest.releaseId}-prerequisites`;
  const request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
  await journal.append('prerequisites.intent', { operationId, requestHash: digest(request), request });
  const input = { manifest, plan, journal, approval, env: {}, authorization: { manifestHash, nativeReview: approval },
    originalDatabaseOperation: database, databaseWriter: { async assertAuthorized() {} } };
  const calls = [];
  let outcome = { state: 'recovered', schemaDigest: schemaAfter, evidenceDigest: hash };
  const apply = reviewedMigrationAdapter({ migrations, workflowPaths, withSalesforce: true, errorPrefix: 'TRADING_FX' });
  const deps = {
    github: () => ({ async read() { return { path: migrationPath, encoding: 'base64', content: migrationBytes.toString('base64') }; } }),
    connect: async () => ({ db: { async end() { calls.push('close'); } } }),
    async transact(transaction) {
      assert.equal(transaction.operationDigest, database.operationDigest);
      assert.equal(transaction.baselineSchemaDigest, schemaBefore);
      assert.equal(transaction.assertWriteAuthorized, undefined);
      calls.push(transaction.mode);
      return outcome;
    },
  };
  const result = await apply(input, deps);
  assert.equal(result.completedOperations[0].operationId, originalOperationId);
  for (const observed of [{ state: 'absent' }, { state: 'recovered', schemaDigest: schemaBefore }]) {
    outcome = observed;
    await assert.rejects(apply(input, deps), { code: 'TRADING_FX_ORIGINAL_SUBMISSION_REVIEW_REQUIRED' });
  }
  assert.deepEqual(calls, ['readback', 'close', 'readback', 'close', 'readback', 'close']);
  assert.equal((await journal.read()).length, 2);
  await journal.append('prerequisites.database_submitting', { operationId, operationDigest: digest({ manifestHash, operationId, request }) });
  await assert.rejects(apply(input, deps), { code: 'TRADING_FX_ORIGINAL_SUBMISSION_BINDING_CHANGED' });
});

test('Trading FX DEVEE recovery verifies original jobs, inventory, and permission prestate without submission', async () => {
  const recovery = await readRecovery(history());
  const component = 'CustomField:Demo__c.Value__c';
  const reviewed = { fingerprint: hash, manifest: [component],
    review: { bootstrap: { components: [component], permissionSets: [permission] } },
    binding: { permissionSets: [permission], sourceTreeHash: hash, manifestSha256: hash,
      testPlan: { level: 'RunLocalTests', minimumTests: 1 } },
    nativeInventories: { devee: { final: { files: {}, inventoryHash: hash } } },
  };
  const prepare = () => ({ packageSha256: hash, cleanup() {} });
  const now = () => new Date(historicalTime);
  let assigned = true;
  const provider = { prepareBootstrap: prepare, prepareValidation: prepare, async verifyIdentity() {},
    async report(_org, id) {
      const index = jobIds.indexOf(id);
      return { id, status: 'Succeeded', success: true, done: true, checkOnly: index === 1, rollbackOnError: true,
        numberComponentsTotal: 1, numberComponentsDeployed: 1, numberTestsTotal: index === 1 ? 1 : 0,
        numberTestsCompleted: index === 1 ? 1 : 0, completedDate: `2026-11-08T12:0${index}:30.000Z`,
        details: { componentSuccesses: [{ componentType: 'CustomField', fullName: 'Demo__c.Value__c', success: true }] } };
    },
    async verifyInventory(org) {
      return { orgId: org.orgId, inventoryHash: hash, sourceTreeHash: null,
        verifiedAt: now().toISOString(), evidenceSha256: hash };
    },
    async permissionAssigned(org, name) {
      assert.equal(org.orgId, policy.environments[0].orgId);
      assert.equal(name, permission);
      return assigned;
    },
  };
  const input = { recovery, reviewed, provider, now };
  const records = await recoverTradingFxDeveePromotion(input);
  assert.deepEqual(records.slice(0, 3).map(row => row.record.jobId), jobIds);
  assert.equal(records.at(-1).record.prestate, false);
  assert.equal(records.at(-1).record.addedByRelease, true);
  assigned = false;
  await assert.rejects(recoverTradingFxDeveePromotion(input), { code: 'SALESFORCE_DEVEE_RECOVERY_PERMISSION_DRIFT' });
});

test('the release engine refuses an exact old authorization after its terminal prerequisite closure', async () => {
  const manifest = createRelease();
  const journal = new MemoryJournal();
  const deployment = staged(manifest);
  const approval = approve(manifest, new Date().toISOString());
  await journal.append('stage.result', { outcome: 'applied', result: deployment });
  await journal.append('smoke.passed', { passed: true, deploymentId: deployment.id, buildId: deployment.buildId,
    login: true, restrictedAccess: true, businessWrites: 0, normalRole: true, modules: manifest.selection.modules,
    tradingFx: { restrictedVerified: true, normalVerified: true, desktopVerified: true } });
  await journal.append('build.passed', { ...deployment, schemaVersion: 1, candidateSha: manifest.candidate.sha,
    sourceDigest: manifest.candidate.sourceDigest, lockDigest: manifest.candidate.lockDigest,
    controllerSha: manifest.controllerSha, qualityPassed: true, performancePassed: true, node: manifest.build.node });
  await journal.append('approval.accepted', approval);
  await journal.append('prerequisites.result', { operationId: originalOperationId, outcome: 'trading_fx_database_and_devee_complete_mirror_not_started' });
  const provider = { async ready() { return deployment; }, async verifyApproval() {}, async assertOwnership() {} };
  await assert.rejects(promoteRelease({ manifest, journal, provider, approval,
    prerequisites: () => assert.fail('A closed release must never run its adapter') }), { code: 'PREREQUISITE_RELEASE_CLOSED' });
});
