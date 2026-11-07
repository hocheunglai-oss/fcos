import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactDigest, assertBuildArtifact, credentialFreeBuildEnvironment } from '../scripts/lib/rapid-release/build.mjs';
import { createManifest, digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { githubClient, verifyExecution, nativeApproval, vercelProvider, assertNativeQualityProducer, assertFrozenWorkflow } from '../scripts/lib/rapid-release/providers.mjs';
const h = 'b'.repeat(64), sha = 'a'.repeat(40);
function manifest() { return createManifest({candidate:{sha,sourceDigest:h,lockDigest:h},controllerSha:'c'.repeat(40),
 previous:{deploymentId:'dpl_old',sha:'d'.repeat(40),schemaDigest:h,configurationDigest:h},paths:['src/components/dashboard/Table.jsx'],
 publicEnvironment:{VITE_SUPABASE_URL:`https://${targets().supabaseProject}.supabase.co`,VITE_SUPABASE_PUBLISHABLE_KEY:`sb_publishable_${'p'.repeat(25)}`},releaseId:'rapid-provider-tests'}); }
test('credential-free builder drops provider and private variables',()=>{
 const m=manifest(), env=credentialFreeBuildEnvironment(m,{PATH:'/bin',FCOS_RAPID_BUILD_HOME:'/tmp/private-home',VERCEL_TOKEN:'hidden',GITHUB_TOKEN:'hidden',SUPABASE_SERVICE_ROLE_KEY:'hidden',VITE_SECRET:'hidden'});
 for(const key of ['VERCEL_TOKEN','GITHUB_TOKEN','SUPABASE_SERVICE_ROLE_KEY','VITE_SECRET']) assert.equal(Object.hasOwn(env,key),false);
 assert.equal(env.FCOS_RAPID_BUILD_ID,m.build.buildId);
});
test('self-contained prebuilt references are bound; traversal/external references fail before credentials',()=>{
 const root=mkdtempSync(join(tmpdir(),'rapid-artifact-')),m=manifest(),out=join(root,'.vercel/output');
 try {
  mkdirSync(join(out,'functions/api.func'),{recursive:true});mkdirSync(join(out,'static'),{recursive:true});mkdirSync(join(out,'shared'),{recursive:true});
  writeFileSync(join(out,'config.json'),'{"version":3}');
  writeFileSync(join(out,'static/app-version.json'),JSON.stringify({buildId:m.build.buildId,commit:sha,sourceDigest:h}));
  writeFileSync(join(out,'shared/index.js'),'export default 1');
  const config=join(out,'functions/api.func/.vc-config.json');
  writeFileSync(config,JSON.stringify({runtime:'nodejs24.x',filePathMap:{'index.js':'.vercel/output/shared/index.js'}}));
  assertBuildArtifact(root,{artifactDigest:artifactDigest(out)},m);
  for(const ref of ['../../private.pem','/proc/self/environ','node_modules/private.js','.vercel/output/shared/../shared/index.js']){
   writeFileSync(config,JSON.stringify({filePathMap:{'index.js':ref}}));
   assert.throws(()=>assertBuildArtifact(root,{artifactDigest:artifactDigest(out)},m),/ARTIFACT_EXTERNAL_REFERENCE_FORBIDDEN/);
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});
function nativeFixture() {
 const m=manifest(),p=targets(),review={state:'approved',user:{login:p.account},environments:[{id:9,name:'fcos-production-release'}]};
 const plan={controllerSha:m.controllerSha,candidateSha:sha,handoverId:'native-fixture'};
 const setup={plan,attestationContract:'fcos-owner-recorded-handover/v1',qualificationPublisher:{account:p.account,method:'protected_controller_api'},handoverId:'native-fixture',databaseReceiptId:1,qualificationDigest:h,kind:'fcos_rapid_release_handover',controllerSha:m.controllerSha,candidateSha:sha,repository:p.repository,projectId:p.projectId,teamId:p.teamId,
 unresolvedProductionOperations:0,oldWritersRetired:true,hostedQualificationPassed:true,eventSubscribersReviewed:true,inventoryDigest:h,nativeCoordinatorReadbackDigest:h,
 finalApprovalEnvironment:'fcos-production-release',planHash:digest(plan),nativeReview:{runId:77,jobId:78,reviewDigest:digest(review),planHash:digest(plan),reviewer:p.account,reviewerId:7,state:'approved',environment:'fcos-production-release',environmentId:9,protectionDigest:h,dispatcherSha:m.controllerSha,workflowPath:'.github/workflows/fcos-rapid-handover.yml',workflowBlobSha:'e'.repeat(40),observedAt:new Date().toISOString()}};
 const run={id:88,head_sha:m.controllerSha,repository:{full_name:p.repository},event:'workflow_dispatch',path:'.github/workflows/fcos-rapid-release.yml',status:'in_progress',head_branch:'main',actor:{login:p.account,id:7},run_attempt:1,display_title:`FCOS rapid release ${digest(m)} ${sha}`,created_at:new Date().toISOString()};
 const environment={id:9,name:'fcos-production-release',can_admins_bypass:false,protection_rules:[{type:'required_reviewers',reviewers:[{reviewer:{login:p.account}}]}]};
 const gh={pages:async()=>[],identity:async()=>({user:{login:'github-actions[bot]',id:1},repo:{default_branch:'main'}}),read:async path=>{
  if(path.includes('/contents/.github/workflows/'))return{type:'file',sha:'e'.repeat(40)};
  if(path.endsWith('/deployments/100'))return{id:100,creator:{login:p.account},payload:setup};
  if(path.endsWith('/runs/88'))return run;
  if(path.endsWith('/runs/77'))return{id:77,head_sha:m.controllerSha,path:'.github/workflows/fcos-rapid-handover.yml',event:'workflow_dispatch',actor:{login:p.account},conclusion:'success',run_attempt:1,display_title:`FCOS rapid handover ${setup.planHash} ${sha}`};
  if(path.includes('/runs/77/jobs'))return{jobs:[{id:78,name:'handover-apply',conclusion:'success'}]};
  if(path.includes('/runs/88/jobs'))return{jobs:[{name:'go-live',status:'in_progress',started_at:new Date().toISOString()}]};
  if(path.endsWith('/approvals'))return[review];
  if(path.includes('/environments/'))return environment;
  throw Error(`unexpected native read ${path}`);
 }};
 return{m,gh,run,setup,env:{FCOS_RAPID_RELEASE_ENABLED:'true',FCOS_RAPID_RELEASE_HANDOVER_ID:'100',GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'88',GITHUB_REPOSITORY:p.repository,GITHUB_SHA:m.controllerSha}};
}
test('trusted activation values require the exact native Deployment ID', async () => {
 const fixture=nativeFixture();
 for(const pointer of ['', '12/../100', '9007199254740992']) {
  const env={...fixture.env,FCOS_RAPID_RELEASE_HANDOVER_ID:pointer};
  await assert.rejects(verifyExecution({github:fixture.gh,manifest:fixture.m,env,phase:'stage'}),/RAPID_RELEASE_HANDOVER_POINTER_REQUIRED/);
 }
 const read=fixture.gh.read;
 fixture.gh.read=async path=>path.endsWith('/deployments/100')?{...(await read(path)),id:101}:read(path);
 await assert.rejects(verifyExecution({github:fixture.gh,manifest:fixture.m,env:fixture.env,phase:'stage'}),/RAPID_RELEASE_HANDOVER_POINTER_CHANGED/);
});
test('native admission requires durable owner-recorded qualification and exact current manifest',async()=>{
 const f=nativeFixture();await verifyExecution({github:f.gh,manifest:f.m,env:f.env,phase:'stage'});
 f.setup.nativeReview.reviewer='unapproved-publisher';
 await assert.rejects(verifyExecution({github:f.gh,manifest:f.m,env:f.env,phase:'stage'}),/PERMANENT_HANDOVER_ATTESTATION_REQUIRED/);
});
test('rerun cannot renew old review and elapsed approval window is preserved',async()=>{
 const f=nativeFixture();f.run.run_attempt=2;
 await assert.rejects(nativeApproval({github:f.gh,manifest:f.m,staged:{id:'dpl_new'},env:f.env}),/FRESH_NATIVE_APPROVAL_REQUIRED/);
 f.run.run_attempt=1;f.run.created_at=new Date(Date.now()-25*60*60*1000).toISOString();
 await assert.rejects(nativeApproval({github:f.gh,manifest:f.m,staged:{id:'dpl_new'},env:f.env}),/EXACT_PRODUCTION_AUTHORIZATION_REQUIRED/);
});
test('installation journal identity does not require code push permission',async()=>{
 const p=targets(),gh=githubClient({token:'fake-test-token-123',actions:true,fetchImpl:async url=>({ok:true,redirected:false,json:async()=>url.endsWith('/users/github-actions%5Bbot%5D')?{login:'github-actions[bot]'}:{full_name:p.repository,archived:false,permissions:{pull:true,push:false}}})});
 assert.equal((await gh.identity()).user.login,'github-actions[bot]');
});
test('valid durable native approval survives a job interruption without refreshing its age',async()=>{
 const f=nativeFixture(),approvedAt=new Date(Date.now()-7200000).toISOString();
 const saved={manifestHash:digest(f.m),candidateSha:f.m.candidate.sha,buildId:f.m.build.buildId,deploymentId:'dpl_new',previousDeploymentId:'dpl_old',
  environment:'fcos-production-release',reviewer:targets().account,nativeReviewVerified:true,runId:88,approvedAt};
 const content={schemaVersion:1,kind:'fcos_rapid_release_event',releaseId:f.m.releaseId,manifestHash:digest(f.m),sequence:0,previousHash:null,event:'approval.accepted',data:saved};
 f.gh.pages=async()=>[{creator:{id:1},payload:{...content,recordHash:digest(content)}}];f.run.run_attempt=2;
 const actual=await nativeApproval({github:f.gh,manifest:f.m,staged:{id:'dpl_new'},env:f.env});
 assert.equal(actual.approvedAt,approvedAt);assert.deepEqual(actual,saved);
});
test('successful quality survives downstream failure or cancellation; failed quality is never reused',async()=>{
 const f=nativeFixture();f.run.status='completed';f.run.path += '@main';
 const proof=await assertFrozenWorkflow({github:f.gh,controllerSha:f.m.controllerSha,dispatcherSha:f.run.head_sha});
 for(const conclusion of ['success','failure','cancelled','timed_out']) {
  f.run.conclusion=conclusion;
  assertNativeQualityProducer(f.run,{jobs:[{name:'quality',conclusion:'success'}]},f.m,proof);
 }
 assert.throws(()=>assertNativeQualityProducer(f.run,{jobs:[{name:'quality',conclusion:'failure'}]},f.m,proof),/PRIOR_NATIVE_QUALITY_REQUIRED/);
});

test('Vercel target pins default only for absent or empty overrides; explicit mismatches fail closed',async()=>{
 const p=targets();
 for(const overrides of [{},{VERCEL_ORG_ID:'',VERCEL_PROJECT_ID:''}]){
  let calls=0;
  const provider=vercelProvider({manifest:manifest(),env:{VERCEL_TOKEN:'fixture-only',...overrides},execute:(_command,args,options)=>{
   calls++;assert.equal(options.env.VERCEL_ORG_ID,p.teamId);assert.equal(options.env.VERCEL_PROJECT_ID,p.projectId);
   if(args[0]==='--version')return '54.20.1';if(args[0]==='whoami')return p.vercelAccount;
   return JSON.stringify({id:p.projectId,accountId:p.teamId,autoAssignCustomDomains:false});
  }});
  assert.equal((await provider.project()).id,p.projectId);assert.equal(calls,3);
 }
 for(const overrides of [{VERCEL_ORG_ID:'other'},{VERCEL_PROJECT_ID:'other'},{VERCEL_ORG_ID:' '},{VERCEL_PROJECT_ID:null}])
  assert.throws(()=>vercelProvider({manifest:manifest(),env:{VERCEL_TOKEN:'fixture-only',...overrides}}),/VERCEL_TARGET_CREDENTIAL_REQUIRED/);
});

test('stage uses existing governed secret slots without moving private values or requiring target variables',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/fcos-rapid-release.yml',import.meta.url),'utf8');
 const stage=workflow.slice(workflow.indexOf('  stage-and-smoke:'),workflow.indexOf('  go-live:'));
 for(const name of ['secrets.FCOS_E2E_EMAIL','secrets.FCOS_E2E_PASSWORD','secrets.FCOS_HOSTED_RUNTIME_EMAIL','secrets.FCOS_HOSTED_RUNTIME_PASSWORD'])assert.ok(stage.includes(name));
 assert.ok(stage.includes('secrets.FCOS_RAPID_VERCEL_STAGE_TOKEN || secrets.FCOS_HOSTED_VERCEL_TOKEN'));
 assert.doesNotMatch(stage,/FCOS_HOSTED_RESTRICTED|vars\.FCOS_VERCEL_TEAM_ID|vars\.FCOS_VERCEL_PROJECT_ID/);
 const live=workflow.slice(workflow.indexOf('  go-live:'));assert.ok(live.includes('secrets.FCOS_HOSTED_NORMAL_EMAIL'));
 assert.doesNotMatch(live,/secrets\.FCOS_HOSTED_RUNTIME_EMAIL/);
});

test('activation of a newer controller immediately fences the previous controller source', async()=>{
 const f=nativeFixture(); f.setup.controllerSha='e'.repeat(40);
 await assert.rejects(verifyExecution({github:f.gh,manifest:f.m,env:f.env,phase:'stage'}),/PERMANENT_HANDOVER_ATTESTATION_REQUIRED/);
});

test('expired setup Actions history is unnecessary; a bot copy cannot replace the owner receipt',async()=>{
 const f=nativeFixture(),original=f.gh.read;let historicalReads=0;
 f.gh.read=async path=>{if(/\/runs\/77(?:\/|$)/.test(path)){historicalReads++;throw Error('historical run expired');}return original(path);};
 await verifyExecution({github:f.gh,manifest:f.m,env:f.env,phase:'stage'});assert.equal(historicalReads,0);
 f.gh.read=async path=>path.endsWith('/deployments/100')?{id:100,creator:{login:'github-actions[bot]'},payload:f.setup}:original(path);
 await assert.rejects(verifyExecution({github:f.gh,manifest:f.m,env:f.env,phase:'stage'}),/PERMANENT_HANDOVER_ATTESTATION_REQUIRED/);
});

test('ordinary dispatcher source changes reuse frozen controller only with identical admitted workflow bytes',async()=>{
 const f=nativeFixture();f.run.head_sha='f'.repeat(40);f.env.GITHUB_SHA=f.run.head_sha;
 await verifyExecution({github:f.gh,manifest:f.m,env:f.env,phase:'stage'});
 const original=f.gh.read;f.gh.read=async path=>path.includes('/contents/')&&path.endsWith('f'.repeat(40))?{type:'file',sha:'9'.repeat(40)}:original(path);
 await assert.rejects(verifyExecution({github:f.gh,manifest:f.m,env:f.env,phase:'stage'}),/DISPATCHER_WORKFLOW_CHANGED/);
});
