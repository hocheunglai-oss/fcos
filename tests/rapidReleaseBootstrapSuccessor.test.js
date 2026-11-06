import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { targets,digest,sourceSnapshot } from '../scripts/lib/rapid-release/contract.mjs';
import { readBootstrapDatabase,claimBootstrap,createBootstrapPlan,bootstrapRequest,BOOTSTRAP_ENVIRONMENT } from '../scripts/lib/rapid-release/bootstrap.mjs';
import { verifyBootstrapAdmission,verifyLockedBootstrap,assertNativeBootstrapAdmission,verifyBootstrapSuccessorAdmission } from '../scripts/lib/rapid-release/bootstrap-admission.mjs';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite'), pins=targets(), owner={id:7,login:pins.account}, repoId=1278654816;
const blob = bytes => ({type:'file',encoding:'base64',content:bytes.toString('base64'),sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')});
async function fixture({complete=true,pg:supplied}={}) {
  const pg=supplied||new PGlite(), directory=mkdtempSync(join(tmpdir(),'fcos-bootstrap-admission-'));
  await pg.exec(`create role anon;create role authenticated;create role service_role;create role fcos_coordinator_runtime;create role fcos_coordinator_owner;
   grant fcos_coordinator_owner to postgres;create schema fcos_release_coordination authorization fcos_coordinator_owner;
   create table fcos_release_coordination.control(singleton boolean primary key,epoch bigint,operation_id text,mode text,bootstrap_id text,recovery_id text,plan_completion_id text,source_upgrade_id text);
   insert into fcos_release_coordination.control values(true,1,null,'qualification',null,null,null,null);
   create table fcos_release_coordination.operations(operation_id text,phase text);create table fcos_release_coordination.operation_events(event_id bigint,operation_id text,state text);
   insert into fcos_release_coordination.operations values('old-unknown','preview.create');`);
  const queries=[], query=pg.query.bind(pg), db={query:async(text,parameters)=>{queries.push(text);return text.startsWith('-- One-time')?(await pg.exec(text)).at(-1):query(text,parameters);}};
  const connection={host:`db.${pins.supabaseProject}.supabase.co`,port:5432,user:'postgres',database:'postgres',ssl:{rejectUnauthorized:true}};
  const source={sha:'a'.repeat(40),sourceDigest:'b'.repeat(64),lockDigest:'c'.repeat(64)};
  const plan=createBootstrapPlan({source,audit:await readBootstrapDatabase({db,connection}),inventoryDigest:'d'.repeat(64),previousProductionId:'dpl_old',quality:{checkRunId:10,runId:11,jobId:12}});
  const claim=(await claimBootstrap({db,connection,plan})).claim, requestHash=digest(bootstrapRequest(plan));
  const qualified={deploymentId:'dpl_preview',githubPreviewDeploymentId:90,githubPreviewStatusId:91};
  if(complete) for(const [phase,evidence]of[['vercel_intent',{requestHash}],['vercel_observed',{deploymentId:'dpl_preview',requestHash}],['preview_qualified',qualified]])
    await pg.query('insert into fcos_release_coordination.rapid_bootstrap_receipts(operation_id,phase,plan_hash,controller_sha,evidence) values($1,$2,$3,$4,$5::jsonb)',[plan.operationId,phase,digest(plan),plan.controllerSha,JSON.stringify(evidence)]);
  const url=`fcos-123456789-${pins.team}.vercel.app`, harnessSha='e'.repeat(40), start=Date.now()-60000;
  const payload={candidateSha:plan.controllerSha,candidateUrl:`https://${url}`,harnessSha};
  writeFileSync(join(directory,'fcos-ci-evidence.json'),JSON.stringify(payload));
  execFileSync('/usr/bin/zip',['-q','evidence.zip','fcos-ci-evidence.json'],{cwd:directory});
  const archive=readFileSync(join(directory,'evidence.zip'));
  const f={pg,db,connection,queries,plan,payload,archive,directory,repo:{id:repoId,full_name:pins.repository,owner,default_branch:'main'},reads:0};
  const phases=[['bootstrap.intent',{sourceDigest:plan.sourceDigest,requestHash}],['bootstrap.claimed',{receiptId:Number(claim.receipt_id),guardFingerprint:claim.evidence.guardFingerprint,historyDigest:plan.historyDigest}],
    ['vercel.intent',{requestHash}],['vercel.observed',{deploymentId:'dpl_preview',requestHash}],['preview.qualified',qualified]];
  f.journal=phases.map(([event,data],index)=>{const body={schemaVersion:1,kind:'fcos_bootstrap_event',operationId:plan.operationId,planHash:digest(plan),controllerSha:plan.controllerSha,event,data};
    return{id:index+1,sha:plan.controllerSha,environment:BOOTSTRAP_ENVIRONMENT,creator:owner,payload:{...body,recordHash:digest(body)}};});
  const run={id:50,repository:f.repo,head_repository:f.repo,head_branch:'main',head_sha:harnessSha,event:'workflow_dispatch',status:'completed',conclusion:'success',path:'.github/workflows/authenticated-release.yml',run_attempt:1,actor:owner,triggering_actor:owner};
  f.run=run;f.environment={id:60,name:'fcos-ci-readonly',can_admins_bypass:false,deployment_branch_policy:{protected_branches:true,custom_branch_policies:false},protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:owner}]}]};
  f.reviews=[{state:'approved',user:owner,environments:[{id:60,name:'fcos-ci-readonly'}]}];
  f.artifact={id:70,name:`fcos-ci-evidence-${plan.controllerSha}`,expired:false,workflow_run:{id:50,head_sha:harnessSha},created_at:new Date(start+30000).toISOString(),digest:`sha256:${digest(archive)}`};
  f.github={read:async path=>{
    f.reads++;
    if(path===`/repos/${pins.repository}`)return f.repo;
    if(path.includes('/contents/scripts/rapid-release/bootstrap-guard.sql'))return blob(readFileSync(new URL('../scripts/rapid-release/bootstrap-guard.sql',import.meta.url)));
    if(path.includes('/contents/.github/workflows/authenticated-release.yml'))return blob(readFileSync(new URL('../.github/workflows/authenticated-release.yml',import.meta.url)));
    if(path.includes('/check-runs/10'))return{id:10,app:{id:15368},head_sha:plan.controllerSha,status:'completed',conclusion:'success',details_url:`https://github.com/${pins.repository}/actions/runs/11/job/12`};
    if(path.endsWith('/actions/runs/11'))return{id:11,head_sha:plan.controllerSha,repository:f.repo,head_repository:f.repo,event:'pull_request',path:'.github/workflows/quality.yml'};
    if(path.endsWith('/actions/jobs/12'))return{id:12,run_id:11,head_sha:plan.controllerSha,name:'code-and-database',status:'completed',conclusion:'success'};
    if(path.endsWith('/actions/runs/50'))return f.run;
    if(path.includes('/branches/'))return{name:'main',protected:true,commit:{sha:'f'.repeat(40)}}; // Controller already merged; original main harness remains independently bound.
    if(path.includes('/environments/'))return f.environment;
    if(path.endsWith('/approvals'))return f.reviews;
    if(path.includes('/jobs?'))return{total_count:2,jobs:[{id:80,name:'require-default-branch-dispatch',completed_at:new Date(start).toISOString()},{id:81,name:'authenticated-candidate',started_at:new Date(start+1000).toISOString(),completed_at:new Date(start+59000).toISOString()}].map(row=>({...row,run_id:50,head_sha:harnessSha,status:'completed',conclusion:'success'}))};
    if(path.includes('/artifacts?'))return{total_count:1,artifacts:[f.artifact]};
    if(path.endsWith('/deployments/90'))return{id:90,sha:plan.controllerSha,environment:'Preview',creator:{login:f.bot||'vercel[bot]'}};
    throw Error('Unexpected native GET');
  },pages:async path=>path.includes(`environment=${BOOTSTRAP_ENVIRONMENT}`)?f.journal:[{id:91,state:'success',creator:{login:'vercel[bot]'},environment_url:`https://${url}`},{id:92,state:'inactive',creator:{login:'vercel[bot]'}}],archive:async()=>f.archive};
  f.vercel={project:async()=>({id:pins.projectId,accountId:pins.teamId,autoAssignCustomDomains:false}),currentProduction:async()=>({id:f.alias||'dpl_old',alias:new URL(pins.origin).hostname,projectId:pins.projectId,teamId:pins.teamId}),
    deployment:async()=>({id:'dpl_preview',url,target:null,readyState:'READY',ownerId:pins.teamId,projectId:pins.projectId,gitSource:{sha:plan.controllerSha,repoId},meta:{githubCommitSha:plan.controllerSha,fcosBootstrapOperation:plan.operationId,fcosBootstrapPlanHash:digest(plan)}})};
  f.readDatabase=async work=>{await pg.query('begin isolation level repeatable read read only');try{const result=await work(db);await pg.query('commit');return result;}catch(error){await pg.query('rollback');throw error;}};
  f.input={bootstrapPlan:plan,controllerSha:plan.controllerSha,github:f.github,vercel:f.vercel,authenticationRunId:50,readDatabase:f.readDatabase};
  f.verify=()=>verifyBootstrapAdmission(f.input); f.close=async()=>{await pg.close();rmSync(directory,{recursive:true,force:true});};return f;
}


