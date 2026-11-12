import { reviewedMigrationAdapter } from './reviewed-migration-adapter.mjs';
import { SUPPLIER_BUCKET_MIGRATIONS } from './supplier-bucket-catalog.mjs';
import { runSupplierBucketTransaction } from './supplier-bucket-transaction.mjs';

export const applyReviewedPrerequisites = reviewedMigrationAdapter({
  migrations: SUPPLIER_BUCKET_MIGRATIONS, workflowPaths: ['api/_xeroSupplierFinancialBucketWorkflow.js'],
  transactMigration: runSupplierBucketTransaction, errorPrefix: 'SUPPLIER_BUCKET', credentialsPrefix: 'SUPPLIER_BUCKET',
  purpose: 'rapid_supplier_bucket_prerequisite',
});
