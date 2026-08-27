import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { navigationCacheDecision } from '@/lib/navigationCachePolicy';
import { publishSalesforceFreshness } from '@/lib/salesforceFreshness';

const STORAGE_PREFIX = 'fcos';
const DEFAULT_FUNCTION_CACHE_TTL_MS = 30_000;
const MAX_FUNCTION_CACHE_ENTRIES = 24;
const functionResponseCache = new Map();
const inFlightFunctionRequests = new Map();
let functionCacheGeneration = 0;

const DEDICATED_FUNCTION_ENDPOINTS = Object.freeze({
  emailRouterBackgroundSync: '/api/email-router-background-sync',
  workNotificationsList: '/api/work-notifications',
  workNotificationsRead: '/api/work-notifications',
  workNotificationsState: '/api/work-notifications',
});

function functionEndpoint(name) {
  return DEDICATED_FUNCTION_ENDPOINTS[name] || `/api/functions/${name}`;
}

const storage = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    window.localStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value));
  },
};

function now() {
  return new Date().toISOString();
}

function cloneJson(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function functionCacheKey(name, payload) {
  return `${name}:${stableStringify(payload || {})}`;
}

async function requestAuthContext() {
  if (!isSupabaseConfigured) return { accessToken: null, scope: 'local' };
  const { data } = await supabase.auth.getSession();
  return {
    accessToken: data?.session?.access_token || null,
    scope: data?.session?.user?.id || 'anonymous',
  };
}

function browserCacheResponse(cached, cacheStatus, backgroundRefresh = false) {
  if (cached.meta?.salesforceBacked && cached.meta?.salesforceFetchedAt) {
    publishSalesforceFreshness({ fetchedAt: cached.meta.salesforceFetchedAt, handler: cached.name });
  }
  return {
    data: cloneJson(cached.data),
    meta: {
      ...(cached.meta || {}),
      cached: true,
      cacheLayer: 'browser',
      cacheStatus,
      cachedAt: cached.updatedAt,
      backgroundRefresh,
    },
  };
}

function touchFunctionCache(key, entry) {
  functionResponseCache.delete(key);
  functionResponseCache.set(key, entry);
}

function trimFunctionCache() {
  while (functionResponseCache.size > MAX_FUNCTION_CACHE_ENTRIES) {
    const oldestKey = functionResponseCache.keys().next().value;
    if (!oldestKey) break;
    functionResponseCache.delete(oldestKey);
  }
}

function invalidateFunctionCache({ names = [], tags = [] } = {}) {
  functionCacheGeneration += 1;
  inFlightFunctionRequests.clear();
  const nameSet = new Set(names);
  const tagSet = new Set(tags);
  if (!nameSet.size && !tagSet.size) {
    functionResponseCache.clear();
    return;
  }
  for (const [key, entry] of functionResponseCache.entries()) {
    const nameMatches = nameSet.has(entry.name);
    const tagMatches = (entry.tags || []).some((tag) => tagSet.has(tag));
    if (nameMatches || tagMatches) functionResponseCache.delete(key);
  }
}

function createEntityStore(name) {
  const read = () => storage.get(name, []);
  const write = (records) => storage.set(name, records);

  return {
    async list(sort = '-updated_date', limit = 100) {
      const records = read();
      const desc = sort.startsWith('-');
      const field = desc ? sort.slice(1) : sort;
      return records
        .slice()
        .sort((a, b) => {
          const av = a[field] || '';
          const bv = b[field] || '';
          return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
        })
        .slice(0, limit);
    },
    async filter(criteria = {}) {
      return read().filter((record) =>
        Object.entries(criteria).every(([key, value]) => record[key] === value)
      );
    },
    async create(payload) {
      const record = {
        ...payload,
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        created_date: now(),
        updated_date: now(),
      };
      write([record, ...read()]);
      return record;
    },
    async update(id, payload) {
      let updated = null;
      const records = read().map((record) => {
        if (record.id !== id) return record;
        updated = { ...record, ...payload, updated_date: now() };
        return updated;
      });
      write(records);
      return updated;
    },
    async delete(id) {
      write(read().filter((record) => record.id !== id));
      return true;
    },
  };
}

async function requestFunction(name, payload, options, cacheKey, authContext, cacheGeneration) {
  const headers = { 'content-type': 'application/json' };
  if (DEDICATED_FUNCTION_ENDPOINTS[name]) headers['x-fcos-function-name'] = name;
  if (options.force) headers['x-fcos-cache-bypass'] = '1';
  if (authContext.accessToken) headers.authorization = `Bearer ${authContext.accessToken}`;
  let res;
  try {
    res = await fetch(functionEndpoint(name), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        data: { cancelled: true },
        meta: {
          cached: false,
          cacheLayer: 'network',
          cacheStatus: 'CANCELLED',
          cachedAt: null,
          requestId: null,
          salesforceCalls: null,
          cancelled: true,
        },
      };
    }
    return {
      data: { error: error?.message || 'Network request failed. Check your connection and try again.' },
      meta: {
        cached: false,
        cacheLayer: 'network',
        cacheStatus: 'UNAVAILABLE',
        cachedAt: null,
        requestId: null,
        salesforceCalls: null,
      },
    };
  }
  const responseContentType = res.headers?.get?.('content-type') || '';
  const responseIsJson = responseContentType.toLowerCase().includes('application/json');
  const data = responseIsJson ? await res.json().catch(() => ({})) : {};
  const responseHeader = (name) => res.headers?.get?.(name) || null;
  const serverCacheStatus = responseHeader('x-fcos-cache') || 'BYPASS';
  const serverFetchedAt = responseHeader('x-fcos-data-fetched-at') || now();
  const requestId = responseHeader('x-fcos-request-id');
  const salesforceCallsHeader = responseHeader('x-fcos-salesforce-calls');
  const salesforceCalls = salesforceCallsHeader == null ? null : Number(salesforceCallsHeader);
  const salesforceBacked = responseHeader('x-fcos-salesforce-backed') === '1';
  const salesforceFetchedAt = responseHeader('x-fcos-salesforce-fetched-at');
  const mutationHeader = responseHeader('x-fcos-handler-mutation');

  if (!responseIsJson) {
    return {
      data: { error: 'The FCOS server API is unavailable. Start the full local FCOS runtime and try again.' },
      meta: {
        cached: false,
        cacheLayer: 'network',
        cacheStatus: 'UNAVAILABLE',
        cachedAt: null,
        requestId,
        salesforceCalls: Number.isFinite(salesforceCalls) ? salesforceCalls : null,
      },
    };
  }

  if (!res.ok) {
    if (res.status >= 500) {
      window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
    }
    return {
      data: {
        ...data,
        error: data.error || data.message || `Request failed: ${res.status}`,
      },
      meta: {
        cached: false,
        cacheLayer: 'server',
        cacheStatus: serverCacheStatus,
        cachedAt: serverFetchedAt,
        requestId,
        salesforceCalls: Number.isFinite(salesforceCalls) ? salesforceCalls : null,
      },
    };
  }

  const fetchedAt = serverFetchedAt;
  const responseMeta = {
    cached: serverCacheStatus === 'HIT',
    cacheLayer: 'server',
    cacheStatus: serverCacheStatus,
    cachedAt: fetchedAt,
    requestId,
    salesforceCalls: Number.isFinite(salesforceCalls) ? salesforceCalls : null,
    salesforceBacked,
    salesforceFetchedAt: salesforceBacked ? salesforceFetchedAt || serverFetchedAt : null,
  };
  if (responseMeta.salesforceBacked && responseMeta.salesforceFetchedAt) {
    publishSalesforceFreshness({ fetchedAt: responseMeta.salesforceFetchedAt, handler: name });
  }
  if (cacheKey && cacheGeneration === functionCacheGeneration) {
    functionResponseCache.set(cacheKey, {
      name,
      data: cloneJson(data),
      meta: responseMeta,
      updatedAt: fetchedAt,
      cachedAtMs: Date.now(),
      tags: [...new Set(options.cacheTags || [])],
    });
    trimFunctionCache();
  }

  const shouldInvalidateCache = options.invalidateCache === true
    || (options.invalidateCache !== false && (mutationHeader === '1' || (!cacheKey && mutationHeader !== '0')));
  if (shouldInvalidateCache) invalidateFunctionCache();
  else if (options.invalidateNames?.length || options.invalidateTags?.length) {
    invalidateFunctionCache({ names: options.invalidateNames, tags: options.invalidateTags });
  }

  return {
    data,
    meta: responseMeta,
  };
}

