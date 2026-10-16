import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';
import { createSqlStore, createCoordinatorHandler, createGithubAuthenticator } from '../supabase/functions/release-coordinator/index.ts';
import { verifyDatabaseIdentity } from '../supabase/functions/release-coordinator/runtime.mjs';
import { digest, createNotificationChallenge, createNotificationDeliveryProof } from '../supabase/functions/release-coordinator/core.mjs';

const available=spawnSync('pg_config',['--bindir'],{encoding:'utf8'});
const bindir=available.status===0?available.stdout.trim():null;
// PGlite tests always run. Native PG proves independent session/transaction races when installed.
test('native PostgreSQL independent runners have one durable execute and no expired/stolen lock', {skip:!bindir&&process.env.FCOS_REQUIRE_NATIVE_COORDINATOR_DATABASE!=='1'},async t=>{
  assert.ok(bindir,'Native PostgreSQL binaries are required by the coordinator database gate.');
  const directory=await mkdtemp(path.join(tmpdir(),'fcos-coordinator-pg-'));
  const data=path.join(directory,'data'),log=path.join(directory,'server.log'),port=54597;
  execFileSync(path.join(bindir,'initdb'),['-D',data,'--username=postgres','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
  execFileSync(path.join(bindir,'pg_ctl'),['-D',data,'-l',log,'-o',`-k ${directory} -h '' -p ${port}`,'-w','start'],{stdio:'pipe'});
  const pool=new pg.Pool({host:directory,port,user:'postgres',database:'postgres',max:12});
  t.after(async()=>{await pool.end();execFileSync(path.join(bindir,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(directory,{recursive:true,force:true});});
  await pool.query(await readFile(new URL('../supabase/migrations/20261016190509_release_coordination.sql',import.meta.url),'utf8'));
  const H='a'.repeat(64),activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'legacy',disabled:true,proofHash:H}],uncertainties:[]};
  await pool.query('select fcos_release_coordination.install_epoch($1,$2)',[1,activation]);
  const owner={kind:'release',id:'features'},m={epoch:1,executionMode:'qualification'};
  const scope={epoch:1,owner,releaseId:'race-release',manifestHash:await digest(m)},intent={...scope,phase:'preview.create',operationId:'race-operation',requestHash:H};
  const query=async(sql,p)=>{const connection=await pool.connect();try{await connection.query('set role fcos_coordinator_runtime');return await connection.query(sql,p);}finally{await connection.query('reset role');connection.release();}};
  const store=createSqlStore(query),S='b'.repeat(40),repository='hocheunglai-oss/fcos';
  const policy={repository,repositoryId:'77',ref:'refs/heads/main',registrationJob:'release / prepare',approvalJobPrefix:'release / production / ',resumeJobPrefix:'release / execute / ',
    workflows:[{callerWorkflowRef:`${repository}/.github/workflows/hosted-release.yml@refs/heads/main`,jobWorkflowRef:`${repository}/.github/workflows/hosted-release-controller.yml@${S}`,jobWorkflowSha:S}]};
  const pair=await generateKeyPair('RS256'),key=await exportJWK(pair.publicKey);key.kid='native';key.alg='RS256';
  const authenticateGithub=createGithubAuthenticator({policy,jwks:createLocalJWKSet({keys:[key]})});
  const token=await new SignJWT({repository,repository_id:'77',ref:'refs/heads/main',ref_type:'branch',run_id:'101',run_attempt:'1',sha:S,workflow_sha:S,
    workflow_ref:policy.workflows[0].callerWorkflowRef,job_workflow_ref:policy.workflows[0].jobWorkflowRef,job_workflow_sha:S,event_name:'workflow_dispatch',runner_environment:'github-hosted'})
    .setProtectedHeader({alg:'RS256',kid:'native'}).setIssuer('https://token.actions.githubusercontent.com').setAudience('fcos-release-coordinator')
    .setSubject(`repo:${repository}:ref:refs/heads/main`).setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('5m').setJti('native-fixture').sign(pair.privateKey);
  const handler=createCoordinatorHandler({store,authenticateGithub});
  const client=createCoordinatorClient({url:'http://localhost/coordinator',epoch:1,owner,tokenProvider:()=>token,fetch:(url,options)=>handler(new Request(url,options))});
  await client.register({...scope,manifest:m});
  // Begin waiting transactions before the first commit; all contenders are independent sessions.
  const results=await Promise.all(Array.from({length:24},()=>client.begin(intent)));
  assert.equal(results.filter(r=>r.disposition==='execute').length,1);
  assert.equal(results.filter(r=>r.disposition==='readback').length,23);
  // Runner disconnection after committed intent cannot remove its logical lock.
  const terminated=await pool.connect(); await terminated.query('begin');await terminated.query('select 1');terminated.release(true);
  assert.equal((await client.begin(intent)).disposition,'readback');
  const qualEvidence={key:'hosted.qualification',status:'passed',actualGithubArtifactValidated:true,artifactSha256:H},qualHash=await digest(qualEvidence);
  // An unresolved qualification operation cannot activate, even with a declared success.
  await assert.rejects(pool.query('select fcos_release_coordination.activate($1,$2)',[1,{manifestHash:scope.manifestHash,evidenceHash:qualHash,oldWriterFenceHash:H,allWritersAdmitted:true,writerAdmissions:[{id:'legacy',admitted:true,proofHash:H}]}]),/ACTIVATION_STATE_INVALID/);
  await client.complete({...intent,evidence:{outcome:'applied',result:{id:'dpl_qualify'}}});
  await client.appendEvidence({...scope,evidenceId:'qualification-native',evidence:qualEvidence});
  for(const phase of ['qualification.stage','qualification.promote','qualification.rollback']) {
    const simulated={...scope,phase,operationId:`native-${phase}`,requestHash:H};await client.begin(simulated);
    await client.complete({...simulated,evidence:{outcome:'applied',result:{simulated:true}}});
  }
  const activationProof={manifestHash:scope.manifestHash,evidenceHash:qualHash,oldWriterFenceHash:H,allWritersAdmitted:true,writerAdmissions:[{id:'legacy',admitted:true,proofHash:H}]};
  await assert.rejects(pool.query('select fcos_release_coordination.activate($1,$2)',[1,activationProof]),/NOTIFICATION_DELIVERY_REQUIRED/);
  const challenge=activation.notificationChallenge,receiptJson=JSON.stringify({...challenge,device:'iphone',confirmedByHuman:true,receivedAt:new Date().toISOString()});
  const notificationDelivery=await createNotificationDeliveryProof({receiptJson,challenge});
  await assert.rejects(client.request('activate',{...scope,notificationDelivery}),/ACTION_UNKNOWN/);
  await assert.rejects(client.snapshot({...scope,notificationDelivery}),/SERVER_FIELD_FORBIDDEN/);
  await client.appendEvidence({...scope,key:'notification.delivery',evidence:{...JSON.parse(receiptJson),receiptSha256:notificationDelivery.receiptSha256}});
  await assert.rejects(pool.query('select fcos_release_coordination.activate($1,$2)',[1,activationProof]),/NOTIFICATION_DELIVERY_REQUIRED/);
  const restricted=await pool.connect();try{await restricted.query('set role fcos_coordinator_runtime');
    await assert.rejects(restricted.query('select fcos_release_coordination.activate($1,$2)',[1,{...activationProof,notificationDelivery}]),/permission denied/);
  }finally{restricted.release(true);}
  for(const invalid of [{...notificationDelivery,receiptSha256:H},{...notificationDelivery,receiptJson:receiptJson+' '}]){
    await assert.rejects(pool.query('select fcos_release_coordination.activate($1,$2)',[1,{...activationProof,notificationDelivery:invalid}]),/NOTIFICATION_DELIVERY_REQUIRED/);
    assert.equal((await client.snapshot(scope)).mode,'qualification');
  }
  for(const patch of [{challenge:H},{repository:'other/fcos'},{operator:'other'},{device:'android'},{confirmedByHuman:'true'},
    {receivedAt:new Date(Date.parse(challenge.issuedAt)-1).toISOString()},{receivedAt:new Date(Date.now()+3600000).toISOString()}]){
    const invalidJson=JSON.stringify({...JSON.parse(receiptJson),...patch});
    const rawHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(invalidJson))),b=>b.toString(16).padStart(2,'0')).join('');
    await assert.rejects(pool.query('select fcos_release_coordination.activate($1,$2)',[1,{...activationProof,notificationDelivery:{receiptJson:invalidJson,receiptSha256:rawHash}}]),/NOTIFICATION_DELIVERY_REQUIRED/);
  }
  const activated=(await pool.query('select fcos_release_coordination.activate($1,$2) as result',[1,{...activationProof,notificationDelivery}])).rows[0].result;
  assert.equal(activated.notificationReceiptSha256,notificationDelivery.receiptSha256);
  const stored=(await pool.query('select proof from fcos_release_coordination.activations where epoch=1')).rows[0].proof;
  assert.deepEqual(stored.notificationDelivery,notificationDelivery);
  await assert.rejects(pool.query('update fcos_release_coordination.activations set proof=proof where epoch=1'),/APPEND_ONLY/);
  const second={...scope,releaseId:'another-release'};await client.register({...second,manifest:m});
  const secondIntent={...second,phase:'preview.create',operationId:'another-preview',requestHash:H};await client.begin(secondIntent);
  const m2={epoch:1,executionMode:'financial'},financial={kind:'financial',ownerId:'finance'},s2={epoch:1,owner:{kind:'financial',id:'finance'},releaseId:'finance-race',manifestHash:await digest(m2)};
  await store.request('register',{...s2,manifest:m2},financial);
  assert.equal((await store.request('begin',{...s2,phase:'financial.link',operationId:'finance-operation',requestHash:H},financial)).disposition,'busy');
  await client.readback({...secondIntent,evidence:{outcome:'unknown'}});
  assert.equal((await store.request('begin',{...s2,phase:'financial.link',operationId:'finance-operation',requestHash:H},financial)).disposition,'busy');
  await client.complete({...secondIntent,evidence:{outcome:'applied',result:{id:'confirmed'}}});
  assert.equal((await store.request('begin',{...s2,phase:'financial.link',operationId:'finance-operation',requestHash:H},financial)).disposition,'execute');
  // Exercise the actual HTTP handler with the minimally privileged DB role as well.
  assert.equal(await verifyDatabaseIdentity(query),true);
  assert.equal((await client.snapshot(scope)).operations['preview.create'].state,'complete');
  const minimal=await pool.connect();try{await minimal.query('set role fcos_coordinator_runtime');
    await assert.rejects(minimal.query('select * from fcos_release_coordination.registrations'),/permission denied/);
    await assert.rejects(minimal.query('select fcos_release_coordination.install_epoch($1,$2)',[2,activation]),/permission denied/);
  }finally{minimal.release(true);}
});
