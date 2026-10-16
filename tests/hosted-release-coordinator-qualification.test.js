import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { createCoordinatorHandler, createSqlStore, createGithubAuthenticator, createGithubQualificationValidator } from '../supabase/functions/release-coordinator/index.ts';
import { validatePolicy } from '../supabase/functions/release-coordinator/auth.mjs';
import { digest, createNotificationChallenge, createNotificationDeliveryProof } from '../supabase/functions/release-coordinator/core.mjs';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';

const H='a'.repeat(64),S='b'.repeat(40),B='c'.repeat(40),C='d'.repeat(40),REPO='hocheunglai-oss/fcos';
const REF='refs/heads/codex/hosted-qualification-exact';
const admission={repository:REPO,repositoryId:'77',ref:REF,bootstrapSha:B,
  callerWorkflowRef:`${REPO}/.github/workflows/authenticated-release.yml@${REF}`,callerWorkflowSha:B,
  jobWorkflowRef:`${REPO}/.github/workflows/hosted-release-controller.yml@${S}`,jobWorkflowSha:S,candidateSha:C,setupSha256:H};
const policy={repository:REPO,repositoryId:'77',ref:'refs/heads/main',registrationJob:'release / prepare',
  approvalJobPrefix:'release / production / ',resumeJobPrefix:'release / execute / ',qualificationAdmission:admission,
  workflows:[{callerWorkflowRef:`${REPO}/.github/workflows/hosted-release.yml@refs/heads/main`,jobWorkflowRef:admission.jobWorkflowRef,jobWorkflowSha:S}]};
const qualificationSource={ref:REF,bootstrapSha:B,callerWorkflowRef:admission.callerWorkflowRef,controllerSha:S,candidateSha:C};
const manifest={epoch:1,stage:'qualification',executionMode:'qualification',setupSha256:H,qualificationSource,
  candidate:{sha:C},controller:{sha:S,workflow:'.github/workflows/hosted-release-controller.yml'}};
const pair=await generateKeyPair('RS256'),key=await exportJWK(pair.publicKey);key.kid='qualification';key.alg='RS256';
const jwks=createLocalJWKSet({keys:[key]});
const baseClaims={repository:REPO,repository_id:'77',ref:REF,ref_type:'branch',ref_protected:'true',run_id:'101',run_attempt:'1',
  sha:B,workflow_sha:B,workflow_ref:admission.callerWorkflowRef,job_workflow_ref:admission.jobWorkflowRef,job_workflow_sha:S,
  event_name:'workflow_dispatch',runner_environment:'github-hosted',actor:'hocheunglai-oss',actor_id:'9'};
async function token(patch={}) {const claims={...baseClaims,...patch};return new SignJWT(claims)
  .setProtectedHeader({alg:'RS256',kid:'qualification'}).setIssuer('https://token.actions.githubusercontent.com').setAudience('fcos-release-coordinator')
  .setSubject(claims.environment?`repo:${REPO}:environment:${claims.environment}`:`repo:${REPO}:ref:${claims.ref}`)
  .setJti(crypto.randomUUID()).setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('5m').sign(pair.privateKey);}
const normalToken=()=>token({ref:'refs/heads/main',sha:S,workflow_sha:S,workflow_ref:policy.workflows[0].callerWorkflowRef,qualificationOnly:true,qualificationAdmission:admission});
const migration=await readFile(new URL('../supabase/migrations/20261016190509_release_coordination.sql',import.meta.url),'utf8');
const available=spawnSync('pg_config',['--bindir'],{encoding:'utf8'}),bindir=available.status===0?available.stdout.trim():null;

