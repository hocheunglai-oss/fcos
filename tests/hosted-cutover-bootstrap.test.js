import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import {createCoordinatorHandler,createSqlStore} from '../supabase/functions/release-coordinator/index.ts';
import {createCoordinatorClient} from '../scripts/lib/hosted-release/coordinator-client.mjs';
import {createNotificationChallenge} from '../supabase/functions/release-coordinator/core.mjs';
import {canonical,digest} from '../scripts/lib/hosted-release/json-contract.mjs';
import {BOOTSTRAP_SOURCE,bootstrapActions,bootstrapSql,createCutoverBootstrapOperator} from '../scripts/lib/hosted-release/cutover-bootstrap.mjs';
const root=new URL('../',import.meta.url),load=n=>readFile(new URL(`supabase/migrations/${n}`,root),'utf8');
const names=['20261016190509_release_coordination.sql','20261018112914_auth_maintenance_coordination.sql','20261019171349_legacy_release_effect_containment.sql'];
const sql=await load('20261020080001_hosted_cutover_bootstrap.sql'),H='a'.repeat(64),J='b'.repeat(64),OWNER='01a0f08b-7fcb-7870-9edc-343e16052b62';
const effects=[{importId:'exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29',kind:'legacy_preview_env_row',effectSha256:digest('synthetic preview')},
 {importId:'production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0',kind:'production_resume_environment_policy',effectSha256:digest('synthetic policy')}];
