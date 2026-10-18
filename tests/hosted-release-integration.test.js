import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { buildReleaseManifest, prepareReleaseManifest } from '../scripts/lib/hosted-release/manifest.mjs';
import { candidateContainerArguments } from '../scripts/lib/hosted-release/isolation.mjs';
import { checkBinding, sanitisedCheckEnvironment } from '../scripts/lib/hosted-release/checks.mjs';
import { validateDeterministicReport } from '../scripts/lib/hosted-release/artifacts.mjs';
import { publishChecks } from '../scripts/lib/hosted-release/publisher.mjs';
import { digest, releaseTargets, NORMAL_MODULES, validateManifest } from '../scripts/lib/hosted-release/contract.mjs';
import { releaseTiming, releaseNotification, assertNotificationDeliveryReceipt } from '../scripts/lib/hosted-release/telemetry.mjs';
import { assertProjectConfiguration, deploymentArguments } from '../scripts/lib/hosted-release/vercel.mjs';
import { collectRuntimeProtectionState } from '../scripts/lib/hosted-release/live-collector.mjs';
import { collectCompatibilitySuccessor } from '../scripts/lib/hosted-release/successor.mjs';
import { verificationPlan } from '../scripts/hosted-release.mjs';
import { hostedProof } from '../scripts/lib/hosted-release/observations.mjs';

