import test from 'node:test';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {materialZip} from './helpers/runtimeMaterialTransport.mjs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { parseCourierTemplate, parseCourierRequest, courierRequestRef, courierPrefix, canonicalCourierStateDirectory, nativeCourierSourcePins, createCourierReadBudget, assertNativeCourierAdmission, createNativeXeroRecoveryRelay, createNativeXeroRecoveryWarmDispatcher, originalWarmVariable, ORIGINAL_WARM_TEMPLATE_VARIABLE, assertCourierAck, parseOwnerReadbackCarrier, assertOwnerReadbackAck, ownerReadbackArtifactName,
  courierPublicationStatus, assertCourierPublicationStatus, canonical, hash, safeCode, REPOSITORY } from '../scripts/lib/hosted-release/xero-recovery-native-relay.mjs';
import { carrierMain, runWarmXeroRecoveryCarrier, runXeroRecoveryOwnerReadback, buildCourierExpectedFiles, captureCourierAck, verifyCourierOidc, verifyCourierDeploymentBytes, courierPublicationObserved, courierGithubReader } from '../scripts/hosted-xero-recovery-carrier.mjs';
import { prepareXeroRecoveryStepRequest } from '../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';
import {xeroHostPackageSourcePins} from '../scripts/package-xero-recovery-host.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
const T=Date.now(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,SHA='1'.repeat(40),CONTROLLER='2'.repeat(40),H='a'.repeat(64);
const binding={operationId:hash('original operation'),ownerThreadId:id(1),tenantId:id(2),actorId:id(3),expectedVersion:449,refreshLeaseId:id(4),probeId:id(5),requestId:id(6),approvalSha256:H,sourceSha256:H,bindingSha256:H,organisationIdentitySha256:null,issuedAt:T-1000,notAfter:T+899000,credentialPreservationCompositeApproved:true};
function template(version=1){return {schemaVersion:version,kind:`fcos_xero_recovery_carrier_template_v${version}`,planJson:canonical({schemaVersion:version,kind:`fcos_xero_recovery_step_plan_v${version}`,binding:{...binding,notAfter:T+(version===2?1799000:899000)}}),controllerSha:CONTROLLER,
 caller:{ref:'refs/heads/fcos-reviewed-carrier',sha:SHA,workflowRef:`${REPOSITORY}/.github/workflows/authenticated-release.yml@refs/heads/fcos-reviewed-carrier`,workflowSha:SHA,jobWorkflowRef:`${REPOSITORY}/.github/workflows/hosted-xero-recovery-carrier.yml@${CONTROLLER}`,jobWorkflowSha:CONTROLLER,jobName:'xero-recovery-carrier',environment:'fcos-hosted-verification',subject:`repo:${REPOSITORY}:environment:fcos-hosted-verification`},
 hostConfiguration:{target:{customEnvironment:'fcos-xero-recovery-111111111111'}},readCredential:{},readAcceptance:{},login:{origin:'https://legacy.vercel.app',publicAuth:{}},issuedAt:T-1000,notAfter:T+(version===2?1799000:899000),artifactCaptureAuthoritySha256:H};}
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
function publicationValue(expected,patch={}){return {...expected.body,id:701,url:`https://api.github.com/${expected.route}`,creator:{id:265701760,login:'hocheunglai-oss'},created_at:new Date(T).toISOString(),updated_at:new Date(T).toISOString(),...patch};}
test('platform creator and exact ref/commit/run/operation/raw bytes authenticate publication; missing remains waiting',async()=>{
 const t=template(),input={templateJson:JSON.stringify(t),runId:'123',ref:courierRequestRef(t,'123',request(t)),commitSha:'3'.repeat(40),raw:request(t),kind:'request'},expected=courierPublicationStatus(input),valid=publicationValue(expected);
 assert.equal(await courierPublicationObserved(async route=>{assert.equal(route,expected.readRoute);return[];},input,T),false);
 assert.equal(await courierPublicationObserved(async()=>[valid],input,T),true);assert.equal(assertCourierPublicationStatus(valid,expected,T).creator.id,265701760);
 for(const patch of [{creator:{id:1,login:'hocheunglai-oss'}},{creator:{id:265701760,login:'foreign'}},{url:'https://api.github.com/repos/foreign/fcos/statuses/'+input.commitSha},{target_url:expected.body.target_url+'foreign'},{description:'request '+'b'.repeat(64)},{context:expected.body.context.toUpperCase()},{state:'pending'}])await assert.rejects(courierPublicationObserved(async()=>[{...valid,...patch}],input,T),{code:'XERO_COURIER_PUBLICATION_INVALID'});
 for(const changed of [{...input,commitSha:'4'.repeat(40)},{...input,templateJson:JSON.stringify({...t,artifactCaptureAuthoritySha256:'b'.repeat(64)})}])assert.equal(await courierPublicationObserved(async()=>[valid],changed,T),false);
 for(const changed of [{...input,ref:input.ref+'-foreign'},{...input,runId:'124'},{...input,raw:canonical({...JSON.parse(input.raw),submissionId:id(99)})}])await assert.rejects(courierPublicationObserved(async()=>[valid],changed,T));
 for(const rows of [[valid,valid],Array.from({length:100},()=>valid),{}])await assert.rejects(courierPublicationObserved(async()=>rows,input,T),{code:'XERO_COURIER_PUBLICATION_INVALID'});
});
test('exact commit statuses never read oversized unrelated Events and reject incomplete status pagination',async()=>{
 const t=template(),input={templateJson:JSON.stringify(t),runId:'123',ref:courierRequestRef(t,'123',request(t)),commitSha:'3'.repeat(40),raw:request(t),kind:'request'},expected=courierPublicationStatus(input),calls=[],oversizedUnrelatedEvents='x'.repeat(263204);assert(oversizedUnrelatedEvents.length>262144);
 for(const paginated of [false,true]){const reader=courierGithubReader({env:{GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789'},signal:new AbortController().signal,now:()=>T,fetchImpl:async u=>{calls.push(String(u));if(String(u).includes('/events'))return new Response(oversizedUnrelatedEvents);return new Response(JSON.stringify([publicationValue(expected)]),{headers:{'content-type':'application/json',...(paginated?{link:'<https://api.github.com/next>; rel="next"'}:{})}});}});
 const result=courierPublicationObserved(reader,input,T);if(paginated)await assert.rejects(result,{code:'XERO_COURIER_PUBLICATION_INVALID'});else assert.equal(await result,true);}
 assert.equal(calls.length,2);assert(calls.every(u=>u.endsWith('/commits/'+input.commitSha+'/statuses?per_page=100')));
});
test('ack binds actual HTTP result, request, run, job and next-step chain and cannot export secret keys',()=>{
 const t=template(),parsed=parseCourierTemplate(JSON.stringify(t)),r=JSON.parse(request(t)),result={kind:'fcos_xero_recovery_step_result_v1',operationId:binding.operationId,planSha256:parsed.planSha256,requestSha256:hash(request(t)),step:'preflight',submissionId:id(7),state:'ready',nextStep:'custodyPrepare',result:{renewalRequired:false,tokenVersion:449,expiresAt:new Date(T+3600000).toISOString(),observedAt:new Date(T).toISOString()},executionAuthorityGranted:false,qualificationAccepted:false};result.resultSha256=hash(canonical(result.result));
 const resultJson=JSON.stringify(result),ack={schemaVersion:1,kind:'fcos_xero_recovery_actual_http_ack_v1',templateSha256:parsed.templateSha256,runId:'123',jobId:22,requestRef:courierRequestRef(t,'123',request(t)),commitSha:'3'.repeat(40),requestSha256:hash(request(t)),hostOrigin:'https://fixed.vercel.app',deploymentId:'dpl_fixture',httpStatus:200,resultJson,resultSha256:hash(resultJson),receivedAt:T};
 const expected={...parsed,runId:'123',jobId:22,request:r,requestRef:ack.requestRef,commitSha:ack.commitSha,hostOrigin:ack.hostOrigin,deploymentId:ack.deploymentId,now:T};assert.equal(assertCourierAck(ack,expected).nextStep,'custodyPrepare');
 for(const mutate of [a=>a.commitSha=SHA,a=>a.httpStatus=202,a=>a.runId='124',a=>{const v=JSON.parse(a.resultJson);v.token='PRIVATE';a.resultJson=JSON.stringify(v);a.resultSha256=hash(a.resultJson);},a=>{const v=JSON.parse(a.resultJson);v.nextStep='sessionVerify';a.resultJson=JSON.stringify(v);a.resultSha256=hash(a.resultJson);}]){const a=structuredClone(ack);mutate(a);assert.throws(()=>assertCourierAck(a,expected));}
});
// Public synthetic provider layout follows actual observed src/out topology;
// original source UIDs are content SHA1, while OUT lambda is only route evidence.
function providerInventory(files,route='xero-recovery'){
 const tree=[],byUid=new Map(),directories=parts=>{let rows=tree;for(const name of parts){let row=rows.find(v=>v.name===name);if(!row){row={name,type:'directory',mode:16749,children:[]};rows.push(row);}rows=row.children;}return rows;};
 for(const file of files){const raw=Buffer.from(file.contentBase64,'base64'),uid=crypto.createHash('sha1').update(raw).digest('hex'),parts=('src/'+file.path).split('/');directories(parts.slice(0,-1)).push({name:parts.at(-1),type:'file',mode:33152,uid});byUid.set(uid,raw);}
 const parts=('out/'+route).split('/');directories(parts.slice(0,-1)).push({name:parts.at(-1),type:'lambda',mode:49590,uid:fcosConnectionIdentifier('vercel','Team ID')+'-'+'f'.repeat(34)});return{tree,byUid};
}
function readerFixture(tree,deploymentPatch={}){const t=template(),token='FIXTURE_READ_CREDENTIAL_'.repeat(3),team=fcosConnectionIdentifier('vercel','Team ID'),project=fcosConnectionIdentifier('vercel','Project ID'),credential={bearerSha256:hash(token),clientId:'cl_fixture',integrationId:'oac_fixture',configurationId:'icfg_fixture',teamId:team,projectId:project,scopes:['read:deployment','read:integration-configuration','read:project'],issuedAt:T-1000,notAfter:T+3600000};
 const review={schemaVersion:1,kind:'fcos_root_accepted_vercel_oauth_exchange',accepted:true,reviewerId:'/root',operator:'hocheunglai-oss',reviewedAt:new Date(T).toISOString(),originalExchangeReceiptSha256:H,configurationReadbackSha256:H,credential};const text=JSON.stringify(review);
 t.readCredential={schemaVersion:1,kind:'fcos_vercel_read_integration',...credential,oauthExchangeReceiptSha256:H,rootAcceptanceSha256:hash(text)};t.readAcceptance={vercelReadCredentialAcceptance:{json:text,sha256:hash(text)}};
 const calls=[],fetchImpl=async(url,o)=>{calls.push(String(url));assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);const path=new URL(url).pathname;
 if(path.startsWith('/v1/'))return json({id:'icfg_fixture',integrationId:'oac_fixture',teamId:team,ownerId:team,projectSelection:'selected',projects:[project],scopes:credential.scopes});
 if(path==='/v13/deployments/dpl_fixture')return json({id:'dpl_fixture',projectId:project,teamId:team,readyState:'READY',url:'fixed.vercel.app',customEnvironment:{slug:t.hostConfiguration.target.customEnvironment},...deploymentPatch});
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
// actual root/human/provider provenance. Python refusal is an explicit synthetic
// completed nonzero fixture, not execution of the operational guard source.
function nativeFixture(version=1){const controlRoot=realpathSync(mkdtempSync(join(tmpdir(),'fcos-native-courier-'))),t=template(version),parsed=parseCourierTemplate(JSON.stringify(t)),stateDirectory=canonicalCourierStateDirectory(binding.operationId,controlRoot);
 mkdirSync(stateDirectory,{recursive:true,mode:0o700});const workflow=join(controlRoot,'workflow.json'),board=join(controlRoot,'workboard.json');
 writeFileSync(workflow,JSON.stringify({unifiedCoordinator:{epoch:'production-reconciliation-20261005'}}));writeFileSync(board,JSON.stringify({checkpointPaths:{workflow}}));
 writeFileSync(join(controlRoot,'.fcos-cli/release-state.json'),JSON.stringify({workboardPath:board}));
 const b={runId:'123',jobId:22,hostOrigin:'https://fixed.vercel.app',deploymentId:'dpl_fixture',rootAdmissionSha256:H},save=(name,value)=>{const path=join(stateDirectory,name),bytes=JSON.stringify(value);writeFileSync(path,bytes,{mode:0o600});return{path,sha256:hash(bytes)};};
 const target={epoch:'production-reconciliation-20261005',featuresOwnerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',artifactCaptureAuthoritySha256:t.artifactCaptureAuthoritySha256,runId:b.runId,jobId:b.jobId,hostOrigin:b.hostOrigin,deploymentId:b.deploymentId,ownerThreadId:binding.ownerThreadId,actorId:binding.actorId,approvalSha256:binding.approvalSha256,sourceSha256:binding.sourceSha256,controllerSha:t.controllerSha},sourcePins=nativeCourierSourcePins();
 const evidence={originalAuthority:save('synthetic-authority.json',{fixture:'SYNTHETIC_NOT_AUTHORITY'}),artifactCaptureAuthority:save('synthetic-capture-authority.json',{fixture:'SYNTHETIC_NOT_CAPTURE_AUTHORITY'}),hostDeploymentSourceReceipt:save('synthetic-deployment.json',{fixture:'SYNTHETIC_NOT_PROVIDER_PROOF'}),coordinationQuota:save('synthetic-quota.json',{kind:'fcos_actual_xero_courier_shared_get_quota_v1',accepted:true,repository:REPOSITORY,nativeGetsPerMinute:20,carrierGetsPerMinute:20,sharedMaximum:45,maximumConcurrentClients:2,actualSharedPreflightReviewed:true})};
 const scopeSha256=hash(canonical({templateSha256:parsed.templateSha256,planSha256:parsed.planSha256,target,sourcePins,evidence}));
 for(const [name,role,reviewerId] of [['rootReview','root','/root'],['independentReview','independent','/root/other_reviewer']])evidence[name]=save(name+'.json',{kind:'fcos_actual_native_xero_courier_action_review_v1',accepted:true,role,reviewerId,scopeSha256,originalHumanAuthorityProvenanceReviewed:true,actualDeploymentSourceProvenanceReviewed:true,actualSharedCoordinationQuotaReviewed:true,actualPublisherStatusScopeAndConsumersReviewed:true});
 const admission={schemaVersion:1,kind:'fcos_root_admitted_native_xero_courier_v1',reviewerId:'/root',accepted:true,templateSha256:parsed.templateSha256,planSha256:parsed.planSha256,target,sourcePins,evidence,scopeSha256};b.rootAdmissionSha256=save('root-native-admission.json',admission).sha256;
 return{controlRoot,t,parsed,stateDirectory,b,admission,save,options:{templateJson:JSON.stringify(t),binding:b,stateDirectory,controlRoot,now:()=>T},clean:()=>rmSync(controlRoot,{recursive:true,force:true})};}
test('synthetic completed Python refusal stops native boundary before credential reads or Git publication',async()=>{
 const f=nativeFixture();try{const commands=[];const relay=await createNativeXeroRecoveryRelay({...f.options,capture:(command)=>{commands.push(command);assert.equal(command,'/usr/bin/python3');return{status:1,stdout:'',stderr:'synthetic guard refusal'};}});await assert.rejects(relay.submit(request(f.t)),{code:'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED'});
 assert.deepEqual(commands,['/usr/bin/python3']);const files=readdirSync(f.stateDirectory);assert.ok(files.some(n=>n.endsWith('.claim-attempt.json')));const stopped=JSON.parse(readFileSync(join(f.stateDirectory,`${binding.operationId}.stopped.json`)));assert.equal(stopped.readbackOnly,true);
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
 assert.deepEqual(workflow.permissions,{contents:'read',actions:'read',statuses:'read','id-token':'write'});
 const steps=workflow.jobs['xero-recovery-carrier'].steps,script=steps[0].with.script;assert.equal(steps[0].env.FCOS_HOSTED_RUNTIME_PASSWORD,undefined);assert.match(steps[1].with.ref,/admitted-controller.outputs.controller_sha/);
 const audience='urn:fcos:xero-recovery-carrier-bootstrap:v1',token=await new SignJWT(claims(template())).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://token.actions.githubusercontent.com').setAudience(audience).sign(key.privateKey);
 for(const expected of [CONTROLLER,SHA]){const outputs=[];const execute=()=>runInNewContext(`(async()=>{${script}})()`,{require:()=>crypto,Buffer,Date,AbortSignal,process:{env:{GITHUB_RUN_ID:'123',EXPECTED_CONTROLLER_SHA:expected}},fetch:async()=>json({keys:[jwk]}),core:{getIDToken:async a=>{assert.equal(a,audience);return token;},setOutput:(k,v)=>outputs.push([k,v])}});
 if(expected===CONTROLLER){await execute();assert.deepEqual(outputs,[['controller_sha',CONTROLLER]]);}else{await assert.rejects(execute(),/XERO_COURIER_CONTROLLER_BOOTSTRAP_REFUSED/);assert.deepEqual(outputs,[]);}}
});
test('exact src/out mapping still independently reads all three original source contents and rejects a substituted final byte',async()=>{
 const names=['.vercel/output/config.json','.vercel/output/functions/xero-recovery.func/.vc-config.json','.vercel/output/functions/xero-recovery.func/index.mjs'],files=names.map((path,i)=>{const bytes=Buffer.from(`actual fixture source ${i}`);return{path,bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64')};}),inventory=providerInventory(files),uids=[...inventory.byUid.keys()];
 for(const wrong of [false,true]){const f=readerFixture(inventory.tree),original=f.fetchImpl;let contents=0;f.fetchImpl=async(u,o)=>{if(new URL(u).pathname.startsWith('/v8/')){contents++;const uid=new URL(u).pathname.split('/').at(-1);return new Response(inventory.byUid.get(uid).toString()+((wrong&&uid===uids[2])?'x':''));}return original(u,o);};
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
function packageTemplate(version=1){const t=template(version),sourcePins=xeroHostPackageSourcePins(),caller=Object.fromEntries(Object.entries(t.caller).filter(([k])=>k!=='jobName'));caller.runId=null;
 t.hostConfiguration={schemaVersion:1,kind:'fcos_compiled_xero_vercel_host_v1',target:{teamId:fcosConnectionIdentifier('vercel','Team ID'),projectId:fcosConnectionIdentifier('vercel','Project ID'),customEnvironment:'fcos-xero-recovery-111111111111',controllerSha:CONTROLLER,hostSourceSha256:hash(JSON.stringify(sourcePins))},planJson:t.planJson,actorBinding:{actorId:binding.actorId,emailSha256:H,accessRevision:5},ownership:{featuresOwnerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',historicalOwnerThreadIds:[binding.ownerThreadId],approvalSha256:binding.approvalSha256,sourceSha256:binding.sourceSha256,controllerSha:CONTROLLER},caller,requestNonceSha256:H};return t;}
test('actual carrier packaging invokes real builder with nonexistent child output then verifies all actual package bytes',async()=>{
 const t=packageTemplate(),files=await buildCourierExpectedFiles({t,runId:'123'});assert.equal(files.length,3);assert.ok(files.some(f=>f.path.endsWith('/index.mjs')&&f.bytes>1000));
 const{tree,byUid}=providerInventory(files);
 const f=readerFixture(tree);t.readCredential=f.t.readCredential;t.readAcceptance=f.t.readAcceptance;const original=f.fetchImpl;const response=await verifyCourierDeploymentBytes({...f,t,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:files,signal:new AbortController().signal,now:()=>T,fetchImpl:async(u,o)=>new URL(u).pathname.startsWith('/v8/')?new Response(byUid.get(new URL(u).pathname.split('/').at(-1))):original(u,o)});assert.equal(response.deploymentId,'dpl_fixture');
});

test('whole warm carrier reaches actual real-builder output before opaque provider-tree denial, with zero login or host writes',async()=>{
 const t=packageTemplate(),f=readerFixture([{name:'xero-recovery',type:'lambda',mode:33188}]);t.readCredential=f.t.readCredential;t.readAcceptance=f.t.readAcceptance;
 const locator=JSON.stringify({schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'}),bytes=Buffer.from(locator),blob=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),commit='3'.repeat(40),tree='4'.repeat(40),ref=courierPrefix(t,'123')+'/locator',calls=[];
 const repository={id:1278654816,full_name:REPOSITORY},run={id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'in_progress',display_title:'FCOS original Xero carrier '+id(40)};
 const env={...f.env,GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789',GITHUB_REPOSITORY:REPOSITORY,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'},fetchImpl=async(u,o)=>{calls.push([String(u),o.method]);const url=new URL(u);if(url.hostname==='api.vercel.com')return f.fetchImpl(u,o);assert.equal(url.hostname,'api.github.com');const p=url.pathname;
 if(p===`/repos/${REPOSITORY}`)return json(repository);if(p.endsWith('/actions/runs/123'))return json(run);if(p.endsWith('/attempts/1/jobs'))return json({total_count:1,jobs:[{id:22,run_id:123,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'in_progress'}]});
 if(p.endsWith('/git/ref/'+ref.slice(5)))return json({ref,object:{type:'commit',sha:commit}});if(p.endsWith('/git/commits/'+commit))return json({sha:commit,parents:[],tree:{sha:tree}});if(p.endsWith('/git/trees/'+tree))return json({sha:tree,truncated:false,tree:[{path:'locator.json',mode:'100644',type:'blob',sha:blob}]});if(p.endsWith('/git/blobs/'+blob))return json({sha:blob,encoding:'base64',content:bytes.toString('base64'),size:bytes.length});if(p.endsWith('/commits/'+commit+'/statuses'))return json([publicationValue(courierPublicationStatus({templateJson:JSON.stringify(t),runId:'123',ref,commitSha:commit,raw:locator,kind:'locator'}))]);assert.fail('Unexpected or credential-bearing transport');};
 await assert.rejects(runWarmXeroRecoveryCarrier({templateJson:JSON.stringify(t),env,fetchImpl,now:()=>T,signal:new AbortController().signal,wait:()=>assert.fail('No readiness loop needed')}),{code:'XERO_COURIER_SOURCE_BYTES_UNPROVEN'});
 assert.ok(calls.some(([u])=>u.includes('/v6/deployments/dpl_fixture/files')));assert.ok(calls.every(([u,m])=>m==='GET'&&(u.startsWith('https://api.github.com/')||u.startsWith('https://api.vercel.com/'))));
});

function readbackFixture(f){
 const expected={epoch:'production-reconciliation-20261005',objective:'reconciliation',ownerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',operationId:`xero-recovery-${binding.operationId}`,bindingSha256:hash(canonical({templateSha256:f.parsed.templateSha256,binding:f.b}))},lease={...expected,leaseId:id(20),coordinationOnly:true,providerAuthorityGranted:false,uncertainOutcomeRequiresReadback:true},raw=request(f.t);
 const held=f.save(`${binding.operationId}.held-lease.json`,{lease,binding:f.b,templateSha256:f.parsed.templateSha256,planSha256:f.parsed.planSha256}),stopped=f.save(`${binding.operationId}.stopped.json`,{readbackOnly:true,requestSha256:hash(raw)}),uncertain=f.save(`${binding.operationId}.preflight.uncertain.json`,{lease,state:'uncertain',durable:true});
 f.save(`${binding.operationId}.preflight.submitting.json`,{lease,state:'submitting',durable:true,rawRequestJson:raw});
 const scope={currentExecutorThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',historicalOwnerThreadId:binding.ownerThreadId,capability:{maximumDispatchPosts:1,maximumHostGets:1,maximumHostPosts:0,maximumSanitizedAckUploads:1,originalOutcomeMayResolve:false},templateSha256:f.parsed.templateSha256,planSha256:f.parsed.planSha256,binding:f.b,requestSha256:hash(raw),originalClaimSha256:held.sha256,originalStoppedSha256:stopped.sha256,originalUncertainSha256:uncertain.sha256,sourcePins:nativeCourierSourcePins(),dispatchId:id(21),issuedAt:T,notAfter:T+600000},scopeSha256=hash(canonical(scope)),reviews={};
 for(const [key,role,reviewerId]of [['rootReview','root','/root'],['independentReview','independent','/root/other_reviewer']])reviews[key]=f.save('readback-'+key+'.json',{kind:'fcos_actual_xero_owner_readback_dispatch_review_v1',accepted:true,role,reviewerId,scopeSha256,reviewedAt:new Date(T).toISOString(),actualOriginalSuccessfulClaimReviewed:true,actualStoppedUnknownOutcomeReviewed:true,actualOriginalAuthorityAndReadbackScopeReviewed:true,actualSharedCoordinationQuotaReviewed:true});
 const admission={schemaVersion:1,kind:'fcos_root_admitted_xero_owner_readback_dispatch_v1',accepted:true,reviewerId:'/root',scope,scopeSha256,...reviews,dispatchId:scope.dispatchId,issuedAt:scope.issuedAt,notAfter:scope.notAfter},path=f.save('root-owner-readback-admission.json',admission).path;
 return{raw,lease,path,admission,scope};
}
test('synthetic command fixture exercises one real JS-guarded readback dispatch, no ref push, no original claim/resolve and no replay',async()=>{
 const f=nativeFixture();try{const r=readbackFixture(f),calls=[],repository={id:1278654816,full_name:REPOSITORY},run={id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'completed'};
 const capture=(command,args,options)=>{calls.push([command,args]);if(command==='/usr/bin/python3'){const input=JSON.parse(options.input);assert.equal(input.mode,'assert');assert.deepEqual(input.lease,r.lease);return{status:0,stdout:JSON.stringify(r.lease)};}assert.equal(command,'fixture-gh');assert.equal(args[0],'api');const route=args[1];let value;
 if(args.includes('POST')){assert.equal(route,`repos/${REPOSITORY}/actions/workflows/authenticated-release.yml/dispatches`);const body=JSON.parse(options.input);assert.equal(body.ref,'fcos-reviewed-carrier');assert.equal(body.inputs.xero_recovery_mode,'owner-readback');const bundle=parseOwnerReadbackCarrier(Buffer.from(body.inputs.xero_recovery_readback_base64,'base64').toString(),f.parsed);assert.equal(bundle.originalBinding.runId,'123');return{status:0,stdout:'HTTP/2.0 204 No Content\r\n\r\n'};}
 if(route==='user')value={id:265701760,login:'hocheunglai-oss'};else if(route===`repos/${REPOSITORY}`)value=repository;else if(route.endsWith('/actions/runs/123'))value=run;else if(route.endsWith('/attempts/1/jobs?per_page=100'))value={total_count:1,jobs:[{id:route.includes('/456/')?33:22,run_id:route.includes('/456/')?456:123,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'completed'}]};else if(route.endsWith('/git/ref/heads/fcos-reviewed-carrier'))value={ref:f.t.caller.ref,object:{type:'commit',sha:SHA}};else if(route.endsWith('/actions/runs/456'))value={...run,id:456};else if(route.endsWith('/actions/runs/456/attempts/1/jobs?per_page=100'))value={total_count:1,jobs:[{id:33,run_id:456,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'completed'}]};else if(route.endsWith('/actions/runs/456/artifacts?per_page=100'))value={total_count:0,artifacts:[]};else assert.fail('Unexpected command');return{status:0,stdout:JSON.stringify(value)};};
 const relay=await createNativeXeroRecoveryRelay({...f.options,capture,nativeRuntime:{credentialAvailable:true,command:'fixture-gh',env:{PATH:'/fixture',HOME:f.controlRoot,GH_CONFIG_DIR:f.controlRoot}}});const result=await relay.dispatchOwnerReadback(r.raw,r.path);assert.equal(r.scope.currentExecutorThreadId,'01a0f08b-7fcb-7870-9edc-343e16052b62');assert.equal(r.scope.historicalOwnerThreadId,binding.ownerThreadId);assert.notEqual(r.scope.currentExecutorThreadId,r.scope.historicalOwnerThreadId);assert.equal(result.status,'owner_readback_dispatched_result_pending');assert.equal(result.originalOutcomeResolved,false);assert.equal(calls.filter(([,a])=>a.includes('POST')).length,1);
 const count=calls.length;await assert.rejects(relay.dispatchOwnerReadback(r.raw,r.path));assert.equal(calls.length,count);assert.ok(readFileSync(join(f.stateDirectory,`${binding.operationId}.stopped.json`)));assert.ok(calls.every(([cmd])=>cmd!=='/usr/bin/git'));const beforeInvalid=calls.length;for(const badRun of ['../user','123','0','9007199254740992'])await assert.rejects(relay.ownerReadbackResult(r.raw,badRun,33));assert.equal(calls.length,beforeInvalid);const countBeforeGet=calls.length;const missing=await relay.ownerReadbackResult(r.raw,'456',33);assert.equal(missing.status,'unknown_owner_readback_required');assert.equal(missing.originalOutcomeResolved,false);assert.ok(calls.slice(countBeforeGet).every(([,args])=>!args.includes('POST')));
 }finally{f.clean();}
});
test('readback dispatch requires original successful claim, actual uncertainty and separate independent provenance review before commands',async()=>{
 for(const mutate of [f=>rmSync(join(f.stateDirectory,`${binding.operationId}.held-lease.json`)),f=>rmSync(join(f.stateDirectory,`${binding.operationId}.preflight.uncertain.json`)),(f,r)=>{const a=structuredClone(r.admission);a.scope.binding.runId='456';f.save('root-owner-readback-admission.json',a);},(f,r)=>{const a=structuredClone(r.admission);a.independentReview=f.save('bad-independent.json',{kind:'fcos_actual_xero_owner_readback_dispatch_review_v1',accepted:true,reviewerId:'/root/xero_host_actor_auth'});f.save('root-owner-readback-admission.json',a);}]){const f=nativeFixture();try{const r=readbackFixture(f);mutate(f,r);const relay=await createNativeXeroRecoveryRelay({...f.options,capture:()=>assert.fail('No commands before original/admission proof')});await assert.rejects(relay.dispatchOwnerReadback(r.raw,r.path));}finally{f.clean();}}
});
test('readback acknowledgements bind original operation, distinct current run and admitted dispatch, unknown stays unknown',()=>{
 const f=nativeFixture();try{const r=readbackFixture(f),bundle={schemaVersion:1,kind:'fcos_xero_owner_readback_carrier_v1',templateSha256:f.parsed.templateSha256,planSha256:f.parsed.planSha256,originalBinding:f.b,requestSha256:hash(r.raw),originalClaimSha256:r.scope.originalClaimSha256,originalStoppedSha256:r.scope.originalStoppedSha256,originalUncertainSha256:r.scope.originalUncertainSha256,admissionScopeSha256:r.admission.scopeSha256,dispatchId:r.scope.dispatchId,issuedAt:T,notAfter:T+600000};
 const result={kind:'fcos_xero_recovery_step_readback_v1',operationId:binding.operationId,planSha256:f.parsed.planSha256,state:'submitted_unknown',nextStep:null,currentStep:'preflight',submissionId:id(7),lastResultSha256:null,checkpoint:{},executionAuthorityGranted:false,qualificationAccepted:false},resultJson=JSON.stringify(result),ack={schemaVersion:1,kind:'fcos_xero_owner_readback_actual_http_ack_v1',templateSha256:f.parsed.templateSha256,planSha256:f.parsed.planSha256,admissionScopeSha256:bundle.admissionScopeSha256,dispatchId:bundle.dispatchId,originalRunId:'123',readerRunId:'456',readerJobId:33,hostOrigin:f.b.hostOrigin,deploymentId:f.b.deploymentId,httpStatus:200,resultJson,resultSha256:hash(resultJson),receivedAt:T};
 const args={parsed:f.parsed,readback:bundle,readerRunId:'456',readerJobId:33,now:T};assert.equal(assertOwnerReadbackAck(ack,args).state,'submitted_unknown');for(const patch of [{originalRunId:'789'},{readerRunId:'123'},{dispatchId:id(99)},{deploymentId:'dpl_other'},{resultJson:JSON.stringify({...result,secret:'PRIVATE'})}])assert.throws(()=>assertOwnerReadbackAck({...ack,...patch},args));assert.notEqual(ownerReadbackArtifactName('123','456',binding.operationId),ownerReadbackArtifactName('123','457',binding.operationId));
 }finally{f.clean();}
});

test('full new-reader carrier verifies fresh signed current run and ORIGINAL run-expanded package before login, never reads command refs',async()=>{
 const t=packageTemplate(),files=await buildCourierExpectedFiles({t,runId:'123'}),{tree,byUid:contents}=providerInventory(files);
 const reader=readerFixture(tree);t.readCredential=reader.t.readCredential;t.readAcceptance=reader.t.readAcceptance;
 const parsed=parseCourierTemplate(JSON.stringify(t)),r={schemaVersion:1,kind:'fcos_xero_owner_readback_carrier_v1',templateSha256:parsed.templateSha256,planSha256:parsed.planSha256,originalBinding:{runId:'123',jobId:22,hostOrigin:'https://fixed.vercel.app',deploymentId:'dpl_fixture',rootAdmissionSha256:H},requestSha256:hash(request(t)),originalClaimSha256:H,originalStoppedSha256:H,originalUncertainSha256:H,admissionScopeSha256:H,dispatchId:id(21),issuedAt:T,notAfter:T+600000};
 const audience=`https://fixed.vercel.app/xero-recovery/owner-readback/123/${parsed.planSha256}`,token=await new SignJWT({...claims(t),run_id:'456'}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://token.actions.githubusercontent.com').setAudience(audience).sign(key.privateKey);
 const repository={id:1278654816,full_name:REPOSITORY},calls=[],env={...reader.env,GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789',GITHUB_REPOSITORY:REPOSITORY,GITHUB_RUN_ID:'456',GITHUB_RUN_ATTEMPT:'1',ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/oidc',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'FIXTURE_ID_TOKEN_REQUEST'};
 const fetchImpl=async(u,o)=>{const url=new URL(u);calls.push([url.href,o.method]);assert.equal(o.method,'GET');assert.ok(o.signal instanceof AbortSignal);
 if(url.hostname==='api.vercel.com'){if(url.pathname.startsWith('/v8/'))return new Response(contents.get(url.pathname.split('/').at(-1)));return reader.fetchImpl(u,o);}
 if(url.hostname==='pipelines.actions.githubusercontent.com'){assert.equal(url.searchParams.get('audience'),audience);return json({value:token});}
 assert.equal(url.hostname,'api.github.com');const p=url.pathname;if(p===`/repos/${REPOSITORY}`)return json(repository);
 const match=p.match(/\/actions\/runs\/(123|456)(\/attempts\/1\/jobs)?$/);assert.ok(match,'No command ref or host HTTP is permitted');const original=match[1]==='123',status=original?'completed':'in_progress';
 if(match[2])return json({total_count:1,jobs:[{id:original?22:33,run_id:Number(match[1]),name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status}]});
 return json({id:Number(match[1]),run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status});};
 // Login's actual public-auth entrypoint refuses this intentionally incomplete
 // synthetic readiness record; source comparison has already consumed all3
 // ORIGINAL-run files. No auth callback fabricates actor/permission success.
 await assert.rejects(runXeroRecoveryOwnerReadback({templateJson:JSON.stringify(t),readbackJson:JSON.stringify(r),env,fetchImpl,jwks,signal:new AbortController().signal,now:()=>T}));
 assert.equal(calls.filter(([u])=>new URL(u).pathname.startsWith('/v8/')).length,3);assert.ok(calls.every(([u,m])=>m==='GET'&&new URL(u).hostname!=='fixed.vercel.app'));
 const before=calls.length;await assert.rejects(runXeroRecoveryOwnerReadback({templateJson:JSON.stringify(t),readbackJson:JSON.stringify(r),env:{...env,GITHUB_RUN_ID:'123'},fetchImpl,jwks,signal:new AbortController().signal,now:()=>T}),{code:'XERO_COURIER_RUN_MISMATCH'});assert.equal(calls.length,before);
});

test('lost or pending native dispatch response consumes one intent, durably records uncertainty and never submits again',async()=>{
 for(const failure of ['throw','pending']){const f=nativeFixture();try{const r=readbackFixture(f),commands=[],repository={id:1278654816,full_name:REPOSITORY};
 const capture=(command,args,_options)=>{commands.push([command,args]);if(command==='/usr/bin/python3')return{status:0,stdout:JSON.stringify(r.lease)};assert.equal(command,'fixture-gh');const route=args[1];
 if(args.includes('POST')){if(failure==='throw')throw Error('PRIVATE_TOKEN_MUST_NOT_ESCAPE');return{status:0,stdout:'HTTP/2.0 204 No Content\r\n',sessionId:'pending'};}
 let value;if(route==='user')value={id:265701760,login:'hocheunglai-oss'};else if(route===`repos/${REPOSITORY}`)value=repository;else if(route.endsWith('/actions/runs/123'))value={id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'completed'};else if(route.endsWith('/attempts/1/jobs?per_page=100'))value={total_count:1,jobs:[{id:22,run_id:123,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'completed'}]};else if(route.endsWith('/git/ref/heads/fcos-reviewed-carrier'))value={ref:f.t.caller.ref,object:{type:'commit',sha:SHA}};else assert.fail('Unexpected command');return{status:0,stdout:JSON.stringify(value)};};
 const relay=await createNativeXeroRecoveryRelay({...f.options,capture,nativeRuntime:{credentialAvailable:true,command:'fixture-gh',env:{PATH:'/fixture',HOME:f.controlRoot,GH_CONFIG_DIR:f.controlRoot}}});await assert.rejects(relay.dispatchOwnerReadback(r.raw,r.path),{code:'XERO_COURIER_READBACK_DISPATCH_UNKNOWN'});
 assert.equal(commands.filter(([,a])=>a.includes('POST')).length,1);const count=commands.length;await assert.rejects(relay.dispatchOwnerReadback(r.raw,r.path));assert.equal(commands.length,count);
 const uncertain=JSON.parse(readFileSync(join(f.stateDirectory,`${binding.operationId}.owner-readback.uncertain.json`)));assert.equal(uncertain.state,'uncertain');const error=readFileSync(join(f.stateDirectory,`${binding.operationId}.owner-readback.tool-error.json`),'utf8');assert.doesNotMatch(error,/PRIVATE_TOKEN/);assert.match(error,/tool_exception|missing_or_pending_result/);
 assert.equal(JSON.parse(readFileSync(join(f.stateDirectory,`${binding.operationId}.stopped.json`))).readbackOnly,true);
 }finally{f.clean();}}
});

test('carrier denies extra/missing source, wrong compiled route/team or source UID before any content read or owner action',async()=>{
 const t=packageTemplate(),files=await buildCourierExpectedFiles({t,runId:'123'}),valid=providerInventory(files).tree;
 for(const change of [rows=>rows.splice(0,1),rows=>rows.push({name:'extra',type:'lambda',mode:49590,uid:'foreign'}),rows=>rows[1].children[0].name='other-route',rows=>rows[1].children[0].uid='team_foreign-'+'f'.repeat(34),rows=>rows[0].children[0].children[0].children[0].uid='0'.repeat(40),rows=>rows[0].children[0].children[0].children.pop()]){
  const tree=structuredClone(valid);change(tree);const f=readerFixture(tree);t.readCredential=f.t.readCredential;t.readAcceptance=f.t.readAcceptance;
  await assert.rejects(verifyCourierDeploymentBytes({...f,t,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:files,signal:new AbortController().signal,now:()=>T}),{code:'XERO_COURIER_SOURCE_BYTES_UNPROVEN'});
  assert.equal(f.calls.length,3);assert.ok(f.calls.every(url=>!url.includes('/v8/')));
 }
});


test('deployment source admission accepts exact ownerId-only team and refuses every conflicting present owner/team ID',async()=>{
 const t=packageTemplate(),files=await buildCourierExpectedFiles({t,runId:'123'}),{tree,byUid}=providerInventory(files),team=fcosConnectionIdentifier('vercel','Team ID');
 for(const [patch,accepted]of [[{teamId:undefined,ownerId:team},true],[{teamId:team,ownerId:team},true],[{teamId:'foreign',ownerId:team},false],[{teamId:team,ownerId:'foreign'},false],[{teamId:null,ownerId:team},false],[{teamId:undefined,ownerId:'foreign'},false],[{teamId:undefined,ownerId:undefined},false]]){
  const f=readerFixture(tree,patch);t.readCredential=f.t.readCredential;t.readAcceptance=f.t.readAcceptance;const original=f.fetchImpl;let contents=0;
  const action=verifyCourierDeploymentBytes({...f,t,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:files,signal:new AbortController().signal,now:()=>T,fetchImpl:async(u,o)=>{if(new URL(u).pathname.startsWith('/v8/')){contents++;return new Response(byUid.get(new URL(u).pathname.split('/').at(-1)));}return original(u,o);}});
  if(accepted){assert.equal((await action).deploymentId,'dpl_fixture');assert.equal(contents,3);}else{await assert.rejects(action,{code:'XERO_COURIER_DEPLOYMENT_MISMATCH'});assert.equal(f.calls.length,2);assert.equal(contents,0);}
 }
});

// These are synthetic provenance/command records for the actual native entrypoint;
// no test grants authority, executes the operational Python source or reads Macs.
function warmFixture(version=1){
 const f=nativeFixture(version),templateJson=f.options.templateJson,variable={name:ORIGINAL_WARM_TEMPLATE_VARIABLE,value:Buffer.from(templateJson).toString('base64'),created_at:new Date(T-1000).toISOString(),updated_at:new Date(T-1000).toISOString()},metadata=originalWarmVariable(variable,templateJson,T);
 const evidence={publicTemplateInstallation:f.save('synthetic-public-variable-installation.json',{kind:'fcos_root_actual_original_carrier_public_template_installation_v1',accepted:true,reviewerId:'/root',templateSha256:f.parsed.templateSha256,variable:metadata,actualNativeReceiptProvenanceReviewed:true}),originalAuthority:f.admission.evidence.originalAuthority,artifactCaptureAuthority:f.admission.evidence.artifactCaptureAuthority,coordinationQuota:f.admission.evidence.coordinationQuota};
 const scope={currentExecutorThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',historicalOwnerThreadId:binding.ownerThreadId,epoch:'production-reconciliation-20261005',templateSha256:f.parsed.templateSha256,planSha256:f.parsed.planSha256,caller:f.t.caller,controllerSha:CONTROLLER,actorId:binding.actorId,originalApprovalSha256:binding.approvalSha256,sourcePins:nativeCourierSourcePins(),variable:metadata,workflowId:77,capability:{maximumGithubDispatchPosts:1,maximumRequestPublications:0,maximumHostPosts:0,maximumOwnerLogins:0,financialAuthorityGranted:false},evidence,dispatchId:id(40),issuedAt:T,notAfter:T+(version===2?1799000:600000)},scopeSha256=hash(canonical(scope)),reviews={};
 for(const[key,role,reviewerId]of[['rootReview','root','/root'],['independentReview','independent','/root/other_reviewer']])reviews[key]=f.save('synthetic-warm-'+key+'.json',{kind:'fcos_actual_original_xero_warm_dispatch_review_v1',accepted:true,role,reviewerId,scopeSha256,reviewedAt:new Date(T).toISOString(),actualPublicTemplateInstallationReviewed:true,actualProtectedCallerSourceReviewed:true,originalAuthorityAndCaptureProvenanceReviewed:true,actualSharedCoordinationQuotaReviewed:true,financialAuthorityGranted:false});
 const admission={schemaVersion:1,kind:'fcos_root_admitted_original_xero_warm_dispatch_v1',accepted:true,reviewerId:'/root',scope,scopeSha256,...reviews};f.save('root-original-warm-admission.json',admission);
 const runtime={command:'synthetic-gh',credentialAvailable:true,env:{PATH:'/usr/bin:/bin',HOME:f.controlRoot,GH_CONFIG_DIR:f.controlRoot}},calls=[];let held;
 const capture=(command,args,options)=>{calls.push({command,args,input:options.input});
  if(command==='/usr/bin/python3'){const v=JSON.parse(options.input);assert.equal(v.expected.objective,'production');assert.equal(v.expected.ownerThreadId,scope.currentExecutorThreadId);assert.match(v.expected.operationId,/^xero-warm-dispatch-/);assert.match(args[2],/claim\('production'/);assert.doesNotMatch(args[2],/claim\('reconciliation'/);if(v.mode==='claim')held={...v.expected,leaseId:id(41),coordinationOnly:true,providerAuthorityGranted:false,uncertainOutcomeRequiresReadback:true};else assert.deepEqual(v.lease,held);return{status:0,stdout:JSON.stringify(held)};}
  assert.equal(command,'synthetic-gh');assert.equal(args[0],'api');const route=args[1];
  if(args.includes('POST')){assert.equal(route,`repos/${REPOSITORY}/actions/workflows/authenticated-release.yml/dispatches`);assert.deepEqual(JSON.parse(options.input),{ref:'fcos-reviewed-carrier',inputs:{xero_recovery_mode:'original-warm',xero_original_warm_dispatch_id:scope.dispatchId}});return{status:0,stdout:'HTTP/2.0 204 No Content\r\n\r\n'};}
  assert(args.includes('GET'));let value;
  if(route==='user')value={id:265701760,login:'hocheunglai-oss'};
  else if(route===`repos/${REPOSITORY}`)value={id:1278654816,full_name:REPOSITORY,permissions:{push:true}};
  else if(route.includes('/branches/'))value={name:'fcos-reviewed-carrier',protected:true,commit:{sha:SHA}};
  else if(route.endsWith('/actions/workflows/authenticated-release.yml'))value={id:77,path:'.github/workflows/authenticated-release.yml',state:'active'};
  else if(route.includes('/contents/')){const bytes=Buffer.from(readFileSync(new URL('../.github/qualification/hosted-release-bootstrap.yml',import.meta.url),'utf8').replaceAll('__FCOS_CONTROLLER_SHA__',CONTROLLER));value={encoding:'base64',content:bytes.toString('base64'),size:bytes.length,sha:crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};}
  else if(route.includes('/actions/variables/'))value=variable;
  else if(route.endsWith('/actions/runs/123')){const repository={id:1278654816,full_name:REPOSITORY};value={id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'in_progress',display_title:`FCOS original Xero carrier ${scope.dispatchId}`,created_at:new Date(T).toISOString()};}
  else if(route.includes('/attempts/1/jobs'))value={total_count:1,jobs:[{id:22,run_id:123,name:'xero-original-warm / xero-recovery-carrier',labels:['ubuntu-24.04'],status:'in_progress'}]};
  else assert.fail('unexpected fixture route '+route);return{status:0,stdout:JSON.stringify(value)};
 };
 return{...f,scope,variable,admission,calls,capture,options:{templateJson,controlRoot:f.controlRoot,capture,nativeRuntime:runtime,now:()=>T,wait:()=>assert.fail('No quota wait in this bounded fixture')}};
}
test('actual original native dispatch holds separate Production orchestration claim, ONE exact POST then observes actual run with no financial action or automatic resolution',async()=>{
 const f=warmFixture();try{const warm=await createNativeXeroRecoveryWarmDispatcher(f.options),result=await warm.dispatch();assert.equal(result.status,'original_warm_dispatched_run_pending');assert.equal(result.financialAuthorityGranted,false);assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,1);
 const observed=await warm.observeRun('123');assert.equal(observed.status,'actual_original_warm_run_observed');assert.equal(observed.jobId,22);assert.equal(observed.orchestrationLeaseResolved,false);assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,1);assert(f.calls.every(c=>['/usr/bin/python3','synthetic-gh'].includes(c.command)));
 const before=f.calls.length;await assert.rejects(warm.dispatch(),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});assert.equal(f.calls.length,before);assert(!readdirSync(f.stateDirectory).some(n=>n.includes('.claim-attempt')||n.includes('.held-lease')));
 }finally{f.clean();}
});
test('original warm admission requires actual hash-bound public installation/provenance and independent source review before commands',async()=>{
 for(const change of [f=>rmSync(join(f.stateDirectory,'root-original-warm-admission.json')),f=>{f.admission.scope.historicalOwnerThreadId=f.scope.currentExecutorThreadId;f.save('root-original-warm-admission.json',f.admission);},f=>{f.admission.scope.sourcePins['scripts/lib/hosted-release/xero-recovery-native-relay.mjs']=H;f.save('root-original-warm-admission.json',f.admission);},f=>{const r=JSON.parse(readFileSync(f.admission.independentReview.path));r.reviewerId='/root/xero_host_actor_auth';f.admission.independentReview=f.save('synthetic-bad-review.json',r);f.save('root-original-warm-admission.json',f.admission);},f=>{f.admission.scope.variable.valueSha256=H;f.save('root-original-warm-admission.json',f.admission); }]){const f=warmFixture();try{change(f);await assert.rejects(createNativeXeroRecoveryWarmDispatcher({...f.options,capture:()=>assert.fail('No command before admission')}));}finally{f.clean();}}
});
test('original warm exact variable/actor/protected branch/rendered caller checks stop before the dispatch write',async()=>{
 for(const route of ['user','/branches/','/contents/','/actions/variables/']){const f=warmFixture();try{const capture=(command,args,o)=>{const r=f.capture(command,args,o);if(command==='synthetic-gh'&&args.includes('GET')&&(route==='user'?args[1]===route:args[1].includes(route))){const v=JSON.parse(r.stdout);if(route==='user')v.id=1;if(route==='/branches/')v.protected=false;if(route==='/contents/')v.content=Buffer.from('foreign source').toString('base64');if(route==='/actions/variables/')v.value=Buffer.from('foreign template').toString('base64');return{status:0,stdout:JSON.stringify(v)};}return r;};const warm=await createNativeXeroRecoveryWarmDispatcher({...f.options,capture});await assert.rejects(warm.dispatch());assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,0);await assert.rejects(warm.dispatch(),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});}finally{f.clean();}}
});
test('original warm pending/lost/nonzero dispatch remains consumed unknown, never observes or retries automatically and never leaks raw error',async()=>{
 for(const failed of [()=>{throw Error('PRIVATE_TOKEN_IN_TOOL');},()=>({status:null,session_id:7}),()=>({status:1,stdout:'PRIVATE_PROVIDER_ERROR'})]){const f=warmFixture();try{const capture=(command,args,o)=>command==='synthetic-gh'&&args.includes('POST')?failed():f.capture(command,args,o),warm=await createNativeXeroRecoveryWarmDispatcher({...f.options,capture});await assert.rejects(warm.dispatch(),{code:'XERO_COURIER_REMOTE_OUTCOME_UNKNOWN'});const count=f.calls.length;await assert.rejects(warm.dispatch(),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});await assert.rejects(warm.observeRun('123'));assert.equal(f.calls.length,count);const records=readdirSync(f.stateDirectory).filter(n=>n.includes('.original-warm.')).map(n=>readFileSync(join(f.stateDirectory,n),'utf8')).join('');assert.match(records,/uncertain/);assert.doesNotMatch(records,/PRIVATE_TOKEN|PRIVATE_PROVIDER/);assert.match(records,/tool-error|tool_error|pending_result|tool_nonzero/);}finally{f.clean();}}
});
test('original warm Python refusal stops before credentials and existing matching lease cannot be adopted',async()=>{
 const f=warmFixture();try{const calls=[],warm=await createNativeXeroRecoveryWarmDispatcher({...f.options,capture:command=>{calls.push(command);return{status:1,stdout:''};}});await assert.rejects(warm.dispatch());assert.deepEqual(calls,['/usr/bin/python3']);await assert.rejects(warm.dispatch(),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});assert.deepEqual(calls,['/usr/bin/python3']);}finally{f.clean();}
});


test('actual original carrier main remains public-only before admitted locator/request and cancels without reading owner secrets',async()=>{
 const t=template(),c=new AbortController(),calls=[],repository={id:1278654816,full_name:REPOSITORY};
 const env={GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789',GITHUB_REPOSITORY:REPOSITORY,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',FCOS_XERO_CARRIER_MODE:'submit',FCOS_XERO_CARRIER_TEMPLATE_BASE64:Buffer.from(JSON.stringify(t)).toString('base64')};
 for(const name of ['FCOS_HOSTED_RUNTIME_EMAIL','FCOS_HOSTED_RUNTIME_PASSWORD','FCOS_HOSTED_VERCEL_READ_TOKEN','FCOS_XERO_RECOVERY_REQUEST_NONCE'])Object.defineProperty(env,name,{get(){assert.fail('No owner/provider credential access during warm wait');}});
 const fetchImpl=async(url,options)=>{calls.push(String(url));assert.equal(options.method,'GET');assert.equal(new URL(url).hostname,'api.github.com');const p=new URL(url).pathname;
 if(p===`/repos/${REPOSITORY}`)return json(repository);
 if(p.endsWith('/actions/runs/123'))return json({id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'in_progress',display_title:'FCOS original Xero carrier '+id(40)});
 if(p.endsWith('/attempts/1/jobs'))return json({total_count:1,jobs:[{id:22,run_id:123,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'in_progress'}]});
 assert(p.includes('/git/ref/heads/codex/fcos-xero-'));return new Response('',{status:404});};
 await assert.rejects(carrierMain(env,{fetchImpl,now:()=>T,signal:c.signal,wait:async()=>{c.abort();}}),{code:'XERO_COURIER_AUTHORITY_EXPIRED'});
 assert.equal(calls.length,4);assert(calls.every(url=>url.startsWith('https://api.github.com/')));
});
test('a foreign original warm run correlation or corrupt native ACK never becomes accepted observed run',async()=>{
 const f=warmFixture();try{const warm=await createNativeXeroRecoveryWarmDispatcher(f.options);await warm.dispatch();const capture=(command,args,o)=>{const r=f.capture(command,args,o);if(command==='synthetic-gh'&&args[1].endsWith('/actions/runs/123')){const v=JSON.parse(r.stdout);v.display_title='FCOS original Xero carrier '+id(99);return{status:0,stdout:JSON.stringify(v)};}return r;};const reader=await createNativeXeroRecoveryWarmDispatcher({...f.options,capture});await assert.rejects(reader.observeRun('123'),{code:'XERO_COURIER_RUN_MISMATCH'});
 const ackPath=join(f.stateDirectory,`${binding.operationId}.original-warm.ack.json`),ack=JSON.parse(readFileSync(ackPath));ack.providerAckSha256=H;writeFileSync(ackPath,JSON.stringify(ack));const before=f.calls.length;await assert.rejects(reader.observeRun('123'),{code:'XERO_COURIER_ORIGINAL_CLAIM_REQUIRED'});assert.equal(f.calls.length,before);
 }finally{f.clean();}
});


test('actual reusable carrier error boundary preserves only trusted safe phase codes and never raw error data',async()=>{
 const yaml=createRequire(import.meta.url)('js-yaml'),workflow=yaml.load(readFileSync(new URL('../.github/workflows/hosted-xero-recovery-carrier.yml',import.meta.url),'utf8'));
 const script=workflow.jobs['xero-recovery-carrier'].steps.at(-1).with.script,AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const error of [Object.assign(Error('PRIVATE_PROVIDER_DETAIL'),{code:'XERO_COURIER_SOURCE_BYTES_UNPROVEN'}),Object.assign(Error('PRIVATE_TOKEN'),{code:'XERO_COURIER_RESPONSE_REFUSED'}),Error('PRIVATE_TOKEN'),{get code(){throw Error('PRIVATE_GETTER');}}]){
  const loaded=[],execute=new AsyncFunction('importModule','process',script.replaceAll('await import(', 'await importModule('));
  await assert.rejects(execute(async path=>{loaded.push(path);return path.endsWith('/xero-recovery-native-relay.mjs')?{safeCode}:{carrierMain:async()=>{throw error;}};},{env:{GITHUB_WORKSPACE:'/trusted/controller'}}),e=>{assert.equal(e.message,safeCode(error));assert.doesNotMatch(e.stack,/PRIVATE_/);return true;});
  assert.deepEqual(loaded,['/trusted/controller/scripts/hosted-xero-recovery-carrier.mjs','/trusted/controller/scripts/lib/hosted-release/xero-recovery-native-relay.mjs']);
 }
 let reads=0;const changing={get code(){reads++;return reads===1?'XERO_COURIER_RESPONSE_REFUSED':'PRIVATE_SECOND_READ_SECRET';}},execute=new AsyncFunction('importModule','process',script.replaceAll('await import(', 'await importModule('));
 await assert.rejects(execute(async path=>path.endsWith('/xero-recovery-native-relay.mjs')?{safeCode}:{carrierMain:async()=>{throw changing;}},{env:{GITHUB_WORKSPACE:'/trusted/controller'}}),e=>{assert.equal(e.message,'XERO_COURIER_RESPONSE_REFUSED');assert.doesNotMatch(e.stack,/PRIVATE_/);return true;});assert.equal(reads,1);
});
// The physical git repository and real JS guards run. Python/GitHub completion
// records are explicitly synthetic command fixtures, not actual owner/authority.
function nativePublicationFixture({pushFailure,statusFailure,missingArtifact=false,version=1}={}){
 const f=nativeFixture(version),raw=request(f.t),calls=[],runtime={credentialAvailable:true,command:'fixture-gh',env:{PATH:'/usr/bin:/bin',HOME:f.controlRoot,GH_CONFIG_DIR:f.controlRoot}};
 const init=spawnSync('/usr/bin/git',['init','--initial-branch=codex/fixture'],{cwd:f.controlRoot,encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:f.controlRoot,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});assert.equal(init.status,0);
 let held,commitSha,archive,claims=0;
 const repository={id:1278654816,full_name:REPOSITORY},run={id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'in_progress'};
 const artifact=()=>{const result={kind:'fcos_xero_recovery_step_result_v1',operationId:binding.operationId,planSha256:f.parsed.planSha256,requestSha256:hash(raw),step:'preflight',submissionId:id(7),state:'ready',nextStep:'custodyPrepare',result:{renewalRequired:false,tokenVersion:449,expiresAt:new Date(T+3600000).toISOString(),observedAt:new Date(T).toISOString()},executionAuthorityGranted:false,qualificationAccepted:false};result.resultSha256=hash(canonical(result.result));const resultJson=JSON.stringify(result);
  const ack={schemaVersion:1,kind:'fcos_xero_recovery_actual_http_ack_v1',templateSha256:f.parsed.templateSha256,runId:'123',jobId:22,requestRef:courierRequestRef(f.t,'123',raw),commitSha,requestSha256:hash(raw),hostOrigin:f.b.hostOrigin,deploymentId:f.b.deploymentId,httpStatus:200,resultJson,resultSha256:hash(resultJson),receivedAt:T};archive=materialZip(ack);
  return{id:91,name:'fcos-xero-ack-123-'+id(7),expired:false,workflow_run:{id:123,head_sha:SHA,repository_id:1278654816,head_repository_id:1278654816},digest:'sha256:'+hash(archive),size_in_bytes:archive.length,created_at:new Date(T).toISOString()};};
 const capture=(command,args,options)=>{calls.push({command,args,input:options.input});
  if(command==='/usr/bin/python3'){const v=JSON.parse(options.input);if(v.mode==='claim'){claims++;held={...v.expected,leaseId:id(55),coordinationOnly:true,providerAuthorityGranted:false,uncertainOutcomeRequiresReadback:true};}else assert.deepEqual(v.lease,held);return{status:0,stdout:JSON.stringify(held)};}
  if(command==='/usr/bin/git'){if(args.includes('push')){commitSha=args.at(-1).split(':')[0];return pushFailure?pushFailure():{status:0,stdout:''};}return spawnSync(command,args,options);}
  assert.equal(command,'fixture-gh');const route=args[1];let value;
  if(args.includes('POST')){assert.equal(route,`repos/${REPOSITORY}/statuses/${commitSha}`);const expected=courierPublicationStatus({templateJson:f.options.templateJson,runId:'123',ref:courierRequestRef(f.t,'123',raw),commitSha,raw,kind:'request'});assert.deepEqual(JSON.parse(options.input),expected.body);if(statusFailure)return statusFailure(expected);return{status:0,stdout:'HTTP/2.0 201 Created\r\ncontent-type: application/json\r\n\r\n'+JSON.stringify(publicationValue(expected))};}
  assert(args.includes('GET'));if(route==='user')value={id:265701760,login:'hocheunglai-oss'};
  else if(route===`repos/${REPOSITORY}`)value=repository;else if(route.endsWith('/actions/runs/123'))value=run;else if(route.endsWith('/attempts/1/jobs?per_page=100'))value={total_count:1,jobs:[{id:22,run_id:123,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'in_progress',started_at:new Date(T-1000).toISOString()}]};
  else if(route.endsWith('/artifacts?per_page=100'))value={total_count:missingArtifact?0:1,artifacts:missingArtifact?[]:[artifact()]};else if(route.endsWith('/actions/artifacts/91/zip'))return{status:0,stdout:archive};else assert.fail('Unexpected fixture route '+route);return{status:0,stdout:JSON.stringify(value)};
 };
 return{...f,calls,raw,claims:()=>claims,options:{...f.options,cwd:f.controlRoot,capture,nativeRuntime:runtime,wait:async()=>{throw Error('SYNTHETIC_ACK_TIMEOUT');}}};
}
test('real native entrypoint uses two distinct guarded GitHub writes under one claimed lease; only actual HTTP artifact completes outer step',async()=>{
 const f=nativePublicationFixture();try{const relay=await createNativeXeroRecoveryRelay(f.options),result=await relay.submit(f.raw);assert.equal(result.status,'submitted_acknowledged');assert.equal(result.result.nextStep,'custodyPrepare');assert.equal(f.claims(),1);assert.equal(f.calls.filter(c=>c.command==='/usr/bin/git'&&c.args.includes('push')).length,1);assert.equal(f.calls.filter(c=>c.command==='fixture-gh'&&c.args.includes('POST')).length,1);
 for(const phase of ['publication-ref','publication-status'])for(const state of ['prepared','submitting','submitted'])assert.equal(JSON.parse(readFileSync(join(f.stateDirectory,`${binding.operationId}.preflight.${phase}.${state}.json`))).state,state);
 assert.equal(JSON.parse(readFileSync(join(f.stateDirectory,`${binding.operationId}.preflight.publication-status.provider-ack.json`))).httpStatus,201);assert(readFileSync(join(f.stateDirectory,`${binding.operationId}.preflight.ack.json`)));const before=f.calls.length;await assert.rejects(relay.submit(f.raw),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});assert.equal(f.calls.length,before);
 }finally{f.clean();}
});
test('unknown push never issues status; unknown/forged status never reads HTTP artifact, retries, advances or fabricates financial ACK',async()=>{
 const failures=[()=>{throw Error('PRIVATE_TOOL_ERROR');},()=>({status:0,session_id:7,stdout:'pending'}),()=>({status:1,stdout:'PRIVATE_ERROR'}),expected=>({status:0,stdout:'HTTP/2.0 201 Created\r\n\r\n'+JSON.stringify(publicationValue(expected,{creator:{id:1,login:'hocheunglai-oss'}}))})];
 for(const failure of failures){for(const phase of ['push','status']){if(phase==='push'&&failure===failures.at(-1))continue;const f=nativePublicationFixture(phase==='push'?{pushFailure:failure}:{statusFailure:failure});try{const relay=await createNativeXeroRecoveryRelay(f.options);await assert.rejects(relay.submit(f.raw));assert.equal(f.calls.filter(c=>c.command==='fixture-gh'&&c.args.includes('POST')).length,phase==='push'?0:1);assert(!f.calls.some(c=>c.args?.[1]?.includes('/artifacts')));const names=readdirSync(f.stateDirectory);assert(names.some(n=>n.endsWith('.preflight.uncertain.json')));assert(!names.some(n=>n.endsWith('.preflight.submitted.json')||n.endsWith('.preflight.ack.json')));const before=f.calls.length;await assert.rejects(relay.submit(f.raw));assert.equal(f.calls.length,before);assert.doesNotMatch(names.map(n=>readFileSync(join(f.stateDirectory,n),'utf8')).join(''),/PRIVATE_TOOL_ERROR|PRIVATE_ERROR/);
 }finally{f.clean();}}}
});
test('publication201 without actual HTTP acknowledgement preserves outer unknown and the original lease',async()=>{
 const f=nativePublicationFixture({missingArtifact:true});try{const relay=await createNativeXeroRecoveryRelay(f.options);await assert.rejects(relay.submit(f.raw));const names=readdirSync(f.stateDirectory);assert(names.some(n=>n.endsWith('.publication-status.submitted.json')));assert(names.some(n=>n.endsWith('.preflight.uncertain.json')));assert(!names.some(n=>n.endsWith('.preflight.submitted.json')||n.endsWith('.preflight.ack.json')));assert(names.some(n=>n.endsWith('.held-lease.json')));assert(f.calls.every(c=>!c.args.includes('resolve')&&!c.args.includes('delete')));
 }finally{f.clean();}
});

test('whole warm carrier waits without status and refuses forged or late status before any provider credential/login/host access',async()=>{
 for(const mode of ['missing','forged','late']){const t=packageTemplate(),c=new AbortController();let at=T;const locator=JSON.stringify({schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'}),bytes=Buffer.from(locator),blob=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),commit='3'.repeat(40),tree='4'.repeat(40),ref=courierPrefix(t,'123')+'/locator',calls=[];
 const expected=courierPublicationStatus({templateJson:JSON.stringify(t),runId:'123',ref,commitSha:commit,raw:locator,kind:'locator'}),repository={id:1278654816,full_name:REPOSITORY};
 const env={GITHUB_TOKEN:'FIXTURE_GITHUB_TOKEN_123456789',GITHUB_REPOSITORY:REPOSITORY,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};for(const name of ['FCOS_HOSTED_RUNTIME_EMAIL','FCOS_HOSTED_RUNTIME_PASSWORD','FCOS_HOSTED_VERCEL_READ_TOKEN','FCOS_XERO_RECOVERY_REQUEST_NONCE'])Object.defineProperty(env,name,{get(){assert.fail('Publisher proof precedes credential access');}});
 const fetchImpl=async(u,o)=>{const url=new URL(u);calls.push(url.href);assert.equal(url.hostname,'api.github.com');assert.equal(o.method,'GET');const p=url.pathname;if(p===`/repos/${REPOSITORY}`)return json(repository);if(p.endsWith('/actions/runs/123'))return json({id:123,run_attempt:1,repository,head_repository:repository,actor:{id:265701760,login:'hocheunglai-oss'},event:'workflow_dispatch',head_sha:SHA,head_branch:'fcos-reviewed-carrier',path:'.github/workflows/authenticated-release.yml',status:'in_progress',display_title:'FCOS original Xero carrier '+id(40)});if(p.endsWith('/attempts/1/jobs'))return json({total_count:1,jobs:[{id:22,run_id:123,name:'xero-recovery-carrier',labels:['ubuntu-24.04'],status:'in_progress'}]});
 if(p.endsWith('/git/ref/'+ref.slice(5)))return json({ref,object:{type:'commit',sha:commit}});if(p.endsWith('/git/commits/'+commit))return json({sha:commit,parents:[],tree:{sha:tree}});if(p.endsWith('/git/trees/'+tree))return json({sha:tree,truncated:false,tree:[{path:'locator.json',mode:'100644',type:'blob',sha:blob}]});if(p.endsWith('/git/blobs/'+blob))return json({sha:blob,encoding:'base64',content:bytes.toString('base64'),size:bytes.length});assert.equal(p,`/repos/${REPOSITORY}/commits/${commit}/statuses`);if(mode==='late')at=t.notAfter;return json(mode==='missing'?[]:[publicationValue(expected,mode==='forged'?{creator:{id:1,login:'hocheunglai-oss'}}:{})]);};
 await assert.rejects(runWarmXeroRecoveryCarrier({templateJson:JSON.stringify(t),env,fetchImpl,signal:c.signal,now:()=>at,wait:async()=>{assert.equal(mode,'missing');c.abort();}}),{code:mode==='forged'?'XERO_COURIER_PUBLICATION_INVALID':'XERO_COURIER_AUTHORITY_EXPIRED'});assert(calls.every(u=>!u.includes('/events')&&new URL(u).hostname==='api.github.com'));
 }
});
test('native action admission requires exact root AND peer review of added publisher status scope and consumers before commands',async()=>{
 for(const name of ['rootReview','independentReview']){const f=nativeFixture();try{const review=JSON.parse(readFileSync(f.admission.evidence[name].path));delete review.actualPublisherStatusScopeAndConsumersReviewed;f.admission.evidence[name]=f.save('missing-status-scope-'+name+'.json',review);f.b.rootAdmissionSha256=f.save('root-native-admission.json',f.admission).sha256;await assert.rejects(createNativeXeroRecoveryRelay({...f.options,capture:()=>assert.fail('No command before actual scope review')}),{code:'XERO_COURIER_ROOT_ADMISSION_REQUIRED'});}finally{f.clean();}}
});


test('v2 requires matching plan/template versions and leaves every v1 ceiling and raw hash unchanged',()=>{
 const legacy=template(),raw=JSON.stringify(legacy),digest=hash(raw),v2=template(2);
 assert.equal(parseCourierTemplate(JSON.stringify(v2)).maximumWindowMs,1800000);
 assert.equal(parseCourierTemplate(raw).maximumWindowMs,900000);
 for(const change of [t=>t.schemaVersion=1,t=>t.kind='fcos_xero_recovery_carrier_template_v1',t=>{const p=JSON.parse(t.planJson);p.schemaVersion=1;p.kind='fcos_xero_recovery_step_plan_v1';t.planJson=canonical(p);},t=>{t.notAfter++;const p=JSON.parse(t.planJson);p.binding.notAfter++;t.planJson=canonical(p);},t=>t.issuedAt--]){
  const t=structuredClone(v2);change(t);assert.throws(()=>parseCourierTemplate(JSON.stringify(t)));
 }
 assert.equal(hash(JSON.stringify(legacy)),digest);assert.equal(JSON.stringify(legacy),raw);
 const extended=structuredClone(legacy);extended.notAfter=T+1799000;assert.throws(()=>parseCourierTemplate(JSON.stringify(extended)));
});

test('actual v2 native warm factory dispatches after minute15 only inside its original30minute envelope, with one consumed intent',async()=>{
 const f=warmFixture(2);try{
  const warm=await createNativeXeroRecoveryWarmDispatcher({...f.options,now:()=>T+900001});
  assert.equal((await warm.dispatch()).status,'original_warm_dispatched_run_pending');
  assert.equal(f.calls.filter(c=>c.args.includes('POST')).length,1);
  await assert.rejects(warm.dispatch(),{code:'XERO_COURIER_CONSUMED_GET_ONLY'});
 }finally{f.clean();}
 const expired=warmFixture(2);try{
  const warm=await createNativeXeroRecoveryWarmDispatcher({...expired.options,now:()=>expired.t.notAfter,capture:()=>assert.fail('No claim/credential/write at original expiry')});
  await assert.rejects(warm.dispatch(),{code:'XERO_COURIER_AUTHORITY_EXPIRED'});
 }finally{expired.clean();}
 const workflow=readFileSync(new URL('../.github/workflows/hosted-xero-recovery-carrier.yml',import.meta.url),'utf8');
 assert.match(workflow,/timeout-minutes: 30/);assert.match(workflow,/v1 still expires/);
});


test('actual v2 carrier builds the new compiled host with its exact unmodified v2 plan',async()=>{
 const t=packageTemplate(2),original=t.planJson,files=await buildCourierExpectedFiles({t,runId:'123'});
 assert.equal(files.length,3);assert.equal(t.planJson,original);assert.equal(t.hostConfiguration.planJson,original);
 assert.equal(JSON.parse(original).schemaVersion,2);assert(files.some(f=>f.path.endsWith('/index.mjs')&&f.bytes>1000));
});


test('late v2 first financial preflight refuses before any claim, intent, credential or provider access',async()=>{
 for(const remaining of [899999,1]){const f=nativeFixture(2);try{
  let commands=0,credentials=0;const runtime={};Object.defineProperty(runtime,'credentialAvailable',{get(){credentials++;assert.fail('No credential access before runway admission');}});
  const before=Object.fromEntries(readdirSync(f.stateDirectory).map(n=>[n,hash(readFileSync(join(f.stateDirectory,n)))]));
  const relay=await createNativeXeroRecoveryRelay({...f.options,now:()=>f.t.notAfter-remaining,nativeRuntime:runtime,capture:()=>{commands++;assert.fail('No claim or provider command before runway admission');}});
  await assert.rejects(relay.submit(request(f.t)),{code:'XERO_COURIER_AUTHORITY_EXPIRED'});
  assert.equal(commands,0);assert.equal(credentials,0);
  assert.deepEqual(Object.fromEntries(readdirSync(f.stateDirectory).map(n=>[n,hash(readFileSync(join(f.stateDirectory,n)))])),before);
 }finally{f.clean();}}
});

test('v2 runway is inclusive at900000ms and v1 retains its prior admission behavior',async()=>{
 for(const [version,remaining]of [[2,900000],[1,1]]){const f=nativeFixture(version);try{
  const commands=[],relay=await createNativeXeroRecoveryRelay({...f.options,now:()=>f.t.notAfter-remaining,capture:command=>{commands.push(command);assert.equal(command,'/usr/bin/python3');return{status:1,stdout:''};}});
  // This synthetic completed Python refusal deliberately stops after admission;
  // it is not an actual operational lease or provider proof.
  await assert.rejects(relay.submit(request(f.t)),{code:'XERO_COURIER_STOPPED_OWNER_READBACK_REQUIRED'});
  assert.deepEqual(commands,['/usr/bin/python3']);assert(readdirSync(f.stateDirectory).some(n=>n.endsWith('.claim-attempt.json')));
 }finally{f.clean();}}
 const f=nativePublicationFixture({version:2});try{
  const relay=await createNativeXeroRecoveryRelay(f.options),result=await relay.submit(f.raw);
  assert.equal(result.status,'submitted_acknowledged');assert.equal(result.result.nextStep,'custodyPrepare');assert.equal(f.claims(),1);
 }finally{f.clean();}
});

test('first downloaded-source mismatch stops before further source reads or owner access',async()=>{
 const t=packageTemplate(),files=await buildCourierExpectedFiles({t,runId:'123'}),{tree}=providerInventory(files),f=readerFixture(tree);
 t.readCredential=f.t.readCredential;t.readAcceptance=f.t.readAcceptance;
 let downloaded=0;const original=f.fetchImpl;
 await assert.rejects(verifyCourierDeploymentBytes({...f,t,locator:{schemaVersion:1,kind:'fcos_xero_host_locator_v1',deploymentId:'dpl_fixture',url:'https://fixed.vercel.app'},expectedFiles:files,signal:new AbortController().signal,now:()=>T,fetchImpl:async(u,o)=>{
  if(new URL(u).pathname.startsWith('/v8/')){downloaded++;return new Response('SYNTHETIC_SUBSTITUTED_BYTES');}
  return original(u,o);
 }}),{code:'XERO_COURIER_SOURCE_BYTES_UNPROVEN'});
 assert.equal(downloaded,1);assert(f.calls.every(u=>new URL(u).hostname==='api.vercel.com'));
});

test('preparation bootstrap verifies real branch-purpose OIDC without an environment principal or owner secret', async () => {
  const yaml = createRequire(import.meta.url)('js-yaml');
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/hosted-xero-recovery-carrier.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['xero-recovery-preparation'], script = job.steps[0].with.script;
  assert.equal(job.environment, undefined);
  const original = claims(template()); delete original.environment;
  original.sub = `repo:${REPOSITORY}:ref:${original.ref}`;
  const audience = 'urn:fcos:xero-recovery-carrier-bootstrap:v1';
  for (const delta of [null, { environment: 'fcos-hosted-verification' }, { sub: `repo:${REPOSITORY}:environment:fcos-hosted-verification` },
    { run_id: '124' }, { job_workflow_sha: SHA }, { ref_protected: 'false' }]) {
    const token = await new SignJWT({ ...original, ...delta }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer('https://token.actions.githubusercontent.com').setAudience(audience).sign(key.privateKey);
    const outputs = [];
    const execute = () => runInNewContext(`(async()=>{${script}})()`, {
      require: () => crypto, Buffer, Date, AbortSignal,
      process: { env: { GITHUB_RUN_ID: '123', EXPECTED_CONTROLLER_SHA: CONTROLLER } },
      fetch: async () => json({ keys: [jwk] }),
      core: { getIDToken: async supplied => { assert.equal(supplied, audience); return token; }, setOutput: (name, value) => outputs.push([name, value]) },
    });
    if (delta === null) { await execute(); assert.deepEqual(outputs, [['controller_sha', CONTROLLER]]); }
    else { await assert.rejects(execute(), /XERO_COURIER_CONTROLLER_BOOTSTRAP_REFUSED/); assert.deepEqual(outputs, []); }
  }
});
