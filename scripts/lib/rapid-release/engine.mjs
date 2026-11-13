import { requiresCompanyFxHistorySmoke, requiresSupplierBucketSmoke, requiresGroupedPetroleumSmoke, requiresTradingFxSmoke,
  assertAuthorization, digest, requireCondition, validateManifest } from './contract.mjs';

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
function supplierBucketSmokeVerified(proof, manifest) {
  return !requiresSupplierBucketSmoke(manifest)
    || proof?.supplierBucket?.restrictedVerified === true && proof.supplierBucket.normalVerified === true;
}
function groupedPetroleumSmokeVerified(proof, manifest) {
  return !requiresGroupedPetroleumSmoke(manifest)
    || proof?.groupedPetroleum?.restrictedVerified === true && proof.groupedPetroleum.normalVerified === true
      && proof.groupedPetroleum.desktopVerified === true;
}
function tradingFxSmokeVerified(proof, manifest) {
  return !requiresTradingFxSmoke(manifest)
    || proof?.tradingFx?.restrictedVerified === true && proof.tradingFx.normalVerified === true
      && proof.tradingFx.desktopVerified === true;
}
export function assertSmokeProof(proof, manifest, staged) {
  requireCondition(proof?.passed === true && proof.deploymentId === staged.id && proof.buildId === manifest.build.buildId
    && proof.login === true && proof.restrictedAccess === true && proof.businessWrites === 0
    && manifest.selection.modules.every(module => proof.modules?.includes(module))
    && (!manifest.selection.normalRole || proof.normalRole === true), 'STAGED_SMOKE_INCOMPLETE');
  requireCondition(supplierBucketSmokeVerified(proof, manifest), 'SMOKE_SUPPLIER_BUCKET_ROUTE_BOUNDARY_FAILED');
  requireCondition(groupedPetroleumSmokeVerified(proof, manifest), 'SMOKE_GROUPED_PETROLEUM_BOUNDARY_REQUIRED');
  requireCondition(tradingFxSmokeVerified(proof, manifest), 'SMOKE_TRADING_FX_BOUNDARY_REQUIRED');
}
export function assertPreBootstrapProof(proof, manifest, staged) {
  const plan = manifest.prerequisites?.plan;
  const selected = manifest.selection.modules;
  const deferred = plan?.deferredModules;
  const completed = proof?.completedModules;
  const exactModules = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
    && new Set(actual).size === actual.length && actual.every(module => expected.includes(module));
  requireCondition((manifest.selection.salesforce || manifest.selection.database) && plan?.deferSchemaDependentSmoke === true
    && Array.isArray(deferred) && deferred.length > 0 && new Set(deferred).size === deferred.length
    && deferred.every(module => selected.includes(module) && !['dashboard', 'markets'].includes(module))
    && proof?.passed === true && proof.mode === 'pre_bootstrap' && proof.manifestHash === digest(manifest)
    && proof.deploymentId === staged.id && proof.buildId === manifest.build.buildId && proof.isolationVerified === true
    && (!manifest.selection.normalRole || proof.normalRole === true)
    && proof.businessWrites === 0 && proof.bootstrapFingerprint === plan.bootstrapFingerprint
    && /^[a-f0-9]{64}$/.test(proof.bootstrapFingerprint || '') && exactModules(proof.deferredChecks, deferred)
    && exactModules(completed, selected.filter(module => !deferred.includes(module)))
    && Array.isArray(proof.completedChecks) && ['runtime_identity', 'authenticated_login', 'authentication_denials', 'request_isolation']
      .every(check => proof.completedChecks.includes(check)), 'PREBOOTSTRAP_STAGE_PROOF_REQUIRED');
  requireCondition(tradingFxSmokeVerified(proof, manifest), 'SMOKE_TRADING_FX_BOUNDARY_REQUIRED');
}
export async function stageRelease({ manifest, journal, provider, build, smoke, beforeBootstrap }) {
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
  const deferred = (manifest.selection.salesforce || manifest.selection.database) && manifest.prerequisites?.plan?.deferSchemaDependentSmoke === true;
  const acceptanceEvent = deferred ? 'stage.pre_bootstrap_passed' : 'smoke.passed';
  const existing = events(records).find(event => event.event === acceptanceEvent && event.data.deploymentId === ready.id);
  if (existing && deferred) assertPreBootstrapProof(existing.data, manifest, ready);
  if (existing && (requiresSupplierBucketSmoke(manifest) || requiresGroupedPetroleumSmoke(manifest)
    || !deferred && requiresTradingFxSmoke(manifest))) assertSmokeProof(existing.data, manifest, ready);
  if (!existing) {
    if (deferred) {
      requireCondition(typeof beforeBootstrap === 'function', 'QUALIFIED_PREBOOTSTRAP_VERIFIER_REQUIRED');
      const proof = await beforeBootstrap({ manifest, staged: ready });
      assertPreBootstrapProof(proof, manifest, ready);
      await journal.append(acceptanceEvent, proof);
    } else {
      const proof = await smoke({ manifest, staged: ready }); assertSmokeProof(proof, manifest, ready);
      await journal.append(acceptanceEvent, proof);
    }
  }
  return { state: deferred ? 'awaiting_authorized_bootstrap' : 'ready_for_decision', deferredChecks: deferred ? manifest.prerequisites.plan.deferredModules : [], manifestHash: digest(manifest), staged: ready,
    conditionalPrerequisites: manifest.selection.salesforce || manifest.selection.database };
}
export async function promoteRelease({ manifest, journal, provider, approval, prerequisites, smoke, observe }) {
  validateManifest(manifest);
  const records = await journal.read(), all = events(records), stagedReference = phaseResult(records, 'stage')?.result;
  const preBootstrap = all.find(event => event.event === 'stage.pre_bootstrap_passed' && event.data.deploymentId === stagedReference?.id)?.data;
  const build = all.find(event => event.event === 'build.passed')?.data;
  const fullStage = all.find(event => event.event === 'smoke.passed' && event.data.deploymentId === stagedReference?.id);
  const deferred = manifest.prerequisites?.plan?.deferSchemaDependentSmoke === true;
  requireCondition(stagedReference && (deferred ? preBootstrap : fullStage), 'STAGED_ACCEPTANCE_REQUIRED');
  if (deferred) assertPreBootstrapProof(preBootstrap, manifest, stagedReference);
  if (requiresSupplierBucketSmoke(manifest) || requiresGroupedPetroleumSmoke(manifest)
    || !deferred && requiresTradingFxSmoke(manifest)) assertSmokeProof(fullStage?.data, manifest, stagedReference);
  assertBuildReceipt(build, manifest);
  const staged = await provider.ready(stagedReference.id);
  requireCondition(staged.id === stagedReference.id && staged.state === 'READY' && staged.buildId === manifest.build.buildId
    && staged.sha === manifest.candidate.sha && staged.target === 'production' && staged.artifactDigest === build.artifactDigest,
  'STAGED_ACCEPTANCE_CHANGED');
  assertAuthorization(approval, manifest, staged);
  await provider.verifyApproval(approval, { manifest, staged });
  if (all.some(event => event.event === 'release.complete')) return { state: 'complete', deploymentId: staged.id, reused: true };
  if (!all.some(event => event.event === 'approval.accepted')) await journal.append('approval.accepted', approval);
  if (manifest.selection.salesforce || manifest.selection.database) {
    await journal.assertNoUnresolvedOtherRelease();
    await provider.assertOwnership({ phase: 'prerequisites', manifest, manifestHash: digest(manifest) });
    requireCondition(typeof prerequisites === 'function', 'APPROVED_PREREQUISITES_REQUIRED');
    const prior = phaseResult(records, 'prerequisites');
    requireCondition(!prior || prior.outcome === 'applied', 'PREREQUISITE_RELEASE_CLOSED');
    let prerequisite = all.find(event => event.event === 'prerequisites.passed')?.data || prior?.result;
    if (!prerequisite) {
      const operationId = `${manifest.releaseId}-prerequisites`, request = { planDigest: digest(manifest.prerequisites), candidateSha: manifest.candidate.sha };
      const intent = all.find(event => event.event === 'prerequisites.intent')?.data;
      if (intent) requireCondition(intent.operationId === operationId && intent.requestHash === digest(request), 'PREREQUISITE_INTENT_CHANGED');
      else await journal.append('prerequisites.intent', { operationId, requestHash: digest(request), request });
      // Reentry resumes the qualified adapter's own per-operation journal/readback;
      // it must never resubmit an uncertain provider operation.
      const result = await prerequisites({ manifest, approval });
      requireCondition(result?.passed === true && result.manifestHash === digest(manifest) && result.backwardCompatible === true, 'PREREQUISITE_VERIFICATION_REQUIRED');
      await journal.append('prerequisites.result', { operationId, outcome: 'applied', result });
      await journal.append('prerequisites.passed', result);
      prerequisite = result;
    }
    const prerequisiteDigest = digest(prerequisite);
    const historyRequired = requiresCompanyFxHistorySmoke(manifest);
    if (!events(await journal.read()).some(event => event.event === 'prerequisites.smoke_passed'
      && event.data.prerequisiteDigest === prerequisiteDigest && event.data.deploymentId === staged.id
      && supplierBucketSmokeVerified(event.data, manifest)
      && groupedPetroleumSmokeVerified(event.data, manifest)
      && tradingFxSmokeVerified(event.data, manifest)
      && (!historyRequired || event.data.companyFxHistory?.readVerified === true && event.data.companyFxHistory?.writeDenied === true))) {
      const currentStage = await provider.ready(staged.id);
      requireCondition(currentStage.id === staged.id && currentStage.state === 'READY' && currentStage.buildId === staged.buildId
        && currentStage.sha === staged.sha && currentStage.target === staged.target && currentStage.artifactDigest === staged.artifactDigest,
      'STAGED_ACCEPTANCE_CHANGED');
      const acceptance = await smoke({ manifest, staged: currentStage, afterPrerequisites: true });
      assertSmokeProof(acceptance, manifest, currentStage);
      requireCondition(!historyRequired || acceptance.companyFxHistory?.readVerified === true
        && acceptance.companyFxHistory?.writeDenied === true, 'SMOKE_COMPANY_FX_HISTORY_REQUIRED');
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
