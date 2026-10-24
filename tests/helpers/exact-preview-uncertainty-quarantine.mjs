import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { digest } from '../../scripts/lib/hosted-release/json-contract.mjs';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const fixture = name => readFile(new URL(`../fixtures/exact-preview-uncertainty-quarantine/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
export const originalManifest = await fixture('original-manifest');
export const originalJournal = await fixture('original-operation');
export const originalRegistration = await fixture('original-registration');
export const ID = originalJournal.operation.operation_id;
export const scope = { epoch: 1, owner: { kind: 'release', id: 'features' }, releaseId: originalManifest.releaseId, manifestHash: digest(originalManifest) };
export const recoveryPrincipal = () => {
  const a = structuredClone(originalJournal.operation.actor);
  delete a.legacyContainmentBoundary;
  a.runId = '49999990001'; // distinct authenticated SYNTHETIC readback run
  a.retainedPreviewReadbackOnly = true; // server-authored, never supplied by caller
  a.environment = 'fcos-hosted-verification';
  a.subject = 'repo:hocheunglai-oss/fcos:environment:fcos-hosted-verification';
  return a;
};
const names = ['20261016190509_release_coordination.sql','20261018112914_auth_maintenance_coordination.sql',
  '20261019171349_legacy_release_effect_containment.sql','20261020080001_hosted_cutover_bootstrap.sql',
  '20261021101811_exact_7dc_public_metadata_quarantine.sql','20261021193455_qualification_schema_recovery.sql',
  '20261021211917_qualification_plan_completion.sql','20261022043925_qualification_source_upgrade.sql',
  '20261022050101_qualification_source_upgrade_policy_route.sql','20261022062147_qualification_source_upgrade_byte_collation.sql',
  '20261022154631_qualification_source_upgrade_registration_context.sql'];
export async function migrationSource() {
  const candidates = (await readdir(migrations)).filter(n => n.endsWith('_exact_preview_uncertainty_quarantine.sql'));
  assert.equal(candidates.length, 1);
  const sql = await readFile(new URL(candidates[0], migrations), 'utf8');
  return { name: candidates[0], sql, body: sql.replace(/\nbegin;\n/, '\n').replace(/\ncommit;\n?$/, '\n') };
}

/** No provider, credentials, persistent volume or external database. Native mode
 * uses a verified local immutable PG17 image on a task-owned loopback port. */
export async function quarantineDatabase(t, native = false) {
  let memory, admin, db, container, calls = 0;
  const image = 'sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675';
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000 }).trim();
  t.after(async () => {
    await db?.end(); await admin?.end(); await memory?.close();
    if (container) {
      assert.equal(docker('inspect','--format','{{index .Config.Labels "fcos.task"}}',container), 'pr122-preview-quarantine-20261023');
      docker('rm','--force',container);
    }
  });
  if (native) {
    assert.equal(docker('context','show'), 'desktop-linux');
    assert.equal(docker('info','--format','{{.Name}} {{.OSType}}'), 'docker-desktop linux');
    assert.equal(docker('image','inspect',image,'--format','{{.Id}}'), image);
    container = docker('run','--detach','--rm','--pull','never','--name',`fcos-pr122-quarantine-${randomUUID()}`,
      '--label','fcos.task=pr122-preview-quarantine-20261023','--publish','127.0.0.1::5432',
      '--tmpfs','/var/lib/postgresql/data:rw','--env','POSTGRES_HOST_AUTH_METHOD=trust',
      '--env','POSTGRES_USER=fcos_test_bootstrap','--env','POSTGRES_DB=postgres',image);
    const address = docker('port',container,'5432/tcp'); assert.match(address, /^127\.0\.0\.1:[0-9]+$/);
    for (let i = 0; ; i++) {
      try { docker('exec',container,'pg_isready','-U','fcos_test_bootstrap'); break; }
      catch (error) { if (i >= 30) throw error; await new Promise(r => setTimeout(r, 250)); }
    }
    const options = { host:'127.0.0.1',port:Number(address.split(':')[1]),database:'postgres' };
    admin = new pg.Client({ ...options,user:'fcos_test_bootstrap' }); await admin.connect();
    await admin.query('create role postgres login nosuperuser createrole inherit nobypassrls;alter database postgres owner to postgres;create role anon;create role authenticated;create role service_role');
    db = new pg.Client({ ...options,user:'postgres' }); await db.connect();
  } else {
    memory = new PGlite();
    await memory.exec('create role anon;create role authenticated;create role service_role');
  }
  const client = db || memory;
  const query = async (sql, parameters = []) => { calls++; return client.query(sql, parameters); };
  const exec = sql => db ? db.query(sql) : memory.exec(sql);
  // Supabase's actual captured journal is UTC. PGlite otherwise inherits the
  // host time zone, changing JSON timestamptz bytes despite identical instants.
  await query("set time zone 'UTC'");
  for (const name of names) await exec(await readFile(new URL(name,migrations),'utf8'));
  if (admin) await admin.query('grant fcos_coordinator_runtime,anon,authenticated,service_role to postgres with inherit false,set true');
  let serial = 0;
  const result = async (sql, parameters=[]) => (await query(sql,parameters)).rows[0].result;
  async function transaction(callback) { await query('begin'); try { return await callback(); } finally { await query('rollback'); } }
  async function fails(sql, parameters, pattern) {
    const point=`expected_${++serial}`; await query(`savepoint ${point}`);
    try { await assert.rejects(parameters.length?query(sql,parameters):exec(sql),pattern); }
    finally { await query(`rollback to savepoint ${point}`); await query(`release savepoint ${point}`); }
  }
  async function role(name, callback) {
    const point=`role_${++serial}`; await query(`savepoint ${point}`); await query(`set local role ${name}`);
    try { return await callback(); }
    finally { await query(`rollback to savepoint ${point}`); await query(`release savepoint ${point}`); }
  }
  async function state() {
    return (await query("select jsonb_build_object('control',(select to_jsonb(c) from fcos_release_coordination.control c),'operations',(select jsonb_agg(to_jsonb(o) order by operation_id) from fcos_release_coordination.operations o),'events',(select jsonb_agg(to_jsonb(e) order by event_id) from fcos_release_coordination.operation_events e),'registrations',(select jsonb_agg(to_jsonb(r) order by release_id) from fcos_release_coordination.registrations r),'imports',(select jsonb_agg(to_jsonb(i) order by import_id) from fcos_release_coordination.imported_uncertainty i),'resolutions',(select jsonb_agg(to_jsonb(i) order by import_id) from fcos_release_coordination.import_resolutions i)) result")).rows[0].result;
  }
  async function seed() {
    // Exact historical public record bytes; current fake receipts below are
    // SYNTHETIC local-only authority doubles, never portable live admission.
    const o=originalJournal.operation;
    await query("insert into fcos_release_coordination.epochs(epoch,activation_evidence) values(1,'{}')");
    await query("update fcos_release_coordination.control set epoch=1,mode='qualification'");
    // Use actual original registration bytes. Its prepare run legitimately
    // predates the separate Preview operation; never infer this actor from o.
    const r=originalRegistration;
    assert.equal(r.registration_actor.runId,'39789525210');assert.equal(o.actor.runId,'39811703824');
    assert.deepEqual(r.manifest,originalManifest);
    await query('insert into fcos_release_coordination.registrations(release_id,epoch,owner,manifest,manifest_hash,scope,registration_actor,registered_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[r.release_id,r.epoch,r.owner,r.manifest,r.manifest_hash,r.scope,r.registration_actor,r.registered_at]);
    await query('insert into fcos_release_coordination.operations(operation_id,release_id,epoch,phase,request_hash,manifest_hash,actor,created_at) values($1,$2,1,$3,$4,$5,$6,$7)',[ID,o.release_id,o.phase,o.request_hash,o.manifest_hash,o.actor,o.created_at]);
    for(const e of originalJournal.events) await query('insert into fcos_release_coordination.operation_events(event_id,operation_id,state,evidence,evidence_hash,actor,created_at) overriding system value values($1,$2,$3,$4,$5,$6,$7)',[e.event_id,ID,e.state,e.evidence,e.evidence_hash,e.actor,e.created_at]);
    await query("select setval('fcos_release_coordination.operation_events_event_id_seq',2,true)");
    await query('update fcos_release_coordination.control set operation_id=$1',[ID]);
  }
  async function proof() {
    const snapshot=await state(),now=new Date().toISOString(),H=digest('SYNTHETIC exact quarantine test evidence');
    const p={schemaVersion:1,kind:'fcos_exact_preview_uncertainty_quarantine_v1',epoch:1,operationId:ID,
      originalOperationSha256:digest(snapshot.operations[0]),originalRegistrationSha256:digest(snapshot.registrations[0]),originalEventSha256:digest(snapshot.events[1]),
      originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false,productionAuthorityGranted:false,
      terminalWriter:{kind:'fcos_exact_preview_terminal_writer_v1',repository:'hocheunglai-oss/fcos',repositoryId:'1278654816',runId:'39811703824',runAttempt:1,jobId:'119940662178',jobName:'release / preview',status:'completed',conclusion:'failure',completedAt:'2026-10-22T16:15:00Z',observedAt:now,readbackSha256:H,originalSourceProvenanceSha256:H,writerStopped:true,credentialJobOnly:true},
      maximumEffect:{kind:'fcos_exact_preview_maximum_effect_v1',argumentsSha256:'8d85327f894543f31757758c3ca4bfb51095ecf39d4af1074f77047090a3ee8e',controllerSha:originalManifest.controller.sha,candidateSha:originalManifest.candidate.sha,sourceSha256:originalManifest.candidate.sourceSha256,teamId:originalManifest.targets.vercelTeam,projectId:originalManifest.targets.vercelProject,ordinaryPreviewOnly:true,readOnlyCi:true,productionAliasesCanChange:false,financialActionsPossible:false,lateEffectPossible:true,sourceEvidenceSha256:H,transportSemanticsSha256:H,runtimeConfinementSha256:H},
      recoveryAdmission:{kind:'fcos_exact_preview_recovery_retention_acceptance_v1',accepted:true,sameCoordinator:true,authenticatedReadbackProofSha256:H,nativeDatabaseProofSha256:H,coordinatorIdentitySha256:H},
      successor:{releaseId:'synthetic-exact-preview-successor',sourceUpgradeId:'SYNTHETIC-exact-preview-new-source',controllerSha:'a'.repeat(40),callerSha:'b'.repeat(40),candidateSha:originalManifest.candidate.sha,setupSha256:'c'.repeat(64),checkerManifestSha256:digest([]),ref:'refs/heads/codex/SYNTHETIC-exact-preview-successor',repositoryId:'1278654816',actorId:'265701760',actor:'hocheunglai-oss'}};
    return reviewed(p);
  }
  return {query,exec,result,transaction,fails,role,state,seed,proof,native,container,calls:()=>calls,
    async concurrentAdmit(p) {
      assert.ok(db,'independent sessions require native PG');
      const clients=Array.from({length:2},()=>new pg.Client({host:db.connectionParameters.host,port:db.connectionParameters.port,user:'postgres',database:'postgres'}));
      try {await Promise.all(clients.map(c=>c.connect()));return await Promise.all(clients.map(c=>c.query('select fcos_release_coordination.admit_exact_preview_uncertainty_quarantine($1) result',[p]).then(r=>r.rows[0].result)));}
      finally {await Promise.all(clients.map(c=>c.end()));}
    },
    version:(await query('select version() version')).rows[0].version};
}
export function reviewed(p) {
  p=structuredClone(p);delete p.humanDecision;delete p.rootReview;delete p.independentReview;
  const now=new Date().toISOString();
  p.humanDecision={kind:'fcos_exact_preview_quarantine_human_decision_v1',operator:'hocheunglai-oss',source:'actual_direct_human_reply',replyReference:'SYNTHETIC isolated local test reply; NOT actual human approval',replySha256:digest('SYNTHETIC local reply'),scopeSha256:digest(p),approved:true,approvedAt:now,acknowledgesUnknown:true,allowsExactQuarantine:true,replayForbidden:true,productionGatesPreserved:true};
  const common={kind:'fcos_exact_preview_quarantine_review_v1',accepted:true,scopeSha256:digest(p),reviewedAt:now};
  return {...p,rootReview:{...common,role:'root',reviewerId:'/root',evidenceSha256:digest('SYNTHETIC root review')},independentReview:{...common,role:'independent',reviewerId:'/root/test_peer',evidenceSha256:digest('SYNTHETIC independent review')}};
}
