import { firstRuntimeCandidateProfile, runtimeProbeProtocolMatches } from '../config/hostedCompatibilityCorrection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { BOOTSTRAP_SOURCE } from '../scripts/lib/hosted-release/cutover-bootstrap.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { CONFIGURATION_SUCCESSOR_PRODUCTION as PIN, DIAGNOSTIC_SUCCESSOR_PRODUCTION as DIAGNOSTIC, RUNTIME_DEPENDENCY_SUCCESSOR_PRODUCTION as DEPENDENCY, RUNTIME_ORDINARY_ADMISSION_SUCCESSOR_PRODUCTION as ORDINARY, collectCompatibilitySuccessor } from '../scripts/lib/hosted-release/successor.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

const NOW = Date.parse('2026-10-22T00:00:00Z');
const env = { GITHUB_RUN_ID: '1', FCOS_VERIFIED_JOB_ID: '2' };
const refused = { code: 'COMPATIBILITY_PRODUCTION_NOT_ACCEPTED' };
// Public manifest metadata supplies the exact source/runtime projection. All
// completion, deployment and observation records below are synthetic local data.
const qualification = JSON.parse(readFileSync(new URL('./fixtures/qualification-plan-completion/manifest.json', import.meta.url), 'utf8'));

function bind(f) {
  const manifestHash = digest(f.registered);
  f.manifest.scope.compatibilityRelease = { releaseId: f.registered.releaseId, manifestHash };
  f.snapshot.registration.manifest_hash = manifestHash;
  f.observation.result.manifestHash = manifestHash;
  f.manifest.scope.compatibilityProductionObservationSha256 = digest(f.observation);
  return f;
}
function configuredFixture(pin = PIN) {
  const registered = { ...structuredClone(qualification), releaseId: 'synthetic-completed-configuration-release', stage: 'compatibility', executionMode: 'release' };
  delete registered.qualificationSource;
  registered.candidate.sha=pin.candidateSha;registered.candidate.sourceProfile=pin.sourceProfile;registered.candidate.sourceSha256=pin.sourceSha256;
  registered.previousProduction.firstRuntime.candidateSha=pin.candidateSha;
  if (pin === DEPENDENCY || pin === ORDINARY) registered.runtime.probeProtocol = 'xero_metered_v1';
  const actual = { id: 'dpl_SyntheticCompletedProduction', sha: pin.candidateSha, sourceSha256: pin.sourceSha256,
    projectId: registered.targets.vercelProject, teamId: registered.targets.vercelTeam, target: 'production', state: 'READY' };
  const observation = { capturedAt: '2026-10-21T12:00:00Z', result: actual };
  const manifest = { ...fixtureManifest(), releaseId: 'synthetic-final-application-release', stage: 'application', epoch: registered.epoch,
    candidate: { ...fixtureManifest().candidate, sha: 'e'.repeat(40), sourceProfile: 'application_v2' },
    previousProduction: { deploymentId: actual.id, sha: actual.sha, sourceSha256: pin.sourceSha256, schemaSha256: pin.schemaSha256, runtimeSha256: pin.runtimeSha256 },
    scope: { ...fixtureManifest().scope, handoffs: [{ kind: 'status19', sha256: 'a'.repeat(64) }, { kind: 'supplier16', sha256: 'b'.repeat(64) }] },
    requiredChecks: [...fixtureManifest().requiredChecks, 'compatibility_production_observation'] };
  const snapshot = { status: 'complete', finished: true,
    registration: { manifest: registered, release_id: registered.releaseId, scope: 'release' },
    checks: { 'production.live_verified': { evidence: observation } } };
  return bind({ registered, actual, observation, manifest, snapshot });
}
const collect = f => collectCompatibilitySuccessor({ manifest: f.manifest, coordinator: { snapshot: async reference => {
  assert.deepEqual(reference, f.manifest.scope.compatibilityRelease); return f.snapshot;
} }, env, now: () => NOW });

