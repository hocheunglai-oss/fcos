import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildSupplierPaymentTerm,
  getIncludedSupplierLines,
  SUPPLIER_PARTIAL_CIA_AMOUNT_ERROR,
  SUPPLIER_BALANCE_TERM_ERROR,
  SUPPLIER_PARTIAL_CIA_SOURCE_ERROR,
  SUPPLIER_PARTIAL_CIA_FORM_ERROR,
} from '../force-app/main/default/lwc/fcbSupplierNominationForm/supplierPaymentTerms.js';

const formUrl = new URL('../force-app/main/default/lwc/fcbSupplierNominationForm/fcbSupplierNominationForm.js', import.meta.url);
const terms = [{ Name: '30 I', Description__c: 'DAYS FROM DATE OF DELIVERY' }, { Name: '2 I', Description__c: 'BANKING DAYS AFTER RECEIPT OF INVOICE AND BDN' }, { Name: 'CIA', Description__c: 'CASH IN ADVANCE' }];
const expected = 'USD 12,345.67 BASIS CASH IN ADVANCE, BALANCE ON 30 DAYS FROM DATE OF DELIVERY';

function product(overrides = {}) {
  return {
    Id: 'product-1', Original_Supplier__c: 'supplier-id', Payment_Term__c: '30 I', Partial_CIA__c: true, Partial_Lumpsum_Buy_At__c: 12345.67,
    Product__r: { Name: 'VLSFO' }, Quantity__c: 100, Unit_of_Measure__c: 'MT', Unit_Buy_At__c: 600,
    ...overrides,
  };
}

function source(overrides = {}) {
  return { Payment_Term__c: 'BUYER TERM', Vessel__c: 'vessel', Vessel__r: { Name: 'TEST VESSEL', IMO__c: '1234567' }, Port__r: { Name: 'TEST PORT' }, STEM_Line_Items__r: [product()], ...overrides };
}

function nomination(overrides = {}) {
  return {
    Id: 'nomination-id', STEM__c: 'stem-id', STEM__r: { Name: 'STEM TEST' }, Account__c: 'supplier-id',
    Account__r: { Name: 'TEST SUPPLIER' }, Payment_Term__c: '30 I', Enquiry__c: 'enquiry-id', RefCode__c: 'TEST REF',
    Remarks__c: 'SOURCE REMARKS', File__c: '/apex/NominationToSupplier?nominationId=nomination-id', ...overrides,
  };
}

function savedNomination(inputs = [{ id: 'saved-payment', label: 'PAYMENT', value: 'USD 1 CIA, BALANCE AMOUNT OLD TERMS' }], overrides = {}) {
  return nomination({
    Last_Saved_Inputs__c: JSON.stringify(inputs), Last_Saved_Remarks__c: JSON.stringify({ label: 'CUSTOM REMARKS', value: 'CUSTOM CONTENT' }),
    ...overrides,
  });
}

function build(lineItems = [product()], paymentTermKey = '30 I', paymentTerms = terms) {
  return buildSupplierPaymentTerm({ lineItems, supplierId: 'supplier-id', paymentTermKey, paymentTerms });
}

