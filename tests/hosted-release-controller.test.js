import test from 'node:test';
import { admitVercelReadFixture } from './helpers/hosted-vercel-read.mjs';
import assert from 'node:assert/strict';
import { canonical, digest, NORMAL_MODULES, validateManifest,fail } from '../scripts/lib/hosted-release/contract.mjs';
import { consequential, executeHostedProduction, preparePreview,reconcilePending,safeFailure } from '../scripts/lib/hosted-release/controller.mjs';
import { firstRuntimeFixture,firstRuntimeOwnerRefreshFixture } from './helpers/hosted-first-runtime.mjs';
import { firstRuntimePrevious,validateFirstRuntimeOwnerRefresh } from '../scripts/lib/hosted-release/first-runtime.mjs';

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

test('terminal Preview and staged build failures stop immediately and preserve the acknowledged create on restart', async () => {
  for (const state of ['ERROR', 'CANCELED']) for (const production of [false, true]) {
    const f = fixture(), run = production ? executeHostedProduction : preparePreview;
    const phase = production ? 'production.stage' : 'preview.create';
    let creates = 0, reads = 0;
    const create = production ? f.provider.stage : f.provider.createPreview;
    f.provider[production ? 'stage' : 'createPreview'] = async (...args) => { creates++; return create(...args); };
    f.provider.ready = async deployment => { reads++; return { ...deployment, state }; };
    const first = await run(f), saved = structuredClone(f.state.operations[phase]);
    assert.deepEqual(first, { status: 'failed', phase: production ? 'production.ready' : 'preview.ready', deploymentId: saved.evidence.result.id, state });
    assert.equal(saved.state, 'complete'); assert.equal(saved.evidence.outcome, 'applied');
    assert.deepEqual(await run(f), first); assert.equal(creates, 1); assert.equal(reads, 2);
    assert.deepEqual(f.state.operations[phase], saved);
    assert.ok(!f.events.some(value => value.startsWith('verify:') || ['promote', 'rollback'].includes(value)));
    assert.equal(f.state.status, 'active');
  }
});

test('building deployments remain pending, but terminal state from a different deployment is rejected', async () => {
  for (const production of [false, true]) {
    const f = fixture(), run = production ? executeHostedProduction : preparePreview;
    f.provider.ready = async deployment => ({ ...deployment, state: 'BUILDING' });
    assert.equal((await run(f)).status, 'waiting_dependency');
    f.provider.ready = async deployment => ({ ...deployment, id: 'dpl_other', state: 'ERROR' });
    await assert.rejects(run(f), { code: 'DEPLOYMENT_IDENTITY' });
    assert.ok(!f.events.some(value => value.startsWith('verify:') || value === 'promote'));
  }
});

test('prepared Production requests bind the journal before submission and preserve acknowledged action receipts', async () => {
  const f = fixture(), requests = Object.fromEntries(['stage', 'promote', 'rollback'].map(action => [action, Object.freeze({ action, bodySha256: H })]));
  for (const action of Object.keys(requests)) {
    const original = f.provider[action];
    f.provider[`prepare${action[0].toUpperCase()}${action.slice(1)}Request`] = async (manifest, input) => {
      assert.equal(manifest, f.manifest); assert.equal(input.operationId, `${manifest.releaseId}-production-${action}`);
      f.events.push(`prepared:${action}`); return requests[action];
    };
    f.provider[action] = async (...args) => {
      assert.equal(args[1].request, requests[action]);
      assert.equal(f.state.operations[`production.${action}`].requestHash, digest(requests[action]));
      const value = await original(...args);
      return action === 'stage' ? value : { accepted: true, pending: false, sourceAction: { action, appliedProven: false } };
    };
  }
  f.provider.verifyArtifact = async (_, __, phase) => { if (phase === 'live') throw Error('fixture health failure'); };
  assert.equal((await executeHostedProduction(f)).status, 'rolled_back');
  for (const action of Object.keys(requests)) assert.ok(f.events.indexOf(`prepared:${action}`) < f.events.indexOf(`intent:production.${action}`));
  for (const action of ['promote', 'rollback']) {
    const saved = f.state.operations[`production.${action}`];
    assert.equal(saved.evidence.outcome, 'applied');
    assert.deepEqual(saved.evidence.result.sourceAction, { action, appliedProven: false });
  }
});

test('pending promotion or rollback stops before every follow-on provider read and remains owner-readback only', async () => {
  for (const action of ['promote', 'rollback']) {
    const f = fixture(); let reads = 0, atSubmission = null, submissions = 0;
    const observe = f.provider.currentProduction;
    f.provider.currentProduction = async () => { reads++; return observe(); };
    if (action === 'rollback') f.provider.verifyArtifact = async (_, __, phase) => { if (phase === 'live') throw Error('fixture health failure'); };
    f.provider[action] = async () => { submissions++; atSubmission = reads; return { accepted: true, pending: true }; };
    await assert.rejects(executeHostedProduction(f), { code: 'PROVIDER_OUTCOME_UNKNOWN' });
    assert.equal(submissions, 1); assert.equal(reads, atSubmission);
    assert.equal(f.state.operations[`production.${action}`].state, 'uncertain');
    assert.equal(f.state.status, 'active');
  }
});

test('Production request preparation failure cannot create an intent or submit a deployment', async () => {
  const f = fixture(); f.provider.prepareStageRequest = async () => { throw Error('source changed before claim'); };
  await assert.rejects(executeHostedProduction(f));
  assert.equal(f.state.operations['production.stage'], undefined);
  assert.ok(!f.events.includes('stage') && !f.events.includes('promote'));
});

