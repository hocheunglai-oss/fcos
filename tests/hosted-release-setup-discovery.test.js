import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverHostedSetup } from '../scripts/hosted-release-manifest.mjs';
import { validateDiscoverySetup } from '../scripts/lib/hosted-release/manifest.mjs';
import { collectSchemaObservation, collectSchemaSnapshot, SCHEMA_QUERY } from '../scripts/lib/hosted-release/observations.mjs';
import { createSetupDiscoveryCollector } from '../scripts/lib/hosted-release/live-collector.mjs';
import { createVercelProductionObserver } from '../scripts/lib/hosted-release/vercel.mjs';
import { digest, FROZEN_COMPATIBILITY_SHA, releaseTargets, validateManifest } from '../scripts/lib/hosted-release/contract.mjs';
import { PREVIEW_PARITY_POLICY } from '../scripts/lib/preview-parity.mjs';
import { vercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { githubClient } from '../scripts/lib/hosted-release/github.mjs';
import { firstRuntimeFixture } from './helpers/hosted-first-runtime.mjs';
import { FIRST_RUNTIME,firstRuntimeLegacyBinding,firstRuntimeSourceAbsence } from '../scripts/lib/hosted-release/first-runtime.mjs';

const H = 'a'.repeat(64), B = 'b'.repeat(40), now = Date.now();
const template = readFileSync(new URL('../.github/qualification/hosted-release-bootstrap.yml',import.meta.url),'utf8');
const clone = value => structuredClone(value);
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(),'fcos-setup-discovery-')); t.after(() => rmSync(directory,{recursive:true,force:true}));
  mkdirSync(join(directory,'.github/qualification'),{recursive:true});
  writeFileSync(join(directory,'.github/qualification/hosted-release-bootstrap.yml'),template);
  const git = args => execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','controller']);
  const C = git(['rev-parse','HEAD']), targets = releaseTargets(), read = vercelReadFixture({now,targets});
  const source = {ref:'refs/heads/codex/discovery-fixture',bootstrapSha:B,controllerSha:C,candidateSha:FROZEN_COMPATIBILITY_SHA,
    callerWorkflowRef:`${targets.repository}/.github/workflows/authenticated-release.yml@refs/heads/codex/discovery-fixture`};
  const setup = {schemaVersion:1,kind:'fcos_hosted_setup_discovery',controllerSha:C,candidateSha:FROZEN_COMPATIBILITY_SHA,
    sourceProfile:'frozen_04ee',targets,qualificationSource:source,environment:'fcos-hosted-verification',issuedAt:now-1000,notAfter:now+60000,
    runtimeIdentity:{emailSha256:digest('runtime@example.invalid'),role:'administrator'},vercelReadCredential:read.binding,
    vercelReadCredentialAcceptance:read.acceptance,legacyProductionBinding:null};
  const env = {GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:targets.repository,GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:source.ref,
    GITHUB_REF_PROTECTED:'true',GITHUB_SHA:B,GITHUB_WORKFLOW_REF:source.callerWorkflowRef,GITHUB_WORKFLOW_SHA:B,GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_RUN_ID:'17',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'hocheunglai-oss',GITHUB_ACTOR_ID:'12345',GITHUB_JOB:'setup_discovery',
    FCOS_HOSTED_SETUP_DISCOVERY_ADMITTED:'true',FCOS_SETUP_DISCOVERY_BOOTSTRAP:'true',FCOS_HOSTED_ENVIRONMENT:setup.environment,
    FCOS_CONTROLLER_SHA:C,FCOS_CANDIDATE_SHA:FROZEN_COMPATIBILITY_SHA,FCOS_CONTROLLER_DIRECTORY:directory,
    FCOS_CANDIDATE_DIRECTORY:join(directory,'not-checked-out'),FCOS_DISCOVERY_OUTPUT:join(directory,'discovery.json'),
    FCOS_RELEASE_OUTPUT:join(directory,'never-manifest.json'),GITHUB_OUTPUT:join(directory,'never-workflow-output.txt'),
    FCOS_ADMITTED_DISCOVERY_SETUP:JSON.stringify(setup),FCOS_ADMITTED_DISCOVERY_SETUP_SHA256:digest(setup),
    FCOS_HOSTED_VERCEL_READ_TOKEN:read.token,FCOS_HOSTED_RUNTIME_EMAIL:'runtime@example.invalid',FCOS_HOSTED_RUNTIME_PASSWORD:'PRIVATE_PASSWORD',
    FCOS_HOSTED_RUNTIME_EXPECTED_ROLE:'administrator',FCOS_PRODUCTION_VERIFICATION_BYPASS:'PRIVATE_BYPASS',
    FCOS_HOSTED_SCHEMA_DATABASE_URL:`postgresql://fcos_release_observer:PRIVATE_DATABASE@db.${targets.supabaseProject}.supabase.co/postgres?sslmode=verify-full`};
  const branch={name:source.ref.slice(11),protected:true,commit:{sha:B}},protection={enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}};
  const run={id:17,repository:{full_name:targets.repository,id:1278654816},head_repository:{full_name:targets.repository},head_branch:branch.name,head_sha:B,
    path:'.github/workflows/authenticated-release.yml',event:'workflow_dispatch',run_attempt:1,status:'in_progress',conclusion:null,
    actor:{login:env.GITHUB_ACTOR,id:12345},triggering_actor:{login:env.GITHUB_ACTOR,id:12345}};
  const workflow={type:'file',path:'.github/workflows/authenticated-release.yml',encoding:'base64',content:Buffer.from(template.replaceAll('__FCOS_CONTROLLER_SHA__',C)).toString('base64')};
  const job={id:18,run_id:17,run_attempt:1,head_sha:B,name:'Setup discovery',status:'in_progress',conclusion:null,started_at:new Date(now-1000).toISOString(),
    steps:[{name:'Discover public setup baseline',status:'in_progress',conclusion:null}]};
  const jobs={total_count:1,jobs:[job]},calls=[];
  const github={identity:async()=>{calls.push('identity');},read:async path=>{
    calls.push(path);
    if(path.endsWith('/actions/runs/17'))return run;
    if(path.includes('/branches/')&&path.endsWith('/protection'))return protection;
    if(path.includes('/branches/'))return branch;
    if(path.includes('/contents/'))return workflow;
    if(path.endsWith('/attempts/1/jobs?per_page=100'))return jobs;
    assert.fail(`unexpected read ${path}`);
  }};
  const collectSource=()=>({candidate:{sha:FROZEN_COMPATIBILITY_SHA,sourceProfile:'frozen_04ee',sourceSha256:H},controller:{sha:C},checks:[]});
  let current=now;const waits=[];
  const options={env,now:()=>current,wait:async milliseconds=>{waits.push(milliseconds);current+=milliseconds;},createGithub:()=>github,collectSource};
  return {directory,C,setup,source,env,branch,protection,run,workflow,job,jobs,calls,github,read,options,waits,advance:milliseconds=>{current+=milliseconds;}};
}
function repin(f) { f.env.FCOS_ADMITTED_DISCOVERY_SETUP=JSON.stringify(f.setup);f.env.FCOS_ADMITTED_DISCOVERY_SETUP_SHA256=digest(f.setup); }
function providerFixture(f,{legacy=false,firstRuntime=false}={}) {
  const first=firstRuntime?firstRuntimeFixture({now}):null;
  const target=f.setup.targets,id=firstRuntime?FIRST_RUNTIME.previousDeploymentId:'dpl_discovery',sha=firstRuntime?FIRST_RUNTIME.previousSha:'c'.repeat(40),url=firstRuntime?FIRST_RUNTIME.previousUrl:'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app';
  const version=first?.version||{commit:sha,deploymentId:legacy?null:id,builtAt:new Date(now-86400000).toISOString(),provenance:{commit:sha,sourceAttested:!legacy,sourceDigest:H,sourceDigestAlgorithm:'sha256:fcos-vercel-source-v1'}};
  const deployment={id,url:new URL(url).hostname,projectId:target.vercelProject,ownerId:target.vercelTeam,target:'production',readyState:'READY',createdAt:now-86400000,meta:{githubCommitSha:sha}};
  const alias={alias:new URL(target.productionOrigin).hostname,projectId:target.vercelProject,deploymentId:id,deployment:{id,url:deployment.url},redirect:null,deletedAt:null};
  const project={id:target.vercelProject,accountId:target.vercelTeam,name:'fcos',link:{type:'github',org:'hocheunglai-oss',repo:'fcos'},targets:{production:{id}}};
  if(legacy)f.setup.legacyProductionBinding={kind:'fcos_discovery_legacy_public_version',teamId:target.vercelTeam,projectId:target.vercelProject,
    productionOrigin:target.productionOrigin,deploymentId:id,immutableUrl:url,commit:sha,sourceDigest:H,sourceDigestAlgorithm:'sha256:fcos-vercel-source-v1',
    publicVersionSha256:digest(version),sourceAttested:false,providerEvidenceSha256:H,versionEvidenceSha256:H,capturedAt:new Date(now-60000).toISOString()};
  if(firstRuntime)f.setup.legacyProductionBinding=firstRuntimeLegacyBinding(first.reference,{now});
  repin(f);
  const runtime={schemaVersion:1,deploymentId:id,sha,sourceDigest:H,capturedAt:new Date(now).toISOString(),
    flags:Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(key=>[key,{state:'known',value:false}])),
    safety:{readOnly:true,externalActions:Object.fromEntries(PREVIEW_PARITY_POLICY.externalActions.map(key=>[key,false]))},auth:{}};
  const calls=[];
  const fetchImpl=async(input,options={})=>{
    const u=new URL(input);calls.push({url:u.href,method:options.method});
    if(u.origin==='https://api.vercel.com') {
      assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);assert.equal(u.searchParams.get('teamId'),target.vercelTeam);
      if(u.pathname.startsWith('/v1/integrations/configuration/'))return Response.json(f.read.configuration);
      if(u.pathname===`/v9/projects/${target.vercelProject}`)return Response.json(project);
      if(u.pathname.startsWith('/v4/aliases/'))return Response.json(alias);
      if(u.pathname===`/v13/deployments/${id}`)return Response.json(deployment);
    }
    if(u.pathname==='/app-version.json') {assert.equal(options.headers?.authorization,undefined);assert.equal(options.headers?.['x-vercel-protection-bypass'],u.origin===url?'PRIVATE_BYPASS':undefined);return Response.json(version);}
    if(u.href===`${url}/api/connection-runtime`) {
      if(firstRuntime){assert.equal(options.method,'GET');assert.equal(options.headers['x-vercel-protection-bypass'],'PRIVATE_BYPASS');assert.equal(options.redirect,'error');return new Response(null,{status:404});}
      assert.equal(options.method,'POST');assert.equal(options.body,JSON.stringify({action:'probe'}));return Response.json(runtime);}
    assert.fail(`unexpected provider read ${u.href}`);
  };
  return {version,deployment,alias,project,runtime,fetchImpl,calls,url,id,sha,first};
}
function schemaClient({unsafe=false,fail=false}={}) {
  const calls=[];
  class Client {
    constructor(config) {assert.equal(config.options,'-c default_transaction_read_only=on -c search_path=pg_catalog');assert.equal(config.ssl.rejectUnauthorized,true);}
    async connect(){calls.push('connect');if(fail)throw new Error('PRIVATE_CONNECTION_FAILURE');}
    async query(sql){calls.push(sql);if(sql.startsWith('select current_user'))return {rows:[{role:'fcos_release_observer',database:'postgres',rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false,memberships:false,table_writes:unsafe}]};if(sql===SCHEMA_QUERY)return {rows:[{snapshot:{relations:['fixture-only'],functions:[]}}]};return {rows:[]};}
    async end(){calls.push('end');}
  }
  return {Client,calls};
}
const login=async()=>({token:'PRIVATE_RUNTIME_BEARER',auth:{user:{id:'00000000-0000-4000-8000-000000000001',email:'runtime@example.invalid',active:true,read_only_ci:false,user_type:'administrator'},moduleAccess:{}}});