async function loadForm(overrides = {}) {
  let code = await readFile(formUrl, 'utf8');
  code = code.replace(/^import .*;\r?$/gmu, '').replace(/@wire\([^)]*\)/gu, '').replaceAll('@api', '').replaceAll('@track', '')
    .replace('export default class FcbSupplierNominationForm', 'class FcbSupplierNominationForm').concat('\nreturn new FcbSupplierNominationForm();');
  const calls = { sources: [], terms: [], remarks: [], updates: [], documents: [], previews: [], events: [] };
  const mocks = {
    LightningElement: class { dispatchEvent(event) { calls.events.push(event); } },
    ShowToastEvent: class { constructor(detail) { Object.assign(this, detail); } },
    buildSupplierPaymentTerm, getIncludedSupplierLines, SUPPLIER_BALANCE_TERM_ERROR, SUPPLIER_PARTIAL_CIA_FORM_ERROR,
    getStemSupplierInfo: async (request) => { calls.sources.push(request); return source(); },
    getSupplierPaymentTerms: async (request) => { calls.terms.push(request); return terms; },
    getNominationSpecialTerms: async (request) => { calls.remarks.push(request); return ['approved remarks']; },
    updateRecord: async (request) => { calls.updates.push(request); },
    generateDocument: async (request) => { calls.documents.push(request); },
    fireEvent: () => {}, window: { open: (...args) => { calls.previews.push(args); } },
    ...overrides,
  };
  return { component: new Function(...Object.keys(mocks), code)(...Object.values(mocks)), calls };
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('supplier partial CIA displays the selected supplier term token and uses buy amounts', () => {
  assert.equal(build([product({ Partial_Lumpsum_Sell_At__c: 999999 })]), expected);
  assert.equal(build([product({ Payment_Term__c: '2 I' })], '2 I'), 'USD 12,345.67 BASIS CASH IN ADVANCE, BALANCE ON 2 BANKING DAYS AFTER RECEIPT OF INVOICE AND BDN');
});

test('sums all distinct included flagged rows, including equal values and partial rows after ordinary rows', () => {
  const rows = [product({ Id: 'ordinary', Partial_CIA__c: false, Partial_Lumpsum_Buy_At__c: 999 }), product({ Id: 'partial-1', Partial_Lumpsum_Buy_At__c: 10.23 }), product({ Id: 'partial-2', Partial_Lumpsum_Buy_At__c: 10.23 })];
  assert.equal(build(rows), 'USD 20.46 BASIS CASH IN ADVANCE, BALANCE ON 30 DAYS FROM DATE OF DELIVERY');
  assert.equal(build([product({ Id: 'one', Partial_Lumpsum_Buy_At__c: 0.1 }), product({ Id: 'two', Partial_Lumpsum_Buy_At__c: '0.20' })]), 'USD 0.30 BASIS CASH IN ADVANCE, BALANCE ON 30 DAYS FROM DATE OF DELIVERY');
});

test('excludes other suppliers, payment keys and cancelled product rows from partial CIA amounts', () => {
  const rows = [product(), product({ Id: 'other-supplier', Original_Supplier__c: 'other', Partial_Lumpsum_Buy_At__c: null }), product({ Id: 'other-key', Payment_Term__c: '2 I', Partial_Lumpsum_Buy_At__c: null }), product({ Id: 'cancelled', Cancelled__c: true, Partial_Lumpsum_Buy_At__c: null })];
  assert.equal(build(rows), expected);
  assert.deepEqual(getIncludedSupplierLines(rows, 'supplier-id', '30 I').map(row => row.Id), ['product-1']);
});

test('invalid, nonpositive, sub-cent and unsafe partial buy amounts fail visibly instead of being omitted', () => {
  for (const amount of [undefined, null, '', ' ', 0, -1, Infinity, -Infinity, NaN, 'bad', true, false, {}, [], 0.001, 1.005]) {
    assert.throws(() => build([product({ Partial_Lumpsum_Buy_At__c: amount })]), { message: SUPPLIER_PARTIAL_CIA_AMOUNT_ERROR }, String(amount));
  }
  assert.throws(() => build([product({ Partial_Lumpsum_Buy_At__c: 100000000000000 })]), { message: SUPPLIER_PARTIAL_CIA_SOURCE_ERROR });
  assert.throws(() => build([product(), product()]), { message: SUPPLIER_PARTIAL_CIA_SOURCE_ERROR });
});

