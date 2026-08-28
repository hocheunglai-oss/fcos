import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { allocateHedgeSalesforceAmounts } from '../api/_hedgeSalesforce.js';
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

test('Salesforce allocation is paper-hedge based and never treats current margin as profit', () => {
  const service = read('api/_hedgeSalesforce.js');
  const physical = read('src/hedge/views/PhysicalView.jsx');
  const hedges = read('src/hedge/views/HedgesView.jsx');
  assert.match(service, /paper_hedge_id/);
  assert.match(service, /calcSwapMtm/);
  assert.match(service, /calcSwapFees/);
  assert.doesNotMatch(service, /current_margin/);
  assert.doesNotMatch(physical, /pushHedgeToSalesforce|Send to Salesforce|Update Salesforce/);
  assert.match(hedges, /Preview Salesforce allocation/);
  assert.match(hedges, /Synchronize all allocations/);
});

test('Salesforce synchronization uses the approved mapping and one all-or-none Composite transaction', () => {
  const service = read('api/_hedgeSalesforce.js');
  assert.match(service, /productId: '01tfu000002zAEDAA2'/);
  assert.match(service, /recordTypeId: '0122x000000cwlgAAA'/);
  assert.match(service, /supplierId: '001fu00000Zo8eHAAR'/);
  assert.match(service, /supplierId: '0012x00000LGhzUAAT'/);
  assert.match(service, /paymentTerm: '7 I'/);
  assert.match(service, /allOrNone: true, compositeRequest: requests/);
  assert.match(service, /previewFingerprint/);
  assert.match(service, /existingPaymentTerm/);
});

test('Hedge allocations are service-only, revisioned, and uniquely keyed by paper hedge and Salesforce STEM', () => {
  const migration = read('supabase/migrations/20260802071600_hedge_salesforce_allocations.sql');
  assert.match(migration, /unique \(paper_hedge_id, salesforce_stem_id\)/);
  assert.match(migration, /alter table public\.hedge_salesforce_allocations enable row level security/);
  assert.match(migration, /revoke all on table public\.hedge_salesforce_allocations from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.hedge_salesforce_allocations to service_role/);
});

test('rich-text templates discard active content while retaining approved formatting', () => {
  const result = sanitizeRichText('<p>Hello <strong>team</strong><script>alert(1)</script><a href="javascript:alert(2)">open</a></p>');
  assert.equal(result, '<p>Hello <strong>team</strong><a target="_blank" rel="noopener noreferrer">open</a></p>');
});
