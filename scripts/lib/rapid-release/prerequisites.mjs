import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertAuthorization, digest, git, requireCondition } from './contract.mjs';

export async function qualifiedAdapter({ manifest, controllerDirectory, load = url => import(url) }) {
  const descriptor = manifest.prerequisites;
  requireCondition(descriptor && /^[a-z][a-z0-9-]{3,64}$/.test(descriptor.adapter), 'REVIEWED_PREREQUISITE_PLAN_REQUIRED');
  const registry = JSON.parse(readFileSync(resolve(controllerDirectory, 'config/rapid-release-adapters.json'), 'utf8'));
  const entry = registry.adapters?.find(item => item.id === descriptor.adapter);
  requireCondition(registry.schemaVersion === 1 && entry && entry.status === 'qualified'
    && entry.sourceDigest === descriptor.adapterDigest && entry.salesforce === manifest.selection.salesforce
    && entry.database === manifest.selection.database, 'QUALIFIED_PREREQUISITE_ADAPTER_REQUIRED');
  const root = realpathSync(controllerDirectory), file = realpathSync(resolve(root, entry.path));
  requireCondition(relative(root, file).startsWith('scripts/') && !relative(root, file).startsWith('..')
    && digest(readFileSync(file)) === entry.sourceDigest && git(root, ['rev-parse', 'HEAD']) === manifest.controllerSha
    && !git(root, ['status', '--porcelain', '--untracked-files=no']), 'PREREQUISITE_CONTROLLER_BINDING_CHANGED');
  const adapter = await load(pathToFileURL(file).href);
  return { adapter, entry, root, descriptor };
}

// Only adapters reviewed into the trusted controller may receive provider credentials.
// Candidate files and provider responses are data, never executable repair adapters.
export async function runPrerequisites({ manifest, approval, staged, journal, controllerDirectory, env, load = url => import(url) }) {
  assertAuthorization(approval, manifest, staged);
  const needed = manifest.selection.salesforce || manifest.selection.database;
  if (!needed) return { passed: true, manifestHash: digest(manifest), backwardCompatible: true, providerCalls: 0 };
  const { adapter, root, descriptor } = await qualifiedAdapter({ manifest, controllerDirectory, load });
  requireCondition(typeof adapter.applyReviewedPrerequisites === 'function', 'PREREQUISITE_ADAPTER_CONTRACT_REQUIRED');
  const result = await adapter.applyReviewedPrerequisites({ manifest, approval, journal, controllerDirectory: root, env,
    plan: descriptor.plan, authorization: { manifestHash: digest(manifest), nativeReview: approval } });
  requireCondition(result?.passed === true && result.manifestHash === digest(manifest)
    && result.backwardCompatible === true && Array.isArray(result.completedOperations)
    && result.completedOperations.every(operation => operation.verified === true && operation.intentRecorded === true)
    && (!manifest.selection.salesforce || result.salesforce?.order === 'devee-mirror-qat-production'
      && result.salesforce.mirrorVerified === true && result.salesforce.sourceTreeHash === descriptor.plan.salesforceSourceTreeHash)
    && (!manifest.selection.database || result.database?.destructiveRollback === false && result.database.readbackVerified === true), 'PREREQUISITE_VERIFICATION_REQUIRED');
  // Private adapter evidence stays in its private store; publish only typed checkpoint metadata.
  const operations = result.completedOperations.map(operation => {
    requireCondition(/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}$/.test(operation.operationId || '')
      && /^[a-f0-9]{64}$/.test(operation.evidenceDigest || ''), 'PREREQUISITE_OPERATION_RECEIPT_REQUIRED');
    return { operationId: operation.operationId, evidenceDigest: operation.evidenceDigest, verified: true, intentRecorded: true };
  });
  return { passed: true, manifestHash: digest(manifest), backwardCompatible: true, completedOperations: operations,
    ...(result.salesforce ? { salesforce: { order: result.salesforce.order, mirrorVerified: true, sourceTreeHash: result.salesforce.sourceTreeHash } } : {}),
    ...(result.database ? { database: { destructiveRollback: false, readbackVerified: true } } : {}) };
}

// An explicit, qualified schema adapter may defer only the schema-dependent
// checks until the one authorization permits bootstrap. This is NOT full smoke.
export async function verifyBeforeBootstrap({ manifest, staged, controllerDirectory, env, load }) {
  const { adapter, entry, descriptor } = await qualifiedAdapter({ manifest, controllerDirectory, load });
  requireCondition(descriptor.plan.deferSchemaDependentSmoke === true && /^[a-f0-9]{64}$/.test(descriptor.plan.bootstrapFingerprint || '')
    && entry.supportsDeferredStage === true && typeof adapter.verifyPreBootstrapStage === 'function', 'QUALIFIED_PREBOOTSTRAP_VERIFIER_REQUIRED');
  const proof = await adapter.verifyPreBootstrapStage({ manifest, staged, controllerDirectory, env });
  requireCondition(proof?.passed === true && proof.mode === 'pre_bootstrap' && proof.deploymentId === staged.id
    && proof.buildId === manifest.build.buildId && proof.manifestHash === digest(manifest)
    && proof.bootstrapFingerprint === descriptor.plan.bootstrapFingerprint
    && proof.isolationVerified === true && proof.businessWrites === 0 && Array.isArray(proof.completedChecks)
    && proof.completedChecks.length > 0 && proof.completedChecks.every(check => /^[a-z][a-z0-9_]{1,80}$/.test(check))
    && Array.isArray(proof.deferredChecks) && proof.deferredChecks.length > 0
    && proof.deferredChecks.every(check => manifest.selection.modules.includes(check)), 'PREBOOTSTRAP_STAGE_PROOF_REQUIRED');
  return { passed: true, mode: 'pre_bootstrap', deploymentId: proof.deploymentId, buildId: proof.buildId,
    manifestHash: proof.manifestHash, isolationVerified: true, businessWrites: 0,
    completedChecks: proof.completedChecks, deferredChecks: proof.deferredChecks, bootstrapFingerprint: descriptor.plan.bootstrapFingerprint };
}
