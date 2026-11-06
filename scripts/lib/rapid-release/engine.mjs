import { assertAuthorization, digest, requireCondition, validateManifest } from './contract.mjs';

const events = records => records.map(record => record.payload);
export function phaseResult(records, phase) { return events(records).filter(event => event.event === `${phase}.result`).at(-1)?.data; }
export async function executeOperation({ phase, manifest, journal, provider, request, submit }) {
  const manifestHash = validateManifest(manifest), records = events(await journal.read());
  const result = records.filter(event => event.event === `${phase}.result`).at(-1)?.data;
  if (result) {
    requireCondition(result.outcome === 'applied', 'PRIOR_OPERATION_FAILED');
    return result.result;
  }
  const saved = records.filter(event => event.event === `${phase}.intent`).at(-1)?.data;
  const operationId = `${manifest.releaseId}-${phase}`, requestHash = digest(request);
  if (saved) {
    requireCondition(saved.operationId === operationId && saved.requestHash === requestHash, 'OPERATION_REQUEST_CHANGED');
    const observed = await provider.discover({ phase, operationId, manifestHash, request });
    if (observed?.outcome !== 'applied') return { waiting: true, code: 'ORIGINAL_OPERATION_READBACK_REQUIRED', operationId };
    await journal.append(`${phase}.result`, { operationId, outcome: 'applied', result: observed.result });
    return observed.result;
  }
  await journal.assertNoUnresolvedOtherRelease();
  // These checks run immediately before the durable intent and callback. Never retry inside the callback.
  await provider.assertOwnership({ phase, manifest, manifestHash });
  await journal.append(`${phase}.intent`, { operationId, requestHash, request });
  let applied;
  try { applied = await submit({ operationId, manifestHash, request }); }
  catch {
    await journal.append('release.waiting', { code: 'PROVIDER_OUTCOME_UNCERTAIN', phase, operationId });
    return { waiting: true, code: 'ORIGINAL_OPERATION_READBACK_REQUIRED', operationId };
  }
  requireCondition(applied && typeof applied === 'object', 'PROVIDER_ACKNOWLEDGEMENT_MISSING');
  await journal.append(`${phase}.result`, { operationId, outcome: 'applied', result: applied }); return applied;
}
export function assertBuildReceipt(receipt, manifest) {
  requireCondition(receipt?.schemaVersion === 1 && receipt.buildId === manifest.build.buildId
    && receipt.candidateSha === manifest.candidate.sha && receipt.sourceDigest === manifest.candidate.sourceDigest
    && receipt.lockDigest === manifest.candidate.lockDigest && /^[a-f0-9]{64}$/.test(receipt.artifactDigest || '')
    && receipt.controllerSha === manifest.controllerSha && receipt.qualityPassed === true
    && receipt.performancePassed === true && receipt.node === manifest.build.node, 'BUILD_RECEIPT_MISMATCH');
}
export function assertSmokeProof(proof, manifest, staged) {
  requireCondition(proof?.passed === true && proof.deploymentId === staged.id && proof.buildId === manifest.build.buildId
    && proof.login === true && proof.restrictedAccess === true && proof.businessWrites === 0
    && manifest.selection.modules.every(module => proof.modules?.includes(module))
    && (!manifest.selection.normalRole || proof.normalRole === true), 'STAGED_SMOKE_INCOMPLETE');
}
export async function stageRelease({ manifest, journal, provider, build, smoke }) {
  validateManifest(manifest); assertBuildReceipt(build, manifest);
  await provider.assertOwnership({ phase: 'stage', manifest, manifestHash: digest(manifest) });
  let records = await journal.read();
  if (!events(records).some(event => event.event === 'release.prepared')) await journal.append('release.prepared', { manifest });
  if (!events(records).some(event => event.event === 'build.passed')) await journal.append('build.passed', build);
  const request = { buildId: build.buildId, artifactDigest: build.artifactDigest, candidateSha: manifest.candidate.sha,
    previousDeploymentId: manifest.previous.deploymentId, target: 'production', skipDomain: true };
  const staged = await executeOperation({ phase: 'stage', manifest, journal, provider, request,
    submit: context => provider.stage({ manifest, build, ...context }) });
  if (staged.waiting) return staged;
  const ready = await provider.ready(staged.id);
  requireCondition(ready.id === staged.id && ready.state === 'READY' && ready.buildId === build.buildId
    && ready.artifactDigest === build.artifactDigest && ready.sha === manifest.candidate.sha && ready.target === 'production', 'STAGED_BUILD_NOT_READY');
  records = await journal.read();
  const existing = events(records).find(event => event.event === 'smoke.passed' && event.data.deploymentId === ready.id);
  if (!existing) {
    const proof = await smoke({ manifest, staged: ready });
    assertSmokeProof(proof, manifest, ready);
    await journal.append('smoke.passed', proof);
  }
  return { state: 'ready_for_decision', manifestHash: digest(manifest), staged: ready,
    conditionalPrerequisites: manifest.selection.salesforce || manifest.selection.database };
}
export async function promoteRelease({ manifest, journal, provider, approval, prerequisites, smoke, observe }) {
  validateManifest(manifest);
  const records = await journal.read(), all = events(records), stagedReference = phaseResult(records, 'stage')?.result;
  requireCondition(stagedReference && all.some(event => event.event === 'smoke.passed' && event.data.deploymentId === stagedReference.id), 'STAGED_ACCEPTANCE_REQUIRED');
  const staged = await provider.ready(stagedReference.id);
  requireCondition(staged.id === stagedReference.id && staged.state === 'READY' && staged.buildId === manifest.build.buildId
    && staged.sha === manifest.candidate.sha, 'STAGED_ACCEPTANCE_CHANGED');
  assertAuthorization(approval, manifest, staged);
  await provider.verifyApproval(approval, { manifest, staged });
  if (all.some(event => event.event === 'release.complete')) return { state: 'complete', deploymentId: staged.id, reused: true };
  if (!all.some(event => event.event === 'approval.accepted')) await journal.append('approval.accepted', approval);
  if (manifest.selection.salesforce || manifest.selection.database) {
    requireCondition(typeof prerequisites === 'function', 'APPROVED_PREREQUISITES_REQUIRED');
    let prerequisite = all.find(event => event.event === 'prerequisites.passed')?.data;
    if (!prerequisite) {
      const result = await prerequisites({ manifest, approval });
      requireCondition(result?.passed === true && result.manifestHash === digest(manifest) && result.backwardCompatible === true, 'PREREQUISITE_VERIFICATION_REQUIRED');
      await journal.append('prerequisites.passed', result);
      prerequisite = result;
    }
    const prerequisiteDigest = digest(prerequisite);
    if (!events(await journal.read()).some(event => event.event === 'prerequisites.smoke_passed'
      && event.data.prerequisiteDigest === prerequisiteDigest && event.data.deploymentId === staged.id)) {
      const currentStage = await provider.ready(staged.id);
      const acceptance = await smoke({ manifest, staged: currentStage }); assertSmokeProof(acceptance, manifest, currentStage);
      await journal.append('prerequisites.smoke_passed', { ...acceptance, prerequisiteDigest });
    }
  }
  const previousResult = phaseResult(await journal.read(), 'promote');
  const current = await provider.currentProduction();
  requireCondition(current.id === manifest.previous.deploymentId || previousResult?.result?.id === current.id
    || events(await journal.read()).some(event => event.event === 'promote.intent') && current.id === staged.id, 'PRODUCTION_BASELINE_CHANGED');
  const promoted = await executeOperation({ phase: 'promote', manifest, journal, provider,
    request: { deploymentId: staged.id, previousDeploymentId: manifest.previous.deploymentId, buildId: manifest.build.buildId },
    submit: context => provider.promote({ manifest, staged, approval, ...context }) });
  if (promoted.waiting) return promoted;
  requireCondition(promoted.id === staged.id, 'PROMOTED_DEPLOYMENT_MISMATCH');
  try {
    const live = await observe({ manifest, staged, durationMs: 300000 });
    requireCondition(live?.passed === true && live.deploymentId === staged.id && live.buildId === manifest.build.buildId
      && live.observationMs >= 300000, 'LIVE_VERIFICATION_FAILED');
    await journal.append('live.passed', live); await journal.append('release.complete', { deploymentId: staged.id });
    return { state: 'complete', deploymentId: staged.id };
  } catch {
    const stillCurrent = await provider.currentProduction();
    if (stillCurrent.id !== staged.id) return { state: 'intervention_required', code: 'NEWER_PRODUCTION_PRESERVED' };
    const compatibility = await provider.rollbackCompatibility({ manifest, previous: manifest.previous });
    if (compatibility?.compatible !== true || compatibility.deploymentId !== manifest.previous.deploymentId)
      return { state: 'intervention_required', code: 'ROLLBACK_COMPATIBILITY_UNPROVEN' };
    const rolledBack = await executeOperation({ phase: 'rollback', manifest, journal, provider,
      request: { deploymentId: manifest.previous.deploymentId, currentDeploymentId: staged.id, compatibilityDigest: digest(compatibility) },
      submit: context => provider.rollback({ manifest, previous: manifest.previous, ...context }) });
    if (rolledBack.waiting) return rolledBack;
    await provider.verifyRollback({ manifest, previous: manifest.previous });
    return { state: 'rolled_back', deploymentId: manifest.previous.deploymentId };
  }
}