test('requires a full matching balance key and description, rejects CIA and conflicting duplicate terms', () => {
  for (const [key, records] of [['30 I', []], [null, terms], ['30 I', [{ Name: '30', Description__c: 'WRONG KEY' }]], ['30 I', [{ Name: '30 I' }]], ['CIA', terms], ['CIA I', [{ Name: 'CIA I', Description__c: 'CASH IN ADVANCE' }]], ['30 I', [terms[0], { Name: '30 I', Description__c: 'DIFFERENT DESCRIPTION' }]]]) {
    assert.throws(() => build([product({ Payment_Term__c: key })], key, records), { message: SUPPLIER_BALANCE_TERM_ERROR });
  }
  assert.equal(build([product()], '30 I', [terms[0], { ...terms[0] }]), expected);
});

test('ordinary terms retain existing token-plus-description wording, including CIA and extra-cost-only sources', () => {
  assert.equal(build([product({ Partial_CIA__c: false })]), '30 DAYS FROM DATE OF DELIVERY');
  assert.equal(build([product({ Partial_CIA__c: false, Payment_Term__c: 'CIA' })], 'CIA'), 'CIA CASH IN ADVANCE');
  assert.equal(build([], '2 I'), '2 BANKING DAYS AFTER RECEIPT OF INVOICE AND BDN');
});

test('fresh nomination waits for special terms, reads supplier scope and saves approved wording on preview and generate', async () => {
  const pendingRemarks = deferred();
  const { component, calls } = await loadForm({ getNominationSpecialTerms: () => pendingRemarks.promise });
  const opening = component.openModal(nomination(), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(component.isDocumentActionDisabled, true);
  await component.handlePreviewPDF();
  await component.handleGeneratePDF();
  assert.equal(calls.updates.length, 0);
  pendingRemarks.resolve(['approved remarks']);
  await opening;
  assert.deepEqual(calls.sources, [{ stemId: 'stem-id', supplierId: 'supplier-id', paymentTerm: '30 I' }]);
  assert.deepEqual(calls.terms, [{ paymentTerms: ['30 I'] }]);
  assert.equal(component.stem.Payment_Term__c, 'BUYER TERM');
  assert.equal(component.inputs.find(input => input.label === 'PAYMENT').value, expected);
  assert.equal(component.specialTerms.value, 'APPROVED REMARKS');
  assert.equal(component.isDocumentActionDisabled, false);
  await component.handlePreviewPDF();
  assert.equal(JSON.parse(calls.updates[0].fields.Saved_Inputs__c).find(input => input.label === 'PAYMENT').value, expected);
  assert.equal(calls.previews[0][0], '/apex/NominationToSupplier?nominationId=nomination-id');
  await component.handleGeneratePDF();
  assert.equal(calls.documents.length, 1);
  assert.equal(JSON.parse(calls.updates[2].fields.Last_Saved_Inputs__c).find(input => input.label === 'PAYMENT').value, expected);
});

test('reopened partial nomination refreshes source and repairs hidden, spanned, duplicate or missing payment rows while retaining other saved edits', async () => {
  for (const inputs of [
    [{ id: 'old', label: 'PAYMENT', value: 'OLD CIA', isHidden: true, isDisabled: true, labelColSpan: 3 }, { id: 'dup', label: 'PAYMENT TERM', value: 'OLD' }, { id: 'custom', label: 'CUSTOM', value: 'CUSTOM CONTENT' }],
    [{ id: 'old', label: { content: 'PAYMENT', colSpan: 3 }, value: 'OLD CIA', labelColSpan: 3 }, { id: 'dup', label: { content: 'PAYMENT TERM' }, value: 'OLD' }, { id: 'custom', label: 'CUSTOM', value: 'CUSTOM CONTENT' }],
    [{ id: 'custom', label: 'CUSTOM', value: 'CUSTOM CONTENT' }],
  ]) {
    const record = savedNomination(inputs);
    const { component, calls } = await loadForm({ getStemSupplierInfo: async () => source({ STEM_Line_Items__r: [product({ Id: 'first', Partial_CIA__c: false }), product({ Id: 'later', Partial_Lumpsum_Buy_At__c: 500 })] }) });
    await component.openModal(record, true);
    assert.deepEqual(calls.terms, [{ paymentTerms: ['30 I'] }]);
    const paymentInputs = component.inputs.filter(input => component.isPaymentRow(input));
    assert.equal(paymentInputs.length, 1);
    assert.equal(paymentInputs[0].value, 'USD 500.00 BASIS CASH IN ADVANCE, BALANCE ON 30 DAYS FROM DATE OF DELIVERY');
    assert.equal(paymentInputs[0].isHidden, false);
    assert.equal(paymentInputs[0].isDisabled, false);
    assert.equal(paymentInputs[0].labelColSpan, undefined);
    assert.equal(paymentInputs[0].isPaymentLocked, true);
    assert.equal(component.inputs.find(input => input.id === 'custom').value, 'CUSTOM CONTENT');
    assert.deepEqual(component.specialTerms, { label: 'CUSTOM REMARKS', value: 'CUSTOM CONTENT' });
    assert.equal(calls.remarks.length, 0);
    assert.equal(record.Last_Saved_Inputs__c, JSON.stringify(inputs));
    assert.equal(component.isDocumentActionDisabled, false);
  }
});

test('protected PAYMENT resists edits and removal; stale values, duplicate rows and hidden-value spans block both actions without writes', async () => {
  const { component, calls } = await loadForm();
  await component.openModal(savedNomination(), true);
  const payment = component.inputs.find(input => input.label === 'PAYMENT');
  const event = { target: { dataset: { id: payment.id } }, detail: { value: 'OLD CIA' } };
  component.handleChangeLabel(event);
  component.handleChangeValue(event);
  component.removeInput(event);
  assert.equal(payment.value, expected);
  assert.equal(component.inputs.length, 1);
  for (const mutate of [() => { payment.value = 'OLD CIA'; }, () => { payment.labelColSpan = 3; }, () => { component.inputs.push({ id: 'duplicate', label: 'PAYMENT', value: 'OLD' }); }]) {
    mutate();
    assert.equal(component.formError, SUPPLIER_PARTIAL_CIA_FORM_ERROR);
    await component.handlePreviewPDF();
    await component.handleGeneratePDF();
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.documents.length, 0);
    assert.equal(calls.previews.length, 0);
    payment.value = expected;
    delete payment.labelColSpan;
    component.inputs = [payment];
  }
});