function legacyRuntimeAuthFixture() {
 const publicAnonKey=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({iss:'supabase',ref:releaseTargets().supabaseProject,role:'anon',exp:Math.floor(now/1000)+3600})).toString('base64url'),'FIXTURE_SIGNATURE'].join('.');
 return {kind:'fcos_legacy_runtime_own_profile_auth_v1',supabaseOrigin:`https://${releaseTargets().supabaseProject}.supabase.co`,publicAnonKey,publicAnonKeySha256:createHash('sha256').update(publicAnonKey).digest('hex'),issuerAuthorizationPath:'/api/oidc/authorize',
  identity:{profileId:'00000000-0000-4000-8000-000000000123',email:'runtime@example.invalid',role:'administrator',accessRevision:2,fcunoSubjectSha256:H},
  preflight:{kind:'fcos_legacy_runtime_own_profile_preflight_v1',accepted:true,reviewerId:'/root',capturedAt:new Date(now).toISOString(),sourceSha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,
   origin:FIRST_RUNTIME.previousUrl,deploymentId:FIRST_RUNTIME.previousDeploymentId,profileRlsOwnSelect:true,authenticatedSelectOnly:true,effectiveAccessSourceVerified:true,effectiveAdmin:true,
   profileExisting:true,linkExisting:true,linkBoundToProfile:true,linkSourceActive:true,linkUseFcos:true,linkRevokedBefore:null,issuer:'https://fcuno.com',
   effectiveAccessSourceSha256:'f5e2678098eb9745e6915c9f23989cb7d46aa9de484132390dcbdab50cbbf4d9',evidenceSha256:H}};
}
const legacySalesforceBinding=()=>({kind:'fcos_legacy_salesforce_app_read_v1',deploymentId:FIRST_RUNTIME.previousDeploymentId,
 sha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,origin:FIRST_RUNTIME.previousUrl,path:'/api/functions/salesforceSchema'});
