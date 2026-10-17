import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { createCoordinatorHandler, createSqlStore, createGithubAuthenticator, createGithubApprovalValidator, createGithubResumeValidator, createFinancialAuthenticator } from '../supabase/functions/release-coordinator/index.ts';
import { digest, createNotificationChallenge, createNotificationDeliveryProof } from '../supabase/functions/release-coordinator/core.mjs';
import { assertIsolatedEnvironment, coordinatorDatabaseOptions, verifyDatabaseIdentity } from '../supabase/functions/release-coordinator/runtime.mjs';
import pg from 'pg';
import { X509Certificate } from 'node:crypto';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';

const H='a'.repeat(64), S='b'.repeat(40), REPO='hocheunglai-oss/fcos';
const policy={repository:REPO,repositoryId:'77',ref:'refs/heads/main',registrationJob:'prepare',approvalJobPrefix:'production / ',resumeJobPrefix:'execute / ',
  workflows:[{callerWorkflowRef:`${REPO}/.github/workflows/hosted-release.yml@refs/heads/main`,jobWorkflowRef:`${REPO}/.github/workflows/hosted-release-controller.yml@${S}`,jobWorkflowSha:S}]};
const owner={kind:'release',id:'features'};
const activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'legacy-production',disabled:true,proofHash:H}],uncertainties:[]};
const migration=await readFile(new URL('../supabase/migrations/20261016190509_release_coordination.sql',import.meta.url),'utf8');
const signing=await generateKeyPair('RS256'), jwk=await exportJWK(signing.publicKey); jwk.kid='test-key'; jwk.alg='RS256'; jwk.use='sig';
const jwks=createLocalJWKSet({keys:[jwk]});
const baseClaims={repository:REPO,repository_id:'77',ref:'refs/heads/main',ref_type:'branch',run_id:'101',run_attempt:'1',
  workflow_ref:policy.workflows[0].callerWorkflowRef,job_workflow_ref:policy.workflows[0].jobWorkflowRef,job_workflow_sha:S,
  sha:S,workflow_sha:S,event_name:'workflow_dispatch',runner_environment:'github-hosted',actor:'hocheunglai-oss',actor_id:'9'};
async function token(changes={}) { const c={...baseClaims,...changes}; return new SignJWT(c).setProtectedHeader({alg:'RS256',kid:'test-key'})
  .setIssuer('https://token.actions.githubusercontent.com').setAudience('fcos-release-coordinator')
  .setSubject(c.environment?`repo:${REPO}:environment:${c.environment}`:`repo:${REPO}:ref:refs/heads/main`).setJti(crypto.randomUUID())
  .setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('5m').sign(signing.privateKey); }
const manifest=(scope='release')=>({schemaVersion:1,epoch:1,executionMode:scope,stage:'application',authorization:{validitySeconds:86400,
  actions:['preview.create','production.stage','production.promote','production.rollback'],rollback:{mode:'compatible_previous_only'}},candidate:{sha:S}});