import {createBootstrapSuccessorPlan,claimBootstrapSuccessor,submitBootstrapSuccessor,observeBootstrapSuccessor,qualifyBootstrapSuccessor,verifyLockedBootstrapSuccessor,bootstrapSuccessorRef,BOOTSTRAP_SUCCESSOR_REVIEW_ENVIRONMENT,BOOTSTRAP_SUCCESSOR_AUTH_ENVIRONMENT,failBootstrapSuccessor,bootstrapSuccessorConfiguration,abortBootstrapSuccessor,BOOTSTRAP_SUCCESSOR_ABORT_ENVIRONMENT,createBootstrapSuccessorReconciliationNative} from '../scripts/lib/rapid-release/bootstrap-successor.mjs';
import {createHandoverPlan} from '../scripts/lib/rapid-release/handover.mjs';

async function successorFixture(options) {
  const f=await fixture(options),newSha='1'.repeat(40),treeOld='2'.repeat(40),treeNew='3'.repeat(40),url=`fcos-987654321-${pins.team}.vercel.app`;
  const patch=[{path:'api/safety.js',oldSha:'4'.repeat(40),newSha:'5'.repeat(40),oldMode:'100644',newMode:'100644'}];
  f.successor=createBootstrapSuccessorPlan({bootstrapPlan:f.plan,controllerSha:newSha,sourceDigest:'6'.repeat(64),lockDigest:f.plan.lockDigest,configurationDigest:digest({fixtureVersion:1}),quality:{checkRunId:110,runId:111,jobId:112},patch});
  f.repo.permissions={admin:true};f.run.conclusion='failure';
  f.newRun={...f.run,id:150,conclusion:'success'};
  const start=Date.now()-60000,payload={candidateSha:newSha,candidateUrl:`https://${url}`,harnessSha:f.newRun.head_sha};
  writeFileSync(join(f.directory,'fcos-ci-evidence.json'),JSON.stringify(payload));
  execFileSync('/usr/bin/zip',['-q','new.zip','fcos-ci-evidence.json'],{cwd:f.directory});f.newArchive=readFileSync(join(f.directory,'new.zip'));
  f.newArtifact={...f.artifact,id:170,name:`fcos-ci-evidence-${newSha}`,workflow_run:{id:150,head_sha:f.newRun.head_sha},created_at:new Date(start+30000).toISOString(),digest:`sha256:${digest(f.newArchive)}`};
  const oldRead=f.github.read,oldPages=f.github.pages,commits=new Map([[f.plan.controllerSha,{sha:f.plan.controllerSha,tree:{sha:treeOld},parents:[]}],[newSha,{sha:newSha,tree:{sha:treeNew},parents:[{sha:f.plan.controllerSha}]}]]);
  f.commits=commits;f.head=null;f.gitWrites=0;f.creates=0;f.deployments=[];
  f.ownerReview={id:200,sha:newSha,creator:owner,environment:BOOTSTRAP_SUCCESSOR_REVIEW_ENVIRONMENT,payload:{schemaVersion:1,kind:'fcos_initial_bootstrap_successor_review',planHash:digest(f.successor),bootstrapPlanHash:digest(f.plan),controllerSha:newSha,patchDigest:digest(patch)}};
  f.github.read=async path=>{
    if(path==='/user')return owner;
    if(path.includes('/contents/vercel.json?'))return blob(Buffer.from(JSON.stringify({git:{deploymentEnabled:f.autoDeploy||false}})));
    if(path.includes('/actions/variables/'))return f.activeVariable||null;
    if(path.endsWith(`/deployments/${f.ownerReview.id}`))return f.ownerReview;
    if(path.includes('/compare/'))return{status:f.compareStatus||'ahead',merge_base_commit:{sha:f.plan.controllerSha},base_commit:{sha:f.plan.controllerSha},total_commits:1};
    if(path.includes('/git/commits/')){const row=commits.get(path.split('/').at(-1));assert.ok(row,'Native commit exists');return row;}
    if(path.includes('/git/trees/')){const old=path.includes(treeOld);return{sha:old?treeOld:treeNew,truncated:false,tree:[{path:'api/safety.js',mode:'100644',type:'blob',sha:old?patch[0].oldSha:f.changedBlob||patch[0].newSha}]};}
    if(path.endsWith('/pulls/124'))return{number:124,state:'open',base:{repo:f.repo,ref:'main'},head:{repo:f.repo,ref:f.successor.branch,sha:f.wrongPr||newSha}};
    if(path.includes('/git/ref/heads/'))return{object:{sha:newSha}};
    if(path.endsWith('/check-runs/110'))return{id:110,app:{id:15368},head_sha:newSha,status:'completed',conclusion:f.newQuality||'success',details_url:`https://github.com/${pins.repository}/actions/runs/111/job/112`};
    if(path.endsWith('/actions/runs/111'))return{id:111,head_sha:newSha,repository:f.repo,head_repository:f.repo,event:'pull_request',path:'.github/workflows/quality.yml'};
    if(path.endsWith('/actions/jobs/112'))return{id:112,run_id:111,head_sha:newSha,name:'code-and-database',status:'completed',conclusion:'success'};
    if(path.endsWith('/actions/runs/150'))return f.newRun;
    if(path.includes('/actions/runs/150/jobs?'))return{total_count:2,jobs:[{id:180,name:'require-default-branch-dispatch',completed_at:new Date(start).toISOString()},{id:181,name:'authenticated-candidate',started_at:new Date(start+1000).toISOString(),completed_at:new Date(start+59000).toISOString()}].map(row=>({...row,run_id:150,head_sha:f.newRun.head_sha,status:'completed',conclusion:'success'}))};
    if(path.includes('/actions/runs/150/artifacts?'))return{total_count:1,artifacts:[f.newArtifact]};
    if(path.endsWith('/deployments/190'))return{id:190,sha:newSha,environment:'Preview',creator:{login:f.newBot||'vercel[bot]'}};
    return oldRead(path);
  };
  f.github.pages=async path=>{
    if(path.includes('/git/matching-refs/'))return f.head?[{ref:bootstrapSuccessorRef(f.successor),object:{type:'commit',sha:f.head}}]:[];
    if(path.includes('/deployments/190/statuses'))return[{id:191,state:'success',creator:{login:'vercel[bot]'},environment_url:`https://${url}`}];return oldPages(path);
  };
  f.github.archive=async path=>path.includes('/170/')?f.newArchive:f.archive;
  f.github.write=async(path,body)=>{f.gitWrites++;if(path.endsWith('/git/commits')){const sha=digest(body).slice(0,40);commits.set(sha,{sha,message:body.message,tree:{sha:body.tree},parents:body.parents.map(sha=>({sha}))});return{sha};}
    assert.ok(path.endsWith('/git/refs'));if(f.head)throw Error('Existing ref');f.head=body.sha;return{object:{sha:f.head}};};
  f.github.patch=async(path,body)=>{f.gitWrites++;assert.equal(body.force,false);assert.equal(commits.get(body.sha).parents[0].sha,f.head,'Only native fast-forward allowed');f.head=body.sha;return{object:{sha:f.head}};};
  const oldDeployment=f.vercel.deployment;
  f.newPreview={id:'dpl_successor',url,target:null,readyState:'READY',ownerId:pins.teamId,projectId:pins.projectId,
    gitSource:{type:'github',sha:newSha,repoId,ref:f.successor.branch,prId:124},meta:{githubCommitSha:newSha,fcosBootstrapOperation:f.successor.operationId,fcosBootstrapPlanHash:digest(f.successor)}};
  f.vercel.deployment=async id=>id==='dpl_successor'?f.newPreview:oldDeployment(id);
  f.vercel.find=async({operationId})=>operationId===f.newPreview.meta.fcosBootstrapOperation?f.deployments:[];f.configuration={fixtureVersion:1};f.vercel.configuration=async()=>f.configuration;
  f.vercel.create=async request=>{f.creates++;assert.equal(request.gitSource.sha,newSha);if(!f.noProviderEffect)f.deployments=[{id:'dpl_successor'}];if(f.lostAck)throw Error('Provider secret never exposed');return f.newPreview;};
  f.context={bootstrapPlan:f.plan,successorPlan:f.successor,github:f.github,vercel:f.vercel,db:f.db,connection:f.connection,readDatabase:f.readDatabase,directory:f.directory,ownerReviewDeploymentId:200,authenticationRunId:150,githubPreviewDeploymentId:190,githubPreviewStatusId:191};
  f.prepare=async()=>{await claimBootstrapSuccessor(f.context);await submitBootstrapSuccessor(f.context);return qualifyBootstrapSuccessor(f.context);};
  return f;
}

