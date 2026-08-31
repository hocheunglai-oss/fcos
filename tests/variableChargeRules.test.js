import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { variableChargeInternals } from '../api/_variableCharges.js';
import {
  anchorageBuyerTotalAdjustment,
  buyerAmountWithAnchorageDecision,
  buyerDecisionOptionsForItem,
  buyerPriceWithAnchorageDefault,
  canApproveBothVariableChargeLegs,
  isAnchorageDuesItem,
  isHongKongAnchorageDuesItem,
  portClearanceApplicationCount,
  statutorySupplierHkdDefault,
  stepPortClearanceApplicationCount,
} from '../src/lib/variableChargeRules.js';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Anchorage Dues buyer charge defaults to the reviewed supplier charge without overwriting an existing charge', () => {
  const item = { productName: 'ANCHORAGE DUES', fixedCost: 500, fixedPrice: null, hongKongVariableCharges: true };
  assert.equal(isAnchorageDuesItem(item), true);
  assert.equal(isAnchorageDuesItem({ productName: ' anchorage   due ' }), true);
  assert.equal(isAnchorageDuesItem({ productName: 'Agency Fee' }), false);
  assert.equal(isHongKongAnchorageDuesItem(item), true);
  assert.equal(isHongKongAnchorageDuesItem({ ...item, hongKongVariableCharges: false }), false);
  assert.equal(buyerPriceWithAnchorageDefault(item, 'fixed'), 500);
  assert.equal(buyerPriceWithAnchorageDefault({ ...item, fixedPrice: 125.5 }, 'fixed'), 125.5);
  assert.equal(buyerPriceWithAnchorageDefault({ productName: 'Agency Fee', fixedPrice: null }, 'fixed'), '');
});

test('Anchorage Dues uses explicit pass-through buyer decisions', () => {
  const hongKongAnchorage = { productName: 'ANCHORAGE DUES', hongKongVariableCharges: true };
  const options = buyerDecisionOptionsForItem(hongKongAnchorage);
  assert.deepEqual(options.map((row) => row.label), ['Pending', 'Pass Through', 'No Supplier Charge']);
  assert.deepEqual(
    buyerDecisionOptionsForItem({ productName: 'Agency Fee' }).map((row) => row.label),
    ['Pending', 'Charge Buyer', 'Do Not Charge'],
  );
  assert.equal(buyerAmountWithAnchorageDecision(hongKongAnchorage, '', 267.51), 0);
  assert.equal(buyerAmountWithAnchorageDecision(hongKongAnchorage, 'exclude', 267.51), 0);
  assert.equal(buyerAmountWithAnchorageDecision(hongKongAnchorage, 'include', 267.51), 267.51);
  assert.equal(buyerAmountWithAnchorageDecision({ productName: 'Agency Fee' }, '', 900), 900);
  assert.equal(anchorageBuyerTotalAdjustment([
    { item: hongKongAnchorage, decision: '', currentTotal: 267.51 },
    { item: hongKongAnchorage, decision: 'include', currentTotal: 100 },
    { item: { productName: 'Agency Fee' }, decision: '', currentTotal: 900 },
  ]), -267.51);
  assert.deepEqual(
    buyerDecisionOptionsForItem({ productName: 'ANCHORAGE DUES', hongKongVariableCharges: false }).map((row) => row.label),
    ['Pending', 'Charge Buyer', 'Do Not Charge'],
  );
});

test('server writes a zero buyer price when excluded Anchorage Dues has no zero stored', () => {
  const row = {
    Id: 'a042x0000000001AAA', Supplier__c: '0012x0000000001AAA',
    Product2Id__r: { Name: 'ANCHORAGE DUES' }, Lumpsum_Cost__c: 500,
    Lumpsum_Price__c: null, LastModifiedDate: '2026-08-27T01:00:00.000+0000',
  };
  const result = variableChargeInternals.applyAnchorageBuyerDefaults(
    { extraCostUpdates: [] },
    [row],
    [{ sourceId: row.Id, buyerChargeDecision: 'exclude' }],
    { hongKongDelivery: true },
  );
  assert.deepEqual(result.extraCostUpdates, [{
    extraCostId: row.Id,
    expectedLastModifiedDate: row.LastModifiedDate,
    pricingType: 'fixed',
    buyerPrice: 0,
  }]);
  assert.equal(variableChargeInternals.applyAnchorageBuyerDefaults(
    { extraCostUpdates: [] },
    [{ ...row, Lumpsum_Price__c: 0 }],
    [{ sourceId: row.Id, buyerChargeDecision: 'exclude' }],
    { hongKongDelivery: true },
  ).extraCostUpdates.length, 0);
  const included = variableChargeInternals.applyAnchorageBuyerDefaults(
    { extraCostUpdates: [] },
    [row],
    [{ sourceId: row.Id, buyerChargeDecision: 'include' }],
    { hongKongDelivery: true },
  );
  assert.equal(included.extraCostUpdates.length, 1);
  assert.equal(included.extraCostUpdates[0].buyerPrice, 500);
  assert.equal(variableChargeInternals.applyAnchorageBuyerDefaults(
    { extraCostUpdates: [] },
    [row],
    [{ sourceId: row.Id, buyerChargeDecision: 'exclude' }],
    { hongKongDelivery: false },
  ).extraCostUpdates.length, 0);
});

