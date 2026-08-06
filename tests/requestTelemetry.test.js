import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logRequestTelemetry,
  parseSforceLimitInfo,
  recordCacheEvent,
  recordEmailRouterOperation,
  recordRequestFailure,
  recordSalesforceCall,
  recordSupabaseRequest,
  requestIdFrom,
  requestTelemetrySummary,
  runWithRequestTelemetry,
  salesforceLimitFromBody,
  telemetryResponseHeaders,
} from '../api/_requestTelemetry.js';

test('parses Salesforce API usage headers and limits responses', () => {
  assert.deepEqual(parseSforceLimitInfo('api-usage=250/1000'), {
    used: 250,
    max: 1000,
    remaining: 750,
    usedPct: 25,
  });
  assert.equal(parseSforceLimitInfo('per-app-api-usage=1/5'), null);
  assert.deepEqual(salesforceLimitFromBody({
    DailyApiRequests: { Max: 1000, Remaining: 600 },
  }), {
    used: 400,
    max: 1000,
    remaining: 600,
    usedPct: 40,
  });
  assert.equal(salesforceLimitFromBody({}), null);
});

test('builds redacted request summaries and response metadata', async () => {
  await runWithRequestTelemetry({ handler: 'buyerInvoices', requestId: 'request-123' }, async () => {
    recordSalesforceCall({
      durationMs: 18,
      rows: 25,
      logicalQueries: 4,
      composite: true,
      limit: parseSforceLimitInfo('api-usage=250/1000'),
    });
    recordSupabaseRequest({ durationMs: 7, ok: true });
    recordCacheEvent('hit', '2026-07-28T10:00:00.000Z');
    recordRequestFailure(
      new Error('louisa@cosulich.com.hk cannot update 0012x00000LGijuAAD'),
      400,
    );

    assert.deepEqual(telemetryResponseHeaders(), {
      'x-fcos-request-id': 'request-123',
      'x-fcos-cache': 'HIT',
      'x-fcos-data-fetched-at': '2026-07-28T10:00:00.000Z',
      'x-fcos-salesforce-calls': '1',
    });
    const summary = requestTelemetrySummary(400);
    assert.equal(typeof summary.durationMs, 'number');
    assert.deepEqual({ ...summary, durationMs: 0 }, {
      event: 'fcos.api.request',
      requestId: 'request-123',
      handler: 'buyerInvoices',
      status: 400,
      durationMs: 0,
      salesforceQuotaCalls: 1,
      salesforceLogicalQueries: 4,
      salesforceCompositeCalls: 1,
      salesforceRows: 25,
      salesforceDurationMs: 18,
      salesforceApiUsed: 250,
      salesforceApiMax: 1000,
      cacheHits: 1,
      cacheMisses: 0,
      cacheBypasses: 0,
      cacheErrors: 0,
      cacheOversized: 0,
      cacheSkipReason: null,
      supabaseRequests: 1,
      supabaseFailures: 0,
      supabaseDurationMs: 7,
      emailRouterOperation: null,
      emailRouterDurationMs: 0,
      emailRouterGraphMs: 0,
      emailRouterStorageMs: 0,
      emailRouterBackground: false,
      errorName: 'Error',
      errorCode: null,
      errorMessage: '[email] cannot update [salesforce-id]',
    });
  });
});

test('logs expected validation failures as warnings', async () => {
  const originalWarn = console.warn;
  const originalError = console.error;
  const warnings = [];
  const errors = [];
  console.warn = (message) => warnings.push(JSON.parse(message));
  console.error = (message) => errors.push(JSON.parse(message));
  try {
    await runWithRequestTelemetry({ handler: 'validation' }, async () => {
      recordRequestFailure(new Error('Invalid selection'), 422);
      logRequestTelemetry(422);
    });
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].status, 422);
  assert.equal(errors.length, 0);
});

test('records redacted Email Router operation timing without message data', async () => {
  await runWithRequestTelemetry({ handler: 'emailRouterDetail', requestId: 'router-request' }, async () => {
    recordEmailRouterOperation({ operation: 'message_detail', totalMs: 420, graphMs: 300, storageMs: 80, continuedInBackground: false });
    const summary = requestTelemetrySummary(200);
    assert.equal(summary.emailRouterOperation, 'message_detail');
    assert.equal(summary.emailRouterDurationMs, 420);
    assert.equal(summary.emailRouterGraphMs, 300);
    assert.equal(summary.emailRouterStorageMs, 80);
    assert.equal(summary.emailRouterBackground, false);
    assert.equal(JSON.stringify(summary).includes('message-id'), false);
  });
});

test('uses an incoming request identifier without accepting unbounded input', () => {
  assert.equal(requestIdFrom({ headers: { 'x-request-id': ' request-id ' } }), 'request-id');
  assert.equal(requestIdFrom({ headers: { 'x-request-id': 'x'.repeat(300) } }).length, 160);
});
