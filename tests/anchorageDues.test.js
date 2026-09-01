import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ANCHORAGE_LOCATION_ELSEWHERE,
  ANCHORAGE_LOCATION_VICTORIA,
  calculateHongKongAnchorageDues,
  convertAnchorageHkd,
} from '../src/lib/anchorageDues.js';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const period = (id, arrival, departure, location = ANCHORAGE_LOCATION_ELSEWHERE) => ({ id, arrival, departure, location });

test('Hong Kong anchorage dues are zero through twelve aggregate hours', () => {
  const result = calculateHongKongAnchorageDues({ nrt: 7000, periods: [period('a', '2026-08-01T00:00:00Z', '2026-08-01T12:00:00Z')] });
  assert.equal(result.statutoryAmountHkd, 0);
  assert.equal(result.allocationComplete, true);
  assert.equal(result.buyer.totalUsd, 0);
});

test('acceptance case: 7,000 NRT times 18 Victoria chargeable hours is HKD 2,520', () => {
  const result = calculateHongKongAnchorageDues({ nrt: 7000, periods: [period('a', '2026-08-01T00:00:00Z', '2026-08-02T06:00:00Z', ANCHORAGE_LOCATION_VICTORIA)] });
  assert.equal(result.complete, true);
  assert.equal(result.locations[0].chargeableHours, 18);
  assert.equal(result.statutoryAmountHkd, 2520);
  assert.equal(result.buyer.totalUsd, 252);
  assert.equal(result.buyer.rateUsdPerNrtHour, 0.002);
});

test('HK2627315T buyer default is independent from the statutory supplier calculation', () => {
  const result = calculateHongKongAnchorageDues({
    nrt: 3615,
    periods: [period('a', '2026-08-01T00:00:00Z', '2026-08-03T01:00:00Z')],
  });
  assert.equal(result.locations[0].chargeableHours, 37);
  assert.equal(result.statutoryAmountHkd, 2006.3);
  assert.equal(result.buyer.totalUsd, 267.51);
  assert.deepEqual(result.buyer.allocations, [{ id: 'a', amountUsd: 267.51 }]);
});

test('partial excess hours round up per location and statutory minimum applies', () => {
  const result = calculateHongKongAnchorageDues({ nrt: 1000, periods: [period('a', '2026-08-01T00:00:00Z', '2026-08-01T12:01:00Z')] });
  assert.equal(result.locations[0].chargeableHours, 1);
  assert.equal(result.rawAmountHkd, 15);
  assert.equal(result.statutoryAmountHkd, 100);
});

test('mixed locations aggregate and round each location independently', () => {
  const result = calculateHongKongAnchorageDues({ nrt: 7000, periods: [
    period('a', '2026-08-01T00:00:00Z', '2026-08-01T13:01:00Z', ANCHORAGE_LOCATION_ELSEWHERE),
    period('b', '2026-08-01T14:00:00Z', '2026-08-01T15:01:00Z', ANCHORAGE_LOCATION_VICTORIA),
  ], allocations: [{ id: 'a', amountHkd: 210 }, { id: 'b', amountHkd: 280 }] });
  assert.deepEqual(result.locations.map((row) => row.chargeableHours), [2, 2]);
  assert.equal(result.statutoryAmountHkd, 490);
  assert.equal(result.allocationComplete, true);
  assert.equal(result.buyer.totalUsd, 56);
  assert.deepEqual(result.buyer.allocations, [{ id: 'a', amountUsd: 24 }, { id: 'b', amountUsd: 32 }]);
});

test('overlaps and invalid NRT fail closed', () => {
  const result = calculateHongKongAnchorageDues({ nrt: 0, periods: [
    period('a', '2026-08-01T00:00:00Z', '2026-08-01T14:00:00Z'),
    period('b', '2026-08-01T13:00:00Z', '2026-08-01T15:00:00Z'),
  ] });
  assert.equal(result.complete, false);
  assert.match(result.errors.join(' '), /NRT/);
  assert.match(result.errors.join(' '), /overlap/);
});

test('multiple rows require exact manual allocation within HKD 0.10', () => {
  const periods = [period('a', '2026-08-01T00:00:00Z', '2026-08-01T13:00:00Z'), period('b', '2026-08-01T14:00:00Z', '2026-08-01T15:00:00Z')];
  assert.equal(calculateHongKongAnchorageDues({ nrt: 7000, periods }).allocationComplete, false);
  const result = calculateHongKongAnchorageDues({ nrt: 7000, periods, allocations: [{ id: 'a', amountHkd: 105 }, { id: 'b', amountHkd: 105 }] });
  assert.equal(result.allocationComplete, true);
  assert.equal(result.buyer.totalUsd, 28);
  assert.deepEqual(result.buyer.allocations, [{ id: 'a', amountUsd: 14 }, { id: 'b', amountUsd: 14 }]);
});

test('HKD and USD conversions are explicit and unsupported currencies remain unavailable', () => {
  assert.deepEqual(convertAnchorageHkd(784, 'HKD', 7.84), { available: true, amount: 784, rate: 1, basis: 'HKD direct' });
  assert.equal(convertAnchorageHkd(784, 'USD', 7.84).amount, 100);
  assert.equal(convertAnchorageHkd(784, 'EUR', 7.84).available, false);
});

test('Salesforce metadata and service-only settings preserve NRT and calculation evidence', async () => {
  const [nrtField, vesselLayout, integrationPermission, migration, service] = await Promise.all([
    repositoryFile('force-app/main/default/objects/Vessel__c/fields/NRT__c.field-meta.xml'),
    repositoryFile('force-app/main/default/layouts/Vessel__c-Vessel Layout.layout-meta.xml'),
    repositoryFile('force-app/main/default/permissionsets/FCOS_Variable_Charges_Integration.permissionset-meta.xml'),
    repositoryFile('supabase/migrations/20260827072934_add_variable_charge_anchorage_settings.sql'),
    repositoryFile('api/_variableCharges.js'),
  ]);
  assert.match(nrtField, /<scale>0<\/scale>/);
  assert.match(nrtField, /<trackHistory>true<\/trackHistory>/);
  assert.match(vesselLayout, /<field>NRT__c<\/field>/);
  for (const field of ['Anchorage_Arrival__c', 'Anchorage_Departure__c', 'Anchorage_Location__c', 'Anchorage_Dues_Allocation_HKD__c', 'Anchorage_NRT_Snapshot__c', 'Anchorage_USD_HKD_Rate__c', 'Anchorage_FX_Settings_Revision__c', 'Anchorage_Calculation_Version__c', 'Anchorage_Buyer_Default_USD__c', 'Anchorage_Buyer_Rate_USD__c', 'Anchorage_Buyer_Calc_Version__c']) {
    assert.match(integrationPermission, new RegExp(`STEM_Extra_Cost__c\\.${field}`));
    assert.match(service, new RegExp(field));
  }
  assert.match(migration, /alter table public\.variable_charge_settings enable row level security/i);
  assert.match(migration, /revoke all on table public\.variable_charge_settings from public, anon, authenticated/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /default 7\.84/i);
});
