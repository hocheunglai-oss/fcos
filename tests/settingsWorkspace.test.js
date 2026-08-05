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

test('module-owned configuration is linked from its owning workflow', async () => {
  const [workspace, emailRouter, hedgeDesk, brokerWorkspace, brokerRegister] = await Promise.all([
    read('../src/pages/SettingsWorkspace.jsx'),
    read('../src/pages/EmailRouter.jsx'),
    read('../src/pages/HedgeDesk.jsx'),
    read('../src/pages/BrokerWorkspace.jsx'),
    read('../src/pages/BrokerRegister.jsx'),
  ]);

  assert.match(emailRouter, /Routing Setup/);
  assert.match(emailRouter, /<EmailRouterSettings \/>/);
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
  const [migration, server, admin, modules] = await Promise.all([
    read('../supabase/migrations/20260804181236_settings_workspace_reorganization.sql'),
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
  assert.match(server, /workspacePreferencesGet: \[\]/);
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
