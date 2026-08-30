import { createHash } from 'node:crypto';
import {
  currentRequestTelemetry,
  recordCacheEvent,
  recordSalesforceCacheHit,
  runtimeCacheWriteAllowed,
} from './_requestTelemetry.js';

export const RUNTIME_CACHE_MAX_BYTES = Math.floor(1.8 * 1024 * 1024);

const localEntries = new Map();
const inFlightLoads = new Map();
const latestLoadTokens = new Map();
let vercelAdapterPromise = null;

function cacheNow(now) {
  return typeof now === 'function' ? Number(now()) : Date.now();
}

function requireNonEmptyString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

/** Return a recursively key-sorted JSON-compatible value for stable cache keys. */
export function normalizeRuntimeCacheValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map((item) => normalizeRuntimeCacheValue(item, seen));
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) throw new TypeError('Runtime cache payload cannot contain circular references');

  seen.add(value);
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) normalized[key] = normalizeRuntimeCacheValue(value[key], seen);
  }
  seen.delete(value);
  return normalized;
}

export function stableRuntimeCacheJson(value) {
  return JSON.stringify(normalizeRuntimeCacheValue(value));
}

export function normalizeRuntimeCacheTags(tags = []) {
  return [...new Set((Array.isArray(tags) ? tags : [tags])
    .map((tag) => String(tag ?? '').trim())
    .filter(Boolean))]
    .sort();
}

export function buildRuntimeCacheKey({
  namespace,
  version = '1',
  accessScope = 'standard',
  apiVersion = 'unknown',
  payload = null,
} = {}) {
  const normalizedNamespace = requireNonEmptyString(namespace, 'namespace');
  const normalizedVersion = requireNonEmptyString(version, 'version');
  const normalizedScope = requireNonEmptyString(accessScope, 'accessScope');
  const normalizedApiVersion = requireNonEmptyString(apiVersion, 'apiVersion');
  const payloadHash = createHash('sha256').update(stableRuntimeCacheJson(payload)).digest('hex');

  return [
    'fcos',
    encodeURIComponent(normalizedNamespace),
    encodeURIComponent(normalizedVersion),
    encodeURIComponent(normalizedScope),
    encodeURIComponent(normalizedApiVersion),
    payloadHash,
  ].join(':');
}

export function runtimeCacheJsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function createMemoryRuntimeCacheAdapter(entries = new Map()) {
  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
    async expireTags(tags) {
      const tagSet = new Set(normalizeRuntimeCacheTags(tags));
      for (const [key, entry] of entries) {
        if (entry?.tags?.some((tag) => tagSet.has(tag))) entries.delete(key);
      }
    },
  };
}

const localAdapter = createMemoryRuntimeCacheAdapter(localEntries);

function isVercelRuntime() {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
}

function bindFirst(target, names) {
  for (const name of names) {
    if (typeof target?.[name] === 'function') return target[name].bind(target);
  }
  return null;
}

export function createVercelRuntimeCacheAdapter(module) {
  if (typeof module?.getCache === 'function') {
    let runtimeCache;
    const getRuntimeCache = () => {
      runtimeCache ||= module.getCache();
      if (!runtimeCache?.get || !runtimeCache?.set) throw new Error('Vercel Runtime Cache is unavailable');
      return runtimeCache;
    };
    return {
      get(key) {
        return getRuntimeCache().get(key);
      },
      set(key, value, { ttlSeconds, tags }) {
        return getRuntimeCache().set(key, value, { ttl: ttlSeconds, tags });
      },
      delete(key) {
        return getRuntimeCache().delete?.(key);
      },
      expireTags(tags) {
        return getRuntimeCache().expireTag?.(tags);
      },
    };
  }

  const candidates = [module?.runtimeCache, module?.cache, module].filter(Boolean);
  for (const candidate of candidates) {
    const get = bindFirst(candidate, ['get', 'getCache']);
    const set = bindFirst(candidate, ['set', 'setCache']);
    if (!get || !set) continue;
    const remove = bindFirst(candidate, ['delete', 'del', 'deleteCache']);
    const expireTag = bindFirst(candidate, ['expireTag', 'revalidateTag', 'invalidateTag']);
    const expireTags = bindFirst(candidate, ['expireTags', 'revalidateTags', 'invalidateTags']);
    return {
      get,
      async set(key, value, { ttlSeconds, tags }) {
        return set(key, value, { ttlSeconds, ttl: ttlSeconds, tags });
      },
      delete: remove,
      async expireTags(tags) {
        if (expireTags) return expireTags(tags);
        if (expireTag) return Promise.all(tags.map((tag) => expireTag(tag)));
        return undefined;
      },
    };
  }
  return null;
}

async function getVercelRuntimeCacheAdapter() {
  if (!isVercelRuntime()) return null;
  if (!vercelAdapterPromise) {
    vercelAdapterPromise = import('@vercel/functions')
      .then(createVercelRuntimeCacheAdapter)
      .catch(() => null);
  }
  return vercelAdapterPromise;
}

async function resolveCacheAdapter(cacheAdapter) {
  if (cacheAdapter) return cacheAdapter;
  return (await getVercelRuntimeCacheAdapter()) || localAdapter;
}

function cacheMetadata(status, key, fetchedAt, ttlSeconds, tags, error = null) {
  return {
    status,
    key,
    fetchedAt: new Date(fetchedAt).toISOString(),
    ttlSeconds,
    tags,
    ...(error ? { error: String(error.message || error) } : {}),
  };
}

