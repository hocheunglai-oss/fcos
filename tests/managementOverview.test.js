import assert from 'node:assert/strict';
import test from 'node:test';
import { managementOverviewLinks, managementWorkSummary } from '../src/lib/managementOverview.js';

test('management drill-through is module scoped without a Dashboard Nom B action', () => {
  assert.deepEqual(managementOverviewLinks(() => false).map(link => link.to), ['/my-commitments']);
  const payments = managementOverviewLinks(module => module === 'incoming_payments').map(link => link.to);
  assert.ok(payments.includes('/payment-collections?tab=reconciliation'));
  assert.equal(payments.includes('/payment-collections?tab=collections'), false);
  const all = managementOverviewLinks(() => true);
  assert.equal(all.length, 4);
  assert.equal(all.some(link => /nom.b/i.test(link.label) || /missing-nom-b/.test(link.to)), false);
});

test('management counts remain personal, loaded and timestamped with source limitations', () => {
  assert.deepEqual(managementWorkSummary({ commitments: [{ id: 'one' }], counts: { overdue: 1 }, generatedAt: '2026-10-01T01:00:00Z', sourcesAtLimit: ['Projects & Tasks'] }),
    { overdue: 1, needsAction: 0, loaded: 1, checkedAt: '2026-10-01T01:00:00Z', partial: true });
  assert.equal(managementWorkSummary({ commitments: [], counts: {}, generatedAt: '2026-10-01T01:00:00Z', unavailableSources: ['Xero'] }).partial, true);
});

test('unverified responses cannot appear as a clear zero-count overview', () => {
  for (const invalid of [null, {}, { commitments: [], counts: {} }, { commitments: [], counts: {}, generatedAt: 'invalid' }]) {
    assert.throws(() => managementWorkSummary(invalid), /verified personal work summary/);
  }
});
