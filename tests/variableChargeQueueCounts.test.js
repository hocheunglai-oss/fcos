import assert from 'node:assert/strict';
import test from 'node:test';
import { variableChargeInternals } from '../api/_variableCharges.js';

test('Variable Charges tab counts agree with their filtered queues despite independent invoice closure', () => {
  const rows = [
    { status: 'completed', simplifiedQueue: 'my_tasks' },
    { status: 'completed', simplifiedQueue: 'completed' },
    { status: 'ready_for_invoice', simplifiedQueue: 'my_tasks' },
    { status: 'ready_for_invoice', simplifiedQueue: 'ready_for_invoice' },
    { status: 'needs_action', simplifiedQueue: 'waiting' },
    { status: 'awaiting_delivery', simplifiedQueue: 'waiting' },
    { status: 'post_invoice_changes', simplifiedQueue: 'my_tasks' },
  ];
  const counts = variableChargeInternals.viewCounts(rows);
  for (const queue of ['my_tasks', 'waiting', 'completed', 'ready_for_invoice']) {
    assert.equal(counts[queue], rows.filter(row => row.simplifiedQueue === queue).length);
  }
  assert.equal(counts.all_cases, rows.length);
  for (const status of ['needs_action', 'awaiting_delivery', 'post_invoice_changes']) assert.equal(counts[status], 1);
  assert.equal(rows[0].status, 'completed', 'count correction must preserve historical invoice closure');
});
