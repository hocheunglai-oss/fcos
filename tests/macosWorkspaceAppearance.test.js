import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('workspace appearance preferences are revisioned and remain service-only', async () => {
  const [migration, server] = await Promise.all([
    read('../supabase/migrations/20260822173115_macos_workspace_appearance_preferences.sql'),
    read('../api/functions/[name].js'),
  ]);
  assert.match(migration, /appearance_mode text not null default 'system'/);
  assert.match(migration, /glass_intensity text not null default 'balanced'/);
  assert.match(migration, /save_user_workspace_preferences_v2/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /p_user_id <> p_actor_user_id/);
  assert.match(migration, /changed after they were opened/);
  assert.match(migration, /revoke all on function public\.save_user_workspace_preferences_v2[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_user_workspace_preferences_v2[\s\S]*to service_role/);
  assert.match(server, /appearanceMode: \['system', 'light', 'dark'\]/);
  assert.match(server, /client\.rpc\('save_user_workspace_preferences_v2'/);
});

test('appearance is applied before first paint and reacts to system accessibility settings', async () => {
  const [html, appearance, styles, layout, settings] = await Promise.all([
    read('../index.html'),
    read('../src/lib/appearancePreferences.js'),
    read('../src/index.css'),
    read('../src/components/Layout.jsx'),
    read('../src/pages/Settings.jsx'),
  ]);
  assert.match(html, /fcos:workspace-appearance:v1/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(appearance, /listenForSystemAppearance/);
  assert.match(styles, /prefers-reduced-transparency: reduce/);
  assert.match(styles, /prefers-contrast: more/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(styles, /fonts\.googleapis\.com/);
  assert.match(layout, /WorkspaceCommandPalette/);
  assert.match(layout, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(layout, /event\.key === ','/);
  assert.match(settings, /Follow system/);
  assert.match(settings, /Glass intensity/);
});

test('shared chrome exposes one compact toolbar registration interface', async () => {
  const [header, chrome] = await Promise.all([
    read('../src/components/common/PageHeader.jsx'),
    read('../src/components/workspace/WorkspaceChrome.jsx'),
  ]);
  assert.match(header, /useWorkspaceChromeRegistration/);
  assert.match(header, /sticky top-0/);
  assert.match(chrome, /WorkspaceChromeProvider/);
  assert.match(chrome, /fcos:workspace-chrome-changed/);
});
