// Hermetic joined contract: workflow-shaped env -> real hosted adapter -> real
// selected normal harness/isolation/coverage. Only native/provider IO is doubled.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHostedBrowser, assertHostedBrowserComposition } from '../scripts/lib/hosted-release/browser.mjs';
import { ORDINARY_BROWSER_CANDIDATE, hostedBrowserProfile } from '../scripts/lib/hosted-release/browser-profile.mjs';
import { COMPATIBILITY_NORMAL_MODULES, verifyRuntimeCompatibilityNormalRole } from '../scripts/runtime-compatibility-normal-role.mjs';
import { releaseResultSummary, hostedRelease } from '../scripts/hosted-release.mjs';
import { digest, releaseTargets } from '../scripts/lib/hosted-release/contract.mjs';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { admitVercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { validateHostedBrowserReport } from '../scripts/lib/hosted-release/browser-publisher.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

const origin='https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
const parity=JSON.parse(readFileSync(new URL('../config/preview-parity-policy.json',import.meta.url)));

function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'fcos-joined-browser-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const events=[],scenario={invalidModule:null},controllerSha='d'.repeat(40),capturedAt=new Date().toISOString();
  const expectedPreview={flags:Object.fromEntries(parity.runtimeFlags.map(k=>[k,{state:'known',value:false}])),
    safety:{readOnly:true,externalActions:Object.fromEntries(parity.externalActions.map(k=>[k,false]))},auth:{}};
  const base=fixtureManifest();
  const manifest={...base,candidate:structuredClone(ORDINARY_BROWSER_CANDIDATE),controller:{...base.controller,sha:controllerSha},targets:releaseTargets(),runtime:{...base.runtime,expectedPreview,probeProtocol:'xero_metered_v1'}};
  const credential=admitVercelReadFixture(manifest);
  credential.setup.probeProtocol='xero_metered_v1';manifest.setupSha256=digest(credential.setup);
  credential.env.FCOS_ADMITTED_RELEASE_SETUP=JSON.stringify(credential.setup);credential.env.FCOS_ADMITTED_RELEASE_SETUP_SHA256=manifest.setupSha256;
  const preview={id:'dpl_JoinedFixture',url:origin,projectId:manifest.targets.vercelProject,teamId:manifest.targets.vercelTeam,
    sha:manifest.candidate.sha,state:'READY',target:'preview',manifestHash:digest(manifest),sourceSha256:manifest.candidate.sourceSha256};
  const version={commit:manifest.candidate.sha,deploymentId:preview.id,provenance:{sourceDigest:manifest.candidate.sourceSha256,releaseEligible:true},builtAt:capturedAt};
  const runtime={capturedAt,deploymentId:preview.id,sha:manifest.candidate.sha,...expectedPreview};
  const auth={user:{id:'12345678-1234-1234-1234-123456789abc',email:'normal@example.invalid',active:true,read_only_ci:false,user_type:'general_manager'},
    moduleAccess:Object.fromEntries(COMPATIBILITY_NORMAL_MODULES.map(s=>[s.module,true]))};
  const source={sourceVerified:true,observationSourcesVerified:true,candidateSha:manifest.candidate.sha,sourceProfile:manifest.candidate.sourceProfile,
    sourceDigest:manifest.candidate.sourceSha256,lockSha256:manifest.candidate.lockSha256,configurationSha256:manifest.candidate.configurationSha256,
    sourceInputsSha256:manifest.candidate.sourceInputsSha256,salesforceSourceSha256:manifest.candidate.salesforceSourceSha256,branch:manifest.candidate.branch,
    controllerSha,manifestHash:digest(manifest)};
  const env={...credential.env,FCOS_HOSTED_BROWSER_ENABLED:'true',RUNNER_TEMP:directory,FCOS_E2E_VERCEL_BYPASS:'z'.repeat(32),
    FCOS_HOSTED_NORMAL_EMAIL:auth.user.email,FCOS_HOSTED_NORMAL_PASSWORD:'PRIVATE_FIXTURE_PASSWORD',FCOS_NORMAL_ROLE_APPROVED_EMAIL:auth.user.email,
    FCOS_HOSTED_NORMAL_EXPECTED_ROLE:'general_manager'}; // No ambient harness-enable flags.
  const token='PRIVATE_FIXTURE_NEW_TOKEN',state={cookies:[],origins:[{origin,localStorage:[{name:'sb-pjforfvchygdyqfcgpmw-auth-token',value:JSON.stringify({access_token:token})}]}]};
  mock.method(childProcess,'execFileSync',(program,args)=>{
    assert.equal(program,'git');events.push('git:'+args[0]);
    if(args[0]==='rev-parse')return controllerSha+'\n';if(args[0]==='status')return '';if(args[0]==='remote')return 'https://github.com/hocheunglai-oss/fcos\n';assert.fail('Unexpected native git IO');
  });syncBuiltinESMExports();t.after(()=>{mock.restoreAll();syncBuiltinESMExports();});
  const jsonResponse=body=>({ok:true,redirected:false,status:200,json:async()=>body});
  const fetchImpl=async(url,options={})=>{
    events.push('http:'+new URL(url).pathname);assert.notEqual(new URL(url).pathname,'/api/connection-runtime','No second metered runtime probe');
    if(String(url).includes('/integrations/configuration/'))return jsonResponse(credential.configuration);
    if(String(url).includes('/v9/projects/'))return jsonResponse({id:manifest.targets.vercelProject,accountId:manifest.targets.vercelTeam,name:'fcos',link:{type:'github',org:'hocheunglai-oss',repo:'fcos'}});
    if(String(url).includes('/v13/deployments/'))return jsonResponse({id:preview.id,url:new URL(origin).hostname,projectId:preview.projectId,teamId:preview.teamId,readyState:'READY',target:null,
      meta:{githubCommitSha:preview.sha,fcosHostedManifest:digest(manifest),fcosSourceSha256:manifest.candidate.sourceSha256}});
    if(String(url).endsWith('/app-version.json'))return jsonResponse(version);
    if(String(url).endsWith('/api/functions/authContext')){assert.equal(options.headers.authorization,'Bearer '+token);return jsonResponse(auth);}
    if(String(url).endsWith('/api/functions/workspacePreferencesGet'))return jsonResponse({preferences:{initialized:true}});
    assert.fail('Unreviewed provider request');
  };
  const requestType={newContext:async()=>({get:async url=>({url:()=>url,status:()=>307,headers:()=>({location:'/app-version.json'})}),
    storageState:async()=>({origins:[],cookies:[{name:'_vercel_jwt',value:'PRIVATE_HOST_COOKIE',domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:Date.now()/1000+3600}]}),dispose:async()=>{}})};
  let launches=0;
  const browserType={launch:async()=>{
    const login=launches++===0;events.push(login?'browser:login':'browser:modules');
    const context={route:async(_,route)=>{context.routeHandler=route;},storageState:async()=>state,close:async()=>{context.closed=true;},newPage:async()=>{
      if(login){let location=origin;const issuer=new URL(FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer).origin,waiting=[];
        const move=url=>{location=url;for(const wait of waiting)if(wait.predicate(new URL(url)))wait.resolve();};
        const page={goto:async()=>{move(origin+'/login');},url:()=>location,
          getByRole:(_,o)=>({waitFor:async()=>{},elementHandle:async()=>({click:async()=>{move(issuer+'/admin');},dispose:async()=>{}}),click:async()=>{move(o.name==='Login'?origin:issuer+'/admin');}}),
          getByLabel:()=>({fill:async()=>{assert.equal(new URL(location).origin,issuer);}}),waitForURL:predicate=>predicate(new URL(location))?Promise.resolve():new Promise(resolve=>waiting.push({predicate,resolve})),
          waitForResponse:async()=>({status:()=>200,json:async()=>auth}),close:async()=>{}};return page;
      }
      const handlers=new Map();let location=origin,closed=false,held=false;
      const locator=(name='')=>({first:()=>locator(name),filter:()=>locator(name),locator:s=>locator(s),getByText:s=>locator(String(s)),
        waitFor:async()=>{},isVisible:async()=>true,getAttribute:async()=>'',click:async()=>{events.push('ui:'+name);},
        count:async()=>name.includes('No receipts stored')?0:1,innerText:async()=>'Workflow Next owner business row'});
      const page={url:()=>location,isClosed:()=>closed,context:()=>context,close:async()=>{closed=true;},on:(k,v)=>handlers.set(k,v),off:k=>handlers.delete(k),
        getByRole:(kind,o)=>locator(kind+':'+o.name),getByLabel:name=>locator(name),getByText:name=>locator(String(name)),locator,
        waitForTimeout:async()=>{await Promise.resolve();},evaluate:async(fn,arg)=>{
          if(typeof arg==='string'){assert.equal(held,true);held=false;return true;}
          if(String(fn).includes('navigator.locks.request')){held=true;return true;}
          if(String(fn).includes('navigator.locks.query'))return held;
          return true;
        },goto:async url=>{
          location=url;
          if(url.endsWith('/app-version.json'))return{status:()=>200,url:()=>url,request:()=>({redirectedFrom:()=>null}),headers:()=>({'content-type':'application/json'}),json:async()=>version};
          const spec=COMPATIBILITY_NORMAL_MODULES.find(s=>new URL(origin+s.path).pathname===new URL(url).pathname&&new URL(origin+s.path).search===new URL(url).search);
          assert.ok(spec,'Real harness used an admitted legacy route');events.push('module:'+spec.module);
          const data=scenario.invalidModule===spec.module?{}:spec.module==='settings'?{settings:{annualInterestRatePct:1,bankChargesUsd:{UBS:1,DBS:1}}}:Object.fromEntries(spec.fields.map(field=>[field,[{id:'LOCAL_ROW'}]]));
          handlers.get('response')?.({url:()=>origin+'/api/functions/'+spec.handler,ok:()=>true,json:async()=>data});
          if(spec.module==='review')handlers.get('response')?.({url:()=>origin+'/api/functions/exceptionReviewWorkflowList',ok:()=>true,json:async()=>({byStemId:{},ownerOptions:[]})});
          return{};
        }};return page;
    }};return{newContext:async()=>context,close:async()=>{}};
  }};
  const options={manifest,preview,mode:'normal_role',env,fetchImpl,requestType,browserType,
    observeRuntime:async()=>{events.push('saved-runtime');return runtime;},admitHostedSource:async()=>source};
  return{options,manifest,preview,env,source,events,runtime,auth,scenario};
}

