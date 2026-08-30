import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LIGHT_DUES_CATEGORY_ALL_OTHER,
  LIGHT_DUES_CATEGORY_RIVER_TRADE,
  calculateHongKongLightDues,
  convertHkdToUsd,
  supplierDualCurrency,
} from '../src/lib/lightDues.js';
import { variableChargeInternals } from '../api/_variableCharges.js';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

for (const [nrt, units] of [[100, 1], [101, 2], [7000, 70], [7001, 71]]) {
  test(`Light Dues rounds ${nrt} NRT to ${units} statutory unit(s)`, () => {
    const result = calculateHongKongLightDues({ nrt, category: LIGHT_DUES_CATEGORY_ALL_OTHER, entryDate: '2026-08-28' });
    assert.equal(result.complete, true);
    assert.equal(result.hundredNrtUnits, units);
    assert.equal(result.amountHkd, units * 43);
  });
}

test('river-trade and acceptance calculations use the statutory rates', () => {
  assert.equal(calculateHongKongLightDues({ nrt: 7000, category: LIGHT_DUES_CATEGORY_ALL_OTHER, entryDate: '2026-08-28' }).amountHkd, 3010);
  assert.equal(calculateHongKongLightDues({ nrt: 7000, category: LIGHT_DUES_CATEGORY_RIVER_TRADE, entryDate: '2026-08-28' }).amountHkd, 1260);
  assert.equal(convertHkdToUsd(3010, 7.84), 383.93);
});

test('missing NRT, category or entry date fails closed', () => {
  assert.equal(calculateHongKongLightDues({ nrt: null, category: LIGHT_DUES_CATEGORY_ALL_OTHER, entryDate: '2026-08-28' }).complete, false);
  assert.equal(calculateHongKongLightDues({ nrt: 7000, category: 'Light Diesel Oil', entryDate: '2026-08-28' }).complete, false);
  assert.equal(calculateHongKongLightDues({ nrt: 7000, category: LIGHT_DUES_CATEGORY_ALL_OTHER }).complete, false);
});

test('only the exact active LIGHT DUES product is statutory evidence', () => {
  assert.equal(variableChargeInternals.isLightDuesRow({ Product2Id__r: { Name: 'LIGHT DUES', IsActive: true } }), true);
  assert.equal(variableChargeInternals.isLightDuesRow({ Product2Id__r: { Name: 'LIGHT DUES', IsActive: false } }), false);
  assert.equal(variableChargeInternals.isLightDuesRow({ Product2Id__r: { Name: 'LIGHT DIESEL OIL', IsActive: true } }), false);
});

test('supplier dual currency preserves reviewed rates and labels legacy current rates', () => {
  assert.deepEqual(supplierDualCurrency({ usdAmount: 100, savedRate: 7.84, currentRate: 7.9 }), {
    complete: true, usdAmount: 100, hkdAmount: 784, rate: 7.84, basis: 'reviewed_rate',
  });
  assert.equal(supplierDualCurrency({ usdAmount: 100, currentRate: 7.84 }).basis, 'current_rate');
  assert.equal(supplierDualCurrency({ usdAmount: 100, currentRate: 7.84 }).hkdAmount, 784);
});

test('Salesforce metadata and FCOS handlers include governed Light Dues and supplier currency evidence', async () => {
  const [integration, service, handlers, objectMetadata] = await Promise.all([
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_Integration.permissionset-meta.xml'),
    repositoryFile('api/_variableCharges.js'),
    repositoryFile('api/functions/[name].js'),
    repositoryFile('force-app/main/default/objects/STEM_Extra_Cost__c/STEM_Extra_Cost__c.object-meta.xml'),
  ]);
  for (const field of [
    'Supplier_Cost_Input_Currency__c', 'Supplier_Cost_Input_Value__c', 'Supplier_Cost_USD_HKD_Rate__c',
    'Supplier_Cost_FX_Settings_Revision__c', 'Light_Dues_Entry_Date__c', 'Light_Dues_Category__c',
    'Light_Dues_NRT_Snapshot__c', 'Light_Dues_Rate_HKD__c', 'Light_Dues_Amount_HKD__c',
    'Light_Dues_USD_HKD_Rate__c', 'Light_Dues_FX_Settings_Revision__c', 'Light_Dues_Calculation_Version__c',
  ]) {
    assert.match(integration, new RegExp(`STEM_Extra_Cost__c\\.${field}`));
    assert.match(service, new RegExp(field));
  }
  assert.match(service, /productName === 'LIGHT DUES'/);
  assert.doesNotMatch(service, /productName === 'LIGHT DIESEL OIL'/);
  assert.match(handlers, /variableChargesVesselNrtSave/);
  assert.match(handlers, /variableChargesLightDuesSave/);
  assert.match(objectMetadata, /<enableHistory>true<\/enableHistory>/);
});