function approvalFixture(hash,registrationTime) {
  const registered=Date.parse(registrationTime), completed=new Date(registered+1000).toISOString(), started=new Date(registered+2000).toISOString();
  const actor={id:9,login:'hocheunglai-oss'},repo={id:77,full_name:REPO,default_branch:'main'};
  return {'':repo,'/branches/main':{name:'main',protected:true,commit:{sha:S}},
    '/branches/main/protection':{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},required_pull_request_reviews:{required_approving_review_count:1},required_status_checks:{strict:true,checks:['code-and-database','dependency-review','authenticated-browser'].map(context=>({context,app_id:15368}))}},
    '/environments/fcos-production-release':{id:81,name:'fcos-production-release',can_admins_bypass:false,deployment_branch_policy:{protected_branches:true,custom_branch_policies:false},
      protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:actor}]}]},
    '/actions/runs/101':{id:101,run_attempt:1,status:'in_progress',conclusion:null,event:'workflow_dispatch',repository:repo,head_repository:repo,
      head_sha:S,head_branch:'main',path:'.github/workflows/hosted-release.yml',actor,triggering_actor:actor},
    '/actions/runs/101/attempts/1/jobs?per_page=100':{total_count:2,jobs:[{id:201,name:'prepare',status:'completed',conclusion:'success',completed_at:completed,run_id:101,run_attempt:1,head_sha:S},
      {id:202,name:`production / ${hash}`,status:'in_progress',conclusion:null,started_at:started,run_id:101,run_attempt:1,head_sha:S}]},
    '/actions/runs/101/approvals':[{state:'approved',user:actor,environments:[{id:81,name:'fcos-production-release'}]}]};
}
async function qualifyDatabase(db,epoch=1) {
  const m={epoch,executionMode:'qualification',stage:'qualification'},scope={epoch,owner,releaseId:`qualification-${epoch}`,manifestHash:await digest(m)},p=await createGithubAuthenticator({policy,jwks})(await token({run_id:'100'}));
  const store=createSqlStore((sql,values)=>db.query(sql,values));
  await store.request('register',{...scope,manifest:m},p);
  const op={...scope,phase:'preview.create',operationId:`qualify-preview-${epoch}`,requestHash:H};
  await store.request('begin',op,p);
  await store.request('complete',{...op,evidence:{outcome:'applied',result:{id:'dpl_qualify'}},evidenceHash:H},p);
  for(const phase of ['qualification.stage','qualification.promote','qualification.rollback']) {
    const simulated={...scope,phase,operationId:`${phase}-${epoch}`,requestHash:H};
    await store.request('begin',simulated,p);
    await store.request('complete',{...simulated,evidence:{outcome:'applied',result:{simulated:true}},evidenceHash:H},p);
  }
  const evidence={key:'hosted.qualification',status:'passed',actualGithubArtifactValidated:true,artifactSha256:H},evidenceHash=await digest(evidence);
  await store.request('appendEvidence',{...scope,evidenceId:`qualification-proof-${epoch}`,evidence,evidenceHash},p);
  const challenge=(await db.query('select activation_evidence from fcos_release_coordination.epochs where epoch=$1',[epoch])).rows[0].activation_evidence.notificationChallenge;
  const notificationDelivery=await createNotificationDeliveryProof({challenge,receiptJson:JSON.stringify({...challenge,device:'iphone',confirmedByHuman:true,receivedAt:new Date().toISOString()})});
  return db.query('select fcos_release_coordination.activate($1,$2::jsonb)',[epoch,JSON.stringify({notificationDelivery,manifestHash:scope.manifestHash,evidenceHash,oldWriterFenceHash:H,allWritersAdmitted:true,writerAdmissions:[{id:'legacy-production',admitted:true,proofHash:H}]})]);
}
async function fixture(t,{activate=true,uncertainties=[]}={}) {
  const db=new PGlite(); t.after(()=>db.close()); await db.exec(migration);
  if(activate) {await db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[1,JSON.stringify({...activation,uncertainties})]);await qualifyDatabase(db);}
  const store=createSqlStore((sql,p)=>db.query(sql,p));
  let fixtureData, metadataReads=0;
  const fetchImpl=async(url,options)=>{
    assert.equal(options.method,'GET'); assert.equal(options.headers.authorization,'Bearer metadata-read-only');
    assert.equal(options.redirect,'error'); metadataReads++;
    if(url==='https://api.github.com/user') return Response.json({login:'hocheunglai-oss',id:9});
    const path=url.replace(`https://api.github.com/repos/${REPO}`,'');
    assert.ok(Object.hasOwn(fixtureData,path),`Unexpected GitHub API path: ${path}`);
    return Response.json(fixtureData[path]);
  };
  const authenticateGithub=createGithubAuthenticator({policy,jwks});
  const handler=createCoordinatorHandler({store,authenticateGithub,validateApproval:createGithubApprovalValidator({policy,token:'metadata-read-only',fetchImpl}),validateResume:createGithubResumeValidator({policy,token:'metadata-read-only',fetchImpl})});
  let authToken=await token();
  const fetchEndpoint=async(url,options)=>handler(new Request(url,options));
  const client=createCoordinatorClient({url:'http://localhost/coordinator',epoch:1,owner,tokenProvider:()=>authToken,fetch:fetchEndpoint});
  const m=manifest(), hash=await digest(m), scope={releaseId:'features-1',manifestHash:hash};
  const register=async(overrides={})=>client.register({...scope,manifest:m,...overrides});
  const approve=async()=>{
    const snap=await client.snapshot(scope); fixtureData=approvalFixture(hash,snap.registration.registered_at);
    authToken=await token({environment:'fcos-production-release'});
    return client.approve(scope);
  };
  return {db,store,client,scope,m,hash,register,approve,handler,authenticateGithub,setData:value=>{fixtureData=value;},setToken:value=>{authToken=value;},metadataReads:()=>metadataReads};
}
const begin=(f,phase='preview.create',operationId='op-preview')=>f.client.begin({...f.scope,phase,operationId,requestHash:H});
const complete=(f,phase='preview.create',operationId='op-preview',outcome='applied')=>f.client.complete({...f.scope,phase,operationId,evidence:{outcome,providerId:'dpl-fixture',sourceHash:H}});

test('real entrypoint serializes concurrent dispatch, survives runner loss, and releases only a confirmed operation',async t=>{
  const f=await fixture(t); await f.register();
  const starts=await Promise.all(Array.from({length:16},()=>begin(f)));
  assert.equal(starts.filter(s=>s.disposition==='execute').length,1);
  assert.equal(starts.filter(s=>s.disposition==='readback').length,15);
  await assert.rejects(f.client.finish({...f.scope,evidence:{status:'done'}}),/UNRESOLVED_OPERATION/);
  // An unrelated process loses memory; durable intent still prohibits another submission.
  const recovered=createCoordinatorClient({url:'http://localhost/coordinator',epoch:1,owner,tokenProvider:()=>token(),fetch:(url,options)=>f.handler(new Request(url,options))});
  assert.equal((await recovered.begin({...f.scope,phase:'preview.create',operationId:'op-preview',requestHash:H})).disposition,'readback');
  await f.client.uncertain({...f.scope,phase:'preview.create',operationId:'op-preview',evidence:{outcome:'unknown',reason:'runner_crashed'}});
  await assert.rejects(begin(f,'production.stage','op-stage'),/PRODUCTION_APPROVAL_REQUIRED/);
  await complete(f);
  assert.equal((await begin(f)).disposition,'complete');
  assert.equal((await f.client.snapshot(f.scope)).lock,null);
});

