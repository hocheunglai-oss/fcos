import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { assertAuthorization, digest, isDigest, requireCondition, targets, validateManifest } from './contract.mjs';
import { DeploymentJournal, pendingOperations } from './journal.mjs';
import { readLocalMirrorDeployments } from './local-mirror-handoff.mjs';
import { githubClient } from './providers.mjs';
import { reviewedMigrationAdapter } from './reviewed-migration-adapter.mjs';
import { prepareReviewedSalesforcePrerequisites, verifyPreBootstrapStage as verifySalesforceStage } from './salesforce-reviewed-adapter.mjs';
import { TRADING_FX_MIGRATIONS } from './trading-fx-migrations.mjs';
import { runTradingFxTransaction } from './trading-fx-transaction.mjs';
import { readTradingFxPostQatRecovery } from './trading-fx-post-qat-recovery.mjs';
import { readTradingFxQatRecovery } from './trading-fx-qat-recovery.mjs';
import { verifyTradingFxXeroQualification } from './trading-fx-xero-qualification.mjs';

const workflowPaths = ['api/_xeroNativeDocumentActions.js', 'api/_xeroPaymentPosting.js'];
const migrationPaths = TRADING_FX_MIGRATIONS.map(({ path }) => path);
const migrationDigest = digest(TRADING_FX_MIGRATIONS);
const salesforcePolicy = FCOS_CONNECTION_POLICY.providers.find(provider => provider.id === 'salesforce');
const ownerId = salesforcePolicy.publication.requiredAccountId;
const botId = 41898282;
const journalEnvironment = 'fcos-release-journal-v1';
const recoveryOutcome = 'trading_fx_database_and_devee_complete_mirror_not_started';
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const applyTradingFxDatabase = reviewedMigrationAdapter({
  migrations: TRADING_FX_MIGRATIONS, workflowPaths, transactMigration: runTradingFxTransaction,
  errorPrefix: 'TRADING_FX', credentialsPrefix: 'TRADING_FX',
  purpose: 'rapid_trading_fx_prerequisite', withSalesforce: true,
});

