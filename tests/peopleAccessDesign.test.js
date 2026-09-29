import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('People & Access defaults to searchable group-first inline editing and preserves identity/reporting controls', async () => {
  const source = await read('src/pages/AdminControl.jsx');
  assert.match(source, /useState\('groups'\)/);
  assert.match(source, /aria-labelledby="permission-groups-title"/);
  assert.match(source, /lg:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.match(source, /Show personal legacy groups/);
  assert.match(source, /People are managed in FCUNO/);
  assert.match(source, /Identity is read-only from FCUNO/);
  assert.match(source, /Open FCUNO Users/);
  assert.match(source, /<ReportingLinesPanel \/>/);
  assert.doesNotMatch(source, /setUserModuleAccess|setUseTypeDefaults|adminUserTypeSave/);
});

test('editors use revision-checked groups-only writes, provenance, impact review, and internal switching guard', async () => {
  const source = await read('src/pages/AdminControl.jsx');
  const permissionPanel = await read('src/components/admin/AccessPermissionPanel.jsx');
  assert.match(source, /invoke\('adminUserGroupsSave'/);
  assert.match(source, /invoke\('adminPermissionGroupSave'/);
  assert.match(source, /expectedRevision: personForm.expectedRevision/);
  assert.match(source, /resolveGroupAccess/);
  assert.match(source, /Review group changes/);
  assert.match(source, />Stay</);
  assert.match(source, />Discard</);
  assert.match(source, /notifyAccessChanged\(\)/);
  assert.match(permissionPanel, /Granted by/);
  assert.match(permissionPanel, /Enabled only/);
});
