import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const [version,lateRunway,crossDeadline,httpFailureStatus] of [[2,false,false],[3,false,false],[3,true,false],[3,false,true],[2,false,false,403],[3,false,false,403],[3,false,false,503]]) test(`v${version}${httpFailureStatus ? ` HTTP${httpFailureStatus} terminal refusal` : lateRunway ? " late-runway refusal" : crossDeadline ? " derived-deadline latency refusal" : ""}: one inert preflight joins native publication, warm carrier, real TLS host, artifact bytes and native consumption`, () => {
  const child = spawnSync(process.execPath, [
    '--experimental-test-module-mocks', '--test',
    fileURLToPath(new URL('./helpers/xero-recovery-joined-child.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1048576,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      XERO_JOINED_PLAN_VERSION: String(version), XERO_JOINED_LATE_RUNWAY: lateRunway ? '1' : '0',
      XERO_JOINED_HTTP_FAILURE_STATUS: String(httpFailureStatus || 0),
      XERO_JOINED_CROSS_DEADLINE: crossDeadline ? '1' : '0', LANG: 'C.UTF-8', NODE_NO_WARNINGS: '1' } });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /pass 1/);
  assert.doesNotMatch(child.stdout + child.stderr, /FIXTURE_PRIVATE_|PRIVATE_APPROVED_PASSWORD|eyJhbGci/);
});
