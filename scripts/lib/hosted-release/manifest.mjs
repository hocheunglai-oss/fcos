import { validateQualificationSource } from '../../../config/hostedReleaseQualification.js';
import { execFileSync } from 'node:child_process';
import { collectSourceAdmission } from './admission.mjs';
import { validateVercelReadAcceptance } from './vercel-read-auth.mjs';
import { CONTRACT_VERSION, CONTROLLER_WORKFLOW, digest, fail, REQUIRED_LIVE_CHECKS, releaseTargets, validateManifest, WRITE_PHASES, FROZEN_COMPATIBILITY_SHA } from './contract.mjs';

/** Source hashes and check sets are computed by the admitted controller. The
 * release plan supplies business scope, never a replacement check definition. */
export function buildReleaseManifest({ plan, setup, previousProduction, candidateDirectory, controllerDirectory, controllerSha,
  candidateSha, collectSource = collectSourceAdmission }) {
  if (setup?.schemaVersion !== 2 || setup.controllerSha !== controllerSha || setup.targetsSha256 !== digest(releaseTargets())
    || plan?.schemaVersion !== 2 || !['compatibility','application','qualification'].includes(plan.stage)) fail('RELEASE_SETUP_NOT_ADMITTED');
  if (plan.executionMode !== undefined && plan.executionMode !== (plan.stage === 'qualification' ? 'qualification' : 'release')) fail('MANIFEST_SCHEMA');
  const qualificationSource = plan.stage === 'qualification' && setup.qualificationSource
    ? validateQualificationSource(setup.qualificationSource, { controllerSha, candidateSha }) : null;
  const sourceProfile = plan.stage === 'compatibility' ? 'frozen_04ee' : plan.stage === 'application' ? 'application_v2' : plan.sourceProfile;
  const source = collectSource({ candidateDirectory, controllerDirectory, controllerSha, candidateSha, sourceProfile });
  const manifest = { schemaVersion: 2, contract: CONTRACT_VERSION, releaseId: plan.releaseId, stage: plan.stage,
    executionMode: plan.stage === 'qualification' ? 'qualification' : 'release', epoch: setup.epoch, setupSha256: digest(setup),
    candidate: { ...source.candidate, branch: plan.branch }, controller: { ...source.controller, workflow: CONTROLLER_WORKFLOW },
    targets: releaseTargets(), scope: plan.scope, previousProduction,
    requiredChecks: [...new Set([...source.checks.map(row => row.id).filter(id => id !== 'final_acceptance'), ...REQUIRED_LIVE_CHECKS,
      ...(plan.stage === 'application' ? ['compatibility_production_observation'] : [])])].sort(),
    authorization: { validitySeconds: 86400, actions: [...WRITE_PHASES], rollback: { mode: 'compatible_previous_only', schemaRollback: false } },
    migration: plan.migration, runtime: plan.runtime, changes: plan.changes, verification: setup.verification,
    ...(qualificationSource ? { qualificationSource: { ...qualificationSource } } : {}),
    ...(setup.dependencies ? { dependencies: setup.dependencies } : {}) };
  validateManifest(manifest);
  return manifest;
}

export async function prepareReleaseManifest({ plan, setup, candidateDirectory, controllerDirectory, controllerSha, candidateSha,
  observePreviousProduction, collectSource, now = Date.now }) {
  if (typeof observePreviousProduction !== 'function') fail('PRODUCTION_OBSERVATION_REQUIRED');
  const provisional = buildReleaseManifest({ plan, setup, previousProduction: setup.previousProduction,
    candidateDirectory, controllerDirectory, controllerSha, candidateSha, collectSource });
  const observed = await observePreviousProduction(provisional);
  if (observed?.readOnly !== true || !Number.isFinite(Date.parse(observed.capturedAt))
    || now() - Date.parse(observed.capturedAt) > 300000 || Date.parse(observed.capturedAt) > now() + 30000) fail('PRODUCTION_OBSERVATION_EXPIRED');
  return buildReleaseManifest({ plan, setup, previousProduction: observed.previousProduction,
    candidateDirectory, controllerDirectory, controllerSha, candidateSha, collectSource });
}