test('successor retains old frozen root and requires its own native quality, Preview and protected browser artifact',async()=>{
  const f=await successorFixture();try{
    await assert.rejects(f.verify(),/AUTHENTICATED_PRODUCER_REQUIRED/);
    const original=await f.readDatabase(db=>verifyLockedBootstrap({db,bootstrapPlan:f.plan,controllerSha:f.plan.controllerSha}));
    await f.prepare();const admission=await verifyBootstrapSuccessorAdmission(f.context);
    assert.equal(admission.reference.schemaVersion,2);assert.equal(admission.reference.bootstrap.controllerSha,f.plan.controllerSha);
    assert.equal(admission.reference.successor.plan.controllerSha,f.successor.controllerSha);assert.equal(admission.reference.authentication.runId,150);
    assert.equal(assertNativeBootstrapAdmission(admission,{controllerSha:f.successor.controllerSha}),admission.reference);
    assert.throws(()=>assertNativeBootstrapAdmission({...admission},{controllerSha:f.successor.controllerSha}),/CAPABILITY_REQUIRED/);
    assert.throws(()=>assertNativeBootstrapAdmission(admission,{controllerSha:f.plan.controllerSha}),/CAPABILITY_REQUIRED/);
    const locked=await f.readDatabase(db=>verifyLockedBootstrapSuccessor({db,github:f.github,bootstrapPlan:f.plan,controllerSha:f.successor.controllerSha,reference:admission.reference}));
    assert.equal(locked.sha,f.head);assert.deepEqual((await f.readDatabase(db=>verifyLockedBootstrap({db,bootstrapPlan:f.plan,controllerSha:f.plan.controllerSha}))),original);
    const audit={database:{control:admission.controlPreimage,receipts:[],unresolvedProduction:[],historyDigest:'a'.repeat(64)},providers:{rapidJournal:{unresolvedProduction:0},noRunning:true,productionId:'dpl_old'}};
    const plan=createHandoverPlan({audit,controllerSha:f.successor.controllerSha,candidateSha:f.successor.controllerSha,buildId:'b'.repeat(64),artifactDigest:'c'.repeat(64),handoverId:'initial-successor-handover',bootstrapPlan:f.plan,bootstrapAdmission:admission});
    assert.equal(plan.bootstrap.plan.controllerSha,f.plan.controllerSha);assert.equal(plan.controlPreimage.mode,'frozen');assert.equal(f.creates,1);
  }finally{await f.close();}
});

