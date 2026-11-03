import assert from 'node:assert/strict';
import test from 'node:test';
import { variableChargeInternals as rules } from '../api/_variableCharges.js';

const supplierId = '0012x0000000001AAA';
const nonHongKong = { stem: { Port__r: { Name: 'GIBRALTAR', Country__c: 'GIBRALTAR' } }, accounts: [{ Id: supplierId, Is_Agent__c: true }], extraCosts: [] };

test('non-Hong Kong agent review does not require an account currency or company rate', async () => {
  assert.equal(rules.requiredAgentCurrency(nonHongKong, supplierId), null);
  const context = { get client() { throw new Error('Non-Hong Kong USD review must not load FX settings'); } };
  await rules.assertAgentCostCurrencyReady(nonHongKong, supplierId, context, 'cost');
  const hk = { ...nonHongKong, stem: { Port__r: { Name: 'HONG KONG' } } };
  assert.throws(() => rules.requiredAgentCurrency(hk, supplierId), /Agreed Agency Fee Currency/);
  assert.equal(rules.requiredAgentCurrency({ ...hk, accounts: [{ ...hk.accounts[0], Agency_Fee_Currency__c: 'HKD' }] }, supplierId), 'HKD');
});

test('non-Hong Kong add/edit cost input is USD and cannot silently accept another currency', () => {
  const policy = { hongKongDelivery: false, settings: null };
  for (const input of [{ supplierCost: 123.4567 }, { cost: 0, inputCurrency: 'usd' }, { fixedAmount: -10, supplierInputCurrency: 'USD' }]) {
    const saved = rules.supplierInputForPort(input, policy, 'Supplier cost');
    assert.equal(saved.usdAmount, input.supplierCost ?? input.cost ?? input.fixedAmount);
    assert.equal(saved.fields.Supplier_Cost_Input_Value__c, saved.usdAmount);
    assert.equal(saved.fields.Supplier_Cost_Input_Currency__c, 'USD');
    assert.equal(saved.fields.Supplier_Cost_USD_HKD_Rate__c, null);
    assert.equal(saved.fields.Supplier_Cost_FX_Settings_Revision__c, null);
  }
  for (const input of [{ inputCurrency: 'HKD' }, { supplierInputCurrency: 'HKD' }, { inputCurrency: 'USD', supplierInputCurrency: 'HKD' }, { inputCurrency: 'USDX' }, { inputCurrency: 'EUR' }]) {
    assert.throws(() => rules.supplierInputForPort({ supplierCost: 784, ...input }, policy, 'Supplier cost'), error => error.code === 'NON_HONG_KONG_CURRENCY_UNSUPPORTED');
  }
});

test('Hong Kong cost input retains reviewed company-rate conversion and stale-rate rejection', () => {
  const policy = { hongKongDelivery: true, settings: { usdHkdRate: 7.84, revision: 4 }, requiredCurrency: 'HKD' };
  const input = { supplierCost: 784, inputCurrency: 'HKD', expectedFxSettingsRevision: 4 };
  const saved = rules.supplierInputForPort(input, policy, 'Supplier cost');
  assert.equal(saved.usdAmount, 100);
  assert.equal(saved.fields.Supplier_Cost_Input_Value__c, 784);
  assert.equal(saved.fields.Supplier_Cost_USD_HKD_Rate__c, 7.84);
  assert.throws(() => rules.supplierInputForPort({ ...input, expectedFxSettingsRevision: 3 }, policy, 'Supplier cost'), /rate changed/);
});

test('non-Hong Kong same-name charges are ordinary USD rows with no Hong Kong statutory defaults', () => {
  const settings = { usdHkdRate: 7.84, revision: 4 };
  const options = { hongKongDelivery: false, basicCallingSupplierIds: new Set([supplierId]), accountsById: new Map([[supplierId, { Is_Agent__c: true, Agency_Fee_Currency__c: 'HKD', Agency_Fee_USD__c: 7840 }]]) };
  for (const name of ['AGENCY FEE', 'PORT CLEARANCE FEE', 'PORT CLEARANCE EXTENSION', 'LIGHT DUES', 'ANCHORAGE DUES']) {
    const row = { Id: 'a042x0000000001AAA', Supplier__c: supplierId, Product2Id__r: { Name: name }, Lumpsum_Cost__c: 100, Lumpsum_Price__c: 130, Line_Total_Buy__c: 100, Line_Total__c: 130, Quantity__c: 1, Supplier_Cost_Input_Currency__c: 'HKD', Supplier_Cost_Input_Value__c: 784, Supplier_Cost_USD_HKD_Rate__c: 7.84, Anchorage_Buyer_Default_USD__c: 800 };
    const result = rules.serializeLiveRow(row, 'extra_cost', settings, options);
    assert.equal(result.productName, name);
    assert.equal(result.basicCallingBundleSupport, false);
    assert.equal(result.supplierCostLocked, false);
    assert.equal(result.buyerDefault, null);
    assert.equal(result.portClearance, null);
    assert.equal(result.anchorage, null);
    assert.equal(result.lightDues, null);
    assert.equal(result.supplierCurrency.inputCurrency, 'USD');
    assert.equal(result.supplierCurrency.inputAmount, 100);
    assert.equal(result.supplierCurrency.unitOrFixed.usdAmount, 100);
    assert.equal(result.supplierCurrency.unitOrFixed.hkdAmount, null);
    assert.deepEqual(result.supplierCurrency.recordedEvidence, { inputCurrency: 'HKD', inputAmount: 784, usdHkdRate: 7.84 });
    assert.equal(row.Supplier_Cost_Input_Value__c, 784);
  }
});
