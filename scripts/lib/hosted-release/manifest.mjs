import { validateQualificationSource } from '../../../config/hostedReleaseQualification.js';
import { execFileSync } from 'node:child_process';
import { collectSourceAdmission } from './admission.mjs';
import { CONTRACT_VERSION, CONTROLLER_WORKFLOW, digest, fail, REQUIRED_LIVE_CHECKS, releaseTargets, validateManifest, WRITE_PHASES } from './contract.mjs';

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
