import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { runGuardedProviderWrite } from '../scripts/lib/guarded-provider-write.mjs';
import { ID, scope, recoveryPrincipal, migrationSource, quarantineDatabase } from './helpers/exact-preview-uncertainty-quarantine.mjs';

const prefix='fcos_release_coordination.';
const claimSql=`select ${prefix}exact_preview_admin_claim($1) result`;
const assertSql=`select ${prefix}exact_preview_admin_assert($1) result`;
const recordSql=`select ${prefix}exact_preview_admin_record($1,$2,$3) result`;
const isolateSql=`select ${prefix}exact_preview_admin_isolate($1,$2) result`;
const readbackSql=`select ${prefix}exact_preview_admin_readback($1,$2) result`;
const command=result=>({exit_code:0,output:JSON.stringify(result)});
const expected=p=>Object.fromEntries(['epoch','objective','ownerThreadId','operationId'].map(k=>[k,p[k]]).concat([['bindingSha256',digest(p)]]));
const action=(scope,tag='isolate-fixture-0001',kind='isolate_preview')=>({schemaVersion:1,kind:'fcos_pr122_administrator_action_v1',epoch:'fcos-hosted-admin-epoch1',objective:'production',ownerThreadId:'01a0f08b-7fcb-7870-9edc-343e16052b62',operationId:'pr122-admin-'+tag,action:kind,scope,humanInstructionSha256:digest('SYNTHETIC direct human instruction'),rootAcceptanceSha256:digest('SYNTHETIC actual root acceptance'),independentAcceptanceSha256:digest('SYNTHETIC distinct independent acceptance')});
const publication=()=>({repository:'hocheunglai-oss/fcos',branch:'codex/hosted-release-consolidation-20261017',fromCommit:'a'.repeat(40),toCommit:'b'.repeat(40),fromIsAncestor:true,automaticDeploymentDisabled:true,allowNewPreview:false,sourcePreflightSha256:digest('SYNTHETIC source preflight'),headSnapshotSha256:digest('SYNTHETIC exact GitHub ref readback')});
const copiedProtectionSha256='0371b73a7ed8f61c241f315b7319a861bd78ccb9934f79233bac8d7c5b08f879';
const callerScope=(p,lock=false)=>({repository:'hocheunglai-oss/fcos',branch:p.successor.ref.slice('refs/heads/'.length),toCommit:p.successor.callerSha,
  ...(lock?{protectionSha256:copiedProtectionSha256,lockBranch:true,enforceAdmins:true,allowForcePushes:false,allowDeletions:false}:{fromCommit:'300a46365fbb8b159100b6bdd66523d757cfa4ec',fromIsAncestor:true,expectedRefAbsent:true}),
  automaticDeploymentDisabled:true,allowNewPreview:false,sourcePreflightSha256:digest('SYNTHETIC exact caller source preflight'),headSnapshotSha256:digest('SYNTHETIC fresh caller ref observation')});
async function adminMigration(){const root=new URL('../supabase/migrations/',import.meta.url);const names=(await readdir(root)).filter(n=>n.endsWith('_exact_preview_administrator_guard.sql'));assert.equal(names.length,1);const sql=await readFile(new URL(names[0],root),'utf8');return{name:names[0],sql,body:sql.replace(/\nbegin;\n/,'\n').replace(/\ncommit;\n?$/,'\n')};}
const stableHistory=s=>({operations:s.operations,events:s.events,registrations:s.registrations,imports:s.imports,resolutions:s.resolutions});
const readbackEvidence=(p,l,observation,providerOutcome='applied',providerCallbackStarted=true)=>({kind:'fcos_pr122_administrator_owner_readback_v1',operationId:p.operationId,bindingSha256:l.bindingSha256,providerOutcome,providerCallbackStarted,observation,observationSha256:digest(observation),rootReviewSha256:digest('SYNTHETIC separate actual owner review'),independentReviewSha256:digest('SYNTHETIC distinct separate independent readback review')});

function callbacks(d,p,overrides={}){
  return {expected:expected(p),claim:async()=>command(await d.result(claimSql,[p])),
    assertLease:async({lease})=>command(await d.result(assertSql,[lease])),
    recordIntent:async({lease,phase})=>command(await d.result(recordSql,[lease,phase,phase==='prepared'?'durable_prepared':'durable_submitting'])),
    submit:async({lease})=>command(await d.result(isolateSql,[lease,p.scope])),
    validateProviderResult:r=>{const v=JSON.parse(r.output);return v.disposition==='quarantined'&&v.proofSha256===digest(p.scope)&&v.originalOutcome==='unknown'&&v.replayAllowed===false;},
    recordOutcome:async({lease,outcome})=>command(await d.result(recordSql,[lease,outcome.state,outcome.reason])),...overrides};
}

