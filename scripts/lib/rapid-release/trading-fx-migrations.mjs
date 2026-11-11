// Exact ordered package from the reviewed Trading FX application source.
// The two files with standalone transaction wrappers are still hashed and
// journaled in full. Their reviewed bodies run under the controller lock.
export const TRADING_FX_MIGRATIONS = Object.freeze([
  {
    path: 'supabase/migrations/20261111180108_xero_financial_currency_evidence.sql',
    digest: '7fedb40aee1197a63fc8268e07c4337d0b222bb8774c566a390b5b5caf868abb',
    transactionEnvelope: true,
  },
  {
    path: 'supabase/migrations/20261111180144_xero_credit_allocation_ledger.sql',
    digest: '76818912cd9f6f24a7e11a4995407c6bd228dd40de51b62604d4c59fbe5134e7',
  },
  {
    path: 'supabase/migrations/20261111180145_xero_rounding_policy.sql',
    digest: 'e085affa0e95868bbf9b8a8ba94f8425270ba7e4daecef98682bcc478763c160',
  },
  {
    path: 'supabase/migrations/20261111180146_xero_prepayment_operation_ledger.sql',
    digest: '02239afa40c13c3ed007b7ac58921658a8715d374bcfcde47dab11ccb1326120',
  },
  {
    path: 'supabase/migrations/20261111180148_xero_prepayment_posting_policy.sql',
    digest: 'e6dbe4932886bfaaea94fb3d1a976d9a53dea5f2ae197c575cfb8a84810d8750',
  },
  {
    path: 'supabase/migrations/20261111180149_xero_native_hkd_atomic_payment_confirmation.sql',
    digest: 'a48e438633fc083af97c2563c01f7ddffc4f82cd544a9c42fbeb1fac35ce27f7',
  },
  {
    path: 'supabase/migrations/20261111201838_xero_native_document_draft_journal.sql',
    digest: '07a0c7e3ac9877e0350f3f51c92f6b100ea71be2eb015f3be1cba835a21db57e',
    transactionEnvelope: true,
  },
].map(Object.freeze));
