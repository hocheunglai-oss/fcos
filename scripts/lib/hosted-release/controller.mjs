import { assertBoundEvidence, digest, fail, ReleaseError, validateManifest } from './contract.mjs';
import { atReleaseBoundary, isReleaseBoundary } from './failure.mjs';
import { safeVercelCommandFailure } from './vercel-command-failure.mjs';
import { safeVercelSourceApiFailure } from './vercel-source-api.mjs';

const bound = manifest => ({ releaseId: manifest.releaseId, manifestHash: digest(manifest) });

/** All writes pass the same durable remote journal. Runner-local files are diagnostics only. */
export async function consequential({ manifest, phase, request, coordinator, submit, readback }) {
  const binding = bound(manifest), operationId = `${manifest.releaseId}-${phase.replaceAll('.', '-')}`;
  const claim = await coordinator.begin({ ...binding, phase, operationId, requestHash: digest(request) });
  if (claim.disposition === 'busy') fail('COORDINATOR_BUSY', phase, 'Wait for the exact existing owner; never expire or steal its operation.');
  if (claim.disposition === 'complete') {
    const evidence = claim.evidence ?? claim.operation?.evidence;
    if (evidence?.outcome !== 'applied') fail('OPERATION_CONSUMED_NOT_APPLIED', phase, 'Prepare a distinct reviewed operation; this intent remains consumed.');
    return evidence.result;
  }
  if (!['execute', 'readback'].includes(claim.disposition)) fail('INVALID_COORDINATOR_RESPONSE', phase);
  if (claim.disposition === 'execute') {
    let value;
    try {
      value = await submit({ operationId, request });
      if (value === undefined || value === null) throw new ReleaseError('PROVIDER_RESPONSE_MISSING', phase);
    }
    catch (error) {
      // Even a local transport exception can occur after submission. Never infer no write.
      const ownerRefreshRequired=error instanceof ReleaseError&&error.code==='FIRST_RUNTIME_OWNER_REFRESH_REQUIRED'
        &&error.detail?.providerSubmissionStarted===false;
      const commandFailure = error instanceof ReleaseError ? safeVercelCommandFailure(error.detail?.commandFailure) : undefined;
      const sourceApiFailure = error instanceof ReleaseError ? safeVercelSourceApiFailure(error.detail?.sourceApiFailure) : undefined;
      const diagnostics = { ...(commandFailure ? { commandFailure } : {}), ...(sourceApiFailure ? { sourceApiFailure } : {}) };
      const reason = ownerRefreshRequired ? 'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED_BEFORE_SUBMISSION' : 'PROVIDER_RESPONSE_LOST';
      try {
        await coordinator.uncertain({ ...binding, phase, operationId, reason,
          ...(Object.keys(diagnostics).length ? { evidence: { outcome: 'unknown', reason, ...diagnostics } } : {}) });
      } catch (coordinationError) {
        // A lost journal response must not erase the only local command report.
        // Keep the coordination refusal authoritative, without copying a raw cause.
        const stopped = coordinationError instanceof ReleaseError ? coordinationError
          : new ReleaseError('COORDINATION_UNCERTAINTY_UNCONFIRMED', 'coordinator.uncertain',
            'Read the original intent and uncertainty result separately; do not retry the provider operation.');
        if (Object.keys(diagnostics).length) stopped.detail = diagnostics;
        throw stopped;
      }
      // Preserve the consumed intent. This precise trusted pre-launch guard can
      // wait for its dependency, but cannot turn a restart into a second submit.
      if(ownerRefreshRequired)throw error;
      // Stop this enclosing operation. Recovery is a separate admitted readback;
      // even a GET must not silently follow a refused, thrown or timed-out write.
      throw new ReleaseError('PROVIDER_OUTCOME_UNKNOWN', phase,
        'Resume GET-only readback for this exact operation; do not resubmit.',
        diagnostics);
    }
    if (value !== undefined) {
      const evidence = { outcome: 'applied', result: value };
      // If this response is lost, the saved intent remains readback-only on restart.
      await coordinator.complete({ ...binding, phase, operationId, evidence });
      return value;
    }
  }
  const observed = await readback({ operationId, request });
  if (!observed || observed.outcome === 'unknown') fail('PROVIDER_OUTCOME_UNKNOWN', phase, 'Resume GET-only readback for this exact operation; do not resubmit.');
  if (!['applied', 'not_applied'].includes(observed.outcome)) fail('INVALID_PROVIDER_READBACK', phase);
  await coordinator.readback({ ...binding, phase, operationId, evidence: observed });
  if (observed.outcome !== 'applied') fail('OPERATION_CONSUMED_NOT_APPLIED', phase, 'The operation remains consumed; a distinct authorized operation is required.');
  return observed.result;
}

