import { COMPATIBILITY_CONFIGURATION_CORRECTION, COMPATIBILITY_DIAGNOSTIC_CORRECTION, COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION } from '../../../config/hostedCompatibilityCorrection.js';
import { canonical, digest, fail, FROZEN_COMPATIBILITY_SHA, validateManifest } from './contract.mjs';
import { hostedProof } from './observations.mjs';

// Explicit source/configuration successor and its reviewed runtime/schema.
// This tuple does not admit another candidate, refresh evidence or authorize a release.
export const CONFIGURATION_SUCCESSOR_PRODUCTION = Object.freeze({
  candidateSha: COMPATIBILITY_CONFIGURATION_CORRECTION.candidateSha,
  sourceProfile: COMPATIBILITY_CONFIGURATION_CORRECTION.sourceProfile,
  sourceSha256: '00d3ef338dfd55db06eeecacb0ca803878586645edfb9e4dea61efe8319a8515',
  schemaSha256: '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d',
  runtimeSha256: '7847f929a137c3b0001dbcd5174e0a6be4c8f7417a78b95a46acc44d11ef0fcf',
  previewRuntimeSha256: 'ce69bfac777f6886f13326f8a6972ae73d6121f4aa4dda33c26ee313caa0cc59',
});

// The diagnostic-only child keeps the exact reviewed runtime/schema and source
// algorithm; only its independently measured immutable source digest changes.
export const DIAGNOSTIC_SUCCESSOR_PRODUCTION = Object.freeze({
  ...CONFIGURATION_SUCCESSOR_PRODUCTION,
  candidateSha: COMPATIBILITY_DIAGNOSTIC_CORRECTION.candidateSha,
  sourceProfile: COMPATIBILITY_DIAGNOSTIC_CORRECTION.sourceProfile,
  sourceSha256: '9f8b01198784d1e222f96f726207ef9c980f9ab5d2536e7a156ca97b2f307912',
});

// Exact real runtime-dependency child. This source pin is not Production proof.
export const RUNTIME_DEPENDENCY_SUCCESSOR_PRODUCTION = Object.freeze({
  ...CONFIGURATION_SUCCESSOR_PRODUCTION,
  candidateSha: COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION.candidateSha,
  sourceProfile: COMPATIBILITY_RUNTIME_DEPENDENCY_CORRECTION.sourceProfile,
  sourceSha256: 'd460d7c3a665799f229bec782322e7a97a52122e4c4ec75bad51551be82ec840',
});

function configurationSuccessorAccepted({ manifest, prior, registered, actual, observation, reference, now, pin }) {
  try { validateManifest(registered); validateManifest(manifest); } catch { return false; }
  // The next manifest's previousProduction comes from its fresh authenticated
  // observation. The stored live result itself contains deployment metadata,
  // not an invented runtime/schema observation.
  return manifest.stage === 'application' && manifest.executionMode === 'release'
    && registered.candidate.sha === pin.candidateSha && registered.candidate.sourceProfile === pin.sourceProfile
    && registered.candidate.sourceSha256 === pin.sourceSha256
    && registered.migration.mode === 'none' && registered.migration.expectedSchemaSha256 === pin.schemaSha256
    && registered.runtime.expectedSha256 === pin.runtimeSha256
    && digest(registered.runtime.expectedProduction) === pin.runtimeSha256
    && digest(registered.runtime.expectedPreview) === pin.previewRuntimeSha256
    && registered.releaseId === reference.releaseId && registered.epoch === manifest.epoch
    && prior.registration.release_id === reference.releaseId && prior.registration.scope === 'release'
    && prior.registration.manifest_hash === reference.manifestHash
    && canonical(registered.targets) === canonical(manifest.targets)
    && actual.sha === pin.candidateSha && actual.sourceSha256 === pin.sourceSha256
    && actual.target === 'production' && actual.state === 'READY'
    && actual.projectId === manifest.targets.vercelProject && actual.teamId === manifest.targets.vercelTeam
    && actual.manifestHash === reference.manifestHash
    && manifest.previousProduction.sha === pin.candidateSha && manifest.previousProduction.sourceSha256 === pin.sourceSha256
    && manifest.previousProduction.schemaSha256 === pin.schemaSha256 && manifest.previousProduction.runtimeSha256 === pin.runtimeSha256
    && Date.parse(observation.capturedAt) <= now() + 30000;
}

/** An application release can consume only the completed compatibility release's
 * immutable live observation. The current Production comparison still runs at stage. */
export async function collectCompatibilitySuccessor({ manifest, coordinator, env, now = Date.now }) {
  const reference = manifest.scope.compatibilityRelease;
  if (!reference || !/^[a-z0-9][a-z0-9-]{7,95}$/.test(reference.releaseId || '')
    || !/^[a-f0-9]{64}$/.test(reference.manifestHash || '')) fail('COMPATIBILITY_RELEASE_REFERENCE_REQUIRED');
  const prior = await coordinator.snapshot(reference), registered = prior.registration?.manifest;
  const observation = prior.checks?.['production.live_verified']?.evidence || prior.checks?.['production.live_verified'];
  const actual = observation?.result;
  const original = registered?.candidate?.sha === FROZEN_COMPATIBILITY_SHA
    && actual?.sha === FROZEN_COMPATIBILITY_SHA && manifest.previousProduction.sha === FROZEN_COMPATIBILITY_SHA;
  const pin = [CONFIGURATION_SUCCESSOR_PRODUCTION, DIAGNOSTIC_SUCCESSOR_PRODUCTION, RUNTIME_DEPENDENCY_SUCCESSOR_PRODUCTION]
    .find(value => registered?.candidate?.sha === value.candidateSha);
  const configurationSuccessor = pin && actual
    && configurationSuccessorAccepted({ manifest, prior, registered, actual, observation, reference, now, pin });
  if (prior.status !== 'complete' || prior.finished !== true || registered?.stage !== 'compatibility'
    || registered.executionMode !== 'release' || !(original || configurationSuccessor)
    || digest(registered) !== reference.manifestHash || registered.scope?.existingUi !== false
    || registered.scope?.handoffs?.length !== 0 || !Number.isFinite(Date.parse(observation?.capturedAt))
    || digest(observation) !== manifest.scope.compatibilityProductionObservationSha256
    || actual?.id !== manifest.previousProduction.deploymentId) fail('COMPATIBILITY_PRODUCTION_NOT_ACCEPTED');
  return hostedProof({ manifest, checkId: 'compatibility_production_observation', kind: 'deterministic',
    capturedAt: new Date(now()).toISOString(), env, inputs: reference,
    result: { releaseId: reference.releaseId, manifestHash: reference.manifestHash,
      observationSha256: digest(observation), originalCapturedAt: observation.capturedAt,
      deploymentId: actual.id, candidateSha: actual.sha, financialAuthority: false } });
}
