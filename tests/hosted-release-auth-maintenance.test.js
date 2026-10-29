import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { createAuthMaintenanceCoordinationBridge } from '../scripts/lib/hosted-release/financial-coordination.mjs';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';
import { createCoordinatorHandler, createFinancialAuthenticator } from '../supabase/functions/release-coordinator/index.ts';
import { createSqlStore, digest, createNotificationChallenge, AUTH_MAINTENANCE_PHASES as PHASES,
 AUTH_MAINTENANCE_CURRENT_OWNER as OWNER, AUTH_MAINTENANCE_HISTORICAL_OWNER as OLD } from '../supabase/functions/release-coordinator/core.mjs';
const H='a'.repeat(64), J='b'.repeat(64), A='10000000-0000-4000-8000-000000000001', T='20000000-0000-4000-8000-000000000002';
const migrationName='20261018112914_auth_maintenance_coordination.sql';
const oldSql=await readFile(new URL('../supabase/migrations/20261016190509_release_coordination.sql',import.meta.url),'utf8');
const newSql=await readFile(new URL(`../supabase/migrations/${migrationName}`,import.meta.url),'utf8');
const pair=await generateKeyPair('ES256'),jwk=await exportJWK(pair.publicKey);jwk.kid='maintenance-fixture';jwk.alg='ES256';
const auth=createFinancialAuthenticator({policy:{issuer:'https://issuer.fixture.invalid',jwksUrl:'https://issuer.fixture.invalid/jwks',audience:'fcos-financial-coordination',owners:[OWNER,OLD]},jwks:createLocalJWKSet({keys:[jwk]})});
async function jwt(owner=OWNER){return new SignJWT({owner_id:owner,coordination_only:true,provider_authority:false}).setProtectedHeader({alg:'ES256',kid:jwk.kid}).setIssuer('https://issuer.fixture.invalid').setAudience('fcos-financial-coordination').setSubject(`fcos-financial:${owner}`).setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('5m').setJti(crypto.randomUUID()).sign(pair.privateKey);}
function authority(fences=[]){const at=Date.now();return {schemaVersion:1,authorityId:H,epoch:1,currentOwnerId:OWNER,historicalOwnerThreadId:OLD,
 humanTransferEvidenceSha256:H,humanAuthorityEvidenceSha256:H,actorId:A,tenantId:T,clientSha256:H,grantLineageSha256:H,sourceSha256:H,executorSha256:H,
 controllerSha256:H,destinationsSha256:H,legacyFenceProofSha256:H,fenceInventorySha256:null,phases:[...PHASES],caps:Object.fromEntries(PHASES.map(p=>[p,2])),
 issuedAt:at-1000,notAfter:at+3600000,maximumOccurrenceWindowMs:900000,coordinationOnly:true,providerAuthorityGranted:false};}
function occurrence(phase=PHASES[0],patch={}){return {phase,operationId:crypto.randomUUID(),occurrenceId:crypto.randomUUID(),requestFingerprint:H,expectedVersion:7,
 refreshLeaseId:crypto.randomUUID(),requestId:crypto.randomUUID(),issuedAt:Date.now()-1,notAfter:Date.now()+60000,recoveryOf:null,recoveryReadbackSha256:null,custodySha256:null,...patch};}
