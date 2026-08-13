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
const simplifiedPresetMigrationUrl = new URL('../supabase/migrations/20260803182723_simplify_emailrouter_routing_presets.sql', import.meta.url);
const caseSensitiveLabelsMigrationUrl = new URL('../supabase/migrations/20260803185144_make_emailrouter_routing_labels_case_sensitive.sql', import.meta.url);
const leavePresetMigrationUrl = new URL('../supabase/migrations/20260804022141_email_router_inline_images_leave_presets.sql', import.meta.url);
const forwardFileMigrationUrl = new URL('../supabase/migrations/20260807120000_email_router_forward_file_learning.sql', import.meta.url);

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

test('Forward-and-File storage is service-only, content-free, and revision protected', async () => {
  const [sql, core, settings, routePanel] = await Promise.all([
    readFile(forwardFileMigrationUrl, 'utf8'),
    readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterSettings.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRedirectPanel.jsx', import.meta.url), 'utf8'),
  ]);
  for (const table of ['routing_folders', 'advisor_recommendations', 'advisor_learning_outcomes', 'advisor_learning_jobs', 'advisor_feedback']) {
    assert.match(sql, new RegExp(`create table if not exists emailrouter\\.${table} \\(`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table emailrouter\\.%I from public, anon, authenticated`, 'i'));
  }
  assert.match(sql, /save_emailrouter_routing_folders/);
  assert.match(sql, /expectedRevision/);
  assert.match(sql, /post_action_state[\s\S]*'pending'[\s\S]*'confirmed'[\s\S]*'failed'[\s\S]*'uncertain'/);
  assert.doesNotMatch(sql, /body_html|raw_mime|recipient_email|attachment_bytes/i);
  assert.match(core, /sentDraftConfirmed[\s\S]*completeConfirmedSourceFiling/);
  assert.match(routePanel, /Forward and Redirect|Send Forward|postActionMode/);
  assert.doesNotMatch(routePanel, /Review the action, recipients|Recipients see the reviewed|FCOS files the source only after/);
  assert.match(routePanel, /<EmailPresetPicker[^>]*compact/);
  assert.match(routePanel, /<EmailRecipientPicker[\s\S]*compact/);
  assert.match(settings, /Post-action folders|Company routing learning|Forget pattern/);
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
  assert.match(layout, /workspaceNavigation\('email_router', \{ moduleId: 'email_router'/);
  assert.match(authModules, /\{ id: 'email_router', label: 'Email Router', path: '\/email-router', sortOrder: 89 \}/);
  assert.match(server, /\{ id: 'email_router', label: 'Email Router', path: '\/email-router', sortOrder: 89 \}/);
  assert.match(server, /emailRouterList: \['email_router'\]/);
  assert.match(server, /emailRouterActionStatus: \['email_router'\]/);
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
  assert.doesNotMatch(dialog, /forward:/);
  assert.match(recipientPicker, /Loading routing directory/);
  assert.match(recipientPicker, /findIndex\([^\n]+\) \+ 1/);
  assert.match(redirectPanel, /Send Redirect/);
  assert.match(redirectPanel, /bccVisible, setBccVisible.*false/);
  assert.match(redirectPanel, /advisor\?\.preselectRecipients !== true \|\| Number\(advisor\?\.recipientConfidence\) <= PRESELECT_CONFIDENCE/);
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
  assert.match(recipientPicker, /Manual \$\{kind\.toUpperCase\(\)\} email/);
  assert.match(redirectPanel, /splitRecipientSelections/);
});

test('Email Router filing waits for Sent Items and retries only the source move', async () => {
  const [core, handlers, workspace, dialog, messageSheet] = await Promise.all([
    readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_emailRouterHandlers.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterWorkspace.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailActionDialog.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailMessageSheet.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(core, /processEmailRouterOutbox\(\{ client, mailbox, limit = 10, actionId = null, confirmNewSubmissions = true \}/);
  assert.match(core, /\.eq\('mail_action_id', targetActionId\)/);
  assert.match(core, /!submittedNow \|\| confirmNewSubmissions/);
  assert.match(handlers, /limit: 1, actionId: result\.id, confirmNewSubmissions: false/);
  assert.match(workspace, /action === 'archive' \|\| action === 'move_market_report'/);
  assert.match(workspace, /destinationFolderKey: 'market_report'/);
  assert.match(workspace, /setMessages\(\(current\) => current\.filter[\s\S]*await submitAction\(payload, movedMessage, \{ refreshList: false \}\)/);
  assert.match(handlers, /continueEmailRouterWork\(submission, runtimeDependencies, 'Draft submission'\)/);
  assert.match(handlers, /emailRouterActionStatusHandler[\s\S]*confirmNewSubmissions: true/);
  assert.match(workspace, /emailRouter\.actionStatus\(\{ actionId \}, \{ force: true, cache: false, invalidateCache: false \}\)/);
  assert.match(workspace, /ACTION_STATUS_POLL_TIMEOUT_MS/);
  assert.match(workspace, /will not resend automatically/);
  assert.match(core, /sentDraftConfirmed[\s\S]*completeConfirmedSourceFiling/);
  assert.match(core, /retryEmailRouterSourceFiling/);
  assert.match(core, /post_action_state: definiteFailure \? 'failed' : 'uncertain'/);
  assert.doesNotMatch(workspace, /payload\.action === 'redirect'[\s\S]*setMessages\(\(current\) => current\.filter/);
  assert.match(workspace, /emailRouter\.directory[\s\S]*setPresets\(directoryResponse\.data\?\.presets/);
  assert.doesNotMatch(workspace, /emailRouter\.presets\(/);
  assert.match(workspace, /\}, \[selectedId\]\);/);
  assert.match(workspace, /attachment\.streamUrl/);
  assert.doesNotMatch(dialog, /archive:\s*\{/);
  assert.match(messageSheet, /Move immediately to Archive/);
  assert.match(messageSheet, /Move immediately to the Market Report folder/);
  assert.match(workspace, /Inbox[\s\S]*Sent[\s\S]*Archive[\s\S]*Actions[\s\S]*EmailMessageActions/);
  assert.match(workspace, /showActions=\{false\}/);
});

test('Email Router action status is page-level and not duplicated in the message pane', async () => {
  const [page, workspace, messageSheet, pageHeader] = await Promise.all([
    readFile(new URL('../src/pages/EmailRouter.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterWorkspace.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailMessageSheet.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/common/PageHeader.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /<ResultNotice result=\{actionResult\} compact \/>/);
  assert.doesNotMatch(page, /Mailbox<\/Button>|activeTab|MailSearch/);
  assert.match(workspace, /<Settings2 \/>[\s\S]*Routing Setup[\s\S]*<CalendarOff \/>[\s\S]*Routing Leave/);
  assert.match(workspace, /<EmailRouterSettings embedded \/>/);
  assert.doesNotMatch(workspace, /eyebrow="Operations"|messages loaded|description="Review connected mailbox traffic/);
  assert.doesNotMatch(workspace, /<ResultNotice result=\{actionResult\} \/>\s*<section/);
  assert.match(workspace, /messageId: sourceMessage\.id/);
  assert.doesNotMatch(workspace, /if \(messageId !== selectedId\) setActionResult\(null\)/);
  assert.match(messageSheet, /actionResult\?\.messageId === message\?\.id/);
  assert.doesNotMatch(messageSheet, /actionResult && <div/);
  assert.match(pageHeader, /status && <div className="min-w-0">\{status\}<\/div>/);
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

test('Email Router routing labels preserve case and are unique by exact case', async () => {
  const [sql, settings, methodologies] = await Promise.all([
    readFile(caseSensitiveLabelsMigrationUrl, 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterSettings.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pageMethodologies.js', import.meta.url), 'utf8'),
  ]);

  assert.match(sql, /nickname ~ '\^\[A-Za-z0-9\]\{1,12\}\$'/);
  assert.match(sql, /on emailrouter\.destinations \(nickname\)/i);
  assert.doesNotMatch(sql, /lower\(existing\.nickname\)|distinct lower\([^)]*nickname/i);
  assert.match(sql, /existing\.nickname = candidate/i);
  assert.match(sql, /destination\.nickname = requested_nickname/i);
  assert.match(sql, /count\(distinct btrim\(value->>'nickname'\)\)/i);
  assert.match(settings, /replace\(\/\[\^A-Za-z0-9\]\/g, ''\)/);
  assert.doesNotMatch(settings, /toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]/);
  assert.match(settings, /case-sensitive unique routing label/i);
  assert.match(methodologies, /case-sensitive labels/i);
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
  assert.match(configuration, /\['preset_save', 'preset_version_save', 'preset_override_save'\]\.includes\(operation\.type\)[\s\S]*save_emailrouter_routing_change/i);
  assert.match(settings, /Remove or replace unavailable recipients before saving/);
  assert.match(settings, /<EmailRecipientPicker/);
  assert.match(settings, /allowManual=\{false\}/);
});

test('Email Router leave-aware preset versions remain service-only and preserve Standard routes', async () => {
  const [sql, core, settings, workspace, messageSheet] = await Promise.all([
    readFile(leavePresetMigrationUrl, 'utf8'),
    readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterSettings.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterWorkspace.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailMessageSheet.jsx', import.meta.url), 'utf8'),
  ]);
  for (const table of ['routing_preset_versions', 'routing_preset_version_conditions', 'routing_preset_version_destinations', 'routing_leave_periods', 'routing_preset_overrides']) {
    assert.match(sql, new RegExp(`create table if not exists emailrouter\\.${table}`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table emailrouter\\.%I from public, anon, authenticated`, 'i'));
  }
  assert.match(sql, /version_label, version_kind[\s\S]*'Standard', 'baseline'/i);
  assert.match(sql, /insert into emailrouter\.routing_preset_version_destinations[\s\S]*routing_preset_destinations/i);
  assert.match(sql, /create or replace function public\.save_emailrouter_routing_leave/i);
  assert.match(sql, /target_user_id <> p_actor and not emailrouter\.configuration_actor_authorized/i);
  assert.match(sql, /tstzrange\(existing\.starts_at, existing\.ends_at, '\[\)'\)[\s\S]*&&/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*routing_leave/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*preset_override/i);
  assert.match(core, /ROUTE_SNAPSHOT_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(core, /route-snapshot-v1:/);
  assert.match(settings, /Routing presets and leave rules/);
  assert.doesNotMatch(settings, /Company routing leave/);
  assert.match(workspace, /canManageAll=\{isAdministrator\}/);
  assert.match(workspace, />Routing Leave<\/span><\/Button>/);
  assert.match(messageSheet, /Inline image unavailable/);
  for (const signature of [
    'public.save_emailrouter_preset_version(jsonb, uuid)',
    'public.save_emailrouter_preset_override(jsonb, uuid)',
    'public.save_emailrouter_routing_leave(jsonb, uuid)',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function ${signature.replace(/[().]/g, '\\$&')} from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function ${signature.replace(/[().]/g, '\\$&')} to service_role`, 'i'));
  }
});

test('routing presets are editable recipient templates identified by a unique display name', async () => {
  const [migrationSql, core, configuration, presetPicker, recipientPicker, redirectPanel, actionDialog, settings] = await Promise.all([
    readFile(simplifiedPresetMigrationUrl, 'utf8'),
    readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_emailRouterConfig.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailPresetPicker.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRecipientPicker.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRedirectPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailActionDialog.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailRouterSettings.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(migrationSql, /unique index[\s\S]*lower\(btrim\(display_name\)\)/i);
  assert.doesNotMatch(migrationSql, /p_operation->>'presetKey'/i);
  assert.match(migrationSql, /A unique preset name and at least one recipient are required/i);
  assert.match(migrationSql, /security invoker/i);
  assert.match(migrationSql, /revoke all on function public\.save_emailrouter_preset\(jsonb, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migrationSql, /grant execute on function public\.save_emailrouter_preset\(jsonb, uuid\)[\s\S]*to service_role/i);
  assert.doesNotMatch(core, /select\('id,preset_key/);
  assert.doesNotMatch(configuration, /select\('id,preset_key/);
  assert.doesNotMatch(settings, /Preset key|presetKey/);
  assert.match(settings, /Routing preset names must be unique/);
  assert.match(presetPicker, /aria-pressed=\{selected\}/);
  assert.match(recipientPicker, /presetRecipientSelections/);
  assert.match(redirectPanel, /setSelections\(next\)/);
  assert.match(redirectPanel, /onChange=\{\(next\) => \{ setPresetId\('none'\)/);
  assert.doesNotMatch(redirectPanel, /disabled=\{presetId !== 'none'/);
  assert.doesNotMatch(actionDialog, /presetRecipientSelections|EmailRecipientPicker/);
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

test('Email Router viewer preserves safe newsletter layout without unsafe active content', async () => {
  const [{ safeEmailImageSource, sanitizeEmailInlineStyle, stripEmailPresentationComments }, stylesheet, messageSheet] = await Promise.all([
    import('../src/lib/emailContentSafety.js'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/email-router/EmailMessageSheet.jsx', import.meta.url), 'utf8'),
  ]);

  assert.equal(safeEmailImageSource('https://prices.example.net/chart.png'), 'https://prices.example.net/chart.png');
  assert.equal(safeEmailImageSource('blob:https://fcos.fcuno.com/inline-image'), 'blob:https://fcos.fcuno.com/inline-image');
  assert.equal(safeEmailImageSource('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeEmailImageSource('data:image/png;base64,iVBO\r\n Rw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeEmailImageSource('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  assert.equal(safeEmailImageSource('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4='), '');
  assert.equal(safeEmailImageSource('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(safeEmailImageSource('http://prices.example.net/tracker.png'), '');
  assert.equal(safeEmailImageSource('javascript:alert(1)'), '');

  const style = sanitizeEmailInlineStyle('width: 680px; text-align: center; color: #174f86; position: fixed; background: url(https://tracker.example.net/pixel)');
  assert.match(style, /width: 680px/);
  assert.match(style, /text-align: center/);
  assert.match(style, /color: #174f86/);
  assert.doesNotMatch(style, /position|url\s*\(/i);

  const wysiwygCss = '.wysiwyg-color-silver {color:silver} p {margin:0; padding:0} body {font-family:Calibri,Arial,sans-serif}';
  assert.equal(stripEmailPresentationComments(`<!-- ${wysiwygCss} --><p>Visible message</p>`), '<p>Visible message</p>');
  assert.equal(stripEmailPresentationComments(`&lt;!-- ${wysiwygCss} --&gt;<p>Visible message</p>`), '<p>Visible message</p>');
  assert.equal(stripEmailPresentationComments('<!-- ordinary sender note --><p>Visible message</p>'), '<!-- ordinary sender note --><p>Visible message</p>');

  assert.match(messageSheet, /email-router-content-shell/);
  assert.match(stylesheet, /\.email-router-content-shell[\s\S]*overflow-wrap: break-word/);
  assert.doesNotMatch(stylesheet, /\.email-router-content table\s*\{[^}]*display:\s*block/s);
});