test('Anchorage Dues contributes its supplier pass-through to financial totals before Salesforce is saved', () => {
  const summary = variableChargeInternals.financialSummary({
    stem: { CurrencyIsoCode: 'HKD', Port__r: { Name: 'HONG KONG', Country__c: 'HONG KONG' } },
    lineItems: [],
    accounts: [{ Id: '0012x0000000001AAA', Name: 'Hong Kong Agent' }],
    extraCosts: [{
      Id: 'a042x0000000001AAA', Supplier__c: '0012x0000000001AAA',
      Product2Id__r: { Name: 'ANCHORAGE DUES' }, Line_Total_Buy__c: 500,
      Line_Total__c: null, CurrencyIsoCode: 'HKD',
    }],
  });
  assert.equal(summary.buyerChargeTotal, 500);
  assert.equal(summary.margin, 0);
  assert.equal(summary.chargesComplete, true);
});

test('Port Clearance application stepper defaults to one and never decrements below one', () => {
  assert.equal(portClearanceApplicationCount(null), 1);
  assert.equal(portClearanceApplicationCount(0), 1);
  assert.equal(portClearanceApplicationCount(3), 3);
  assert.equal(stepPortClearanceApplicationCount(null, -1), 1);
  assert.equal(stepPortClearanceApplicationCount(1, -1), 1);
  assert.equal(stepPortClearanceApplicationCount(1, 1), 2);
  assert.equal(stepPortClearanceApplicationCount(2, 1), 3);
});

test('calculated Light and Anchorage Dues prefill an otherwise empty Supplier Leg in HKD', () => {
  assert.deepEqual(statutorySupplierHkdDefault({
    productName: 'LIGHT DUES',
    hongKongVariableCharges: true,
    fixedCost: 0,
    supplierCurrency: { inputAmount: null },
    lightDuesVerification: { calculation: { complete: true, amountHkd: 3010 } },
  }), { amountHkd: 3010, source: 'light_dues_calculation' });
  assert.deepEqual(statutorySupplierHkdDefault({
    productName: 'ANCHORAGE DUES',
    hongKongVariableCharges: true,
    fixedCost: 0,
    supplierCurrency: { inputAmount: null },
    anchorageVerification: { allocationHkd: 2520 },
  }), { amountHkd: 2520, source: 'anchorage_dues_calculation' });
  assert.deepEqual(statutorySupplierHkdDefault({
    productName: 'ANCHORAGE DUES',
    hongKongVariableCharges: true,
    fixedCost: 0,
    supplierCurrency: { inputAmount: null },
    anchorageVerification: { allocationHkd: 0 },
  }), { amountHkd: 0, source: 'anchorage_dues_calculation' });
  assert.equal(statutorySupplierHkdDefault({
    productName: 'LIGHT DUES',
    hongKongVariableCharges: true,
    fixedCost: 100,
    lightDuesVerification: { calculation: { complete: true, amountHkd: 3010 } },
  }), null);
  assert.equal(statutorySupplierHkdDefault({
    productName: 'LIGHT DUES',
    hongKongVariableCharges: true,
    fixedCost: 0,
    supplierCurrency: { inputAmount: 0 },
    lightDuesVerification: { calculation: { complete: true, amountHkd: 3010 } },
  }), null);
});

test('General Manager review of both legs enables one atomic approval without changing assignments', () => {
  assert.equal(canApproveBothVariableChargeLegs({
    commonOwner: false,
    reviewingBothAsGeneralManager: true,
    bothOpen: true,
    canCostEdit: true,
    canBuyerEdit: true,
  }), true);
  assert.equal(canApproveBothVariableChargeLegs({
    commonOwner: false,
    reviewingBothAsGeneralManager: false,
    bothOpen: true,
    canCostEdit: true,
    canBuyerEdit: true,
  }), false);
  assert.equal(canApproveBothVariableChargeLegs({
    commonOwner: false,
    reviewingBothAsGeneralManager: true,
    bothOpen: true,
    canCostEdit: true,
    canBuyerEdit: false,
  }), false);
});

test('Is Variable triggers review globally while Hong Kong charge rules remain port-specific', () => {
  assert.equal(variableChargeInternals.isVariableChargeAccount({ Is_Agent__c: false, Is_Variable__c: true }), true);
  assert.equal(variableChargeInternals.isVariableChargeAccount({ Is_Agent__c: false, Is_Variable__c: false }), false);
  assert.equal(variableChargeInternals.isHongKongStem({ Port__r: { Name: 'HONG KONG' } }), true);
  assert.equal(variableChargeInternals.isHongKongStem({ Port__r: { Country__c: 'Hong Kong' } }), true);
  assert.equal(variableChargeInternals.isHongKongStem({ Port__r: { Name: 'SINGAPORE', Country__c: 'SINGAPORE' } }), false);
});