function usableEntry(entry, now) {
  return Boolean(entry
    && typeof entry === 'object'
    && Number.isFinite(entry.expiresAt)
    && entry.expiresAt > now
    && Object.hasOwn(entry, 'value'));
}

async function readEntry(adapter, key, now) {
  const entry = await adapter.get(key);
  if (!entry || usableEntry(entry, now)) return entry;
  await adapter.delete?.(key);
  return null;
}

/**
 * Read a cached value or run loader. Loader errors are deliberately propagated and never cached.
 */
export async function getOrLoadRuntimeCache({
  namespace,
  version = '1',
  accessScope = 'standard',
  apiVersion = 'unknown',
  payload = null,
  ttlSeconds,
  tags = [],
  force = false,
  loader,
  cacheAdapter,
  now,
} = {}) {
  if (typeof loader !== 'function') throw new TypeError('loader must be a function');
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl < 0) throw new TypeError('ttlSeconds must be a non-negative number');

  const key = buildRuntimeCacheKey({ namespace, version, accessScope, apiVersion, payload });
  const normalizedTags = normalizeRuntimeCacheTags(tags);
  const adapter = await resolveCacheAdapter(cacheAdapter);
  const start = cacheNow(now);

  if (!force && ttl > 0) {
    try {
      const entry = await readEntry(adapter, key, start);
      if (usableEntry(entry, start)) {
        if (entry.sources?.salesforce === true) {
          recordSalesforceCacheHit(entry.sources.salesforceFetchedAt || entry.fetchedAt);
        }
        const result = {
          value: entry.value,
          cache: cacheMetadata('hit', key, entry.fetchedAt, ttl, normalizedTags),
        };
        recordCacheEvent(result.cache.status, result.cache.fetchedAt);
        return result;
      }
    } catch (error) {
      const result = await loadAndOptionallyCache({
        adapter,
        key,
        ttl,
        tags: normalizedTags,
        loader,
        now,
        status: 'error',
        cacheError: error,
      });
      recordCacheEvent(result.cache.status, result.cache.fetchedAt);
      return result;
    }
  }

  const result = await loadAndOptionallyCache({
    adapter,
    key,
    ttl,
    tags: normalizedTags,
    loader,
    now,
    status: force || ttl === 0 ? 'bypass' : 'miss',
  });
  recordCacheEvent(result.cache.status, result.cache.fetchedAt);
  return result;
}

async function loadAndOptionallyCache({ adapter, key, ttl, tags, loader, now, status, cacheError = null }) {
  const deduplicate = status !== 'bypass';
  if (deduplicate && inFlightLoads.has(key)) {
    const result = await inFlightLoads.get(key);
    if (result.sources?.salesforce === true && currentRequestTelemetry()?.salesforce?.backed !== true) {
      recordSalesforceCacheHit(result.sources.salesforceFetchedAt || result.cache?.fetchedAt);
    }
    return result;
  }
  const loadToken = Symbol(key);
  latestLoadTokens.set(key, loadToken);

  const promise = (async () => {
    const salesforceReadsBefore = currentRequestTelemetry()?.salesforce?.sourceReads || 0;
    const value = await loader();
    const fetchedAt = cacheNow(now);
    const telemetry = currentRequestTelemetry();
    const salesforceBacked = (telemetry?.salesforce?.sourceReads || 0) > salesforceReadsBefore;
    const sources = salesforceBacked ? {
      salesforce: true,
      salesforceFetchedAt: new Date(fetchedAt).toISOString(),
    } : { salesforce: false };
    let finalStatus = status;
    let finalError = cacheError;

    if (ttl > 0 && latestLoadTokens.get(key) === loadToken && !runtimeCacheWriteAllowed()) {
      finalStatus = 'bypass';
      finalError = new Error('Runtime cache write skipped after an upstream partial failure');
    } else if (ttl > 0 && latestLoadTokens.get(key) === loadToken) {
      const entry = { value, fetchedAt, expiresAt: fetchedAt + ttl * 1000, tags, sources };
      try {
        if (runtimeCacheJsonSize(entry) > RUNTIME_CACHE_MAX_BYTES) {
          finalStatus = 'oversize';
        } else {
          await adapter.set(key, entry, { ttlSeconds: ttl, tags });
        }
      } catch (error) {
        finalStatus = 'error';
        finalError = error;
      }
    }

    return {
      value,
      cache: cacheMetadata(finalStatus, key, fetchedAt, ttl, tags, finalError),
      sources,
    };
  })();

  if (deduplicate) inFlightLoads.set(key, promise);
  try {
    return await promise;
  } finally {
    if (deduplicate) inFlightLoads.delete(key);
    if (latestLoadTokens.get(key) === loadToken) latestLoadTokens.delete(key);
  }
}

export async function expireRuntimeCacheTags(tags, { cacheAdapter } = {}) {
  const normalizedTags = normalizeRuntimeCacheTags(tags);
  if (normalizedTags.length === 0) return { status: 'bypass', tags: [] };
  const adapter = await resolveCacheAdapter(cacheAdapter);
  try {
    await adapter.expireTags?.(normalizedTags);
    return { status: 'expired', tags: normalizedTags };
  } catch (error) {
    return { status: 'error', tags: normalizedTags, error: String(error.message || error) };
  }
}

export function resetRuntimeCacheForTests() {
  localEntries.clear();
  inFlightLoads.clear();
  latestLoadTokens.clear();
  vercelAdapterPromise = null;
}
