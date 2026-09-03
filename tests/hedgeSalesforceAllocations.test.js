import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { allocateHedgeSalesforceAmounts, mergeHedgeSalesforceMapping } from '../api/_hedgeSalesforce.js';
import { allocateGrossPnlAcrossPhysicals, allocateVenueHedgeResultAcrossPhysicals, physicalHedgeSalesforceManagedState, physicalHedgeSalesforceWriteBody } from '../api/_hedgePhysicalSalesforce.js';
import { sanitizeRichText } from '../api/_richText.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('allocates final net P&L by STEM and applies the rounding residual to the last allocation', () => {
  const rows = allocateHedgeSalesforceAmounts({ grossPnl: 100, feeAmount: 1, shares: [1 / 3, 2 / 3] });
  assert.deepEqual(rows, [
    { share: 1 / 3, grossPnl: 33.33, feeAmount: 0.33, netPnl: 33, salesforceCost: -33 },
    { share: 2 / 3, grossPnl: 66.67, feeAmount: 0.67, netPnl: 66, salesforceCost: -66 },
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.netPnl, 0), 99);
  assert.equal(rows.reduce((sum, row) => sum + row.salesforceCost, 0), -99);
});

test('ICE Physical Trade Salesforce costs use allocated gross hedge P&L and exclude separately billed fees', () => {
  const rows = allocateGrossPnlAcrossPhysicals({
    grossPnl: 100,
    sgoRatio: 7.45,
    physicals: [
      { id: 'one', qty_min: 100, qty_max: 100, unit: 'MT' },
      { id: 'two', qty_min: 200, qty_max: 200, unit: 'MT' },
    ],
  });
  assert.deepEqual(rows.map(({ physicalTradeId, grossPnl, salesforceCost }) => ({ physicalTradeId, grossPnl, salesforceCost })), [
    { physicalTradeId: 'one', grossPnl: 33.33, salesforceCost: -33.33 },
    { physicalTradeId: 'two', grossPnl: 66.67, salesforceCost: -66.67 },
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.grossPnl, 0), 100);
  assert.equal(rows.reduce((sum, row) => sum + row.directCosts, 0), 0);
  assert.equal(rows.reduce((sum, row) => sum + row.netPnl, 0), 100);

  const ranged = allocateGrossPnlAcrossPhysicals({
    grossPnl: -25,
    sgoRatio: 7.45,
    physicals: [
      { id: 'range', qty_min: 100, qty_max: 200, unit: 'MT' },
      { id: 'fixed', qty_min: 50, qty_max: 50, unit: 'MT' },
    ],
  });
  assert.deepEqual(ranged.map(({ physicalTradeId, weight, grossPnl, salesforceCost }) => ({ physicalTradeId, weight, grossPnl, salesforceCost })), [
    { physicalTradeId: 'range', weight: 150, grossPnl: -18.75, salesforceCost: 18.75 },
    { physicalTradeId: 'fixed', weight: 50, grossPnl: -6.25, salesforceCost: 6.25 },
  ]);

});

test('FCBS Physical Trade Salesforce costs include direct FCBS charges with deterministic allocation', () => {
  const rows = allocateVenueHedgeResultAcrossPhysicals({
    venue: 'FCBS',
    grossPnl: 100,
    directCostAmount: 1,
    sgoRatio: 7.45,
    physicals: [
      { id: 'one', qty_min: 100, qty_max: 100, unit: 'MT' },
      { id: 'two', qty_min: 200, qty_max: 200, unit: 'MT' },
    ],
  });
  assert.deepEqual(rows.map(({ physicalTradeId, grossPnl, directCosts, netPnl, salesforceCost }) => ({ physicalTradeId, grossPnl, directCosts, netPnl, salesforceCost })), [
    { physicalTradeId: 'one', grossPnl: 33.33, directCosts: 0.33, netPnl: 33, salesforceCost: -33 },
    { physicalTradeId: 'two', grossPnl: 66.67, directCosts: 0.67, netPnl: 66, salesforceCost: -66 },
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.grossPnl, 0), 100);
  assert.equal(rows.reduce((sum, row) => sum + row.directCosts, 0), 1);
  assert.equal(rows.reduce((sum, row) => sum + row.netPnl, 0), 99);
  assert.equal(rows.reduce((sum, row) => sum + row.salesforceCost, 0), -99);

  const loss = allocateVenueHedgeResultAcrossPhysicals({
    venue: 'FCBS',
    grossPnl: -25,
    directCostAmount: 1,
    sgoRatio: 7.45,
    physicals: [
      { id: 'range', qty_min: 100, qty_max: 200, unit: 'MT' },
      { id: 'fixed', qty_min: 50, qty_max: 50, unit: 'MT' },
    ],
  });
  assert.deepEqual(loss.map(({ physicalTradeId, grossPnl, directCosts, netPnl, salesforceCost }) => ({ physicalTradeId, grossPnl, directCosts, netPnl, salesforceCost })), [
    { physicalTradeId: 'range', grossPnl: -18.75, directCosts: 0.75, netPnl: -19.5, salesforceCost: 19.5 },
    { physicalTradeId: 'fixed', grossPnl: -6.25, directCosts: 0.25, netPnl: -6.5, salesforceCost: 6.5 },
  ]);

  const service = read('api/_hedgePhysicalSalesforce.js');
  const physical = read('src/hedge/views/PhysicalView.jsx');
  const hedges = read('src/hedge/views/HedgesView.jsx');
  assert.match(service, /loaded\.inputs\.swap\.venue === 'FCBS' \? loaded\.financials\.feeAmount : 0/);
  assert.match(service, /salesforceCost: roundMoney\(-\(grossRows\[index\] - directCostRows\[index\]\)\)/);
  assert.match(service, /FCOS final net FCBS hedge result/);
  assert.doesNotMatch(service, /current_margin/);
  assert.match(physical, /Salesforce hedge result/);
  assert.match(physical, /FCBS direct costs included/);
  assert.match(physical, /Billed directly by FCBS/);
  assert.match(physical, /Confirm add/);
  assert.doesNotMatch(hedges, /Preview Salesforce allocation|Synchronize all allocations/);
});