test('legacy Salesforce app observation requires a separate exact opt-in and never substitutes baseline authority',t=>{
 const f=fixture(t);providerFixture(f,{legacy:true,firstRuntime:true});f.setup.legacySalesforceAppObservation=legacySalesforceBinding();f.setup.legacyRuntimeAuth=legacyRuntimeAuthFixture();
 assert.equal(validateDiscoverySetup(f.setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),f.setup);
 for(const change of [v=>v.path='/api/functions/systemHealth',v=>v.origin='https://foreign.vercel.app',v=>v.sha='e'.repeat(40),v=>v.sourceSha256=H,v=>v.extra=true]){
  const setup=clone(f.setup);change(setup.legacySalesforceAppObservation);
  assert.throws(()=>validateDiscoverySetup(setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),{code:'DISCOVERY_LEGACY_SALESFORCE_BINDING_INVALID'});
 }
 const setup=clone(f.setup);setup.firstRuntimeBaseline=firstRuntimeFixture({now}).reference;
 assert.throws(()=>validateDiscoverySetup(setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),{code:'DISCOVERY_LEGACY_SALESFORCE_BINDING_INVALID'});
});
test('legacy runtime authentication is inseparable from its opt-in and actual identity preflight',t=>{
 const f=fixture(t);providerFixture(f,{legacy:true,firstRuntime:true});f.setup.legacySalesforceAppObservation=legacySalesforceBinding();f.setup.legacyRuntimeAuth=legacyRuntimeAuthFixture();
 for(const change of [s=>delete s.legacyRuntimeAuth,s=>s.legacyRuntimeAuth.identity.email='other@example.invalid',s=>s.legacyRuntimeAuth.preflight.effectiveAdmin=false,s=>s.legacyRuntimeAuth.preflight.authenticatedSelectOnly=false,
  s=>s.legacyRuntimeAuth.supabaseOrigin='https://foreign.supabase.co',s=>s.legacyRuntimeAuth.preflight.capturedAt=new Date(now-1800001).toISOString()]){
  const setup=clone(f.setup);change(setup);assert.throws(()=>validateDiscoverySetup(setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),{code:'DISCOVERY_LEGACY_RUNTIME_AUTH_INVALID'});
 }
 const setup=clone(f.setup);delete setup.legacySalesforceAppObservation;
 assert.throws(()=>validateDiscoverySetup(setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),{code:'DISCOVERY_LEGACY_RUNTIME_AUTH_INVALID'});
});
test('actual discovery entrypoint invokes opted-in app observer and keeps first-runtime baseline incomplete',async t=>{
 const f=fixture(t),p=providerFixture(f,{legacy:true,firstRuntime:true}),db=schemaClient();f.setup.legacySalesforceAppObservation=legacySalesforceBinding();f.setup.legacyRuntimeAuth=legacyRuntimeAuthFixture();repin(f);let observations=0;
 const proof={kind:'fcos_legacy_salesforce_app_read_observation_v1',baselineAccepted:false,appOwnedAuth:{state:'authenticated',selectedMode:'unknown',orgId:null,isSandbox:null}};
 const result=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login,protection:async()=>({}),
  verifyLegacySource:()=>({sourceAbsent:true}),observeLegacySalesforce:async args=>{observations++;assert.deepEqual(args.binding,f.setup.legacySalesforceAppObservation);assert.equal(args.production.deployment.id,FIRST_RUNTIME.previousDeploymentId);assert.equal(args.bypass,'PRIVATE_BYPASS');assert.equal(typeof args.tokenProvider,'function');return proof;}})});
 assert.equal(observations,1);assert.equal(result.status,'baseline_required');assert.equal(result.qualificationAccepted,false);assert.equal(result.admittedSetup,false);
 assert.deepEqual(result.observations.runtime.result.legacySalesforceAppObservation,proof);assert.deepEqual(result.observations.runtime.result.auth,{});
 assert.equal(result.observations.runtime.result.automaticRollbackEligible,false);assert.doesNotMatch(readFileSync(f.env.FCOS_DISCOVERY_OUTPUT,'utf8'),/PRIVATE_/);
});
test('opted-in legacy app observation cannot bypass runtime identity or protection admission',async t=>{
 for(const missing of ['identity','protection']){
  const f=fixture(t),p=providerFixture(f,{legacy:true,firstRuntime:true}),db=schemaClient();f.setup.legacySalesforceAppObservation=legacySalesforceBinding();f.setup.legacyRuntimeAuth=legacyRuntimeAuthFixture();repin(f);
  if(missing==='identity')f.env.FCOS_HOSTED_RUNTIME_EMAIL='different@example.invalid';else delete f.env.FCOS_PRODUCTION_VERIFICATION_BYPASS;
  if(missing==='protection'){
   const collector=createSetupDiscoveryCollector({setup:f.setup,env:f.env,now:()=>now,fetchImpl:p.fetchImpl,verifyLegacySource:()=>({sourceAbsent:true}),
    observeLegacySalesforce:()=>assert.fail('no app auth before protection'),login:()=>assert.fail('no login')});
   await assert.rejects(collector.runtime({deployment:{id:p.id,sha:p.sha,url:p.url,sourceSha256:FIRST_RUNTIME.sourceSha256},publicVersion:{sha256:digest(p.version)}}),{code:'DISCOVERY_RUNTIME_PROTECTION'});
   continue;
  }
  const result=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,
   verifyLegacySource:()=>({sourceAbsent:true}),observeLegacySalesforce:()=>assert.fail('no app auth before admission'),login:()=>assert.fail('no login')})});
  assert.equal(result.status,'incomplete');assert.equal(result.failures[0].code,'DISCOVERY_RUNTIME_IDENTITY');
 }
});

