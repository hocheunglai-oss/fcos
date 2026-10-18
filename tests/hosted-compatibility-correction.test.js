import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {COMPATIBILITY_CORRECTION as C,isFirstRuntimeCandidateSha,firstRuntimeCandidateProfile} from '../config/hostedCompatibilityCorrection.js';
import {loadReleaseCheckManifest,requiredReleaseChecks} from '../scripts/lib/hosted-release/checks.mjs';
import {validateManifest} from '../scripts/lib/hosted-release/contract.mjs';
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
