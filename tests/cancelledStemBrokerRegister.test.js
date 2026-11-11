import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { nativeFinancialQuantity } from '../api/_financialQuantity.js';

const source = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
const stemId = 'a0H000000000001AAA';
const brokerId = '001000000000001AAA';
const secondaryId = '001000000000002AAA';
const line = (id, extra = {}) => ({
  Id: id, STEM__c: stemId, Name: id, Cancelled__c: false,
  Product__r: { Name: 'Active product', Family: 'Fuel' }, Quantity__c: 10,
  Unit_of_Measure__c: 'MT', Buyer_Broker__c: brokerId,
  Buyers_Brokers_Commission_Per_Unit__c: 2, Commission_Cost__c: 25, ...extra,
});
const actualFunction = (start, end, dependencies, name = start.match(/function (\w+)/)[1]) => vm.runInNewContext(
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))) + `\n${name}`,
  dependencies,
);

async function register(lines, { delivered = false } = {}) {
  const before = JSON.stringify(lines);
  const handler = actualFunction('function uniquePresentValues(', '\nasync function salesforceBrokerRegisterFull(', {
    nativeFinancialQuantity,
    chunkIds: (ids) => ids.length ? [ids] : [],
    salesforceObjectFields: async () => ({ fields: [] }), findDashboardUomField: () => null,
    interofficeStemAccessCondition: async () => '',
    queryRows: async () => [{ Id: stemId, Name: 'HK2627141T fixture', Delivery_Date__c: delivered ? '2026-10-01' : null }],
    compositeQueryRows: async (specs) => specs.map(({ soql }) => {
      if (soql.includes('FROM STEM_Line_Item__c')) return lines;
      if (soql.includes('FROM STEM_Buyer_Broker__c')) return [{ Id: 'secondary-header', STEM__c: stemId, Buyer_Broker__c: secondaryId }];
      if (soql.includes('FROM Account')) return [{ Id: brokerId, Name: 'Primary broker' }, { Id: secondaryId, Name: 'Secondary broker' }];
      return [];
    }),
    paymentDataReliabilityState: () => ({ reliable: false }),
    paymentDataReliabilityMetadata: (excluded, included) => ({ excluded, included }),
    LEGACY_PAYMENT_DATA_LABEL: 'Historical payment data',
    brokerAmount: (rate, qty) => Number(rate || 0) * qty,
    numericValue: (v) => v == null ? null : Number(v), money: String,
    formatQuantityLabel: (qty, unit) => `${qty} ${unit}`, paymentDelayDays: () => null,
  }, 'salesforceBrokerRegisterUncached');
  const result = await handler({ limit: 2000 });
  assert.equal(JSON.stringify(lines), before);
  return JSON.parse(JSON.stringify(result));
}

test('replacement lines are counted once even when cancelled lines retain exported buyer commission', async () => {
  const lines = [true, false].flatMap((cancelled) => [300, 80].map((quantity) => line(`${cancelled}-${quantity}`, {
    Cancelled__c: cancelled,
    Exported__c: cancelled,
    Quantity__c: quantity,
    Quantity_Delivered_Per_BDN__c: cancelled ? null : quantity,
    Buyers_Brokers_Commission_Per_Unit__c: 3,
    Buyers_Brokers_Commission_Lumpsum__c: quantity * 3,
    Commission_Cost__c: quantity * 3,
  })));
  const { rows } = await register(lines, { delivered: true });
  assert.deepEqual(rows.map(({ brokerType, commissionAmount, bdnQuantity }) => ({ brokerType, commissionAmount, bdnQuantity })), [
    { brokerType: 'Buyer Broker', commissionAmount: 1140, bdnQuantity: 380 },
  ]);
});

test('cancelled lines are excluded before supplier, primary and secondary broker grouping', async () => {
  const activeSupplier = line('active-supplier', {
    Supplier_Broker__c: brokerId, Suppliers_Brokers_Commission_Per_Unit__c: 4,
    Buyers_Brokers_Commission_Per_Unit__c: 0,
  });
  const activeBuyer = line('active-buyer', { Cancelled__c: undefined });
  const cancelled = line('cancelled', {
    Cancelled__c: true, Quantity__c: 20,
    Buyers_Brokers_Commission_Per_Unit__c: 3, Commission_Cost__c: 80,
  });
  const cancelledSupplier = line('cancelled-supplier', {
    Cancelled__c: true, Supplier_Broker__c: brokerId,
    Suppliers_Brokers_Commission_Per_Unit__c: 9,
    Buyers_Brokers_Commission_Per_Unit__c: 0,
  });
  const expected = await register([activeSupplier, activeBuyer]);
  assert.deepEqual(await register([activeSupplier, activeBuyer, cancelled, cancelledSupplier]), expected);
  assert.deepEqual(expected.rows.map(row => [row.brokerType, row.commissionAmount]), [
    ['Supplier Broker', 40], ['Buyer Broker', 20], ['Secondary Buyer Broker', 5],
  ]);
});
