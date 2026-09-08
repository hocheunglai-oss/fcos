import test from 'node:test';
import assert from 'node:assert/strict';
import { isBuyerPaymentAllocation, isPaymentRemittance } from '../api/_paymentClassification.js';
import { expectedBuyerInvoiceEstimate } from '../api/_dashboardAccountCreditStatement.js';
import { allocateSupplierContribution } from '../api/_dashboardAccountInsight.js';
import { dashboardAccountInsightServiceInternals as service } from '../api/_dashboardAccountInsightService.js';

const buyer = '001000000000001AAA';
const supplier = '001000000000002AAA';
const stemId = 'a0H000000000001AAA';
test('sample remittance is supporting evidence, never a third allocation', () => {
  const rows = [
    { Amount__c: 473256.55, RecordType: { DeveloperName: 'ReceivableRemittance' } },
    { Amount__c: 215720.80, RecordType: { DeveloperName: 'Receivable' } },
    { Amount__c: 257535.75, RecordType: { DeveloperName: 'Receivable' } },
  ].map((row) => ({ ...row, STEM__c: stemId, Account__c: buyer }));
  const allocations = rows.filter((row) => isBuyerPaymentAllocation(row, { buyerAccountId: buyer, requireRecordType: true }));
  assert.equal(allocations.length, 2);
  assert.equal(allocations.reduce((sum, row) => sum + row.Amount__c, 0), 473256.55);
  assert.equal(isPaymentRemittance(rows[0]), true);
  for (const changed of [
    { RecordType: { DeveloperName: 'Payable' } }, { RecordType: undefined },
    { Account__c: supplier }, { Supplier_Invoice__c: 'a06000000000001AAA' }, { Status__c: 'Voided' },
  ]) assert.equal(isBuyerPaymentAllocation({ ...rows[1], ...changed }, { buyerAccountId: buyer, requireRecordType: true, statusFields: ['Status__c'] }), false);
});
test('four invoiced fixed charges preserve USD totals and described HKD evidence', () => {
  const costs = [202.93, 248.72, 14.80, 255.91];
  const charges = costs.map((cost, index) => ({ Id: `charge-${index}`, Supplier__c: supplier, Fixed__c: true, Lumpsum_Cost__c: cost, Lumpsum_Price__c: [0, 0, 7.40, 267.51][index], Unit_Cost__c: null, Unit_Price__c: null }));
  const allocations = allocateSupplierContribution({ stem: { Delivery_Date__c: '2026-08-22' }, extraCosts: charges, buyerAmount: 274.91, supplierAmount: 722.36, brokerCommissions: 0, extraCostSupplierField: 'Supplier__c', extraCostSupplierRelationship: 'Supplier__r' });
  assert.ok(Math.abs(allocations[0].directCost - 722.36) < 0.00001);
  assert.equal(expectedBuyerInvoiceEstimate({ extraCosts: charges }).amount, 274.91);
  const required = ['Fixed__c', 'Lumpsum_Cost__c', 'Lumpsum_Price__c', 'Supplier_Cost_Input_Currency__c', 'Supplier_Cost_Input_Value__c', 'Supplier_Cost_USD_HKD_Rate__c', 'Supplier_Cost_FX_Settings_Revision__c'];
  const fields = service.extraCostSelectFields(new Map(required.map((name) => [name, { name }])), new Map(), new Map(), { valid: false });
  for (const name of required) assert.ok(fields.includes(name));
});
test('payment timing never substitutes record creation for an absent payment date', () => {
  assert.equal(service.paymentFieldConfiguration(new Map([['CreatedDate', { name: 'CreatedDate' }]])).dateField, null);
});
test('range max estimate remains distinct from Salesforce midpoint exposure', () => {
  const estimate = expectedBuyerInvoiceEstimate({ lineItems: [{ Quantity__c: 250, Quantity_Max__c: 350, Is_Quantity_Range__c: true, Price_Per_Unit__c: 1214 }] });
  assert.equal(estimate.amount, 424900);
  assert.notEqual(estimate.amount, 364200);
});