test('unknown provider writes keep global lock; readback cannot replay absent or applied intents',async t=>{
  const f=await fixture(t); await f.register(); await begin(f);
  await f.client.uncertain({...f.scope,phase:'preview.create',operationId:'op-preview',evidence:{outcome:'unknown'}});
  const m2={...manifest(),candidate:{sha:'c'.repeat(40)}}, h2=await digest(m2), s2={releaseId:'features-2',manifestHash:h2};
  await f.client.register({...s2,manifest:m2});
  assert.equal((await f.client.begin({...s2,phase:'preview.create',operationId:'op-other',requestHash:H})).disposition,'busy');
  await f.client.readback({...f.scope,phase:'preview.create',operationId:'op-preview',evidence:{outcome:'unknown',observed:'still ambiguous'}});
  assert.equal((await f.client.begin({...s2,phase:'preview.create',operationId:'op-other',requestHash:H})).disposition,'busy');
  await complete(f,'preview.create','op-preview','not_applied');
  assert.equal((await begin(f)).disposition,'complete');
  await assert.rejects(begin(f,'preview.create','new-id'),/OPERATION_CONFLICT/);
  assert.equal((await f.client.begin({...s2,phase:'preview.create',operationId:'op-other',requestHash:H})).disposition,'execute');
});

test('approval is independently read, bound to registered summary and 24h admission; finance can run between release phases',async t=>{
  const f=await fixture(t); await f.register(); await begin(f); await complete(f);
  await assert.rejects(begin(f,'production.stage','op-stage'),/PRODUCTION_APPROVAL_REQUIRED/);
  const approved=await f.approve(); assert.equal(f.metadataReads(),8);
  assert.equal(approved.approval.receipt.manifestHash,f.hash); assert.equal(approved.approval.receipt.reviewer,'hocheunglai-oss');
  assert.equal(Date.parse(approved.approval.expires_at)-Date.parse(approved.approval.admitted_at),86400000);
  assert.deepEqual((await f.client.approve(f.scope)).approval,approved.approval); assert.equal(f.metadataReads(),8);
  assert.equal((await begin(f,'production.stage','op-stage')).disposition,'execute'); await complete(f,'production.stage','op-stage');
  const financialOwner={kind:'financial',id:'xero-existing-owner'},financialPrincipal={kind:'financial',ownerId:'xero-existing-owner'};
  const fm={epoch:1,executionMode:'financial',fingerprint:H},fs={epoch:1,owner:financialOwner,releaseId:'finance-1',manifestHash:await digest(fm)};
  await f.store.request('register',{...fs,manifest:fm},financialPrincipal);
  assert.equal((await f.store.request('begin',{...fs,phase:'financial.link',operationId:'finance-op',requestHash:H},financialPrincipal)).disposition,'execute');
  assert.equal((await begin(f,'production.promote','op-promote')).disposition,'busy');
  await f.store.request('complete',{...fs,phase:'financial.link',operationId:'finance-op',evidence:{outcome:'applied'},evidenceHash:H},financialPrincipal);
  assert.equal((await begin(f,'production.promote','op-promote')).disposition,'execute');
});

test('append-only manifests, operations, events, checks and authorization cannot be rewritten or truncated',async t=>{
  const f=await fixture(t); await f.register(); await begin(f); await complete(f); await f.approve();
  await f.client.appendEvidence({...f.scope,evidenceId:'e-1',evidence:{key:'preview.tests',passed:true,hash:H}});
  await f.client.appendEvidence({...f.scope,evidenceId:'e-1',evidence:{key:'preview.tests',passed:true,hash:H}});
  await assert.rejects(f.client.appendEvidence({...f.scope,evidenceId:'e-1',evidence:{key:'preview.tests',passed:false}}),/EVIDENCE_CONFLICT/);
  await f.client.appendEvidence({...f.scope,key:'volatile.check',evidence:{passed:true,observation:1}});
  await f.client.appendEvidence({...f.scope,key:'volatile.check',evidence:{passed:true,observation:2}});
  const snap=await f.client.snapshot(f.scope); assert.equal(snap.operations['preview.create'].state,'complete'); assert.equal(snap.checks['preview.tests'].passed,true); assert.equal(snap.checks['volatile.check'].observation,2); assert.equal(snap.evidence.length,3);
  for(const table of ['registrations','operations','operation_events','evidence','authorizations','approval_admissions','registration_runs','resume_admissions']) {
    await assert.rejects(f.db.exec(`delete from fcos_release_coordination.${table}`),/APPEND_ONLY/);
    await assert.rejects(f.db.exec(`truncate fcos_release_coordination.${table} cascade`),/APPEND_ONLY/);
  }
  await assert.rejects(f.register({manifest:{...f.m,stage:'compatibility'}}),/MANIFEST_HASH_MISMATCH/);
  await f.setToken(await token());
  const newManifest={...f.m,stage:'compatibility'};
  await assert.rejects(f.register({manifest:newManifest,manifestHash:await digest(newManifest)}),/MANIFEST_CONFLICT/);
  await f.client.finish({...f.scope,evidence:{result:'complete'}});
  await assert.rejects(begin(f,'production.stage','later'),/RELEASE_FINISHED/);
});

