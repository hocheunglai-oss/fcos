import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { deriveTradingFxFinalPosteffectSalesforce } from '../scripts/lib/rapid-release/trading-fx-final-posteffect-checkpoint.mjs';
import {
  readTradingFxFinalPosteffectRetainedEvidence, verifyTradingFxFinalPosteffectHistory,
} from '../scripts/lib/rapid-release/trading-fx-final-posteffect-history.mjs';
import { TRADING_FX_MIGRATIONS } from '../scripts/lib/rapid-release/trading-fx-migrations.mjs';

const databaseOperationId = 'trading-fx-hkd-final-preview-mwf7rns1-prerequisites';
const now = Date.parse('2026-11-15T22:00:00.000Z');
const hash = letter => letter.repeat(64);

function fixture() {
  const candidate = { sha: 'a'.repeat(40), sourceDigest: hash('b') };
  const previous = { deploymentId: 'dpl_previous', sha: 'c'.repeat(40), configurationDigest: hash('d'), schemaDigest: hash('e') };
  const plan = { backwardCompatible: true, migrations: structuredClone(TRADING_FX_MIGRATIONS),
    salesforceFingerprint: hash('a'), salesforceSourceTreeHash: hash('b'), xeroQualificationDeploymentId: 100,
    xeroQualificationDigest: hash('f'), salesSupportRepair: { viewAllFieldsCorrection: true, correctionFingerprint: hash('c'),
      sourceTreeHash: hash('d') } };
  const manifest = { releaseId: 'posteffect-test', candidate, previous, selection: { salesforce: true, database: true },
    paths: TRADING_FX_MIGRATIONS.map(({ path }) => path), prerequisites: { adapter: 'trading-fx-prerequisites', plan } };
  const verified = { manifest, records: [{ payload: { event: 'prerequisites.intent' } }], operationId: 'posteffect-test-prerequisites',
    signingProvider: { nativeConfiguration() {}, tradingFxSigningEnvironment() {} } };
  const baseline = { ...previous, currentDeploymentId: previous.deploymentId, observedAt: new Date(now - 1000).toISOString() };
  const order = 'devee-mirror-qat-production';
  const pinned = { salesforce: { order, mirrorVerified: true, sourceTreeHash: plan.salesforceSourceTreeHash,
    correction: { fingerprint: plan.salesSupportRepair.correctionFingerprint, sourceTreeHash: plan.salesSupportRepair.sourceTreeHash, order } },
  completedOperations: [{ operationId: 'salesforce:production:deployment', verified: true, intentRecorded: true, evidenceDigest: hash('9') }] };
  const salesforce = { nativeVerified: true, ...structuredClone(pinned.salesforce), fingerprint: plan.salesforceFingerprint,
    completedOperations: structuredClone(pinned.completedOperations) };
  const history = { database: { operationId: databaseOperationId, operationDigest: hash('7'), baselineSchemaDigest: hash('8'),
    schemaDigest: previous.schemaDigest }, originalReceipt: { id: 7773043936, payload: { data: { databaseSubmissionId: 7772079332,
    operationId: databaseOperationId, databaseSchemaDigest: previous.schemaDigest, evidenceDigest: hash('6') } } },
  qualificationManifest: { candidate: { sha: 'd'.repeat(40), sourceDigest: hash('5') }, prerequisites: { plan: structuredClone(plan) } } };
  const xero = { verified: true, testCompany: true, candidateSha: history.qualificationManifest.candidate.sha,
    sourceDigest: history.qualificationManifest.candidate.sourceDigest, evidenceDigest: plan.xeroQualificationDigest,
    migrationDigest: digest(TRADING_FX_MIGRATIONS) };
  const called = [];
  const github = { read() { throw new Error('unexpected provider read'); } };
  const env = {};
  const input = { verified, github, env, baseline, salesforce };
  const dependencies = {
    deriveSalesforce: data => { assert.equal(data, verified); called.push('derive'); return pinned; },
    readHistory: async frame => {
      assert.deepEqual(frame, { manifest, github, env, signingProvider: verified.signingProvider });
      called.push('database_history');
      return history;
    },
    verifyMigrations: async frame => { assert.deepEqual(frame, { manifest, github }); called.push('migration_bytes'); },
    verifyXero: async (frame, { github: native }) => {
      assert.deepEqual(frame, { manifest: history.qualificationManifest, plan: history.qualificationManifest.prerequisites.plan, env });
      assert.equal(native(), github);
      called.push('xero_demo');
      return xero;
    },
    now: () => now,
  };
  return { input, dependencies, called, plan, history, xero, pinned, run: () => verifyTradingFxFinalPosteffectHistory(input, dependencies) };
}

test('recovers the exact original operation with a current read-only baseline and canonical public receipt', async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(f.called, ['derive', 'database_history', 'migration_bytes', 'xero_demo']);
  assert.deepEqual(result, {
    passed: true, manifestHash: digest(f.input.verified.manifest), backwardCompatible: true,
    salesforce: f.pinned.salesforce,
    database: { readbackVerified: true, destructiveRollback: false, schemaDigest: f.input.baseline.schemaDigest },
    completedOperations: [{ operationId: databaseOperationId, verified: true, intentRecorded: true,
      evidenceDigest: digest({ databaseReceiptId: 7773043936, databaseSubmissionId: 7772079332,
        originalEvidence: hash('6'), operationDigest: hash('7'), migrations: TRADING_FX_MIGRATIONS, schemaDigest: hash('e') }) },
    ...f.pinned.completedOperations],
  });
});