export function assertAdmittedSetup({ setup, expectedSha256, controllerDirectory, controllerSha }) {
  if (digest(setup) !== expectedSha256 || setup.controllerSha !== controllerSha) fail('SETUP_BINDING_CHANGED');
  const head = execFileSync('git', ['rev-parse','HEAD'], { cwd: controllerDirectory, encoding: 'utf8' }).trim();
  if (head !== controllerSha) fail('CONTROLLER_CHECKOUT_CHANGED');
  return setup;
}

/** A discovery admission is a separate public contract, never a release setup or manifest. */
export function validateDiscoverySetup(setup, { controllerSha, candidateSha, now = Date.now() } = {}) {
  const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!exact(setup, ['schemaVersion','kind','controllerSha','candidateSha','sourceProfile','targets','qualificationSource',
    'environment','issuedAt','notAfter','runtimeIdentity','vercelReadCredential','vercelReadCredentialAcceptance','legacyProductionBinding'])
    || setup.schemaVersion !== 1 || setup.kind !== 'fcos_hosted_setup_discovery'
    || setup.controllerSha !== controllerSha || setup.candidateSha !== candidateSha
    || setup.candidateSha !== FROZEN_COMPATIBILITY_SHA || setup.sourceProfile !== 'frozen_04ee'
    || digest(setup.targets) !== digest(releaseTargets()) || setup.environment !== 'fcos-hosted-verification'
    || !Number.isSafeInteger(setup.issuedAt) || setup.issuedAt <= 0 || setup.issuedAt > now + 30000
    || !Number.isSafeInteger(setup.notAfter) || setup.notAfter <= now || setup.notAfter <= setup.issuedAt
    || !exact(setup.runtimeIdentity, ['emailSha256','role']) || !isHash(setup.runtimeIdentity.emailSha256)
    || !['administrator','general_manager'].includes(setup.runtimeIdentity.role)) fail('DISCOVERY_SETUP_INVALID');
  validateQualificationSource(setup.qualificationSource, { controllerSha, candidateSha });
  validateVercelReadAcceptance(setup.vercelReadCredential, { vercelReadCredentialAcceptance: setup.vercelReadCredentialAcceptance }, { targets: setup.targets, now });
  if (setup.notAfter > setup.vercelReadCredential.notAfter) fail('DISCOVERY_SETUP_INVALID');
  const legacy = setup.legacyProductionBinding;
  if (legacy !== null && (!exact(legacy, ['kind','teamId','projectId','productionOrigin','deploymentId','immutableUrl','commit',
    'sourceDigest','sourceDigestAlgorithm','publicVersionSha256','sourceAttested','providerEvidenceSha256','versionEvidenceSha256','capturedAt'])
    || legacy.kind !== 'fcos_discovery_legacy_public_version'
    || legacy.teamId !== setup.targets.vercelTeam || legacy.projectId !== setup.targets.vercelProject
    || legacy.productionOrigin !== setup.targets.productionOrigin || !/^dpl_[A-Za-z0-9]+$/.test(legacy.deploymentId || '')
    || !/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(legacy.immutableUrl || '') || !/^[a-f0-9]{40}$/.test(legacy.commit || '')
    || !['sourceDigest','publicVersionSha256','providerEvidenceSha256','versionEvidenceSha256'].every(key => isHash(legacy[key]))
    || legacy.sourceDigestAlgorithm !== 'sha256:fcos-vercel-source-v1' || legacy.sourceAttested !== false
    || !Number.isFinite(Date.parse(legacy.capturedAt)) || Date.parse(legacy.capturedAt) > now + 30000)) fail('DISCOVERY_LEGACY_BINDING_INVALID');
  return setup;
}
