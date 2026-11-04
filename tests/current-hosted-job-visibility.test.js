import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireCurrentHostedJob } from '../scripts/lib/hosted-release/current-job-visibility.mjs';
import { githubClient } from '../scripts/lib/hosted-release/github.mjs';
import { safeDiagnosticFailure, atReleaseBoundary } from '../scripts/lib/hosted-release/failure.mjs';

const repository = 'hocheunglai-oss/fcos', actor = 'hocheunglai-oss', sha = 'a'.repeat(40), jobName = 'release / dependencies / before';
const snapshot = (status = 'queued', extra = {}) => ({ total_count: 1, jobs: [{ id: 71, name: jobName, status, conclusion: null, head_sha: sha, run_id: 123, ...extra }] });
function fixture(snapshots = [snapshot()]) {
  let clock = 1000;
  const calls = [], waits = [], controller = new AbortController();
  const args = { repository, jobName, env: { GITHUB_SHA: sha, GITHUB_RUN_ID: '123', GITHUB_REPOSITORY_ID: '99', GITHUB_ACTOR: actor, GITHUB_ACTOR_ID: '42' },
    run: { id: 123, run_attempt: 1, event: 'workflow_dispatch', head_branch: 'qualified', head_sha: sha, status: 'in_progress', conclusion: null,
      repository: { full_name: repository, id: 99 }, head_repository: { full_name: repository }, actor: { login: actor, id: 42 }, triggering_actor: { login: actor, id: 42 } },
    qualificationSource: { ref: 'refs/heads/qualified', bootstrapSha: sha }, qualificationRunVerified: true,
    signal: controller.signal, now: () => clock,
    delay: async (ms, _value, options) => { waits.push(ms); assert.equal(options.signal.aborted, false); clock += ms; },
    github: { read: async (path, options) => { calls.push({ path, options }); const value = snapshots[Math.min(calls.length - 1, snapshots.length - 1)]; if (value instanceof Error) throw value; return value; } },
  };
  return { args, calls, waits, controller, setClock: x => { clock = x; }, run: () => acquireCurrentHostedJob(args) };
}