test('unknown Preview ACK is readback only across repeated and different-host submission calls',async()=>{
  const f=await successorFixture();try{f.lostAck=true;f.noProviderEffect=true;await claimBootstrapSuccessor(f.context);
    await assert.rejects(submitBootstrapSuccessor(f.context),/PREVIEW_ACK_UNKNOWN/);
    await assert.rejects(submitBootstrapSuccessor({...f.context,directory:mkdtempSync(join(f.directory,'host-'))}),/PREVIEW_ACK_UNKNOWN/);assert.equal(f.creates,1);
    f.deployments=[{id:'dpl_successor'}];await observeBootstrapSuccessor(f.context);await submitBootstrapSuccessor(f.context);assert.equal(f.creates,1);
  }finally{await f.close();}
});

test('wrong owner, incomplete patch, unrelated source, failed quality and changed PR are refused before any journal/provider write',async()=>{
  for(const mutate of[f=>{f.autoDeploy=true;},f=>{f.ownerReview.creator={id:9,login:'vercel[bot]'};},f=>{f.changedBlob='9'.repeat(40);},f=>{f.compareStatus='diverged';},f=>{f.newQuality='failure';},f=>{f.wrongPr='9'.repeat(40);}]){
    const f=await successorFixture();try{mutate(f);await assert.rejects(claimBootstrapSuccessor(f.context),/OWNER_REVIEW_REQUIRED|PATCH_CHANGED|DESCENDANT_REQUIRED|QUALITY_REQUIRED|EXACT_PR_REQUIRED|AUTODEPLOY_DISABLED_REQUIRED/);assert.equal(f.gitWrites,0);assert.equal(f.creates,0);}finally{await f.close();}
  }
});

