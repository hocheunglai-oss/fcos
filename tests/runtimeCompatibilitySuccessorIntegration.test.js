import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SOURCE_ROOT, cleanGitEnvironment } from './helpers/runtimeCompatibilitySuccessorPortable.mjs';

// npm test discovers this .test.js file. Only this exact child receives the VM
// flag; no inherited NODE_OPTIONS, preload, credentials or provider settings.
test('portable successor hermetic closure executes all 20 focused unit checks', t => {
  const args = ['--experimental-vm-modules', '--test', '--test-reporter=tap',
    join(SOURCE_ROOT, 'tests/runtimeCompatibilitySuccessorIntegration.hermetic.mjs')];
  const result = spawnSync(process.execPath, args, { cwd: SOURCE_ROOT,
    env: cleanGitEnvironment(), encoding: 'utf8', timeout: 120000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  // Keep the inner TAP visible and distinguish the 20 checks from this one
  // discovery wrapper. A failed child cannot be represented as a passing suite.
  t.diagnostic(result.stdout || 'No inner TAP emitted.');
  if (result.stderr) t.diagnostic(result.stderr);
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, 'Hermetic child failed; inspect preserved inner TAP.');
  for (const line of ['# tests 20', '# pass 20', '# fail 0', '# skipped 0', '# todo 0']) {
    assert.ok(result.stdout.split(/\r?\n/).includes(line), `Missing exact inner TAP summary: ${line}`);
  }
});
