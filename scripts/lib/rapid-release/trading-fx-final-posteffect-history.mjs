import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { digest, isDigest, requireCondition, targets } from './contract.mjs';
import { readTradingFxRecovery } from './trading-fx-adapter.mjs';
import { readFailedBootstrapSuccessor } from './trading-fx-failed-bootstrap-closure.mjs';
import { readTradingFxFieldBoundNoEffectClosure } from './trading-fx-field-bound-no-effect-checkpoint.mjs';
import { deriveTradingFxFinalPosteffectSalesforce } from './trading-fx-final-posteffect-checkpoint.mjs';
import { TRADING_FX_MIGRATIONS } from './trading-fx-migrations.mjs';
import { readTradingFxPostQatRecovery } from './trading-fx-post-qat-recovery.mjs';
import { readTradingFxProductionBootstrapClosure } from './trading-fx-production-bootstrap-checkpoint.mjs';
import {
  assertTradingFxFieldBoundCorrectionSuccessor, assertTradingFxProductionBootstrapSuccessor,
  assertTradingFxViewAllFieldsCorrectionSuccessor,
} from './trading-fx-production-bootstrap-successor.mjs';
import { readTradingFxQatRecovery } from './trading-fx-qat-recovery.mjs';
import { readTradingFxSalesSupportNoEffectClosure } from './trading-fx-sales-support-no-effect-checkpoint.mjs';
import { verifyTradingFxXeroQualification } from './trading-fx-xero-qualification.mjs';

const ownerId = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce').publication.requiredAccountId;
const databaseReceiptId = 7773043936;
const databaseSubmissionId = 7772079332;
const databaseOperationId = 'trading-fx-hkd-final-preview-mwf7rns1-prerequisites';
const migrationPaths = TRADING_FX_MIGRATIONS.map(({ path }) => path);
const migrationDigest = digest(TRADING_FX_MIGRATIONS);
const check = (condition, code) => requireCondition(condition, `TRADING_FX_FINAL_POSTEFFECT_${code}`);
const same = (left, right) => digest(left ?? null) === digest(right ?? null);

async function readHistoricalEvidence({ manifest, github, env, signingProvider }) {
  const plan = manifest.prerequisites.plan;
  const [bootstrap, ineffectiveProfile, ineffectiveFieldBound] = await Promise.all([
    readTradingFxProductionBootstrapClosure({ github, receiptId: plan.tradingFxProductionBootstrapRecoveryReceiptId }),
    readTradingFxSalesSupportNoEffectClosure({ github, receiptId: plan.tradingFxFieldBoundCorrectionClosureReceiptId }),
    readTradingFxFieldBoundNoEffectClosure({ github, receiptId: plan.tradingFxViewAllFieldsClosureReceiptId }),
  ]);
  assertTradingFxProductionBootstrapSuccessor(manifest, bootstrap.checkpoint.prior);
  assertTradingFxFieldBoundCorrectionSuccessor(ineffectiveFieldBound.checkpoint.prior, ineffectiveProfile.checkpoint.prior);
  assertTradingFxViewAllFieldsCorrectionSuccessor(manifest, ineffectiveFieldBound.checkpoint.prior);

  let originalReceipt;
  const historical = await readFailedBootstrapSuccessor({
    manifest: bootstrap.checkpoint.prior, github, ownerId, provider: signingProvider,
    readPostQatRecovery: prior => readTradingFxPostQatRecovery({
      manifest: prior, github, ownerId, receiptId: prior.prerequisites.plan.tradingFxPostQatRecoveryReceiptId,
      readQatRecovery: next => readTradingFxQatRecovery({
        manifest: next, github, ownerId, receiptId: next.prerequisites.plan.tradingFxQatRecoveryReceiptId,
        readOriginalRecovery: async original => {
          const evidence = await readTradingFxRecovery({ manifest: original, plan: original.prerequisites.plan, env }, { github: () => github });
          originalReceipt = evidence.receipt;
          return evidence;
        },
      }),
    }),
  });
  return { ...historical, originalReceipt };
}

async function reverifyMigrationBytes({ manifest, github }) {
  const endpoint = `/repos/${targets().repository}/contents/`;
  await Promise.all(TRADING_FX_MIGRATIONS.map(async ({ path, digest: expected }) => {
    const file = await github.read(`${endpoint}${path}?ref=${manifest.candidate.sha}`);
    check(file?.type === 'file' && file.path === path && file.encoding === 'base64' && typeof file.content === 'string'
      && digest(Buffer.from(file.content, 'base64')) === expected, 'MIGRATION_BYTES_CHANGED');
  }));
}

