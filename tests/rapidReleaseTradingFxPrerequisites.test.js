import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { createTradingFxPrerequisiteAdapter } from '../scripts/lib/rapid-release/trading-fx-adapter.mjs';
import { TRADING_FX_MIGRATIONS } from '../scripts/lib/rapid-release/trading-fx-migrations.mjs';

const hash = 'a'.repeat(64);

function fixture({ qualification = {}, databaseReadback = true, malformedSalesforce = false } = {}) {
  const calls = [];
  let applied = false;
  let failSalesforce = false;
  const manifest = {
    candidate: { sha: 'a'.repeat(40), sourceDigest: hash },
    selection: { salesforce: true, database: true, normalRole: true, modules: ['xero_portal', 'buyer_invoices'] },
    paths: ['api/_xeroNativeDocumentActions.js', 'api/_xeroPaymentPosting.js', ...TRADING_FX_MIGRATIONS.map(row => row.path)],
  };
  const plan = { migrations: TRADING_FX_MIGRATIONS, salesforceFingerprint: hash, salesforceSourceTreeHash: hash,
    bootstrapFingerprint: hash, backwardCompatible: true, deferSchemaDependentSmoke: true,
    deferredModules: ['buyer_invoices'], xeroQualificationDigest: hash };
  const input = { manifest, plan, approval: { nativeReviewVerified: true } };
  const receipt = operationId => ({ operationId, verified: true, intentRecorded: true, evidenceDigest: hash });
  const bound = { passed: true, manifestHash: digest(manifest), backwardCompatible: true };
  const adapter = createTradingFxPrerequisiteAdapter({
    async verifyXeroQualification() {
      calls.push('verify-xero');
      return { verified: true, testCompany: true, candidateSha: manifest.candidate.sha, sourceDigest: hash,
        migrationDigest: digest(TRADING_FX_MIGRATIONS), evidenceDigest: hash, ...qualification };
    },
    async verifyStage(_input, options) { calls.push('stage'); assert.equal(options.withDatabase, true); return 'stage-proof'; },
    prepareSalesforce(_input, options) {
      calls.push('review-salesforce');
      assert.equal(options.withDatabase, true);
      if (malformedSalesforce) throw new Error('unreviewed Salesforce source');
      return async () => {
        calls.push('apply-salesforce');
        if (failSalesforce) throw new Error('Salesforce prerequisite paused');
        return { ...bound, salesforce: { mirrorVerified: true, order: 'devee-mirror-qat-production', sourceTreeHash: hash, fingerprint: hash },
          completedOperations: [receipt('salesforce:production:deployment')] };
      };
    },
    async applyDatabase() {
      calls.push(applied ? 'read-original-database' : 'apply-database');
      applied = true;
      return { ...bound, database: { readbackVerified: databaseReadback, destructiveRollback: false, schemaDigest: hash },
        completedOperations: [receipt('database-prerequisite')] };
    },
  });
  return { calls, adapter, input, pauseSalesforce: value => { failSalesforce = value; } };
}

test('Trading FX uses one scoped staged approval path and resumes database readback before Salesforce', async () => {
  const { calls, input, adapter, pauseSalesforce } = fixture();
  assert.equal(await adapter.verifyPreBootstrapStage(input), 'stage-proof');
  pauseSalesforce(true);
  await assert.rejects(adapter.applyReviewedPrerequisites(input), /Salesforce prerequisite paused/);
  pauseSalesforce(false);
  const result = await adapter.applyReviewedPrerequisites(input);
  assert.equal(result.database.schemaDigest, hash);
  assert.equal(result.salesforce.mirrorVerified, true);
  assert.deepEqual(result.completedOperations.map(row => row.operationId), ['database-prerequisite', 'salesforce:production:deployment']);
  assert.deepEqual(calls, ['verify-xero', 'stage', 'verify-xero', 'review-salesforce', 'apply-database', 'apply-salesforce',
    'verify-xero', 'review-salesforce', 'read-original-database', 'apply-salesforce']);
});

test('Trading FX rejects unqualified Xero or Salesforce evidence before a database effect', async () => {
  assert.throws(() => createTradingFxPrerequisiteAdapter(), { code: 'TRADING_FX_XERO_VERIFIER_REQUIRED' });
  for (const qualification of [{ testCompany: false }, { candidateSha: 'b'.repeat(40) }, { migrationDigest: 'b'.repeat(64) }]) {
    const { calls, adapter, input } = fixture({ qualification });
    await assert.rejects(adapter.verifyPreBootstrapStage(input), { code: 'TRADING_FX_XERO_QUALIFICATION_REQUIRED' });
    await assert.rejects(adapter.applyReviewedPrerequisites(input), { code: 'TRADING_FX_XERO_QUALIFICATION_REQUIRED' });
    assert.deepEqual(calls, ['verify-xero', 'verify-xero']);
  }
  const { calls, adapter, input } = fixture({ malformedSalesforce: true });
  await assert.rejects(adapter.applyReviewedPrerequisites(input), /unreviewed Salesforce source/);
  assert.deepEqual(calls, ['verify-xero', 'review-salesforce']);
});

test('Trading FX requires the exact migration package and completed database readback', async () => {
  const { calls, adapter, input } = fixture({ databaseReadback: false });
  await assert.rejects(adapter.applyReviewedPrerequisites({ ...input, plan: { ...input.plan, migrations: [] } }),
    { code: 'TRADING_FX_REVIEWED_PLAN_REQUIRED' });
  assert.deepEqual(calls, []);
  await assert.rejects(adapter.applyReviewedPrerequisites(input), { code: 'TRADING_FX_DATABASE_PROOF_REQUIRED' });
  assert.deepEqual(calls, ['verify-xero', 'review-salesforce', 'apply-database']);
});
