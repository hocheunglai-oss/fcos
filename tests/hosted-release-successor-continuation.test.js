import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { BOOTSTRAP_SOURCE } from '../scripts/lib/hosted-release/cutover-bootstrap.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { CONFIGURATION_SUCCESSOR_PRODUCTION as PIN, collectCompatibilitySuccessor } from '../scripts/lib/hosted-release/successor.mjs';
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
function configuredFixture() {
  const registered = { ...structuredClone(qualification), releaseId: 'synthetic-completed-configuration-release', stage: 'compatibility', executionMode: 'release' };
  delete registered.qualificationSource;
  const actual = { id: 'dpl_SyntheticCompletedProduction', sha: PIN.candidateSha, sourceSha256: PIN.sourceSha256,
    projectId: registered.targets.vercelProject, teamId: registered.targets.vercelTeam, target: 'production', state: 'READY' };
  const observation = { capturedAt: '2026-10-21T12:00:00Z', result: actual };
  const manifest = { ...fixtureManifest(), releaseId: 'synthetic-final-application-release', stage: 'application', epoch: registered.epoch,
    candidate: { ...fixtureManifest().candidate, sha: 'e'.repeat(40), sourceProfile: 'application_v2' },
    previousProduction: { deploymentId: actual.id, sha: actual.sha, sourceSha256: PIN.sourceSha256, schemaSha256: PIN.schemaSha256, runtimeSha256: PIN.runtimeSha256 },
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

test('ordinary manifest builder, checkout and reusable controller share the admitted immutable64aa pin', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release.yml', import.meta.url), 'utf8'));
  const manifest = workflow.jobs.manifest, checkout = manifest.steps.find(row => row.name === 'Check out admitted controller');
  const reusableSha = workflow.jobs.release.uses.split('@').at(-1);
  assert.equal(reusableSha, BOOTSTRAP_SOURCE.controllerSha);
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

test('only the explicit2ef source/profile/schema/runtime is added, even with self-consistent new hashes', async () => {
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
  for (const mutate of mutations) { const f = configuredFixture(); mutate(f); bind(f); await assert.rejects(collect(f), refused); }
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
  for (const mutate of mutations) { const f = configuredFixture(); mutate(f); bind(f); await assert.rejects(collect(f), refused); }
  for (const mutate of [f => { f.manifest.scope.compatibilityProductionObservationSha256 = 'b'.repeat(64); },
    f => { f.manifest.scope.compatibilityRelease.manifestHash = 'b'.repeat(64); }, f => { f.actual.manifestHash = 'b'.repeat(64); }]) {
    const f = configuredFixture(); mutate(f); await assert.rejects(collect(f), refused);
  }
});
