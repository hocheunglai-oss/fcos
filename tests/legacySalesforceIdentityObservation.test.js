import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {observeLegacySalesforceIdentity} from '../scripts/lib/hosted-release/legacy-salesforce-identity-observation.mjs';
import {FIRST_RUNTIME,firstRuntimeTargets,firstRuntimeDigest} from '../scripts/lib/hosted-release/first-runtime.mjs';
import {FCOS_CONNECTION_POLICY,fcosSalesforceEnvironment} from '../config/fcosConnections.js';
import {FCOS_READ_ONLY_CI} from '../config/fcosCiIdentity.js';

const root=fileURLToPath(new URL('../',import.meta.url)),at=Date.now(),H='a'.repeat(64),id='00000000-0000-4000-8000-000000000123';
const federation=FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation,supabase=new URL(federation.oidcCallbackUrl).origin;
const jwt=p=>[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify(p)).toString('base64url'),'PRIVATE_SIGNATURE'].join('.');
const claims=()=>({iss:`${supabase}/auth/v1`,aud:'authenticated',role:'authenticated',sub:id,iat:Math.floor(at/1000),exp:Math.floor(at/1000)+3600});
const errorPayload=()=>({error:'Refresh the list to restart pagination.',message:'Refresh the list to restart pagination.',code:'MISSING_NOM_B_CURSOR_INVALID',requestId:'PRIVATE_REQUEST_ID'});
const response=(value=errorPayload(),status=400,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-fcos-handler-mutation':'0','x-fcos-external-action':'0',...headers}});
function fixture() {
  const binding={kind:'fcos_legacy_salesforce_identity_read_v1',deploymentId:FIRST_RUNTIME.previousDeploymentId,sha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,origin:FIRST_RUNTIME.previousUrl,path:'/api/functions/missingNomBList'};
  const targets=firstRuntimeTargets(),production={readOnly:true,capturedAt:new Date(at-1000).toISOString(),bindingMode:'exact_legacy_public_version',
    deployment:{id:binding.deploymentId,url:binding.origin,sha:binding.sha,sourceSha256:binding.sourceSha256,target:'production',state:'READY',projectId:targets.vercelProject,teamId:targets.vercelTeam},
    publicVersion:{sha256:H,commit:binding.sha,deploymentId:null,sourceAttested:false},
    originalBinding:{deploymentId:binding.deploymentId,immutableUrl:binding.origin,commit:binding.sha,sourceDigest:binding.sourceSha256,publicVersionSha256:H}};
  const publicAuth={kind:'fcos_legacy_runtime_own_profile_auth_v1',supabaseOrigin:supabase,issuerAuthorizationPath:'/api/oidc/authorize',
    publicAnonKey:`sb_publishable_${'A'.repeat(31)}`,publicAnonKeySha256:'',
    identity:{profileId:id,email:'PRIVATE_OWN_ACTOR@example.invalid'.toLowerCase(),role:'general_manager',accessRevision:2,fcunoSubjectSha256:H},
    preflight:{kind:'fcos_legacy_runtime_own_profile_preflight_v1',accepted:true,reviewerId:'/root',capturedAt:new Date(at-1000).toISOString(),sourceSha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,
      origin:binding.origin,deploymentId:binding.deploymentId,profileRlsOwnSelect:true,authenticatedSelectOnly:true,effectiveAccessSourceVerified:true,effectiveAdmin:true,
      profileExisting:true,linkExisting:true,linkBoundToProfile:true,linkSourceActive:true,linkUseFcos:true,linkRevokedBefore:null,issuer:federation.issuer,
      effectiveAccessSourceSha256:'f5e2678098eb9745e6915c9f23989cb7d46aa9de484132390dcbdab50cbbf4d9',evidenceSha256:H}};
  publicAuth.publicAnonKeySha256=firstRuntimeDigest(publicAuth.publicAnonKey);
  const token=jwt(claims()),calls=[],options={binding,production,publicAuth,controllerDirectory:root,bypass:'PRIVATE_BYPASS',now:()=>at,
    protection:async value=>{calls.push('protection');assert.equal(value.origin,binding.origin);assert.equal(value.bypass,'PRIVATE_BYPASS');return {private:'PRIVATE_PROTECTION_STATE'};},
    tokenProvider:async value=>{calls.push('login');assert.equal(value.deployment.id,binding.deploymentId);assert.equal(value.protectionState.private,'PRIVATE_PROTECTION_STATE');return token;},
    recheckProduction:async()=>{calls.push('recheck');return {...structuredClone(production),capturedAt:new Date(at).toISOString()};},
    fetchImpl:async(url,o)=>{calls.push('fetch');assert.equal(url,`${binding.origin}${binding.path}`);assert.equal(o.method,'POST');assert.equal(o.body,'{"cursor":"!"}');assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');
      assert.deepEqual(o.headers,{authorization:`Bearer ${token}`,'x-vercel-protection-bypass':'PRIVATE_BYPASS','content-type':'application/json'});assert.ok(o.signal instanceof AbortSignal);return response();}};
  return {binding,production,publicAuth,token,calls,options};
}

test('exact source-bound POST yields source-enforced guard provenance without raw Org fields, business rows, credentials or release acceptance',async()=>{
  const f=fixture(),r=await observeLegacySalesforceIdentity(f.options);
  assert.equal(r.status,'observed',JSON.stringify(r.failures));assert.deepEqual(f.calls,['protection','login','recheck','fetch']);assert.equal(r.source.verified,true);assert.equal(r.source.files.length,8);
  assert.equal(r.binding.productionRecheckedAt,new Date(at).toISOString());assert.equal(r.httpStatus,400);assert.equal(r.result.code,'MISSING_NOM_B_CURSOR_INVALID');
  assert.equal(r.result.responseSha256,firstRuntimeDigest(Buffer.from(JSON.stringify(errorPayload()))));assert.equal(r.appOwnedAuth.state,'authenticated');
  assert.equal(r.appOwnedAuth.selectedMode,'unknown');assert.equal(r.appOwnedAuth.orgId,null);assert.equal(r.appOwnedAuth.isSandbox,null);
  assert.equal(r.identityGuard.state,'passed');assert.equal(r.identityGuard.rawOrganizationFieldsObserved,false);assert.match(r.identityGuard.provenance,/source_enforced/);
  assert.equal(r.baselineAccepted,false);assert.equal(r.qualificationAccepted,false);assert.equal(r.behavior.outerRetries,0);assert.equal(r.behavior.directProviderCalls,0);
  assert.equal(r.behavior.businessQueries,0);assert.equal(r.behavior.nominationListRead,false);assert.equal(r.behavior.existingJwtOrRefreshMayOccur,true);assert.equal(r.behavior.ordinaryErrorLoggingMayOccur,true);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|private_own|sb_publishable|"cursor"|"requestId"/);
});

