import test from 'node:test';
import assert from 'node:assert/strict';
import { workNotificationAccessContext } from '../api/_workNotificationAccess.js';

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
