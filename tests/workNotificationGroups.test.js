import test from 'node:test';
import assert from 'node:assert/strict';
import { groupWorkNotifications } from '../src/lib/workNotificationGroups.js';

test('system incidents are grouped by stable signature while ordinary work remains separate', () => {
  const rows = groupWorkNotifications([
    { id: 'old', source: 'system_error', incidentSignature: 'ABC', title: 'Sync failed', createdAt: '2026-08-28T01:00:00Z', readAt: null },
    { id: 'new', source: 'system_error', incidentSignature: 'abc', title: 'Sync failed again', createdAt: '2026-08-29T01:00:00Z', readAt: '2026-08-29T02:00:00Z' },
    { id: 'task-1', source: 'collaboration', title: 'Review A', createdAt: '2026-08-29T01:00:00Z' },
    { id: 'task-2', source: 'collaboration', title: 'Review A', createdAt: '2026-08-29T01:00:00Z' },
  ]);
  assert.equal(rows.length, 3);
  const incident = rows.find((row) => row.groupKey === 'incident:abc');
  assert.equal(incident.occurrenceCount, 2);
  assert.equal(incident.unreadOccurrenceCount, 1);
  assert.deepEqual(incident.notificationIds, ['old', 'new']);
  assert.equal(incident.title, 'Sync failed again');
  assert.equal(incident.readAt, null);
});

test('server-aggregated incident counts are retained when duplicate rows are grouped', () => {
  const [incident] = groupWorkNotifications([
    { id: 'older', source: 'system_error', incidentSignature: 'same', occurrenceCount: 4, createdAt: '2026-08-29T01:00:00Z', readAt: null },
    { id: 'newer', source: 'system_error', incidentSignature: 'same', occurrenceCount: 2, createdAt: '2026-08-29T02:00:00Z', readAt: '2026-08-29T03:00:00Z' },
  ]);
  assert.equal(incident.occurrenceCount, 6);
  assert.equal(incident.unreadOccurrenceCount, 4);
  assert.equal(incident.readAt, null);
});