test('already active exact self job consumes one complete-page GET and never waits', async () => {
  const f = fixture([snapshot('in_progress')]); assert.equal((await f.run()).id, 71); assert.equal(f.calls.length, 1); assert.deepEqual(f.waits, []);
  assert.equal(f.calls[0].path, `/repos/${repository}/actions/runs/123/attempts/1/jobs?per_page=100&page=1`);
});
test('only exact queued self-job can become active after one or two fixed waits with pinned id', async () => {
  for (const states of [['queued', 'in_progress'], ['queued', 'queued', 'in_progress']]) {
    const f = fixture(states.map(s => snapshot(s))); assert.equal((await f.run()).id, 71); assert.equal(f.calls.length, states.length);
    assert.deepEqual(f.waits, states.length === 2 ? [1000] : [1000, 3000]);
    assert.equal(new Set(f.calls.map(c => c.path)).size, 1); assert.equal(new Set(f.calls.map(c => c.options.signal)).size, 1);
    assert.deepEqual(f.calls.map(c => c.options.timeoutMs), states.length === 2 ? [10000, 9000] : [10000, 9000, 6000]);
  }
});
test('actual target-locked GitHub JSON client uses the same exact page for queued then active', async () => {
  const f = fixture(), calls = [];
  f.args.github = githubClient({ token: 'LOCAL_PRIVATE_FIXTURE', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), signal: options.signal }); return Response.json(snapshot(calls.length === 1 ? 'queued' : 'in_progress'));
  } });
  assert.equal((await f.run()).id, 71); assert.equal(calls.length, 2); assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].url, `https://api.github.com/repos/${repository}/actions/runs/123/attempts/1/jobs?per_page=100&page=1`);
  assert.deepEqual(f.waits, [1000]);
});
test('remaining queued after two additional reads refuses with no fourth GET', async () => {
  const f = fixture(); await assert.rejects(f.run(), { code: 'CURRENT_HOSTED_JOB_IDENTITY' }); assert.equal(f.calls.length, 3); assert.deepEqual(f.waits, [1000, 3000]);
});
test('missing, duplicate, truncated or unknown snapshots refuse without waiting or pagination', async () => {
  for (const s of [{ total_count: 0, jobs: [] }, { total_count: 2, jobs: [...snapshot().jobs, ...snapshot().jobs] },
    { total_count: 2, jobs: snapshot().jobs }, { total_count: 101, jobs: snapshot().jobs }, { total_count: '1', jobs: snapshot().jobs },
    { ...snapshot(), pending: true }, { ...snapshot(), completed: false }, { total_count: 1, jobs: [null] }]) {
    const f = fixture([s]); await assert.rejects(f.run(), { code: 'CURRENT_HOSTED_JOB_IDENTITY' }); assert.equal(f.calls.length, 1); assert.deepEqual(f.waits, []);
  }
});
test('terminal, unknown, nonnull conclusion or invalid ID never receives another GET', async () => {
  for (const s of [snapshot('completed', { conclusion: 'success' }), snapshot('waiting'), snapshot('unknown'), snapshot('queued', { conclusion: 'failure' }), snapshot('queued', { id: 0 })]) {
    const f = fixture([s]); await assert.rejects(f.run(), { code: 'CURRENT_HOSTED_JOB_IDENTITY' }); assert.equal(f.calls.length, 1); assert.deepEqual(f.waits, []);
  }
});
test('wrong run/head/attempt/actor/source/repository context never enters visibility wait', async () => {
  for (const change of [f => { f.args.run.run_attempt = 2; }, f => { f.args.run.event = 'push'; }, f => { f.args.run.head_branch = 'foreign'; },
    f => { f.args.run.head_sha = 'b'.repeat(40); }, f => { f.args.run.id = 124; }, f => { f.args.run.actor.id = 43; },
    f => { f.args.run.triggering_actor.login = 'foreign'; }, f => { f.args.run.repository.id = 100; },
    f => { f.args.qualificationRunVerified = false; }, f => { f.args.qualificationSource.bootstrapSha = 'b'.repeat(40); }]) {
    const f = fixture(); change(f); await assert.rejects(f.run(), { code: 'CURRENT_HOSTED_JOB_IDENTITY' }); assert.equal(f.calls.length, 1); assert.deepEqual(f.waits, []);
  }
  for (const extra of [{ head_sha: 'b'.repeat(40) }, { run_id: 124 }, { run_id: '123' }]) {
    const f = fixture([snapshot('queued', extra)]); await assert.rejects(f.run()); assert.equal(f.calls.length, 1); assert.deepEqual(f.waits, []);
  }
});
test('changed pinned ID, head/run mismatch, ambiguity or terminal later snapshot stops immediately', async () => {
  for (const s of [snapshot('in_progress', { id: 72 }), snapshot('in_progress', { head_sha: 'b'.repeat(40) }), snapshot('in_progress', { run_id: 124 }),
    { total_count: 2, jobs: [...snapshot().jobs, ...snapshot().jobs] }, snapshot('completed', { conclusion: 'cancelled' }), { ...snapshot(), unknown: true }]) {
    const f = fixture([snapshot(), s]); await assert.rejects(f.run()); assert.equal(f.calls.length, 2); assert.deepEqual(f.waits, [1000]);
  }
});
test('initial or subsequent transport throw/refusal has no subsequent call', async () => {
  for (const snapshots of [[Error('PRIVATE_TRANSPORT')], [snapshot(), Error('PRIVATE_TRANSPORT')]]) {
    const f = fixture(snapshots); await assert.rejects(f.run()); assert.equal(f.calls.length, snapshots.length); assert.equal(f.waits.length, snapshots.length - 1);
  }
  let calls = 0;
  const f = fixture(); f.args.github = githubClient({ token: 'LOCAL_PRIVATE_FIXTURE', fetchImpl: async () => { calls++; return new Response('PRIVATE', { status: 403 }); } });
  await assert.rejects(f.run(), { code: 'GITHUB_READ_HTTP_403' }); assert.equal(calls, 1); assert.deepEqual(f.waits, []);
});
test('earlier deadline, expired/late result and cancellation bound GETs and waits', async () => {
  const tight = fixture(); tight.args.deadlineEpochMs = 1500; await assert.rejects(tight.run()); assert.equal(tight.calls.length, 1); assert.deepEqual(tight.waits, []);
  const expired = fixture(); expired.args.deadlineEpochMs = 1000; await assert.rejects(expired.run()); assert.equal(expired.calls.length, 0);
  const late = fixture(); late.args.github.read = async () => { late.calls.push({}); late.setClock(11000); return snapshot('in_progress'); };
  await assert.rejects(late.run()); assert.equal(late.calls.length, 1); assert.deepEqual(late.waits, []);
  const cancelled = fixture(); cancelled.controller.abort(); await assert.rejects(cancelled.run()); assert.equal(cancelled.calls.length, 0);
  const during = fixture(); during.args.delay = async () => { during.controller.abort(); };
  await assert.rejects(during.run()); assert.equal(during.calls.length, 1);
  const drift = fixture(); drift.args.delay = async () => { drift.args.run.actor.id = 43; };
  await assert.rejects(drift.run()); assert.equal(drift.calls.length, 1);
  const waitError = fixture(); waitError.args.delay = async () => { throw Error('PRIVATE'); };
  await assert.rejects(waitError.run(), e => e.detail.currentJobIdentity.failedPredicates.includes('VISIBILITY_WAIT')); assert.equal(waitError.calls.length, 1);
});
test('actual GitHub fetch AND JSON-body hangs abort inside earlier visibility deadline with zero follow-on GETs', async () => {
  for (const stage of ['fetch', 'body']) {
    let calls = 0, nativeSignal; const f = fixture(); delete f.args.now; f.args.deadlineEpochMs = Date.now() + 25;
    f.args.github = githubClient({ token: 'LOCAL_PRIVATE_FIXTURE', fetchImpl: async (_url, options) => {
      calls++; nativeSignal = options.signal;
      if (stage === 'fetch') return new Promise(() => {});
      return { ok: true, json: () => new Promise(() => {}) };
    } });
    const keepAlive = setTimeout(() => {}, 250);
    try { const started = Date.now(); await assert.rejects(f.run()); assert.ok(Date.now() - started < 200); assert.equal(nativeSignal.aborted, true); assert.equal(calls, 1); assert.deepEqual(f.waits, []); }
    finally { clearTimeout(keepAlive); }
  }
});
test('actual JSON-body cancellation aborts native signal and cannot admit a later resolved body', async () => {
  const f = fixture(); delete f.args.now; let resolveBody, calls = 0, nativeSignal;
  f.args.github = githubClient({ token: 'LOCAL_PRIVATE_FIXTURE', fetchImpl: async (_url, options) => {
    calls++; nativeSignal = options.signal; return { ok: true, json: () => new Promise(r => { resolveBody = r; }) };
  } });
  const pending = f.run(); await new Promise(r => setImmediate(r)); f.controller.abort();
  await assert.rejects(pending); resolveBody(snapshot('in_progress')); await new Promise(r => setImmediate(r));
  assert.equal(nativeSignal.aborted, true); assert.equal(calls, 1); assert.deepEqual(f.waits, []);
});
test('new closed refusal labels survive original error code and actual safe boundary sanitizer', async () => {
  const f = fixture([{ total_count: 2, jobs: snapshot().jobs }]); let error;
  try { await atReleaseBoundary('session.github', () => f.run()); } catch (e) { error = e; }
  const safe = safeDiagnosticFailure(error); assert.equal(safe.code, 'CURRENT_HOSTED_JOB_IDENTITY');
  assert.deepEqual(safe.currentJobIdentity.failedPredicates, ['JOBS_SNAPSHOT_COMPLETE']); assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|qualified|token|head_sha/);
});
