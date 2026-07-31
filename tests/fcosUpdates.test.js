import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildFcosUpdateEmail,
  FCOS_UPDATE_SEND_AS_RECOVERY_MESSAGE,
  fcosUpdateMailConfig,
  fcosUpdateSenderFailureMessage,
  fcosUpdateSourceCandidates,
  inferFcosUpdateCategory,
} from '../api/_fcosUpdates.js';
import { APP_VERSION_HISTORY } from '../src/lib/appVersion.js';
import {
  smtpAddressParts,
  smtpAuthenticatedFromAddress,
} from '../api/_smtp.js';

test('FCOS update source import includes the five-day boundary and future releases', () => {
  const candidates = fcosUpdateSourceCandidates(APP_VERSION_HISTORY, '2026-07-27');
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((item) => item.source_release_date >= '2026-07-27'));
  assert.ok(candidates.some((item) => item.source_version === '2.0.51'));
  assert.ok(!candidates.some((item) => item.source_version === '2.0.41'));

  const keys = candidates.map((item) => `${item.source_version}:${item.source_change_index}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(candidates.every((item) => /^[a-f0-9]{64}$/.test(item.source_hash)));
});

test('FCOS update categories use conservative release wording defaults', () => {
  assert.equal(inferFcosUpdateCategory('Added a new shared queue.'), 'new_feature');
  assert.equal(inferFcosUpdateCategory('Corrected a major sending failure.'), 'major_bug_fix');
  assert.equal(inferFcosUpdateCategory('Updated the workflow ordering.'), 'improved_logic');
});

test('FCOS update email escapes editable copy and never includes recipient addresses', () => {
  const batch = {
    subject: 'FCOS updates',
    introduction: 'Hello <team>',
    closing: 'Regards & thanks',
    fcos_update_batch_items: [
      {
        sort_order: 0,
        category: 'major_bug_fix',
        email_title: 'Corrected <script>alert(1)</script>',
        email_body: 'No raw HTML & no address user@example.com.',
        fcos_update_items: {
          source_version: '2.0.51',
          source_release_date: '2026-07-31',
        },
      },
    ],
  };
  const email = buildFcosUpdateEmail(batch, 'https://fcos.example.com/');
  assert.equal(email.subject, 'FCOS updates');
  assert.match(email.html, /Hello &lt;team&gt;/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /https:\/\/fcos\.example\.com\//);
  assert.match(email.text, /Major Bug Fix/);
});

test('shared SMTP sender always resolves to the authenticated mailbox', () => {
  assert.deepEqual(smtpAddressParts('FCOS Updates <info@example.com>'), {
    name: 'FCOS Updates',
    email: 'info@example.com',
  });
  assert.equal(
    smtpAuthenticatedFromAddress(
      { user: 'authenticated@example.com' },
      'FCOS Updates <different@example.com>',
    ),
    'FCOS Updates <authenticated@example.com>',
  );
});

test('FCOS Updates supports a strict module-specific From address', () => {
  const config = fcosUpdateMailConfig({
    SMTP_HOST: 'smtp.office365.com',
    SMTP_USER: 'louisa@example.com',
    SMTP_PASSWORD: 'shared-secret',
    FCOS_UPDATE_SENDER_NAME: 'Vincent Lee',
    FCOS_UPDATE_FROM_EMAIL: 'vincent@example.com',
  });

  assert.equal(config.from, 'Vincent Lee <vincent@example.com>');
  assert.equal(config.senderAddress, 'vincent@example.com');
  assert.equal(config.authenticatedAddress, 'louisa@example.com');
  assert.equal(config.requiresSendAs, true);
  assert.equal(config.smtp.user, 'louisa@example.com');
  assert.equal(config.smtp.password, 'shared-secret');
});

test('FCOS Updates can authenticate through dedicated SMTP credentials', () => {
  const config = fcosUpdateMailConfig({
    SMTP_USER: 'louisa@example.com',
    SMTP_PASSWORD: 'shared-secret',
    FCOS_UPDATE_SMTP_USER: 'vincent@example.com',
    FCOS_UPDATE_SMTP_PASSWORD: 'vincent-secret',
    FCOS_UPDATE_SENDER_NAME: 'Vincent Lee',
  });

  assert.equal(config.from, 'Vincent Lee <vincent@example.com>');
  assert.equal(config.requiresSendAs, false);
  assert.equal(config.smtp.user, 'vincent@example.com');
  assert.equal(config.smtp.password, 'vincent-secret');
});

test('FCOS Updates treats Microsoft Send As rejection as a sender-wide failure', () => {
  assert.equal(
    fcosUpdateSenderFailureMessage(new Error('554 5.2.252 SendAsDenied; MapiExceptionSendAsDenied')),
    FCOS_UPDATE_SEND_AS_RECOVERY_MESSAGE,
  );
  assert.equal(fcosUpdateSenderFailureMessage(new Error('550 recipient rejected')), '');
  assert.doesNotMatch(FCOS_UPDATE_SEND_AS_RECOVERY_MESSAGE, /@/);
});

test('FCOS update migration creates service-only workflow and General Manager controls', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260731044413_admin_controlled_fcos_update_emails.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'fcos_update_settings',
    'fcos_update_items',
    'fcos_update_batches',
    'fcos_update_batch_items',
    'fcos_update_deliveries',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant all on table public\\.${table} to service_role`));
  }
  assert.match(sql, /create table if not exists public\.fcos_update_events/);
  assert.match(sql, /alter table public\.fcos_update_events enable row level security/);
  assert.match(sql, /revoke all on table public\.fcos_update_events from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.fcos_update_events from service_role/);
  assert.match(sql, /grant select, insert on table public\.fcos_update_events to service_role/);
  assert.match(sql, /role_row\.role = 'general_manager'/);
  assert.match(sql, /collaboration_roles_one_active_general_manager_idx/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /start_fcos_update_delivery/);
  assert.match(sql, /cancel_fcos_update_batch/);
  assert.match(sql, /finalize_fcos_update_delivery/);
  assert.match(sql, /default date '2026-07-27'/);
  assert.match(sql, /'Pending Approval'/);
  assert.match(sql, /'Partial Failure'/);
  assert.match(sql, /'Uncertain'/);
});