test('actual discovery reports exact first-runtime baseline dependency without POSTing the absent endpoint',async t=>{
  for(const baseline of [false,true,'unknown']){
    const f=fixture(t),p=providerFixture(f,{legacy:true,firstRuntime:true}),db=schemaClient();
    if(baseline){const value=clone(p.first.value);if(baseline==='unknown')value.runtime.auth.salesforce.state='unknown';f.setup.firstRuntimeBaseline=p.first.referenceFor(value);repin(f);}
    const result=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,
      verifyLegacySource:()=>firstRuntimeSourceAbsence(new URL('..',import.meta.url).pathname),login:()=>assert.fail('legacy login forbidden'),protection:()=>assert.fail('legacy POST protection forbidden')})});
    assert.equal(result.status,baseline===true?'observed':'baseline_required',JSON.stringify(result.failures));assert.deepEqual(result.failures,[]);
    assert.equal(result.qualificationAccepted,false);assert.equal(result.admittedSetup,false);const runtime=result.observations.runtime.result;
    assert.equal(runtime.endpointAbsent,true);assert.equal(runtime.automaticRollbackEligible,false);assert.ok(p.calls.every(c=>c.method!=='POST'));
    if(!baseline){assert.equal(runtime.endpointObservation.httpStatus,404);assert.equal(result.observations.runtime.status,'endpoint_absent');assert.equal(runtime.flags.FCOS_ENABLE_FCUNO_FEDERATION.state,'unknown');}
    else {assert.equal(runtime.authHistorical,true);assert.equal(runtime.freshOwnerObservationRequired,true);}
    assert.doesNotMatch(readFileSync(f.env.FCOS_DISCOVERY_OUTPUT,'utf8'),/PRIVATE_/);
  }
});
test('immutable Git source absence alone never becomes an observed deployed HTTP404',async t=>{
  const f=fixture(t),p=providerFixture(f,{legacy:true,firstRuntime:true}),production={deployment:{id:p.id,sha:p.sha,url:p.url,sourceSha256:FIRST_RUNTIME.sourceSha256},publicVersion:{sha256:digest(p.version)}};
  for(const response of [null,302,401,200]){
    const env={...f.env};if(response===null)delete env.FCOS_PRODUCTION_VERIFICATION_BYPASS;let calls=0;
    const collector=createSetupDiscoveryCollector({setup:f.setup,env,now:()=>now,verifyLegacySource:()=>({sourceAbsent:true}),fetchImpl:async()=>{calls++;return new Response(null,{status:response});},login:()=>assert.fail('no login')});
    const runtime=await collector.runtime(production);assert.equal(runtime.sourceAbsent,true);assert.equal(runtime.endpointAbsent,null);assert.equal(runtime.endpointObservation.status,'not_observed');assert.equal(runtime.baselineRequired,true);assert.equal(calls,response===null?0:1);
  }
});

test('seedless actual discovery entrypoint admits exact B/C/F and emits baseline only without a release or epoch',async t=>{
  const f=fixture(t),p=providerFixture(f,{legacy:true}),db=schemaClient();
  assert.equal(validateDiscoverySetup(f.setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),f.setup);
  const result=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login,protection:async()=>({})})});
  assert.equal(result.status,'observed',JSON.stringify(result.failures));assert.deepEqual(result.failures,[]);assert.equal(result.qualificationAccepted,false);assert.equal(result.admittedSetup,false);
  assert.equal(result.observations.production.result.publicVersion.deploymentId,null);assert.equal(result.observations.production.result.publicVersion.sourceAttested,false);
  assert.equal(result.observations.production.result.automaticRollbackEligible,false);assert.equal(result.observations.production.result.originalBinding.capturedAt,f.setup.legacyProductionBinding.capturedAt);
  assert.equal(result.observations.runtime.result.deploymentId,p.id);assert.equal(result.observations.schema.result.sha256,digest({relations:['fixture-only'],functions:[]}));
  assert.equal(existsSync(f.env.FCOS_RELEASE_OUTPUT),false);assert.equal(existsSync(f.env.GITHUB_OUTPUT),false);
  assert.doesNotMatch(readFileSync(f.env.FCOS_DISCOVERY_OUTPUT,'utf8'),/PRIVATE_|expectedProduction|expectedPreview|manifestHash|publisher/);
  assert.deepEqual(db.calls.slice(-5),['begin isolation level repeatable read read only','set local search_path = pg_catalog',SCHEMA_QUERY,'commit','end']);
  assert.throws(()=>validateManifest(result),{code:'MANIFEST_SCHEMA'});
});

test('dispatch-only admission runs before candidate/provider/private work and validates the current scoped step',async t=>{
  const f=fixture(t);f.job.steps[0].name='Admit discovery before candidate checkout';
  const result=await discoverHostedSetup({...f.options,validateDispatchOnly:true,collectSource:()=>assert.fail('no candidate reads'),createCollector:()=>assert.fail('no provider work')});
  assert.equal(result.status,'admitted_discovery_only');assert.equal(existsSync(f.env.FCOS_CANDIDATE_DIRECTORY),false);assert.equal(f.calls.length,6);
});

test('actual entrypoint waits only for queued or missing expected job/step publication before private collection',async t=>{
  for(const pending of ['queued','missing-job','missing-step','queued-run']){
    const f=fixture(t),p=providerFixture(f,{legacy:true}),db=schemaClient();
    if(pending==='queued'){f.job.status='queued';f.job.started_at=null;f.job.steps[0].status='queued';}
    if(pending==='missing-job'){f.jobs.jobs=[];f.jobs.total_count=0;}
    if(pending==='missing-step')f.job.steps=[];
    if(pending==='queued-run')f.run.status='queued';
    let privateCollectors=0;
    const r=await discoverHostedSetup({...f.options,wait:async milliseconds=>{
      assert.equal(privateCollectors,0);f.waits.push(milliseconds);f.advance(milliseconds);
      f.jobs.jobs=[f.job];f.jobs.total_count=1;f.run.status='in_progress';f.job.status='in_progress';
      f.job.started_at=new Date(now-1000).toISOString();f.job.steps=[{name:'Discover public setup baseline',status:'in_progress',conclusion:null}];
    },createCollector:options=>{privateCollectors++;assert.deepEqual(f.waits,[2000]);return createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login,protection:async()=>({})});}});
    assert.equal(r.status,'observed');assert.equal(privateCollectors,1);assert.equal(r.binding.publicationWaitMs,2000);
    assert.equal(r.binding.jobStartedAt,new Date(now-1000).toISOString());assert.equal(r.binding.originalSetupIssuedAt,f.setup.issuedAt);
  }
});

