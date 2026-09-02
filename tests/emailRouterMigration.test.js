import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MigrationError,
  buildActiveUserMapping,
  buildMetadataSyncPlan,
  buildOperationalPayload,
  runMigration,
  safeSummary,
} from '../scripts/migrate-email-router.mjs';

const sourceUsers = [{ id: 'source-user-1', email: 'User@Example.com' }];
const targetUsers = [{ id: 'target-user-1', email: 'user@example.com', full_name: 'FCOS User' }];

test('maps active users by normalized email and produces deterministic configuration', () => {
  const mapping = buildActiveUserMapping(sourceUsers, targetUsers);
  const result = buildOperationalPayload({
    activeUsers: sourceUsers,
    teamMembers: [
      { id: 'member-1', app_user_id: 'source-user-1', display_name: 'FCOS User', email: 'user@example.com', destination_type: 'person', sort_order: 1 },
      { id: 'member-2', app_user_id: null, display_name: 'Shared Operations', email: 'ops@example.com', destination_type: 'shared', sort_order: 2 },
    ],
    departments: [{ id: 'department-1', name: 'Operations', slug: 'operations', active: true }],
    departmentRecipients: [{ department_id: 'department-1', team_member_id: 'member-1', recipient_email: 'user@example.com', recipient_kind: 'to', active: true }],
    routingPresets: [{ id: 'preset-1', name: 'Operations', description: 'Operational routing', active: true, sort_order: 1 }],
    routingPresetRecipients: [
      { preset_id: 'preset-1', team_member_id: 'member-1', recipient_email: 'user@example.com', recipient_kind: 'to', position: 1 },
      { preset_id: 'preset-1', team_member_id: 'member-2', recipient_email: 'ops@example.com', recipient_kind: 'cc', position: 2 },
    ],
    settings: [{ key: 'directory.allowed_domains', value: { domains: ['Example.com'] } }],
  }, mapping, { targetMailboxId: 'target-mailbox-1' });

  assert.equal(mapping.summary.matched, 1);
  assert.equal(result.counts.fcosProfileDestinations, 1);
  assert.equal(result.counts.providerDirectoryDestinations, 1);
  assert.equal(result.counts.destinationGroups, 1);
  assert.equal(result.counts.destinationGroupMembers, 1);
  assert.deepEqual(result.payload.fcosProfileDestinations[0], {
    source_key: result.payload.fcosProfileDestinations[0].source_key,
    user_profile_id: 'target-user-1',
  });
  assert.equal(result.payload.providerDirectoryDestinations[0].email_address, 'ops@example.com');
  assert.equal(result.payload.mailboxConnection.purpose_key, 'email_router_mailbox');
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});

test('fails closed for duplicate or unmatched active users without exposing emails', () => {
  assert.throws(
    () => buildActiveUserMapping(sourceUsers, [{ id: 'target-user-1', email: 'user@example.com' }, { id: 'target-user-2', email: 'USER@example.com' }]),
    (error) => error instanceof MigrationError && error.code === 'DUPLICATE_TARGET_ACTIVE_USER_EMAIL',
  );
  const summary = JSON.stringify(safeSummary(new MigrationError('UNMATCHED_SOURCE_ACTIVE_USER')));
  assert.equal(summary.includes('@'), false);
});

test('includes FCOS-only active users in the native directory without blocking cutover', () => {
  const mapping = buildActiveUserMapping(sourceUsers, [
    ...targetUsers,
    { id: 'target-user-2', email: 'second@example.com', full_name: 'Second User' },
  ]);
  const result = buildOperationalPayload({
    activeUsers: sourceUsers,
    teamMembers: [{ id: 'member-1', app_user_id: 'source-user-1', display_name: 'FCOS User', email: 'user@example.com', destination_type: 'person', sort_order: 1 }],
    departments: [],
    departmentRecipients: [],
    routingPresets: [],
    routingPresetRecipients: [],
    settings: [],
  }, mapping, { targetMailboxId: 'target-mailbox-1' });

  assert.equal(mapping.summary.unmatchedTarget, 1);
  assert.equal(result.counts.fcosProfileDestinations, 2);
});

