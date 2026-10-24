import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {preservationPreflight} from '../scripts/hosted-preservation-preflight.mjs';
import {sealPreservationMembership,openPreservationMembership} from '../scripts/lib/hosted-release/preservation-preflight.mjs';
import {dependencyHash} from '../scripts/lib/hosted-release/dependencies.mjs';
import {releaseTargets,FROZEN_COMPATIBILITY_SHA,validateManifest} from '../scripts/lib/hosted-release/contract.mjs';
import {loadDependencySetup} from '../scripts/lib/hosted-release/dependency-publisher.mjs';

const H='a'.repeat(64),B='b'.repeat(40),time=Date.now(),template=readFileSync(new URL('../.github/qualification/hosted-release-bootstrap.yml',import.meta.url),'utf8');
function fixture(t,{duplicate=false}={}) {
  const directory=mkdtempSync(join(tmpdir(),'preservation-preflight-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'.github/qualification'),{recursive:true});writeFileSync(join(directory,'.github/qualification/hosted-release-bootstrap.yml'),template);
  const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','controller']);const C=git(['rev-parse','HEAD']),targets=releaseTargets();
  const rows=[{id:'PRIVATE_MEMBERSHIP_ID',amount:'PRIVATE_FINANCIAL_VALUE'}],membership={schemaVersion:1,kind:'fcos_release_preservation_membership',project:targets.supabaseProject,
    tables:[{table:'invoices',keyColumn:'id',keys:duplicate?['PRIVATE_MEMBERSHIP_ID','PRIVATE_MEMBERSHIP_ID']:['PRIVATE_MEMBERSHIP_ID'],expectedRowsSha256:dependencyHash(rows)}]};
  const bytes=Buffer.from(JSON.stringify(membership)),connection=`postgresql://fcos_release_observer:PRIVATE_DATABASE@db.${targets.supabaseProject}.supabase.co/postgres?sslmode=verify-full`;
  const encryption={candidateSha:FROZEN_COMPATIBILITY_SHA,project:targets.supabaseProject,membershipSha256:dependencyHash(bytes),connection};
  const encrypted=sealPreservationMembership(bytes,encryption),envelopeSha256=dependencyHash(encrypted);
  const source={ref:'refs/heads/codex/preservation-fixture',bootstrapSha:B,controllerSha:C,candidateSha:FROZEN_COMPATIBILITY_SHA,callerWorkflowRef:`${targets.repository}/.github/workflows/authenticated-release.yml@refs/heads/codex/preservation-fixture`};
  const setup={schemaVersion:1,kind:'fcos_preservation_preflight_setup_v1',discoveryOnly:true,controllerSha:C,candidateSha:FROZEN_COMPATIBILITY_SHA,targets,qualificationSource:source,
    environment:'fcos-hosted-dependency-verification',issuedAt:time-1000,notAfter:time+60000,membership:{fileSha256:encryption.membershipSha256,envelopeSha256,path:`.github/qualification/preservation/${envelopeSha256}.json`}};
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:targets.repository,GITHUB_REPOSITORY_ID:'1278654816',GITHUB_REF:source.ref,GITHUB_REF_PROTECTED:'true',GITHUB_SHA:B,GITHUB_WORKFLOW_REF:source.callerWorkflowRef,GITHUB_WORKFLOW_SHA:B,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'17',GITHUB_ACTOR:'hocheunglai-oss',GITHUB_ACTOR_ID:'12345',GITHUB_JOB:'preservation_preflight',
    FCOS_CONTROLLER_SHA:C,FCOS_CANDIDATE_SHA:FROZEN_COMPATIBILITY_SHA,FCOS_CONTROLLER_DIRECTORY:directory,FCOS_CANDIDATE_DIRECTORY:join(directory,'not-executed'),FCOS_HOSTED_ENVIRONMENT:setup.environment,
    FCOS_SETUP_DISCOVERY_BOOTSTRAP:'true',FCOS_HOSTED_PRESERVATION_PREFLIGHT_ADMITTED:'true',FCOS_ADMITTED_PRESERVATION_PREFLIGHT:JSON.stringify(setup),FCOS_ADMITTED_PRESERVATION_PREFLIGHT_SHA256:dependencyHash(setup),
    FCOS_HOSTED_GITHUB_READ_TOKEN:'PRIVATE_GITHUB_READER',FCOS_HOSTED_PRESERVATION_DATABASE_URL:connection,FCOS_PRESERVATION_PREFLIGHT_OUTPUT:join(directory,'public-result.json'),GITHUB_OUTPUT:join(directory,'never-workflow-output')};
  const run={id:17,repository:{full_name:targets.repository,id:1278654816},head_repository:{full_name:targets.repository},head_branch:source.ref.slice(11),head_sha:B,path:'.github/workflows/authenticated-release.yml',event:'workflow_dispatch',run_attempt:1,status:'in_progress',conclusion:null,actor:{login:env.GITHUB_ACTOR,id:12345},triggering_actor:{login:env.GITHUB_ACTOR,id:12345}};
  const job={id:18,run_id:17,run_attempt:1,head_sha:B,name:'Preservation preflight',status:'in_progress',conclusion:null,started_at:new Date(time-1000).toISOString(),steps:[{name:'Observe preservation without release authority',status:'in_progress',conclusion:null}]};
  const protection={enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}},calls=[],sql=[];
  const github={identity:async()=>{calls.push('identity');},read:async path=>{calls.push(path);
    if(path.endsWith('/actions/runs/17'))return run;if(path.endsWith('/attempts/1/jobs?per_page=100'))return {total_count:1,jobs:[job]};
    if(path.endsWith('/protection'))return protection;if(path.includes('/branches/'))return {name:source.ref.slice(11),protected:true,commit:{sha:B}};
    if(path.includes('/contents/.github/workflows/'))return {type:'file',path:'.github/workflows/authenticated-release.yml',encoding:'base64',content:Buffer.from(template.replaceAll('__FCOS_CONTROLLER_SHA__',C)).toString('base64')};
    if(path.includes('/contents/'+setup.membership.path))return {type:'file',path:setup.membership.path,encoding:'base64',content:encrypted.toString('base64')};assert.fail('Unexpected GitHub GET '+path);
  }};
  const identity={role:'fcos_release_observer',database:'postgres',rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false,memberships:false,table_writes:false,definer_access:false};
  class Client {constructor(c){assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.options,'-c default_transaction_read_only=on -c search_path=pg_catalog');}async connect(){sql.push('connect');}async query(query,parameters){sql.push(query);if(query.startsWith('select current_user'))return {rows:[identity]};if(query.startsWith('select to_jsonb')){assert.deepEqual(parameters,[['PRIVATE_MEMBERSHIP_ID']]);return {rows:rows.map(row=>({row}))};}return {rows:[]};}async end(){sql.push('end');}}
  const collectSource=()=>({candidate:{sha:FROZEN_COMPATIBILITY_SHA,sourceProfile:'frozen_04ee',sourceSha256:H},controller:{sha:C}});
  return {directory,setup,env,run,job,protection,calls,sql,identity,rows,bytes,encrypted,encryption,github,Client,options:{env,now:()=>time,createGithub:()=>github,collectSource,Client}};
}
test('actual preflight admits live source/job, decrypts only in memory and reuses SELECT-only preservation without a manifest',async t=>{
  const f=fixture(t),r=await preservationPreflight(f.options);assert.equal(r.status,'observed',JSON.stringify(r.failures));assert.equal(r.discoveryOnly,true);assert.equal(r.releaseEvidenceAccepted,false);assert.equal(r.observation.rowCount,1);assert.equal(r.observation.fullKeyedRowsUnchanged,true);
  assert.ok(f.sql.includes('begin isolation level repeatable read read only'));assert.equal(f.sql.at(-1),'end');assert.ok(f.sql.every(q=>q==='connect'||q==='end'||q==='commit'||q==='rollback'||q.startsWith('select ')||q==='begin isolation level repeatable read read only'));
  assert.doesNotMatch(readFileSync(f.env.FCOS_PRESERVATION_PREFLIGHT_OUTPUT,'utf8'),/PRIVATE_|manifestHash|checkId|fcos_hosted_dependency_raw/);assert.equal(existsSync(f.env.GITHUB_OUTPUT),false);assert.throws(()=>validateManifest(r));
});
test('early admission requires exact running step and exposes no private input or candidate source',async t=>{
  const f=fixture(t);f.job.steps[0].name='Admit preservation preflight before candidate checkout';delete f.env.FCOS_HOSTED_PRESERVATION_DATABASE_URL;
  const r=await preservationPreflight({...f.options,validateDispatchOnly:true,collectSource:()=>assert.fail('no source yet'),Client:class {constructor(){assert.fail('no DB');}}});assert.equal(r.status,'admitted_discovery_only');assert.ok(!f.calls.some(c=>c.includes('/contents/.github/qualification/preservation/')));
});
test('wrong setup/source/run/job/protection/credential drift blocks before membership/SQL and leaks no secrets',async t=>{
  for(const mutate of [f=>f.env.GITHUB_ACTOR='other',f=>f.env.FCOS_HOSTED_ENVIRONMENT='fcos-hosted-verification',f=>f.env.FCOS_ADMITTED_PRESERVATION_PREFLIGHT_SHA256=H,
    f=>f.run.head_sha='e'.repeat(40),f=>f.job.run_attempt=2,f=>f.job.steps.push({...f.job.steps[0]}),f=>f.protection.allow_force_pushes.enabled=true,
    f=>f.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='PRIVATE_OIDC',f=>f.env.FCOS_HOSTED_VERCEL_READ_TOKEN='PRIVATE_VERCEL',f=>f.env.FCOS_RELEASE_PLAN='{}']){
    const f=fixture(t);mutate(f);const r=await preservationPreflight(f.options);assert.equal(r.status,'incomplete');assert.deepEqual(f.sql,[]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
  }
  const f=fixture(t),r=await preservationPreflight({...f.options,collectSource:()=>({candidate:{sha:'e'.repeat(40)},controller:{sha:f.setup.controllerSha}})});assert.equal(r.failures[0].code,'PRESERVATION_SOURCE_CHANGED');assert.deepEqual(f.sql,[]);
});
test('duplicates, baseline drift and dangerous DB privileges fail closed through the same collector',async t=>{
  for(const variant of ['duplicate','rows','privilege']){const f=fixture(t,{duplicate:variant==='duplicate'});if(variant==='rows')f.rows[0].amount='CHANGED';if(variant==='privilege')f.identity.table_writes=true;
    const r=await preservationPreflight(f.options);assert.equal(r.status,'incomplete');assert.equal(r.failures[0].code,'PRESERVATION_REVALIDATION_REQUIRED');if(variant==='duplicate')assert.deepEqual(f.sql,[]);else assert.equal(f.sql.at(-1),'end');}
});
test('AEAD binds canonical observer/project/candidate/raw FILE bytes; no plaintext or wrong URL is accepted',t=>{
  const f=fixture(t),args={...f.encryption,envelopeSha256:dependencyHash(f.encrypted)};assert.deepEqual(openPreservationMembership(f.encrypted,args),f.bytes);assert.ok(!f.encrypted.includes(Buffer.from('PRIVATE_MEMBERSHIP_ID')));
  for(const change of [{connection:f.encryption.connection.replace('PRIVATE_DATABASE','wrong')},{candidateSha:'e'.repeat(40)},{membershipSha256:H},{project:'wrong'},{connection:'postgresql://postgres:private@wrong/postgres'},{envelopeSha256:H}])assert.throws(()=>openPreservationMembership(f.encrypted,{...args,...change}),{code:'PRESERVATION_PRIVATE_HANDOFF_INVALID'});
  assert.throws(()=>openPreservationMembership(f.bytes,{...args,envelopeSha256:dependencyHash(f.bytes)}),{code:'PRESERVATION_PRIVATE_HANDOFF_INVALID'});
  const manifest={candidate:{sha:FROZEN_COMPATIBILITY_SHA},targets:f.setup.targets,dependencies:{schemaVersion:1,preservation:{membershipSha256:f.encryption.membershipSha256}}};
  assert.throws(()=>loadDependencySetup({manifest,env:{FCOS_HOSTED_PRESERVATION_MEMBERSHIP_FILE:'plaintext'},readFile:()=>f.bytes}));
});
test('generic encrypted handoff supports an independently admitted application candidate without changing frozen preflight scope',t=>{
  const f=fixture(t),applicationSha='e'.repeat(40),args={...f.encryption,candidateSha:applicationSha},encrypted=sealPreservationMembership(f.bytes,args);
  assert.deepEqual(openPreservationMembership(encrypted,{...args,envelopeSha256:dependencyHash(encrypted)}),f.bytes);
  assert.throws(()=>openPreservationMembership(encrypted,{...args,candidateSha:FROZEN_COMPATIBILITY_SHA,envelopeSha256:dependencyHash(encrypted)}),{code:'PRESERVATION_PRIVATE_HANDOFF_INVALID'});
  assert.throws(()=>sealPreservationMembership(f.bytes,{...args,candidateSha:'unbound'}));
});
test('bootstrap gives only trusted reader step the DBURL; no OIDC/coordinator/Vercel or secret inheritance',()=>{
  const yaml=createRequire(import.meta.url)('js-yaml'),w=yaml.load(template),j=w.jobs.preservation_preflight;
  assert.equal(j.environment,'fcos-hosted-dependency-verification');assert.deepEqual(j.permissions,{contents:'read',actions:'read'});assert.equal(j.env.FCOS_RELEASE_MANIFEST,undefined);
  const privateSteps=j.steps.filter(s=>s.env?.FCOS_HOSTED_PRESERVATION_DATABASE_URL);assert.equal(privateSteps.length,1);assert.equal(privateSteps[0].name,'Observe preservation without release authority');
  assert.doesNotMatch(JSON.stringify(j),/id-token|VERCEL|COORDINATOR|secrets:inherit|upload.*membership\.json/);
});
