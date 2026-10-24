import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {COMPATIBILITY_CORRECTION as C,COMPATIBILITY_CONFIGURATION_CORRECTION as V,COMPATIBILITY_DIAGNOSTIC_CORRECTION as D,COMPATIBILITY_VERIFICATION_CORRECTION as M,COMPATIBILITY_MEASUREMENT_CORRECTION as N,COMPATIBILITY_RUNTIME_METERING_CORRECTION as R,isFirstRuntimeCandidateSha,firstRuntimeCandidateProfile} from '../config/hostedCompatibilityCorrection.js';
import {loadReleaseCheckManifest,requiredReleaseChecks} from '../scripts/lib/hosted-release/checks.mjs';
import {validateManifest,digest} from '../scripts/lib/hosted-release/contract.mjs';
import {assertHostedSetup} from '../scripts/lib/hosted-release/admission.mjs';
import {buildReleaseManifest} from '../scripts/lib/hosted-release/manifest.mjs';
import {fixtureManifest} from './helpers/hosted-release-manifest.mjs';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
test('explicit correction preserves frozen history and changes exactly the reviewed three files',()=>{
  assert.equal(git('rev-parse',`${C.candidateSha}^`),C.baseSha);
  assert.deepEqual(git('diff-tree','--no-commit-id','--name-only','-r',C.baseSha,C.candidateSha).split('\n'),C.files.map(f=>f.path).sort());
  for(const f of C.files){const bytes=execFileSync('git',['show',`${C.candidateSha}:${f.path}`],{cwd:ROOT});assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);}
  for(const path of ['force-app/main/default','vercel.json','api/connection-runtime.js','api/_salesforce.js'])assert.equal(git('diff','--name-only',C.baseSha,C.candidateSha,'--',path),'');
  assert.equal(C.existingUi,false);assert.deepEqual(C.handoffs,[]);
});
test('new candidate profile inherits every required frozen check and exact commands',()=>{
  const {manifest}=loadReleaseCheckManifest(ROOT),original=requiredReleaseChecks(manifest,'frozen_04ee'),corrected=requiredReleaseChecks(manifest,C.sourceProfile);
  assert.deepEqual(corrected.map(c=>c.id),original.map(c=>c.id));
  for(const c of corrected)assert.deepEqual(c.profileCommands?.[C.sourceProfile]||c.commands,c.profileCommands?.frozen_04ee||c.commands);
  assert.equal(manifest.sourceProfiles[C.sourceProfile].candidateSha,C.candidateSha);
  assert.equal(manifest.sourceProfiles.frozen_04ee.candidateSha,C.baseSha);
});
test('compatibility manifest requires exact new SHA/profile and retains independent business scope',()=>{
  const m=fixtureManifest();m.candidate.sha=C.candidateSha;m.candidate.sourceProfile=C.sourceProfile;
  assert.doesNotThrow(()=>validateManifest(m));
  for(const mutate of [v=>v.candidate.sha='e'.repeat(40),v=>v.candidate.sourceProfile='frozen_04ee',v=>delete v.candidate.sourceProfile,v=>v.scope.existingUi=true,v=>v.scope.handoffs=[{kind:'status19',sha256:'a'.repeat(64)}],v=>v.scope.financialAuthority=true]){
    const v=structuredClone(m);mutate(v);assert.throws(()=>validateManifest(v));
  }
  assert.equal(isFirstRuntimeCandidateSha('e'.repeat(40)),false);assert.equal(firstRuntimeCandidateProfile('e'.repeat(40)),null);
  assert.equal(firstRuntimeCandidateProfile(C.baseSha),'frozen_04ee');assert.equal(firstRuntimeCandidateProfile(C.candidateSha),C.sourceProfile);
});
test('configuration successor has the exact observed idempotent bytes and only one changed file',()=>{
  assert.equal(V.baseSha,C.candidateSha);
  assert.equal(git('rev-parse',`${V.candidateSha}^`),V.baseSha);
  assert.deepEqual(git('diff-tree','--no-commit-id','--name-only','-r',V.baseSha,V.candidateSha).split('\n'),['vercel.json']);
  const read=sha=>execFileSync('git',['show',`${sha}:vercel.json`],{cwd:ROOT});
  const prior=JSON.parse(read(V.baseSha)),bytes=read(V.candidateSha),value=JSON.parse(bytes);
  assert.equal(bytes.length,1216);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),V.files[0].sha256);
  assert.equal(git('rev-parse',`${V.candidateSha}:vercel.json`),V.files[0].gitBlob);
  const canonicalize=value=>JSON.stringify({...value,name:'fcos',version:2})+'\n';
  assert.equal(bytes.toString(),canonicalize(prior));
  assert.equal(bytes.toString(),canonicalize(value));
  const {name,version,...unchanged}=value;
  assert.equal(name,'fcos');assert.equal(version,2);assert.deepEqual(unchanged,prior);
  assert.equal(value.crons.length,11);
  for(const key of ['existingUi','salesforceMetadataChanged','cronSchedulesChanged'])assert.equal(V[key],false);
  assert.deepEqual(V.handoffs,[]);
});
test('configuration successor preserves all31 checks, original profiles and manifest scope restrictions',()=>{
  const {manifest}=loadReleaseCheckManifest(ROOT),old=requiredReleaseChecks(manifest,C.sourceProfile),next=requiredReleaseChecks(manifest,V.sourceProfile);
  assert.equal(old.length,31);assert.deepEqual(next.map(x=>x.id),old.map(x=>x.id));
  for(let i=0;i<old.length;i++)assert.deepEqual(next[i].profileCommands?.[V.sourceProfile]||next[i].commands,old[i].profileCommands?.[C.sourceProfile]||old[i].commands);
  assert.equal(manifest.sourceProfiles[V.sourceProfile].candidateSha,V.candidateSha);
  assert.equal(manifest.sourceProfiles[C.sourceProfile].candidateSha,C.candidateSha);
  assert.equal(firstRuntimeCandidateProfile(C.baseSha),'frozen_04ee');
  assert.equal(firstRuntimeCandidateProfile(C.candidateSha),C.sourceProfile);
  assert.equal(firstRuntimeCandidateProfile(V.candidateSha),V.sourceProfile);
  assert.equal(isFirstRuntimeCandidateSha(V.candidateSha),true);
  const m=fixtureManifest();m.candidate.sha=V.candidateSha;m.candidate.sourceProfile=V.sourceProfile;
  assert.doesNotThrow(()=>validateManifest(m));
  for(const change of [v=>v.candidate.sha=C.candidateSha,v=>v.candidate.sourceProfile=C.sourceProfile,v=>delete v.candidate.sourceProfile,v=>v.scope.existingUi=true,v=>v.scope.handoffs=[{kind:'status19',sha256:'a'.repeat(64)}],v=>v.scope.financialAuthority=true]){
    const changed=structuredClone(m);change(changed);assert.throws(()=>validateManifest(changed));
  }
});