test('builds metadata-only sync evidence without message subjects or recipients', () => {
  const plan = buildMetadataSyncPlan([
    { provider_message_id: 'opaque-1', folder_id: 'inbox', received_at: '2026-08-01T00:00:00Z', sent_at: null, is_read: false, has_attachments: false, attachment_count: 0, status: 'received' },
    { provider_message_id: 'opaque-2', folder_id: 'sentitems', received_at: '2026-08-01T01:00:00Z', sent_at: '2026-08-01T01:00:00Z', is_read: true, has_attachments: true, attachment_count: 1, status: 'routed' },
  ]);

  const output = JSON.stringify(plan.summary);
  assert.equal(plan.summary.folders.inbox.count, 1);
  assert.equal(plan.summary.folders.archive.count, 0);
  assert.equal(output.includes('opaque-1'), false);
  assert.equal(output.includes('subject'), false);
  assert.equal(output.includes('recipient'), false);
});

test('defaults to a redacted dry run without target writes or sync dispatch', async () => {
  const sourceRows = {
    app_users: sourceUsers,
    team_members: [{ id: 'member-1', app_user_id: 'source-user-1', display_name: 'FCOS User', email: 'user@example.com', destination_type: 'person', sort_order: 1 }],
    departments: [],
    department_recipient_assignments: [],
    routing_presets: [{ id: 'preset-1', name: 'Operations', description: '', active: true, sort_order: 1 }],
    routing_preset_recipients: [{ preset_id: 'preset-1', team_member_id: 'member-1', recipient_email: 'user@example.com', recipient_kind: 'to', position: 1 }],
    app_settings: [],
    email_messages: [{ mailbox_address: 'user@example.com', provider_message_id: 'opaque-1', folder_id: 'inbox', received_at: '2026-08-01T00:00:00Z', sent_at: null, is_read: false, has_attachments: false, attachment_count: 0, status: 'received' }],
    email_sender_routes: [{ purpose_key: 'email_router_mailbox', mailbox_id: 'target-mailbox-1', email_sender_mailboxes: { id: 'target-mailbox-1', email_address: 'user@example.com', active: true } }],
  };
  const fetchFn = async (url, options = {}) => {
    assert.notEqual(options.method, 'POST');
    const table = new URL(url).pathname.split('/').at(-1);
    return new Response(JSON.stringify(table === 'user_profiles' ? targetUsers : sourceRows[table] || []), { status: 200 });
  };
  const summary = await runMigration({
    env: {
      EMAILROUTER_SOURCE_SUPABASE_URL: 'https://source.example.test',
      EMAILROUTER_SOURCE_SUPABASE_SERVICE_ROLE_KEY: 'source-key',
      FCOS_TARGET_SUPABASE_URL: 'https://target.example.test',
      FCOS_TARGET_SUPABASE_SERVICE_ROLE_KEY: 'target-key',
    },
    argv: ['node', 'scripts/migrate-email-router.mjs'],
    fetchFn,
  });

  assert.equal(summary.mode, 'dry_run');
  assert.equal(summary.operationalConfiguration.targetApply, 'not_requested');
  assert.equal(summary.metadataSync.dispatch, 'prepared_not_dispatched');
  assert.equal(JSON.stringify(summary).includes('@'), false);
});

test('standalone completed actions are not reported as pending cutover work', async () => {
  const exportFile = new URL(`file://${process.cwd()}/emailrouter-export-test-${process.pid}.ndjson`);
  const { writeFile, unlink } = await import('node:fs/promises');
  const records = [
    { type: 'manifest', format: 'emailrouter-ndjson', schemaVersion: 2, mailboxContentIncluded: false, attachmentBytesIncluded: false },
    { type: 'record', table: 'mail_actions', row: { status: 'completed' } },
    { type: 'record', table: 'mail_actions', row: { status: 'failed' } },
    { type: 'complete', counts: { mail_actions: 2 } },
  ];
  await writeFile(exportFile, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  try {
    const fetchFn = async (url) => {
      const table = new URL(url).pathname.split('/').at(-1);
      if (table === 'user_profiles') return new Response('[]', { status: 200 });
      if (table === 'email_sender_routes') {
        return new Response(JSON.stringify([{
          purpose_key: 'email_router_mailbox',
          mailbox_id: 'mailbox-1',
          email_sender_mailboxes: { id: 'mailbox-1', email_address: 'router@example.com', active: true },
        }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    };
    const summary = await runMigration({
      env: {
        EMAILROUTER_SOURCE_EXPORT_FILE: exportFile.pathname,
        FCOS_TARGET_SUPABASE_URL: 'https://target.example.test',
        FCOS_TARGET_SUPABASE_SERVICE_ROLE_KEY: 'target-key',
      },
      argv: ['node', 'scripts/migrate-email-router.mjs'],
      fetchFn,
    });
    assert.equal(summary.sourceInventory.pendingActions, 0);
  } finally {
    await unlink(exportFile).catch(() => {});
  }
});
