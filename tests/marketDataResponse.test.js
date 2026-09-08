import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let fixtureId = 0;

async function loadMarketData(invoke) {
  const key = `__fcosMarketDataFixture${fixtureId++}`;
  globalThis[key] = { functions: { invoke } };
  const source = await readFile(new URL('../src/hedge/api/marketData.js', import.meta.url), 'utf8');
  const fixture = source.replace(
    "import { appClient } from '@/api/appClient';",
    `const appClient = globalThis[${JSON.stringify(key)}];`,
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(fixture).toString('base64')}#${key}`;
  return {
    api: await import(moduleUrl),
    dispose: () => delete globalThis[key],
  };
}

test('market intelligence foreground and background updates expose the same DTO', async () => {
  const foreground = { asOfDate: '2026-09-05', capabilities: { canManageMarketData: true } };
  const background = { asOfDate: '2026-09-06', capabilities: { canManageMarketData: false } };
  const backgroundValues = [];
  let invocation;
  const { api, dispose } = await loadMarketData(async (handler, payload, options) => {
    invocation = { handler, payload, options };
    options.onBackgroundUpdate({ data: { data: background } });
    return { data: { data: foreground } };
  });

  try {
    assert.deepEqual(await api.loadMarketPulseSnapshot({
      asOfDate: '2026-09-05',
      force: false,
      cacheTtlMs: 10,
      onBackgroundUpdate: (value) => backgroundValues.push(value),
    }, {
      force: true,
      cacheTtlMs: 20,
      navigationAware: true,
    }), foreground);
    assert.deepEqual(backgroundValues, [background]);
    assert.equal(invocation.handler, 'marketPulseSnapshot');
    assert.deepEqual(invocation.payload, { asOfDate: '2026-09-05' });
    assert.equal(invocation.options.force, true);
    assert.equal(invocation.options.cacheTtlMs, 20);
    assert.equal(invocation.options.navigationAware, true);
    assert.equal(invocation.options.cache, true);
    assert.deepEqual(invocation.options.cacheTags, ['markets', 'market-pulse']);
  } finally {
    dispose();
  }
});

test('market intelligence retains flat DTO compatibility for foreground and background responses', async () => {
  const foreground = { reportDate: '2026-09-06', cards: [] };
  const background = { reportDate: '2026-09-07', cards: [{ id: 'next' }] };
  const updates = [];
  const { api, dispose } = await loadMarketData(async (_handler, _payload, options) => {
    options.onBackgroundUpdate({ data: background });
    return { data: foreground };
  });

  try {
    assert.deepEqual(await api.loadMarketIntelligenceBrief({}, {
      onBackgroundUpdate: (value) => updates.push(value),
    }), foreground);
    assert.deepEqual(updates, [background]);
  } finally {
    dispose();
  }
});

test('market intelligence preserves foreground errors and ignores error or unknown background envelopes', async () => {
  const validPulse = { asOfDate: '2026-09-06', capabilities: { canManageMarketData: true } };
  const updates = [];
  const { api, dispose } = await loadMarketData(async (_handler, _payload, options) => {
    options.onBackgroundUpdate({ data: { error: 'Background refresh failed.' } });
    options.onBackgroundUpdate({ data: { data: { error: 'Nested background failure.' } } });
    options.onBackgroundUpdate({ data: null });
    options.onBackgroundUpdate({ unexpected: validPulse });
    options.onBackgroundUpdate({ data: { data: validPulse } });
    return { data: { error: 'Foreground failure.' } };
  });

  try {
    await assert.rejects(
      () => api.loadMarketPulseSnapshot({ onBackgroundUpdate: (value) => updates.push(value) }),
      /Foreground failure\./,
    );
    assert.deepEqual(updates, [validPulse]);
  } finally {
    dispose();
  }
});