test('Physical Trade synchronization uses the approved mapping, external key and one all-or-none Composite transaction', () => {
  const legacy = read('api/_hedgeSalesforce.js');
  const service = read('api/_hedgePhysicalSalesforce.js');
  const field = read('force-app/main/default/objects/STEM_Extra_Cost__c/fields/FCOS_Hedge_Allocation_Key__c.field-meta.xml');
  assert.match(legacy, /productId: '01tfu000002zAEDAA2'/);
  assert.match(legacy, /recordTypeId: '0122x000000cwlgAAA'/);
  assert.match(legacy, /supplierId: '001fu00000Zo8eHAAR'/);
  assert.match(legacy, /supplierId: '0012x00000LGhzUAAT'/);
  assert.match(legacy, /paymentTerm: '7 I'/);
  assert.match(legacy, /externalKeyField: 'FCOS_Hedge_Allocation_Key__c'/);
  assert.match(legacy, /uomField: 'Unit_of_Measure__c'/);
  assert.match(legacy, /unitOfMeasure: '1\.'/);
  assert.match(legacy, /orderedQuantityField: 'Quantity__c'/);
  assert.match(legacy, /quantity: 0/);
  assert.match(legacy, /\[config\.orderedQuantityField\]: config\.quantity/);
  assert.match(legacy, /\[config\.quantityField\]: config\.quantity/);
  assert.match(legacy, /\[config\.uomField\]: config\.unitOfMeasure/);
  assert.match(field, /<externalId>true<\/externalId>/);
  assert.match(field, /<unique>true<\/unique>/);
  assert.match(field, /<trackHistory>false<\/trackHistory>/);
  assert.match(service, /allOrNone: true, compositeRequest: requests/);
  assert.match(service, /\[config\.uomField\]: config\.unitOfMeasure/);
  assert.match(service, /record\?\.\[config\.uomField\] !== config\.unitOfMeasure/);
  assert.match(service, /previewFingerprint/);
  assert.match(service, /sfQueryAll/);
  assert.match(service, /row\.unmanagedCandidate \? null : row\.salesforceRecordId/);
  assert.match(service, /salesforceWritePerformed: false/);
  assert.match(service, /\['create', 'recreate'\]\.includes\(item\.rowAction\) \? response\?\.body\?\.id : item\.row\.salesforceRecordId/);
  assert.match(service, /function physicalHedgeSalesforceManagedState[\s\S]*config\.buyerInvoiceField[\s\S]*record\?\.IsDeleted === true[\s\S]*function resolveSalesforce/);
});

