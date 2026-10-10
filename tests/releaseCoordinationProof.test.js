import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { exerciseArtifactCoordination, releaseCoordinationProofPlan, runReleaseCoordinationProof, waitForProofAction } from '../scripts/release-coordination-proof.mjs';
function backend() {
  const records = new Map(); let id = 0;
  const upload = async (name, marker) => {
    if (records.has(name)) throw Error('exclusive conflict');
    const row = { id: ++id, digest: `fixture-${id}`, marker }; records.set(name, row); return row;
  };
  return { upload, read: async name => structuredClone(records.get(name)), crash: async () => { await upload('crash', 'crash'); return 86; } };
}
test('artifact-only proof is disabled and outside a real exact protected job refuses before provider reads', async () => {
  assert.equal(releaseCoordinationProofPlan().mutations, 0);
  await assert.rejects(() => runReleaseCoordinationProof());
  const workflow = load(readFileSync(new URL('../.github/workflows/release-coordination-proof.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.jobs.proof.environment, 'fcos-production-release');
  assert.match(workflow.jobs.proof.if, /PROOF_ENABLED == 'true'/);
  assert.match(workflow.jobs.proof.if, /PROOF_HARNESS_SHA == github.sha/);
  const step = workflow.jobs.proof.steps.find(row => row.with?.route === 'proof');
  assert.deepEqual(Object.keys(step.env), ['GH_TOKEN']);
});
test('offline backend exercise requires one winner, immutable duplicate refusal and GET-only child recovery', async () => {
  const result = await exerciseArtifactCoordination(backend());
  assert.equal(result.grantsActivation, false); assert.equal(result.deploymentAuthority, false);
  assert.equal(result.artifacts.length, 2);
  for (const change of [
    api => { api.upload = async () => ({ id: 1, digest: 'fixture' }); },
    api => { api.read = async () => ({ id: 99, digest: 'changed' }); },
    api => { api.crash = async () => 0; },
    api => { const read = api.read; let calls = 0; api.read = async name => ++calls === 2 ? {} : read(name); },
  ]) { const api = backend(); change(api); await assert.rejects(() => exerciseArtifactCoordination(api)); }
});


test('initial action wait permits root job-bound admission without renewing the original run deadline', async () => {
  let clock = 0, reads = 0;
  const action = await waitForProofAction({ runId: 9, deadline: 30000, now: () => clock, pause: async ms => { clock += ms; },
    read: () => JSON.stringify(++reads < 3 ? { binding: { runId: 8 } } : { binding: { runId: 9 }, fixture: true }) });
  assert.equal(action.binding.runId, 9); assert.equal(clock, 20000); assert.equal(reads, 3);
  clock = 0;
  await assert.rejects(() => waitForProofAction({ runId: 9, deadline: 15000, now: () => clock, pause: async ms => { clock += ms; }, read: () => undefined }));
  assert.equal(clock, 15000);
  await assert.rejects(() => waitForProofAction({ runId: 9, deadline: 16000, now: () => clock, read: () => { clock = 16001; return JSON.stringify({ binding: { runId: 9 } }); } }));
});
