import test from 'node:test';
import assert from 'node:assert/strict';
import { executeXeroPrepayment } from '../api/_xeroPrepaymentExecution.js';
import { xeroPrepaymentEvidenceFingerprint as hash } from '../api/_xeroPrepaymentCurrency.js';

const cashId = 'a02000000000001AAA';
const otherCashId = 'a02000000000002AAA';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture() {
  const review = { sourceId:cashId, action:'create', cashEventId:cashId, status:'eligible', currency:'HKD',
    nativeAmount:780, accountingUsd:100, sourceFingerprint:'a'.repeat(64), reviewFingerprint:'b'.repeat(64), proposal:{method:'PUT',path:'/BankTransactions',payload:{}} };
  const body = { operationId:id(1), sourceId:cashId, action:'create', reviewed:true, reviewFingerprint:review.reviewFingerprint };
  const state = { operation:null, sends:0, reads:0, reviews:0, created:false };
  const ledger = {
    get:async()=>state.operation,
    claim:async input=> {
      if(state.operation) return {claimed:false,operation:state.operation};
      state.operation={operation_id:input.operationId,tenant_id:input.tenantId,source_id:input.sourceId,action:input.action,actor_id:input.actorId,source_hash:input.sourceHash,cash_event_id:input.cashEventId,
        request_evidence:input.requestEvidence,request_hash:input.requestHash,review_hash:input.reviewHash,status:'processing',send_started_at:null};
      return {claimed:true,operation:state.operation};
    },
    markSent:async()=> {
      if(state.operation.send_started_at) return {marked:false,operation:state.operation};
      state.operation.send_started_at='2026-09-11T00:00:00Z';return {marked:true,operation:state.operation};
    },
    finish:async(patch)=> {Object.assign(state.operation,{status:patch.status,response_evidence:patch.responseEvidence});return {operation:state.operation};},
    cancel:async()=>{assert.equal(state.operation.send_started_at,null);state.operation.status='cancelled_before_send';return {operation:state.operation};},
  };
  const deps = {tenantId:id(2),actorId:id(3),ledger,
    loadReview:async()=>{state.reviews++;return structuredClone(review);},
    send:async()=>{state.sends++;state.created=true;},
    readOutcome:async()=>{state.reads++;if(!state.created)throw new Error('No exact provider evidence');return {identities:{xeroBankTransactionId:id(4),xeroPrepaymentId:id(5)},verified:true};},
  };
  return {review,body,state,deps};
}
test('fresh reviewed write crosses one durable send boundary and returns a stored receipt on retry',async()=>{
  const f=fixture();assert.equal((await executeXeroPrepayment(f.body,f.deps)).status,'applied');
  assert.equal(f.state.sends,1);assert.equal(f.state.reviews,2);assert.equal(f.state.reads,1);
  assert.equal((await executeXeroPrepayment(f.body,f.deps)).status,'applied');
  assert.equal(f.state.sends,1);assert.equal(f.state.reads,1);
});
test('lost provider response reconciles by reading and never repeats the write',async()=>{
  const f=fixture();f.deps.send=async()=>{f.state.sends++;f.state.created=true;throw new Error('response lost');};
  assert.equal((await executeXeroPrepayment(f.body,f.deps)).status,'applied');assert.equal(f.state.sends,1);
});
test('uncertain outcome remains GET-only on every later retry',async()=>{
  const f=fixture();f.deps.send=async()=>{f.state.sends++;throw new Error('unknown');};
  await assert.rejects(executeXeroPrepayment(f.body,f.deps),{code:'XERO_PREPAYMENT_UNKNOWN'});
  assert.equal(f.state.operation.status,'unknown');
  await assert.rejects(executeXeroPrepayment(f.body,f.deps),{code:'XERO_PREPAYMENT_UNKNOWN'});
  f.state.created=true;assert.equal((await executeXeroPrepayment(f.body,f.deps)).status,'applied');
  assert.equal(f.state.sends,1);assert.equal(f.state.reads,3);
});
test('stale evidence before send cancels without crossing the boundary',async()=>{
  const f=fixture();f.deps.loadReview=async()=>({ ...f.review,reviewFingerprint:++f.state.reviews===1?f.review.reviewFingerprint:'c'.repeat(64)});
  await assert.rejects(executeXeroPrepayment(f.body,f.deps),{code:'XERO_PREPAYMENT_CANCELLED'});
  assert.equal(f.state.sends,0);assert.equal(f.state.operation.send_started_at,null);
  await assert.rejects(executeXeroPrepayment(f.body,f.deps),{code:'XERO_PREPAYMENT_CANCELLED'});
});
test('uncertain send-marker response cannot cause a payment retry or cancellation',async()=>{
  const f=fixture();f.deps.ledger.markSent=async()=>{f.state.operation.send_started_at='saved';throw new Error('RPC response lost');};
  await assert.rejects(executeXeroPrepayment(f.body,f.deps),{code:'XERO_PREPAYMENT_UNKNOWN'});
  await assert.rejects(executeXeroPrepayment(f.body,f.deps),{code:'XERO_PREPAYMENT_UNKNOWN'});assert.equal(f.state.sends,0);
});
test('request, tenant and approved-evidence tampering reject before another action',async()=>{
  const f=fixture();await executeXeroPrepayment(f.body,f.deps);
  for(const patch of [{sourceId:otherCashId},{action:'refund'},{reviewFingerprint:'c'.repeat(64)}])
    await assert.rejects(executeXeroPrepayment({...f.body,...patch},f.deps),{code:'XERO_PREPAYMENT_OPERATION_MISMATCH'});
  f.state.operation.request_evidence={...f.review,nativeAmount:781};
  await assert.rejects(executeXeroPrepayment(f.body,f.deps),{code:'XERO_PREPAYMENT_OPERATION_MISMATCH'});
  assert.equal(f.state.sends,1);assert.notEqual(f.state.operation.request_hash,hash(f.state.operation.request_evidence));
});
test('auxiliary audit failure after durable success does not turn a proven payment unknown',async()=>{
  const f=fixture();f.deps.audit=async event=>{if(event.event==='prepayment_reconciled')throw new Error('audit unavailable');};
  assert.equal((await executeXeroPrepayment(f.body,f.deps)).status,'applied');assert.equal(f.state.operation.status,'applied');
});
test('a lost finish response recovers the committed receipt without downgrading it or sending again',async()=>{
  const f=fixture();let finishes=0;
  f.deps.ledger.finish=async patch=>{
    finishes++;assert.equal(patch.status,'applied');
    Object.assign(f.state.operation,{status:'applied',response_evidence:patch.responseEvidence});
    throw new Error('Commit succeeded but response was lost');
  };
  const result=await executeXeroPrepayment(f.body,f.deps);
  assert.equal(result.status,'applied');assert.equal(result.result.verified,true);
  assert.equal(finishes,1);assert.equal(f.state.sends,1);
});

