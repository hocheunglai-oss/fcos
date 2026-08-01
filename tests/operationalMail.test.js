import assert from 'node:assert/strict';
import test from 'node:test';
import {
  operationalMailConfig,
  operationalMailStatus,
  sendOperationalMail,
} from '../api/_operationalMail.js';

const graphEnv = {
  FCOS_OPERATIONAL_TRANSPORT: 'microsoft_graph_oidc',
  FCOS_OPERATIONAL_MICROSOFT_MAILBOX: 'louisa@example.com',
  FCOS_UPDATE_MICROSOFT_TENANT_ID: 'shared-tenant-id',
  FCOS_UPDATE_MICROSOFT_CLIENT_ID: 'shared-client-id',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'louisa@example.com',
  SMTP_PASSWORD: 'smtp-secret',
};

test('operational Graph sender can reuse the FCOS Updates OIDC application', () => {
  const config = operationalMailConfig(graphEnv);
  assert.equal(config.deliveryMethod, 'microsoft_graph_oidc');
  assert.equal(config.graph.tenantId, 'shared-tenant-id');
  assert.equal(config.graph.clientId, 'shared-client-id');
  assert.equal(config.senderAddress, 'louisa@example.com');
  assert.equal(config.configured, true);
});

test('operational sender uses Graph without SMTP when Graph succeeds', async () => {
  let smtpCalls = 0;
  const result = await sendOperationalMail(
    { to: 'buyer@example.com', subject: 'Reminder', html: '<p>Reminder</p>' },
    {
      env: graphEnv,
      graphTransport: {
        sendMail: async () => ({ id: 'graph-message', accepted: ['buyer@example.com'], rejected: [] }),
      },
      sendSmtp: async () => {
        smtpCalls += 1;
        return { id: 'smtp-message' };
      },
    },
  );

  assert.equal(result.id, 'graph-message');
  assert.equal(result.deliveryMethod, 'microsoft_graph_oidc');
  assert.equal(result.from, 'louisa@example.com');
  assert.equal(result.transportFallback, false);
  assert.equal(smtpCalls, 0);
});

test('definite Graph authorization failure can use the configured SMTP continuity fallback', async () => {
  let fallbackMessage = null;
  const authorizationError = Object.assign(new Error('Mailbox scope is unavailable.'), {
    code: 'MICROSOFT_GRAPH_MAIL_UNAUTHORIZED',
  });
  const result = await sendOperationalMail(
    { from: 'FCOS <info@example.com>', to: 'buyer@example.com', subject: 'Reminder', text: 'Reminder' },
    {
      env: { ...graphEnv, FCOS_OPERATIONAL_SMTP_FALLBACK: 'true' },
      graphTransport: { sendMail: async () => { throw authorizationError; } },
      sendSmtp: async (message) => {
        fallbackMessage = message;
        return { id: 'smtp-message', accepted: ['buyer@example.com'], rejected: [] };
      },
    },
  );

  assert.equal(result.deliveryMethod, 'smtp_fallback');
  assert.equal(result.transportFallback, true);
  assert.equal(result.fallbackReason, 'MICROSOFT_GRAPH_MAIL_UNAUTHORIZED');
  assert.equal(fallbackMessage.from, 'FCOS <louisa@example.com>');
});

test('uncertain Graph delivery is never retried through SMTP', async () => {
  let smtpCalls = 0;
  const uncertainError = Object.assign(new Error('Response unavailable.'), {
    code: 'MICROSOFT_GRAPH_SEND_UNCERTAIN',
    mailDeliveryUncertain: true,
  });

  await assert.rejects(
    () => sendOperationalMail(
      { to: 'buyer@example.com', subject: 'Reminder', text: 'Reminder' },
      {
        env: { ...graphEnv, FCOS_OPERATIONAL_SMTP_FALLBACK: 'true' },
        graphTransport: { sendMail: async () => { throw uncertainError; } },
        sendSmtp: async () => {
          smtpCalls += 1;
          return { id: 'smtp-message' };
        },
      },
    ),
    (error) => error === uncertainError,
  );
  assert.equal(smtpCalls, 0);
});

test('operational sender status exposes identity and fallback without secrets', () => {
  const status = operationalMailStatus({
    ...graphEnv,
    FCOS_OPERATIONAL_SMTP_FALLBACK: 'true',
  });
  assert.equal(status.senderAddress, 'louisa@example.com');
  assert.equal(status.transportLabel, 'Microsoft Graph with Vercel OIDC');
  assert.equal(status.displayNameMode, 'mailbox_managed');
  assert.equal(status.fallbackEnabled, true);
  assert.equal(status.fallbackAddress, 'louisa@example.com');
  assert.doesNotMatch(JSON.stringify(status), /shared-tenant-id|shared-client-id|smtp-secret/);
});
