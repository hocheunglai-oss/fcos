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
  supplierInputAmountUsd,
  variableChargeQuantityLabel,
} from '../src/lib/variableChargeRules.js';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Anchorage Dues buyer charge uses the independent NRT-hour default without overwriting an amendment', () => {
  const item = {
    productName: 'ANCHORAGE DUES', fixedCost: 500, fixedPrice: null, hongKongVariableCharges: true,
    anchorageVerification: { buyerDefault: { available: true, amountUsd: 267.51, applyCalculatedDefault: true } },
  };
  assert.equal(isAnchorageDuesItem(item), true);
  assert.equal(isAnchorageDuesItem({ productName: ' anchorage   due ' }), true);
  assert.equal(isAnchorageDuesItem({ productName: 'Agency Fee' }), false);
  assert.equal(isHongKongAnchorageDuesItem(item), true);
  assert.equal(isHongKongAnchorageDuesItem({ ...item, hongKongVariableCharges: false }), false);
  assert.equal(buyerPriceWithAnchorageDefault(item, 'fixed'), 267.51);
  assert.equal(buyerPriceWithAnchorageDefault({
    ...item,
    fixedPrice: 125.5,
    anchorageVerification: { buyerDefault: { available: true, amountUsd: 267.51, applyCalculatedDefault: false } },
  }, 'fixed'), 125.5);
  assert.equal(buyerPriceWithAnchorageDefault({ ...item, anchorageVerification: null }, 'fixed'), '');
  assert.equal(buyerPriceWithAnchorageDefault({ productName: 'Agency Fee', fixedPrice: null }, 'fixed'), '');
});

