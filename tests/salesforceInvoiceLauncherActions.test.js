import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { availableInvoiceActions, invoiceActionPageReference, invoiceLauncherRecordId } from
  '../force-app/main/default/lwc/fcosTradeInvoiceActions/invoiceActions.js';

const metadata = new URL('../force-app/main/default/', import.meta.url);
const recordId = 'a102x0000000001AAA';
const available = {
  recordId,
    objectApiName: 'Invoice__c',
  actions: ['Finalize_Native_Proforma', 'Record_HKD_Payment', 'Record_HKD_Credit', 'Global.SendEmail'],
};
const context = { objectApiName: 'Invoice__c', recordId, canEnter: true, availability: available };

test('launches only declared native actions for both invoice objects', () => {
  for (const objectApiName of ['Invoice__c', 'Supplier_Invoice__c']) {
    const selectedId = objectApiName === 'Invoice__c' ? recordId : 'a202x0000000001AAA';
    const all = { ...context, recordId: selectedId, objectApiName,
      availability: { ...available, recordId: selectedId, objectApiName } };
    const actions = availableInvoiceActions(all);
    assert.equal(actions.length, 3);
    for (const { name, label } of actions) {
      const apiName = objectApiName + '.' + name;
      const action = readFileSync(new URL('quickActions/' + apiName + '.quickAction-meta.xml', metadata), 'utf8');
      assert.ok(action.includes('<label>' + label + '</label>'));
      assert.deepEqual(invoiceActionPageReference({ ...all, action: name }), {
        type: 'standard__quickAction', attributes: { apiName }, state: { recordId: selectedId },
      });
    }
    assert.equal(invoiceActionPageReference({ ...all, action: 'Global.SendEmail' }), null);
  }
});

test('a hidden, delayed or incomplete admission never launches an action', () => {
  const action = 'Record_HKD_Payment';
  for (const invalid of [
    { canEnter: false }, { recordId: recordId.slice(0, 15) }, { objectApiName: 'STEM__c' },
    { availability: undefined }, { availability: { ...available, recordId: 'a102x0000000002AAA' } },
    { availability: { ...available, objectApiName: 'Supplier_Invoice__c' } },
    { availability: { ...available, actions: ['Record_HKD_Credit'] } },
  ]) {
    assert.equal(invoiceActionPageReference({ ...context, ...invalid, action }), null);
  }
  assert.equal(invoiceLauncherRecordId({ ...context, canEnter: false }), undefined);
});
