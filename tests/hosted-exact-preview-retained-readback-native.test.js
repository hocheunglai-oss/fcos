import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile,writeFile } from 'node:fs/promises';
import { generateKeyPair,exportJWK,createLocalJWKSet,SignJWT } from 'jose';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { sourceUpgradeFixture } from './helpers/hosted-qualification-source-upgrade.mjs';
import { ID,scope,originalJournal,migrationSource,quarantineDatabase } from './helpers/exact-preview-uncertainty-quarantine.mjs';
import { createGithubAuthenticator as legacyGithubAuthenticator } from '../supabase/functions/release-coordinator/auth.mjs';

const target=path.resolve(process.env.FCOS_RETAINED_CONTROLLER_ROOT||process.cwd());
const moduleUrl=file=>pathToFileURL(path.join(target,file)).href;
const {createGithubAuthenticator}=await import(moduleUrl('supabase/functions/release-coordinator/auth.mjs'));
const {createCoordinatorHandler,createSqlStore}=await import(moduleUrl('supabase/functions/release-coordinator/index.ts'));
const {RETAINED_PREVIEW}=await import(moduleUrl('supabase/functions/release-coordinator/core.mjs'));

test('native PG17 actual signed retained-owner JWT passes actual handler/auth and preserves successor serializer',{skip:process.env.FCOS_EXACT_PREVIEW_NATIVE!=='docker'},async t=>{
  assert.ok(RETAINED_PREVIEW,'Run against the prepared retained-owner source, never silently substitute a fake authenticator');
  const started=performance.now(),d=await quarantineDatabase(t,true),m=await migrationSource();await d.exec(m.sql);await d.seed();const before=await d.state();
  await d.result('select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result',[await d.proof()]);
  const policy=sourceUpgradeFixture().upgrade.policy,admission=RETAINED_PREVIEW.admission;
  const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);jwk.kid='SYNTHETIC-readback-key';jwk.alg='RS256';
  const jwks=createLocalJWKSet({keys:[jwk]});
  const principalRun='49999990001';
  const base={repository:admission.repository,repository_id:admission.repositoryId,ref:admission.ref,ref_type:'branch',sha:admission.bootstrapSha,
    workflow_sha:admission.callerWorkflowSha,workflow_ref:admission.callerWorkflowRef,job_workflow_ref:admission.jobWorkflowRef,job_workflow_sha:admission.jobWorkflowSha,
    run_id:principalRun,run_attempt:'1',actor:RETAINED_PREVIEW.actor,actor_id:RETAINED_PREVIEW.actorId,ref_protected:'true',event_name:'workflow_dispatch',runner_environment:'github-hosted',environment:'fcos-hosted-preview'};
  const token=async changes=>{const c={...base,...changes};return new SignJWT(c).setProtectedHeader({alg:'RS256',kid:jwk.kid})
    .setIssuer('https://token.actions.githubusercontent.com').setAudience('fcos-release-coordinator')
    .setSubject(c.environment?`repo:${admission.repository}:environment:${c.environment}`:`repo:${admission.repository}:ref:${c.ref}`)
    .setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('5m').setJti(crypto.randomUUID()).sign(pair.privateKey);};
  const signed=await token({});
  let requests=0,unexpectedMetadata=0;
  const store=createSqlStore(async(sql,values)=>{
    requests++;await d.query('begin');
    try {await d.query('set local role fcos_coordinator_runtime');const result=await d.query(sql,values);await d.query('commit');return result;}
    catch(error){await d.query('rollback');throw error;}
  });
  const handler=createCoordinatorHandler({store,authenticateGithub:createGithubAuthenticator({policy,jwks}),validateQualification:async()=>{unexpectedMetadata++;throw Error('No new source admission during readback');}});
  const send=(action,payload,bearer=signed)=>handler(new Request('http://localhost/coordination',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bearer}`},body:JSON.stringify({action,payload})}));
  await t.test('signature-verified new attempt1 run retains its actual identity and can snapshot only old scope',async()=>{
    const principal=await createGithubAuthenticator({policy,jwks})(signed);
    assert.equal(principal.retainedPreviewReadbackOnly,true);assert.equal(principal.runId,principalRun);assert.notEqual(principal.runId,originalJournal.operation.actor.runId);
    const response=await send('snapshot',scope);assert.equal(response.status,200);const snapshot=await response.json();assert.equal(snapshot.operations['preview.create'].state,'uncertain');
    assert.equal(snapshot.registration.registration_actor.runId,'39811703824');
    const verificationToken=await token({environment:'fcos-hosted-verification'});
    const verificationPrincipal=await createGithubAuthenticator({policy,jwks})(verificationToken);
    assert.equal(verificationPrincipal.retainedPreviewReadbackOnly,true);assert.equal(verificationPrincipal.runId,principalRun);
    assert.equal((await send('snapshot',scope,verificationToken)).status,200);
    for(const patch of [{releaseId:'another-release'},{manifestHash:'a'.repeat(64)},{epoch:2},{owner:{kind:'release',id:'another'}}]){
      const response=await send('snapshot',{...scope,...patch});assert.equal(response.status,403);
    }
  });
  await t.test('retained tuple cannot register, begin, complete, approve, resume, append or finish',async()=>{
    const n=requests;
    for(const action of ['register','begin','claim','complete','uncertain','appendEvidence','finish','admitApproval','approve','resume']){
      const response=await send(action,{...scope,phase:'preview.create',operationId:ID,requestHash:originalJournal.operation.request_hash,evidence:{outcome:'unknown'}});
      assert.ok([400,403].includes(response.status),action);
    }
    assert.equal(requests,n,'rejected actions do not reach SQL');
  });
  await t.test('wrong signed source/caller/actor/run/subject and wrong signature fail before SQL',async()=>{
    const n=requests;
    for(const patch of [{actor_id:'99'},{actor:'other'},{run_attempt:'2'},{sha:'a'.repeat(40)},{workflow_sha:'a'.repeat(40)},{job_workflow_sha:'a'.repeat(40)},{workflow_ref:base.workflow_ref+'-other'},{repository_id:'99'},{ref_protected:'false'},{environment:'fcos-production-release'}]){
      assert.equal((await send('snapshot',scope,await token(patch))).status,401);
    }
    const other=await generateKeyPair('RS256');const forged=await new SignJWT(base).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://token.actions.githubusercontent.com').setAudience('fcos-release-coordinator').setSubject(`repo:${admission.repository}:environment:fcos-hosted-preview`).setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('5m').setJti('SYNTHETIC-forged').sign(other.privateKey);
    assert.equal((await send('snapshot',scope,forged)).status,401);assert.equal(requests,n);
  });
  await t.test('old trusted runtime unmarked verification identity remains supported during handoff',async()=>{
    const legacyPolicy={...policy,qualificationAdmission:admission};
    const oldAuth=legacyGithubAuthenticator({policy:legacyPolicy,jwks});const oldToken=await token({environment:'fcos-hosted-verification'});
    const principal=await oldAuth(oldToken);assert.equal(principal.retainedPreviewReadbackOnly,undefined);assert.equal(principal.runId,principalRun);
    const oldHandler=createCoordinatorHandler({store,authenticateGithub:oldAuth});
    const response=await oldHandler(new Request('http://localhost/coordination',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${oldToken}`},body:JSON.stringify({action:'snapshot',payload:scope})}));
    assert.equal(response.status,200);
  });
  await t.test('actual handler readback records fresh signed actor while keeping every original record and successor lock',async()=>{
    await d.query("insert into fcos_release_coordination.operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor) values('SYNTHETIC-other-held',$1,1,'qualification.stage',$2,$3,$4)",[scope.releaseId,'d'.repeat(64),scope.manifestHash,originalJournal.operation.actor]);
    await d.query("insert into fcos_release_coordination.operation_events(operation_id,state,evidence,evidence_hash,actor) values('SYNTHETIC-other-held','intent','{}',$1,$2)",['d'.repeat(64),originalJournal.operation.actor]);
    await d.query("update fcos_release_coordination.control set operation_id='SYNTHETIC-other-held',mode='active'");
    const unknown=await send('readback',{...scope,phase:'preview.create',operationId:ID,evidence:{outcome:'unknown',reason:'SYNTHETIC owner GET-only observation'}});assert.equal(unknown.status,200);
    let state=await d.state();assert.equal(state.control.operation_id,'SYNTHETIC-other-held');
    const latest=state.events.filter(e=>e.operation_id===ID).at(-1);assert.equal(latest.actor.runId,principalRun);assert.equal(latest.actor.retainedPreviewReadbackOnly,true);
    assert.deepEqual(state.operations.find(o=>o.operation_id===ID),before.operations[0]);assert.deepEqual(state.registrations,before.registrations);
    assert.deepEqual(state.events.slice(0,2),before.events);
    const applied=await send('readback',{...scope,phase:'preview.create',operationId:ID,evidence:{outcome:'applied',result:{id:'dpl_SYNTHETIC_late_preview'}}});assert.equal(applied.status,200);
    state=await d.state();assert.equal(state.control.operation_id,'SYNTHETIC-other-held');assert.equal(state.events.filter(e=>e.operation_id===ID).at(-1).state,'complete');
    assert.deepEqual(state.operations.find(o=>o.operation_id===ID),before.operations[0]);assert.deepEqual(state.registrations,before.registrations);
    assert.equal(unexpectedMetadata,0);
  });
  const files=['supabase/functions/release-coordinator/auth.mjs','supabase/functions/release-coordinator/core.mjs','supabase/functions/release-coordinator/index.ts'];
  const report={schemaVersion:1,kind:'fcos_retained_preview_actual_jwt_sql_local_verification_v1',target,sourceFiles:await Promise.all(files.map(async file=>({file,sha256:digest(await readFile(path.join(target,file)))}))),quarantineMigrationSha256:digest(m.sql),databaseVersion:d.version,elapsedMs:Math.round(performance.now()-started),originalRunId:'39811703824',freshAuthenticatedReadbackRunId:principalRun,oldOperationIdentityUnchanged:true,providerCalls:0,liveSqlCalls:0,actualHostedOidcTokenProduced:false,actualTokenProducingWorkflowRouteVerified:false,qualificationAccepted:false,productionAuthorityGranted:false};
  if(process.env.FCOS_RETAINED_READBACK_PROOF)await writeFile(process.env.FCOS_RETAINED_READBACK_PROOF,JSON.stringify(report,null,2)+'\n');
});
