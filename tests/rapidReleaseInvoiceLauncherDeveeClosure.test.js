import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceClosureResult, originalInvoiceRun, verifyStoppedInvoiceClosure } from '../scripts/lib/rapid-release/invoice-launcher-devee-closure.mjs';
import { pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';

test('Invoice Launcher closure resolves only the outer operation while recording retained DEVEE work', () => {
  const result = invoiceClosureResult('a'.repeat(64));
  assert.equal(result.outcome,'devee_verified_mirror_not_published');
  assert.deepEqual(result.deveeCheckpoints,[originalInvoiceRun.validationReceiptId,originalInvoiceRun.deploymentReceiptId]);
  assert.equal(result.salesforceFingerprint,originalInvoiceRun.fingerprint);
  const original = { payload:{ event:'prerequisites.intent',data:{operationId:result.operationId} } };
  const unknown = { payload:{ event:'promote.intent',data:{operationId:'unrelated-promotion'} } };
  const closure = { payload:{ event:'prerequisites.result',data:result } };
  assert.equal(pendingOperations([original,closure]).length,0);
  assert.deepEqual(pendingOperations([original,unknown,closure]),[{event:'promote.intent',data:unknown.payload.data}]);
});

test('Invoice Launcher closure refuses an unverifiable readback digest', () => {
  assert.throws(()=>invoiceClosureResult('unverified'),/INVOICE_CLOSURE_EVIDENCE_MISMATCH/u);
});

test('a nonterminal or reassigned original run cannot enter closure', () => {
  const input = { run:{ id:originalInvoiceRun.runId,status:'in_progress' }, jobs:{jobs:[]},records:[],requests:[] };
  assert.throws(()=>verifyStoppedInvoiceClosure(input),/INVOICE_CLOSURE_ORIGINAL_RUN_MISMATCH/u);
});

test('the stopped run requires its original protected Production approval', () => {
  const run = { id:originalInvoiceRun.runId, run_attempt:1, status:'completed', conclusion:'failure',
    actor:{id:originalInvoiceRun.actorId}, triggering_actor:{id:originalInvoiceRun.actorId},
    repository:{id:originalInvoiceRun.repositoryId}, head_sha:originalInvoiceRun.dispatcher,
    event:'workflow_dispatch', path:'.github/workflows/fcos-rapid-release.yml' };
  const jobs = {jobs:[{name:'go-live',run_id:originalInvoiceRun.runId,run_attempt:1,
    status:'completed',conclusion:'failure'}]};
  const input = {run,jobs,approvals:[],records:[],requests:[]};
  assert.throws(()=>verifyStoppedInvoiceClosure(input),/INVOICE_CLOSURE_ORIGINAL_APPROVAL_MISMATCH/u);
  input.approvals = [{state:'approved',user:{id:originalInvoiceRun.actorId,login:'hocheunglai-oss'},
    environments:[{id:23178773471,name:'fcos-production-release'}]}];
  assert.throws(()=>verifyStoppedInvoiceClosure(input),/INVOICE_CLOSURE_JOURNAL_LENGTH_MISMATCH/u);
});
