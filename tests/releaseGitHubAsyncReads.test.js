import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { githubReleaseAsyncReads } from '../scripts/lib/release-github-async-reads.mjs';

const repository = 'hocheunglai-oss/fcos';
const runtime = { command: 'gh-fixed', env: { GH_REPO: repository }, injectedArgs: ['--hostname', 'github.com'] };
const endpoint = `repos/${repository}/actions/runs/1`;

function syncOutput(value, calls) {
  return (command, args, options) => { calls.push({ command, args, options }); return value; };
}

test('identity remains synchronous with the fixed GET command contract', () => {
  const calls = [];
  const reads = githubReleaseAsyncReads(runtime, { cwd: '/fixed/cwd', executeSync: syncOutput('{"login":"hocheunglai-oss","id":7}', calls),
    executeAsync: () => assert.fail('user identity must not use async execution') });
  assert.deepEqual(reads.json('user'), { login: 'hocheunglai-oss', id: 7 });
  assert.deepEqual(calls, [{ command: 'gh-fixed', args: ['api', 'user', '--method', 'GET', '--hostname', 'github.com'],
    options: { cwd: '/fixed/cwd', env: runtime.env, timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' } }]);
});

test('rejects unpinned routes before either executor runs', async () => {
  let calls = 0;
  const reads = githubReleaseAsyncReads(runtime, { executeSync: () => { calls++; }, executeAsync: () => { calls++; } });
  await assert.rejects(reads.json('repos/other/repository'), /outside the pinned repository/);
  await assert.rejects(reads.archive(`repos/${repository}-suffix/actions/artifacts/1/zip`), /outside the pinned repository/);
  assert.equal(calls, 0);
});

test('every mutable JSON read executes freshly and suppresses malformed and CLI diagnostics', async () => {
  let calls = 0;
  const reads = githubReleaseAsyncReads(runtime, { executeSync: syncOutput('{"login":"hocheunglai-oss","id":7}', []),
    executeAsync: (_command, _args, _options, callback) => { calls++; callback(null, calls === 1 ? '{"value":1}' : '{"value":2}', 'private stderr'); } });
  assert.deepEqual(await reads.json(endpoint), { value: 1 });
  assert.deepEqual(await reads.json(endpoint), { value: 2 });
  assert.equal(calls, 2);

  const malformed = githubReleaseAsyncReads(runtime, { executeAsync: (_command, _args, _options, callback) => callback(null, '{private malformed') });
  await assert.rejects(malformed.json(endpoint), error => error.message === 'Pinned GitHub release read failed; private diagnostics suppressed.');
  const failed = githubReleaseAsyncReads(runtime, { executeAsync: (_command, _args, _options, callback) => callback(new Error('private provider stderr')) });
  await assert.rejects(failed.json(endpoint), error => error.message === 'Pinned GitHub release read failed; private diagnostics suppressed.' && !error.message.includes('provider'));
});

test('limits mixed JSON and archive GETs to two FIFO executions and settles queued successes and errors', async () => {
  const calls = [];
  const callbacks = [];
  let active = 0, maximum = 0, synchronousCalls = 0;
  const reads = githubReleaseAsyncReads(runtime, { executeSync: () => { synchronousCalls++; return '{"login":"hocheunglai-oss","id":7}'; },
    executeAsync: (command, args, options, callback) => {
    active++; maximum = Math.max(maximum, active); calls.push({ command, endpoint: args[1], args, options });
    callbacks.push((error, stdout) => { active--; callback(error, stdout); });
  } });
  const first = reads.json(`${endpoint}/one`);
  const second = reads.archive(`repos/${repository}/actions/artifacts/2/zip`);
  const third = reads.json(`${endpoint}/three`);
  const fourth = reads.archive(`repos/${repository}/actions/artifacts/4/zip`);
  assert.equal(maximum, 2);
  assert.throws(() => reads.json('user'), error => error.message === 'Pinned GitHub release read failed; private diagnostics suppressed.');
  assert.equal(synchronousCalls, 0, 'identity must not create a third process while async GETs are active');
  assert.deepEqual(calls.map(call => call.endpoint), [`${endpoint}/one`, `repos/${repository}/actions/artifacts/2/zip`]);
  callbacks.shift()(null, '{"first":true}');
  assert.deepEqual(calls.map(call => call.endpoint), [`${endpoint}/one`, `repos/${repository}/actions/artifacts/2/zip`, `${endpoint}/three`]);
  callbacks.shift()(new Error('private archive failure'));
  assert.deepEqual(calls.map(call => call.endpoint), [`${endpoint}/one`, `repos/${repository}/actions/artifacts/2/zip`, `${endpoint}/three`, `repos/${repository}/actions/artifacts/4/zip`]);
  callbacks.shift()(null, '{"third":true}');
  const bytes = Buffer.from([0, 255, 7, 128]);
  callbacks.shift()(null, bytes);
  assert.deepEqual(await first, { first: true });
  await assert.rejects(second, error => error.message === 'Pinned GitHub release read failed; private diagnostics suppressed.');
  assert.deepEqual(await third, { third: true });
  assert.deepEqual(await fourth, bytes);
  assert.equal(maximum, 2);
  for (const call of calls) {
    assert.equal(call.command, 'gh-fixed');
    assert.deepEqual(call.args, ['api', call.endpoint, '--method', 'GET', '--hostname', 'github.com']);
    assert.equal(call.options.env, runtime.env);
    assert.equal(call.options.timeout, 30000);
    assert.equal(call.options.maxBuffer, 4 * 1024 * 1024);
    assert.deepEqual(call.options.stdio, ['ignore', 'pipe', 'pipe']);
  }
  assert.equal(calls[1].options.encoding, 'buffer');
  assert.equal(calls[0].options.encoding, 'utf8');
});

test('the default child-process adapter preserves archive bytes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-async-gh-read-'));
  const executable = join(directory, 'fixed-gh-fixture.mjs');
  const bytes = Buffer.from([0, 255, 7, 128]);
  try {
    writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write(Buffer.from([0, 255, 7, 128]));\n`, { mode: 0o700 });
    chmodSync(executable, 0o700);
    const reads = githubReleaseAsyncReads({ command: executable, env: { PATH: process.env.PATH } });
    assert.deepEqual(await reads.archive(`repos/${repository}/actions/artifacts/7/zip`), bytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
