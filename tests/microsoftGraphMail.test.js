import assert from 'node:assert/strict';
import test from 'node:test';
import { createMicrosoftGraphMailTransport } from '../api/_microsoftGraphMail.js';

const config = {
  tenantId: 'tenant-id',
  clientId: 'client-id',
  mailbox: 'vincent@example.com',
};

test('Microsoft Graph mail exchanges Vercel OIDC and sends through the configured mailbox', async () => {
  const requests = [];
  const transport = await createMicrosoftGraphMailTransport(config, {
    oidcTokenProvider: async () => 'vercel-oidc-assertion',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) {
        return { ok: true, json: async () => ({ access_token: 'graph-token' }) };
      }
      return { status: 202 };
    },
  });

  const result = await transport.sendMail({
    to: ['recipient@example.com'],
    subject: 'FCOS update',
    html: '<p>Update</p>',
  });

  assert.deepEqual(result.accepted, ['recipient@example.com']);
  assert.equal(transport.authenticatedAddress, 'vincent@example.com');
  assert.match(requests[0].url, /tenant-id\/oauth2\/v2\.0\/token$/);
  assert.equal(requests[0].options.body.get('client_assertion'), 'vercel-oidc-assertion');
  assert.equal(requests[0].options.body.get('scope'), 'https://graph.microsoft.com/.default');
  assert.match(requests[1].url, /users\/vincent%40example\.com\/sendMail$/);
  const message = JSON.parse(requests[1].options.body);
  assert.equal(message.saveToSentItems, true);
  assert.equal(message.message.toRecipients[0].emailAddress.address, 'recipient@example.com');
  assert.equal(Object.hasOwn(message.message, 'from'), false);
});

test('Microsoft Graph mailbox authorization failures stop the whole FCOS Updates batch', async () => {
  const transport = await createMicrosoftGraphMailTransport(config, {
    oidcTokenProvider: async () => 'vercel-oidc-assertion',
    fetchImpl: async (url) => url.includes('/token')
      ? { ok: true, json: async () => ({ access_token: 'graph-token' }) }
      : { status: 403 },
  });

  await assert.rejects(
    () => transport.sendMail({ to: ['recipient@example.com'], subject: 'Update', html: 'Update' }),
    (error) => error.code === 'MICROSOFT_GRAPH_MAIL_UNAUTHORIZED'
      && error.fcosUpdateGlobal === true
      && error.fcosUpdateUncertain === false,
  );
});

test('Microsoft Graph network failures are uncertain rather than safe to resend', async () => {
  let requestCount = 0;
  const transport = await createMicrosoftGraphMailTransport(config, {
    oidcTokenProvider: async () => 'vercel-oidc-assertion',
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) return { ok: true, json: async () => ({ access_token: 'graph-token' }) };
      throw new Error('network unavailable');
    },
  });

  await assert.rejects(
    () => transport.sendMail({ to: ['recipient@example.com'], subject: 'Update', html: 'Update' }),
    (error) => error.code === 'MICROSOFT_GRAPH_SEND_UNCERTAIN'
      && error.fcosUpdateUncertain === true,
  );
});
