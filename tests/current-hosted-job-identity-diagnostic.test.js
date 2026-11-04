import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentHostedJobIdentity, safeCurrentJobIdentity } from '../scripts/lib/hosted-release/current-job-identity.mjs';
import { atReleaseBoundary, safeDiagnosticFailure } from '../scripts/lib/hosted-release/failure.mjs';
import { hostedDependencyEntrypointFailure, hostedDependencies } from '../scripts/hosted-release-dependencies.mjs';
import { ReleaseError } from '../scripts/lib/hosted-release/json-contract.mjs';

const fixture = () => ({ run: { run_attempt: 1, event: 'workflow_dispatch', head_branch: 'qualified', head_sha: 'a'.repeat(40) },
  jobs: [{ id: 71, name: 'release / dependencies / before', status: 'in_progress', conclusion: null, head_sha: 'a'.repeat(40), run_id: 123 }],
  jobName: 'release / dependencies / before', env: { GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' }, qualificationSource: { ref: 'refs/heads/qualified' } });
function refusal(f) { try { assertCurrentHostedJobIdentity(f); assert.fail('MUST_REFUSE'); } catch (e) { assert.equal(e.code, 'CURRENT_HOSTED_JOB_IDENTITY'); return e; } }

test('exact original current-job predicate still admits only the unique active job', () => {
  const f = fixture(); assert.equal(assertCurrentHostedJobIdentity(f), f.jobs[0]);
  const main = fixture(); delete main.qualificationSource; main.run.head_branch = 'main'; assert.equal(assertCurrentHostedJobIdentity(main).id, 71);
});

test('each current-job identity predicate has an exact safe failed label', () => {
  for (const [where, field, value, expected] of [
    ['run', 'run_attempt', 2, 'RUN_ATTEMPT'], ['run', 'event', 'push', 'RUN_EVENT'], ['run', 'head_branch', 'main', 'RUN_BRANCH'],
    ['run', 'head_sha', 'b'.repeat(40), 'RUN_HEAD_SHA'], ['job', 'name', 'other', 'ACTIVE_NAMED_JOB_UNIQUE'],
    ['job', 'status', 'queued', 'ACTIVE_NAMED_JOB_UNIQUE'], ['job', 'conclusion', 'success', 'ACTIVE_NAMED_JOB_UNIQUE'],
    ['job', 'head_sha', undefined, 'JOB_HEAD_SHA'], ['job', 'run_id', undefined, 'JOB_RUN_ID'], ['job', 'run_id', '123', 'JOB_RUN_ID'],
  ]) { const f = fixture(); (where === 'run' ? f.run : f.jobs[0])[field] = value; const e = refusal(f); assert.ok(e.detail.currentJobIdentity.failedPredicates.includes(expected)); }
  const missing = fixture(); missing.jobs = []; assert.equal(refusal(missing).detail.currentJobIdentity.namedJobs, 0);
  const duplicate = fixture(); duplicate.jobs.push({ ...duplicate.jobs[0] });
  const d = refusal(duplicate).detail.currentJobIdentity; assert.deepEqual(d.failedPredicates, ['ACTIVE_NAMED_JOB_UNIQUE']); assert.equal(d.activeNamedJobs, 2); assert.equal(d.jobHeadMatches, undefined);
});

test('named/status/conclusion counts distinguish unique-job refusal without copying provider payloads', () => {
  const f = fixture(); f.jobs.push({ ...f.jobs[0], status: 'queued' }); f.jobs[0].conclusion = 'PRIVATE';
  const e = refusal(f), d = e.detail.currentJobIdentity;
  assert.deepEqual([d.namedJobs, d.inProgressNamedJobs, d.nullConclusionNamedJobs, d.activeNamedJobs], [2, 1, 1, 0]);
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE|qualified|dependencies|head_sha|run_id/);
});

test('same original predicate verdicts hold for all bounded status/conclusion/run variants', () => {
  for (const status of ['queued', 'in_progress', 'completed']) for (const conclusion of [null, undefined, 'success']) for (const attempt of [1, 2]) for (const jobRun of [123, '123', 124]) {
    const f = fixture(); f.jobs[0].status = status; f.jobs[0].conclusion = conclusion; f.jobs[0].run_id = jobRun; f.run.run_attempt = attempt;
    const matches = f.jobs.filter(job => job.name === f.jobName && job.status === 'in_progress' && job.conclusion === null);
    const oldAccepted = !(f.run.run_attempt !== 1 || f.run.event !== 'workflow_dispatch' || f.run.head_branch !== 'qualified' || f.run.head_sha !== f.env.GITHUB_SHA || matches.length !== 1 || matches[0].head_sha !== f.run.head_sha || matches[0].run_id !== Number(f.env.GITHUB_RUN_ID));
    let accepted = true; try { assertCurrentHostedJobIdentity(f); } catch { accepted = false; }
    assert.equal(accepted, oldAccepted);
  }
});

test('actual dependency session refusal reaches boundary sanitizer and CLI projection before any producer action', async () => {
  const f = fixture(); delete f.jobs[0].head_sha;
  let producer = 0, error;
  try { await hostedDependencies({ env: { FCOS_VERIFICATION_PHASE: 'before', FCOS_RELEASE_MANIFEST: '{}' }, readManifest: () => ({}),
    sessionFactory: async options => { assert.equal(options.jobName, f.jobName); return atReleaseBoundary('session.github', () => assertCurrentHostedJobIdentity(f)); },
    measure: () => { producer++; }, preserve: () => { producer++; } }); } catch (e) { error = e; }
  assert.equal(producer, 0); assert.equal(error.code, 'CURRENT_HOSTED_JOB_IDENTITY');
  const safe = safeDiagnosticFailure(error), line = JSON.parse(JSON.stringify(hostedDependencyEntrypointFailure(error)));
  assert.deepEqual(line, { status: 'failed', code: 'CURRENT_HOSTED_JOB_IDENTITY', currentJobIdentity: safe.currentJobIdentity });
  assert.deepEqual(line.currentJobIdentity.failedPredicates, ['JOB_HEAD_SHA']); assert.equal(line.currentJobIdentity.jobHeadPresent, false);
});

test('current-job diagnostics require the exact typed error/boundary and strip arbitrary strings/getters', () => {
  assert.deepEqual(hostedDependencyEntrypointFailure({ code: 'CURRENT_HOSTED_JOB_IDENTITY', detail: { currentJobIdentity: { failedPredicates: ['JOB_HEAD_SHA'] } } }), { status: 'failed', code: 'CURRENT_HOSTED_JOB_IDENTITY' });
  const wrong = new ReleaseError('CURRENT_HOSTED_JOB_IDENTITY', 'browser.normal', 'PRIVATE', { currentJobIdentity: { failedPredicates: ['JOB_HEAD_SHA'] } });
  assert.equal(safeDiagnosticFailure(wrong).currentJobIdentity, undefined);
  let n = 0; const d = safeCurrentJobIdentity({ failedPredicates: ['JOB_HEAD_SHA', 'PRIVATE'], get namedJobs() { return ++n === 1 ? 1 : 'PRIVATE'; }, activeNamedJobs: Infinity, jobHeadPresent: 'PRIVATE', token: 'PRIVATE' });
  assert.deepEqual(d, { failedPredicates: ['JOB_HEAD_SHA'], namedJobs: 1 }); assert.equal(n, 1); assert.doesNotMatch(JSON.stringify(d), /PRIVATE/);
});