export async function readTradingFxRecovery({ manifest, plan, env }, { github = githubClient } = {}) {
  const { tradingFxRecoveryReceiptId: receiptId, ...originalPlan } = plan;
  requireCondition(positiveId(receiptId) && plan.mirrorPublication === 'local-collaborator',
    'TRADING_FX_RECOVERY_LOCATOR_INVALID');
  const candidateSha = manifest.candidate.sha;
  const api = github({ token: env.GITHUB_TOKEN, candidateSha });
  const path = `/repos/${targets().repository}/deployments/`;
  const receipt = await api.read(path + receiptId);
  const payload = receipt?.payload;
  const closure = payload?.data;
  requireCondition(receipt?.id === receiptId && receipt.creator?.id === ownerId
    && receipt.creator.login === targets().account && receipt.environment === journalEnvironment
    && receipt.sha === candidateSha && payload?.kind === 'fcos_rapid_release_event'
    && payload.event === 'prerequisites.result' && isDigest(payload.manifestHash)
    && payload.releaseId !== manifest.releaseId && closure?.outcome === recoveryOutcome
    && positiveId(closure.originalRunId) && positiveId(closure.databaseSubmissionId)
    && closure.salesforceFingerprint === plan.salesforceFingerprint
    && isDigest(closure.databaseSchemaDigest) && closure.databaseSchemaDigest === manifest.previous.schemaDigest
    && isDigest(closure.evidenceDigest) && Array.isArray(closure.deveeCheckpoints)
    && closure.deveeCheckpoints.length === 3 && Array.isArray(closure.deveePermissionCheckpoints)
    && [...closure.deveeCheckpoints, ...closure.deveePermissionCheckpoints].every(positiveId),
  'TRADING_FX_RECOVERY_CLOSURE_REQUIRED');
  const journal = new DeploymentJournal({ github: { ...api, candidateSha }, actorIds: [ownerId, botId],
    releaseId: payload.releaseId, manifestHash: payload.manifestHash });
  const [chain, mirrorRecords] = await Promise.all([journal.read(), readLocalMirrorDeployments(api, candidateSha)]);
  const terminal = chain.at(-1);
  const beforeClosure = chain.slice(0, -1);
  const findBot = event => beforeClosure.find(record => record.payload.event === event && record.creator.id === botId);
  const prepared = findBot('release.prepared');
  const prior = prepared?.payload.data.manifest;
  requireCondition(terminal?.id === receiptId && terminal.creator.id === ownerId
    && terminal.payload.recordHash === payload.recordHash && prior && validateManifest(prior) === payload.manifestHash
    && prior.releaseId === payload.releaseId && prior.controllerSha !== manifest.controllerSha
    && prior.prerequisites.adapter === manifest.prerequisites.adapter && digest(prior.prerequisites.plan) === digest(originalPlan)
    && digest(prior.candidate) === digest(manifest.candidate) && digest(prior.build) === digest(manifest.build)
    && digest(prior.previous) === digest({ ...manifest.previous, schemaDigest: prior.previous.schemaDigest })
    && prior.previous.schemaDigest !== manifest.previous.schemaDigest
    && digest(prior.paths) === digest(manifest.paths) && digest(prior.moduleInventory) === digest(manifest.moduleInventory),
  'TRADING_FX_RECOVERY_MANIFEST_CHANGED');
  const operationId = `${prior.releaseId}-prerequisites`;
  const request = { planDigest: digest(prior.prerequisites), candidateSha };
  const operationDigest = digest({ manifestHash: payload.manifestHash, operationId, request });
  const intentRecord = findBot('prerequisites.intent');
  const intent = intentRecord?.payload.data;
  const submissions = beforeClosure.filter(record => record.payload.event === 'prerequisites.database_submitting');
  const pending = pendingOperations(beforeClosure);
  requireCondition(closure.operationId === operationId
    && intent?.operationId === operationId && intent.requestHash === digest(request) && digest(intent.request ?? null) === digest(request)
    && submissions.length === 1 && submissions[0].creator.id === botId && submissions[0].id === closure.databaseSubmissionId
    && digest(submissions[0].payload.data) === digest({ operationId, operationDigest })
    && pending.length === 1 && pending[0].event === 'prerequisites.intent' && pending[0].data.operationId === operationId
    && pendingOperations(chain).length === 0
    && beforeClosure.every(({ payload: entry }) => !/^(?:prerequisites\.(?:result|passed|smoke_passed)|(?:promote|rollback)\.|live\.passed|release\.complete)/u.test(entry.event)
      && (entry.event !== 'salesforce.checkpoint' || entry.data.outcome === 'evidence' || entry.data.stage === 'devee'))
    && !mirrorRecords.some(record => record.payload?.manifestHash === payload.manifestHash),
  'TRADING_FX_RECOVERY_ORIGINAL_OPERATION_REQUIRED');
  const stageRecord = findBot('stage.result');
  const stage = stageRecord?.payload.data;
  const priorApproval = findBot('approval.accepted');
  const approval = priorApproval?.payload.data;
  const authoritySequence = [prepared, stageRecord, priorApproval, intentRecord, submissions[0]];
  requireCondition(stage?.outcome === 'applied' && stage.result?.sha === candidateSha && stage.result.buildId === prior.build.buildId
    && stage.result.manifestHash === payload.manifestHash
    && authoritySequence.every((record, index) => record
      && (index === 0 || record.payload.sequence > authoritySequence[index - 1].payload.sequence))
    && approval?.runId === closure.originalRunId && Number.isFinite(Date.parse(priorApproval.created_at)),
  'TRADING_FX_RECOVERY_ORIGINAL_APPROVAL_REQUIRED');
  assertAuthorization(approval, prior, stage.result, Date.parse(priorApproval.created_at));

  const checkpoints = new Map(beforeClosure.filter(({ payload: entry }) => entry.event === 'salesforce.checkpoint')
    .map(record => [`${record.payload.data.stage}:${record.payload.data.operation}`, record]));
  const expectedJobs = ['bootstrap', 'validation', 'deployment'].map(operation => checkpoints.get('devee:' + operation));
  const expectedPermissions = [...checkpoints.values()].filter(({ payload: entry }) => entry.data.stage === 'devee'
    && entry.data.operation.startsWith('permission:')).sort((left, right) => left.payload.data.operation.localeCompare(right.payload.data.operation));
  requireCondition([...expectedJobs, ...expectedPermissions].every(record => record?.creator.id === botId
    && record.payload.data.outcome === 'resolved' && record.payload.data.fingerprint === plan.salesforceFingerprint
    && record.payload.sequence > submissions[0].payload.sequence)
    && digest(expectedJobs.map(record => record.id)) === digest(closure.deveeCheckpoints)
    && digest(expectedPermissions.map(record => record.id)) === digest(closure.deveePermissionCheckpoints),
  'TRADING_FX_RECOVERY_DEVEE_CHECKPOINTS_REQUIRED');
  return {
    receipt, jobs: expectedJobs, permissions: expectedPermissions,
    database: { operationId, operationDigest, baselineSchemaDigest: prior.previous.schemaDigest, schemaDigest: closure.databaseSchemaDigest },
  };
}

async function readQatRecovery({ manifest, plan, env }) {
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha });
  return readTradingFxQatRecovery({ manifest, github, receiptId: plan.tradingFxQatRecoveryReceiptId, ownerId,
    readOriginalRecovery: prior => readTradingFxRecovery({ manifest: prior, plan: prior.prerequisites.plan, env }) });
}

