import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FIRST_RUNTIME, admittedFirstRuntimeBaseline, captureFirstRuntimeBaseline, captureFirstRuntimeOriginalOwnerRefresh,validateFirstRuntimeOwnerRefresh,firstRuntimePrevious, firstRuntimeDigest, firstRuntimeSourceAbsence } from '../scripts/lib/hosted-release/first-runtime.mjs';
import { firstRuntimeFixture,firstRuntimeOwnerRefreshFixture } from './helpers/hosted-first-runtime.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { vercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import { buildReleaseManifest,prepareReleaseManifest } from '../scripts/lib/hosted-release/manifest.mjs';
import { createPreviousProductionObserver } from '../scripts/lib/hosted-release/live-collector.mjs';
import { createVercelAdapter } from '../scripts/lib/hosted-release/vercel.mjs';
import { assertHostedSetup } from '../scripts/lib/hosted-release/admission.mjs';
import { prepareHostedManifest } from '../scripts/hosted-release-manifest.mjs';
import { digest,releaseTargets,validateManifest,NORMAL_MODULES,REQUIRED_LIVE_CHECKS,ReleaseError } from '../scripts/lib/hosted-release/contract.mjs';
import { safeFailure,consequential } from '../scripts/lib/hosted-release/controller.mjs';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';
const ROOT=fileURLToPath(new URL('..',import.meta.url)),H='a'.repeat(64);
function fixture() {
  const first=firstRuntimeFixture(),m=fixtureManifest(),read=vercelReadFixture({now:first.now,targets:m.targets});m.candidate.sourceProfile='frozen_04ee';
  m.previousProduction=firstRuntimePrevious(first.reference,{now:first.now});
  const runtime={flags:first.runtime.flags,safety:first.runtime.safety,auth:first.runtime.auth};
  m.runtime={expectedProduction:runtime,expectedSha256:digest(runtime),expectedPreview:{...runtime,safety:{...runtime.safety,readOnly:true}}};
  const setup={schemaVersion:2,controllerSha:m.controller.sha,targetsSha256:digest(releaseTargets()),epoch:m.epoch,firstRuntimeBaseline:first.reference,
    verification:{runtime:{image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},publicBuildEnvironment:{},projectSettings:{},vercelReadCredential:read.binding},vercelReadCredentialAcceptance:read.acceptance};
  const plan={...m,branch:m.candidate.branch};delete plan.previousProduction;
  const collectSource=()=>({candidate:m.candidate,controller:m.controller,checks:[{id:'unit'}]});
  const env={FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(setup),FCOS_HOSTED_VERCEL_READ_TOKEN:read.token};
  const options={plan,setup,controllerSha:m.controller.sha,candidateSha:m.candidate.sha,collectSource,now:()=>first.now};
  return {...first,m,setup,plan,read,env,options};
}
function provider(f) {
  const t=f.m.targets,id=FIRST_RUNTIME.previousDeploymentId,url=FIRST_RUNTIME.previousUrl;
  const deployment={id,url:new URL(url).hostname,projectId:t.vercelProject,ownerId:t.vercelTeam,target:'production',readyState:'READY',createdAt:f.now-86400000,meta:{githubCommitSha:FIRST_RUNTIME.previousSha}};
  const project={id:t.vercelProject,accountId:t.vercelTeam,name:'fcos',link:{type:'github',org:'hocheunglai-oss',repo:'fcos'},targets:{production:{id}}};
  const alias={alias:new URL(t.productionOrigin).hostname,projectId:t.vercelProject,deploymentId:id,deployment:{id,url:deployment.url},redirect:null,deletedAt:null};
  const calls=[],fetchImpl=async(input,options)=>{const u=new URL(input);calls.push({url:u.href,method:options.method||'GET'});assert.equal(options.method||'GET','GET');
    if(u.origin==='https://api.vercel.com') {
      if(u.pathname.startsWith('/v1/integrations/configuration/'))return Response.json(f.read.configuration);
      if(u.pathname==='/v9/projects/'+t.vercelProject)return Response.json(project);
      if(u.pathname.startsWith('/v4/aliases/'))return Response.json(alias);
      if(u.pathname==='/v13/deployments/'+id)return Response.json(deployment);
    }
    if([t.productionOrigin,url].includes(u.origin)&&u.pathname==='/app-version.json')return Response.json(f.version);
    assert.fail('No legacy runtime endpoint, login or arbitrary request is allowed: '+u.href);
  };return {fetchImpl,calls,deployment,project,alias};
}
test('only actual exact-pair typed baseline/native bytes and independent root acceptance admit first runtime',()=>{
  const f=fixture();assert.equal(admittedFirstRuntimeBaseline(f.reference).candidateSha,FIRST_RUNTIME.candidateSha);
  assert.throws(()=>admittedFirstRuntimeBaseline({helperSourceVerified:true,runtime:f.runtime}));
  assert.throws(()=>admittedFirstRuntimeBaseline({...f.reference,json:f.reference.json+' '}));
  for(const mutate of [v=>v.candidateSha='e'.repeat(40),v=>v.previous.deploymentId='dpl_other',v=>v.previous.sha='e'.repeat(40),v=>v.previous.sourceSha256='b'.repeat(64),v=>v.source.helperRevision='b'.repeat(64),v=>v.configuration.complete=false,v=>v.configuration.keys.push('bad key'),v=>v.endpointAbsence.httpStatus=302,v=>v.endpointAbsence.url='https://fcos.fcuno.com/api/connection-runtime',v=>v.endpointAbsence.sourceAbsent=false,v=>v.nativeEvidence.environmentInventorySha256='missing',v=>v.runtime.flags[Object.keys(v.runtime.flags)[0]]={state:'unknown'},v=>v.runtime.auth.salesforce.state='unknown',v=>v.runtime.auth.openai={state:'authenticated',target:'private-marker',mode:'application'}]) {
    const value=structuredClone(f.value);mutate(value);assert.throws(()=>admittedFirstRuntimeBaseline(f.referenceFor(value)));
  }
  const review=JSON.parse(f.reference.acceptance.json);review.accepted=false;const json=JSON.stringify(review);assert.throws(()=>admittedFirstRuntimeBaseline({...f.reference,acceptance:{json,sha256:firstRuntimeDigest(json)}}));
});
test('durable baseline keeps original historical clocks; consequential auth requires an independently admitted fresh owner observation',()=>{
  const f=fixture(),later=f.now+1800001,accepted=admittedFirstRuntimeBaseline(f.reference,{now:later});assert.equal(accepted.runtime.capturedAt,f.runtime.capturedAt);
  const old=firstRuntimeOwnerRefreshFixture(f),current=firstRuntimeOwnerRefreshFixture(f,{now:later});
  assert.throws(()=>validateFirstRuntimeOwnerRefresh(old.reference,{baselineReference:f.reference,expectedSha256:old.reference.sha256,now:later}),{code:'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED'});
  assert.doesNotThrow(()=>validateFirstRuntimeOwnerRefresh(current.reference,{baselineReference:f.reference,expectedSha256:current.reference.sha256,now:later}));
  for(const mutate of [v=>v.baselineSha256='b'.repeat(64),v=>v.previous.deploymentId='dpl_wrong',v=>v.configurationSha256='b'.repeat(64),v=>v.schema.sha256='b'.repeat(64),v=>v.runtime.flags[Object.keys(v.runtime.flags)[0]].value=true]){
    const value=structuredClone(current.value);mutate(value);const r=current.referenceFor(value);assert.throws(()=>validateFirstRuntimeOwnerRefresh(r,{baselineReference:f.reference,expectedSha256:r.sha256,now:later}));
  }
  const unknown=structuredClone(current.value);unknown.runtime.auth.salesforce.state='unknown';const r=current.referenceFor(unknown);
  assert.throws(()=>validateFirstRuntimeOwnerRefresh(r,{baselineReference:f.reference,expectedSha256:r.sha256,now:later}),{code:'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED'});
  assert.throws(()=>validateFirstRuntimeOwnerRefresh(current.reference,{baselineReference:f.reference,expectedSha256:'b'.repeat(64),now:later}));
});
test('source-verified capture uses complete native deployment inventory and only existing provider GET sessions',async()=>{
  const f=fixture(),calls=[],privateEnvironment={VERCEL_ENV:'production',SUPABASE_URL:`https://${f.m.targets.supabaseProject}.supabase.co`,SUPABASE_SECRET_KEY:'sb_secret_PRIVATE_FIXTURE',SALESFORCE_INSTANCE_URL:'https://fcbhk.my.salesforce.com',SALESFORCE_ACCESS_TOKEN:'PRIVATE_SF_FIXTURE',XERO_TENANT_ID:f.tenant};
  const {fcosSalesforceEnvironment}=await import('../config/fcosConnections.js');privateEnvironment.SALESFORCE_INSTANCE_URL=fcosSalesforceEnvironment('production').instanceUrl;
  const deployment={id:FIRST_RUNTIME.previousDeploymentId,sha:FIRST_RUNTIME.previousSha,url:FIRST_RUNTIME.previousUrl,target:'production',state:'READY',createdAt:f.now-86400000};
  const nativeDeployment={id:deployment.id,createdAt:deployment.createdAt,meta:{githubCommitSha:deployment.sha},url:new URL(deployment.url).hostname,projectId:f.m.targets.vercelProject,ownerId:f.m.targets.vercelTeam,target:'production',readyState:'READY',env:[...Object.keys(privateEnvironment),'VERCEL_DEPLOYMENT_KEY']};
  const nativeEnvironment={envs:Object.entries(privateEnvironment).filter(([key])=>key!=='VERCEL_ENV').map(([key,value])=>({id:key,key,value,target:['production'],createdAt:f.now-90000000,updatedAt:f.now-90000000,gitBranch:null}))};
  const args={controllerDirectory:ROOT,privateEnvironment,deployment,nativeDeployment,nativeEnvironment,configuration:{reader:f.value.configuration.reader,capturedAt:f.value.configuration.capturedAt},schema:f.value.schema,endpointAbsence:Object.fromEntries(Object.entries(f.value.endpointAbsence).filter(([k])=>k!=='sourceAbsent')),
    nativeEvidence:{...f.value.nativeEvidence,deploymentSha256:digest(nativeDeployment)},now:f.now,fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return Response.json(url==='https://api.xero.com/connections'?[{tenantId:f.tenant,tenantType:'ORGANISATION'}]:String(url).includes('/services/data/')?{records:[{Id:fcosSalesforceEnvironment('production').orgId,IsSandbox:false}]}:[]);},
    clientFactory:(_url,_key,options)=>{assert.equal(options.auth.autoRefreshToken,false);return {from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{tenant_id:f.tenant,access_token:'PRIVATE_XERO_FIXTURE',expires_at:new Date(f.now+300000).toISOString()}})})})})};}};
  const value=await captureFirstRuntimeBaseline(args);assert.equal(calls.length,3);assert.equal(value.runtime.auth.salesforce.state,'authenticated');assert.doesNotMatch(JSON.stringify(value),/PRIVATE_/);assert.equal(value.previous.sourceSha256,FIRST_RUNTIME.sourceSha256);
  assert.deepEqual(value.configuration.unobservedKeys,['VERCEL_DEPLOYMENT_KEY']);assert.ok(value.configuration.absentDependencies.includes('FCOS_ENABLE_READ_ONLY_CI'));
  const before=calls.length;await assert.rejects(captureFirstRuntimeBaseline({...args,privateEnvironment:{VERCEL_ENV:'production'}}),{code:'FIRST_RUNTIME_CONFIGURATION_INCOMPLETE'});assert.equal(calls.length,before);
  await assert.rejects(captureFirstRuntimeBaseline({...args,nativeDeployment:{...nativeDeployment,projectId:'wrong'}}),{code:'FIRST_RUNTIME_DEPLOYMENT_INVENTORY_REQUIRED'});assert.equal(calls.length,before);
  for(const mutate of [a=>{a.nativeEnvironment.envs[0].updatedAt=f.now;},a=>{a.nativeEnvironment.pagination={next:1};},a=>{a.nativeEnvironment.envs[0].gitBranch='main';},a=>{a.privateEnvironment.SALESFORCE_ACCESS_TOKEN='fabricated';}]){const a=structuredClone(Object.fromEntries(Object.entries(args).filter(([k])=>!['fetchImpl','clientFactory'].includes(k))));mutate(a);await assert.rejects(captureFirstRuntimeBaseline({...args,...a}));assert.equal(calls.length,before);}
  const missing={...args,nativeDeployment:{...nativeDeployment,env:[...nativeDeployment.env,'FCOS_ENABLE_READ_ONLY_CI']}};missing.nativeEvidence={...args.nativeEvidence,deploymentSha256:digest(missing.nativeDeployment)};
  await assert.rejects(captureFirstRuntimeBaseline(missing),{code:'FIRST_RUNTIME_CONFIGURATION_INCOMPLETE'});assert.equal(calls.length,before);
  for(const opaque of ['',null,'********','[redacted]']) {
    const nativeEnvironment=structuredClone(args.nativeEnvironment),privateEnvironment={...args.privateEnvironment};nativeEnvironment.envs.find(r=>r.key==='SUPABASE_SECRET_KEY').value=opaque;
    if(typeof opaque==='string')privateEnvironment.SUPABASE_SECRET_KEY=opaque;else delete privateEnvironment.SUPABASE_SECRET_KEY;
    await assert.rejects(captureFirstRuntimeBaseline({...args,nativeEnvironment,privateEnvironment}),{code:'FIRST_RUNTIME_CONFIGURATION_INCOMPLETE'});assert.equal(calls.length,before);
  }
  const captured={...f,value,reference:f.referenceFor(value)},refresh=await captureFirstRuntimeOriginalOwnerRefresh({...args,baselineReference:captured.reference,identityCapturedAt:new Date(f.now).toISOString()});
  assert.equal(refresh.baselineSha256,captured.reference.sha256);assert.equal(calls.length,before+3);assert.doesNotMatch(JSON.stringify(refresh),/PRIVATE_/);
  const denied=await captureFirstRuntimeBaseline({...args,fetchImpl:async()=>new Response(null,{status:401})});assert.equal(denied.runtime.auth.salesforce.state,'unknown');assert.throws(()=>admittedFirstRuntimeBaseline(f.referenceFor(denied)),{code:'FIRST_RUNTIME_BASELINE_INCOMPLETE'});
});
test('manifest preparation observes real legacy baseline before complete validation without a prior hash seed',async()=>{
  const f=fixture(),p=provider(f);let observed=0;
  const manifest=await prepareReleaseManifest({...f.options,observePreviousProduction:async context=>{observed++;assert.equal(context.previousProduction,undefined);return createPreviousProductionObserver({context,setup:f.setup,env:f.env,fetchImpl:p.fetchImpl,now:()=>f.now,schemaObservation:async()=>({sha256:H}),login:()=>assert.fail('no login'),protection:()=>assert.fail('no protection')}).observePreviousProduction();}});
  assert.equal(observed,1);assert.equal(manifest.previousProduction.runtimeSha256,digest(f.plan.runtime.expectedProduction));assert.equal(manifest.previousProduction.firstRuntime.rollbackEligible,false);
  assert.deepEqual(manifest.scope.handoffs,[]);assert.equal(NORMAL_MODULES.length,15);assert.ok(REQUIRED_LIVE_CHECKS.every(k=>manifest.requiredChecks.includes(k)));assert.ok(p.calls.length>0);
  assert.doesNotThrow(()=>validateManifest(manifest));
  const setupEnv={...f.env};manifest.setupSha256=digest(f.setup);assert.doesNotThrow(()=>assertHostedSetup({setup:f.setup,manifest,env:setupEnv}));
});
test('baseline does not authorize normal/application weakening, another candidate, runtime expectations or rollback',async()=>{
  const f=fixture(),prior=firstRuntimePrevious(f.reference),manifest=buildReleaseManifest({...f.options,previousProduction:prior});
  for(const mutate of [m=>m.stage='application',m=>m.candidate.sha='e'.repeat(40),m=>m.candidate.sourceProfile='application_v2',m=>m.previousProduction.firstRuntime.rollbackEligible=true,m=>m.previousProduction.firstRuntime.previousUrl='https://foreign.vercel.app']){const value=structuredClone(manifest);mutate(value);assert.throws(()=>validateManifest(value));}
  assert.throws(()=>buildReleaseManifest({...f.options,plan:{...f.plan,runtime:{...f.plan.runtime,expectedProduction:{madeUp:true},expectedSha256:digest({madeUp:true})}},previousProduction:prior}));
  const env={...f.env,FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_WRITER',FCOS_HOSTED_VERCEL_TOKEN_ID:'id'};const adapter=createVercelAdapter({manifest,candidateDirectory:ROOT,env,fetchImpl:()=>assert.fail('no legacy probe'),schemaObservation:()=>assert.fail('no legacy rollback schema probe')});
  const result=await adapter.rollbackCompatibility(prior,manifest);assert.equal(result.compatible,false);assert.equal(result.reason,'legacy_runtime_compatibility_unobserved');
});
test('actual writer admission waits before credentials or provider calls when original-owner observations are missing or expired',async()=>{
  const f=fixture(),manifest=buildReleaseManifest({...f.options,previousProduction:firstRuntimePrevious(f.reference)}),env={...f.env,
    GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:manifest.targets.repository,GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:'refs/heads/main',GITHUB_REF_PROTECTED:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'17',FCOS_CONTROLLER_SHA:manifest.controller.sha,
    FCOS_HOSTED_CREDENTIAL_CLASS:'production',FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_WRITER',FCOS_HOSTED_VERCEL_TOKEN_ID:'id'};
  const adapter=createVercelAdapter({manifest,candidateDirectory:ROOT,env,now:()=>f.now+1800001,execute:()=>assert.fail('no CLI or submit'),fetchImpl:()=>assert.fail('no provider')});
  for(const phase of ['production','production.promote']){
    let error;try{await adapter.admit(manifest,phase);}catch(e){error=e;}assert.equal(error.code,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');assert.equal(safeFailure(error).status,'waiting_dependency');
  }
  const old=firstRuntimeOwnerRefreshFixture(f);env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH=JSON.stringify(old.reference);env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256=old.reference.sha256;
  await assert.rejects(adapter.admit(manifest,'production'),{code:'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED'});
  env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256='b'.repeat(64);
  await assert.rejects(adapter.admit(manifest,'production'),{code:'FIRST_RUNTIME_OWNER_REFRESH_INVALID'});
  assert.equal(safeFailure(new ReleaseError('FIRST_RUNTIME_OWNER_REFRESH_INVALID')).status,'intervention_required');
});
test('actual adapter rechecks owner freshness at the final staging/promotion CLI boundary and retains consumed intents',async t=>{
  const f=fixture(),directory=mkdtempSync(join(tmpdir(),'first-runtime-late-expiry-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  // Offline native checkout of the actual candidate, with no credential-bearing
  // environment, shared source edits, provider access or mocked provenance.
  const gitEnv={PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
  const git=args=>execFileSync('git',args,{cwd:directory,env:gitEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['-c','core.hooksPath=/dev/null','clone','--shared','--no-checkout','--quiet',ROOT,directory]);
  git(['-c','core.hooksPath=/dev/null','checkout','--detach','--quiet',FIRST_RUNTIME.candidateSha]);
  const source=collectBuildProvenance({cwd:directory,env:{},requireClean:true});assert.equal(source.commit,FIRST_RUNTIME.candidateSha);
  f.m.candidate.sourceSha256=source.sourceDigest;f.m.candidate.lockSha256=digest(readFileSync(join(directory,'package-lock.json')));
  const settings={framework:'vite',buildCommand:'npm run build',devCommand:null,installCommand:'npm ci',outputDirectory:'dist',rootDirectory:null,nodeVersion:'24.x'};
  f.setup.verification.projectSettings=settings;const manifest=buildReleaseManifest({...f.options,previousProduction:firstRuntimePrevious(f.reference)}),target=manifest.targets;
  const original=firstRuntimeOwnerRefreshFixture(f).reference,env={...f.env,FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(f.setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(f.setup),
    GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:target.repository,GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:'refs/heads/main',GITHUB_REF_PROTECTED:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'17',FCOS_CONTROLLER_SHA:manifest.controller.sha,
    FCOS_HOSTED_CREDENTIAL_CLASS:'production',FCOS_HOSTED_VERCEL_TOKEN:'PRIVATE_WRITER',FCOS_HOSTED_VERCEL_TOKEN_ID:'id',FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH:JSON.stringify(original),FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256:original.sha256};
  let current=f.now,expireDuringAdmission=false;const writes=[],reads=[];
  const project={id:target.vercelProject,accountId:target.vercelTeam,name:'fcos',link:{type:'github',org:'hocheunglai-oss',repo:'fcos',productionBranch:'main',deployHooks:[]},autoAssignCustomDomains:false,...settings};
  const adapter=createVercelAdapter({manifest,candidateDirectory:directory,env,now:()=>current,
    execute:(_command,args)=>{if(args[0]==='--version')return 'Vercel CLI 54.20.1';writes.push(args[0]);return args[0]==='deploy'?'https://fcos-late12345-hocheunglai-6535s-projects.vercel.app':'promoted';},
    fetchImpl:async(url,options)=>{assert.equal(options.method,'GET');reads.push(url.pathname);
      if(url.pathname===`/v9/projects/${target.vercelProject}`)return Response.json(project);
      if(url.pathname==='/v5/user/tokens/current')return Response.json({token:{id:'id',expiresAt:f.now+86400000,scopes:[{type:'team',teamId:target.vercelTeam}]}});
      if(url.pathname==='/v9/projects')return Response.json({projects:[{id:target.vercelProject}],pagination:{count:1,next:null}});
      if(url.pathname==='/v2/user')return new Response(null,{status:403});
      if(url.pathname===`/v2/teams/${target.vercelTeam}`){if(expireDuringAdmission)current=f.now+1800001;return new Response(null,{status:403});}
      if(url.pathname==='/v13/deployments/fcos-late12345-hocheunglai-6535s-projects.vercel.app')return Response.json({id:'dpl_latefixture',url:'fcos-late12345-hocheunglai-6535s-projects.vercel.app',projectId:target.vercelProject,teamId:target.vercelTeam,target:'production',readyState:'READY',meta:{githubCommitSha:manifest.candidate.sha}});
      assert.fail('Unexpected fixture GET '+url.pathname);
    }});
  const context={operationId:`${manifest.releaseId}-production-stage`};
  expireDuringAdmission=true;let error;try{await adapter.stage(manifest,context);}catch(e){error=e;}
  assert.equal(error.code,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');assert.equal(safeFailure(error).status,'waiting_dependency');assert.equal(error.detail.providerSubmissionStarted,false);
  assert.equal(reads.at(-1),`/v2/teams/${target.vercelTeam}`);assert.deepEqual(writes,[]);
  current=f.now;expireDuringAdmission=false;await adapter.admit(manifest,'production.promote');
  // Simulates schema/acceptance/coordinator.begin awaiting after admission.
  current=f.now+1800001;await assert.rejects(adapter.promote({id:'dpl_latefixture'}),{code:'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED'});assert.deepEqual(writes,[]);
  current=f.now;await adapter.stage(manifest,context);await adapter.promote({id:'dpl_latefixture'});assert.deepEqual(writes,['deploy','promote']);writes.length=0;
  current=f.now+1800001;const state={consumed:false},journal=[];
  const coordinator={begin:async()=>{if(state.consumed)return {disposition:'readback'};state.consumed=true;journal.push('intent');return {disposition:'execute'};},
    uncertain:async row=>{state.reason=row.reason;journal.push('uncertain');}};
  const operation={manifest,coordinator,phase:'production.promote',request:{deploymentId:'dpl_latefixture'},submit:()=>adapter.promote({id:'dpl_latefixture'}),readback:async()=>{journal.push('GET-only');return {outcome:'unknown'};}};
  try{await consequential(operation);}catch(e){error=e;}assert.equal(safeFailure(error).status,'waiting_dependency');assert.match(error.recovery,/already-recorded intent remains consumed and GET-only/);
  assert.equal(state.reason,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED_BEFORE_SUBMISSION');assert.deepEqual(journal,['intent','uncertain']);assert.deepEqual(writes,[]);
  const fresh=firstRuntimeOwnerRefreshFixture(f,{now:current}).reference;env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH=JSON.stringify(fresh);env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256=fresh.sha256;
  await assert.rejects(consequential(operation),{code:'PROVIDER_OUTCOME_UNKNOWN'});assert.deepEqual(journal,['intent','uncertain','GET-only']);assert.equal(state.consumed,true);assert.deepEqual(writes,[]);
});
test('actual hosted manifest entrypoint consumes baseline through seedless read-only transport and never leaks provider credentials',async t=>{
  const f=fixture(),directory=mkdtempSync(join(tmpdir(),'first-runtime-entry-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'candidate'));
  const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(['init','-q']);writeFileSync(join(directory,'README'),'controller');git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','controller']);const C=git(['rev-parse','HEAD']);
  f.setup.controllerSha=C;f.m.controller.sha=C;f.options.controllerSha=C;
  const env={...f.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:f.m.targets.repository,GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:'refs/heads/main',GITHUB_REF_PROTECTED:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'17',FCOS_CONTROLLER_SHA:C,FCOS_CANDIDATE_SHA:FIRST_RUNTIME.candidateSha,FCOS_CONTROLLER_DIRECTORY:directory,FCOS_CANDIDATE_DIRECTORY:join(directory,'candidate'),FCOS_RELEASE_PLAN:JSON.stringify(f.plan),FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(f.setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(f.setup),FCOS_RELEASE_OUTPUT:join(directory,'manifest.json'),GITHUB_OUTPUT:join(directory,'workflow-output')};
  const p=provider(f);const manifest=await prepareHostedManifest({env,prepareManifest:options=>prepareReleaseManifest({...options,collectSource:f.options.collectSource,now:()=>f.now}),createPreviousObserver:options=>createPreviousProductionObserver({...options,fetchImpl:p.fetchImpl,now:()=>f.now,schemaObservation:async()=>({sha256:H}),login:()=>assert.fail('no login')})});
  assert.equal(manifest.previousProduction.firstRuntime.rollbackEligible,false);assert.doesNotMatch(readFileSync(env.FCOS_RELEASE_OUTPUT,'utf8'),/PRIVATE_|access_token/);assert.ok(!readFileSync(env.FCOS_RELEASE_OUTPUT,'utf8').includes(f.read.token));assert.equal(manifest.previousProduction.deploymentId,FIRST_RUNTIME.previousDeploymentId);
});
test('immutable source capability proves endpoint absent only on exact legacy tree',()=>{const proof=firstRuntimeSourceAbsence(ROOT);assert.equal(proof.sourceAbsent,true);assert.equal(proof.candidateSha,FIRST_RUNTIME.candidateSha);});
