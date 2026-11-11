import { reviewedMigrationAdapter } from './reviewed-migration-adapter.mjs';
import { GROUPED_PETROLEUM_MIGRATIONS } from './grouped-petroleum-catalog.mjs';
import { runGroupedPetroleumTransaction } from './grouped-petroleum-transaction.mjs';

export const applyReviewedPrerequisites = reviewedMigrationAdapter({
  migrations: GROUPED_PETROLEUM_MIGRATIONS,
  workflowPaths: ['api/_xeroIssuedGroupedPetroleumScope.js', 'api/_xeroIssuedSupplierWorkflow.js'],
  transactMigration: runGroupedPetroleumTransaction, errorPrefix: 'GROUPED_PETROLEUM', credentialsPrefix: 'GROUPED_PETROLEUM',
  purpose: 'rapid_grouped_petroleum_prerequisite',
});