async function setup(t,{fences=[],patch={},native=false}={}){
 let db,query,exec,pool;
 if(native){const configured=spawnSync('pg_config',['--bindir'],{encoding:'utf8'});assert.equal(configured.status,0);const bin=configured.stdout.trim();
  const dir=await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'fcos-auth-maintenance-pg-')),data=join(dir,'data');let started=false;
  t.after(async()=>{await pool?.end();if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(dir,{recursive:true,force:true});});
  execFileSync(join(bin,'initdb'),['-D',data,'--username=postgres','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
  execFileSync(join(bin,'pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-k ${dir} -h '' -p 54599`,'-w','start'],{stdio:'pipe'});started=true;
  pool=new pg.Pool({host:dir,port:54599,user:'postgres',database:'postgres',max:12});query=(s,p=[])=>pool.query(s,p);exec=s=>pool.query(s);
 }else{db=new PGlite();t.after(()=>db.close());query=(s,p=[])=>db.query(s,p);exec=s=>db.exec(s);}
 await exec(oldSql);await exec(newSql);
 const activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'original',disabled:true,proofHash:H}],uncertainties:[]};
 await query('select fcos_release_coordination.install_epoch(1,$1)',[JSON.stringify(activation)]);
 const a={...authority(),...patch};a.fenceInventorySha256=await digest(fences);
 const imported=(await query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2) as v',[JSON.stringify(a),JSON.stringify(fences)])).rows[0].v;
 assert.equal(imported.authoritySha256,await digest(a));
 const runtimeQuery=async(sql,values)=>{if(pool){const c=await pool.connect();try{await c.query('set role fcos_coordinator_runtime');return await c.query(sql,values);}finally{await c.query('reset role');c.release();}}
  await exec('set role fcos_coordinator_runtime');try{return await query(sql,values);}finally{await exec('reset role');}};
 const store=createSqlStore(runtimeQuery),handler=createCoordinatorHandler({store,authenticateGithub:async()=>{throw Error('no GitHub identity');},authenticateFinancial:auth});
 const client=createCoordinatorClient({url:'http://localhost/coordination',adapter:'financial',epoch:1,owner:{kind:'financial',id:OWNER},tokenProvider:()=>jwt(),fetch:(url,init)=>handler(new Request(url,init))});
 let allow=true,fenced=true;
 const config={coordinator:client,authority:a,authoritySha256:imported.authoritySha256,recheckAuthority:async()=>allow?{authorityId:a.authorityId,authoritySha256:imported.authoritySha256,currentOwnerId:OWNER,historicalOwnerThreadId:OLD,humanTransferEvidenceSha256:a.humanTransferEvidenceSha256}:null,
  recheckFence:async()=>({permanentlyFenced:fenced,currentOwnerId:OWNER,historicalOwnerThreadId:OLD,legacyFenceProofSha256:H,fenceInventorySha256:a.fenceInventorySha256})};
 return {query,exec,store,client,handler,a,config,bridge:createAuthMaintenanceCoordinationBridge(config),setAllow:v=>allow=v,setFence:v=>fenced=v};
}
const evidence=()=>({outcome:'applied',nativeAcknowledgementSha256:H,independentReadbackSha256:J});
const principal={kind:'financial',ownerId:OWNER,coordinationOnly:true,providerAuthorityGranted:false};
async function registered(f,input){const calls=[];const bridge=createAuthMaintenanceCoordinationBridge({...f.config,coordinator:{...f.client,register:async p=>{calls.push(p);return f.client.register(p);}}});
 const result=await bridge.begin(input);return {bridge,b:calls[0],result};}