test('wrong immutable source, target, binding, public version or native horizon refuses before private callbacks',async t=>{
  for(const mutate of [f=>f.binding.kind='fcos_legacy_salesforce_app_read_v1',f=>f.binding.path='/api/functions/salesforceSchema',f=>f.binding.origin='https://fcos.fcuno.com',f=>f.binding.extra='PRIVATE_TOKEN',
    f=>f.binding.sha='e'.repeat(40),f=>f.production.deployment.sourceSha256=H,f=>f.production.deployment.teamId='wrong',f=>f.production.deployment.projectId='wrong',
    f=>f.production.deployment.id='dpl_Wrong',f=>f.production.deployment.target='preview',f=>f.production.publicVersion.deploymentId=f.binding.deploymentId,
    f=>f.production.publicVersion.sourceAttested=true,f=>f.production.originalBinding.publicVersionSha256='b'.repeat(64),f=>f.production.capturedAt=new Date(at-1800001).toISOString()]){
    const f=fixture();mutate(f);const r=await observeLegacySalesforceIdentity(f.options);assert.equal(r.status,'unknown');assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_BINDING_INVALID');assert.deepEqual(f.calls,[]);
  }
  for(const remote of ['https://example.invalid/foreign.git',`https://github.com/${firstRuntimeTargets().repository}.git`]){
    const dir=mkdtempSync(join(tmpdir(),'legacy-sf-identity-source-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));execFileSync('git',['init','-q',dir]);execFileSync('git',['-C',dir,'remote','add','origin',remote]);
    const f=fixture(),r=await observeLegacySalesforceIdentity({...f.options,controllerDirectory:dir});assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_SOURCE_INVALID');assert.deepEqual(f.calls,[]);
  }
});

test('Git override and missing/changed/CI actor evidence refuse before login or POST',async t=>{
  const previous=process.env.GIT_CONFIG_COUNT;process.env.GIT_CONFIG_COUNT='1';t.after(()=>{if(previous===undefined)delete process.env.GIT_CONFIG_COUNT;else process.env.GIT_CONFIG_COUNT=previous;});
  const f=fixture(),r=await observeLegacySalesforceIdentity(f.options);assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_SOURCE_INVALID');assert.deepEqual(f.calls,[]);
  if(previous===undefined)delete process.env.GIT_CONFIG_COUNT;else process.env.GIT_CONFIG_COUNT=previous;
  for(const mutate of [f=>{f.options.publicAuth=undefined;},f=>f.publicAuth.identity.role='administrator',f=>f.publicAuth.identity.email=FCOS_READ_ONLY_CI.email,
    f=>f.publicAuth.preflight.profileExisting=false,f=>f.publicAuth.preflight.linkExisting=false,f=>f.publicAuth.preflight.linkBoundToProfile=false,
    f=>f.publicAuth.preflight.effectiveAdmin=false,f=>f.publicAuth.preflight.sourceSha256=H,f=>f.publicAuth.preflight.capturedAt=new Date(at-1800001).toISOString()]){
    const f=fixture();mutate(f);const r=await observeLegacySalesforceIdentity(f.options);assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_ACTOR_INVALID');assert.deepEqual(f.calls,[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
  }
});

test('wrong bearer actor, target, role or expiry is caught locally after login and never sent',async()=>{
  for(const mutate of [c=>c.sub='00000000-0000-4000-8000-000000000999',c=>c.iss='https://foreign.invalid/auth/v1',c=>c.role='service_role',c=>c.aud='wrong',c=>c.exp=Math.floor(at/1000)-1,c=>c.iat=Math.floor(at/1000)-3600]){
    const f=fixture(),c=claims();mutate(c);const r=await observeLegacySalesforceIdentity({...f.options,tokenProvider:async()=>{f.calls.push('login');return jwt(c);}});
    assert.equal(r.status,'unknown');assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_ACTOR_INVALID');assert.deepEqual(f.calls,['protection','login']);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
  }
});

test('after-login native recheck blocks alias/source/version moves, cached observations, stale login and errors before POST',async()=>{
  const missing=fixture(),absent=await observeLegacySalesforceIdentity({...missing.options,recheckProduction:undefined});assert.equal(absent.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_TARGET_CHANGED');assert.deepEqual(missing.calls,[]);
  for(const change of ['moved','source','cached','same_object','version','future','failure']){
    const f=fixture(),r=await observeLegacySalesforceIdentity({...f.options,recheckProduction:async()=>{f.calls.push('recheck');
      if(change==='failure')throw Error('PRIVATE_RECHECK');if(change==='cached')return structuredClone(f.production);
      if(change==='same_object'){f.production.capturedAt=new Date(at).toISOString();return f.production;}
      const fresh={...structuredClone(f.production),capturedAt:new Date(at).toISOString()};
      if(change==='moved')fresh.deployment.id='dpl_Moved';if(change==='source')fresh.deployment.sourceSha256='b'.repeat(64);
      if(change==='version'){fresh.publicVersion.sha256='b'.repeat(64);fresh.originalBinding.publicVersionSha256=fresh.publicVersion.sha256;}
      if(change==='future')fresh.capturedAt=new Date(at+1).toISOString();return fresh;
    }});assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_TARGET_CHANGED');assert.deepEqual(f.calls,['protection','login','recheck']);assert.equal(r.httpStatus,null);assert.equal(r.result,undefined);
  }
  const f=fixture();let clock=at;const r=await observeLegacySalesforceIdentity({...f.options,now:()=>clock,tokenProvider:async()=>{f.calls.push('login');clock=at+1800001;return f.token;}});
  assert.equal(r.status,'unknown');assert.deepEqual(f.calls,['protection','login']);
});

test('401, wrong-status 400, 5xx, redirects, network errors and write headers never produce identity proof or retry',async()=>{
  const variants=[()=>response({error:'PRIVATE_ERROR'},401),()=>response({error:'PRIVATE_ERROR'},403),()=>response(errorPayload(),200),()=>response(errorPayload(),500),
    ()=>response(errorPayload(),503),()=>{throw Error('PRIVATE_NETWORK');},()=>({status:400,ok:false,redirected:true,body:new Response('PRIVATE').body}),
    ()=>response(errorPayload(),400,{'x-fcos-handler-mutation':'1'}),()=>response(errorPayload(),400,{'x-fcos-external-action':'1'}),
    ()=>response(errorPayload(),400,{'content-type':'text/html'}),()=>response(errorPayload(),400,{'cache-control':'public,max-age=3600'})];
  for(const make of variants){const f=fixture(),r=await observeLegacySalesforceIdentity({...f.options,fetchImpl:async()=>{f.calls.push('fetch');return make();}});
    assert.equal(r.status,'unknown');assert.equal(r.identityGuard.state,'unknown');assert.equal(r.appOwnedAuth.state,'unknown');assert.equal(r.result,undefined);assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_READ_UNKNOWN');assert.equal(f.calls.filter(c=>c==='fetch').length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
  }
});

test('wrong cursor code, messages, extra fields and oversized/invalid response bodies are sanitized and never accepted',async()=>{
  const variants=[()=>response({...errorPayload(),code:'MISSING_NOM_B_ORG_MISMATCH'}),()=>response({...errorPayload(),code:'MISSING_NOM_B_CURSOR_INVALID_PRIVATE'}),
    ()=>response({...errorPayload(),message:'PRIVATE_WRONG_MESSAGE'}),()=>response({...errorPayload(),error:'PRIVATE_WRONG_ERROR'}),()=>response({...errorPayload(),details:'PRIVATE_TOKEN'}),
    ()=>response({...errorPayload(),requestId:''}),()=>response({...errorPayload(),requestId:'x'.repeat(161)}),()=>response({...errorPayload(),requestId:'bad\nrequest'}),
    ()=>response(errorPayload(),400,{'content-length':'4097'}),()=>response(errorPayload(),400,{'content-length':'wrong'}),
    ()=>new Response('x'.repeat(4097),{status:400,headers:{'content-type':'application/json','cache-control':'no-store','x-fcos-handler-mutation':'0','x-fcos-external-action':'0'}})];
  for(const make of variants){const f=fixture(),r=await observeLegacySalesforceIdentity({...f.options,fetchImpl:async()=>{f.calls.push('fetch');return make();}});
    assert.equal(r.status,'unknown');assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_RESPONSE_UNKNOWN');assert.equal(r.identityGuard.state,'unknown');assert.equal(r.result,undefined);assert.equal(f.calls.filter(c=>c==='fetch').length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|details/);
  }
});

test('only fixed login codes escape; expiry during response leaves guard unobserved',async()=>{
  for(const [code,expected] of [['LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED','LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED'],['LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED_PRIVATE',undefined]]){
    const f=fixture(),r=await observeLegacySalesforceIdentity({...f.options,tokenProvider:async()=>{throw Object.assign(Error('PRIVATE_PASSWORD'),{code});}});
    assert.equal(r.failures[0].code,'LEGACY_SALESFORCE_IDENTITY_LOGIN_UNKNOWN');assert.equal(r.failures[0].loginPhase,expected);assert.equal(r.httpStatus,null);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
  }
  const f=fixture();let clock=at;const r=await observeLegacySalesforceIdentity({...f.options,now:()=>clock,fetchImpl:async()=>{f.calls.push('fetch');clock=at+1800001;return response();}});
  assert.equal(r.status,'unknown');assert.equal(r.identityGuard.state,'unknown');assert.equal(r.result,undefined);assert.equal(f.calls.filter(c=>c==='fetch').length,1);
});

const frozen=path=>execFileSync('git',['--no-replace-objects','show',`${FIRST_RUNTIME.previousSha}:${path}`],{cwd:root,encoding:'utf8'});
const dataUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
// Execute the complete frozen service in this offline test only. Leave its
// function bodies unchanged; bind immutable config and Node crypto, replacing
// unused provider/mail dependencies with throw-on-use stubs. Inject only the
// existing sfRequest boundary, not gateway.verify or cursor handling.
async function frozenService() {
  const configUrl=dataUrl(frozen('config/fcosConnections.js'));
  const source=frozen('api/_missingNomB.js').replace(/^import \{([^}]+)\} from '([^']+)';$/gm,(line,names,specifier)=>{
    if(specifier==='node:crypto')return line;
    if(specifier==='../config/fcosConnections.js')return `import {${names}} from '${configUrl}';`;
    return names.split(',').map(name=>`const ${name.trim()}=()=>{throw Error('UNEXPECTED_OFFLINE_DEPENDENCY');};`).join('\n');
  });
  return import(dataUrl(source));
}

