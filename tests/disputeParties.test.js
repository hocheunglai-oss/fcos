import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDisputePartyRegistry,
  findDisputeParty,
  resolveOriginalSupplierLookup,
} from '../api/_disputeParties.js';

const STEM_ID = 'a00000000000001AAA';
const BUYER_ID = '001000000000001AAA';
const SUPPLIER_A = '001000000000002AAA';
const SUPPLIER_B = '001000000000003AAA';

function lineItem(id, supplierId, name, paymentTerm, extra = {}) {
  return {
    Id: id,
    Original_Supplier__c: supplierId,
    Original_Supplier__r: { Name: name },
    Payment_Term__c: paymentTerm,
    Product__r: { Name: extra.product || 'VLSFO' },
    Cancelled__c: extra.cancelled || false,
  };
}

function dispute(id, buyerId, supplierId, supplierName = 'Supplier') {
  return {
    Id: id,
    STEM__c: STEM_ID,
    Buyer__c: buyerId || null,
    Buyer__r: buyerId ? { Name: 'Buyer Account' } : null,
    Supplier__c: supplierId || null,
    Supplier__r: supplierId ? { Name: supplierName } : null,
  };
}

test('validates Original_Supplier__c as an Account lookup', () => {
  const valid = resolveOriginalSupplierLookup([{
    name: 'Original_Supplier__c',
    type: 'reference',
    referenceTo: ['Account'],
    relationshipName: 'Original_Supplier__r',
  }]);
  assert.equal(valid.valid, true);

  const invalid = resolveOriginalSupplierLookup([{
    name: 'Original_Supplier__c',
    type: 'string',
    referenceTo: [],
  }]);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.issue.code, 'original_supplier_lookup_invalid');
});

test('supports a buyer-only dispute', () => {
  const registry = buildDisputePartyRegistry({
    stem: { Account__c: BUYER_ID },
    disputeRecords: [dispute('a01000000000001AAA', BUYER_ID, null)],
  });
  assert.equal(registry.valid, true);
  assert.equal(registry.buyer.accountId, BUYER_ID);
  assert.equal(registry.buyer.label, 'Buyer Account');
  assert.deepEqual(registry.suppliers, []);
});

test('rejects a disputed stem with no buyer or supplier dispute record', () => {
  const registry = buildDisputePartyRegistry({ disputeRecords: [] });
  assert.equal(registry.valid, false);
  assert.ok(registry.issues.some((item) => item.code === 'no_dispute_parties'));
});

test('supports one record containing buyer and supplier', () => {
  const registry = buildDisputePartyRegistry({
    stem: { Account__c: BUYER_ID },
    lineItems: [lineItem('a02000000000001AAA', SUPPLIER_A, 'Supplier A', '30 days')],
    disputeRecords: [dispute('a01000000000002AAA', BUYER_ID, SUPPLIER_A, 'Supplier A')],
  });
  assert.equal(registry.valid, true);
  assert.deepEqual(registry.buyer.disputeIds, ['a01000000000002AAA']);
  assert.equal(registry.suppliers[0].accountId, SUPPLIER_A);
  assert.equal(registry.suppliers[0].label, 'Supplier A | 30 days');
});

test('keeps same-name suppliers with different IDs separate', () => {
  const registry = buildDisputePartyRegistry({
    stem: { Account__c: BUYER_ID },
    lineItems: [
      lineItem('a02000000000002AAA', SUPPLIER_A, 'Same Supplier', '30 days'),
      lineItem('a02000000000003AAA', SUPPLIER_B, 'Same Supplier', '60 days'),
    ],
    disputeRecords: [
      dispute('a01000000000003AAA', BUYER_ID, SUPPLIER_A, 'Same Supplier'),
      dispute('a01000000000004AAA', BUYER_ID, SUPPLIER_B, 'Same Supplier'),
    ],
  });
  assert.equal(registry.valid, true);
  assert.equal(registry.suppliers.length, 2);
  assert.notEqual(registry.suppliers[0].partyKey, registry.suppliers[1].partyKey);
  assert.match(registry.suppliers[0].label, /30 days/);
  assert.match(registry.suppliers[1].label, /60 days/);
  assert.match(registry.suppliers[0].label, /002AAA/);
  assert.match(registry.suppliers[1].label, /003AAA/);
});

test('rejects a supplier without a non-cancelled stem line item', () => {
  const registry = buildDisputePartyRegistry({
    lineItems: [lineItem('a02000000000004AAA', SUPPLIER_A, 'Supplier A', '30 days', { cancelled: true })],
    disputeRecords: [dispute('a01000000000005AAA', null, SUPPLIER_A, 'Supplier A')],
  });
  assert.equal(registry.valid, false);
  assert.ok(registry.issues.some((item) => item.code === 'supplier_without_stem_line_item'));
});

test('rejects duplicate supplier records and buyer-only rows alongside suppliers', () => {
  const registry = buildDisputePartyRegistry({
    stem: { Account__c: BUYER_ID },
    lineItems: [lineItem('a02000000000005AAA', SUPPLIER_A, 'Supplier A', '30 days')],
    disputeRecords: [
      dispute('a01000000000006AAA', BUYER_ID, SUPPLIER_A, 'Supplier A'),
      dispute('a01000000000007AAA', BUYER_ID, SUPPLIER_A, 'Supplier A'),
      dispute('a01000000000008AAA', BUYER_ID, null),
    ],
  });
  assert.equal(registry.valid, false);
  assert.ok(registry.issues.some((item) => item.code === 'duplicate_supplier_dispute'));
  assert.ok(registry.issues.some((item) => item.code === 'buyer_only_record_with_suppliers'));
});

test('rejects mixed buyers and missing buyer propagation', () => {
  const otherBuyer = '001000000000004AAA';
  const registry = buildDisputePartyRegistry({
    lineItems: [
      lineItem('a02000000000006AAA', SUPPLIER_A, 'Supplier A', '30 days'),
      lineItem('a02000000000007AAA', SUPPLIER_B, 'Supplier B', '60 days'),
    ],
    disputeRecords: [
      dispute('a01000000000009AAA', BUYER_ID, SUPPLIER_A, 'Supplier A'),
      dispute('a01000000000010AAA', otherBuyer, SUPPLIER_B, 'Supplier B'),
    ],
  });
  assert.equal(registry.valid, false);
  assert.ok(registry.issues.some((item) => item.code === 'mixed_buyer_accounts'));

  const missingBuyer = buildDisputePartyRegistry({
    lineItems: [
      lineItem('a02000000000008AAA', SUPPLIER_A, 'Supplier A', '30 days'),
      lineItem('a02000000000009AAA', SUPPLIER_B, 'Supplier B', '60 days'),
    ],
    disputeRecords: [
      dispute('a01000000000011AAA', BUYER_ID, SUPPLIER_A, 'Supplier A'),
      dispute('a01000000000012AAA', null, SUPPLIER_B, 'Supplier B'),
    ],
  });
  assert.ok(missingBuyer.issues.some((item) => item.code === 'buyer_not_repeated_on_supplier_records'));
});

test('finds parties by 15 or 18 character account ID', () => {
  const registry = buildDisputePartyRegistry({
    lineItems: [lineItem('a02000000000010AAA', SUPPLIER_A, 'Supplier A', '30 days')],
    disputeRecords: [dispute('a01000000000013AAA', null, SUPPLIER_A, 'Supplier A')],
  });
  assert.equal(findDisputeParty(registry, 'supplier', SUPPLIER_A.slice(0, 15))?.accountId, SUPPLIER_A);
});