test('a staged build that changes the public Production alias cannot mint a promotion intent or be adopted', async () => {
  for (const pointsToStage of [false, true]) {
    const f = fixture();
    f.provider.verifyArtifact = async (deployment, _, phase) => {
      if (phase === 'staged') f.setLive(pointsToStage ? deployment : { id: 'dpl_other', sha: S });
    };
    await assert.rejects(executeHostedProduction(f), { code: 'STAGED_PRODUCTION_ALIAS_CHANGED' });
    assert.equal(f.state.operations['production.stage'].evidence.outcome, 'applied');
    assert.equal(f.state.operations['production.promote'], undefined);
    assert.equal(f.state.checks['production.staged_verified'], undefined);
    assert.ok(!f.events.includes('promote') && !f.events.includes('rollback'));
  }
});

test('alias recovery validates the consumed request before owner reads and never invents an acknowledgement', async () => {
  const f = fixture();
  f.provider.promote = async () => ({ pending: true, accepted: true });
  await assert.rejects(executeHostedProduction(f), { code: 'PROVIDER_OUTCOME_UNKNOWN' });
  const operation = structuredClone(f.state.operations['production.promote']);
  let reads = 0; const observe = f.provider.currentProduction;
  f.provider.currentProduction = async () => { reads++; return observe(); };
  f.provider.verifyProjectActionRecoveryRequest = async (_, input) => {
    assert.deepEqual(input.operation, operation); throw Error('consumed request mismatch');
  };
  await assert.rejects(reconcilePending(f)); assert.equal(reads, 0);
  const receipt = Object.freeze({ basis: 'original_request_and_authenticated_owner_readback', postAcknowledgementProven: false });
  f.provider.verifyProjectActionRecoveryRequest = async (_, input) => {
    assert.deepEqual(input.operation, operation); assert.equal(input.phase, 'production.promote'); return receipt;
  };
  f.setLive(f.state.operations['production.stage'].evidence.result);
  const recovered = await reconcilePending(f);
  assert.equal(reads, 1); assert.equal(recovered.operations['production.promote'].state, 'complete');
  assert.deepEqual(recovered.operations['production.promote'].evidence.result.sourceActionReadback, receipt);
  assert.equal(recovered.operations['production.promote'].evidence.result.sourceAction, undefined);
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

test('first cutover preserves its manifest and completed stage while awaiting only expired original-owner observations',async()=>{
  const f=fixture(),first=firstRuntimeFixture({now:clock});let current=clock,reference;
  f.manifest.candidate.sourceProfile='frozen_04ee';f.manifest.previousProduction=firstRuntimePrevious(first.reference,{now:clock});
  const runtime={flags:first.runtime.flags,safety:first.runtime.safety,auth:first.runtime.auth};f.manifest.runtime.expectedProduction=runtime;f.manifest.runtime.expectedSha256=digest(runtime);
  f.setLive({id:f.manifest.previousProduction.deploymentId,sha:f.manifest.previousProduction.sha});f.now=()=>current;
  for(const proof of Object.values(f.state.checks))proof.manifestHash=digest(f.manifest);
  const manifestHash=digest(f.manifest),originalBaseline=first.reference.json;
  f.provider.admit=async()=>{try{validateFirstRuntimeOwnerRefresh(reference,{baselineReference:first.reference,expectedSha256:reference?.sha256,now:current});}
    catch(e){fail(e.code,'first_runtime.owner_refresh');}};
  let error;try{await executeHostedProduction(f);}catch(e){error=e;}assert.equal(safeFailure(error).status,'waiting_dependency');assert.equal(f.events.length,0);
  reference=firstRuntimeOwnerRefreshFixture(first).reference;f.provider.ready=async d=>{current=clock+1800001;return d;};
  try{await executeHostedProduction(f);}catch(e){error=e;}assert.equal(error.code,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');assert.equal(f.events.filter(e=>e==='stage').length,1);assert.ok(!f.events.includes('promote'));
  reference=firstRuntimeOwnerRefreshFixture(first,{now:current}).reference;
  f.provider.collectCheck=async id=>({...f.state.checks[id],capturedAt:new Date(current).toISOString()});
  assert.equal((await executeHostedProduction(f)).status,'complete');assert.equal(f.events.filter(e=>e==='stage').length,1);assert.equal(f.events.filter(e=>e==='promote').length,1);
  assert.equal(digest(f.manifest),manifestHash);assert.equal(first.reference.json,originalBaseline);
});


test('post-ACK verification failure keeps the original deployment and resumes only its consumer', async () => {
  const f=fixture();let creates=0;
  const create=f.provider.createPreview;f.provider.createPreview=async(...args)=>{creates++;return create(...args);};
  f.provider.ready=async()=>{throw Error('PRIVATE_PROVIDER_RESPONSE');};
  await assert.rejects(preparePreview(f),error=>{const safe=safeFailure(error);assert.equal(safe.code,'RELEASE_BOUNDARY_FAILED');assert.equal(safe.boundary,'preview.ready');assert.equal(JSON.stringify(safe).includes('PRIVATE'),false);return true;});
  assert.equal(f.state.operations['preview.create'].state,'complete');assert.equal(creates,1);
  f.provider.ready=async value=>value;f.provider.verifyArtifact=async()=>{throw new SyntaxError('PRIVATE_BODY');};
  await assert.rejects(preparePreview(f),error=>safeFailure(error).boundary==='preview.artifact');
  assert.equal(creates,1);assert.equal(f.events.filter(x=>x==='intent:preview.create').length,1);
  f.provider.verifyArtifact=async()=>{};assert.equal((await preparePreview(f)).status,'ready');assert.equal(creates,1);
});
