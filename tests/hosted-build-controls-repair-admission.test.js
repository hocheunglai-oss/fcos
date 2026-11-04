import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD_CONTROLS_REPAIR_DEPENDENCY_CONTEXT as CURRENT, REVIEW_REPAIR_DEPENDENCY_CONTEXT as OLD, dependencyContextCandidate } from '../config/hostedDependencyContext.js';
import { COMPATIBILITY_BUILD_CONTROLS_REPAIR_CORRECTION, firstRuntimeCandidateProfile, runtimeProbeProtocolMatches } from '../config/hostedCompatibilityCorrection.js';
import { assertHostedOrdinaryBrowserSource, hostedBrowserProfile } from '../scripts/lib/hosted-release/browser-profile.mjs';
import { assertHostedBrowserComposition } from '../scripts/lib/hosted-release/browser.mjs';
import { BUILD_CONTROLS_REPAIR_COMPATIBILITY_NORMAL_MODULES, REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES } from '../scripts/runtime-compatibility-normal-role.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';

const candidate = CURRENT.candidate;
const checks = JSON.parse(readFileSync(new URL('../config/release-checks-v2.json', import.meta.url)));
const sealed = JSON.parse(readFileSync(new URL('./fixtures/hosted-dependency-context.json', import.meta.url)));
const manifest = () => ({ candidate: structuredClone(candidate), controller: { sha: 'd'.repeat(40) }, targets: { repository: 'hocheunglai-oss/fcos' } });

test('the exact build/control successor is additive and cannot borrow another profile', () => {
  assert.equal(candidate.sha, '45767ebadb4a3e92179738cdbce87c6a80b81afd');
  assert.equal(COMPATIBILITY_BUILD_CONTROLS_REPAIR_CORRECTION.baseSha, OLD.candidate.sha);
  assert.equal(firstRuntimeCandidateProfile(candidate.sha), candidate.sourceProfile);
  assert.equal(firstRuntimeCandidateProfile(OLD.candidate.sha), OLD.candidate.sourceProfile);
  assert.equal(runtimeProbeProtocolMatches(candidate, 'xero_metered_v1'), true);
  assert.equal(runtimeProbeProtocolMatches({ ...candidate, sourceProfile: OLD.candidate.sourceProfile }, 'xero_metered_v1'), false);
  assert.equal(hostedBrowserProfile(manifest()), 'ordinary_compatibility');
  for (const field of Object.keys(candidate)) {
    const changed = manifest(); changed.candidate[field] = 'foreign';
    assert.throws(() => hostedBrowserProfile(changed), { code: 'HOSTED_BROWSER_PROFILE_INVALID' });
  }
  assert.throws(() => hostedBrowserProfile({ candidate: { sha: candidate.sha, sourceProfile: candidate.sourceProfile } }), { code: 'HOSTED_BROWSER_PROFILE_INVALID' });
});

test('all31 mandatory checks and the exact migration command survive the new profile', () => {
  const previous = checks.checks.filter(row => row.profiles.includes(OLD.candidate.sourceProfile));
  const current = checks.checks.filter(row => row.profiles.includes(candidate.sourceProfile));
  assert.equal(current.length, 31);
  assert.deepEqual(current.map(row => row.id), previous.map(row => row.id));
  for (const row of current) assert.deepEqual(row.profileCommands?.[candidate.sourceProfile], row.profileCommands?.[OLD.candidate.sourceProfile]);
  assert.equal(checks.sourceProfiles[candidate.sourceProfile].candidateSha, candidate.sha);
  assert.equal(checks.sourceProfiles[OLD.candidate.sourceProfile].candidateSha, OLD.candidate.sha);
});

test('the old sealed dependency lineage remains exact rather than being recreated', () => {
  const m = { candidate: structuredClone(candidate), dependencies: structuredClone(sealed.dependencies) };
  assert.equal(dependencyContextCandidate(m, { seed: sealed.seed, handoff: sealed.handoff }), OLD.contextCandidateSha);
  assert.equal(CURRENT.seedSha256, OLD.seedSha256);
  assert.equal(CURRENT.handoffSha256, OLD.handoffSha256);
  for (const field of Object.keys(candidate)) {
    const changed = structuredClone(m); changed.candidate[field] = 'foreign';
    assert.throws(() => dependencyContextCandidate(changed), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
  }
  assert.throws(() => dependencyContextCandidate(m, { seed: { ...sealed.seed, extra: true } }), { code: 'DEPENDENCY_CONTEXT_REQUIRED' });
});

test('the actual browser source guard requires every new candidate and observation binding', () => {
  const m = manifest(), source = { sourceVerified: true, observationSourcesVerified: true,
    controllerSha: m.controller.sha, manifestHash: digest(m), candidateSha: candidate.sha,
    sourceProfile: candidate.sourceProfile, sourceDigest: candidate.sourceSha256,
    lockSha256: candidate.lockSha256, configurationSha256: candidate.configurationSha256,
    sourceInputsSha256: candidate.sourceInputsSha256, salesforceSourceSha256: candidate.salesforceSourceSha256, branch: candidate.branch };
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REF_PROTECTED: 'true', GITHUB_REPOSITORY: m.targets.repository,
    GITHUB_SHA: m.controller.sha, FCOS_E2E_EXPECTED_COMMIT: candidate.sha, FCOS_HOSTED_BROWSER_ENABLED: 'true' };
  assert.equal(assertHostedOrdinaryBrowserSource({ manifest: m, source, env }), source);
  for (const field of Object.keys(source)) {
    const changed = { ...source, [field]: typeof source[field] === 'boolean' ? false : 'foreign' };
    assert.throws(() => assertHostedOrdinaryBrowserSource({ manifest: m, source: changed, env }), { code: 'HOSTED_BROWSER_SOURCE_BINDING' });
  }
});

test('the complete15-module desktop UI catalogue and all old catalogue bindings remain intact', () => {
  const current = assertHostedBrowserComposition(manifest());
  assert.equal(current.modules, BUILD_CONTROLS_REPAIR_COMPATIBILITY_NORMAL_MODULES);
  assert.equal(current.modules.length, 15);
  assert.deepEqual(current.modules, REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES);
  assert.notEqual(current.modules, REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES);
  assert.equal(assertHostedBrowserComposition({ candidate: OLD.candidate }).modules, REVIEW_REPAIR_COMPATIBILITY_NORMAL_MODULES);
  assert.equal(current.modules.find(row => row.module === 'xero_portal').handler, 'xeroPortalReceiptsList');
});