test('activation requires fencing and uncertainty import; stale epochs fail and no runtime role can activate or read tables',async t=>{
  const f=await fixture(t,{activate:false}); await assert.rejects(f.register(),/INACTIVE/);
  for(const invalid of [{}, {...activation,writers:[]},{...activation,writers:[{id:'writer',disabled:false,proofHash:H}]}]) {
    await assert.rejects(f.db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[1,JSON.stringify(invalid)]),/ACTIVATION_EVIDENCE_REQUIRED|OLD_WRITER_NOT_FENCED/);
  }
  const uncertainty={operationId:'old-unknown',evidenceHash:H,reason:'lost old runner'};
  await f.db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[1,JSON.stringify({...activation,uncertainties:[uncertainty]})]);
  await f.register(); await assert.rejects(begin(f),/QUALIFICATION_ONLY/);
  const qm={epoch:1,executionMode:'qualification'},qs={epoch:1,owner,releaseId:'import-blocked-qual',manifestHash:await digest(qm)};
  await f.client.register({...qs,manifest:qm});
  assert.equal((await f.client.begin({...qs,phase:'preview.create',operationId:'blocked',requestHash:H})).disposition,'busy');
  await assert.rejects(f.db.query('select fcos_release_coordination.resolve_import($1,$2::jsonb)',['old-unknown',JSON.stringify({outcome:'unknown',evidenceHash:H})]),/DEFINITIVE_READBACK_REQUIRED/);
  await f.db.query('select fcos_release_coordination.resolve_import($1,$2::jsonb)',['old-unknown',JSON.stringify({outcome:'not_applied',evidenceHash:H})]);
  await qualifyDatabase(f.db);
  assert.equal((await begin(f)).disposition,'execute'); await complete(f);
  await f.db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[2,JSON.stringify({...activation,notificationChallenge:createNotificationChallenge()})]);
  await assert.rejects(f.client.snapshot(f.scope),/STALE_EPOCH/);
  await f.db.exec('set role fcos_coordinator_runtime');
  await assert.rejects(f.db.exec('select * from fcos_release_coordination.registrations'),/permission denied/);
  await assert.rejects(f.db.query('select fcos_release_coordination.activate($1,$2::jsonb)',[3,JSON.stringify(activation)]),/permission denied/);
  await assert.rejects(f.db.exec('create table fcos_release_coordination.illegal(x int)'),/permission denied/);
  await f.db.exec('reset role');
});

test('qualification cannot acquire Production authority and request scopes cannot inject approval',async t=>{
  const f=await fixture(t),m=manifest('qualification'),scope={releaseId:'qualify',manifestHash:await digest(m)};
  await f.client.register({...scope,manifest:m});
  await assert.rejects(f.client.begin({...scope,phase:'production.stage',operationId:'forbidden',requestHash:H}),/PRODUCTION_APPROVAL_REQUIRED/);
  await assert.rejects(f.client.request('approve',{...scope,approvalReceipt:{approved:true}}),/SERVER_FIELD_FORBIDDEN/);
  await assert.rejects(f.client.snapshot({...scope,manifestHash:'f'.repeat(64)}),/SCOPE_MISMATCH/);
});

test('approval metadata rejection remains fail closed with durable admission but no authorization',async t=>{
  const f=await fixture(t);await f.register(); const snap=await f.client.snapshot(f.scope);
  const good=approvalFixture(f.hash,snap.registration.registered_at); await f.setToken(await token({environment:'fcos-production-release'}));
  for(const mutate of [d=>{d['/environments/fcos-production-release'].can_admins_bypass=true;},
    d=>{d['/actions/runs/101/approvals'].push(d['/actions/runs/101/approvals'][0]);},
    d=>{d['/actions/runs/101/attempts/1/jobs?per_page=100'].jobs[1].name='production / another-hash';},
    d=>{d['/branches/main/protection'].enforce_admins.enabled=false;},
    d=>{d['/actions/runs/101'].actor.login='other';}]) {
    const data=structuredClone(good);mutate(data);f.setData(data);await assert.rejects(f.client.approve(f.scope),/COORDINATION_/);
    assert.equal((await f.client.snapshot(f.scope)).approval,null);
  }
  assert.equal((await f.db.query('select count(*)::int as n from fcos_release_coordination.approval_admissions')).rows[0].n,1);
});

test('cryptographic OIDC pins repository, reusable source, ref, attempt, audience and signature',async()=>{
  const auth=createGithubAuthenticator({policy,jwks});assert.equal((await auth(await token())).runId,'101');
  for(const change of [{repository_id:'78'},{repository:'other/fcos'},{ref:'refs/heads/other'},{job_workflow_sha:'c'.repeat(40)},
    {job_workflow_ref:`${REPO}/.github/workflows/hosted-release-controller.yml@refs/heads/main`},{run_attempt:'2'},{event_name:'pull_request'},
    {workflow_ref:`other/fcos/.github/workflows/hosted-release.yml@refs/heads/main`},{runner_environment:'self-hosted'}]) {
    await assert.rejects(auth(await token(change)),/IDENTITY_INVALID/);
  }
  const foreign=await generateKeyPair('RS256');
  const forged=await new SignJWT(baseClaims).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://token.actions.githubusercontent.com')
    .setAudience('fcos-release-coordinator').setIssuedAt().setExpirationTime('5m').sign(foreign.privateKey);
  await assert.rejects(auth(forged),/IDENTITY_INVALID/);
});

