import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { canRenderCiWorkspace } from '../src/lib/readOnlyCiRoutes.js';

const ci = { read_only_ci: true };
const denied = ['/my-commitments', '/growth-coaching', '/projects-tasks', '/fcos-improvements', '/settings',
  '/payment-collections', '/email-router', '/special-terms', '/admin', '/master-contracts', '/xero-portal', '/unknown'];

test('CI workspaces are positive-allowlisted, including all five formerly ungated routes', () => {
  for (const path of ['/', '/markets', '/markets/', '/accounts/001123456789012', '/accounts/001123456789012AAA']) {
    assert.equal(canRenderCiWorkspace(ci, path), true, path);
  }
  for (const path of [...denied, '/markets/../settings', '/markets-other', '/accounts/invalid/settings']) {
    assert.equal(canRenderCiWorkspace(ci, path), false, path);
  }
});

test('CI presentation gate does not change ordinary user routes or existing permission decisions', () => {
  for (const user of [null, {}, { read_only_ci: false }, { user_type: 'viewer' }, { user_type: 'admin' }]) {
    for (const path of denied) assert.equal(canRenderCiWorkspace(user, path), true);
  }
});

test('the shared Outlet is guarded before any restricted workspace is mounted', async () => {
  const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /canRenderCiWorkspace\(user, location\.pathname\) \? <Outlet \/> : <AccessDenied \/>/);
  assert.equal((layout.match(/<Outlet\b/g) || []).length, 1);
  const smoke = await readFile(new URL('../e2e/workspace-smoke.spec.js', import.meta.url), 'utf8');
  for (const route of denied.slice(0, 5)) assert.ok(smoke.includes(`'${route}'`));
  assert.match(smoke, /name: \/\^Access denied\$\/i/);
});
