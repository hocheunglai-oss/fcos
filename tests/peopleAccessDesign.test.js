import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('People & Access uses a clear people and permission-group workspace', async () => {
  const source = await read('src/pages/AdminControl.jsx');

  assert.match(source, /Access overview/);
  assert.match(source, /aria-labelledby="people-panel-title"/);
  assert.match(source, /aria-labelledby="permission-groups-title"/);
  assert.match(source, /xl:grid-cols-\[minmax\(310px,0\.8fr\)_minmax\(0,1\.45fr\)\]/);
  assert.match(source, /People are managed in FCUNO/);
  assert.match(source, /Open FCUNO Users/);
  assert.match(source, /ReadOnlyPermissionGrid/);
  assert.match(source, /Edit permissions/);
  assert.doesNotMatch(source, /activeSection === 'users'|activeSection === 'types'/);
});

test('access editors use explicit choices while preserving existing save handlers', async () => {
  const source = await read('src/pages/AdminControl.jsx');

  assert.match(source, /No access/);
  assert.match(source, /Not allowed/);
  assert.match(source, /Permission group/);
  assert.match(source, /Custom access/);
  assert.match(source, /appClient\.functions\.invoke\('adminUserSave'/);
  assert.match(source, /appClient\.functions\.invoke\('adminUserTypeSave'/);
  assert.match(source, /<ReportingLinesPanel \/>/);
});