test('diagnostic successor is the explicit one-file child and leaves business source, configuration and historical pins unchanged',()=>{
  assert.equal(D.baseSha,V.candidateSha);assert.equal(git('rev-parse',`${D.candidateSha}^`),D.baseSha);
  assert.deepEqual(git('diff-tree','--no-commit-id','--name-only','-r',D.baseSha,D.candidateSha).split('\n'),D.files.map(f=>f.path));
  for(const f of D.files){const bytes=execFileSync('git',['show',`${D.candidateSha}:${f.path}`],{cwd:ROOT});assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.equal(git('rev-parse',`${D.candidateSha}:${f.path}`),f.gitBlob);}
  for(const path of ['force-app/main/default','vercel.json','src','api','supabase','package.json','package-lock.json'])assert.equal(git('diff','--name-only',D.baseSha,D.candidateSha,'--',path),'');
  for(const key of ['existingUi','salesforceMetadataChanged','cronSchedulesChanged'])assert.equal(D[key],false);assert.deepEqual(D.handoffs,[]);
});
test('diagnostic successor inherits all31 frozen checks and exact commands with independent candidate/profile binding',()=>{
  const {manifest}=loadReleaseCheckManifest(ROOT),old=requiredReleaseChecks(manifest,V.sourceProfile),next=requiredReleaseChecks(manifest,D.sourceProfile);
  assert.equal(next.length,31);assert.deepEqual(next.map(x=>x.id),old.map(x=>x.id));
  for(let i=0;i<old.length;i++)assert.deepEqual(next[i].profileCommands?.[D.sourceProfile]||next[i].commands,old[i].profileCommands?.[V.sourceProfile]||old[i].commands);
  assert.equal(manifest.sourceProfiles[D.sourceProfile].candidateSha,D.candidateSha);assert.equal(manifest.sourceProfiles[V.sourceProfile].candidateSha,V.candidateSha);
  assert.equal(firstRuntimeCandidateProfile(D.candidateSha),D.sourceProfile);assert.equal(isFirstRuntimeCandidateSha(D.candidateSha),true);
  const m=fixtureManifest();m.candidate.sha=D.candidateSha;m.candidate.sourceProfile=D.sourceProfile;assert.doesNotThrow(()=>validateManifest(m));
  for(const change of [v=>v.candidate.sha=V.candidateSha,v=>v.candidate.sourceProfile=V.sourceProfile,v=>delete v.candidate.sourceProfile,v=>v.scope.existingUi=true,v=>v.scope.handoffs=[{kind:'status19',sha256:'a'.repeat(64)}],v=>v.scope.financialAuthority=true]){const changed=structuredClone(m);change(changed);assert.throws(()=>validateManifest(changed));}
});