test('publication timeout and original setup/job horizons deny without private collection or timestamp renewal',async t=>{
  const f=fixture(t);f.job.steps=[];
  const r=await discoverHostedSetup({...f.options,createCollector:()=>assert.fail('no private collector')});
  assert.deepEqual(r.failures,[{phase:'admission',code:'DISCOVERY_JOB_PUBLICATION_TIMEOUT'}]);
  assert.equal(f.waits.reduce((a,b)=>a+b,0),20000);assert.ok(f.waits.every(ms=>ms<=2000));
  for(const kind of ['setup','job']){
    const f=fixture(t);f.job.steps=[];
    if(kind==='setup'){f.setup.notAfter=now+1000;repin(f);}else f.job.started_at=new Date(now-899000).toISOString();
    const r=await discoverHostedSetup({...f.options,createCollector:()=>assert.fail('no private collector')});
    assert.equal(r.failures[0].code,kind==='setup'?'DISCOVERY_SETUP_EXPIRED':'DISCOVERY_JOB_CONTEXT');assert.deepEqual(f.waits,[1000]);
  }
});

test('terminal/failed/foreign/duplicate job or run never waits; terminal publication and changed original times stop immediately',async t=>{
  for(const mutate of [f=>{f.job.status='completed';f.job.conclusion='success';},f=>{f.job.status='completed';f.job.conclusion='failure';},
    f=>{f.run.status='completed';f.run.conclusion='failure';},f=>f.job.run_id=99,f=>f.job.head_sha='e'.repeat(40),
    f=>f.run.head_sha='e'.repeat(40),f=>{f.jobs.jobs.push(clone(f.job));f.jobs.total_count=2;},
    f=>{f.job.steps[0].status='completed';f.job.steps[0].conclusion='success';}]){
    const f=fixture(t);mutate(f);const r=await discoverHostedSetup({...f.options,createCollector:()=>assert.fail('no private collector')});
    assert.equal(r.status,'incomplete');assert.deepEqual(f.waits,[]);
  }
  for(const mutate of [f=>{f.run.status='completed';f.run.conclusion='cancelled';},f=>{f.job.status='completed';f.job.conclusion='failure';},
    f=>f.job.started_at=new Date(now+1000).toISOString(),f=>f.job.id=19]){
    const f=fixture(t);f.job.steps=[];
    const r=await discoverHostedSetup({...f.options,wait:async milliseconds=>{f.waits.push(milliseconds);f.advance(milliseconds);mutate(f);},createCollector:()=>assert.fail('no private collector')});
    assert.equal(r.status,'incomplete');assert.deepEqual(f.waits,[2000]);assert.notEqual(r.failures[0].code,'DISCOVERY_JOB_PUBLICATION_TIMEOUT');
  }
});

test('independent GitHub admission reads and publication retries never exceed two concurrent requests',async t=>{
  const f=fixture(t);f.job.steps[0].name='Admit discovery before candidate checkout';f.job.steps[0].status='queued';
  let active=0,maximum=0;
  const github={...f.github,read:async path=>{active++;maximum=Math.max(maximum,active);try{await new Promise(resolve=>setImmediate(resolve));return await f.github.read(path);}finally{active--;}}};
  const r=await discoverHostedSetup({...f.options,validateDispatchOnly:true,createGithub:()=>github,wait:async milliseconds=>{f.advance(milliseconds);f.job.steps[0].status='in_progress';}});
  assert.equal(r.status,'admitted_discovery_only');assert.equal(maximum,2);assert.equal(active,0);
});

test('poll GETs receive the remaining original deadline and transport timeout yields precise publication failure',async t=>{
  const f=fixture(t);f.job.steps=[];let timedOut=false;const timeouts=[];
  const github={...f.github,read:async(path,options)=>{
    if(options?.timeoutMs!==undefined){timeouts.push(options.timeoutMs);if(!timedOut){timedOut=true;f.advance(options.timeoutMs);}const e=new Error('PRIVATE_REQUEST_TIMEOUT');e.code='GITHUB_READ_UNAVAILABLE';throw e;}
    return f.github.read(path);
  }};
  const r=await discoverHostedSetup({...f.options,createGithub:()=>github,createCollector:()=>assert.fail('no late private collector')});
  assert.deepEqual(r.failures,[{phase:'admission',code:'DISCOVERY_JOB_PUBLICATION_TIMEOUT'}]);
  assert.deepEqual(f.waits,[2000]);assert.deepEqual(timeouts,[18000,18000]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
});

test('shared GitHub read timeout is bounded before GET; default and artifact redirect behavior stay unchanged',async()=>{
  let calls=0;const repository=releaseTargets().repository;
  const github=githubClient({token:'PRIVATE_GITHUB_FIXTURE',fetchImpl:async()=>{calls++;return Response.json({ok:true});}});
  for(const timeoutMs of [0,-1,30001,1.5,Infinity,NaN,'1000',null])await assert.rejects(github.read(`/repos/${repository}`,{timeoutMs}),{code:'GITHUB_READ_TIMEOUT_INVALID'});
  assert.equal(calls,0);await github.read(`/repos/${repository}`);await github.read(`/repos/${repository}`,{timeoutMs:1});await github.read(`/repos/${repository}`,{timeoutMs:30000});assert.equal(calls,3);
  let aborted=false;
  const bounded=githubClient({token:'PRIVATE_GITHUB_FIXTURE',fetchImpl:async(_url,options)=>new Promise((_resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('fixture timeout signal not delivered')),100);
    const abort=()=>{aborted=true;clearTimeout(timer);reject(options.signal.reason);};
    if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});
  })});
  await assert.rejects(bounded.read(`/repos/${repository}`,{timeoutMs:2}),{code:'GITHUB_READ_UNAVAILABLE'});assert.equal(aborted,true);
  const redirectCalls=[];const artifact=githubClient({token:'PRIVATE_GITHUB_FIXTURE',fetchImpl:async(url,options)=>{
    redirectCalls.push({url:String(url),headers:options.headers,signal:options.signal});
    return redirectCalls.length===1?new Response(null,{status:302,headers:{location:'https://fixture.blob.core.windows.net/only-artifact'}}):new Response('public fixture');
  }});
  assert.equal((await artifact.read(`/repos/${repository}/actions/artifacts/1/zip`,{bytes:true,timeoutMs:1000})).toString(),'public fixture');
  assert.equal(redirectCalls.length,2);assert.equal(redirectCalls[1].headers,undefined);assert.notEqual(redirectCalls[0].signal,redirectCalls[1].signal);
});