test('venue supplier mappings cannot be overridden by saved Hedge settings', () => {
  const mapping = mergeHedgeSalesforceMapping({
    mappingRevision: 99,
    venues: {
      ICE: { supplierId: '0012x00000LGhzUAAT', supplierName: 'Wrong ICE supplier', paymentTerm: '30 I' },
      FCBS: { supplierId: '001fu00000Zo8eHAAR', supplierName: 'Wrong FCBS supplier', supplierClKey: 'WRONG', paymentTerm: '60 I' },
    },
  });

  assert.equal(mapping.venues.ICE.supplierId, '001fu00000Zo8eHAAR');
  assert.equal(mapping.venues.ICE.supplierName, 'STRAITS FINANCIAL SERVICES PTE LTD');
  assert.equal(mapping.venues.ICE.paymentTerm, '7 I');
  assert.equal(mapping.venues.FCBS.supplierId, '0012x00000LGhzUAAT');
  assert.equal(mapping.venues.FCBS.supplierName, 'FRATELLI COSULICH BUNKERS (S) PTE LTD');
  assert.equal(mapping.venues.FCBS.supplierClKey, 'HKFCBS');
  assert.equal(mapping.venues.FCBS.paymentTerm, '7 I');
  assert.equal(mapping.mappingRevision, 99);
});

test('wrong FCBS suppliers require an update unless the Salesforce row is invoice-locked', () => {
  const config = {
    buyerInvoiceField: 'Buyer_Invoice__c',
    supplierInvoiceField: 'Supplier_Invoice__c',
    cancelledField: 'Cancelled__c',
    stemLookupField: 'STEM__c',
    productLookupField: 'Product2Id__c',
    productId: 'swaps-product',
    supplierLookupField: 'Supplier__c',
    uomField: 'Unit_of_Measure__c',
    unitOfMeasure: '1.',
    orderedQuantityField: 'Quantity__c',
    quantityField: 'Quantity_Delivered_Per_BDN__c',
    quantity: 0,
    amountField: 'Lumpsum_Cost__c',
  };
  const row = {
    salesforceStemId: 'stem',
    supplierAccountId: '0012x00000LGhzUAAT',
    supplierName: 'FRATELLI COSULICH BUNKERS (S) PTE LTD',
    salesforceCost: 100,
  };
  const wrongSupplier = {
    STEM__c: 'stem',
    Product2Id__c: 'swaps-product',
    Supplier__c: '001fu00000Zo8eHAAR',
    Unit_of_Measure__c: '1.',
    Quantity__c: 0,
    Quantity_Delivered_Per_BDN__c: 0,
    Lumpsum_Cost__c: 100,
  };

  assert.deepEqual(physicalHedgeSalesforceManagedState(wrongSupplier, row, config), {
    state: 'update_required',
    issue: 'The Salesforce supplier must be corrected to FRATELLI COSULICH BUNKERS (S) PTE LTD.',
  });
  assert.equal(physicalHedgeSalesforceManagedState({ ...wrongSupplier, Buyer_Invoice__c: 'invoice' }, row, config).state, 'locked_by_invoice');
});

test('Physical Trade updates never PATCH the immutable Salesforce STEM parent', () => {
  const config = {
    amountField: 'Lumpsum_Cost__c',
    descriptionField: 'Description__c',
    externalKeyField: 'FCOS_Hedge_Allocation_Key__c',
    uomField: 'Unit_of_Measure__c',
    unitOfMeasure: '1.',
    productLookupField: 'Product2Id__c',
    productId: 'product',
    supplierLookupField: 'Supplier__c',
    fixedField: 'Fixed__c',
    orderedQuantityField: 'Quantity__c',
    quantityField: 'Quantity_Delivered_Per_BDN__c',
    quantity: 0,
    paymentTermField: 'Payment_Term__c',
    stemLookupField: 'STEM__c',
    recordTypeId: 'record-type',
    venues: { ICE: { paymentTerm: '7 I' }, FCBS: { paymentTerm: '7 I' } },
  };
  const row = {
    venue: 'ICE',
    salesforceCost: 125.5,
    description: 'Final gross hedge result',
    salesforceStemId: 'stem',
    supplierAccountId: '001fu00000Zo8eHAAR',
  };

  for (const rowAction of ['update', 'adopt', 'restore']) {
    const body = physicalHedgeSalesforceWriteBody({ rowAction, row, config, allocationKey: 'allocation' });
    assert.equal(body.STEM__c, undefined, `${rowAction} must not PATCH the non-reparentable master-detail field`);
    assert.equal(body.RecordTypeId, undefined, `${rowAction} must not PATCH create-only identity`);
    assert.equal(body.Lumpsum_Cost__c, 125.5);
    assert.equal(body.Quantity__c, 0);
    assert.equal(body.Quantity_Delivered_Per_BDN__c, 0);
    assert.equal(body.Unit_of_Measure__c, '1.');
    assert.equal(body.Supplier__c, '001fu00000Zo8eHAAR');
  }

  const create = physicalHedgeSalesforceWriteBody({ rowAction: 'create', row, config, allocationKey: 'allocation' });
  assert.equal(create.STEM__c, 'stem');
  assert.equal(create.RecordTypeId, 'record-type');
  assert.equal(create.Unit_of_Measure__c, '1.');
  assert.equal(create.Quantity__c, 0);
  assert.equal(create.Quantity_Delivered_Per_BDN__c, 0);
  assert.equal(create.Supplier__c, '001fu00000Zo8eHAAR');

  const fcbsCreate = physicalHedgeSalesforceWriteBody({ rowAction: 'create', row: { ...row, venue: 'FCBS', supplierAccountId: '0012x00000LGhzUAAT' }, config, allocationKey: 'fcbs-allocation' });
  assert.equal(fcbsCreate.Supplier__c, '0012x00000LGhzUAAT');

  const trigger = read('force-app/main/default/triggers/StemExtraCostTrigger.trigger');
  const handler = read('force-app/main/default/classes/StemExtraCostTriggerHandler.cls');
  assert.match(trigger, /normalizeSwapsQuantityAndUnit\(Trigger\.new\)/);
  assert.match(handler, /stemExtraCost\.Quantity__c = 0/);
  assert.match(handler, /stemExtraCost\.Quantity_Delivered_Per_BDN__c = 0/);
  assert.match(handler, /stemExtraCost\.Unit_of_Measure__c = '1\.'/);

  const service = read('api/_hedgePhysicalSalesforce.js');
  assert.ok(service.indexOf('if (rejected) throw') < service.indexOf('salesforceAccepted = true;'));
  const physical = read('src/hedge/views/PhysicalView.jsx');
  assert.match(physical, /return "Confirm adoption"/);
  assert.match(physical, /row\.cannotApply/);
});