test('verification successor changes only the six reviewed verification files and preserves all business source',()=>{
  assert.equal(M.baseSha,D.candidateSha);assert.equal(git('rev-parse',`${M.candidateSha}^`),M.baseSha);
  assert.deepEqual(git('diff-tree','--no-commit-id','--name-only','-r',M.baseSha,M.candidateSha).split('\n'),M.files.map(f=>f.path));
  assert.equal(M.files.length,6);
  for(const f of M.files){const bytes=execFileSync('git',['show',`${M.candidateSha}:${f.path}`],{cwd:ROOT});assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.equal(git('rev-parse',`${M.candidateSha}:${f.path}`),f.gitBlob);}
  for(const path of ['src','api','force-app','supabase','vercel.json','config','package.json','package-lock.json'])assert.equal(git('diff','--name-only',M.baseSha,M.candidateSha,'--',path),'');
  for(const key of ['existingUi','salesforceMetadataChanged','cronSchedulesChanged'])assert.equal(M[key],false);
  assert.deepEqual(M.handoffs,[]);
});

test('verification profile preserves all31 checks and changes only the exact disposable migration transport',()=>{
  const {manifest}=loadReleaseCheckManifest(ROOT),old=requiredReleaseChecks(manifest,D.sourceProfile),next=requiredReleaseChecks(manifest,M.sourceProfile);
  assert.equal(next.length,31);assert.deepEqual(next.map(x=>x.id),old.map(x=>x.id));
  for(let i=0;i<old.length;i++){
    const prior=old[i].profileCommands?.[D.sourceProfile]||old[i].commands,current=next[i].profileCommands?.[M.sourceProfile]||next[i].commands;
    if(next[i].id!=='migrations'){assert.deepEqual(current,prior);continue;}
    assert.equal(current.length,1);const env={...current[0].env};
    assert.equal(env.FCOS_MIGRATION_PARENT_PROOF_FILE,'/controller/output/disposable-migration-server.json');assert.equal(env.FCOS_MIGRATION_PROJECT_ID,'fcos');
    delete env.FCOS_MIGRATION_PARENT_PROOF_FILE;delete env.FCOS_MIGRATION_PROJECT_ID;
    assert.deepEqual({...current[0],env},prior[0]);assert.deepEqual(next[i].profileCommands.application_v2,current);
  }
  assert.equal(manifest.sourceProfiles[D.sourceProfile].candidateSha,D.candidateSha);
  assert.equal(manifest.sourceProfiles[M.sourceProfile].candidateSha,M.candidateSha);
  assert.equal(firstRuntimeCandidateProfile(M.candidateSha),M.sourceProfile);assert.equal(isFirstRuntimeCandidateSha(M.candidateSha),true);
  const m=fixtureManifest();m.candidate.sha=M.candidateSha;m.candidate.sourceProfile=M.sourceProfile;assert.doesNotThrow(()=>validateManifest(m));
  for(const mutate of [v=>v.candidate.sha=D.candidateSha,v=>v.candidate.sourceProfile=D.sourceProfile,v=>delete v.candidate.sourceProfile,v=>v.scope.existingUi=true,v=>v.scope.handoffs=[{kind:'status19',sha256:'a'.repeat(64)}],v=>v.scope.financialAuthority=true]){const changed=structuredClone(m);mutate(changed);assert.throws(()=>validateManifest(changed));}
});


