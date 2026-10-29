import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildInvoicePaymentTerm,
  PARTIAL_CIA_AMOUNT_ERROR,
  PARTIAL_CIA_BALANCE_TERM_ERROR,
  PARTIAL_CIA_FORM_TERM_ERROR,
} from '../force-app/main/default/lwc/fcbInvoiceForm/invoicePaymentTerms.js';
import { buildInvoiceVesselText, normalizeInvoiceVesselText } from '../force-app/main/default/lwc/fcbInvoiceForm/invoiceVesselText.js';

const formUrl = new URL('../force-app/main/default/lwc/fcbInvoiceForm/fcbInvoiceForm.js', import.meta.url);
const balanceTerm = { Name: '30', Description__c: 'days after delivery' };
const expected = 'USD 125,000.50 BASIS CASH IN ADVANCE, BALANCE ON 30 DAYS AFTER DELIVERY';

function stem(overrides = {}) {
  return {
    KeyStem__c: 'HK-TEST', Partial_CIA__c: true, Partial_Lumpsum_Sell_At__c: 125000.5, Payment_Term__c: '30',
    Account__r: { Name: 'Test Buyer', Banking_Preference__c: 'DBS' },
    Vessel__c: 'vessel', Vessel__r: { Name: 'Test Vessel', IMO__c: '1234567' },
    Port__r: { Name: 'Test Port' }, Delivery_Date__c: '2026-09-28', Invoice_Due_Date__c: '2026-10-28',
    ...overrides,
  };
}

const products = [{ id: 'product-salesforce-id', total: 200000, productName: 'VLSFO', quantity: 400, unitOfMeasure: 'MT', unitSellAt: 500 }];

function savedForm(inputs = [{ id: 'saved-term', label: 'PAYMENT TERM', value: 'CASH IN ADVANCE' }]) {
  return {
    Id: 'saved-form', Attn__c: JSON.stringify({ label: 'ATTN', value: 'ACCOUNTS' }), Total__c: JSON.stringify({ name: 'TOTAL', amount: 200000 }),
    Products__c: JSON.stringify([{ id: products[0].id, name: 'VLSFO', quantity: '400 MT', unitPrice: 500, amount: 200000 }]),
    Inputs__c: JSON.stringify(inputs), Info_Text__c: 'CUSTOM INFO', Vessel_Text__c: 'M/V TEST VESSEL',
    Buyer_Name__c: 'TEST BUYER', Today_Date__c: '29/09/2026', Address__c: 'CUSTOM ADDRESS',
  };
}

async function loadForm(overrides = {}) {
  let source = await readFile(formUrl, 'utf8');
  source = source.replace(/^import .*;\r?$/gmu, '').replace(/@wire\([^)]*\)/gu, '').replaceAll('@api', '').replaceAll('@track', '')
    .replace('export default class FcbInvoiceForm', 'class FcbInvoiceForm').concat('\nreturn new FcbInvoiceForm();');
  const calls = { paymentTerms: [], invoices: [], pdfs: [], savedForms: [], tables: [] };
  const bank = { Beneficiary_Bank__c: 'BANK', Beneficiary__c: 'FCB', Account_No__c: '123' };
  class Pdf {
    internal = { pageSize: { width: 595 }, getFontSize: () => 8 };
    lastAutoTable = { finalY: 20 };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    text() {}
    line() {}
    autoTable(table) { calls.tables.push(table); }
    output() { return 'data:application/pdf;base64,TEST'; }
    getStringUnitWidth() { return 8; }
  }
  const mocks = {
    LightningElement: class {}, buildInvoicePaymentTerm, PARTIAL_CIA_BALANCE_TERM_ERROR, PARTIAL_CIA_FORM_TERM_ERROR,
    buildInvoiceVesselText, normalizeInvoiceVesselText,
    getStemInfo: async () => stem(),
    getPaymentTerm: async (request) => { calls.paymentTerms.push(request); return balanceTerm; },
    getDBSInfo: async () => bank, getUBSInfo: async () => bank,
    getVariableChargeInvoiceReadiness: async () => ({ ready: true, requiresVariableChargeReview: false }),
    loadScript: async () => {}, jsPDF: 'jsPDF', jspdfAutotable: 'autotable', pdfLib: 'pdfLib',
    createInvoice: async (request) => { calls.invoices.push(request); return { Id: 'new-invoice', Name: 'NEW INVOICE' }; },
    generateInvoicePDF: async (request) => { calls.pdfs.push(request); },
    upsertLastInvoiceForm: async (request) => { calls.savedForms.push(request); },
    fireEvent: () => {}, window: { jspdf: { jsPDF: Pdf } },
    ...overrides,
  };
  const component = new Function(...Object.keys(mocks), source)(...Object.values(mocks));
  component.addHeader = component.addText = component.addFooters = () => {};
  return { component, calls };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('partial CIA uses configured amount and selected term, independently of receipts and due date', () => {
  assert.equal(buildInvoicePaymentTerm(stem({ Payments__r: [{ Amount__c: 999, Date__c: '2000-01-01' }], Invoice_Due_Date__c: '2000-01-01' }), balanceTerm), expected);
  assert.equal(buildInvoicePaymentTerm(stem({ Partial_Lumpsum_Sell_At__c: '1234.567', Payment_Term__c: '45' }), { Name: '45', Description__c: 'days from invoice date' }), 'USD 1,234.57 BASIS CASH IN ADVANCE, BALANCE ON 45 DAYS FROM INVOICE DATE');
});

