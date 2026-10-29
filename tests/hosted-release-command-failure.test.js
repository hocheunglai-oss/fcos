import test from 'node:test';
import assert from 'node:assert/strict';
import { vercelCommandFailure, safeVercelCommandFailure } from '../scripts/lib/hosted-release/vercel-command-failure.mjs';
import { consequential, preparePreview, executeHostedProduction, safeFailure } from '../scripts/lib/hosted-release/controller.mjs';
import { ReleaseError, digest } from '../scripts/lib/hosted-release/contract.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

test('native command failure preserves closed status and stream fingerprints, never secret-bearing error text', () => {
  const secret = 'PRIVATE_BEARER_OR_RESPONSE';
  const report = vercelCommandFailure({ status: 1, stdout: Buffer.from(secret), stderr: secret, code: 'ETIMEDOUT', signal: 'SIGTERM', message: secret, path: secret, spawnargs: [secret] }, 'deploy');
  assert.equal(report.exitStatus, 1); assert.equal(report.nativeCode, 'ETIMEDOUT'); assert.equal(report.signal, 'SIGTERM');
  assert.deepEqual(report.stdout, {bytes: Buffer.byteLength(secret), sha256: digest(secret)});
  assert.equal(report.outcome, 'unknown'); assert.equal(JSON.stringify(report).includes(secret), false);
  assert.deepEqual(safeVercelCommandFailure(report), report);
  const opaque = vercelCommandFailure({status: secret, code: secret, signal: secret, stderr: {}}, secret);
  assert.equal(opaque.command, 'unknown'); assert.equal(opaque.exitStatus, null); assert.equal(opaque.stderr, null);
  assert.equal(JSON.stringify(opaque).includes(secret), false);
});

test('public projection rejects added raw fields, malformed stream metadata and unrecognized signal or native code', () => {
  const base = vercelCommandFailure({status: 1, stderr: 'private'}, 'deploy');
  for (const mutation of [x => {x.message = 'SECRET';}, x => {x.signal = 'SECRET';}, x => {x.nativeCode = 'SECRET';},
    x => {x.stderr.sha256 = 'SECRET';}, x => {x.stderr.bytes = -1;}, x => {x.stderr.text = 'SECRET';}, x => {x.exitStatus = 256;}]) {
    const value = structuredClone(base); mutation(value); assert.equal(safeVercelCommandFailure(value), undefined);
    const projected = safeFailure(new ReleaseError('VERCEL_COMMAND_UNRESOLVED', 'vercel.write', 'Read back.', {commandFailure: value}));
    assert.equal(Object.hasOwn(projected, 'commandFailure'), false); assert.equal(JSON.stringify(projected).includes('SECRET'), false);
  }
});

function journalFixture() {
  const events = [], manifest = fixtureManifest(); let operation;
  const coordinator = {
    begin: async () => {events.push('begin'); if (operation) return {disposition: 'readback'}; operation = {state: 'intent'}; return {disposition: 'execute'};},
    uncertain: async row => {events.push('uncertain'); operation = {state: 'uncertain', row};},
    readback: async row => {events.push('readback'); operation = {state: 'complete', row};},
    complete: async () => assert.fail('failed submission cannot complete'),
  };
  return {manifest, coordinator, events, get operation() {return operation;}};
}

