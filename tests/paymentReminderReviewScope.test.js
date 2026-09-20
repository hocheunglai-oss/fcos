import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
function sourceFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const remaining = source.slice(start);
  const end = remaining.slice(1).search(/\n(?:async )?function \w+\(/);
  return end < 0 ? remaining : remaining.slice(0, end + 1);
}

function harness() {
  const stemA = 'a012x0000000001AAA';
  const stemB = 'a012x0000000002AAA';
  const stemC = 'a012x0000000003AAA';
  const state = {
    rows: [stemA, stemB, stemC].map((stemId, index) => ({
      stemId, stemName: `STEM ${index}`, buyerName: 'Buyer', buyerInvoiceDueDate: '2026-09-01',
      lastModifiedAt: '2026-09-10T00:00:00Z', paymentReminderEligible: index !== 2,
      reminderRuleRevision: 1,
    })),
    settingsRevision: 1,
    recipient: 'buyer@example.com',
    reservations: [],
    scopes: [],
  };
  const emails = (...values) => values.flat().filter(Boolean);
  const context = vm.createContext({
    createHash,
    isSalesforceId: (value) => /^[a-zA-Z0-9]{18}$/.test(value),
    requireInterofficeStemAccess: async () => {},
    resolveGraphEmailSender: async () => ({}),
    loadStoredBuyerInvoiceEmailSettings: async () => ({
      settings: { daysAhead: 7, paymentReminderSubject: 'Reminder', paymentReminderBody: 'Please pay' },
      meta: { storageAvailable: true, revision: state.settingsRevision },
    }),
    buyerInvoiceEmailSettings: (settings) => settings,
    salesforceBuyerInvoicesDueTargeted: async (body) => {
      state.scopes.push(body);
      const ids = body.requestedStemIds || body.invoiceStemIds;
      return { paymentReminderRulesAvailable: true, rows: ids?.length ? state.rows.filter((row) => ids.includes(row.stemId)) : state.rows };
    },
    buyerReminderCandidateByAccount: () => true,
    uniqueEmailList: emails,
    paymentReminderRoutingForRows: (rows) => ({
      to: [state.recipient], warnings: [],
      groups: [{ key: 'buyer', rows, to: [state.recipient], cc: [], bcc: [] }],
    }),
    paymentReminderTemplateContext: () => ({}),
    renderPaymentReminderEmailList: () => [],
    buildBuyerInvoicePaymentReminderEmail: () => ({ html: 'Preview', text: 'Preview' }),
    paymentReminderPreviewSecret: () => 'test-secret',
    signPaymentReminderPreview: (preview) => preview,
    verifyPaymentReminderPreview: (preview) => preview,
    serverEmailDeliveryStatus: () => ({ hasServerProvider: true }),
    reconcileBuyerInvoiceCollections: async () => {},
    evaluateBuyerReminderSelection: (rows, ids) => ({
      rows: rows.filter((row) => ids.includes(row.stemId)),
      unknownStemIds: ids.filter((id) => !rows.some((row) => row.stemId === id)),
      restrictedRows: rows.filter((row) => ids.includes(row.stemId) && !row.paymentReminderEligible),
    }),
    paymentReminderRequestHash: () => 'request-hash',
    reservePaymentReminderOperation: async (_client, input) => {
      state.reservations.push(input);
      // Stop at the delivery boundary. No Graph/email tools are present in this harness.
      return { replay: true, result: {} };
    },
    appError: (message, status, code) => Object.assign(new Error(message), { status, code }),
  });
  for (const name of ['loadBuyerInvoicePaymentReminderContext', 'preparePaymentReminderRouting', 'paymentReminderPreparationFingerprint', 'paymentReminderConflictDetails', 'buyerInvoicePaymentReminderPrepare', 'buyerInvoicePaymentReminderSend']) {
    vm.runInContext(sourceFunction(name), context);
  }
  const access = { client: {}, profile: { id: 'user', email: 'user@example.com' } };
  return {
    state, stemA, stemB, stemC,
    prepare: () => context.buyerInvoicePaymentReminderPrepare({ stemId: stemA, daysAhead: 7 }, null, access),
    send: (preview, selectedIds = [stemA]) => context.buyerInvoicePaymentReminderSend({
      stemId: stemA, daysAhead: 7, invoiceStemIds: selectedIds,
      previewToken: preview.previewToken, idempotencyKey: 'test-payment-reminder-operation',
      recipientBatches: [{ key: 'buyer', to: 'buyer@example.com' }],
    }, null, access),
  };
}

test('sending a subset compares the complete reviewed buyer scope, including restricted candidates', async () => {
  const h = harness();
  const preview = await h.prepare();
  assert.equal(preview.candidates.length, 3);
  await h.send(preview);
  assert.equal(h.state.reservations.length, 1);
  assert.deepEqual([...h.state.reservations[0].selectedStemIds], [h.stemA]);
  assert.equal(h.state.scopes[1].requestedStemIds.length, 0);
});

test('selecting all eligible invoices does not conflict with an unselected restricted candidate', async () => {
  const h = harness();
  await h.send(await h.prepare(), [h.stemA, h.stemB]);
  assert.equal(h.state.reservations.length, 1);
});

for (const [label, change] of [
  ['Salesforce changes', (h) => { h.state.rows[0].lastModifiedAt = '2026-09-10T01:00:00Z'; }],
  ['recipient changes', (h) => { h.state.recipient = 'new@example.com'; }],
  ['settings changes', (h) => { h.state.settingsRevision += 1; }],
  ['rule changes', (h) => { h.state.rows[0].reminderRuleRevision += 1; }],
  ['candidate removal', (h) => { h.state.rows.pop(); }],
]) {
  test(`real ${label} still block delivery after review`, async () => {
    const h = harness();
    const preview = await h.prepare();
    change(h);
    await assert.rejects(h.send(preview), { code: 'PAYMENT_REMINDER_REVIEW_STALE' });
    assert.equal(h.state.reservations.length, 0);
  });
}
