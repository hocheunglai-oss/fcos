import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { createNotificationChallenge, createNotificationDeliveryProof } from '../supabase/functions/release-coordinator/core.mjs';
import { runQualification, publishQualificationArtifact } from '../scripts/hosted-release-qualification.mjs';
import { preparePreview, executeHostedProduction } from '../scripts/lib/hosted-release/controller.mjs';
import { CONTRACT_VERSION, CONTROLLER_WORKFLOW, REQUIRED_LIVE_CHECKS, NORMAL_MODULES, WRITE_PHASES, digest, releaseTargets } from '../scripts/lib/hosted-release/contract.mjs';
import { createCoordinatorHandler, createSqlStore, createGithubAuthenticator, createGithubApprovalValidator, createGithubResumeValidator } from '../supabase/functions/release-coordinator/index.ts';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';
import { vercelReadFixture } from './helpers/hosted-vercel-read.mjs';
const H='a'.repeat(64),S='b'.repeat(40),repository='hocheunglai-oss/fcos';
const runtime={flags:{},safety:{readOnly:false},auth:{}};
function manifest(releaseId,qualification=false){return{schemaVersion:2,contract:CONTRACT_VERSION,releaseId,epoch:1,stage:qualification?'qualification':'application',executionMode:qualification?'qualification':'release',
 targets:releaseTargets(),candidate:{sha:S,branch:'codex/rehearsal',sourceProfile:'application_v2',sourceSha256:H,lockSha256:H,configurationSha256:H,salesforceSourceSha256:H},
 controller:{sha:S,workflow:CONTROLLER_WORKFLOW,checkManifestSha256:H,configurationSha256:H},
 scope:{sha256:H,financialAuthority:false,existingUi:false,handoffs:qualification?[]:[{kind:'status19',sha256:H},{kind:'supplier16',sha256:H}],compatibilityProductionObservationSha256:H},
 previousProduction:{deploymentId:'dpl_previous',sha:'c'.repeat(40),sourceSha256:H,schemaSha256:H,runtimeSha256:digest(runtime)},
 requiredChecks:[...REQUIRED_LIVE_CHECKS,...(qualification?[]:['compatibility_production_observation'])],
 authorization:{validitySeconds:86400,actions:WRITE_PHASES,rollback:{mode:'compatible_previous_only',schemaRollback:false}},
 migration:{mode:'none',expectedSchemaSha256:H},runtime:{expectedSha256:digest(runtime),expectedProduction:runtime,expectedPreview:{...runtime,safety:{readOnly:true}}},changes:['Local rehearsal only'],
 ...(qualification?{verification:{runtime:{image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},publicBuildEnvironment:{},projectSettings:{},vercelReadCredential:vercelReadFixture().binding}}:{})};}
const binaries=spawnSync('pg_config',['--bindir'],{encoding:'utf8'}),bindir=binaries.status===0?binaries.stdout.trim():null;
function proof(m,id,{stale=false}={}){return{schemaVersion:2,checkId:id,status:'passed',kind:'volatile',maxAgeSeconds:1800,manifestHash:digest(m),candidateSha:m.candidate.sha,controllerSha:m.controller.sha,
 inputsSha256:H,artifactSha256:H,capturedAt:new Date(Date.now()-(stale?3600000:0)).toISOString(),publisher:{trust:'hosted_controller',runId:101,jobId:201},
 result:id==='normal_role'?{actualData:true,unexpectedWrites:0,modules:NORMAL_MODULES}:id==='restricted_browser'?{identity:'restricted',unexpectedWrites:0}:id==='server_performance'?{serverBundlesRequired:true}:{localRehearsal:true}};}

