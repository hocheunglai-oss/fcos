import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buyerReminderEligibility } from '../api/_buyerInvoiceReminderRules.js';
import {
  hasPaymentCollectionDispute,
  matchesPaymentCollectionDisputeFilter,
  paymentCollectionDisputeState,
} from '../src/lib/paymentCollectionDisputes.js';

const migrationUrl = new URL('../supabase/migrations/20260731175320_personalized_navigation_payment_collections.sql', import.meta.url);
const postingMigrationUrl = new URL('../supabase/migrations/20260802154311_payment_collection_posting_reconciliation.sql', import.meta.url);

test('payment advice pauses reminders until verification and settlement always blocks reminders', () => {
  const baseRow = {
    buyerAccountId: '0012x00000ABCDE',
    buyerBrokerRoutingMode: 'buyer_only',
    daysUntilDue: -10,
  };
  const standardRule = { policy: 'standard' };
  const pending = buyerReminderEligibility({ ...baseRow, collection: { status: 'Payment Advice Received', adviceVerificationDate: '2999-01-01' } }, standardRule, true);
  assert.equal(pending.eligible, false);
  assert.match(pending.blockingReason, /awaiting Salesforce posting/i);

  const expired = buyerReminderEligibility({ ...baseRow, collection: { status: 'Payment Advice Received', adviceVerificationDate: '2000-01-01' } }, standardRule, true);
  assert.equal(expired.eligible, true);

  const paid = buyerReminderEligibility({ ...baseRow, collection: { status: 'Paid / Closed' } }, standardRule, true);
  assert.equal(paid.eligible, false);
  assert.match(paid.blockingReason, /settled/i);
});

test('Payment Collections distinguishes active disputes, closed history, and unexpected statuses', () => {
  assert.equal(paymentCollectionDisputeState('No Dispute'), 'none');
  assert.equal(paymentCollectionDisputeState('No Disputes'), 'none');
  assert.equal(paymentCollectionDisputeState('Opened'), 'active');
  assert.equal(paymentCollectionDisputeState('Approved - Pending Accounting'), 'active');
  assert.equal(paymentCollectionDisputeState('Closed with Supplier only'), 'closed');
  assert.equal(paymentCollectionDisputeState('Unexpected Salesforce Value'), 'issue');
  assert.equal(hasPaymentCollectionDispute('Closed'), true);
  assert.equal(matchesPaymentCollectionDisputeFilter('Opened', 'with-dispute'), true);
  assert.equal(matchesPaymentCollectionDisputeFilter('No Dispute', 'no-dispute'), true);
});

test('collection migration preserves history and installs service-only personalized navigation', async () => {
  const [migration, postingMigration] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(postingMigrationUrl, 'utf8'),
  ]);
  assert.match(migration, /create table if not exists public\.user_navigation_preferences/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.user_navigation_preferences from anon, authenticated/);
  assert.match(migration, /grant all on table public\.user_navigation_preferences to service_role/);
  assert.match(migration, /when 'Not Started' then 'To Contact'/);
  assert.match(migration, /when 'Reminder Sent' then 'Awaiting Buyer'/);
  assert.match(migration, /'Payment Advice Received'/);
  assert.match(migration, /'payment_advice'/);
  assert.match(postingMigration, /payment_posting_pending/);
  assert.match(postingMigration, /payment_partially_posted/);
  assert.match(postingMigration, /payment_posting_mismatch/);
  assert.match(postingMigration, /payment_posting_overdue/);
  assert.match(postingMigration, /payment_reconciliation_snapshot jsonb/);
  assert.match(postingMigration, /posting_reminder_override_reason/);
  assert.match(postingMigration, /revoke all on table public\.buyer_invoice_collection_items from public, anon, authenticated/);
  assert.match(migration, /advice_document_ids jsonb/);
  assert.match(migration, /save_user_navigation_preferences/);
});

