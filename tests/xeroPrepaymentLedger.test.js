import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimXeroPrepaymentOperation,
  getXeroPrepaymentOperation,
  markXeroPrepaymentSent,
  finishXeroPrepaymentOperation,
  cancelXeroPrepaymentOperation,
  prepaymentLedgerFor,
} from '../api/_xeroPrepaymentLedger.js';

const id = suffix => `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const sf = suffix => `a0000000000000${suffix}`;
const hash = character => character.repeat(64);
function claimInput(change = {}) {
  return {
    operationId: id(1), tenantId: id(2), cashEventId: sf(1), sourceKind: 'cash_event', sourceId: sf(1), action: 'create',
    sourceHash: hash('a'), reviewHash: hash('b'), requestHash: hash('c'), requestEvidence: { payload: { Type: 'RECEIVE-PREPAYMENT' } },
    currency: 'HKD', nativeAmount: '7800.00', accountingUsd: '1000.00', actorId: id(3), ...change,
  };
}
function rpcClient(result = { data: { ok: true } }) {
  const calls = [];
  return { calls, client: { from: () => ({}), rpc: async (name, args) => { calls.push({ name, args }); return result; } } };
}

test('claim maps complete immutable cash evidence to the versioned RPC', async () => {
  const { client, calls } = rpcClient({ data: { claimed: true, operation: { operation_id: id(1) } } });
  const result = await claimXeroPrepaymentOperation(client, claimInput());
  assert.equal(result.claimed, true);
  assert.deepEqual(calls, [{ name: 'claim_xero_prepayment_operation_v1', args: {
    p_operation_id: id(1), p_tenant_id: id(2), p_cash_event_id: sf(1), p_source_kind: 'cash_event', p_source_id: sf(1), p_action: 'create',
    p_source_hash: hash('a'), p_review_hash: hash('b'), p_request_hash: hash('c'), p_request_evidence: { payload: { Type: 'RECEIVE-PREPAYMENT' } },
    p_currency: 'HKD', p_native_amount: '7800.00', p_accounting_usd: '1000.00', p_invoice_mapping_id: null, p_actor_id: id(3),
  } }]);
});

test('allocation claims require an exact final invoice mapping and preserve cent strings', async () => {
  const { client, calls } = rpcClient();
  await claimXeroPrepaymentOperation(client, claimInput({
    operationId: id(4), sourceKind: 'cash_allocation', sourceId: sf(2), action: 'allocate', invoiceMappingId: id(5), nativeAmount: '0.01', accountingUsd: '0.00',
  }));
  assert.equal(calls[0].args.p_invoice_mapping_id, id(5));
  assert.equal(calls[0].args.p_native_amount, '0.01');
  assert.equal(calls[0].args.p_accounting_usd, '0.00');
});

test('claim rejects mismatched sources, proforma-like missing mappings, precision drift and empty evidence before RPC', async () => {
  for (const change of [
    { sourceId: sf(2) },
    { action: 'allocate', sourceKind: 'cash_allocation', sourceId: sf(2) },
    { action: 'refund', sourceKind: 'cash_allocation' },
    { nativeAmount: '1.001' },
    { accountingUsd: '-0.01' },
    { requestEvidence: {} },
    { sourceHash: hash('A') },
  ]) {
    const { client, calls } = rpcClient();
    await assert.rejects(claimXeroPrepaymentOperation(client, claimInput(change)), /Xero prepayment ledger/);
    assert.equal(calls.length, 0);
  }
});

test('mark, finish and cancel call only their durable state RPCs', async () => {
  const { client, calls } = rpcClient();
  await markXeroPrepaymentSent(client, { operationId: id(1), tenantId: id(2), requestHash: hash('c') });
  await finishXeroPrepaymentOperation(client, { operationId: id(1), tenantId: id(2), requestHash: hash('c'), status: 'unknown', xeroPrepaymentId: id(6), responseEvidence: { readback: 'pending' } });
  await cancelXeroPrepaymentOperation(client, { operationId: id(7), tenantId: id(2), requestHash: hash('d'), responseEvidence: { reason: 'source changed' } });
  assert.deepEqual(calls.map(call => call.name), ['mark_xero_prepayment_sent_v1', 'finish_xero_prepayment_operation_v1', 'cancel_xero_prepayment_operation_v1']);
  assert.deepEqual(calls[1].args, {
    p_operation_id: id(1), p_tenant_id: id(2), p_request_hash: hash('c'), p_status: 'unknown', p_xero_bank_transaction_id: null,
    p_xero_prepayment_id: id(6), p_xero_allocation_id: null, p_xero_payment_id: null, p_response_evidence: { readback: 'pending' },
  });
});

test('finish rejects invalid status, provider identity and missing readback evidence', async () => {
  for (const change of [
    { status: 'processing' },
    { xeroPrepaymentId: 'not-a-uuid' },
    { responseEvidence: {} },
  ]) {
    const { client, calls } = rpcClient();
    await assert.rejects(finishXeroPrepaymentOperation(client, {
      operationId: id(1), tenantId: id(2), requestHash: hash('c'), status: 'applied', xeroPrepaymentId: id(6), responseEvidence: { verified: true }, ...change,
    }), /Xero prepayment ledger/);
    assert.equal(calls.length, 0);
  }
});

test('get is an exact tenant-scoped read and rejects mismatched rows', async () => {
  const filters = [];
  const record = { operation_id: id(1), tenant_id: id(2) };
  const query = {
    select: () => query,
    eq: (field, value) => { filters.push([field, value]); return query; },
    maybeSingle: async () => ({ data: record }),
  };
  const client = { rpc: async () => ({}), from: table => { assert.equal(table, 'xero_financial_prepayment_operations'); return query; } };
  assert.equal((await getXeroPrepaymentOperation(client, { operationId: id(1), tenantId: id(2) })).operation_id, id(1));
  assert.deepEqual(filters, [['operation_id', id(1)], ['tenant_id', id(2)]]);
  record.tenant_id = id(3);
  await assert.rejects(getXeroPrepaymentOperation(client, { operationId: id(1), tenantId: id(2) }), /identity differs/);
});

test('database errors are normalized and the compact DAO exposes every contract method', async () => {
  const { client } = rpcClient({ error: { message: 'permission denied' } });
  await assert.rejects(markXeroPrepaymentSent(client, { operationId: id(1), tenantId: id(2), requestHash: hash('c') }), error => error.code === 'XERO_PREPAYMENT_LEDGER_DATABASE' && error.status === 503);
  assert.deepEqual(Object.keys(prepaymentLedgerFor(client)), ['claim', 'get', 'markSent', 'finish', 'cancel']);
});
