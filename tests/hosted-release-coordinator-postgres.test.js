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
import { digest } from '../supabase/functions/release-coordinator/core.mjs';

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
  const H='a'.repeat(64),activation={inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'legacy',disabled:true,proofHash:H}],uncertainties:[]};
  await pool.query('select fcos_release_coordination.install_epoch($1,$2)',[1,activation]);
  const owner={kind:'release',id:'features'},m={epoch:1,executionMode:'qualification'};
  const scope={epoch:1,owner,releaseId:'race-release',manifestHash:await digest(m)},intent={...scope,phase:'preview.create',operationId:'race-operation',requestHash:H};
  const query=async(sql,p)=>{const connection=await pool.connect();try{await connection.query('set role fcos_coordinator_runtime');return await connection.query(sql,p);}finally{await connection.query('reset role');connection.release();}};
  const store=createSqlStore(query),S='b'.repeat(40),repository='hocheunglai-oss/fcos';
  const policy={repository,repositoryId:'77',ref:'refs/heads/main',registrationJob:'release / prepare',approvalJobPrefix:'release / production / ',
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
  const qualEvidence={key:'hosted.qualification',status:'passed',artifactSha256:H},qualHash=await digest(qualEvidence);
  // An unresolved qualification operation cannot activate, even with a declared success.
  await assert.rejects(pool.query('select fcos_release_coordination.activate($1,$2)',[1,{manifestHash:scope.manifestHash,evidenceHash:qualHash,oldWriterFenceHash:H,allWritersAdmitted:true,writerAdmissions:[{id:'legacy',admitted:true,proofHash:H}]}]),/ACTIVATION_STATE_INVALID/);
  await client.complete({...intent,evidence:{outcome:'applied',result:{id:'dpl_qualify'}}});
  await client.appendEvidence({...scope,evidenceId:'qualification-native',evidence:qualEvidence});
  await pool.query('select fcos_release_coordination.activate($1,$2)',[1,{manifestHash:scope.manifestHash,evidenceHash:qualHash,oldWriterFenceHash:H,allWritersAdmitted:true,writerAdmissions:[{id:'legacy',admitted:true,proofHash:H}]}]);
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
