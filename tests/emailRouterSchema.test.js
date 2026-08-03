import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260803090000_native_emailrouter_schema.sql', import.meta.url);
const accessMigrationUrl = new URL('../supabase/migrations/20260803030109_email_router_module_access.sql', import.meta.url);
const activeDirectoryMigrationUrl = new URL('../supabase/migrations/20260803041219_email_router_active_user_directory.sql', import.meta.url);
const orderedDirectoryMigrationUrl = new URL('../supabase/migrations/20260803110944_email_router_ordered_directory.sql', import.meta.url);
const externalRestoreMigrationUrl = new URL('../supabase/migrations/20260803135527_fix_email_router_external_reactivation.sql', import.meta.url);
const directoryEventMigrationUrl = new URL('../supabase/migrations/20260803162059_allow_emailrouter_routing_directory_events.sql', import.meta.url);
const presetValidationMigrationUrl = new URL('../supabase/migrations/20260803165805_fix_emailrouter_preset_recipient_validation.sql', import.meta.url);
const routingIntegrityMigrationUrl = new URL('../supabase/migrations/20260803172446_harden_emailrouter_routing_integrity.sql', import.meta.url);

test('native Email Router schema is service-only and metadata-only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of [
    'mailbox_connections',
    'messages',
    'message_attachment_metadata',
    'destinations',
    'destination_groups',
    'routing_presets',
    'mail_actions',
    'mail_action_outbox',
    'mailbox_subscriptions',
    'mailbox_delta_state',
    'alerts',
    'alert_notification_states',
    'ai_usage_events',
    'events',
  ]) assert.match(sql, new RegExp(`create table if not exists emailrouter\\.${table} \\(`));
  assert.match(sql, /revoke all on schema emailrouter from public, anon, authenticated/i);
  assert.match(sql, /pgrst\.db_schemas = 'public, storage, graphql_public, emailrouter'/i);
  assert.match(sql, /grant usage on schema emailrouter to service_role/i);
  assert.match(sql, /alter table emailrouter\.%I enable row level security/i);
  assert.match(sql, /revoke all on table emailrouter\.%I from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /\b(?:subject|body_html|body_text|body_preview|raw_mime|attachment_name|recipient_email_array)\b/i);
});

test('native Email Router migration preserves Graph registry ownership and durable action states', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /sender_mailbox_id uuid not null references public\.email_sender_mailboxes/i);
  assert.match(sql, /'email_router_mailbox'/);
  assert.doesNotMatch(sql, /where route\.purpose_key = 'payment_reminders'/i);
  for (const state of ['reserved', 'draft_created', 'submitted', 'confirmed', 'failed', 'uncertain']) assert.match(sql, new RegExp(`'${state}'`));
  assert.match(sql, /where state in \('reserved', 'draft_created'\)/i);
  assert.match(sql, /where state in \('submitted', 'uncertain'\)/i);
  assert.match(sql, /events is append-only/i);
  assert.match(sql, /application_kind = 'native'/i);
  assert.match(sql, /status = 'retired'/i);
});

