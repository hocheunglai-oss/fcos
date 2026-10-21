import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtempSync,readFileSync,rmSync,readdirSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {createVercelRecoveryIngress,createVercelIngressProbe,VERCEL_INGRESS_PROBE_PATH,validateVercelRecoveryCompiled} from '../scripts/lib/hosted-release/xero-recovery-vercel-ingress.mjs';
import {createXeroRecoveryHost} from '../scripts/lib/hosted-release/xero-recovery-host.mjs';
import {recoveryStepCanonicalJson as canonical,prepareXeroRecoveryStepRequest} from '../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';
import {packageXeroRecoveryHost,xeroHostPackageSourcePins,packageMain,readExpectedXeroHostUploadFiles} from '../scripts/package-xero-recovery-host.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),HOST='fcos-test12345-hocheunglai-6535s-projects.vercel.app';
const controller='f'.repeat(40),nonce='fixture_owner_nonce_1234567890',id='20000000-0000-4000-8000-000000000002';
const target=()=>({teamId:'team_MbKDazzCrou3eKTuausPv4X2',projectId:'prj_0pUORPGfFPyKtYhKr6ecwJ9ydvEs',customEnvironment:'fcos-xero-recovery-aaaaaaaaaaaa',controllerSha:controller,hostSourceSha256:hash(JSON.stringify(xeroHostPackageSourcePins()))});
function compiled(){const at=Date.now(),owner='30000000-0000-4000-8000-000000000003',binding={operationId:'a'.repeat(64),ownerThreadId:owner,tenantId:'10000000-0000-4000-8000-000000000001',actorId:id,expectedVersion:7,
  refreshLeaseId:'40000000-0000-4000-8000-000000000004',probeId:'50000000-0000-4000-8000-000000000005',requestId:'60000000-0000-4000-8000-000000000006',
  approvalSha256:'b'.repeat(64),sourceSha256:'c'.repeat(64),bindingSha256:'d'.repeat(64),organisationIdentitySha256:null,issuedAt:at-1000,notAfter:at+600000,credentialPreservationCompositeApproved:true};
  return {schemaVersion:1,kind:'fcos_compiled_xero_vercel_host_v1',target:target(),planJson:canonical({schemaVersion:1,kind:'fcos_xero_recovery_step_plan_v1',binding}),
    actorBinding:{actorId:id,emailSha256:hash('fixture@example.invalid'),accessRevision:5},ownership:{featuresOwnerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',historicalOwnerThreadIds:[owner],approvalSha256:binding.approvalSha256,sourceSha256:binding.sourceSha256,controllerSha:controller},
    caller:{ref:'refs/heads/features',sha:'e'.repeat(40),workflowSha:'e'.repeat(40),workflowRef:'hocheunglai-oss/fcos/.github/workflows/xero-carrier.yml@refs/heads/features',jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/xero-private.yml@${controller}`,jobWorkflowSha:controller,runId:'123456789',environment:'fcos-hosted-verification',subject:'repo:hocheunglai-oss/fcos:environment:fcos-hosted-verification'},requestNonceSha256:hash(nonce)};
}
function environment(t,change={}){const values={VERCEL:'1',VERCEL_ENV:'preview',VERCEL_TARGET_ENV:target().customEnvironment,VERCEL_URL:HOST,VERCEL_DEPLOYMENT_ID:'dpl_fixture',VERCEL_PROJECT_ID:target().projectId,
  XERO_CLIENT_ID:'fixture-client',XERO_CLIENT_SECRET:'FIXTURE_PRIVATE_CLIENT',VITE_SUPABASE_URL:'https://pjforfvchygdyqfcgpmw.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'FIXTURE_PRIVATE_SERVICE',...change};
  const before=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));for(const [k,v] of Object.entries(values))if(v===undefined)delete process.env[k];else process.env[k]=v;
  t.after(()=>{for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;});}
const ingressHeaders={host:HOST,'x-forwarded-host':HOST,'x-forwarded-proto':'https','x-vercel-deployment-url':HOST};
async function server(t,handler){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(async()=>{s.closeAllConnections();await new Promise(r=>s.close(r));});
  const send=({method='GET',path=VERCEL_INGRESS_PROBE_PATH,headers={},body}={})=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:s.address().port,path,method,headers:{...ingressHeaders,...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.end(body);});return {s,send};}
test('credential-free probe observes real HTTP transport honestly and never grants ingress authority',async t=>{environment(t);const {send}=await server(t,createVercelIngressProbe({target:target()}));
  const r=await send();assert.equal(r.status,200);assert.equal(r.body.nativeSocketTls,false);assert.equal(r.body.normalHttpsConsistency,true);assert.equal(r.body.ingressQualified,false);assert.equal(r.body.providerReceipt,false);
  assert.doesNotMatch(JSON.stringify(r),/FIXTURE_PRIVATE_|XERO_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
  const spoof=await send({headers:{'x-forwarded-proto':'http'}});assert.equal(spoof.body.normalHttpsConsistency,false);
  for(const value of [{path:'/xero-recovery'},{headers:{authorization:'Bearer private'}},{headers:{'x-forwarded-host':['a.example','b.example']}},{method:'POST'}])assert.equal((await send(value)).status,403);
});
test('platform inputs are required and immutable; headers cannot create Vercel context',t=>{environment(t);const good=compiled();
  for(const [key,value] of [['VERCEL','0'],['VERCEL_URL','fcos.fcuno.com'],['VERCEL_ENV','production'],['VERCEL_TARGET_ENV','foreign'],['VERCEL_PROJECT_ID','foreign'],['VERCEL_DEPLOYMENT_ID','bad']]){
    const before=process.env[key];process.env[key]=value;assert.throws(()=>createVercelRecoveryIngress({compiled:good}));process.env[key]=before;}
  for(const mutate of [c=>c.target.teamId='foreign',c=>c.ownership.featuresOwnerThreadId='30000000-0000-4000-8000-000000000003',c=>c.actorBinding.password='PRIVATE',c=>c.caller.audience='https://foreign.invalid',c=>c.privateEnvironment={}]){const c=structuredClone(good);mutate(c);assert.throws(()=>validateVercelRecoveryCompiled(c));}
});
const keys=await generateKeyPair('RS256'),jwks={keys:[{...await exportJWK(keys.publicKey),kid:'carrier',alg:'RS256'}]};
async function credentials(c){const at=Math.floor(Date.now()/1000),caller=c.caller;const oidc=await new SignJWT({repository:'hocheunglai-oss/fcos',repository_id:'1278654816',repository_owner:'hocheunglai-oss',actor:'hocheunglai-oss',actor_id:'265701760',ref:caller.ref,ref_type:'branch',ref_protected:'true',sha:caller.sha,workflow_sha:caller.workflowSha,workflow_ref:caller.workflowRef,job_workflow_ref:caller.jobWorkflowRef,job_workflow_sha:caller.jobWorkflowSha,run_id:caller.runId,run_attempt:'1',event_name:'workflow_dispatch',runner_environment:'github-hosted',environment:caller.environment,sub:caller.subject,aud:`https://${HOST}/xero-recovery`,iss:'https://token.actions.githubusercontent.com',iat:at,exp:at+300,jti:'fixture'}).setProtectedHeader({alg:'RS256',kid:'carrier'}).sign(keys.privateKey);
return {authorization:`Bearer ${oidc}`,'x-fcos-owner-bearer':'e30.e30.e30','x-fcos-provider-access-token':'e30.e30.e30','x-fcos-recovery-nonce':nonce};}
// Synthetic requests can exercise malformed raw-header shapes that Node's HTTP
// parser rejects first. Provider HTTP remains a local stub in every case.
async function synthetic(handler,{rawHeaders,method='GET',body,path='/xero-recovery',headerError,chunks,endBody=true,bodyEvent}={}){
  const req=new EventEmitter(),res=new EventEmitter(),reads={path:0,method:0,body:0};let bodyPaused=false;
  Object.defineProperty(req,'rawHeaders',{get(){if(headerError)throw headerError;return rawHeaders;}});
  Object.defineProperty(req,'url',{get(){reads.path++;return path;}});
  Object.defineProperty(req,'method',{get(){reads.method++;return method;}});
  req.socket={encrypted:false};req.pause=()=>{bodyPaused=true;};const on=req.on;
  req.on=function(name,listener){if(name==='data'||name==='end')reads.body++;return on.call(this,name,listener);};
  res.writeHead=status=>{res.statusCode=status;};res.end=value=>{res.body=JSON.parse(value);res.writableEnded=true;res.writableFinished=true;};
  const result=handler(req,res);queueMicrotask(()=>{for(const chunk of chunks||(body?[Buffer.from(body)]:[]))req.emit('data',chunk);
    if(bodyEvent)req.emit(bodyEvent,Error('FIXTURE_PRIVATE_BODY_EVENT'));else if(endBody)req.emit('end');});await result;
  for(const name of ['data','end','close','aborted','error'])assert.equal(req.listenerCount(name),0,`cleaned ${name} listener`);
  return {status:res.statusCode,body:res.body,reads,bodyPaused};
}
const raw=values=>Object.entries(values).flat();
const transportKind='fcos_xero_vercel_ingress_transport_failure_v1';
const refusedBody={error:'XERO_RECOVERY_HOST_REFUSED',ownerReadbackRequired:false,retryable:false};
const probeSentinel='fcos-ingress-shape-probe';
const postProbeHeaders={...ingressHeaders,authorization:`Bearer ${probeSentinel}`,'x-fcos-owner-bearer':probeSentinel,
  'x-fcos-provider-access-token':probeSentinel,'x-fcos-recovery-nonce':probeSentinel,'content-type':'application/json','content-length':'2'};
const probeRefusedBody=reason=>({error:'XERO_VERCEL_INGRESS_PROBE_REFUSED',reason,executionAuthorityGranted:false});
test('credential-free synthetic POST probe observes framing with public sentinels and leaves GET policy unchanged',async t=>{
  environment(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('no provider work');});
  const handler=createVercelIngressProbe({target:target()}),{send}=await server(t,handler);
  const response=await send({method:'POST',headers:postProbeHeaders,body:'{}'});assert.equal(response.status,200);
  assert.equal(response.body.syntheticPostTransportShape,true);assert.equal(response.body.publicSentinelCredentialsOnly,true);assert.equal(response.body.genuineAuthenticatedPostQualified,false);
  assert.equal(response.body.normalHttpsConsistency,true);assert.deepEqual(response.body.observedHeaders,ingressHeaders);assert.equal(response.body.nativeSocketTls,false);
  for(const field of ['providerReceipt','ingressQualified','executionAuthorityGranted'])assert.equal(response.body[field],false);
  assert.doesNotMatch(JSON.stringify(response),/fcos-ingress-shape-probe|authorization|x-fcos-|FIXTURE_PRIVATE_/);
  const inconsistent=await send({method:'POST',headers:{...postProbeHeaders,'x-forwarded-proto':'http'},body:'{}'});
  assert.equal(inconsistent.status,200);assert.equal(inconsistent.body.normalHttpsConsistency,false);assert.equal(inconsistent.body.ingressQualified,false);
  const get=await send({headers:{'content-length':'0','content-type':'text/plain','x-fcos-recovery-nonce':'legacy-get-value','proxy-authorization':'legacy-get-value'}});
  assert.equal(get.status,200);assert.equal(Object.hasOwn(get.body,'syntheticPostTransportShape'),false);
  assert.equal((await send({headers:{authorization:`Bearer ${probeSentinel}`}})).status,403);assert.equal(calls,0);
});
test('POST probe rejects real credential strings and forbidden or inexact framing without reflecting input',async t=>{
  environment(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('no provider work');});
  const handler=createVercelIngressProbe({target:target()}),marker='FIXTURE_PRIVATE_REAL_CREDENTIAL',logs=[];
  t.mock.method(console,'error',value=>logs.push(value));
  const cases=[
    ...[['authorization','sentinel_authorization_refused'],['x-fcos-owner-bearer','sentinel_owner_refused'],['x-fcos-provider-access-token','sentinel_provider_refused'],['x-fcos-recovery-nonce','sentinel_nonce_refused']].flatMap(([key,reason])=>{
      const missing={...postProbeHeaders};delete missing[key];return [[{...postProbeHeaders,[key]:marker},reason],[missing,reason]];}),
    ...['cookie','transfer-encoding','proxy-authorization'].map(key=>[{...postProbeHeaders,[key]:marker},'forbidden_header']),
    [{...postProbeHeaders,'content-type':'application/json; charset=utf-8'},'body_content_type_refused'],
    ...['02','0','3'].map(value=>[{...postProbeHeaders,'content-length':value},'body_length_header_refused'])
  ];
  for(const [headers,reason] of cases){
    const response=await synthetic(handler,{method:'POST',path:VERCEL_INGRESS_PROBE_PATH,rawHeaders:raw(headers),body:'{}'});
    assert.equal(response.status,403);assert.deepEqual(response.body,probeRefusedBody(reason));assert.equal(response.reads.body,0);
  }
  for(const [rawHeaders,reason] of [
    [undefined,'raw_headers_shape_refused'],[[...raw(postProbeHeaders),'odd'],'raw_headers_shape_refused'],
    [[...raw(postProbeHeaders),...Array.from({length:51},(_,i)=>[`x-count-${i}`,marker]).flat()],'raw_header_count_exceeded'],
    [[...raw(postProbeHeaders),'Authorization',marker],'raw_header_duplicate_refused'],
    [[null,marker,...raw(postProbeHeaders)],'raw_header_name_refused'],[[...raw(postProbeHeaders),'x-value',{}],'raw_header_value_shape_refused'],
    [[...raw(postProbeHeaders),'x-value',`${marker}\r\n${marker}`],'raw_header_value_refused'],
    [[...raw(postProbeHeaders),'x-value',marker.repeat(4000)],'raw_header_size_exceeded']
  ]){
    const response=await synthetic(handler,{method:'POST',path:VERCEL_INGRESS_PROBE_PATH,rawHeaders,body:marker});
    assert.equal(response.status,403);assert.deepEqual(response.body,probeRefusedBody(reason));assert.equal(response.reads.body,0);
  }
  const external=await synthetic(handler,{method:'POST',path:VERCEL_INGRESS_PROBE_PATH,headerError:Object.assign(Error(marker),{reason:marker})});
  assert.deepEqual(external.body,probeRefusedBody('probe_check_failed'));
  const before=process.env.VERCEL;process.env.VERCEL=marker;let platform;
  try{platform=await synthetic(handler,{method:'POST',path:VERCEL_INGRESS_PROBE_PATH,rawHeaders:raw(postProbeHeaders),body:marker});}finally{process.env.VERCEL=before;}
  assert.deepEqual(platform.body,probeRefusedBody('platform_context_refused'));assert.equal(platform.reads.body,0);
  assert.equal(calls,0);assert.deepEqual(logs,[]);
});
test('POST probe bounds exact body bytes, cancellation and a one-second stalled-body timeout',async t=>{
  environment(t);const handler=createVercelIngressProbe({target:target()}),options={method:'POST',path:VERCEL_INGRESS_PROBE_PATH,rawHeaders:raw(postProbeHeaders)};
  const split=await synthetic(handler,{...options,chunks:[Buffer.from('{'),Buffer.from('}')]});assert.equal(split.status,200);assert.equal(split.body.syntheticPostTransportShape,true);assert.equal(split.bodyPaused,true);
  for(const [input,reason] of [[{body:'{'},'body_length_mismatch'],[{body:'[]'},'body_sentinel_mismatch'],[{body:'{} '},'body_size_exceeded'],
    [{chunks:[Buffer.alloc(65536,120)]},'body_size_exceeded'],[{chunks:['{}']},'body_chunk_refused'],
    ...['aborted','error','close'].map(bodyEvent=>[{bodyEvent},'body_cancelled'])]){
    const response=await synthetic(handler,{...options,...input});assert.equal(response.status,403);assert.deepEqual(response.body,probeRefusedBody(reason));assert.equal(response.bodyPaused,true);
  }
  const before=Date.now(),timeout=await synthetic(handler,{...options,endBody:false});assert.equal(timeout.status,403);assert.deepEqual(timeout.body,probeRefusedBody('body_timeout'));assert.equal(timeout.bodyPaused,true);
  assert.ok(Date.now()-before>=900);assert.ok(Date.now()-before<10000);
});
test('valid synthetic GET and POST transport shapes retain count/size boundaries and advance to GitHub authentication',async t=>{
  environment(t);const logs=[];t.mock.method(console,'error',value=>logs.push(JSON.parse(value)));const c=compiled();let calls=0;
  const handler=createVercelRecoveryIngress({compiled:c,hostOptions:{fetchImpl:async()=>{calls++;return new Response(null,{status:401});}}});
  const headers={...ingressHeaders,...await credentials(c)},body=prepareXeroRecoveryStepRequest({planJson:c.planJson,step:'preflight',submissionId:randomUUID(),previousResultSha256:null}).requestJson;
  for(const method of ['GET','POST']){
    const base=raw({...headers,...(method==='POST'?{'content-type':'application/json','content-length':String(Buffer.byteLength(body))}:{})});
    const atCountLimit=[...base,...Array.from({length:(100-base.length)/2},(_,i)=>[`x-extra-${i}`,'safe']).flat()];
    const size=base.reduce((sum,value)=>sum+value.length,0)+'x-padding'.length;
    const atSizeLimit=[...base,'x-padding','p'.repeat(65536-size)];
    for(const rawHeaders of [base,atCountLimit,atSizeLimit]){
      const response=await synthetic(handler,{method,rawHeaders,...(method==='POST'?{body}:{})});
      assert.equal(response.status,403);assert.deepEqual(response.body,refusedBody);assert.ok(response.reads.path>0);assert.ok(response.reads.body>0);
    }
  }
  assert.equal(calls,6);assert.deepEqual(logs.map(({kind,phase,reason})=>[kind,phase,reason]),Array.from({length:6},()=>['fcos_xero_recovery_host_failure_v1','github_jwks','jwks_response_refused']));
});
test('each synthetic transport refusal retains its gate and logs only a fixed predicate code before downstream work',async t=>{
  environment(t);const logs=[];t.mock.method(console,'error',value=>logs.push(JSON.parse(value)));const c=compiled();let calls=0,clockReads=0;
  const handler=createVercelRecoveryIngress({compiled:c,hostOptions:{now:()=>{clockReads++;return Date.now();},fetchImpl:async()=>{calls++;throw Error('FIXTURE_PRIVATE_PROVIDER');}}});
  const marker='FIXTURE_PRIVATE_SENSITIVE_HEADER',base=raw({...ingressHeaders,authorization:`Bearer ${marker}`,'x-fcos-owner-bearer':marker,'x-fcos-provider-access-token':marker,'x-fcos-recovery-nonce':marker,['x-private-name-'+marker]:marker});
  const changed=(key,value)=>base.map((entry,i)=>i%2&&base[i-1]===key?value:entry);
  const cases=[
    ['raw_headers_shape_refused',undefined],['raw_headers_shape_refused',{}],['raw_headers_shape_refused',[...base,'odd']],
    ['raw_header_count_exceeded',[...base,...Array.from({length:51},(_,i)=>[`x-count-${i}`,marker]).flat()]],
    ['raw_header_name_refused',[null,marker,...base]],
    ['raw_header_name_refused',[{toLowerCase(){throw Object.assign(Error(marker),{code:marker,reason:marker});}},marker,...base]],
    ['raw_header_value_shape_refused',[...base,'x-value',new String(marker)]],
    ['raw_header_duplicate_refused',[...base,'HOST',marker]],
    ['raw_header_value_refused',[...base,'x-value',`${marker}\r\n${marker}`]],
    ['raw_header_size_exceeded',[...base,'x-size',marker.repeat(4000)]],
    ...[['host','host_mismatch'],['x-forwarded-host','forwarded_host_mismatch'],['x-forwarded-proto','forwarded_proto_mismatch'],['x-vercel-deployment-url','deployment_url_mismatch']]
      .flatMap(([key,reason])=>[[reason,changed(key,marker)],[reason,base.filter((_entry,i)=>base[i-i%2]!==key)]])
  ];
  for(const method of ['GET','POST'])for(const [reason,rawHeaders] of cases){
    const before=logs.length,response=await synthetic(handler,{method,rawHeaders,body:marker,path:`/xero-recovery?private=${marker}`});
    assert.equal(response.status,403,reason);assert.deepEqual(response.body,refusedBody);assert.deepEqual(response.reads,{path:0,method:0,body:0});
    assert.deepEqual(logs.slice(before),[{kind:transportKind,reason},{kind:'fcos_xero_recovery_host_failure_v1',phase:'request_transport',reason:'phase_failed',httpStatus:403,ownerReadbackRequired:false,retryable:false}]);
  }
  assert.equal(calls,0);assert.equal(clockReads,0);assert.doesNotMatch(JSON.stringify(logs),/FIXTURE_PRIVATE_|Bearer|x-fcos-|https?:\/\/|fcos-test/);
  assert.ok(logs.filter(log=>log.kind===transportKind).every(log=>Object.keys(log).sort().join(',')==='kind,reason'));
});
test('platform invalidation and changed valid hosting context have distinct sanitized transport refusals',async t=>{
  environment(t);const logs=[];t.mock.method(console,'error',value=>logs.push(JSON.parse(value)));const c=compiled();let calls=0;
  const handler=createVercelRecoveryIngress({compiled:c,hostOptions:{fetchImpl:async()=>{calls++;throw Error('no downstream work');}}});
  for(const [key,value,reason] of [
    ...['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_PROJECT_ID','VERCEL_URL','VERCEL_DEPLOYMENT_ID'].map(key=>[key,'FIXTURE_PRIVATE_PLATFORM','platform_context_refused']),
    ['VERCEL_URL','fcos-other123-hocheunglai-6535s-projects.vercel.app','platform_context_changed'],['VERCEL_DEPLOYMENT_ID','dpl_changed','platform_context_changed']
  ]){
    const before=process.env[key];process.env[key]=value;let response;
    try{response=await synthetic(handler,{rawHeaders:raw(ingressHeaders)});}finally{process.env[key]=before;}
    assert.equal(response.status,403);assert.deepEqual(response.body,refusedBody);assert.deepEqual(response.reads,{path:0,method:0,body:0});
    assert.deepEqual(logs.at(-2),{kind:transportKind,reason});
  }
  assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(logs),/FIXTURE_PRIVATE_|dpl_changed|fcos-other123|https?:\/\//);
});
test('external transport exceptions and diagnostic logger failures cannot expose values or change refusal',async t=>{
  environment(t);const logs=[];const logger=t.mock.method(console,'error',value=>logs.push(JSON.parse(value)));const c=compiled();let calls=0;
  const handler=createVercelRecoveryIngress({compiled:c,hostOptions:{fetchImpl:async()=>{calls++;throw Error('no downstream work');}}});
  const headerError=Object.assign(Error('FIXTURE_PRIVATE_EXCEPTION'),{code:'host_mismatch',reason:'FIXTURE_PRIVATE_REASON',phase:'FIXTURE_PRIVATE_PHASE'});
  const response=await synthetic(handler,{headerError});assert.equal(response.status,403);assert.deepEqual(response.body,refusedBody);
  assert.deepEqual(response.reads,{path:0,method:0,body:0});assert.deepEqual(logs[0],{kind:transportKind,reason:'transport_check_failed'});assert.doesNotMatch(JSON.stringify(logs),/FIXTURE_PRIVATE_/);
  logger.mock.mockImplementation(()=>{throw Error('FIXTURE_PRIVATE_LOGGER');});
  const stopped=await synthetic(handler,{rawHeaders:[]});assert.equal(stopped.status,403);assert.deepEqual(stopped.body,refusedBody);assert.deepEqual(stopped.reads,{path:0,method:0,body:0});assert.equal(calls,0);
});
test('actual HTTP platform adapter preserves actor refusal and blocks all following POSTs after uncertainty',async t=>{environment(t);const c=compiled();let reads=0;
  const handler=createVercelRecoveryIngress({compiled:c,hostOptions:{githubJwks:createLocalJWKSet(jwks),fetchImpl:async()=>{reads++;return new Response(null,{status:401});}}});const {send}=await server(t,handler),headers=await credentials(c),body=prepareXeroRecoveryStepRequest({planJson:c.planJson,step:'preflight',submissionId:randomUUID(),previousResultSha256:null}).requestJson;
  for(const patch of [{host:'fcos-foreign123-hocheunglai-6535s-projects.vercel.app'},{'x-forwarded-proto':'http'},{'x-vercel-deployment-url':'foreign.vercel.app'},{'x-forwarded-host':['a','b']}])assert.equal((await send({method:'POST',path:'/xero-recovery',headers:{...headers,...patch},body})).status,403);
  assert.equal(reads,0);const failed=await send({method:'POST',path:'/xero-recovery',headers,body});assert.equal(failed.status,503);assert.equal(failed.body.retryable,false);assert.equal(reads,1);
  assert.equal((await send({method:'POST',path:'/xero-recovery',headers,body})).status,403);assert.equal(reads,1);
});
test('native host default still refuses forwarded HTTP without the trusted constructor transport',async t=>{environment(t);const c=compiled(),handler=createXeroRecoveryHost({planJson:c.planJson,actorBinding:c.actorBinding,ownership:c.ownership,caller:{...c.caller,audience:`https://${HOST}/xero-recovery`},publicOrigin:`https://${HOST}`,requestNonceSha256:c.requestNonceSha256,privateEnvironment:{XERO_CLIENT_ID:'fixture',XERO_CLIENT_SECRET:'private',VITE_SUPABASE_URL:process.env.VITE_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:'private'},fetchImpl:()=>assert.fail('no calls')});const {send}=await server(t,handler);assert.equal((await send({path:'/xero-recovery'})).status,403);});
function files(root){return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(root,e.name)):[join(root,e.name)]);}
for(const mode of ['probe','host'])test(`minimal ${mode} package default entrypoint and byte inventory`,async t=>{environment(t);const dir=mkdtempSync(join(realpathSync(tmpdir()),'xero-minimal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const output=join(dir,'package'),sourcePins=xeroHostPackageSourcePins(),configuration=mode==='probe'?{target:target()}:compiled();
  const manifest=await packageXeroRecoveryHost({mode,configuration,sourcePins,outputDirectory:output});assert.deepEqual(manifest.crons,[]);assert.deepEqual(manifest.aliases,[]);assert.equal(manifest.frontendIncluded,false);
  assert.deepEqual(JSON.parse(readFileSync(join(output,'.vercel/output/config.json'))),{version:3});
  const expected=readExpectedXeroHostUploadFiles({outputDirectory:output,mode});assert.equal(expected.length,3);assert.deepEqual(expected.map(({contentBase64:_contentBase64,...r})=>r),manifest.expectedUploadFiles);
  for(const row of expected)assert.equal(hash(Buffer.from(row.contentBase64,'base64')),row.sha256);assert.equal(files(output).length,5);const entry=files(output).find(p=>p.endsWith('/index.mjs'));
  const text=readFileSync(entry,'utf8');assert.doesNotMatch(text,/FIXTURE_PRIVATE_|BEGIN PRIVATE KEY/);if(mode==='probe'){
    assert.doesNotMatch(text,/SUPABASE_SERVICE_ROLE_KEY|XERO_CLIENT_SECRET|privateEnvironment|createXeroRecoveryHost|fetchImpl/);assert.deepEqual(manifest.dependencyInputs,[]);}
  const {default:handler}=await import(pathToFileURL(entry));assert.equal(typeof handler,'function');const {send}=await server(t,handler);assert.equal((await send({path:mode==='probe'?VERCEL_INGRESS_PROBE_PATH:'/xero-recovery'})).status,mode==='probe'?200:403);
  if(mode==='probe'){
    const post=await send({method:'POST',headers:postProbeHeaders,body:'{}'});assert.equal(post.status,200);assert.equal(post.body.syntheticPostTransportShape,true);assert.equal(post.body.genuineAuthenticatedPostQualified,false);
    const secret=await send({method:'POST',headers:{...postProbeHeaders,authorization:'Bearer FIXTURE_PRIVATE_JWT'},body:'{}'});assert.equal(secret.status,403);assert.deepEqual(secret.body,probeRefusedBody('sentinel_authorization_refused'));}
  await assert.rejects(packageXeroRecoveryHost({mode,configuration,sourcePins,outputDirectory:output}));
  const bad={...sourcePins,'api/_xeroRateLimit.js':'0'.repeat(64)};await assert.rejects(packageXeroRecoveryHost({mode,configuration,sourcePins:bad,outputDirectory:join(dir,'bad')}));
  const configPath=join(dir,'public.json'),pinsPath=join(dir,'pins.json');writeFileSync(configPath,JSON.stringify(configuration));writeFileSync(pinsPath,JSON.stringify(sourcePins));
  const cli=await packageMain([mode,configPath,pinsPath,join(dir,'entrypoint')]);assert.equal(cli.mode,mode);assert.equal(cli.bundleSha256,manifest.bundleSha256);
  writeFileSync(join(output,'unexpected.js'),'extra');assert.throws(()=>readExpectedXeroHostUploadFiles({outputDirectory:output,mode}));
});

test('physical HTTP cancellation reaches actor dependency and prevents later ordinary work',async t=>{
  environment(t);const c=compiled();let entered,signal,reads=0;const held=new Promise(r=>{entered=r;});
  const handler=createVercelRecoveryIngress({compiled:c,hostOptions:{githubJwks:createLocalJWKSet(jwks),fetchImpl:async(_url,init)=>{reads++;signal=init.signal;entered();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('fixture cancellation')),{once:true}));}}});
  const {s,send}=await server(t,handler),headers=await credentials(c),body=prepareXeroRecoveryStepRequest({planJson:c.planJson,step:'preflight',submissionId:randomUUID(),previousResultSha256:null}).requestJson;
  const req=request({hostname:'127.0.0.1',port:s.address().port,path:'/xero-recovery',method:'POST',headers:{...ingressHeaders,...headers,'content-type':'application/json','content-length':Buffer.byteLength(body)}});req.on('error',()=>{});req.end(body);await held;req.destroy();
  await new Promise(r=>setTimeout(r,20));assert.equal(signal.aborted,true);assert.equal(reads,1);assert.equal((await send({method:'POST',path:'/xero-recovery',headers,body})).status,403);assert.equal(reads,1);
});
