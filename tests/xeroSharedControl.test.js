import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSharedControl, fixtureXeroConnection } from './helpers/xeroSharedControl.js';
import { xeroAccountingFetch, getFreshXeroConnection, writeStoredXeroConnection } from '../api/_xeroContactSync.js';
import { createXeroSharedControl, runWithXeroBudget, forecastXeroBudget } from '../api/_xeroSharedControl.js';
const json = (data,status=200,headers={}) => Response.json(data,{status,headers});
const connection = { tenantId:'00000000-0000-4000-8000-000000000001', accessToken:'fixture',tokenVersion:1 };
const immediate = async (_tenant,fn) => fn();

test('unbound callers fail closed even with a mocked fetch; injected controller sees every retry', async () => {
  let calls=0;const receipts=[];const observations=[];
  const fetchImpl=async()=>{calls++;return json({},calls===1?503:200,{'x-daylimit-remaining':String(1000-calls)});};
  await assert.rejects(xeroAccountingFetch(connection,'/Invoices',{fetchImpl}),e=>e.code==='XERO_SHARED_CONTROL_UNAVAILABLE');assert.equal(calls,0);
  const control=fixtureSharedControl({admit:async data=>{receipts.push(data);return {requestId:String(receipts.length)};},observe:async data=>observations.push(data)});
  await xeroAccountingFetch(fixtureXeroConnection(connection,control),'/Invoices',{fetchImpl,requestGate:immediate,wait:async()=>{}});
  assert.equal(receipts.length,2);assert.equal(observations.length,2);assert.equal(observations[0].status,503);
  assert.deepEqual(observations.map(item=>item.headers.get('x-daylimit-remaining')),['999','998']);
  assert.equal(receipts[0].tokenVersion,1);
});

test('write reserves future verification, uncertain response is never replayed, and callbacks receive receipts', async()=>{
  const budgets=[];const events=[];let calls=0;
  const control=fixtureSharedControl({reserve:async x=>{budgets.push(x);return{id:'budget'};},observe:async x=>events.push(x)});
  const bound=fixtureXeroConnection(connection,control);
  await assert.rejects(xeroAccountingFetch(bound,'/Invoices',{method:'POST',retryOnRateLimit:true,fetchImpl:async()=>{calls++;throw Error('private network');},requestGate:immediate}),e=>e.code==='XERO_WRITE_OUTCOME_UNKNOWN'&&e.details.safeToRetry===false);
  assert.equal(calls,1);assert.equal(budgets[0].verificationCalls,1);assert.equal(events[0].outcomeUnknown,true);
  let callback;
  await xeroAccountingFetch(bound,'/Contacts',{method:'POST',fetchImpl:async()=>json({Contacts:[]}),requestGate:immediate,onResponse:async data=>{callback=data;}});
  assert.equal(callback.budgetId,'budget');assert.ok(callback.requestId);
});

test('campaign AsyncLocalStorage preserves parallel tenant budgets and explicit verification phase',async()=>{
  const admissions=[];const control=fixtureSharedControl({admit:async x=>{admissions.push(x);return{requestId:'r'};},reserve:async()=>{throw Error('must use existing reservation');}});
  const bound=fixtureXeroConnection(connection,control);
  await Promise.all(['a','b'].map(budgetId=>runWithXeroBudget(bound,{budgetId},()=>xeroAccountingFetch(bound,'/Invoices',{budgetPhase:'verification',fetchImpl:async()=>json({}),requestGate:immediate}))));
  assert.deepEqual(admissions.map(x=>[x.budgetId,x.budgetPhase]),[['a','verification'],['b','verification']]);
  assert.deepEqual(forecastXeroBudget({operationCalls:25,verificationCalls:25}),{operationCalls:25,verificationCalls:25,totalCalls:50,reserve:200,minimumAvailableCalls:250});
});

test('durable campaign write request identity reaches admission before the provider send', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  let admitted = false;
  const control = fixtureSharedControl({ admit: async data => {
    assert.equal(data.requestId, requestId); assert.equal(data.method, 'POST');
    admitted = true; return { requestId };
  } });
  let receipt;
  await xeroAccountingFetch(fixtureXeroConnection(connection, control), '/Contacts', {
    method: 'POST', requestId, budgetId: 'owned-budget', requestGate: immediate,
    fetchImpl: async () => { assert.equal(admitted, true); return json({ Contacts: [] }); },
    onResponse: data => { receipt = data; },
  });
  assert.equal(receipt.requestId, requestId);
});