test('invalid source amounts, duplicate row IDs and incompatible terms block fresh and reopened actions with specific visible errors', async () => {
  for (const lastSaved of [false, true]) {
    for (const [rows, key, error] of [
      [[product({ Partial_Lumpsum_Buy_At__c: null })], '30 I', SUPPLIER_PARTIAL_CIA_AMOUNT_ERROR],
      [[product(), product()], '30 I', SUPPLIER_PARTIAL_CIA_SOURCE_ERROR],
      [[product({ Payment_Term__c: 'CIA' })], 'CIA', SUPPLIER_BALANCE_TERM_ERROR],
    ]) {
      const { component, calls } = await loadForm({ getStemSupplierInfo: async () => source({ STEM_Line_Items__r: rows }) });
      await component.openModal(savedNomination(undefined, { Payment_Term__c: key }), lastSaved);
      assert.equal(component.formError, error);
      assert.equal(component.actionExecuted, true);
      assert.equal(component.isDocumentActionDisabled, true);
      await component.handlePreviewPDF();
      await component.handleGeneratePDF();
      assert.equal(calls.updates.length, 0);
      assert.equal(calls.previews.length, 0);
      assert.equal(calls.documents.length, 0);
    }
  }
});

test('source, payment, special-terms and malformed saved-form failures stop loading and block actions visibly', async () => {
  for (const [overrides, record, saved] of [
    [{ getStemSupplierInfo: async () => { throw new Error('source failed'); } }, nomination(), false],
    [{ getSupplierPaymentTerms: async () => { throw new Error('terms failed'); } }, nomination(), false],
    [{ getNominationSpecialTerms: async () => { throw new Error('remarks failed'); } }, nomination(), false],
    [{}, savedNomination(undefined, { Last_Saved_Inputs__c: 'invalid JSON' }), true],
  ]) {
    const { component, calls } = await loadForm(overrides);
    await component.openModal(record, saved);
    assert.equal(component.actionExecuted, true);
    assert.equal(component.isDocumentActionDisabled, true);
    assert.ok(component.formError);
    await component.handlePreviewPDF();
    await component.handleGeneratePDF();
    assert.equal(calls.updates.length, 0);
  }
});