test('ordinary wrapper shares the reviewed immutable6a3 pin without changing original qualification64aa', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release.yml', import.meta.url), 'utf8'));
  const manifest = workflow.jobs.manifest, checkout = manifest.steps.find(row => row.name === 'Check out admitted controller');
  const reusableSha = workflow.jobs.release.uses.split('@').at(-1);
  assert.equal(reusableSha, '6a3fbd8fd05a76c052e7e380d618aedf43e5b72e');
  assert.equal(BOOTSTRAP_SOURCE.controllerSha, '64aa338b04cee7e05bde0ca9bfd10b81ac001a65');
  assert.equal(manifest.env.FCOS_CONTROLLER_SHA, reusableSha);
  assert.equal(checkout.with.ref, reusableSha);
  assert.ok(manifest.steps.some(row => row.run === 'node controller/scripts/hosted-release-manifest.mjs'));
});

test('exact2ef completed Production tuple is accepted without changing its original observation', async () => {
  const f = configuredFixture(), original = structuredClone(f), proof = await collect(f);
  assert.equal(f.registered.candidate.sourceProfile, PIN.sourceProfile);
  assert.equal(digest(f.registered.runtime.expectedProduction), PIN.runtimeSha256);
  assert.equal(digest(f.registered.runtime.expectedPreview), PIN.previewRuntimeSha256);
  assert.equal(proof.result.originalCapturedAt, f.observation.capturedAt);
  assert.equal(proof.result.observationSha256, digest(f.observation));
  assert.equal(proof.result.candidateSha, PIN.candidateSha);
  assert.equal(proof.result.financialAuthority, false);
  assert.deepEqual(f, original);
});

test('original04ee observation remains supported under its unchanged contract', async () => {
  const registered = fixtureManifest(), observation = { capturedAt: '2026-10-17T00:00:00Z', result: { id: 'dpl_original', sha: registered.candidate.sha } };
  const manifest = { ...registered, stage: 'application', previousProduction: { ...registered.previousProduction, deploymentId: observation.result.id, sha: registered.candidate.sha },
    scope: { ...registered.scope, compatibilityRelease: { releaseId: registered.releaseId, manifestHash: digest(registered) }, compatibilityProductionObservationSha256: digest(observation) } };
  const proof = await collectCompatibilitySuccessor({ manifest, coordinator: { snapshot: async () => ({ status: 'complete', finished: true,
    registration: { manifest: registered }, checks: { 'production.live_verified': { evidence: observation } } }) }, env, now: () => NOW });
  assert.equal(proof.result.candidateSha, registered.candidate.sha);
  assert.equal(proof.result.originalCapturedAt, observation.capturedAt);
});

test('only explicit source/profile/schema/runtime tuples are added, even with self-consistent new hashes', async () => {
  const mutations = [
    f => { f.registered.candidate.sha = f.actual.sha = f.manifest.previousProduction.sha = '8f39dde6a6885292ce3b70cb61a78f8b86b947c3'; },
    f => { f.registered.candidate.sha = f.actual.sha = f.manifest.previousProduction.sha = 'd'.repeat(40); },
    f => { f.registered.candidate.sourceProfile = 'frozen_04ee'; },
    f => { f.registered.candidate.sourceSha256 = f.actual.sourceSha256 = f.manifest.previousProduction.sourceSha256 = 'b'.repeat(64); },
    f => { f.registered.migration.expectedSchemaSha256 = f.manifest.previousProduction.schemaSha256 = 'b'.repeat(64); },
    f => { f.registered.runtime.expectedProduction.safety.readOnly = true; f.registered.runtime.expectedSha256 = f.manifest.previousProduction.runtimeSha256 = digest(f.registered.runtime.expectedProduction); },
    f => { f.registered.runtime.expectedPreview.safety.externalActions.salesforce_write = true; },
    f => { f.registered.migration.mode = 'separately_authorized'; f.registered.migration.acceptedMigrationProofSha256 = 'b'.repeat(64); },
  ];
  for (const pin of [PIN,DIAGNOSTIC,DEPENDENCY,ORDINARY])for (const mutate of mutations) { const f = configuredFixture(pin); mutate(f); bind(f); await assert.rejects(collect(f), refused); }
});

