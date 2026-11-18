import assert from 'node:assert/strict';
import test from 'node:test';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { xeroFinanceCompletion } from '../api/_xeroFinanceCompletion.js';
import { XERO_FINANCIAL_CUTOFF, XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';

test('combined Finance checks are bound to the same saved preview, tenant and Xero read budget', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const tenantId = '00000000-0000-4000-8000-000000000002';
  const through = '2026-11-18T09:00:00.000Z';
  const run = { id, revision: 1, mode: 'preview', status: 'ready_for_review', source_snapshot_at: through,
    cutoff_date: XERO_FINANCIAL_CUTOFF, control_totals: { workflowSnapshot: {
      tenantId, complete: true, expectedItemCount: 1, includePayments: true, recordExactMatches: false,
      salesforceOrgId: fcosSalesforceEnvironment('production').orgId,
      reconciliationVersion: XERO_RECONCILIATION_VERSION, persistenceVersion: 2,
    } } };
  const calls = [];
  let revision = 1;
  const client = { from(table) {
    assert.equal(table, 'xero_financial_sync_runs');
    return { select: (columns) => ({ eq: (column, key) => {
      assert.deepEqual([column, key], ['id', id]);
      return { maybeSingle: async () => ({ data: columns === '*' ? run : { id, revision, status: run.status } }) };
    } }) };
  } };
  const loadLane = async (window, { transport }) => {
    await transport.read(await transport.getConnection(), '/Organisations', { method: 'GET' });
    return { ...window, tenantId, complete: true, rows: [], paymentBridges: [] };
  };
  const options = { client, env: {}, now: () => Date.parse('2026-11-18T09:05:00.000Z'),
    readConnection: async () => ({ tenantId, accessToken: 'fixture', expiresAt: '2026-11-18T09:30:00.000Z' }),
    accountingFetch: async (_connection, path, { method }) => { assert.equal(method, 'GET'); calls.push(path); return {}; },
    loadPreview: async () => ({ rows: [{ salesforceId: 'a01000000000001', action: 'link', status: 'eligible' }], payments: { tenantId, rows: [] } }),
    checkChanges: async (runId, { connection, accountingFetch }) => {
      assert.equal(runId, id);
      await accountingFetch(connection, '/Invoices?page=1&pageSize=1', { method: 'GET',
        headers: { 'If-Modified-Since': new Date(through).toUTCString() } });
      return { changed: false };
    },
    loadCredits: loadLane, loadPrepayments: loadLane,
  };
  const combined = await xeroFinanceCompletion({ runId: id }, options);
  assert.equal(combined.summary.completion, 100);
  assert.equal(combined.xeroReads, 2);
  assert.equal(combined.through, through);
  assert.deepEqual(calls, ['/Organisations', '/Invoices?page=1&pageSize=1']);
  assert.doesNotMatch(JSON.stringify(combined), /fixture|accessToken/);
  await assert.rejects(xeroFinanceCompletion({ runId: id }, { ...options, env: { VERCEL_ENV: 'preview' },
    readConnection: () => assert.fail('staging may not enter Xero quota coordination'),
  }), { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  await assert.rejects(xeroFinanceCompletion({ runId: id }, { ...options, checkChanges: async () => ({ changed: true }) }), /Finance check changed/);
  revision = 2;
  await assert.rejects(xeroFinanceCompletion({ runId: id }, options), /Finance check changed/);
  run.control_totals.workflowSnapshot.includePayments = false;
  await assert.rejects(xeroFinanceCompletion({ runId: id }, options), /complete document and payment/);
});