test('ordinary saved CIA preserves custom wording and remarks despite an unset intended date', async () => {
  const { component, calls } = await loadForm({ getStemSupplierInfo: async () => source({ STEM_Line_Items__r: [product({ Partial_CIA__c: false, Payment_Term__c: 'CIA', Intended_Payment_Date__c: null })] }) });
  await component.openModal(savedNomination([{ id: 'custom', label: 'PAYMENT', value: 'CUSTOM PAYMENT', isPaymentLocked: true }], { Payment_Term__c: 'CIA' }), true);
  assert.equal(component.inputs[0].value, 'CUSTOM PAYMENT');
  assert.equal(component.inputs[0].isPaymentLocked, false);
  assert.equal(component.specialTerms.value, 'CUSTOM CONTENT');
  assert.equal(calls.terms.length, 0);
  assert.equal(calls.remarks.length, 0);
  assert.equal(component.isModalOpen, true);
  assert.equal(component.isDocumentActionDisabled, false);
});

test('extra-cost-only fresh nomination retains ordinary supplier wording', async () => {
  const cost = { Id: 'charge', Supplier__c: 'supplier-id', Payment_Term__c: '2 I', RecordType: { Name: 'STEM Charge' }, Product2Id__r: { Name: 'SERVICE' }, Fixed__c: true, Lumpsum_Cost__c: 200 };
  const { component } = await loadForm({ getStemSupplierInfo: async () => source({ STEM_Line_Items__r: [], STEM_Extra_Costs__r: [cost] }) });
  await component.openModal(nomination({ Payment_Term__c: '2 I' }), false);
  assert.equal(component.formError, null);
  assert.equal(component.inputs.find(input => input.label === 'PAYMENT').value, '2 BANKING DAYS AFTER RECEIPT OF INVOICE AND BDN');
  assert.equal(component.inputs.find(input => input.label === 'PAYMENT').isPaymentLocked, undefined);
});

test('late source and special-term responses cannot overwrite a later nomination', async () => {
  for (const slowStage of ['source', 'remarks']) {
    const slow = deferred();
    const { component } = await loadForm({
      getStemSupplierInfo: ({ stemId }) => slowStage === 'source' && stemId === 'old' ? slow.promise : Promise.resolve(source({ STEM_Line_Items__r: [product({ Partial_Lumpsum_Buy_At__c: stemId === 'old' ? 100 : 500 })] })),
      getNominationSpecialTerms: ({ enquiryId }) => slowStage === 'remarks' && enquiryId === 'old' ? slow.promise : Promise.resolve(['NEW REMARKS']),
    });
    const oldOpening = component.openModal(nomination({ STEM__c: 'old', Enquiry__c: 'old' }), false);
    await new Promise(resolve => setImmediate(resolve));
    component.closeModal();
    await component.openModal(nomination({ STEM__c: 'new', Enquiry__c: 'new' }), false);
    slow.resolve(slowStage === 'source' ? source() : ['OLD REMARKS']);
    await oldOpening;
    assert.equal(component.inputs.find(input => input.label === 'PAYMENT').value, 'USD 500.00 BASIS CASH IN ADVANCE, BALANCE ON 30 DAYS FROM DATE OF DELIVERY');
    assert.equal(component.specialTerms.value, 'NEW REMARKS');
    assert.equal(component.isDocumentActionDisabled, false);
  }
});

