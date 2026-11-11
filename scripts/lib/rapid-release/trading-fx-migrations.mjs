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
    digest: '3fd57d66df4a0fc140a16250ac650f5cfbc03526b05078170cdd70b79396154f',
  },
  {
    path: 'supabase/migrations/20261111180146_xero_prepayment_operation_ledger.sql',
    digest: '08a8dc2d42d223d369c4e201ebaf7e57561510f74850cb085c21e6f56cabcc6c',
  },
  {
    path: 'supabase/migrations/20261111180148_xero_prepayment_posting_policy.sql',
    digest: '29d9f510f6cb269dc0b7433c419bb6521344c5e665c127790e790ec97b51a57d',
  },
  {
    path: 'supabase/migrations/20261111180149_xero_native_hkd_atomic_payment_confirmation.sql',
    digest: 'a48e438633fc083af97c2563c01f7ddffc4f82cd544a9c42fbeb1fac35ce27f7',
  },
  {
    path: 'supabase/migrations/20261111201838_xero_native_document_draft_journal.sql',
    digest: 'eed5b935e0af9d38ed679d588da10dcc1abfa9285c77cd2b55dbd778d9ac1ac4',
    transactionEnvelope: true,
  },
].map(Object.freeze));