test('failed old browser cannot qualify successor, and fake bot/changed alias never grant authority',async()=>{
  const f=await successorFixture();try{await claimBootstrapSuccessor(f.context);await submitBootstrapSuccessor(f.context);
    await assert.rejects(qualifyBootstrapSuccessor({...f.context,authenticationRunId:50}),/AUTHENTICATED_PRODUCER_REQUIRED/);
    f.newBot=owner.login;await assert.rejects(qualifyBootstrapSuccessor(f.context),/GENUINE_PREVIEW_REQUIRED/);
    f.newBot=null;f.alias='dpl_moved';await assert.rejects(qualifyBootstrapSuccessor(f.context),/PREVIEW_OR_ALIAS_CHANGED/);assert.equal(f.creates,1);
  }finally{await f.close();}
});

test('transient authenticated failure reuses the exact READY Preview with a new protected run and zero rebuilds',async()=>{
  const f=await successorFixture();try{await claimBootstrapSuccessor(f.context);await submitBootstrapSuccessor(f.context);
    f.newRun.conclusion='failure';await assert.rejects(qualifyBootstrapSuccessor(f.context),/AUTHENTICATED_PRODUCER_REQUIRED/);
    assert.equal(JSON.parse(f.commits.get(f.head).message).phase,'vercel_observed');
    const previous=f.github.read,run={...f.newRun,id:251,conclusion:'success'},artifact={...f.newArtifact,id:171,workflow_run:{id:251,head_sha:run.head_sha}};
    f.github.read=async path=>{if(path.endsWith('/actions/runs/251'))return run;
      if(path.includes('/actions/runs/251/jobs?')){const result=await previous(path.replace('/251/jobs?','/150/jobs?'));return{...result,jobs:result.jobs.map(row=>({...row,run_id:251}))};}
      if(path.includes('/actions/runs/251/artifacts?'))return{total_count:1,artifacts:[artifact]};return previous(path);};
    const archive=f.github.archive;f.github.archive=async path=>path.includes('/171/')?f.newArchive:archive(path);
    const result=await qualifyBootstrapSuccessor({...f.context,authenticationRunId:251});assert.equal(result.state.data.authentication.runId,251);
    assert.equal(f.newRun.conclusion,'failure');assert.equal(f.creates,1);
  }finally{await f.close();}
});

test('expired or copied new browser evidence and changed source invalidate only admission without another submission',async()=>{
  const f=await successorFixture();try{await f.prepare();f.newArtifact.expired=true;
    await assert.rejects(verifyBootstrapSuccessorAdmission(f.context),/AUTHENTICATED_ARTIFACT_REQUIRED/);
    f.newArtifact.expired=false;f.newArtifact.digest='sha256:'+ '0'.repeat(64);await assert.rejects(verifyBootstrapSuccessorAdmission(f.context),/ARTIFACT_DIGEST/);
    f.newArtifact.digest=`sha256:${digest(f.newArchive)}`;f.changedBlob='8'.repeat(40);await assert.rejects(verifyBootstrapSuccessorAdmission(f.context),/PATCH_CHANGED/);assert.equal(f.creates,1);
  }finally{await f.close();}
});

test('prepared/finalized handover fences new claims; successor head is rechecked under existing handover lock',async()=>{
  const f=await successorFixture();try{await f.prepare();const admission=await verifyBootstrapSuccessorAdmission(f.context);
    const current=f.head;f.head='9'.repeat(40);await assert.rejects(f.readDatabase(db=>verifyLockedBootstrapSuccessor({db,github:f.github,bootstrapPlan:f.plan,controllerSha:f.successor.controllerSha,reference:admission.reference})));f.head=current;
    await f.pg.exec("create table fcos_release_coordination.rapid_handover_receipts(receipt_id bigint,handover_id text,phase text);insert into fcos_release_coordination.rapid_handover_receipts values(1,'other','prepared')");
    await assert.rejects(claimBootstrapSuccessor(f.context),/HANDOVER_ALREADY_CLAIMED/);assert.equal(f.creates,1);
    await f.pg.query("update fcos_release_coordination.rapid_handover_receipts set phase='finalized'");await assert.rejects(claimBootstrapSuccessor(f.context),/HANDOVER_ALREADY_CLAIMED/);
  }finally{await f.close();}
});


test('known native build failure closes only its exact attempt; unknown/queued outcomes cannot unlock a new version',async()=>{
  const f=await successorFixture();try{
    await claimBootstrapSuccessor(f.context);await submitBootstrapSuccessor(f.context);
    await assert.rejects(failBootstrapSuccessor({...f.context,failure:{type:'vercel_terminal',state:'ERROR'}}),/PREVIEW_OR_ALIAS_CHANGED/);
    f.configuration={fixtureVersion:2};f.newPreview.readyState='ERROR';const result=await failBootstrapSuccessor({...f.context,failure:{type:'vercel_terminal',state:'ERROR'}});
    assert.equal(result.state.phase,'failed');assert.equal(result.state.data.deploymentId,'dpl_successor');
    await assert.rejects(submitBootstrapSuccessor(f.context),/CONFIGURATION_CHANGED|KNOWN_FAILURE/);assert.equal(f.creates,1);
    const retry=createBootstrapSuccessorPlan({...f.successor,bootstrapPlan:f.plan,revision:2});assert.notEqual(retry.operationId,f.successor.operationId);assert.deepEqual(retry.quality,f.successor.quality);
    f.configuration={fixtureVersion:2};const next=createBootstrapSuccessorPlan({...f.successor,bootstrapPlan:f.plan,configurationDigest:digest(f.configuration),revision:2});
    f.ownerReview={...f.ownerReview,id:201,payload:{...f.ownerReview.payload,planHash:digest(next)}};
    const continued=await claimBootstrapSuccessor({...f.context,successorPlan:next,ownerReviewDeploymentId:201});assert.equal(continued.state.phase,'claimed');assert.equal(continued.state.parentSha,result.sha);
  }finally{await f.close();}
});

