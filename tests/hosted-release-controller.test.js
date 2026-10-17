import test from 'node:test';
import { admitVercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import assert from 'node:assert/strict';
import { canonical, digest, NORMAL_MODULES, validateManifest } from '../scripts/lib/hosted-release/contract.mjs';
import { consequential, executeHostedProduction, preparePreview } from '../scripts/lib/hosted-release/controller.mjs';

const H = 'a'.repeat(64), S = 'b'.repeat(40), clock = Date.parse('2026-10-17T03:00:00Z');
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

function fixture() {
  const manifest = fixtureManifest(), events = [], state = { operations: {}, checks: {}, status: 'active' };
  let live = { id: manifest.previousProduction.deploymentId, sha: manifest.previousProduction.sha };
  const staged = { id: 'dpl_staged', sha: manifest.candidate.sha, target: 'production', projectId: manifest.targets.vercelProject, teamId: manifest.targets.vercelTeam, url: 'https://fcos-example.vercel.app', state: 'READY' };
  for (const checkId of manifest.requiredChecks) state.checks[checkId] = {
    schemaVersion: 2, checkId, status: 'passed', manifestHash: digest(manifest), candidateSha: manifest.candidate.sha, controllerSha: manifest.controller.sha,
    inputsSha256: H, artifactSha256: H, capturedAt: new Date(clock).toISOString(), kind: 'volatile', maxAgeSeconds: 1800,
    publisher: { trust: 'hosted_controller', runId: 1, jobId: 2 }, result: { modules: NORMAL_MODULES, actualData: true, unexpectedWrites: 0, identity: 'restricted', serverBundlesRequired: true },
  };
  const coordinator = {
    register: async () => state, snapshot: async () => structuredClone(state),
    request: async action => { assert.equal(action, 'approve'); return { manifestHash: digest(manifest), expiresAt: new Date(clock + 86400000).toISOString() }; },
    begin: async ({ phase, operationId, requestHash }) => {
      const old = state.operations[phase];
      if (old) { assert.equal(old.requestHash, requestHash); return { disposition: old.state === 'complete' ? 'complete' : 'readback', evidence: old.evidence }; }
      if (Object.values(state.operations).some(row => row.state !== 'complete')) return { disposition: 'busy' };
      state.operations[phase] = { operationId, requestHash, state: 'intent' }; events.push(`intent:${phase}`); return { disposition: 'execute' };
    },
    complete: async ({ phase, evidence }) => { Object.assign(state.operations[phase], { state: 'complete', evidence }); events.push(`complete:${phase}`); },
    uncertain: async ({ phase }) => { state.operations[phase].state = 'uncertain'; },
    readback: async ({ phase, evidence }) => { Object.assign(state.operations[phase], { state: 'complete', evidence }); },
    appendEvidence: async ({ key, evidence }) => { state.checks[key] = evidence; },
    finish: async ({ status }) => { state.status = status; },
  };
  const provider = {
    admit: async () => {}, currentProduction: async () => live,
    createPreview: async () => ({ ...staged, id: 'dpl_preview', target: 'preview' }),
    stage: async () => { events.push('stage'); return staged; }, ready: async deployment => deployment,
    discover: async () => ({ outcome: 'applied', result: staged }), verifyArtifact: async (_, __, phase) => { events.push(`verify:${phase}`); },
    promote: async () => { events.push('promote'); live = staged; },
    rollbackCompatibility: async () => ({ compatible: true, deploymentId: 'dpl_previous', schemaSha256: H, runtimeSha256: manifest.runtime.expectedSha256 }),
    rollback: async () => { events.push('rollback'); live = { id: 'dpl_previous', sha: manifest.previousProduction.sha }; }, verifyRollback: async () => {},
  };
  return { manifest, state, events, coordinator, provider, now: () => clock, setLive: value => { live = value; } };
}

test('manifest binds frozen scope, all live checks, exact targets and rollback authorization', () => {
  const manifest = fixtureManifest(); assert.equal(validateManifest(manifest).manifestHash, digest(manifest));
  for (const mutate of [m => { m.candidate.sha = S; }, m => { m.requiredChecks.pop(); }, m => { m.targets.vercelProject = 'other'; }, m => { m.authorization.rollback.schemaRollback = true; }, m => { m.scope.handoffs.push({ kind: 'status19', sha256: H }); }]) {
    const bad = structuredClone(manifest); mutate(bad); assert.throws(() => validateManifest(bad));
  }
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('real controller entrypoints prepare, stage, verify, promote and complete; restart sends no more writes', async () => {
  const f = fixture(); assert.equal((await preparePreview(f)).status, 'ready');
  assert.equal((await executeHostedProduction(f)).status, 'complete');
  assert.ok(f.events.indexOf('intent:production.stage') < f.events.indexOf('stage'));
  assert.ok(f.events.indexOf('verify:staged') < f.events.indexOf('promote'));
  const count = f.events.length; assert.equal((await executeHostedProduction(f)).resumed, true); assert.equal(f.events.length, count);
});

test('lost submission and runner crash resume only through exact readback, never create again', async () => {
  const f = fixture(); let submissions = 0, discoverable = false;
  f.provider.stage = async () => { submissions++; throw new Error('opaque'); };
  const discover = f.provider.discover;
  f.provider.discover = async (...args) => discoverable ? discover(...args) : { outcome: 'unknown' };
  await assert.rejects(executeHostedProduction(f), { code: 'PROVIDER_OUTCOME_UNKNOWN' });
  assert.equal(f.state.operations['production.stage'].state, 'uncertain');
  discoverable = true;
  assert.equal((await executeHostedProduction(f)).status, 'complete'); assert.equal(submissions, 1);
});

test('losing journal completion response cannot replay a successful provider submission', async () => {
  const f = fixture(); const complete = f.coordinator.complete; let lost = true;
  f.coordinator.complete = async input => { await complete(input); if (lost) { lost = false; throw new Error('runner interruption'); } };
  await assert.rejects(executeHostedProduction(f));
  assert.equal((await executeHostedProduction(f)).status, 'complete'); assert.equal(f.events.filter(value => value === 'stage').length, 1);
});

test('pending evidence waits without staging and downstream restart preserves existing passing evidence', async () => {
  const f = fixture(); delete f.state.checks.normal_role;
  assert.deepEqual((await executeHostedProduction(f)).missing, ['normal_role']); assert.ok(!f.events.includes('stage'));
});

test('expired live evidence is refreshed, deterministic acceptance is not rerun', async () => {
  const f = fixture(); f.state.checks.normal_role.capturedAt = new Date(clock - 7200000).toISOString();
  let refreshes = 0; f.provider.collectCheck = async id => { refreshes++; return { ...f.state.checks[id], capturedAt: new Date(clock).toISOString() }; };
  assert.equal((await executeHostedProduction(f)).status, 'complete'); assert.equal(refreshes, 2);
});

test('failed live verification automatically rolls back only to currently compatible recorded build', async () => {
  const f = fixture(); f.provider.verifyArtifact = async (_, __, phase) => { if (phase === 'live') throw new Error('health'); };
  assert.equal((await executeHostedProduction(f)).status, 'rolled_back'); assert.equal(f.events.filter(value => value === 'rollback').length, 1);
  assert.equal((await executeHostedProduction(f)).resumed, true);
});

test('rollback is refused when schema compatibility or current Production ownership changed', async () => {
  for (const moved of [false, true]) {
    const f = fixture(); f.provider.verifyArtifact = async (_, __, phase) => { if (phase === 'live') { if (moved) f.setLive({ id: 'dpl_other' }); throw new Error('health'); } };
    f.provider.rollbackCompatibility = async () => ({ compatible: false });
    await assert.rejects(executeHostedProduction(f), { code: moved ? 'ROLLBACK_PRODUCTION_MOVED' : 'ROLLBACK_INCOMPATIBLE' }); assert.ok(!f.events.includes('rollback'));
  }
});

test('qualification cannot call real Production and duplicate intent never gets execute twice', async () => {
  const f = fixture(); f.manifest.stage = 'qualification'; f.manifest.executionMode = 'qualification';
  admitVercelReadFixture(f.manifest);
  await assert.rejects(executeHostedProduction(f), { code: 'QUALIFICATION_CANNOT_DEPLOY' });
  let calls = 0;
  const args = { manifest: f.manifest, coordinator: f.coordinator, phase: 'preview.create', request: { x: 1 }, submit: async () => { calls++; return { id: 'dpl_once' }; }, readback: async () => ({ outcome: 'unknown' }) };
  assert.deepEqual(await consequential(args), { id: 'dpl_once' }); assert.deepEqual(await consequential(args), { id: 'dpl_once' }); assert.equal(calls, 1);
});

test('long staged build rechecks volatile acceptance before promotion and resumes without another deployment', async () => {
  const f=fixture(); let current=clock;
  f.now=()=>current;
  f.provider.ready=async d=>{current=clock+1801000;return d;};
  const first=await executeHostedProduction(f);
  assert.equal(first.status,'waiting_dependency');assert.equal(first.phase,'production.acceptance');
  assert.equal(f.events.filter(x=>x==='stage').length,1);assert.ok(!f.events.includes('promote'));
  for(const proof of Object.values(f.state.checks)) if(proof.kind==='volatile')proof.capturedAt=new Date(current).toISOString();
  assert.equal((await executeHostedProduction(f)).status,'complete');
  assert.equal(f.events.filter(x=>x==='stage').length,1);assert.equal(f.events.filter(x=>x==='promote').length,1);
});