test('wrong environment, operator, ref, job, OIDC, foreign targets, release inputs and credentials fail before metadata/provider work',async t=>{
  const changes=[{GITHUB_JOB:'manifest'},{GITHUB_ACTOR:'someone'},{GITHUB_REF:'refs/heads/main'},{GITHUB_WORKFLOW_SHA:'e'.repeat(40)},
    {GITHUB_REF_PROTECTED:'false'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REPOSITORY_ID:'1'},{FCOS_HOSTED_ENVIRONMENT:'fcos-production-release'},
    {FCOS_HOSTED_SETUP_DISCOVERY_ADMITTED:'false'},{ACTIONS_ID_TOKEN_REQUEST_TOKEN:'PRIVATE_OIDC'},
    {FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_WRITER'},{FCOS_HOSTED_SALESFORCE_CLIENT_SECRET:'PRIVATE_SF'},
    {FCOS_HOSTED_COORDINATOR_URL:'https://coordinator.invalid'},{SUPABASE_SECRET_KEY:'PRIVATE_DB'},
    {FCOS_RELEASE_PLAN:'{}'},{FCOS_ADMITTED_RELEASE_SETUP:'{}'},{FCOS_RESUME_MANIFEST:'{}'}];
  for(const change of changes){const f=fixture(t);Object.assign(f.env,change);let reads=0;const r=await discoverHostedSetup({...f.options,createGithub:()=>{reads++;assert.fail('no reads');}});assert.equal(r.status,'incomplete');assert.equal(reads,0);assert.equal(r.failures.length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);}
  for(const mutate of [s=>s.targets.vercelProject='prj_foreign',s=>s.targets.supabaseProject='foreign',s=>s.candidateSha='e'.repeat(40),s=>s.notAfter=now-1,s=>s.notAfter=s.vercelReadCredential.notAfter+1,s=>s.runtimeIdentity.role='viewer',s=>s.schemaVersion=2,s=>s.previousProduction={},s=>s.epoch=1,s=>s.vercelReadCredentialAcceptance.json+=' ']){
    const f=fixture(t);mutate(f.setup);repin(f);const r=await discoverHostedSetup({...f.options,createGithub:()=>assert.fail('no metadata')});assert.equal(r.status,'incomplete');assert.equal(r.failures[0].phase,'admission');
  }
});

test('setup pin and exact legacy public contract fail before any metadata or private collection',async t=>{
  const f=fixture(t);f.env.FCOS_ADMITTED_DISCOVERY_SETUP_SHA256='0'.repeat(64);
  const result=await discoverHostedSetup({...f.options,createGithub:()=>assert.fail('no metadata')});assert.equal(result.failures[0].code,'SETUP_BINDING_CHANGED');
  for(const change of [{teamId:'team_wrong'},{projectId:'prj_wrong'},{sourceAttested:true},{sourceDigestAlgorithm:'unknown'},
    {immutableUrl:'http://foreign.invalid'},{publicVersionSha256:'invalid'},{providerEvidenceSha256:'invalid'},{capturedAt:new Date(now+60000).toISOString()}]){
    const f=fixture(t);providerFixture(f,{legacy:true});Object.assign(f.setup.legacyProductionBinding,change);repin(f);
    const r=await discoverHostedSetup({...f.options,createGithub:()=>assert.fail('no metadata')});assert.equal(r.failures[0].code,'DISCOVERY_LEGACY_BINDING_INVALID');
  }
});

test('live run/protection/workflow/job drift and source drift stop discovery without collector construction',async t=>{
  for(const mutate of [f=>f.branch.commit.sha='e'.repeat(40),f=>f.protection.allow_force_pushes.enabled=true,f=>f.run.triggering_actor.login='someone',
    f=>f.run.head_sha='e'.repeat(40),f=>f.workflow.content=Buffer.from('hostile workflow').toString('base64'),f=>f.jobs.jobs.push(clone(f.job)),
    f=>f.job.steps[0].name='Some other action',f=>f.job.started_at=new Date(now-900001).toISOString(),f=>f.job.run_id=99]){
    const f=fixture(t);mutate(f);const r=await discoverHostedSetup({...f.options,createCollector:()=>assert.fail('no provider')});assert.equal(r.status,'incomplete');assert.equal(r.failures[0].phase,'admission');
  }
  const f=fixture(t);const r=await discoverHostedSetup({...f.options,collectSource:()=>({candidate:{sha:'e'.repeat(40)},controller:{sha:f.C}}),createCollector:()=>assert.fail('no provider')});assert.equal(r.failures[0].code,'DISCOVERY_SOURCE_CHANGED');
});

test('each exact legacy binding mutation rejects, and no unbound null-ID version or alias move passes',async t=>{
  for(const mutate of [p=>p.version.commit='e'.repeat(40),p=>p.version.provenance.sourceDigest='f'.repeat(64),p=>p.version.provenance.sourceAttested=true,
    p=>p.version.deploymentId='dpl_other',p=>p.version.extra='drift',p=>p.alias.projectId='prj_foreign',p=>p.alias.deploymentId='dpl_other',
    p=>p.deployment.ownerId='team_foreign',p=>p.deployment.teamId='team_conflict',p=>p.deployment.target='preview',p=>p.project.targets.production.id='dpl_other']){
    const f=fixture(t),p=providerFixture(f,{legacy:true});mutate(p);const observer=createVercelProductionObserver({setup:f.setup,env:f.env,fetchImpl:p.fetchImpl,now:()=>now});await assert.rejects(observer.observe());
  }
  const f=fixture(t),p=providerFixture(f,{legacy:true});f.setup.legacyProductionBinding=null;
  await assert.rejects(createVercelProductionObserver({setup:f.setup,env:f.env,fetchImpl:p.fetchImpl,now:()=>now}).observe(),{code:'DISCOVERY_LEGACY_VERSION'});
  const f2=fixture(t),p2=providerFixture(f2,{legacy:true});let aliases=0;
  const fetchImpl=async(u,o)=>{if(new URL(u).pathname.startsWith('/v4/aliases/')&&++aliases===2)p2.alias.deploymentId='dpl_moved';return p2.fetchImpl(u,o);};
  await assert.rejects(createVercelProductionObserver({setup:f2.setup,env:f2.env,fetchImpl,now:()=>now}).observe());
});

test('ordinary fully bound current version needs no legacy exception; observer has no write API',async t=>{
  const f=fixture(t),p=providerFixture(f),observer=createVercelProductionObserver({setup:f.setup,env:f.env,fetchImpl:p.fetchImpl,now:()=>now});
  assert.deepEqual(Object.keys(observer).sort(),['inspect','observe']);const actual=await observer.observe();assert.equal(actual.bindingMode,'deployment_id');assert.equal(p.deployment.teamId,undefined);assert.equal(actual.deployment.teamId,p.deployment.ownerId);
  p.deployment.teamId=f.setup.targets.vercelTeam;assert.equal((await observer.observe()).deployment.teamId,p.deployment.ownerId);
  for(const method of ['createPreview','stage','promote','rollback','rollbackCompatibility','verifyRollback','create'])assert.equal(observer[method],undefined);
});

test('strict runtime deployment/source/freshness failures preserve independent schema results without leaking errors',async t=>{
  for(const change of [{deploymentId:null},{sourceDigest:'f'.repeat(64)},{sha:'e'.repeat(40)},{capturedAt:new Date(now-3600000).toISOString()}]){
    const f=fixture(t),p=providerFixture(f,{legacy:true}),db=schemaClient();Object.assign(p.runtime,change);
    const r=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login,protection:async()=>({})})});
    assert.equal(r.status,'incomplete');assert.equal(r.observations.schema.status,'observed');assert.deepEqual(r.failures,[{phase:'runtime',code:'DISCOVERY_RUNTIME_UNOBSERVED'}]);
  }
  const f=fixture(t),p=providerFixture(f),db=schemaClient({fail:true});
  const r=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login:async()=>{throw new Error('PRIVATE_BEARER_failure');},protection:async()=>({})})});
  assert.equal(r.observations.production.status,'observed');assert.deepEqual(r.failures.map(x=>x.phase).sort(),['runtime','schema']);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
});

