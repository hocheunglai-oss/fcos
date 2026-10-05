import assert from 'node:assert/strict';
import test from 'node:test';
import { xeroFinancialSyncPreview } from '../api/_xeroFinancialSync.js';

function fixture() {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let active = false;
  const events = [];
  let captured = null;
  let savedRun = null;
  const client = {
    from() {
      const query = { select: () => query, eq: () => query, order: () => query,
        maybeSingle: async () => ({ data: savedRun }),
        range: async () => ({ data: [], error: null }) };
      return query;
    },
    async rpc(name, parameters) {
      assert.equal(active, false, 'reservation ends before saving local preview');
      if (name === 'begin_xero_financial_preview_v2') {
        events.push(['persist', parameters]);
        savedRun = { ...parameters.p_run, status: 'ready_for_review' };
        return { data: { runId: savedRun.id, expectedItemCount: 0 } };
      }
      assert.equal(name, 'finalize_xero_financial_preview_v2');
      return { data: { run: savedRun, items: [], reused: false }, error: null };
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
    loadCheckpoint: async (_client, scope) => {
      if (captured) assert.equal(scope.inputEvidenceHash, captured.input_evidence_hash);
      return captured;
    },
    createCheckpoint: async (_client, scope) => ({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 1, ...scope }),
    saveCheckpoint: async (_client, { id, revision, scope, payload }) => {
      events.push(['capture']);
      captured = { id, revision: revision + 1, input_evidence_hash: scope.inputEvidenceHash,
        actor_id: scope.actorId, tenant_id: scope.tenantId, salesforce_org_id: scope.salesforceOrgId,
        reconciliation_version: scope.reconciliationVersion, input_options: scope.inputOptions,
        state: 'captured', storage_version: 2, storage_hash: 'b'.repeat(64), token_version: 1,
        captured_at: new Date().toISOString(),
        payload_hash: 'a'.repeat(64), payload: structuredClone(payload) };
      return captured;
    },
    publishCheckpoint: async () => { events.push(['checkpoint-publish']); },
    onStage: () => {},
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
  assert.equal(events.find(([type]) => type === 'persist')[1].p_run.id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(saved.inventoryReference.tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(saved.inventory, undefined, 'inventory is stored once in its immutable capture');
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

test('a captured complete provider inventory resumes after failed publication without another quota reservation or provider call', async () => {
  const { dependencies, events } = fixture();
  const original = dependencies.client.rpc;
  dependencies.client.rpc = async () => ({ error: { message: 'storage unavailable' }, status: 500 });
  await assert.rejects(xeroFinancialSyncPreview({ linkFirst: true, includePayments: true }, dependencies), { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.equal(events.filter(([name]) => name === 'capture').length, 1);
  dependencies.client.rpc = original;
  const before = events.length;
  const result = await xeroFinancialSyncPreview({ linkFirst: true, includePayments: true }, dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.deepEqual(events.slice(before).map(([name]) => name), ['persist', 'checkpoint-publish']);
  assert.equal(events.findLast(([name]) => name === 'persist')[1].p_run.control_totals.workflowSnapshot.previewCheckpointPayloadHash, 'a'.repeat(64));
  assert.equal(events.filter(([name]) => name === 'inventory').length, 1);
});