test('thrown submission journals the safe native diagnostic and stops before any inline discovery; separate recovery never resubmits', async () => {
  const f = journalFixture(), commandFailure = vercelCommandFailure({status: 1, stderr: 'SECRET'}, 'deploy');
  let writes = 0, reads = 0;
  const args = {...f, phase:'preview.create', request:{candidate:f.manifest.candidate,target:'preview'},
    submit: async () => {writes++; throw new ReleaseError('VERCEL_COMMAND_UNRESOLVED','vercel.write','Read only.',{commandFailure});},
    readback: async () => {reads++; return {outcome:'applied',result:{id:'dpl_original'}};}};
  await assert.rejects(consequential(args), error => {
    assert.equal(error.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.deepEqual(safeFailure(error).commandFailure, commandFailure); return true;
  });
  assert.equal(writes,1); assert.equal(reads,0); assert.deepEqual(f.events,['begin','uncertain']);
  assert.deepEqual(f.operation.row.evidence,{outcome:'unknown',reason:'PROVIDER_RESPONSE_LOST',commandFailure});
  assert.deepEqual(await consequential(args),{id:'dpl_original'});
  assert.equal(writes,1); assert.equal(reads,1); assert.equal(f.operation.state,'complete');
});

test('missing submission responses stop as uncertain without discovery or an applied receipt', async () => {
  for (const value of [null, undefined]) {
    const f = journalFixture();
    await assert.rejects(consequential({...f,phase:'preview.create',request:{},submit:async()=>value,readback:async()=>assert.fail('no follow-on read')}),{code:'PROVIDER_OUTCOME_UNKNOWN'});
    assert.equal(f.operation.state,'uncertain'); assert.deepEqual(f.events,['begin','uncertain']);
  }
});

test('uncertainty recording refusal stops all subsequent callbacks and never manufactures a completion', async () => {
  const f = journalFixture(); f.coordinator.uncertain = async () => {throw new ReleaseError('COORDINATION_RESPONSE_UNKNOWN','coordinator.uncertain');};
  const commandFailure=vercelCommandFailure({status:1,stderr:'SECRET'},'deploy');
  await assert.rejects(consequential({...f,phase:'preview.create',request:{},submit:async()=>{throw new ReleaseError('VERCEL_COMMAND_UNRESOLVED','vercel.write','Read only.',{commandFailure});},readback:async()=>assert.fail('no follow-on read')}),error=>{
    assert.equal(error.code,'COORDINATION_RESPONSE_UNKNOWN'); assert.deepEqual(safeFailure(error).commandFailure,commandFailure);
    assert.equal(JSON.stringify(safeFailure(error)).includes('SECRET'),false);return true;
  });
  assert.equal(f.operation.state,'intent'); assert.deepEqual(f.events,['begin']);
});

test('new Preview capability refusal occurs before begin; existing consumed Preview recovery bypasses only that create gate', async () => {
  const manifest = fixtureManifest(), events = [];
  const coordinator = {register:async()=>{},snapshot:async()=>({}),begin:async()=>assert.fail('must not consume intent')};
  const provider = {admit:async()=>{},assertWriteCapability:()=>{throw new ReleaseError('VERCEL_CLI_PROJECT_SCOPE_UNSUPPORTED','vercel.transport');}};
  await assert.rejects(preparePreview({manifest,coordinator,provider}),{code:'VERCEL_CLI_PROJECT_SCOPE_UNSUPPORTED'});
  coordinator.snapshot = async () => ({operations:{'preview.create':{state:'uncertain'}}});
  coordinator.begin = async () => ({disposition:'readback'});
  provider.discover = async () => {events.push('GET'); return {outcome:'unknown'};};
  await assert.rejects(preparePreview({manifest,coordinator,provider}),{code:'PROVIDER_OUTCOME_UNKNOWN'});
  assert.deepEqual(events,['GET']);
});

test('a consumed not-applied operation remains consumed and cannot request a new write', async () => {
  const manifest=fixtureManifest(), coordinator={begin:async()=>({disposition:'complete',evidence:{outcome:'not_applied'}})};
  await assert.rejects(consequential({manifest,coordinator,phase:'preview.create',request:{},submit:async()=>assert.fail('no retry'),readback:async()=>assert.fail('no extra read')}),{code:'OPERATION_CONSUMED_NOT_APPLIED'});
});

test('qualification still cannot reach a real Production operation', async () => {
  const manifest=fixtureManifest(); manifest.stage='qualification';
  await assert.rejects(executeHostedProduction({manifest,coordinator:{snapshot:async()=>assert.fail('no real Production')},provider:{}}));
});