const unknowns=effects.map(e=>({operationId:e.importId,evidenceHash:H,ownerThreadId:OWNER,ownerReadbackHash:J}));
const policy={schemaVersion:1,policy:'legacy_control_plane_effects_v1',selection:'detached_node24_before_candidate_v1',effects};
function inputs(){
 const source={ref:BOOTSTRAP_SOURCE.ref,bootstrapSha:BOOTSTRAP_SOURCE.bootstrapSha,callerWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@${BOOTSTRAP_SOURCE.ref}`,controllerSha:BOOTSTRAP_SOURCE.controllerSha,candidateSha:BOOTSTRAP_SOURCE.candidateSha};
 const setup={epoch:1,qualificationSource:source,legacyReleaseContainment:policy};
 const plan={releaseId:'synthetic-qualification',stage:'qualification',executionMode:'qualification',scope:{compatibilityOnly:true}};
 const proof={schemaVersion:1,bootstrapId:'synthetic-bootstrap',epoch:1,ownerThreadId:OWNER,repository:'hocheunglai-oss/fcos',repositoryId:'1278654816',operatorId:'265701760',operatorLogin:'hocheunglai-oss',...BOOTSTRAP_SOURCE,
  setup,setupSha256:digest(setup),plan,planSha256:digest(plan),sentinelSha256:H,inventorySha256:H,rootReviewSha256:H,independentReviewSha256:J,
  containmentProofs:effects.map((e,i)=>({schemaVersion:1,...e,importedEvidenceSha256:digest(unknowns[i]),originalIntentSha256:H,originalSourceSha256:H,confinementEvidenceSha256:H,controllerPolicySha256:digest(policy),rootReviewSha256:H,independentReviewSha256:J,originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false}))};
 proof.actions=bootstrapActions(proof);
 const manifest={schemaVersion:2,releaseId:plan.releaseId,epoch:1,stage:'qualification',executionMode:'qualification',scope:plan.scope,controller:{sha:source.controllerSha,workflow:'.github/workflows/hosted-release-controller.yml'},candidate:{sha:source.candidateSha},setupSha256:proof.setupSha256,qualificationSource:source,legacyReleaseContainment:policy};
 const principal={kind:'github',qualificationOnly:true,repositoryId:proof.repositoryId,actorId:proof.operatorId,actor:proof.operatorLogin,ref:source.ref,sha:source.bootstrapSha,workflowSha:source.bootstrapSha,workflowRef:source.callerWorkflowRef,
  jobWorkflowSha:source.controllerSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,runId:'101',runAttempt:'1',
  qualificationAdmission:{repository:proof.repository,repositoryId:proof.repositoryId,ref:source.ref,bootstrapSha:source.bootstrapSha,callerWorkflowRef:source.callerWorkflowRef,callerWorkflowSha:source.bootstrapSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,jobWorkflowSha:source.controllerSha,candidateSha:source.candidateSha,setupSha256:proof.setupSha256}};
 return {proof,manifest,principal,scope:{epoch:1,owner:{kind:'release',id:'features'},releaseId:manifest.releaseId,manifestHash:digest(manifest)}};
}

test('native PostgreSQL admin handoff uses the existing singleton and keeps authority/unknown history private',async t=>{
 const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim(),dir=await mkdtemp(path.join(tmpdir(),'fcos-cutover-bootstrap-pg-')),data=path.join(dir,'data'),port=54629;
 let started=false,db,admin;
 t.after(async()=>{await db?.end();await admin?.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(dir,{recursive:true,force:true});});
 execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fcos_test_bootstrap','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -p ${port}`,'-w','start'],{stdio:'pipe'});started=true;
 admin=new pg.Client({host:dir,port,user:'fcos_test_bootstrap',database:'postgres'});await admin.connect();
 await admin.query('create role postgres login nosuperuser createrole inherit nobypassrls;alter database postgres owner to postgres;create role anon;create role authenticated;create role service_role');
 db=new pg.Client({host:dir,port,user:'postgres',database:'postgres'});await db.connect();for(const n of names)await db.query(await load(n));
 const signatures=['dispatch(text,jsonb,jsonb)','dispatch_without_auth_maintenance(text,jsonb,jsonb)','activate(bigint,jsonb)','install_epoch(bigint,jsonb)'].map(n=>`fcos_release_coordination.${n}`);
 const metadata=async()=> (await db.query('select oid::int,prosrc,prosecdef,proconfig,proowner::regrole::text owner,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
 const before=await metadata();
 for(const signature of signatures)await t.test(`source drift in ${signature} rejects the entire migration`,async()=>{
  await db.query('begin');const def=(await db.query('select pg_get_functiondef($1::regprocedure) as v',[signature])).rows[0].v;
  await db.query(def.replace('AS $function$','AS $function$\n-- synthetic drift'));
  await assert.rejects(db.query(sql),/BOOTSTRAP_SOURCE_DRIFT/);await db.query('rollback');assert.deepEqual(await metadata(),before);
  assert.equal((await db.query("select to_regclass('fcos_release_coordination.cutover_bootstraps') as v")).rows[0].v,null);
 });
 await db.query(sql);await admin.query('grant fcos_coordinator_runtime to postgres with inherit false,set true');
 for(const prior of before){const current=(await metadata()).find(r=>r.oid===prior.oid);for(const k of ['oid','prosecdef','proconfig','owner','acl'])assert.deepEqual(current[k],prior[k]);}
 let savepoint=0;
 async function runtime(query,values=[]){const s=`runtime_${++savepoint}`;await db.query(`savepoint ${s}`);await db.query('set local role fcos_coordinator_runtime');try{const r=await db.query(query,values);await db.query('reset role');await db.query(`release savepoint ${s}`);return r;}catch(e){await db.query(`rollback to savepoint ${s}`);await db.query('reset role');await db.query(`release savepoint ${s}`);throw e;}}
 const store=createSqlStore(runtime,{bootstrapAdmission:true});
 async function fails(query,values,pattern){const s=`expected_${++savepoint}`;await db.query(`savepoint ${s}`);try{await assert.rejects(db.query(query,values),pattern);}finally{await db.query(`rollback to savepoint ${s}`);await db.query(`release savepoint ${s}`);}}
 async function fixture(){const f=inputs(),activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'original',disabled:true,proofHash:H}],uncertainties:unknowns};
  await db.query('select fcos_release_coordination.install_epoch(1,$1)',[activation]);
  const q=async(command,extra)=>{const p=bootstrapSql(command,f.proof,extra);return (await db.query(p.query,p.parameters)).rows[0].result;};
  const evidence=(actionId,patch={})=>({basis:'native_ack',outcome:'applied',requestSha256:digest(f.proof.actions.find(a=>a.id===actionId).request),providerEvidenceSha256:H,rootReviewSha256:H,...patch});
  return {...f,q,evidence,activation,admit:()=>q('admit'),intent:actionId=>q('intent',{actionId}),record:(actionId,patch)=>q('record',{actionId,evidence:evidence(actionId,patch)}),finish:()=>q('finish')};}
 async function scenario(name,fn){await t.test(name,async()=>{await db.query('begin');try{await fn();}finally{await db.query('rollback');}});}
 await scenario('exact action sequence is consumed once; no release registration or grant is invented',async()=>{
  const f=await fixture();assert.equal((await f.admit()).disposition,'admitted');assert.equal((await f.admit()).disposition,'readback');
  assert.equal((await f.intent('enable_qualification')).disposition,'execute');assert.equal((await f.intent('enable_qualification')).disposition,'readback');
  await fails('select fcos_release_coordination.cutover_bootstrap_intent($1,$2,$3)',[f.proof.bootstrapId,'dispatch_qualification',digest(f.proof)],/PRIOR_ACTION_UNRESOLVED/);
  await f.record('enable_qualification');await f.intent('dispatch_qualification');await f.record('dispatch_qualification');await f.finish();
  assert.equal((await f.intent('dispatch_qualification')).disposition,'readback');assert.equal((await f.finish()).disposition,'complete');
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.registrations')).rows[0].n,0);
  assert.deepEqual((await db.query('select operation_id,bootstrap_id,mode from fcos_release_coordination.control')).rows[0],{operation_id:null,bootstrap_id:null,mode:'qualification'});
  for(const table of ['import_resolutions','auth_maintenance_authorities','authorizations','activations'])assert.equal((await db.query(`select count(*)::int n from fcos_release_coordination.${table}`)).rows[0].n,0);
 });
 await scenario('crash/unknown retains the lock, blocks follow-on, and requires exact original owner readback',async()=>{
  const f=await fixture();await f.admit();await f.intent('enable_qualification');await f.record('enable_qualification',{outcome:'unknown'});
  await fails('select fcos_release_coordination.finish_cutover_bootstrap($1,$2)',[f.proof.bootstrapId,digest(f.proof)],/PRIOR_ACTION_UNRESOLVED/);
  await fails('select fcos_release_coordination.record_cutover_bootstrap($1,$2,$3,$4)',[f.proof.bootstrapId,'enable_qualification',digest(f.proof),f.evidence('enable_qualification')],/READBACK_REQUIRED/);
  await fails('select fcos_release_coordination.record_cutover_bootstrap($1,$2,$3,$4)',[f.proof.bootstrapId,'enable_qualification',J,f.evidence('enable_qualification',{basis:'owner_readback'})],/EVIDENCE_INVALID/);
  await f.record('enable_qualification',{basis:'owner_readback'});assert.equal((await f.intent('dispatch_qualification')).disposition,'execute');
  await fails('select fcos_release_coordination.install_epoch(2,$1)',[{...f.activation,notificationChallenge:createNotificationChallenge()}],/BOOTSTRAP_BUSY/);
  await fails('select fcos_release_coordination.activate(1,$1)',[{}],/BOOTSTRAP_BUSY/);
  for(const principal of [{...f.principal},{kind:'financial',ownerId:OWNER}])await assert.rejects(store.request('claim',{...f.scope,phase:'financial.probe',operationId:'wrong',requestHash:H},principal),/BOOTSTRAP_BUSY/);
 });
 await scenario('wrong owner/epoch/target/source/sentinel/proof or third unknown cannot obtain bootstrap authority',async()=>{
  const f=await fixture();for(const patch of [{ownerThreadId:'other'},{epoch:2},{repository:'other/repo'},{controllerSha:'c'.repeat(40)},{candidateSha:'c'.repeat(40)},{ref:'refs/heads/main'},{sentinelSha256:J},{setupSha256:J},{extra:true},
   {actions:[{id:'arbitrary',request:{method:'DELETE',route:'/repos/hocheunglai-oss/fcos',body:{}}}]}])await fails('select fcos_release_coordination.admit_cutover_bootstrap($1)',[{...f.proof,...patch}],/ADMISSION_INVALID/);
  await db.query('insert into fcos_release_coordination.imported_uncertainty values($1,1,$2)',['third',{operationId:'third',evidenceHash:H}]);
  await fails('select fcos_release_coordination.admit_cutover_bootstrap($1)',[f.proof],/ADMISSION_INVALID/);
 });
 await scenario('runtime cannot administer/read journal tables; append-only histories cannot be rewritten',async()=>{
  const f=await fixture();await f.admit();
  for(const q of ['select * from fcos_release_coordination.cutover_bootstraps',"select fcos_release_coordination.admit_cutover_bootstrap('{}')",`select fcos_release_coordination.cutover_bootstrap_snapshot('${f.proof.bootstrapId}','${digest(f.proof)}')`])await assert.rejects(runtime(q),/permission denied/);
  for(const table of ['cutover_bootstraps','cutover_bootstrap_actions','cutover_bootstrap_events','cutover_bootstrap_finishes'])await fails(`truncate fcos_release_coordination.${table} cascade`,[],/APPEND_ONLY/);
 });
 await scenario('real unchanged client waits for fast dispatch handoff and exact pending containment admissions, without extra metadata reads',async()=>{
  const f=await fixture();let metadata=0,providerWrites=0,firstPending,releaseWait;
  const first=new Promise(r=>{firstPending=r;}),gate=new Promise(r=>{releaseWait=r;});
  const boundary={validatedBy:'trusted_coordinator',manifestHash:f.scope.manifestHash,controllerSha:f.proof.controllerSha,setupSha256:f.proof.setupSha256,policySha256:digest(policy)};
  const handler=createCoordinatorHandler({store,authenticateGithub:async()=>f.principal,validateQualification:async()=>{metadata++;},validateLegacyContainment:async()=>{metadata++;return boundary;}});
  const send=(action,payload)=>handler(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic'},body:JSON.stringify({action,payload})}));
  let registered;
  const client=createCoordinatorClient({url:'http://localhost',epoch:1,owner:f.scope.owner,tokenProvider:async()=>'synthetic',wait:()=>gate,
   fetch:async(url,init)=>{const response=await handler(new Request(url,init));if(response.status===429)firstPending();return response;}});
  const github={request:async request=>{
   if(request.method==='GET'){if(request.route==='/user')return{id:265701760,login:'hocheunglai-oss'};if(request.route==='/repos/hocheunglai-oss/fcos')return{id:1278654816,full_name:'hocheunglai-oss/fcos'};
    if(request.route.includes('/branches/'))return{protected:true,commit:{sha:f.proof.bootstrapSha}};
    if(request.route.endsWith('FCOS_HOSTED_QUALIFICATION_ADMITTED'))return{name:'FCOS_HOSTED_QUALIFICATION_ADMITTED',value:providerWrites?'true':'false'};
    return request.route.endsWith('_SHA256')?{name:'FCOS_ADMITTED_RELEASE_SETUP_SHA256',value:f.proof.setupSha256}:{name:'FCOS_ADMITTED_RELEASE_SETUP',value:canonical(f.proof.setup)};}
   providerWrites++;if(request.method==='POST'){registered=client.register({...f.scope,manifest:f.manifest});await first;assert.equal(metadata,0);}return{status:204};}};
  const operator=createCutoverBootstrapOperator({proof:f.proof,admin:{projectRef:'pjforfvchygdyqfcgpmw',query:(q,p)=>db.query(q,p)},github});
  await operator.admit();await operator.execute('enable_qualification',{rootReviewSha256:H});await operator.execute('dispatch_qualification',{rootReviewSha256:H});
  await operator.finish();releaseWait();assert.equal((await registered).registered,true);assert.equal(providerWrites,2);assert.equal(metadata,1);
  assert.equal((await operator.execute('dispatch_qualification',{rootReviewSha256:H})).disposition,'readback');assert.equal(providerWrites,2);
  const intent={...f.scope,phase:'preview.create',operationId:'real-synthetic-preview',requestHash:H};
  assert.equal((await send('begin',intent)).status,429);assert.equal(metadata,1);
  await db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,f.proof.containmentProofs[0]]);
  assert.equal((await send('begin',intent)).status,429);assert.equal(metadata,1);
  await db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,f.proof.containmentProofs[1]]);
  assert.equal((await (await send('begin',intent)).json()).disposition,'execute');assert.equal(metadata,3);
  await store.request('uncertain',{...intent,evidence:{outcome:'unknown'},evidenceHash:H},{...f.principal,legacyContainmentBoundary:boundary});
  await db.query('select fcos_release_coordination.revoke_legacy_release_containment($1,$2,$3)',[f.scope.releaseId,effects[0].importId,H]);
  assert.equal(await store.admissionPending('begin',{...intent,phase:'qualification.stage'},f.principal),false);
  assert.equal((await store.request('begin',{...intent,phase:'qualification.stage',operationId:'new-phase'},{...f.principal,legacyContainmentBoundary:boundary})).disposition,'busy');
  assert.equal((await (await send('begin',intent)).json()).disposition,'readback');assert.equal(metadata,3);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.imported_uncertainty')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.import_resolutions')).rows[0].n,0);
 });
 await scenario('pending is not a blanket missing-admission or wrong-identity retry',async()=>{
  const f=await fixture();await f.admit();
  for(const patch of [{actorId:'1'},{jobWorkflowSha:'c'.repeat(40)},{sha:'c'.repeat(40)},{runAttempt:'2'},{kind:'financial'}])assert.equal(await store.admissionPending('register',{...f.scope,manifest:f.manifest},{...f.principal,...patch}),false);
  assert.equal(await store.admissionPending('register',{...f.scope,manifest:{...f.manifest,setupSha256:J}},f.principal),false);
 });
 await scenario('bootstrap winning after the precheck gives only the exact registration a bounded pending response',async()=>{
  const f=await fixture();let raced=false,checks=0;
  const racedStore={...store,admissionPending:async(...args)=>{checks++;const pending=await store.admissionPending(...args);if(!raced){raced=true;await f.admit();}return pending;}};
  const handler=createCoordinatorHandler({store:racedStore,authenticateGithub:async()=>f.principal,validateQualification:async()=>{}});
  const send=payload=>handler(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic'},body:JSON.stringify({action:'register',payload})}));
  const response=await send({...f.scope,manifest:f.manifest});assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:'COORDINATION_METADATA_PENDING'});assert.equal(checks,2);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.registrations')).rows[0].n,0);
  const foreign=await send({...f.scope,owner:{kind:'release',id:'foreign'},manifest:f.manifest});assert.equal(foreign.status,409);assert.deepEqual(await foreign.json(),{error:'COORDINATION_BOOTSTRAP_BUSY'});
 });
 await scenario('native lost response is never resubmitted and prior unknown prevents a follow-on write',async()=>{
  const f=await fixture();let writes=0,gets=0;
  const github={request:async request=>{
   if(request.method!=='GET'){writes++;throw Error('synthetic private raw provider detail');}gets++;
   if(request.route==='/user')return{id:265701760,login:'hocheunglai-oss'};
   if(request.route==='/repos/hocheunglai-oss/fcos')return{id:1278654816,full_name:'hocheunglai-oss/fcos'};
   if(request.route.includes('/branches/'))return{protected:true,commit:{sha:f.proof.bootstrapSha}};
   if(request.route.endsWith('FCOS_HOSTED_QUALIFICATION_ADMITTED'))return{name:'FCOS_HOSTED_QUALIFICATION_ADMITTED',value:writes?'true':'false'};
   return request.route.endsWith('_SHA256')?{name:'FCOS_ADMITTED_RELEASE_SETUP_SHA256',value:f.proof.setupSha256}:{name:'FCOS_ADMITTED_RELEASE_SETUP',value:canonical(f.proof.setup)};}};
  const operator=createCutoverBootstrapOperator({proof:f.proof,admin:{projectRef:'pjforfvchygdyqfcgpmw',query:(q,p)=>db.query(q,p)},github});
  await operator.admit();await assert.rejects(operator.execute('enable_qualification',{rootReviewSha256:H}),/PROVIDER_RESPONSE_UNKNOWN/);assert.equal(writes,1);
  const beforeGets=gets;assert.equal((await operator.execute('enable_qualification',{rootReviewSha256:H})).disposition,'readback');assert.equal(gets,beforeGets);
  await db.query('savepoint expected_followon');
  try{await assert.rejects(operator.execute('dispatch_qualification',{rootReviewSha256:H}),/PRIOR_ACTION_UNRESOLVED/);}finally{await db.query('rollback to savepoint expected_followon');await db.query('release savepoint expected_followon');}assert.equal(writes,1);
  const snapshot=await operator.snapshot();assert.equal(snapshot.events.at(-1).state,'uncertain');assert.equal(snapshot.control.bootstrap_id,f.proof.bootstrapId);
  assert.ok(!JSON.stringify(snapshot).includes('synthetic private raw provider detail'));
 });
 // Two independent admin sessions exercise the actual control-row lock, not a
 // shared JavaScript promise. Only one distinct bootstrap can win this epoch.
 await t.test('concurrent independent admin sessions cannot admit two bootstraps',async()=>{
  const f=await fixture(),other=new pg.Client({host:dir,port,user:'postgres',database:'postgres'});await other.connect();
  try{const results=await Promise.allSettled([db.query('select fcos_release_coordination.admit_cutover_bootstrap($1)',[f.proof]),other.query('select fcos_release_coordination.admit_cutover_bootstrap($1)',[{...f.proof,bootstrapId:'other-bootstrap'}])]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&/ADMISSION_INVALID/.test(r.reason.message)).length,1);
   assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.cutover_bootstraps')).rows[0].n,1);
  }finally{await other.end();}
 });
});