test('rejects incompatible Production or changed operation scope before reading historical evidence', async () => {
  for (const [change, code] of [
    [f => { f.input.baseline.currentDeploymentId = 'dpl_other'; }, /BASELINE_CHANGED/],
    [f => { f.input.baseline.configurationDigest = hash('b'); }, /BASELINE_CHANGED/],
    [f => { f.input.baseline.schemaDigest = hash('8'); }, /BASELINE_CHANGED/],
    [f => { f.input.baseline.observedAt = new Date(now - 300_001).toISOString(); }, /BASELINE_CHANGED/],
    [f => { f.input.verified.records.push({ payload: { event: 'prerequisites.database_submitting' } }); }, /REVIEWED_PACKAGE_CHANGED/],
    [f => { f.plan.migrations[0].digest = hash('0'); }, /REVIEWED_PACKAGE_CHANGED/],
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.run(), code);
    assert.deepEqual(f.called, []);
  }
});

test('refuses unverified Salesforce results and original-operation evidence drift', async () => {
  for (const [change, code] of [
    [f => { f.input.salesforce.nativeVerified = false; }, /SALESFORCE_EVIDENCE_CHANGED/],
    [f => { f.input.salesforce.completedOperations[0].evidenceDigest = hash('0'); }, /SALESFORCE_EVIDENCE_CHANGED/],
    [f => { f.history.originalReceipt.payload.data.databaseSubmissionId += 1; }, /DATABASE_HISTORY_CHANGED/],
    [f => { f.history.database.operationId = f.input.verified.operationId; }, /DATABASE_HISTORY_CHANGED/],
    [f => { f.history.qualificationManifest.prerequisites.plan.xeroQualificationDeploymentId += 1; }, /XERO_QUALIFICATION_SCOPE_CHANGED/],
    [f => { f.xero.testCompany = false; }, /XERO_QUALIFICATION_CHANGED/],
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.run(), code);
  }
});

test('rejects changed migration bytes at the exact candidate ref', async () => {
  const f = fixture();
  delete f.dependencies.verifyMigrations;
  const seen = [];
  f.input.github.read = async endpoint => {
    seen.push(endpoint);
    return { type: 'file', path: endpoint.split('/contents/')[1].split('?')[0], encoding: 'base64', content: 'YWRqdXN0ZWQ=' };
  };
  await assert.rejects(f.run(), /MIGRATION_BYTES_CHANGED/);
  const ref = f.input.verified.manifest.candidate.sha;
  assert.deepEqual(seen, TRADING_FX_MIGRATIONS.map(({ path }) => `/repos/hocheunglai-oss/fcos/contents/${path}?ref=${ref}`));
});

test('retained database history can be verified without treating Salesforce as applied', async () => {
  const f = fixture();
  delete f.input.salesforce;
  const retained = await readTradingFxFinalPosteffectRetainedEvidence(f.input, f.dependencies);
  assert.deepEqual(f.called, ['database_history', 'migration_bytes', 'xero_demo']);
  assert.deepEqual(Object.keys(retained).sort(), ['database', 'databaseOperation']);
  assert.equal(retained.databaseOperation.operationId, databaseOperationId);
  assert.equal(retained.database.schemaDigest, f.input.baseline.schemaDigest);
});

test('uses the exact checkpoint-derived Salesforce proof and excludes the private fingerprint field', async () => {
  const f = fixture();
  const checkpoints = new Map();
  const save = (fingerprint, stage, operation) => checkpoints.set(`${fingerprint}:${stage}:${operation}`, {
    payload: { data: { fingerprint, stage, operation, outcome: 'resolved', evidenceDigest: digest({ fingerprint, stage, operation }) } },
  });
  for (const stage of ['devee', 'qat', 'production']) {
    for (const operation of ['bootstrap', 'validation', 'deployment', 'permission:Fcos_Trading_FX_Data']) {
      save(f.plan.salesforceFingerprint, stage, operation);
    }
    save(f.plan.salesSupportRepair.correctionFingerprint, stage, 'sales-support-correction');
  }
  save(f.plan.salesforceFingerprint, 'shared_mirror', 'publication');
  save(f.plan.salesSupportRepair.correctionFingerprint, 'shared_mirror', 'publication');
  f.input.verified.checkpoints = checkpoints;
  delete f.dependencies.deriveSalesforce;
  const pinned = deriveTradingFxFinalPosteffectSalesforce(f.input.verified);
  f.input.salesforce = { ...pinned.salesforce, nativeVerified: true, fingerprint: f.plan.salesforceFingerprint,
    completedOperations: pinned.completedOperations };
  const result = await f.run();
  assert.equal(Object.hasOwn(result.salesforce, 'fingerprint'), false);
  assert.equal(result.completedOperations.length, 18);
  assert.deepEqual(result.completedOperations.slice(1), pinned.completedOperations);
});
