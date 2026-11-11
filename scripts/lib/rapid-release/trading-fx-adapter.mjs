import { digest, isDigest, requireCondition } from './contract.mjs';
import { reviewedMigrationAdapter } from './reviewed-migration-adapter.mjs';
import { prepareReviewedSalesforcePrerequisites, verifyPreBootstrapStage as verifySalesforceStage } from './salesforce-reviewed-adapter.mjs';
import { TRADING_FX_MIGRATIONS } from './trading-fx-migrations.mjs';
import { runTradingFxTransaction } from './trading-fx-transaction.mjs';

const workflowPaths = ['api/_xeroNativeDocumentActions.js', 'api/_xeroPaymentPosting.js'];
const migrationPaths = TRADING_FX_MIGRATIONS.map(({ path }) => path);
const migrationDigest = digest(TRADING_FX_MIGRATIONS);
const applyTradingFxDatabase = reviewedMigrationAdapter({
  migrations: TRADING_FX_MIGRATIONS, workflowPaths, transactMigration: runTradingFxTransaction,
  errorPrefix: 'TRADING_FX', credentialsPrefix: 'TRADING_FX',
  purpose: 'rapid_trading_fx_prerequisite', withSalesforce: true,
});

export function createTradingFxPrerequisiteAdapter({
  verifyXeroQualification, applyDatabase = applyTradingFxDatabase,
  prepareSalesforce = prepareReviewedSalesforcePrerequisites, verifyStage = verifySalesforceStage,
} = {}) {
  requireCondition(typeof verifyXeroQualification === 'function', 'TRADING_FX_XERO_VERIFIER_REQUIRED');

  async function verifyScope(input) {
    const { manifest, plan } = input;
    requireCondition(manifest.selection.salesforce === true && manifest.selection.database === true
      && manifest.selection.normalRole === true && manifest.selection.modules.includes('xero_portal')
      && plan.backwardCompatible === true && plan.deferSchemaDependentSmoke === true
      && isDigest(plan.bootstrapFingerprint) && isDigest(plan.salesforceFingerprint)
      && isDigest(plan.salesforceSourceTreeHash) && digest(plan.migrations) === migrationDigest
      && workflowPaths.every(path => manifest.paths.includes(path))
      && digest(manifest.paths.filter(path => path.startsWith('supabase/migrations/'))) === digest(migrationPaths)
      && isDigest(plan.xeroQualificationDigest), 'TRADING_FX_REVIEWED_PLAN_REQUIRED');
    const qualification = await verifyXeroQualification(input);
    requireCondition(qualification?.verified === true && qualification.testCompany === true
      && qualification.candidateSha === manifest.candidate.sha && qualification.sourceDigest === manifest.candidate.sourceDigest
      && qualification.migrationDigest === migrationDigest && qualification.evidenceDigest === plan.xeroQualificationDigest,
    'TRADING_FX_XERO_QUALIFICATION_REQUIRED');
  }

  return {
    async verifyPreBootstrapStage(input) {
      await verifyScope(input);
      return verifyStage(input, { withDatabase: true });
    },
    async applyReviewedPrerequisites(input) {
      await verifyScope(input);
      const applySalesforce = prepareSalesforce(input, { withDatabase: true });
      // The reviewed DB additions are backward compatible. Complete and
      // verify them before Salesforce can expose any native financial records.
      const database = await applyDatabase(input);
      const manifestHash = digest(input.manifest);
      requireCondition(database?.passed === true && database.manifestHash === manifestHash && database.backwardCompatible === true
        && database.database?.readbackVerified === true && database.database.destructiveRollback === false
        && isDigest(database.database.schemaDigest), 'TRADING_FX_DATABASE_PROOF_REQUIRED');
      const salesforce = await applySalesforce();
      requireCondition(salesforce?.passed === true && salesforce.manifestHash === manifestHash && salesforce.backwardCompatible === true
        && salesforce.salesforce?.mirrorVerified === true && salesforce.salesforce.order === 'devee-mirror-qat-production'
        && salesforce.salesforce.sourceTreeHash === input.plan.salesforceSourceTreeHash
        && salesforce.salesforce.fingerprint === input.plan.salesforceFingerprint, 'TRADING_FX_SALESFORCE_PROOF_REQUIRED');
      return { passed: true, manifestHash, backwardCompatible: true, database: database.database, salesforce: salesforce.salesforce,
        completedOperations: [...database.completedOperations, ...salesforce.completedOperations] };
    },
  };
}
