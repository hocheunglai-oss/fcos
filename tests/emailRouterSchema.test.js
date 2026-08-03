import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260803090000_native_emailrouter_schema.sql', import.meta.url);
const accessMigrationUrl = new URL('../supabase/migrations/20260803030109_email_router_module_access.sql', import.meta.url);
const activeDirectoryMigrationUrl = new URL('../supabase/migrations/20260803041219_email_router_active_user_directory.sql', import.meta.url);

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

test('Email Router routing labels are active-user nicknames with service-only configuration', async () => {
  const [sql, core, configuration, dialog] = await Promise.all([
    readFile(activeDirectoryMigrationUrl, 'utf8'),
    readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_emailRouterConfig.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailActionDialog.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(sql, /add column if not exists nickname text/i);
  assert.match(sql, /add column if not exists redirect_enabled boolean/i);
  assert.match(sql, /revoke all on function public\.save_emailrouter_routing_users\(jsonb, uuid\)\s+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.save_emailrouter_routing_users\(jsonb, uuid\)\s+to service_role/i);
  assert.match(core, /\.eq\('destination_kind', 'fcos_profile'\)/);
  assert.match(core, /\.eq\('redirect_enabled', true\)/);
  assert.match(core, /\{ id: destination\.id, label: destination\.nickname \}/);
  assert.match(configuration, /operation\.type === 'routing_users_save'/);
  assert.match(dialog, /const RECIPIENT_KINDS = \['to', 'cc', 'bcc'\]/);
  assert.match(dialog, /destinationSelections: selections/);
  assert.doesNotMatch(dialog, /recipientAddress|emailAddress|manualRecipients/);
});