test('measurement successor is exactly four reviewed verification paths above the immutable six-file predecessor',()=>{
  assert.equal(N.baseSha,M.candidateSha);assert.equal(git('rev-parse',`${N.candidateSha}^`),N.baseSha);
  assert.deepEqual(git('diff-tree','--no-commit-id','--name-only','-r',N.baseSha,N.candidateSha).split('\n'),N.files.map(f=>f.path));
  assert.equal(N.files.length,4);
  for(const f of N.files){const bytes=execFileSync('git',['show',`${N.candidateSha}:${f.path}`],{cwd:ROOT});assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.equal(git('rev-parse',`${N.candidateSha}:${f.path}`),f.gitBlob);}
  for(const path of ['src','api','force-app','supabase','vercel.json','config','.github/workflows','package.json','package-lock.json'])assert.equal(git('diff','--name-only',N.baseSha,N.candidateSha,'--',path),'');
  for(const key of ['existingUi','salesforceMetadataChanged','cronSchedulesChanged'])assert.equal(N[key],false);assert.deepEqual(N.handoffs,[]);
  assert.equal(M.candidateSha,'bf517a8ba86f8c210eacd2b9dd859ca7c4d48e3d');assert.equal(firstRuntimeCandidateProfile(M.candidateSha),M.sourceProfile);
});

test('measurement profile retains all31 exact verification commands and rejects candidate/profile/scope substitutions',()=>{
  const {manifest}=loadReleaseCheckManifest(ROOT),prior=requiredReleaseChecks(manifest,M.sourceProfile),next=requiredReleaseChecks(manifest,N.sourceProfile);
  assert.equal(next.length,31);assert.deepEqual(next.map(c=>c.id),prior.map(c=>c.id));
  for(let i=0;i<prior.length;i++)assert.deepEqual(next[i].profileCommands?.[N.sourceProfile]||next[i].commands,prior[i].profileCommands?.[M.sourceProfile]||prior[i].commands);
  assert.equal(manifest.sourceProfiles[N.sourceProfile].candidateSha,N.candidateSha);assert.equal(manifest.sourceProfiles[M.sourceProfile].candidateSha,M.candidateSha);
  assert.equal(firstRuntimeCandidateProfile(N.candidateSha),N.sourceProfile);assert.equal(isFirstRuntimeCandidateSha(N.candidateSha),true);
  const m=fixtureManifest();m.candidate.sha=N.candidateSha;m.candidate.sourceProfile=N.sourceProfile;assert.doesNotThrow(()=>validateManifest(m));
  for(const mutate of [v=>v.candidate.sha=M.candidateSha,v=>v.candidate.sourceProfile=M.sourceProfile,v=>delete v.candidate.sourceProfile,v=>v.scope.existingUi=true,v=>v.scope.handoffs=[{kind:'status19',sha256:'a'.repeat(64)}],v=>v.scope.financialAuthority=true]){const changed=structuredClone(m);mutate(changed);assert.throws(()=>validateManifest(changed));}
});

test('metered runtime child is the exact seven-file direct descendant and preserves all unrelated source',()=>{
  assert.equal(R.baseSha,N.candidateSha);assert.equal(git('rev-parse',`${R.candidateSha}^`),R.baseSha);
  assert.equal(R.files.length,7);assert.equal(R.probeProtocol,'xero_metered_v1');
  assert.deepEqual(git('diff-tree','--no-commit-id','--name-only','-r',R.baseSha,R.candidateSha).split('\n'),R.files.map(f=>f.path));
  for(const f of R.files){const bytes=execFileSync('git',['show',`${R.candidateSha}:${f.path}`],{cwd:ROOT});assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.equal(git('rev-parse',`${R.candidateSha}:${f.path}`),f.gitBlob);}
  for(const path of ['src','force-app','supabase','vercel.json','config','.github/workflows','package.json','package-lock.json','.codex','AGENTS.md'])assert.equal(git('diff','--name-only',R.baseSha,R.candidateSha,'--',path),'');
  for(const key of ['existingUi','salesforceMetadataChanged','cronSchedulesChanged'])assert.equal(R[key],false);assert.deepEqual(R.handoffs,[]);
});

