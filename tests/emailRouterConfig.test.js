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
    presetKey: 'operations',
    destinations: [{ destinationId: 'destination-1', groupId: null, recipientKind: 'to', position: 1 }],
  };

  const result = await saveEmailRouterConfiguration(client, { id: 'profile-1' }, operation);

  assert.deepEqual(result, { id: 'preset-1', revision: 1 });
  assert.deepEqual(calls, [{
    name: 'save_emailrouter_preset',
    args: { p_operation: operation, p_actor: 'profile-1' },
  }]);
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
