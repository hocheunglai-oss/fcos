import assert from 'node:assert/strict';
import test from 'node:test';

import { saveEmailRouterConfiguration } from '../api/_emailRouterConfig.js';

test('routing preset saves use the dedicated null-safe database function', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { id: 'preset-1', revision: 1 }, error: null };
    },
  };
  const operation = {
    type: 'preset_save',
    displayName: 'Operations',
    destinations: [{ destinationId: 'destination-1', groupId: null, recipientKind: 'to', position: 1 }],
  };

  const result = await saveEmailRouterConfiguration(client, { id: 'profile-1' }, operation);

  assert.deepEqual(result, { id: 'preset-1', revision: 1 });
  assert.deepEqual(calls, [{
    name: 'save_emailrouter_routing_change',
    args: { p_operation: operation, p_actor: 'profile-1' },
  }]);
});

test('every routing mutation uses the atomic integrity guard', async () => {
  for (const operation of [
    { type: 'routing_directory_save', items: [{ id: 'entry-1' }] },
    { type: 'destination_save' },
    { type: 'group_save' },
    { type: 'preset_save' },
  ]) {
    const calls = [];
    const client = { async rpc(name, args) { calls.push({ name, args }); return { data: {}, error: null }; } };
    await saveEmailRouterConfiguration(client, { id: 'profile-1' }, operation);
    assert.equal(calls[0].name, 'save_emailrouter_routing_change');
    assert.deepEqual(calls[0].args, { p_operation: operation, p_actor: 'profile-1' });
  }
});

test('legacy and forged configuration operations are rejected before database access', async () => {
  let rpcCalled = false;
  const client = { async rpc() { rpcCalled = true; return { data: {}, error: null }; } };
  await assert.rejects(
    saveEmailRouterConfiguration(client, { id: 'profile-1' }, { type: 'routing_users_save', items: [] }),
    (error) => error.code === 'EMAIL_ROUTER_CONFIGURATION_INVALID' && /no longer supported/i.test(error.message),
  );
  assert.equal(rpcCalled, false);
});

test('routing preset saves replace raw unavailable-recipient errors with repair guidance', async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: 'Email Router preset contains an unavailable group' } };
    },
  };

  await assert.rejects(
    saveEmailRouterConfiguration(client, { id: 'profile-1' }, { type: 'preset_save' }),
    (error) => error.code === 'EMAIL_ROUTER_CONFIGURATION_SAVE_FAILED'
      && /Remove or replace it/i.test(error.message),
  );
});
