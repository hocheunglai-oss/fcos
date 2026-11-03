import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostedRelease } from '../scripts/hosted-release.mjs';
import { preparePreview, terminalReleaseStatus } from '../scripts/lib/hosted-release/controller.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

function fixture(t, status) {
  const root = mkdtempSync(join(tmpdir(), 'fcos-terminal-recovery-')), previous = process.cwd();
  process.chdir(root);
  t.after(() => { process.chdir(previous); rmSync(root, { recursive: true, force: true }); });
  const manifest = fixtureManifest();
  const approval = { manifest_hash: digest(manifest), expires_at: '2026-10-01T00:00:00Z', receipt: { protectedJobStartedAt: '2026-09-30T00:00:00Z' } };
  const snapshot = { status, finished: true, approval, registration: { release_id: manifest.releaseId, epoch: manifest.epoch,
    manifest_hash: digest(manifest), manifest: structuredClone(manifest) },
    checks: new Proxy({}, { ownKeys: () => assert.fail('terminal recovery must not recheck original evidence'), get: () => assert.fail('terminal recovery must not recheck original evidence') }) };
  const calls = [];
  const coordinator = new Proxy({ register: async () => calls.push('register'), snapshot: async () => { calls.push('snapshot'); return snapshot; } }, {
    get: (target, key) => key in target ? target[key] : () => assert.fail(`unexpected coordinator call: ${String(key)}`),
  });
  const env = { FCOS_RELEASE_MANIFEST: JSON.stringify(manifest), FCOS_RELEASE_OUTPUT: join(root, 'result.json'), GITHUB_OUTPUT: join(root, 'workflow-output'), GITHUB_STEP_SUMMARY: join(root, 'summary') };
  const sessionFactory = async context => {
    calls.push('admission'); assert.deepEqual(context.manifest, manifest); assert.equal(context.jobName, 'release / prepare');
    return { coordinator, admission: new Proxy({}, { get: () => assert.fail('terminal recovery must not plan or rerun admitted checks') }) };
  };
  return { root, manifest, approval, snapshot, coordinator, calls, env, sessionFactory };
}

for (const status of ['complete', 'rolled_back']) {
  test(`actual prepare entrypoint recovers saved ${status} without checks, authority renewal or provider setup`, async t => {
    const f = fixture(t, status), originalApproval = JSON.stringify(f.approval);
    const result = await hostedRelease('prepare', f);
    assert.deepEqual(f.calls, ['admission', 'register', 'snapshot']);
    assert.equal(result.status, status); assert.equal(result.resumed, true); assert.deepEqual(result.groups, []);
    assert.equal(JSON.stringify(result.originalApproval), originalApproval); assert.equal(JSON.stringify(f.snapshot.approval), originalApproval);
    const outputs = Object.fromEntries(readFileSync(f.env.GITHUB_OUTPUT, 'utf8').trim().split('\n').map(row => { const i = row.indexOf('='); return [row.slice(0, i), row.slice(i + 1)]; }));
    assert.equal(outputs.terminal, 'true'); assert.equal(outputs.terminal_status, status);
    assert.deepEqual(JSON.parse(outputs.groups), { group: [] }); assert.deepEqual(JSON.parse(outputs.browser_matrix), { mode: [] });
    for (const key of ['has_checks', 'has_browsers', 'dependencies_required', 'approved']) assert.equal(outputs[key], 'false');
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'check-cache.json'), 'utf8')).checks, []);
    assert.equal(JSON.parse(readFileSync(f.env.FCOS_RELEASE_OUTPUT, 'utf8')).status, status);
  });

  test(`Preview defense preserves saved ${status} before any provider or intent call`, async t => {
    const f = fixture(t, status);
    const provider = new Proxy({}, { get: () => assert.fail('terminal Preview recovery must not admit credentials or contact a provider') });
    assert.deepEqual(await preparePreview({ ...f, provider }), { status, resumed: true });
    assert.deepEqual(f.calls, ['register', 'snapshot']);
  });
}

test('terminal recovery cannot bypass immutable source admission', async t => {
  const f = fixture(t, 'complete');
  await assert.rejects(hostedRelease('prepare', { ...f, sessionFactory: async () => { throw new Error('SOURCE_BINDING_CHANGED'); } }), /SOURCE_BINDING_CHANGED/);
  assert.deepEqual(f.calls, []); assert.equal(existsSync(f.env.FCOS_RELEASE_OUTPUT), false); assert.equal(existsSync(join(f.root, 'check-cache.json')), false);
});

test('actual prepare entrypoint cannot turn an arbitrary coordinator status into completion', async t => {
  const f = fixture(t, 'claimed_complete'); f.snapshot.checks = {};
  const result = await hostedRelease('prepare', { ...f, sessionFactory: async () => ({ coordinator: f.coordinator, admission: { checks: [] } }) });
  assert.equal(result.status, 'prepared'); assert.equal(result.resumed, undefined);
  const outputs = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
  assert.match(outputs, /(?:^|\n)terminal=false\n/); assert.match(outputs, /(?:^|\n)terminal_status=\n/);
});

test('only matching finished complete/rolled_back snapshots are terminal', () => {
  const manifest = fixtureManifest(), registration = { release_id: manifest.releaseId, epoch: manifest.epoch, manifest_hash: digest(manifest), manifest: structuredClone(manifest) };
  const snapshot = { status: 'complete', finished: true, registration };
  for (const status of [undefined, 'finished', 'success', 'COMPLETE', 'complete ', 'intervention_required']) assert.equal(terminalReleaseStatus({ ...snapshot, status }, manifest), null);
  for (const change of [{ finished: false }, { registration: { ...registration, release_id: 'another-release' } }, { registration: { ...registration, epoch: manifest.epoch + 1 } },
    { registration: { ...registration, manifest_hash: 'f'.repeat(64) } }, { registration: { ...registration, manifest: { ...manifest, changes: ['different source scope'] } } }, { registration: undefined }]) {
    assert.throws(() => terminalReleaseStatus({ ...snapshot, ...change }, manifest), { code: 'TERMINAL_RELEASE_BINDING' });
  }
});
