import { digest, isSha, requireCondition, targets } from './contract.mjs';
import { COMPANY_FX_MIGRATION_DIGEST, COMPANY_FX_MIGRATION_PATH } from './company-fx-catalog.mjs';
import { applyCompanyFxTransaction } from './company-fx-transaction.mjs';
import { assertPinnedDatabaseIdentity, openPinnedDatabase } from './database-connection.mjs';
import { createDatabaseCredentialIntentStore } from './database-intent.mjs';
import { githubClient } from './providers.mjs';

const expectedPlan = { migrationPath: COMPANY_FX_MIGRATION_PATH, migrationDigest: COMPANY_FX_MIGRATION_DIGEST };
const writerIdentity = "select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only";

async function openWriter({ manifest, controllerDirectory, env }) {
  const token = env.FCOS_RAPID_COMPANY_FX_DB_ACCESS_TOKEN;
  const ownerToken = env.FCOS_RAPID_COMPANY_FX_GH_OWNER_TOKEN;
  requireCondition(env.GITHUB_ACTIONS === 'true' && token && ownerToken && env.FCOS_RAPID_DATABASE_CA,
    'COMPANY_FX_PROTECTED_WRITER_CREDENTIAL_REQUIRED');
  const credential = { kind: 'supabase_management', token };
  const github = githubClient({ token: ownerToken });
  const intentStore = await createDatabaseCredentialIntentStore({
    credential, directory: controllerDirectory, source: { sha: manifest.controllerSha }, purpose: 'rapid_company_fx_prerequisite', github,
  });
  return openPinnedDatabase({ credential, intentStore, caFile: env.FCOS_RAPID_DATABASE_CA });
}

export async function applyReviewedPrerequisites({ manifest, approval, journal, controllerDirectory, env, plan, authorization,
  databaseWriter }, { github = githubClient, connect = openWriter, verifyIdentity = assertPinnedDatabaseIdentity } = {}) {
  const manifestHash = digest(manifest);
  requireCondition(digest(plan) === digest(expectedPlan) && manifest.selection.database === true
    && manifest.selection.salesforce === false && isSha(manifest.candidate.sha)
    && digest(manifest.paths.filter(path => path.startsWith('supabase/migrations/'))) === digest([COMPANY_FX_MIGRATION_PATH]),
  'COMPANY_FX_REVIEWED_PLAN_MISMATCH');
  requireCondition(approval?.manifestHash === manifestHash && approval.nativeReviewVerified === true
    && authorization?.manifestHash === manifestHash && digest(authorization.nativeReview ?? null) === digest(approval)
    && typeof databaseWriter?.assertAuthorized === 'function', 'COMPANY_FX_PROTECTED_WRITER_REQUIRED');
  const operationId = `${manifest.releaseId}-prerequisites`;
  const request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
  const records = (await journal.read()).map(record => record.payload);
  const durableApproval = records.find(record => record.event === 'approval.accepted')?.data;
  const intent = records.find(record => record.event === 'prerequisites.intent')?.data;
  requireCondition(digest(durableApproval ?? null) === digest(approval ?? null)
    && intent?.operationId === operationId && intent.requestHash === digest(request) && digest(intent.request ?? null) === digest(request),
  'COMPANY_FX_DURABLE_AUTHORIZED_INTENT_REQUIRED');
  const nativeGitHub = github({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha });
  const file = await nativeGitHub.read(`/repos/${targets().repository}/contents/${COMPANY_FX_MIGRATION_PATH}?ref=${manifest.candidate.sha}`);
  requireCondition(file.path === COMPANY_FX_MIGRATION_PATH && file.encoding === 'base64'
    && typeof file.content === 'string', 'COMPANY_FX_MIGRATION_BYTES_CHANGED');
  const migrationBytes = Buffer.from(file.content, 'base64');
  requireCondition(digest(migrationBytes) === COMPANY_FX_MIGRATION_DIGEST, 'COMPANY_FX_MIGRATION_BYTES_CHANGED');
  await databaseWriter.assertAuthorized();
  const { db, connection } = await connect({ manifest, controllerDirectory, env });
  try {
    const assertConnection = async () => verifyIdentity((await db.query(writerIdentity)).rows[0], connection, { readOnly: false });
    const result = await applyCompanyFxTransaction({ db, migrationBytes,
      operationDigest: digest({ manifestHash, operationId, request }), baselineSchemaDigest: manifest.previous.schemaDigest,
      assertConnection,
      async assertWriteAuthorized() {
        await databaseWriter.assertAuthorized();
        await assertConnection();
      } });
    return { passed: true, manifestHash, backwardCompatible: true,
      completedOperations: [{ operationId, evidenceDigest: result.evidenceDigest, verified: true, intentRecorded: true }],
      database: { destructiveRollback: false, readbackVerified: true, schemaDigest: result.schemaDigest } };
  } finally {
    await db.end();
  }
}
