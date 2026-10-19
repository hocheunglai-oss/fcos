import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('one inert preflight joins native publication, warm carrier, real TLS host, artifact bytes and native consumption', () => {
  const child = spawnSync(process.execPath, [
    '--experimental-test-module-mocks', '--test',
    fileURLToPath(new URL('./helpers/xero-recovery-joined-child.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1048576,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      LANG: 'C.UTF-8', NODE_NO_WARNINGS: '1' } });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /pass 1/);
  assert.doesNotMatch(child.stdout + child.stderr, /FIXTURE_PRIVATE_|PRIVATE_APPROVED_PASSWORD|eyJhbGci/);
});
