import assert from 'node:assert/strict';
import test from 'node:test';
import { xeroFinancialSyncPreview } from '../api/_xeroFinancialSync.js';

function fixture() {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let active = false;
  const events = [];
  const client = {
    from() {
      const query = { select: () => query, eq: () => query, order: () => query,
        range: async () => ({ data: [], error: null }) };
      return query;
    },
    async rpc(name, parameters) {
      assert.equal(active, false, 'reservation ends before saving local preview');
      assert.equal(name, 'persist_xero_financial_preview_v1');
      events.push(['persist', parameters]);
      return { data: { run: { ...parameters.p_run, status: 'ready_for_review' }, items: [], reused: false }, error: null };
    },
  };
  const dependencies = {
    client, env: {}, accessContext: { profile: { id: actorId, email: 'operator@example.test' } },
    getConnection: async () => ({ tenantId, scope: 'accounting.invoices accounting.contacts accounting.settings.read' }),
    loadSafetyContext: async () => ({}), loadPayments: async () => [],
    loadSalesforce: async () => ({ buyers: [], suppliers: [], lines: [], extras: [], products: [], productRecords: [],
      groupedAccountSnapshot: { complete: true, accounts: [] }, fingerprintBasis: {} }),
    reserveBudget: async (_connection, options) => { events.push(['reserve', options]); return { id: 'budget-one' }; },
    withBudget: async (_connection, _options, operation) => { active = true; try { return await operation(); } finally { active = false; } },
    releaseBudget: async () => { events.push(['release']); },
    loadXero: async () => { assert.equal(active, true); events.push(['inventory']); return {
      tenantId, documents: [], inactiveDocuments: [], contacts: [], contactsComplete: true, organisation: { baseCurrency: 'USD' },
      fingerprintBasis: {}, callCount: 5, paymentReadSnapshot: { invoices: [], payments: [] },
    }; },
    accountingFetch: async (_connection, path) => { assert.equal(active, true); events.push(['settings', path]); return { Accounts: [], TaxRates: [] }; },
    paymentPreview: async (_body, options) => { assert.equal(active, true, 'payment dependencies share the reservation');
      assert.deepEqual(options.xeroReadSnapshot.sourcePayments, []); events.push(['payments']); return { tenantId, rows: [] }; },
    querySalesforce: async () => { throw new Error('No documentary query is needed for an empty complete selection.'); },
  };
  return { dependencies, events };
}

test('complete inventory and payment dependency reads share one budget before local persistence', async () => {
  const { dependencies, events } = fixture();
  const result = await xeroFinancialSyncPreview({ linkFirst: true, includePayments: true, recordExactMatches: false }, dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  const reservation = events.find(([type]) => type === 'reserve')[1];
  assert.equal(reservation.operationCalls, 251);
  assert.equal(reservation.verificationCalls, 0);
  assert.ok(events.findIndex(([type]) => type === 'payments') < events.findIndex(([type]) => type === 'release'));
  const saved = events.find(([type]) => type === 'persist')[1].p_run.control_totals.workflowSnapshot;
  assert.equal(saved.inventory.complete, true);
  assert.deepEqual(saved.contactCases, []);
  assert.equal(saved.callForecast.callsNeeded, reservation.operationCalls);
});

test('insufficient quota prevents all provider reads and preview persistence', async () => {
  const { dependencies, events } = fixture();
  dependencies.reserveBudget = async () => { throw new Error('XERO_ALLOWANCE_RESERVE'); };
  await assert.rejects(xeroFinancialSyncPreview({ linkFirst: true, includePayments: true }, dependencies), /RESERVE/);
  assert.deepEqual(events, []);
});

test('link-first checks cannot bypass exact approval with automatic linking', async () => {
  const { dependencies, events } = fixture();
  await assert.rejects(xeroFinancialSyncPreview({ linkFirst: true, recordExactMatches: true }, dependencies), /separate exact link approval/);
  assert.deepEqual(events, []);
});
