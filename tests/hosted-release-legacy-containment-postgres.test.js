import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { createCoordinatorHandler,createSqlStore } from '../supabase/functions/release-coordinator/index.ts';
import {createLegacyContainmentValidator} from '../supabase/functions/release-coordinator/legacy-containment.mjs';
import { digest, createMetadataAdmission, createNotificationChallenge, createNotificationDeliveryProof } from '../supabase/functions/release-coordinator/core.mjs';

const oldName='20261016190509_release_coordination.sql',maintenanceName='20261018112914_auth_maintenance_coordination.sql';
const migrationName='20261019171349_legacy_release_effect_containment.sql';
const load=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const oldSql=await load(oldName),maintenanceSql=await load(maintenanceName),sql=await load(migrationName);
const hash=s=>createHash('sha256').update(s).digest('hex');
const H='a'.repeat(64),S='b'.repeat(40),SETUP='c'.repeat(64),REPO='hocheunglai-oss/fcos';
const OWNER='01a0f08b-7fcb-7870-9edc-343e16052b62',OLD='01a0b0e2-b1af-7bf0-963d-3138c42648e3';
const owner={kind:'release',id:OWNER};
const effects=[
 {importId:'exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29',kind:'legacy_preview_env_row',effectSha256:hash('synthetic preview effect')},
 {importId:'production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0',kind:'production_resume_environment_policy',effectSha256:hash('synthetic environment policy effect')}
];
const policy={schemaVersion:1,policy:'legacy_control_plane_effects_v1',selection:'detached_node24_before_candidate_v1',effects};
const gh={kind:'github',runId:'101',runAttempt:'1',repositoryId:'77',ref:'refs/heads/main',sha:S,workflowSha:S,
 workflowRef:`${REPO}/.github/workflows/hosted-release.yml@refs/heads/main`,jobWorkflowRef:`${REPO}/.github/workflows/hosted-release-controller.yml@${S}`,jobWorkflowSha:S,
 actor:'hocheunglai-oss',actorId:'9',environment:null};
const unknowns=effects.map((e,i)=>({operationId:e.importId,evidenceHash:hash(`synthetic original intent ${i}`),ownerThreadId:OWNER,ownerReadbackHash:hash(`synthetic original unknown readback ${i}`)}));
const signatures=[
 'dispatch_without_auth_maintenance(text,jsonb,jsonb)','activate(bigint,jsonb)','install_epoch(bigint,jsonb)','dispatch(text,jsonb,jsonb)'
].map(n=>`fcos_release_coordination.${n}`);