test('Anchorage Dues uses explicit buyer decisions', () => {
  const hongKongAnchorage = { productName: 'ANCHORAGE DUES', hongKongVariableCharges: true };
  const options = buyerDecisionOptionsForItem(hongKongAnchorage);
  assert.deepEqual(options.map((row) => row.label), ['Pending', 'Charge Buyer', 'Do Not Charge']);
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

test('server applies the independent buyer default and writes zero when Anchorage Dues is excluded', () => {
  const row = {
    Id: 'a042x0000000001AAA', Supplier__c: '0012x0000000001AAA',
    Product2Id__r: { Name: 'ANCHORAGE DUES' }, Lumpsum_Cost__c: 500,
    Lumpsum_Price__c: null, Anchorage_Buyer_Default_USD__c: 267.51,
    LastModifiedDate: '2026-08-27T01:00:00.000+0000',
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
  assert.equal(included.extraCostUpdates[0].buyerPrice, 267.51);
  assert.equal(variableChargeInternals.applyAnchorageBuyerDefaults(
    { extraCostUpdates: [] },
    [{ ...row, Lumpsum_Price__c: 300 }],
    [{ sourceId: row.Id, buyerChargeDecision: 'include' }],
    { hongKongDelivery: true },
  ).extraCostUpdates.length, 0);
  assert.equal(variableChargeInternals.applyAnchorageBuyerDefaults(
    { extraCostUpdates: [] },
    [row],
    [{ sourceId: row.Id, buyerChargeDecision: 'exclude' }],
    { hongKongDelivery: false },
  ).extraCostUpdates.length, 0);
});

test('Anchorage Dues contributes its independent buyer default to financial totals before Salesforce is saved', () => {
  const summary = variableChargeInternals.financialSummary({
    stem: { CurrencyIsoCode: 'HKD', Port__r: { Name: 'HONG KONG', Country__c: 'HONG KONG' } },
    lineItems: [],
    accounts: [{ Id: '0012x0000000001AAA', Name: 'Hong Kong Agent' }],
    extraCosts: [{
      Id: 'a042x0000000001AAA', Supplier__c: '0012x0000000001AAA',
      Product2Id__r: { Name: 'ANCHORAGE DUES' }, Line_Total_Buy__c: 500,
      Lumpsum_Cost__c: 500, Lumpsum_Price__c: 500,
      Line_Total__c: 500, Anchorage_Buyer_Default_USD__c: 267.51, CurrencyIsoCode: 'HKD',
    }],
  });
  assert.equal(summary.buyerChargeTotal, 267.51);
  assert.equal(summary.margin, -232.49);
  assert.equal(summary.chargesComplete, true);
  const amended = variableChargeInternals.financialSummary({
    stem: { CurrencyIsoCode: 'USD', Port__r: { Name: 'HONG KONG' } },
    lineItems: [], accounts: [{ Id: '0012x0000000001AAA', Name: 'Hong Kong Agent' }],
    extraCosts: [{
      Supplier__c: '0012x0000000001AAA', Product2Id__r: { Name: 'ANCHORAGE DUES' },
      Lumpsum_Cost__c: 500, Lumpsum_Price__c: 300, Anchorage_Buyer_Default_USD__c: 267.51,
      CurrencyIsoCode: 'USD',
    }],
  });
  assert.equal(amended.buyerChargeTotal, 300);
});

test('Port Clearance application stepper defaults to one and never decrements below one', () => {
  assert.equal(portClearanceApplicationCount(null), 1);
  assert.equal(portClearanceApplicationCount(0), 1);
  assert.equal(portClearanceApplicationCount(3), 3);
  assert.equal(stepPortClearanceApplicationCount(null, -1), 1);
  assert.equal(stepPortClearanceApplicationCount(1, -1), 1);
  assert.equal(stepPortClearanceApplicationCount(1, 1), 2);
  assert.equal(stepPortClearanceApplicationCount(2, 1), 3);
  assert.equal(variableChargeQuantityLabel({ productName: 'PORT CLEARANCE FEE' }, 1, '1.'), '1 application');
  assert.equal(variableChargeQuantityLabel({ productName: 'PORT CLEARANCE FEE' }, 2, '1.'), '2 applications');
  assert.equal(variableChargeQuantityLabel({ productName: 'OTHER' }, 2, 'MT'), '2 MT');
});

test('HKD supplier inputs are converted to USD before margin calculations', () => {
  assert.equal(supplierInputAmountUsd(1950, 'HKD', 7.84), 1950 / 7.84);
  assert.equal(supplierInputAmountUsd(248.72, 'USD', 7.84), 248.72);
  assert.equal(supplierInputAmountUsd(1950, 'HKD', null), null);
});

test('financial totals derive per-unit costs when Salesforce line totals are stale', () => {
  const summary = variableChargeInternals.financialSummary({
    stem: { CurrencyIsoCode: 'USD' },
    lineItems: [],
    accounts: [{ Id: '0012x0000000001AAA', Name: 'Hong Kong Agent' }],
    extraCosts: [{
      Supplier__c: '0012x0000000001AAA', Quantity__c: 2,
      Unit_Cost__c: 7.4, Unit_Price__c: 7.4,
      Line_Total_Buy__c: 0, Line_Total__c: 0, CurrencyIsoCode: 'USD',
    }],
  });
  assert.equal(summary.supplierCostTotal, 14.8);
  assert.equal(summary.buyerChargeTotal, 14.8);
  assert.equal(summary.margin, 0);
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
  assert.match(component, />Add Extra Cost<\/Button>/);
  assert.match(component, />Remove Extra Cost<\/AlertDialogAction>/);
  assert.match(component, /Agent Agreed Currency/);
  assert.match(service, /Agency_Fee_Currency__c/);
  assert.match(service, /requiredInputCurrency: agentCurrency/);
  assert.match(service, /AGENT_COST_CURRENCY_MISMATCH/);
  assert.match(service, /inputCurrency === 'HKD'[\s\S]*nativeTotal \/ rate/);
});

test('manual Hong Kong support rows inherit the exact supplier Basic Calling Cost defaults', () => {
  const supplierId = '0012x0000000001AAA';
  const basic = {
    Id: 'a04000000000001AAA', Supplier__c: supplierId,
    Product2Id__r: { Name: 'BASIC CALLING COST' },
    Lumpsum_Cost__c: 0, Lumpsum_Price__c: 1000, Line_Total_Buy__c: 0, Line_Total__c: 1000,
  };
  const agency = {
    Id: 'a04000000000002AAA', Supplier__c: supplierId,
    Product2Id__r: { Name: 'AGENCY FEE' },
    Lumpsum_Cost__c: 250, Lumpsum_Price__c: null, Line_Total_Buy__c: 250, Line_Total__c: 0,
    Hong_Kong_Bundle_Managed__c: false,
  };
  const light = {
    Id: 'a04000000000004AAA', Supplier__c: supplierId,
    Product2Id__r: { Name: 'LIGHT DUES' },
    Lumpsum_Cost__c: 202.93, Lumpsum_Price__c: 0, Line_Total_Buy__c: 202.93, Line_Total__c: 0,
    Supplier_Cost_Input_Currency__c: 'USD', Supplier_Cost_Input_Value__c: 202.93,
    Supplier_Cost_USD_HKD_Rate__c: 7.84,
    Hong_Kong_Bundle_Managed__c: false,
  };
  const port = {
    Id: 'a04000000000003AAA', Supplier__c: supplierId,
    Product2Id__r: { Name: 'PORT CLEARANCE FEE' },
    Quantity__c: 2, Unit_Cost__c: 7.4, Unit_Price__c: 0, Line_Total_Buy__c: 14.8,
    Supplier_Cost_Input_Currency__c: 'HKD', Supplier_Cost_Input_Value__c: 58,
    Supplier_Cost_USD_HKD_Rate__c: 7.84,
    Hong_Kong_Bundle_Managed__c: false,
  };
  const live = {
    stem: { Port__r: { Name: 'HONG KONG' } },
    lineItems: [],
    extraCosts: [basic, agency, port, light],
    accounts: [{
      Id: supplierId,
      Name: 'Hong Kong Agent',
      Is_Agent__c: true,
      Agency_Fee_USD__c: 1950,
      Agency_Fee_Currency__c: 'HKD',
    }],
  };
  const settings = { usdHkdRate: 7.84, revision: 4 };
  const supplierIds = variableChargeInternals.basicCallingSupplierIds(live);
  const options = { basicCallingSupplierIds: supplierIds, accountsById: new Map(live.accounts.map((row) => [row.Id, row])) };

  const serializedBasic = variableChargeInternals.serializeLiveRow(basic, 'extra_cost', settings, options);
  const serializedAgency = variableChargeInternals.serializeLiveRow(agency, 'extra_cost', settings, options);
  const serializedPort = variableChargeInternals.serializeLiveRow(port, 'extra_cost', settings, options);
  const serializedLight = variableChargeInternals.serializeLiveRow(light, 'extra_cost', settings, options);
  assert.equal(serializedBasic.buyerDefault.decision, 'include');
  assert.equal(serializedAgency.basicCallingBundleSupport, true);
  assert.equal(serializedAgency.managedBasicCallingBundle, false);
  assert.equal(serializedAgency.supplierCostLocked, true);
  assert.equal(serializedAgency.supplierCurrency.inputCurrency, 'HKD');
  assert.equal(serializedAgency.supplierCurrency.inputAmount, 1950);
  assert.equal(serializedAgency.supplierCurrency.unitOrFixed.usdAmount, 248.72);
  assert.deepEqual(serializedAgency.buyerDefault, { decision: 'exclude', unitOrFixedUsd: 0, totalUsd: 0, locked: true });
  assert.equal(serializedPort.buyerDefault.decision, 'include');
  assert.equal(serializedPort.buyerDefault.unitOrFixedUsd, 3.7);
  assert.equal(serializedPort.productName, 'PORT CLEARANCE EXTENSION');
  assert.equal(serializedPort.supplierCurrency.requiredInputCurrency, 'HKD');
  assert.equal(serializedPort.supplierCurrency.lockedToAgentCurrency, true);
  assert.equal(serializedLight.supplierCurrency.inputCurrency, 'HKD');
  assert.equal(serializedLight.supplierCurrency.inputAmount, 1590.9712);
  assert.equal(serializedLight.supplierCurrency.requiredInputCurrency, 'HKD');
  assert.equal(serializedLight.supplierCurrency.normalizedFromStoredUsd, true);

  const summary = variableChargeInternals.supplierDualCurrencySummary(live, settings).bySupplier[0];
  assert.equal(summary.hkd, 3656.97);
  assert.equal(summary.usd, 466.45);
});

test('server applies Basic Calling, Agency, Port Clearance Extension and Light Dues buyer defaults to legacy manual rows', () => {
  const supplierId = '0012x0000000001AAA';
  const rows = [
    { Id: 'a04000000000001AAA', Supplier__c: supplierId, Product2Id__r: { Name: 'BASIC CALLING COST' }, Lumpsum_Cost__c: 0, Lumpsum_Price__c: 1000, LastModifiedDate: '2026-08-31T00:00:00.000Z' },
    { Id: 'a04000000000002AAA', Supplier__c: supplierId, Product2Id__r: { Name: 'AGENCY FEE' }, Lumpsum_Cost__c: 248.72, Lumpsum_Price__c: null, LastModifiedDate: '2026-08-31T00:00:01.000Z' },
    { Id: 'a04000000000003AAA', Supplier__c: supplierId, Product2Id__r: { Name: 'PORT CLEARANCE FEE' }, Quantity__c: 2, Unit_Cost__c: 7.4, Unit_Price__c: 0, LastModifiedDate: '2026-08-31T00:00:02.000Z' },
    { Id: 'a04000000000004AAA', Supplier__c: supplierId, Product2Id__r: { Name: 'LIGHT DUES' }, Lumpsum_Cost__c: 202.93, Lumpsum_Price__c: null, LastModifiedDate: '2026-08-31T00:00:03.000Z' },
  ];
  const result = variableChargeInternals.applyHongKongBuyerDefaults({
    reviews: rows.map((row) => ({ sourceId: row.Id, reviewed: true, buyerChargeDecision: '' })),
    extraCostUpdates: [],
  }, rows, { hongKongDelivery: true, usdHkdRate: 7.84 });
  const decisions = new Map(result.reviews.map((row) => [row.sourceId, row.buyerChargeDecision]));
  assert.equal(decisions.get(rows[0].Id), 'include');
  assert.equal(decisions.get(rows[1].Id), 'exclude');
  assert.equal(decisions.get(rows[2].Id), 'include');
  assert.equal(decisions.get(rows[3].Id), 'exclude');
  const updates = new Map(result.extraCostUpdates.map((row) => [row.extraCostId, row]));
  assert.equal(updates.get(rows[1].Id).buyerPrice, 0);
  assert.equal(updates.get(rows[2].Id).buyerPrice, 3.7);
  assert.equal(updates.get(rows[3].Id).buyerPrice, 0);
});

test('Anchorage location keeps the Salesforce value while showing the clearer user label', async () => {
  const [component, field] = await Promise.all([
    repositoryFile('src/components/payments/VariableCharges.jsx'),
    repositoryFile('force-app/main/default/objects/STEM_Extra_Cost__c/fields/Anchorage_Location__c.field-meta.xml'),
  ]);
  assert.match(component, /ANCHORAGE_LOCATION_ELSEWHERE_LABEL/);
  assert.match(field, /<fullName>Elsewhere in Hong Kong<\/fullName>[\s\S]*<label>Anywhere except Victoria Port<\/label>/);
});

test('Variable Charges exposes separate supplier statutory and buyer NRT-hour anchorage evidence', async () => {
  const [component, service, readiness, integrationPermission] = await Promise.all([
    repositoryFile('src/components/payments/VariableCharges.jsx'),
    repositoryFile('api/_variableCharges.js'),
    repositoryFile('force-app/main/default/classes/VariableChargeInvoiceReadinessService.cls'),
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_Integration.permissionset-meta.xml'),
  ]);
  assert.match(component, /Supplier <strong>HKD 0\.015 \/ 0\.020 per NRT-hour<\/strong>/);
  assert.match(component, /Buyer <strong>USD 0\.002 per NRT-hour<\/strong>/);
  assert.match(component, /Buyer formula/);
  assert.match(service, /ANCHORAGE_BUYER_RATE_USD_PER_NRT_HOUR/);
  assert.match(service, /Anchorage_Buyer_Default_USD__c/);
  assert.match(readiness, /ANCHORAGE_BUYER_RATE_USD = 0\.002/);
  assert.match(readiness, /Anchorage_Buyer_Calc_Version__c/);
  for (const field of ['Anchorage_Buyer_Default_USD__c', 'Anchorage_Buyer_Rate_USD__c', 'Anchorage_Buyer_Calc_Version__c']) {
    assert.match(integrationPermission, new RegExp(`STEM_Extra_Cost__c\\.${field}`));
  }
});
