import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {createNotificationChallenge} from '../supabase/functions/release-coordinator/core.mjs';
import {createCoordinatorHandler,createSqlStore} from '../supabase/functions/release-coordinator/index.ts';
import {canonical,digest} from '../scripts/lib/hosted-release/json-contract.mjs';
import {bootstrapSql} from '../scripts/lib/hosted-release/cutover-bootstrap.mjs';
import {schemaRecoveryActions,validateSchemaRecoveryProof,schemaRecoverySql,createQualificationSchemaRecoveryOperator} from '../scripts/lib/hosted-release/qualification-schema-recovery.mjs';
import {schemaRecoveryFixture,schemaQuarantineFixture,reviewRecovery,schemaConfigurationFixture} from './helpers/hosted-qualification-schema-recovery.mjs';
import {typedFirstRuntimeFixture} from './helpers/hosted-first-runtime-v2.mjs';
import {SCHEMA_QUERY} from '../scripts/lib/hosted-release/observations.mjs';
const load=n=>readFile(new URL(`../supabase/migrations/${n}`,import.meta.url),'utf8');
const names=['20261016190509_release_coordination.sql','20261018112914_auth_maintenance_coordination.sql','20261019171349_legacy_release_effect_containment.sql','20261020080001_hosted_cutover_bootstrap.sql','20261021101811_exact_7dc_public_metadata_quarantine.sql'];
const migrationName='20261022000001_qualification_schema_recovery.sql',migration=await load(migrationName);
function repin(p){p.setupSha256=digest(p.setup);p.planSha256=digest(p.plan);p.actions=schemaRecoveryActions(p);return reviewRecovery(p);}

test('JS proof/route construction refuses source, setup, plan, review and arbitrary-command drift',()=>{
 const f=schemaRecoveryFixture();assert.doesNotThrow(()=>validateSchemaRecoveryProof(f.recovery,{originalProof:f.original}));
 for(const mutate of [p=>p.epoch=2,p=>p.extra=true,p=>p.originalBootstrapSha256=f.J,p=>p.setup.controllerSha='c'.repeat(40),
  p=>p.setup.extra=true,p=>p.plan.scope.financialAuthority=true,p=>p.plan.migration.mode='apply',p=>p.plan.extra=true,
  p=>p.terminalFailure.runId='101',p=>p.terminalFailure.beforeRegistration=false]) {
  const p=structuredClone(f.recovery);mutate(p);assert.throws(()=>validateSchemaRecoveryProof(repin(p),{originalProof:f.original}));
 }
 for(const slot of ['rootReview','independentReview'])for(const patch of [{accepted:false},{subjectSha256:f.J},{sourceEvidenceSha256:null},{role:'root'},{reviewerId:'/root'},{extra:true}]){
  if(slot==='rootReview'&&(patch.role==='root'||patch.reviewerId==='/root'))continue;
  assert.throws(()=>validateSchemaRecoveryProof({...f.recovery,[slot]:{...f.recovery[slot],...patch}},{originalProof:f.original}));
 }
 assert.throws(()=>schemaRecoverySql('arbitrary',f.recovery));
 assert.throws(()=>createQualificationSchemaRecoveryOperator({proof:f.recovery,originalProof:f.original,admin:{projectRef:'wrong',query(){}},github:{request(){}}}));
});

