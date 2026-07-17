import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FCOS_BACKBONE_BRIDGE_PATH,
  FCOS_BACKBONE_BRIDGE_CREDENTIAL_VERSIONS,
  FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION,
  FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS,
  authenticatedBackboneBridgePayload,
  backboneBridgeActor,
  backboneBridgeConfig,
  backboneBridgeRequest,
  browserSafeBackboneFinanceHandoff,
  browserSafeBackboneTradeProjection,
  canonicalBackboneBridgeRequest,
  signBackboneBridgeRequest,
} from '../api/_backboneBridge.js';

const authUserId = 'a39b8ff9-936f-4915-b762-b769d5f7ce75';

function accessContext(overrides = {}) {
  return {
    authUser: {
      id: authUserId,
      email: 'Verified.User@Example.com',
      ...(overrides.authUser || {}),
    },
    profile: {
      id: authUserId,
      email: ' verified.user@example.com ',
      active: true,
      ...(overrides.profile || {}),
    },
  };
}

test('bridge stays unconfigured without a 32-character server secret', () => {
  assert.equal(backboneBridgeConfig({}).configured, false);
  assert.equal(backboneBridgeConfig({ FCOS_BACKBONE_BRIDGE_SECRET: 'short' }).configured, false);
  assert.equal(backboneBridgeConfig({ FCOS_BACKBONE_BRIDGE_SECRET: 'x'.repeat(32) }).configured, true);
});

test('rolling deployment accepts the previous and current bridge schemas only', () => {
  assert.equal(FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS.has('2026-07-15.1'), true);
  assert.equal(FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS.has('2026-07-16.2'), true);
  assert.equal(FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS.has('2026-07-17.1'), true);
  assert.equal(FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS.has(FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION), true);
  assert.equal(FCOS_BACKBONE_BRIDGE_SUPPORTED_SCHEMA_VERSIONS.has('2026-07-17.99'), false);
});

