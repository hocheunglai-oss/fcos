import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareDiagnosticEnvironmentCreate,validateDiagnosticEnvironmentAcknowledgement,prepareLegacyDiagnosticRequest,submitLegacyDiagnosticOnce,unchangedLegacyDiagnosticConfiguration} from '../scripts/lib/hosted-release/legacy-runtime-diagnostic-operation.mjs';
import {fcosConnectionIdentifier} from '../config/fcosConnections.js';
const canon=v=>Array.isArray(v)?v.map(canon):v&&Object.getPrototypeOf(v)===Object.prototype?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(canon(v))).digest('hex');
const project=fcosConnectionIdentifier('vercel','Project ID'),team=fcosConnectionIdentifier('vercel','Team ID');
function fixture(){
 const base='.vercel/output/functions/api/legacy-runtime-observation.func/';
 const content={'.vercel/output/config.json':{version:3,routes:[{src:'^/api/legacy-runtime-observation$',dest:'/api/legacy-runtime-observation'}]},'.vercel/project.json':{orgId:team,projectId:project},'vercel.json':{version:2,crons:[]}};
 const files=Object.entries(content).map(([path,data])=>({path,bytes:Buffer.from(JSON.stringify(data))}));
 for(const name of ['handler.mjs','connections.mjs','collector.mjs','.vc-config.json','index.mjs'])files.push({path:base+name,bytes:Buffer.from('reviewed fixture source')});
 const rows=files.map(f=>({path:f.path,byteLength:f.bytes.length,sha256:hash(f.bytes)}));
 const binding={operationId:'a'.repeat(64),buildSha256:'b'.repeat(64),targets:{vercelProject:project,vercelTeam:team},allowQuotaMetadata:false,customEnvironment:{id:'env_fixture123',slug:'fcos-legacy-diag-'+ 'a'.repeat(12),copyFrom:'production'}};
 const manifest={schemaVersion:1,kind:'fcos_legacy_runtime_diagnostic_build_v1',diagnosticOnly:true,baselineAccepted:false,buildSha256:binding.buildSha256,binding,bindingSha256:hash(binding),files:rows,outputSha256:hash(rows)};
 const request=prepareLegacyDiagnosticRequest({manifest,files});
 const ack={id:'dpl_fixture123',projectId:project,ownerId:team,target:null,customEnvironment:binding.customEnvironment,url:'fcos-fixture123.vercel.app',meta:request.body.meta,alias:[],aliasAssigned:false};
 return {manifest,files,request,ack};
}
test('offline preparation emits one inline prebuilt custom-environment request without env overrides or new upload calls',()=>{
 const f=fixture(),body=f.request.body;
 assert.equal(body.autoAssignCustomDomains,false);assert.ok(!Object.hasOwn(body,'target'));assert.equal(body.customEnvironmentSlugOrId,'env_fixture123');assert.deepEqual(body.crons,[]);
 assert.equal(body.files.length,7);assert.ok(!body.files.some(x=>x.file==='.vercel/project.json'));
 for(const k of ['deploymentId','env','build','gitSource','projectSettings','alias','withLatestCommit'])assert.ok(!Object.hasOwn(body,k));
 assert.equal(new URL(f.request.url).searchParams.get('prebuilt'),'1');
});
test('changed bytes, paths, crons, config, opaque target or substituted file inventory fail before preparation',()=>{
 for(const change of [f=>f.files[0].bytes=Buffer.from('changed'),f=>f.files[0].path='../private.env',f=>f.manifest.binding.targets.vercelProject='other',f=>f.files.push({path:'api/cron.js',bytes:Buffer.from('x')}),f=>f.manifest.baselineAccepted=true]){
  const f=fixture();change(f);assert.throws(()=>prepareLegacyDiagnosticRequest(f));
 }
 const f=fixture();f.files.find(x=>x.path==='vercel.json').bytes=Buffer.from(JSON.stringify({version:2,crons:[{path:'/api/cron',schedule:'* * * * *'}]}));
 f.manifest.files=f.files.map(x=>({path:x.path,byteLength:x.bytes.length,sha256:hash(x.bytes)}));f.manifest.outputSha256=hash(f.manifest.files);
 assert.throws(()=>prepareLegacyDiagnosticRequest(f),{code:'DIAGNOSTIC_CONFIGURATION_CHANGED'});
});
test('one provider attempt has exact target, no redirects/retries and sanitized acknowledgement',async()=>{
 const f=fixture();let calls=0;
 const result=await submitLegacyDiagnosticOnce({request:f.request,expectedRequestSha256:f.request.sha256,token:'PRIVATE_FIXTURE',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,f.request.url);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer PRIVATE_FIXTURE');
  assert.deepEqual(JSON.parse(options.body),f.request.body);return Response.json(f.ack);
 }});
 assert.equal(calls,1);assert.equal(result.id,f.ack.id);assert.ok(!JSON.stringify(result).includes('PRIVATE_FIXTURE'));
});
test('missing approved digest and rehashed domain/settings/target changes produce zero requests',async()=>{
 for(const change of [r=>r.body.autoAssignCustomDomains=true,r=>r.body.env={PRIVATE:'wrong'},r=>r.body.project='other',r=>r.body.target='production',r=>r.body.crons=[{}],r=>r.body.deploymentId='dpl_old']){
  const {request}=fixture();change(request);request.sha256=hash({url:request.url,body:request.body});let count=0;
  await assert.rejects(submitLegacyDiagnosticOnce({request,expectedRequestSha256:request.sha256,token:'private',fetchImpl:()=>{count++;}}),{code:'DIAGNOSTIC_SUBMISSION_INVALID'});assert.equal(count,0);
 }
 const {request}=fixture();await assert.rejects(submitLegacyDiagnosticOnce({request,token:'private',fetchImpl:()=>assert.fail('no request')}),{code:'DIAGNOSTIC_SUBMISSION_INVALID'});
});
test('lost response, bad acknowledgement or HTTP error stay consumed GET-only with one attempt and no raw exception',async()=>{
 for(const response of [()=>{throw Error('PRIVATE_TOKEN');},()=>new Response('PRIVATE_TOKEN',{status:500}),()=>Response.json({id:'dpl_late',private:'PRIVATE_TOKEN'}),()=>Response.json({...fixture().ack,alias:['fcos.fcuno.com']})]){
  const {request}=fixture();let calls=0;let error;
  try{await submitLegacyDiagnosticOnce({request,expectedRequestSha256:request.sha256,token:'private',fetchImpl:async()=>{calls++;return response();}});}catch(e){error=e;}
  assert.equal(calls,1);assert.equal(error.code,'DIAGNOSTIC_SUBMISSION_UNCERTAIN');assert.equal(error.getOnly,true);assert.equal(error.noReplay,true);assert.ok(!error.message.includes('PRIVATE'));
 }
});
test('metadata equality retains inference and cannot accept value exports, changed records or newer updates',()=>{
 const rows=Array.from({length:58},(_,i)=>({id:'id'+i,key:'KEY_'+i,target:['production'],gitBranch:null,createdAt:1,updatedAt:2}));
 const result=unchangedLegacyDiagnosticConfiguration({before:rows,after:[...rows].reverse(),previousCreatedAt:3});assert.equal(result.originalValueEqualityProven,false);
 for(const change of [v=>v[0].id='different',v=>v[0].value='private',v=>v[0].updatedAt=4,v=>v.pop(),v=>v[0].target=['preview']]){
  const after=structuredClone(rows);change(after);assert.throws(()=>unchangedLegacyDiagnosticConfiguration({before:rows,after,previousCreatedAt:3}));
 }
});