test('workflow-shaped env reaches real ordinary compatibility harness, all15 modules and real isolation without ambient flags/probe',async t=>{
  const f=fixture(t);assert.equal(f.env.FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED,undefined);assert.equal(f.env.FCOS_NORMAL_ROLE_E2E_ENABLED,undefined);
  const result=await runHostedBrowser(f.options);
  assert.equal(result.status,'passed',JSON.stringify(releaseResultSummary(result)));assert.equal(result.result.browserProfile,'ordinary_compatibility');
  assert.equal(result.result.modules.length,15);assert.equal(f.events.filter(e=>e.startsWith('module:')).length,15);
  const published=validateHostedBrowserReport({manifest:f.manifest,report:result,mode:'normal_role',preview:f.preview});
  assert.equal(published[0].completedAt,result.capturedAt);assert.equal(published[0].result.browserProfile,'ordinary_compatibility');
  for(const change of [r=>{r.result.browserProfile='application';},r=>{delete r.result.browserIsolation;},r=>{r.status='failed';}]){
    const bad=structuredClone(result);change(bad);assert.throws(()=>validateHostedBrowserReport({manifest:f.manifest,report:bad,mode:'normal_role',preview:f.preview}));
  }
  assert.equal(result.result.browserIsolation.backgroundSync.modules.length,15);assert.equal(result.result.browserIsolation.backgroundSync.released,true);
  assert.ok(f.events.includes('ui:tab:Receipts'));assert.equal(f.events.filter(e=>e==='saved-runtime').length,1);
  assert.equal(f.env.FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|access_token|PASSWORD/);
});