test('bridge preserves the Finance handoff operation in the signed server payload', async () => {
  const requestId = 'a39b8ff9-936f-4915-b762-b769d5f7ce75';
  let captured;
  await backboneBridgeRequest({
    operation: 'finance.handoffs',
    actor: { userId: requestId, email: 'user@example.com' },
    limit: 50,
  }, {
    env: { FCOS_BACKBONE_BRIDGE_SECRET: 'x'.repeat(32) },
    requestId,
    timestamp: '1784131200',
    signal: null,
    fetchImpl: async (_url, options) => {
      captured = JSON.parse(options.body);
      return new Response(JSON.stringify({ schemaVersion: FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION, requestId, handoffs: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(captured, {
    operation: 'finance.handoffs',
    actor: { userId: requestId, email: 'user@example.com' },
    limit: 50,
  });
});

test('bridge preserves one immutable Finance-handoff detail request in the signed server payload', async () => {
  const requestId = 'a39b8ff9-936f-4915-b762-b769d5f7ce75';
  const handoffId = 'ed5bc71c-c71c-41b8-9fb2-4e0aa2ed2a9a';
  let captured;
  await backboneBridgeRequest({
    operation: 'finance.handoff.detail',
    actor: { userId: requestId, email: 'user@example.com' },
    handoffId,
  }, {
    env: { FCOS_BACKBONE_BRIDGE_SECRET: 'x'.repeat(32) },
    requestId,
    timestamp: '1784131200',
    signal: null,
    fetchImpl: async (_url, options) => {
      captured = JSON.parse(options.body);
      return new Response(JSON.stringify({
        schemaVersion: FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION,
        requestId,
        handoff: { handoffId, enquiryNumber: 'ENQ-1' },
        package: {},
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(captured, {
    operation: 'finance.handoff.detail',
    actor: { userId: requestId, email: 'user@example.com' },
    handoffId,
  });
});

test('recognizes only the two non-secret Backbone credential rotation labels', () => {
  assert.equal(FCOS_BACKBONE_BRIDGE_CREDENTIAL_VERSIONS.has('primary'), true);
  assert.equal(FCOS_BACKBONE_BRIDGE_CREDENTIAL_VERSIONS.has('previous'), true);
  assert.equal(FCOS_BACKBONE_BRIDGE_CREDENTIAL_VERSIONS.has('unknown'), false);
});

test('bridge actor comes from the verified auth user after active-profile equality', () => {
  assert.deepEqual(backboneBridgeActor(accessContext()), {
    userId: authUserId,
    email: 'verified.user@example.com',
  });
});

test('bridge actor rejects profile drift, inactive profiles, and missing verified identity', () => {
  const cases = [
    accessContext({ profile: { email: 'someone.else@example.com' } }),
    accessContext({ profile: { id: '88de45f4-fb87-47ad-aefe-acaf191a17f9' } }),
    accessContext({ profile: { active: false } }),
    accessContext({ authUser: { email: '' } }),
    accessContext({ authUser: { id: 'not-a-uuid' } }),
  ];

  for (const context of cases) {
    assert.throws(
      () => backboneBridgeActor(context),
      (error) => error.status === 409 && /out of sync/i.test(error.message),
    );
  }
});

test('authenticated bridge payload rejects a browser-supplied actor override', () => {
  const payload = authenticatedBackboneBridgePayload({
    operation: 'trade.find',
    actor: {
      userId: '88de45f4-fb87-47ad-aefe-acaf191a17f9',
      email: 'attacker@example.com',
    },
  }, accessContext());

  assert.deepEqual(payload.actor, {
    userId: authUserId,
    email: 'verified.user@example.com',
  });
});

test('browser projection removes Salesforce record ids from older Backbone responses', () => {
  const response = {
    schemaVersion: FCOS_BACKBONE_BRIDGE_SCHEMA_VERSION,
    requestId: authUserId,
    trade: {
      caseId: '9d6fcc2a-e540-45fb-8307-e8544174ad2a',
      salesforceEnquiryId: '006234567890123AAA',
      enquiryNumber: 'ENQ-26001',
    },
    stems: [{
      stemId: '13555180-f26f-4af9-8a0f-cdb927e13ec5',
      salesforceStemId: 'a01234567890123AAA',
      stemNumber: 'HKG260001T',
    }],
    items: [{
      caseId: '9d6fcc2a-e540-45fb-8307-e8544174ad2a',
      salesforceEnquiryId: '006234567890123AAA',
      enquiryNumber: 'ENQ-26001',
    }],
  };

  const safe = browserSafeBackboneTradeProjection(response);
  assert.equal('salesforceEnquiryId' in safe.trade, false);
  assert.equal('salesforceStemId' in safe.stems[0], false);
  assert.equal('salesforceEnquiryId' in safe.items[0], false);
  assert.equal(safe.trade.enquiryNumber, 'ENQ-26001');
  assert.equal(safe.stems[0].stemNumber, 'HKG260001T');
  assert.equal(response.trade.salesforceEnquiryId, '006234567890123AAA');
  assert.equal(response.stems[0].salesforceStemId, 'a01234567890123AAA');
});

test('Finance handoff detail recursively removes Salesforce fields before browser delivery', () => {
  const safe = browserSafeBackboneFinanceHandoff({
    handoff: { enquiryNumber: 'ENQ-26001', salesforceEnquiryId: '006234567890123AAA' },
    package: {
      trade: { buyerName: 'Buyer A', salesforceStemId: 'a01234567890123AAA' },
      allocations: [{ productName: 'VLSFO', nested: { salesforceRecordId: 'hidden' } }],
    },
  });

  assert.deepEqual(safe, {
    handoff: { enquiryNumber: 'ENQ-26001' },
    package: {
      trade: { buyerName: 'Buyer A' },
      allocations: [{ productName: 'VLSFO', nested: {} }],
    },
  });
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
        headers: {
          'content-type': 'application/json',
          'x-fcos-bridge-key-version': 'primary',
        },
      });
    },
  });
  assert.equal(data.requestId, requestId);
  assert.equal(data.bridgeCredentialVersion, 'primary');
  assert.equal(captured.url, 'https://fcbhk-erp.vercel.app/api/fcos/v1/bridge');
  assert.match(captured.options.headers['x-fcos-signature'], /^[0-9a-f]{64}$/);
  assert.equal(captured.options.signal instanceof AbortSignal, true);
});

test('bridge stays compatible with an older Backbone response during a rolling deployment', async () => {
  const requestId = 'a39b8ff9-936f-4915-b762-b769d5f7ce75';
  const data = await backboneBridgeRequest({
    operation: 'identity.resolve',
    actor: { userId: requestId, email: 'user@example.com' },
  }, {
    env: { FCOS_BACKBONE_BRIDGE_SECRET: 'x'.repeat(32) },
    requestId,
    timestamp: '1784131200',
    signal: null,
    fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: '2026-07-15.1', requestId, identity: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(data.bridgeCredentialVersion, 'unknown');
});