test('actual frozen semantic entrypoint verifies Organization before rejecting exact invalid cursor, with one provider read and zero business queries',async()=>{
  const service=await frozenService(),sf=fcosSalesforceEnvironment('production'),publicError=await import(dataUrl(frozen('api/_publicApiError.js')));
  const contracts=await import(dataUrl(frozen('shared/functionContracts.js').replace(/^import .*;$/m,'const stemReadRequestIssues=()=>{throw Error("UNEXPECTED_BUSINESS_CONTRACT");};')));
  assert.deepEqual(contracts.validateFunctionRequest('missingNomBList',{cursor:'!'}).issues,[]);
  for(const orgs of [[{Id:sf.orgId,IsSandbox:sf.isSandbox}],[{Id:'wrong',IsSandbox:false}],[{Id:sf.orgId,IsSandbox:true}],[],[{Id:sf.orgId,IsSandbox:false},{Id:sf.orgId,IsSandbox:false}]]){
    const events=[],profile={id,active:true,user_type:'general_manager'},client={from:table=>{events.push(`own-profile:${table}`);assert.equal(table,'user_profiles');return {
      select:columns=>{assert.equal(columns,'id,email,full_name,user_type,active');return {eq:(column,value)=>{assert.equal(column,'id');assert.equal(value,id);return {maybeSingle:async()=>({data:profile,error:null})};}};}};},rpc:()=>assert.fail('No writes')};
    const sfRequest=async(path,options)=>{events.push('organization');assert.equal(options,undefined);const u=new URL(path,'https://offline.invalid');
      assert.equal(u.pathname,'/query/');assert.equal(u.searchParams.get('q'),'SELECT Id, IsSandbox FROM Organization LIMIT 2');assert.equal(events.filter(e=>e==='organization').length,1);return {records:orgs,done:true};};
    const accepted=orgs.length===1&&orgs[0].Id===sf.orgId&&orgs[0].IsSandbox===sf.isSandbox;
    await assert.rejects(service.missingNomBList({cursor:'!'},{client,profile},{sfRequest}),error=>{
      assert.equal(error.status,accepted?400:503);assert.equal(error.code,accepted?'MISSING_NOM_B_CURSOR_INVALID':'MISSING_NOM_B_ORG_MISMATCH');
      if(accepted)assert.deepEqual(publicError.publicApiErrorPayload(error,400,'PRIVATE_REQUEST_ID'),errorPayload());return true;
    });
    assert.deepEqual(events,['own-profile:user_profiles','organization']);
  }
});