test('exact ordinary tuple rejects every source/profile substitution before any IO',async t=>{
  const f=fixture(t);
  for(const key of ['sha','sourceProfile','sourceSha256','lockSha256','configurationSha256','sourceInputsSha256','salesforceSourceSha256','branch']){
    const manifest=structuredClone(f.manifest);manifest.candidate[key]='wrong';let calls=0;
    const result=await runHostedBrowser({...f.options,manifest,verifyController:()=>{calls++;}});assert.equal(result.status,'failed');assert.equal(calls,0);assert.equal(result.stage,'browser.profile');
  }
  for(const key of ['sourceDigest','lockSha256','configurationSha256','sourceInputsSha256','salesforceSourceSha256','branch']){
    const result=await runHostedBrowser({...f.options,admitHostedSource:async()=>({...f.source,[key]:'wrong'})});assert.equal(result.diagnosticCode,'HOSTED_BROWSER_SOURCE_BINDING');
  }
  assert.equal(f.events.includes('browser:login'),false);
});

test('legacy public04ee verifier still rejects be6 even with ambient compatibility flag',async t=>{
  const f=fixture(t);let calls=0;await assert.rejects(verifyRuntimeCompatibilityNormalRole({env:{...f.env,FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED:'true',GITHUB_SHA:f.manifest.controller.sha,FCOS_E2E_EXPECTED_COMMIT:f.manifest.candidate.sha},fetchImpl:()=>{calls++;}}),e=>e.normalRoleDiagnostic?.stage==='CONFIGURATION');assert.equal(calls,0);
});