test('probe is one exact Organisations read; observation failure stops retries and preserves unknown receipt',async()=>{
  let calls=0;const control=fixtureSharedControl({observe:async()=>{throw Error('private DB details');}});const bound=fixtureXeroConnection(connection,control);
  await assert.rejects(xeroAccountingFetch(bound,'/Invoices',{probeId:'probe',fetchImpl:async()=>{calls++;}}),e=>e.code==='XERO_PROBE_AUTHORITY_INVALID');
  await assert.rejects(xeroAccountingFetch(bound,'/Organisations',{probeId:'probe',fetchImpl:async()=>{calls++;return json({},503);},requestGate:immediate}),e=>e.code==='XERO_OBSERVATION_FAILED');assert.equal(calls,1);
  await assert.rejects(xeroAccountingFetch(bound,'/Invoices',{headers:{Authorization:'wrong'},fetchImpl:async()=>{calls++;}}),e=>e.code==='XERO_REQUEST_SCOPE_INVALID');assert.equal(calls,1);
});

function storedClient(row) { return {from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})})})}; }
const storedRow={tenant_id:connection.tenantId,tenant_name:'fixture',access_token:'fixture-access',refresh_token:'fixture-refresh',token_version:1,scope:'accounting.transactions',expires_at:'2000-01-01T00:00:00Z'};
const env={XERO_CLIENT_ID:'fixture-client',XERO_CLIENT_SECRET:'fixture-secret'};
test('valid access survives absent renewal config; expired connection uses one claimed CAS renewal',async()=>{
  let calls=0;const finished=[];
  const control=fixtureSharedControl({claimRefresh:async()=>({state:'claimed'}),finishRefresh:async x=>{finished.push(x);return{tokenVersion:2};}});
  const fresh=await getFreshXeroConnection(storedClient({...storedRow,expires_at:new Date(Date.now()+3600_000).toISOString()}),{env:{},sharedControl:control,fetchImpl:async()=>{calls++;}});
  assert.equal(fresh.accessToken,'fixture-access');assert.equal(calls,0);
  const result=await getFreshXeroConnection(storedClient(storedRow),{env,sharedControl:control,fetchImpl:async()=>{calls++;return json({access_token:'fixture-new',refresh_token:'fixture-new-refresh',expires_in:1800});}});
  assert.equal(result.tokenVersion,2);assert.equal(calls,1);assert.equal(finished[0].tokenVersion,1);assert.equal(result.tenantId,connection.tenantId);
});

test('busy or uncertain renewal never reuses refresh token; revocation differs from configuration failure',async()=>{
  for(const state of ['busy','uncertain','revoked']) {
    const control=fixtureSharedControl({claimRefresh:async()=>({state})});
    await assert.rejects(getFreshXeroConnection(storedClient(storedRow),{env,sharedControl:control,fetchImpl:async()=>{throw Error('must not call');}}),e=>e.code===({busy:'XERO_RENEWAL_IN_PROGRESS',uncertain:'XERO_RENEWAL_OUTCOME_UNKNOWN',revoked:'XERO_CONNECTION_REVOKED'})[state]);
  }
  for(const [error,expected] of [['invalid_grant','revoked'],['invalid_client','superseded']]) {
    const failures=[];const control=fixtureSharedControl({claimRefresh:async()=>({state:'claimed'}),failRefresh:async x=>failures.push(x)});
    await assert.rejects(getFreshXeroConnection(storedClient(storedRow),{env,sharedControl:control,fetchImpl:async()=>json({error,error_description:'private provider detail'},400)}));
    assert.equal(failures[0].state,expected);
  }
});

test('rotation followed by storage failure stays uncertain; reconnect uses expected version CAS',async()=>{
  const failures=[];let requestCount=0;
  const control=fixtureSharedControl({claimRefresh:async()=>({state:'claimed'}),finishRefresh:async()=>{throw Error('storage failed');},failRefresh:async x=>failures.push(x),reconnect:async x=>{assert.equal(x.tokenVersion,1);return{tokenVersion:2};}});
  await assert.rejects(getFreshXeroConnection(storedClient(storedRow),{env,sharedControl:control,fetchImpl:async()=>{requestCount++;return json({access_token:'new',refresh_token:'rotated',expires_in:1800});}}),e=>e.code==='XERO_RENEWAL_OUTCOME_UNKNOWN');
  assert.equal(requestCount,1);assert.equal(failures[0].state,'uncertain');
  const reconnect={...connection};await writeStoredXeroConnection(storedClient(storedRow),reconnect,{sharedControl:control});assert.equal(reconnect.tokenVersion,2);
});