test('owner-attested failed dispatch is labelled separately, linked to original intent, and never grants browser authority',async()=>{
  const f=await successorFixture();try{
    await claimBootstrapSuccessor(f.context);await submitBootstrapSuccessor(f.context);
    const now=Date.now(),harnessSha=f.newRun.head_sha,common={planHash:digest(f.successor),controllerSha:f.successor.controllerSha,deploymentId:'dpl_successor',candidateUrl:`https://${f.newPreview.url}`,harnessSha};
    const intent={id:210,sha:f.successor.controllerSha,creator:owner,environment:BOOTSTRAP_SUCCESSOR_AUTH_ENVIRONMENT,created_at:new Date(now-5000).toISOString(),payload:{schemaVersion:1,kind:'fcos_initial_bootstrap_successor_authentication_intent',...common}};
    const failureRun={...f.newRun,id:250,actor:owner,run_attempt:1,conclusion:'failure',created_at:new Date(now-4000).toISOString(),updated_at:new Date(now-1000).toISOString()};
    const statement={schemaVersion:1,kind:'fcos_initial_bootstrap_successor_authentication_failure',provenance:'owner_attested_original_dispatch',intentDeploymentId:210,...common,runId:250,runAttempt:1};
    const evidence={...intent,id:211,created_at:new Date(now).toISOString(),payload:statement};
    const old=f.github.read;f.github.read=async path=>path.endsWith('/deployments/210')?intent:path.endsWith('/deployments/211')?evidence:path.endsWith('/actions/runs/250/attempts/1')?failureRun:old(path);
    const failure={type:'authentication_terminal',intentDeploymentId:210,evidenceDeploymentId:211,runId:250,runAttempt:1,statementDigest:digest(statement),intentDigest:digest(intent.payload),conclusion:'failure'};
    failureRun.status='queued';await assert.rejects(failBootstrapSuccessor({...f.context,failure}),/FAILURE_EVIDENCE_REQUIRED/);
    failureRun.status='completed';evidence.creator={id:9,login:'github-actions[bot]'};await assert.rejects(failBootstrapSuccessor({...f.context,failure}),/FAILURE_EVIDENCE_REQUIRED/);
    evidence.creator=owner;const result=await failBootstrapSuccessor({...f.context,failure});assert.equal(result.state.phase,'failed');
    await assert.rejects(verifyBootstrapSuccessorAdmission(f.context),/QUALIFIED_HEAD_REQUIRED/);assert.equal(f.creates,1);
  }finally{await f.close();}
});

