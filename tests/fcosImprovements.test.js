import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  IMPROVEMENT_PRIORITIES,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_TYPES,
  improvementStatusTransitionAllowed,
} from '../api/_fcosImprovements.js';

const root = new URL('../', import.meta.url);

test('FCOS Improvements exposes the agreed ticket types, priorities, and workflow states', () => {
  assert.deepEqual(IMPROVEMENT_TYPES, ['bug', 'feature_request']);
  assert.deepEqual(IMPROVEMENT_PRIORITIES, ['Low', 'Medium', 'High', 'Urgent']);
  assert.deepEqual(IMPROVEMENT_STATUSES, [
    'Reported',
    'Under Review',
    'Accepted',
    'In Progress',
    'Ready for Verification',
    'Closed',
    'Reopened',
    'Rejected',
  ]);
});

test('FCOS Improvements accepts only explicit workflow transitions', () => {
  assert.equal(improvementStatusTransitionAllowed('Reported', 'Under Review'), true);
  assert.equal(improvementStatusTransitionAllowed('Under Review', 'Accepted'), true);
  assert.equal(improvementStatusTransitionAllowed('Accepted', 'In Progress'), true);
  assert.equal(improvementStatusTransitionAllowed('In Progress', 'Ready for Verification'), true);
  assert.equal(improvementStatusTransitionAllowed('Ready for Verification', 'Closed'), true);
  assert.equal(improvementStatusTransitionAllowed('Closed', 'Reopened'), true);
  assert.equal(improvementStatusTransitionAllowed('Reported', 'Closed'), false);
  assert.equal(improvementStatusTransitionAllowed('Closed', 'In Progress'), false);
});

test('migration keeps ticket data service-only and General Manager decisions atomic', async () => {
  const source = await readFile(new URL('supabase/migrations/20260804145038_fcos_improvements_ticketing.sql', root), 'utf8');
  for (const table of [
    'fcos_improvement_tickets',
    'fcos_improvement_proposals',
    'fcos_improvement_attachments',
    'fcos_improvement_events',
    'fcos_improvement_notifications',
  ]) {
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(source, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
    assert.match(source, new RegExp(`grant all on table public\\.${table} to service_role`, 'i'));
  }
  assert.match(source, /collaboration_is_general_manager\(p_actor_id\)/);
  assert.match(source, /fcos_improvement_status_transition_allowed/);
  assert.match(source, /where approval_state = 'pending'/);
  assert.match(source, /'fcos-improvement-files'.*false.*20971520/s);
});

test('all active users receive the page and authenticated API while approval remains role-bound', async () => {
  const [app, layout, standards, handler, page, notifications] = await Promise.all([
    readFile(new URL('src/App.jsx', root), 'utf8'),
    readFile(new URL('src/components/Layout.jsx', root), 'utf8'),
    readFile(new URL('src/lib/workspaceStandards.js', root), 'utf8'),
    readFile(new URL('api/functions/[name].js', root), 'utf8'),
    readFile(new URL('src/pages/FcosImprovements.jsx', root), 'utf8'),
    readFile(new URL('api/_workNotifications.js', root), 'utf8'),
  ]);
  assert.match(app, /path="\/fcos-improvements" element={<FcosImprovements \/>}/);
  assert.match(layout, /workspaceNavigation\('fcos_improvements'/);
  assert.match(standards, /fcos_improvements:[\s\S]*section: 'Personal'/);
  for (const name of ['improvementsList', 'improvementDetail', 'improvementCreate', 'improvementPropose', 'improvementDecision']) {
    assert.match(handler, new RegExp(`${name}: \\[\\]`));
  }
  assert.match(page, /Pending Approval/);
  assert.match(page, /Copy Codex prompt/);
  assert.match(notifications, /source: 'fcos_improvements'/);
});

test('Codex helper can show and propose but has no approval command', async () => {
  const [script, packageJson] = await Promise.all([
    readFile(new URL('scripts/fcos-improvements.mjs', root), 'utf8'),
    readFile(new URL('package.json', root), 'utf8'),
  ]);
  assert.match(script, /command === 'show'/);
  assert.match(script, /command === 'comment'/);
  assert.match(script, /command === 'status'/);
  assert.doesNotMatch(script, /command === 'approve'/);
  assert.match(script, /This helper cannot approve them/);
  assert.match(packageJson, /"improvements:agent"/);
});