// These fixture routes are the only Vercel boundary. No real Vercel credential/URL is used.
function fakeVercel(m){
 const deployments=new Map(),effects={preview:0,stage:0,promote:0,rollback:0,reads:0,readsAtLostRollback:null},previous={id:m.previousProduction.deploymentId,sha:m.previousProduction.sha,
 target:'production',projectId:m.targets.vercelProject,teamId:m.targets.vercelTeam,state:'READY',url:'https://previous.vercel.app'};
 deployments.set(previous.id,previous);let current=previous,crashStage=false,readUnavailable=false,failLive=false,rollbackLost=false;
 async function api(method,route,body){
  if(method==='GET')effects.reads++;
  if(route==='/deployments'&&method==='POST'){
   const key=body.target==='preview'?'preview':'stage';effects[key]++;const id=`dpl_${key}${effects[key]}`;
   const deployment={id,sha:m.candidate.sha,target:body.target,projectId:m.targets.vercelProject,teamId:m.targets.vercelTeam,state:'READY',url:`https://${key}${effects[key]}.vercel.app`,operationId:body.operationId,manifestHash:digest(m)};
   deployments.set(id,deployment);if(key==='stage'&&crashStage){crashStage=false;readUnavailable=true;throw new Error('simulated runner crash after accepted API write');}return deployment;
  }
  if(route==='/deployments'&&method==='GET'){
   if(readUnavailable)throw new Error('simulated read unavailable');const matches=[...deployments.values()].filter(d=>d.operationId===body.operationId);return matches.length===1?{outcome:'applied',result:matches[0]}:{outcome:'unknown'};
  }
  if(route==='/current'&&method==='GET')return current;
  if(route==='/promote'&&method==='POST'){effects.promote++;current=deployments.get(body.id);return current;}
  if(route==='/rollback'&&method==='POST'){effects.rollback++;current=previous;if(rollbackLost){rollbackLost=false;effects.readsAtLostRollback=effects.reads;throw new Error('simulated lost rollback response');}return current;}
  throw new Error('Unexpected fake Vercel route');
 }
 const provider={admit:async()=>{},createPreview:async(_,c)=>api('POST','/deployments',{target:'preview',operationId:c.operationId}),
 stage:async(_,c)=>api('POST','/deployments',{target:'production',operationId:c.operationId}),discover:async(_,__,c)=>api('GET','/deployments',c),
 ready:async d=>deployments.get(d.id),verifyArtifact:async(_,__,phase)=>{if(phase==='live'&&failLive)throw Object.assign(new Error('fixture public readback failure'),{code:'LOCAL_READBACK_FAILURE'});},
 currentProduction:async()=>api('GET','/current'),promote:async d=>api('POST','/promote',d),rollback:async()=>api('POST','/rollback'),
 rollbackCompatibility:async()=>({compatible:true,deploymentId:previous.id,schemaSha256:H,runtimeSha256:m.runtime.expectedSha256}),verifyRollback:async d=>{assert.equal(d.id,previous.id);}};
 return{provider,effects,setFaults:v=>{if(v.crashStage!==undefined)crashStage=v.crashStage;if(v.readUnavailable!==undefined)readUnavailable=v.readUnavailable;if(v.failLive!==undefined)failLive=v.failLive;if(v.rollbackLost!==undefined)rollbackLost=v.rollbackLost;}};
}