function startFunctionRequest(name, payload, options, cacheKey, authContext) {
  // A caller-owned AbortSignal must never share an in-flight request: aborting
  // that request would otherwise cancel work belonging to another consumer.
  const requestKey = !options.force && !options.signal && cacheKey ? cacheKey : null;
  if (requestKey && inFlightFunctionRequests.has(requestKey)) return inFlightFunctionRequests.get(requestKey);
  const cacheGeneration = functionCacheGeneration;
  const request = requestFunction(name, payload, options, cacheKey, authContext, cacheGeneration);
  if (requestKey) {
    inFlightFunctionRequests.set(requestKey, request);
    const removeRequest = () => {
      if (inFlightFunctionRequests.get(requestKey) === request) inFlightFunctionRequests.delete(requestKey);
    };
    request.then(removeRequest, removeRequest);
  }
  return request;
}

async function invoke(name, payload = {}, options = {}) {
  const authContext = await requestAuthContext();
  const rawCacheKey = options.cacheKey || (options.cache ? functionCacheKey(name, payload) : null);
  const cacheKey = rawCacheKey ? `${authContext.scope}:${rawCacheKey}` : null;
  const cached = cacheKey ? functionResponseCache.get(cacheKey) : null;
  const ttlMs = Math.max(0, Number(options.cacheTtlMs ?? DEFAULT_FUNCTION_CACHE_TTL_MS));
  const decision = navigationCacheDecision({
    hasEntry: Boolean(cached),
    ageMs: cached ? Date.now() - cached.cachedAtMs : 0,
    freshMs: ttlMs,
    maxStaleMs: options.navigationAware ? options.maxStaleMs : ttlMs,
    force: options.force === true,
  });

  if (decision === 'fresh') {
    touchFunctionCache(cacheKey, cached);
    return browserCacheResponse(cached, 'HIT');
  }
  if (decision === 'stale' && options.navigationAware) {
    touchFunctionCache(cacheKey, cached);
    const backgroundRequest = startFunctionRequest(name, payload, { ...options, force: false }, cacheKey, authContext);
    backgroundRequest.then((result) => {
      if (result.data?.error) {
        const fallback = browserCacheResponse(cached, 'STALE_ERROR', false);
        fallback.meta.refreshError = result.data.error;
        options.onBackgroundUpdate?.(fallback);
        return;
      }
      options.onBackgroundUpdate?.(result);
    }).catch((error) => {
      const fallback = browserCacheResponse(cached, 'STALE_ERROR', false);
      fallback.meta.refreshError = error?.message || 'Background refresh failed.';
      options.onBackgroundUpdate?.(fallback);
    });
    return browserCacheResponse(cached, 'STALE', true);
  }
  if (decision === 'expired' && cacheKey) functionResponseCache.delete(cacheKey);
  return startFunctionRequest(name, payload, options, cacheKey, authContext);
}

