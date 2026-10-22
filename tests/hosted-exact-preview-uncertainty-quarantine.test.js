import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { ID, scope, recoveryPrincipal, originalManifest, originalJournal, reviewed, migrationSource, quarantineDatabase } from './helpers/exact-preview-uncertainty-quarantine.mjs';

const native=process.env.FCOS_EXACT_PREVIEW_NATIVE==='docker';
const admit='select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result';
const dispatch='select fcos_release_coordination.dispatch($1,$2,$3) result';
const history=state=>({operations:state.operations,events:state.events,registrations:state.registrations,imports:state.imports,resolutions:state.resolutions});
test(`${native?'native PG17 Docker':'PGlite'} exact Preview quarantine preserves UNKNOWN, source and original-owner recovery`,async t=>{
  const started=performance.now(),d=await quarantineDatabase(t,native),m=await migrationSource();
  assert.match(d.version,native?/PostgreSQL 17\./:/PGlite 0\.5\.8/);
  const initial=await d.state();
  const signatures=['dispatch(text,jsonb,jsonb)','dispatch_without_auth_maintenance(text,jsonb,jsonb)','qualification_source_upgrade_quiescent()','qualification_source_upgrade_proof_valid(jsonb)','activate(bigint,jsonb)'].map(s=>'fcos_release_coordination.'+s);
  const metadata=async()=>(await d.query('select oid::int,proowner::regrole::text owner,proacl::text acl,proconfig,prosecdef,prosrc from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
  const beforeMetadata=await metadata();
  await t.test('source drift refuses entire installation with original catalog preserved',()=>d.transaction(async()=>{
    const def=(await d.query('select pg_get_functiondef($1::regprocedure) v',[signatures[0]])).rows[0].v;
    await d.exec(def.replace('AS $function$','AS $function$\n-- SYNTHETIC drift'));
    await d.fails(m.body,[],/EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT/);
    assert.equal((await d.query("select to_regclass('fcos_release_coordination.exact_preview_uncertainty_quarantines') v")).rows[0].v,null);
  }));
  await t.test('existing security mode/ACL drift cannot be preserved as newly accepted authority',()=>d.transaction(async()=>{
    await d.exec('grant execute on function fcos_release_coordination.dispatch(text,jsonb,jsonb) to anon');
    await d.fails(m.body,[],/EXACT_PREVIEW_QUARANTINE_SOURCE_DRIFT/);
  }));
  await d.exec(m.sql);
  assert.deepEqual(await d.state(),initial);
  const afterMetadata=await metadata();
  for(let i=0;i<beforeMetadata.length;i++)for(const key of ['oid','owner','acl','proconfig','prosecdef'])assert.deepEqual(afterMetadata[i][key],beforeMetadata[i][key],key);
  await d.seed();const original=await d.state(),p=await d.proof();
  assert.equal(digest(originalManifest),scope.manifestHash);
  assert.equal(digest({candidate:originalManifest.candidate,target:'preview'}),originalJournal.operation.request_hash);
  await t.test('missing, wrong operation/phase/state/actor/source and authority expansion fail without state changes',()=>d.transaction(async()=>{
    const mutations=[x=>{x.operationId='other';},x=>{x.epoch=2;},x=>{x.originalOutcome='not_applied';},x=>{x.replayAllowed=true;},x=>{x.financialAuthorityGranted=true;},x=>{x.maximumEffect.ordinaryPreviewOnly=false;},x=>{x.maximumEffect.readOnlyCi=false;},x=>{x.maximumEffect.productionAliasesCanChange=true;},x=>{x.maximumEffect.financialActionsPossible=true;},x=>{x.maximumEffect.controllerSha='c'.repeat(40);},x=>{x.maximumEffect.argumentsSha256='d'.repeat(64);},x=>{x.terminalWriter.status='in_progress';},x=>{x.terminalWriter.jobId='99';},x=>{x.terminalWriter.runId='99';},x=>{x.terminalWriter.writerStopped=false;},x=>{x.originalEventSha256='e'.repeat(64);},x=>{x.successor.actorId='99';},x=>{x.successor.controllerSha=originalManifest.controller.sha;}];
    for(const change of mutations){const x=structuredClone(p);change(x);await d.fails(admit,[reviewed(x)],/EXACT_PREVIEW_QUARANTINE_/);}
    for(const change of [x=>{delete x.humanDecision;},x=>{x.humanDecision.replySha256='bad';},x=>{x.humanDecision.approved=false;},x=>{x.rootReview.accepted=false;},x=>{x.independentReview.evidenceSha256=x.rootReview.evidenceSha256;}]){const x=structuredClone(p);change(x);await d.fails(admit,[x],/EXACT_PREVIEW_QUARANTINE_/);}
    assert.deepEqual(await d.state(),original);
  }));
  await t.test('JSON null, non-string and infinite evidence timestamps never satisfy freshness or review provenance',()=>d.transaction(async()=>{
    for(const keys of [['terminalWriter','completedAt'],['terminalWriter','observedAt'],['humanDecision','approvedAt'],['rootReview','reviewedAt'],['independentReview','reviewedAt']]){
      for(const value of [null,42,'infinity','-infinity','invalid']){
        const x=structuredClone(p);x[keys[0]][keys[1]]=value;
        if(keys[0]==='terminalWriter')Object.assign(x,reviewed(x));
        if(keys[0]==='humanDecision')for(const k of ['rootReview','independentReview'])x[k].scopeSha256=digest(Object.fromEntries(Object.entries(x).filter(([key])=>!['rootReview','independentReview'].includes(key))));
        await d.fails(admit,[x],/EXACT_PREVIEW_QUARANTINE_INVALID/);
      }
    }
  }));
  await t.test('stored phase/actor drift is checked independently of prepared proof',()=>d.transaction(async()=>{
    // Mutation triggers remain on. Fixture alteration is explicitly privileged
    // and rolled back; no production code path can alter these original rows.
    await d.exec('alter table fcos_release_coordination.operations disable trigger append_only');
    await d.query("update fcos_release_coordination.operations set phase='production.stage' where operation_id=$1",[ID]);
    await d.fails(admit,[p],/EXACT_PREVIEW_QUARANTINE_INVALID/);
    await d.query("update fcos_release_coordination.operations set phase='preview.create',actor=jsonb_set(actor,'{actorId}','\"99\"') where operation_id=$1",[ID]);
    await d.fails(admit,[p],/EXACT_PREVIEW_QUARANTINE_INVALID/);
  }));
  await t.test('another unresolved operation is never quarantined or ignored',()=>d.transaction(async()=>{
    await d.query("insert into fcos_release_coordination.operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor) values('SYNTHETIC-other', $1,1,'qualification.stage',$2,$3,$4)",[scope.releaseId,'d'.repeat(64),scope.manifestHash,recoveryPrincipal()]);
    await d.query("insert into fcos_release_coordination.operation_events(operation_id,state,evidence,evidence_hash,actor) values('SYNTHETIC-other','uncertain','{}',$1,$2)",['d'.repeat(64),recoveryPrincipal()]);
    await d.fails(admit,[p],/EXACT_PREVIEW_QUARANTINE_STATE_CHANGED/);
  }));
  await t.test('private roles cannot admit, revoke or read quarantine rows',()=>d.transaction(async()=>{
    for(const role of ['fcos_coordinator_runtime','anon','authenticated','service_role'])await d.role(role,async()=>{
      await d.fails(admit,[p],/permission denied/);
      await d.fails('select * from fcos_release_coordination.exact_preview_uncertainty_quarantines',[],/permission denied/);
      await d.fails('select fcos_release_coordination.revoke_exact_preview_uncertainty_quarantine($1,$2,$3)',[ID,digest(p),'a'.repeat(64)],/permission denied/);
      await d.fails('select fcos_release_coordination.read_exact_preview_uncertainty()',[],/permission denied/);
    });
  }));
  await t.test('actual postgres metadata history read is exact, private and never resolves or claims the old attempt',async()=>{
    const before=await d.state();
    const read=await d.result('select fcos_release_coordination.read_exact_preview_uncertainty() result');
    assert.equal(read.kind,'fcos_exact_preview_uncertainty_metadata_history_v1');
    assert.equal(read.observedBy.databaseSessionUser,'postgres');
    assert.equal(read.originalOutcome,'unknown');assert.equal(read.replayAllowed,false);
    assert.deepEqual(read.registration,before.registrations[0]);assert.deepEqual(read.operation,before.operations[0]);
    assert.deepEqual(read.events,before.events);assert.deepEqual(await d.state(),before);
    const f=(await d.query("select proowner::regrole::text owner,prosecdef,provolatile,proconfig,proacl::text acl from pg_proc where oid='fcos_release_coordination.read_exact_preview_uncertainty()'::regprocedure")).rows[0];
    assert.deepEqual(f,{owner:'fcos_coordinator_owner',prosecdef:true,provolatile:'s',proconfig:['search_path=pg_catalog, fcos_release_coordination'],acl:'{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}'});
  });
  await t.test('one exact admission releases only serializer and preserves every original UNKNOWN byte',async()=>{
    let result;
    if(native){const results=await d.concurrentAdmit(p);assert.deepEqual(results.map(r=>r.disposition).sort(),['quarantined','readback']);result=results.find(r=>r.disposition==='quarantined');}
    else result=await d.result(admit,[p]);
    assert.equal(result.disposition,'quarantined');assert.equal(result.originalOutcome,'unknown');assert.equal(result.replayAllowed,false);
    const current=await d.state();assert.equal(current.control.operation_id,null);assert.equal(current.control.mode,'qualification');
    assert.deepEqual(history(current),history(original));
    const read=await d.result('select fcos_release_coordination.read_exact_preview_uncertainty() result');
    assert.deepEqual(read.events,original.events);assert.deepEqual(read.operation,original.operations[0]);
    assert.equal(read.observedBy.databaseSessionUser,'postgres');assert.deepEqual(await d.state(),current);
    assert.equal((await d.query('select fcos_release_coordination.qualification_source_upgrade_quiescent() v')).rows[0].v,true);
  });
  await t.test('identical admission is readback-only; changed admission conflicts; tables stay append-only',()=>d.transaction(async()=>{
    const before=await d.state();assert.equal((await d.result(admit,[p])).disposition,'readback');assert.deepEqual(await d.state(),before);
    const changed=structuredClone(p);changed.maximumEffect.sourceEvidenceSha256='e'.repeat(64);
    await d.fails(admit,[reviewed(changed)],/EXACT_PREVIEW_QUARANTINE_CONFLICT/);
    await d.fails('update fcos_release_coordination.exact_preview_uncertainty_quarantines set proof=proof',[],/APPEND_ONLY/);
    await d.fails('delete from fcos_release_coordination.exact_preview_uncertainty_quarantines',[],/APPEND_ONLY/);
  }));
  await t.test('checker exception binds exact successor and immutable17-file digest; unrelated files retain old predicate',async()=>{
    const s=p.successor,proof={operationId:s.sourceUpgradeId,parent:{releaseId:scope.releaseId},plan:{releaseId:s.releaseId},setup:{controllerSha:s.controllerSha,qualificationSource:{bootstrapSha:s.callerSha,ref:s.ref}},setupSha256:s.setupSha256,checkerManifest:[]};
    const check=async x=>(await d.query('select fcos_release_coordination.exact_preview_quarantine_checker_change($1) v',[x])).rows[0].v;
    assert.equal(await check(proof),true);
    for(const mutate of [x=>{x.operationId+='-other';},x=>{x.parent.releaseId='other';},x=>{x.setup.controllerSha='d'.repeat(40);},x=>{x.setupSha256='e'.repeat(64);},x=>{x.checkerManifest.push({path:'other'});}]){const x=structuredClone(proof);mutate(x);assert.equal(await check(x),false);}
    // The helper only bounds an exception; all actual parent/source/17-file
    // prerequisites are still independently enforced by the existing validator.
    assert.equal((await d.query('select fcos_release_coordination.qualification_source_upgrade_proof_valid($1) v',[proof])).rows[0].v,false);
    const body=(await d.query("select prosrc from pg_proc where oid='fcos_release_coordination.qualification_source_upgrade_proof_valid(jsonb)'::regprocedure")).rows[0].prosrc;
    assert.ok(body.includes("in ('supabase/functions/release-coordinator/auth.mjs','supabase/functions/release-coordinator/core.mjs') and exact_preview_quarantine_checker_change(p)"));
    assert.ok(body.includes('jsonb_array_length(p->\'checkerManifest\')<>17'));
    const transport=structuredClone(proof);transport.setup.verification={vercelSourceTransport:'fcos_source_api_archive_v1'};transport.manifest={verification:{vercelSourceTransport:'fcos_source_api_archive_v1'}};transport.previous={setup:{verification:{}},manifest:{verification:{}}};
    const allowed=async x=>(await d.query('select fcos_release_coordination.exact_preview_quarantine_transport_change($1) v',[x])).rows[0].v;
    assert.equal(await allowed(transport),true);
    for(const mutate of [x=>{x.setup.verification.vercelSourceTransport='other';},x=>{x.manifest.verification.vercelSourceTransport=null;},x=>{x.previous.setup.verification.vercelSourceTransport=null;},x=>{x.previous.manifest.verification.vercelSourceTransport='fcos_source_api_archive_v1';},x=>{x.setupSha256='e'.repeat(64);}]){const x=structuredClone(transport);mutate(x);assert.equal(await allowed(x),false);}
    assert.ok(body.includes("(p->'setup'->'verification')-'vercelSourceTransport'"));
    assert.ok(body.includes("(p->'manifest'->'verification')-'vercelSourceTransport'"));
  });
  await t.test('a second UNKNOWN after admission blocks new writes and source upgrades',()=>d.transaction(async()=>{
    await d.query("insert into fcos_release_coordination.operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor) values('SYNTHETIC-second-unknown',$1,1,'qualification.stage',$2,$3,$4)",[scope.releaseId,'d'.repeat(64),scope.manifestHash,recoveryPrincipal()]);
    await d.query("insert into fcos_release_coordination.operation_events(operation_id,state,evidence,evidence_hash,actor) values('SYNTHETIC-second-unknown','uncertain','{}',$1,$2)",['d'.repeat(64),recoveryPrincipal()]);
    await d.fails(dispatch,['begin',{...scope,phase:'qualification.promote',operationId:'SYNTHETIC-no-exemption',requestHash:'a'.repeat(64)},recoveryPrincipal()],/UNRESOLVED_OPERATION/);
    assert.equal((await d.query('select fcos_release_coordination.qualification_source_upgrade_quiescent() v')).rows[0].v,false);
  }));
  await t.test('quarantine alone cannot start a successor, financial or Production operation or activate',()=>d.transaction(async()=>{
    await d.fails(dispatch,['begin',{...scope,phase:'qualification.stage',operationId:'SYNTHETIC-unadmitted',requestHash:'a'.repeat(64)},recoveryPrincipal()],/QUARANTINE_SUCCESSOR_REQUIRED/);
    await d.fails(dispatch,['begin',{...scope,phase:'production.stage',operationId:'SYNTHETIC-prod',requestHash:'a'.repeat(64)},recoveryPrincipal()],/QUARANTINE_SUCCESSOR_REQUIRED/);
    await d.fails(dispatch,['begin',{...scope,phase:'financial.link',operationId:'SYNTHETIC-financial',requestHash:'a'.repeat(64)},{kind:'financial',ownerId:'finance'}],/QUARANTINE_SUCCESSOR_REQUIRED/);
    await d.fails('select fcos_release_coordination.activate(1,$1)',[{manifestHash:scope.manifestHash,previewUncertaintyQuarantineSha256:digest(p)}],/QUARANTINE_ACTIVATION_REQUIRED/);
  }));
  await t.test('fresh authenticated original owner retains GET-only journal snapshot and unknown readback',()=>d.transaction(async()=>{
    const a=recoveryPrincipal();assert.notEqual(a.runId,originalJournal.operation.actor.runId);
    const snap=await d.result(dispatch,['snapshot',scope,a]);assert.equal(snap.operations['preview.create'].state,'uncertain');
    const legacy=structuredClone(a);delete legacy.retainedPreviewReadbackOnly;
    assert.equal((await d.result(dispatch,['snapshot',scope,legacy])).operations['preview.create'].state,'uncertain');
    const evidence={outcome:'unknown',reason:'SYNTHETIC original owner GET-only readback'};
    const result=await d.result(dispatch,['readback',{...scope,phase:'preview.create',operationId:ID,evidence,evidenceHash:digest(evidence)},a]);
    assert.equal(result.disposition,'readback');assert.equal((await d.state()).control.operation_id,null);
    for(const mutate of [x=>{x.actor='other';},x=>{x.actorId='99';},x=>{x.repositoryId='99';},x=>{x.runAttempt='2';},x=>{x.retainedPreviewReadbackOnly=false;},x=>{x.retainedPreviewReadbackOnly='true';},x=>{x.jobWorkflowSha='a'.repeat(40);},x=>{x.qualificationAdmission.setupSha256='b'.repeat(64);},x=>{x.environment='fcos-production-release';},x=>{x.subject+='-wrong';}]){
      const bad=structuredClone(a);mutate(bad);await d.fails(dispatch,['snapshot',scope,bad],/QUARANTINE_OWNER_INVALID/);
    }
  }));
  await t.test('definitive original-owner recovery NEVER clears a successor lock; original intent stays consumed',()=>d.transaction(async()=>{
    // A real successor is admitted separately. This fixture seeds its already
    // held serializer directly to test the independent lock-safety invariant.
    await d.query("insert into fcos_release_coordination.operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor) values('SYNTHETIC-successor-held',$1,1,'qualification.stage',$2,$3,$4)",[scope.releaseId,'d'.repeat(64),scope.manifestHash,recoveryPrincipal()]);
    await d.query("insert into fcos_release_coordination.operation_events(operation_id,state,evidence,evidence_hash,actor) values('SYNTHETIC-successor-held','intent','{}',$1,$2)",['d'.repeat(64),recoveryPrincipal()]);
    await d.query("update fcos_release_coordination.control set operation_id='SYNTHETIC-successor-held',mode='active'");
    const evidence={outcome:'applied',result:{id:'dpl_SYNTHETIC_late_owned_preview'}};
    const result=await d.result(dispatch,['readback',{...scope,phase:'preview.create',operationId:ID,evidence,evidenceHash:digest(evidence)},recoveryPrincipal()]);
    assert.equal(result.disposition,'complete');assert.equal((await d.state()).control.operation_id,'SYNTHETIC-successor-held');
    const snap=await d.result(dispatch,['snapshot',scope,recoveryPrincipal()]);assert.equal(snap.operations['preview.create'].state,'complete');
    await d.fails(dispatch,['readback',{...scope,phase:'preview.create',operationId:ID,evidence:{outcome:'not_applied'},evidenceHash:'a'.repeat(64)},recoveryPrincipal()],/TERMINAL_CONFLICT/);
  }));
  await t.test('revocation blocks new writes/quiescence but never removes original owner readback',()=>d.transaction(async()=>{
    await d.query('select fcos_release_coordination.revoke_exact_preview_uncertainty_quarantine($1,$2,$3)',[ID,digest(p),'a'.repeat(64)]);
    assert.equal((await d.query('select fcos_release_coordination.qualification_source_upgrade_quiescent() v')).rows[0].v,false);
    await d.fails(dispatch,['begin',{...scope,phase:'qualification.stage',operationId:'SYNTHETIC-revoked',requestHash:'a'.repeat(64)},recoveryPrincipal()],/UNRESOLVED_OPERATION/);
    const snap=await d.result(dispatch,['snapshot',scope,recoveryPrincipal()]);assert.equal(snap.operations['preview.create'].state,'uncertain');
  }));
  const report={schemaVersion:1,kind:'fcos_exact_preview_quarantine_local_checks_v1',database:native?'local_Docker_PostgreSQL17':'PGlite',version:d.version,migration:m.name,migrationSha256:digest(m.sql),elapsedMs:Math.round(performance.now()-started),databaseQueries:d.calls(),providerCalls:0,liveSqlCalls:0,originalOutcome:'unknown',qualificationAccepted:false,productionAuthorityGranted:false,actualHumanApprovalCreated:false};
  if(process.env.FCOS_EXACT_PREVIEW_PROOF){await mkdir(new URL('.',`file://${process.env.FCOS_EXACT_PREVIEW_PROOF}`),{recursive:true});await writeFile(process.env.FCOS_EXACT_PREVIEW_PROOF,JSON.stringify(report,null,2)+'\n');}
});