test('existing client exhausts only bounded definitive pending; an unknown response is never retried',async()=>{
 let calls=0;const p=inputs();const client=createCoordinatorClient({url:'http://localhost',epoch:1,owner:p.scope.owner,tokenProvider:async()=>'fixture',wait:async()=>{},now:()=>0,
  fetch:async()=>{calls++;return Response.json({error:'COORDINATION_METADATA_PENDING'},{status:429,headers:{'retry-after':'60'}});}});
 await assert.rejects(client.register({...p.scope,manifest:p.manifest}),/METADATA_PENDING/);assert.equal(calls,4);
 calls=0;const lost=createCoordinatorClient({url:'http://localhost',epoch:1,owner:p.scope.owner,tokenProvider:async()=>'fixture',fetch:async()=>{calls++;throw Error('private raw detail');}});
 await assert.rejects(lost.register({...p.scope,manifest:p.manifest}),/RESPONSE_UNKNOWN/);assert.equal(calls,1);
});

test('actual credential-free operator CLI emits the exact parameterized intent and rejects arbitrary commands',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'fcos-bootstrap-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const p=inputs().proof,proof=path.join(dir,'proof.json'),extra=path.join(dir,'extra.json');
 await writeFile(proof,JSON.stringify(p));await writeFile(extra,JSON.stringify({actionId:'dispatch_qualification'}));
 const args=['scripts/hosted-cutover-bootstrap.mjs','intent',proof,extra],options={cwd:root,encoding:'utf8',env:{PATH:process.env.PATH}};
 const actual=JSON.parse(execFileSync(process.execPath,args,options));
 assert.deepEqual(actual,bootstrapSql('intent',p,{actionId:'dispatch_qualification'}));
 assert.equal(actual.projectRef,'pjforfvchygdyqfcgpmw');assert.deepEqual(actual.parameters,[p.bootstrapId,'dispatch_qualification',digest(p)]);
 assert.throws(()=>execFileSync(process.execPath,[args[0],'arbitrary-write',proof],{...options,stdio:'pipe'}),e=>e.status===1&&e.stderr==='BOOTSTRAP_OPERATOR_INPUT_REFUSED\n');
});