test('environment creation uses provider-internal copy without secrets, branch matcher or domains',()=>{
 const request=prepareDiagnosticEnvironmentCreate({operationId:'a'.repeat(64)});assert.equal(request.body.copyEnvVarsFrom,'production');
 for(const k of ['env','branchMatcher','domains','target'])assert.ok(!Object.hasOwn(request.body,k));
 const value={id:'env_new123',slug:request.body.slug,description:request.body.description,type:'preview',domains:[],currentDeploymentAliases:[]};
 assert.equal(validateDiagnosticEnvironmentAcknowledgement(value,request).copyFrom,'production');
 for(const change of [v=>v.type='production',v=>v.domains=['fcos.fcuno.com'],v=>v.branchMatcher={type:'equals',pattern:'main'},v=>v.id='foreign']){const copy=structuredClone(value);change(copy);assert.throws(()=>validateDiagnosticEnvironmentAcknowledgement(copy,request));}
});

test('actual minimal create response acknowledges only the owned ID without claiming optional associations were read',()=>{
 const request=prepareDiagnosticEnvironmentCreate({operationId:'a'.repeat(64)});
 const actual={id:'env_new123',slug:request.body.slug,description:request.body.description,type:'preview',createdAt:1792308155035,updatedAt:1792308155035};
 assert.deepEqual(validateDiagnosticEnvironmentAcknowledgement(actual,request),{id:actual.id,slug:actual.slug,copyFrom:'production'});
 for(const change of [v=>v.description='foreign operation',v=>v.domains=null,v=>v.currentDeploymentAliases={},v=>v.currentDeploymentAliases=['fcos.fcuno.com'],v=>v.branchMatcher={type:'equals',pattern:'main'}]){
  const value=structuredClone(actual);change(value);assert.throws(()=>validateDiagnosticEnvironmentAcknowledgement(value,request));
 }
 const changed=structuredClone(request);changed.body.description='foreign';assert.throws(()=>validateDiagnosticEnvironmentAcknowledgement(actual,changed),{code:'DIAGNOSTIC_ENVIRONMENT_REQUEST_CHANGED'});
});