test('real PostgreSQL control lock serializes handover preparation against a new successor claim', {skip:!existsSync('/opt/homebrew/bin/initdb')}, async()=>{
  const {Client}=createRequire(import.meta.url)('pg');
  const out=join(process.cwd(),'outputs');mkdirSync(out,{recursive:true});const root=mkdtempSync(join(out,'p-')),data=join(root,'d'),socket=join(out,'s');mkdirSync(socket,{mode:0o700});
  const port=55449;let started=false,a,b,f;
  try{
    execFileSync('/opt/homebrew/bin/initdb',['-D',data,'--no-locale','-A','trust','-U','postgres'],{stdio:'pipe'});
    execFileSync('/opt/homebrew/bin/pg_ctl',['-D',data,'-l',join(root,'server.log'),'-o',`-c listen_addresses='' -c unix_socket_directories=${socket} -p ${port}`,'-w','start'],{stdio:'pipe'});started=true;
    a=new Client({host:socket,port,user:'postgres',database:'postgres'});b=new Client({host:socket,port,user:'postgres',database:'postgres'});await a.connect();await b.connect();
    f=await successorFixture({pg:{exec:async sql=>[await a.query(sql)],query:(...args)=>a.query(...args),close:async()=>{}}});
    await b.query('create table fcos_release_coordination.rapid_handover_receipts(receipt_id bigint,handover_id text,phase text)');
    await b.query('begin');await b.query('lock table fcos_release_coordination.control in share row exclusive mode');
    let settled=false;const pending=claimBootstrapSuccessor(f.context).finally(()=>{settled=true;});
    const deadline=Date.now()+5000;let waiting=false;
    while(Date.now()<deadline){const rows=await b.query("select exists(select 1 from pg_locks l join pg_class c on c.oid=l.relation where c.relname='control' and not l.granted) as waiting");if(rows.rows[0].waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,true,'Successor waits on the exact existing control table lock');assert.equal(settled,false);assert.equal(f.gitWrites,0);
    await b.query("insert into fcos_release_coordination.rapid_handover_receipts values(1,'native-handover','prepared')");await b.query('commit');
    await assert.rejects(pending,/HANDOVER_ALREADY_CLAIMED/);assert.equal(f.gitWrites,0);assert.equal(f.creates,0);
    await b.query('delete from fcos_release_coordination.rapid_handover_receipts');await claimBootstrapSuccessor(f.context);
    const second={...f.context,db:{query:(...args)=>b.query(...args)},directory:mkdtempSync(join(f.directory,'other-')),readDatabase:async work=>{
      await b.query('begin isolation level repeatable read read only');try{const result=await work({query:(...args)=>b.query(...args)});await b.query('commit');return result;}catch(error){await b.query('rollback');throw error;}}};
    const attempts=await Promise.allSettled([submitBootstrapSuccessor(f.context),submitBootstrapSuccessor(second)]);
    assert.ok(attempts.some(r=>r.status==='fulfilled'));assert.equal(f.creates,1,'Two real native pg clients reserve one Preview submission');
    f.newPreview.readyState='ERROR';await failBootstrapSuccessor({...f.context,failure:{type:'vercel_terminal',state:'ERROR'}});
    f.configuration={fixtureVersion:2};const next=createBootstrapSuccessorPlan({...f.successor,bootstrapPlan:f.plan,configurationDigest:digest(f.configuration),revision:2});
    f.ownerReview={...f.ownerReview,id:201,payload:{...f.ownerReview.payload,planHash:digest(next)}};
    const nextContext={...f.context,successorPlan:next,ownerReviewDeploymentId:201};await claimBootstrapSuccessor(nextContext);
    const oldPreview=structuredClone(f.newPreview),oldDeployment=f.vercel.deployment;
    f.newPreview={...oldPreview,id:'dpl_next',readyState:'READY',meta:{...oldPreview.meta,fcosBootstrapOperation:next.operationId,fcosBootstrapPlanHash:digest(next)}};f.deployments=[];
    f.vercel.deployment=async id=>id==='dpl_next'?f.newPreview:id==='dpl_successor'?oldPreview:oldDeployment(id);
    f.vercel.create=async()=>{f.creates++;f.deployments=[{id:'dpl_next'}];return f.newPreview;};
    const abortContext=ownerAbort(f,nextContext);const races=await Promise.allSettled([abortBootstrapSuccessor(abortContext),submitBootstrapSuccessor({...second,successorPlan:next})]);
    assert.ok(races.some(r=>r.status==='fulfilled'));assert.ok(f.creates<=2,'Abort vs intent cannot create twice');
    const phase=JSON.parse(f.commits.get(f.head).message).phase;if(phase==='aborted')assert.equal(f.creates,1,'Abort winner forbids the original provider POST');
    assert.match(execFileSync('/opt/homebrew/bin/postgres',['--version'],{encoding:'utf8'}),/17\./);
  }catch(error){if(!started&&existsSync(join(root,'server.log')))throw new Error(readFileSync(join(root,'server.log'),'utf8'));throw error;}finally{if(f)await f.close();await a?.end();await b?.end();if(started)execFileSync('/opt/homebrew/bin/pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});rmSync(root,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});


function ownerAbort(f,context=f.context) {
  const statement={schemaVersion:1,kind:'fcos_initial_bootstrap_successor_abort',planHash:digest(context.successorPlan),headSha:f.head,controllerSha:context.successorPlan.controllerSha,reason:'source_superseded'};
  const row={id:220,sha:context.successorPlan.controllerSha,creator:owner,environment:BOOTSTRAP_SUCCESSOR_ABORT_ENVIRONMENT,payload:statement};
  const previous=f.github.read;f.github.read=async path=>path.endsWith('/deployments/220')?row:previous(path);
  return{...context,abortDeploymentId:220,claimedHeadSha:f.head,reason:'source_superseded'};
}

test('only an exact owner-reviewed unsubmitted claim can abort; intent/unknown attempts remain fenced',async()=>{
  const f=await successorFixture();try{await claimBootstrapSuccessor(f.context);const context=ownerAbort(f);
    const aborted=await abortBootstrapSuccessor(context);assert.equal(aborted.state.phase,'aborted');assert.equal(f.creates,0);
    await assert.rejects(submitBootstrapSuccessor(f.context),/KNOWN_FAILURE/);assert.equal(f.creates,0);
  }finally{await f.close();}
  const submitted=await successorFixture();try{await claimBootstrapSuccessor(submitted.context);const context=ownerAbort(submitted);submitted.noProviderEffect=true;
    await assert.rejects(submitBootstrapSuccessor(submitted.context),/PREVIEW_ACK_UNKNOWN/);await assert.rejects(abortBootstrapSuccessor(context),/UNSUBMITTED_HEAD_REQUIRED/);assert.equal(submitted.creates,1);
  }finally{await submitted.close();}
});

test('native Preview configuration binds all four branch flags and versions without retaining credential values',()=>{
  const branch='codex/test',project={id:pins.projectId,accountId:pins.teamId,autoAssignCustomDomains:false,nodeVersion:'24.x'};
  const values={VITE_FCOS_ENABLE_FCUNO_OIDC:'true',FCOS_ENABLE_FCUNO_FEDERATION:'true',FCUNO_IDENTITY_ISSUER:'https://fcuno.com',FCOS_ENABLE_READ_ONLY_CI:'true'};
  const rows=Object.entries(values).map(([key,value],id)=>({id:`env_${id}`,key,value,type:'plain',gitBranch:branch,target:['preview'],updatedAt:123}));
  rows.push({id:'private',key:'SECRET',value:'NEVER_RETAIN_THIS',type:'encrypted',gitBranch:branch,target:['preview'],updatedAt:123});
  const original=bootstrapSuccessorConfiguration({project,rows,branch});assert.ok(!JSON.stringify(original).includes('NEVER_RETAIN_THIS'));
  rows.at(-1).value='CHANGED_PRIVATE_VALUE';assert.deepEqual(bootstrapSuccessorConfiguration({project,rows,branch}),original);
  rows.at(-1).updatedAt=124;assert.notEqual(digest(bootstrapSuccessorConfiguration({project,rows,branch})),digest(original));
  rows.find(r=>r.key==='FCOS_ENABLE_READ_ONLY_CI').value='false';assert.throws(()=>bootstrapSuccessorConfiguration({project,rows,branch}),/PUBLIC_CONFIGURATION_REQUIRED/);
});


test('source-owned reconciliation factory qualifies executing source but cannot submit, claim, observe or admit after old config/PR drift',async()=>{
  const f=await successorFixture(),directory=join(f.directory,'executing');mkdirSync(directory);writeFileSync(join(directory,'package-lock.json'),'{"lockfileVersion":3}');
  writeFileSync(join(directory,'vercel.json'),'{"git":{"deploymentEnabled":false}}');
  const run=args=>execFileSync('git',args,{cwd:directory,stdio:'pipe',encoding:'utf8'});run(['init','-q']);run(['remote','add','origin',`https://github.com/${pins.repository}.git`]);run(['add','.']);run(['-c','user.name=FCOS offline fixture','-c','user.email=fixture@example.invalid','commit','-qm','Offline executing fixture']);
  const snapshot=sourceSnapshot(directory),executing=createBootstrapSuccessorPlan({...f.successor,bootstrapPlan:f.plan,controllerSha:snapshot.sha,sourceDigest:snapshot.sourceDigest,lockDigest:snapshot.lockDigest,quality:{checkRunId:310,runId:311,jobId:312},configurationDigest:digest({changed:true}),revision:2});
  const child=createRequire(import.meta.url)('node:child_process'),original=child.execFileSync,calls=[];
  const fake=(binary,args,options)=>{
    if(binary==='git')return original(binary,args,options);calls.push([binary,args]);
    if(binary.endsWith('/gh')){const path=args[1];let row;
      const sha=path.includes('/310')||path.includes('/311')||path.includes('/312')?snapshot.sha:f.successor.controllerSha;
      if(path==='/user')row=owner;
      else if(path===`/repos/${pins.repository}`)row=f.repo;
      else if(path.includes('/check-runs/')){const id=Number(path.split('/').at(-1));row={id,app:{id:15368},head_sha:sha,status:'completed',conclusion:'success',details_url:`https://github.com/${pins.repository}/actions/runs/${id+1}/job/${id+2}`};}
      else if(path.includes('/actions/runs/')){const id=Number(path.split('/').at(-1));row={id,head_sha:sha,repository:f.repo,head_repository:f.repo,event:'pull_request',path:'.github/workflows/quality.yml'};}
      else if(path.includes('/actions/jobs/')){const id=Number(path.split('/').at(-1));row={id,run_id:id-1,head_sha:sha,name:'code-and-database',status:'completed',conclusion:'success'};}
      else if(path.includes('/contents/vercel.json'))row=blob(Buffer.from('{"git":{"deploymentEnabled":false}}'));
      else if(path.includes('/compare/'))row={status:'ahead',merge_base_commit:{sha:f.plan.controllerSha},base_commit:{sha:f.plan.controllerSha},total_commits:1};
      else if(path.includes('/git/commits/')){const id=path.split('/').at(-1);row={sha:id,tree:{sha:(id===f.plan.controllerSha?'2':'3').repeat(40)}};}
      else if(path.includes('/git/trees/')){const old=path.includes('2'.repeat(40));row={sha:(old?'2':'3').repeat(40),truncated:false,tree:[{type:'blob',path:'api/safety.js',mode:'100644',sha:(old?'4':'5').repeat(40)}]};}
      else if(path.endsWith('/pulls/124'))row={number:124,state:'open',base:{repo:f.repo,ref:'main'},head:{repo:f.repo,ref:f.plan.branch,sha:snapshot.sha}};
      else if(path.includes('/git/ref/heads/'))row={object:{sha:snapshot.sha}};
      else throw Error('Unexpected offline route');return JSON.stringify(row);
    }
    assert.ok(binary.endsWith('/vercel'));if(args[0]==='--version')return'54.20.1';if(args[0]==='whoami')return pins.vercelAccount;
    if(args[1].startsWith('/v2/teams/'))return JSON.stringify({id:pins.teamId,slug:pins.team});
    if(args[1].startsWith('/v9/projects/'))return JSON.stringify({id:pins.projectId,accountId:pins.teamId,autoAssignCustomDomains:false,link:{type:'github',repoId}});
    throw Error('Unexpected offline Vercel route');
  };
  try{mock.method(child,'execFileSync',fake);syncBuiltinESMExports();
    const native=await createBootstrapSuccessorReconciliationNative({bootstrapPlan:f.plan,successorPlan:f.successor,executingPlan:executing,cwd:directory});
    assert.equal(native.source.sha,snapshot.sha);assert.ok(calls.some(([,args])=>args[1]?.includes('/check-runs/310')));assert.ok(calls.some(([,args])=>args[1]?.includes('/check-runs/110')));
    assert.ok(!calls.some(([,args])=>args[1]?.includes('/env?')),'Old configuration is never demanded for terminal-only clients');
    for(const operation of[claimBootstrapSuccessor,submitBootstrapSuccessor,observeBootstrapSuccessor,qualifyBootstrapSuccessor,verifyBootstrapSuccessorAdmission])await assert.rejects(operation({...f.context,vercel:native.vercel}),/RECONCILIATION_ONLY/);
    await assert.rejects(native.vercel.create({}),/RECONCILIATION_ONLY/);await assert.rejects(native.vercel.configuration(f.plan.branch),/RECONCILIATION_ONLY/);
    assert.ok(calls.every(([,args])=>!args.includes('POST')),'Factory/readback mode sends zero provider mutations');
  }finally{mock.restoreAll();syncBuiltinESMExports();await f.close();}
});