test('same coordinator admits only four maintenance phases in qualification; current Features and legacy lineage remain distinct',async t=>{
 const f=await setup(t);
 for(const phase of PHASES.slice(0,3)){const input=occurrence(phase);const first=await f.bridge.begin(input);assert.equal(first.disposition,'execute');assert.equal(first.providerAuthorityGranted,false);
  assert.equal((await f.bridge.begin(input)).disposition,'readback');await f.bridge.complete(input,evidence());assert.equal((await f.bridge.begin(input)).disposition,'complete');
  const snap=await f.bridge.snapshot(input);assert.equal(snap.registration.owner.id,OWNER);assert.equal(snap.registration.manifest.historicalOwnerThreadId,OLD);assert.equal(snap.mode,'qualification');}
 assert.equal((await f.query('select mode from fcos_release_coordination.control')).rows[0].mode,'qualification');
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.activations')).rows[0].n,0);
});
test('runtime cannot import authority, alter immutable allocations, refund caps or bypass original dispatch grants',async t=>{
 const f=await setup(t);await f.exec('set role fcos_coordinator_runtime');
 try{await assert.rejects(f.query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2)',[JSON.stringify(f.a),'[]']),/permission denied/);
  await assert.rejects(f.query("select fcos_release_coordination.dispatch_without_auth_maintenance('register','{}','{}')"),/permission denied/);
  await assert.rejects(f.query('select * from fcos_release_coordination.auth_maintenance_authorities'),/permission denied/);
 }finally{await f.exec('reset role');}
 await assert.rejects(f.query('update fcos_release_coordination.auth_maintenance_authorities set authority=authority'),/APPEND_ONLY/);
 const input=occurrence();await f.bridge.begin(input);await f.bridge.complete(input,{...evidence(),outcome:'not_applied'});
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_occurrences')).rows[0].n,1);
});
test('wrong parent, current/historical owner, actor, source, epoch and phase cannot acquire an occurrence',async t=>{
 const f=await setup(t);const input=occurrence(),captured=await registered(f,input);await captured.bridge.complete(input,evidence());
 for(const change of [{authoritySha256:J},{currentOwnerId:OLD},{historicalOwnerThreadId:OWNER},{actorId:crypto.randomUUID()},{tenantId:crypto.randomUUID()},
  {clientSha256:J},{sourceSha256:J},{executorSha256:J},{controllerSha256:J},{humanTransferEvidenceSha256:J},{epoch:2},{phase:'financial.create'}]){
  const manifest={...captured.b.manifest,...change,operationId:crypto.randomUUID(),occurrenceId:crypto.randomUUID()};
  await assert.rejects(f.client.register({releaseId:`wrong-${crypto.randomUUID()}`,manifest,manifestHash:await digest(manifest)}));
 }
 const oldPrincipal={...principal,ownerId:OLD};await assert.rejects(f.store.request('register',{...captured.b,epoch:1,owner:{kind:'financial',id:OLD}},oldPrincipal),/PARENT_REQUIRED/);
 f.setAllow(false);await assert.rejects(f.bridge.begin(occurrence()),/IMPORTED_AUTHORITY_REQUIRED/);f.setAllow(true);f.setFence(false);await assert.rejects(f.bridge.begin(occurrence()),/HANDOFF_FENCE_REQUIRED/);
});
test('finite explicit caps debit on unique registration and never refund after not_applied',async t=>{
 const caps=Object.fromEntries(PHASES.map(p=>[p,p===PHASES[0]?1:0]));const f=await setup(t,{patch:{caps}}),input=occurrence();
 await f.bridge.begin(input);await f.bridge.complete(input,{...evidence(),outcome:'not_applied'});
 await assert.rejects(f.bridge.begin(occurrence()),/CAP_EXHAUSTED/);await assert.rejects(f.bridge.begin(occurrence(PHASES[1])),/CAP_EXHAUSTED/);
 const absent={...f.a};delete absent.caps;assert.throws(()=>createAuthMaintenanceCoordinationBridge({...f.config,authority:absent,authoritySha256:H}),/IMPORTED_AUTHORITY_REQUIRED/);
});
test('expired occurrence and null/extended time bindings cannot start a provider-bearing phase',async t=>{
 const f=await setup(t),input=occurrence(undefined,{issuedAt:f.a.issuedAt+1,notAfter:Date.now()-1});await assert.rejects(f.bridge.begin(input),/EXPIRED/);
 await assert.rejects(f.bridge.begin(occurrence(undefined,{issuedAt:f.a.notAfter-1000,notAfter:f.a.notAfter+1})),/TIME_SCOPE_REQUIRED/);
 const captured=await registered(f,occurrence());
 const bad={...captured.b.manifest,operationId:crypto.randomUUID(),occurrenceId:crypto.randomUUID(),notAfter:null};
 await assert.rejects(f.store.request('register',{epoch:1,owner:{kind:'financial',id:OWNER},releaseId:'null-time',manifest:bad,manifestHash:await digest(bad)},principal),/MANIFEST_INVALID/);
});
test('unknown intent blocks later tenant/client occurrences and release operations, without expiry, refund or runtime resolution',async t=>{
 const f=await setup(t),input=occurrence(),{b}=await registered(f,input);
 await f.client.uncertain({...b,evidence:{outcome:'unknown'}});
 await assert.rejects(f.bridge.begin(occurrence()),/UNRESOLVED/);await assert.rejects(f.bridge.complete(input,evidence()),/DEFINITIVE_READBACK_REQUIRED/);
 const read=await f.bridge.recover(input);assert.equal(read.lock,input.operationId);assert.equal(read.events.at(-1).state,'uncertain');
 const m={epoch:1,executionMode:'qualification'},scope={epoch:1,owner:{kind:'release',id:'features'},releaseId:'release-blocked',manifestHash:await digest(m)};
 await f.store.request('register',{...scope,manifest:m},{kind:'github',runId:'1',runAttempt:'1',sha:H,workflowSha:H,jobWorkflowRef:'fixture',jobWorkflowSha:H});
 assert.equal((await f.store.request('begin',{...scope,phase:'preview.create',operationId:'release-operation',requestHash:H},{kind:'github'})).disposition,'busy');
 await f.exec('set role fcos_coordinator_runtime');try{await assert.rejects(f.query('select fcos_release_coordination.resolve_auth_maintenance_fence($1,$2)',[input.operationId,JSON.stringify(evidence())]),/permission denied/);}finally{await f.exec('reset role');}
});
test('one global operation lock serializes release and maintenance; ordinary financial phases remain denied in qualification',async t=>{
 const f=await setup(t),m={epoch:1,executionMode:'qualification'},scope={epoch:1,owner:{kind:'release',id:'features'},releaseId:'release-first',manifestHash:await digest(m)},gh={kind:'github',runId:'1',runAttempt:'1',sha:H,workflowSha:H,jobWorkflowRef:'fixture',jobWorkflowSha:H};
 await f.store.request('register',{...scope,manifest:m},gh);await f.store.request('begin',{...scope,phase:'preview.create',operationId:'release-lock',requestHash:H},gh);
 const input=occurrence();assert.equal((await f.bridge.begin(input)).disposition,'busy');
 await f.store.request('complete',{...scope,phase:'preview.create',operationId:'release-lock',evidence:{outcome:'applied'},evidenceHash:H},gh);
 assert.equal((await f.bridge.begin(input)).disposition,'execute');
 const fm={epoch:1,executionMode:'financial'},fs={epoch:1,owner:{kind:'financial',id:OWNER},releaseId:'ordinary-finance',manifestHash:await digest(fm)};
 await f.store.request('register',{...fs,manifest:fm},principal);
 await assert.rejects(f.store.request('begin',{...fs,phase:'financial.create',operationId:'forbidden',requestHash:H},principal),/QUALIFICATION_ONLY/);
});
test('legacy unresolved fence survives cutover; only separately admitted captured-rotation recovery can acquire the lock',async t=>{
 const original='legacy-original-operation',f=await setup(t,{fences:[{operationId:original,evidenceSha256:H}]});
 await assert.rejects(f.bridge.begin(occurrence()),/UNRESOLVED/);
 const recovery=occurrence(PHASES[3],{recoveryOf:original,recoveryReadbackSha256:J,custodySha256:H});
 await assert.rejects(f.bridge.begin(recovery),/RECOVERY_REQUIRED/);
 await f.query('select fcos_release_coordination.admit_auth_maintenance_saved_rotation($1,$2,$3,$4,$5,$6)',[H,original,J,H,recovery.expectedVersion,recovery.refreshLeaseId]);
 assert.equal((await f.bridge.begin(recovery)).disposition,'execute');await f.bridge.complete(recovery,evidence());
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_resolutions where operation_id=$1',[original])).rows[0].n,0);
 await assert.rejects(f.bridge.begin(occurrence()),/UNRESOLVED/);
 await f.query('select fcos_release_coordination.resolve_auth_maintenance_fence($1,$2)',[original,JSON.stringify({...evidence(),recoveryOperationId:recovery.operationId})]);
 assert.equal((await f.bridge.begin(occurrence())).disposition,'execute');
});
test('native PostgreSQL independently competing child grants cannot exceed an imported cap',async t=>{
 const configured=spawnSync('pg_config',['--bindir'],{encoding:'utf8'});if(configured.status!==0){t.skip('native PostgreSQL unavailable');return;}
 const f=await setup(t,{native:true,patch:{caps:Object.fromEntries(PHASES.map(p=>[p,p===PHASES[1]?1:0]))}});
 const make=async()=>{const input=occurrence(PHASES[1]);const m={schemaVersion:1,epoch:1,executionMode:'auth_maintenance',authorityId:H,authoritySha256:await digest(f.a),currentOwnerId:OWNER,historicalOwnerThreadId:OLD,
 humanTransferEvidenceSha256:H,actorId:A,tenantId:T,clientSha256:H,grantLineageSha256:H,sourceSha256:H,executorSha256:H,controllerSha256:H,destinationsSha256:H,...input,coordinationOnly:true,providerAuthorityGranted:false};
 return f.client.register({releaseId:`race-${input.occurrenceId}`,manifest:m,manifestHash:await digest(m)});};
 const results=await Promise.allSettled(Array.from({length:12},make));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_occurrences')).rows[0].n,1);
});