test('financial adapter uses an independent signature, exact owner, and denies any provider authority',async()=>{
  const pair=await generateKeyPair('ES256'),key=await exportJWK(pair.publicKey);key.kid='finance';
  const auth=createFinancialAuthenticator({policy:{issuer:'https://finance.example.invalid',jwksUrl:'https://finance.example.invalid/jwks',audience:'fcos-financial-coordination',owners:['xero']},jwks:createLocalJWKSet({keys:[key]})});
  const sign=authority=>new SignJWT({owner_id:'xero',coordination_only:true,provider_authority:authority}).setProtectedHeader({alg:'ES256',kid:'finance'})
    .setIssuer('https://finance.example.invalid').setAudience('fcos-financial-coordination').setSubject('fcos-financial:xero')
    .setJti('finance-1').setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime('4m').sign(pair.privateKey);
  assert.equal((await auth(await sign(false))).providerAuthorityGranted,false);
  await assert.rejects(auth(await sign(true)),/FINANCIAL_IDENTITY_INVALID/);
  await assert.rejects(auth(await token()),/FINANCIAL_IDENTITY_INVALID/);
});

test('client never retries an uncertain transport response',async()=>{
  let calls=0;const client=createCoordinatorClient({url:'http://localhost/coordinator',epoch:1,owner,tokenProvider:()=>token(),fetch:async()=>{calls++;throw new Error('disconnected');}});
  await assert.rejects(client.begin({releaseId:'one',manifestHash:H,phase:'preview.create',operationId:'op',requestHash:H}),/RESPONSE_UNKNOWN/);
  assert.equal(calls,1);
});


test('approval expiry comes from first admission and cannot be renewed by repeated validation',async t=>{
  const f=await fixture(t);await f.register();
  const principal=await f.authenticateGithub(await token({environment:'fcos-production-release'}));
  await f.db.query(`insert into fcos_release_coordination.approval_admissions(release_id,run_id,run_attempt,actor,observed_at) values($1,'101','1',$2::jsonb,clock_timestamp()-interval '25 hours')`,[f.scope.releaseId,JSON.stringify(principal)]);
  await assert.rejects(f.approve(),/APPROVAL_EXPIRED/);
  await assert.rejects(f.client.approve(f.scope),/APPROVAL_EXPIRED/);
  await assert.rejects(begin(f,'production.stage','expired-op'),/PRODUCTION_APPROVAL_REQUIRED/);
});

test('lost HTTP response after committed begin requires readback after restart',async t=>{
  const f=await fixture(t);await f.register();let requests=0;
  const lost=createCoordinatorClient({url:'http://localhost/coordinator',epoch:1,owner,tokenProvider:()=>token(),fetch:async(url,options)=>{
    requests++;await f.handler(new Request(url,options));throw new Error('runner lost response');
  }});
  await assert.rejects(lost.begin({...f.scope,phase:'preview.create',operationId:'op-preview',requestHash:H}),/RESPONSE_UNKNOWN/);
  assert.equal(requests,1);assert.equal((await begin(f)).disposition,'readback');
});

test('isolated host refuses automatically injected Supabase and provider secrets or wrong DB target',()=>{
  const env={FCOS_COORDINATOR_DATABASE_URL:'postgresql://fcos_coordinator_runtime:fixture@db.pjforfvchygdyqfcgpmw.supabase.co/postgres?sslmode=verify-full',FCOS_COORDINATOR_GITHUB_METADATA_TOKEN:'read-only'};
  assert.equal(assertIsolatedEnvironment(env),env.FCOS_COORDINATOR_DATABASE_URL);
  for(const name of ['SUPABASE_DB_URL','SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY','GH_TOKEN','VERCEL_TOKEN','XERO_REFRESH_TOKEN','AWS_SECRET_ACCESS_KEY']) {
    assert.throws(()=>assertIsolatedEnvironment({...env,[name]:'fixture'}),/BROAD_CREDENTIAL_FORBIDDEN/);
  }
  assert.throws(()=>assertIsolatedEnvironment({...env,FCOS_COORDINATOR_DATABASE_URL:env.FCOS_COORDINATOR_DATABASE_URL.replace('pjforfvchygdyqfcgpmw','other')}),/DATABASE_ROLE_INVALID/);
});

