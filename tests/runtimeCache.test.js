import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_CACHE_MAX_BYTES,
  buildRuntimeCacheKey,
  createMemoryRuntimeCacheAdapter,
  createVercelRuntimeCacheAdapter,
  expireRuntimeCacheTags,
  getOrLoadRuntimeCache,
  normalizeRuntimeCacheTags,
  normalizeRuntimeCacheValue,
  resetRuntimeCacheForTests,
  stableRuntimeCacheJson,
} from '../api/_runtimeCache.js';

test.beforeEach(() => resetRuntimeCacheForTests());

test('normalizes payloads and includes all cache identity dimensions in a stable key', () => {
  assert.deepEqual(normalizeRuntimeCacheValue({ z: undefined, b: 2, a: { d: 4, c: 3 } }), {
    a: { c: 3, d: 4 },
    b: 2,
  });
  assert.equal(stableRuntimeCacheJson({ b: 2, a: 1 }), stableRuntimeCacheJson({ a: 1, b: 2 }));

  const base = {
    namespace: 'buyer-invoices', version: '2', accessScope: 'standard', apiVersion: 'v60.0', payload: { b: 2, a: 1 },
  };
  assert.equal(buildRuntimeCacheKey(base), buildRuntimeCacheKey({ ...base, payload: { a: 1, b: 2 } }));
  assert.notEqual(buildRuntimeCacheKey(base), buildRuntimeCacheKey({ ...base, accessScope: 'interoffice' }));
  assert.notEqual(buildRuntimeCacheKey(base), buildRuntimeCacheKey({ ...base, apiVersion: 'v61.0' }));
  assert.notEqual(buildRuntimeCacheKey(base), buildRuntimeCacheKey({ ...base, payload: { a: 2, b: 2 } }));
});

test('returns a cache hit until TTL expiry', async () => {
  const cache = createMemoryRuntimeCacheAdapter();
  let time = 1_000;
  let loads = 0;
  const options = {
    namespace: 'dashboard', ttlSeconds: 60, cacheAdapter: cache, now: () => time,
    loader: async () => ({ sequence: ++loads }),
  };

  const first = await getOrLoadRuntimeCache(options);
  const second = await getOrLoadRuntimeCache(options);
  time += 60_001;
  const third = await getOrLoadRuntimeCache(options);

  assert.equal(first.cache.status, 'miss');
  assert.equal(second.cache.status, 'hit');
  assert.equal(third.cache.status, 'miss');
  assert.equal(loads, 2);
});

test('force bypass refreshes the value and marks the response as bypass', async () => {
  const cache = createMemoryRuntimeCacheAdapter();
  let loads = 0;
  const options = { namespace: 'dashboard', ttlSeconds: 60, cacheAdapter: cache, loader: async () => ++loads };

  await getOrLoadRuntimeCache(options);
  const forced = await getOrLoadRuntimeCache({ ...options, force: true });
  const afterForce = await getOrLoadRuntimeCache(options);

  assert.equal(forced.value, 2);
  assert.equal(forced.cache.status, 'bypass');
  assert.equal(afterForce.value, 2);
  assert.equal(afterForce.cache.status, 'hit');
});

test('force bypass does not join an in-flight cached load', async () => {
  const cache = createMemoryRuntimeCacheAdapter();
  let release;
  let markStarted;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  let loads = 0;
  const options = {
    namespace: 'dashboard',
    ttlSeconds: 60,
    cacheAdapter: cache,
    loader: async () => {
      loads += 1;
      const sequence = loads;
      if (sequence === 1) {
        markStarted();
        await pending;
      }
      return sequence;
    },
  };

  const cold = getOrLoadRuntimeCache(options);
  await started;
  const forced = await getOrLoadRuntimeCache({ ...options, force: true });
  release();
  await cold;
  const afterForce = await getOrLoadRuntimeCache(options);

  assert.equal(forced.value, 2);
  assert.equal(forced.cache.status, 'bypass');
  assert.equal(afterForce.value, 2);
  assert.equal(afterForce.cache.status, 'hit');
  assert.equal(loads, 2);
});

