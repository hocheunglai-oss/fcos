import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('global command palette searches exact Account and GROUP identities without preloading them', async () => {
  const [palette, layout] = await Promise.all([
    readFile(new URL('../src/components/workspace/WorkspaceCommandPalette.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(palette, /query\.trim\(\)\.length < 2/);
  assert.match(palette, /dashboardCounterpartySearch/);
  assert.match(palette, /insightAccountId/);
  assert.match(palette, /insightEntityType/);
  assert.match(palette, /buyerStemCount/);
  assert.match(palette, /supplierStemCount/);
  assert.match(layout, /canSearchCounterparties=\{hasModuleAccess\('dashboard'\)\}/);
});
