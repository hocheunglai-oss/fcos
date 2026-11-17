import assert from 'node:assert/strict';
import test from 'node:test';
import { editorsClosureResult, originalEditorsRun, verifyStoppedEditorsClosure } from '../scripts/lib/rapid-release/editors-devee-closure.mjs';
import { pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';

test('Editors closure resolves only the outer operation while recording retained DEVEE work', () => {
  const result = editorsClosureResult('a'.repeat(64));
  assert.equal(result.outcome,'editors_devee_retained_no_production_effect');
  assert.equal(result.deveeRestorationPending,true);
  assert.equal(result.originalDeveeDeploymentId,originalEditorsRun.deployId);
  const original = { payload:{ event:'prerequisites.intent',data:{operationId:result.operationId} } };
  const unknown = { payload:{ event:'promote.intent',data:{operationId:'unrelated-promotion'} } };
  const closure = { payload:{ event:'prerequisites.result',data:result } };
  assert.equal(pendingOperations([original,closure]).length,0);
  assert.deepEqual(pendingOperations([original,unknown,closure]),[{event:'promote.intent',data:unknown.payload.data}]);
});

test('Editors closure refuses an unverifiable readback digest', () => {
  assert.throws(()=>editorsClosureResult('unverified'),/EDITORS_CLOSURE_EVIDENCE_MISMATCH/u);
});

test('a nonterminal or reassigned original run cannot enter closure', () => {
  const input = { run:{ id:originalEditorsRun.runId,status:'in_progress' }, jobs:{jobs:[]},records:[],requests:[] };
  assert.throws(()=>verifyStoppedEditorsClosure(input),/EDITORS_CLOSURE_ORIGINAL_RUN_MISMATCH/u);
});