async function readPostQatRecovery({ manifest, plan, env }) {
  const github = githubClient({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha });
  return readTradingFxPostQatRecovery({ manifest, github, receiptId: plan.tradingFxPostQatRecoveryReceiptId, ownerId,
    readQatRecovery: prior => readQatRecovery({ manifest: prior, plan: prior.prerequisites.plan, env }) });
}

export function createTradingFxPrerequisiteAdapter({
  verifyXeroQualification, applyDatabase = applyTradingFxDatabase,
  prepareSalesforce = prepareReviewedSalesforcePrerequisites, verifyStage = verifySalesforceStage,
  readRecovery = readTradingFxRecovery, readStoppedQatRecovery = readQatRecovery,
  readStoppedPostQatRecovery = readPostQatRecovery,
} = {}) {
  requireCondition(typeof verifyXeroQualification === 'function', 'TRADING_FX_XERO_VERIFIER_REQUIRED');

  async function verifyScope(input, prior) {
    const { manifest, plan } = input;
    requireCondition(manifest.selection.salesforce === true && manifest.selection.database === true
      && manifest.selection.normalRole === true && manifest.selection.modules.includes('xero_portal')
      && plan.backwardCompatible === true && plan.deferSchemaDependentSmoke === true
      && Array.isArray(plan.deferredModules) && !plan.deferredModules.includes('xero_portal')
      && isDigest(plan.bootstrapFingerprint) && isDigest(plan.salesforceFingerprint)
      && isDigest(plan.salesforceSourceTreeHash) && digest(plan.migrations) === migrationDigest
      && workflowPaths.every(path => manifest.paths.includes(path))
      && digest(manifest.paths.filter(path => path.startsWith('supabase/migrations/'))) === digest(migrationPaths)
      && isDigest(plan.xeroQualificationDigest), 'TRADING_FX_REVIEWED_PLAN_REQUIRED');
    // The stopped-QAT reader proves that the successor changed only the Apex
    // test fixture and reviewed source hash. Reverify the original Demo receipt
    // against its own candidate and keep its original evidence identity.
    const qualifiedManifest = prior || manifest;
    const qualifiedPlan = qualifiedManifest.prerequisites?.plan || plan;
    requireCondition(!prior || (plan.xeroQualificationDeploymentId === qualifiedPlan.xeroQualificationDeploymentId
      && plan.xeroQualificationDigest === qualifiedPlan.xeroQualificationDigest),
    'TRADING_FX_QAT_XERO_QUALIFICATION_CHANGED');
    const qualification = await verifyXeroQualification({ ...input, manifest: qualifiedManifest, plan: qualifiedPlan });
    requireCondition(qualification?.verified === true && qualification.testCompany === true
      && qualification.candidateSha === qualifiedManifest.candidate.sha && qualification.sourceDigest === qualifiedManifest.candidate.sourceDigest
      && qualification.migrationDigest === migrationDigest && qualification.evidenceDigest === plan.xeroQualificationDigest,
    'TRADING_FX_XERO_QUALIFICATION_REQUIRED');
  }

  async function recoveryFor(input) {
    const original = Object.hasOwn(input.plan, 'tradingFxRecoveryReceiptId');
    const stoppedQat = Object.hasOwn(input.plan, 'tradingFxQatRecoveryReceiptId');
    const postQat = Object.hasOwn(input.plan, 'tradingFxPostQatRecoveryReceiptId');
    requireCondition(Number(original) + Number(stoppedQat) + Number(postQat) <= 1, 'TRADING_FX_RECOVERY_LOCATOR_INVALID');
    if (postQat) return { postQat: await readStoppedPostQatRecovery(input) };
    if (stoppedQat) return { qat: await readStoppedQatRecovery(input) };
    return { original: original ? await readRecovery(input) : undefined };
  }

  return {
    async verifyPreBootstrapStage(input) {
      const recovery = await recoveryFor(input);
      await verifyScope(input, (recovery.qat || recovery.postQat?.nested)?.prior);
      return verifyStage(input, { withDatabase: true });
    },
    async applyReviewedPrerequisites(input) {
      const recovery = await recoveryFor(input);
      await verifyScope(input, (recovery.qat || recovery.postQat?.nested)?.prior);
      const applySalesforce = prepareSalesforce(input, { withDatabase: true, tradingFxRecovery: recovery.original,
        tradingFxQatRecovery: recovery.qat, tradingFxPostQatRecovery: recovery.postQat });
      // The reviewed DB additions are backward compatible. Complete and
      // verify them before Salesforce can expose any native financial records.
      const database = await applyDatabase({ ...input, originalDatabaseOperation: (recovery.postQat || recovery.qat || recovery.original)?.database });
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

export const { applyReviewedPrerequisites, verifyPreBootstrapStage } = createTradingFxPrerequisiteAdapter({
  verifyXeroQualification: verifyTradingFxXeroQualification,
});
