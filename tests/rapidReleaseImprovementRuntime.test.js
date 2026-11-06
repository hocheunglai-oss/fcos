import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { handleReleaseObstacle, recordVerifiedLearning } from '../scripts/lib/rapid-release/improvement-runtime.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => hash(canonical(value));
const controllerDirectory = resolve('.');
const manifest = { releaseId: 'release-fixture-one', targets: { repository: fcosConnectionIdentifier('github', 'Repository'), projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'), origin: new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin }, candidate: { sha: 'a'.repeat(40) }, build: { buildId: 'fixture-build', publicEnvironment: {} } };
const registry = { schemaVersion: 1, recipes: [] };
const journal = () => { const records = []; return { records, read: async () => records, append: async (event, data) => records.push({ payload: { event, data } }) }; };
const recipe = (incident, patch = {}) => ({ schemaVersion: 1, id: 'reconcile-original-fixture', status: 'verified', kind: incident.kind, action: 'reconcile_original_operation', preconditions: incident.inputs, proof: { reproduced: true, regressionPassed: true, sourceDigest: incident.inputs.source, checkDigest: 'c'.repeat(64) }, ...patch });
async function fixture(run) { const directory = await mkdtemp(join(tmpdir(), 'fcos-improvement-test-')); try { await run({ directory, outputFile: join(directory, 'incident.json') }); } finally { await rm(directory, { recursive: true, force: true }); } }
const call = options => handleReleaseObstacle({ manifest, controllerDirectory, registry, phase: 'stage', ...options });

test('unknown failures are captured once with no raw provider message, stack, credential or unowned code', async () => fixture(async ({ outputFile }) => {
  const error = { code: 'MALICIOUS_SECRET_CODE', message: 'Bearer PRIVATE_TOKEN password=PRIVATE_PASSWORD', stack: 'PRIVATE_STACK' };
  const first = await call({ error, outputFile, completedSteps: ['lint', 'password=PRIVATE_PASSWORD'] });
  const second = await call({ error, outputFile });
  assert.equal(first.state, 'supervisor_diagnosis');
  assert.equal(first.workRequest.type, 'supervisor_work_request');
  assert.equal(first.incident.code, 'UNCLASSIFIED_RELEASE_OBSTACLE');
  assert.equal(first.incident.signature, second.incident.signature);
  const stored = await readFile(outputFile, 'utf8');
  assert.equal(JSON.parse(stored).records.filter(record => record.payload.event === 'obstacle.detected').length, 1);
  assert.doesNotMatch(stored, /PRIVATE_|MALICIOUS|Bearer/);
}));

test('real original-operation discovery records only a matching applied native result and never submits', async () => fixture(async ({ outputFile }) => {
  const j = journal(), request = { buildId: manifest.build.buildId, candidateSha: manifest.candidate.sha, artifactDigest: 'd'.repeat(64) };
  await j.append('stage.intent', { operationId: `${manifest.releaseId}-stage`, request, requestHash: digest(request) });
  const incident = (await call({ error: { code: 'ORIGINAL_OPERATION_READBACK_REQUIRED' }, outputFile })).incident;
  let discoveries = 0, ownerships = 0;
  const provider = { assertOwnership: async () => { ownerships++; }, discover: async context => {
    discoveries++; assert.deepEqual(context.request, request); assert.equal(context.operationId, `${manifest.releaseId}-stage`);
    return { outcome: 'applied', result: { id: 'dpl_fixtureOne', url: 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app', target: 'production', state: 'READY', operationId: context.operationId, manifestHash: digest(manifest), sha: manifest.candidate.sha, buildId: manifest.build.buildId, artifactDigest: request.artifactDigest, token: 'PRIVATE_IGNORED' } };
  }, stage: async () => { throw Error('must never submit'); } };
  const result = await call({ error: { code: 'ORIGINAL_OPERATION_READBACK_REQUIRED' }, journal: j, provider, outputFile, registry: { schemaVersion: 1, recipes: [recipe(incident)] } });
  assert.equal(result.state, 'resume_checkpoint');
  assert.equal(discoveries, 1); assert.equal(ownerships, 1);
  assert.equal(j.records.filter(record => record.payload.event === 'stage.result').length, 1);
  assert.equal(result.measuredSavings, null);
  assert.equal(result.proof.measurement.providerMethodCalls, 2);
  assert.equal(JSON.stringify(j.records).includes('PRIVATE_'), false);
  const repeated = await call({ error: { code: 'ORIGINAL_OPERATION_READBACK_REQUIRED' }, journal: j, provider, outputFile, registry: { schemaVersion: 1, recipes: [recipe(incident)] } });
  assert.equal(repeated.state, 'already_verified'); assert.equal(discoveries, 1);
}));

test('unknown original readback remains pending and preserves the original intent', async () => fixture(async ({ outputFile }) => {
  const j = journal(), request = { buildId: manifest.build.buildId };
  await j.append('stage.intent', { operationId: `${manifest.releaseId}-stage`, request, requestHash: digest(request) });
  const incident = (await call({ error: { code: 'ORIGINAL_OPERATION_READBACK_REQUIRED' }, outputFile })).incident;
  const provider = { assertOwnership: async () => {}, discover: async () => ({ outcome: 'unknown' }) };
  const result = await call({ error: { code: 'ORIGINAL_OPERATION_READBACK_REQUIRED' }, journal: j, provider, outputFile, registry: { schemaVersion: 1, recipes: [recipe(incident)] } });
  assert.equal(result.state, 'awaiting_original_outcome');
  assert.equal(j.records.filter(record => record.payload.event === 'stage.intent').length, 1);
  assert.equal(j.records.some(record => ['stage.result', 'repair.verified', 'repair.disabled'].includes(record.payload.event)), false);
}));

test('version mismatch cannot reuse a recipe, two prior attempts escalate and failed deterministic repair disables its recipe', async () => fixture(async ({ outputFile }) => {
  const incident = (await call({ error: { code: 'BUILD_FAILED' }, outputFile })).incident;
  let actions = 0;
  const known = recipe(incident, { action: 'repair_fixture', deterministic: true });
  const configured = { schemaVersion: 1, recipes: [known], trustedHandlers: { repair_fixture: async () => { actions++; throw Error('PRIVATE_PROVIDER_ERROR'); } }, authority: async () => {} };
  const mismatch = await call({ error: { code: 'BUILD_FAILED' }, outputFile, registry: { ...configured, recipes: [{ ...known, preconditions: { ...incident.inputs, tools: 'e'.repeat(64) } }] } });
  assert.equal(mismatch.state, 'supervisor_diagnosis'); assert.equal(actions, 0);
  const j = journal();
  for (let attempt = 0; attempt < 2; attempt++) await j.append('repair.attempted', { signature: incident.signature, approach: 'event-driven-recovery' });
  const escalated = await call({ error: { code: 'BUILD_FAILED' }, outputFile, journal: j, registry: configured });
  assert.equal(escalated.state, 'escalate_analysis'); assert.equal(actions, 0);
  const other = journal();
  const failed = await call({ error: { code: 'BUILD_FAILED' }, outputFile, journal: other, registry: configured });
  assert.equal(failed.recipeDisabled, true); assert.equal(actions, 1);
  await call({ error: { code: 'BUILD_FAILED' }, outputFile, journal: other, registry: configured });
  assert.equal(actions, 1);
}));

test('learning requires proof, exact input preconditions, authority and a separate version-controlled worktree', async () => fixture(async ({ directory, outputFile }) => {
  const repo = join(directory, 'repo'), worktree = join(directory, 'worktree'); await mkdir(repo);
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  await writeFile(join(repo, 'recipes.json'), '{"schemaVersion":1,"recipes":[]}\n'); git(['add', 'recipes.json']); git(['commit', '-m', 'fixture']); git(['worktree', 'add', '-b', 'codex/fixture', worktree]);
  const incident = (await call({ error: { code: 'BUILD_FAILED' }, outputFile })).incident;
  const known = recipe(incident);
  const proof = { ...known.proof, originalOperationsPreserved: true, authorityExpanded: false };
  await assert.rejects(recordVerifiedLearning({ registryFile: join(worktree, 'recipes.json'), controllerDirectory, recipe: known, incident, proof: { ...proof, regressionPassed: false }, authority: async () => {} }), { code: 'LEARNING_VERIFIED_REPRODUCTION_REQUIRED' });
  const result = await recordVerifiedLearning({ registryFile: join(worktree, 'recipes.json'), controllerDirectory, recipe: known, incident, proof, authority: async () => {} });
  assert.equal(result.recorded, true);
  const stored = JSON.parse(await readFile(join(worktree, 'recipes.json'), 'utf8'));
  assert.equal(stored.recipes[0].proof.checkDigest, proof.checkDigest);
  await assert.rejects(recordVerifiedLearning({ registryFile: join(worktree, 'recipes.json'), controllerDirectory: worktree, recipe: known, incident, proof, authority: async () => {} }), { code: 'LEARNING_REQUIRES_SEPARATE_ISOLATED_WORKTREE' });
}));
