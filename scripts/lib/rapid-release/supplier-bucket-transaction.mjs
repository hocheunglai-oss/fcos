import { readSupplierBucketCatalog, SUPPLIER_BUCKET_MIGRATIONS } from './supplier-bucket-catalog.mjs';
import { runReviewedMigrationTransaction } from './reviewed-migration-transaction.mjs';

export function runSupplierBucketTransaction(input) {
  return runReviewedMigrationTransaction(input, {
    reviewedMigrations: SUPPLIER_BUCKET_MIGRATIONS, readCatalog: readSupplierBucketCatalog, errorPrefix: 'SUPPLIER_BUCKET',
  });
}
