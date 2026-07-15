import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FCOS_BACKBONE_BRIDGE_PATH,
  backboneBridgeConfig,
  backboneBridgeRequest,
  canonicalBackboneBridgeRequest,
  signBackboneBridgeRequest,
} from '../api/_backboneBridge.js';

test('bridge stays unconfigured without a 32-character server secret', () => {
  assert.equal(backboneBridgeConfig({}).configured, false);
  assert.equal(backboneBridgeConfig({ FCOS_BACKBONE_BRIDGE_SECRET: 'short' }).configured, false);
  assert.equal(backboneBridgeConfig({ FCOS_BACKBONE_BRIDGE_SECRET: 'x'.repeat(32) }).configured, true);
});

test('FCOS and Backbone use the same canonical signed request', () => {
  const input = {
    timestamp: '1784131200',
    requestId: 'a39b8ff9-936f-4915-b762-b769d5f7ce75',
    method: 'POST',
    path: FCOS_BACKBONE_BRIDGE_PATH,
    body: '{"operation":"identity.resolve"}',
  };
  assert.equal(
    canonicalBackboneBridgeRequest(input),
    `${input.timestamp}\n${input.requestId}\nPOST\n/api/fcos/v1/bridge\n${input.body}`,
  );
  assert.equal(
    signBackboneBridgeRequest('x'.repeat(32), input),
    '8b14a08397f506b30831fe3658c1234f8d14fed75f69703b2c03f151c505f4c6',
  );
});

test('bridge sends a signed request and validates response identity', async () => {
  const requestId = 'a39b8ff9-936f-4915-b762-b769d5f7ce75';
  let captured;
  const data = await backboneBridgeRequest({
    operation: 'identity.resolve',
    actor: { userId: requestId, email: 'user@example.com' },
  }, {
    env: {
      FCOS_BACKBONE_URL: 'https://fcbhk-erp.vercel.app',
      FCOS_BACKBONE_BRIDGE_SECRET: 'x'.repeat(32),
    },
    requestId,
    timestamp: '1784131200',
    signal: null,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ schemaVersion: '2026-07-15.1', requestId, identity: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(data.requestId, requestId);
  assert.equal(captured.url, 'https://fcbhk-erp.vercel.app/api/fcos/v1/bridge');
  assert.match(captured.options.headers['x-fcos-signature'], /^[0-9a-f]{64}$/);
  assert.equal(captured.options.signal instanceof AbortSignal, true);
});