test('Physical Trade hedge-result mappings and immutable history are service-only', () => {
  const migration = read('supabase/migrations/20260902093000_physical_hedge_salesforce_costs.sql');
  const venueMigration = read('supabase/migrations/20260903143343_normalize_hedge_salesforce_venue_suppliers.sql');
  assert.match(migration, /unique \(physical_trade_id, venue\)/);
  assert.match(migration, /allocation_key text not null unique/);
  assert.match(migration, /alter table public\.hedge_physical_salesforce_costs enable row level security/);
  assert.match(migration, /alter table public\.hedge_physical_salesforce_cost_history enable row level security/);
  assert.match(migration, /revoke all on table public\.hedge_physical_salesforce_costs from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.hedge_physical_salesforce_costs to service_role/);
  assert.match(migration, /grant select, insert on table public\.hedge_physical_salesforce_cost_history to service_role/);
  assert.doesNotMatch(migration, /grant .*update.*hedge_physical_salesforce_cost_history/);
  assert.match(venueMigration, /001fu00000Zo8eHAAR/);
  assert.match(venueMigration, /0012x00000LGhzUAAT/);
  assert.match(venueMigration, /FRATELLI COSULICH BUNKERS \(S\) PTE LTD/);
  assert.match(venueMigration, /HKFCBS/);
  assert.match(venueMigration, /is distinct from normalized\.next_value/);
});

test('legacy Paper Hedge Salesforce writes are rejected in favor of Physical Trades', () => {
  const handler = read('api/functions/[name].js');
  assert.match(handler, /HEDGE_SALESFORCE_USE_PHYSICAL_TRADE/);
  assert.match(handler, /hedgePhysicalSalesforceStatus/);
  assert.match(handler, /hedgePhysicalSalesforcePreview/);
  assert.match(handler, /hedgePhysicalSalesforceApply/);
});

test('Physical Trades show the Salesforce STEM name and open the shared STEM detail', () => {
  const service = read('api/_hedgePhysicalSalesforce.js');
  const physical = read('src/hedge/views/PhysicalView.jsx');
  assert.match(service, /SELECT Id,Name,\$\{stemNameField\}/);
  assert.match(service, /salesforceStemName: stem\?\.Name/);
  assert.match(physical, /StemDetailLink/);
  assert.match(physical, /StemDetailModal/);
  assert.match(physical, /hedgeResult\.salesforceStemName \|\| record\.stem_number/);
  assert.match(physical, /supplierCorrectionRequired/);
  assert.match(physical, /currentSupplierName/);
});

test('rich-text templates discard active content while retaining approved formatting', () => {
  const result = sanitizeRichText('<p>Hello <strong>team</strong><script>alert(1)</script><a href="javascript:alert(2)">open</a></p>');
  assert.equal(result, '<p>Hello <strong>team</strong><a target="_blank" rel="noopener noreferrer">open</a></p>');
});
