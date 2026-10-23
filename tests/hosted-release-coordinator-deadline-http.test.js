import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createNodeCoordinatorServer } from '../supabase/functions/release-coordinator/server.mjs';
import { createCoordinatorHandler } from '../supabase/functions/release-coordinator/index.ts';
import { createMetadataAdmission } from '../supabase/functions/release-coordinator/core.mjs';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';
import { ReleaseError } from '../scripts/lib/hosted-release/json-contract.mjs';
import { safeFailure } from '../scripts/lib/hosted-release/controller.mjs';
import { COORDINATOR_REQUEST_BUDGET as budget, COORDINATOR_DEADLINE_HEADER as deadlineHeader, createRequestContext, readCoordinatorMetadata } from '../supabase/functions/release-coordinator/core.mjs';

const H='a'.repeat(64),owner={kind:'release',id:'features'};
const scope={epoch:1,owner,releaseId:'http-deadline-fixture',manifestHash:H,phase:'preview.create',operationId:'exact-operation',requestHash:H};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const requestBody=JSON.stringify({action:'begin',payload:scope});
const jsonRequest=(headers={})=>new Request('http://localhost/coordinate',{method:'POST',headers:{authorization:'Bearer SYNTHETIC','content-type':'application/json',...headers},body:requestBody});
async function listen(t,server) {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}/coordinate`;
}
const client=(url,options={})=>createCoordinatorClient({url,epoch:1,owner,tokenProvider:async()=> 'SYNTHETIC',...options});

test('one bounded protocol derives database reserve without changing metadata or unknown-outcome policy',()=>{
  assert.deepEqual(budget,{clientMs:45000,handlerMs:42000,responseMarginMs:3000,storageReserveMs:21000,metadataReadMs:10000});
  assert.equal(budget.clientMs-budget.handlerMs,budget.responseMarginMs);
  assert.equal(budget.storageReserveMs,10000+10000+1000);
});

test('real HTTP disconnect during authentication prevents all later SQL and metadata',async t=>{
  const auth=deferred(),entered=deferred(),disconnected=deferred(),settled=deferred();let sql=0,metadata=0;
  const handle=createCoordinatorHandler({store:{request:()=>{sql++;return {};}},authenticateGithub:async()=>{entered.resolve();await auth.promise;return {kind:'github',qualificationOnly:true};},
    validateQualification:()=>{metadata++;}});
  const url=await listen(t,createNodeCoordinatorServer(async request=>{
    request.signal.addEventListener('abort',()=>disconnected.resolve(),{once:true});
    try{return await handle(request);}finally{settled.resolve();}
  }));
  const outgoing=httpRequest(url,{method:'POST',headers:{authorization:'Bearer SYNTHETIC','content-type':'application/json'}});
  outgoing.on('error',()=>{});outgoing.end(requestBody);await entered.promise;
  outgoing.destroy();await disconnected.promise;auth.resolve();await settled.promise;
  assert.equal(sql,0);assert.equal(metadata,0);
});

test('real HTTP timeout while SQL is in flight awaits its late commit and never resubmits or reads back',async t=>{
  const entered=deferred(),commit=deferred(),settled=deferred(),events=[],calls=[];let retainedIntent;
  const handle=createCoordinatorHandler({requestContextOptions:{budget:{...budget,handlerMs:50,responseMarginMs:0,storageReserveMs:10},observe:event=>events.push(event)},
    authenticateGithub:async()=>({kind:'github'}),store:{async request(action,payload){
      calls.push(action);if(action==='snapshot')return {};
      entered.resolve();await commit.promise;retainedIntent={operationId:payload.operationId,requestHash:payload.requestHash,state:'held'};return {disposition:'execute'};
    }}});
  const url=await listen(t,createNodeCoordinatorServer(async request=>{try{return await handle(request);}finally{settled.resolve();}}));
  const result=client(url,{requestBudgetMs:90}).begin(scope);await entered.promise;
  let transportError;
  await assert.rejects(result,error=>{transportError=error;return error.code==='COORDINATION_RESPONSE_UNKNOWN'&&error.detail.coordinatorTransport.stage==='fetch'&&error.detail.coordinatorTransport.timeout;});
  assert.equal(retainedIntent,undefined,'The test database operation is still pending after transport timeout');
  commit.resolve();await settled.promise;
  assert.deepEqual(retainedIntent,{operationId:scope.operationId,requestHash:H,state:'held'});
  assert.deepEqual(calls,['snapshot','begin']);
  assert.ok(events.some(event=>event.stage==='sql_dispatch'&&event.outcome==='settled_after_cancellation'));
  assert.ok(events.every(event=>Object.keys(event).sort().join(',')==='action,durationMs,event,outcome,requestSha256,stage'&&Number.isSafeInteger(event.durationMs)&&event.durationMs>=0));
  assert.ok(events.every(event=>event.action==='begin'&&event.requestSha256===transportError.detail.coordinatorTransport.requestSha256));
  t.diagnostic(JSON.stringify({fault:'late_database_commit_after_client_timeout',failure:safeFailure(transportError),serverStages:events,sqlCalls:calls,retainedIntentState:retainedIntent.state}));
});

test('real HTTP body truncation is classified separately and cannot trigger an automatic retry',async t=>{
  let calls=0;
  const url=await listen(t,createServer((request,response)=>{
    calls++;request.resume();response.writeHead(200,{'content-type':'application/json','content-length':'100'});response.flushHeaders();response.write('{"disposition":');
    setTimeout(()=>response.destroy(),15);
  }));
  let error;try{await client(url).begin(scope);}catch(caught){error=caught;}
  assert.equal(error?.code,'COORDINATION_RESPONSE_UNKNOWN');assert.equal(calls,1);
  assert.deepEqual(error.detail.coordinatorTransport,{stage:'response_body',elapsedMs:error.detail.coordinatorTransport.elapsedMs,timeout:false,requestSha256:error.detail.coordinatorTransport.requestSha256});
  assert.deepEqual(safeFailure(error).coordinatorTransport,error.detail.coordinatorTransport);
  t.diagnostic(JSON.stringify({fault:'response_body_truncated',failure:safeFailure(error),submissions:calls}));
});

test('metadata cutoff aborts real GETs, cancels queued reads, preserves two slots and the complete 45/minute reservation',async t=>{
  let clock=0,reads=0,active=0,maximum=0;const both=deferred(),events=[],sql=[];
  const metadataUrl=await listen(t,createServer((request,response)=>{
    reads++;active++;maximum=Math.max(maximum,active);if(reads===2)both.resolve();
    response.on('close',()=>{active--;});request.resume();
  }));
  const gate=createMetadataAdmission({now:()=>clock});gate.admit(40).finish();
  const handle=createCoordinatorHandler({requestContextOptions:{budget:{...budget,handlerMs:180,responseMarginMs:0,storageReserveMs:50},observe:event=>events.push(event)},
    authenticateGithub:async()=>({kind:'github',qualificationOnly:true}),store:{request:action=>{sql.push(action);return {};}},
    admitMetadata:({weight})=>{assert.equal(weight,5);return gate.admit(weight);},
    validateQualification:async({metadataReservation,requestContext})=>Promise.all(Array.from({length:3},()=>metadataReservation.runRead(()=>readCoordinatorMetadata({url:metadataUrl,token:'SYNTHETIC',fetchImpl:fetch,requestContext}),{signal:requestContext.metadataSignal}))),
  });
  const url=await listen(t,createNodeCoordinatorServer(handle));
  const result=client(url).begin(scope);await both.promise;
  await assert.rejects(result,{code:'COORDINATION_DEADLINE_EXCEEDED'});
  assert.equal(reads,2);assert.equal(maximum,2);assert.deepEqual(sql,['snapshot']);
  assert.throws(()=>gate.admit(1),{code:'COORDINATION_METADATA_PENDING'});
  // Let fetch/body cancellation settle; the whole reserved weight stays charged.
  await new Promise(resolve=>setImmediate(resolve));clock=59999;
  assert.throws(()=>gate.admit(1),{code:'COORDINATION_METADATA_PENDING'});
  clock=60000;gate.admit(45).finish();
  assert.ok(events.some(event=>event.stage==='qualification'&&event.outcome==='error'));
});

test('deadline header is fail-closed before authentication/SQL, and future or skewed clocks cannot expand the local cap',async()=>{
  let auth=0,sql=0;
  const handle=createCoordinatorHandler({authenticateGithub:()=>{auth++;return {kind:'github'};},store:{request:()=>{sql++;return {};}}});
  for(const raw of ['NaN','Infinity','1e999','-1','1.5','0','99999999999999999']) {
    const response=await handle(jsonRequest({[deadlineHeader]:raw}));assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'COORDINATION_DEADLINE_INVALID'});
  }
  const expired=await handle(jsonRequest({[deadlineHeader]:'1'}));assert.equal(expired.status,408);assert.equal(auth,0);assert.equal(sql,0);
  let clock=100000;const context=createRequestContext(jsonRequest({[deadlineHeader]:'999999999999999'}),{now:()=>clock});
  clock+=budget.handlerMs;assert.throws(()=>context.assertActive(),{code:'COORDINATION_DEADLINE_EXCEEDED'});context.finish();
  clock=100000;const rollback=createRequestContext(jsonRequest(),{now:()=>clock,budget:{...budget,handlerMs:10,storageReserveMs:1}});
  clock=1;await new Promise(resolve=>setTimeout(resolve,20));assert.throws(()=>rollback.assertActive(),{code:'COORDINATION_DEADLINE_EXCEEDED'});rollback.finish();
  clock=100000;const reserve=createRequestContext(jsonRequest(),{now:()=>clock,budget:{...budget,handlerMs:200,storageReserveMs:180}});
  clock=1;await new Promise(resolve=>setTimeout(resolve,40));reserve.assertActive();
  assert.throws(()=>reserve.assertStorage(),{code:'COORDINATION_DEADLINE_EXCEEDED'});reserve.finish();
});

test('final storage cannot start after preflight consumes its explicit reserve; started snapshot is awaited',async()=>{
  let clock=100000;const calls=[];
  const handle=createCoordinatorHandler({requestContextOptions:{now:()=>clock},authenticateGithub:()=>({kind:'github'}),
    store:{async request(action){calls.push(action);clock+=22000;return {};}}});
  const response=await handle(jsonRequest());assert.equal(response.status,408);assert.deepEqual(calls,['snapshot']);
  assert.deepEqual(await response.json(),{error:'COORDINATION_DEADLINE_EXCEEDED'});
});

test('public transport evidence validates exact fixed keys and never reflects arbitrary exception data',()=>{
  const valid={stage:'fetch',elapsedMs:45000,timeout:true,requestSha256:H};
  const failure=value=>safeFailure(new ReleaseError('COORDINATION_RESPONSE_UNKNOWN','coordinator.begin','readback',{coordinatorTransport:value}));
  assert.deepEqual(failure(valid).coordinatorTransport,valid);
  for(const value of [{...valid,url:'SYNTHETIC_PRIVATE_URL'},{...valid,stage:'private-text'},{...valid,elapsedMs:Infinity},{...valid,elapsedMs:-1},{...valid,elapsedMs:0.5},{...valid,timeout:'true'},{...valid,requestSha256:'SYNTHETIC_PRIVATE_TEXT'}]) {
    assert.equal(failure(value).coordinatorTransport,undefined);assert.equal(JSON.stringify(failure(value)).includes('SYNTHETIC_PRIVATE'),false);
  }
});

test('a real metadata refusal cancels queued GETs before its scheduler slot is released',async t=>{
  let clock=0,reads=0,first;const sql=[];
  const metadataUrl=await listen(t,createServer((request,response)=>{
    reads++;request.resume();
    if(reads===1)first=response;
    if(reads===2){first.writeHead(403,{'content-type':'application/json'});first.end('{"error":"SYNTHETIC_PRIVATE_REFUSAL"}');}
    if(reads>2){response.writeHead(500);response.end();}
  }));
  const gate=createMetadataAdmission({now:()=>clock});gate.admit(40).finish();
  const handle=createCoordinatorHandler({authenticateGithub:async()=>({kind:'github',qualificationOnly:true}),
    store:{request:action=>{sql.push(action);return {};}},admitMetadata:({weight})=>gate.admit(weight),
    validateQualification:async({metadataReservation,requestContext})=>Promise.all(Array.from({length:3},()=>metadataReservation.runRead(()=>readCoordinatorMetadata({url:metadataUrl,token:'SYNTHETIC',fetchImpl:fetch,requestContext}),{signal:requestContext.metadataSignal}))),
  });
  const url=await listen(t,createNodeCoordinatorServer(handle));
  await assert.rejects(client(url).begin(scope),{code:'COORDINATION_GITHUB_METADATA_UNAVAILABLE'});
  assert.equal(reads,2,'The third GET must remain cancelled, including after the failed slot is freed');
  assert.deepEqual(sql,['snapshot']);assert.throws(()=>gate.admit(1),{code:'COORDINATION_METADATA_PENDING'});
  await new Promise(resolve=>setImmediate(resolve));clock=60000;gate.admit(45).finish();
});