test('container COPY closure includes every relative server import; normal caller pins the reviewed successor while original bootstrap stays frozen',async()=>{
 const docker=await readFile(new URL('supabase/functions/release-coordinator/Dockerfile',root),'utf8');
 const copies=[...docker.matchAll(/^COPY (\S+) /gm)].map(m=>m[1]);
 const seen=new Set();async function visit(relative){if(seen.has(relative))return;seen.add(relative);assert.ok(copies.some(p=>relative===p||relative.startsWith(`${p}/`)),`missing container COPY: ${relative}`);
  const text=await readFile(new URL(relative,root),'utf8');for(const m of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){if(m[1].startsWith('.'))await visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative),m[1])));}}
 await visit('supabase/functions/release-coordinator/server.mjs');assert.ok(seen.has('config/legacyReleaseContainment.js'));
 const caller=await readFile(new URL('.github/workflows/hosted-release.yml',root),'utf8');
 assert.equal(BOOTSTRAP_SOURCE.controllerSha,'64aa338b04cee7e05bde0ca9bfd10b81ac001a65');
 assert.ok(caller.includes('hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@6a3fbd8fd05a76c052e7e380d618aedf43e5b72e'));
 assert.ok(!caller.includes('hosted-release-controller.yml@4079c569'));
 const session=await readFile(new URL('scripts/lib/hosted-release/session.mjs',root),'utf8');
 assert.ok(session.includes("owner: { kind: 'release', id: 'features' }"));assert.equal(inputs().scope.owner.id,'features');
});