test('migration and configuration RPCs remain service-role only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const signature of [
    'public.apply_emailrouter_operational_config(jsonb, text)',
    'public.reconcile_emailrouter_operational_config(jsonb)',
    'public.sync_emailrouter_fcos_destinations(uuid)',
    'public.save_emailrouter_configuration(jsonb, uuid)',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function ${signature.replace(/[().]/g, '\\$&')}\\s+from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function ${signature.replace(/[().]/g, '\\$&')}\\s+to service_role`, 'i'));
  }
});

test('Email Router visibility is controlled by module access without removing current access', async () => {
  const [sql, app, layout, authModules, server] = await Promise.all([
    readFile(accessMigrationUrl, 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/authModules.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  ]);
  assert.match(sql, /values \('email_router', 'Email Router', '\/email-router', 89\)/);
  assert.match(sql, /select id, 'email_router', true\s+from public\.user_types/);
  assert.match(sql, /select id, 'email_router', true\s+from public\.user_profiles\s+where use_type_defaults = false/);
  assert.match(app, /path="\/email-router" element=\{<ModuleGate moduleId="email_router">/);
  assert.match(layout, /id: 'email_router'[\s\S]*moduleId: 'email_router'/);
  assert.match(authModules, /\{ id: 'email_router', label: 'Email Router', path: '\/email-router', sortOrder: 89 \}/);
  assert.match(server, /\{ id: 'email_router', label: 'Email Router', path: '\/email-router', sortOrder: 89 \}/);
  assert.match(server, /emailRouterList: \['email_router'\]/);
  assert.match(server, /emailRouterSettingsSave: \['email_router'\]/);
});

test('Email Router destination profiles do not rely on cross-schema PostgREST embeds', async () => {
  const [core, configuration] = await Promise.all([
    readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_emailRouterConfig.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(core, /\.select\([^\n]*user_profiles\(/);
  assert.doesNotMatch(configuration, /\.select\([^\n]*user_profiles\(/);
  assert.match(core, /emailRouterProfilesById/);
  assert.match(configuration, /emailRouterProfilesById/);
});

test('Email Router directory supports ordered users, external contacts, and groups through service-only configuration', async () => {
  const [activeSql, orderedSql, externalRestoreSql, core, configuration, dialog, recipientPicker, redirectPanel, messageSheet, settings, workspace] = await Promise.all([
    readFile(activeDirectoryMigrationUrl, 'utf8'),
    readFile(orderedDirectoryMigrationUrl, 'utf8'),
    readFile(externalRestoreMigrationUrl, 'utf8'),
    readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_emailRouterConfig.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailActionDialog.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRecipientPicker.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRedirectPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailMessageSheet.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterSettings.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterWorkspace.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(activeSql, /add column if not exists nickname text/i);
  assert.match(activeSql, /add column if not exists redirect_enabled boolean/i);
  assert.match(orderedSql, /alter table emailrouter\.destination_groups[\s\S]*add column if not exists redirect_enabled/i);
  assert.match(orderedSql, /create or replace function public\.save_emailrouter_routing_directory/i);
  assert.match(orderedSql, /create or replace function public\.save_emailrouter_external_destination/i);
  assert.match(orderedSql, /create or replace function public\.save_emailrouter_group/i);
  for (const signature of [
    'public.save_emailrouter_routing_directory(jsonb, uuid)',
    'public.save_emailrouter_external_destination(jsonb, uuid)',
    'public.save_emailrouter_group(jsonb, uuid)',
  ]) {
    assert.match(orderedSql, new RegExp(`revoke all on function ${signature.replace(/[().]/g, '\\$&')}\\s+from public, anon, authenticated`, 'i'));
    assert.match(orderedSql, new RegExp(`grant execute on function ${signature.replace(/[().]/g, '\\$&')}\\s+to service_role`, 'i'));
  }
  assert.match(core, /destination_kind === 'fcos_profile'/);
  assert.match(core, /\.eq\('redirect_enabled', true\)/);
  assert.match(core, /kind: 'group'/);
  assert.match(core, /groupId: normalizedGroupId/);
  assert.match(configuration, /operation\.type === 'routing_directory_save'/);
  assert.match(configuration, /save_emailrouter_routing_change/);
  assert.match(recipientPicker, /export const RECIPIENT_KINDS = \['to', 'cc', 'bcc'\]/);
  assert.match(dialog, /splitRecipientSelections/);
  assert.match(recipientPicker, /Loading routing directory/);
  assert.match(recipientPicker, /findIndex\([^\n]+\) \+ 1/);
  assert.match(redirectPanel, /Send Redirect/);
  assert.match(redirectPanel, /bccVisible, setBccVisible.*false/);
  assert.match(redirectPanel, /Number\(advisor\?\.confidence\) <= PRESELECT_CONFIDENCE/);
  assert.doesNotMatch(messageSheet, /Redirect message.*onAction/s);
  assert.match(externalRestoreSql, /configuration\.destination_restore/);
  assert.match(externalRestoreSql, /where destination\.email_address = requested_email[\s\S]*for update/i);
  assert.match(externalRestoreSql, /delete from emailrouter\.destination_group_members[\s\S]*destination_row\.id/i);
  assert.match(externalRestoreSql, /revoke all on function public\.save_emailrouter_external_destination\(jsonb, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(externalRestoreSql, /grant execute on function public\.save_emailrouter_external_destination\(jsonb, uuid\)[\s\S]*to service_role/i);
  assert.match(settings, /DragDropContext/);
  assert.match(settings, /Add external contact/);
  assert.match(settings, /draggableId=\{key\}/);
  assert.match(workspace, /directoryLoading=\{directoryLoading\}/);
  assert.match(workspace, /<EmailRedirectPanel/);
  assert.match(dialog, /const recipients = splitRecipientSelections\(selections\)/);
  assert.match(recipientPicker, /Manual \$\{kind\.toUpperCase\(\)\} email/);
  assert.match(redirectPanel, /splitRecipientSelections/);
});

test('Email Router audit events allow whole-directory ordering changes', async () => {
  const [orderedSql, directoryEventSql] = await Promise.all([
    readFile(orderedDirectoryMigrationUrl, 'utf8'),
    readFile(directoryEventMigrationUrl, 'utf8'),
  ]);

  assert.match(orderedSql, /'configuration\.routing_directory_save',[\s\S]*'routing_directory'/i);
  assert.match(directoryEventSql, /drop constraint if exists events_entity_type_check/i);
  assert.match(directoryEventSql, /add constraint events_entity_type_check[\s\S]*'routing_directory'/i);
});

test('Email Router presets validate only the non-null recipient identity', async () => {
  const [migrationSql, configuration, settings] = await Promise.all([
    readFile(presetValidationMigrationUrl, 'utf8'),
    readFile(new URL('../api/_emailRouterConfig.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterSettings.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(migrationSql, /create or replace function public\.save_emailrouter_preset/i);
  assert.match(migrationSql, /destination_id_value is not null and not exists/i);
  assert.match(migrationSql, /group_id_value is not null and not exists/i);
  assert.match(migrationSql, /destination\.redirect_enabled = true/i);
  assert.match(migrationSql, /destination_group\.redirect_enabled = true/i);
  assert.match(migrationSql, /revoke all on function public\.save_emailrouter_preset\(jsonb, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migrationSql, /grant execute on function public\.save_emailrouter_preset\(jsonb, uuid\)[\s\S]*to service_role/i);
  assert.match(configuration, /operation\.type === 'preset_save'[\s\S]*save_emailrouter_routing_change/i);
  assert.match(settings, /Remove or replace unavailable recipients before saving/);
  assert.match(settings, /Unavailable recipient/);
});

test('Email Router routing mutations preserve active group and preset integrity atomically', async () => {
  const sql = await readFile(routingIntegrityMigrationUrl, 'utf8');
  assert.match(sql, /create or replace function emailrouter\.assert_routing_integrity\(\)/i);
  assert.match(sql, /active Email Router preset contains an unavailable destination/i);
  assert.match(sql, /active Email Router preset contains an unavailable group/i);
  assert.match(sql, /create or replace function public\.save_emailrouter_routing_change/i);
  for (const operation of ['routing_directory_save', 'destination_save', 'group_save', 'preset_save']) {
    assert.match(sql, new RegExp(`when '${operation}'`, 'i'));
  }
  assert.match(sql, /perform emailrouter\.assert_routing_integrity\(\)/i);
  assert.match(sql, /revoke all on function public\.save_emailrouter_routing_change\(jsonb, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.save_emailrouter_routing_change\(jsonb, uuid\)[\s\S]*to service_role/i);
});