test('a changed proposal with the same review fingerprint cancels the original before send', async () => {
  const f = fixture();
  f.deps.loadReview = async () => {
    const review = structuredClone(f.review);
    if (++f.state.reviews === 2) review.proposal.payload = { changed: true };
    return review;
  };
  await assert.rejects(executeXeroPrepayment(f.body, f.deps), { code: 'XERO_PREPAYMENT_CANCELLED' });
  assert.equal(f.state.sends, 0);
  assert.equal(f.state.reads, 0);
});

test('recovery only uses a marked original operation for the original Finance actor', async () => {
  const f = fixture();
  await assert.rejects(executeXeroPrepayment(f.body, { ...f.deps, recoveryOnly: true }), { code: 'XERO_PREPAYMENT_OPERATION_MISMATCH' });
  assert.equal(f.state.reviews, 0);
  f.deps.ledger.markSent = async () => { throw new Error('Marker not committed'); };
  await assert.rejects(executeXeroPrepayment(f.body, f.deps), { code: 'XERO_PREPAYMENT_UNSENT' });
  await assert.rejects(executeXeroPrepayment(f.body, { ...f.deps, recoveryOnly: true, actorId: id(99) }), { code: 'XERO_PREPAYMENT_OPERATION_MISMATCH' });
  await assert.rejects(executeXeroPrepayment(f.body, { ...f.deps, recoveryOnly: true }), { code: 'XERO_PREPAYMENT_UNSENT' });
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.sends, 0);
});

test('an empty finish acknowledgement cannot make a prepayment appear applied', async () => {
  const f = fixture();
  const finish = f.deps.ledger.finish;
  f.deps.ledger.finish = async (patch) => patch.status === 'applied' ? {} : finish(patch);
  await assert.rejects(executeXeroPrepayment(f.body, f.deps), { code: 'XERO_PREPAYMENT_UNKNOWN' });
  assert.equal(f.state.operation.status, 'unknown');
  assert.equal(f.state.sends, 1);
  f.deps.ledger.finish = finish;
  assert.equal((await executeXeroPrepayment(f.body, { ...f.deps, recoveryOnly: true })).status, 'applied');
  assert.equal(f.state.sends, 1);
});
