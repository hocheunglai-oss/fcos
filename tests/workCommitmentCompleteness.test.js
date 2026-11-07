import test from 'node:test';
import assert from 'node:assert/strict';
import { workCommitmentsList } from '../api/_workCommitments.js';

function fixture(tables = {}, errors = {}, notificationSnapshot = {}) {
  const queries = [];
  const client = {
    rpc: async () => ({ data: notificationSnapshot, error: null }),
    from(table) {
      const query = { table, columns: null, filters: [] };
      queries.push(query);
      const builder = new Proxy({}, {
        get(_target, method) {
          if (method === 'then') return (resolve, reject) => {
            const rows = (tables[table] || []).map(row => query.columns
              ? Object.fromEntries(query.columns.split(',').filter(key => key in row).map(key => [key, row[key]])) : row);
            return Promise.resolve({ data: rows, error: errors[table] || null }).then(resolve, reject);
          };
          return (...args) => {
            if (method === 'select') query.columns = args[0];
            else query.filters.push({ method, args });
            return builder;
          };
        },
      });
      return builder;
    },
  };
  return { context: { client, profile: { id: 'trader-1' }, capabilities: {} }, queries };
}

const blockedItem = {
  id: 'task-1', item_key: 'TASK-1', item_type: 'Task', title: 'Verify delivery',
  status: 'Blocked', owner_user_id: 'trader-1', assignee_user_id: 'trader-1',
  assignee_name: 'Trader One', blocked_reason: 'Waiting for supplier evidence.',
};

test('personal commitments retain the saved blocker with the existing ownership filter', async () => {
  const f = fixture({ collaboration_items: [blockedItem] });
  const result = await workCommitmentsList({}, f.context);
  assert.equal(result.commitments[0].blocker, 'Waiting for supplier evidence.');
  assert.equal(result.commitments[0].owner, 'Trader One');
  assert.equal(result.commitments[0].link, '/projects-tasks?item=task-1');
  const query = f.queries.find(row => row.table === 'collaboration_items');
  assert.ok(query.columns.split(',').includes('blocked_reason'));
  assert.deepEqual(query.filters.find(row => row.method === 'or').args, ['owner_user_id.eq.trader-1,assignee_user_id.eq.trader-1']);
});

test('blank blockers retain fallback guidance and nonblocked work has no blocker', async () => {
  for (const [status, reason, expected] of [
    ['Blocked', '  ', 'Open the work item to review its dependency or blocker.'],
    ['In Progress', 'Old blocker', null],
  ]) {
    const f = fixture({ collaboration_items: [{ ...blockedItem, status, blocked_reason: reason }] });
    assert.equal((await workCommitmentsList({}, f.context)).commitments[0].blocker, expected);
  }
});

test('unavailable core sources are disclosed instead of being presented as verified empty lists', async () => {
  const f = fixture({ collaboration_items: [blockedItem] }, {
    growth_goals: { code: '42P01', message: 'does not exist' },
    growth_coaching_relationships: { code: '42P01', message: 'does not exist' },
  });
  const result = await workCommitmentsList({}, f.context);
  assert.ok(result.unavailableSources.includes('Growth & Coaching'));
  assert.equal(result.unavailableSources.filter(source => source === 'Growth & Coaching').length, 1);
  assert.equal(result.commitments[0].id, 'collaboration:task-1');
});

test('permission and other database failures still fail closed', async () => {
  const error = { code: '42501', message: 'permission denied' };
  const f = fixture({}, { collaboration_items: error });
  await assert.rejects(workCommitmentsList({}, f.context), value => value === error);
});

test('a personal source reaching its cap is disclosed without claiming company-wide completeness', async () => {
  const f = fixture({ collaboration_items: Array.from({ length: 250 }, (_, index) => ({ ...blockedItem, id: `task-${index}` })) });
  const result = await workCommitmentsList({}, f.context);
  assert.deepEqual(result.sourcesAtLimit, ['Projects & Tasks']);
  assert.equal(result.commitments.length, 250);
});

test('improvement tickets expose the assigned responsible person', async () => {
  const f = fixture({ fcos_improvement_tickets: [{ id: 'improvement-1', ticket_key: 'FCOS-1', title: 'Check source data',
    status: 'In Progress', assignee_user_id: 'trader-1', assignee_name: 'Trader One' }] });
  const result = await workCommitmentsList({}, f.context);
  assert.equal(result.commitments[0].owner, 'Trader One');
  assert.equal(result.commitments[0].actionLabel, 'Open ticket');
});

test('notifications reaching their combined cap disclose possibly omitted operational work', async () => {
  const snapshot = { collaboration: Array.from({ length: 100 }, (_, index) => ({ id: `notification-${index}`, title: 'Task assigned', created_at: '2026-10-01T00:00:00Z' })) };
  const f = fixture({}, {}, snapshot);
  const result = await workCommitmentsList({}, f.context);
  assert.ok(result.sourcesAtLimit.includes('Notifications'));
});
