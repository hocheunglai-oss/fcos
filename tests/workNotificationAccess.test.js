import test from 'node:test';
import assert from 'node:assert/strict';
import { workNotificationAccessContext } from '../api/_workNotificationAccess.js';
import { workNotificationsRead } from '../api/_workNotifications.js';

test('notification operations derive Markets visibility from effective group access', async () => {
  for (const markets of [true, false]) {
    const profile = { id: 'operator' };
    const context = {
      profile,
      capabilities: { markets: !markets },
      client: {
        async rpc(name, args) {
          assert.equal(name, 'fcos_effective_access');
          assert.deepEqual(args, { p_user_id: profile.id });
          return { data: { user_id: profile.id, permissions: { markets } } };
        },
      },
    };
    assert.equal((await workNotificationAccessContext(context)).capabilities.markets, markets);
  }
});

test('restricted CI notification reads do not resolve live group access', async () => {
  const context = { profile: { email: 'it@cosulich.com.hk' } };
  assert.equal(await workNotificationAccessContext(context), context);
});

test('mark-read filters shape the returned view without changing the mutation scope', async () => {
  const writes = [];
  const context = {
    profile: { id: 'fixture-user', email: 'it@cosulich.com.hk' },
    client: {
      from(table) {
        return {
          update() { return this; },
          eq(column, value) {
            assert.deepEqual([column, value], ['user_id', 'fixture-user']);
            return this;
          },
          is() { return this; },
          async in(column, ids) {
            writes.push({ table, column, ids });
            return { error: null };
          },
        };
      },
    },
  };
  const notificationIds = ['collaboration:fixture-notification'];
  const filtered = await workNotificationsRead({ notificationIds, listState: 'handled', source: 'markets' }, context);
  const legacy = await workNotificationsRead({ notificationIds }, context);
  assert.deepEqual(filtered.filters, { state: 'handled', source: 'markets', type: 'all' });
  assert.deepEqual(legacy.filters, { state: 'active', source: 'all', type: 'all' });
  const write = { table: 'collaboration_notifications', column: 'id', ids: ['fixture-notification'] };
  assert.deepEqual(writes, [write, write]);
});
