import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeXeroCreditAllocation } from '../api/_xeroPrepaymentExecution.js';
import { createXeroCreditAllocationTransport } from '../api/_xeroPrepaymentTransport.js';
import { creditAllocationLedgerFor } from '../api/_xeroCreditAllocationLedger.js';
import { fixtureXeroConnection } from './helpers/xeroSharedControl.js';
import { id } from './fixtures/xeroPrepayment.js';

const tenantId = id(2);
const actorId = id(3);
const creditId = 'a03000000000001AAA';
const body = { creditId, operationId: id(5), reviewed: true, reviewFingerprint: 'a'.repeat(64) };
const xeroCreditId = id(6);
const xeroInvoiceId = id(7);
const allocationId = id(8);
const allocationDate = '2026-09-10';

function fixture() {
  const credit = { CreditNoteID: xeroCreditId, Type: 'ACCRECCREDIT', Status: 'AUTHORISED', CurrencyCode: 'HKD',
    Total: 780, RemainingCredit: 780, Allocations: [], Contact: { ContactID: id(9) } };
  const invoice = { InvoiceID: xeroInvoiceId, Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'HKD',
    Total: 780, AmountDue: 780, Contact: { ContactID: id(9) } };
  const review = {
    creditId, status: 'eligible', action: 'credit_allocate', reviewFingerprint: body.reviewFingerprint,
    creditMappingId: id(10), invoiceMappingId: id(11), currency: 'HKD', amount: 780, accountingUsd: 97.5,
    xeroCreditId, xeroInvoiceId, allocationDate, creditRemaining: 780, invoiceAmountDue: 780,
    evidence: { xeroCredit: credit, xeroInvoice: invoice },
    proposal: { method: 'PUT', path: `/CreditNotes/${xeroCreditId}/Allocations`,
      payload: { Allocations: [{ Amount: 780, Invoice: { InvoiceID: xeroInvoiceId } }] },
      headers: { 'Idempotency-Key': 'fixture-credit' } },
  };
  const state = { operation: null, transitions: [], requests: new Map(), budgets: new Map(), calls: [], releases: [], resolutions: [] };
  const client = {
    from(table) {
      const filters = {};
      const query = {
        select: () => query, eq: (field, value) => { filters[field] = value; return query; },
        async maybeSingle() {
          assert.equal(filters.tenant_id, tenantId);
          return { data: table === 'xero_financial_credit_allocations' ? state.operation
            : (table === 'xero_shared_requests' ? state.requests : state.budgets).get(filters.id) ?? null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(args.p_actor_id, actorId);
      if (name === 'claim_xero_credit_allocation_v1') {
        state.operation = { operation_id: args.p_operation_id, tenant_id: args.p_tenant_id, reviewed_by: args.p_actor_id,
          request_hash: args.p_request_hash, request_evidence: args.p_request_evidence,
          credit_mapping_id: args.p_credit_mapping_id, invoice_mapping_id: args.p_invoice_mapping_id, status: 'processing' };
        return { data: { claimed: true, operation: state.operation } };
      }
      assert.equal(name, 'transition_xero_credit_allocation_v1');
      state.transitions.push(args.p_transition);
      if (args.p_transition === 'mark_sent') state.operation.send_started_at = '2026-11-12T00:00:00Z';
      else Object.assign(state.operation, { status: args.p_transition, xero_allocation_id: args.p_xero_allocation_id,
        response_evidence: args.p_response_evidence });
      if (args.p_transition === 'applied') throw new Error('Final database acknowledgement lost');
      return { data: { changed: true, operation: state.operation } };
    },
  };
  const connection = fixtureXeroConnection({ tenantId }, {
    async reserve(args) {
      const budget = { id: args.budgetId, tenant_id: tenantId, owner_key: args.ownerKey, state: 'active',
        expires_at: '2026-11-12T00:10:00Z', operation_remaining: args.operationCalls, verification_remaining: args.verificationCalls };
      state.budgets.set(budget.id, budget);
      return budget;
    },
    async resolveUnknown(args) {
      assert.equal(state.operation.status, 'applied');
      state.resolutions.push(args);
      Object.assign(state.requests.get(args.requestId), { state: 'complete', outcome_unknown: false });
      return true;
    },
    async release({ budgetId }) {
      state.releases.push(budgetId);
      state.budgets.get(budgetId).state = 'released';
    },
  });
  const transport = createXeroCreditAllocationTransport({
    client, connection, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, now: () => Date.parse('2026-11-12T00:01:00Z'),
    async accountingFetch(_connection, pathName, request) {
      state.calls.push([request.method, pathName]);
      const resource_key = pathName.split('/')[1];
      if (request.method === 'PUT') {
        assert.ok(state.operation.send_started_at);
        assert.equal(request.retryOnRateLimit, false);
        state.requests.set(request.requestId, { id: request.requestId, tenant_id: tenantId, budget_id: request.budgetId,
          method: 'PUT', resource_key, phase: 'operation', state: 'unknown', outcome_unknown: true });
        throw new Error('Provider response lost');
      }
      const requestId = id(80 + state.calls.length);
      state.requests.set(requestId, { id: requestId, tenant_id: tenantId, budget_id: request.budgetId,
        method: 'GET', resource_key, phase: request.budgetPhase, state: 'complete', response_status: 200 });
      request.onResponse({ method: 'GET', status: 200, pathName, budgetId: request.budgetId, requestId });
      if (resource_key === 'CreditNotes') return { CreditNotes: [{ ...credit, RemainingCredit: 0,
        Allocations: [{ AllocationID: allocationId, Amount: 780, Date: allocationDate, Invoice: { InvoiceID: xeroInvoiceId } }] }] };
      return { Invoices: [{ ...invoice, AmountDue: 0 }] };
    },
  });
  const options = { ...transport, tenantId, actorId, ledger: creditAllocationLedgerFor(client, actorId), loadReview: async () => structuredClone(review) };
  return { options, state, review };
}

test('one reviewed credit PUT survives lost provider and journal acknowledgements', async () => {
  const { options, state } = fixture();
  const result = await executeXeroCreditAllocation(body, options);
  assert.equal(result.status, 'applied');
  assert.equal(result.result.allocationId, allocationId);
  assert.deepEqual(state.transitions, ['mark_sent', 'applied']);
  assert.deepEqual(state.calls, [
    ['PUT', `/CreditNotes/${xeroCreditId}/Allocations`], ['GET', `/CreditNotes/${xeroCreditId}`], ['GET', `/Invoices/${xeroInvoiceId}`],
  ]);
  assert.equal(state.resolutions[0].evidenceReference, `xero_financial_credit_allocations:${body.operationId}`);
  assert.equal((await executeXeroCreditAllocation(body, { ...options, recoveryOnly: true })).status, 'applied');
  assert.equal(state.calls.length, 3);
  assert.equal(state.resolutions.length, 1);
  assert.equal(state.releases.length, 1);
  await assert.rejects(executeXeroCreditAllocation(body, { ...options, recoveryOnly: true, actorId: id(99) }),
    { code: 'XERO_CREDIT_ALLOCATION_OPERATION_MISMATCH' });
});

test('changed credit review cancels before Xero admission', async () => {
  const { options, state, review } = fixture();
  let reviews = 0;
  await assert.rejects(executeXeroCreditAllocation(body, { ...options, loadReview: async () => ({
    ...review, accountingUsd: ++reviews === 2 ? 97.49 : 97.5,
  }) }), { code: 'XERO_CREDIT_ALLOCATION_CANCELLED' });
  assert.deepEqual(state.transitions, ['cancelled_before_send']);
  assert.equal(state.calls.length, 0);
  assert.equal(state.budgets.size, 0);
});