test('non-partial CIA retains description only and ordinary payment terms retain their existing wording', () => {
  assert.equal(buildInvoicePaymentTerm({ Partial_CIA__c: false }, { Name: 'CIA', Description__c: 'cash in advance' }), 'CASH IN ADVANCE');
  assert.equal(buildInvoicePaymentTerm({ Partial_CIA__c: false }, balanceTerm), '30 DAYS AFTER DELIVERY');
});

test('partial CIA rejects missing, nonpositive, nonfinite and malformed configured amounts', () => {
  for (const amount of [undefined, null, '', ' ', 0, -1, Infinity, -Infinity, NaN, 'not an amount', false, true, {}, []]) {
    assert.throws(() => buildInvoicePaymentTerm(stem({ Partial_Lumpsum_Sell_At__c: amount }), balanceTerm), { message: PARTIAL_CIA_AMOUNT_ERROR }, String(amount));
  }
});

test('partial CIA rejects missing, mismatched or CIA balance terms and incomplete descriptions', () => {
  for (const [selected, record] of [[null, balanceTerm], ['CIA', { Name: 'CIA', Description__c: 'cash in advance' }], ['30', null], ['30', { Name: 'CIA', Description__c: 'cash in advance' }], ['45', balanceTerm], ['30', { Name: '30' }], ['30', { Name: '', Description__c: 'days' }]]) {
    assert.throws(() => buildInvoicePaymentTerm(stem({ Payment_Term__c: selected }), record), { message: PARTIAL_CIA_BALANCE_TERM_ERROR });
  }
});

test('fresh buyer invoice and proforma render and save the approved partial CIA wording on a new invoice', async () => {
  for (const proforma of [false, true]) {
    const { component, calls } = await loadForm();
    await component.openModal('stem-id', products, proforma, true, null);
    const paymentInput = component.inputs.find(input => input.label === 'PAYMENT TERM');
    assert.equal(paymentInput.value, expected);
    assert.equal(paymentInput.isPaymentTermLocked, true);
    assert.equal(component.isGenerateDisabled, false);
    component.handleGeneratePDF();
    await flush();
    assert.equal(calls.invoices.length, 1);
    assert.equal(calls.invoices[0].createProforma, proforma);
    assert.equal(calls.pdfs[0].invoiceId, 'new-invoice');
    assert.ok(calls.tables.some(table => table.body?.some(row => row[0] === 'PAYMENT TERM' && row[1] === `: ${expected}`)));
    assert.equal(JSON.parse(calls.savedForms[0].lastInvoiceForm.Inputs__c).find(input => input.label === 'PAYMENT TERM').value, expected);
  }
});