test('isolated database transport binds direct or observed session pooler, role, project and verified TLS',()=>{
  const direct='postgresql://fcos_coordinator_runtime:fixture%3A%40@db.pjforfvchygdyqfcgpmw.supabase.co/postgres?sslmode=verify-full';
  const pooled='postgresql://fcos_coordinator_runtime.pjforfvchygdyqfcgpmw:fixture%3A%40@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
  for(const url of [direct,pooled]) {
    const options=coordinatorDatabaseOptions({FCOS_COORDINATOR_DATABASE_URL:url});
    const actual=new pg.Client(options).connectionParameters;
    assert.equal(actual.host,new URL(url).hostname);assert.equal(actual.port,5432);
    assert.equal(actual.user,decodeURIComponent(new URL(url).username));assert.equal(actual.password,'fixture:@');
    assert.equal(actual.database,'postgres');assert.equal(actual.ssl.rejectUnauthorized,true);
    assert.equal(actual.ssl.servername,actual.host);assert.equal(options.connectionString,undefined);
    assert.equal(new X509Certificate(actual.ssl.ca).fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  }
  const invalid=[
    direct.replace('postgresql:','postgres:'),direct.replace('/postgres?','/other?'),direct.replace(':fixture%3A%40',''),
    direct.replace('fcos_coordinator_runtime:','postgres:'),direct.replace('.supabase.co/','.supabase.co:6543/'),
    pooled.replace('aws-0-','aws-1-'),pooled.replace('runtime.pjforfvchygdyqfcgpmw','runtime.other'),
    pooled.replace('runtime.pjforfvchygdyqfcgpmw','runtime'),pooled.replace(':5432/',':6543/'),
    direct+'#fragment',direct.replace('verify-full','require'),direct.replace('verify-full','disable'),
    ...['host=example.invalid','user=postgres','password=other','port=6543','dbname=other','options=-c%20role%3Dpostgres',
      'sslmode=no-verify','sslmode=verify-full','ssl=false','sslrootcert=/tmp/ca','sslcert=/tmp/key','hostaddr=127.0.0.1',
      'application_name=unexpected','%68ost=example.invalid'].map(query=>direct+'&'+query),
  ];
  for(const url of invalid) assert.throws(()=>coordinatorDatabaseOptions({FCOS_COORDINATOR_DATABASE_URL:url}),/DATABASE_ROLE_INVALID/);
});

test('database startup rejects SET ROLE impersonation, another database and broad privileges',async()=>{
  const valid={identity:'fcos_coordinator_runtime',login_identity:'fcos_coordinator_runtime',database_name:'postgres',
    rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false,memberships:false,application_access:false,external_definer_access:false};
  assert.equal(await verifyDatabaseIdentity(async()=>({rows:[valid]})),true);
  for(const changed of [{login_identity:'postgres'},{identity:'postgres'},{database_name:'other'},
    ...['rolsuper','rolcreaterole','rolcreatedb','rolbypassrls','memberships','application_access','external_definer_access'].map(k=>({[k]:true}))]) {
    await assert.rejects(verifyDatabaseIdentity(async()=>({rows:[{...valid,...changed}]})),/DATABASE_PRIVILEGES_INVALID/);
  }
});

test('main may move during approval; a distinct registered run resumes the immutable manifest without renewing approval',async t=>{
  const f=await fixture(t);await f.register();const first=await f.client.snapshot(f.scope);
  const initial=approvalFixture(f.hash,first.registrationRun.registered_at);initial['/branches/main'].commit.sha='c'.repeat(40);
  f.setData(initial);f.setToken(await token({environment:'fcos-production-release'}));
  const approval=await f.client.approve(f.scope);
  await begin(f,'production.stage','original-stage');
  await f.client.uncertain({...f.scope,phase:'production.stage',operationId:'original-stage',reason:'runner lost after submit'});
  const nextSha='d'.repeat(40);f.setToken(await token({run_id:'102',sha:nextSha,workflow_sha:nextSha}));
  await f.register();const next=await f.client.snapshot(f.scope);
  assert.equal(next.registration.registration_actor.runId,'101');assert.equal(next.registrationRun.run_id,'102');
  const data=approvalFixture(f.hash,next.registrationRun.registered_at),resumed={};
  for(const [key,value] of Object.entries(data)) resumed[key.replace('/101','/102')]=value;
  resumed['/branches/main'].commit.sha='e'.repeat(40);
  resumed['/actions/runs/102'].id=102;resumed['/actions/runs/102'].head_sha=nextSha;
  for(const job of resumed['/actions/runs/102/attempts/1/jobs?per_page=100'].jobs){job.run_id=102;job.head_sha=nextSha;if(job.name.startsWith('production / '))job.name=`execute / ${f.hash}`;}
  resumed['/environments/fcos-hosted-production-resume']={...resumed['/environments/fcos-production-release'],id:82,name:'fcos-hosted-production-resume',protection_rules:[]};
  delete resumed['/environments/fcos-production-release'];delete resumed['/actions/runs/102/approvals'];
  f.setData(resumed);f.setToken(await token({run_id:'102',sha:nextSha,workflow_sha:nextSha,environment:'fcos-hosted-production-resume'}));
  await assert.rejects(f.client.approve(f.scope),/APPROVAL_ENVIRONMENT_REQUIRED/);
  await assert.rejects(begin(f,'production.promote','resumed-promote'),/PRODUCTION_APPROVAL_REQUIRED/);
  const recovered=await f.client.resume(f.scope);assert.equal(recovered.expiresAt,approval.expiresAt);assert.equal(recovered.manifestHash,f.hash);
  assert.equal((await begin(f,'production.stage','original-stage')).disposition,'readback');
  await f.client.readback({...f.scope,phase:'production.stage',operationId:'original-stage',evidence:{outcome:'applied',result:{id:'dpl_original'}}});
  assert.equal((await begin(f,'production.promote','resumed-promote')).disposition,'execute');
  assert.equal((await f.client.snapshot(f.scope)).approval.expires_at,approval.expiresAt);
  assert.equal((await f.db.query('select count(*)::int as n from fcos_release_coordination.authorizations')).rows[0].n,1);
  assert.equal((await f.db.query('select count(*)::int as n from fcos_release_coordination.resume_admissions')).rows[0].n,1);
});

test('resume cannot create authority or renew an expired receipt; existing intents remain GET-only recoverable',async t=>{
  const f=await fixture(t);await f.register();f.setToken(await token({environment:'fcos-hosted-production-resume'}));
  await assert.rejects(f.client.resume(f.scope),/RESUME_FORBIDDEN/);
  await assert.rejects(f.client.approve(f.scope),/APPROVAL_ENVIRONMENT_REQUIRED/);
  f.setToken(await token());await begin(f);
  await f.db.query(`insert into fcos_release_coordination.authorizations(release_id,run_id,run_attempt,approved_job_id,manifest_hash,epoch,receipt,admitted_at,expires_at)
    values($1,'101','1',202,$2,1,$3::jsonb,statement_timestamp()-interval '25 hours',statement_timestamp()-interval '1 hour')`,[f.scope.releaseId,f.hash,JSON.stringify({manifestHash:f.hash,runId:'101'})]);
  f.setToken(await token({environment:'fcos-hosted-production-resume'}));
  await assert.rejects(f.client.resume(f.scope),/RESUME_FORBIDDEN/);
  assert.equal((await begin(f)).disposition,'readback');
  await f.client.readback({...f.scope,phase:'preview.create',operationId:'op-preview',evidence:{outcome:'not_applied'}});
  await assert.rejects(begin(f,'production.stage','expired-write'),/PRODUCTION_APPROVAL_REQUIRED/);
});

test('qualification simulation phases share durable intents but can never authorize real Production',async t=>{
  const f=await fixture(t);await f.register();
  await assert.rejects(begin(f,'qualification.stage','forbidden-simulation'),/QUALIFICATION_SIMULATION_ONLY/);
  const qm={...manifest('qualification'),stage:'qualification'},qs={releaseId:'qualification-sim',manifestHash:await digest(qm)};
  await f.client.register({...qs,manifest:qm});
  const op={...qs,phase:'qualification.stage',operationId:'simulated-stage',requestHash:H};
  assert.equal((await f.client.begin(op)).disposition,'execute');
  await f.client.uncertain({...op,reason:'simulated lost response'});assert.equal((await f.client.begin(op)).disposition,'readback');
  await f.client.readback({...op,evidence:{outcome:'applied',result:{simulated:true}}});
  assert.equal((await f.client.begin(op)).disposition,'complete');
  await assert.rejects(f.client.begin({...qs,phase:'production.stage',operationId:'must-not-deploy',requestHash:H}),/PRODUCTION_APPROVAL_REQUIRED/);
  f.setToken(await token({environment:'fcos-production-release'}));
  await assert.rejects(f.client.begin({...qs,phase:'qualification.rollback',operationId:'no-prod-simulation',requestHash:H}),/QUALIFICATION_SIMULATION_ONLY/);
});

test('approval-only gate hands the same-run executor its original immutable receipt without another review',async t=>{
  const f=await fixture(t);await f.register();const original=await f.approve();const snapshot=await f.client.snapshot(f.scope);
  const data=approvalFixture(f.hash,snapshot.registrationRun.registered_at),jobs=data['/actions/runs/101/attempts/1/jobs?per_page=100'];
  const gate=jobs.jobs[1];gate.status='completed';gate.conclusion='success';gate.completed_at=gate.started_at;
  jobs.jobs.push({...gate,id:203,name:`execute / ${f.hash}`,status:'in_progress',conclusion:null,completed_at:null});jobs.total_count=3;
  data['/environments/fcos-hosted-production-resume']={...data['/environments/fcos-production-release'],id:82,name:'fcos-hosted-production-resume',protection_rules:[]};
  delete data['/environments/fcos-production-release'];delete data['/actions/runs/101/approvals'];f.setData(data);
  f.setToken(await token({environment:'fcos-hosted-production-resume'}));
  const resumed=await f.client.resume(f.scope);assert.equal(resumed.expiresAt,original.expiresAt);
  assert.equal((await begin(f,'production.stage','same-run-stage')).disposition,'execute');
  assert.equal((await f.db.query('select count(*)::int as n from fcos_release_coordination.authorizations')).rows[0].n,1);
});


test('explicit later human review appends a session and old resume admission cannot authorize the new session',async t=>{
  const f=await fixture(t);await f.register();
  const oldReceipt={manifestHash:f.hash,epoch:1,runId:'101',runAttempt:'1',approvedJobId:202,protectedJobStartedAt:new Date(Date.now()-26*3600000).toISOString()};
  await f.db.query(`insert into fcos_release_coordination.authorizations(release_id,run_id,run_attempt,approved_job_id,manifest_hash,epoch,receipt,admitted_at,expires_at)
    values($1,'101','1',202,$2,1,$3,statement_timestamp()-interval '25 hours',statement_timestamp()-interval '1 hour')`,[f.scope.releaseId,f.hash,JSON.stringify(oldReceipt)]);
  const original=(await f.client.snapshot(f.scope)).approval;
  f.setToken(await token({environment:'fcos-production-release'}));await assert.rejects(f.client.approve(f.scope),/RENEWAL_NEW_RUN_REQUIRED/);
  const nextSha='d'.repeat(40);f.setToken(await token({run_id:'102',sha:nextSha,workflow_sha:nextSha}));await f.register();
  const next=await f.client.snapshot(f.scope),data=approvalFixture(f.hash,next.registrationRun.registered_at),renewal={};
  for(const [key,value]of Object.entries(data))renewal[key.replace('/101','/102')]=value;
  renewal['/actions/runs/102'].id=102;renewal['/actions/runs/102'].head_sha=nextSha;
  for(const job of renewal['/actions/runs/102/attempts/1/jobs?per_page=100'].jobs){job.id+=100;job.run_id=102;job.head_sha=nextSha;}
  const productionToken=await token({run_id:'102',sha:nextSha,workflow_sha:nextSha,environment:'fcos-production-release'});
  f.setData(renewal);f.setToken(productionToken);
  const principal=await f.authenticateGithub(productionToken),payload={...f.scope,epoch:1,owner};
  await f.store.request('admitApproval',payload,principal);
  await assert.rejects(f.store.request('approve',{...payload,approvalReceipt:{...oldReceipt,runId:'102',approvedJobId:302}},principal),/APPROVAL_INVALID/);
  renewal['/actions/runs/102/approvals'][0].state='rejected';await assert.rejects(f.client.approve(f.scope),/APPROVAL_AMBIGUOUS/);
  assert.equal((await f.client.snapshot(f.scope)).approvalHistory.length,1);
  renewal['/actions/runs/102/approvals'][0].state='approved';const approved=await f.client.approve(f.scope),latest=(await f.client.snapshot(f.scope)).approval;
  assert.equal(latest.run_id,'102');assert.notEqual(latest.authorization_event_id,original.authorization_event_id);
  assert.equal(Date.parse(latest.expires_at)-Date.parse(latest.admitted_at),86400000);
  assert.equal((await f.client.approve(f.scope)).expiresAt,approved.expiresAt);
  const history=(await f.client.snapshot(f.scope)).approvalHistory;assert.equal(history.length,2);assert.deepEqual(history[0],original);
  // A stale admission for this run, bound to the previous session, grants no new write.
  await f.db.query("insert into fcos_release_coordination.resume_admissions(release_id,run_id,authorization_event_id,receipt) values($1,'102',$2,'{}')",[f.scope.releaseId,original.authorization_event_id]);
  const jobs=renewal['/actions/runs/102/attempts/1/jobs?per_page=100'];jobs.jobs[1].name=`execute / ${f.hash}`;
  renewal['/environments/fcos-hosted-production-resume']={...renewal['/environments/fcos-production-release'],id:82,name:'fcos-hosted-production-resume',protection_rules:[]};
  f.setToken(await token({run_id:'102',sha:nextSha,workflow_sha:nextSha,environment:'fcos-hosted-production-resume'}));
  await assert.rejects(begin(f,'production.promote','renewed-promote'),/PRODUCTION_APPROVAL_REQUIRED/);
  assert.equal((await f.client.resume(f.scope)).expiresAt,approved.expiresAt);
  assert.equal((await begin(f,'production.promote','renewed-promote')).disposition,'execute');
  const resumeRows=(await f.db.query('select authorization_event_id from fcos_release_coordination.resume_admissions order by authorization_event_id')).rows;
  assert.deepEqual(resumeRows.map(row=>row.authorization_event_id),[original.authorization_event_id,latest.authorization_event_id]);
});


test('one-time notification setup is integrity-bound, canonical, non-refreshing and cannot be installed by runtime fields',async t=>{
  const challenge=createNotificationChallenge(),receiptJson=JSON.stringify({...challenge,device:'iphone',confirmedByHuman:true,receivedAt:new Date().toISOString()});
  const proof=await createNotificationDeliveryProof({receiptJson,challenge});
  assert.deepEqual(await createNotificationDeliveryProof({receiptJson,challenge}),proof);
  for(const patch of [{operator:'other'},{repository:'other/fcos'},{challenge:H},{device:'android'},{confirmedByHuman:'true'},
    {receivedAt:new Date(Date.now()+3600000).toISOString()}]){
    await assert.rejects(createNotificationDeliveryProof({receiptJson:JSON.stringify({...JSON.parse(receiptJson),...patch}),challenge}),/NOTIFICATION_DELIVERY_REQUIRED/);
  }
  await assert.rejects(createNotificationDeliveryProof({receiptJson,challenge:{...challenge,operator:'other'}}),/NOTIFICATION_CHALLENGE_REQUIRED/);
  const f=await fixture(t,{activate:false});
  await assert.rejects(f.db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[1,JSON.stringify({...activation,notificationChallenge:undefined})]),/NOTIFICATION_CHALLENGE_REQUIRED/);
  await f.db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[1,JSON.stringify({...activation,notificationChallenge:challenge})]);
  await assert.rejects(f.db.query('select fcos_release_coordination.install_epoch($1,$2::jsonb)',[2,JSON.stringify({...activation,notificationChallenge:challenge})]),/NOTIFICATION_CHALLENGE_REUSED/);
});
