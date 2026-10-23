import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest } from '../scripts/lib/hosted-release/json-contract.mjs';
import { SOURCE_UPGRADE_CONTROLLER_REPAIR as S, SOURCE_UPGRADE_DIAGNOSTIC as D,
  controllerRepairSourceUpgradeTransition, sourceUpgradeActions, validateSourceUpgradeProof } from '../scripts/lib/hosted-release/qualification-source-upgrade.mjs';
import { sourceUpgradeFixture, repinSourceUpgrade } from './helpers/hosted-qualification-source-upgrade.mjs';

const projection = JSON.parse(readFileSync(new URL('./fixtures/qualification-source-upgrade-controller-repair/parent-projection.json', import.meta.url)));
// Genuine public5c parent data; the prospective child reviews, sources,
// registration and provider facts are explicitly synthetic local fixtures.
function fixture() {
  const p = sourceUpgradeFixture().upgrade, old = structuredClone(projection);
  p.parent = { kind: 'source_upgrade', operationId: S.parentOperationId, proofSha256: S.parentProofSha256,
    releaseId: S.parentReleaseId, manifestHash: S.parentManifestSha256 };
  p.previous = { setup: old.setup, plan: old.plan, manifest: old.manifest };
  p.previousPolicy = old.policy; p.previousCheckerManifest = old.checkerManifest;
  p.setup = structuredClone(old.setup); p.plan = structuredClone(old.plan); p.manifest = structuredClone(old.manifest);
  p.policy = structuredClone(old.policy); p.checkerManifest = structuredClone(old.checkerManifest);
  p.checkerFiles = p.checkerFiles.map(f => old.checkerFileOverrides.find(x => x.file === f.file) || f);
  p.operationId = 'SYNTHETIC-controller-repair-source-upgrade'; p.plan.releaseId = 'SYNTHETIC-controller-repair-release';
  const ref = 'refs/heads/codex/SYNTHETIC-controller-repair';
  const q = { ref, bootstrapSha: 'a'.repeat(40), controllerSha: 'b'.repeat(40), candidateSha: D.candidateSha,
    callerWorkflowRef: 'hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@' + ref };
  p.setup.controllerSha = q.controllerSha; p.setup.qualificationSource = q;
  p.manifest.releaseId = p.plan.releaseId; p.manifest.qualificationSource = q; p.manifest.controller.sha = q.controllerSha;
  Object.assign(p.policy.qualificationAdmission, { ref, bootstrapSha: q.bootstrapSha, callerWorkflowSha: q.bootstrapSha,
    callerWorkflowRef: q.callerWorkflowRef, jobWorkflowSha: q.controllerSha,
    jobWorkflowRef: 'hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@' + q.controllerSha });
  p.previousConfiguration = { ...p.previousConfiguration, setupSha256: S.parentSetupSha256, policySha256: S.parentPolicySha256 };
  p.previousRegistrationSha256 = digest('SYNTHETIC current5c registration, not live admission');
  return repinSourceUpgrade(p);
}

test('public parent is exactly the completed5c source tuple', () => {
  assert.equal(projection.proofSha256, S.parentProofSha256);
  for (const [key, expected] of [['setup', S.parentSetupSha256], ['plan', S.parentPlanSha256],
    ['manifest', S.parentManifestSha256], ['policy', S.parentPolicySha256]]) assert.equal(digest(projection[key]), expected);
  assert.equal(digest(projection.checkerManifest), D.checkerManifestSha256);
});

test('one fresh controller/caller preserves160 source, dependency ciphertext bindings and all six action semantics', () => {
  const p = fixture(); assert.equal(controllerRepairSourceUpgradeTransition(p), true);
  assert.doesNotThrow(() => validateSourceUpgradeProof(p));
  assert.deepEqual(p.manifest.candidate, projection.manifest.candidate);
  assert.deepEqual(p.setup.dependencies, projection.setup.dependencies);
  assert.deepEqual(p.setup.dependencyArtifact, projection.setup.dependencyArtifact);
  assert.deepEqual(p.plan.runtime, projection.plan.runtime);
  assert.deepEqual(p.manifest.previousProduction, projection.manifest.previousProduction);
  assert.equal(sourceUpgradeActions(p)[5].request.body.inputs.candidate_sha, D.candidateSha);
  assert.deepEqual(p.actions.map(a => a.id), ['policy_patch', 'checker_deploy', 'url_patch', 'setup_patch', 'setup_hash_patch', 'dispatch']);
  assert.equal(p.actions[1].request.body.files.length, 17);
  assert.equal(Object.hasOwn(p.actions[1].request.body, 'target'), false);
});