test('custom-environment submission is one-shot and unknown response retains GET-only state',async()=>{
 const {submitDiagnosticEnvironmentOnce}=await import('../scripts/lib/hosted-release/legacy-runtime-diagnostic-operation.mjs');
 const request=prepareDiagnosticEnvironmentCreate({operationId:'a'.repeat(64)});let calls=0;
 const result=await submitDiagnosticEnvironmentOnce({request,expectedRequestSha256:request.sha256,token:'private',fetchImpl:async()=>{calls++;return Response.json({id:'env_new123',slug:request.body.slug,description:request.body.description,type:'preview',domains:[],currentDeploymentAliases:[]});}});
 assert.equal(calls,1);assert.equal(result.copyFrom,'production');
 await assert.rejects(submitDiagnosticEnvironmentOnce({request,expectedRequestSha256:request.sha256,token:'private',fetchImpl:async()=>{calls++;throw Error('PRIVATE');}}),{code:'DIAGNOSTIC_ENVIRONMENT_SUBMISSION_UNCERTAIN',getOnly:true,noReplay:true});assert.equal(calls,2);
});
test('cleanup refuses original/shared IDs, targets or foreign deployment and never enables broad deletion',async()=>{
 const {prepareDiagnosticCleanup,assertDiagnosticProductionPreservation}=await import('../scripts/lib/hosted-release/legacy-runtime-diagnostic-operation.mjs');
 const f=fixture(),environment=f.manifest.binding.customEnvironment,operationId=f.request.operationId;
 const args={environment,operationId,beforeVariableIds:['original'],expectedRecordKeys:Array.from({length:58},(_,i)=>'KEY_'+i),ownedVariables:Array.from({length:58},(_,i)=>({id:'new'+i,key:'KEY_'+i,target:[],customEnvironmentIds:[environment.id]})),deployment:{id:'dpl_owned123',projectId:project,customEnvironment:environment,operationId,target:null}};
 const result=prepareDiagnosticCleanup(args);assert.equal(result.actions.length,60);assert.deepEqual(result.actions.at(-1).body,{deleteUnassignedEnvironmentVariables:false});
 for(const change of [v=>v.ownedVariables[0].id='original',v=>v.ownedVariables[0].target=['production'],v=>v.ownedVariables[0].customEnvironmentIds.push('env_other'),v=>v.deployment.target='production',v=>v.deployment.operationId='b'.repeat(64)]){const copy=structuredClone(args);change(copy);assert.throws(()=>prepareDiagnosticCleanup(copy));}
 const partial={...args,deployment:null,ownedVariables:args.ownedVariables.slice(0,3),noDeploymentSubmission:{kind:'root_reviewed_no_diagnostic_deployment_submission_v1',operationId,providerSubmissionStarted:false,durableIntentSha256:'c'.repeat(64),rootAcceptanceSha256:'d'.repeat(64)}};
 assert.equal(prepareDiagnosticCleanup(partial).actions.length,4);
 assert.throws(()=>prepareDiagnosticCleanup({...partial,noDeploymentSubmission:undefined}));
 assert.throws(()=>prepareDiagnosticCleanup({...partial,noDeploymentSubmission:{...partial.noDeploymentSubmission,providerSubmissionStarted:true}}));
 assert.throws(()=>prepareDiagnosticCleanup({...partial,ownedVariables:[{...partial.ownedVariables[0],key:'OUTSIDE_SCOPE'}]}));
 const before={deploymentId:'dpl_old123',aliasSha256:'a'.repeat(64),cronSha256:'b'.repeat(64),environmentMetadataSha256:'c'.repeat(64)};
 assert.equal(assertDiagnosticProductionPreservation({before,after:{...before}}).unchanged,true);
 assert.throws(()=>assertDiagnosticProductionPreservation({before,after:{...before,cronSha256:'d'.repeat(64)}}));
});
