import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { runGuardedProviderWrite } from '../scripts/lib/guarded-provider-write.mjs';
import { guardDatabase, guardMigration, binding, expected, sql, completed } from './helpers/qualification-source-upgrade-guard.mjs';

const ns='fcos_release_coordination.';
const callbacks=(d,b,overrides={})=>({expected:expected(b),claim:async()=>completed(await d.result(sql.claim,[b,null])),
  assertLease:async({lease})=>completed(await d.result(sql.assert,[lease])),
  recordIntent:async({lease,phase})=>completed(await d.result(sql.record,[lease,phase,phase==='prepared'?'durable_prepared':'durable_submitting'])),
  submit:async()=>({exit_code:0,output:'SYNTHETIC provider ACK, no network'}),validateProviderResult:r=>r.output==='SYNTHETIC provider ACK, no network',
  recordOutcome:async({lease,outcome})=>completed(await d.result(sql.record,[lease,outcome.state,outcome.reason])),...overrides});

for(const native of [false,true])test(`${native?'native PG17':'PGlite'} source-upgrade UUID guard preserves exact intent and uncertainty`,
  {skip:native&&process.env.FCOS_SOURCE_UPGRADE_GUARD_NATIVE!=='docker'},async t=>{
    const started=performance.now(),d=await guardDatabase(t,native),m=await guardMigration(),f=await d.seed();
    const before=await d.state(),history=await d.history(),metadata=await d.metadata(),b=binding(f.p,f.quarantine,'policy_patch');
    await t.test('bootstrap plus a refused first claim rolls back the new DDL and original intent',()=>d.transaction(async()=>{
      await d.fails(m.body+`select ${ns}qualification_source_upgrade_guard_claim('{"kind":"invalid"}',null);`,[],/SOURCE_GUARD_SCOPE/);
      assert.equal((await d.query(`select to_regclass('${ns}qualification_source_upgrade_guards') v`)).rows[0].v,null);
      assert.equal((await d.query(`select count(*)::int n from ${ns}qualification_source_upgrade_intents where operation_id=$1`,[f.p.operationId])).rows[0].n,0);
    }));
    await t.test('changed dependency source or ACL refuses inert installation atomically',async()=>{
      for(const mode of ['body','acl'])await d.transaction(async()=>{
        const signature=`${ns}qualification_source_upgrade_intent(text,text,text,jsonb)`;
        if(mode==='body') {
          const def=(await d.query('select pg_get_functiondef($1::regprocedure) v',[signature])).rows[0].v;
          await d.exec(def.replace('AS $function$','AS $function$\n-- SYNTHETIC source drift'));
        } else await d.exec(`grant execute on function ${signature} to anon`);
        await d.fails(m.body,[],/SOURCE_GUARD_DEPENDENCY_DRIFT/);
        assert.equal((await d.query(`select to_regclass('${ns}qualification_source_upgrade_guards') v`)).rows[0].v,null);
      });
    });
    await d.exec(m.sql);
    assert.deepEqual((await d.metadata()).filter(x=>metadata.some(y=>y.oid===x.oid)),metadata);
    assert.deepEqual(await d.state(),before);
    const afterHistory=await d.history();for(const [name,row] of Object.entries(history))assert.deepEqual(afterHistory[name],row);
    await t.test('one actual UUID and original execute intent are read without re-claiming',()=>d.transaction(async()=>{
      const lease=await d.result(sql.claim,[b,null]);assert.deepEqual(Object.fromEntries(Object.entries(lease).filter(([k])=>k in expected(b))),expected(b));
      assert.match(lease.leaseId,/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      const v=await d.result(sql.lookup,[b]);assert.deepEqual(v.lease,lease);assert.equal(v.replayAllowed,false);assert.equal(v.state,'claimed');
      assert.equal(v.intent.disposition,'execute');assert.equal(v.intent.requestSha256,b.requestSha256);
      assert.deepEqual(v.intent.request,f.p.actions[0].request);
      assert.equal(v.sourceUpgradeSnapshot.kind,'fcos_source_upgrade_snapshot_projection_v1');
      assert.equal(v.sourceUpgradeSnapshot.proofCanonicalSha256,digest(f.p));assert.equal(v.sourceUpgradeSnapshot.snapshot.upgrade.proof,undefined);
      assert.equal(v.sourceUpgradeSnapshot.snapshot.intents.length,1);
      const a=await d.result(sql.snapshot,[lease]);assert.deepEqual(a.intent,v.intent);
      await d.fails(sql.claim,[b,null],/SOURCE_GUARD_CONSUMED/);
      assert.equal((await d.call('qualification_source_upgrade_intent',[f.p.operationId,'policy_patch',digest(f.p),null])).disposition,'readback');
    }));
    await t.test('changed scope/request/active quarantine cannot mint a lease or consume an intent',()=>d.transaction(async()=>{
      for(const patch of [{kind:'arbitrary'},{sourceUpgradeId:f.parent.operationId},{proofSha256:'a'.repeat(64)},
        {actionId:'production'},{previewQuarantineProofSha256:'a'.repeat(64)},{extra:true},{requestSha256:'e'.repeat(64)}])
        await d.fails(sql.claim,[{...b,...patch},null],/SOURCE_GUARD_(SCOPE|EXECUTE_REQUIRED)/);
      assert.equal((await d.query(`select count(*)::int n from ${ns}qualification_source_upgrade_intents where operation_id=$1`,[f.p.operationId])).rows[0].n,0);
      await d.call('revoke_exact_preview_uncertainty_quarantine',[f.quarantine.operationId,digest(f.quarantine),digest('SYNTHETIC revoke')]);
      await d.fails(sql.claim,[b,null],/SOURCE_GUARD_SCOPE/);
    }));
    await t.test('existing source intent cannot be adopted, even with an otherwise exact binding',()=>d.transaction(async()=>{
      await d.call('qualification_source_upgrade_intent',[f.p.operationId,'policy_patch',digest(f.p),null]);
      await d.fails(sql.claim,[b,null],/SOURCE_GUARD_CONSUMED/);
      assert.equal((await d.query(`select count(*)::int n from ${ns}qualification_source_upgrade_guards`)).rows[0].n,0);
    }));
    await t.test('runtime/provider roles cannot claim, assert, record, look up or insert private rows',()=>d.transaction(async()=>{
      const lease=await d.result(sql.claim,[b,null]);
      for(const role of ['fcos_coordinator_runtime','anon','authenticated','service_role'])await d.role(role,async()=>{
        for(const [q,args] of [[sql.claim,[b,null]],[sql.assert,[lease]],[sql.record,[lease,'prepared','durable_prepared']],[sql.lookup,[b]],[sql.snapshot,[lease]]])
          await d.fails(q,args,/permission denied/);
        await d.fails(`insert into ${ns}qualification_source_upgrade_guards(source_upgrade_id,action_id,binding,binding_sha256,execute_intent) values('x','x','{}','x','{}')`,[],/permission denied/);
      });
    }));
    await t.test('fake UUID/binding/extra lease fields and wrong state/reason fail closed',()=>d.transaction(async()=>{
      const lease=await d.result(sql.claim,[b,null]);
      for(const patch of [{leaseId:'00000000-0000-4000-8000-000000000001'},{bindingSha256:'e'.repeat(64)},
        {operationId:lease.operationId+'x'},{providerAuthorityGranted:true},{extra:true}])await d.fails(sql.assert,[{...lease,...patch}],/SOURCE_GUARD_LEASE/);
      for(const [state,reason] of [['submitting','durable_submitting'],['submitted','provider_acknowledged'],['prepared','wrong'],['not_applied','guard_stopped']])
        await d.fails(sql.record,[lease,state,reason],/SOURCE_GUARD_TRANSITION/);
      await d.result(sql.record,[lease,'prepared','durable_prepared']);
      await d.fails(sql.record,[lease,'prepared','durable_prepared'],/SOURCE_GUARD_TRANSITION/);
    }));
    await t.test('changed control or quarantine after claim blocks the provider boundary',()=>d.transaction(async()=>{
      const lease=await d.result(sql.claim,[b,null]);
      await d.query(`update ${ns}control set mode='frozen'`);await d.fails(sql.assert,[lease],/SOURCE_GUARD_LEASE/);
      await d.query(`update ${ns}control set mode='qualification'`);
      await d.call('revoke_exact_preview_uncertainty_quarantine',[f.quarantine.operationId,digest(f.quarantine),digest('SYNTHETIC revoke')]);
      await d.fails(sql.assert,[lease],/SOURCE_GUARD_LEASE/);
    }));
    await t.test('an open administrator guard excludes new claim and prewrite assertion',()=>d.transaction(async()=>{
      await d.role('fcos_coordinator_owner',async()=>{
        const packet={synthetic:true};await d.query(`insert into ${ns}exact_preview_administrator_actions(operation_id,packet,binding_sha256) values('SYNTHETIC-open-admin',$1,$2)`,[packet,digest(packet)]);
        await d.fails(sql.claim,[b,null],/SOURCE_GUARD_BUSY/);
      });
      const lease=await d.result(sql.claim,[b,null]);
      await d.role('fcos_coordinator_owner',async()=>{
        const packet={synthetic:true};await d.query(`insert into ${ns}exact_preview_administrator_actions(operation_id,packet,binding_sha256) values('SYNTHETIC-open-admin',$1,$2)`,[packet,digest(packet)]);
        await d.fails(sql.assert,[lease],/SOURCE_GUARD_LEASE/);
      });
    }));
    await t.test('malformed claim completion records no provider submission and leaves a real held guard',()=>d.transaction(async()=>{
      let submits=0;await assert.rejects(runGuardedProviderWrite(callbacks(d,b,{claim:async()=>({...completed(await d.result(sql.claim,[b,null])),exit_code:1}),submit:async()=>{submits++;}})),/claim/);
      assert.equal(submits,0);assert.equal((await d.result(sql.lookup,[b])).state,'claimed');
    }));
    await t.test('uncertain result is append-only, blocks every later action, and grants no retry',()=>d.transaction(async()=>{
      let submits=0;const r=await runGuardedProviderWrite(callbacks(d,b,{submit:async()=>{submits++;throw Error('SYNTHETIC lost response');}}));
      assert.equal(r.status,'uncertain_outcome_recorded');assert.equal(submits,1);assert.equal((await d.result(sql.lookup,[b])).state,'uncertain');
      await d.fails(sql.claim,[binding(f.p,f.quarantine,'checker_deploy'),null],/SOURCE_GUARD_BUSY/);
      await d.fails(sql.assert,[r.lease],/SOURCE_GUARD_LEASE/);await d.fails(sql.claim,[b,null],/SOURCE_GUARD_CONSUMED/);
      assert.equal((await d.query(`select count(*)::int n from ${ns}qualification_source_upgrade_events where operation_id=$1`,[f.p.operationId])).rows[0].n,0);
    }));
    await t.test('append-only rows and all original function bodies/ACL/history remain intact',()=>d.transaction(async()=>{
      await d.result(sql.claim,[b,null]);
      for(const name of ['qualification_source_upgrade_guards','qualification_source_upgrade_guard_events'])await d.role('fcos_coordinator_owner',async()=>{
        await d.fails(`delete from ${ns}${name}`,[],/APPEND_ONLY/);
        await d.fails(`truncate ${ns}${name} cascade`,[],/APPEND_ONLY/);
      });
      assert.deepEqual((await d.metadata()).filter(x=>metadata.some(y=>y.oid===x.oid)),metadata);
      assert.deepEqual((await d.state()).operations,before.operations);assert.deepEqual((await d.state()).events,before.events);
      assert.deepEqual((await d.state()).imports,before.imports);assert.deepEqual((await d.state()).resolutions,before.resolutions);
    }));
    await t.test('six exact actions require each known source record and configuration release; submitted guard alone is insufficient',()=>d.transaction(async()=>{
      let calls=0;const H=digest('SYNTHETIC local ACK proof'),ready={kind:'fcos_qualification_source_upgrade_ready_v1',accepted:true,operationId:f.p.operationId,proofSha256:digest(f.p),projectId:f.p.preservation.project.id,teamId:f.p.preservation.team.id,deploymentId:'dpl_SYNTHETICguardfresh001',coordinatorUrl:'https://synthetic-guard-fresh.vercel.app/coordinate',policySha256:digest(f.p.policy),setupSha256:f.p.setupSha256,checkerManifestSha256:digest(f.p.checkerManifest),preservationSha256:digest(f.p.preservation),sourceEvidenceSha256:H,rootReviewSha256:H,independentReviewSha256:digest('SYNTHETIC distinct READY'),observedAt:new Date().toISOString()};
      for(const [index,a] of f.p.actions.entries()) {
        let request=a.request;if(a.id==='url_patch')request={...request,body:{...request.body,value:ready.coordinatorUrl}};
        const bind=binding(f.p,f.quarantine,a.id,request);
        if(a.id==='dispatch') {
          await d.fails(sql.claim,[bind,null],/NOT_HELD_OR_UNRESOLVED/);
          await d.call('finish_qualification_source_upgrade_configuration',[f.p.operationId,digest(f.p),{...ready,kind:'fcos_qualification_source_upgrade_configuration_v1'}]);
        }
        const c=callbacks(d,bind,{claim:async()=>completed(await d.result(sql.claim,[bind,a.id==='url_patch'?ready:null])),submit:async()=>{calls++;
          // The new dispatch may immediately activate its authenticated runner.
          // Terminal guard recording must still preserve the actual ACK.
          if(a.id==='dispatch')await d.query(`update ${ns}control set mode='frozen'`);
          return {exit_code:0,output:'SYNTHETIC provider ACK, no network'};}});
        const outcome=await runGuardedProviderWrite(c);assert.equal(outcome.status,'submitted_acknowledged');
        assert.equal((await d.result(sql.lookup,[bind])).state,'submitted');
        assert.equal((await d.query(`select count(*)::int n from ${ns}qualification_source_upgrade_events where operation_id=$1`,[f.p.operationId])).rows[0].n,index);
        if(a.id==='dispatch')await d.query(`update ${ns}control set mode='qualification'`);
        if(index<5)await d.fails(sql.claim,[binding(f.p,f.quarantine,f.p.actions[index+1].id),null],/NOT_HELD_OR_UNRESOLVED/);
        const response={completed:true,status:['policy_patch','checker_deploy'].includes(a.id)?200:204,exitCode:0,bodyEmpty:!['policy_patch','checker_deploy'].includes(a.id),...(a.id==='checker_deploy'?{deploymentId:ready.deploymentId,coordinatorUrl:ready.coordinatorUrl}:{})};
        await d.call('record_qualification_source_upgrade',[f.p.operationId,a.id,digest(f.p),{basis:'native_ack',outcome:'applied',requestSha256:digest(request),providerEvidenceSha256:digest(response),rootReviewSha256:digest(f.p.rootReview),response}]);
      }
      assert.equal(calls,6);assert.deepEqual((await d.state()).events,before.events);
      assert.equal((await d.query(`select count(*)::int n from ${ns}qualification_source_upgrade_guards`)).rows[0].n,6);
    }));
    if(native)await t.test('independent concurrent claims have exactly one control-lock winner',async()=>{
      const address=execFileSync('docker',['port',d.container,'5432/tcp'],{encoding:'utf8'}).trim();
      const clients=Array.from({length:2},()=>new pg.Client({host:'127.0.0.1',port:Number(address.split(':')[1]),database:'postgres',user:'postgres'}));
      try {await Promise.all(clients.map(c=>c.connect()));await Promise.all(clients.map(c=>c.query("begin;set local lock_timeout='200ms'")));
        const outcomes=await Promise.allSettled(clients.map(c=>c.query(sql.claim,[b,null])));
        assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected'&&r.reason.code==='55P03').length,1);
      }finally{await Promise.all(clients.map(async c=>{await c.query('rollback');await c.end();}));}
    });
    const report={kind:'local_source_upgrade_guard_test_v1',native,version:d.version,elapsedMs:performance.now()-started,calls:d.calls(),providerCalls:0,sourceSha256:digest(m.sql),existingFunctionCount:metadata.length,existingTableCount:Object.keys(history).length,allPreviousTableRowsPreserved:true,oldOperationUnchanged:true,sourceRowsOnlyAdditive:true};
    if(process.env.FCOS_SOURCE_UPGRADE_GUARD_RESULT)await writeFile(process.env.FCOS_SOURCE_UPGRADE_GUARD_RESULT+(native?'.native':'.pglite')+'.json',JSON.stringify(report,null,2)+'\n');
    t.diagnostic(JSON.stringify(report));
  });
