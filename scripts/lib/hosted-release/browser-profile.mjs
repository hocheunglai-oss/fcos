import { ORDINARY_ADMISSION_DEPENDENCY_CONTEXT, REVIEW_REPAIR_DEPENDENCY_CONTEXT } from '../../../config/hostedDependencyContext.js';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { isFirstRuntimeCandidateSha } from '../../../config/hostedCompatibilityCorrection.js';
import { canonical, digest, ReleaseError } from './json-contract.mjs';

export const ORDINARY_BROWSER_CANDIDATE = ORDINARY_ADMISSION_DEPENDENCY_CONTEXT.candidate;
export const FROZEN_BROWSER_CANDIDATE = '04ee3425aac7a49089eda781eb3c976aea1f6785';
const refuse = code => { throw new ReleaseError(code, 'browser.profile', 'Correct the exact admitted browser profile before any Preview or probe.'); };

export const REVIEW_REPAIR_BROWSER_CANDIDATE = REVIEW_REPAIR_DEPENDENCY_CONTEXT.candidate;
export function hostedOrdinaryBrowserCandidate(candidate) {
  const pin = [ORDINARY_BROWSER_CANDIDATE, REVIEW_REPAIR_BROWSER_CANDIDATE].find(value => candidate?.sha === value.sha || candidate?.sourceProfile === value.sourceProfile);
  if (pin && canonical(candidate) !== canonical(pin)) refuse('HOSTED_BROWSER_PROFILE_INVALID');
  return pin;
}

// Pure composition check. Neither a caller-provided flag nor a SHA prefix can
// enroll another candidate into the legacy catalogue.
export function hostedBrowserProfile(manifest) {
  const candidate = manifest?.candidate;
  if (hostedOrdinaryBrowserCandidate(candidate)) return 'ordinary_compatibility';
  if (candidate?.sha === FROZEN_BROWSER_CANDIDATE && [undefined, 'frozen_04ee'].includes(candidate.sourceProfile)) return 'frozen_compatibility';
  if (candidate?.sourceProfile === 'application_v2' && /^[a-f0-9]{40}$/.test(candidate.sha)
      && !isFirstRuntimeCandidateSha(candidate.sha)) return 'application';
  refuse('HOSTED_BROWSER_PROFILE_INVALID');
}

export function assertHostedOrdinaryBrowserContext({ manifest, env }) {
  if (hostedBrowserProfile(manifest) !== 'ordinary_compatibility'
      || env?.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF_PROTECTED !== 'true'
      || env.GITHUB_REPOSITORY !== fcosConnectionIdentifier('github', 'Repository')
      || env.GITHUB_SHA !== manifest.controller?.sha || env.FCOS_E2E_EXPECTED_COMMIT !== manifest.candidate.sha
      || env.FCOS_HOSTED_BROWSER_ENABLED !== 'true') refuse('HOSTED_BROWSER_CONTEXT_INVALID');
}

export function assertHostedOrdinaryBrowserSource({ manifest, source, env }) {
  assertHostedOrdinaryBrowserContext({ manifest, env });
  const candidate = hostedOrdinaryBrowserCandidate(manifest.candidate);
  const fields = { candidateSha: 'sha', sourceProfile: 'sourceProfile', sourceDigest: 'sourceSha256',
    lockSha256: 'lockSha256', configurationSha256: 'configurationSha256', sourceInputsSha256: 'sourceInputsSha256',
    salesforceSourceSha256: 'salesforceSourceSha256', branch: 'branch' };
  if (source?.sourceVerified !== true || source.observationSourcesVerified !== true
      || source.controllerSha !== manifest.controller.sha || source.manifestHash !== digest(manifest)
      || Object.entries(fields).some(([key, candidateKey]) => source[key] !== candidate[candidateKey]))
    refuse('HOSTED_BROWSER_SOURCE_BINDING');
  return source;
}

// Called only by the hosted adapter AFTER source, runtime and normal identity
// checks. Strip ambient activation flags and derive exactly the selected one.
export function assertHostedBrowserJobContext(env, manifest, profile) {
  if (profile !== hostedBrowserProfile(manifest) || env?.GITHUB_ACTIONS !== 'true'
      || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_REPOSITORY !== manifest.targets?.repository)
    refuse('HOSTED_BROWSER_CONTEXT_INVALID');
}

// A credential-free plan, also compiled by prepare/reconcile/fixtures. Returning
// this description does not activate a process or assert a hosted identity.
export function hostedBrowserHarnessActivation(profile) {
  if (!['application', 'ordinary_compatibility', 'frozen_compatibility'].includes(profile)) refuse('HOSTED_BROWSER_COMPOSITION_INVALID');
  return profile === 'application' ? { FCOS_NORMAL_ROLE_E2E_ENABLED: 'true' } : { FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true' };
}

export function hostedBrowserHarnessEnvironment(env, manifest, profile) {
  assertHostedBrowserJobContext(env, manifest, profile);
  const clean = { ...env }; delete clean.FCOS_NORMAL_ROLE_E2E_ENABLED; delete clean.FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED;
  return { ...clean, GITHUB_SHA: manifest.controller.sha, ...hostedBrowserHarnessActivation(profile) };
}
