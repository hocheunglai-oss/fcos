import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Settings is universal while administrative sections remain role-aware', async () => {
  const [app, workspace, auth, settings] = await Promise.all([
    read('../src/App.jsx'),
    read('../src/pages/SettingsWorkspace.jsx'),
    read('../src/lib/AuthContext.jsx'),
    read('../src/pages/Settings.jsx'),
  ]);

  assert.match(app, /path="\/settings" element=\{<SettingsWorkspace \/>\}/);
  assert.match(app, /RedirectWithSection section="people"/);
  assert.match(workspace, /id: 'my'[\s\S]*access: 'all'/);
  assert.match(workspace, /id: 'health'[\s\S]*access: 'all'/);
  assert.match(workspace, /id: 'people'[\s\S]*access: 'administrator'/);
  assert.match(workspace, /id: 'updates'[\s\S]*access: 'administrator'/);
  assert.match(workspace, /SettingsPage section="my"/);
  assert.match(workspace, /FcosUpdatesSection/);
  assert.match(workspace, /SelectTrigger aria-label="Settings section"/);
  assert.match(auth, /const hasCapability = useCallback/);
  assert.doesNotMatch(settings, /Save All Settings/);
  assert.match(settings, /sameWorkspaceSettings\(settingsDraftValue, baseSettings\)/);
  const comparableSettings = settings.slice(settings.indexOf('function comparableWorkspaceSettings'), settings.indexOf('function SettingsPanel'));
  assert.doesNotMatch(comparableSettings, /revision|initialized/);
  assert.match(settings, /Save My Settings/);
});

test('sidebar preference controls are launched only from My Settings', async () => {
  const [layout, settings] = await Promise.all([
    read('../src/components/Layout.jsx'),
    read('../src/pages/Settings.jsx'),
  ]);

  assert.doesNotMatch(layout, /toggle-fixed-sidebar|Use auto-hide sidebar|Keep sidebar open/);
  assert.doesNotMatch(layout, /title="Customize navigation"|aria-label="Customize navigation"/);
  assert.doesNotMatch(layout, /fixed inset-y-0 left-0 z-\[39\] w-1/);
  assert.match(layout, /fcos:navigation-customize/);
  assert.doesNotMatch(layout, /import \{ DragDropContext, Draggable, Droppable \} from '@hello-pangea\/dnd'/);
  assert.match(layout, /await import\('@hello-pangea\/dnd'\)/);
  assert.doesNotMatch(settings, /Auto-hide at the left edge|Keep fixed space/);
  assert.match(settings, /<SelectItem value="fixed">Icon only<\/SelectItem>/);
  assert.match(settings, /<SelectItem value="auto_hide">Icon and caption<\/SelectItem>/);
  assert.match(settings, /expands the complete dock while the pointer is anywhere over the sidebar/);
  assert.match(settings, /Customize sidebar order and visibility/);
});