async function fixture(t,native=false) {
  let db,query;
  if(native) {
    const directory=await mkdtemp(path.join(tmpdir(),'fcos-qualification-bootstrap-pg-')),data=path.join(directory,'data'),port=54591;
    execFileSync(path.join(bindir,'initdb'),['-D',data,'--username=postgres','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
    execFileSync(path.join(bindir,'pg_ctl'),['-D',data,'-l',path.join(directory,'server.log'),'-o',`-k ${directory} -h '' -p ${port}`,'-w','start'],{stdio:'pipe'});
    db=new pg.Pool({host:directory,port,user:'postgres',database:'postgres',max:4});
    t.after(async()=>{await db.end();execFileSync(path.join(bindir,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(directory,{recursive:true,force:true});});
    await db.query(migration);
    query=async(sql,values)=>{const connection=await db.connect();try{await connection.query('set role fcos_coordinator_runtime');return await connection.query(sql,values);}finally{await connection.query('reset role');connection.release();}};
  } else {db=new PGlite();t.after(()=>db.close());await db.exec(migration);query=(sql,values)=>db.query(sql,values);}
  const install={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,
    legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'legacy',disabled:true,proofHash:H}],uncertainties:[]};
  await db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[1,JSON.stringify(install)]);
  const actor={id:9,login:'hocheunglai-oss'},repository={id:77,full_name:REPO,default_branch:'main'};
  const metadata={repository,branch:{name:REF.slice(11),protected:true,commit:{sha:B}},
    protection:{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}},
    run:{id:101,run_attempt:1,status:'in_progress',conclusion:null,event:'workflow_dispatch',head_branch:REF.slice(11),head_sha:B,
      path:'.github/workflows/authenticated-release.yml',repository,head_repository:repository,actor,triggering_actor:actor,
      referenced_workflows:[{path:admission.jobWorkflowRef,sha:S}]}};
  let reads=0,active=0,maximum=0;
  const fetchImpl=async(url,options)=>{
    reads++;active++;maximum=Math.max(active,maximum);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(options.headers.authorization,'Bearer readonly-metadata');
    await new Promise(resolve=>setImmediate(resolve));
    const suffix=url.replace(`https://api.github.com/repos/${REPO}`,'');
    const data=url==='https://api.github.com/user'?actor:suffix===''?metadata.repository:
      suffix===`/branches/${encodeURIComponent(REF.slice(11))}`?metadata.branch:
      suffix===`/branches/${encodeURIComponent(REF.slice(11))}/protection`?metadata.protection:suffix==='/actions/runs/101'?metadata.run:null;
    assert.ok(data,`Unexpected metadata path ${url}`);active--;return Response.json(data);
  };
  const authenticateGithub=createGithubAuthenticator({policy,jwks}),store=createSqlStore(query);
  const handler=createCoordinatorHandler({store,authenticateGithub,validateQualification:createGithubQualificationValidator({policy,token:'readonly-metadata',fetchImpl})});
  let currentToken=await token();
  const client=createCoordinatorClient({url:'http://localhost/coordinate',epoch:1,owner:{kind:'release',id:'features'},
    tokenProvider:()=>currentToken,fetch:(url,options)=>handler(new Request(url,options))});
  const scope={releaseId:'bootstrap-qualification',manifestHash:await digest(manifest)};
  return {db,query,store,handler,client,scope,metadata,install,authenticateGithub,reads:()=>reads,maximum:()=>maximum,
    setToken:value=>{currentToken=value;},register:()=>client.register({...scope,manifest})};
}

