import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVIEW_REPAIR_DEPENDENCY_CONTEXT as CURRENT, ORDINARY_ADMISSION_DEPENDENCY_CONTEXT as OLD, dependencyContextCandidate } from '../config/hostedDependencyContext.js';
import { COMPATIBILITY_REVIEW_REPAIR_CORRECTION, firstRuntimeCandidateProfile, isFirstRuntimeCandidateSha, runtimeProbeProtocolMatches } from '../config/hostedCompatibilityCorrection.js';
import { hostedBrowserProfile, assertHostedOrdinaryBrowserSource, hostedBrowserHarnessActivation } from '../scripts/lib/hosted-release/browser-profile.mjs';
import { assertHostedBrowserComposition } from '../scripts/lib/hosted-release/browser.mjs';
import { BE6_COMPATIBILITY_NORMAL_MODULES, REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES, compatibilityNormalModuleReadiness } from '../scripts/runtime-compatibility-normal-role.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';

const candidate = CURRENT.candidate;
const sealed = JSON.parse(readFileSync(new URL('./fixtures/hosted-dependency-context.json', import.meta.url)));
const checks = JSON.parse(readFileSync(new URL('../config/release-checks-v2.json', import.meta.url)));
const manifest = () => ({ candidate: structuredClone(candidate), controller: { sha: 'd'.repeat(40) }, targets: { repository: 'hocheunglai-oss/fcos' } });
const envFor = m => ({ GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true', GITHUB_REPOSITORY: m.targets.repository,
  GITHUB_SHA: m.controller.sha, FCOS_E2E_EXPECTED_COMMIT: m.candidate.sha, FCOS_HOSTED_BROWSER_ENABLED: 'true' });
function receipt(m) {
  return { sourceVerified: true, observationSourcesVerified: true, controllerSha: m.controller.sha, manifestHash: digest(m),
    candidateSha: candidate.sha, sourceProfile: candidate.sourceProfile, sourceDigest: candidate.sourceSha256,
    lockSha256: candidate.lockSha256, configurationSha256: candidate.configurationSha256,
    sourceInputsSha256: candidate.sourceInputsSha256, salesforceSourceSha256: candidate.salesforceSourceSha256, branch: candidate.branch };
}

test('only the exact new source tuple joins the stable ordinary compatibility family', () => {
  const m = manifest();
  assert.equal(hostedBrowserProfile(m), 'ordinary_compatibility');
  assert.equal(firstRuntimeCandidateProfile(candidate.sha), candidate.sourceProfile);
  assert.equal(isFirstRuntimeCandidateSha(candidate.sha), true);
  assert.equal(runtimeProbeProtocolMatches(candidate, 'xero_metered_v1'), true);
  assert.equal(runtimeProbeProtocolMatches(candidate, undefined), false);
  assert.equal(COMPATIBILITY_REVIEW_REPAIR_CORRECTION.baseSha, OLD.candidate.sha);
  assert.deepEqual(hostedBrowserHarnessActivation(hostedBrowserProfile(m)), { FCOS_COMPATIBILITY_NORMAL_ROLE_ENABLED: 'true' });
  for (const field of Object.keys(candidate)) {
    const changed = manifest(); changed.candidate[field] = 'foreign';
    assert.throws(() => hostedBrowserProfile(changed), { code: 'HOSTED_BROWSER_PROFILE_INVALID' });
  }
  assert.throws(() => hostedBrowserProfile({ candidate: { sha: candidate.sha, sourceProfile: candidate.sourceProfile } }), { code: 'HOSTED_BROWSER_PROFILE_INVALID' });
  assert.throws(() => hostedBrowserProfile({ candidate: { ...candidate, sourceProfile: 'application_v2' } }), { code: 'HOSTED_BROWSER_PROFILE_INVALID' });
  assert.throws(() => hostedBrowserProfile({ candidate: { ...candidate, sha: OLD.candidate.sha } }), { code: 'HOSTED_BROWSER_PROFILE_INVALID' });
});

