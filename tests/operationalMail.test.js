import assert from 'node:assert/strict';
import test from 'node:test';
import {
  operationalMailConfig,
  operationalMailStatus,
  sendOperationalMail,
} from '../api/_operationalMail.js';

const graphEnv = {
  FCOS_MICROSOFT_TENANT_ID: 'tenant-id',
  FCOS_MICROSOFT_CLIENT_ID: 'client-id',
};

function graphClient() {
  return {
    from(table) {
      assert.equal(table, 'email_sender_routes');
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    purpose_key: 'payment_reminders',
                    email_sender_purposes: { enabled: true },
                    email_sender_mailboxes: {
                      id: 'mailbox-1',
                      email_address: 'collections@example.com',
                      active: true,
                    },
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

function graphClientWithThenableRpc() {
  return {
    ...graphClient(),
    rpc() {
      return {
        then(resolve) {
          resolve({ data: null, error: null });
        },
      };
    },
  };
}

test('operational mail uses the one Graph application without a transport fallback', () => {
  const config = operationalMailConfig(graphEnv);
  const status = operationalMailStatus(graphEnv);
  assert.equal(config.deliveryMethod, 'microsoft_graph_oidc');
  assert.equal(config.graph.tenantId, 'tenant-id');
  assert.equal(config.graph.clientId, 'client-id');
  assert.equal(config.configured, true);
  assert.equal(status.transportLabel, 'Microsoft Graph with Vercel OIDC');
  assert.doesNotMatch(JSON.stringify(status), /tenant-id|client-id/);
});

test('the assigned purpose mailbox is the sender and workflow From values are ignored', async () => {
  let submitted;
  const result = await sendOperationalMail(
    {
      from: 'forged@example.com',
      to: 'buyer@example.com',
      subject: 'Reminder',
      html: '<p>Reminder</p>',
    },
    {
      client: graphClient(),
      purposeKey: 'payment_reminders',
      env: graphEnv,
      transport: {
        sendMail: async (message) => {
          submitted = message;
          return { id: 'graph-message', accepted: ['buyer@example.com'], rejected: [] };
        },
      },
    },
  );

  assert.equal(result.id, 'graph-message');
  assert.equal(result.deliveryMethod, 'microsoft_graph_oidc');
  assert.equal(result.senderAddress, 'collections@example.com');
  assert.equal(Object.hasOwn(submitted, 'from'), false);
});

test('email delivery fails closed when no purpose is supplied', async () => {
  await assert.rejects(
    () => sendOperationalMail({ to: 'buyer@example.com', subject: 'Reminder' }, { client: graphClient(), env: graphEnv }),
    (error) => error.code === 'EMAIL_PURPOSE_REQUIRED',
  );
});

test('Graph delivery succeeds when Supabase RPC is awaitable but has no catch method', async () => {
  const result = await sendOperationalMail(
    { to: 'buyer@example.com', subject: 'Reminder', html: '<p>Reminder</p>' },
    {
      client: graphClientWithThenableRpc(),
      purposeKey: 'payment_reminders',
      env: { ...graphEnv, FCOS_MICROSOFT_CLIENT_ID: 'client-id-thenable-rpc' },
      transport: { sendMail: async () => ({ id: 'graph-accepted', accepted: ['buyer@example.com'], rejected: [] }) },
    },
  );
  assert.equal(result.id, 'graph-accepted');
});
