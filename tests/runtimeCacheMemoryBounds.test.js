import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRuntimeCacheAdapter, LOCAL_RUNTIME_CACHE_MAX_BYTES, LOCAL_RUNTIME_CACHE_MAX_ENTRIES, runtimeCacheJsonSize } from '../api/_runtimeCache.js';

test('local fallback bounds distinct query growth without changing retained values', async () => {
  const entries = new Map();
  const cache = createMemoryRuntimeCacheAdapter(entries);
  for (let i = 0; i < 1000; i += 1) await cache.set(String(i), { value: { payload: 'x'.repeat(128 * 1024), index: i }, tags: ['snapshot'] });
  assert.ok(entries.size <= LOCAL_RUNTIME_CACHE_MAX_ENTRIES);
  assert.ok([...entries.values()].reduce((bytes, entry) => bytes + runtimeCacheJsonSize(entry), 0) <= LOCAL_RUNTIME_CACHE_MAX_BYTES);
  assert.equal((await cache.get('999')).value.index, 999);
  assert.equal(await cache.get('0'), null);
});

test('LRU touches, replacing entries and tag expiry release their byte budget', async () => {
  const entries = new Map();
  const cache = createMemoryRuntimeCacheAdapter(entries, { maxEntries: 2, maxBytes: 100 });
  await cache.set('a', { value: 'A', tags: ['first'] });
  await cache.set('b', { value: 'B', tags: ['second'] });
  await cache.get('a');
  await cache.set('c', { value: 'C', tags: ['third'] });
  assert.equal(await cache.get('b'), null);
  await cache.expireTags(['first']);
  await cache.set('d', { value: 'D', tags: [] });
  assert.deepEqual([...entries.keys()], ['c', 'd']);
  await cache.set('d', { value: 'small' });
  await cache.delete('c');
  await cache.set('large', { value: 'x'.repeat(100) });
  assert.equal(await cache.get('large'), null);
  assert.equal((await cache.get('d')).value, 'small');
  cache.clear();
  await cache.set('after-clear', { value: 'reset' });
  assert.deepEqual([...entries.keys()], ['after-clear']);
});

test('byte limit evicts entries before the key count limit', async () => {
  const entries = new Map();
  const cache = createMemoryRuntimeCacheAdapter(entries, { maxEntries: 10, maxBytes: 100 });
  for (let i = 0; i < 5; i += 1) await cache.set(String(i), { value: 'x'.repeat(50) });
  assert.equal(entries.size, 1);
  assert.equal((await cache.get('4')).value.length, 50);
});
