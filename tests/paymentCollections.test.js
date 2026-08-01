import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buyerReminderEligibility } from '../api/_buyerInvoiceReminderRules.js';

const migrationUrl = new URL('../supabase/migrations/20260731175320_personalized_navigation_payment_collections.sql', import.meta.url);

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

test('collection migration preserves history and installs service-only personalized navigation', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /create table if not exists public\.user_navigation_preferences/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.user_navigation_preferences from anon, authenticated/);
  assert.match(migration, /grant all on table public\.user_navigation_preferences to service_role/);
  assert.match(migration, /when 'Not Started' then 'To Contact'/);
  assert.match(migration, /when 'Reminder Sent' then 'Awaiting Buyer'/);
  assert.match(migration, /'Payment Advice Received'/);
  assert.match(migration, /'payment_advice'/);
  assert.match(migration, /payment_pending_posting/);
  assert.match(migration, /advice_document_ids jsonb/);
  assert.match(migration, /save_user_navigation_preferences/);
});

test('FCOS exposes fixed personal, trading and tools navigation with user customization', async () => {
  const [layout, app] = await Promise.all([
    readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(layout, /label: 'Personal'/);
  assert.match(layout, /label: 'Trading'/);
  assert.match(layout, /label: 'Tools'/);
  assert.match(layout, /hiddenItemIds: \['review', 'pnl', 'report_archive'\]/);
  assert.match(layout, /DragDropContext/);
  assert.match(layout, /navigationPreferencesSave/);
  assert.match(app, /path="\/payment-collections"/);
  assert.match(app, /RedirectWithTab path="\/payment-collections" tab="collections"/);
  assert.match(app, /RedirectWithSection section="users"/);
});

test('Payment Collections connects queue, incoming payments and reconciliation with structured advice evidence', async () => {
  const [workspace, buyerPage, server] = await Promise.all([
    readFile(new URL('../src/pages/PaymentCollections.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /Collection Queue/);
  assert.match(workspace, /Incoming Payments/);
  assert.match(workspace, /Reconciliation Exceptions/);
  assert.match(buyerPage, /Payment Advice Received/);
  assert.match(buyerPage, /adviceReceivedDate/);
  assert.match(buyerPage, /adviceVerificationDate/);
  assert.match(buyerPage, /Drop payment advice here/);
  assert.match(server, /async function buyerInvoicePaymentAdviceSave/);
  assert.match(server, /Payment Collections requires STEM__c\.Receivable_Balance__c/);
  assert.match(server, /eventType: 'auto_closed'/);
  assert.match(server, /eventType: 'auto_reopened'/);
  assert.match(server, /payment_pending_posting/);
  assert.match(server, /changed after they were opened[\s\S]*409/);
});
