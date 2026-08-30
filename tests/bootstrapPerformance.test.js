import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('auth bootstrap returns both preference projections from one database row', async () => {
  const source = await readSource('../api/functions/[name].js');
  assert.match(source, /function loadAuthBootstrapPreferences/);
  assert.match(source, /\.from\('user_navigation_preferences'\)[\s\S]*?section_orders,hidden_item_ids,sidebar_mode,table_density/);
  assert.match(source, /navigationPreferences: bootstrapPreferences\?\.navigationPreferences \|\| null/);
  assert.match(source, /workspacePreferences: bootstrapPreferences\?\.workspacePreferences \|\| null/);
});

test('layout consumes bootstrapped preferences and retains compatibility handlers as fallbacks', async () => {
  const source = await readSource('../src/components/Layout.jsx');
  assert.match(source, /bootstrapPreferences\?\.workspace/);
  assert.match(source, /bootstrapPreferences\?\.navigation/);
  assert.match(source, /: appClient\.functions\.invoke\('workspacePreferencesGet'\)/);
  assert.match(source, /: appClient\.functions\.invoke\('navigationPreferencesGet'\)/);
});

test('portal application listing reuses its already-loaded catalog during reconciliation', async () => {
  const source = await readSource('../api/_portal.js');
  assert.match(source, /catalog: preloadedCatalog = null/);
  assert.match(source, /const catalog = preloadedCatalog \|\| await loadPortalCatalog\(client\)/);
  assert.match(source, /reconcilePortalEntitlementsForProfile\(client, profile, null, \{ catalog \}\)/);
});