test('qualification, rollback, incomplete, foreign target and changed live/source tuples never count as Production', async () => {
  const mutations = [
    f => { f.registered.stage = 'qualification'; f.registered.executionMode = 'qualification'; },
    f => { f.registered.stage = 'application'; },
    f => { f.snapshot.status = 'rolled_back'; }, f => { f.snapshot.status = 'waiting_dependency'; }, f => { f.snapshot.finished = false; },
    f => { f.snapshot.registration.scope = 'qualification'; }, f => { f.snapshot.registration.release_id = 'foreign-release'; },
    f => { f.registered.scope.existingUi = true; }, f => { f.registered.scope.financialAuthority = true; },
    f => { f.actual.id = 'dpl_Foreign'; }, f => { f.actual.sha = 'd'.repeat(40); },
    f => { f.actual.sourceSha256 = 'b'.repeat(64); }, f => { f.actual.target = 'preview'; }, f => { f.actual.state = 'BUILDING'; },
    f => { f.actual.projectId = 'foreign-project'; }, f => { f.actual.teamId = 'foreign-team'; },
    f => { f.manifest.previousProduction.sourceSha256 = 'b'.repeat(64); },
    f => { f.manifest.previousProduction.schemaSha256 = 'b'.repeat(64); }, f => { f.manifest.previousProduction.runtimeSha256 = 'b'.repeat(64); },
    f => { f.manifest.stage = 'qualification'; f.manifest.executionMode = 'qualification'; },
    f => { f.manifest.scope.handoffs = []; }, f => { f.manifest.scope.financialAuthority = true; },
    f => { f.observation.capturedAt = 'invalid'; }, f => { f.observation.capturedAt = new Date(NOW + 30001).toISOString(); },
  ];
  for (const pin of [PIN,DIAGNOSTIC,DEPENDENCY,ORDINARY])for (const mutate of mutations) { const f = configuredFixture(pin); mutate(f); bind(f); await assert.rejects(collect(f), refused); }
  for (const mutate of [f => { f.manifest.scope.compatibilityProductionObservationSha256 = 'b'.repeat(64); },
    f => { f.manifest.scope.compatibilityRelease.manifestHash = 'b'.repeat(64); }, f => { f.actual.manifestHash = 'b'.repeat(64); }]) {
    for(const pin of [PIN,DIAGNOSTIC,DEPENDENCY,ORDINARY]){const f = configuredFixture(pin); mutate(f); await assert.rejects(collect(f), refused);}
  }
});


test('exact diagnostic child160 retains the reviewed2ef runtime/schema and accepts only its measured archive digest',async()=>{
  assert.equal(DIAGNOSTIC.candidateSha,'160edcccc3347596ac18bb5c9dcb34ecc26df02b');
  assert.equal(DIAGNOSTIC.sourceProfile,'compat_source_diagnostics_20261023');
  assert.equal(DIAGNOSTIC.sourceSha256,'9f8b01198784d1e222f96f726207ef9c980f9ab5d2536e7a156ca97b2f307912');
  for(const key of ['schemaSha256','runtimeSha256','previewRuntimeSha256'])assert.equal(DIAGNOSTIC[key],PIN[key]);
  const f=configuredFixture(DIAGNOSTIC),before=structuredClone(f),proof=await collect(f);
  assert.equal(proof.result.candidateSha,DIAGNOSTIC.candidateSha);assert.equal(proof.result.originalCapturedAt,f.observation.capturedAt);
  assert.equal(proof.result.observationSha256,digest(f.observation));assert.equal(proof.result.financialAuthority,false);assert.deepEqual(f,before);
});

