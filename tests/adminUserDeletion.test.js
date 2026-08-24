import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handlerUrl = new URL('../api/functions/[name].js', import.meta.url);
const portalUrl = new URL('../api/_portal.js', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260824005729_fix_user_deletion_immutable_audit.sql', import.meta.url);

function functionSource(source, startName, endName) {
  const start = source.indexOf(`async function ${startName}`);
  const end = source.indexOf(`async function ${endName}`, start + 1);
  assert.notEqual(start, -1, `${startName} was not found`);
  assert.notEqual(end, -1, `${endName} was not found`);
  return source.slice(start, end);
}

test('Variable Charges audit attribution remains immutable when a user is deleted', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /drop constraint if exists ship_agent_charge_events_actor_user_id_fkey/);
  assert.match(migration, /drop constraint if exists variable_charge_events_actor_user_id_fkey/);
  assert.match(migration, /Immutable historical FCOS actor UUID/);
  assert.doesNotMatch(migration, /update\s+public\.variable_charge_events/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.variable_charge_events/i);
});

test('failed Auth deletion restores an active FCOS profile and records a safe failure', async () => {
  const [handler, portal] = await Promise.all([
    readFile(handlerUrl, 'utf8'),
    readFile(portalUrl, 'utf8'),
  ]);
  const deletion = functionSource(handler, 'adminUserDelete', 'adminPortalAccessSave');

  assert.match(deletion, /try\s*\{[\s\S]*preparePortalUserDeletion[\s\S]*auth\.admin\.deleteUser/);
  assert.match(deletion, /catch \(error\)[\s\S]*restorePortalUserAfterFailedDeletion/);
  assert.match(deletion, /user_delete_failed/);
  assert.match(deletion, /USER_DELETE_RESTORE_FAILED/);
  assert.doesNotMatch(deletion, /message:\s*error\?*\.message/);

  assert.match(portal, /export async function restorePortalUserAfterFailedDeletion/);
  assert.match(portal, /profile\.active !== true/);
  assert.match(portal, /\.eq\('active', false\)/);
  assert.match(portal, /restored: restoredProfile\?\.active === true/);
});