test('reused partial CIA forms fetch the selected term and repair legacy, duplicate, hidden or absent payment rows while preserving other edits', async () => {
  for (const inputs of [
    [{ id: 'saved-term', label: 'PAYMENT TERM', value: 'CASH IN ADVANCE', isHidden: true }, { id: 'duplicate', label: 'payment term', value: 'OLD' }, { id: 'due-date', label: 'DUE DATE', value: 'CUSTOM DATE' }],
    [{ id: 'due-date', label: 'DUE DATE', value: 'CUSTOM DATE' }],
  ]) {
    const original = savedForm(inputs);
    const { component, calls } = await loadForm();
    await component.openModal('stem-id', products, false, true, original);
    assert.deepEqual(calls.paymentTerms, [{ paymentTerm: '30' }]);
    const terms = component.inputs.filter(input => input.label === 'PAYMENT TERM');
    assert.equal(terms.length, 1);
    assert.equal(terms[0].value, expected);
    assert.equal(terms[0].isHidden, false);
    assert.equal(component.inputs.find(input => input.id === 'due-date').value, 'CUSTOM DATE');
    assert.equal(component.infoText, 'CUSTOM INFO');
    assert.equal(component.isGenerateDisabled, false);
    assert.equal(original.Inputs__c, JSON.stringify(inputs));
  }
});

test('partial CIA payment row resists edits/removal, and tampering or added duplicate terms visibly blocks generation', async () => {
  const { component, calls } = await loadForm();
  await component.openModal('stem-id', products, true, true, savedForm());
  const paymentInput = component.inputs.find(input => input.label === 'PAYMENT TERM');
  const event = { target: { dataset: { id: paymentInput.id } }, detail: { value: 'OLD CASH IN ADVANCE' } };
  component.handleChangeInputLabel(event);
  component.handleChangeInputValue(event);
  component.removeInput(event);
  assert.equal(component.inputs.find(input => input.id === paymentInput.id).value, expected);
  paymentInput.value = 'OLD CASH IN ADVANCE';
  assert.equal(component.invoiceFormError, PARTIAL_CIA_FORM_TERM_ERROR);
  component.handleGeneratePDF();
  assert.equal(calls.invoices.length, 0);
  assert.equal(calls.tables.length, 0);
  assert.equal(paymentInput.value, 'OLD CASH IN ADVANCE');
  paymentInput.value = expected;
  component.inputs.push({ id: 'custom-term', label: 'PAYMENT TERM', value: 'OLD TERMS' });
  assert.equal(component.isGenerateDisabled, true);
  assert.equal(component.invoiceFormError, PARTIAL_CIA_FORM_TERM_ERROR);
});

test('invalid partial CIA source fields block both fresh and reused form generation with specific visible errors', async () => {
  for (const lastForm of [null, savedForm()]) {
    for (const [record, expectedError] of [[stem({ Partial_Lumpsum_Sell_At__c: 0 }), PARTIAL_CIA_AMOUNT_ERROR], [stem({ Payment_Term__c: 'CIA' }), PARTIAL_CIA_BALANCE_TERM_ERROR], [stem({ Payment_Term__c: null }), PARTIAL_CIA_BALANCE_TERM_ERROR]]) {
      const { component, calls } = await loadForm({ getStemInfo: async () => record });
      await component.openModal('stem-id', products, true, true, lastForm);
      assert.equal(component.invoiceFormError, expectedError);
      assert.equal(component.actionExecuted, true);
      assert.equal(component.isGenerateDisabled, true);
      component.handleGeneratePDF();
      assert.equal(calls.invoices.length, 0);
    }
  }
});

test('Apex form and payment lookup failures are handled visibly, stop loading, and disable generation', async () => {
  for (const overrides of [
    { getStemInfo: async () => { throw new Error('lookup failed'); } },
    { getPaymentTerm: async () => { throw new Error('query returned no rows'); } },
    { getDBSInfo: async () => { throw new Error('bank failed'); } },
  ]) {
    const { component, calls } = await loadForm(overrides);
    await component.openModal('stem-id', products, true, true, null);
    assert.equal(component.actionExecuted, true);
    assert.equal(component.isGenerateDisabled, true);
    assert.ok(component.invoiceFormError);
    component.handleGeneratePDF();
    assert.equal(calls.invoices.length, 0);
  }
});