test('diagnostic candidate cannot borrow parent source/profile, another commit, another registration, or a future observation',async()=>{
  for(const mutate of [f=>{f.registered.candidate.sourceProfile=PIN.sourceProfile;},
    f=>{f.registered.candidate.sourceSha256=f.actual.sourceSha256=f.manifest.previousProduction.sourceSha256=PIN.sourceSha256;},
    f=>{f.registered.candidate.sha=f.actual.sha=f.manifest.previousProduction.sha='160edcccc3347596ac18bb5c9dcb34ecc26df02c';},
    f=>{f.snapshot.registration.release_id='unrelated-compatibility-release';},
    f=>{f.observation.capturedAt=new Date(NOW+30001).toISOString();}]){
    const f=configuredFixture(DIAGNOSTIC);mutate(f);bind(f);await assert.rejects(collect(f),refused);
  }
});


test('real runtime dependency child is exact-source admitted and cannot borrow consumed1e proof', async () => {
  assert.equal(DEPENDENCY.candidateSha, '9152fa655b6e507a568d773534404843595fe323');
  assert.equal(DEPENDENCY.sourceProfile, 'compat_runtime_dependency_20261024');
  assert.equal(firstRuntimeCandidateProfile(DEPENDENCY.candidateSha), DEPENDENCY.sourceProfile);
  assert.equal(DEPENDENCY.sourceSha256, 'd460d7c3a665799f229bec782322e7a97a52122e4c4ec75bad51551be82ec840');
  const f = configuredFixture(DEPENDENCY), original = structuredClone(f), proof = await collect(f);
  assert.deepEqual(f, original); assert.equal(proof.result.originalCapturedAt, f.observation.capturedAt);
  assert.equal(proof.result.candidateSha, DEPENDENCY.candidateSha);
  for (const mutate of [x => { x.registered.candidate.sha=x.actual.sha=x.manifest.previousProduction.sha='1e25147dc9fc9ba008096f1200b681993d49d428'; },
    x => { x.registered.candidate.sourceProfile='compat_runtime_metering_20261024'; },
    x => { x.registered.candidate.sourceSha256=x.actual.sourceSha256=x.manifest.previousProduction.sourceSha256='5317444c5e3c732aa19642f9602db5301c1312fcc34cc7144811a42e7e31fb90'; },
    x => { delete x.registered.runtime.probeProtocol; }]) {
    const changed = configuredFixture(DEPENDENCY); mutate(changed); bind(changed); await assert.rejects(collect(changed), refused);
  }
  assert.equal(runtimeProbeProtocolMatches({ sha:DEPENDENCY.candidateSha, sourceProfile:DEPENDENCY.sourceProfile },'xero_metered_v1'),true);
  assert.equal(runtimeProbeProtocolMatches({ sha:DEPENDENCY.candidateSha, sourceProfile:'compat_runtime_metering_20261024' },'xero_metered_v1'),false);
  assert.equal(runtimeProbeProtocolMatches({ sha:'1e25147dc9fc9ba008096f1200b681993d49d428', sourceProfile:'compat_runtime_metering_20261024' },'xero_metered_v1'),true);
  const checks=JSON.parse(readFileSync(new URL('../config/release-checks-v2.json',import.meta.url)));
  assert.deepEqual(checks.checks.filter(x=>x.profiles.includes(DEPENDENCY.sourceProfile)).map(x=>x.id),checks.checks.filter(x=>x.profiles.includes('compat_runtime_metering_20261024')).map(x=>x.id));
});