test('FCOS exposes fixed personal, trading, cross-functional, finance and tools navigation with user customization', async () => {
  const [layout, app, server] = await Promise.all([
    readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  ]);
  assert.match(layout, /label: 'Personal'/);
  assert.match(layout, /label: 'Trading'/);
  assert.match(layout, /label: 'Cross Functions'/);
  assert.match(layout, /label: 'Finance'/);
  assert.match(layout, /label: 'Tools'/);
  assert.match(layout, /id: 'trading'[\s\S]*workspaceNavigation\('dashboard'[\s\S]*workspaceNavigation\('buyers_administrator'/);
  assert.match(layout, /id: 'cross_functions'[\s\S]*workspaceNavigation\('payment_collections'[\s\S]*workspaceNavigation\('disputes'[\s\S]*workspaceNavigation\('unofficial_compensation'[\s\S]*workspaceNavigation\('brokers'/);
  assert.match(layout, /id: 'finance'[\s\S]*workspaceNavigation\('cashflow_forecast'/);
  assert.match(layout, /hiddenItemIds: \['review', 'pnl'\]/);
  assert.match(layout, /DragDropContext/);
  assert.match(layout, /navigationPreferencesSave/);
  assert.match(layout, /legacyTradingOrder/);
  assert.match(layout, /legacyTradingWasDefault/);
  assert.match(server, /cross_functions: \['payment_collections', 'disputes', 'unofficial_compensation', 'brokers'\]/);
  assert.match(server, /finance: \['cashflow_forecast'\]/);
  assert.match(server, /legacyTradingOrder/);
  assert.match(server, /legacyTradingWasDefault/);
  assert.match(app, /path="\/payment-collections"/);
  assert.match(app, /RedirectWithTab path="\/payment-collections" tab="collections"/);
  assert.match(app, /RedirectWithSection section="people"/);
});

test('Payment Collections connects queue, incoming payments and reconciliation with structured advice evidence', async () => {
  const [workspace, buyerPage, incomingPage, server] = await Promise.all([
    readFile(new URL('../src/pages/PaymentCollections.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/IncomingPayments.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /Collection Queue/);
  assert.match(workspace, /Incoming Payments/);
  assert.match(workspace, /Reconciliation Exceptions/);
  assert.match(buyerPage, /Payment Advice Received/);
  assert.match(buyerPage, /adviceReceivedDate/);
  assert.match(buyerPage, /adviceVerificationDate/);
  assert.match(buyerPage, /Drop payment advice here/);
  assert.match(buyerPage, /promisedAmount: row\.collection\?\.promisedAmount \?\? promiseAmountFromReceivable\(row\)/);
  assert.match(buyerPage, /status === 'Promise to Pay'[\s\S]*promisedAmount: current\.promisedAmount \|\| promiseAmountFromReceivable\(row\)/);
  assert.match(buyerPage, /Promised Amount[\s\S]*type="text" inputMode="decimal"/);
  assert.doesNotMatch(buyerPage, /Promised Amount[\s\S]{0,200}type="number"/);
  assert.match(buyerPage, /Dispute open/);
  assert.match(buyerPage, /Dispute history/);
  assert.match(buyerPage, /With dispute/);
  assert.match(buyerPage, /flex flex-wrap items-center gap-2[\s\S]{0,180}Buyer Trader \/ Payment Handler/);
  assert.match(buyerPage, /flex flex-wrap items-center gap-2[\s\S]{0,180}Collection Status/);
  assert.match(server, /async function buyerInvoicePaymentAdviceSave/);
  assert.match(server, /disputeStatus: stem\.Dispute_Status__c \|\| null/);
  assert.match(server, /Payment Collections requires STEM__c\.Receivable_Balance__c/);
  assert.match(server, /eventType: 'auto_closed'/);
  assert.match(server, /eventType: 'auto_reopened'/);
  assert.match(server, /payment_posting_pending/);
  assert.match(server, /async function buyerInvoicePostingReminderOverrideSave/);
  assert.match(workspace, /Previous balance/);
  assert.match(workspace, /Detected payments/);
  assert.match(workspace, /Allow reminder/);
  assert.match(server, /changed after they were opened[\s\S]*409/);
  assert.match(incomingPage, /try \{[\s\S]*await requestPayments[\s\S]*catch \(loadError\)[\s\S]*finally \{[\s\S]*setLoading\(false\)/);
  assert.match(incomingPage, /if \(!data\) void load\(\)/);
  assert.match(incomingPage, /htmlFor="incoming-payment-created-from"/);
  assert.match(incomingPage, /id="incoming-payment-created-from"/);
});

test('STEM details open only from explicit STEM-column links', async () => {
  const paths = [
    '../src/pages/BuyerInvoices.jsx',
    '../src/pages/CashflowForecast.jsx',
    '../src/pages/ReviewQueue.jsx',
    '../src/pages/DisputeWorkflow.jsx',
    '../src/pages/IncomingPayments.jsx',
    '../src/pages/PaymentCollections.jsx',
    '../src/pages/StemPnlReport.jsx',
    '../src/components/dashboard/PnlTable.jsx',
    '../src/components/brokers/BrokerRegisterTable.jsx',
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  const stemLink = await readFile(new URL('../src/components/common/StemDetailLink.jsx', import.meta.url), 'utf8');
  const reorderableTable = await readFile(new URL('../src/components/common/ReorderableDataTable.jsx', import.meta.url), 'utf8');

  for (const source of sources) {
    assert.match(source, /StemDetailLink/);
    assert.doesNotMatch(source, /<tr[^>]*onClick=\{[^}]*setSelectedStemId/);
    assert.doesNotMatch(source, /onRowClick/);
  }
  assert.match(stemLink, /aria-label={`Open STEM details for \$\{accessibleStemName\}`}/);
  assert.doesNotMatch(reorderableTable, /onRowClick/);
});
