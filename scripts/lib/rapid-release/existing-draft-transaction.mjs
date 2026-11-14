import { readExistingDraftCatalog } from './existing-draft-catalog.mjs';
import { runReviewedMigrationTransaction } from './reviewed-migration-transaction.mjs';

export const EXISTING_DRAFT_MIGRATIONS = Object.freeze([
  Object.freeze({
    path: 'supabase/migrations/20261114053200_xero_existing_draft_status_authorisation_v1.sql',
    digest: '2016244b462ad574624a9322cd84028b81ff7a877ed02be1f4f588ed16e23572',
  }),
  Object.freeze({
    path: 'supabase/migrations/20261114053201_xero_existing_draft_quota_exception_v1.sql',
    digest: '70797689fe602281e6b96b7c6d50bc52fcea729380ff7051e6356f9cfed5d3e9',
    transactionEnvelope: true,
  }),
]);

export function runExistingDraftTransaction(input) {
  return runReviewedMigrationTransaction(input, {
    reviewedMigrations: EXISTING_DRAFT_MIGRATIONS,
    readCatalog: readExistingDraftCatalog,
    errorPrefix: 'EXISTING_DRAFT',
  });
}