test('metered runtime profile preserves all31 exact commands and requires its own candidate and protocol',()=>{
  const {manifest}=loadReleaseCheckManifest(ROOT),prior=requiredReleaseChecks(manifest,N.sourceProfile),next=requiredReleaseChecks(manifest,R.sourceProfile);
  assert.equal(next.length,31);assert.deepEqual(next.map(c=>c.id),prior.map(c=>c.id));
  for(let i=0;i<prior.length;i++)assert.deepEqual(next[i].profileCommands?.[R.sourceProfile]||next[i].commands,prior[i].profileCommands?.[N.sourceProfile]||prior[i].commands);
  assert.equal(manifest.sourceProfiles[R.sourceProfile].candidateSha,R.candidateSha);
  const m=fixtureManifest();m.candidate.sha=R.candidateSha;m.candidate.sourceProfile=R.sourceProfile;m.runtime.probeProtocol=R.probeProtocol;
  assert.doesNotThrow(()=>validateManifest(m));assert.equal(firstRuntimeCandidateProfile(R.candidateSha),R.sourceProfile);assert.equal(isFirstRuntimeCandidateSha(R.candidateSha),true);
  for(const mutate of [v=>delete v.runtime.probeProtocol,v=>v.runtime.probeProtocol='unknown',v=>v.candidate.sha=N.candidateSha,v=>v.candidate.sourceProfile=N.sourceProfile,v=>v.scope.existingUi=true,v=>v.scope.handoffs=[{kind:'status19',sha256:'a'.repeat(64)}],v=>v.scope.financialAuthority=true]){const changed=structuredClone(m);mutate(changed);assert.throws(()=>validateManifest(changed));}
  for(const pin of [C,V,D,M,N]){const old=fixtureManifest();old.candidate.sha=pin.candidateSha;old.candidate.sourceProfile=pin.sourceProfile;assert.doesNotThrow(()=>validateManifest(old));old.runtime.probeProtocol=R.probeProtocol;assert.throws(()=>validateManifest(old),{code:'RUNTIME_PROBE_PROTOCOL_BINDING'});}
});

function runtimeSetupFixture() {
  const m=fixtureManifest();m.candidate.sha=R.candidateSha;m.candidate.sourceProfile=R.sourceProfile;m.runtime.probeProtocol=R.probeProtocol;
  m.verification={runtime:{image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${'a'.repeat(64)}`,node:'v24.18.0',python:'Python 3.11.2',platform:'linux',arch:'x64'},publicBuildEnvironment:{},projectSettings:{nodeVersion:'24.x'}};
  const setup={schemaVersion:2,controllerSha:m.controller.sha,epoch:m.epoch,targetsSha256:digest(m.targets),verification:m.verification,probeProtocol:R.probeProtocol};
  const env=()=>{m.setupSha256=digest(setup);return {FCOS_ADMITTED_RELEASE_SETUP:JSON.stringify(setup),FCOS_ADMITTED_RELEASE_SETUP_SHA256:digest(setup)};};
  return {m,setup,env};
}
test('new setup marker is independently required even after coherent setup hash rebinding',()=>{
  const {m,setup,env}=runtimeSetupFixture();assert.doesNotThrow(()=>assertHostedSetup({manifest:m,env:env()}));
  for(const marker of [undefined,'unknown']){setup.probeProtocol=marker;if(marker===undefined)delete setup.probeProtocol;assert.throws(()=>assertHostedSetup({manifest:m,env:env()}),{code:'RUNTIME_PROBE_SETUP_PROTOCOL'});}
  setup.probeProtocol=R.probeProtocol;delete m.runtime.probeProtocol;
  assert.throws(()=>assertHostedSetup({manifest:m,env:env()}),{code:'RUNTIME_PROBE_SETUP_PROTOCOL'});
});

test('manifest builder refuses protocol mismatch before collecting source, while new application opt-in stays supported',()=>{
  const {m,setup}=runtimeSetupFixture();let reads=0;
  const options={plan:{schemaVersion:2,stage:'compatibility',runtime:m.runtime},setup,candidateSha:R.candidateSha,controllerSha:m.controller.sha,collectSource:()=>{reads++;throw Error('source marker');}};
  delete setup.probeProtocol;
  assert.throws(()=>buildReleaseManifest(options),{code:'RUNTIME_PROBE_SETUP_PROTOCOL'});assert.equal(reads,0);
  setup.probeProtocol=R.probeProtocol;assert.throws(()=>buildReleaseManifest(options),/source marker/);assert.equal(reads,1);
  m.stage='application';m.candidate.sha='e'.repeat(40);m.candidate.sourceProfile='application_v2';
  m.scope.compatibilityProductionObservationSha256='a'.repeat(64);m.scope.handoffs=[{kind:'status19',sha256:'a'.repeat(64)},{kind:'supplier16',sha256:'a'.repeat(64)}];m.requiredChecks.push('compatibility_production_observation');
  assert.doesNotThrow(()=>validateManifest(m));
  m.runtime.probeProtocol='unknown';assert.throws(()=>validateManifest(m),{code:'RUNTIME_PROBE_PROTOCOL_BINDING'});
});
