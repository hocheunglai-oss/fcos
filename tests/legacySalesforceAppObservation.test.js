import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {observeLegacySalesforceApp} from '../scripts/lib/hosted-release/legacy-salesforce-app-observation.mjs';
import {FIRST_RUNTIME,firstRuntimeTargets,firstRuntimeDigest} from '../scripts/lib/hosted-release/first-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),at=Date.now(),H='a'.repeat(64);
const objects=[{name:'Account',label:'PRIVATE_METADATA_LABEL',queryable:true,custom:false},{name:'Fixture__c',label:'Fixture',queryable:true,custom:true}];
const response=(value={objects},status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-fcos-handler-mutation':'0','x-fcos-external-action':'0',...headers}});
function fixture() {
  const binding={kind:'fcos_legacy_salesforce_app_read_v1',deploymentId:FIRST_RUNTIME.previousDeploymentId,sha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,origin:FIRST_RUNTIME.previousUrl,path:'/api/functions/salesforceSchema'};
  const targets=firstRuntimeTargets(),production={readOnly:true,capturedAt:new Date(at-1000).toISOString(),bindingMode:'exact_legacy_public_version',
    deployment:{id:binding.deploymentId,url:binding.origin,sha:binding.sha,sourceSha256:binding.sourceSha256,target:'production',state:'READY',projectId:targets.vercelProject,teamId:targets.vercelTeam},
    publicVersion:{sha256:H,commit:binding.sha,deploymentId:null,sourceAttested:false},
    originalBinding:{deploymentId:binding.deploymentId,immutableUrl:binding.origin,commit:binding.sha,sourceDigest:binding.sourceSha256,publicVersionSha256:H}};
  const calls=[],options={binding,production,controllerDirectory:root,bypass:'PRIVATE_BYPASS',now:()=>at,
    protection:async value=>{calls.push('protection');assert.equal(value.origin,binding.origin);assert.equal(value.bypass,'PRIVATE_BYPASS');return {private:'PRIVATE_PROTECTION_STATE'};},
    tokenProvider:async value=>{calls.push('login');assert.equal(value.deployment.id,binding.deploymentId);assert.equal(value.protectionState.private,'PRIVATE_PROTECTION_STATE');return 'PRIVATE_FCOS_SESSION';},
    fetchImpl:async(url,o)=>{calls.push('fetch');assert.equal(url,`${binding.origin}${binding.path}`);assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');assert.equal(o.body,undefined);
      assert.deepEqual(o.headers,{authorization:'Bearer PRIVATE_FCOS_SESSION','x-vercel-protection-bypass':'PRIVATE_BYPASS'});assert.ok(o.signal instanceof AbortSignal);return response();}};
  return {binding,production,calls,options};
}

test('actual adapter verifies immutable source before callbacks and performs one existing app read; only aggregate evidence is saved',async()=>{
  const f=fixture(),result=await observeLegacySalesforceApp(f.options);
  assert.equal(result.status,'observed',JSON.stringify(result.failures));assert.deepEqual(f.calls,['protection','login','fetch']);assert.equal(result.source.verified,true);assert.equal(result.source.files.length,4);
  assert.equal(result.result.objectCount,2);assert.equal(result.result.customObjectCount,1);assert.equal(result.result.responseSha256,firstRuntimeDigest(Buffer.from(JSON.stringify({objects}))));
  assert.equal(result.appOwnedAuth.state,'authenticated');assert.equal(result.appOwnedAuth.selectedMode,'unknown');assert.equal(result.appOwnedAuth.orgId,null);assert.equal(result.appOwnedAuth.isSandbox,null);
  assert.equal(result.baselineAccepted,false);assert.equal(result.qualificationAccepted,false);assert.equal(result.behavior.existingJwtOrRefreshMayOccur,true);assert.equal(result.behavior.ordinaryErrorLoggingMayOccur,true);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|Fixture__c|PRIVATE_FCOS_SESSION|"objects"/);assert.equal(result.binding.publicVersionSha256,H);assert.equal(result.httpStatus,200);
});

