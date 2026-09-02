import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  IMPROVEMENT_PRIORITIES,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_TYPES,
  improvementStatusChangeRequiresNote,
  improvementStatusTransitionLabel,
  improvementStatusTransitionAllowed,
} from '../api/_fcosImprovements.js';

const root = new URL('../', import.meta.url);

test('FCOS Improvements exposes the agreed ticket types, priorities, and workflow states', () => {
  assert.deepEqual(IMPROVEMENT_TYPES, ['bug', 'feature_request']);
  assert.deepEqual(IMPROVEMENT_PRIORITIES, ['Low', 'Medium', 'High', 'Urgent']);
  assert.deepEqual(IMPROVEMENT_STATUSES, [
    'Reported',
    'In Progress',
    'Ready for Verification',
    'Closed',
    'Rejected',
  ]);
});

test('FCOS Improvements accepts only explicit workflow transitions', () => {
  assert.equal(improvementStatusTransitionAllowed('Reported', 'In Progress'), true);
  assert.equal(improvementStatusTransitionAllowed('Reported', 'Rejected'), true);
  assert.equal(improvementStatusTransitionAllowed('In Progress', 'Ready for Verification'), true);
  assert.equal(improvementStatusTransitionAllowed('In Progress', 'Rejected'), true);
  assert.equal(improvementStatusTransitionAllowed('Ready for Verification', 'Closed'), true);
  assert.equal(improvementStatusTransitionAllowed('Ready for Verification', 'In Progress'), true);
  assert.equal(improvementStatusTransitionAllowed('Closed', 'In Progress'), true);
  assert.equal(improvementStatusTransitionAllowed('Rejected', 'Reported'), true);
  assert.equal(improvementStatusTransitionAllowed('Reported', 'Closed'), false);
  assert.equal(improvementStatusTransitionAllowed('Closed', 'Reported'), false);
  assert.equal(improvementStatusTransitionAllowed('Rejected', 'In Progress'), false);
  for (const legacyStatus of ['Under Review', 'Accepted', 'Reopened']) {
    assert.equal(improvementStatusTransitionAllowed('Reported', legacyStatus), false);
    assert.equal(improvementStatusTransitionAllowed(legacyStatus, 'In Progress'), false);
  }
});

