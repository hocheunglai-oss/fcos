import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectBuildProvenance } from '../build-provenance.mjs';
import { collectCheckBinding, collectReleaseCheckSource, loadReleaseCheckManifest, requiredReleaseChecks } from './checks.mjs';
import { canonical, digest, fail, REQUIRED_LIVE_CHECKS, validateManifest } from './contract.mjs';

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

export function assertHostedController({ controllerDirectory, controllerSha, env = process.env }) {
  if (git(controllerDirectory, ['rev-parse', 'HEAD']) !== controllerSha
    || git(controllerDirectory, ['status', '--porcelain', '--untracked-files=no'])) fail('CONTROLLER_CHECKOUT_CHANGED');
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'hocheunglai-oss/fcos'
    || env.GITHUB_REPOSITORY_ID !== '1278654816' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.FCOS_CONTROLLER_SHA !== controllerSha || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')) fail('HOSTED_CONTROLLER_REQUIRED');
}

export function assertHostedSetup({ manifest, env = process.env }) {
  let setup; try { setup = JSON.parse(env.FCOS_ADMITTED_RELEASE_SETUP); } catch { fail('ADMITTED_SETUP_MISSING'); }
  if (digest(setup) !== env.FCOS_ADMITTED_RELEASE_SETUP_SHA256 || manifest.setupSha256 !== digest(setup)
    || setup.controllerSha !== manifest.controller.sha || setup.epoch !== manifest.epoch
    || setup.targetsSha256 !== digest(manifest.targets)
    || canonical(setup.verification) !== canonical(manifest.verification)
    || canonical(setup.dependencies || null) !== canonical(manifest.dependencies || null)) fail('ADMITTED_SETUP_CHANGED');
  return setup;
}
