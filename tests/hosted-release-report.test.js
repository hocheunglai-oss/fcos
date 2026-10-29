import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportHostedRelease } from '../scripts/hosted-release-report.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

function fixture(t, { execute = 'failure', status = null, result } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fcos-release-report-')), previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; rmSync(root, { recursive: true, force: true }); });
  const manifest = fixtureManifest(), snapshot = { status, finished: ['complete', 'rolled_back'].includes(status),
    registration: { release_id: manifest.releaseId, epoch: manifest.epoch, manifest_hash: digest(manifest), manifest }, operations: {}, checks: {} };
  const file = join(root, 'production-result.json');
  if (result !== undefined) writeFileSync(file, typeof result === 'string' ? result : JSON.stringify(result));
  const env = { FCOS_RELEASE_MANIFEST: JSON.stringify(manifest), GITHUB_RUN_ID: '101', FCOS_RELEASE_OUTPUT: join(root, 'report.json'),
    GITHUB_STEP_SUMMARY: join(root, 'summary'), FCOS_JOB_RESULTS: JSON.stringify({ execute: { result: execute } }),
    ...(execute === 'skipped' ? {} : { FCOS_RELEASE_RESULT_FILE: file }) };
  const github = { identity: async () => {}, read: async () => ({ id: 101, run_attempt: 1, created_at: '2026-10-17T00:00:00Z', run_started_at: '2026-10-17T00:00:10Z' }),
    pages: async () => [{ name: 'release / execute', status: 'completed', conclusion: execute, started_at: '2026-10-17T00:00:20Z', completed_at: '2026-10-17T00:00:30Z' }] };
  return { root, env, snapshot, createGithub: () => github,
    sessionFactory: async context => { assert.equal(context.jobName, 'release / report'); assert.deepEqual(context.manifest, manifest); return { coordinator: { snapshot: async () => snapshot } }; } };
}

test('actual report entrypoint preserves safe executor failure details in report, summary and notification', async t => {
  const diagnostics = { code: 'ROLLBACK_INCOMPATIBLE', phase: 'production.rollback', recovery: 'Keep the operation recorded and request intervention; no schema rollback is permitted.' };
  const f = fixture(t, { result: { status: 'intervention_required', ...diagnostics, rawProviderResponse: 'must-not-appear', credential: 'must-not-appear' } });
  const report = await reportHostedRelease(f);
  assert.equal(report.status, 'intervention_required'); assert.equal(report.executorArtifact, 'available'); assert.equal(process.exitCode, 1);
  for (const [key, value] of Object.entries(diagnostics)) {
    assert.equal(report[key], value); assert.equal(report.notification[key], value); assert.ok(readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8').includes(value));
  }
  assert.equal(report.notification.event, 'intervention_required');
  assert.doesNotMatch(readFileSync(f.env.FCOS_RELEASE_OUTPUT, 'utf8') + readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /must-not-appear/);
});

test('missing attempted-executor artifact requires intervention even if finish was saved', async t => {
  const f = fixture(t, { execute: 'success', status: 'complete' });
  const report = await reportHostedRelease(f);
  assert.equal(report.status, 'intervention_required'); assert.equal(report.journalReleaseStatus, 'complete');
  assert.equal(report.executorArtifact, 'missing'); assert.equal(report.code, 'EXECUTOR_RESULT_ARTIFACT_MISSING'); assert.equal(process.exitCode, 1);
  assert.equal(report.notification.code, report.code); assert.match(report.recovery, /unchanged manifest/);
});

test('missing workflow result path cannot disguise an attempted executor as success', async t => {
  const f = fixture(t, { execute: 'success', status: 'complete' }); delete f.env.FCOS_RELEASE_RESULT_FILE;
  const report = await reportHostedRelease(f);
  assert.equal(report.status, 'intervention_required'); assert.equal(report.executorArtifact, 'missing'); assert.equal(process.exitCode, 1);
});

test('malformed executor artifact produces safe diagnostics without echoing its bytes', async t => {
  const f = fixture(t, { result: '{private-provider-response' });
  const report = await reportHostedRelease(f);
  assert.equal(report.executorArtifact, 'invalid'); assert.equal(report.code, 'EXECUTOR_RESULT_ARTIFACT_INVALID'); assert.equal(process.exitCode, 1);
  assert.doesNotMatch(readFileSync(f.env.FCOS_RELEASE_OUTPUT, 'utf8'), /private-provider-response/);
});

test('unsafe result diagnostic fields are rejected before reporting', async t => {
  const f = fixture(t, { result: { status: 'intervention_required', code: 'unsafe code value', recovery: 'private\nvalue' } });
  const report = await reportHostedRelease(f);
  assert.equal(report.executorArtifact, 'invalid'); assert.equal(report.code, 'EXECUTOR_RESULT_ARTIFACT_INVALID');
  assert.doesNotMatch(readFileSync(f.env.FCOS_RELEASE_OUTPUT, 'utf8'), /unsafe code value|private/);
});

test('actual rollback result retains its recorded cause in the final notification', async t => {
  const f = fixture(t, { execute: 'success', status: 'rolled_back', result: { status: 'rolled_back', cause: 'LIVE_VERIFICATION_FAILED' } });
  const report = await reportHostedRelease(f);
  assert.equal(report.status, 'rolled_back'); assert.equal(report.cause, 'LIVE_VERIFICATION_FAILED');
  assert.equal(report.notification.cause, report.cause); assert.ok(readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8').includes(report.cause));
  assert.equal(process.exitCode, 1);
});

test('an executor completion artifact alone cannot replace unavailable coordinator authority', async t => {
  const f = fixture(t, { execute: 'success', result: { status: 'complete' } });
  const report = await reportHostedRelease({ ...f, sessionFactory: async () => { throw new Error('unavailable'); } });
  assert.equal(report.status, 'intervention_required'); assert.equal(report.journalStatus, 'unavailable'); assert.equal(process.exitCode, 1);
});

for (const status of ['complete', 'rolled_back']) {
  test(`terminal ${status} recovery reports the saved journal without a new executor artifact or stale-proof rechecks`, async t => {
    const f = fixture(t, { execute: 'skipped', status });
    f.snapshot.checks = new Proxy({}, { get: (_, key) => key === 'hosted.qualification' ? undefined : assert.fail('terminal report must not recheck original evidence') });
    const report = await reportHostedRelease(f);
    assert.equal(report.status, status); assert.equal(report.journalReleaseStatus, status); assert.equal(report.executorArtifact, 'not_requested');
    assert.equal(report.notification.event, status); assert.equal(report.code, undefined); assert.deepEqual(report.notification.missing, []);
    if (status === 'rolled_back') assert.equal(process.exitCode, 1);
  });
}