async function download(name, payload = {}, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (DEDICATED_FUNCTION_ENDPOINTS[name]) headers['x-fcos-function-name'] = name;
  if (options.force) headers['x-fcos-cache-bypass'] = '1';
  const authContext = await requestAuthContext();
  if (authContext.accessToken) headers.authorization = `Bearer ${authContext.accessToken}`;
  const response = await fetch(functionEndpoint(name), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    if (response.status >= 500) window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
    const contentType = response.headers.get('content-type') || '';
    const errorBody = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
    throw new Error(errorBody.error || `Download failed: ${response.status}`);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : quoted || 'download';
  return { blob: await response.blob(), filename };
}

function clearFunctionCache() {
  invalidateFunctionCache();
}

export const appClient = {
  functions: {
    invoke,
    download,
    clearCache: clearFunctionCache,
    invalidateCache: invalidateFunctionCache,
  },
  entities: {
    AppSettings: createEntityStore('app_settings'),
  },
  auth: {
    async me() {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        return data.user;
      }
      return {
        id: 'local-admin',
        full_name: 'Vincent',
        email: 'vincent@cosulich.com.hk',
        role: 'admin',
      };
    },
    async logout() {
      clearFunctionCache();
      if (isSupabaseConfigured) await supabase.auth.signOut();
    },
    redirectToLogin() {},
  },
};
