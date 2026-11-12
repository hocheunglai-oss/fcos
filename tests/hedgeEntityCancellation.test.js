import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/hedge/api/entities.js', import.meta.url), 'utf8');

async function loadClient(invoke) {
  const key = Symbol.for('fcos.test.hedgeEntityInvoke');
  globalThis[key] = invoke;
  try {
    const fixture = source.replace(
      "import { appClient } from '@/api/appClient';",
      "const appClient = { functions: { invoke: globalThis[Symbol.for('fcos.test.hedgeEntityInvoke')] } };",
    );
    return await import(`data:text/javascript,${encodeURIComponent(fixture + '\n// ' + crypto.randomUUID())}`);
  } finally {
    delete globalThis[key];
  }
}

test('a cancelled settings update rejects instead of returning an empty success', async () => {
  const { AppConfig } = await loadClient(async () => ({ data: { cancelled: true } }));
  await assert.rejects(AppConfig.update('settings', {}), { name: 'AbortError' });
});

test('an account change keeps the existing refresh instruction', async () => {
  const { loadDeskSnapshot } = await loadClient(async () => ({
    data: { error: 'Your account changed. Refresh this view.' },
    meta: { cancelled: true },
  }));
  await assert.rejects(loadDeskSnapshot(), {
    name: 'AbortError',
    message: 'Your account changed. Refresh this view.',
  });
});

test('only successful background snapshots reach the consumer', async () => {
  const saved = { physicals: [], swaps: [] };
  const refreshed = { physicals: [{ id: 'p1' }], swaps: [] };
  const updates = [];
  const { loadDeskSnapshot } = await loadClient(async (_name, _payload, options) => {
    options.onBackgroundUpdate({ data: { cancelled: true, data: saved } });
    options.onBackgroundUpdate({ data: { data: saved }, meta: { cancelled: true } });
    options.onBackgroundUpdate({ data: { error: 'Request failed' } });
    options.onBackgroundUpdate({ data: {} });
    options.onBackgroundUpdate({ data: { data: refreshed } });
    return { data: { data: saved } };
  });
  assert.equal(await loadDeskSnapshot({ onBackgroundUpdate: (data) => updates.push(data) }), saved);
  assert.deepEqual(updates, [refreshed]);
});

test('a delete acknowledgement succeeds and a missing acknowledgement rejects', async () => {
  let result = { data: { data: true } };
  const { AppConfig } = await loadClient(async () => result);
  assert.equal(await AppConfig.delete('settings'), true);
  result = { data: {} };
  await assert.rejects(AppConfig.delete('settings'), /Refresh the saved result before retrying/);
});