test('exceptional status transitions expose clear labels and require notes', () => {
  assert.equal(improvementStatusTransitionLabel('Ready for Verification', 'In Progress'), 'Return to In Progress');
  assert.equal(improvementStatusTransitionLabel('Closed', 'In Progress'), 'Reopen → In Progress');
  assert.equal(improvementStatusTransitionLabel('Rejected', 'Reported'), 'Reconsider → Reported');
  assert.equal(improvementStatusTransitionLabel('Reported', 'In Progress'), 'In Progress');

  for (const [from, to] of [
    ['Reported', 'Rejected'],
    ['In Progress', 'Rejected'],
    ['Ready for Verification', 'In Progress'],
    ['Closed', 'In Progress'],
    ['Rejected', 'Reported'],
  ]) {
    assert.equal(improvementStatusChangeRequiresNote(from, to), true, `${from} -> ${to}`);
  }
  assert.equal(improvementStatusChangeRequiresNote('Reported', 'In Progress'), false);
  assert.equal(improvementStatusChangeRequiresNote('In Progress', 'Ready for Verification'), false);
  assert.equal(improvementStatusChangeRequiresNote('Ready for Verification', 'Closed'), false);
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

test('status simplification migration narrows current state without rewriting history', async () => {
  const source = await readFile(new URL('supabase/migrations/20260821094025_simplify_fcos_improvement_statuses.sql', root), 'utf8');
  assert.match(source, /check \(status in \('Reported', 'In Progress', 'Ready for Verification', 'Closed', 'Rejected'\)\)/);
  assert.match(source, /ticket\.status in \('Under Review', 'Accepted'\).*then 'Reported'/s);
  assert.match(source, /proposal\.payload->>'fromStatus'[\s\S]*when 'Closed' then 'In Progress'[\s\S]*when 'Rejected' then 'Reported'/);
  assert.match(source, /Historical proposal payloads and events[\s\S]*retain the terminology/i);
  assert.doesNotMatch(source, /update public\.fcos_improvement_proposals as/);
  assert.doesNotMatch(source, /update public\.fcos_improvement_events as/);
  assert.match(source, /fcos_improvement_status_note_required/);
  assert.match(source, /v_target_status in \('Closed', 'Rejected'\)/);
  assert.match(source, /security invoker/);
  assert.match(source, /revoke all on function public\.fcos_improvement_status_note_required\(text, text\) from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.fcos_improvement_status_note_required\(text, text\) to service_role/);
});

test('reduced lifecycle is projected consistently in the API, UI, commitments, CLI, and methodology', async () => {
  const [service, page, commitments, script, methodology] = await Promise.all([
    readFile(new URL('api/_fcosImprovements.js', root), 'utf8'),
    readFile(new URL('src/pages/FcosImprovements.jsx', root), 'utf8'),
    readFile(new URL('api/_workCommitments.js', root), 'utf8'),
    readFile(new URL('scripts/fcos-improvements.mjs', root), 'utf8'),
    readFile(new URL('src/lib/pageMethodologies.js', root), 'utf8'),
  ]);
  assert.match(service, /allowedStatusTransitions/);
  assert.match(service, /improvementStatusChangeRequiresNote\(ticket\.status, status\)/);
  assert.match(page, /Reopen → In Progress/);
  assert.match(page, /Reconsider → Reported/);
  assert.match(page, /selectedStatusTransition\?\.requiresNote/);
  assert.match(commitments, /\.not\('status', 'in', '\(Closed,Rejected\)'\)/);
  assert.match(script, /Ticket statuses: Reported, In Progress, Ready for Verification, Closed, Rejected/);
  assert.match(script, /This helper cannot approve them/);
  assert.match(methodology, /Tickets progress through Reported, In Progress, Ready for Verification, and Closed/);
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

test('new improvement tickets default to the active General Manager without hardcoding a user', async () => {
  const [service, page, methodology] = await Promise.all([
    readFile(new URL('api/_fcosImprovements.js', root), 'utf8'),
    readFile(new URL('src/pages/FcosImprovements.jsx', root), 'utf8'),
    readFile(new URL('src/lib/pageMethodologies.js', root), 'utf8'),
  ]);
  const createStart = service.indexOf('export async function improvementCreate');
  const createEnd = service.indexOf('\nfunction proposalPayload', createStart);
  const createSource = service.slice(createStart, createEnd);
  assert.match(createSource, /const generalManager = await activeGeneralManager\(client\)/);
  assert.match(createSource, /assignee_user_id: generalManager\.id/);
  assert.match(createSource, /assignee_name: generalManager\.full_name \|\| generalManager\.email/);
  assert.match(createSource, /assignee_email: generalManager\.email/);
  assert.doesNotMatch(createSource, /vincent@cosulich\.com\.hk/i);
  assert.match(page, /ticket\?\.assignee\?\.id \|\| response\.data\.generalManager\?\.id/);
  assert.match(methodology, /New tickets default to the active UUID-backed General Manager as accountable assignee/);
});

test('FCOS-000001 removes PSPRS only from the external payment-reminder invoice table', async () => {
  const [serverSource, pageSource] = await Promise.all([
    readFile(new URL('api/functions/[name].js', root), 'utf8'),
    readFile(new URL('src/pages/BuyerInvoices.jsx', root), 'utf8'),
  ]);
  const reminderStart = serverSource.indexOf('function buildBuyerInvoicePaymentReminderEmail');
  const reminderEnd = serverSource.indexOf('\nasync function loadBuyerInvoicePaymentReminderContext', reminderStart);
  const reminderSource = serverSource.slice(reminderStart, reminderEnd);
  assert.doesNotMatch(reminderSource, />PSPRS</);
  assert.doesNotMatch(reminderSource, /escapeHtml\(row\.prpspStatus/);
  assert.doesNotMatch(reminderSource, /\| PSPRS \$\{/);
  assert.match(reminderSource, /colspan="8"/);

  const previewStart = pageSource.indexOf('function invoiceTablePreviewHtml');
  const previewEnd = pageSource.indexOf('\nfunction emailBodyPreviewHtml', previewStart);
  const previewSource = pageSource.slice(previewStart, previewEnd);
  assert.doesNotMatch(previewSource, />PSPRS</);
  assert.doesNotMatch(previewSource, /escapeHtml\(row\.prpspStatus/);

  const internalReportStart = serverSource.indexOf('function buildBuyerInvoiceReportEmail');
  const internalReportEnd = serverSource.indexOf('\nfunction reminderCandidateKey', internalReportStart);
  assert.match(serverSource.slice(internalReportStart, internalReportEnd), />PSPRS</);
});
