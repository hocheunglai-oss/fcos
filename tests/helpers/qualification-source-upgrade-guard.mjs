import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { digest } from '../../scripts/lib/hosted-release/json-contract.mjs';
import { bootstrapSql } from '../../scripts/lib/hosted-release/cutover-bootstrap.mjs';
import { planCompletionSql } from '../../scripts/lib/hosted-release/qualification-plan-completion.mjs';
import { sourceUpgradeFixture, repinSourceUpgrade } from './hosted-qualification-source-upgrade.mjs';
import { quarantineDatabase, migrationSource, originalManifest, originalRegistration, originalJournal, ID, reviewed } from './exact-preview-uncertainty-quarantine.mjs';

const ns = 'fcos_release_coordination.';
const directory = new URL('../../supabase/migrations/', import.meta.url);
export async function guardMigration() {
  const names = (await readdir(directory)).filter(n => n.endsWith('_qualification_source_upgrade_guarded_actions.sql'));
  assert.equal(names.length, 1);
  const sql = await readFile(new URL(names[0], directory), 'utf8');
  return { name: names[0], sql, body: sql.replace(/\nbegin;\n/, '\n').replace(/\ncommit;\n?$/, '\n') };
}
export const binding = (p, q, action, request) => ({ kind: 'fcos_fresh_source_upgrade_action_binding_v1',
  sourceUpgradeId: p.operationId, proofSha256: digest(p), actionId: action,
  requestSha256: digest(request || p.actions.find(a => a.id === action).request), previewQuarantineProofSha256: digest(q) });
export const expected = b => ({ epoch: 'fcos-hosted-source-upgrade-epoch1', objective: 'production',
  ownerThreadId: '01a0f08b-7fcb-7870-9edc-343e16052b62', operationId: b.sourceUpgradeId + ':' + b.actionId, bindingSha256: digest(b) });
export const sql = {
  claim: `select ${ns}qualification_source_upgrade_guard_claim($1,$2) result`,
  assert: `select ${ns}qualification_source_upgrade_guard_assert($1) result`,
  record: `select ${ns}qualification_source_upgrade_guard_record($1,$2,$3) result`,
  snapshot: `select ${ns}qualification_source_upgrade_guard_snapshot($1) result`,
  lookup: `select ${ns}qualification_source_upgrade_guard_lookup($1) result`,
};
export const completed = value => ({ exit_code: 0, output: JSON.stringify(value) });

/** Full private migrations and original entrypoints. Public catalogue is the
 * explicit isolated observation double already used by the existing native
 * source-upgrade fixture; this does not attest a live database or provider ACK.
 * New source/quarantine reviews are SYNTHETIC local test data. */