test('local rehearsal: native PostgreSQL, signed OIDC, real endpoint/client/controller, delayed gate, crash recovery and rollback',
 {skip:!bindir&&process.env.FCOS_REQUIRE_NATIVE_COORDINATOR_DATABASE!=='1'},async t=>{
 assert.ok(bindir,'Native PostgreSQL is required for the coordinator rehearsal gate.');
 const directory=await mkdtemp(path.join(tmpdir(),'fcos-qualification-pg-')),data=path.join(directory,'data'),port=54596;
 execFileSync(path.join(bindir,'initdb'),['-D',data,'--username=postgres','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
 execFileSync(path.join(bindir,'pg_ctl'),['-D',data,'-l',path.join(directory,'server.log'),'-o',`-k ${directory} -h '' -p ${port}`,'-w','start'],{stdio:'pipe'});
 const pool=new pg.Pool({host:directory,port,user:'postgres',database:'postgres',max:8});
 t.after(async()=>{await pool.end();execFileSync(path.join(bindir,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(directory,{recursive:true,force:true});});
 await pool.query(await readFile(new URL('../supabase/migrations/20261016190509_release_coordination.sql',import.meta.url),'utf8'));
 const notificationChallenge=createNotificationChallenge();
 await pool.query('select fcos_release_coordination.install_epoch($1,$2)',[1,{notificationChallenge,inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'legacy',disabled:true,proofHash:H}],uncertainties:[]}]);
 const query=async(sql,values)=>{const c=await pool.connect();try{await c.query('set role fcos_coordinator_runtime');return await c.query(sql,values);}finally{await c.query('reset role');c.release();}};
 const policy={repository,repositoryId:'77',ref:'refs/heads/main',registrationJob:'release / prepare',approvalJobPrefix:'release / production / ',resumeJobPrefix:'release / execute / ',
 workflows:[{callerWorkflowRef:`${repository}/.github/workflows/hosted-release.yml@refs/heads/main`,jobWorkflowRef:`${repository}/${CONTROLLER_WORKFLOW}@${S}`,jobWorkflowSha:S}]};
 const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);jwk.kid='rehearsal';jwk.alg='RS256';
 let identity={runId:'101',sha:S,environment:null},metadata,loseCompletionPhase;
 async function identityToken(){const e=identity.environment;return new SignJWT({repository,repository_id:'77',ref:'refs/heads/main',ref_type:'branch',run_id:identity.runId,run_attempt:'1',sha:identity.sha,workflow_sha:identity.sha,
 workflow_ref:policy.workflows[0].callerWorkflowRef,job_workflow_ref:policy.workflows[0].jobWorkflowRef,job_workflow_sha:S,event_name:'workflow_dispatch',runner_environment:'github-hosted',...(e?{environment:e}:{})})
 .setProtectedHeader({alg:'RS256',kid:'rehearsal'}).setIssuer('https://token.actions.githubusercontent.com').setAudience('fcos-release-coordinator')
 .setSubject(e?`repo:${repository}:environment:${e}`:`repo:${repository}:ref:refs/heads/main`).setJti(crypto.randomUUID()).setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('5m').sign(pair.privateKey);}
 const readGithub=async(url,options)=>{
  assert.equal(options.method,'GET');if(url==='https://api.github.com/user')return Response.json({login:'hocheunglai-oss',id:9});
  const route=url.replace(`https://api.github.com/repos/${repository}`,''),repo={id:77,full_name:repository,default_branch:'main'},actor={id:9,login:'hocheunglai-oss'};
  const envName=identity.environment,id=envName==='fcos-production-release'?81:82,registered=Date.parse(metadata.registered_at),started=new Date(registered+2000).toISOString();
  const jobId=Number(identity.runId)*10;
  const baseJob={run_id:Number(identity.runId),run_attempt:1,head_sha:identity.sha};
  const records={'':repo,'/branches/main':{name:'main',protected:true,commit:{sha:'e'.repeat(40)}},'/branches/main/protection':{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},required_status_checks:{strict:true,checks:['code-and-database','dependency-review','authenticated-browser'].map(context=>({context,app_id:15368}))}},
   [`/environments/${envName}`]:{id,name:envName,can_admins_bypass:false,deployment_branch_policy:{protected_branches:true,custom_branch_policies:false},protection_rules:envName==='fcos-production-release'?[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:actor}]}]:[]},
   [`/actions/runs/${identity.runId}`]:{id:Number(identity.runId),run_attempt:1,status:'in_progress',conclusion:null,event:'workflow_dispatch',repository:repo,head_repository:repo,head_sha:identity.sha,head_branch:'main',path:'.github/workflows/hosted-release.yml',actor,triggering_actor:actor},
   [`/actions/runs/${identity.runId}/attempts/1/jobs?per_page=100`]:{total_count:2,jobs:[{...baseJob,id:jobId+1,name:'release / prepare',status:'completed',conclusion:'success',completed_at:new Date(registered+1000).toISOString()},
    {...baseJob,id:jobId+2,name:`${envName==='fcos-production-release'?policy.approvalJobPrefix:policy.resumeJobPrefix}${metadata.manifestHash}`,status:'in_progress',conclusion:null,started_at:started}]},
   [`/actions/runs/${identity.runId}/approvals`]:[{state:'approved',user:actor,environments:[{id:81,name:'fcos-production-release'}]}]};
  assert.ok(Object.hasOwn(records,route),`Unexpected fixture metadata route ${route}`);return Response.json(records[route]);
 };
 const handler=createCoordinatorHandler({store:createSqlStore(query),authenticateGithub:createGithubAuthenticator({policy,jwks:createLocalJWKSet({keys:[jwk]})}),
  validateApproval:createGithubApprovalValidator({policy,token:'local-read-only-fixture',fetchImpl:readGithub}),validateResume:createGithubResumeValidator({policy,token:'local-read-only-fixture',fetchImpl:readGithub})});
 const client=createCoordinatorClient({url:'http://localhost/coordinator',epoch:1,owner:{kind:'release',id:'features'},tokenProvider:identityToken,fetch:async(url,options)=>{
  const body=JSON.parse(options.body),response=await handler(new Request(url,options));if(body.action==='complete'&&body.payload.phase===loseCompletionPhase){loseCompletionPhase=null;throw new Error('lost committed completion response');}return response;
 }});
 const bind=m=>({releaseId:m.releaseId,manifestHash:digest(m)}),publish=async(m,stale=false)=>{for(const id of m.requiredChecks)await client.appendEvidence({...bind(m),key:id,evidence:proof(m,id,{stale})});};
 const gate=async m=>{metadata={...(await client.snapshot(bind(m))).registrationRun,manifestHash:digest(m)};identity.environment='fcos-production-release';return client.approve(bind(m));};
 const executor=async()=>{identity.environment='fcos-hosted-production-resume';};

 // Qualification waits for real Preview/check evidence; simulator only writes its own durable effects.
 const q=manifest('qualification-rehearsal',true),qv=fakeVercel(q);await client.register({...bind(q),manifest:q});
 assert.equal((await runQualification({manifest:q,coordinator:client,simulateProduction:true,context:'local_rehearsal'})).phase,'qualification.preview');
 await preparePreview({manifest:q,coordinator:client,provider:qv.provider});
 assert.equal((await runQualification({manifest:q,coordinator:client,simulateProduction:true,context:'local_rehearsal'})).status,'waiting_dependency');
 await publish(q);loseCompletionPhase='qualification.stage';
 await assert.rejects(runQualification({manifest:q,coordinator:client,simulateProduction:true,context:'local_rehearsal'}),/RESPONSE_UNKNOWN/);
 const rehearsal=await runQualification({manifest:q,coordinator:client,simulateProduction:true,context:'local_rehearsal'});
 assert.equal(rehearsal.hostedQualification,false);assert.equal(rehearsal.evidenceKey,'local.qualification');assert.equal(qv.effects.preview,1);assert.equal(qv.effects.stage,0);
 const qualified=await client.snapshot(bind(q));assert.equal(qualified.operations['qualification.stage'].state,'complete');
 const notificationDelivery=await createNotificationDeliveryProof({challenge:notificationChallenge,receiptJson:JSON.stringify({...notificationChallenge,device:'iphone',confirmedByHuman:true,receivedAt:new Date().toISOString()})});
 const activation={notificationDelivery,manifestHash:digest(q),evidenceHash:rehearsal.evidenceHash,oldWriterFenceHash:H,allWritersAdmitted:true,writerAdmissions:[{id:'legacy',admitted:true,proofHash:H}]};
 await assert.rejects(pool.query('select fcos_release_coordination.activate($1,$2)',[1,activation]),/HOSTED_QUALIFICATION_REQUIRED/);
 // Actual publisher code with a fake GitHub artifact boundary; this remains a local rehearsal.
 const archivePath=path.join(directory,'qualification.zip'),reportPath=path.join(directory,'qualification.json');let archive;
 const archived=async report=>{await writeFile(reportPath,JSON.stringify(report));await rm(archivePath,{force:true});execFileSync('zip',['-q','-j',archivePath,reportPath]);archive=await readFile(archivePath);};
 const producerRun={id:101,run_attempt:1,repository:{full_name:repository},head_repository:{full_name:repository},head_branch:'main',event:'workflow_dispatch',head_sha:S,
   referenced_workflows:[{path:`${repository}/${CONTROLLER_WORKFLOW}@${S}`,sha:S}]};
 const producerJob={id:204,run_id:101,run_attempt:1,head_sha:S,name:'release / qualify',status:'completed',conclusion:'success',started_at:new Date(Date.parse(rehearsal.capturedAt)-1000).toISOString(),completed_at:new Date(Date.parse(rehearsal.capturedAt)+1000).toISOString(),steps:[{name:'Run admitted checks',status:'completed',conclusion:'success'}]};
 const fakeGithub={read:async(route,options)=>{if(options?.bytes)return archive;assert.equal(route,`/repos/${repository}/actions/runs/101`);return producerRun;},
   pages:async(route,field)=>field==='jobs'?[producerJob]:[{id:999,name:`fcos-${q.releaseId}-qualification`,expired:false,digest:`sha256:${digest(archive)}`,workflow_run:{id:101,head_sha:S},created_at:rehearsal.capturedAt}]};
 await archived(rehearsal);await assert.rejects(publishQualificationArtifact({manifest:q,coordinator:client,github:fakeGithub,runId:101}),/QUALIFICATION_ARTIFACT_REPORT_INVALID/);
 const fixtureHostedReport={...rehearsal,context:'hosted',kind:'fcos_hosted_release_qualification',hostedQualification:true};await archived(fixtureHostedReport);
 const published=await publishQualificationArtifact({manifest:q,coordinator:client,github:fakeGithub,runId:101});assert.equal(published.status,'passed');
 const publishedSnapshot=await client.snapshot(bind(q));assert.equal(publishedSnapshot.checks['hosted.qualification'].actualGithubArtifactValidated,true);
 await pool.query('select fcos_release_coordination.activate($1,$2)',[1,{...activation,evidenceHash:published.evidenceHash}]);

 // A delayed human gate does not authorize stale volatile evidence; the executor waits and refreshes only affected proofs.
 const m=manifest('production-rehearsal'),v=fakeVercel(m);identity.environment=null;
 await preparePreview({manifest:m,coordinator:client,provider:v.provider});await publish(m,true);const approved=await gate(m);await executor();
 assert.equal((await executeHostedProduction({manifest:m,coordinator:client,provider:v.provider,resumeAuthorization:true})).status,'waiting_dependency');assert.equal(v.effects.stage,0);
 await publish(m);v.setFaults({crashStage:true});
 await assert.rejects(executeHostedProduction({manifest:m,coordinator:client,provider:v.provider,resumeAuthorization:true}),/PROVIDER_OUTCOME_UNKNOWN|read unavailable|READ_UNAVAILABLE/);
 assert.equal(v.effects.stage,1);assert.equal((await client.snapshot(bind(m))).operations['production.stage'].state,'uncertain');
 // A new dispatch prepares the same manifest and reconciles the original staged write without another POST or renewed receipt.
 identity={runId:'102',sha:'d'.repeat(40),environment:null};await client.register({...bind(m),manifest:m});
 metadata={...(await client.snapshot(bind(m))).registrationRun,manifestHash:digest(m)};await executor();v.setFaults({readUnavailable:false,failLive:true,rollbackLost:true});
 await assert.rejects(executeHostedProduction({manifest:m,coordinator:client,provider:v.provider,resumeAuthorization:true}),error=>error.code==='PROVIDER_OUTCOME_UNKNOWN'&&error.phase==='production.rollback');
 assert.equal(v.effects.reads,v.effects.readsAtLostRollback);
 assert.equal(v.effects.rollback,1);
 assert.equal((await client.snapshot(bind(m))).operations['production.rollback'].state,'uncertain');
 // A separate invocation reads the consumed rollback; it must never post again.
 const terminal=await executeHostedProduction({manifest:m,coordinator:client,provider:v.provider,resumeAuthorization:true});
 assert.equal(terminal.status,'rolled_back');assert.equal(v.effects.stage,1);assert.equal(v.effects.promote,1);assert.equal(v.effects.rollback,1);
 const saved=await client.snapshot(bind(m));assert.equal(saved.status,'rolled_back');assert.equal(saved.approval.expires_at,approved.expiresAt);assert.equal(saved.operations['production.rollback'].state,'complete');
 assert.equal((await pool.query('select count(*)::int as n from fcos_release_coordination.authorizations')).rows[0].n,1);

 // Historical fixture rows represent a runner crash after a staged POST, more
 // than 24h ago. They are inserted once, never updated to manufacture expiry.
 const renewal=manifest('production-renewal-rehearsal'),rv=fakeVercel(renewal),past=new Date(Date.now()-26*3600000).toISOString();
 identity={runId:'201',sha:S,environment:null};
 const historicalActor=await createGithubAuthenticator({policy,jwks:createLocalJWKSet({keys:[jwk]})})(await identityToken());
 await pool.query(`insert into fcos_release_coordination.registrations(release_id,epoch,owner,manifest,manifest_hash,scope,registration_actor,registered_at)
   values($1,1,$2,$3,$4,'release',$5,$6::timestamptz-interval '10 seconds')`,[renewal.releaseId,JSON.stringify({kind:'release',id:'features'}),JSON.stringify(renewal),digest(renewal),JSON.stringify(historicalActor),past]);
 await pool.query(`insert into fcos_release_coordination.registration_runs(release_id,run_id,run_attempt,actor,registered_at)
   values($1,'201','1',$2,$3::timestamptz-interval '10 seconds')`,[renewal.releaseId,JSON.stringify(historicalActor),past]);
 metadata={...(await client.snapshot(bind(renewal))).registrationRun,manifestHash:digest(renewal)};identity.environment='fcos-production-release';
 const historicalPrincipal=await createGithubAuthenticator({policy,jwks:createLocalJWKSet({keys:[jwk]})})(await identityToken());
 const historical=await client.snapshot(bind(renewal));
 const historicalReceipt=await createGithubApprovalValidator({policy,token:'local-read-only-fixture',fetchImpl:readGithub})({principal:historicalPrincipal,registration:historical.registration,registrationRun:historical.registrationRun,manifestHash:digest(renewal)});
 await pool.query(`insert into fcos_release_coordination.approval_admissions(release_id,run_id,run_attempt,actor,observed_at) values($1,'201','1',$2,$3)`,[renewal.releaseId,JSON.stringify(historicalPrincipal),past]);
 await pool.query(`insert into fcos_release_coordination.authorizations(release_id,run_id,run_attempt,approved_job_id,manifest_hash,epoch,receipt,admitted_at,expires_at)
   values($1,'201','1',$2,$3,1,$4,$5::timestamptz,$5::timestamptz+interval '24 hours')`,[renewal.releaseId,historicalReceipt.approvedJobId,digest(renewal),JSON.stringify(historicalReceipt),past]);
 const oldAuthorization=(await client.snapshot(bind(renewal))).approval;
 const stageId=`${renewal.releaseId}-production-stage`,stageRequestHash=digest({candidate:renewal.candidate,previous:renewal.previousProduction,target:'production',skipDomain:true});
 await rv.provider.stage(renewal,{operationId:stageId});
 await pool.query(`insert into fcos_release_coordination.operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor,created_at)
   values($1,$2,1,'production.stage',$3,$4,$5,$6)`,[stageId,renewal.releaseId,stageRequestHash,digest(renewal),JSON.stringify(historicalPrincipal),past]);
 await pool.query(`insert into fcos_release_coordination.operation_events(operation_id,state,evidence,evidence_hash,actor,created_at)
   values($1,'uncertain','{"outcome":"unknown"}',$2,$3,$4)`,[stageId,H,JSON.stringify(historicalPrincipal),past]);
 await pool.query('update fcos_release_coordination.control set operation_id=$1 where singleton',[stageId]);
 await assert.rejects(client.approve(bind(renewal)),/RENEWAL_NEW_RUN_REQUIRED/);
 identity.environment='fcos-hosted-production-resume';await assert.rejects(client.resume(bind(renewal)),/RESUME_FORBIDDEN/);
 identity={runId:'202',sha:'d'.repeat(40),environment:null};await client.register({...bind(renewal),manifest:renewal});
 const newReceipt=await gate(renewal),afterApproval=await client.snapshot(bind(renewal));
 assert.equal(afterApproval.approvalHistory.length,2);assert.deepEqual(afterApproval.approvalHistory[0],oldAuthorization);
 assert.equal(afterApproval.lock,stageId,'New authority cannot clear an uncertain provider operation.');
 assert.equal(afterApproval.approval.run_id,'202');assert.notEqual(newReceipt.expiresAt,oldAuthorization.expires_at);
 const renewalAdmission=(await pool.query("select observed_at from fcos_release_coordination.approval_admissions where release_id=$1 and run_id='202'",[renewal.releaseId])).rows[0].observed_at;
 assert.equal(Date.parse(newReceipt.expiresAt)-new Date(renewalAdmission).getTime(),86400000);
 const repeated=await client.approve(bind(renewal));assert.equal(repeated.expiresAt,newReceipt.expiresAt);
 assert.equal((await client.snapshot(bind(renewal))).approvalHistory.length,2);
 await executor();await publish(renewal);
 const renewedResult=await executeHostedProduction({manifest:renewal,coordinator:client,provider:rv.provider,resumeAuthorization:true});
 assert.equal(renewedResult.status,'complete');assert.equal(rv.effects.stage,1,'The historical stage POST is never repeated after renewed approval.');assert.equal(rv.effects.promote,1);
 const renewedSnapshot=await client.snapshot(bind(renewal));assert.deepEqual(renewedSnapshot.approvalHistory[0],oldAuthorization);
 assert.equal(renewedSnapshot.approval.authorization_event_id,afterApproval.approval.authorization_event_id);
 assert.equal(renewedSnapshot.operations['production.stage'].operationId,stageId);
 await assert.rejects(pool.query("update fcos_release_coordination.authorizations set expires_at=expires_at+interval '1 day' where authorization_event_id=$1",[oldAuthorization.authorization_event_id]),/APPEND_ONLY/);

});