test('runtime admitted identity and fresh provider recheck precede login; unknown runtime flags remain unknown',async t=>{
  const f=fixture(t),p=providerFixture(f);const collector=createSetupDiscoveryCollector({setup:f.setup,env:{...f.env,FCOS_HOSTED_RUNTIME_EMAIL:'other@example.invalid'},fetchImpl:p.fetchImpl,login:()=>assert.fail('no login'),protection:()=>assert.fail('no protection')});
  await assert.rejects(collector.runtime((await createVercelProductionObserver({setup:f.setup,env:f.env,fetchImpl:p.fetchImpl}).observe())),{code:'DISCOVERY_RUNTIME_IDENTITY'});
  const db=schemaClient();p.runtime.flags={};const r=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login,protection:async()=>({})})});
  assert.equal(r.status,'observed');assert.ok(Object.values(r.observations.runtime.result.flags).every(flag=>flag.state==='unknown'));
});

test('raw readonly schema digest requires original observer privileges; normal release comparison stays strict',async t=>{
  const f=fixture(t),db=schemaClient();const raw=await collectSchemaSnapshot({targets:f.setup.targets,env:f.env,Client:db.Client,now:()=>now});
  assert.equal(raw.readOnly,true);assert.equal(raw.capturedAt,new Date(now).toISOString());
  const unsafe=schemaClient({unsafe:true});await assert.rejects(collectSchemaSnapshot({targets:f.setup.targets,env:f.env,Client:unsafe.Client}),{code:'SCHEMA_OBSERVER_PRIVILEGES'});assert.equal(unsafe.calls.includes(SCHEMA_QUERY),false);
  await assert.rejects(collectSchemaObservation({manifest:{targets:f.setup.targets,migration:{expectedSchemaSha256:'0'.repeat(64)}},env:f.env,Client:db.Client}),{code:'LIVE_SCHEMA_CHANGED'});
});

test('setup horizon is rechecked during collection without renewing original observation times',async t=>{
  const f=fixture(t);let time=now;
  const result=await discoverHostedSetup({...f.options,now:()=>time,createCollector:()=>({
    production:async()=>{time=f.setup.notAfter;return {capturedAt:new Date(now).toISOString()};},schema:async()=>({sha256:H}),runtime:()=>assert.fail('expired binding cannot log in'),
  })});
  assert.equal(result.status,'incomplete');assert.ok(result.failures.every(item=>item.code==='DISCOVERY_SETUP_EXPIRED'));
  assert.equal(result.binding.originalSetupNotAfter,f.setup.notAfter);
});

test('CLI emits sanitized admission failure artifact and never a release output on wrong real context',t=>{
  const f=fixture(t),result=spawnSync(process.execPath,['scripts/hosted-release-manifest.mjs','--discover-setup'],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{PATH:process.env.PATH,...f.env,GITHUB_REF:'refs/heads/main'}});
  assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'incomplete',phase:'setup.discovery'});assert.equal(result.stderr,'');
  const artifact=JSON.parse(readFileSync(f.env.FCOS_DISCOVERY_OUTPUT));assert.deepEqual(artifact.failures,[{phase:'admission',code:'DISCOVERY_CONTEXT_INVALID'}]);assert.equal(existsSync(f.env.FCOS_RELEASE_OUTPUT),false);
  const invalid=spawnSync(process.execPath,['scripts/hosted-release-manifest.mjs','--discover-setup','--release'],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{PATH:process.env.PATH,...f.env}});
  assert.equal(invalid.status,1);assert.equal(invalid.stderr,'');assert.deepEqual(JSON.parse(readFileSync(f.env.FCOS_DISCOVERY_OUTPUT)).failures,[{phase:'arguments',code:'DISCOVERY_ARGUMENT_INVALID'}]);

});

