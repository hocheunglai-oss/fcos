import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { variableChargeInternals } from '../api/_variableCharges.js';
import {
  anchorageBuyerTotalAdjustment,
  buyerAmountWithAnchorageDecision,
  buyerDecisionOptionsForItem,
  buyerPriceWithAnchorageDefault,
  isAnchorageDuesItem,
} from '../src/lib/variableChargeRules.js';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Anchorage Dues buyer charge defaults to zero without overwriting an existing charge', () => {
  const item = { productName: 'ANCHORAGE DUES', fixedCost: 500, fixedPrice: null };
  assert.equal(isAnchorageDuesItem(item), true);
  assert.equal(isAnchorageDuesItem({ productName: ' anchorage   due ' }), true);
  assert.equal(isAnchorageDuesItem({ productName: 'Agency Fee' }), false);
  assert.equal(buyerPriceWithAnchorageDefault(item, 'fixed'), 0);
  assert.equal(buyerPriceWithAnchorageDefault({ ...item, fixedPrice: 125.5 }, 'fixed'), 125.5);
  assert.equal(buyerPriceWithAnchorageDefault({ productName: 'Agency Fee', fixedPrice: null }, 'fixed'), '');
});

test('Anchorage Dues uses explicit excess-time buyer decisions', () => {
  const options = buyerDecisionOptionsForItem({ productName: 'ANCHORAGE DUES' });
  assert.deepEqual(options.map((row) => row.label), ['Pending', 'Charge Excess', 'No Charge · 12h or less']);
  assert.deepEqual(
    buyerDecisionOptionsForItem({ productName: 'Agency Fee' }).map((row) => row.label),
    ['Pending', 'Charge Buyer', 'Do Not Charge'],
  );
  assert.equal(buyerAmountWithAnchorageDecision({ productName: 'ANCHORAGE DUES' }, '', 267.51), 0);
  assert.equal(buyerAmountWithAnchorageDecision({ productName: 'ANCHORAGE DUES' }, 'exclude', 267.51), 0);
  assert.equal(buyerAmountWithAnchorageDecision({ productName: 'ANCHORAGE DUES' }, 'include', 267.51), 267.51);
  assert.equal(buyerAmountWithAnchorageDecision({ productName: 'Agency Fee' }, '', 900), 900);
  assert.equal(anchorageBuyerTotalAdjustment([
    { item: { productName: 'ANCHORAGE DUES' }, decision: '', currentTotal: 267.51 },
    { item: { productName: 'ANCHORAGE DUES' }, decision: 'include', currentTotal: 100 },
    { item: { productName: 'Agency Fee' }, decision: '', currentTotal: 900 },
  ]), -267.51);
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
  ).extraCostUpdates.length, 0);
  assert.equal(variableChargeInternals.applyAnchorageBuyerDefaults(
    { extraCostUpdates: [] },
    [row],
    [{ sourceId: row.Id, buyerChargeDecision: 'include' }],
  ).extraCostUpdates.length, 0);
});

test('Anchorage Dues contributes a zero buyer charge to financial totals before Salesforce is saved', () => {
  const summary = variableChargeInternals.financialSummary({
    stem: { CurrencyIsoCode: 'HKD' },
    lineItems: [],
    accounts: [{ Id: '0012x0000000001AAA', Name: 'Hong Kong Agent' }],
    extraCosts: [{
      Id: 'a042x0000000001AAA', Supplier__c: '0012x0000000001AAA',
      Product2Id__r: { Name: 'ANCHORAGE DUES' }, Line_Total_Buy__c: 500,
      Line_Total__c: null, CurrencyIsoCode: 'HKD',
    }],
  });
  assert.equal(summary.buyerChargeTotal, 0);
  assert.equal(summary.margin, -500);
  assert.equal(summary.chargesComplete, true);
});

test('Is Variable is a history-tracked Account field placed beside Is Agent in both Account forms', async () => {
  const [field, controller, recordMarkup, recordController, newMarkup, userPermission, integrationPermission] = await Promise.all([
    repositoryFile('force-app/main/default/objects/Account/fields/Is_Variable__c.field-meta.xml'),
    repositoryFile('force-app/main/default/classes/AccountController.cls'),
    repositoryFile('force-app/main/default/lwc/fcbAccountRecordType/fcbAccountRecordType.html'),
    repositoryFile('force-app/main/default/lwc/fcbAccountRecordType/fcbAccountRecordType.js'),
    repositoryFile('force-app/main/default/lwc/fcbNewAccountOverride/fcbNewAccountOverride.html'),
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_User.permissionset-meta.xml'),
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_Integration.permissionset-meta.xml'),
  ]);
  assert.match(field, /<fullName>Is_Variable__c<\/fullName>/);
  assert.match(field, /<label>Is Variable<\/label>/);
  assert.match(field, /<trackHistory>true<\/trackHistory>/);
  assert.match(controller, /Is_Agent__c, Is_Variable__c, Is_Broker__c/);
  assert.ok(recordMarkup.indexOf('name="isAgent"') < recordMarkup.indexOf('name="isVariable"'));
  assert.ok(recordMarkup.indexOf('name="isVariable"') < recordMarkup.indexOf('name="isBroker"'));
  assert.ok(newMarkup.indexOf('field-name="Is_Agent__c"') < newMarkup.indexOf('field-name="Is_Variable__c"'));
  assert.ok(newMarkup.indexOf('field-name="Is_Variable__c"') < newMarkup.indexOf('field-name="Is_Broker__c"'));
  assert.match(recordController, /fields\["Is_Variable__c"\] = this\.isVariable/);
  assert.match(userPermission, /Account\.Is_Variable__c/);
  assert.match(integrationPermission, /Account\.Is_Variable__c/);
});