async function exerciseQualification(f) {
  await f.register();const principal=await f.authenticateGithub(await token());
  assert.equal(principal.qualificationOnly,true);assert.deepEqual(principal.qualificationAdmission,admission);
  const preview={...f.scope,phase:'preview.create',operationId:'bootstrap-preview',requestHash:H};
  const starts=await Promise.all(Array.from({length:8},()=>f.client.begin(preview)));
  assert.equal(starts.filter(x=>x.disposition==='execute').length,1);assert.equal(starts.filter(x=>x.disposition==='readback').length,7);
  assert.ok(f.maximum()<=2,'Metadata concurrency is globally bounded across requests');
  await f.client.uncertain({...preview,evidence:{outcome:'unknown'}});
  assert.equal((await f.client.begin(preview)).disposition,'readback');
  await f.client.complete({...preview,evidence:{outcome:'applied',result:{id:'dpl_ActualPreviewFixture'}}});
  for(const phase of ['qualification.stage','qualification.promote','qualification.rollback']) {
    const intent={...f.scope,phase,operationId:phase,requestHash:H};assert.equal((await f.client.begin(intent)).disposition,'execute');
    await f.client.complete({...intent,evidence:{outcome:'applied',result:{simulated:true}}});
  }
  await assert.rejects(f.client.approve(f.scope),/QUALIFICATION_ONLY/);await assert.rejects(f.client.resume(f.scope),/QUALIFICATION_ONLY/);
  for(const phase of ['production.stage','production.promote','production.rollback','financial.create'])
    await assert.rejects(f.client.begin({...f.scope,phase,operationId:phase,requestHash:H}),/QUALIFICATION_ONLY/);
  const live={epoch:1,stage:'application',executionMode:'release'},liveScope={epoch:1,owner:{kind:'release',id:'features'},releaseId:'live-release',manifestHash:await digest(live)};
  await f.store.request('register',{...liveScope,manifest:live},await f.authenticateGithub(await normalToken()));
  await assert.rejects(f.client.snapshot(liveScope),/QUALIFICATION_SCOPE_INVALID/);
  await assert.rejects(f.store.request('register',{...liveScope,releaseId:'forged-live',manifest:live},principal),/QUALIFICATION_SCOPE_INVALID/);
  await assert.rejects(f.store.request('admitApproval',{...f.scope,epoch:1,owner:{kind:'release',id:'features'}},principal),/QUALIFICATION_ONLY/);
  const proof={key:'hosted.qualification',status:'passed',actualGithubArtifactValidated:true,artifactSha256:H};
  await f.client.appendEvidence({...f.scope,key:proof.key,evidence:proof});
  const notificationDelivery=await createNotificationDeliveryProof({challenge:f.install.notificationChallenge,
    receiptJson:JSON.stringify({...f.install.notificationChallenge,device:'iphone',confirmedByHuman:true,receivedAt:new Date().toISOString()})});
  const activation={manifestHash:f.scope.manifestHash,evidenceHash:await digest(proof),oldWriterFenceHash:H,
    allWritersAdmitted:true,writerAdmissions:[{id:'legacy',admitted:true,proofHash:H}],notificationDelivery};
  assert.equal((await f.db.query('select fcos_release_coordination.activate($1,$2::jsonb) as result',[1,JSON.stringify(activation)])).rows[0].result.mode,'active');
  await assert.rejects(f.client.snapshot(f.scope),/QUALIFICATION_ONLY/);
  assert.equal((await f.db.query('select count(*)::int as n from fcos_release_coordination.authorizations')).rows[0].n,0);
}

test('qualification admission is independently pinned and never derived from forged caller claims',async()=>{
  const authenticate=createGithubAuthenticator({policy,jwks});
  assert.equal((await authenticate(await normalToken())).qualificationOnly,undefined);
  for(const patch of [{sha:S},{workflow_sha:S},{job_workflow_sha:B},{workflow_ref:policy.workflows[0].callerWorkflowRef},
    {ref_protected:'false'},{repository_id:'78'},{event_name:'pull_request'},{run_attempt:'2'},
    {environment:'fcos-production-release'},{environment:'fcos-hosted-production-resume'}])
    await assert.rejects(authenticate(await token({...patch,qualificationOnly:true,qualificationAdmission:admission})),/IDENTITY_INVALID/);
  for(const patch of [{ref:'refs/heads/main'},{callerWorkflowSha:S},{setupSha256:'main'},{repository:'other/fcos'},
    {callerWorkflowRef:`${REPO}/.github/workflows/other.yml@${REF}`},{extra:true}])
    assert.throws(()=>validatePolicy({...policy,qualificationAdmission:{...admission,...patch}}),/QUALIFICATION_POLICY_INVALID/);
});

test('actual Request handler and PGlite permit the exact qualification path and refuse Production authority',async t=>exerciseQualification(await fixture(t)));

