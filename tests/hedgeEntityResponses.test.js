import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/hedge/api/entities.js', import.meta.url), 'utf8');
globalThis.__hedgeResponseClient = { functions: { invoke: async () => ({ data: {} }) } };
const { loadDeskSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(source.replace("import { appClient } from '@/api/appClient';", 'const appClient = globalThis.__hedgeResponseClient;')).toString('base64')}`);
test.after(() => { delete globalThis.__hedgeResponseClient; });

test('cancelled or absent entity responses cannot become empty successful snapshots', async () => {
  for (const response of [{ data: { cancelled: true } }, { data: {}, meta: { cancelled: true } }]) {
    __hedgeResponseClient.functions.invoke = async () => response;
    await assert.rejects(loadDeskSnapshot(), { name: 'AbortError' });
  }
  __hedgeResponseClient.functions.invoke = async () => ({ data: {} });
  await assert.rejects(loadDeskSnapshot(), /saved result/);
});

test('background cancellation/errors do not erase a valid snapshot', async () => {
  const updates = [];
  __hedgeResponseClient.functions.invoke = async (_name, _body, options) => {
    for (const response of [{ data: { cancelled: true } }, { data: { error: 'unavailable' } }, { data: {} }, { data: { data: { physicals: [{ id: 'fresh' }] } } }]) options.onBackgroundUpdate(response);
    return { data: { data: { physicals: [{ id: 'cached' }] } } };
  };
  const snapshot = await loadDeskSnapshot({ onBackgroundUpdate: (value) => updates.push(value) });
  assert.equal(snapshot.physicals[0].id, 'cached');
  assert.deepEqual(updates, [{ physicals: [{ id: 'fresh' }] }]);
});
