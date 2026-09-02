import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { allocateHedgeSalesforceAmounts } from '../api/_hedgeSalesforce.js';
import { allocateGrossPnlAcrossPhysicals } from '../api/_hedgePhysicalSalesforce.js';
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

test('Physical Trade Salesforce costs use allocated gross hedge P&L and exclude fees', () => {
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

  const service = read('api/_hedgePhysicalSalesforce.js');
  const physical = read('src/hedge/views/PhysicalView.jsx');
  const hedges = read('src/hedge/views/HedgesView.jsx');
  assert.match(service, /grossPnl/);
  assert.match(service, /salesforceCost: roundMoney\(-grossRows\[index\]\)/);
  assert.doesNotMatch(service, /calcSwapFees|netPnl|current_margin/);
  assert.match(physical, /Salesforce hedge result/);
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
  assert.match(field, /<externalId>true<\/externalId>/);
  assert.match(field, /<unique>true<\/unique>/);
  assert.match(field, /<trackHistory>false<\/trackHistory>/);
  assert.match(service, /allOrNone: true, compositeRequest: requests/);
  assert.match(service, /previewFingerprint/);
  assert.match(service, /sfQueryAll/);
  assert.match(service, /row\.unmanagedCandidate \? null : row\.salesforceRecordId/);
  assert.match(service, /salesforceWritePerformed: false/);
  assert.match(service, /\['create', 'recreate'\]\.includes\(item\.rowAction\) \? response\?\.body\?\.id : item\.row\.salesforceRecordId/);
  assert.match(service, /function stateFromManagedRecord[\s\S]*config\.buyerInvoiceField[\s\S]*record\?\.IsDeleted === true[\s\S]*function resolveSalesforce/);
});

test('Physical Trade hedge-result mappings and immutable history are service-only', () => {
  const migration = read('supabase/migrations/20260902093000_physical_hedge_salesforce_costs.sql');
  assert.match(migration, /unique \(physical_trade_id, venue\)/);
  assert.match(migration, /allocation_key text not null unique/);
  assert.match(migration, /alter table public\.hedge_physical_salesforce_costs enable row level security/);
  assert.match(migration, /alter table public\.hedge_physical_salesforce_cost_history enable row level security/);
  assert.match(migration, /revoke all on table public\.hedge_physical_salesforce_costs from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.hedge_physical_salesforce_costs to service_role/);
  assert.match(migration, /grant select, insert on table public\.hedge_physical_salesforce_cost_history to service_role/);
  assert.doesNotMatch(migration, /grant .*update.*hedge_physical_salesforce_cost_history/);
});

test('legacy Paper Hedge Salesforce writes are rejected in favor of Physical Trades', () => {
  const handler = read('api/functions/[name].js');
  assert.match(handler, /HEDGE_SALESFORCE_USE_PHYSICAL_TRADE/);
  assert.match(handler, /hedgePhysicalSalesforceStatus/);
  assert.match(handler, /hedgePhysicalSalesforcePreview/);
  assert.match(handler, /hedgePhysicalSalesforceApply/);
});

test('rich-text templates discard active content while retaining approved formatting', () => {
  const result = sanitizeRichText('<p>Hello <strong>team</strong><script>alert(1)</script><a href="javascript:alert(2)">open</a></p>');
  assert.equal(result, '<p>Hello <strong>team</strong><a target="_blank" rel="noopener noreferrer">open</a></p>');
});