test('manifest setup, candidate, controller, both qualification modes and exact source fields are mandatory',async t=>{
  const f=await fixture(t);
  for(const patch of [{stage:'application'},{executionMode:'release'},{setupSha256:'f'.repeat(64)},
    {candidate:{sha:B}},{controller:{sha:B,workflow:manifest.controller.workflow}},{qualificationSource:{...qualificationSource,extra:true}},
    {qualificationSource:{...qualificationSource,bootstrapSha:S}},{qualificationSource:null}]) {
    const m={...manifest,...patch};await assert.rejects(f.client.register({releaseId:crypto.randomUUID(),manifest:m,manifestHash:await digest(m)}),/QUALIFICATION_SCOPE_INVALID/);
  }
  assert.equal(f.reads(),0); // Invalid scope is rejected before SQL or metadata.
  await assert.rejects(f.client.register({...f.scope,manifest,qualificationOnly:true}),/SERVER_FIELD_FORBIDDEN/);
  assert.equal((await f.db.query('select count(*)::int as n from fcos_release_coordination.registrations')).rows[0].n,0);
});

test('each request rechecks actual protected branch, run and immutable reusable controller before SQL',async t=>{
  const f=await fixture(t);await f.register();
  f.metadata.run.path=`.github/workflows/authenticated-release.yml@${REF.slice(11)}`;
  assert.equal((await f.client.snapshot(f.scope)).registration.manifest_hash,f.scope.manifestHash);
  const original=structuredClone(f.metadata);
  for(const mutate of [m=>{m.branch.commit.sha=S;},m=>{m.branch.protected=false;},m=>{m.protection.allow_force_pushes.enabled=true;},
    m=>{m.run.head_sha=S;},m=>{m.run.path='.github/workflows/authenticated-release.yml@other';},m=>{m.run.run_attempt=2;},m=>{m.run.status='completed';},m=>{m.run.referenced_workflows[0].sha=B;},
    m=>{m.run.actor={login:'other',id:10};},m=>{m.run.repository={id:78,full_name:REPO};}]) {
    Object.assign(f.metadata,structuredClone(original));mutate(f.metadata);
    await assert.rejects(f.client.begin({...f.scope,phase:'preview.create',operationId:'never-dispatched',requestHash:H}),/QUALIFICATION_/);
  }
  assert.equal((await f.db.query('select count(*)::int as n from fcos_release_coordination.operations')).rows[0].n,0);
});

test('qualification principal cannot route to the separate financial adapter or self-supply server authority',async t=>{
  const f=await fixture(t),bearer=await token(),scope={...f.scope,epoch:1,owner:{kind:'financial',id:'finance'},manifest};
  for(const financial of [false,true]) {
    const response=await f.handler(new Request('http://localhost/coordinate',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bearer}`,
      ...(financial?{'x-fcos-coordination-adapter':'financial'}:{})},body:JSON.stringify({action:'register',payload:scope})}));
    assert.equal(response.status,403);assert.match((await response.json()).error,/OWNER_MISMATCH|FINANCIAL_ADAPTER_DISABLED/);
  }
  const handler=createCoordinatorHandler({store:f.store,authenticateGithub:f.authenticateGithub});
  const response=await handler(new Request('http://localhost/coordinate',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bearer}`},
    body:JSON.stringify({action:'register',payload:{...f.scope,epoch:1,owner:{kind:'release',id:'features'},manifest}})}));
  assert.equal(response.status,403);assert.equal((await response.json()).error,'COORDINATION_QUALIFICATION_VALIDATOR_REQUIRED');
});

test('native PostgreSQL qualification bootstrap uses the real handler and private runtime role',
  {skip:!bindir&&process.env.FCOS_REQUIRE_NATIVE_COORDINATOR_DATABASE!=='1'},async t=>{
    assert.ok(bindir,'Native PostgreSQL is mandatory for the coordinator database gate.');await exerciseQualification(await fixture(t,true));
  });