test('Is Variable and native-currency Agency Fee fields are placed and persisted consistently', async () => {
  const [field, agencyCurrencyField, controller, recordMarkup, recordController, newMarkup, newController, userPermission, integrationPermission] = await Promise.all([
    repositoryFile('force-app/main/default/objects/Account/fields/Is_Variable__c.field-meta.xml'),
    repositoryFile('force-app/main/default/objects/Account/fields/Agency_Fee_Currency__c.field-meta.xml'),
    repositoryFile('force-app/main/default/classes/AccountController.cls'),
    repositoryFile('force-app/main/default/lwc/fcbAccountRecordType/fcbAccountRecordType.html'),
    repositoryFile('force-app/main/default/lwc/fcbAccountRecordType/fcbAccountRecordType.js'),
    repositoryFile('force-app/main/default/lwc/fcbNewAccountOverride/fcbNewAccountOverride.html'),
    repositoryFile('force-app/main/default/lwc/fcbNewAccountOverride/fcbNewAccountOverride.js'),
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_User.permissionset-meta.xml'),
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_Integration.permissionset-meta.xml'),
  ]);
  assert.match(field, /<fullName>Is_Variable__c<\/fullName>/);
  assert.match(field, /<label>Is Variable<\/label>/);
  assert.match(field, /<trackHistory>true<\/trackHistory>/);
  assert.match(agencyCurrencyField, /<fullName>Agency_Fee_Currency__c<\/fullName>/);
  assert.match(agencyCurrencyField, /<fullName>USD<\/fullName>[\s\S]*<fullName>HKD<\/fullName>/);
  assert.match(controller, /Is_Agent__c, Is_Variable__c, Agency_Fee_USD__c, Agency_Fee_Currency__c, Is_Broker__c/);
  assert.ok(recordMarkup.indexOf('name="isAgent"') < recordMarkup.indexOf('name="isVariable"'));
  assert.ok(recordMarkup.indexOf('name="isAgent"') < recordMarkup.indexOf('name="agencyFeeUsd"'));
  assert.ok(recordMarkup.indexOf('name="agencyFeeUsd"') < recordMarkup.indexOf('name="agencyFeeCurrency"'));
  assert.match(recordMarkup, /<template if:true=\{isAgent\}>[\s\S]*name="agencyFeeUsd"[\s\S]*name="agencyFeeCurrency"[\s\S]*<\/template>/);
  assert.ok(recordMarkup.indexOf('name="isVariable"') < recordMarkup.indexOf('name="isBroker"'));
  assert.ok(newMarkup.indexOf('field-name="Is_Agent__c"') < newMarkup.indexOf('field-name="Is_Variable__c"'));
  assert.match(newMarkup, /<template if:true=\{isAgent\}>[\s\S]*Agency_Fee_USD__c[\s\S]*Agency_Fee_Currency__c[\s\S]*<\/template>/);
  assert.ok(newMarkup.indexOf('field-name="Is_Variable__c"') < newMarkup.indexOf('field-name="Is_Broker__c"'));
  assert.match(recordController, /fields\["Is_Variable__c"\] = this\.isVariable/);
  assert.match(recordController, /fields\["Agency_Fee_Currency__c"\] = this\.agencyFeeCurrency/);
  assert.match(newController, /attribute === 'Is_Agent__c'[\s\S]*this\.isAgent = event\.target\.value/);
  assert.match(recordController, /showSaveButton\(\)[\s\S]*this\.isVariable !== this\.savedIsVariable/);
  assert.match(userPermission, /Account\.Is_Variable__c/);
  assert.match(userPermission, /Account\.Agency_Fee_Currency__c/);
  assert.match(integrationPermission, /Account\.Is_Variable__c/);
  assert.match(integrationPermission, /Account\.Agency_Fee_Currency__c/);
});

test('Variable Charges presents native-HKD selected totals and removes duplicated leg-header totals', async () => {
  const [component, service] = await Promise.all([
    repositoryFile('src/components/payments/VariableCharges.jsx'),
    repositoryFile('api/_variableCharges.js'),
  ]);
  assert.match(component, /agencyFeeCurrency === 'HKD'[\s\S]*about \$\{formatMoney\(total\.usd, 'USD'\)\}/);
  assert.doesNotMatch(component, /<LegHeader[^>]+totalLabel="Total Supplier Cost"/);
  assert.doesNotMatch(component, /<LegHeader[^>]+totalLabel="Total Buyer Charge"/);
  assert.match(service, /Agency_Fee_Currency__c/);
  assert.match(service, /inputCurrency === 'HKD'[\s\S]*nativeTotal \/ rate/);
});
