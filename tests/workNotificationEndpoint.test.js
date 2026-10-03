import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadEffectiveGroupAccess } from '../api/_accessGroups.js';
import { emptyCiNotifications, isReadOnlyCiProfile } from '../api/_readOnlyCiAccess.js';

const files = await Promise.all(['_authenticatedFunction.js', '_workNotificationAccess.js', '_workNotifications.js', 'work-notifications.js'].map((path) => readFile(new URL(`../api/${path}`, import.meta.url), 'utf8')));
const script = files.map((source) => source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\n/gm, '').replace(/export default /g, 'globalThis.endpoint = ').replace(/export (async )?function /g, '$1function ')).join('\n');

function fixture(permission, { ci = false, blocked = false, accessError = null } = {}) {
  const profile = { id: 'fixture-user', email: 'fixture@example.invalid', user_type: 'trader', active: true, ...(ci ? { is_read_only_ci: true } : {}) };
  const calls = [];
  let notificationState = {};
  const event = { id: 'alert-1', title: 'Market fixture', message: 'Market moved', alert_type: 'price_change', severity: 'warning', created_at: new Date().toISOString() };
  const query = (table) => {
    const result = () => ({ data: table === 'market_intelligence_alert_events' ? [event] : table === 'market_intelligence_alert_notification_states' ? [notificationState] : [], error: null });
    const q = { maybeSingle: async () => ({ data: profile, error: null }), then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
    for (const method of ['select', 'eq', 'is', 'in', 'gte', 'order', 'limit', 'or', 'update', 'upsert']) q[method] = (...args) => { calls.push({ table, method, args }); return q; };
    return q;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
    from: query, schema: () => ({ from: query }),
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      if (name === 'fcos_effective_access') return { data: { user_id: profile.id, permissions: { markets: permission } }, error: accessError };
      if (name === 'set_market_intelligence_alert_notification_state') {
        notificationState = { alert_event_id: event.id, read_at: new Date().toISOString(), handled_at: args.p_state === 'handled' ? new Date().toISOString() : null };
        return { data: 1, error: null };
      }
      return { data: {}, error: null };
    },
  };
  const context = vm.createContext({
    process: { env: {} }, Buffer, console, Date, Object, Set, Map, Promise,
    createClient: () => client, serverSupabaseConfig: () => ({ configured: true, url: 'https://fixture.invalid', key: 'fixture' }),
    enforceFcunoFederatedAccess: async ({ profile: stored }) => stored,
    loadEffectiveGroupAccess,
    isReadOnlyCiProfile: (stored) => ci || isReadOnlyCiProfile(stored), emptyCiNotifications, ciModuleAccess: () => ({}),
    requireDeploymentMutationAllowed: (mutation) => { if (blocked && mutation) throw Object.assign(new Error('Preview is read only.'), { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' }); },
    requireReadOnlyCiOperation: (_profile, _name, _body, { mutation }) => { if (ci && mutation) throw Object.assign(new Error('CI is read only.'), { status: 403 }); },
    requestIdFrom: () => 'fixture-request', runWithRequestTelemetry: (_options, action) => action(),
    recordRequestFailure: () => {}, recordSupabaseRequest: () => {}, logRequestTelemetry: () => {}, telemetryResponseHeaders: () => ({}),
    shouldNotifySystemError: () => false, reportSystemError: () => {}, validSystemErrorSignature: () => false, systemIncidentPresentation: () => ({}),
    listSpecialTermApprovalQueue: async () => ({ items: [] }), listSpecialTermClauseConsolidations: async () => ({ consolidations: [] }),
  });
  vm.runInContext(script, context);
  return { calls, async request(name, body = {}) {
    let payload;
    const res = { statusCode: 200, setHeader() {}, end(value) { payload = JSON.parse(value); } };
    await context.endpoint({ method: 'POST', headers: { authorization: 'Bearer fixture-token', 'x-fcos-function-name': name }, body }, res);
    return { status: res.statusCode, data: payload };
  } };
}

test('dedicated route resolves effective Markets visibility and read/handled state', async () => {
  for (const permission of [true]) {
    const f = fixture(permission);
    const list = await f.request('workNotificationsList', { source: 'markets' });
    assert.equal(list.status, 200);
    assert.equal(list.data.notifications.length, 1);
    assert.equal(list.data.unreadCount, 1);
    const read = await f.request('workNotificationsRead', { notificationIds: ['market_intelligence:alert-1'], source: 'markets', listState: 'unread' });
    assert.equal(read.data.notifications.length, 0);
    assert.deepEqual(read.data.filters, { source: 'markets', state: 'unread', type: 'all' });
    const handled = await f.request('workNotificationsState', { notificationIds: ['market_intelligence:alert-1'], state: 'handled', source: 'markets', listState: 'handled' });
    assert.equal(handled.data.updated, 1);
    assert.equal(handled.data.notifications.length, 1);
    assert.ok(f.calls.some((call) => call.rpc === 'fcos_effective_access'));
  }
});

test('denied permission cannot be overridden by request capabilities', async () => {
  for (const permission of [false, null, 'write', 'read', 'full']) {
    const f = fixture(permission);
    const list = await f.request('workNotificationsList', { source: 'markets', capabilities: { markets: true } });
    assert.equal(list.data.notifications.length, 0);
    await f.request('workNotificationsRead', { notificationIds: ['market_intelligence:alert-1'], capabilities: { markets: true } });
    const handled = await f.request('workNotificationsState', { notificationIds: ['market_intelligence:alert-1'], state: 'handled', capabilities: { markets: true } });
    assert.equal(handled.data.updated, 0);
    assert.equal(f.calls.filter((call) => call.rpc === 'set_market_intelligence_alert_notification_state').length, 0);
  }
});

test('access failures fail closed; CI skips access reads and Preview blocks mutation before authentication', async () => {
  assert.equal((await fixture(true, { accessError: new Error('storage unavailable') }).request('workNotificationsList')).status, 500);
  const ci = fixture(true, { ci: true });
  assert.equal((await ci.request('workNotificationsList')).data.notifications.length, 0);
  assert.equal((await ci.request('workNotificationsState', { state: 'handled', notificationIds: ['market_intelligence:alert-1'] })).status, 403);
  assert.ok(ci.calls.every((call) => call.table === 'user_profiles' && ['select', 'eq'].includes(call.method)));
  const preview = fixture(true, { blocked: true });
  assert.equal((await preview.request('workNotificationsRead')).status, 403);
  assert.equal(preview.calls.length, 0);
});
