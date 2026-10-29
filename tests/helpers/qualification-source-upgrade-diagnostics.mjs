import { readFile } from 'node:fs/promises';
import { digest } from '../../scripts/lib/hosted-release/json-contract.mjs';
import { SOURCE_UPGRADE_DIAGNOSTIC as S } from '../../scripts/lib/hosted-release/qualification-source-upgrade.mjs';
import { repinSourceUpgrade, sourceUpgradeFixture } from './hosted-qualification-source-upgrade.mjs';

export const projection = JSON.parse(await readFile(new URL('../fixtures/qualification-source-upgrade-diagnostics/parent-projection.json', import.meta.url), 'utf8'));
export const migration = () => readFile(new URL('../../supabase/migrations/20261022225021_qualification_source_upgrade_diagnostic_candidate.sql', import.meta.url), 'utf8');
/** Exact public parent projections; every child review/source/run is explicitly
 * SYNTHETIC. This fixture does not attest publication, completion or live state. */
export function diagnosticFixture({ parent, previousRegistrationSha256, configuration, checkerFiles, reviewedAt = new Date().toISOString() } = {}) {
  const p = structuredClone(parent || sourceUpgradeFixture().upgrade), old = projection;
  p.previous = { setup: structuredClone(old.setup), plan: structuredClone(old.plan), manifest: structuredClone(old.manifest) };
  p.previousPolicy = structuredClone(old.policy); p.previousCheckerManifest = structuredClone(old.checkerManifest);
  p.setup = structuredClone(old.setup); p.plan = structuredClone(old.plan); p.manifest = structuredClone(old.manifest);
  p.policy = structuredClone(old.policy); p.checkerManifest = structuredClone(old.checkerManifest);
  p.parent = { kind: 'source_upgrade', operationId: S.parentOperationId, proofSha256: S.parentProofSha256, releaseId: S.parentReleaseId, manifestHash: S.parentManifestSha256 };
  p.operationId = 'SYNTHETIC-diagnostic-candidate-source-upgrade'; p.plan.releaseId = 'SYNTHETIC-diagnostic-candidate-release';
  p.plan.sourceProfile = S.sourceProfile; p.plan.branch = S.branch;
  const q = { ref: 'refs/heads/codex/SYNTHETIC-diagnostic-caller', bootstrapSha: 'a'.repeat(40), controllerSha: 'b'.repeat(40),
    candidateSha: S.candidateSha, callerWorkflowRef: 'hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@refs/heads/codex/SYNTHETIC-diagnostic-caller' };
  p.setup.controllerSha = q.controllerSha; p.setup.qualificationSource = q;
  const ref = p.setup.firstRuntimeBaseline, value = JSON.parse(ref.json), review = JSON.parse(ref.acceptance.json);
  value.candidateSha = S.candidateSha; value.candidateSourceProfile = S.sourceProfile;
  ref.json = JSON.stringify(value); ref.sha256 = digest(ref.json);
  review.baselineSha256 = ref.sha256; review.reviewedAt = reviewedAt;
  review.firstCutoverException.scopeSha256 = digest({ kind: 'previous-runtime-endpoint-absent-typed-v2', candidateSha: S.candidateSha,
    sourceProfile: S.sourceProfile, previous: value.previous, desiredRuntimeSha256: digest(value.desiredRuntime), existingUi: false, handoffs: [], rollbackEligible: false });
  ref.acceptance.json = JSON.stringify(review); ref.acceptance.sha256 = digest(ref.acceptance.json);
  p.manifest.releaseId = p.plan.releaseId; p.manifest.qualificationSource = q;
  p.manifest.controller.sha = q.controllerSha; p.manifest.controller.checkManifestSha256 = S.checkManifestSha256;
  Object.assign(p.manifest.candidate, { sha: S.candidateSha, sourceProfile: S.sourceProfile, sourceSha256: S.sourceSha256, sourceInputsSha256: S.sourceInputsSha256, branch: S.branch });
  Object.assign(p.manifest.previousProduction.firstRuntime, { candidateSha: S.candidateSha, baselineSha256: ref.sha256 });
  Object.assign(p.policy.qualificationAdmission, { ref: q.ref, bootstrapSha: q.bootstrapSha, callerWorkflowSha: q.bootstrapSha,
    callerWorkflowRef: q.callerWorkflowRef, jobWorkflowSha: q.controllerSha, candidateSha: q.candidateSha,
    jobWorkflowRef: `hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${q.controllerSha}` });
  p.previousConfiguration = configuration || { ...p.previousConfiguration, setupSha256: S.parentSetupSha256, policySha256: S.parentPolicySha256 };
  p.previousRegistrationSha256 = previousRegistrationSha256 || digest('SYNTHETIC current parent registration');
  if (checkerFiles) p.checkerFiles = checkerFiles;
  return repinSourceUpgrade(p);
}
export function repinBaseline(p, mutate, reviewMutate = () => {}) {
  const ref = p.setup.firstRuntimeBaseline, value = JSON.parse(ref.json), review = JSON.parse(ref.acceptance.json);
  mutate(value); ref.json = JSON.stringify(value); ref.sha256 = digest(ref.json);
  review.baselineSha256 = ref.sha256; reviewMutate(review); ref.acceptance.json = JSON.stringify(review); ref.acceptance.sha256 = digest(ref.acceptance.json);
  p.manifest.previousProduction.firstRuntime.baselineSha256 = ref.sha256;
  return repinSourceUpgrade(p);
}
