import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDisputePartyRegistry,
  findDisputeParty,
  resolveExtraCostSupplierLookup,
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
    Original_Supplier__r: supplierId ? { Name: name } : null,
    Supplier_Name__c: name,
    Payment_Term__c: paymentTerm,
    Product__r: { Name: extra.product || 'VLSFO' },
    Cancelled__c: extra.cancelled || false,
  };
}

function extraCost(id, supplierId, name, paymentTerm, extra = {}) {
  return {
    Id: id,
    Supplier__c: supplierId,
    Supplier__r: supplierId ? { Name: name } : null,
    Supplier_Name__c: name,
    Payment_Term__c: paymentTerm,
    Product2Id__r: { Name: extra.product || 'Barge' },
    Cancelled__c: extra.cancelled || false,
  };
}

test('validates line and extra-cost supplier Account lookups', () => {
  const lineLookup = resolveOriginalSupplierLookup([{
    name: 'Original_Supplier__c', type: 'reference', referenceTo: ['Account'], relationshipName: 'Original_Supplier__r',
  }]);
  assert.equal(lineLookup.valid, true);

  const extraLookup = resolveExtraCostSupplierLookup([{
    name: 'Supplier__c', label: 'Supplier', type: 'reference', referenceTo: ['Account'], relationshipName: 'Supplier__r',
  }]);
  assert.equal(extraLookup.valid, true);
  assert.equal(extraLookup.fieldName, 'Supplier__c');

  const invalid = resolveExtraCostSupplierLookup([{ name: 'Supplier__c', label: 'Supplier', type: 'string', referenceTo: [] }]);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.issue.code, 'extra_cost_supplier_lookup_missing');
});

test('builds buyer, line supplier, and extra-cost supplier candidates', () => {
  const registry = buildDisputePartyRegistry({
    stem: { Id: STEM_ID, Account__c: BUYER_ID, Account__r: { Name: 'Buyer Account' } },
    lineItems: [lineItem('a02000000000001AAA', SUPPLIER_A, 'Supplier A', '30 days')],
    extraCosts: [extraCost('a03000000000001AAA', SUPPLIER_B, 'Supplier B', '60 days')],
    extraCostSupplierField: 'Supplier__c',
    extraCostSupplierRelationship: 'Supplier__r',
  });
  assert.equal(registry.candidateSchemaValid, true);
  assert.equal(registry.candidates.length, 3);
  assert.deepEqual(registry.buyer.roles, ['buyer']);
  assert.equal(findDisputeParty(registry, 'supplier', SUPPLIER_A)?.name, 'Supplier A');
  assert.equal(findDisputeParty(registry, 'supplier', SUPPLIER_B)?.name, 'Supplier B');
});

test('includes cancelled supplier sources without changing their identity', () => {
  const registry = buildDisputePartyRegistry({
    lineItems: [lineItem('a02000000000002AAA', SUPPLIER_A, 'Supplier A', '30 days', { cancelled: true })],
  });
  assert.equal(registry.candidateSchemaValid, true);
  assert.equal(registry.suppliers[0].accountId, SUPPLIER_A);
  assert.equal(registry.suppliers[0].cancelledSourceOnly, true);
});

test('deduplicates one supplier ID across payment terms and source objects', () => {
  const registry = buildDisputePartyRegistry({
    lineItems: [
      lineItem('a02000000000003AAA', SUPPLIER_A, 'Supplier A', '30 days'),
      lineItem('a02000000000004AAA', SUPPLIER_A, 'Supplier A', '45 days'),
    ],
    extraCosts: [extraCost('a03000000000002AAA', SUPPLIER_A, 'Supplier A', '60 days')],
    extraCostSupplierField: 'Supplier__c',
    extraCostSupplierRelationship: 'Supplier__r',
  });
  assert.equal(registry.suppliers.length, 1);
  assert.deepEqual(registry.suppliers[0].paymentTerms, ['30 days', '45 days', '60 days']);
  assert.deepEqual(registry.suppliers[0].sourceTypes, ['line_item', 'extra_cost']);
});

test('keeps same-name supplier IDs separate without exposing IDs in labels', () => {
  const registry = buildDisputePartyRegistry({
    lineItems: [
      lineItem('a02000000000005AAA', SUPPLIER_A, 'Same Supplier', '30 days'),
      lineItem('a02000000000006AAA', SUPPLIER_B, 'Same Supplier', '60 days'),
    ],
  });
  assert.equal(registry.suppliers.length, 2);
  assert.match(registry.suppliers[0].label, /30 days/);
  assert.match(registry.suppliers[1].label, /60 days/);
  assert.doesNotMatch(registry.suppliers[0].label, /002AAA/);
  assert.doesNotMatch(registry.suppliers[1].label, /003AAA/);
});

test('numbers indistinguishable same-name supplier options without exposing IDs', () => {
  const registry = buildDisputePartyRegistry({
    lineItems: [
      lineItem('a02000000000009AAA', SUPPLIER_A, 'Same Supplier', '30 days'),
      lineItem('a02000000000010AAA', SUPPLIER_B, 'Same Supplier', '30 days'),
    ],
  });
  assert.match(registry.suppliers[0].label, /Supplier option 1/);
  assert.match(registry.suppliers[1].label, /Supplier option 2/);
  assert.doesNotMatch(registry.suppliers.map((party) => party.label).join(' '), /00[23]AAA/);
});

test('counts an Account that is buyer and supplier once with both roles', () => {
  const registry = buildDisputePartyRegistry({
    stem: { Id: STEM_ID, Account__c: BUYER_ID, Account__r: { Name: 'Dual Account' } },
    lineItems: [lineItem('a02000000000007AAA', BUYER_ID, 'Dual Account', '30 days')],
  });
  assert.equal(registry.candidates.length, 1);
  assert.deepEqual(registry.candidates[0].roles, ['buyer', 'supplier']);
  assert.equal(findDisputeParty(registry, 'buyer', BUYER_ID)?.accountId, BUYER_ID);
  assert.equal(findDisputeParty(registry, 'supplier', BUYER_ID)?.accountId, BUYER_ID);
});

test('fails closed when a supplier name has no Account lookup value', () => {
  const registry = buildDisputePartyRegistry({
    lineItems: [lineItem('a02000000000008AAA', null, 'Unresolved Supplier', '30 days')],
  });
  assert.equal(registry.candidateSchemaValid, false);
  assert.ok(registry.issues.some((item) => item.code === 'line_supplier_account_missing'));
});
