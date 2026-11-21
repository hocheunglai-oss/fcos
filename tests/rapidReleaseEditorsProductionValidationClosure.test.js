import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEditorsClosureApproval, editorsClosureEnvironment, editorsClosureOutcome,
  editorsProductionValidationClosureResult, originalEditorsProductionValidation as original,
  verifyStoppedEditorsProductionValidation } from '../scripts/lib/rapid-release/editors-production-validation-closure.mjs';
import { pendingOperations } from '../scripts/lib/rapid-release/journal.mjs';

const owner = { id: original.actorId, login: 'hocheunglai-oss' };
const review = { state: 'approved', user: owner, environments: [editorsClosureEnvironment] };

function workflowAttempt({ id, mode, conclusion, jobIds, day }) {
  const created_at = `2026-11-${day}T01:00:00Z`;
  const completed_at = `2026-11-${day}T02:00:00Z`;
  const run = { id, status: 'completed', conclusion, run_attempt: 1, event: 'workflow_dispatch',
    head_branch: 'main', head_sha: original.dispatcher, repository: { id: original.repositoryId, full_name: 'hocheunglai-oss/fcos' },
    actor: owner, triggering_actor: owner, created_at, path: '.github/workflows/fcos-rapid-release.yml@refs/heads/main',
    display_title: `FCOS rapid ${mode} ${original.manifestHash} ${original.candidate}` };
  return { run, jobs: { total_count: 3, jobs: ['quality', 'stage-and-smoke', 'go-live'].map((name, i) => ({
    id: jobIds[i], name, run_id: id, run_attempt: 1, status: 'completed', conclusion: i === 2 ? conclusion : 'success',
    started_at: created_at, completed_at,
  })) }, approvals: [structuredClone(review)] };
}

function nativeHistory() {
  return { originalAttempt: workflowAttempt({ id: original.originalRunId, mode: 'release', conclusion: 'cancelled',
    jobIds: [136579609717, 136583344538, 136587464377], day: '20' }),
  continuedAttempt: workflowAttempt({ id: original.continuationRunId, mode: 'resume', conclusion: 'failure',
    jobIds: [136683213619, 136683430049, 136683912866], day: '21' }), records: [], requests: [] };
}

test('Editors closure binds the exact approvals, original jobs and unchanged mirror', () => {
  const result = editorsProductionValidationClosureResult({ evidenceDigest: 'a'.repeat(64), closureRunId: 12345 });
  assert.equal(result.outcome, editorsClosureOutcome);
  assert.deepEqual(result.approvalReceiptIds, [7956086286, 7956743076]);
  assert.deepEqual([result.deveeValidationJobId, result.deveeDeploymentJobId, result.qatValidationJobId,
    result.qatDeploymentJobId, result.productionValidationJobId], ['0AfHF000007J8nR0AS', '0AfHF000007J8qf0AC',
    '0AfBh000006lkaDKAQ', '0AfBh000006lkbpKAA', '0Affu000001BAhpCAG']);
  assert.equal(result.mirrorReceiptId, 7956278754);
  assert.equal(result.mirrorRequestId, 7956784449);
  assert.equal(result.productionDeploySubmitted, false);
  assert.equal(result.promotionSubmitted, false);
  assert.equal(result.closureRunId, 12345);
});

test('Editors closure resolves only its original prerequisite operation', () => {
  const data = editorsProductionValidationClosureResult({ evidenceDigest: 'a'.repeat(64), closureRunId: 12345 });
  const record = (event, data) => ({ payload: { event, data } });
  const originalIntent = record('prerequisites.intent', { operationId: data.operationId });
  const unrelatedIntent = record('promote.intent', { operationId: 'another-release-promotion' });
  const result = record('prerequisites.result', data);
  assert.deepEqual(pendingOperations([originalIntent, result]), []);
  assert.deepEqual(pendingOperations([unrelatedIntent, originalIntent, result]), [unrelatedIntent.payload]);
  for (const invalid of [{ closureRunId: 12345, evidenceDigest: 'unverified' }, { closureRunId: 0, evidenceDigest: 'a'.repeat(64) }]) {
    assert.throws(() => editorsProductionValidationClosureResult(invalid), /EDITORS_CLOSURE_EVIDENCE_MISMATCH/u);
  }
});

test('the original cancellation and continuation failure both need pinned terminal job evidence', () => {
  const input = nativeHistory();
  assert.throws(() => verifyStoppedEditorsProductionValidation(input), /EDITORS_CLOSURE_JOURNAL_MISMATCH/u);
  input.originalAttempt.run.status = 'queued';
  assert.throws(() => verifyStoppedEditorsProductionValidation(input), /EDITORS_CLOSURE_ORIGINAL_RUN_MISMATCH/u);
  input.originalAttempt.run.status = 'completed';
  input.continuedAttempt.jobs.jobs[2].conclusion = 'success';
  assert.throws(() => verifyStoppedEditorsProductionValidation(input), /EDITORS_CLOSURE_ORIGINAL_JOBS_MISMATCH/u);
});

test('the two exact historical approvals cannot be borrowed from another environment or actor', () => {
  assert.doesNotThrow(() => assertEditorsClosureApproval([review]));
  assert.throws(() => assertEditorsClosureApproval([review, review]), /EDITORS_CLOSURE_NATIVE_APPROVAL_MISMATCH/u);
  const input = nativeHistory();
  input.originalAttempt.approvals[0].environments[0].id++;
  assert.throws(() => verifyStoppedEditorsProductionValidation(input), /EDITORS_CLOSURE_NATIVE_APPROVAL_MISMATCH/u);
  input.originalAttempt.approvals = [review];
  input.continuedAttempt.approvals[0].user.id++;
  assert.throws(() => verifyStoppedEditorsProductionValidation(input), /EDITORS_CLOSURE_NATIVE_APPROVAL_MISMATCH/u);
});