test('native PG17 real administrator leases serialize exact PR122 isolation and source-only publication',{skip:process.env.FCOS_EXACT_PREVIEW_NATIVE!=='docker'},async t=>{
  const start=performance.now(),d=await quarantineDatabase(t,true),q=await migrationSource(),m=await adminMigration();
  await d.exec(q.sql);await d.seed();const original=await d.state(),proof=await d.proof();
  const signatures=['dispatch(text,jsonb,jsonb)','qualification_source_upgrade_quiescent()','activate(bigint,jsonb)'].map(s=>prefix+s);
  const metadata=async()=>(await d.query('select oid::int,proowner::regrole::text owner,proacl::text acl,proconfig,prosecdef,prosrc from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
  const before=await metadata();
  await t.test('changed existing source or ACL refuses atomic bootstrap before a lease exists',async()=>{
    for(const mode of ['body','acl'])await d.transaction(async()=>{
      if(mode==='body'){const def=(await d.query('select pg_get_functiondef($1::regprocedure) v',[signatures[0]])).rows[0].v;await d.exec(def.replace('AS $function$','AS $function$\n-- SYNTHETIC marker-preserving source drift'));}
      else await d.exec(`grant execute on function ${signatures[0]} to anon`);
      await d.fails(m.body,[],/EXACT_PREVIEW_ADMIN_SOURCE_DRIFT/);
      assert.equal((await d.query("select to_regclass('fcos_release_coordination.exact_preview_administrator_actions') v")).rows[0].v,null);
    });
  });
  await d.exec(m.sql);const after=await metadata();
  for(let i=0;i<before.length;i++)for(const key of ['oid','owner','acl','proconfig','prosecdef'])assert.deepEqual(after[i][key],before[i][key]);
  assert.deepEqual(await d.state(),original);
  await t.test('wrong action/identity/source binding fails; private runtime roles cannot claim a real lease',()=>d.transaction(async()=>{
    const p=action(proof);
    for(const mutate of [x=>{x.ownerThreadId='other';},x=>{x.epoch='other';},x=>{x.action='production';},x=>{x.scope.maximumEffect.candidateSha='d'.repeat(40);},x=>{x.rootAcceptanceSha256=x.independentAcceptanceSha256;},x=>{x.operationId='invalid';}]){const x=structuredClone(p);mutate(x);await d.fails(claimSql,[x],/EXACT_PREVIEW_ADMIN_SCOPE/);}
    for(const role of ['fcos_coordinator_runtime','anon','authenticated','service_role'])await d.role(role,()=>d.fails(claimSql,[p],/permission denied/));
    assert.deepEqual(await d.state(),original);
  }));
  await t.test('claim and final assertions are real database reads; malformed claim acknowledgement cannot submit',()=>d.transaction(async()=>{
    const p=action(proof,'claim-ack-lost-0001');let submits=0;
    await assert.rejects(runGuardedProviderWrite(callbacks(d,p,{claim:async()=>({...command(await d.result(claimSql,[p])),exit_code:1}),submit:async()=>{submits++;throw Error('must never run');}})),/claim/);
    assert.equal(submits,0);assert.equal((await d.query('select fcos_release_coordination.exact_preview_admin_open() v')).rows[0].v,true);
    const beforeEvents=(await d.query('select to_jsonb(e) value from fcos_release_coordination.exact_preview_administrator_events e order by event_id')).rows;
    const snapshot=await d.result(`select ${prefix}exact_preview_admin_snapshot($1,$2) result`,[p.operationId,digest(p)]);
    assert.equal(snapshot.state,'claimed');assert.equal(snapshot.readOnly,true);assert.equal(snapshot.replayAllowed,false);assert.equal(snapshot.lease.bindingSha256,digest(p));
    assert.deepEqual((await d.query('select to_jsonb(e) value from fcos_release_coordination.exact_preview_administrator_events e order by event_id')).rows,beforeEvents);
    await d.fails(`select ${prefix}exact_preview_admin_snapshot($1,$2)`,[p.operationId,'f'.repeat(64)],/ADMIN_LEASE/);
    await d.fails(claimSql,[action(proof,'claim-ack-lost-0002')],/ADMIN_BUSY/);
    assert.deepEqual(await d.state(),original);
  }));
  await t.test('exact real guarded isolation preserves original history and closes only administrator serializer',()=>d.transaction(async()=>{
    const p=action(proof,'successful-isolation-0001');let submits=0;
    const c=callbacks(d,p),result=await runGuardedProviderWrite({...c,submit:async input=>{submits++;return c.submit(input);}});
    assert.equal(result.status,'submitted_acknowledged');assert.equal(submits,1);
    const states=(await d.query('select state from fcos_release_coordination.exact_preview_administrator_events order by event_id')).rows.map(r=>r.state);
    assert.deepEqual(states,['claimed','prepared','submitting','submitted']);
    assert.equal((await d.query('select fcos_release_coordination.exact_preview_admin_open() v')).rows[0].v,false);
    const now=await d.state();assert.equal(now.control.operation_id,null);assert.equal(now.control.mode,'qualification');assert.deepEqual(stableHistory(now),stableHistory(original));
    await d.fails(claimSql,[p],/ADMIN_CONSUMED/);
  }));
  await t.test('wrong lease or changed isolate proof cannot reach admission; normal writes/activation/source-upgrade stay blocked',()=>d.transaction(async()=>{
    const p=action(proof,'held-isolation-0001'),lease=await d.result(claimSql,[p]);
    for(const mutate of [x=>{x.leaseId='00000000-0000-4000-8000-000000000001';},x=>{x.bindingSha256='e'.repeat(64);},x=>{x.operationId+='-other';}]){const l=structuredClone(lease);mutate(l);await d.fails(assertSql,[l],/ADMIN_LEASE/);}
    await d.result(recordSql,[lease,'prepared','durable_prepared']);await d.result(recordSql,[lease,'submitting','durable_submitting']);
    const other=structuredClone(proof);other.maximumEffect.sourceEvidenceSha256='e'.repeat(64);
    await d.fails(isolateSql,[lease,other],/ADMIN_SCOPE/);
    await d.fails('select fcos_release_coordination.dispatch($1,$2,$3)',['begin',{...scope,phase:'qualification.stage',operationId:'SYNTHETIC-next',requestHash:'a'.repeat(64)},recoveryPrincipal()],/ADMIN_BUSY/);
    await d.fails('select fcos_release_coordination.activate(1,$1)',[{}],/ADMIN_BUSY/);
    assert.equal((await d.query('select fcos_release_coordination.qualification_source_upgrade_quiescent() v')).rows[0].v,false);
    assert.deepEqual(await d.state(),original);
  }));
  await t.test('uncertain submission stays held and blocks any fresh claim; it grants no replay',()=>d.transaction(async()=>{
    const p=action(proof,'uncertain-isolation-0001');let calls=0;
    const r=await runGuardedProviderWrite(callbacks(d,p,{submit:async()=>{calls++;throw Error('SYNTHETIC lost provider response');}}));
    assert.equal(r.status,'uncertain_outcome_recorded');assert.equal(calls,1);
    await d.fails(claimSql,[action(proof,'uncertain-isolation-0002')],/ADMIN_BUSY/);
    await d.fails(assertSql,[r.lease],/ADMIN_LEASE/);
    assert.deepEqual(await d.state(),original);
  }));
  await t.test('source publication permits only exact disabled feature ref and never a new Preview',()=>d.transaction(async()=>{
    await d.result('select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result',[proof]);
    const p=action(publication(),'source-publication-0001','publish_pr122_source');
    for(const mutate of [x=>{x.scope.branch='main';},x=>{x.scope.repository='other/fcos';},x=>{x.scope.allowNewPreview=true;},x=>{x.scope.automaticDeploymentDisabled=false;},x=>{x.scope.fromIsAncestor=false;},x=>{x.scope.toCommit=x.scope.fromCommit;}]){const x=structuredClone(p);mutate(x);await d.fails(claimSql,[x],/ADMIN_SCOPE/);}
    let writes=0,previews=0;
    const r=await runGuardedProviderWrite(callbacks(d,p,{submit:async()=>{writes++;return command({kind:'SYNTHETIC_exact_Git_ref_CAS_readback',repository:p.scope.repository,branch:p.scope.branch,sha:p.scope.toCommit});},validateProviderResult:r=>JSON.parse(r.output).sha===p.scope.toCommit}));
    assert.equal(r.status,'submitted_acknowledged');assert.equal(writes,1);assert.equal(previews,0);
    assert.deepEqual(stableHistory(await d.state()),stableHistory(original));
  }));
  await t.test('publication final assertion fails after quarantine revocation',()=>d.transaction(async()=>{
    await d.result('select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result',[proof]);
    const p=action(publication(),'revoked-publication-0001','publish_pr122_source'),lease=await d.result(claimSql,[p]);
    await d.query('select fcos_release_coordination.revoke_exact_preview_uncertainty_quarantine($1,$2,$3)',[ID,digest(proof),'a'.repeat(64)]);
    await d.fails(assertSql,[lease],/ADMIN_LEASE/);
  }));
  await t.test('lost isolation ACK reconciles through exact stored row, with no provider retry or original resolution',()=>d.transaction(async()=>{
    const p=action(proof,'recover-isolation-0001'),lease=await d.result(claimSql,[p]);
    await d.result(recordSql,[lease,'prepared','durable_prepared']);await d.result(recordSql,[lease,'submitting','durable_submitting']);
    await d.result(isolateSql,[lease,proof]);await d.result(recordSql,[lease,'uncertain','provider_exception']);
    assert.notEqual((await d.query("select to_regprocedure('fcos_release_coordination.exact_preview_admin_readback(jsonb,jsonb)') v")).rows[0].v,null,'separate supported readback RPC required');
    const evidence=readbackEvidence(p,lease,{kind:'stored_exact_preview_quarantine',operationId:ID,proofSha256:digest(proof)});
    await d.result(readbackSql,[lease,evidence]);
    assert.equal((await d.query('select fcos_release_coordination.exact_preview_admin_open() v')).rows[0].v,false);
    assert.deepEqual(stableHistory(await d.state()),stableHistory(original));
  }));
  await t.test('pre-submit guarded refusal may close only its admin intent, while submitting cannot claim no effect',()=>d.transaction(async()=>{
    const p=action(proof,'presubmit-stopped-0001'),lease=await d.result(claimSql,[p]);
    await d.result(recordSql,[lease,'prepared','durable_prepared']);
    const evidence=readbackEvidence(p,lease,{kind:'guard_stopped_before_submit',guardStopSha256:digest('SYNTHETIC actual guarded before-submit stop')},'not_applied',false);
    assert.equal((await d.result(readbackSql,[lease,evidence])).state,'not_applied');
    assert.equal((await d.query('select fcos_release_coordination.exact_preview_admin_open() v')).rows[0].v,false);
    assert.deepEqual(await d.state(),original);
    const p2=action(proof,'already-submitting-0001'),l2=await d.result(claimSql,[p2]);
    await d.result(recordSql,[l2,'prepared','durable_prepared']);await d.result(recordSql,[l2,'submitting','durable_submitting']);
    await d.fails(readbackSql,[l2,readbackEvidence(p2,l2,evidence.observation,'not_applied',false)],/ADMIN_READBACK/);
  }));
  await t.test('publication lost ACK needs exact authenticated ref readback; other target or SHA stays held',()=>d.transaction(async()=>{
    await d.result('select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result',[proof]);
    const p=action(publication(),'publish-lost-ack-0001','publish_pr122_source'),lease=await d.result(claimSql,[p]);
    await d.result(recordSql,[lease,'prepared','durable_prepared']);await d.result(recordSql,[lease,'submitting','durable_submitting']);await d.result(recordSql,[lease,'uncertain','provider_result_unconfirmed']);
    const observation={kind:'authenticated_github_exact_ref_readback',repository:p.scope.repository,branch:p.scope.branch,commit:p.scope.toCommit,authenticatedObserverLogin:'hocheunglai-oss',authenticatedObserverId:'265701760',readbackSha256:digest('SYNTHETIC exact ref readback'),observedAt:new Date().toISOString()};
    for(const change of [{branch:'main'},{commit:p.scope.fromCommit},{authenticatedObserverId:'99'},{observedAt:null}])await d.fails(readbackSql,[lease,readbackEvidence(p,lease,{...observation,...change})],/ADMIN_READBACK/);
    assert.equal((await d.result(readbackSql,[lease,readbackEvidence(p,lease,observation)])).state,'submitted');
    assert.deepEqual(stableHistory(await d.state()),stableHistory(original));
  }));
  await t.test('fresh caller creation and protection permit only exact admitted source, absent ref and copied lock policy',()=>d.transaction(async()=>{
    await d.result('select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result',[proof]);
    for(const lock of [false,true]){
      const kind=lock?'lock_qualification_caller':'publish_qualification_caller',p=action(callerScope(proof,lock),'exact-caller-'+(lock?'lock':'create')+'-0001',kind);
      const common=[x=>{x.scope.repository='other/fcos';},x=>{x.scope.branch='main';},x=>{x.scope.toCommit='f'.repeat(40);},x=>{x.scope.allowNewPreview=true;},x=>{x.scope.automaticDeploymentDisabled=false;}];
      const specific=lock?[x=>{x.scope.protectionSha256='f'.repeat(64);},x=>{x.scope.lockBranch=false;},x=>{x.scope.enforceAdmins=false;},x=>{x.scope.allowForcePushes=true;},x=>{x.scope.allowDeletions=true;}]:[x=>{delete x.scope.expectedRefAbsent;},x=>{x.scope.expectedRefAbsent=false;},x=>{x.scope.fromCommit='f'.repeat(40);},x=>{x.scope.fromIsAncestor=false;}];
      for(const mutate of [...common,...specific]){const x=structuredClone(p);mutate(x);await d.fails(claimSql,[x],/ADMIN_SCOPE/);}
      let callbacksStarted=0;
      const result=await runGuardedProviderWrite(callbacks(d,p,{submit:async()=>{callbacksStarted++;return command({kind:'SYNTHETIC exact caller API acknowledgement',branch:p.scope.branch,commit:p.scope.toCommit,protectionSha256:lock?copiedProtectionSha256:null});},validateProviderResult:r=>{const v=JSON.parse(r.output);return v.branch===p.scope.branch&&v.commit===p.scope.toCommit&&(!lock||v.protectionSha256===copiedProtectionSha256);}}));
      assert.equal(result.status,'submitted_acknowledged');assert.equal(callbacksStarted,1);
      assert.deepEqual(stableHistory(await d.state()),stableHistory(original));
    }
  }));
  await t.test('uncertain caller creation and lock stay held until exact separate authenticated owner readback, with no replay',async()=>{
    for(const lock of [false,true])await d.transaction(async()=>{
      await d.result('select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result',[proof]);
      const kind=lock?'lock_qualification_caller':'publish_qualification_caller',p=action(callerScope(proof,lock),'uncertain-caller-'+(lock?'lock':'create')+'-0001',kind),lease=await d.result(claimSql,[p]);
      await d.result(recordSql,[lease,'prepared','durable_prepared']);await d.result(recordSql,[lease,'submitting','durable_submitting']);await d.result(recordSql,[lease,'uncertain','provider_exception']);
      await d.fails(claimSql,[action(callerScope(proof,lock),'another-caller-write-0001',kind)],/ADMIN_BUSY/);
      const o={kind:lock?'authenticated_github_locked_caller_readback':'authenticated_github_exact_ref_readback',repository:p.scope.repository,branch:p.scope.branch,commit:p.scope.toCommit,
        ...(lock?{protectionSha256:copiedProtectionSha256,lockBranch:true,enforceAdmins:true,allowForcePushes:false,allowDeletions:false}:{}),authenticatedObserverLogin:'hocheunglai-oss',authenticatedObserverId:'265701760',readbackSha256:digest('SYNTHETIC actual exact caller readback'),observedAt:new Date().toISOString()};
      for(const patch of [{branch:'main'},{commit:'f'.repeat(40)},{observedAt:null},...(lock?[{protectionSha256:'f'.repeat(64)},{lockBranch:false}]:[])])await d.fails(readbackSql,[lease,readbackEvidence(p,lease,{...o,...patch})],/ADMIN_READBACK/);
      assert.equal((await d.result(readbackSql,[lease,readbackEvidence(p,lease,o)])).state,'submitted');
      assert.equal((await d.query('select fcos_release_coordination.exact_preview_admin_open() v')).rows[0].v,false);
      assert.deepEqual(stableHistory(await d.state()),stableHistory(original));
    });
  });
  await t.test('actual guarded bootstrap installs both definitions and claims atomically; refusal rolls all definitions back',async child=>{
    const second=await quarantineDatabase(child,true);await second.seed();const initial=await second.state(),p=action(await second.proof(),'atomic-bootstrap-0001');
    await second.query('begin');
    try {await second.exec(q.body);await second.exec(m.body);const wrong=structuredClone(p);wrong.ownerThreadId='other';await assert.rejects(second.result(claimSql,[wrong]),/ADMIN_SCOPE/);}
    finally {await second.query('rollback');}
    for(const name of ['exact_preview_uncertainty_quarantines','exact_preview_administrator_actions'])assert.equal((await second.query('select to_regclass($1) v',[prefix+name])).rows[0].v,null);
    assert.deepEqual(await second.state(),initial);
    const result=await runGuardedProviderWrite(callbacks(second,p,{claim:async()=>{
      await second.query('begin');
      try {await second.exec(q.body);await second.exec(m.body);const lease=await second.result(claimSql,[p]);assert.equal((await second.state()).control.operation_id,ID);await second.query('commit');return command(lease);}
      catch(error){await second.query('rollback');throw error;}
    }}));
    assert.equal(result.status,'submitted_acknowledged');assert.deepEqual(stableHistory(await second.state()),stableHistory(initial));
  });
  let concurrentLease;
  await t.test('two native sessions cannot both acquire administrator lease',async()=>{
    const port=Number(execFileSync('docker',['port',d.container,'5432/tcp'],{encoding:'utf8'}).trim().split(':')[1]);
    const clients=Array.from({length:2},()=>new pg.Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'}));
    try {await Promise.all(clients.map(c=>c.connect()));const results=await Promise.allSettled(clients.map((c,i)=>c.query(claimSql,[action(proof,`concurrent-claim-000${i}`)])));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&/ADMIN_BUSY/.test(x.reason.message)).length,1);
      concurrentLease=results.find(x=>x.status==='fulfilled').value.rows[0].result;
    }finally{await Promise.all(clients.map(c=>c.end()));}
    assert.deepEqual(await d.state(),original);
  });
  await t.test('another actual login inheriting administrator EXECUTE cannot record or resolve the submitting owner lease',async()=>{
    const lease=concurrentLease;assert.ok(lease);
    await d.result(recordSql,[lease,'prepared','durable_prepared']);await d.result(recordSql,[lease,'submitting','durable_submitting']);
    await d.result(isolateSql,[lease,proof]);
    const port=Number(execFileSync('docker',['port',d.container,'5432/tcp'],{encoding:'utf8'}).trim().split(':')[1]);
    const options={host:'127.0.0.1',port,database:'postgres'},bootstrap=new pg.Client({...options,user:'fcos_test_bootstrap'}),other=new pg.Client({...options,user:'fcos_test_other_administrator'});
    try{
      await bootstrap.connect();await bootstrap.query('create role fcos_test_other_administrator login inherit;grant postgres to fcos_test_other_administrator');
      await other.connect();assert.equal((await other.query('select session_user::text v')).rows[0].v,'fcos_test_other_administrator');
      for(const args of [[lease,'uncertain','provider_exception'],[lease,'submitted','provider_acknowledged']])await assert.rejects(other.query(recordSql,args),/ADMIN_TRANSITION|ADMIN_LEASE/);
      await assert.rejects(other.query(assertSql,[lease]),/ADMIN_LEASE/);
      await assert.rejects(other.query(`select ${prefix}exact_preview_admin_snapshot($1,$2)`,[lease.operationId,lease.bindingSha256]),/ADMIN_LEASE/);
      assert.equal((await d.query('select state from fcos_release_coordination.exact_preview_administrator_events where operation_id=$1 order by event_id desc limit 1',[lease.operationId])).rows[0].state,'submitting');
      await d.result(recordSql,[lease,'submitted','provider_acknowledged']);
      assert.deepEqual(stableHistory(await d.state()),stableHistory(original));
    }finally{await other.end();await bootstrap.end();}
  });
  const report={schemaVersion:1,kind:'fcos_exact_preview_administrator_guard_native_checks_v1',databaseVersion:d.version,quarantineMigrationSha256:digest(q.sql),administratorMigration:m.name,administratorMigrationSha256:digest(m.sql),guardSourceSha256:digest(await readFile(new URL('../scripts/lib/guarded-provider-write.mjs',import.meta.url))),elapsedMs:Math.round(performance.now()-start),providerCalls:0,liveSqlCalls:0,originalOutcome:'unknown',productionAuthorityGranted:false};
  if(process.env.FCOS_EXACT_PREVIEW_ADMIN_PROOF)await writeFile(process.env.FCOS_EXACT_PREVIEW_ADMIN_PROOF,JSON.stringify(report,null,2)+'\n');
});