export async function guardDatabase(t, native = false) {
  const cleanup=[];let d;
  t.after(async()=>{
    if(native&&d?.container&&process.env.FCOS_SOURCE_UPGRADE_GUARD_SERVER_LOG) {
      try{await writeFile(process.env.FCOS_SOURCE_UPGRADE_GUARD_SERVER_LOG,execFileSync('docker',['logs',d.container],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).toString());}catch{/* Primary test failure remains authoritative. */}
    }
    for(const f of cleanup.reverse())await f();
  });
  d=await quarantineDatabase({after:f=>cleanup.push(f)},native);
  await d.exec((await migrationSource()).sql);
  const admins = (await readdir(directory)).filter(n => n.endsWith('_exact_preview_administrator_guard.sql'));
  assert.equal(admins.length, 1); await d.exec(await readFile(new URL(admins[0], directory), 'utf8'));
  const history = async () => {
    const tables=(await d.query("select tablename from pg_tables where schemaname='fcos_release_coordination' order by tablename collate \"C\"")).rows, rows={};
    for(const {tablename} of tables) rows[tablename]=(await d.query(`select count(*)::int count,fcos_release_coordination.auth_maintenance_hash(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text collate \"C\"),'[]'::jsonb)) sha256 from fcos_release_coordination.${tablename} t`)).rows[0];
    return rows;
  };
  const metadata = async () => (await d.query("select oid::int,proname,proowner::regrole::text owner,proacl::text acl,proconfig,prosecdef,prosrc from pg_proc where pronamespace='fcos_release_coordination'::regnamespace order by oid")).rows;
  const call = (name, args = []) => d.result(`select ${ns}${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args);
  const insertRegistration = r => d.query(`insert into ${ns}registrations(release_id,epoch,owner,manifest,manifest_hash,scope,registration_actor,registered_at) values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.release_id,r.epoch,r.owner,r.manifest,r.manifest_hash,r.scope,r.registration_actor,r.registered_at]);
  const contain = async (r, f) => { for (const proof of f.original.containmentProofs) await call('admit_legacy_release_containment', [r.release_id, proof]); };
  async function seedPrerequisites(initialRegistration) {
    const f = sourceUpgradeFixture();
    await d.exec(`create or replace function ${ns}qualification_schema_recovery_catalog_digest() returns text language sql stable set search_path=pg_catalog as $$select '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'::text$$`);
    await call('install_epoch', [1, f.activation]); await call('admit_exact_7dc_publication_quarantine', [f.quarantine]);
    for (const command of ['admit']) { const q = bootstrapSql(command, f.original); await d.result(q.query, q.parameters); }
    for (const a of f.original.actions) for (const command of ['intent','record']) {
      const q = bootstrapSql(command, f.original, { actionId:a.id, evidence:{basis:'native_ack',outcome:'applied',requestSha256:digest(a.request),providerEvidenceSha256:f.H,rootReviewSha256:f.original.rootReviewSha256} });
      await d.result(q.query, q.parameters);
    }
    { const q=bootstrapSql('finish',f.original); await d.result(q.query,q.parameters); }
    await call('admit_qualification_schema_recovery',[f.recovery]);
    for(const a of f.recovery.actions) {
      await call('qualification_schema_recovery_intent',[f.recovery.recoveryId,a.id,digest(f.recovery)]);
      await call('record_qualification_schema_recovery',[f.recovery.recoveryId,a.id,digest(f.recovery),{basis:'native_ack',outcome:'applied',requestSha256:digest(a.request),providerEvidenceSha256:f.H,rootReviewSha256:digest(f.recovery.rootReview)}]);
    }
    await call('finish_qualification_schema_recovery',[f.recovery.recoveryId,digest(f.recovery)]);
    for(const command of ['admit','intent','record','finish']) {
      const response={completed:true,status:204,exitCode:0,bodyEmpty:true};
      const q=planCompletionSql(command,f.proof,{evidence:{basis:'native_ack',outcome:'applied',requestSha256:digest(f.proof.request),providerEvidenceSha256:digest(response),rootReviewSha256:digest(f.proof.rootReview),response}});
      await d.result(q.query,q.parameters);
    }
    const r=initialRegistration || {release_id:f.scope.releaseId,epoch:1,owner:f.scope.owner,manifest:f.manifest,manifest_hash:digest(f.manifest),scope:'qualification',registration_actor:f.principal,registered_at:'2026-10-21T23:05:00+00:00'};
    await insertRegistration(r); await contain(r,f);
    return { f,r };
  }
  async function completeSource(p, configuration) {
    await call('admit_qualification_source_upgrade',[p]);
    const H=digest('SYNTHETIC local native acknowledgements, never provider evidence');
    const ready={kind:'fcos_qualification_source_upgrade_ready_v1',accepted:true,operationId:p.operationId,proofSha256:digest(p),projectId:p.preservation.project.id,teamId:p.preservation.team.id,deploymentId:'dpl_SYNTHETICguardparent001',coordinatorUrl:'https://synthetic-guard-parent.vercel.app/coordinate',policySha256:digest(p.policy),setupSha256:p.setupSha256,checkerManifestSha256:digest(p.checkerManifest),preservationSha256:digest(p.preservation),sourceEvidenceSha256:H,rootReviewSha256:H,independentReviewSha256:digest('SYNTHETIC distinct parent READY review'),observedAt:new Date().toISOString()};
    for(const a of p.actions) {
      if(a.id==='dispatch') {
        if(configuration) {
          await d.query(`insert into ${ns}qualification_source_upgrade_milestones(operation_id,milestone,closure,closure_sha256) values($1,'configuration_ready',$2,$3)`,[p.operationId,configuration,digest(configuration)]);
          await d.query(`update ${ns}control set source_upgrade_id=null`);
        } else await call('finish_qualification_source_upgrade_configuration',[p.operationId,digest(p),{...ready,kind:'fcos_qualification_source_upgrade_configuration_v1'}]);
      }
      let i;
      if(configuration) {
        // Seed already-completed, validated immutable history in this isolated
        // operational fixture. No clock is refreshed and no admission is replayed.
        const request=structuredClone(a.request),pastReady={...configuration,kind:'fcos_qualification_source_upgrade_ready_v1'};
        if(a.id==='url_patch')request.body.value=configuration.coordinatorUrl;
        await d.query(`insert into ${ns}qualification_source_upgrade_intents(operation_id,action_id,ordinal,request,request_sha256,ready,intended_at) values($1,$2,$3,$4,$5,$6,$7)`,[p.operationId,a.id,p.actions.indexOf(a)+1,request,digest(request),a.id==='url_patch'?pastReady:null,configuration.observedAt]);
        i={requestSha256:digest(request)};
      } else i=await call('qualification_source_upgrade_intent',[p.operationId,a.id,digest(p),a.id==='url_patch'?ready:null]);
      const response={completed:true,status:['policy_patch','checker_deploy'].includes(a.id)?200:204,exitCode:0,bodyEmpty:!['policy_patch','checker_deploy'].includes(a.id),...(a.id==='checker_deploy'?{deploymentId:configuration?.deploymentId||ready.deploymentId,coordinatorUrl:configuration?.coordinatorUrl||ready.coordinatorUrl}:{})};
      await call('record_qualification_source_upgrade',[p.operationId,a.id,digest(p),{basis:'native_ack',outcome:'applied',requestSha256:i.requestSha256,providerEvidenceSha256:digest(response),rootReviewSha256:digest(p.rootReview),response}]);
      if(a.id==='dispatch') await call('finish_qualification_source_upgrade_dispatch',[p.operationId,digest(p),{kind:'fcos_qualification_source_upgrade_dispatch_v1',accepted:true,operationId:p.operationId,proofSha256:digest(p),requestSha256:i.requestSha256,providerEvidenceSha256:digest(response),sourceEvidenceSha256:H}]);
    }
    return configuration || {...ready,kind:'fcos_qualification_source_upgrade_configuration_v1'};
  }
  async function seed(actual) {
    const {f,r}=await seedPrerequisites(actual?.initialRegistration);
    let parent=actual?.parent;
    if(!parent) {
      parent=sourceUpgradeFixture(digest(r)).upgrade;
      parent.operationId='qualification-source-upgrade-epoch1-39715847468-v1';
      parent.setup.controllerSha=originalManifest.controller.sha;parent.setup.qualificationSource=originalManifest.qualificationSource;
      parent.plan.releaseId=originalManifest.releaseId;parent.manifest=structuredClone(originalManifest);
      const q=parent.setup.qualificationSource;
      Object.assign(parent.policy.qualificationAdmission,{ref:q.ref,bootstrapSha:q.bootstrapSha,callerWorkflowSha:q.bootstrapSha,callerWorkflowRef:q.callerWorkflowRef,jobWorkflowSha:q.controllerSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${q.controllerSha}`});
      parent=repinSourceUpgrade(parent);assert.deepEqual(parent.manifest,originalManifest);
    }
    // Actual historical closure may be aged: table integrity accepts history;
    // a new live finish RPC must still enforce its original freshness gate.
    const config=await completeSource(parent,actual?.configuration);
    await insertRegistration(originalRegistration);await contain(originalRegistration,f);
    const o=originalJournal.operation;
    await d.query(`insert into ${ns}operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor,created_at) values($1,$2,1,$3,$4,$5,$6,$7)`,[ID,o.release_id,o.phase,o.request_hash,o.manifest_hash,o.actor,o.created_at]);
    for(const e of originalJournal.events) await d.query(`insert into ${ns}operation_events(event_id,operation_id,state,evidence,evidence_hash,actor,created_at) overriding system value values($1,$2,$3,$4,$5,$6,$7)`,[e.event_id,ID,e.state,e.evidence,e.evidence_hash,e.actor,e.created_at]);
    await d.query(`update ${ns}control set operation_id=$1`,[ID]);
    let p=actual?.proof;
    if(!p) {
      p=structuredClone(parent);p.operationId='SYNTHETIC-source-upgrade-guard-successor';
      p.parent={kind:'source_upgrade',operationId:parent.operationId,proofSha256:digest(parent),releaseId:parent.plan.releaseId,manifestHash:parent.manifestSha256};
      p.previous={setup:parent.setup,plan:parent.plan,manifest:parent.manifest};p.previousRegistrationSha256=digest(originalRegistration);
      p.previousConfiguration=config;p.previousPolicy=parent.policy;p.previousCheckerManifest=parent.checkerManifest;
      p.setup.controllerSha='e'.repeat(40);const q=p.setup.qualificationSource;
      Object.assign(q,{ref:'refs/heads/codex/SYNTHETIC-source-guard-successor',bootstrapSha:'f'.repeat(40),controllerSha:p.setup.controllerSha,callerWorkflowRef:'hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@refs/heads/codex/SYNTHETIC-source-guard-successor'});
      p.plan.releaseId='synthetic-source-guard-successor';p.manifest.releaseId=p.plan.releaseId;p.manifest.controller.sha=p.setup.controllerSha;p.manifest.qualificationSource=q;
      Object.assign(p.policy.qualificationAdmission,{ref:q.ref,bootstrapSha:q.bootstrapSha,callerWorkflowSha:q.bootstrapSha,callerWorkflowRef:q.callerWorkflowRef,jobWorkflowSha:q.controllerSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${q.controllerSha}`});
      p=repinSourceUpgrade(p);
    }
    let quarantine=actual?.quarantine;
    if(!quarantine) {
      quarantine=await d.proof();quarantine.originalRegistrationSha256=digest(originalRegistration);
      quarantine.successor={...quarantine.successor,sourceUpgradeId:p.operationId,releaseId:p.plan.releaseId,controllerSha:p.setup.controllerSha,callerSha:p.setup.qualificationSource.bootstrapSha,ref:p.setup.qualificationSource.ref,setupSha256:p.setupSha256,checkerManifestSha256:digest(p.checkerManifest)};
      quarantine=reviewed(quarantine);await call('admit_exact_preview_uncertainty_quarantine',[quarantine]);
    } else {
      // Exact already-admitted historical proof, not a refreshed admission.
      await d.query(`insert into ${ns}exact_preview_uncertainty_quarantines values($1,1,$2,$3,$4)`,[ID,quarantine,digest(quarantine),'2026-10-22T19:40:00Z']);
      await d.query(`update ${ns}control set operation_id=null`);
    }
    assert.equal(await call('qualification_source_upgrade_proof_valid',[p]),true);
    assert.equal((await call('admit_qualification_source_upgrade',[p])).disposition,'admitted');
    return {p,quarantine,parent,config};
  }
  return {...d,metadata,history,call,seed,completeSource};
}
