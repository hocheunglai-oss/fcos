import { digest, isSha, requireCondition, targets } from './contract.mjs';
import { assertPinnedDatabaseIdentity, openPinnedDatabase } from './database-connection.mjs';
import { createDatabaseCredentialIntentStore } from './database-intent.mjs';
import { githubClient } from './providers.mjs';

const submissionEvent = 'prerequisites.database_submitting';
const writerIdentity = "select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only";

export function reviewedMigrationAdapter({
  migrations, workflowPaths, transactMigration, errorPrefix, credentialsPrefix, purpose,
  requiredModule = 'xero_portal',
}) {
  const expectedPlan = { migrations };
  const reviewedPaths = migrations.map(({ path }) => path);
  const check = (condition, code) => requireCondition(condition, `${errorPrefix}_${code}`);

  async function openWriter({ manifest, controllerDirectory, env }) {
    const token = env[`FCOS_RAPID_${credentialsPrefix}_DB_ACCESS_TOKEN`];
    const ownerToken = env[`FCOS_RAPID_${credentialsPrefix}_GH_OWNER_TOKEN`];
    check(env.GITHUB_ACTIONS === 'true' && token && ownerToken && env.FCOS_RAPID_DATABASE_CA,
      'PROTECTED_WRITER_CREDENTIAL_REQUIRED');
    const credential = { kind: 'supabase_management', token };
    const intentStore = await createDatabaseCredentialIntentStore({
      credential, directory: controllerDirectory, source: { sha: manifest.controllerSha },
      purpose, github: githubClient({ token: ownerToken }),
    });
    return openPinnedDatabase({ credential, intentStore, caFile: env.FCOS_RAPID_DATABASE_CA });
  }

  return async function applyReviewedPrerequisites({
    manifest, approval, journal, controllerDirectory, env, plan, authorization, databaseWriter,
  }, { github = githubClient, connect = openWriter, verifyIdentity = assertPinnedDatabaseIdentity,
    transact = transactMigration } = {}) {
    const manifestHash = digest(manifest);
    check(digest(plan) === digest(expectedPlan) && manifest.selection.database === true
      && manifest.selection.salesforce === false && manifest.selection.normalRole === true && isSha(manifest.candidate.sha)
      && manifest.selection.modules.includes(requiredModule)
      && workflowPaths.every(path => manifest.paths.includes(path))
      && digest(manifest.paths.filter(path => path.startsWith('supabase/migrations/'))) === digest(reviewedPaths),
    'REVIEWED_PLAN_MISMATCH');
    check(approval?.manifestHash === manifestHash && approval.nativeReviewVerified === true
      && authorization?.manifestHash === manifestHash && digest(authorization.nativeReview ?? null) === digest(approval)
      && typeof databaseWriter?.assertAuthorized === 'function', 'PROTECTED_WRITER_REQUIRED');

    const operationId = `${manifest.releaseId}-prerequisites`;
    const request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
    const operationDigest = digest({ manifestHash, operationId, request });
    const submission = { operationId, operationDigest };
    const records = (await journal.read()).map(({ payload }) => payload);
    const durableApproval = records.find(record => record.event === 'approval.accepted')?.data;
    const intent = records.find(record => record.event === 'prerequisites.intent')?.data;
    check(digest(durableApproval ?? null) === digest(approval)
      && intent?.operationId === operationId && intent.requestHash === digest(request) && digest(intent.request ?? null) === digest(request),
    'DURABLE_AUTHORIZED_INTENT_REQUIRED');
    const markers = records.filter(record => record.event === submissionEvent);
    check(markers.length <= 1 && markers.every(record => digest(record.data) === digest(submission)),
      'SUBMISSION_BINDING_CHANGED');

    const nativeGitHub = github({ token: env.GITHUB_TOKEN, candidateSha: manifest.candidate.sha });
    const migrationBytes = await Promise.all(migrations.map(async ({ path, digest: expected }) => {
      const file = await nativeGitHub.read(`/repos/${targets().repository}/contents/${path}?ref=${manifest.candidate.sha}`);
      check(file.path === path && file.encoding === 'base64' && typeof file.content === 'string',
        'MIGRATION_BYTES_CHANGED');
      const bytes = Buffer.from(file.content, 'base64');
      check(digest(bytes) === expected, 'MIGRATION_BYTES_CHANGED');
      return bytes;
    }));
    await databaseWriter.assertAuthorized();
    const { db, connection } = await connect({ manifest, controllerDirectory, env });
    try {
      const assertConnection = async () => verifyIdentity((await db.query(writerIdentity)).rows[0], connection, { readOnly: false });
      const transaction = { db, migrationBytes, operationDigest, baselineSchemaDigest: manifest.previous.schemaDigest, assertConnection };
      if (markers.length === 0) {
        await transact({ ...transaction, mode: 'apply', async assertWriteAuthorized() {
          await databaseWriter.assertAuthorized();
          await assertConnection();
          await journal.append(submissionEvent, submission, { expectedPreviousHash: records.at(-1)?.recordHash ?? null });
        } });
      }
      const result = await transact({ ...transaction, mode: 'readback' });
      check(result.state === 'recovered', 'ORIGINAL_SUBMISSION_REVIEW_REQUIRED');
      return { passed: true, manifestHash, backwardCompatible: true,
        completedOperations: [{ operationId, evidenceDigest: result.evidenceDigest, verified: true, intentRecorded: true }],
        database: { destructiveRollback: false, readbackVerified: true, schemaDigest: result.schemaDigest } };
    } finally {
      await db.end();
    }
  };
}