test('PDF library rejection is handled once, remains visible after reopening, and disables generation', async () => {
  let attempts = 0;
  const { component } = await loadForm({ loadScript: async () => { attempts++; throw new Error('resource failed'); } });
  component.renderedCallback();
  await component.pdfLibraryLoadPromise;
  component.renderedCallback();
  assert.equal(attempts, 2);
  await component.openModal('stem-id', products, true, true, null);
  assert.match(component.invoiceFormError, /PDF tools could not be loaded/u);
  assert.equal(component.actionExecuted, true);
  assert.equal(component.isGenerateDisabled, true);
});

test('generation waits for the PDF libraries to finish loading', async () => {
  const resourceLoad = deferred();
  const { component } = await loadForm({ loadScript: () => resourceLoad.promise });
  component.renderedCallback();
  await component.openModal('stem-id', products, true, true, null);
  assert.equal(component.isGenerateDisabled, true);
  resourceLoad.resolve();
  await component.pdfLibraryLoadPromise;
  assert.equal(component.isGenerateDisabled, false);
});

test('late responses from a closed form cannot restore the old STEM, terms or readiness into a later form', async () => {
  const oldStem = deferred();
  const oldReadiness = deferred();
  const { component } = await loadForm({
    getStemInfo: ({ stemId }) => stemId === 'old-stem' ? oldStem.promise : Promise.resolve(stem({ KeyStem__c: 'NEW-STEM', Partial_Lumpsum_Sell_At__c: 500 })),
    getVariableChargeInvoiceReadiness: ({ stemId }) => stemId === 'old-stem' ? oldReadiness.promise : Promise.resolve({ ready: true, requiresVariableChargeReview: false }),
  });
  const oldLoad = component.openModal('old-stem', products, false, true, savedForm());
  component.closeModal();
  await component.openModal('new-stem', products, false, true, savedForm());
  oldStem.resolve(stem({ KeyStem__c: 'OLD-STEM' }));
  oldReadiness.resolve({ ready: false, requiresVariableChargeReview: true, reason: 'OLD BLOCK' });
  await oldLoad;
  await flush();
  assert.equal(component.stem.KeyStem__c, 'NEW-STEM');
  assert.equal(component.inputs.find(input => input.label === 'PAYMENT TERM').value, 'USD 500.00 BASIS CASH IN ADVANCE, BALANCE ON 30 DAYS AFTER DELIVERY');
  assert.equal(component.variableChargeReadiness.ready, true);
  assert.equal(component.isGenerateDisabled, false);
});

test('non-partial reused forms and credit notes retain their edited terms without new balance validation', async () => {
  for (const [record, selectedProducts] of [[stem({ Partial_CIA__c: false }), products], [stem({ Partial_Lumpsum_Sell_At__c: null, Payment_Term__c: 'CIA' }), [{ ...products[0], total: -200000 }]]]) {
    const original = savedForm([{ id: 'custom-term', label: 'PAYMENT TERM', value: 'CUSTOM PAYMENT', isPaymentTermLocked: true }]);
    const { component, calls } = await loadForm({ getStemInfo: async () => record });
    await component.openModal('stem-id', selectedProducts, false, true, original);
    assert.equal(component.inputs[0].value, 'CUSTOM PAYMENT');
    assert.equal(component.inputs[0].isPaymentTermLocked, false);
    assert.equal(calls.paymentTerms.length, 0);
    assert.equal(component.invoiceFormError, null);
    assert.equal(component.isGenerateDisabled, false);
  }
});

test('the form exposes validation and makes only protected payment-term fields read-only', async () => {
  const html = await readFile(new URL('../force-app/main/default/lwc/fcbInvoiceForm/fcbInvoiceForm.html', import.meta.url), 'utf8');
  assert.match(html, /if:true=\{invoiceFormError\}[\s\S]*role="alert"[\s\S]*\{invoiceFormError\}/u);
  assert.equal((html.match(/read-only=\{input.isPaymentTermLocked\}/gu) || []).length, 2);
  assert.match(html, /disabled=\{input.isPaymentTermLocked\}/u);
});
