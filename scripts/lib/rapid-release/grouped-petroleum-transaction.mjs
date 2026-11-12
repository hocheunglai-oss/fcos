import { GROUPED_PETROLEUM_MIGRATIONS, readGroupedPetroleumCatalog } from './grouped-petroleum-catalog.mjs';
import { runReviewedMigrationTransaction } from './reviewed-migration-transaction.mjs';

export function runGroupedPetroleumTransaction(input) {
  return runReviewedMigrationTransaction(input, {
    reviewedMigrations: GROUPED_PETROLEUM_MIGRATIONS, readCatalog: readGroupedPetroleumCatalog, errorPrefix: 'GROUPED_PETROLEUM',
  });
}