test('application sidebar is a translucent icon dock and session actions belong to Settings', async () => {
  const [layout, workspace] = await Promise.all([
    read('../src/components/Layout.jsx'),
    read('../src/pages/SettingsWorkspace.jsx'),
  ]);

  assert.match(layout, /navigationEditing \? 'w-\[248px\]' : sidebarShowsCaptions \? 'w-\[232px\]' : 'w-\[72px\]'/);
  assert.match(layout, /backdrop-blur-2xl/);
  assert.match(layout, /<span className="sr-only">\{label\}<\/span>/);
  assert.match(layout, /<TooltipContent side="right" sideOffset=\{12\}/);
  assert.match(layout, /group-hover:scale-125/);
  assert.match(layout, /sidebarCaptionMode && sidebarHovered/);
  assert.doesNotMatch(layout, /origin-left items-center gap-3[\s\S]{0,220}hover:scale-\[1\.04\]/);
  assert.match(layout, /truncate whitespace-nowrap/);
  assert.match(layout, /<div className="w-\[72px\] shrink-0" aria-hidden="true" \/>/);
  assert.match(layout, /data-sidebar-caption-glass="true"/);
  assert.match(layout, /app-workspace-sidebar fixed[\s\S]*z-\[45\]/);
  assert.match(layout, /left-\[64px\][\s\S]*bg-white\/\[0\.18\][\s\S]*backdrop-blur-lg[\s\S]*supports-\[backdrop-filter\]:bg-white\/\[0\.12\]/);
  assert.match(layout, /flex w-14 shrink-0 justify-center/);
  assert.match(layout, /flex h-8 items-center[\s\S]*<WorkNotifications \/>/);
  assert.match(layout, /sidebarShowsCaptions \? 'space-y-2 px-2 py-3'/);
  assert.match(layout, /sidebarMode: 'auto_hide'/);
  assert.match(layout, /aria-label="Application navigation"/);
  assert.match(layout, /function navigationTargetIsActive/);
  assert.match(layout, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(layout, /<Link[\s\S]*aria-label=\{label\}/);
  assert.doesNotMatch(layout, />\s*Sign out\s*</);
  assert.match(layout, /fcos:version-audit-open/);
  assert.match(layout, /fcos:sign-out-requested/);
  assert.match(workspace, /Version \{APP_VERSION\}/);
  assert.match(workspace, />Sign out</);
  assert.match(workspace, /lg:mt-auto/);
});

test('module-owned configuration is linked from its owning workflow', async () => {
  const [workspace, emailRouter, hedgeDesk, brokerWorkspace, brokerRegister] = await Promise.all([
    read('../src/pages/SettingsWorkspace.jsx'),
    read('../src/pages/EmailRouter.jsx'),
    read('../src/pages/HedgeDesk.jsx'),
    read('../src/pages/BrokerWorkspace.jsx'),
    read('../src/pages/BrokerRegister.jsx'),
  ]);

  assert.match(emailRouter, /<EmailRouterWorkspace settingsOpen=\{settingsOpen\}/);
  assert.doesNotMatch(emailRouter, /activeTab|MailSearch/);
  assert.match(hedgeDesk, /id: 'administration'/);
  assert.match(hedgeDesk, /<HedgeSettingsPanel \/>/);
  assert.match(brokerWorkspace, /activeTab === 'configuration'/);
  assert.match(brokerWorkspace, /<BrokerCommissionConfiguration \/>/);
  assert.match(workspace, /\/email-router\?tab=routing-setup/);
  assert.match(workspace, /\/hedge-desk\?tab=administration/);
  assert.match(workspace, /\/brokers\?tab=configuration/);
  assert.doesNotMatch(brokerRegister, /provider:\s*exchangeRateProvider/);
});

test('workspace preferences and broker settings are revisioned and service-only', async () => {
  const [migration, sidebarDefaultMigration, server, admin, modules] = await Promise.all([
    read('../supabase/migrations/20260804181236_settings_workspace_reorganization.sql'),
    read('../supabase/migrations/20260805163332_default_sidebar_icon_caption.sql'),
    read('../api/functions/[name].js'),
    read('../src/pages/AdminControl.jsx'),
    read('../src/lib/authModules.js'),
  ]);

  assert.match(migration, /add column if not exists sidebar_mode/);
  assert.match(migration, /create or replace function public\.save_user_workspace_preferences/);
  assert.match(migration, /create or replace function public\.save_user_navigation_preferences[\s\S]*workspace_preference_events/);
  assert.match(migration, /create table if not exists public\.broker_commission_settings/);
  assert.match(migration, /exchange_rate_provider text not null default 'blended'/);
  assert.match(migration, /revoke all on table public\.broker_commission_settings from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.broker_commission_settings to service_role/);
  assert.match(migration, /'broker_settings_manage'/);
  assert.match(sidebarDefaultMigration, /alter column sidebar_mode set default 'auto_hide'/);
  assert.match(sidebarDefaultMigration, /where sidebar_mode is distinct from 'auto_hide'/);
  assert.match(sidebarDefaultMigration, /revision = revision \+ 1/);
  assert.match(sidebarDefaultMigration, /workspace_preference_events/);
  assert.match(server, /workspacePreferencesGet: \[\]/);
  assert.match(server, /calendarGateEnabled \? row : \{ \.\.\.row, status: 'disabled'/);
  assert.match(server, /base\.warning && \(!reportedStatus \|\| reportedStatus === 'online'\) \? 'warning'/);
  assert.match(server, /systemHealth: \[\]/);
  assert.match(server, /loadBrokerCommissionSettings\(client\)/);
  const rateHandler = server.slice(server.indexOf('async function frankfurterUsdCnyRate'), server.indexOf('function earliestDate'));
  assert.match(rateHandler, /loadBrokerCommissionSettings\(client\)/);
  assert.doesNotMatch(rateHandler, /body\.provider/);
  assert.match(server, /capabilities: capabilityValues/);
  assert.match(admin, /\!\['settings', 'admin'\]\.includes\(module\.id\)/);
  assert.doesNotMatch(admin, />Application Access</);
  assert.match(modules, /id: 'broker_settings_manage'/);
});

test('System Health includes a lazy, signed, secret-safe CLI-first Connection Checklist', async () => {
  const [settings, checklist, policy, sharedPolicy, methodology] = await Promise.all([
    read('../src/pages/Settings.jsx'),
    read('../src/components/settings/ConnectionChecklist.jsx'),
    read('../src/lib/connectionChecklist.js'),
    read('../config/fcosConnections.js'),
    read('../src/lib/pageMethodologies.js'),
  ]);

  assert.match(settings, /lazy\(\(\) => import\('@\/components\/settings\/ConnectionChecklist'\)\)/);
  assert.match(settings, /<TabsTrigger value="connections">Connection Checklist<\/TabsTrigger>/);
  assert.match(checklist, /Live, machine-signed verification/);
  assert.match(checklist, /appClient\.functions\.invoke\('systemHealth'/);
  assert.doesNotMatch(checklist, /<Input|<Textarea/);
  assert.doesNotMatch(checklist, /localStorage|browser_authentication_completed/);
  assert.match(policy, /APPROVED_CONNECTION_BROWSER_PROFILE = FCOS_CONNECTION_POLICY\.browserProfile/);
  assert.match(sharedPolicy, /browserProfile: 'Otto'/);
  assert.match(sharedPolicy, /publicKeySpkiBase64/);
  assert.match(methodology, /The Connection Checklist requires an approved CLI and version first/);
});

test('Settings uses unified AI cards, compact access tables, and atomic email route saving', async () => {
  const [settings, people, workspace, dashboardAi, hedgeAi, routerAi, migration, server] = await Promise.all([
    read('../src/pages/Settings.jsx'),
    read('../src/pages/AdminControl.jsx'),
    read('../src/pages/SettingsWorkspace.jsx'),
    read('../src/components/settings/AiModelSettingsCard.jsx'),
    read('../src/hedge/components/HedgeAssistantAiSettings.jsx'),
    read('../src/components/email-router/EmailRouterAdvisorAiSettings.jsx'),
    read('../supabase/migrations/20260805113522_email_sender_route_batch.sql'),
    read('../api/functions/[name].js'),
  ]);

  assert.match(settings, /emailSenderRouteSave/);
  assert.match(settings, /Save \{dirtySenderRoutes\.length\} assignment/);
  assert.doesNotMatch(settings, /Save route/);
  assert.match(people, /Search name, email, or type/);
  assert.doesNotMatch(people, /adminAuditLogs|Audit Log/);
  assert.match(workspace, /grid-cols-\[212px_minmax\(0,1fr\)\]/);
  assert.match(dashboardAi, /Cached input/);
  assert.match(hedgeAi, /<AiModelSettingsCard/);
  assert.match(routerAi, /<AiModelSettingsCard/);
  assert.match(migration, /create or replace function public\.save_email_sender_routes_batch/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.save_email_sender_routes_batch\(jsonb, text, uuid, text\) to service_role/);
  assert.match(server, /emailSenderRouteSave: \['admin'\]/);
});
