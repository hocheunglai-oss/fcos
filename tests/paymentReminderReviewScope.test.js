import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { paymentReminderPreparationFingerprint } from '../api/_paymentReminderOperations.js';
import { paymentReminderCurrencyTotal, paymentReminderMoney } from '../api/_paymentReminderCurrency.js';

const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
function sourceFunction(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const remaining = source.slice(start);
  const end = remaining.slice(1).search(/\n(?:async )?function \w+\(/);
  return end < 0 ? remaining : remaining.slice(0, end + 1);
}

test('the email builder uses native currency in the template, HTML and plain text', () => {
  const context = vm.createContext({
    paymentReminderCurrencyTotal, paymentReminderMoney,
    paymentReminderRoutingForRows: () => ({ groups: [] }),
    paymentReminderRecipients: () => [], uniqueTextList: () => [], uniqueEmailList: () => [],
    overdueEmailStyles: () => ({}), escapeHtml: String, prettyDate: String, overdueDisplayValue: () => '',
    paymentReminderContentHtml: (value) => value, insertInvoiceTable: (body, table) => body + table,
    hasHtmlMarkup: () => false,
  });
  for (const name of ['paymentReminderDisplayCurrency', 'paymentReminderTemplateContext', 'renderPaymentReminderTemplate', 'buildBuyerInvoicePaymentReminderEmail']) {
    vm.runInContext(sourceFunction(name), context);
  }
  const hkd = { stemName: 'HKD STEM', currency: 'HKD', invoiceAmount: 7800, receivableBalance: 3900,
    nativeCurrencyEvidence: { invoices: [] } };
  const usd = { stemName: 'USD STEM', currency: 'HKD', invoiceAmount: 100, receivableBalance: 50 };
  const email = context.buildBuyerInvoicePaymentReminderEmail({ daysAhead: 7 }, {
    paymentReminderSubject: 'Outstanding {{totalReceivable}}', paymentReminderBody: 'Balance {{receivableBalance}}',
  }, hkd, [hkd, usd]);
  assert.match(email.subject, /HKD 3,900\.00 \/ USD 50\.00/);
  assert.match(email.html, /HKD 7,800\.00/);
  assert.match(email.html, /\$100\.00/);
  assert.match(email.text, /Balance HKD 3,900\.00/);
  assert.match(email.text, /Receivable Balance HKD 3,900\.00/);
  assert.match(email.text, /Receivable Balance \$50\.00/);
});

test('legacy USD preparation preserves the previously issued fingerprint format', () => {
  const fingerprint = paymentReminderPreparationFingerprint({
    settingsRevision: 3,
    candidates: [
      { stemId: 'stem-B', lastModifiedAt: '2026-01-02T00:00:00Z', paymentReminderEligible: true },
      { stemId: 'stem-A', paymentReminderEligible: false, reminderRuleRevision: 2 },
    ],
    preparedGroups: [{ key: 'buyer', stemIds: ['stem-B', 'stem-A'],
      to: ['Buyer@example.com', 'buyer@example.com'], cc: ['CC@example.com'], bcc: [] }],
  });
  assert.equal(fingerprint, 'eac201be64ba3164b8ea416ba6c18dc286adf333d956a19208f58d442e97696e');
});

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
    nativeScopes: [],
  };
  const emails = (...values) => values.flat().filter(Boolean);
  const context = vm.createContext({
    paymentReminderPreparationFingerprint,
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
    loadPaymentReminderCurrencies: async (rows) => {
      state.nativeScopes.push(rows.map((row) => row.stemId));
      return rows;
    },
    buyerReminderCandidateByAccount: (row) => row.buyerName === 'Buyer',
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
  for (const name of ['loadBuyerInvoicePaymentReminderContext', 'preparePaymentReminderRouting', 'paymentReminderConflictDetails', 'publicPaymentReminderCandidate', 'buyerInvoicePaymentReminderPrepare', 'buyerInvoicePaymentReminderSend']) {
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

test('native preview exposes the reviewed currency and amounts without private source evidence', async () => {
  const h = harness();
  Object.assign(h.state.rows[0], { currency: 'HKD', receivableBalance: 3900,
    accountingReceivableUsd: 500, nativeCurrencyEvidence: { invoices: [{ rateRevision: 'private' }] } });
  const preview = await h.prepare();
  assert.equal(preview.selected.currency, 'HKD');
  assert.equal(preview.selected.receivableBalance, 3900);
  assert.equal(preview.selected.accountingReceivableUsd, 500);
  assert.equal(preview.selected.reminderCurrencyVerified, true);
  assert.equal(preview.candidates[1].reminderCurrencyVerified, undefined);
  assert.ok([preview.selected, ...preview.candidates].every((row) => !Object.hasOwn(row, 'nativeCurrencyEvidence')));
});

test('currency evidence is read for the same complete buyer scope on preview and send', async () => {
  const h = harness();
  h.state.rows.push({ ...h.state.rows[0], stemId: 'a012x0000000004AAA', buyerName: 'Another buyer' });
  const preview = await h.prepare();
  await h.send(preview, [h.stemA]);
  assert.deepEqual(h.state.nativeScopes.map((scope) => [...scope]), [
    [h.stemA, h.stemB, h.stemC],
    [h.stemA, h.stemB, h.stemC],
  ]);
});

for (const [label, change] of [
  ['Salesforce changes', (h) => { h.state.rows[0].lastModifiedAt = '2026-09-10T01:00:00Z'; }],
  ['recipient changes', (h) => { h.state.recipient = 'new@example.com'; }],
  ['settings changes', (h) => { h.state.settingsRevision += 1; }],
  ['rule changes', (h) => { h.state.rows[0].reminderRuleRevision += 1; }],
  ['candidate removal', (h) => { h.state.rows.pop(); }],
  ['native currency changes', (h) => { h.state.rows[0].nativeCurrencyEvidence = { invoices: [{ rateRevision: 'changed' }] }; }],
]) {
  test(`real ${label} still block delivery after review`, async () => {
    const h = harness();
    const preview = await h.prepare();
    change(h);
    await assert.rejects(h.send(preview), { code: 'PAYMENT_REMINDER_REVIEW_STALE' });
    assert.equal(h.state.reservations.length, 0);
  });
}

test('a changed native balance alone invalidates the review before delivery reservation', async () => {
  const h = harness();
  Object.assign(h.state.rows[0], { currency: 'HKD', receivableBalance: 3900,
    nativeCurrencyEvidence: { invoices: [{ rateRevision: 'unchanged' }] } });
  const preview = await h.prepare();
  h.state.rows[0].receivableBalance -= 0.01;
  await assert.rejects(h.send(preview), { code: 'PAYMENT_REMINDER_REVIEW_STALE' });
  assert.equal(h.state.reservations.length, 0);
});
