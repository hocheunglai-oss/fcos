import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertAuthorization, digest, git, requireCondition } from './contract.mjs';

// Only adapters reviewed into the trusted controller may receive provider credentials.
// Candidate files and provider responses are data, never executable repair adapters.
export async function runPrerequisites({ manifest, approval, staged, journal, controllerDirectory, env, load = url => import(url) }) {
  assertAuthorization(approval, manifest, staged);
  const needed = manifest.selection.salesforce || manifest.selection.database;
  if (!needed) return { passed: true, manifestHash: digest(manifest), backwardCompatible: true, providerCalls: 0 };
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
  requireCondition(typeof adapter.applyReviewedPrerequisites === 'function', 'PREREQUISITE_ADAPTER_CONTRACT_REQUIRED');
  const result = await adapter.applyReviewedPrerequisites({ manifest, approval, journal, controllerDirectory: root, env,
    plan: descriptor.plan, authorization: { manifestHash: digest(manifest), nativeReview: approval } });
  requireCondition(result?.passed === true && result.manifestHash === digest(manifest)
    && result.backwardCompatible === true && Array.isArray(result.completedOperations)
    && result.completedOperations.every(operation => operation.verified === true && operation.intentRecorded === true)
    && (!manifest.selection.salesforce || result.salesforce?.order === 'devee-mirror-qat-production'
      && result.salesforce.mirrorVerified === true && result.salesforce.sourceTreeHash === descriptor.plan.salesforceSourceTreeHash)
    && (!manifest.selection.database || result.database?.destructiveRollback === false && result.database.readbackVerified === true), 'PREREQUISITE_VERIFICATION_REQUIRED');
  return result;
}
