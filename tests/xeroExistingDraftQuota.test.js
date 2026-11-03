import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readExistingDraftQuotaPolicy as policy, reserveExistingDraftQuota as reserve, releaseExistingDraftQuota as release,
  existingDraftSpendableCalls as spendable } from '../api/_xeroExistingDraftQuota.js';
const connection={tenantId:randomUUID()},actor={id:randomUUID(),email:'Operator@Example.com'},ids=[randomUUID(),randomUUID()].sort();
function harness(response){const calls=[];return {calls,client:{rpc:async(name,args)=>{calls.push({name,args});return{data:response,error:null};}}};}
test('quota policy is server-owned, normalized, exact-scope and fail-closed',async()=>{
  const expiry=new Date(Date.now()+3600000).toISOString(),id=randomUUID(),h=harness({reserveFloor:0,grantId:id,grantExpiresAt:expiry});
  assert.deepEqual(await policy(connection,{client:h.client,actor,targetIds:[...ids].reverse()}),{reserveFloor:0,grantId:id,grantExpiresAt:expiry});
  assert.equal(h.calls[0].name,'xero_existing_draft_quota_policy_v1');assert.deepEqual(h.calls[0].args,{p_tenant_id:connection.tenantId,p_actor_id:actor.id,p_actor_email:'operator@example.com',p_target_ids:ids});
  for(const data of [{reserveFloor:1},{reserveFloor:0},{reserveFloor:0,grantId:id,grantExpiresAt:new Date(0).toISOString()}]){
    await assert.rejects(policy(connection,{client:harness(data).client,actor,targetIds:ids}));
  }
  const normal=harness({reserveFloor:200});assert.equal((await policy(connection,{client:normal.client,actor,targetIds:ids})).reserveFloor,200);
});
test('malformed actors, targets and client-supplied scope cannot reach reservation',async()=>{
  const h=harness({});
  for(const input of [{actor:{id:actor.id,email:''},targetIds:ids},{actor,targetIds:[ids[0],ids[0]]},{actor,targetIds:['x']},{actor,targetIds:[]}]){
    await assert.rejects(policy(connection,{client:h.client,...input}));
  }
  await assert.rejects(reserve(connection,{client:h.client,actor,targetIds:ids,mode:'preview',runId:randomUUID()}));
  await assert.rejects(reserve(connection,{client:h.client,actor,targetIds:ids,mode:'apply'}));
  await assert.rejects(reserve(connection,{client:h.client,actor,targetIds:ids,mode:'recovery',runId:randomUUID(),claimId:randomUUID()}));
  assert.equal(h.calls.length,0);
});
test('dedicated reservation computes its budget in SQL, never accepts HTTP counts or floors',async()=>{
  const id=randomUUID(),run=randomUUID(),h=harness({id,reserveFloor:0});
  await reserve(connection,{client:h.client,actor,targetIds:ids,mode:'apply',runId:run,budgetId:id,operationCalls:900,reserveFloor:0});
  assert.deepEqual(h.calls[0],{name:'xero_existing_draft_quota_reserve_v1',args:{p_tenant_id:connection.tenantId,p_actor_id:actor.id,p_actor_email:'operator@example.com',p_id:id,p_target_ids:ids,p_mode:'apply',p_run_id:run,p_claim_id:null,p_ttl_seconds:600}});
  await assert.rejects(reserve(connection,{client:harness({id:randomUUID(),reserveFloor:0}).client,actor,targetIds:ids,mode:'preview',budgetId:id}));
});
test('release calls durable scope-aware escrow cleanup and private database errors are sanitized',async()=>{
  const h=harness({released:true}),id=randomUUID();await release(connection,{client:h.client,actor,budgetId:id,reason:'Uncertain; preserve claim recovery'});
  assert.equal(h.calls[0].name,'xero_existing_draft_quota_release_v1');assert.equal(h.calls[0].args.p_actor_email,'operator@example.com');
  await assert.rejects(policy(connection,{client:{rpc:async()=>({error:{message:'PRIVATE XERO_RESERVE_PROTECTED secret'}})},actor,targetIds:ids}),error=>error.code==='XERO_RESERVE_PROTECTED'&&!error.message.includes('secret'));
  await assert.rejects(policy(connection,{client:{rpc:async()=>{throw Error('secret');}},actor,targetIds:ids}),error=>!error.message.includes('secret'));
  await assert.rejects(policy(connection,{client:{rpc:async()=>null},actor,targetIds:ids}),error=>error.code==='XERO_SHARED_CONTROL_UNAVAILABLE');
});
test('spendable calculation never raises conservative capacity from cached headers or unknown state',()=>{
  assert.equal(spendable({allowanceKnown:true,availableCalls:270,reservedCalls:0,spendableCalls:952},{reserveFloor:0}),270);
  assert.equal(spendable({allowanceKnown:true,availableCalls:270,reservedCalls:0},{reserveFloor:200}),70);
  assert.equal(spendable({allowanceKnown:true,availableCalls:270,reservedCalls:200},{reserveFloor:0}),70);
  for(const status of [{allowanceKnown:false,availableCalls:952,reservedCalls:0},{allowanceKnown:true,availableCalls:952},{allowanceKnown:true,availableCalls:1.1,reservedCalls:0}])assert.equal(spendable(status,{reserveFloor:0}),0);
});