test('sealed dependency reuse requires exact new source, immutable seed and original AAD', () => {
  const m = { candidate: structuredClone(candidate), dependencies: structuredClone(sealed.dependencies) };
  assert.equal(dependencyContextCandidate(m, { seed: sealed.seed, handoff: sealed.handoff }), OLD.contextCandidateSha);
  for (const field of Object.keys(candidate)) {
    const changed = structuredClone(m); changed.candidate[field] = 'foreign';
    assert.throws(() => dependencyContextCandidate(changed), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  }
  assert.throws(() => dependencyContextCandidate({ ...m, dependencies: {} }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  assert.throws(() => dependencyContextCandidate(m, { seed: { ...sealed.seed, extra: true } }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  assert.throws(() => dependencyContextCandidate(m, { handoff: { ...sealed.handoff, candidateSha: candidate.sha } }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
});

test('new hosted source receipt cannot borrow candidate, controller, manifest or any partial source field', () => {
  const m = manifest(), source = receipt(m), env = envFor(m);
  assert.equal(assertHostedOrdinaryBrowserSource({ manifest: m, source, env }), source);
  for (const field of Object.keys(source)) {
    const changed = { ...source, [field]: typeof source[field] === 'boolean' ? false : 'foreign' };
    assert.throws(() => assertHostedOrdinaryBrowserSource({ manifest: m, source: changed, env }), { code: 'HOSTED_BROWSER_SOURCE_BINDING' });
  }
  assert.throws(() => assertHostedOrdinaryBrowserSource({ manifest: m, source, env: { ...env, GITHUB_SHA: 'f'.repeat(40) } }), { code: 'HOSTED_BROWSER_CONTEXT_INVALID' });
});

test('all31 old checks and exact command overrides remain mandatory for the new profile', () => {
  const previous = checks.checks.filter(row => row.profiles.includes(OLD.candidate.sourceProfile));
  const current = checks.checks.filter(row => row.profiles.includes(candidate.sourceProfile));
  assert.equal(current.length, 31);
  assert.deepEqual(current.map(row => row.id), previous.map(row => row.id));
  for (const row of current) assert.deepEqual(row.profileCommands?.[candidate.sourceProfile], row.profileCommands?.[OLD.candidate.sourceProfile]);
  assert.equal(checks.sourceProfiles[candidate.sourceProfile].candidateSha, candidate.sha);
  assert.equal(checks.sourceProfiles[OLD.candidate.sourceProfile].candidateSha, OLD.candidate.sha);
});

test('distinct new15-module catalogue is selected only by its admitted tuple; oldbe6 remains unchanged', () => {
  const current = assertHostedBrowserComposition(manifest());
  assert.equal(current.profile, 'ordinary_compatibility');
  assert.equal(current.modules, REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES);
  assert.equal(current.modules.length, 15);
  assert.equal(assertHostedBrowserComposition({ candidate: OLD.candidate }).modules, BE6_COMPATIBILITY_NORMAL_MODULES);
  assert.deepEqual(current.modules.map(row => row.module), BE6_COMPATIBILITY_NORMAL_MODULES.map(row => row.module));
  for (let i = 0; i < current.modules.length; i++) {
    const { sourceContract: newer, ...a } = current.modules[i], { sourceContract: older, ...b } = BE6_COMPATIBILITY_NORMAL_MODULES[i];
    assert.notEqual(newer, older); assert.deepEqual(a, b);
  }
});

test('new Review source requires its actual complete-batch marker; legacy absence remains separately supported', async () => {
  const state = { pending: 0, workflowLoaded: true }, responses = [{ loaded: true }];
  const current = REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'review');
  const previous = BE6_COMPATIBILITY_NORMAL_MODULES.find(row => row.module === 'review');
  const page = (count, busy) => ({ locator: () => ({ count: async () => count, getAttribute: async () => busy }) });
  assert.equal(await compatibilityNormalModuleReadiness(current, page(0), responses, state), false);
  assert.equal(await compatibilityNormalModuleReadiness(current, page(1, 'true'), responses, state), false);
  assert.equal(await compatibilityNormalModuleReadiness(current, page(2, 'false'), responses, state), false);
  assert.equal(await compatibilityNormalModuleReadiness(current, page(1, 'false'), responses, state), true);
  assert.equal(await compatibilityNormalModuleReadiness(previous, page(0), responses, state), true);
  assert.equal(hostedBrowserProfile({ candidate: OLD.candidate }), 'ordinary_compatibility');
  assert.equal(hostedBrowserProfile({ candidate: { sha: '04ee3425aac7a49089eda781eb3c976aea1f6785' } }), 'frozen_compatibility');
});