test('prepare/reconcile/checks composition fails before session, registration, provider or probe',async t=>{
  const f=fixture(t),manifest=structuredClone(f.manifest);manifest.candidate.sourceSha256='e'.repeat(64);
  for(const command of ['prepare','reconcile','checks']){
    let calls=0;await assert.rejects(hostedRelease(command,{env:{...f.env,FCOS_RELEASE_MANIFEST:JSON.stringify(manifest)},sessionFactory:()=>{calls++;assert.fail('No remote session');}}),{code:'HOSTED_BROWSER_PROFILE_INVALID'});assert.equal(calls,0);
  }
});

test('application catalogue remains distinct, unknown compatibility profiles cannot fall through',t=>{
  const f=fixture(t),application={...f.manifest,candidate:{...f.manifest.candidate,sha:'e'.repeat(40),sourceProfile:'application_v2'}};
  const selection=assertHostedBrowserComposition(application);assert.equal(selection.profile,'application');assert.equal(selection.modules.find(s=>s.module==='xero_portal').handler,'xeroIntegrityReport');
  assert.throws(()=>hostedBrowserProfile({...application,candidate:{...application.candidate,sourceProfile:'compat_unknown'}}),{code:'HOSTED_BROWSER_PROFILE_INVALID'});
  assert.throws(()=>hostedBrowserProfile({...application,candidate:{...application.candidate,sha:'2ef733d17dd12314c72971c2220b2b09903a6bf0'}}),{code:'HOSTED_BROWSER_PROFILE_INVALID'});
});

test('plain failures retain fixed preflight stage and safe compatibility module diagnostics',async t=>{
  const f=fixture(t);
  const result=await runHostedBrowser({...f.options,observeRuntime:async()=>{throw Error('PRIVATE_PROVIDER_BODY token=password');}});
  assert.equal(result.stage,'browser.runtime');assert.equal(releaseResultSummary(result).stage,'browser.runtime');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|password/);
  f.scenario.invalidModule='markets';const coverage=await runHostedBrowser(f.options);
  assert.equal(coverage.status,'failed');assert.equal(coverage.stage,'browser.normal');assert.equal(coverage.normalRole.stage,'COVERAGE');
  assert.equal(releaseResultSummary(coverage).normalRole.modules.find(s=>s.module==='markets').reason,'DATA_SHAPE_REJECTED');
});

test('before/after browser upload retains failed reports without allowing failure-as-pass',()=>{
  const source=readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8');
  for(const phase of ['before','after']){
    const block=source.split(`  browser_${phase}:`)[1].split(/\n  [a-z_]+:/)[0];
    assert.match(block,/always\(\) && steps\.run\.outcome != 'skipped'/);assert.match(block,/if-no-files-found: error/);
  }
});