const H='a'.repeat(64), image=`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`;
test('hosted public publishable-key alias preserves controller credential isolation', () => {
  const values = { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public_fixture' };
  const f = setupFixture();
  f.setup.verification.publicBuildEnvironment = values;
  const manifest = buildReleaseManifest({ ...f, previousProduction: f.setup.previousProduction });
  assert.doesNotThrow(() => validateManifest(manifest));
  const options = { home: '/tmp/check-home', candidateDirectory: '/tmp/candidate', command: { env: {} },
    environment: { FCOS_HOSTED_PUBLIC_BUILD_INPUTS: JSON.stringify(values), VERCEL_TOKEN: 'controller-only', SUPABASE_SECRET_KEY: 'controller-only' } };
  options.environment.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH='PRIVATE_OWNER_OBSERVATION';
  options.environment.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256='PRIVATE_OWNER_DIGEST';
  const env = sanitisedCheckEnvironment(options);
  assert.equal(env.VITE_SUPABASE_PUBLISHABLE_KEY, values.VITE_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(env.VERCEL_TOKEN, undefined);
  assert.equal(env.SUPABASE_SECRET_KEY, undefined);
  assert.equal(env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH,undefined);assert.equal(env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256,undefined);
  assert.throws(() => sanitisedCheckEnvironment({ ...options, environment: { FCOS_HOSTED_PUBLIC_BUILD_INPUTS: JSON.stringify({ SUPABASE_SECRET_KEY: 'private' }) } }), /Unadmitted public build inputs/);
});
function setupFixture() {
  const m=fixtureManifest();
  const setup={schemaVersion:2,controllerSha:m.controller.sha,targetsSha256:digest(releaseTargets()),epoch:2,previousProduction:m.previousProduction,
    verification:{runtime:{image,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},publicBuildEnvironment:{},projectSettings:{}}};
  const plan={...m,schemaVersion:2,branch:m.candidate.branch};
  const collectSource=()=>({candidate:{...m.candidate,sourceProfile:'frozen_04ee'},controller:m.controller,checks:[{id:'unit'}]});
  return{plan,setup,controllerSha:m.controller.sha,candidateSha:m.candidate.sha,collectSource};
}
test('manifest preparation computes required checks and binds actual observed Production without altering scope',async()=>{
  const f=setupFixture(), now=Date.parse('2026-10-17T04:00:00Z');
  const actual={...f.setup.previousProduction,deploymentId:'dpl_actual'};
  const m=await prepareReleaseManifest({...f,now:()=>now,observePreviousProduction:async()=>({readOnly:true,capturedAt:new Date(now).toISOString(),previousProduction:actual})});
  assert.equal(m.previousProduction.deploymentId,'dpl_actual');assert.ok(m.requiredChecks.includes('unit'));
  assert.equal(m.authorization.validitySeconds,86400);assert.deepEqual(m.scope.handoffs,[]);
  await assert.rejects(prepareReleaseManifest({...f,now:()=>now,observePreviousProduction:async()=>({readOnly:true,capturedAt:new Date(now-300001).toISOString(),previousProduction:actual})}),{code:'PRODUCTION_OBSERVATION_EXPIRED'});
  assert.throws(()=>buildReleaseManifest({...f,setup:{...f.setup,controllerSha:'f'.repeat(40)},previousProduction:actual}),{code:'RELEASE_SETUP_NOT_ADMITTED'});
});
test('candidate process cannot inherit controller secrets or mount its files writable',t=>{
  const root=mkdtempSync(join(tmpdir(),'fcos-isolation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const candidateDirectory=join(root,'candidate'),controllerDirectory=join(root,'controller');mkdirSync(candidateDirectory);mkdirSync(controllerDirectory);
  const options={image,candidateDirectory,controllerDirectory,program:'node',args:['/candidate/test.js'],env:{CI:'true'}};
  const args=candidateContainerArguments(options);
  assert.ok(args.includes(`type=bind,src=${realpathSync(controllerDirectory)},dst=/controller,readonly`));
  assert.ok(args.includes(`type=bind,src=${realpathSync(candidateDirectory)},dst=/candidate`));
  assert.equal(args[args.indexOf('--tmpfs')+1], '/tmp:rw,nosuid,nodev,exec,size=1g');
  assert.ok(args.includes('--read-only'));assert.ok(args.includes('--security-opt=no-new-privileges'));assert.ok(!args.join(' ').includes('docker.sock'));
  for(const key of ['GITHUB_TOKEN','ACTIONS_ID_TOKEN_REQUEST_TOKEN','VERCEL_TOKEN','DATABASE_PASSWORD','NODE_OPTIONS'])assert.throws(()=>candidateContainerArguments({...options,env:{[key]:'private'}}),{code:'CANDIDATE_CREDENTIAL_ENVIRONMENT'});
  assert.throws(()=>candidateContainerArguments({...options,image:image.replace(`@sha256:${H}`,':latest')}),{code:'CANDIDATE_IMAGE_NOT_ADMITTED'});
});
function rawFixture(t){
  const root=mkdtempSync(join(tmpdir(),'fcos-publisher-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const f=setupFixture(),manifest=buildReleaseManifest({...f,previousProduction:f.setup.previousProduction});
  const source={values:[['package-lock.json',H]],candidateDirectory:root};
  const command={program:'node',args:['--test','tests/a.test.js'],env:{}};
  const checks=['unit','build'].map(id=>({id,kind:'deterministic',phase:'deterministic',group:'code',inputs:['@source'],commands:[command]}));
  const common={runtime:manifest.verification.runtime,installedLockSha256:H,buildConfigurationSha256:digest(manifest.verification),candidateSha:manifest.candidate.sha};
  const rows=checks.map(c=>({schemaVersion:2,checkId:c.id,binding:checkBinding(c,common,source),status:'passed',startedAt:new Date(Date.now()-2000).toISOString(),completedAt:new Date(Date.now()-1000).toISOString(),commands:[{program:'node',args:command.args,exitCode:0}]}));
  return{manifest,admission:{source,binding:{candidateSha:manifest.candidate.sha},checks},group:'code',report:{schemaVersion:2,kind:'fcos_hosted_release_checks',status:'passed',...common,checks:rows}};
}
test('partial deterministic report publishes genuine successes and keeps failed/pending checks incomplete',t=>{
  const f=rawFixture(t);f.report.status='failed';f.report.checks[1].status='failed';
  assert.deepEqual(validateDeterministicReport(f).map(x=>x.id),['unit']);
  f.report.status='waiting_dependency';f.report.checks[1].status='waiting_dependency';
  assert.deepEqual(validateDeterministicReport(f).map(x=>x.id),['unit']);
  f.report.checks[0].commands[0].exitCode=1;assert.throws(()=>validateDeterministicReport(f),{code:'DETERMINISTIC_EVIDENCE_INVALID'});
});
test('publisher requires actual matching controller/job/archive and cannot republish stale normal proof as historical',async()=>{
  const m=fixtureManifest(),start='2026-10-17T04:00:00Z',end='2026-10-17T04:01:00Z';
  const run={id:1,run_attempt:1,repository:{full_name:m.targets.repository},head_repository:{full_name:m.targets.repository},head_branch:'main',head_sha:m.controller.sha,event:'workflow_dispatch',referenced_workflows:[{path:`${m.targets.repository}/${m.controller.workflow}@${m.controller.sha}`,sha:m.controller.sha}]};
  const job={id:2,run_id:1,run_attempt:1,head_sha:run.head_sha,name:'release / checks / code',status:'completed',conclusion:'success',started_at:start,completed_at:end,steps:[{name:'Run admitted checks',status:'completed',conclusion:'success'}]};
  const artifact={id:3,expired:false,workflow_run:{id:1,head_sha:run.head_sha},digest:`sha256:${H}`,archiveSha256:H,created_at:end};
  const check={id:'normal_role',kind:'volatile',status:'passed',inputsSha256:H,completedAt:'2026-10-10T00:00:00Z',result:{}};
  const options={manifest:m,run,job,artifact,expectedJobName:job.name,coordinator:{appendEvidence:async()=>assert.fail('should not publish')},validateReport:()=>[check],validateHistoricalCheck:async()=>true};
  await assert.rejects(publishChecks(options),{code:'CHECK_REPORT_INVALID'});
  await assert.rejects(publishChecks({...options,artifact:{...artifact,archiveSha256:'b'.repeat(64)}}),{code:'PRODUCER_ARTIFACT_BINDING'});
});
test('workflow isolates candidate jobs and has exactly one Production reviewer boundary',()=>{
  const require=createRequire(import.meta.url),yaml=require('js-yaml');
  const w=yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml',import.meta.url),'utf8'));
  const jobs=w.jobs,check=jobs.checks;
  assert.equal(check.environment,undefined);assert.equal(check.permissions['id-token'],undefined);
  assert.doesNotMatch(JSON.stringify(check),/secrets\./);assert.equal(jobs.production.environment.name,'fcos-production-release');
  assert.equal(Object.values(jobs).filter(j=>j.environment==='fcos-production-release'||j.environment?.name==='fcos-production-release').length,1);
  assert.ok(jobs.preview.needs.includes('reconcile'));assert.match(jobs.reconcile.steps.find(s=>s.id==='run').run,/reconcile$/);
  assert.match(jobs.observe_after.if,/always\(\)/);assert.match(jobs.browser_after.if,/always\(\)/);
  for(const j of Object.values(jobs))for(const step of j.steps||[])if(step.uses)assert.match(step.uses,/@[a-f0-9]{40}$/);
  assert.ok(!JSON.stringify(w).includes('keychain'));assert.equal(w.concurrency['cancel-in-progress'],false);
  assert.equal(jobs.dependencies_before.permissions['id-token'],undefined);
  assert.ok(jobs.publish_after.needs.includes('dependencies_after'));
  assert.doesNotMatch(JSON.stringify(jobs.dependencies_before),/secrets\.FCOS_HOSTED_VERCEL|secrets\.FCOS_HOSTED_RUNTIME/);
  const ownerSteps=Object.entries(jobs).flatMap(([jobId,j])=>(j.steps||[]).filter(s=>s.env?.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH).map(s=>[jobId,s]));
  assert.equal(ownerSteps.length,1);assert.equal(ownerSteps[0][0],'execute');assert.match(ownerSteps[0][1].env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH,/vars\.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH/);
});
test('deployment binds remote build settings and public build values to deterministic verification',()=>{
  const settings={framework:'vite',buildCommand:'npm run build',devCommand:null,installCommand:'npm ci',outputDirectory:'dist',rootDirectory:null,nodeVersion:'24.x'};
  assert.equal(assertProjectConfiguration(settings,{...settings}),true);
  for(const key of Object.keys(settings))assert.throws(()=>assertProjectConfiguration({...settings,[key]:'changed'},settings),{code:'VERCEL_BUILD_CONFIGURATION_CHANGED'});
  assert.throws(()=>assertProjectConfiguration(settings,{}),{code:'VERCEL_BUILD_CONFIGURATION_CHANGED'});
  const manifest=fixtureManifest();manifest.verification={...setupFixture().setup.verification,projectSettings:settings,publicBuildEnvironment:{VITE_FCOS_ENABLE_FCUNO_OIDC:'true'}};
  const args=deploymentArguments(manifest,`${manifest.releaseId}-production-stage`,true);
  assert.ok(args.includes('--skip-domain'));assert.ok(args.includes('VITE_FCOS_ENABLE_FCUNO_OIDC=true'));
  assert.ok(args.includes(`fcosVerificationSha256=${digest(manifest.verification)}`));
});
test('runtime protection uses the actual host-cookie helper without a private file',async()=>{
  const origin='https://fcos-observed1-hocheunglai-6535s-projects.vercel.app',sha='a'.repeat(40);let disposed=false;
  const cookie={name:'_vercel_jwt',domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:Date.now()/1000+600,value:'synthetic'};
  const requestImpl={newContext:async()=>({get:async(url,options)=>{
    assert.equal(url,`${origin}/app-version.json`);assert.equal(options.maxRedirects,0);
    assert.equal(options.headers['x-vercel-protection-bypass'],'synthetic');
    return{url:()=>url,status:()=>307,headers:()=>({location:'/app-version.json'})};
  },storageState:async()=>({cookies:[cookie],origins:[]}),dispose:async()=>{disposed=true;}})};
  const state=await collectRuntimeProtectionState({origin,sha,bypass:'synthetic',requestImpl});
  assert.deepEqual(state,{cookies:[cookie],origins:[]});assert.equal(disposed,true);
});
test('telemetry separates queue, parallel compute and observed approval waiting without inventing phone delivery',()=>{
  const timing=releaseTiming({run:{id:1,created_at:'2026-10-17T00:00:00Z',run_started_at:'2026-10-17T00:00:10Z'},jobs:[{status:'completed',started_at:'2026-10-17T00:00:10Z',completed_at:'2026-10-17T00:02:10Z'},{status:'completed',started_at:'2026-10-17T00:00:10Z',completed_at:'2026-10-17T00:01:10Z'}],approval:{approvedAt:'2026-10-17T01:00:00Z'},prerequisiteCompletedAt:'2026-10-17T00:02:10Z'});
  assert.equal(timing.computeSeconds,180);assert.equal(timing.initialQueueSeconds,10);assert.equal(timing.approvalWaitSeconds,3470);assert.equal(timing.wallSeconds,130);
  assert.equal(releaseNotification({manifest:fixtureManifest(),status:'waiting_dependency',runId:1}),null);
  const event=releaseNotification({manifest:fixtureManifest(),status:'complete',runId:1});assert.equal(event.delivery.iphoneReceiptVerified,false);
  assert.throws(()=>assertNotificationDeliveryReceipt({receipt:{},challenge:'abc',repository:'hocheunglai-oss/fcos',operator:'hocheunglai-oss'}),{code:'IPHONE_DELIVERY_NOT_VERIFIED'});
});
test('final application consumes only the completed frozen compatibility Production observation',async()=>{
  const prior=fixtureManifest(), observation={capturedAt:'2026-10-17T00:00:00Z',result:{id:'dpl_compatible',sha:prior.candidate.sha}};
  const manifest={...prior,stage:'application',previousProduction:{...prior.previousProduction,deploymentId:observation.result.id,sha:prior.candidate.sha},
    scope:{...prior.scope,compatibilityRelease:{releaseId:prior.releaseId,manifestHash:digest(prior)},compatibilityProductionObservationSha256:digest(observation)}};
  const snapshot={status:'complete',finished:true,registration:{manifest:prior},checks:{'production.live_verified':{evidence:observation}}};
  const args={manifest,coordinator:{snapshot:async ref=>{assert.deepEqual(ref,manifest.scope.compatibilityRelease);return snapshot;}},env:{GITHUB_RUN_ID:'1',FCOS_VERIFIED_JOB_ID:'2'}};
  const proof=await collectCompatibilitySuccessor(args);assert.equal(proof.result.originalCapturedAt,observation.capturedAt);
  assert.equal(proof.result.financialAuthority,false);
  snapshot.status='rolled_back';await assert.rejects(collectCompatibilitySuccessor(args),{code:'COMPATIBILITY_PRODUCTION_NOT_ACCEPTED'});
  snapshot.status='complete';observation.result.id='dpl_foreign';await assert.rejects(collectCompatibilitySuccessor(args),{code:'COMPATIBILITY_PRODUCTION_NOT_ACCEPTED'});
});
test('fresh accepted browser and dependency stages are skipped without renewing their timestamps',()=>{
  const manifest=fixtureManifest(), capturedAt=new Date(Date.now()-1000).toISOString(), checks={};
  for(const id of ['restricted_browser','normal_role','nom_b','preservation']) {
    const result=id==='normal_role'?{unexpectedWrites:0,modules:[...NORMAL_MODULES],actualData:true}:id==='restricted_browser'?{unexpectedWrites:0,identity:'restricted'}:{};
    checks[id]=hostedProof({manifest,checkId:id,result,inputs:{id},capturedAt,kind:id==='nom_b'?'deterministic':'volatile',env:{GITHUB_RUN_ID:'1',FCOS_VERIFIED_JOB_ID:'2'}});
  }
  assert.deepEqual(verificationPlan({checks},manifest),{browser_matrix:'{"mode":[]}',has_browsers:'false',dependencies_required:'false'});
  assert.equal(checks.normal_role.capturedAt,capturedAt);
  checks.normal_role.capturedAt=new Date(Date.now()-1801000).toISOString();
  assert.equal(verificationPlan({checks},manifest).browser_matrix,'{"mode":["normal_role"]}');
});