const mutations = [
  ['parent proof', p => { p.parent.proofSha256 = 'c'.repeat(64); }],
  ['parent operation', p => { p.parent.operationId = 'foreign'; }],
  ['parent setup', p => { p.previous.setup.controllerSha = 'c'.repeat(40); }],
  ['parent manifest', p => { p.previous.manifest.candidate.sha = 'c'.repeat(40); }],
  ['parent policy', p => { p.previousPolicy.workflows = []; }],
  ['candidate', p => { p.manifest.candidate.sha = 'c'.repeat(40); }],
  ['candidate source', p => { p.manifest.candidate.sourceSha256 = 'c'.repeat(64); }],
  ['candidate lock', p => { p.manifest.candidate.lockSha256 = 'c'.repeat(64); }],
  ['candidate configuration', p => { p.manifest.candidate.configurationSha256 = 'c'.repeat(64); }],
  ['candidate Salesforce', p => { p.manifest.candidate.salesforceSourceSha256 = 'c'.repeat(64); }],
  ['candidate inputs', p => { p.manifest.candidate.sourceInputsSha256 = 'c'.repeat(64); }],
  ['source profile', p => { p.plan.sourceProfile = 'arbitrary'; }],
  ['runtime', p => { p.plan.runtime.expectedPreview.safety.readOnly = false; }],
  ['financial scope', p => { p.plan.scope.financialAuthority = true; }],
  ['schema', p => { p.plan.migration.expectedSchemaSha256 = 'c'.repeat(64); }],
  ['setup dependency', p => { p.setup.dependencies.preservation.envelopeSha256 = 'c'.repeat(64); }],
  ['manifest dependency', p => { p.manifest.dependencies.preservation.envelopeSha256 = 'c'.repeat(64); }],
  ['dependency artifact', p => { p.setup.dependencyArtifact.name = 'foreign'; }],
  ['baseline clock', p => { p.setup.firstRuntimeBaseline.json += ' '; }],
  ['previous Production', p => { p.manifest.previousProduction.deploymentId = 'dpl_FOREIGN000000000'; }],
  ['checker source', p => { p.checkerManifest[0].sha256 = 'c'.repeat(64); }],
  ['same controller', p => { p.setup.qualificationSource.controllerSha = p.previous.setup.controllerSha; }],
  ['same caller', p => { p.setup.qualificationSource.bootstrapSha = p.previous.setup.qualificationSource.bootstrapSha; }],
  ['same ref', p => { p.setup.qualificationSource.ref = p.previous.setup.qualificationSource.ref; }],
];
for (const [name, mutate] of mutations) test('controller-only transition refuses ' + name, () => {
  const p = fixture(); mutate(p); assert.equal(controllerRepairSourceUpgradeTransition(p), false);
  assert.throws(() => validateSourceUpgradeProof(repinSourceUpgrade(p)));
});

test('checker bytes, policy rules and final reviews cannot be changed merely by recomputing hashes', () => {
  for (const mutate of [p => { p.checkerFiles[0].data = 'YWJj'; }, p => { p.policy.workflows = []; },
    p => { p.rootReview.accepted = false; }, p => { p.rootReview.subjectSha256 = 'c'.repeat(64); }]) {
    const p = fixture(); mutate(p); assert.throws(() => validateSourceUpgradeProof(p));
  }
});

test('historical2ef proof and requests remain accepted without mutation', () => {
  const p = sourceUpgradeFixture().upgrade, before = JSON.stringify(p);
  assert.equal(controllerRepairSourceUpgradeTransition(p), false);
  assert.doesNotThrow(() => validateSourceUpgradeProof(p));
  assert.equal(JSON.stringify(p), before);
  assert.equal(p.actions[5].request.body.inputs.candidate_sha, '2ef733d17dd12314c72971c2220b2b09903a6bf0');
});