function assertDeployment(deployment, manifest, target) {
  if (!/^dpl_[a-zA-Z0-9]+$/.test(deployment?.id || '') || deployment.sha !== manifest.candidate.sha
    || deployment.target !== target || deployment.projectId !== manifest.targets.vercelProject
    || deployment.teamId !== manifest.targets.vercelTeam) fail('DEPLOYMENT_IDENTITY', `${target}.verify`);
  let url;
  try { url = new URL(deployment.url); } catch { fail('DEPLOYMENT_ORIGIN'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') || url.username || url.password || url.port
    || url.pathname !== '/' || url.search || url.hash) fail('DEPLOYMENT_ORIGIN');
  return deployment;
}

async function evidenceWrite(coordinator, manifest, key, result, now) {
  await coordinator.appendEvidence({ ...bound(manifest), key, evidence: { result, capturedAt: new Date(now()).toISOString() } });
}

export function terminalReleaseStatus(snapshot, manifest) {
  if (!['complete', 'rolled_back'].includes(snapshot?.status)) return null;
  const registration = snapshot.registration, manifestHash = digest(manifest);
  if (snapshot.finished !== true || registration?.release_id !== manifest.releaseId
    || registration.epoch !== manifest.epoch || registration.manifest_hash !== manifestHash
    || !registration.manifest || digest(registration.manifest) !== manifestHash) fail('TERMINAL_RELEASE_BINDING', 'release.recovery');
  return snapshot.status;
}

export async function preparePreview({ manifest, coordinator, provider, now = Date.now }) {
  validateManifest(manifest);
  await atReleaseBoundary('preview.register', () => coordinator.register({ ...bound(manifest), manifest }));
  const snapshot = await atReleaseBoundary('preview.snapshot', () => coordinator.snapshot(bound(manifest)));
  const terminal = terminalReleaseStatus(snapshot, manifest);
  if (terminal) return { status: terminal, resumed: true };
  await atReleaseBoundary('preview.admit', () => provider.admit(manifest, 'preview'));
  if (!snapshot.operations?.['preview.create']) provider.assertWriteCapability?.();
  const request = provider.preparePreviewRequest
    ? await provider.preparePreviewRequest(manifest, { operationId: `${manifest.releaseId}-preview-create`, existingOperation: snapshot.operations?.['preview.create'] })
    : { candidate: manifest.candidate, target: 'preview' };
  const preview = await consequential({ manifest, coordinator, phase: 'preview.create', request,
    submit: context => provider.createPreview(manifest, context), readback: context => provider.discover(manifest, 'preview', context) });
  assertDeployment(preview, manifest, 'preview');
  // Building is a dependency, not a false proof failure; a restart polls the same deployment.
  const ready = await provider.ready(preview);
  if (ready.state !== 'READY') return { status: 'waiting_dependency', phase: 'preview.ready', deploymentId: preview.id };
  assertDeployment(ready, manifest, 'preview');
  await provider.verifyArtifact(ready, manifest, 'preview');
  await evidenceWrite(coordinator, manifest, 'preview.ready', ready, now);
  return { status: 'ready', phase: 'preview.ready', deployment: ready };
}

export async function collectAcceptance({ manifest, coordinator, provider, now = Date.now, refresh = false }) {
  validateManifest(manifest);
  const snapshot = await coordinator.snapshot(bound(manifest)), checks = { ...snapshot.checks };
  const missing = [];
  for (const id of manifest.requiredChecks) {
    let proof = checks[id];
    if (proof?.evidence) proof = proof.evidence;
    try { assertBoundEvidence(proof, manifest, id, { now: now() }); }
    catch (error) {
      if (!(error instanceof ReleaseError)) throw error;
      // Refresh only the affected volatile observation. No deterministic suite is restarted here.
      if (refresh && (proof?.kind === 'volatile' || !proof) && typeof provider.collectCheck === 'function') {
        const refreshed = await provider.collectCheck(id, manifest, snapshot);
        if (refreshed) {
          assertBoundEvidence(refreshed, manifest, id, { now: now() });
          await coordinator.appendEvidence({ ...bound(manifest), key: id, evidence: refreshed }); proof = refreshed;
        } else { missing.push(id); continue; }
      } else { missing.push(id); continue; }
    }
    checks[id] = proof;
  }
  return { status: missing.length ? 'waiting_dependency' : 'ready', checks, missing };
}

async function rollback({ manifest, coordinator, provider, staged, cause, now }) {
  if (manifest.authorization.rollback.mode !== 'compatible_previous_only') fail('ROLLBACK_NOT_AUTHORIZED', 'production.rollback');
  const previous = manifest.previousProduction;
  const current = await provider.currentProduction();
  if (current.id !== staged.id && current.id !== previous.deploymentId) fail('ROLLBACK_PRODUCTION_MOVED', 'production.rollback', 'Another release owns Production. Inspect it; do not change its domains.');
  // Compatibility is observed now, never inferred from a formerly passing Preview.
  const compatible = await provider.rollbackCompatibility(previous, manifest);
  if (compatible?.compatible !== true || compatible.schemaSha256 !== manifest.migration.expectedSchemaSha256
    || compatible.runtimeSha256 !== manifest.runtime.expectedSha256 || compatible.deploymentId !== previous.deploymentId) fail('ROLLBACK_INCOMPATIBLE', 'production.rollback', 'Keep the operation recorded and request intervention; no schema rollback is permitted.');
  provider.assertWriteCapability?.();
  const restored = await consequential({ manifest, coordinator, phase: 'production.rollback', request: { from: staged.id, to: previous.deploymentId, schemaSha256: compatible.schemaSha256, runtimeSha256: compatible.runtimeSha256 },
    submit: async context => {
      // A second observation closes the local check-to-write gap; shared coordination fences all participating writers.
      await provider.admit(manifest, 'production.rollback');
      const before = await provider.currentProduction();
      if (before.id === previous.deploymentId) return before;
      if (before.id !== staged.id) fail('ROLLBACK_PRODUCTION_MOVED', 'production.rollback');
      await provider.rollback(previous, context);
      const restored = await provider.currentProduction();
      if (restored.id !== previous.deploymentId || restored.sha !== previous.sha) fail('ROLLBACK_NOT_OBSERVED', 'production.rollback');
      return restored;
    },
    readback: async () => {
      const live = await provider.currentProduction();
      return live.id === previous.deploymentId && live.sha === previous.sha ? { outcome: 'applied', result: live } : { outcome: 'unknown' };
    } });
  if (restored.id !== previous.deploymentId || restored.sha !== previous.sha) fail('ROLLBACK_OUTCOME_UNKNOWN', 'production.rollback', 'Read back the exact rollback; never repeat it blindly.');
  await provider.verifyRollback(restored, manifest);
  await evidenceWrite(coordinator, manifest, 'production.rolled_back', { deploymentId: restored.id, cause }, now);
  await coordinator.finish({ ...bound(manifest), status: 'rolled_back' });
  return { status: 'rolled_back', deploymentId: restored.id, cause };
}

export async function reconcilePending({ manifest, coordinator, provider }) {
  let snapshot = await coordinator.snapshot(bound(manifest));
  for (const [phase, operation] of Object.entries(snapshot.operations || {})) {
    if (operation.state === 'complete') continue;
    const operationId = operation.operationId || operation.operation_id;
    let observed;
    if (phase === 'preview.create' || phase === 'production.stage') observed = await provider.discover(manifest, phase === 'preview.create' ? 'preview' : 'production', { operationId });
    else if (phase === 'production.promote' || phase === 'production.rollback') {
      const live = await provider.currentProduction(), target = phase === 'production.rollback'
        ? { id: manifest.previousProduction.deploymentId, sha: manifest.previousProduction.sha }
        : snapshot.operations['production.stage']?.evidence?.result;
      observed = target && live.id === target.id && live.sha === target.sha ? { outcome: 'applied', result: live } : { outcome: 'unknown' };
    } else continue;
    if (observed?.outcome !== 'applied') fail('PROVIDER_OUTCOME_UNKNOWN', phase, 'Continue GET-only discovery of the consumed intent; elapsed authority cannot authorize replay.');
    await coordinator.readback({ ...bound(manifest), phase, operationId, evidence: observed });
    snapshot = await coordinator.snapshot(bound(manifest));
  }
  return snapshot;
}

export async function executeHostedProduction({ manifest, coordinator, provider, now = Date.now, resumeAuthorization = false }) {
  validateManifest(manifest);
  if (manifest.stage === 'qualification') fail('QUALIFICATION_CANNOT_DEPLOY', 'production.stage');
  const snapshot = await reconcilePending({ manifest, coordinator, provider });
  if (['complete', 'rolled_back'].includes(snapshot.status)) return { status: snapshot.status, resumed: true };
  const restored = snapshot.operations?.['production.rollback']?.evidence;
  if (restored?.outcome === 'applied') {
    await provider.verifyRollback(restored.result, manifest);
    await coordinator.finish({ ...bound(manifest), status: 'rolled_back' });
    return { status: 'rolled_back', resumed: true, deploymentId: restored.result.id };
  }
  await provider.admit(manifest, 'production');
  // The remote coordinator validates actual GitHub review and the immutable registration.
  // A pending approval has no local execution timer and needs no chat/private signature.
  const approval = await coordinator.request(resumeAuthorization ? 'resume' : 'approve', bound(manifest));
  if (approval.manifestHash !== digest(manifest) || Date.parse(approval.expiresAt) <= now()) fail('PRODUCTION_APPROVAL_EXPIRED', 'production.approval', 'Approve this manifest again in a distinct protected authorization session.');
  const acceptance = await collectAcceptance({ manifest, coordinator, provider, now, refresh: true });
  if (acceptance.status !== 'ready') return { status: 'waiting_dependency', phase: 'production.acceptance', missing: acceptance.missing };
  const existingStage = snapshot.operations?.['production.stage'];
  if (!existingStage) {
    provider.assertWriteCapability?.();
    const current = await provider.currentProduction();
    if (current.id !== manifest.previousProduction.deploymentId || current.sha !== manifest.previousProduction.sha) fail('PRODUCTION_CHANGED', 'production.stage', 'Prepare a new manifest with the actual Production and rollback target.');
  }
  const staged = await consequential({ manifest, coordinator, phase: 'production.stage', request: { candidate: manifest.candidate, previous: manifest.previousProduction, target: 'production', skipDomain: true },
    submit: context => provider.stage(manifest, context), readback: context => provider.discover(manifest, 'production', context) });
  assertDeployment(staged, manifest, 'production');
  const ready = await provider.ready(staged);
  if (ready.state !== 'READY') return { status: 'waiting_dependency', phase: 'production.ready', deploymentId: staged.id };
  assertDeployment(ready, manifest, 'production');
  await provider.verifyArtifact(ready, manifest, 'staged');
  await evidenceWrite(coordinator, manifest, 'production.staged_verified', ready, now);
  await provider.admit(manifest, 'production.promote');
  // A slow staged build must not consume stale browser/business observations.
  // Schema is always read again at the promotion boundary, even inside its TTL.
  if (provider.collectCheck) {
    const schema = await provider.collectCheck('live_schema', manifest, await coordinator.snapshot(bound(manifest)));
    if (schema) { assertBoundEvidence(schema, manifest, 'live_schema', { now: now() }); await coordinator.appendEvidence({ ...bound(manifest), key: 'live_schema', evidence: schema }); }
  }
  const promotionAcceptance = await collectAcceptance({ manifest, coordinator, provider, now, refresh: true });
  if (promotionAcceptance.status !== 'ready') return { status: 'waiting_dependency', phase: 'production.acceptance', missing: promotionAcceptance.missing, deploymentId: ready.id };
  if (!snapshot.operations?.['production.promote']) provider.assertWriteCapability?.();
  const live = await consequential({ manifest, coordinator, phase: 'production.promote', request: { deploymentId: ready.id, previousDeploymentId: manifest.previousProduction.deploymentId },
    submit: async context => {
      const current = await provider.currentProduction();
      if (current.id === ready.id && current.sha === manifest.candidate.sha) return current;
      if (current.id !== manifest.previousProduction.deploymentId || current.sha !== manifest.previousProduction.sha) fail('PRODUCTION_CHANGED', 'production.promote');
      await provider.promote(ready, context);
      const result = await provider.currentProduction();
      if (result.id !== ready.id || result.sha !== manifest.candidate.sha) fail('PROMOTION_NOT_OBSERVED', 'production.promote');
      return result;
    },
    readback: async () => {
      const result = await provider.currentProduction();
      return result.id === ready.id && result.sha === manifest.candidate.sha ? { outcome: 'applied', result } : { outcome: 'unknown' };
    } });
  try { await provider.verifyArtifact(live, manifest, 'live'); }
  catch (error) { return rollback({ manifest, coordinator, provider, staged: ready, cause: error.code || 'LIVE_VERIFICATION_FAILED', now }); }
  await evidenceWrite(coordinator, manifest, 'production.live_verified', live, now);
  await coordinator.finish({ ...bound(manifest), status: 'complete' });
  return { status: 'complete', deploymentId: live.id, candidateSha: manifest.candidate.sha, manifestHash: digest(manifest) };
}

export function safeFailure(error) {
  const commandFailure = error instanceof ReleaseError ? safeVercelCommandFailure(error.detail?.commandFailure) : undefined;
  const sourceApiFailure = error instanceof ReleaseError ? safeVercelSourceApiFailure(error.detail?.sourceApiFailure) : undefined;
  if(error instanceof ReleaseError&&error.code==='FIRST_RUNTIME_OWNER_REFRESH_REQUIRED')return {
    status:'waiting_dependency',code:error.code,phase:error.phase,recovery:error.recovery};
  return error instanceof ReleaseError ? { status: 'intervention_required', code: error.code, phase: error.phase, recovery: error.recovery,
    ...(isReleaseBoundary(error.boundary) ? { boundary: error.boundary } : {}),
    ...(commandFailure ? { commandFailure } : {}), ...(sourceApiFailure ? { sourceApiFailure } : {}) }
    : { status: 'intervention_required', code: 'UNCLASSIFIED_PROVIDER_FAILURE', phase: 'unknown', recovery: 'Inspect sanitized phase evidence; do not replay a consequential operation.' };
}