test('write failures stay visible, stop the spinner and permit a deliberate retry', async () => {
  const { component } = await loadForm({ updateRecord: async () => { throw { body: { message: 'SAVE FAILED' } }; } });
  await component.openModal(nomination(), false);
  await component.handlePreviewPDF();
  assert.equal(component.formError, 'SAVE FAILED');
  assert.equal(component.actionExecuted, true);
  assert.equal(component.isDocumentActionDisabled, false);
});

test('pending preview or generate saves cannot use or mutate a later nomination', async () => {
  for (const action of ['handlePreviewPDF', 'handleGeneratePDF']) {
    const pendingSave = deferred();
    const updates = [];
    const { component, calls } = await loadForm({ updateRecord: async request => { updates.push(request); await pendingSave.promise; } });
    await component.openModal(nomination({ Id: 'original-id' }), false);
    const operation = component[action]();
    component.closeModal();
    await component.openModal(nomination({ Id: 'later-id' }), false);
    pendingSave.resolve();
    await operation;
    assert.equal(updates.length, 1);
    assert.equal(updates[0].fields.Id, 'original-id');
    assert.equal(calls.documents.length, 0);
    assert.equal(calls.previews.length, 0);
    assert.equal(component.nomination.Id, 'later-id');
    assert.equal(component.isModalOpen, true);
    assert.equal(component.isDocumentActionDisabled, false);
  }
});

test('a document already generating finishes bookkeeping for its captured nomination without closing or changing the later form', async () => {
  const pendingDocument = deferred();
  const documents = [];
  const updates = [];
  const { component } = await loadForm({
    generateDocument: async request => { documents.push(request); await pendingDocument.promise; },
    updateRecord: async request => { updates.push(request); },
  });
  await component.openModal(nomination({ Id: 'original-id', File__c: 'ORIGINAL URL', STEM__r: { Name: 'ORIGINAL STEM' } }), false);
  const operation = component.handleGeneratePDF();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(documents.length, 1);
  component.closeModal();
  await component.openModal(nomination({ Id: 'later-id', File__c: 'LATER URL', STEM__r: { Name: 'LATER STEM' } }), false);
  component.specialTerms.value = 'LATER EDIT';
  pendingDocument.resolve();
  await operation;
  assert.deepEqual(documents[0], { nominationId: 'original-id', fileUrl: 'ORIGINAL URL', fileName: 'ORIGINAL STEM - NOM' });
  assert.equal(updates[1].fields.Id, 'original-id');
  assert.equal(JSON.parse(updates[1].fields.Last_Saved_Remarks__c).value, 'APPROVED REMARKS');
  assert.equal(JSON.parse(updates[1].fields.Last_Saved_Inputs__c).find(input => input.label === 'PAYMENT').value, expected);
  assert.equal(component.nomination.Id, 'later-id');
  assert.equal(component.specialTerms.value, 'LATER EDIT');
  assert.equal(component.isModalOpen, true);
  assert.equal(component.isDocumentActionDisabled, false);
});

test('reopening the same nomination during generation blocks another preview or generate until original bookkeeping finishes', async () => {
  const pendingDocument = deferred();
  const pendingBookkeeping = deferred();
  const documents = [];
  const updates = [];
  const { component, calls } = await loadForm({
    generateDocument: async request => { documents.push(request); await pendingDocument.promise; },
    updateRecord: async request => {
      updates.push(request);
      if (request.fields.Last_Saved_Inputs__c) await pendingBookkeeping.promise;
    },
  });
  await component.openModal(nomination(), false);
  const original = component.handleGeneratePDF();
  await new Promise(resolve => setImmediate(resolve));
  component.closeModal();
  await component.openModal(nomination(), false);
  assert.match(component.formError, /still running for this nomination/u);
  assert.equal(component.isDocumentActionDisabled, true);
  await component.handleGeneratePDF();
  await component.handlePreviewPDF();
  assert.equal(updates.length, 1);
  assert.equal(documents.length, 1);
  assert.equal(calls.previews.length, 0);
  pendingDocument.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 2);
  assert.equal(component.isDocumentActionDisabled, true);
  await component.handleGeneratePDF();
  assert.equal(updates.length, 2);
  pendingBookkeeping.resolve();
  await original;
  assert.equal(component.nominationBusyMessage, null);
  assert.equal(component.isModalOpen, true);
  assert.equal(component.isDocumentActionDisabled, false);
});