test('binding/source/version/deployment drift fails before protection/login or GET, including a foreign Git repository',async t=>{
  for(const mutate of [f=>f.binding.path='/api/functions/systemHealth',f=>f.binding.origin='https://fcos.fcuno.com',f=>f.binding.extra='PRIVATE_TOKEN',f=>f.binding.sha='e'.repeat(40),
    f=>f.production.deployment.teamId='wrong',f=>f.production.deployment.id='dpl_Wrong',f=>f.production.deployment.sourceSha256=H,f=>f.production.deployment.target='preview',
    f=>f.production.publicVersion.deploymentId=f.binding.deploymentId,f=>f.production.publicVersion.sourceAttested=true,f=>f.production.originalBinding.publicVersionSha256='b'.repeat(64),
    f=>f.production.capturedAt=new Date(at-1800001).toISOString()]){
    const f=fixture();mutate(f);const result=await observeLegacySalesforceApp(f.options);assert.equal(result.status,'unknown');assert.equal(result.failures[0].code,'LEGACY_SALESFORCE_APP_BINDING_INVALID');assert.deepEqual(f.calls,[]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
  }
  const dir=mkdtempSync(join(tmpdir(),'legacy-sf-source-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));execFileSync('git',['init','-q',dir]);execFileSync('git',['-C',dir,'remote','add','origin','https://example.invalid/foreign.git']);
  const f=fixture(),result=await observeLegacySalesforceApp({...f.options,controllerDirectory:dir});assert.equal(result.failures[0].code,'LEGACY_SALESFORCE_APP_SOURCE_INVALID');assert.deepEqual(f.calls,[]);
});

test('Git override is rejected before private callbacks; a slow login cannot use an expired native target observation',async t=>{
  const previous=process.env.GIT_CONFIG_COUNT;process.env.GIT_CONFIG_COUNT='1';t.after(()=>{if(previous===undefined)delete process.env.GIT_CONFIG_COUNT;else process.env.GIT_CONFIG_COUNT=previous;});
  const f=fixture(),invalid=await observeLegacySalesforceApp(f.options);assert.equal(invalid.failures[0].code,'LEGACY_SALESFORCE_APP_SOURCE_INVALID');assert.deepEqual(f.calls,[]);
  if(previous===undefined)delete process.env.GIT_CONFIG_COUNT;else process.env.GIT_CONFIG_COUNT=previous;
  const slow=fixture();let clock=at;const r=await observeLegacySalesforceApp({...slow.options,now:()=>clock,tokenProvider:async()=>{slow.calls.push('login');clock=at+1800001;return 'PRIVATE_SESSION';}});
  assert.equal(r.status,'unknown');assert.deepEqual(slow.calls,['protection','login']);assert.equal(r.httpStatus,null);
});

test('401/403/500, network exceptions and redirects are unknown with one outer GET and no raw error/hash leakage',async()=>{
  const responses=[()=>response({error:'PRIVATE_PROVIDER_ERROR'},401),()=>response({error:'PRIVATE_PROVIDER_ERROR'},403),()=>response({error:'PRIVATE_PROVIDER_ERROR'},500),
    ()=>{throw Error('PRIVATE_TOKEN_RAW_EXCEPTION');},()=>({status:200,ok:true,redirected:true,body:new Response('private').body}),()=>({status:200,ok:true,body:{}})];
  for(const create of responses){const f=fixture(),r=await observeLegacySalesforceApp({...f.options,fetchImpl:async()=>{f.calls.push('fetch');return create();}});
    assert.equal(r.status,'unknown');assert.equal(r.appOwnedAuth.state,'unknown');assert.equal(f.calls.filter(c=>c==='fetch').length,1);assert.equal(r.result,undefined);assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_APP_READ_UNKNOWN');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|RAW_EXCEPTION|ProviderError/);
  }
});

test('wrong shape, duplicate objects, extra fields, write headers and oversized bodies never become authentication evidence',async()=>{
  const variants=[()=>response({objects:[]}),()=>response({objects:[objects[0],objects[0]]}),()=>response({objects:[{...objects[0],accessToken:'PRIVATE_TOKEN'}]}),
    ()=>response({objects:[{...objects[0],queryable:false}]}),()=>response({objects},200,{'x-fcos-handler-mutation':'1'}),()=>response({objects},200,{'x-fcos-external-action':'1'}),
    ()=>response({objects},200,{'content-type':'text/html'}),()=>response({objects},200,{'cache-control':'public,max-age=3600'}),()=>new Response('x'.repeat(1048577),{headers:{'content-type':'application/json','cache-control':'no-store','x-fcos-handler-mutation':'0','x-fcos-external-action':'0'}})];
  for(const make of variants){const f=fixture(),r=await observeLegacySalesforceApp({...f.options,fetchImpl:async()=>{f.calls.push('fetch');return make();}});assert.equal(r.status,'unknown');assert.equal(r.appOwnedAuth.state,'unknown');assert.equal(r.result,undefined);assert.equal(f.calls.filter(c=>c==='fetch').length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|accessToken/);}
});

test('private login errors stay sanitized; native observation expiring during the read cannot be published as fresh',async()=>{
  const f=fixture(),login=await observeLegacySalesforceApp({...f.options,tokenProvider:async()=>{throw Error('PRIVATE_PASSWORD');}});assert.equal(login.failures[0].code,'LEGACY_SALESFORCE_APP_LOGIN_UNKNOWN');assert.equal(f.calls.filter(c=>c==='fetch').length,0);assert.doesNotMatch(JSON.stringify(login),/PRIVATE_/);
  const late=fixture();let clock=at;const r=await observeLegacySalesforceApp({...late.options,now:()=>clock,fetchImpl:async()=>{late.calls.push('fetch');clock=at+1800001;return response();}});
  assert.equal(r.status,'unknown');assert.equal(r.result,undefined);assert.equal(r.appOwnedAuth.state,'unknown');assert.equal(late.calls.filter(c=>c==='fetch').length,1);assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_APP_RESPONSE_UNKNOWN');
});
