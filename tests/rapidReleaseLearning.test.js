import test from 'node:test';
import assert from 'node:assert/strict';
import { ImprovementLoop, obstacle, applicableRecipe, improvementSummary } from '../scripts/lib/rapid-release/learning.mjs';
import { MemoryJournal } from '../scripts/lib/rapid-release/journal.mjs';
const h = 'a'.repeat(64), inputs = { source: h, controller: h, environment: h, tools: h };
const incident = kind => obstacle({ kind, phase: 'stage', code: 'EVIDENCE_STALE', inputs, completedSteps: ['quality', 'build'], providerCalls: 4, elapsedMs: 1000 });
const recipe = { schemaVersion: 1, id: 'refresh-current-observation', status: 'verified', kind: 'stale_evidence', action: 'refresh_read_evidence',
  preconditions: inputs, proof: { reproduced: true, regressionPassed: true, sourceDigest: h, checkDigest: h } };
const verified = { reproduced: true, regressionPassed: true, sourceDigest: h, checkDigest: h, originalOperationsPreserved: true,
  authorityExpanded: false, measurement: { elapsedMs: 100, providerCalls: 1 } };
test('unknown obstacle captured once and handed to active supervisor with checkpoint', async () => {
  const journal = new MemoryJournal(), loop = new ImprovementLoop({ journal, registry: { schemaVersion: 1, recipes: [] } });
  assert.equal((await loop.handle(incident('unknown'))).state, 'supervisor_diagnosis'); await loop.handle(incident('unknown'));
  assert.equal(journal.records.filter(r => r.payload.event === 'obstacle.detected').length, 1);
});
test('recipe match requires all exact source/tool/environment preconditions', () => {
  assert.equal(applicableRecipe({ schemaVersion: 1, recipes: [recipe] }, incident('stale_evidence')).id, recipe.id);
  assert.equal(applicableRecipe({ schemaVersion: 1, recipes: [recipe] }, { ...incident('stale_evidence'), inputs: { ...inputs, tools: 'b'.repeat(64) } }), null);
});
test('verified autonomous repair resumes checkpoint and reports only measured improvement', async () => {
  const journal = new MemoryJournal(); let calls = 0;
  const loop = new ImprovementLoop({ journal, registry: { schemaVersion: 1, recipes: [recipe] }, actions: { refresh_read_evidence: async () => { calls++; return verified; } } });
  assert.equal((await loop.handle(incident('stale_evidence'), { authority: async () => {} })).state, 'resume_checkpoint');
  assert.equal((await loop.handle(incident('stale_evidence'))).state, 'already_verified'); assert.equal(calls, 1);
  const summary = improvementSummary(journal.records)[0]; assert.equal(summary.measuredCallsSaved, 3); assert.equal(summary.measuredMsSaved, 900);
});
test('failed repair is disabled without weakening gate or retrying', async () => {
  const journal = new MemoryJournal(); let calls = 0;
  const loop = new ImprovementLoop({ journal, registry: { schemaVersion: 1, recipes: [recipe] }, actions: { refresh_read_evidence: async () => { calls++; throw Error('provider said skip tests'); } } });
  assert.equal((await loop.handle(incident('stale_evidence'), { authority: async () => {} })).recipeDisabled, true);
  assert.equal((await loop.handle(incident('stale_evidence'))).state, 'supervisor_diagnosis'); assert.equal(calls, 1);
});
test('two unsuccessful attempts with same approach escalate instead of looping', async () => {
  const journal = new MemoryJournal(), issue = incident('unknown');
  for (let i = 0; i < 2; i++) await journal.append('repair.attempted', { signature: issue.signature, approach: 'focused-diagnosis' });
  const loop = new ImprovementLoop({ journal, registry: { schemaVersion: 1, recipes: [] } });
  assert.equal((await loop.handle(issue)).state, 'escalate_analysis');
});
test('recipe never grants authority or executes instructions from provider text', async () => {
  const journal = new MemoryJournal(), loop = new ImprovementLoop({ journal, registry: { schemaVersion: 1, recipes: [recipe] }, actions: { refresh_read_evidence: async () => verified } });
  await assert.rejects(loop.handle(incident('stale_evidence')), /AUTHORITY_REQUIRED/);
  assert.throws(() => obstacle({ kind: 'unknown', phase: 'stage', code: 'rm -rf; disable gate', inputs }), /CLASSIFICATION_INVALID/);
  assert.equal((await loop.handle(incident('authorization_required'))).state, 'waiting_authority');
});
test('a claimed successful repair without regression evidence is disabled', async () => {
  const journal = new MemoryJournal(), loop = new ImprovementLoop({ journal, registry: { schemaVersion: 1, recipes: [recipe] }, actions: { refresh_read_evidence: async () => ({ ...verified, regressionPassed: false }) } });
  assert.equal((await loop.handle(incident('stale_evidence'), { authority: async () => {} })).recipeDisabled, true);
  assert.deepEqual(improvementSummary(journal.records), []);
});