test('deduplicates concurrent local loads for the same cache key', async () => {
  const cache = createMemoryRuntimeCacheAdapter();
  let loads = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const options = {
    namespace: 'queue', ttlSeconds: 30, cacheAdapter: cache,
    loader: async () => { loads += 1; await pending; return 'loaded'; },
  };
  const first = getOrLoadRuntimeCache(options);
  const second = getOrLoadRuntimeCache(options);
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(loads, 1);
  assert.equal(a.value, 'loaded');
  assert.equal(b.value, 'loaded');
});

test('does not cache oversized values or loader errors', async () => {
  const cache = createMemoryRuntimeCacheAdapter();
  let loads = 0;
  const oversized = 'x'.repeat(RUNTIME_CACHE_MAX_BYTES);
  const options = { namespace: 'large', ttlSeconds: 60, cacheAdapter: cache, loader: async () => ({ oversized, n: ++loads }) };

  const first = await getOrLoadRuntimeCache(options);
  const second = await getOrLoadRuntimeCache(options);
  assert.equal(first.cache.status, 'oversize');
  assert.equal(second.cache.status, 'oversize');
  assert.equal(loads, 2);

  let failingLoads = 0;
  await assert.rejects(() => getOrLoadRuntimeCache({
    namespace: 'failure', ttlSeconds: 60, cacheAdapter: cache,
    loader: async () => { failingLoads += 1; throw new Error('Salesforce unavailable'); },
  }), /Salesforce unavailable/);
  const recovered = await getOrLoadRuntimeCache({
    namespace: 'failure', ttlSeconds: 60, cacheAdapter: cache,
    loader: async () => { failingLoads += 1; return 'recovered'; },
  });
  assert.equal(recovered.cache.status, 'miss');
  assert.equal(failingLoads, 2);
});

test('fails open when cache reads or writes fail and returns cache metadata', async () => {
  const brokenCache = {
    async get() { throw new Error('cache unavailable'); },
    async set() { throw new Error('cache unavailable'); },
  };
  const result = await getOrLoadRuntimeCache({
    namespace: 'health', ttlSeconds: 60, cacheAdapter: brokenCache, loader: async () => 'live',
  });
  assert.equal(result.value, 'live');
  assert.equal(result.cache.status, 'error');
  assert.match(result.cache.error, /cache unavailable/);
});

test('adapts the documented Vercel getCache interface without importing Vercel', async () => {
  const calls = [];
  const adapter = createVercelRuntimeCacheAdapter({
    getCache() {
      calls.push('getCache');
      return {
        async get(key) { calls.push(['get', key]); return null; },
        async set(key, value, options) { calls.push(['set', key, value, options]); },
        async expireTag(tags) { calls.push(['expireTag', tags]); },
      };
    },
  });
  await adapter.get('key');
  await adapter.set('key', { value: 1 }, { ttlSeconds: 60, tags: ['stem:1'] });
  await adapter.expireTags(['stem:1']);

  assert.equal(calls.filter((call) => call === 'getCache').length, 1);
  assert.deepEqual(calls.at(-2), ['set', 'key', { value: 1 }, { ttl: 60, tags: ['stem:1'] }]);
  assert.deepEqual(calls.at(-1), ['expireTag', ['stem:1']]);
});

test('expires entries by normalized tags', async () => {
  const cache = createMemoryRuntimeCacheAdapter();
  assert.deepEqual(normalizeRuntimeCacheTags([' stem:1 ', 'account:2', 'stem:1', '']), ['account:2', 'stem:1']);
  let loads = 0;
  const load = (namespace, tags) => getOrLoadRuntimeCache({
    namespace, ttlSeconds: 60, tags, cacheAdapter: cache, loader: async () => ++loads,
  });
  await load('stem-one', ['stem:1']);
  await load('stem-two', ['stem:2']);

  assert.deepEqual(await expireRuntimeCacheTags(['stem:1'], { cacheAdapter: cache }), {
    status: 'expired', tags: ['stem:1'],
  });
  const expired = await load('stem-one', ['stem:1']);
  const retained = await load('stem-two', ['stem:2']);
  assert.equal(expired.cache.status, 'miss');
  assert.equal(retained.cache.status, 'hit');
});