test('registered maintenance cannot fall through to legacy completion by changing request manifest mode',async t=>{
 const f=await setup(t),input=occurrence(),{b}=await registered(f,input);await f.client.uncertain({...b,evidence:{outcome:'unknown'}});
 await assert.rejects(f.client.complete({...b,manifest:{executionMode:'financial'},evidence:{outcome:'applied'}}),/DEFINITIVE_READBACK_REQUIRED/);
 assert.equal((await f.bridge.snapshot(input)).events.at(-1).state,'uncertain');
});
test('tenant/client unknown fence persists after a new epoch and a separately imported authority',async t=>{
 const original='old-era-unknown',f=await setup(t,{fences:[{operationId:original,evidenceSha256:H}]});
 const activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'same-fenced-writer',disabled:true,proofHash:H}],uncertainties:[]};
 await f.query('select fcos_release_coordination.install_epoch(2,$1)',[JSON.stringify(activation)]);
 const a={...f.a,authorityId:J,humanAuthorityEvidenceSha256:J,epoch:2,fenceInventorySha256:await digest([])};
 const imported=(await f.query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2) as v',[JSON.stringify(a),'[]'])).rows[0].v;
 const client=createCoordinatorClient({url:'http://localhost/coordination',adapter:'financial',epoch:2,owner:{kind:'financial',id:OWNER},tokenProvider:()=>jwt(),fetch:(url,init)=>f.handler(new Request(url,init))});
 const bridge=createAuthMaintenanceCoordinationBridge({...f.config,coordinator:client,authority:a,authoritySha256:imported.authoritySha256,
  recheckAuthority:async()=>({authorityId:J,authoritySha256:imported.authoritySha256,currentOwnerId:OWNER,historicalOwnerThreadId:OLD,humanTransferEvidenceSha256:H}),
  recheckFence:async()=>({permanentlyFenced:true,currentOwnerId:OWNER,historicalOwnerThreadId:OLD,legacyFenceProofSha256:H,fenceInventorySha256:a.fenceInventorySha256})});
 await assert.rejects(bridge.begin(occurrence()),/UNRESOLVED/);
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_fences where operation_id=$1',[original])).rows[0].n,1);
});

