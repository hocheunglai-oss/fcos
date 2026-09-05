import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('high-frequency notification and Email Router calls bypass the universal dispatcher', async () => {
  const [client, notificationsRoute, emailRoute, backgroundSync] = await Promise.all([
    read('../src/api/appClient.js'),
    read('../api/work-notifications.js'),
    read('../api/email-router-background-sync.js'),
    read('../api/_emailRouterBackgroundSync.js'),
  ]);
  assert.match(client, /workNotificationsList: '\/api\/work-notifications'/);
  assert.match(client, /workNotificationsRead: '\/api\/work-notifications'/);
  assert.match(client, /workNotificationsState: '\/api\/work-notifications'/);
  assert.match(client, /emailRouterBackgroundSync: '\/api\/email-router-background-sync'/);
  assert.match(client, /x-fcos-function-name/);
  assert.doesNotMatch(notificationsRoute, /functions\/\[name\]/);
  assert.doesNotMatch(emailRoute, /functions\/\[name\]/);
  assert.doesNotMatch(emailRoute, /_emailRouterHandlers/);
  assert.doesNotMatch(backgroundSync, /pdf-parse/);
  assert.match(backgroundSync, /folders: \['inbox'\]/);
  assert.match(backgroundSync, /maxPages: 1/);
  assert.match(emailRoute, /moduleId: 'email_router'/);
});

test('notification database snapshot is one service-only security-invoker request with a rollout fallback', async () => {
  const [service, migration] = await Promise.all([
    read('../api/_workNotifications.js'),
    read('../supabase/migrations/20260819173207_work_notification_snapshot.sql'),
  ]);
  assert.match(service, /client\.rpc\('load_work_notification_snapshot'/);
  assert.match(service, /loadLegacyDatabaseSnapshot/);
  assert.match(service, /unavailableSnapshotFunction/);
  assert.match(migration, /create or replace function public\.load_work_notification_snapshot/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /set statement_timeout = '8s'/);
  assert.match(migration, /revoke all on function public\.load_work_notification_snapshot[\s\S]*from authenticated/);
  assert.match(migration, /grant execute on function public\.load_work_notification_snapshot[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/);
});

test('foreground Email Router checks are bounded while full maintenance remains scheduled', async () => {
  const [handlers, dispatcher, vercel] = await Promise.all([
    read('../api/_emailRouterHandlers.js'),
    read('../api/functions/[name].js'),
    read('../vercel.json'),
  ]);
  const foreground = handlers.match(/export async function emailRouterBackgroundSyncHandler[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(foreground, /folders: \['inbox'\]/);
  assert.match(foreground, /maxPages: 1/);
  assert.doesNotMatch(foreground, /sentitems|archive/);
  assert.match(dispatcher, /for \(const folder of \['inbox', 'sentitems', 'archive'\]\)/);
  assert.match(dispatcher, /maintainEmailRouterSubscriptions/);
  assert.match(vercel, /"path": "\/api\/functions\/emailRouterMaintenanceCron"/);
  assert.match(vercel, /"schedule": "\*\/5 \* \* \* \*"/);
});

test('quality gate covers browser libraries, server modules, checked JavaScript, and performance budgets', async () => {
  const [eslint, packageJson, workflow, coreTypes, budget] = await Promise.all([
    read('../eslint.config.js'),
    read('../package.json'),
    read('../.github/workflows/quality.yml'),
    read('../jsconfig.core.json'),
    read('../config/performance-budgets.json'),
  ]);
  assert.match(eslint, /src\/lib\/\*\*\/\*\.\{js,mjs,cjs,jsx\}/);
  assert.match(eslint, /src\/components\/ui\/\*\*\/\*\.\{js,mjs,cjs,jsx\}/);
  assert.match(eslint, /src\/hooks\/\*\*\/\*\.\{js,mjs,cjs,jsx\}/);
  assert.match(eslint, /api\/\*\*\/\*\.\{js,mjs,cjs\}/);
  assert.match(packageJson, /tsc -p \.\/jsconfig\.core\.json/);
  assert.match(packageJson, /"verify:performance"/);
  assert.match(workflow, /npm run verify:performance/);
  assert.match(coreTypes, /"checkJs": true/);
  assert.match(coreTypes, /api\/_buyerInvoiceDates\.js/);
  assert.match(coreTypes, /src\/lib\/paymentDataReliability\.js/);
  assert.match(budget, /"workNotificationsDatabase": 1/);
  assert.match(budget, /"emailRouterForegroundPages": 1/);
});
