import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeXeroPrepayment } from '../api/_xeroPrepaymentExecution.js';
import { createXeroPrepaymentTransport } from '../api/_xeroPrepaymentTransport.js';
import { fixtureXeroConnection } from './helpers/xeroSharedControl.js';

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenantId = id(1);
const target = id(7);
const originalOperation = {
  operation_id: id(2), tenant_id: tenantId, request_hash: 'a'.repeat(64), action: 'create',
  request_evidence: { proposal: { method: 'PUT', path: '/BankTransactions', payload: { BankTransactions: [] }, headers: { 'Idempotency-Key': 'fixture' } } },
};

function fixture({ env = { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' } } = {}) {
  const operation = structuredClone(originalOperation);
  const state = { requests: new Map(), budgets: new Map(), sends: [], reads: [], resolutions: [], reserves: [], releases: [] };
  const connection = fixtureXeroConnection({ tenantId }, {
    async reserve(args) {
      state.reserves.push(args);
      const budget = {
        id: args.budgetId || id(30), tenant_id: tenantId, owner_key: args.ownerKey, state: 'active', expires_at: '2026-11-11T18:10:00Z',
        operation_remaining: args.operationCalls, verification_remaining: args.verificationCalls,
      };
      state.budgets.set(budget.id, budget);
      return budget;
    },
    async release(args) {
      state.releases.push(args.budgetId);
      state.budgets.get(args.budgetId).state = 'released';
    },
    async resolveUnknown(args) {
      state.resolutions.push(args);
      state.requests.get(args.requestId).state = 'complete';
      state.requests.get(args.requestId).outcome_unknown = false;
      return true;
    },
  });
  const client = {
    from(table) {
      const filters = {};
      const query = {
        select: () => query, eq: (field, value) => { filters[field] = value; return query; },
        async maybeSingle() {
          assert.equal(filters.tenant_id, tenantId);
          const rows = table === 'xero_shared_requests' ? state.requests : state.budgets;
          return { data: rows.get(filters.id) ?? null };
        },
      };
      return query;
    },
  };
  const options = {
    client, connection, env, now: () => Date.parse('2026-11-11T18:00:00Z'),
    async accountingFetch(_connection, pathName, request) {
      const resource_key = pathName.split('/')[1];
      if (request.method === 'PUT' || request.method === 'DELETE') {
        state.sends.push(request);
        state.requests.set(request.requestId, { id: request.requestId, tenant_id: tenantId, budget_id: request.budgetId,
          method: request.method, resource_key, phase: request.budgetPhase, state: 'unknown', outcome_unknown: true });
        throw new Error('Synthetic lost Xero response');
      }
      state.reads.push(request);
      const requestId = id(80 + state.reads.length);
      state.requests.set(requestId, { id: requestId, tenant_id: tenantId, budget_id: request.budgetId,
        method: 'GET', resource_key, phase: request.budgetPhase, state: 'complete', response_status: 200 });
      request.onResponse({ pathName, method: 'GET', status: 200, budgetId: request.budgetId, requestId });
    },
    async verifyOutcome(_request, read) {
      await read(`/BankTransactions/${target}`);
      await read(`/Prepayments/${id(8)}`);
      return { identities: { xeroBankTransactionId: target, xeroPrepaymentId: id(8) }, verified: true };
    },
  };
  return { operation, state, options, transport: createXeroPrepaymentTransport(options) };
}

async function originalSend(f) {
  await f.transport.prepareSend(f.operation);
  Object.assign(f.operation, { status: 'processing', send_started_at: '2026-11-11T17:59:00Z' });
  await assert.rejects(f.transport.send(f.operation.request_evidence.proposal, f.operation.operation_id, f.operation), /lost Xero/);
  return f.state.sends[0];
}

test('one send uses an exact reserved budget and durable readback resolves the original admission once', async () => {
  const f = fixture();
  const send = await originalSend(f);
  assert.equal(send.retryOnRateLimit, false);
  assert.equal(send.budgetPhase, 'operation');
  assert.equal(send.idempotencyKey, 'fixture');
  assert.equal(f.state.reserves[0].operationCalls, 1);
  assert.equal(f.state.reserves[0].verificationCalls, 3);
  const result = await f.transport.readOutcome(f.operation.request_evidence, f.operation);
  assert.equal(result.transport.requestId, send.requestId);
  assert.ok(f.state.reads.every((read) => read.method === 'GET' && read.budgetId === send.budgetId && read.budgetPhase === 'verification'));
  assert.equal(f.state.resolutions.length, 0);
  const applied = { ...f.operation, status: 'applied', response_evidence: result };
  await f.transport.settle(applied);
  await f.transport.settle(applied);
  assert.deepEqual(f.state.resolutions, [{ tenantId, requestId: send.requestId, verificationRequestId: id(81),
    evidenceReference: `xero_financial_prepayment_operations:${f.operation.operation_id}` }]);
  assert.deepEqual(f.state.releases, [send.budgetId]);
  assert.equal(f.state.sends.length, 1);
});

test('allocation and reversal reserve the third invoice payment read, including recovery of an older send', async () => {
  for (const [action, method, suffix] of [['allocate', 'PUT', ''], ['reverse', 'DELETE', `/${id(9)}`]]) {
    const f = fixture();
    f.operation.action = action;
    Object.assign(f.operation.request_evidence.proposal, { method, path: `/Prepayments/${target}/Allocations${suffix}` });
    f.transport = createXeroPrepaymentTransport({ ...f.options, verifyOutcome: async (_request, read) => {
      await read(`/Prepayments/${target}`);
      await read(`/Invoices/${id(10)}`);
      await read('/Payments?page=1');
      return { identities: { xeroPrepaymentId: target } };
    } });
    const send = await originalSend(f);
    assert.equal(f.state.reserves[0].verificationCalls, 3);
    f.state.budgets.get(send.budgetId).verification_remaining = 2;
    const result = await f.transport.readOutcome(f.operation.request_evidence, f.operation);
    assert.equal(f.state.sends.length, 1);
    assert.equal(f.state.reserves.length, 2);
    assert.equal(f.state.reserves[1].operationCalls, 0);
    assert.equal(f.state.reserves[1].verificationCalls, 3);
    assert.equal(f.state.reads.length, 3);
    assert.ok(f.state.reads.every(read => read.method === 'GET' && read.budgetId === result.transport.budgetId));
    await f.transport.settle({ ...f.operation, status: 'applied', response_evidence: result });
    assert.deepEqual(f.state.releases, [send.budgetId, result.transport.budgetId]);
  }
});

test('expired original budget gets only verification capacity and never a new send', async () => {
  const f = fixture();
  const send = await originalSend(f);
  f.state.budgets.get(send.budgetId).expires_at = '2026-11-11T17:00:00Z';
  const result = await f.transport.readOutcome(f.operation.request_evidence, f.operation);
  assert.equal(result.transport.budgetId, id(30));
  assert.equal(f.state.reserves[1].operationCalls, 0);
  assert.equal(f.state.sends.length, 1);
  await f.transport.settle({ ...f.operation, status: 'applied', response_evidence: result });
  assert.deepEqual(f.state.releases, [send.budgetId, id(30)]);
});

test('missing, in-flight or mismatched original admission stops before any verification GET', async () => {
  const f = fixture();
  const send = await originalSend(f);
  const request = f.state.requests.get(send.requestId);
  f.state.requests.delete(send.requestId);
  await assert.rejects(f.transport.readOutcome(f.operation.request_evidence, f.operation), /original Xero admission/);
  f.state.requests.set(send.requestId, { ...request, state: 'inflight', deadline_at: '2026-11-11T18:02:00Z' });
  await assert.rejects(f.transport.readOutcome(f.operation.request_evidence, f.operation), /still in flight/);
  f.state.requests.set(send.requestId, { ...request, resource_key: 'Invoices' });
  await assert.rejects(f.transport.readOutcome(f.operation.request_evidence, f.operation), /original Xero admission/);
  assert.deepEqual(f.state.reads, []);
});

test('wrong provider readback cannot release a shared hold, and the financial gate precedes reservation', async () => {
  const f = fixture();
  await originalSend(f);
  const wrongReadback = createXeroPrepaymentTransport({ ...f.options, verifyOutcome: async (_request, read) => {
    await read(`/Prepayments/${id(8)}`);
    return { identities: { xeroBankTransactionId: target } };
  } });
  await assert.rejects(wrongReadback.readOutcome(f.operation.request_evidence, f.operation), /exact original resource/);
  assert.deepEqual(f.state.resolutions, []);
  const disabled = fixture({ env: {} });
  await assert.rejects(disabled.transport.prepareSend(disabled.operation), /financial synchronization/i);
  assert.deepEqual(disabled.state.reserves, []);
});

test('runner persists Xero proof before releasing the shared hold and reuses it after acknowledgement loss', async () => {
  const f = fixture();
  const actorId = id(3);
  const body = { operationId: id(2), sourceId: 'a02000000000001AAA', action: 'create', reviewFingerprint: 'b'.repeat(64), reviewed: true };
  const review = { sourceId: body.sourceId, cashEventId: body.sourceId, action: 'create', status: 'eligible', currency: 'HKD',
    reviewFingerprint: body.reviewFingerprint, sourceFingerprint: 'c'.repeat(64), nativeAmount: 780, accountingUsd: 97.5,
    proposal: f.operation.request_evidence.proposal };
  let row;
  const ledger = {
    async get() { return row; },
    async claim(input) {
      row = { operation_id: input.operationId, tenant_id: input.tenantId, actor_id: input.actorId,
        source_id: input.sourceId, cash_event_id: input.cashEventId, action: input.action, source_hash: input.sourceHash,
        review_hash: input.reviewHash, request_hash: input.requestHash, request_evidence: input.requestEvidence, status: 'processing' };
      return { operation: row, claimed: true };
    },
    async markSent() {
      assert.equal(f.state.reserves.length, 1);
      row.send_started_at = '2026-11-11T18:00:00Z';
      return { operation: row, marked: true };
    },
    async finish(input) {
      assert.equal(f.state.resolutions.length, 0);
      assert.ok(input.responseEvidence.transport.verificationId);
      Object.assign(row, { status: input.status, response_evidence: input.responseEvidence });
      throw new Error('Committed, response lost');
    },
  };
  const options = { ...f.transport, tenantId, actorId, ledger, loadReview: async () => structuredClone(review) };
  assert.equal((await executeXeroPrepayment(body, options)).status, 'applied');
  assert.equal((await executeXeroPrepayment(body, { ...options, recoveryOnly: true })).status, 'applied');
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.reads.length, 2);
  assert.equal(f.state.resolutions.length, 1);
});