test('one human authority cannot be salted into another aggregate budget and malformed parent fields refuse',async t=>{
 const f=await setup(t);
 await assert.rejects(f.query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2)',[JSON.stringify({...f.a,authorityId:J}),'[]']),/duplicate key/);
 for(const patch of [{historicalOwnerThreadId:null},{currentOwnerId:null},{phases:null},{coordinationOnly:null},{issuedAt:null},{caps:{}}])
  await assert.rejects(f.query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2)',[JSON.stringify({...f.a,authorityId:J,humanAuthorityEvidenceSha256:J,...patch}),'[]']));
});
test('null actor or tenant cannot consume an immutable imported human authority',async t=>{
 const f=await setup(t),a={...f.a,authorityId:J,humanAuthorityEvidenceSha256:J};
 for(const field of ['actorId','tenantId']) for(const value of [null,1,{},[],true,''])
  await assert.rejects(f.query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2)',[JSON.stringify({...a,[field]:value}),'[]']),/AUTHORITY_INVALID/);
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_authorities where authority_id=$1',[J])).rows[0].n,0);
 await f.query('select fcos_release_coordination.import_auth_maintenance_authority($1,$2)',[JSON.stringify(a),'[]']);
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_authorities where authority_id=$1',[J])).rows[0].n,1);
});
test('saved-rotation admission binds original expected version and original lease, and never authorizes a new POST',async t=>{
 const original='captured-original',f=await setup(t,{fences:[{operationId:original,evidenceSha256:H}]}),lease=crypto.randomUUID();
 await f.query('select fcos_release_coordination.admit_auth_maintenance_saved_rotation($1,$2,$3,$4,$5,$6)',[H,original,J,H,7,lease]);
 for(const change of [{expectedVersion:8},{refreshLeaseId:crypto.randomUUID()},{recoveryReadbackSha256:H},{custodySha256:J}])
  await assert.rejects(f.bridge.begin(occurrence(PHASES[3],{recoveryOf:original,recoveryReadbackSha256:J,custodySha256:H,refreshLeaseId:lease,...change})),/RECOVERY_REQUIRED/);
 assert.equal((await f.bridge.begin(occurrence(PHASES[3],{recoveryOf:original,recoveryReadbackSha256:J,custodySha256:H,refreshLeaseId:lease}))).disposition,'execute');
 assert.equal(Object.hasOwn(f.bridge,'renew'),false);assert.equal(Object.hasOwn(f.bridge,'submit'),false);
});
test('real financial JWT for historical owner cannot impersonate the transferred current owner',async t=>{
 const f=await setup(t),input=occurrence(),{b}=await registered(f,input);await f.bridge.complete(input,evidence());
 const response=await f.handler(new Request('http://localhost/coordination',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${await jwt(OLD)}`,'x-fcos-coordination-adapter':'financial'},
 body:JSON.stringify({action:'register',payload:{...b,epoch:1,owner:{kind:'financial',id:OLD},releaseId:'old-owner-attempt'}})}));
 assert.equal(response.status,403);assert.equal((await response.json()).error,'COORDINATION_MAINTENANCE_PRINCIPAL_REQUIRED');
});

test('privileged early revocation blocks new admission without clearing unknown state or refunding the occurrence',async t=>{
 const f=await setup(t),input=occurrence();await f.bridge.begin(input);
 await f.query('select fcos_release_coordination.revoke_auth_maintenance_authority($1,$2)',[H,J]);
 await assert.rejects(f.bridge.complete(input,evidence()),/REVOKED/);await assert.rejects(f.bridge.begin(occurrence()),/REVOKED/);
 const snap=await f.bridge.recover(input);assert.equal(snap.lock,input.operationId);assert.equal(snap.events.at(-1).state,'intent');
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_occurrences')).rows[0].n,1);
 await f.exec('set role fcos_coordinator_runtime');try{await assert.rejects(f.query('select fcos_release_coordination.revoke_auth_maintenance_authority($1,$2)',[H,J]),/permission denied/);}finally{await f.exec('reset role');}
});
test('central occurrence expiry after allocation consumes the grant but cannot begin later',async t=>{
 const f=await setup(t),input=occurrence(undefined,{issuedAt:Date.now()-1,notAfter:Date.now()+300});let saved;
 const bridge=createAuthMaintenanceCoordinationBridge({...f.config,coordinator:{...f.client,register:async b=>{saved=b;return f.client.register(b);},begin:async()=>({disposition:'not_submitted'})}});
 await bridge.begin(input);await new Promise(r=>setTimeout(r,350));
 await assert.rejects(f.client.begin(saved),/EXPIRED/);
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.auth_maintenance_occurrences')).rows[0].n,1);
 assert.equal((await f.query('select count(*)::int n from fcos_release_coordination.operations')).rows[0].n,0);
});
test('bridge captures the exact occurrence before asynchronous authority recheck',async t=>{
 const f=await setup(t),input=occurrence();let unblock;const waiting=new Promise(r=>unblock=r);
 const bridge=createAuthMaintenanceCoordinationBridge({...f.config,recheckAuthority:async b=>{await waiting;return f.config.recheckAuthority(b);}});
 const pending=bridge.begin(input);input.requestFingerprint=J;unblock();assert.equal((await pending).disposition,'execute');
 assert.equal((await f.query('select request_hash from fcos_release_coordination.operations where operation_id=$1',[input.operationId])).rows[0].request_hash,H);
});
