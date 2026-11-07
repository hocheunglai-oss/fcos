import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { targets,digest } from '../scripts/lib/rapid-release/contract.mjs';
import { readBootstrapDatabase,claimBootstrap,createBootstrapPlan,bootstrapRequest,BOOTSTRAP_ENVIRONMENT } from '../scripts/lib/rapid-release/bootstrap.mjs';
import { verifyBootstrapAdmission,verifyLockedBootstrap,assertNativeBootstrapAdmission } from '../scripts/lib/rapid-release/bootstrap-admission.mjs';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite'), pins=targets(), owner={id:7,login:pins.account}, repoId=1278654816;
const blob = bytes => ({type:'file',encoding:'base64',content:bytes.toString('base64'),sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')});
async function fixture({complete=true}={}) {
  const pg=new PGlite(), directory=mkdtempSync(join(tmpdir(),'fcos-bootstrap-admission-'));
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
  const f={pg,db,queries,plan,payload,archive,directory,repo:{id:repoId,full_name:pins.repository,owner,default_branch:'main'},reads:0};
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

test('initial handover admits the actual frozen postimage after merge with independent protected browser evidence',async()=>{
  const f=await fixture();try{
    const admission=await f.verify();assert.equal(admission.controlPreimage.mode,'frozen');
    assert.equal(admission.reference.authentication.artifactId,70);assert.equal(admission.reference.bootstrap.deploymentId,'dpl_preview');
    assert.equal(assertNativeBootstrapAdmission(admission,{controllerSha:f.plan.controllerSha}),admission.reference);
    assert.throws(()=>assertNativeBootstrapAdmission(JSON.parse(JSON.stringify(admission)),{controllerSha:f.plan.controllerSha}),/NATIVE_CAPABILITY_REQUIRED/);
    assert.throws(()=>assertNativeBootstrapAdmission(admission,{controllerSha:f.plan.controllerSha,now:admission.verifiedAt+60001}),/NATIVE_CAPABILITY_REQUIRED/);
    await f.pg.exec('create table fcos_release_coordination.rapid_handover_receipts(handover_id text);insert into fcos_release_coordination.rapid_handover_receipts values(\'own-reviewed-handover\')');
    const offset=f.queries.length,locked=await f.readDatabase(db=>verifyLockedBootstrap({db,bootstrapPlan:f.plan,controllerSha:f.plan.controllerSha,reference:admission.reference}));
    assert.equal(locked.controlPreimage.mode,'frozen');assert.ok(f.queries.slice(offset).every(sql=>sql.startsWith('select ')),'Locked verifier must never begin/commit/write.');
    assert.equal((await f.pg.query('select mode from fcos_release_coordination.control')).rows[0].mode,'frozen');
  }finally{await f.close();}
});

test('cached JSON reader flags, forged source/reference and incomplete bootstrap phases cannot grant admission',async()=>{
  const f=await fixture();try{
    await assert.rejects(verifyBootstrapAdmission({...f.input,readDatabase:async()=>({verified:true})}),/NATIVE_DATABASE_READER_REQUIRED/);
    await assert.rejects(verifyBootstrapAdmission({...f.input,controllerSha:'0'.repeat(40)}),/SOURCE_MISMATCH/);
    const admission=await f.verify();await assert.rejects(f.readDatabase(db=>verifyLockedBootstrap({db,bootstrapPlan:f.plan,controllerSha:f.plan.controllerSha,reference:{bootstrap:{...admission.reference.bootstrap,operationId:'foreign'}}})),/REFERENCE_MISMATCH/);
  }finally{await f.close();}
  const incomplete=await fixture({complete:false});try{await assert.rejects(incomplete.verify(),/RECEIPTS_INVALID/);assert.equal(incomplete.reads,0);}finally{await incomplete.close();}
});

test('every old unknown/history row and permanent guard remain required',async()=>{
  const f=await fixture();try{
    await f.pg.query("insert into fcos_release_coordination.operations values('new-unknown','preview.create')");await assert.rejects(f.verify(),/HISTORY_OR_PHASE_CHANGED/);
  }finally{await f.close();}
  const guard=await fixture();try{await guard.pg.query('alter table fcos_release_coordination.control disable trigger rapid_bootstrap_control_guard');await assert.rejects(guard.verify(),/GUARD_CHANGED/);}finally{await guard.close();}
});

test('missing native journal, fake bot and changed live alias are rejected without mutation',async()=>{
  const f=await fixture();try{
    const original=f.journal;f.journal=[];await assert.rejects(f.verify(),/NATIVE_JOURNAL_REQUIRED/);f.journal=original;
    f.bot='some-owner';await assert.rejects(f.verify(),/GENUINE_PREVIEW_REQUIRED/);f.bot=null;
    f.alias='dpl_changed';await assert.rejects(f.verify(),/PREVIEW_OR_ALIAS_CHANGED/);
  }finally{await f.close();}
});

test('browser job/review/artifact must be native, successful, exact and digest verified',async()=>{
  const f=await fixture();try{
    f.run.conclusion='failure';await assert.rejects(f.verify(),/AUTHENTICATED_PRODUCER_REQUIRED/);f.run.conclusion='success';
    const reviews=f.reviews;f.reviews=[];await assert.rejects(f.verify(),/human environment approval/);f.reviews=reviews;
    f.artifact.expired=true;await assert.rejects(f.verify(),/AUTHENTICATED_ARTIFACT_REQUIRED/);f.artifact.expired=false;
    f.artifact.digest=`sha256:${'0'.repeat(64)}`;await assert.rejects(f.verify(),/ARTIFACT_DIGEST/);
    f.artifact.digest=`sha256:${digest(f.archive)}`;f.artifact.workflow_run.head_sha='0'.repeat(40);await assert.rejects(f.verify(),/AUTHENTICATED_ARTIFACT_REQUIRED/);
    f.artifact.workflow_run.head_sha=f.run.head_sha;writeFileSync(join(f.directory,'fcos-ci-evidence.json'),JSON.stringify({...f.payload,candidateSha:'0'.repeat(40)}));
    execFileSync('/usr/bin/zip',['-q','wrong.zip','fcos-ci-evidence.json'],{cwd:f.directory});f.archive=readFileSync(join(f.directory,'wrong.zip'));f.artifact.digest=`sha256:${digest(f.archive)}`;
    await assert.rejects(f.verify(),/AUTHENTICATED_ARTIFACT_BINDING/);
  }finally{await f.close();}
});
