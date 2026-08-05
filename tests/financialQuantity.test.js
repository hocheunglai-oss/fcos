import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  financialQuantityValue,
  nativeFinancialQuantity,
} from '../api/_financialQuantity.js';

test('financial quantity uses native ordered and delivered values without MT fallback', () => {
  const line = {
    Quantity__c: 330_800,
    Quantity_Delivered_Per_BDN__c: 330_000,
    Quantity_in_MT__c: 280.5,
    Unit_of_Measure__c: 'L',
  };
  assert.equal(financialQuantityValue(line, false), 330_800);
  assert.equal(financialQuantityValue(line, true), 330_000);
  assert.equal(nativeFinancialQuantity(line, { stemHasDelivery: true }).unitOfMeasure, 'L');
});

test('financial quantity uses native range midpoint and never density conversion', () => {
  const line = {
    Quantity__c: 1_000,
    Quantity_Max__c: 1_200,
    Quantity_in_MT__c: 980,
    Is_Quantity_Range__c: true,
    UOM__c: 'KL',
  };
  const result = nativeFinancialQuantity(line);
  assert.equal(result.quantity, 1_100);
  assert.equal(result.minimum, 1_000);
  assert.equal(result.maximum, 1_200);
  assert.equal(result.unitOfMeasure, 'KL');
});

test('missing UOM warns but does not infer a converted quantity', () => {
  const result = nativeFinancialQuantity({ Quantity__c: 12, Quantity_in_MT__c: 999 });
  assert.equal(result.quantity, 12);
  assert.match(result.warning, /no unit conversion was inferred/i);
});

test('Broker Commissions keeps native Salesforce UOM in quantities and per-unit labels', async () => {
  const [server, table] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/brokers/BrokerRegisterTable.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /const nativeQuantity = nativeFinancialQuantity\(item/);
  assert.match(server, /quantityUnit,\s*\n\s*deliveryDate/);
  assert.match(server, /`\$\{money\(item\.value\)\} \/ \$\{item\.unit\}`/);
  assert.doesNotMatch(table, /\$\{fmtMoney\(number\)\} \/ MT/);
  assert.match(table, /UOM not set/);
});
