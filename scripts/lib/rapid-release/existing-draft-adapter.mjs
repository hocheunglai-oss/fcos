import { requireCondition } from './contract.mjs';
import { EXISTING_DRAFT_MIGRATIONS, runExistingDraftTransaction } from './existing-draft-transaction.mjs';
import { reviewedMigrationAdapter } from './reviewed-migration-adapter.mjs';

const apply = reviewedMigrationAdapter({
  migrations: EXISTING_DRAFT_MIGRATIONS,
  workflowPaths: ['api/_xeroExistingDraftAuthorisation.js', 'src/components/xero/XeroExistingDraftAuthorisationPanel.jsx'],
  transactMigration: runExistingDraftTransaction,
  errorPrefix: 'EXISTING_DRAFT',
  credentialsPrefix: 'EXISTING_DRAFT',
  purpose: 'rapid_existing_draft_prerequisite',
});

export function applyReviewedPrerequisites(input) {
  requireCondition(input.plan?.deferSchemaDependentSmoke === undefined, 'EXISTING_DRAFT_FULL_STAGE_REQUIRED');
  return apply(input);
}
