import { digest, fail, FROZEN_COMPATIBILITY_SHA } from './contract.mjs';
import { hostedProof } from './observations.mjs';

/** An application release can consume only the completed compatibility release's
 * immutable live observation. The current Production comparison still runs at stage. */
export async function collectCompatibilitySuccessor({ manifest, coordinator, env, now = Date.now }) {
  const reference = manifest.scope.compatibilityRelease;
  if (!reference || !/^[a-z0-9][a-z0-9-]{7,95}$/.test(reference.releaseId || '')
    || !/^[a-f0-9]{64}$/.test(reference.manifestHash || '')) fail('COMPATIBILITY_RELEASE_REFERENCE_REQUIRED');
  const prior = await coordinator.snapshot(reference), registered = prior.registration?.manifest;
  const observation = prior.checks?.['production.live_verified']?.evidence || prior.checks?.['production.live_verified'];
  const actual = observation?.result;
  if (prior.status !== 'complete' || prior.finished !== true || registered?.stage !== 'compatibility'
    || registered.executionMode !== 'release' || registered.candidate?.sha !== FROZEN_COMPATIBILITY_SHA
    || digest(registered) !== reference.manifestHash || registered.scope?.existingUi !== false
    || registered.scope?.handoffs?.length !== 0 || !Number.isFinite(Date.parse(observation?.capturedAt))
    || digest(observation) !== manifest.scope.compatibilityProductionObservationSha256
    || actual?.id !== manifest.previousProduction.deploymentId || actual.sha !== FROZEN_COMPATIBILITY_SHA
    || manifest.previousProduction.sha !== FROZEN_COMPATIBILITY_SHA) fail('COMPATIBILITY_PRODUCTION_NOT_ACCEPTED');
  return hostedProof({ manifest, checkId: 'compatibility_production_observation', kind: 'deterministic',
    capturedAt: new Date(now()).toISOString(), env, inputs: reference,
    result: { releaseId: reference.releaseId, manifestHash: reference.manifestHash,
      observationSha256: digest(observation), originalCapturedAt: observation.capturedAt,
      deploymentId: actual.id, candidateSha: actual.sha, financialAuthority: false } });
}