function operatorTransportFixture(outcome,{configurationPatch={}}={}) {
 const f=schemaRecoveryFixture(),calls=[],action=f.recovery.actions[0];
 const admin={projectRef:'pjforfvchygdyqfcgpmw',query:async(q)=>{calls.push({kind:'sql',q});
  if(q.includes('_snapshot('))return{rows:[{result:{actions:[],events:[]}}]};
  if(q.includes('_intent('))return{rows:[{result:{disposition:'execute',request:action.request,requestSha256:digest(action.request)}}]};
  if(q.includes('record_'))return{rows:[{result:{disposition:'recorded',state:'applied'}}]};
  throw Error('unexpected synthetic RPC');}};
 const github={request:async r=>{calls.push({kind:r.method==='GET'?'get':'native',r});if(r.method!=='GET'){if(outcome instanceof Error)throw outcome;return outcome;}
  if(r.route==='/user')return{id:265701760,login:'hocheunglai-oss'};if(r.route==='/repos/hocheunglai-oss/fcos')return{id:1278654816,full_name:'hocheunglai-oss/fcos'};
  if(r.route.includes('/branches/'))return{protected:true,commit:{sha:f.original.bootstrapSha}};
  if(r.route.includes('/actions/runs/'))return{id:39653018028,status:'completed',conclusion:'failure',run_attempt:1,head_sha:f.original.bootstrapSha,head_branch:f.original.ref.slice(11)};
  if(r.route.endsWith('FCOS_HOSTED_QUALIFICATION_ADMITTED'))return{name:'FCOS_HOSTED_QUALIFICATION_ADMITTED',value:'true'};
  return r.route.endsWith('_SHA256')?{name:'FCOS_ADMITTED_RELEASE_SETUP_SHA256',value:f.original.setupSha256}:{name:'FCOS_ADMITTED_RELEASE_SETUP',value:canonical(f.original.setup)};}};
 const operator=createQualificationSchemaRecoveryOperator({proof:f.recovery,originalProof:f.original,admin,github,
  verifyConfiguration:async()=>{calls.push({kind:'configuration'});return {...schemaConfigurationFixture(f.recovery),...configurationPatch};},
  verifyOwnerReadback:async()=>{calls.push({kind:'owner_readback'});throw Error('no separate readback admitted');}});
 return {operator,calls,review:{rootReviewSha256:digest(f.recovery.rootReview)}};
}
test('uncertain/refused/contradictory native envelopes stop locally with zero follow-on RPC, record or retry',async()=>{
 for(const outcome of [new Error('timeout'),undefined,null,{status:429},{status:500},{status:204,disposition:'pending'},
  {status:204,disposition:'unknown'},{status:204,disposition:'refused'},{status:204,exitCode:1},{status:204,ok:false}]){
  const {operator,calls,review}=operatorTransportFixture(outcome);await assert.rejects(operator.execute('replace_setup',review),/RESPONSE_UNKNOWN/);
  const stop=calls.length;for(const operation of [()=>operator.execute('replace_setup',review),()=>operator.execute('replace_setup_sha',review),()=>operator.admit(),()=>operator.snapshot(),()=>operator.finish()])await assert.rejects(operation(),/OWNER_READBACK_REQUIRED/);
  assert.equal(calls.length,stop);assert.equal(calls.filter(c=>c.kind==='native').length,1);assert.equal(calls.filter(c=>c.kind==='owner_readback').length,0);
  assert.equal(calls.filter(c=>c.kind==='sql'&&c.q.includes('record_')).length,0);
 }
 const known=operatorTransportFixture({status:204});assert.equal((await known.operator.execute('replace_setup',known.review)).disposition,'applied');
 assert.equal(known.calls.filter(c=>c.kind==='sql'&&c.q.includes('record_')).length,1);
});
test('actual finite configuration callback is mandatory and any target/source/policy/closure mismatch refuses before intent',async()=>{
 for(const patch of [{accepted:false},{projectId:'foreign'},{teamId:'foreign'},{serverSourceSha:'c'.repeat(40)},{serverSourceManifestSha256:'b'.repeat(64)},
  {policySha256:'b'.repeat(64)},{setupSha256:'b'.repeat(64)},{credentialsPreserved:false},{defaultProductionPreserved:false},{publicCoordinatorUrlMatches:false},
  {coordinatorUrl:'https://foreign.invalid/coordinate'},{extra:true}]){
  const {operator,calls,review}=operatorTransportFixture({status:204},{configurationPatch:patch});await assert.rejects(operator.execute('replace_setup',review),/CONFIGURATION_REQUIRED/);
  const stop=calls.length;await assert.rejects(operator.snapshot(),/OWNER_READBACK_REQUIRED/);assert.equal(calls.length,stop);
  assert.equal(calls.filter(c=>c.kind==='native').length,0);assert.equal(calls.filter(c=>c.kind==='sql'&&c.q.includes('_intent(')).length,0);
 }
});