test('bootstrap discovery is read-only, minimally credentialed, always saves disposition and never calls release',()=>{
  const yaml=createRequire(import.meta.url)('js-yaml'),workflow=yaml.load(template),job=workflow.jobs.setup_discovery;
  assert.ok(workflow.on.workflow_dispatch.inputs.bootstrap_phase.options.includes('setup-discovery'));assert.equal(job.name,'Setup discovery');assert.equal(job.environment,'fcos-hosted-verification');
  assert.deepEqual(job.permissions,{contents:'read',actions:'read'});assert.equal(job.uses,undefined);assert.equal(job.outputs,undefined);assert.equal(workflow.jobs.release.if,"${{ inputs.xero_recovery_mode == 'disabled' && inputs.bootstrap_phase == 'qualification' }}");
  assert.equal(workflow.jobs.manifest.if,"${{ inputs.xero_recovery_mode == 'disabled' && inputs.bootstrap_phase == 'qualification' && vars.FCOS_HOSTED_QUALIFICATION_ADMITTED == 'true' }}");
  assert.equal(job.if,"${{ inputs.xero_recovery_mode == 'disabled' && inputs.bootstrap_phase == 'setup-discovery' && vars.FCOS_HOSTED_SETUP_DISCOVERY_ADMITTED == 'true' }}");
  assert.doesNotMatch(JSON.stringify(job),/SALESFORCE|COORDINATOR|PRESERVATION|FCOS_HOSTED_VERCEL_TOKEN|id-token|secrets: inherit|hosted-release-controller/);
  assert.deepEqual(job.steps.filter(step=>step.env?.FCOS_HOSTED_RUNTIME_PASSWORD).map(step=>step.name),['Discover public setup baseline']);
  assert.ok(job.steps.findIndex(step=>step.name==='Admit discovery before candidate checkout')<job.steps.findIndex(step=>step.with?.path==='candidate'));
  const upload=job.steps.find(step=>step.uses?.startsWith('actions/upload-artifact@'));assert.equal(upload.if,'${{ always() }}');assert.equal(upload.with.path,'setup-discovery.json');assert.equal(upload.with.overwrite,false);
});


const legacySalesforceIdentityBinding=()=>({...legacySalesforceBinding(),kind:'fcos_legacy_salesforce_identity_read_v1',path:'/api/functions/missingNomBList'});
function admitIdentityDiscovery(f){
 f.setup.legacySalesforceIdentityObservation=legacySalesforceIdentityBinding();f.setup.legacyRuntimeAuth=legacyRuntimeAuthFixture();
 f.setup.runtimeIdentity.role='general_manager';f.setup.legacyRuntimeAuth.identity.role='general_manager';f.env.FCOS_HOSTED_RUNTIME_EXPECTED_ROLE='general_manager';
}
test('bounded legacy Salesforce identity read is separately admitted and cannot inherit the earlier schema-read binding',t=>{
 const f=fixture(t);providerFixture(f,{legacy:true,firstRuntime:true});admitIdentityDiscovery(f);
 assert.equal(validateDiscoverySetup(f.setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),f.setup);
 for(const change of [s=>s.legacySalesforceIdentityObservation.path='/api/functions/salesforceSchema',s=>s.legacySalesforceIdentityObservation.kind='fcos_legacy_salesforce_app_read_v1',
  s=>s.legacySalesforceIdentityObservation.origin='https://foreign.vercel.app',s=>s.legacySalesforceIdentityObservation.extra=true,s=>s.runtimeIdentity.role='administrator',
  s=>s.firstRuntimeBaseline=firstRuntimeFixture({now}).reference]){
  const setup=clone(f.setup);change(setup);assert.throws(()=>validateDiscoverySetup(setup,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),{code:'DISCOVERY_LEGACY_SALESFORCE_IDENTITY_BINDING_INVALID'});
 }
 const absent=clone(f.setup);delete absent.legacyRuntimeAuth;
 assert.throws(()=>validateDiscoverySetup(absent,{controllerSha:f.C,candidateSha:FROZEN_COMPATIBILITY_SHA,now}),{code:'DISCOVERY_LEGACY_RUNTIME_AUTH_INVALID'});
});
test('actual discovery routes identity-only admission to its distinct observer and reuses the completed schema action without calling it',async t=>{
 const f=fixture(t),p=providerFixture(f,{legacy:true,firstRuntime:true}),db=schemaClient();admitIdentityDiscovery(f);repin(f);let observed=0;
 const proof={kind:'fcos_legacy_salesforce_identity_read_observation_v1',status:'observed',baselineAccepted:false,qualificationAccepted:false,
  identityGuard:{state:'passed',rawOrganizationFieldsObserved:false},appOwnedAuth:{state:'authenticated',selectedMode:'unknown',orgId:null,isSandbox:null}};
 const result=await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login,protection:async()=>({}),
  verifyLegacySource:()=>({sourceAbsent:true}),observeLegacySalesforce:()=>assert.fail('a consumed schema read must not be repeated by identity-only admission'),
  observeLegacySalesforceIdentity:async args=>{observed++;assert.deepEqual(args.binding,f.setup.legacySalesforceIdentityObservation);assert.deepEqual(args.publicAuth,f.setup.legacyRuntimeAuth);
   assert.equal(typeof args.tokenProvider,'function');assert.equal(typeof args.recheckProduction,'function');assert.equal(args.bypass,'PRIVATE_BYPASS');return proof;}})});
 assert.equal(observed,1);assert.equal(result.status,'baseline_required');assert.equal(result.qualificationAccepted,false);
 assert.deepEqual(result.observations.runtime.result.legacySalesforceIdentityObservation,proof);assert.equal(result.observations.runtime.result.legacySalesforceAppObservation,undefined);
 assert.deepEqual(result.observations.runtime.result.auth,{});assert.doesNotMatch(readFileSync(f.env.FCOS_DISCOVERY_OUTPUT,'utf8'),/PRIVATE_/);
});
test('an identity observer is never invoked merely because a schema observer was admitted',async t=>{
 const f=fixture(t),p=providerFixture(f,{legacy:true,firstRuntime:true}),db=schemaClient();f.setup.legacySalesforceAppObservation=legacySalesforceBinding();f.setup.legacyRuntimeAuth=legacyRuntimeAuthFixture();repin(f);
 await discoverHostedSetup({...f.options,createCollector:options=>createSetupDiscoveryCollector({...options,fetchImpl:p.fetchImpl,Client:db.Client,login,protection:async()=>({}),verifyLegacySource:()=>({sourceAbsent:true}),
  observeLegacySalesforce:async()=>({status:'observed',baselineAccepted:false}),observeLegacySalesforceIdentity:()=>assert.fail('no new POST without exact opt-in')})});
});
