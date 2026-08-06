import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requestTelemetryStorage = new AsyncLocalStorage();

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSforceLimitInfo(value) {
  const match = String(value || '').match(/(?:^|[,;]\s*)api-usage=(\d+)\/(\d+)/i);
  if (!match) return null;
  const used = Number(match[1]);
  const max = Number(match[2]);
  return {
    used,
    max,
    remaining: Math.max(0, max - used),
    usedPct: max > 0 ? (used / max) * 100 : null,
  };
}

export function salesforceLimitFromBody(body = {}) {
  const daily = body?.DailyApiRequests;
  const max = numeric(daily?.Max);
  const remaining = numeric(daily?.Remaining);
  if (max == null || remaining == null) return null;
  const used = Math.max(0, max - remaining);
  return {
    used,
    max,
    remaining,
    usedPct: max > 0 ? (used / max) * 100 : null,
  };
}

function initialTelemetry({ handler, requestId } = {}) {
  return {
    requestId: requestId || randomUUID(),
    handler: String(handler || 'unknown'),
    startedAtMs: Date.now(),
    salesforce: {
      quotaCalls: 0,
      logicalQueries: 0,
      compositeCalls: 0,
      rows: 0,
      durationMs: 0,
      limit: null,
    },
    supabase: {
      requests: 0,
      durationMs: 0,
      failures: 0,
    },
    cache: {
      hits: 0,
      misses: 0,
      bypasses: 0,
      errors: 0,
      oversized: 0,
      status: 'BYPASS',
      fetchedAt: null,
      writeAllowed: true,
      skipReason: null,
    },
    emailRouter: {
      operation: null,
      durationMs: 0,
      graphMs: 0,
      storageMs: 0,
      continuedInBackground: false,
    },
    error: null,
  };
}

export function runWithRequestTelemetry(options, run) {
  return requestTelemetryStorage.run(initialTelemetry(options), run);
}

export function currentRequestTelemetry() {
  return requestTelemetryStorage.getStore() || null;
}

export function requestIdFrom(req) {
  const incoming = req?.headers?.['x-request-id'] || req?.headers?.['x-vercel-id'];
  return String(incoming || '').trim().slice(0, 160) || randomUUID();
}

export function recordSalesforceCall({
  durationMs = 0,
  rows = 0,
  logicalQueries = 0,
  composite = false,
  limit = null,
} = {}) {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return;
  telemetry.salesforce.quotaCalls += 1;
  telemetry.salesforce.logicalQueries += Math.max(0, Number(logicalQueries) || 0);
  telemetry.salesforce.compositeCalls += composite ? 1 : 0;
  telemetry.salesforce.rows += Math.max(0, Number(rows) || 0);
  telemetry.salesforce.durationMs += Math.max(0, Number(durationMs) || 0);
  if (limit) telemetry.salesforce.limit = limit;
}

export function recordSalesforceLimit(limit) {
  const telemetry = currentRequestTelemetry();
  if (telemetry && limit) telemetry.salesforce.limit = limit;
}

export function recordSupabaseRequest({ durationMs = 0, ok = true } = {}) {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return;
  telemetry.supabase.requests += 1;
  telemetry.supabase.durationMs += Math.max(0, Number(durationMs) || 0);
  if (!ok) telemetry.supabase.failures += 1;
}

export function recordEmailRouterOperation({ operation, totalMs = 0, graphMs = 0, storageMs = 0, continuedInBackground = false } = {}) {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return;
  telemetry.emailRouter = {
    operation: String(operation || 'unknown').replaceAll(/[^a-z0-9_.-]/gi, '_').slice(0, 80),
    durationMs: Math.max(0, Number(totalMs) || 0),
    graphMs: Math.max(0, Number(graphMs) || 0),
    storageMs: Math.max(0, Number(storageMs) || 0),
    continuedInBackground: continuedInBackground === true,
  };
}

