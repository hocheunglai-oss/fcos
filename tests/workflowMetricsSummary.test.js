import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWorkflowMetrics } from '../api/_workflowMetricsSummary.js';
import { createWorkflowMetricsReader } from '../api/_workflowMetrics.js';

test('operational summary separates API completion from failed and uncertain outcomes', () => {
  assert.deepEqual(summarizeWorkflowMetrics([
    { requests: 12, completed: 8, failed: 2, uncertain: 1, conflict: 1 },
    { requests: 8, completed: 6, failed: 0, uncertain: 2, conflict: 0 },
  ]), { requests: 20, completed: 14, failed: 2, uncertain: 3, conflict: 1, completedPercent: 70 });
  assert.equal(summarizeWorkflowMetrics([]).completedPercent, null);
});

test('metrics summary ignores malformed counts instead of displaying NaN or negative totals', () => {
  assert.deepEqual(summarizeWorkflowMetrics([{ requests: -1, completed: 'unknown', failed: Infinity, uncertain: NaN, conflict: 1.5 }]),
    { requests: 0, completed: 0, failed: 0, uncertain: 0, conflict: 0, completedPercent: null });
});

test('administrative metrics preserve access checks, disclose partial results and use one database read', async () => {
  const records = Array.from({ length: 5001 }, (_, i) => ({ event_day: '2026-10-01', handler: `save${i % 2}`, outcome: 'failed', request_count: 1, duration_ms: 10 }));
  let reads = 0; let auth = 0; let permission = 0;
  const builder = { select() { return this; }, gte() { return this; }, order() { return this; }, limit(value) {
    reads++; assert.equal(value, 5001); return Promise.resolve({ data: records, error: null });
  } };
  const context = { client: { from(table) { assert.equal(table, 'workflow_daily_metrics'); return builder; } } };
  const read = createWorkflowMetricsReader({
    requireActiveUser: async () => { auth++; return context; },
    requireAdministratorContext: candidate => { permission++; assert.equal(candidate, context); },
  });
  const result = await read({}, {});
  assert.equal(auth, 1); assert.equal(permission, 1); assert.equal(reads, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.summary.failed, 5000);
  assert.equal(result.summary.requests, 5000);
  assert.equal(result.rows[0].averageMs, 10);
});

test('denied metrics access performs no database reads', async () => {
  const denied = new Error('Administrator access required');
  const read = createWorkflowMetricsReader({ requireActiveUser: async () => ({ client: { from() { assert.fail('Unauthorized read'); } } }),
    requireAdministratorContext: () => { throw denied; } });
  await assert.rejects(read({}, {}), denied);
});
