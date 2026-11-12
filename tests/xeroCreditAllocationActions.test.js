import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { creditAllocationLedgerFor } from '../api/_xeroCreditAllocationLedger.js';
import {
  xeroCreditAllocationApply, xeroCreditAllocationPreview, xeroCreditAllocationReconcile, xeroCreditAllocationRecoveryQueue,
} from '../api/_xeroCreditAllocationActions.js';

const id = suffix => `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const tenantId = id(1);
const actorId = id(2);
const creditId = 'a02000000000001AAA';
const selected = { sourceObject: 'Invoice__c', creditId, tenantId };
const reviewFingerprint = 'a'.repeat(64);
const approved = { ...selected, reviewFingerprint, operationId: id(3), reviewed: true };
const enabled = { FCOS_ENABLE_XERO_CREDIT_ALLOCATIONS: 'true', FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' };

function fixture() {
  const calls = [];
  let operation = null;
  let failRead = false;
  const review = {
    creditId, action: 'credit_allocate', status: 'eligible', reviewFingerprint, creditMappingId: id(4), invoiceMappingId: id(5),
    currency: 'HKD', amount: 780, accountingUsd: 100, creditNumber: 'CR', allocationDate: '2026-09-01',
    evidence: { private: 'never return' }, proposal: { method: 'PUT', path: `/CreditNotes/${id(7)}/Allocations` },
  };
  const options = {
    client: {}, accessContext: { profile: { id: actorId } }, env: enabled,
    getConnection: async () => ({ tenantId, scope: 'accounting.invoices accounting.payments.read accounting.settings.read' }),
    loadReview: async (object, selectedId, deps, execution) => {
      calls.push('review');
      assert.equal(object, 'Invoice__c');
      assert.equal(selectedId, creditId);
      assert.equal(deps.actorId, actorId);
      if (execution.ignoreOperationId) {
        assert.equal(execution.ignoreOperationId, approved.operationId);
        assert.equal(execution.reviewFingerprint, reviewFingerprint);
      }
      return review;
    },
    ledgerFor: (_client, actor) => {
      assert.equal(actor, actorId);
      return {
        get: async () => operation,
        listUnresolved: async (tenant) => {
          assert.equal(tenant, tenantId);
          return { rows: operation ? [operation] : [], hasMore: false };
        },
        claim: async (input) => {
          calls.push('claim');
          operation = { operation_id: input.operationId, tenant_id: input.tenantId, reviewed_by: input.actorId,
            credit_mapping_id: input.creditMappingId, invoice_mapping_id: input.invoiceMappingId,
            request_hash: input.requestHash, request_evidence: input.requestEvidence, status: 'processing' };
          return { claimed: true, operation };
        },
        markSent: async () => {
          calls.push('mark');
          operation = { ...operation, send_started_at: '2026-09-01T00:00:00Z' };
          return { marked: true, operation };
        },
        finish: async (input) => {
          calls.push(input.status);
          operation = { ...operation, status: input.status, response_evidence: input.responseEvidence, xero_allocation_id: input.xeroAllocationId };
          return { operation };
        },
        cancel: async () => {
          calls.push('cancel');
          operation = { ...operation, status: 'cancelled_before_send' };
          throw new Error('simulated lost cancellation response');
        },
      };
    },
    transportFor: () => ({
      prepareSend: async () => calls.push('reserve'),
      send: async proposal => { assert.equal(proposal, review.proposal); calls.push('send'); },
      readOutcome: async () => {
        calls.push('read');
        if (failRead) throw new Error('simulated lost provider response');
        return { identities: { xeroAllocationId: id(8) } };
      },
      settle: async () => calls.push('settle'),
    }),
  };
  return { options, calls, review, get operation() { return operation; }, loseRead() { failRead = true; }, restoreRead() { failRead = false; } };
}

test('Finance preview filters private evidence and apply rebuilds the reviewed proposal', async () => {
  const f = fixture();
  const preview = await xeroCreditAllocationPreview(selected, f.options);
  assert.equal(preview.writeEnabled, true);
  assert.equal(preview.reviewFingerprint, reviewFingerprint);
  assert.equal(preview.evidence, undefined);
  assert.equal(preview.proposal, undefined);
  const result = await xeroCreditAllocationApply({ ...approved, proposal: { method: 'DELETE' } }, f.options);
  assert.deepEqual(result, { operationId: approved.operationId, status: 'applied' });
  assert.deepEqual(f.calls, ['review', 'review', 'claim', 'review', 'reserve', 'mark', 'send', 'read', 'applied', 'settle']);
});

test('disabled, stale and staged requests stop before any write admission', async () => {
  const f = fixture();
  await assert.rejects(xeroCreditAllocationPreview(selected, { ...f.options, env: { VERCEL_ENV: 'preview' } }),
    { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  await assert.rejects(xeroCreditAllocationApply(approved, { ...f.options, env: {} }),
    { code: 'XERO_CREDIT_ALLOCATION_DISABLED' });
  await assert.rejects(xeroCreditAllocationApply({ ...approved, reviewed: false }, f.options),
    { code: 'XERO_CREDIT_ALLOCATION_REVIEW_REQUIRED' });
  await assert.rejects(xeroCreditAllocationApply({ ...approved, reviewFingerprint: 'b'.repeat(64) }, f.options),
    { code: 'XERO_CREDIT_ALLOCATION_STALE' });
  assert.deepEqual(f.calls, ['review']);
});

test('the original actor can recover with posting disabled using one original send', async () => {
  const f = fixture();
  f.loseRead();
  await assert.rejects(xeroCreditAllocationApply(approved, f.options), { code: 'XERO_CREDIT_ALLOCATION_UNKNOWN' });
  f.restoreRead();
  const recovery = { tenantId, operationId: approved.operationId, reviewFingerprint, reviewed: true };
  const options = { ...f.options, env: {}, loadReview: () => assert.fail('recovery must not rebuild a proposal') };
  assert.deepEqual(await xeroCreditAllocationReconcile(recovery, options), { operationId: approved.operationId, status: 'applied' });
  assert.equal(f.calls.filter(call => call === 'send').length, 1);
  assert.equal(f.calls.filter(call => call === 'reserve').length, 1);
});

test('recovery resolves an unsent cancellation through original-operation readback', async () => {
  const f = fixture();
  await xeroCreditAllocationApply(approved, f.options);
  const prior = f.operation;
  Object.assign(prior, { status: 'processing', send_started_at: null });
  const recovery = { tenantId, operationId: approved.operationId, reviewFingerprint, reviewed: true };
  assert.deepEqual(await xeroCreditAllocationReconcile(recovery, { ...f.options, env: {},
    transportFor: () => assert.fail('unsent cancellation requires no transport'),
  }), { operationId: approved.operationId, status: 'cancelled_before_send' });
  assert.equal(f.calls.at(-1), 'cancel');
});

test('Finance preview resolves a credit number to its exact issued record', async () => {
  const f = fixture();
  const result = await xeroCreditAllocationPreview({
    sourceObject: selected.sourceObject, creditNumber: 'CN-0100', tenantId,
  }, { ...f.options, resolveCreditId: async (object, number) => {
    assert.equal(object, selected.sourceObject);
    assert.equal(number, 'CN-0100');
    return creditId;
  } });
  assert.equal(result.creditId, creditId);
});


test('discovers the original reviewer’s durable operation with zero Xero calls or token refresh', async () => {
  const f = fixture();
  f.loseRead();
  await assert.rejects(xeroCreditAllocationApply(approved, f.options), { code: 'XERO_CREDIT_ALLOCATION_UNKNOWN' });
  const callsBefore = f.calls.length;
  const options = { ...f.options, env: {}, getConnection: () => assert.fail('must not refresh'),
    getStoredConnection: async () => ({ tenantId, scope: 'accounting.invoices.read' }) };
  const queue = await xeroCreditAllocationRecoveryQueue({ tenantId }, options);
  assert.deepEqual(queue, { tenantId, hasMore: false, rows: [{ operationId: approved.operationId,
    reviewFingerprint, creditNumber: 'CR', status: 'unknown' }] });
  assert.equal(f.calls.length, callsBefore);
  f.operation.reviewed_by = id(99);
  await assert.rejects(xeroCreditAllocationRecoveryQueue({ tenantId }, options), { code: 'XERO_CREDIT_ALLOCATION_OPERATION_MISMATCH' });
  f.operation.reviewed_by = actorId;
  f.operation.request_evidence.amount = 781;
  await assert.rejects(xeroCreditAllocationRecoveryQueue({ tenantId }, options), { code: 'XERO_CREDIT_ALLOCATION_OPERATION_MISMATCH' });
});


test('journal discovery issues one bounded GET filtered by tenant, actor and unresolved status', async () => {
  const calls = [];
  const row = { operation_id: id(3), tenant_id: tenantId, reviewed_by: actorId, status: 'processing' };
  const client = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, request) => {
      calls.push([new URL(input), request]);
      return Response.json([row], { headers: { 'content-range': '0-0/1' } });
    } },
  });
  const ledger = creditAllocationLedgerFor(client, actorId);
  assert.deepEqual(await ledger.listUnresolved(tenantId), { rows: [row], hasMore: false });
  assert.equal(calls.length, 1);
  const [[url, request]] = calls;
  assert.match(url.pathname, /xero_financial_credit_allocations$/);
  assert.equal(url.searchParams.get('tenant_id'), `eq.${tenantId}`);
  assert.equal(url.searchParams.get('reviewed_by'), `eq.${actorId}`);
  assert.equal(url.searchParams.get('status'), 'in.(processing,unknown,exception)');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.equal(request.method, 'GET');
  row.reviewed_by = id(99);
  await assert.rejects(ledger.listUnresolved(tenantId), { code: 'XERO_CREDIT_ALLOCATION_STORAGE' });
});
