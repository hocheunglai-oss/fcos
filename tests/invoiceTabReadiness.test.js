import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function createTab({ readiness = async () => ({ ready: true }), reminder = async () => 'Reminder sent' } = {}) {
  const source = await readFile(new URL('../force-app/main/default/lwc/fcbStemProcessing/fcbStemProcessing.js', import.meta.url), 'utf8');
  const methods = source.slice(source.indexOf('  invoiceReadiness = null;'), source.indexOf('  createInvoiceDisabled = true;'));
  const Tab = new Function('getBuyerInvoiceTabReadiness', 'sendBuyerChargeReminder', 'getErrorMessage', 'PROFORMA_INVOICE_LABEL', `return class { ${methods} }`)(readiness, reminder, error => error.body?.message || error.message, 'Create Proforma Invoice');
  const tab = new Tab();
  Object.assign(tab, { recordId: 'stem', selectedProducts: [{ total: 10 }], invoiceButtonLabel: 'Create Invoice', createInvoiceDisabled: false, disabledLastInvoiceForm: false });
  return tab;
}

test('final invoice actions fail closed while proforma and credit actions retain existing gates', async () => {
  const tab = await createTab();
  assert.equal(tab.invoiceActionDisabled, true);
  assert.equal(tab.lastInvoiceActionDisabled, true);
  tab.invoiceReadiness = { ready: false, reason: 'approval needed', pendingBuyerApproval: true };
  assert.equal(tab.showReminder, true);
  tab.invoiceButtonLabel = 'Create Proforma Invoice';
  assert.equal(tab.invoiceActionDisabled, false);
  tab.invoiceButtonLabel = 'Create Invoice';
  tab.selectedProducts = [{ total: -1 }];
  assert.equal(tab.invoiceActionDisabled, false);
  tab.createInvoiceDisabled = true;
  assert.equal(tab.invoiceActionDisabled, true);
});

test('reminder serializes requests and reuses its key after an uncertain failure', async () => {
  let rejectFirst;
  const requests = [];
  const tab = await createTab({ reminder: request => {
    requests.push(request);
    if (requests.length === 1) return new Promise((resolve, reject) => { rejectFirst = reject; });
    return Promise.resolve('Reminder sent');
  } });
  const first = tab.handleTraderReminder();
  await tab.handleTraderReminder();
  assert.equal(requests.length, 1);
  rejectFirst({ body: { message: 'Assignment unavailable' } });
  await first;
  assert.equal(tab.reminderResult, 'Assignment unavailable');
  await tab.handleTraderReminder();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(tab.reminderResult, 'Reminder sent');
  assert.equal(tab.reminderRequestId, null);
});

test('late readiness response cannot overwrite a newer result', async () => {
  let resolveOld;
  let count = 0;
  const tab = await createTab({ readiness: () => ++count === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ ready: false, reason: 'new blocker' }) });
  const old = tab.refreshInvoiceReadiness();
  await tab.refreshInvoiceReadiness();
  resolveOld({ ready: true });
  assert.equal(await old, null);
  assert.equal(tab.invoiceReadiness.reason, 'new blocker');
});
