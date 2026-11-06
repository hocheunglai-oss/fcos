import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { targets,digest,createManifest } from '../scripts/lib/rapid-release/contract.mjs';
import { readBootstrapDatabase,claimBootstrap,createBootstrapPlan,bootstrapRequest,BOOTSTRAP_ENVIRONMENT } from '../scripts/lib/rapid-release/bootstrap.mjs';
import { verifyBootstrapAdmission,verifyLockedBootstrap,assertNativeBootstrapAdmission } from '../scripts/lib/rapid-release/bootstrap-admission.mjs';

import { auditHandover, applyHandover, createHandoverPlan, handoverDigest, withHandoverReadOnlyTransaction } from '../scripts/lib/rapid-release/handover.mjs';
import { createHandoverAdapter, readHandoverArtifactArchive } from '../scripts/lib/rapid-release/handover-adapter.mjs';
import { readonlyRoleProvisioningSql, createReadonlyRoleVerifier } from '../scripts/lib/rapid-release/readonly-database.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite'), pins=targets(), owner={id:7,login:pins.account}, repoId=1278654816;
const blob = bytes => ({type:'file',encoding:'base64',content:bytes.toString('base64'),sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')});
async function fixture({complete=true}={}) {
  const pg=new PGlite(), directory=mkdtempSync(join(tmpdir(),'fcos-bootstrap-admission-'));
  await pg.exec(`create role anon;create role authenticated;create role service_role;create role fcos_coordinator_runtime;create role fcos_coordinator_owner;
   grant fcos_coordinator_owner to postgres;create schema fcos_release_coordination authorization fcos_coordinator_owner;
   create table fcos_release_coordination.control(singleton boolean primary key,epoch bigint,operation_id text,mode text,bootstrap_id text,recovery_id text,plan_completion_id text,source_upgrade_id text);
   insert into fcos_release_coordination.control values(true,1,null,'qualification',null,null,null,null);
   create table fcos_release_coordination.operations(operation_id text,phase text);create table fcos_release_coordination.operation_events(event_id bigint,operation_id text,state text);
   insert into fcos_release_coordination.operations values('old-unknown','preview.create');
   create function fcos_release_coordination.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'APPEND_ONLY';end$$;`);
  const queries=[], query=pg.query.bind(pg), db={query:async(text,parameters)=>{queries.push(text);return (text.startsWith('-- One-time') || text.startsWith('-- Controller-only'))?(await pg.exec(text)).at(-1):query(text,parameters);}};
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

async function handoverFixture() {
  const f=await fixture(), admission=await f.verify(); let plan, admissions=0, created=null;
  const github={...f.github,
    identity:async()=>({login:pins.account,repository:pins.repository}),execution:async()=>({runId:100,jobId:101}),
    verifyNativePlan:async()=>{},eventSubscribers:async()=>({inventory:[],evidenceDigest:'d'.repeat(64)}),
    rapidJournalAudit:async()=>({digest:'e'.repeat(64),unresolvedProduction:0}),activeHandover:async()=>null,
    bootstrapAdmission:async()=>{admissions++;return f.verify();},
    pages:async()=>[],get:async path=>{
      if(path.includes('/contents/'))return{type:'file',sha:'f'.repeat(40)};
      if(path.includes('/actions/variables/'))return{value:'false'};
      if(path.includes('/actions/workflows/'))return null;
      if(path.endsWith('/approvals'))return[{id:90,state:'approved',user:owner,environments:[{id:1}]}];
      if(path.includes('/environments/'))return{id:1,can_admins_bypass:false,protection_rules:[{type:'required_reviewers',reviewers:[{reviewer:owner}]}]};
      if(path.includes('/actions/jobs/'))return{id:101,run_id:100,status:'in_progress',name:'handover-apply'};
      return{id:100,head_sha:f.plan.controllerSha,event:'workflow_dispatch',status:'in_progress',actor:owner,repository:{full_name:pins.repository},path:'.github/workflows/fcos-rapid-handover.yml'};
    },
    qualification:async()=>({runId:100,planHash:handoverDigest(plan),controllerSha:plan.controllerSha,candidateSha:plan.candidateSha,buildId:plan.buildId,artifactDigest:plan.artifactDigest,
      deploymentId:'dpl_staged',browser:{passed:true,login:true,restrictedAccess:true,normalRole:true,businessWrites:0,deploymentId:'dpl_staged',buildId:plan.buildId}}),
    findDeployment:async()=>created,createDeployment:async body=>(created={id:200,creator:owner,payload:body.payload}),
  };
  const vercel={...f.vercel,deployment:async()=>({id:'dpl_staged',target:'production',readyState:'READY',projectId:pins.projectId,ownerId:pins.teamId,aliasAssigned:false,
    meta:{githubCommitSha:plan.candidateSha,fcosRapidBuildId:plan.buildId,fcosRapidArtifactDigest:plan.artifactDigest,fcosHandoverPlanHash:handoverDigest(plan)}})};
  const input={db:f.db,connection:f.connection,github,vercel},audit=await auditHandover(input);
  const options={audit,controllerSha:f.plan.controllerSha,candidateSha:'b'.repeat(40),buildId:'c'.repeat(64),artifactDigest:'d'.repeat(64),handoverId:'bootstrap-handover-fixture',bootstrapAdmission:admission,bootstrapPlan:f.plan};
  plan=createHandoverPlan(options);
  return{...f,input,admission,options,audit,get handoverPlan(){return plan;},set handoverPlan(value){plan=value;},get admissions(){return admissions;},apply:phase=>applyHandover({...input,plan,phase})};
}

test('native initial bootstrap provenance binds the actual frozen preimage and cannot be replaced by JSON or a successor',async()=>{
  const f=await handoverFixture();try{
    assert.equal(f.handoverPlan.controlPreimage.mode,'frozen');assert.deepEqual(f.handoverPlan.bootstrap.reference,f.admission.reference);
    assert.throws(()=>createHandoverPlan({...f.options,bootstrapAdmission:JSON.parse(JSON.stringify(f.admission))}),/NATIVE_CAPABILITY_REQUIRED/);
    assert.throws(()=>createHandoverPlan({...f.options,bootstrapAdmission:undefined,bootstrapPlan:undefined}),/QUIESCENT_QUALIFICATION_REQUIRED/);
    assert.throws(()=>createHandoverPlan({...f.options,bootstrapPlan:{...f.plan,inventoryDigest:'0'.repeat(64)}}),/BOOTSTRAP_PREIMAGE_MISMATCH/);
    assert.throws(()=>createHandoverPlan({...f.options,audit:{...f.audit,database:{...f.audit.database,control:{...f.audit.database.control,epoch:2}}}}),/BOOTSTRAP_PREIMAGE_MISMATCH/);
    const parent={handover_id:'prior-handover-fixture',phase:'finalized',plan_hash:'1'.repeat(64),receipt_id:300,evidence:{controllerSha:'f'.repeat(40)}};
    const activeHandover={handoverId:parent.handover_id,planHash:parent.plan_hash,databaseReceiptId:parent.receipt_id,controllerSha:parent.evidence.controllerSha,nativeCoordinatorReadbackDigest:handoverDigest(parent.evidence)};
    assert.throws(()=>createHandoverPlan({...f.options,audit:{...f.audit,database:{...f.audit.database,receipts:[parent]},providers:{...f.audit.providers,activeHandover}}}),/BOOTSTRAP_INITIAL_ONLY/);
    await assert.rejects(applyHandover({...f.input,plan:{...f.handoverPlan,supersedes:{controllerSha:'0'.repeat(40)}},phase:'prepare'}),/PLAN_TARGET_MISMATCH/);
    assert.equal((await f.pg.query("select to_regclass('fcos_release_coordination.rapid_handover_receipts') as receipt")).rows[0].receipt,null);
  }finally{await f.close();}
});

test('bootstrap prepare and abort re-read full native proof, append receipts and permanently preserve frozen ownership',async()=>{
  const f=await handoverFixture();try{
    const before=f.queries.length;assert.equal((await f.apply('prepare')).state,'frozen');assert.equal(f.admissions,1);
    f.artifact.expired=true;await assert.rejects(f.apply('abort'),/AUTHENTICATED_ARTIFACT_REQUIRED/);f.artifact.expired=false;
    assert.equal((await f.apply('abort')).state,'frozen');assert.equal(f.admissions,3);
    assert.ok(!f.queries.slice(before).some(sql=>/^update fcos_release_coordination.control/i.test(sql)));
    assert.equal((await f.pg.query('select mode from fcos_release_coordination.control')).rows[0].mode,'frozen');
    await assert.rejects(f.pg.query("update fcos_release_coordination.control set mode='qualification'"),/BOOTSTRAP.*FENCED/);
    const rows=(await f.pg.query('select phase,evidence from fcos_release_coordination.rapid_handover_receipts order by receipt_id')).rows;
    assert.deepEqual(rows.map(row=>row.phase),['prepared','aborted']);assert.deepEqual(rows[1].evidence.bootstrap,f.admission.reference);
    assert.equal((await f.pg.query('select count(*)::int as count from fcos_release_coordination.rapid_bootstrap_receipts')).rows[0].count,4);
  }finally{await f.close();}
});

test('each bootstrap apply requires unchanged browser/native reference and rechecks actual guard under the lock before DDL',async()=>{
  const f=await handoverFixture();try{
    const original=f.input.github.bootstrapAdmission;
    f.input.github.bootstrapAdmission=async()=>JSON.parse(JSON.stringify(f.admission));await assert.rejects(f.apply('prepare'),/NATIVE_CAPABILITY_REQUIRED/);
    f.input.github.bootstrapAdmission=original;f.artifact.digest=`sha256:${'0'.repeat(64)}`;await assert.rejects(f.apply('prepare'),/ARTIFACT_DIGEST/);
    f.artifact.digest=`sha256:${digest(f.archive)}`;
    const query=f.db.query;f.db.query=async(text,parameters)=>{const result=await query(text,parameters);
      if(text==='lock table fcos_release_coordination.control in share row exclusive mode')await f.pg.query('alter table fcos_release_coordination.control disable trigger rapid_bootstrap_control_guard');return result;};
    await assert.rejects(f.apply('prepare'),/GUARD_CHANGED/);
    assert.equal((await f.pg.query("select to_regclass('fcos_release_coordination.rapid_handover_receipts') as receipt")).rows[0].receipt,null);
    assert.equal((await f.verify()).controlPreimage.mode,'frozen','Rejected transaction rolled back native tampering.');
  }finally{await f.close();}
});

test('bootstrap finalize retains the real staged qualification boundary and idempotent permanent receipt',async()=>{
  const f=await handoverFixture();try{
    await f.apply('prepare');const qualification=f.input.github.qualification;
    f.input.github.qualification=async()=>({...await qualification(),browser:{passed:true}});
    await assert.rejects(f.apply('finalize'),/REAL_STAGED_QUALIFICATION_REQUIRED/);f.input.github.qualification=qualification;
    const final=await f.apply('finalize');assert.equal(final.deploymentId,200);assert.equal(f.admissions,3);
    assert.equal((await f.apply('finalize')).reused,true);assert.equal(f.admissions,4);
    assert.equal((await f.pg.query('select mode from fcos_release_coordination.control')).rows[0].mode,'frozen');
    assert.equal((await f.pg.query("select count(*)::int as count from fcos_release_coordination.rapid_handover_receipts where phase='finalized'")).rows[0].count,1);
  }finally{await f.close();}
});

test('initial handover atomically grants the existing metadata reader access without business authority',async()=>{
  const f=await handoverFixture();try{
    await f.pg.exec(readonlyRoleProvisioningSql(createReadonlyRoleVerifier(Buffer.from('synthetic-fixture-password-0123456789'))));
    await f.apply('prepare');
    await f.pg.exec(`set session authorization ${fcosConnectionIdentifier('supabase','Database release read-only role')}`);
    assert.equal((await f.pg.query('select phase from fcos_release_coordination.rapid_handover_receipts')).rows[0].phase,'prepared');
    await assert.rejects(f.pg.query("update fcos_release_coordination.control set mode='qualification'"),/permission denied/);
    await assert.rejects(f.pg.query("insert into fcos_release_coordination.rapid_handover_receipts(handover_id,phase,plan_hash,evidence) values('foreign-receipt','prepared','"+'a'.repeat(64)+"','{}')"),/permission denied/);
  }finally{await f.close();}
});

test('artifact download is pinned, bounded and never forwards GitHub credentials to signed storage',async()=>{
  const path=`/repos/${pins.repository}/actions/artifacts/70/zip`,calls=[],bytes=Buffer.from('fixture zip');
  const fetchImpl=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://productionresultssa42.blob.core.windows.net/archive/signed?sig=private'}}):new Response(bytes);};
  assert.deepEqual(await readHandoverArtifactArchive({path,token:'fixture-private',fetchImpl}),bytes);
  assert.equal(calls[0].options.headers.authorization,'Bearer fixture-private');assert.equal(calls[1].options.headers,undefined);assert.equal(calls[1].options.redirect,'error');
  await assert.rejects(readHandoverArtifactArchive({path:'/repos/other/repo/actions/artifacts/70/zip',token:'fixture',fetchImpl}),/TARGET_MISMATCH/);
  for(const location of ['https://attacker.invalid/archive','http://productionresultssa42.blob.core.windows.net/archive','https://user:secret@productionresultssa42.blob.core.windows.net/archive']){
    let count=0;await assert.rejects(readHandoverArtifactArchive({path,token:'fixture',fetchImpl:async()=>{count++;return new Response(null,{status:302,headers:{location}});}}),/DOWNLOAD_REFUSED/);assert.equal(count,1);
  }
  for(const response of [()=>new Response(new Uint8Array(2097153)),()=>new Response(bytes,{headers:{'content-length':'2097153'}}),()=>new Response(null,{status:307,headers:{location:'https://attacker.invalid'}})])
    await assert.rejects(readHandoverArtifactArchive({path,token:'fixture',fetchImpl:async()=>response()}),/DOWNLOAD_REFUSED/);
});

test('adapter initial context and persisted bootstrap plan invoke fresh native proof inside real identity-verified read-only transactions',async()=>{
  const f=await fixture();try{
    const manifest=createManifest({candidate:{sha:f.plan.controllerSha,sourceDigest:f.plan.sourceDigest,lockDigest:f.plan.lockDigest},controllerSha:f.plan.controllerSha,
      previous:{deploymentId:'dpl_old',sha:'d'.repeat(40),schemaDigest:'a'.repeat(64),configurationDigest:'b'.repeat(64)},paths:['src/pages/Dashboard.jsx'],
      publicEnvironment:{VITE_SUPABASE_URL:`https://${pins.supabaseProject}.supabase.co`,VITE_SUPABASE_PUBLISHABLE_KEY:`sb_publishable_${'p'.repeat(25)}`},releaseId:'bootstrap-adapter-fixture'});
    writeFileSync(join(f.directory,'manifest.json'),JSON.stringify(manifest));
    const report={schemaVersion:1,mode:'administrator-reviewed-native',account:pins.account,repository:pins.repository,collectedAt:new Date().toISOString(),scope:'all_repository_installations',source:'github_repository_settings_and_configure_pages',evidenceDigest:'a'.repeat(64),
      entries:[{installationId:1,appId:2,name:'Fixture',events:[],permissions:{metadata:'read'},repositoryScope:{selection:'selected',repository:pins.repository},configurationState:'current',disposition:'read-only',evidenceDigest:'b'.repeat(64)}]};
    const fetchImpl=async url=>{const path=new URL(url).pathname+new URL(url).search;
      if(path==='/user')return Response.json(owner);if(path==='/users/github-actions%5Bbot%5D')return Response.json({login:'github-actions[bot]',id:8});
      if(path.endsWith('/zip'))return new Response(f.archive);
      if(path.includes('/deployments?')||path.includes('/statuses?'))return Response.json(await f.github.pages(path));
      return Response.json(await f.github.read(path));};
    const provider={...f.vercel,previewDeployment:id=>f.vercel.deployment(id)};
    const adapter=await createHandoverAdapter({db:f.db,connection:f.connection,applicationInventoryReport:report,bootstrapContext:{bootstrapPlan:f.plan,authenticationRunId:50},fetchImpl,providerFactory:()=>provider,
      env:{FCOS_RAPID_HANDOVER_GITHUB_TOKEN:'fixture-token-long',GITHUB_REPOSITORY:pins.repository,FCOS_HANDOVER_ARTIFACT_DIRECTORY:f.directory}});
    const admission=await adapter.github.bootstrapAdmission();assertNativeBootstrapAdmission(admission,{controllerSha:f.plan.controllerSha});
    assert.ok(f.queries.includes('begin isolation level repeatable read read only'));
    const reference=admission.reference;await adapter.github.bootstrapAdmission({plan:{controllerSha:f.plan.controllerSha,bootstrap:{plan:f.plan,reference}}});
    await assert.rejects(withHandoverReadOnlyTransaction({db:f.db,connection:{...f.connection,user:'service_role'}},db=>verifyLockedBootstrap({db,bootstrapPlan:f.plan,controllerSha:f.plan.controllerSha})),/PINNED_TLS/);
    assert.equal((await f.pg.query('select mode from fcos_release_coordination.control')).rows[0].mode,'frozen');
  }finally{await f.close();}
});

