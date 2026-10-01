import assert from 'node:assert/strict';
import test from 'node:test';
import { NORMAL_ROLE_MODULES, normalModuleDataLoaded, normalRolePortalActionsReadOnly, normalRoleRequestAllowed, normalRoleXeroIntegrityRequest, normalRoleXeroPortalLoadFailed, normalRoleXeroReportIncludesSearch, normalXeroIntegrityReportLoaded } from '../scripts/normal-role-release.mjs';

const origin = 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app';
const checkedAt = '2026-10-01T00:00:00.000Z';

function report(overrides = {}) {
  const coverage = [
    { key: 'sales', label: 'Sales invoices / credits', checkedAt, available: true, complete: true, total: 1, notice: 'Saved evidence.' },
    { key: 'bills', label: 'Supplier bills / credits', checkedAt, available: true, complete: true, total: 0, notice: 'Saved evidence.' },
    // A document report remains valid when the saved payment snapshot could not
    // be verified. The portal must present that as unavailable, never as zero.
    { key: 'payments', label: 'Payments / allocations', checkedAt, available: false, complete: false, total: null, notice: 'A complete verified saved payment capture is unavailable.' },
    { key: 'contacts', label: 'Contact identities', checkedAt, available: false, complete: false, total: null, notice: 'No saved Contact identity check.' },
  ];
  const rows = [{ id: 'document:1', kind: 'buyer_invoice', status: 'matched', documentNumber: 'INV 1', stemReference: 'STEM 1', accountName: 'Buyer A',
    checkedAt, sourceValues: { total: 100 }, xeroValues: { total: 100 }, differences: [] }];
  return { schemaVersion: 1, generatedAt: checkedAt, scope: { dateBasis: 'buyer_invoice_delivery_date', contactsDateBound: false, universeTotal: null },
    coverage, metrics: { checked: 1, matched: 1, missing: 0, mismatched: 0, blocked: 0, uncertain: 0, unverified: 0 }, currencyTotals: [], rows,
    pagination: { page: 1, pageSize: 25, total: 1, hasNext: false }, history: [], historyPagination: { page: 1, pageSize: 20, total: 0, hasNext: false },
    health: { errors: [{ code: 'XERO_INTEGRITY_PAYMENT_EVIDENCE_UNAVAILABLE' }] }, notices: ['Counts describe saved evidence only.'], ...overrides };
}

test('normal-role Xero coverage uses the integrity report and permits truthful unavailable payment evidence', () => {
  const portal = NORMAL_ROLE_MODULES.find(row => row.module === 'xero_portal');
  assert.deepEqual({ handler: portal.handler, fields: portal.fields }, { handler: 'xeroIntegrityReport', fields: ['rows'] });
  assert.deepEqual(normalXeroIntegrityReportLoaded({ data: report() }).loaded, true);
  assert.deepEqual(normalModuleDataLoaded(portal, report()).rows, 1);
});

test('normal-role Xero coverage rejects denied, error-shaped, incomplete and fabricated report responses', () => {
  const invalid = [
    { error: 'Access denied' },
    report({ schemaVersion: 2 }),
    report({ coverage: report().coverage.filter(row => row.key !== 'payments') }),
    report({ coverage: report().coverage.map(row => row.key === 'payments' ? { ...row, available: false, total: 0 } : row) }),
    report({ metrics: { ...report().metrics, checked: 2 } }),
    report({ metrics: { ...report().metrics, checked: 0 } }),
    report({ rows: [{ ...report().rows[0], status: 'invented' }] }),
    report({ rows: [{ ...report().rows[0], sourceValues: null }] }),
    report({ pagination: { ...report().pagination, total: 0 } }),
  ];
  for (const payload of invalid) assert.deepEqual(normalXeroIntegrityReportLoaded(payload), { loaded: false, rows: null });
});

test('normal-role request guard permits only integrity report filter reads and denies workflow actions', () => {
  const filters = { from: '2026-01-01', to: null, search: 'INV 1', status: 'all', kind: 'buyer_invoice', page: 1, pageSize: 25, historyPage: 1, historyPageSize: 20 };
  assert.equal(normalRoleXeroIntegrityRequest(filters), true);
  assert.equal(normalRoleRequestAllowed({ url: `${origin}/api/functions/xeroIntegrityReport`, method: 'POST', body: filters }, origin), true);
  for (const body of [{ action: 'sync' }, { reviewed: true }, { from: '2026-02-30' }, { pageSize: 101 }, { kind: 'payment_apply' }]) {
    assert.equal(normalRoleXeroIntegrityRequest(body), false);
    assert.equal(normalRoleRequestAllowed({ url: `${origin}/api/functions/xeroIntegrityReport`, method: 'POST', body }, origin), false);
  }
});

test('normal-role portal coverage rejects review, sync, upload and correction controls', () => {
  assert.equal(normalRolePortalActionsReadOnly(['Refresh evidence', 'Previous', 'Next']), true);
  for (const label of ['Review selected', 'Start sync', 'Upload receipt', 'Correct document', 'Apply payment', 'Save changes']) {
    assert.equal(normalRolePortalActionsReadOnly(['Refresh evidence', label]), false);
  }
});

test('normal-role portal scopes errors to the rendered load alert and preserves unavailable evidence notices', () => {
  assert.equal(normalRoleXeroPortalLoadFailed([]), false);
  assert.equal(normalRoleXeroPortalLoadFailed(['Payments / allocations: evidence is unavailable.']), false);
  for (const alert of ['Saved evidence is unavailable. Access denied.', 'Something went wrong while reading the report.', 'Could not verify saved evidence.']) {
    assert.equal(normalRoleXeroPortalLoadFailed([alert]), true);
  }
});

test('normal-role portal search requires a newly validated matching report row', () => {
  assert.equal(normalRoleXeroReportIncludesSearch(report(), 'INV 1'), true);
  assert.equal(normalRoleXeroReportIncludesSearch(report(), 'buyer a'), true);
  assert.equal(normalRoleXeroReportIncludesSearch(report(), 'not a saved row'), false);
  assert.equal(normalRoleXeroReportIncludesSearch({ rows: [] }, 'INV 1'), false);
});