test('RPC adapter sanitises private errors and forwards only fresh response quota headers',async()=>{
  const args=[];const control=createXeroSharedControl({rpc:async(name,payload)=>{args.push({name,payload});return{data:{},error:null};}});
  await control.observe({tenantId:connection.tenantId,requestId:'first',status:429,headers:new Headers({
    'x-daylimit-remaining':'700','x-appdaylimit-remaining':'650','x-minlimit-remaining':'2',
    'x-appminlimit-remaining':'3','retry-after':'15','x-rate-limit-problem':'minute',
  })});
  assert.equal(args[0].payload.p_snapshot.dayRemaining,700);
  assert.equal(args[0].payload.p_snapshot.appDayRemaining,650);
  assert.equal(args[0].payload.p_snapshot.minuteRemaining,2);
  assert.equal(args[0].payload.p_snapshot.appMinuteRemaining,3);
  assert.equal(args[0].payload.p_snapshot.retryAfterSeconds,15);
  assert.equal(args[0].payload.p_snapshot.rateLimitProblem,'minute');
  await control.observe({tenantId:connection.tenantId,requestId:'second',status:200,headers:new Headers()});
  assert.equal(args[1].payload.p_snapshot.dayRemaining,undefined);
  assert.equal(args[1].payload.p_snapshot.appDayRemaining,undefined);
  assert.equal(args[1].payload.p_snapshot.retryAt,null);
  const failing=createXeroSharedControl({rpc:async()=>({error:{message:'Private database schema XERO_RESERVE_PROTECTED private key'}})});
  await assert.rejects(failing.status(connection.tenantId),e=>e.code==='XERO_RESERVE_PROTECTED'&&!e.message.includes('private'));
});

test('binary attachment uses shared accounting admission without changing content',async()=>{
  const bytes=Buffer.from('fixture-document');let captured;const admissions=[];
  const bound=fixtureXeroConnection(connection,fixtureSharedControl({admit:async x=>{admissions.push(x);return{requestId:'r'};}}));
  await xeroAccountingFetch(bound,'/Invoices/fixture/Attachments/receipt.pdf',{method:'POST',rawBody:bytes,headers:{'Content-Type':'application/pdf'},requestGate:immediate,fetchImpl:async(_url,options)=>{captured=options;return json({Attachments:[]});}});
  assert.equal(captured.body,bytes);assert.equal(captured.headers['Content-Type'],'application/pdf');assert.equal(admissions[0].resourceKey,'Invoices');
});

test('missing admission receipt cannot dispatch; malformed bodies fail before reserving',async()=>{
  let calls=0;const bound=fixtureXeroConnection(connection,fixtureSharedControl({admit:async()=>null}));
  await assert.rejects(xeroAccountingFetch(bound,'/Invoices',{requestGate:immediate,fetchImpl:async()=>{calls++;}}),e=>e.code==='XERO_ADMISSION_INVALID');
  assert.equal(calls,0);
  const circular={};circular.self=circular;
  await assert.rejects(xeroAccountingFetch(bound,'/Invoices',{method:'POST',body:circular,fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
});

test('cross-instance capacity queues without sending requests before durable admission', async () => {
  let admitted = 0; let sent = 0; const waited = [];
  const control = fixtureSharedControl({ admit: async () => {
    if (++admitted < 3) throw Object.assign(new Error('Busy'), { code: 'XERO_INFLIGHT_LIMIT' });
    return { requestId: 'admitted' };
  } });
  await xeroAccountingFetch(fixtureXeroConnection(connection, control), '/Invoices', {
    requestGate: immediate, wait: async ms => { waited.push(ms); assert.equal(sent, 0); },
    fetchImpl: async () => { sent++; return json({ Invoices: [] }); },
  });
  assert.equal(sent, 1); assert.deepEqual(waited, [1000, 1000]);
});
