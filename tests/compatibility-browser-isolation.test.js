import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, statSync, symlinkSync, copyFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compatibilityBrowserIsolationVerified, assertCompatibilityWorkspacePreferences } from '../scripts/lib/compatibility-browser-isolation.mjs';
import { COMPATIBILITY_NORMAL_MODULES } from '../scripts/runtime-compatibility-normal-role.mjs';
import { runtimeCompatibilityControlRevision } from '../scripts/lib/runtime-compatibility-release.mjs';
import { releaseConfigurationRevision } from '../scripts/lib/release-readiness.mjs';

test('actual candidate preference shape must be genuinely initialized; missing/false/read errors are actionable blockers', () => {
  assert.deepEqual(assertCompatibilityWorkspacePreferences({ preferences: { initialized: true, revision: 42 } }),
    { handler: 'workspacePreferencesGet', initialized: true, responseVerified: true });
  for (const data of [{ preferences: { initialized: false } }, { preferences: { initialized: 'true' } }, { initialized: true },
    { preferences: {} }, { preferences: { initialized: true }, error: 'unavailable' }, undefined]) {
    assert.throws(() => assertCompatibilityWorkspacePreferences(data), /already be initialized.*cannot migrate/);
  }
});

test('both trusted control inventories bind the new executable isolation helper bytes', () => {
  const root = fileURLToPath(new URL('..', import.meta.url)), scratch = mkdtempSync(join(tmpdir(), 'fcos-isolation-controls-'));
  try {
    for (const name of ['config', '.github', '.codex']) symlinkSync(join(root, name), join(scratch, name));
    for (const name of ['AGENTS.md', 'package.json', 'package-lock.json', 'vercel.json', 'playwright.config.js']) copyFileSync(join(root, name), join(scratch, name));
    mkdirSync(join(scratch, 'tests'));
    const chromiumTest = join(scratch, 'tests/compatibility-browser-isolation.chromium.mjs');
    copyFileSync(join(root, 'tests/compatibility-browser-isolation.chromium.mjs'), chromiumTest);
    mkdirSync(join(scratch, 'scripts')); mkdirSync(join(scratch, 'scripts/lib'));
    for (const name of readdirSync(join(root, 'scripts'))) if (name !== 'lib') {
      const source = join(root, 'scripts', name), target = join(scratch, 'scripts', name);
      if (statSync(source).isDirectory()) symlinkSync(source, target); else copyFileSync(source, target);
    }
    for (const name of readdirSync(join(root, 'scripts/lib'))) if (name !== 'compatibility-browser-isolation.mjs') {
      const source = join(root, 'scripts/lib', name), target = join(scratch, 'scripts/lib', name);
      if (statSync(source).isDirectory()) symlinkSync(source, target); else copyFileSync(source, target);
    }
    const helper = join(scratch, 'scripts/lib/compatibility-browser-isolation.mjs'); copyFileSync(join(root, 'scripts/lib/compatibility-browser-isolation.mjs'), helper);
    const before = [runtimeCompatibilityControlRevision(scratch, root), releaseConfigurationRevision(root, scratch)];
    appendFileSync(helper, '\n// offline byte-drift fixture\n');
    assert.notEqual(runtimeCompatibilityControlRevision(scratch, root), before[0]);
    assert.notEqual(releaseConfigurationRevision(root, scratch), before[1]);
    copyFileSync(join(root, 'scripts/lib/compatibility-browser-isolation.mjs'), helper);
    appendFileSync(chromiumTest, '\n// offline executable drift fixture\n');
    assert.notEqual(runtimeCompatibilityControlRevision(scratch, root), before[0]);
    assert.equal(releaseConfigurationRevision(root, scratch), before[1], 'compatibility-only browser test is not a general release dependency');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});


test('strict isolation schema rejects absent, incomplete, changed, private or unsafe claims without launching a browser', () => {
  const binding = { candidateUrl: 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app', sha: 'f'.repeat(40), harnessSha: 'c'.repeat(40),
    deploymentId: 'dpl_offlineFixture', sourceDigest: 'b'.repeat(64) };
  const names = COMPATIBILITY_NORMAL_MODULES.map(row => row.module);
  const proof = { schemaVersion: 1, kind: 'fcos_compatibility_browser_isolation', candidateUrl: binding.candidateUrl, candidateSha: binding.sha,
    harnessSha: binding.harnessSha, deploymentId: binding.deploymentId, sourceDigest: binding.sourceDigest,
    guardian: { path: '/app-version.json', contentType: 'application/json', provenanceVerified: true, closed: true },
    backgroundSync: { excludedFeature: 'automatic_mailbox_sync', lockName: 'fcos:email-router-background-sync', mode: 'exclusive', sameContext: true, webLocks: true, broadcastChannel: true,
      acquiredBeforeNavigation: true, modules: names.map(module => ({ module, before: true, after: true })), finalHeld: true, released: true },
    workspacePreferences: { handler: 'workspacePreferencesGet', initialized: true, responseVerified: true },
    telemetry: { excludedFeature: 'speed_insights', path: '/_vercel/speed-insights/script.js', method: 'GET', resourceType: 'script', noQuery: true, policy: 'abort_before_execution', abortedRequests: 0 },
    blockedRequests: 0, contextClosed: true };
  assert.equal(compatibilityBrowserIsolationVerified(proof, binding, names), true);
  assert.equal(compatibilityBrowserIsolationVerified(undefined, binding, names), false);
    for (const alter of [p => { delete p.harnessSha; }, p => { p.harnessSha = 'd'.repeat(40); }, p => { p.backgroundSync.modules.pop(); },
      p => { p.backgroundSync.modules[0].after = false; }, p => { p.backgroundSync.modules.reverse(); }, p => { p.backgroundSync.released = false; },
      p => { p.backgroundSync.broadcastChannel = false; }, p => { p.guardian.closed = false; }, p => { p.contextClosed = false; },
      p => { p.workspacePreferences.initialized = false; }, p => { p.blockedRequests = 1; }, p => { p.telemetry.rawUrl = 'secret'; },
      p => { p.sourceDigest = 'e'.repeat(64); }, p => { p.telemetry.abortedRequests = 1001; }]) {
      const changed = structuredClone(proof); alter(changed);
      assert.equal(compatibilityBrowserIsolationVerified(changed, binding, names), false);
    }
});
