import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissingNomBHandlers } from '../api/_missingNomBHandlers.js';

function harness({ client = { id: 'service-client' } } = {}) {
  const calls = [];
  const env = { CRON_SECRET: 'protected-secret', FCOS_ENABLE_MISSING_NOM_B_REMINDERS: 'true' };
  const dependencies = {
    env,
    requireActiveUser: async (req) => { calls.push(['active-user', req]); return { client: { id: 'user-client' }, profile: { id: 'user' } }; },
    requireCronAuthorization: (req) => calls.push(['cron-auth', req]),
    safeSupabaseAdminClient: () => client,
    appError: (message, status) => Object.assign(new Error(message), { status }),
    timedCheck: async (run) => ({ ok: true, details: await run() }),
    healthRow: (base, result) => ({ ...base, result }),
    configuredEnv: (names) => ({ names, configured: true }),
    listService: async (body, context) => { calls.push(['list', body, context]); return { rows: [] }; },
    uploadService: async (body, context) => { calls.push(['upload', body, context]); return { uploaded: true }; },
    reminderService: async (input) => { calls.push(['reminder', input]); return { ok: true, scanned: 1 }; },
    statusService: async (input) => { calls.push(['status', input]); return { activatedAt: '2026-10-01T00:00:00.000Z' }; },
  };
  return { calls, env, handlers: createMissingNomBHandlers(dependencies) };
}

test('Missing Nom B list and upload retain supplied access contexts and authenticate only when absent', async () => {
  const { calls, handlers } = harness();
  const req = { headers: { authorization: 'Bearer session' } };
  const supplied = { client: { id: 'supplied' }, profile: { id: 'supplied-user' } };
  assert.deepEqual(await handlers.missingNomBList({ cursor: 'next' }, req, supplied), { rows: [] });
  assert.deepEqual(await handlers.missingNomBUpload({ operationId: 'operation' }, req), { uploaded: true });
  assert.deepEqual(calls, [
    ['list', { cursor: 'next' }, supplied],
    ['active-user', req],
    ['upload', { operationId: 'operation' }, { client: { id: 'user-client' }, profile: { id: 'user' } }],
  ]);
});

test('Missing Nom B cron preserves protected authorization, service environment, and unavailable-client failure', async () => {
  const { calls, env, handlers } = harness();
  const req = { headers: { authorization: 'Bearer protected-secret' } };
  assert.deepEqual(await handlers.missingNomBReminderCron({}, req), { ok: true, scanned: 1 });
  assert.deepEqual(calls, [
    ['cron-auth', req],
    ['reminder', { client: { id: 'service-client' }, env }],
  ]);

  const unavailable = harness({ client: null });
  await assert.rejects(unavailable.handlers.missingNomBReminderCron({}, req), {
    message: 'FCOS database access is unavailable for Nom B reminders.', status: 503,
  });
  assert.deepEqual(unavailable.calls, [['cron-auth', req]]);
});

test('Missing Nom B System Health row retains status probing and failed-configuration visibility', async () => {
  const ready = harness();
  assert.deepEqual(await ready.handlers.missingNomBHealthRow(), {
    id: 'missing-nom-b', name: 'Missing Nom B', category: 'Operations',
    purpose: 'Buyer-trader filing reminders, invoice scan progress, and verified Nom B uploads.',
    scope: 'server', provider: 'Salesforce / Microsoft Graph', endpoint: '/missing-nom-b',
    authType: 'FCOS session and protected cron', configured: true,
    configuredEnv: { names: ['FCOS_ENABLE_MISSING_NOM_B_REMINDERS'], configured: true },
    notes: ['Checks final buyer invoice PDFs every five minutes after activation.', 'Uncertain delivery and upload outcomes require verification before another write.'],
    result: { ok: true, details: { activatedAt: '2026-10-01T00:00:00.000Z' } },
  });
  assert.deepEqual(ready.calls, [['status', { client: { id: 'service-client' }, env: ready.env }]]);

  const unavailable = harness({ client: null });
  const row = await unavailable.handlers.missingNomBHealthRow();
  assert.equal(row.configured, false);
  assert.equal(row.result, null);
  assert.deepEqual(unavailable.calls, []);
});
