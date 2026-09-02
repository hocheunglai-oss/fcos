import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  PAYMENT_REMINDER_PREVIEW_TTL_MS,
  mapPaymentReminderBatches,
  paymentReminderBatchHash,
  paymentReminderDeliveryUncertain,
  paymentReminderRequestHash,
  signPaymentReminderPreview,
  verifyPaymentReminderPreview,
} from '../api/_paymentReminderOperations.js';

const secret = 'payment-reminder-preview-secret-for-tests-123456';
const stemA = 'a012x0000000001AAA';
const stemB = 'a012x0000000002AAA';

test('five-minute payment reminder previews are signed, bound, and expire', () => {
  const payload = { anchorStemId: stemA, candidateStemIds: [stemA, stemB], preparationHash: 'a'.repeat(64), settingsRevision: 4 };
  const token = signPaymentReminderPreview(payload, secret, 10_000);
  assert.deepEqual(verifyPaymentReminderPreview(token, secret, 10_001), {
    ...payload,
    issuedAt: 10_000,
    expiresAt: 10_000 + PAYMENT_REMINDER_PREVIEW_TTL_MS,
  });
  assert.throws(() => verifyPaymentReminderPreview(`${token}x`, secret, 10_001), /invalid/i);
  assert.throws(() => verifyPaymentReminderPreview(token, secret, 10_000 + PAYMENT_REMINDER_PREVIEW_TTL_MS), /expired/i);
});

test('operation hashes are stable across harmless recipient and selection ordering', () => {
  const left = paymentReminderRequestHash({
    anchorStemId: stemA,
    invoiceStemIds: [stemB, stemA],
    recipientBatches: [{ key: 'group', stemIds: [stemB, stemA], to: 'Buyer@Example.com; accounts@example.com', cc: '', bcc: '' }],
    subject: 'Reminder',
    body: '<p>Body</p>',
  });
  const right = paymentReminderRequestHash({
    anchorStemId: stemA,
    invoiceStemIds: [stemA, stemB],
    recipientBatches: [{ key: 'group', stemIds: [stemA, stemB], to: ['accounts@example.com', 'buyer@example.com'], cc: [], bcc: [] }],
    subject: 'Reminder',
    body: '<p>Body</p>',
  });
  assert.equal(left, right);
  assert.notEqual(left, paymentReminderRequestHash({
    anchorStemId: stemA,
    invoiceStemIds: [stemA, stemB],
    recipientBatches: [{ key: 'group', stemIds: [stemA, stemB], to: ['different@example.com'] }],
    subject: 'Reminder',
    body: '<p>Body</p>',
  }));
  assert.match(paymentReminderBatchHash({ key: 'group', stemIds: [stemA], to: ['buyer@example.com'] }, { subject: 'Reminder', body: 'Body' }), /^[a-f0-9]{64}$/);
});

test('only uncertain Graph outcomes are protected from automatic retry', () => {
  assert.equal(paymentReminderDeliveryUncertain({ code: 'MICROSOFT_GRAPH_SEND_UNCERTAIN' }), true);
  assert.equal(paymentReminderDeliveryUncertain({ mailDeliveryUncertain: true }), true);
  assert.equal(paymentReminderDeliveryUncertain({ code: 'MICROSOFT_GRAPH_RECIPIENT_REJECTED' }), false);
});

test('independent reminder batches run with a hard concurrency limit of three', async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapPaymentReminderBatches([0, 1, 2, 3, 4, 5], async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximumActive, 3);
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10]);
});

test('operation ledger and repair functions are service-only, RLS protected, and redacted', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260815165720_fast_verified_payment_reminders.sql', import.meta.url), 'utf8');
  const advisorSql = await readFile(new URL('../supabase/migrations/20260815172712_fast_verified_payment_reminders_advisor_index.sql', import.meta.url), 'utf8');
  assert.match(sql, /buyer_invoice_payment_reminder_operations[\s\S]*enable row level security/i);
  assert.match(sql, /buyer_invoice_payment_reminder_batches[\s\S]*enable row level security/i);
  assert.match(sql, /revoke all on table public\.buyer_invoice_payment_reminder_operations from public, anon, authenticated/i);
  assert.match(sql, /security invoker/ig);
  assert.match(sql, /reserve_buyer_invoice_payment_reminder_operation/i);
  assert.match(sql, /save_buyer_invoice_payment_reminder_timeline/i);
  assert.match(sql, /repair_buyer_invoice_payment_reminder_timelines/i);
  assert.doesNotMatch(sql, /message_body|recipient_email|recipient_address/i);
  assert.match(advisorSql, /buyer_invoice_payment_reminder_operations\(actor_user_id\)[\s\S]*actor_user_id is not null/i);
});

test('server send path is scoped, signed, idempotent, bounded, and atomic', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const contextStart = source.indexOf('async function loadBuyerInvoicePaymentReminderContext');
  const contextEnd = source.indexOf('\nasync function buyerInvoicePaymentReminderPrepare', contextStart);
  const contextSource = source.slice(contextStart, contextEnd);
  assert.match(contextSource, /salesforceBuyerInvoicesDueTargeted/);
  assert.doesNotMatch(contextSource, /salesforceBuyerInvoicesDue\s*\(/);
  assert.match(source, /signPaymentReminderPreview/);
  assert.match(source, /verifyPaymentReminderPreview/);
  assert.match(source, /reservePaymentReminderOperation/);
  assert.match(source, /mapPaymentReminderBatches\(outboundBatches,[\s\S]*\}, 3\)/);
  assert.match(source, /savePaymentReminderTimeline/);
  assert.match(source, /repairPaymentReminderTimelines\(client, 50\)/);
  assert.doesNotMatch(source, /Payment reminder sent to \$\{item\.to\.join/);
});

test('payment reminder UI is one review surface with one final send action', async () => {
  const source = await readFile(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /PAYMENT_REMINDER_STEPS|currentStep|>Next<|>Back</);
  assert.match(source, /Verifying live Salesforce balances/);
  assert.match(source, /Edit recipients/);
  assert.match(source, /Edit message/);
  assert.match(source, /previewToken: data\.previewToken/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /invalidateCache\(\{ names: \['salesforceBuyerInvoicesDue', 'buyerInvoiceCollectionList', 'paymentCollectionsReconcile'\]/);
  assert.doesNotMatch(source.slice(source.indexOf('function PaymentReminderModal'), source.indexOf('function CopyInvoiceSelectionModal')), /clearCache\(\)/);
});
