import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync(
  new URL('../force-app/main/default/lwc/fcbCommissionInvoiceForm/fcbCommissionInvoiceForm.js', import.meta.url),
  'utf8',
);
const controller = fs.readFileSync(
  new URL('../force-app/main/default/classes/StemProcessingController.cls', import.meta.url),
  'utf8',
);

test('commission invoice eligibility uses Hidden Commission, not broker visibility flags', () => {
  assert.match(component, /Supplier_Broker__r\.Hidden_Commission__c/);
  assert.match(component, /Buyer_Broker__r\.Hidden_Commission__c/);
  assert.doesNotMatch(component, /!stemLineItem\.Supplier_Broker__r\.Hidden_Broker__c/);
  assert.doesNotMatch(component, /!stemLineItem\.STEM__r\.Buyer_Broker__r\.Hidden_Broker__c/);
  assert.doesNotMatch(component, /!broker\.STEM_Buyer_Broker__r\.Buyer_Broker__r\.Hidden_Broker__c/);
});

test('commission template query returns commission visibility for every broker relationship', () => {
  const matches = controller.match(/Hidden_Commission__c/g) || [];
  assert.equal(matches.length, 3);
});