test('FCOS update workflow protects reviewed revisions and interrupted delivery', async () => {
  const [server, panel, recipientMigration] = await Promise.all([
    readFile(new URL('../api/_fcosUpdates.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/admin/FcosUpdatesPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260731083127_fcos_update_saved_recipients.sql', import.meta.url), 'utf8'),
  ]);

  assert.match(server, /function requireExpectedBatchRevision/);
  assert.match(server, /recoverInterruptedFcosUpdateDeliveries/);
  assert.match(server, /rpc\('save_fcos_update_batch_with_recipients'/);
  assert.match(server, /rpc\('start_fcos_update_saved_delivery'/);
  assert.match(server, /rpc\('finalize_fcos_update_delivery'/);
  assert.match(server, /const statuses = includeUncertain \? \['Uncertain'\] : \['Failed'\]/);
  assert.match(server, /result\.accepted\.length !== 1/);
  assert.match(server, /sender:[\s\S]*mailConfig\.senderName[\s\S]*mailConfig\.senderAddress/);
  assert.match(server, /FCOS_UPDATE_FROM_EMAIL/);
  assert.match(server, /createSmtpTransport\(mailConfig\.smtp/);

  assert.match(panel, /const batchIsDirty = useMemo/);
  assert.match(panel, /!batchDraft\.id \|\| batchIsDirty \? await saveBatch\(\) : batchDraft/);
  assert.match(panel, /recipients: batchDraft\.recipients/);
  assert.match(panel, /Saving recipient changes returns an approved email to Draft/);
  assert.match(panel, /Sender: \{model\.sender\?\.name/);
  assert.match(panel, /expectedRevision: sendConfirmation\.revision/);
  assert.match(panel, /expectedRecipientCount: sendConfirmation\.recipientCount/);
  assert.match(panel, /disabled=\{Boolean\(working\) \|\| batchIsDirty\}/);
  assert.match(panel, /Discard unsaved changes\?/);

  assert.match(recipientMigration, /create table if not exists public\.fcos_update_batch_recipients/);
  assert.match(recipientMigration, /function public\.save_fcos_update_batch_with_recipients[\s\S]*security invoker/);
  assert.match(recipientMigration, /function public\.start_fcos_update_saved_delivery[\s\S]*security invoker/);
  assert.match(recipientMigration, /alter table public\.fcos_update_batch_recipients enable row level security/);
  assert.match(recipientMigration, /revoke all on table public\.fcos_update_batch_recipients from public, anon, authenticated/);
  assert.match(recipientMigration, /grant all on table public\.fcos_update_batch_recipients to service_role/);
  assert.doesNotMatch(recipientMigration, /security definer/i);
});
