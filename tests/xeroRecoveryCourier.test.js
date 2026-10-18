import test from 'node:test';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { parseCourierTemplate, parseCourierRequest, courierRequestRef, courierPrefix, canonicalCourierStateDirectory, nativeCourierSourcePins, createCourierReadBudget, assertNativeCourierAdmission, createNativeXeroRecoveryRelay, assertCourierAck,
  canonical, hash, safeCode, REPOSITORY } from '../scripts/lib/hosted-release/xero-recovery-native-relay.mjs';
import { carrierMain, runWarmXeroRecoveryCarrier, buildCourierExpectedFiles, captureCourierAck, verifyCourierOidc, verifyCourierDeploymentBytes, courierPublicationObserved, courierGithubReader } from '../scripts/hosted-xero-recovery-carrier.mjs';
import { prepareXeroRecoveryStepRequest } from '../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';
import {xeroHostPackageSourcePins} from '../scripts/package-xero-recovery-host.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
const T=Date.now(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,SHA='1'.repeat(40),CONTROLLER='2'.repeat(40),H='a'.repeat(64);
const binding={operationId:hash('original operation'),ownerThreadId:id(1),tenantId:id(2),actorId:id(3),expectedVersion:449,refreshLeaseId:id(4),probeId:id(5),requestId:id(6),approvalSha256:H,sourceSha256:H,bindingSha256:H,organisationIdentitySha256:null,issuedAt:T-1000,notAfter:T+899000,credentialPreservationCompositeApproved:true};
function template(){return {schemaVersion:1,kind:'fcos_xero_recovery_carrier_template_v1',planJson:canonical({schemaVersion:1,kind:'fcos_xero_recovery_step_plan_v1',binding}),controllerSha:CONTROLLER,
 caller:{ref:'refs/heads/fcos-reviewed-carrier',sha:SHA,workflowRef:`${REPOSITORY}/.github/workflows/authenticated-release.yml@refs/heads/fcos-reviewed-carrier`,workflowSha:SHA,jobWorkflowRef:`${REPOSITORY}/.github/workflows/hosted-xero-recovery-carrier.yml@${CONTROLLER}`,jobWorkflowSha:CONTROLLER,jobName:'xero-recovery-carrier',environment:'fcos-hosted-verification',subject:`repo:${REPOSITORY}:environment:fcos-hosted-verification`},
 hostConfiguration:{target:{customEnvironment:'fcos-xero-recovery-111111111111'}},readCredential:{},readAcceptance:{},login:{origin:'https://legacy.vercel.app',publicAuth:{}},issuedAt:T-1000,notAfter:T+899000,artifactCaptureAuthoritySha256:H};}
const request=t=>prepareXeroRecoveryStepRequest({planJson:t.planJson,step:'preflight',submissionId:id(7),previousResultSha256:null}).requestJson;
const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
function claims(t){return {repository_id:'1278654816',repository:REPOSITORY,repository_owner:'hocheunglai-oss',actor_id:'265701760',actor:'hocheunglai-oss',event_name:'workflow_dispatch',run_attempt:'1',run_id:'123',runner_environment:'github-hosted',ref_protected:'true',ref:t.caller.ref,sha:t.caller.sha,workflow_ref:t.caller.workflowRef,workflow_sha:t.caller.workflowSha,job_workflow_ref:t.caller.jobWorkflowRef,job_workflow_sha:t.caller.jobWorkflowSha,environment:t.caller.environment,sub:t.caller.subject,iat:Math.floor(T/1000),exp:Math.floor(T/1000)+299,jti:'actual-signed-fixture'};}
const key=await generateKeyPair('RS256'),jwk=await exportJWK(key.publicKey);jwk.kid='fixture';
const jwks=createLocalJWKSet({keys:[jwk]}),sign=p=>new SignJWT(p).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://token.actions.githubusercontent.com').setAudience('https://fixed.vercel.app/xero-recovery').sign(key.privateKey);
const verify=(token,t=template(),extra={})=>verifyCourierOidc({token,t,runId:'123',audience:'https://fixed.vercel.app/xero-recovery',jwks,signal:new AbortController().signal,now:()=>T,...extra});
test('canonical fixed public request cannot select a different plan, source, actor, host or signal',()=>{
 const t=template(),raw=request(t);assert.equal(parseCourierRequest(raw,t).step,'preflight');assert.match(courierRequestRef(t,'123',raw),/^refs\/heads\/codex\/fcos-xero-[a-f0-9]{16}-123\/request-preflight-/);
 for(const changed of [{...JSON.parse(raw),host:'https://foreign.invalid'},{...JSON.parse(raw),planSha256:'b'.repeat(64)},{...JSON.parse(raw),signal:{}},{...JSON.parse(raw),actorId:id(9)}])assert.throws(()=>parseCourierRequest(canonical(changed),t));
 assert.throws(()=>parseCourierRequest(raw+' ',t));assert.throws(()=>parseCourierRequest('x'.repeat(2049),t));
});
test('trusted template pins immutable reusable controller, verification environment and finite plan horizon',()=>{
 assert.equal(parseCourierTemplate(JSON.stringify(template())).plan.binding.actorId,id(3));
 for(const mutate of [t=>t.caller.jobWorkflowSha=SHA,t=>t.caller.environment='production',t=>t.notAfter+=1,t=>t.caller.workflowSha=CONTROLLER]){const t=template();mutate(t);assert.throws(()=>parseCourierTemplate(JSON.stringify(t)));}
});
test('real signed GitHub OIDC admits the exact actual caller/run and rejects tuple substitutions',async()=>{
 const t=template();assert.equal((await verify(await sign(claims(t)))).expiresAt,claims(t).exp*1000);
 for(const delta of [{actor_id:'1'},{run_id:'124'},{run_attempt:'2'},{ref_protected:'false'},{runner_environment:'self-hosted'},{event_name:'push'},{job_workflow_sha:SHA},{environment:'production'},{repository_id:'2'},{exp:Math.floor(T/1000)+301},{iat:Math.floor(T/1000)-301,exp:Math.floor(T/1000)-1}])await assert.rejects(verify(await sign({...claims(t),...delta})),{code:'XERO_COURIER_OIDC_INVALID'});
});
test('foreign signing key, missing JWT, cancellation and foreign audience fail without fallback',async()=>{
 const other=await generateKeyPair('RS256'),token=await new SignJWT(claims(template())).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://token.actions.githubusercontent.com').setAudience('https://fixed.vercel.app/xero-recovery').sign(other.privateKey);
 await assert.rejects(verify(token));await assert.rejects(verify('PRIVATE_PROVIDER_TOKEN'));await assert.rejects(verify(await sign(claims(template())),template(),{audience:'https://foreign.invalid'}));
 const c=new AbortController();c.abort();await assert.rejects(verify(await sign(claims(template())),template(),{signal:c.signal}));
});
test('missing/delayed attributable publication evidence remains waiting, not authenticated or terminal',async()=>{
 const ref=courierRequestRef(template(),'123',request(template())),commitSha='3'.repeat(40),event={type:'PushEvent',repo:{name:REPOSITORY},actor:{id:265701760,login:'hocheunglai-oss'},payload:{ref,head:commitSha}};
 assert.equal(await courierPublicationObserved(async()=>[],ref,commitSha),false);assert.equal(await courierPublicationObserved(async()=>[{...event,payload:{ref}}],ref,commitSha),false);
 assert.equal(await courierPublicationObserved(async()=>[event],ref,commitSha),true);event.actor.id=1;assert.equal(await courierPublicationObserved(async()=>[event],ref,commitSha),false);
});
test('ack binds actual HTTP result, request, run, job and next-step chain and cannot export secret keys',()=>{
 const t=template(),parsed=parseCourierTemplate(JSON.stringify(t)),r=JSON.parse(request(t)),result={kind:'fcos_xero_recovery_step_result_v1',operationId:binding.operationId,planSha256:parsed.planSha256,requestSha256:hash(request(t)),step:'preflight',submissionId:id(7),state:'ready',nextStep:'custodyPrepare',result:{renewalRequired:false,tokenVersion:449,expiresAt:new Date(T+3600000).toISOString(),observedAt:new Date(T).toISOString()},executionAuthorityGranted:false,qualificationAccepted:false};result.resultSha256=hash(canonical(result.result));
 const resultJson=JSON.stringify(result),ack={schemaVersion:1,kind:'fcos_xero_recovery_actual_http_ack_v1',templateSha256:parsed.templateSha256,runId:'123',jobId:22,requestRef:courierRequestRef(t,'123',request(t)),commitSha:'3'.repeat(40),requestSha256:hash(request(t)),hostOrigin:'https://fixed.vercel.app',deploymentId:'dpl_fixture',httpStatus:200,resultJson,resultSha256:hash(resultJson),receivedAt:T};
 const expected={...parsed,runId:'123',jobId:22,request:r,requestRef:ack.requestRef,commitSha:ack.commitSha,hostOrigin:ack.hostOrigin,deploymentId:ack.deploymentId,now:T};assert.equal(assertCourierAck(ack,expected).nextStep,'custodyPrepare');
 for(const mutate of [a=>a.commitSha=SHA,a=>a.httpStatus=202,a=>a.runId='124',a=>{const v=JSON.parse(a.resultJson);v.token='PRIVATE';a.resultJson=JSON.stringify(v);a.resultSha256=hash(a.resultJson);},a=>{const v=JSON.parse(a.resultJson);v.nextStep='sessionVerify';a.resultJson=JSON.stringify(v);a.resultSha256=hash(a.resultJson);}]){const a=structuredClone(ack);mutate(a);assert.throws(()=>assertCourierAck(a,expected));}
});
function readerFixture(tree){const t=template(),token='FIXTURE_READ_CREDENTIAL_'.repeat(3),team=fcosConnectionIdentifier('vercel','Team ID'),project=fcosConnectionIdentifier('vercel','Project ID'),credential={bearerSha256:hash(token),clientId:'cl_fixture',integrationId:'oac_fixture',configurationId:'icfg_fixture',teamId:team,projectId:project,scopes:['read:deployment','read:integration-configuration','read:project'],issuedAt:T-1000,notAfter:T+3600000};
 const review={schemaVersion:1,kind:'fcos_root_accepted_vercel_oauth_exchange',accepted:true,reviewerId:'/root',operator:'hocheunglai-oss',reviewedAt:new Date(T).toISOString(),originalExchangeReceiptSha256:H,configurationReadbackSha256:H,credential};const text=JSON.stringify(review);
 t.readCredential={schemaVersion:1,kind:'fcos_vercel_read_integration',...credential,oauthExchangeReceiptSha256:H,rootAcceptanceSha256:hash(text)};t.readAcceptance={vercelReadCredentialAcceptance:{json:text,sha256:hash(text)}};
 const calls=[],fetchImpl=async(url,o)=>{calls.push(String(url));assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);const path=new URL(url).pathname;
 if(path.startsWith('/v1/'))return json({id:'icfg_fixture',integrationId:'oac_fixture',teamId:team,ownerId:team,projectSelection:'selected',projects:[project],scopes:credential.scopes});
 if(path==='/v13/deployments/dpl_fixture')return json({id:'dpl_fixture',projectId:project,teamId:team,readyState:'READY',url:'fixed.vercel.app',customEnvironment:{slug:t.hostConfiguration.target.customEnvironment}});
 if(path==='/v6/deployments/dpl_fixture/files')return json(tree);throw Error('PRIVATE_UNEXPECTED_URL');};
 return {t,env:{FCOS_HOSTED_VERCEL_READ_TOKEN:token},fetchImpl,calls};}