export function recordCacheEvent(status, fetchedAt = null) {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return;
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'hit') telemetry.cache.hits += 1;
  else if (normalized === 'miss') telemetry.cache.misses += 1;
  else if (normalized === 'error') telemetry.cache.errors += 1;
  else if (normalized === 'oversize') telemetry.cache.oversized += 1;
  else telemetry.cache.bypasses += 1;
  telemetry.cache.status = normalized === 'hit'
    ? 'HIT'
    : normalized === 'miss'
      ? 'MISS'
      : normalized === 'error'
        ? 'ERROR'
        : normalized === 'oversize'
          ? 'OVERSIZE'
          : 'BYPASS';
  if (fetchedAt) telemetry.cache.fetchedAt = fetchedAt;
}

export function markRuntimeCacheUnsafe(reason = 'upstream_error') {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return;
  telemetry.cache.writeAllowed = false;
  telemetry.cache.skipReason = String(reason || 'upstream_error').slice(0, 80);
}

export function runtimeCacheWriteAllowed() {
  return currentRequestTelemetry()?.cache.writeAllowed !== false;
}

function redactTelemetryText(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/g, '[salesforce-id]')
    .slice(0, 500);
}

export function recordRequestFailure(error, status = 500) {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return;
  telemetry.error = {
    status: Number(status) || 500,
    name: redactTelemetryText(error?.name || 'Error'),
    code: redactTelemetryText(error?.code || ''),
    message: redactTelemetryText(error?.message || 'Request failed'),
  };
}

export function telemetryResponseHeaders() {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return {};
  return {
    'x-fcos-request-id': telemetry.requestId,
    'x-fcos-cache': telemetry.cache.status,
    'x-fcos-data-fetched-at': telemetry.cache.fetchedAt || new Date().toISOString(),
    'x-fcos-salesforce-calls': String(telemetry.salesforce.quotaCalls),
  };
}

export function requestTelemetrySummary(status = 200) {
  const telemetry = currentRequestTelemetry();
  if (!telemetry) return null;
  return {
    event: 'fcos.api.request',
    requestId: telemetry.requestId,
    handler: telemetry.handler,
    status: Number(status) || 500,
    durationMs: Date.now() - telemetry.startedAtMs,
    salesforceQuotaCalls: telemetry.salesforce.quotaCalls,
    salesforceLogicalQueries: telemetry.salesforce.logicalQueries,
    salesforceCompositeCalls: telemetry.salesforce.compositeCalls,
    salesforceRows: telemetry.salesforce.rows,
    salesforceDurationMs: Math.round(telemetry.salesforce.durationMs),
    salesforceApiUsed: telemetry.salesforce.limit?.used ?? null,
    salesforceApiMax: telemetry.salesforce.limit?.max ?? null,
    cacheHits: telemetry.cache.hits,
    cacheMisses: telemetry.cache.misses,
    cacheBypasses: telemetry.cache.bypasses,
    cacheErrors: telemetry.cache.errors,
    cacheOversized: telemetry.cache.oversized,
    cacheSkipReason: telemetry.cache.skipReason,
    supabaseRequests: telemetry.supabase.requests,
    supabaseFailures: telemetry.supabase.failures,
    supabaseDurationMs: Math.round(telemetry.supabase.durationMs),
    emailRouterOperation: telemetry.emailRouter.operation,
    emailRouterDurationMs: Math.round(telemetry.emailRouter.durationMs),
    emailRouterGraphMs: Math.round(telemetry.emailRouter.graphMs),
    emailRouterStorageMs: Math.round(telemetry.emailRouter.storageMs),
    emailRouterBackground: telemetry.emailRouter.continuedInBackground,
    errorName: telemetry.error?.name || null,
    errorCode: telemetry.error?.code || null,
    errorMessage: telemetry.error?.message || null,
  };
}

export function logRequestTelemetry(status = 200) {
  const summary = requestTelemetrySummary(status);
  if (!summary) return;
  const message = JSON.stringify(summary);
  if (summary.status >= 500) console.error(message);
  else if (summary.status >= 400) console.warn(message);
  else console.log(message);
}
