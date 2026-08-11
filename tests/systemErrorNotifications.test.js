import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  reportSystemError,
  resolveRecoveredSystemErrorHandler,
  shouldNotifySystemError,
  shouldRecordSystemErrorEnvironment,
  systemErrorDedupeKey,
  systemErrorPublicDescriptor,
  validSystemErrorSignature,
} from '../api/_systemErrorNotifications.js';

const migrationUrl = new URL('../supabase/migrations/20260804113709_system_error_notifications.sql', import.meta.url);
const handlerUrl = new URL('../api/functions/[name].js', import.meta.url);
const notificationsUrl = new URL('../api/_workNotifications.js', import.meta.url);
const notificationUiUrl = new URL('../src/components/WorkNotifications.jsx', import.meta.url);

function functionSource(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const opening = source.indexOf('{', source.indexOf(') {', start));
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not read ${name}`);
}

test('only unexpected server failures create global error notifications', () => {
  assert.equal(shouldNotifySystemError(400), false);
  assert.equal(shouldNotifySystemError(409), false);
  assert.equal(shouldNotifySystemError(500), true);
  assert.equal(shouldNotifySystemError(503), true);
  assert.equal(shouldRecordSystemErrorEnvironment({ VERCEL_ENV: 'production' }), true);
  assert.equal(shouldRecordSystemErrorEnvironment({ VERCEL_ENV: 'preview' }), false);
  assert.equal(shouldRecordSystemErrorEnvironment({ VERCEL_ENV: 'development' }), false);
  assert.equal(shouldRecordSystemErrorEnvironment({ FCOS_ALLOW_NONPRODUCTION_SYSTEM_ERROR_NOTIFICATIONS: '1' }), true);
});

test('system errors are redacted, friendly, and keyed by a stable incident signature', async () => {
  const error = new ReferenceError('client is not defined for vincent@example.com on 0012x00000LGhzUAAT with sk_secret-value');
  const occurredAt = new Date('2026-08-04T03:30:00.000Z');
  const first = systemErrorDedupeKey({ handler: 'outstandingBuyerInvoicesEmailReport', error, status: 500, occurredAt });
  const repeated = systemErrorDedupeKey({ handler: 'outstandingBuyerInvoicesEmailReport', error, status: 500, occurredAt: new Date('2026-08-04T03:35:00.000Z') });
  const later = systemErrorDedupeKey({ handler: 'outstandingBuyerInvoicesEmailReport', error, status: 500, occurredAt: new Date('2026-08-04T03:41:00.000Z') });
  assert.equal(first, repeated);
  assert.equal(first, later);

  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: 'event-id', error: null };
    },
  };
  const result = await reportSystemError(client, {
    handler: 'outstandingBuyerInvoicesEmailReport',
    error,
    status: 500,
    requestId: 'request-123',
    occurredAt,
    environment: { VERCEL_ENV: 'production' },
  });
  assert.deepEqual(result, { recorded: true, eventId: 'event-id' });
  assert.equal(calls[0].name, 'record_system_error_event');
  const serialized = JSON.stringify(calls[0].payload);
  assert.doesNotMatch(serialized, /vincent@example\.com|0012x00000LGhzUAAT|sk_secret-value|client is not defined/i);
  assert.match(calls[0].payload.p_title, /Outstanding buyer invoices report failed/);
});

test('development failures cannot create production notification rows', async () => {
  let called = false;
  const result = await reportSystemError({ rpc: async () => { called = true; } }, {
    handler: 'specialTermsWorkspace',
    error: new Error('development failure'),
    status: 503,
    environment: { VERCEL_ENV: 'development' },
  });
  assert.deepEqual(result, { recorded: false, skipped: true, reason: 'non-production' });
  assert.equal(called, false);
});

test('system incident signatures include controlled bootstrap records', () => {
  assert.equal(validSystemErrorSignature('a'.repeat(64)), true);
  assert.equal(validSystemErrorSignature('bootstrap:outstanding-buyer-invoices:last-error'), true);
  assert.equal(validSystemErrorSignature('bootstrap:../../unsafe'), false);
  assert.equal(validSystemErrorSignature('not-an-incident'), false);
});

test('unknown handlers receive a safe generic notification', () => {
  const descriptor = systemErrorPublicDescriptor('newSecretWorkflow');
  assert.equal(descriptor.title, 'FCOS operation failed');
  assert.match(descriptor.message, /new Secret Workflow/);
  assert.equal(descriptor.link, '/');
});

test('a recovered handler resolves only incidents seen before the successful run began', async () => {
  const observed = {};
  const client = {
    from(table) {
      if (table === 'system_error_events') {
        return {
          select() { return this; },
          eq(column, value) { observed.handler = { column, value }; return this; },
          lte(column, value) {
            observed.cutoff = { column, value };
            return this;
          },
          async gte(column, value) {
            observed.earliest = { column, value };
            return { data: [{ id: 'event-1' }], error: null };
          },
        };
      }
      if (table === 'user_profiles') {
        return {
          select() { return this; },
          async eq() { return { data: [{ id: 'profile-1' }], error: null }; },
        };
      }
      if (table === 'system_error_notification_states') {
        return {
          select() { return this; },
          in(column, value) {
            observed.stateFilters ||= [];
            observed.stateFilters.push({ column, value });
            if (observed.stateFilters.length === 2) return Promise.resolve({ data: [], error: null });
            return this;
          },
          async upsert(rows, options) {
            observed.rows = rows;
            observed.options = options;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const startedAt = new Date('2026-08-11T11:00:00.000Z');
  const seenSince = new Date('2026-08-11T10:45:00.000Z');
  const resolvedAt = new Date('2026-08-11T11:00:05.000Z');
  const result = await resolveRecoveredSystemErrorHandler(client, 'emailRouterMaintenanceCron', { resolvedThrough: startedAt, seenSince, resolvedAt });
  assert.deepEqual(result, { resolved: 1 });
  assert.deepEqual(observed.handler, { column: 'handler', value: 'emailRouterMaintenanceCron' });
  assert.deepEqual(observed.cutoff, { column: 'last_seen_at', value: startedAt.toISOString() });
  assert.deepEqual(observed.earliest, { column: 'last_seen_at', value: seenSince.toISOString() });
  assert.equal(observed.rows[0].handled_at, resolvedAt.toISOString());
  assert.deepEqual(observed.options, { onConflict: 'event_id,user_id' });
});

test('system error storage is service-only and integrated into unified notifications', async () => {
  const [migration, notifications, notificationUi] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(notificationsUrl, 'utf8'),
    readFile(notificationUiUrl, 'utf8'),
  ]);
  for (const table of ['system_error_events', 'system_error_notification_states']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`, 'i'));
  }
  assert.match(migration, /security invoker/i);
  assert.match(migration, /on conflict \(dedupe_key\) do update/i);
  assert.match(notifications, /system_error_notification_states/);
  assert.match(notifications, /incidentSignature: row\.dedupe_key/);
  assert.match(notifications, /verificationAvailable/);
  assert.match(notifications, /specialTermsWorkspace/);
  assert.match(notifications, /emailRouterMaintenanceCron/);
  assert.match(notifications, /source: 'system_error'/);
  assert.match(notifications, /diagnosticRef: row\.last_request_id/);
  assert.match(notifications, /outcome: 'Completion not confirmed'/);
  assert.match(notifications, /retryAvailable: Boolean\(row\.link\)/);
  assert.match(notifications, /Review affected workspace before retrying/);
  assert.match(notificationUi, /Diagnostic reference:/);
  assert.match(notificationUi, /Save outcome:/);
  assert.match(notificationUi, /Open Error Centre/);
  assert.match(notificationUi, /notification\.actionLabel/);
  assert.match(notificationUi, /systemErrorVerify/);
  const handler = await readFile(handlerUrl, 'utf8');
  const systemErrors = await readFile(new URL('../api/_systemErrorNotifications.js', import.meta.url), 'utf8');
  assert.match(handler, /resolveRecoveredSystemErrorHandler/);
  assert.match(systemErrors, /resolveSystemErrorIncident/);
  assert.match(systemErrors, /\.eq\('dedupe_key', dedupeKey\)/);
  assert.match(handler, /async function systemErrorVerify/);
  assert.match(handler, /case 'specialTermsWorkspace'/);
  assert.match(handler, /case 'hedgeDeskSalesforceMapping'/);
  assert.match(handler, /case 'emailRouterMaintenanceCron'/);
  assert.match(handler, /EMAIL_ROUTER_SYNCHRONIZATION_STALE/);
  assert.match(handler, /expectedFolders = \['inbox', 'sentitems', 'archive'\]/);
  assert.match(handler, /case 'salesforceQuery'/);
  assert.match(handler, /resolveSystemErrorIncident\(context\.client, incidentSignature\)/);
  assert.match(handler, /resolveRecoveredSystemErrorHandler\(client, 'emailRouterMaintenanceCron', \{/);
});

test('all Graph report and reminder handlers pass an explicit database client', async () => {
  const source = await readFile(handlerUrl, 'utf8');
  const incoming = functionSource(source, 'incomingPaymentEmailReport');
  const reminder = functionSource(source, 'buyerInvoicePaymentReminderSend');
  const outstanding = functionSource(source, 'outstandingBuyerInvoicesEmailReport');
  assert.match(incoming, /const activeAccess = accessContext \|\| \(await requireActiveUser\(req\)\)/);
  assert.match(incoming, /client: activeAccess\.client, purposeKey: 'incoming_payment_reports'/);
  assert.match(reminder, /client: activeAccess\.client, purposeKey: 'payment_reminders'/);
  assert.match(outstanding, /const deliveryClient = activeAccess\?\.client \|\| safeSupabaseAdminClient\(\)/);
  assert.match(outstanding, /client: deliveryClient, purposeKey: 'outstanding_invoice_reports'/);
});
