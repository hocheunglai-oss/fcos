import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { emailRouterBackgroundSyncDue, syncEmailRouterMailboxIfDue } from '../api/_emailRouterCore.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Email Router background cadence is thirty seconds on every FCOS page', async () => {
  const [background, layout, workspace, client] = await Promise.all([
    read('../src/components/email-router/EmailRouterBackgroundSync.jsx'),
    read('../src/components/Layout.jsx'),
    read('../src/components/email-router/EmailRouterWorkspace.jsx'),
    read('../src/lib/emailRouter.js'),
  ]);
  assert.match(background, /EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS = 30_000/);
  assert.match(background, /window\.setInterval\(synchronize, EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS\)/);
  assert.match(background, /document\.visibilityState !== 'visible'/);
  assert.match(background, /new window\.BroadcastChannel\(EMAIL_ROUTER_BACKGROUND_SYNC_CHANNEL\)/);
  assert.match(background, /channelRef\.current\?\.postMessage\(\{ type: EMAIL_ROUTER_BACKGROUND_SYNC_SIGNAL \}\)/);
  assert.match(background, /event\.data\?\.type === EMAIL_ROUTER_BACKGROUND_SYNC_SIGNAL/);
  assert.match(background, /navigator\.locks\?\.request && channelRef\.current/);
  assert.match(background, /navigator\.locks\.request\(EMAIL_ROUTER_BACKGROUND_SYNC_LOCK, \{ ifAvailable: true \}/);
  assert.match(background, /invalidateCache\(\{ names: \['emailRouterList', 'emailRouterDetail'\] \}\)/);
  assert.doesNotMatch(background, /if \(Number\(response\.data\?\.changed \|\| 0\) > 0\)/);
  assert.match(layout, /<EmailRouterBackgroundSync enabled=\{hasModuleAccess\('email_router'\)\} \/>/);
  assert.match(workspace, /fcos:email-router-synced/);
  assert.match(workspace, /foreground: false, force: true, silent: true/);
  assert.doesNotMatch(workspace, /event\.detail\?\.changed/);
  assert.match(client, /emailRouterBackgroundSync/);
});

test('server synchronization uses a short dedupe window and non-mutating browser policy', () => {
  const nowMs = Date.parse('2026-08-06T10:00:30.000Z');
  assert.equal(emailRouterBackgroundSyncDue('2026-08-06T10:00:02.000Z', { nowMs }), true);
  assert.equal(emailRouterBackgroundSyncDue('2026-08-06T10:00:03.000Z', { nowMs }), false);
  assert.equal(emailRouterBackgroundSyncDue(null, { nowMs }), true);
  const policy = registeredHandlerBehavior('emailRouterBackgroundSync');
  assert.equal(policy.mutation, false);
  assert.equal(policy.cache, 'none');
});

test('background synchronization is module-scoped and claims the mailbox before Graph reads', async () => {
  const [functions, handlers, core] = await Promise.all([
    read('../api/functions/[name].js'),
    read('../api/_emailRouterHandlers.js'),
    read('../api/_emailRouterCore.js'),
  ]);
  assert.match(functions, /emailRouterBackgroundSync: \['email_router'\]/);
  assert.match(functions, /nativeEmailRouterBackgroundSync/);
  assert.match(handlers, /syncEmailRouterMailboxIfDue/);
  assert.match(handlers, /folders: \['inbox'\]/);
  assert.match(handlers, /maxPages: 1/);
  assert.match(core, /claimQuery[\s\S]*last_synced_at[\s\S]*claimed_elsewhere/);
  assert.match(core, /folders = \['inbox', 'sentitems', 'archive'\]/);
});

test('one mailbox claim deduplicates simultaneous FCOS users and tabs', async () => {
  let lastSyncedAt = '2026-08-06T10:00:00.000Z';
  const query = () => {
    const state = { action: 'select', payload: null, filters: [] };
    const builder = {
      select() { return this; },
      update(payload) { state.action = 'update'; state.payload = payload; return this; },
      eq(column, value) { state.filters.push([column, value]); return this; },
      is(column, value) { state.filters.push([column, value]); return this; },
      async maybeSingle() {
        if (state.action === 'select') return { data: { id: 'mailbox-1', last_synced_at: lastSyncedAt }, error: null };
        const expectedLastSync = state.filters.find(([column]) => column === 'last_synced_at')?.[1];
        if (expectedLastSync !== lastSyncedAt) return { data: null, error: null };
        lastSyncedAt = state.payload.last_synced_at;
        return { data: { id: 'mailbox-1' }, error: null };
      },
    };
    return builder;
  };
  const client = { schema: () => ({ from: () => query() }) };
  let folderCalls = 0;
  const dependencies = {
    now: () => Date.parse('2026-08-06T10:00:30.000Z'),
    syncFolder: async () => { folderCalls += 1; return { synced: 1, removed: 0, pages: 1, nextLink: null }; },
    resolveAlert: async () => {},
    recordAlert: async () => {},
  };
  const first = await syncEmailRouterMailboxIfDue({ client, mailbox: { id: 'mailbox-1' } }, dependencies);
  const second = await syncEmailRouterMailboxIfDue({ client, mailbox: { id: 'mailbox-1' } }, dependencies);
  assert.equal(first.claimed, true);
  assert.equal(first.changed, 3);
  assert.equal(second.claimed, false);
  assert.equal(second.status, 'recent');
  assert.equal(folderCalls, 3);
});
