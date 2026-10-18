import { qualificationSourceBinding } from '../../../config/hostedReleaseQualification.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectBuildProvenance } from '../build-provenance.mjs';
import { collectCheckBinding, collectReleaseCheckSource, loadReleaseCheckManifest, requiredReleaseChecks } from './checks.mjs';
import { canonical, digest, fail, REQUIRED_LIVE_CHECKS, validateManifest } from './contract.mjs';
import { validateSalesforceReadAcceptance } from './salesforce-read-auth.mjs';
import { validateVercelReadAcceptance } from './vercel-read-auth.mjs';
import { validateVercelPreviewWriterAcceptance, validateVercelProductionWriterAcceptance } from './vercel-writer-auth.mjs';
import { assertFirstRuntimeSetup } from './first-runtime.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
export function collectSourceAdmission({ candidateDirectory, controllerDirectory, controllerSha, candidateSha, sourceProfile }) {
  const loaded = loadReleaseCheckManifest(controllerDirectory), source = collectReleaseCheckSource(candidateDirectory);
  const binding = collectCheckBinding({ candidateDirectory, controllerDirectory, controllerSha, expectedCandidateSha: candidateSha,
    sourceProfile, ...loaded, source });
  const provenance = collectBuildProvenance({ cwd: candidateDirectory, env: {}, requireClean: true });
  const sf = source.values.filter(([path]) => path.startsWith('force-app/main/default/'));
  if (!sf.length || provenance.commit !== candidateSha) fail('SOURCE_ADMISSION');
  const policy = readFileSync(join(controllerDirectory, 'config/hosted-release-policy.json'));
  return { source, binding, checks: requiredReleaseChecks(loaded.manifest, sourceProfile),
    candidate: { sha: candidateSha, sourceProfile, sourceSha256: provenance.sourceDigest,
      lockSha256: binding.lockSha256, configurationSha256: binding.configurationSha256, salesforceSourceSha256: digest(sf), sourceInputsSha256: source.sourceInputsSha256 },
    controller: { sha: controllerSha, checkManifestSha256: loaded.manifestSha256, configurationSha256: digest(policy) } };
}

export function assertSourceAdmission({ manifest, candidateDirectory, controllerDirectory }) {
  validateManifest(manifest);
  if (!manifest.verification) fail('VERIFICATION_SETUP_REQUIRED');
  const actual = collectSourceAdmission({ candidateDirectory, controllerDirectory, controllerSha: manifest.controller.sha,
    candidateSha: manifest.candidate.sha, sourceProfile: manifest.candidate.sourceProfile });
  for (const [key, value] of Object.entries(actual.candidate)) if (manifest.candidate[key] !== value) fail(`SOURCE_BINDING_${key.toUpperCase()}`);
  for (const [key, value] of Object.entries(actual.controller)) if (manifest.controller[key] !== value) fail(`CONTROLLER_BINDING_${key.toUpperCase()}`);
  const required = [...new Set([...actual.checks.map(row => row.id).filter(id => id !== 'final_acceptance'), ...REQUIRED_LIVE_CHECKS,
    ...(manifest.stage === 'application' ? ['compatibility_production_observation'] : [])])].sort();
  if (canonical([...manifest.requiredChecks].sort()) !== canonical(required)) fail('REQUIRED_CHECKS_CHANGED');
  if (manifest.stage === 'compatibility' && manifest.candidate.sourceProfile !== 'frozen_04ee'
    || manifest.stage === 'application' && manifest.candidate.sourceProfile !== 'application_v2') fail('PRODUCTION_SOURCE_PROFILE');
  return actual;
}

export function assertHostedSourceContext({ manifest, controllerSha = manifest?.controller?.sha, env = process.env }) {
  const source = qualificationSourceBinding(manifest);
  if (env.FCOS_QUALIFICATION_BOOTSTRAP === 'true' && (manifest?.stage !== 'qualification' || manifest?.executionMode !== 'qualification')) fail('QUALIFICATION_BOOTSTRAP_ONLY');
  if (source) {
    assertHostedSetup({ manifest, env });
    if (['fcos-production-release', 'fcos-hosted-production-resume'].includes(env.FCOS_HOSTED_ENVIRONMENT)) fail('QUALIFICATION_PRODUCTION_ENVIRONMENT_FORBIDDEN');
    if (env.FCOS_HOSTED_QUALIFICATION_ADMITTED !== 'true' || env.GITHUB_REF !== source.ref || env.GITHUB_SHA !== source.bootstrapSha
      || env.GITHUB_RUN_ATTEMPT !== '1' || source.controllerSha !== controllerSha) fail('QUALIFICATION_SOURCE_CONTEXT');
  } else if (env.GITHUB_REF !== 'refs/heads/main' || env.FCOS_QUALIFICATION_BOOTSTRAP === 'true') fail('HOSTED_CONTROLLER_REQUIRED');
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'hocheunglai-oss/fcos' || env.GITHUB_REPOSITORY_ID !== '1278654816'
    || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.FCOS_CONTROLLER_SHA !== controllerSha || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')) fail('HOSTED_CONTROLLER_REQUIRED');
  return source;
}

export function assertHostedController({ controllerDirectory, controllerSha, manifest, env = process.env }) {
  if (git(controllerDirectory, ['rev-parse', 'HEAD']) !== controllerSha
    || git(controllerDirectory, ['status', '--porcelain', '--untracked-files=no'])) fail('CONTROLLER_CHECKOUT_CHANGED');
  assertHostedSourceContext({ manifest, controllerSha, env });
}

export function assertHostedSetup({ manifest, env = process.env }) {
  let setup; try { setup = JSON.parse(env.FCOS_ADMITTED_RELEASE_SETUP); } catch { fail('ADMITTED_SETUP_MISSING'); }
  if (digest(setup) !== env.FCOS_ADMITTED_RELEASE_SETUP_SHA256 || manifest.setupSha256 !== digest(setup)
    || setup.controllerSha !== manifest.controller.sha || setup.epoch !== manifest.epoch
    || setup.targetsSha256 !== digest(manifest.targets)
    || canonical(setup.verification) !== canonical(manifest.verification)
    || canonical(setup.dependencies || null) !== canonical(manifest.dependencies || null)
    || manifest.qualificationSource !== undefined && canonical(setup.qualificationSource || null) !== canonical(manifest.qualificationSource)) fail('ADMITTED_SETUP_CHANGED');
  if(manifest.stage==='qualification' || manifest.verification?.vercelReadCredential)
    validateVercelReadAcceptance(manifest.verification?.vercelReadCredential,setup,{targets:manifest.targets});
  if (manifest.verification?.vercelPreviewWriterCredential)
    validateVercelPreviewWriterAcceptance(manifest.verification.vercelPreviewWriterCredential, setup, { targets: manifest.targets });
  if (manifest.verification?.vercelProductionWriterCredential)
    validateVercelProductionWriterAcceptance(manifest.verification.vercelProductionWriterCredential, setup,
      { targets: manifest.targets, previewBinding: manifest.verification.vercelPreviewWriterCredential });
  if (manifest.verification?.salesforceReadCredential)
    validateSalesforceReadAcceptance(manifest.verification.salesforceReadCredential, setup);
  assertFirstRuntimeSetup({setup,manifest});
  return setup;
}