test('same-nomination lock survives a pending preview save and releases after a failed save', async () => {
  let rejectSave;
  const pendingSave = new Promise((resolve, reject) => { rejectSave = reject; });
  const updates = [];
  const { component, calls } = await loadForm({ updateRecord: async request => { updates.push(request); await pendingSave; } });
  await component.openModal(nomination(), false);
  const original = component.handlePreviewPDF();
  component.closeModal();
  await component.openModal(nomination(), false);
  await component.handlePreviewPDF();
  await component.handleGeneratePDF();
  assert.equal(updates.length, 1);
  assert.equal(component.isDocumentActionDisabled, true);
  rejectSave(new Error('SAVE FAILED'));
  await original;
  assert.equal(component.nominationBusyMessage, null);
  assert.equal(component.isDocumentActionDisabled, false);
  assert.equal(calls.previews.length, 0);
});

test('a nomination locked during generation does not block another nomination', async () => {
  const pendingDocument = deferred();
  const documents = [];
  const { component, calls } = await loadForm({ generateDocument: async request => { documents.push(request); await pendingDocument.promise; } });
  await component.openModal(nomination({ Id: 'original' }), false);
  const original = component.handleGeneratePDF();
  await new Promise(resolve => setImmediate(resolve));
  component.closeModal();
  await component.openModal(nomination({ Id: 'other' }), false);
  assert.equal(component.isDocumentActionDisabled, false);
  await component.handlePreviewPDF();
  assert.equal(calls.previews.length, 1);
  assert.equal(calls.updates[1].fields.Id, 'other');
  assert.deepEqual(component.inFlightNominationIds, ['original']);
  pendingDocument.resolve();
  await original;
  assert.deepEqual(component.inFlightNominationIds, []);
});

test('generation failures release the nomination lock at every awaited stage', async () => {
  for (const failingStage of ['save', 'generate', 'bookkeeping']) {
    const { component } = await loadForm({
      updateRecord: async ({ fields }) => {
        if ((failingStage === 'save' && fields.Saved_Inputs__c) || (failingStage === 'bookkeeping' && fields.Last_Saved_Inputs__c)) throw new Error('OPERATION FAILED');
      },
      generateDocument: async () => { if (failingStage === 'generate') throw new Error('OPERATION FAILED'); },
    });
    await component.openModal(nomination(), false);
    await component.handleGeneratePDF();
    assert.deepEqual(component.inFlightNominationIds, []);
    assert.equal(component.formError, 'OPERATION FAILED');
    assert.equal(component.actionExecuted, true);
    assert.equal(component.isDocumentActionDisabled, false);
  }
});

test('both buttons use the guard and only protected payment-row fields are read-only', async () => {
  const html = await readFile(new URL('../force-app/main/default/lwc/fcbSupplierNominationForm/fcbSupplierNominationForm.html', import.meta.url), 'utf8');
  assert.equal((html.match(/disabled=\{isDocumentActionDisabled\}/gu) || []).length, 2);
  assert.equal((html.match(/read-only=\{input.isPaymentLocked\}/gu) || []).length, 2);
  assert.match(html, /if:true=\{formError\}[\s\S]*role="alert"[\s\S]*\{formError\}/u);
});