function assertRetainedScope({ verified, baseline }, now) {
  const { manifest, records, operationId } = verified;
  const plan = manifest.prerequisites?.plan;
  const observedAt = Date.parse(baseline?.observedAt);
  const current = now();
  check(manifest.prerequisites?.adapter === 'trading-fx-prerequisites' && manifest.selection?.database === true
    && manifest.selection.salesforce === true && plan?.backwardCompatible === true && plan.salesSupportRepair?.viewAllFieldsCorrection === true
    && same(plan.migrations, TRADING_FX_MIGRATIONS)
    && same(manifest.paths?.filter(path => path.startsWith('supabase/migrations/')), migrationPaths)
    && operationId === `${manifest.releaseId}-prerequisites`
    && records.every(row => row.payload.event !== 'prerequisites.database_submitting'), 'REVIEWED_PACKAGE_CHANGED');
  check(Number.isFinite(observedAt) && observedAt >= current - 300_000 && observedAt <= current
    && baseline.deploymentId === manifest.previous.deploymentId && baseline.currentDeploymentId === baseline.deploymentId
    && baseline.sha === manifest.previous.sha && baseline.configurationDigest === manifest.previous.configurationDigest
    && isDigest(baseline.schemaDigest) && baseline.schemaDigest === manifest.previous.schemaDigest, 'BASELINE_CHANGED');

}

async function retainedEvidence({ verified, github, env, baseline }, {
  readHistory = readHistoricalEvidence, verifyMigrations = reverifyMigrationBytes,
  verifyXero = verifyTradingFxXeroQualification, now = Date.now,
}) {
  const { manifest, operationId, signingProvider } = verified;
  const plan = manifest.prerequisites.plan;
  const [history] = await Promise.all([
    readHistory({ manifest, github, env, signingProvider }),
    verifyMigrations({ manifest, github }),
  ]);
  const { database, originalReceipt, qualificationManifest } = history;
  const original = originalReceipt?.payload?.data;
  check(originalReceipt?.id === databaseReceiptId && original?.databaseSubmissionId === databaseSubmissionId
    && original.operationId === databaseOperationId && database?.operationId === databaseOperationId
    && database.operationId !== operationId && isDigest(database.operationDigest) && isDigest(database.baselineSchemaDigest)
    && database.baselineSchemaDigest !== database.schemaDigest && original.databaseSchemaDigest === baseline.schemaDigest
    && database.schemaDigest === baseline.schemaDigest && isDigest(original.evidenceDigest), 'DATABASE_HISTORY_CHANGED');
  const qualificationPlan = qualificationManifest?.prerequisites?.plan;
  check(qualificationPlan?.xeroQualificationDeploymentId === plan.xeroQualificationDeploymentId
    && qualificationPlan?.xeroQualificationDigest === plan.xeroQualificationDigest
    && same(qualificationPlan?.migrations, TRADING_FX_MIGRATIONS), 'XERO_QUALIFICATION_SCOPE_CHANGED');
  const xero = await verifyXero({ manifest: qualificationManifest, plan: qualificationPlan, env }, { github: () => github, now });
  check(xero?.verified === true && xero.testCompany === true && xero.candidateSha === qualificationManifest.candidate.sha
    && xero.sourceDigest === qualificationManifest.candidate.sourceDigest && xero.evidenceDigest === plan.xeroQualificationDigest
    && xero.migrationDigest === migrationDigest, 'XERO_QUALIFICATION_CHANGED');

  const databaseOperation = { operationId: databaseOperationId, verified: true, intentRecorded: true,
    evidenceDigest: digest({ databaseReceiptId, databaseSubmissionId, originalEvidence: original.evidenceDigest,
      operationDigest: database.operationDigest, migrations: TRADING_FX_MIGRATIONS, schemaDigest: baseline.schemaDigest }) };
  return { databaseOperation, database: { destructiveRollback: false, readbackVerified: true, schemaDigest: baseline.schemaDigest } };
}

export async function readTradingFxFinalPosteffectRetainedEvidence(input, dependencies = {}) {
  assertRetainedScope(input, dependencies.now ?? Date.now);
  return retainedEvidence(input, dependencies);
}

export async function verifyTradingFxFinalPosteffectHistory(input, dependencies = {}) {
  assertRetainedScope(input, dependencies.now ?? Date.now);
  const { verified, salesforce } = input;
  const { manifest } = verified;
  const deriveSalesforce = dependencies.deriveSalesforce ?? deriveTradingFxFinalPosteffectSalesforce;
  const pinned = deriveSalesforce(verified);
  const { fingerprint: checkpointFingerprint, ...publicSalesforce } = pinned.salesforce;
  const { nativeVerified, completedOperations, fingerprint, ...salesforceProof } = salesforce;
  check(nativeVerified === true && fingerprint === manifest.prerequisites.plan.salesforceFingerprint
    && (checkpointFingerprint === undefined || checkpointFingerprint === fingerprint)
    && same(salesforceProof, publicSalesforce) && same(completedOperations, pinned.completedOperations), 'SALESFORCE_EVIDENCE_CHANGED');

  const { databaseOperation, database } = await retainedEvidence(input, dependencies);
  return { passed: true, manifestHash: digest(manifest), backwardCompatible: true,
    completedOperations: [databaseOperation, ...pinned.completedOperations], salesforce: publicSalesforce, database };
}