test('actual approved reader path refuses opaque prebuilt function source before any login or host request',async()=>{
 const f=readerFixture([{name:'xero-recovery',type:'lambda',mode:33188}]);await assert.rejects(verifyCourierDeploymentBytes({...f,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:[{path:'a',sha256:H},{path:'b',sha256:H},{path:'c',sha256:H}],signal:new AbortController().signal,now:()=>T}),{code:'XERO_COURIER_SOURCE_BYTES_UNPROVEN'});
 assert.equal(f.calls.length,3);assert.ok(f.calls.every(u=>u.startsWith('https://api.vercel.com/')));
});
test('source inventory cannot omit or add bytes, substitute metadata digest, or follow redirects',async()=>{
 for(const tree of [[],[{name:'../index.mjs',type:'file',uid:'x'}],[{name:'index.mjs',type:'file',uid:'x',meta:{sourceDigest:H}}]]){const f=readerFixture(tree);await assert.rejects(verifyCourierDeploymentBytes({...f,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:[],signal:new AbortController().signal,now:()=>T}));assert.equal(f.calls.length,3);}
});
// Inert admission fixtures exercise byte/tuple binding only; they are never
// actual root/human/provider provenance. The real historical guard still denies.
function nativeFixture(){const controlRoot=realpathSync(mkdtempSync(join(tmpdir(),'fcos-native-courier-'))),t=template(),parsed=parseCourierTemplate(JSON.stringify(t)),stateDirectory=canonicalCourierStateDirectory(binding.operationId,controlRoot);
 mkdirSync(stateDirectory,{recursive:true,mode:0o700});mkdirSync(join(controlRoot,'.fcos-cli'),{recursive:true});writeFileSync(join(controlRoot,'.fcos-cli/release-state.json'),readFileSync('/Users/vincex/Documents/FCOS/.fcos-cli/release-state.json'));
 const b={runId:'123',jobId:22,hostOrigin:'https://fixed.vercel.app',deploymentId:'dpl_fixture',rootAdmissionSha256:H},save=(name,value)=>{const path=join(stateDirectory,name),bytes=JSON.stringify(value);writeFileSync(path,bytes,{mode:0o600});return{path,sha256:hash(bytes)};};
 const target={epoch:'production-reconciliation-20261005',featuresOwnerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',artifactCaptureAuthoritySha256:t.artifactCaptureAuthoritySha256,runId:b.runId,jobId:b.jobId,hostOrigin:b.hostOrigin,deploymentId:b.deploymentId,ownerThreadId:binding.ownerThreadId,actorId:binding.actorId,approvalSha256:binding.approvalSha256,sourceSha256:binding.sourceSha256,controllerSha:t.controllerSha},sourcePins=nativeCourierSourcePins();
 const evidence={originalAuthority:save('synthetic-authority.json',{fixture:'SYNTHETIC_NOT_AUTHORITY'}),artifactCaptureAuthority:save('synthetic-capture-authority.json',{fixture:'SYNTHETIC_NOT_CAPTURE_AUTHORITY'}),hostDeploymentSourceReceipt:save('synthetic-deployment.json',{fixture:'SYNTHETIC_NOT_PROVIDER_PROOF'}),coordinationQuota:save('synthetic-quota.json',{kind:'fcos_actual_xero_courier_shared_get_quota_v1',accepted:true,repository:REPOSITORY,nativeGetsPerMinute:20,carrierGetsPerMinute:20,sharedMaximum:45,maximumConcurrentClients:2,actualSharedPreflightReviewed:true})};
 const scopeSha256=hash(canonical({templateSha256:parsed.templateSha256,planSha256:parsed.planSha256,target,sourcePins,evidence}));
 for(const [name,role,reviewerId] of [['rootReview','root','/root'],['independentReview','independent','/root/other_reviewer']])evidence[name]=save(name+'.json',{kind:'fcos_actual_native_xero_courier_action_review_v1',accepted:true,role,reviewerId,scopeSha256,originalHumanAuthorityProvenanceReviewed:true,actualDeploymentSourceProvenanceReviewed:true,actualSharedCoordinationQuotaReviewed:true});
 const admission={schemaVersion:1,kind:'fcos_root_admitted_native_xero_courier_v1',reviewerId:'/root',accepted:true,templateSha256:parsed.templateSha256,planSha256:parsed.planSha256,target,sourcePins,evidence,scopeSha256};b.rootAdmissionSha256=save('root-native-admission.json',admission).sha256;
 return{controlRoot,t,parsed,stateDirectory,b,admission,save,options:{templateJson:JSON.stringify(t),binding:b,stateDirectory,controlRoot,now:()=>T},clean:()=>rmSync(controlRoot,{recursive:true,force:true})};}
test('native real guard rejects historical-owner reconciliation before credential reads or Git publication',async()=>{
 const f=nativeFixture();try{const relay=await createNativeXeroRecoveryRelay(f.options);await assert.rejects(relay.submit(request(f.t)),{code:'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED'});
 const files=readdirSync(f.stateDirectory);assert.ok(files.some(n=>n.endsWith('.claim-attempt.json')));const stopped=JSON.parse(readFileSync(join(f.stateDirectory,`${binding.operationId}.stopped.json`)));assert.equal(stopped.readbackOnly,true);
 await assert.rejects(relay.submit(request(f.t)),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});await assert.rejects(relay.readback(request(f.t)));assert.doesNotMatch(JSON.stringify(stopped),/PRIVATE_|access_token|password/);
 }finally{f.clean();}
});
test('native canonical state and actual admission bytes cannot be replaced by a digest or alternate directory',async()=>{
 const f=nativeFixture();try{await assert.rejects(createNativeXeroRecoveryRelay({...f.options,stateDirectory:join(f.controlRoot,'alternate')}),{code:'XERO_COURIER_CANONICAL_STATE_REQUIRED'});
 assert.throws(()=>assertNativeCourierAdmission({...f.parsed,coordinatorEpoch:'production-reconciliation-20261005',binding:{...f.b,rootAdmissionSha256:'b'.repeat(64)},stateDirectory:f.stateDirectory,controlRoot:f.controlRoot}),{code:'XERO_COURIER_ROOT_ADMISSION_REQUIRED'});
 const altered={...f.admission,target:{...f.admission.target,jobId:23}};f.b.rootAdmissionSha256=f.save('root-native-admission.json',altered).sha256;await assert.rejects(createNativeXeroRecoveryRelay(f.options),{code:'XERO_COURIER_ROOT_ADMISSION_REQUIRED'});
 }finally{f.clean();}
});
test('an existing local claim attempt or matching-looking held receipt never permits initial claim adoption',async()=>{
 const f=nativeFixture();try{writeFileSync(join(f.stateDirectory,`${binding.operationId}.claim-attempt.json`),'{}');writeFileSync(join(f.stateDirectory,`${binding.operationId}.held-lease.json`),JSON.stringify({binding:f.b,lease:{leaseId:id(8)}}));
 const relay=await createNativeXeroRecoveryRelay({...f.options,capture:()=>assert.fail('Consumed initial claim cannot invoke even the Python command')});await assert.rejects(relay.submit(request(f.t)),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});
 }finally{f.clean();}
});
test('whole carrier entrypoint fails closed on actual run mismatch without login, OIDC or provider writes',async()=>{
 const t=template(),calls=[],env={GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789',GITHUB_REPOSITORY:REPOSITORY,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',FCOS_XERO_CARRIER_TEMPLATE_BASE64:Buffer.from(JSON.stringify(t)).toString('base64')};
 await assert.rejects(carrierMain(env,{now:()=>T,fetchImpl:async(u,o)=>{calls.push([u,o.method]);return json(u.endsWith(`/repos/${REPOSITORY}`)?{id:1278654816,full_name:REPOSITORY}:{id:123,run_attempt:2});}}),{code:'XERO_COURIER_RUN_MISMATCH'});assert.equal(calls.length,2);assert.ok(calls.every(([u,m])=>u.startsWith('https://api.github.com/')&&m==='GET'));
});
test('errors never propagate arbitrary provider code, raw token, or throwing accessors',async()=>{
 for(const e of [Error('PRIVATE_TOKEN'),{code:'XERO_PRIVATE_PROVIDER_TOKEN'},{get code(){throw Error('PRIVATE');}}])assert.equal(safeCode(e),'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED');
 const signal=new AbortController();signal.abort();const read=courierGithubReader({env:{GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789'},signal:signal.signal,fetchImpl:()=>assert.fail('No transport after cancellation')});await assert.rejects(read(`repos/${REPOSITORY}`));
});

test('physical reusable bootstrap checks a real signed workflow SHA before checkout and secrets',async()=>{
 const yaml=createRequire(import.meta.url)('js-yaml'),workflow=yaml.load(readFileSync(new URL('../.github/workflows/hosted-xero-recovery-carrier.yml',import.meta.url),'utf8'));
 const steps=workflow.jobs['xero-recovery-carrier'].steps,script=steps[0].with.script;assert.equal(steps[0].env.FCOS_HOSTED_RUNTIME_PASSWORD,undefined);assert.match(steps[1].with.ref,/admitted-controller.outputs.controller_sha/);
 const audience='urn:fcos:xero-recovery-carrier-bootstrap:v1',token=await new SignJWT(claims(template())).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://token.actions.githubusercontent.com').setAudience(audience).sign(key.privateKey);
 for(const expected of [CONTROLLER,SHA]){const outputs=[];const execute=()=>runInNewContext(`(async()=>{${script}})()`,{require:()=>crypto,Buffer,Date,AbortSignal,process:{env:{GITHUB_RUN_ID:'123',EXPECTED_CONTROLLER_SHA:expected}},fetch:async()=>json({keys:[jwk]}),core:{getIDToken:async a=>{assert.equal(a,audience);return token;},setOutput:(k,v)=>outputs.push([k,v])}});
 if(expected===CONTROLLER){await execute();assert.deepEqual(outputs,[['controller_sha',CONTROLLER]]);}else{await assert.rejects(execute(),/XERO_COURIER_CONTROLLER_BOOTSTRAP_REFUSED/);assert.deepEqual(outputs,[]);}}
});
test('exact byte comparison reads all three source files and rejects a substituted final byte',async()=>{
 const names=['a','b','c'],files=names.map((path,i)=>{const bytes=Buffer.from(`actual fixture source ${i}`);return {path,bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64')};});
 for(const wrong of [false,true]){const f=readerFixture(names.map(name=>({name,type:'file',mode:33188,uid:name}))),original=f.fetchImpl;let contents=0;f.fetchImpl=async(u,o)=>{if(new URL(u).pathname.startsWith('/v8/')){contents++;const index=names.indexOf(new URL(u).pathname.split('/').at(-1));return new Response(Buffer.from(files[index].contentBase64,'base64').toString()+((wrong&&index===2)?'x':''));}return original(u,o);};
 const action=verifyCourierDeploymentBytes({...f,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:files,signal:new AbortController().signal,now:()=>T});
 if(wrong)await assert.rejects(action,{code:'XERO_COURIER_SOURCE_BYTES_UNPROVEN'});else assert.equal((await action).origin,'https://fixed.vercel.app');assert.equal(contents,3);}
});

test('capture boundary refuses a new artifact write when cancellation or expiry follows HTTP result',async()=>{
 const ack={kind:'already-validated-actual-http-fixture'},t=template(),c=new AbortController();c.abort();
 // The actual SDK capture entrypoint is invoked; no SDK fixture can manufacture
 // success. Cancellation/expiry is checked before even creating its directory.
 await assert.rejects(captureCourierAck({ack,t,runId:'123',submissionId:id(7),signal:c.signal,now:()=>T}),{code:'XERO_COURIER_AUTHORITY_EXPIRED'});
 await assert.rejects(captureCourierAck({ack,t,runId:'123',submissionId:id(7),signal:new AbortController().signal,now:()=>t.notAfter}),{code:'XERO_COURIER_AUTHORITY_EXPIRED'});
});

test('native and carrier rolling GET allocations total40/min with cancellation and five/min headroom',async()=>{
 let at=0;const sleeps=[],c=new AbortController(),budget=createCourierReadBudget({now:()=>at,wait:async ms=>{sleeps.push(ms);at+=ms;},signal:c.signal});
 for(let i=0;i<21;i++)await budget();assert.deepEqual(sleeps,[60000]);assert.equal(at,60000);c.abort();await assert.rejects(budget());
});
function packageTemplate(){const t=template(),sourcePins=xeroHostPackageSourcePins(),caller=Object.fromEntries(Object.entries(t.caller).filter(([k])=>k!=='jobName'));caller.runId=null;
 t.hostConfiguration={schemaVersion:1,kind:'fcos_compiled_xero_vercel_host_v1',target:{teamId:fcosConnectionIdentifier('vercel','Team ID'),projectId:fcosConnectionIdentifier('vercel','Project ID'),customEnvironment:'fcos-xero-recovery-111111111111',controllerSha:CONTROLLER,hostSourceSha256:hash(JSON.stringify(sourcePins))},planJson:t.planJson,actorBinding:{actorId:binding.actorId,emailSha256:H,accessRevision:5},ownership:{featuresOwnerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',historicalOwnerThreadIds:[binding.ownerThreadId],approvalSha256:binding.approvalSha256,sourceSha256:binding.sourceSha256,controllerSha:CONTROLLER},caller,requestNonceSha256:H};return t;}
test('actual carrier packaging invokes real builder with nonexistent child output then verifies all actual package bytes',async()=>{
 const t=packageTemplate(),files=await buildCourierExpectedFiles({t,runId:'123'});assert.equal(files.length,3);assert.ok(files.some(f=>f.path.endsWith('/index.mjs')&&f.bytes>1000));
 const tree=[],byUid=new Map();for(const [index,f] of files.entries()){let rows=tree;const parts=f.path.split('/');for(const name of parts.slice(0,-1)){let directory=rows.find(v=>v.name===name);if(!directory){directory={name,type:'directory',mode:16877,children:[]};rows.push(directory);}rows=directory.children;}const uid='fixture'+index;rows.push({name:parts.at(-1),type:'file',mode:33188,uid});byUid.set(uid,Buffer.from(f.contentBase64,'base64'));}
 const f=readerFixture(tree);t.readCredential=f.t.readCredential;t.readAcceptance=f.t.readAcceptance;const original=f.fetchImpl;const response=await verifyCourierDeploymentBytes({...f,t,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:files,signal:new AbortController().signal,now:()=>T,fetchImpl:async(u,o)=>new URL(u).pathname.startsWith('/v8/')?new Response(byUid.get(new URL(u).pathname.split('/').at(-1))):original(u,o)});assert.equal(response.deploymentId,'dpl_fixture');
});

test('whole warm carrier reaches actual real-builder output before opaque provider-tree denial, with zero login or host writes',async()=>{
 const t=packageTemplate(),f=readerFixture([{name:'xero-recovery',type:'lambda',mode:33188}]);t.readCredential=f.t.readCredential;t.readAcceptance=f.t.readAcceptance;
 const locator=JSON.stringify({schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'}),bytes=Buffer.from(locator),blob=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),commit='3'.repeat(40),tree='4'.repeat(40),ref=courierPrefix(t,'123')+'/locator',calls=[];
 const repository={id:1278654816,full_name:REPOSITORY},run={id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'in_progress'};
 const env={...f.env,GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789',GITHUB_REPOSITORY:REPOSITORY,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'},fetchImpl=async(u,o)=>{calls.push([String(u),o.method]);const url=new URL(u);if(url.hostname==='api.vercel.com')return f.fetchImpl(u,o);assert.equal(url.hostname,'api.github.com');const p=url.pathname;
 if(p===`/repos/${REPOSITORY}`)return json(repository);if(p.endsWith('/actions/runs/123'))return json(run);if(p.endsWith('/attempts/1/jobs'))return json({total_count:1,jobs:[{id:22,run_id:123,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'in_progress'}]});
 if(p.endsWith('/git/ref/'+ref.slice(5)))return json({ref,object:{type:'commit',sha:commit}});if(p.endsWith('/git/commits/'+commit))return json({sha:commit,parents:[],tree:{sha:tree}});if(p.endsWith('/git/trees/'+tree))return json({sha:tree,truncated:false,tree:[{path:'locator.json',mode:'100644',type:'blob',sha:blob}]});if(p.endsWith('/git/blobs/'+blob))return json({sha:blob,encoding:'base64',content:bytes.toString('base64'),size:bytes.length});if(p.endsWith('/events'))return json([{type:'PushEvent',repo:{name:REPOSITORY},actor:{id:265701760,login:'hocheunglai-oss'},payload:{ref,head:commit}}]);assert.fail('Unexpected or credential-bearing transport');};
 await assert.rejects(runWarmXeroRecoveryCarrier({templateJson:JSON.stringify(t),env,fetchImpl,now:()=>T,signal:new AbortController().signal,wait:()=>assert.fail('No readiness loop needed')}),{code:'XERO_COURIER_SOURCE_BYTES_UNPROVEN'});
 assert.ok(calls.some(([u])=>u.includes('/v6/deployments/dpl_fixture/files')));assert.ok(calls.every(([u,m])=>m==='GET'&&(u.startsWith('https://api.github.com/')||u.startsWith('https://api.vercel.com/'))));
});