test('native PostgreSQL finite same-epoch recovery preserves the original journal and UNKNOWN history',async t=>{
 const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim(),dir=await mkdtemp(path.join(tmpdir(),'fcos-schema-recovery-pg-')),data=path.join(dir,'data'),port=54634;
 let started=false,db,admin;
 t.after(async()=>{await db?.end();await admin?.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(dir,{recursive:true,force:true});});
 execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fcos_test_bootstrap','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -p ${port}`,'-w','start'],{stdio:'pipe'});started=true;
 admin=new pg.Client({host:dir,port,user:'fcos_test_bootstrap',database:'postgres'});await admin.connect();
 await admin.query('create role postgres login nosuperuser createrole inherit nobypassrls;alter database postgres owner to postgres;create role anon;create role authenticated;create role service_role');
 db=new pg.Client({host:dir,port,user:'postgres',database:'postgres'});await db.connect();for(const n of names)await db.query(await load(n));
 const patched=['cutover_bootstrap_claim_ready(jsonb)','cutover_bootstrap_pending(text,jsonb,jsonb)','dispatch(text,jsonb,jsonb)','install_epoch(bigint,jsonb)','activate(bigint,jsonb)'];
 const unchanged=['cutover_bootstrap_proof_valid(jsonb)','dispatch_without_auth_maintenance(text,jsonb,jsonb)','legacy_release_unknowns_contained(fcos_release_coordination.registrations,jsonb,boolean)'];
 const metadata=async()=>(await db.query('select oid::int,proname,prosrc,prosecdef,proconfig,proowner::regrole::text owner,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by oid',[[...patched,...unchanged].map(s=>'fcos_release_coordination.'+s)])).rows;
 const before=await metadata();
 for(const signature of patched)await t.test(`exact source drift refuses ${signature}`,async()=>{
  await db.query('begin');const def=(await db.query('select pg_get_functiondef($1::regprocedure) v',['fcos_release_coordination.'+signature])).rows[0].v;
  await db.query(def.replace('AS $function$','AS $function$\n-- synthetic drift'));await assert.rejects(db.query(migration),/SCHEMA_RECOVERY_SOURCE_DRIFT/);await db.query('rollback');
  assert.deepEqual(await metadata(),before);assert.equal((await db.query("select to_regclass('fcos_release_coordination.qualification_schema_recoveries') v")).rows[0].v,null);
 });
 await db.query(migration);for(const prior of before){const current=(await metadata()).find(r=>r.oid===prior.oid);for(const k of ['oid','prosecdef','proconfig','owner','acl'])assert.deepEqual(current[k],prior[k]);if(unchanged.some(s=>s.startsWith(prior.proname+'(')))assert.equal(current.prosrc,prior.prosrc);}
 await admin.query('grant fcos_coordinator_runtime,anon,authenticated,service_role to postgres with inherit false,set true');let serial=0;
 async function fails(q,p,pattern){const s=`expected_${++serial}`;await db.query(`savepoint ${s}`);try{await assert.rejects(db.query(q,p),pattern);}finally{await db.query(`rollback to savepoint ${s}`);await db.query(`release savepoint ${s}`);}}
 async function role(name,q,p=[]){const s=`role_${++serial}`;await db.query(`savepoint ${s}`);await db.query(`set local role ${name}`);try{const r=await db.query(q,p);await db.query('reset role');await db.query(`release savepoint ${s}`);return r;}catch(e){await db.query(`rollback to savepoint ${s}`);await db.query('reset role');await db.query(`release savepoint ${s}`);throw e;}}
 const store=createSqlStore((q,p)=>role('fcos_coordinator_runtime',q,p),{bootstrapAdmission:true});
 const valid=async p=>(await db.query('select fcos_release_coordination.qualification_schema_recovery_proof_valid($1) v',[p])).rows[0].v;
 await t.test('real private catalog function is byte-equivalent to exact64aa query and detects public drift',async()=>{
  assert.equal(digest(SCHEMA_QUERY),'1e2adc39dde451751f683ec9bc7560463f6afdd753da165e1659da9b9b16291b');
  const fn=(await db.query("select prosrc,proconfig from pg_proc where oid='fcos_release_coordination.qualification_schema_recovery_catalog_digest()'::regprocedure")).rows[0];
  assert.equal(fn.prosrc,`\n select fcos_release_coordination.auth_maintenance_hash(snapshot) from (\n${SCHEMA_QUERY}\n ) observed_catalog\n`);assert.deepEqual(fn.proconfig,['search_path=pg_catalog']);
  const current=async()=>(await db.query('select fcos_release_coordination.qualification_schema_recovery_catalog_digest() v')).rows[0].v;
  const expected=digest((await db.query(SCHEMA_QUERY)).rows[0].snapshot);assert.equal(await current(),expected);
  await db.query('begin');try{await db.query('create table public.synthetic_schema_probe(id integer)');assert.notEqual(await current(),expected);assert.equal(await current(),digest((await db.query(SCHEMA_QUERY)).rows[0].snapshot));}finally{await db.query('rollback');}
 });
 // Explicit disposable-DB dependency test double. Production SQL/query/constants
 // remain byte-identical; no test hook, GUC or bypass is shipped. The real
 // function/query equivalence and drift were verified above before this stub.
 const realCatalogDefinition=(await db.query("select pg_get_functiondef('fcos_release_coordination.qualification_schema_recovery_catalog_digest()'::regprocedure) v")).rows[0].v;
 const syntheticCatalog=()=>db.query("create or replace function fcos_release_coordination.qualification_schema_recovery_catalog_digest() returns text language sql stable set search_path=pg_catalog as $$select '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'::text$$");
 await syntheticCatalog();
 async function fixture({finishOriginal=true}={}) {
  const f=schemaRecoveryFixture(),quarantine=schemaQuarantineFixture(),activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:f.H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:f.H,proofHash:f.H},writers:[{id:'original',disabled:true,proofHash:f.H}],uncertainties:[...f.unknowns,quarantine.incident]};
  await db.query('select fcos_release_coordination.install_epoch(1,$1)',[activation]);await db.query('select fcos_release_coordination.admit_exact_7dc_publication_quarantine($1)',[quarantine.proof]);
  const old=async(command,extra)=>{const q=bootstrapSql(command,f.original,extra);return (await db.query(q.query,q.parameters)).rows[0].result;};
  await old('admit');for(const a of f.original.actions){await old('intent',{actionId:a.id});await old('record',{actionId:a.id,evidence:{basis:'native_ack',outcome:'applied',requestSha256:digest(a.request),providerEvidenceSha256:f.H,rootReviewSha256:f.H}});}if(finishOriginal)await old('finish');
  const q=async(command,extra)=>{const v=schemaRecoverySql(command,f.recovery,extra);return (await db.query(v.query,v.parameters)).rows[0].result;};
  const evidence=(id,patch={})=>({basis:'native_ack',outcome:'applied',requestSha256:digest(f.recovery.actions.find(a=>a.id===id).request),providerEvidenceSha256:f.H,rootReviewSha256:digest(f.recovery.rootReview),...patch});
  const boundary={validatedBy:'trusted_coordinator',manifestHash:f.scope.manifestHash,controllerSha:f.original.controllerSha,setupSha256:f.recovery.setupSha256,policySha256:digest(f.original.setup.legacyReleaseContainment)};
  const intent={...f.scope,phase:'preview.create',operationId:'synthetic-recovery-preview',requestHash:f.H};
  return {...f,activation,q,evidence,intent,boundary,admit:()=>q('admit'),finish:()=>q('finish'),
   apply:async()=>{for(const a of f.recovery.actions){assert.equal((await q('intent',{actionId:a.id})).disposition,'execute');await q('record',{actionId:a.id,evidence:evidence(a.id)});}return q('finish');},
   register:()=>store.request('register',{...f.scope,manifest:f.manifest},f.principal),begin:()=>store.request('begin',intent,{...f.principal,legacyContainmentBoundary:boundary}),
   contain:i=>db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,f.original.containmentProofs[i]])};
 }
 async function scenario(name,fn){await t.test(name,async()=>{await db.query('begin');try{await fn();}finally{await db.query('rollback');}});}
 await scenario('real changed catalog refuses before admission/new intent but permits known-ACK finish',async()=>{
  const f=await fixture();await db.query(realCatalogDefinition);
  await fails('select fcos_release_coordination.admit_qualification_schema_recovery($1)',[f.recovery],/LIVE_SCHEMA_CHANGED/);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.qualification_schema_recoveries')).rows[0].n,0);
  await syntheticCatalog();await f.admit();await db.query(realCatalogDefinition);
  await fails('select fcos_release_coordination.qualification_schema_recovery_intent($1,$2,$3)',[f.recovery.recoveryId,'replace_setup',digest(f.recovery)],/LIVE_SCHEMA_CHANGED/);
  await syntheticCatalog();for(const a of f.recovery.actions){await f.q('intent',{actionId:a.id});await f.q('record',{actionId:a.id,evidence:f.evidence(a.id)});}await db.query(realCatalogDefinition);
  assert.equal((await f.finish()).disposition,'complete');
 });
 await scenario('one reservation, three exact actions, finite finish; original tuple cannot claim successor',async()=>{
  const f=await fixture();assert.equal(await valid(f.recovery),true);
  const histories=async()=>(await db.query("select 'bootstrap' kind,to_jsonb(b) v from fcos_release_coordination.cutover_bootstraps b union all select 'unknown',to_jsonb(u) from fcos_release_coordination.imported_uncertainty u order by kind,v")).rows;
  const original=await histories();assert.equal((await f.admit()).disposition,'admitted');assert.equal((await f.admit()).disposition,'readback');
  assert.equal((await f.apply()).disposition,'complete');assert.equal((await f.finish()).disposition,'complete');assert.equal((await f.q('intent',{actionId:'dispatch_qualification'})).disposition,'readback');
  assert.equal((await f.register()).registered,true);assert.equal((await f.begin()).disposition,'busy');await f.contain(0);assert.equal((await f.begin()).disposition,'busy');await f.contain(1);
  assert.equal((await f.begin()).disposition,'execute');assert.deepEqual(await histories(),original);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.import_resolutions')).rows[0].n,0);
  for(const table of ['authorizations','activations','auth_maintenance_authorities'])assert.equal((await db.query(`select count(*)::int n from fcos_release_coordination.${table}`)).rows[0].n,0);
  const wrong={...f.scope,manifestHash:f.J};assert.equal((await db.query('select fcos_release_coordination.cutover_bootstrap_claim_ready($1) v',[wrong])).rows[0].v,false);
 });
 await scenario('partial setup handoff blocks actual registration/install/activation/new operations; exact metadata wait only',async()=>{
  const f=await fixture();await f.admit();await f.q('intent',{actionId:'replace_setup'});await f.q('record',{actionId:'replace_setup',evidence:f.evidence('replace_setup')});
  assert.equal(await store.admissionPending('register',{...f.scope,manifest:f.manifest},f.principal),true);
  const handler=createCoordinatorHandler({store,authenticateGithub:async()=>f.principal,validateQualification:async()=>assert.fail('pending cannot read provider metadata')});
  const response=await handler(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic'},body:JSON.stringify({action:'register',payload:{...f.scope,manifest:f.manifest}})}));
  assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:'COORDINATION_METADATA_PENDING'});
  assert.equal(await store.admissionPending('register',{...f.scope,manifest:{...f.manifest,setupSha256:f.J}},f.principal),false);
  for(const patch of [{actorId:'1'},{runAttempt:'2'},{sha:'c'.repeat(40)},{kind:'financial'}])assert.equal(await store.admissionPending('register',{...f.scope,manifest:f.manifest},{...f.principal,...patch}),false);
  await assert.rejects(f.register(),/BOOTSTRAP_BUSY/);await assert.rejects(f.begin(),/BOOTSTRAP_BUSY/);
  await fails('select fcos_release_coordination.install_epoch(2,$1)',[{...f.activation,notificationChallenge:createNotificationChallenge()}],/BOOTSTRAP_BUSY/);
  await fails('select fcos_release_coordination.activate(1,$1)',[{}],/BOOTSTRAP_BUSY/);
  await fails('select fcos_release_coordination.finish_qualification_schema_recovery($1,$2)',[f.recovery.recoveryId,digest(f.recovery)],/PRIOR_ACTION_UNRESOLVED/);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.registrations')).rows[0].n,0);
 });
 await scenario('unknown/absent ACK is consumed once and requires exact owner readback, never follow-on or replay',async()=>{
  const f=await fixture();await f.admit();await f.q('intent',{actionId:'replace_setup'});await f.q('record',{actionId:'replace_setup',evidence:f.evidence('replace_setup',{outcome:'unknown'})});
  assert.equal((await f.q('intent',{actionId:'replace_setup'})).disposition,'readback');
  await fails('select fcos_release_coordination.qualification_schema_recovery_intent($1,$2,$3)',[f.recovery.recoveryId,'replace_setup_sha',digest(f.recovery)],/PRIOR_ACTION_UNRESOLVED/);
  await fails('select fcos_release_coordination.record_qualification_schema_recovery($1,$2,$3,$4)',[f.recovery.recoveryId,'replace_setup',digest(f.recovery),f.evidence('replace_setup')],/READBACK_REQUIRED/);
  await f.q('record',{actionId:'replace_setup',evidence:f.evidence('replace_setup',{basis:'owner_readback'})});assert.equal((await f.q('intent',{actionId:'replace_setup_sha'})).disposition,'execute');
 });
 await scenario('unfinished original, changed old hash/epoch/source/setup/plan/schema/terminal evidence refuse',async()=>{
  await db.query('savepoint unfinished');const unfinished=await fixture({finishOriginal:false});assert.equal(await valid(unfinished.recovery),false);await db.query('rollback to savepoint unfinished');await db.query('release savepoint unfinished');
  const f=await fixture();
  for(const mutate of [p=>p.originalBootstrapSha256=f.J,p=>p.epoch=2,p=>p.recoveryId='another',p=>p.setup.extra=true,p=>p.setup.qualificationSource.controllerSha='c'.repeat(40),p=>p.setup.qualificationSource.ref='refs/heads/main',
   p=>p.plan.scope.financialAuthority=true,p=>p.plan.migration.mode='apply',p=>p.plan.extra=true,p=>p.plan.migration.expectedSchemaSha256=f.J,p=>p.terminalFailure.runId='103',p=>p.terminalFailure.beforeRegistration=false,p=>p.extra=true]){
   const p=structuredClone(f.recovery);mutate(p);assert.equal(await valid(repin(p)),false);
  }
  for(const slot of ['rootReview','independentReview'])for(const patch of [{accepted:false},{subjectSha256:f.J},{role:'unknown'},{reviewerId:'/root/other'},{extra:true},{reviewedAt:'infinity'}])assert.equal(await valid({...f.recovery,[slot]:{...f.recovery[slot],...patch}}),false);
  const baseline=JSON.parse(f.recovery.setup.firstRuntimeBaseline.json);baseline.runtime.capturedAt='2026-10-21T19:00:00Z';
  const p=structuredClone(f.recovery);p.setup.firstRuntimeBaseline.json=JSON.stringify(baseline);p.setup.firstRuntimeBaseline.sha256=digest(p.setup.firstRuntimeBaseline.json);assert.equal(await valid(repin(p)),false);
  const first=typedFirstRuntimeFixture({now:Date.parse('2026-10-18T12:00:00Z')});
  for(const mutate of [v=>v.schema.projectRef='foreign',v=>v.schema.sha256=f.J,v=>v.schema.extra=true,v=>v.nativeEvidence.schema.extra=true,
   v=>v.configurationCopy.capturedAt='2026-10-21T18:45:00Z',v=>v.originalOwners.xero.ownerId='another-owner']){
   const bad=structuredClone(f.recovery),value=JSON.parse(bad.setup.firstRuntimeBaseline.json);mutate(value);
   bad.setup.firstRuntimeBaseline=first.referenceFor(value,r=>r.reviewedAt='2026-10-21T18:45:00Z');assert.equal(await valid(repin(bad)),false);
   assert.throws(()=>validateSchemaRecoveryProof(repin(bad),{originalProof:f.original}));
  }
  await fails('update fcos_release_coordination.cutover_bootstraps set proof=$1',[f.recovery],/APPEND_ONLY/);
 });
 await scenario('revoked quarantine blocks finish and retains the recovery reservation',async()=>{
  const f=await fixture();await f.admit();for(const a of f.recovery.actions){await f.q('intent',{actionId:a.id});await f.q('record',{actionId:a.id,evidence:f.evidence(a.id)});}
  const q=(await db.query('select proof_sha256 from fcos_release_coordination.exact_7dc_publication_quarantines')).rows[0];
  await db.query('select fcos_release_coordination.revoke_exact_7dc_publication_quarantine($1,$2,$3)',['replacement-template-7dc21331fe45',q.proof_sha256,f.H]);
  await fails('select fcos_release_coordination.finish_qualification_schema_recovery($1,$2)',[f.recovery.recoveryId,digest(f.recovery)],/PRIOR_ACTION_UNRESOLVED/);
  assert.equal((await db.query('select recovery_id from fcos_release_coordination.control')).rows[0].recovery_id,f.recovery.recoveryId);
 });
 await scenario('quarantine revocation or any original resolution blocks admission, finish and effective claim',async()=>{
  const f=await fixture();await f.admit();await f.apply();await f.register();await f.contain(0);await f.contain(1);
  await db.query('insert into fcos_release_coordination.import_resolutions(import_id,evidence) values($1,$2)',[f.unknowns[0].operationId,{outcome:'not_applied',ownerReadbackHash:f.H}]);
  assert.equal(await valid(f.recovery),false);assert.equal((await f.begin()).disposition,'busy');
 });
 await scenario('private ACL/RLS, append-only tables, consumed conflict and second recovery refusal',async()=>{
  const f=await fixture();await f.admit();
  for(const name of ['anon','authenticated','service_role','fcos_coordinator_runtime'])for(const q of ['select * from fcos_release_coordination.qualification_schema_recoveries',"select fcos_release_coordination.admit_qualification_schema_recovery('{}')"])
   await assert.rejects(role(name,q),/permission denied/);
  for(const table of ['qualification_schema_recoveries','qualification_schema_recovery_actions','qualification_schema_recovery_events','qualification_schema_recovery_finishes'])await fails(`truncate fcos_release_coordination.${table} cascade`,[],/APPEND_ONLY/);
  const other=reviewRecovery({...f.recovery,recoveryId:'another'});await fails('select fcos_release_coordination.admit_qualification_schema_recovery($1)',[other],/ADMISSION_INVALID/);
  await fails('select fcos_release_coordination.admit_qualification_schema_recovery($1)',[reviewRecovery({...f.recovery,originalBootstrapSha256:f.J})],/CONFLICT/);
  await fails('select fcos_release_coordination.admit_cutover_bootstrap($1)',[{...f.original,bootstrapId:'second-bootstrap'}],/ADMISSION_INVALID/);
 });
 await scenario('fourth UNKNOWN cannot enter recovery',async()=>{
  const f=await fixture();await db.query('insert into fcos_release_coordination.imported_uncertainty values($1,1,$2)',['fourth',{operationId:'fourth',evidenceHash:f.H}]);
  assert.equal(await valid(f.recovery),false);await fails('select fcos_release_coordination.admit_qualification_schema_recovery($1)',[f.recovery],/ADMISSION_INVALID/);
 });
 await scenario('preexisting original registration cannot enter recovery',async()=>{
  const f=await fixture(),old=f.original;
  const manifest={...f.manifest,releaseId:old.plan.releaseId,setupSha256:old.setupSha256,migration:old.plan.migration};
  const principal={...f.principal,qualificationAdmission:{...f.principal.qualificationAdmission,setupSha256:old.setupSha256}};
  const scope={...f.scope,releaseId:manifest.releaseId,manifestHash:digest(manifest)};
  assert.equal((await store.request('register',{...scope,manifest},principal)).registered,true);assert.equal(await valid(f.recovery),true);
  await fails('select fcos_release_coordination.admit_qualification_schema_recovery($1)',[f.recovery],/ADMISSION_INVALID/);
 });
 await scenario('original unfinished journal remains blocked without a replacement bootstrap',async()=>{
  const f=await fixture({finishOriginal:false});await fails('select fcos_release_coordination.admit_qualification_schema_recovery($1)',[f.recovery],/ADMISSION_INVALID/);
 });
 await scenario('consumed uncertain operation stays readback-only after later containment drift',async()=>{
  const f=await fixture();await f.admit();await f.apply();await f.register();await f.contain(0);await f.contain(1);assert.equal((await f.begin()).disposition,'execute');
  await store.request('uncertain',{...f.intent,evidence:{outcome:'unknown'},evidenceHash:f.H},{...f.principal,legacyContainmentBoundary:f.boundary});
  await db.query('select fcos_release_coordination.revoke_legacy_release_containment($1,$2,$3)',[f.scope.releaseId,f.original.containmentProofs[0].importId,f.H]);
  assert.equal((await f.begin()).disposition,'readback');assert.equal((await store.request('begin',{...f.intent,phase:'qualification.stage',operationId:'forbidden-follow-on'},{...f.principal,legacyContainmentBoundary:f.boundary})).disposition,'busy');
 });
 await scenario('trusted native operator emits each exact request once and preserves lost-response uncertainty',async()=>{
  const f=await fixture();let setup=f.original.setup,sha=f.original.setupSha256,writes=0,lose=true,sqlCalls=0;
  const github={request:async r=>{if(r.method==='GET'){
   if(r.route==='/user')return{id:265701760,login:'hocheunglai-oss'};if(r.route==='/repos/hocheunglai-oss/fcos')return{id:1278654816,full_name:'hocheunglai-oss/fcos'};
   if(r.route.includes('/branches/'))return{protected:true,commit:{sha:f.original.bootstrapSha}};
   if(r.route.includes('/actions/runs/'))return{id:39653018028,status:'completed',conclusion:'failure',run_attempt:1,head_sha:f.original.bootstrapSha,head_branch:f.original.ref.slice(11)};
   if(r.route.endsWith('FCOS_HOSTED_QUALIFICATION_ADMITTED'))return{name:'FCOS_HOSTED_QUALIFICATION_ADMITTED',value:'true'};
   return r.route.endsWith('_SHA256')?{name:'FCOS_ADMITTED_RELEASE_SETUP_SHA256',value:sha}:{name:'FCOS_ADMITTED_RELEASE_SETUP',value:canonical(setup)};
  }writes++;if(r.body.name==='FCOS_ADMITTED_RELEASE_SETUP'){setup=JSON.parse(r.body.value);if(lose){lose=false;throw Error('synthetic lost response');}}if(r.body.name==='FCOS_ADMITTED_RELEASE_SETUP_SHA256')sha=r.body.value;return{status:204};}};
  const nativeQuery=async(q,p)=>{sqlCalls++;const s=`native_${++serial}`;await db.query(`savepoint ${s}`);try{const r=await db.query(q,p);await db.query(`release savepoint ${s}`);return r;}catch(e){await db.query(`rollback to savepoint ${s}`);await db.query(`release savepoint ${s}`);throw e;}};
  const operator=createQualificationSchemaRecoveryOperator({proof:f.recovery,originalProof:f.original,admin:{projectRef:'pjforfvchygdyqfcgpmw',query:nativeQuery},github,
   verifyConfiguration:async()=>schemaConfigurationFixture(f.recovery),verifyOwnerReadback:async x=>({kind:'fcos_qualification_schema_recovery_owner_readback_admitted_v1',accepted:true,...x,admissionReceiptSha256:f.H})});
  const review={rootReviewSha256:digest(f.recovery.rootReview)};await operator.admit();await assert.rejects(operator.execute('replace_setup',review),/SCHEMA_RECOVERY_RESPONSE_UNKNOWN/);
  const stoppedCalls=sqlCalls;await assert.rejects(operator.execute('replace_setup',review),/OWNER_READBACK_REQUIRED/);assert.equal(writes,1);
  await assert.rejects(operator.execute('replace_setup_sha',review),/OWNER_READBACK_REQUIRED/);assert.equal(writes,1);assert.equal(sqlCalls,stoppedCalls);
  await operator.readback('replace_setup',f.evidence('replace_setup',{basis:'owner_readback'}));await operator.execute('replace_setup_sha',review);await operator.execute('dispatch_qualification',review);await operator.finish();assert.equal(writes,3);
 });
});
