import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { githubReleaseAsyncReads } from '../scripts/lib/release-github-async-reads.mjs';
import { SUCCESSOR_LIVE_HARNESS_FILES } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { assertVerificationEnvironmentReview } from '../scripts/lib/release-evidence.mjs';

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

const commit = 'a'.repeat(40);
const contentsEndpoint = (path = 'scripts/example.mjs', ref = commit) => `repos/${repository}/contents/${path}?ref=${ref}`;
function contentsOutput(path, bytes = Buffer.from('verified source'), overrides = {}) {
  return JSON.stringify({ type: 'file', path, encoding: 'base64', size: bytes.length,
    sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    content: bytes.toString('base64') + '\n', ...overrides });
}
function contentsExecutor(calls, output = path => contentsOutput(path)) {
  return (_command, args, _options, callback) => {
    calls.push(args[1]); const path = args[1].split('/contents/')[1]?.split('?')[0];
    setImmediate(() => callback(null, output(path, args[1])));
  };
}

test('coalesces full-commit contents reads and returns independent copies', async () => {
  const calls = [], reads = githubReleaseAsyncReads(runtime, { executeAsync: contentsExecutor(calls) });
  const values = await Promise.all([reads.json(contentsEndpoint()), reads.json(contentsEndpoint()), reads.json(contentsEndpoint())]);
  assert.equal(calls.length, 1);
  values[0].content = 'caller corruption';
  assert.equal(values[1].content, Buffer.from('verified source').toString('base64') + '\n');
  assert.deepEqual(await reads.json(contentsEndpoint()), values[1]);
  assert.equal(calls.length, 1);
  await reads.json(contentsEndpoint('scripts/other.mjs'));
  await reads.json(contentsEndpoint('scripts/example.mjs', 'b'.repeat(40)));
  assert.equal(calls.length, 3);
});

test('branch, ambiguous, encoded and noncanonical source routes remain uncached', async () => {
  const calls = [], reads = githubReleaseAsyncReads(runtime, { executeAsync: contentsExecutor(calls) });
  const paths = [contentsEndpoint(undefined, 'main'), contentsEndpoint(undefined, 'abc123'),
    contentsEndpoint(undefined, 'A'.repeat(40)), contentsEndpoint() + '&ref=' + commit,
    contentsEndpoint() + '&extra=true', contentsEndpoint('scripts%2Fexample.mjs'),
    contentsEndpoint('scripts//example.mjs'), contentsEndpoint('scripts/../example.mjs')];
  for (const path of paths) { await reads.json(path); await reads.json(path); }
  assert.equal(calls.length, paths.length * 2);
});

test('rejects malformed immutable blobs without caching failure and accepts newline base64 and empty files', async () => {
  for (const overrides of [{ type: 'dir' }, { path: 'other' }, { sha: '0'.repeat(40) }, { content: '%%%invalid' },
    { content: 'dmVyaWZpZWQgc291cmNl\r' }, { size: 999 }]) {
    let calls = 0;
    const reads = githubReleaseAsyncReads(runtime, { executeAsync: (_c, _a, _o, callback) => {
      calls++; callback(null, contentsOutput('scripts/example.mjs', Buffer.from('verified source'), calls === 1 ? overrides : {}));
    } });
    await assert.rejects(reads.json(contentsEndpoint()), error => error.message === 'Pinned GitHub release read failed; private diagnostics suppressed.');
    assert.equal((await reads.json(contentsEndpoint())).type, 'file');
    await reads.json(contentsEndpoint()); assert.equal(calls, 2);
  }
  const calls = [], reads = githubReleaseAsyncReads(runtime, { executeAsync: contentsExecutor(calls,
    path => contentsOutput(path, Buffer.alloc(0), { content: '' })) });
  assert.equal((await reads.json(contentsEndpoint())).size, 0);
  await reads.json(contentsEndpoint()); assert.equal(calls.length, 1);
});

test('failed immutable CLI requests clear coalescing state and suppress private diagnostics', async () => {
  let calls = 0;
  const reads = githubReleaseAsyncReads(runtime, { executeAsync: (_c, _a, _o, callback) => {
    calls++; setImmediate(() => calls === 1 ? callback(new Error('private credential diagnostic'))
      : callback(null, contentsOutput('scripts/example.mjs')));
  } });
  const first = await Promise.allSettled([reads.json(contentsEndpoint()), reads.json(contentsEndpoint())]);
  assert.ok(first.every(value => value.status === 'rejected' && value.reason.message === 'Pinned GitHub release read failed; private diagnostics suppressed.'));
  await reads.json(contentsEndpoint()); assert.equal(calls, 2);
});

test('bounds coalescing and entry eviction while preserving the two-process limit', async () => {
  const calls = []; let active = 0, maximum = 0;
  const reads = githubReleaseAsyncReads(runtime, { executeAsync: (_c, args, _o, callback) => {
    calls.push(args[1]); active++; maximum = Math.max(maximum, active);
    setImmediate(() => { active--; callback(null, contentsOutput(args[1].split('/contents/')[1].split('?')[0])); });
  } });
  const paths = Array.from({ length: 129 }, (_, i) => contentsEndpoint(`scripts/file-${i}.mjs`));
  await Promise.all([...paths.map(path => reads.json(path)), reads.json(paths[128])]);
  assert.equal(calls.length, 130, 'the bounded in-flight map declines a new distinct key when full');
  assert.equal(maximum, 2);
  await reads.json(paths[0]); assert.equal(calls.length, 131, 'oldest entry is evicted at capacity');
});