test('ordinary app protocol and complete inherited K commands retain exact maintained semantics', () => {
  for (const [protocol,accepted] of [[undefined,true],['xero_metered_v1',true],['unknown',false]])
    assert.equal(runtimeProbeProtocolMatches({sha:'f'.repeat(40),sourceProfile:'application_v2'},protocol),accepted);
  for (const [candidate,protocol] of [[{sha:DEPENDENCY.candidateSha,sourceProfile:'application_v2'},'xero_metered_v1'],
    [{sha:'f'.repeat(40),sourceProfile:DEPENDENCY.sourceProfile},'xero_metered_v1'],
    [{sha:DEPENDENCY.candidateSha,sourceProfile:DEPENDENCY.sourceProfile},undefined]])
    assert.equal(runtimeProbeProtocolMatches(candidate,protocol),false);
  const checks=JSON.parse(readFileSync(new URL('../config/release-checks-v2.json',import.meta.url)));
  for (const check of checks.checks) assert.deepEqual(check.profileCommands?.[DEPENDENCY.sourceProfile],check.profileCommands?.compat_runtime_metering_20261024);
});

test('ordinary Connections child has its own exact live successor and all31 inherited check commands', async () => {
  assert.equal(ORDINARY.candidateSha, 'be6daf6162480ca77ec8d4f04fe5aaa5b228a22c');
  assert.equal(ORDINARY.sourceProfile, 'compat_runtime_ordinary_admission_20261025');
  assert.equal(ORDINARY.sourceSha256, 'e4936669ba9a4874852d7c105ff48e5ab0cfb7fb56c46cee4875f674d33dd49f');
  assert.equal(firstRuntimeCandidateProfile(ORDINARY.candidateSha), ORDINARY.sourceProfile);
  for (const key of ['schemaSha256', 'runtimeSha256', 'previewRuntimeSha256']) assert.equal(ORDINARY[key], DEPENDENCY[key]);
  const f = configuredFixture(ORDINARY), before = structuredClone(f), proof = await collect(f);
  assert.deepEqual(f, before); assert.equal(proof.result.candidateSha, ORDINARY.candidateSha);
  assert.equal(proof.result.originalCapturedAt, f.observation.capturedAt); assert.equal(proof.result.financialAuthority, false);
  for (const mutate of [x => { x.registered.candidate.sha=x.actual.sha=x.manifest.previousProduction.sha=DEPENDENCY.candidateSha; },
    x => { x.registered.candidate.sourceProfile=DEPENDENCY.sourceProfile; },
    x => { x.registered.candidate.sourceSha256=x.actual.sourceSha256=x.manifest.previousProduction.sourceSha256=DEPENDENCY.sourceSha256; },
    x => { delete x.registered.runtime.probeProtocol; }]) {
    const changed=configuredFixture(ORDINARY); mutate(changed); bind(changed); await assert.rejects(collect(changed),refused);
  }
  assert.equal(runtimeProbeProtocolMatches({sha:ORDINARY.candidateSha,sourceProfile:ORDINARY.sourceProfile},'xero_metered_v1'),true);
  for (const candidate of [{sha:ORDINARY.candidateSha,sourceProfile:DEPENDENCY.sourceProfile},
    {sha:DEPENDENCY.candidateSha,sourceProfile:ORDINARY.sourceProfile},{sha:'f'.repeat(40),sourceProfile:ORDINARY.sourceProfile}])
    assert.equal(runtimeProbeProtocolMatches(candidate,'xero_metered_v1'),false);
  assert.equal(runtimeProbeProtocolMatches({sha:ORDINARY.candidateSha,sourceProfile:ORDINARY.sourceProfile},undefined),false);
  const checks=JSON.parse(readFileSync(new URL('../config/release-checks-v2.json',import.meta.url)));
  assert.equal(checks.sourceProfiles[ORDINARY.sourceProfile].candidateSha,ORDINARY.candidateSha);
  const selected=checks.checks.filter(x=>x.profiles.includes(ORDINARY.sourceProfile)); assert.equal(selected.length,31);
  assert.deepEqual(selected.map(x=>x.id),checks.checks.filter(x=>x.profiles.includes(DEPENDENCY.sourceProfile)).map(x=>x.id));
  for(const check of checks.checks) assert.deepEqual(check.profileCommands?.[ORDINARY.sourceProfile],check.profileCommands?.[DEPENDENCY.sourceProfile]);
});