// Native PostgreSQL is mandatory for this security gate. Every value is synthetic,
// and the server is a task-owned Unix-socket instance with no TCP listener.
test('native PostgreSQL release-only containment keeps original unknowns, ACLs, global lock and financial/maintenance fences',async t=>{
 const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();
 const dir=await mkdtemp(path.join(process.platform==='darwin'?'/private/tmp':tmpdir(),'fcos-legacy-containment-pg-')),data=path.join(dir,'data'),port=54618;
 let started=false,admin,db;
 t.after(async()=>{await db?.end();await admin?.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(dir,{recursive:true,force:true});});
 execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fcos_test_bootstrap','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -p ${port}`,'-w','start'],{stdio:'pipe'});started=true;
 admin=new pg.Client({host:dir,port,user:'fcos_test_bootstrap',database:'postgres'});await admin.connect();
 await admin.query('create role postgres login nosuperuser nocreatedb createrole inherit nobypassrls; alter database postgres owner to postgres; create role anon; create role authenticated; create role service_role');
 db=new pg.Client({host:dir,port,user:'postgres',database:'postgres'});await db.connect();
 assert.deepEqual((await db.query('select rolsuper,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user')).rows[0],{rolsuper:false,rolcreaterole:true,rolbypassrls:false});
 await db.query(oldSql);await db.query(maintenanceSql);
 const metadata=async()=> (await db.query("select oid::int,proname,prosrc,prosecdef,proconfig,proowner::regrole::text owner,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by proname",[signatures])).rows;
 const before=await metadata();
 for(const signature of signatures) await t.test(`migration rejects drift in ${signature}`,async()=>{
  await db.query('begin');
  const def=(await db.query('select pg_get_functiondef($1::regprocedure) as v',[signature])).rows[0].v;
  // Modify body bytes only; preserve the actual signature, owner and grants.
  await db.query(def.replace('AS $function$','AS $function$\n-- synthetic drift'));
  await assert.rejects(db.query(sql),/COORDINATION_LEGACY_CONTAINMENT_SOURCE_DRIFT/);
  await db.query('rollback');
  assert.equal((await db.query("select to_regclass('fcos_release_coordination.legacy_release_containments') as v")).rows[0].v,null);
  assert.deepEqual(await metadata(),before);
 });
 await db.query(sql);
 // Fixture-only SET ROLE capability for this non-superuser migration session.
 // Runtime itself receives no membership, table grant, or administration right.
 await admin.query('grant fcos_coordinator_runtime to postgres with inherit false, set true');
 const after=await metadata();
 for(const prior of before){const current=after.find(r=>r.oid===prior.oid);assert.ok(current);
  for(const field of ['oid','prosecdef','proconfig','owner','acl'])assert.deepEqual(current[field],prior[field],`${prior.proname} ${field}`);
  if(['dispatch','install_epoch'].includes(prior.proname))assert.equal(current.prosrc,prior.prosrc,`${prior.proname} unchanged`);
 }
 assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.legacy_release_containments')).rows[0].n,0);
 let savepoint=0;
 async function fails(query,values,pattern){const s=`expected_${++savepoint}`;await db.query(`savepoint ${s}`);
  try{await assert.rejects(db.query(query,values),pattern);}finally{await db.query(`rollback to savepoint ${s}`);await db.query(`release savepoint ${s}`);}}
 async function runtime(query,values=[]){const s=`runtime_${++savepoint}`;await db.query(`savepoint ${s}`);await db.query('set local role fcos_coordinator_runtime');
  try{const result=await db.query(query,values);await db.query('reset role');await db.query(`release savepoint ${s}`);return result;}
  catch(e){await db.query(`rollback to savepoint ${s}`);await db.query('reset role');await db.query(`release savepoint ${s}`);throw e;}}
 const dispatch=async(action,p,principal)=> (await runtime('select fcos_release_coordination.dispatch($1,$2,$3) as v',[action,p,principal])).rows[0].v;
 async function fixture({imports=unknowns,manifestPatch={},actorPatch={}}={}){
  const activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'original',disabled:true,proofHash:H}],uncertainties:imports};
  await db.query('select fcos_release_coordination.install_epoch(1,$1)',[activation]);
  const manifest={schemaVersion:2,releaseId:'qualification',epoch:1,executionMode:'qualification',stage:'qualification',setupSha256:SETUP,
   controller:{sha:S,workflow:'.github/workflows/hosted-release-controller.yml'},legacyReleaseContainment:structuredClone(policy),...manifestPatch};
  const principal={...gh,...actorPatch},scope={epoch:1,owner,releaseId:'qualification',manifestHash:await digest(manifest)};
  await dispatch('register',{...scope,manifest},principal);
  const boundary={validatedBy:'trusted_coordinator',manifestHash:scope.manifestHash,controllerSha:manifest.controller.sha,setupSha256:manifest.setupSha256,policySha256:await digest(manifest.legacyReleaseContainment)};
  const authenticated={...principal,legacyContainmentBoundary:boundary};
  const proof=async(i,patch={})=>({schemaVersion:1,...effects[i],importedEvidenceSha256:await digest(imports[i]),originalIntentSha256:hash(`synthetic separately reviewed original intent ${i}`),
   originalSourceSha256:H,confinementEvidenceSha256:H,controllerPolicySha256:boundary.policySha256,rootReviewSha256:hash('synthetic root review'),independentReviewSha256:hash('synthetic independent review'),
   originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false,...patch});
  const admit=async(i,patch={})=>(await db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2) as v',[scope.releaseId,await proof(i,patch)])).rows[0].v;
  const intent=(phase='preview.create')=>({...scope,phase,operationId:`operation-${phase}`,requestHash:H});
  const begin=(principal=authenticated,phase='preview.create')=>dispatch('begin',intent(phase),principal);
  const complete=(phase='preview.create',result={id:'dpl_synthetic'})=>dispatch('complete',{...intent(phase),evidence:{outcome:'applied',result},evidenceHash:H},authenticated);
  return {activation,manifest,scope,principal,authenticated,boundary,proof,admit,intent,begin,complete};
 }
 async function scenario(name,body){await t.test(name,async()=>{await db.query('begin');try{await body();}finally{await db.query('rollback');}});}
 await scenario('migration grants no exception; both exact privileged admissions AND trusted fresh server boundary are mandatory',async()=>{
  const f=await fixture();assert.equal((await f.begin()).disposition,'busy');await f.admit(0);assert.equal((await f.begin()).disposition,'busy');
  const accepted=await f.admit(1);assert.equal(accepted.originalOutcome,'unknown');assert.equal(accepted.replayAllowed,false);assert.equal(accepted.financialAuthorityGranted,false);
  assert.equal((await f.begin(f.principal)).disposition,'busy');
  for(const patch of [{validatedBy:'caller'},{manifestHash:H},{controllerSha:'c'.repeat(40)},{setupSha256:H},{policySha256:H},{unreviewed:true}])
   assert.equal((await f.begin({...f.authenticated,legacyContainmentBoundary:{...f.boundary,...patch}})).disposition,'busy');
  for(const patch of [{kind:'financial'},{jobWorkflowSha:'c'.repeat(40)},{jobWorkflowRef:'foreign'},{repositoryId:'78'},{actorId:'10'},{actor:'other'}]){
   if(patch.kind)continue;assert.equal((await f.begin({...f.authenticated,...patch})).disposition,'busy');}
  assert.equal((await f.begin()).disposition,'execute');
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.imported_uncertainty')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.import_resolutions')).rows[0].n,0);
 });
 await scenario('exact proof shape/full imported JSON/original intent/policy/kind/hash binding refuse malformed or altered admissions',async()=>{
  const f=await fixture();
  const cases=[{schemaVersion:'1'},{kind:effects[1].kind},{importId:'third-unknown'},{effectSha256:H},{importedEvidenceSha256:H},{originalIntentSha256:'not-a-hash'},
   {originalSourceSha256:null},{confinementEvidenceSha256:'not-a-hash'},{controllerPolicySha256:H},{rootReviewSha256:null},{independentReviewSha256:null},
   {originalOutcome:'not_applied'},{replayAllowed:true},{financialAuthorityGranted:true},{extra:true}];
  for(const patch of cases)await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,await f.proof(0,patch)],/COORDINATION_LEGACY_CONTAINMENT_(INVALID|BINDING_CHANGED)/);
  const omitted=await f.proof(0);delete omitted.originalSourceSha256;
  await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,omitted],/CONTAINMENT_INVALID/);
  await f.admit(0);await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,await f.proof(0)],/duplicate key/);
  assert.equal((await f.begin()).disposition,'busy');
 });
 await scenario('unlisted third unknown and foreign-epoch imports remain global stops; install_epoch is unchanged',async()=>{
  const third={operationId:'third-unknown',evidenceHash:H,ownerThreadId:OLD,ownerReadbackHash:H};
  const f=await fixture({imports:[...unknowns,third]});await f.admit(0);await f.admit(1);assert.equal((await f.begin()).disposition,'busy');
  await fails('select fcos_release_coordination.install_epoch(2,$1)',[{...f.activation,uncertainties:[],notificationChallenge:createNotificationChallenge()}],/IMPORTED_UNCERTAINTY_UNRESOLVED/);
 });
 await scenario('known allowed import from a foreign epoch cannot be admitted or contained',async()=>{
  const f=await fixture({imports:[unknowns[0]]});
  await db.query('insert into fcos_release_coordination.epochs(epoch,activation_evidence) values(2,$1)',[{...f.activation,notificationChallenge:createNotificationChallenge()}]);
  await db.query('insert into fcos_release_coordination.imported_uncertainty values($1,2,$2)',[effects[1].importId,unknowns[1]]);
  await f.admit(0);
  await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,{...await f.proof(0),...effects[1],importedEvidenceSha256:await digest(unknowns[1])}],/BINDING_CHANGED/);
  assert.equal((await f.begin()).disposition,'busy');
 });
 await scenario('revocation never resolves or reopens old intent; exact consumed readback/complete remain accessible',async()=>{
  const f=await fixture();await f.admit(0);await f.admit(1);assert.equal((await f.begin()).disposition,'execute');
  await dispatch('uncertain',{...f.intent(),evidence:{outcome:'unknown'},evidenceHash:H},f.authenticated);
  await db.query('select fcos_release_coordination.revoke_legacy_release_containment($1,$2,$3)',[f.scope.releaseId,effects[0].importId,H]);
  assert.equal((await f.begin(f.principal)).disposition,'readback');
  assert.equal((await f.complete()).disposition,'complete');assert.equal((await f.begin(f.principal)).disposition,'complete');
  assert.equal((await f.begin(f.authenticated,'qualification.stage')).disposition,'busy');
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.import_resolutions')).rows[0].n,0);
  await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,await f.proof(0)],/duplicate key/);
 });
 await scenario('private owner tables are append-only and runtime/anon/authenticated/service roles cannot admit/revoke/read/write or invoke helpers',async()=>{
  const f=await fixture();await f.admit(0);await f.admit(1);
  for(const table of ['legacy_release_containments','legacy_release_containment_revocations']){
   const row=(await db.query('select relrowsecurity,relowner::regrole::text owner from pg_class where oid=$1::regclass',[`fcos_release_coordination.${table}`])).rows[0];
   assert.deepEqual(row,{relrowsecurity:true,owner:'fcos_coordinator_owner'});
   for(const statement of [`update fcos_release_coordination.${table} set epoch=epoch`,`delete from fcos_release_coordination.${table}`,`truncate fcos_release_coordination.${table} cascade`])await fails(statement,[],/APPEND_ONLY/);
   await assert.rejects(runtime(`select * from fcos_release_coordination.${table}`),/permission denied/);
   await assert.rejects(runtime(`insert into fcos_release_coordination.${table} default values`),/permission denied/);
  }
  for(const statement of [
   ['select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,await f.proof(0)]],
   ['select fcos_release_coordination.revoke_legacy_release_containment($1,$2,$3)',[f.scope.releaseId,effects[0].importId,H]],
   ['select fcos_release_coordination.legacy_release_unknowns_contained(r,$1,true) from fcos_release_coordination.registrations r',[f.principal]],
   ['select fcos_release_coordination.legacy_release_registration_valid(null)',[]]
  ])await assert.rejects(runtime(...statement),/permission denied/);
  const acl=(await db.query("select r.rolname,p.proname,has_function_privilege(r.oid,p.oid,'EXECUTE') ok from pg_roles r cross join pg_proc p join pg_namespace n on p.pronamespace=n.oid where r.rolname in ('anon','authenticated','service_role','fcos_coordinator_runtime') and n.nspname='fcos_release_coordination' and p.proname in ('admit_legacy_release_containment','revoke_legacy_release_containment','legacy_release_unknowns_contained','legacy_release_registration_valid')")).rows;
  assert.equal(acl.length,16);assert.ok(acl.every(v=>v.ok===false));
 });
 for(const [name,manifestPatch,actorPatch] of [
  ['wrong registered release ID',{releaseId:'foreign-release'},{}],
  ['missing policy',{legacyReleaseContainment:null},{}],['wrong policy',{legacyReleaseContainment:{...policy,policy:'generic_unknowns'}},{}],
  ['unknown effect',{legacyReleaseContainment:{...policy,effects:[effects[0],{...effects[1],importId:'third'}]}},{}],
  ['duplicate effect',{legacyReleaseContainment:{...policy,effects:[effects[0],effects[0]]}},{}],
  ['nullable effect kind',{legacyReleaseContainment:{...policy,effects:[effects[0],{...effects[1],kind:null}]}},{}],
  ['missing setup',{setupSha256:null},{}],['missing controller',{controller:{}},{}],['non GitHub actor',{}, {kind:'github',actorId:null}]
 ])await scenario(`registration cannot admit ${name}`,async()=>{
  const f=await fixture({manifestPatch,actorPatch});await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,await f.proof(0)],/CONTAINMENT_INVALID/);
 });
 await scenario('different registered manifest/controller/setup/epoch cannot reuse a prior admission',async()=>{
  const f=await fixture();await f.admit(0);await f.admit(1);
  for(const patch of [{setupSha256:H},{controller:{sha:'d'.repeat(40),workflow:'.github/workflows/hosted-release-controller.yml'}},{legacyReleaseContainment:{...policy,effects:[{...effects[0],effectSha256:H},effects[1]]}}]){
   const manifest={...f.manifest,...patch},scope={...f.scope,releaseId:crypto.randomUUID(),manifestHash:await digest(manifest)};
   const principal={...gh,jobWorkflowSha:manifest.controller.sha,jobWorkflowRef:`${REPO}/.github/workflows/hosted-release-controller.yml@${manifest.controller.sha}`};
   await dispatch('register',{...scope,manifest},principal);
   const p={...principal,legacyContainmentBoundary:{...f.boundary,manifestHash:scope.manifestHash,controllerSha:manifest.controller.sha,setupSha256:manifest.setupSha256,policySha256:await digest(manifest.legacyReleaseContainment)}};
   assert.equal((await dispatch('begin',{...scope,phase:'preview.create',operationId:crypto.randomUUID(),requestHash:H},p)).disposition,'busy');
  }
  await assert.rejects(dispatch('begin',{...f.intent(),epoch:2},f.authenticated),/STALE_EPOCH/);
 });
 await scenario('same global lock, durable hosted qualification and real notification delivery remain mandatory; finance/maintenance stay blocked after activation',async()=>{
  const f=await fixture();await f.admit(0);await f.admit(1);
  const qEvidence={key:'hosted.qualification',status:'passed',actualGithubArtifactValidated:true,artifactSha256:H},qHash=await digest(qEvidence);
  const activationProof={manifestHash:f.scope.manifestHash,evidenceHash:qHash,oldWriterFenceHash:H,allWritersAdmitted:true,writerAdmissions:[{id:'original',admitted:true,proofHash:H}]};
  await fails('select fcos_release_coordination.activate(1,$1)',[activationProof],/HOSTED_QUALIFICATION_REQUIRED/);
  const fm={epoch:1,executionMode:'financial'},fs={...f.scope,owner:{kind:'financial',id:OWNER},releaseId:'ordinary-finance',manifestHash:await digest(fm)},fp={kind:'financial',ownerId:OWNER};
  await dispatch('register',{...fs,manifest:fm},fp);await assert.rejects(dispatch('begin',{...fs,phase:'financial.link',operationId:'finance',requestHash:H},fp),/QUALIFICATION_ONLY/);
  assert.equal((await f.begin()).disposition,'execute');
  const other={...f.manifest,releaseId:'second'},os={...f.scope,releaseId:'second',manifestHash:await digest(other)};
  await dispatch('register',{...os,manifest:other},f.principal);
  for(let i=0;i<2;i++)await db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[os.releaseId,await f.proof(i)]);
  assert.equal((await dispatch('begin',{...os,phase:'preview.create',operationId:'second-preview',requestHash:H},{...f.authenticated,legacyContainmentBoundary:{...f.boundary,manifestHash:os.manifestHash}})).disposition,'busy');
  await f.complete();
  for(const phase of ['qualification.stage','qualification.promote','qualification.rollback']){assert.equal((await f.begin(f.authenticated,phase)).disposition,'execute');await f.complete(phase,{simulated:true});}
  await dispatch('appendEvidence',{...f.scope,evidenceId:'hosted-proof',evidence:qEvidence,evidenceHash:qHash},f.authenticated);
  await fails('select fcos_release_coordination.activate(1,$1)',[activationProof],/NOTIFICATION_DELIVERY_REQUIRED/);
  const challenge=f.activation.notificationChallenge,notificationDelivery=await createNotificationDeliveryProof({challenge,receiptJson:JSON.stringify({...challenge,device:'iphone',confirmedByHuman:true,receivedAt:new Date().toISOString()})});
  assert.equal((await db.query('select fcos_release_coordination.activate(1,$1) as v',[{...activationProof,notificationDelivery}])).rows[0].v.mode,'active');
  assert.equal((await dispatch('begin',{...fs,phase:'financial.link',operationId:'finance',requestHash:H},fp)).disposition,'busy');
  const release={...f.manifest,releaseId:'production-release',stage:'application',executionMode:'release',authorization:{actions:['production.stage']}},rs={...f.scope,releaseId:release.releaseId,manifestHash:await digest(release)};
  const rp={...gh,environment:'fcos-hosted-production-resume',legacyContainmentBoundary:{...f.boundary,manifestHash:rs.manifestHash}};
  await dispatch('register',{...rs,manifest:release},rp);
  for(let i=0;i<2;i++)await db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[rs.releaseId,await f.proof(i)]);
  await assert.rejects(dispatch('begin',{...rs,phase:'production.stage',operationId:'unapproved-production',requestHash:H},rp),/PRODUCTION_APPROVAL_REQUIRED/);
  await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[fs.releaseId,await f.proof(0)],/CONTAINMENT_INVALID/);
  const phases=['auth_maintenance.renew_existing_grant','auth_maintenance.read_connections','auth_maintenance.read_organisations','auth_maintenance.finish_saved_rotation'];
  const a={schemaVersion:1,authorityId:H,epoch:1,currentOwnerId:OWNER,historicalOwnerThreadId:OLD,humanTransferEvidenceSha256:H,humanAuthorityEvidenceSha256:H,
   actorId:'10000000-0000-4000-8000-000000000001',tenantId:'20000000-0000-4000-8000-000000000002',clientSha256:H,grantLineageSha256:H,sourceSha256:H,executorSha256:H,controllerSha256:H,destinationsSha256:H,
   legacyFenceProofSha256:H,fenceInventorySha256:await digest([]),phases,caps:Object.fromEntries(phases.map(p=>[p,1])),issuedAt:Date.now()-1000,notAfter:Date.now()+3600000,maximumOccurrenceWindowMs:900000,coordinationOnly:true,providerAuthorityGranted:false};
  await db.query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2)',[a,JSON.stringify([])]);
  const m={schemaVersion:1,epoch:1,executionMode:'auth_maintenance',authorityId:H,authoritySha256:await digest(a),...Object.fromEntries(['currentOwnerId','historicalOwnerThreadId','humanTransferEvidenceSha256','actorId','tenantId','clientSha256','grantLineageSha256','sourceSha256','executorSha256','controllerSha256','destinationsSha256'].map(k=>[k,a[k]])),
   phase:phases[1],operationId:'maintenance',occurrenceId:crypto.randomUUID(),requestFingerprint:H,expectedVersion:7,refreshLeaseId:crypto.randomUUID(),requestId:crypto.randomUUID(),issuedAt:Date.now()-1,notAfter:Date.now()+60000,recoveryOf:null,recoveryReadbackSha256:null,custodySha256:null,coordinationOnly:true,providerAuthorityGranted:false};
  const ms={epoch:1,owner:fs.owner,releaseId:'maintenance',manifestHash:await digest(m)},mp={...fp,coordinationOnly:true,providerAuthorityGranted:false};
  await dispatch('register',{...ms,manifest:m},mp);
  assert.equal((await dispatch('begin',{...ms,phase:m.phase,operationId:m.operationId,requestHash:H},mp)).disposition,'busy');
  await fails('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[ms.releaseId,await f.proof(0)],/CONTAINMENT_INVALID/);
  const state=(await db.query('select (select count(*) from fcos_release_coordination.imported_uncertainty)::int imports,(select count(*) from fcos_release_coordination.import_resolutions)::int resolutions')).rows[0];
  assert.deepEqual(state,{imports:2,resolutions:0});
 });
 await scenario('real HTTP handler and native SQL consume trusted metadata once; revocation/outage cannot strand the original readback',async()=>{
  const f=await fixture();await f.admit(0);await f.admit(1);let reads=0,unavailable=false;
  const resume={name:'fcos-hosted-production-resume',id:1,can_admins_bypass:false,deployment_branch_policy:{protected_branches:true,custom_branch_policies:false},protection_rules:[{type:'branch_policy'}]};
  const final={...resume,name:'fcos-production-release',id:2,protection_rules:[{type:'branch_policy'},{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:9,login:'hocheunglai-oss'}}]}]};
  const metadata=createMetadataAdmission();
  const validate=createLegacyContainmentValidator({policy:{repository:REPO},token:'INERT_METADATA',fetchImpl:async url=>{reads++;if(unavailable)throw Error('inert unavailable');return Response.json(url.endsWith('/user')?{id:9,login:'hocheunglai-oss'}:url.endsWith(resume.name)?resume:final);}});
  const handler=createCoordinatorHandler({store:createSqlStore(runtime),authenticateGithub:async()=>f.principal,admitMetadata:({weight})=>metadata.admit(weight),validateLegacyContainment:validate});
  const send=phase=>handler(new Request('http://localhost/coordinator',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer inert'},body:JSON.stringify({action:'begin',payload:f.intent(phase)})}));
  let response=await send('preview.create');assert.equal(response.status,200);assert.equal((await response.json()).disposition,'execute');assert.equal(reads,3);
  await db.query('select fcos_release_coordination.revoke_legacy_release_containment($1,$2,$3)',[f.scope.releaseId,effects[0].importId,H]);unavailable=true;
  response=await send('preview.create');assert.equal(response.status,200);assert.equal((await response.json()).disposition,'readback');assert.equal(reads,3);
  response=await send('qualification.stage');assert.equal(response.status,503);assert.match((await response.json()).error,/METADATA_UNAVAILABLE/);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.operations')).rows[0].n,1);
 });
 await scenario('without any imported unknown existing flat qualification behavior needs no containment policy or server boundary',async()=>{
  const f=await fixture({imports:[],manifestPatch:{legacyReleaseContainment:null}});assert.equal((await f.begin(f.principal)).disposition,'execute');
 });
 assert.equal(hash(await load(oldName)),hash(oldSql));assert.equal(hash(await load(maintenanceName)),hash(maintenanceSql));
});