test('bounds cached bytes and leaves oversized valid contents uncached', async () => {
  const calls = [], bytes = Buffer.alloc(750 * 1024, 97);
  const reads = githubReleaseAsyncReads(runtime, { executeAsync: contentsExecutor(calls, path => contentsOutput(path, bytes)) });
  for (let i = 0; i < 9; i++) await reads.json(contentsEndpoint(`large-${i}.txt`));
  await reads.json(contentsEndpoint('large-0.txt'));
  assert.equal(calls.length, 10, 'total byte limit evicts the oldest entry before entry-count capacity');
  const largeCalls = [], large = githubReleaseAsyncReads(runtime, { executeAsync: contentsExecutor(largeCalls,
    path => contentsOutput(path, Buffer.alloc(800 * 1024, 98))) });
  await large.json(contentsEndpoint()); await large.json(contentsEndpoint());
  assert.equal(largeCalls.length, 2);
});

test('a changed transport identity cannot reuse cached source', async () => {
  const boundRuntime = { command: 'gh-fixed', env: { GH_REPO: repository, GH_TOKEN: 'fixture-a' } }, calls = [];
  const reads = githubReleaseAsyncReads(boundRuntime, { executeAsync: contentsExecutor(calls) });
  await reads.json(contentsEndpoint()); boundRuntime.env.GH_TOKEN = 'fixture-b';
  await assert.rejects(reads.json(contentsEndpoint()), /private diagnostics suppressed/);
  assert.equal(calls.length, 1);
});

test('cached self-consistent source still requires every caller expected-SHA256 check', async () => {
  const calls = [], reads = githubReleaseAsyncReads(runtime, { executeAsync: contentsExecutor(calls) });
  const expected = createHash('sha256').update('different pinned source').digest('hex'); let checks = 0;
  for (let i = 0; i < 2; i++) {
    const value = await reads.json(contentsEndpoint()); checks++;
    assert.notEqual(createHash('sha256').update(Buffer.from(value.content, 'base64')).digest('hex'), expected);
  }
  assert.equal(checks, 2); assert.equal(calls.length, 1);
});

test('reuses the complete real trusted-source closure while approvals remain fresh and can deny the next admission', async () => {
  const calls = [], files = new Map(SUCCESSOR_LIVE_HARNESS_FILES.map(path => [path, readFileSync(new URL('../' + path, import.meta.url))]));
  assert.ok(files.size > 64 && files.size < 128);
  let approvalReads = 0;
  const actor = { login: 'hocheunglai-oss', id: 7 }, environment = { name: 'fcos-ci-readonly', id: 7, can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: actor }] }] };
  const run = { run_attempt: 1, actor, triggering_actor: actor };
  const reads = githubReleaseAsyncReads(runtime, { executeAsync: (_c, args, _o, callback) => {
    calls.push(args[1]);
    if (args[1].endsWith('/approvals')) {
      approvalReads++; callback(null, JSON.stringify(approvalReads === 1
        ? [{ state: 'approved', user: actor, environments: [{ id: 7, name: 'fcos-ci-readonly' }] }] : []));
    } else {
      const path = args[1].split('/contents/')[1].split('?')[0];
      setImmediate(() => callback(null, contentsOutput(path, files.get(path))));
    }
  } });
  let expectedSHA256Checks = 0;
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const [path, body] of files) {
      const value = await reads.json(contentsEndpoint(path)); expectedSHA256Checks++;
      assert.equal(createHash('sha256').update(Buffer.from(value.content, 'base64')).digest('hex'), createHash('sha256').update(body).digest('hex'));
    }
    const approvals = await reads.json(`repos/${repository}/actions/runs/1/approvals`);
    if (sweep === 0) assertVerificationEnvironmentReview({ environment, approvals, run, kind: 'restricted_browser' });
    else assert.throws(() => assertVerificationEnvironmentReview({ environment, approvals, run, kind: 'restricted_browser' }), /missing the exact human/);
  }
  assert.equal(expectedSHA256Checks, files.size * 2);
  assert.equal(calls.filter(path => path.includes('/contents/')).length, files.size);
  assert.equal(approvalReads, 2);
});


test('duplicate uncoupled completions do not double-count cached bytes at in-flight capacity', async () => {
  const calls = [], large = Buffer.alloc(750 * 1024, 97);
  const reads = githubReleaseAsyncReads(runtime, { executeAsync: contentsExecutor(calls, path =>
    contentsOutput(path, path === 'large-duplicate.txt' ? large : Buffer.from('small'))) });
  const small = Array.from({ length: 128 }, (_, i) => contentsEndpoint(`small-${i}.txt`));
  await Promise.all([...small.map(path => reads.json(path)),
    ...Array.from({ length: 12 }, () => reads.json(contentsEndpoint('large-duplicate.txt')))]);
  assert.equal(calls.length, 140);
  await reads.json(contentsEndpoint('large-duplicate.txt'));
  await reads.json(small[127]);
  assert.equal(calls.length, 140, 'replacement must not evict entries through phantom bytes');
});
