import assert from 'node:assert/strict';
import test from 'node:test';
import { createMicrosoftGraphMailTransport, verifyMicrosoftGraphMailAuthentication } from '../api/_microsoftGraphMail.js';

const config = {
  tenantId: 'tenant-id',
  clientId: 'client-id',
  mailbox: 'vincent@example.com',
};

test('Microsoft Graph health authentication exchanges a token without sending email', async () => {
  const requests = [];
  const result = await verifyMicrosoftGraphMailAuthentication(config, {
    oidcTokenProvider: async () => 'vercel-oidc-assertion',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ access_token: 'graph-token', expires_in: 3600 }),
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/oauth2\/v2\.0\/token$/);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(result.method, 'microsoft_graph_oidc');
  assert.equal(result.authenticatedAddress, 'vincent@example.com');
  assert.ok(result.accessTokenExpiresAt);
});

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
    to: ['recipient@example.com', 'SECOND@example.com'],
    cc: 'copy@example.com',
    bcc: ['blind@example.com'],
    subject: 'FCOS update',
    html: '<p>Update</p>',
  });

  assert.deepEqual(result.accepted, ['recipient@example.com', 'second@example.com', 'copy@example.com', 'blind@example.com']);
  assert.equal(transport.authenticatedAddress, 'vincent@example.com');
  assert.match(requests[0].url, /tenant-id\/oauth2\/v2\.0\/token$/);
  assert.equal(requests[0].options.body.get('client_assertion'), 'vercel-oidc-assertion');
  assert.equal(requests[0].options.body.get('scope'), 'https://graph.microsoft.com/.default');
  assert.match(requests[1].url, /users\/vincent%40example\.com\/sendMail$/);
  const message = JSON.parse(requests[1].options.body);
  assert.equal(message.saveToSentItems, true);
  assert.equal(message.message.toRecipients[0].emailAddress.address, 'recipient@example.com');
  assert.equal(message.message.toRecipients[1].emailAddress.address, 'second@example.com');
  assert.equal(message.message.ccRecipients[0].emailAddress.address, 'copy@example.com');
  assert.equal(message.message.bccRecipients[0].emailAddress.address, 'blind@example.com');
  assert.equal(message.message.body.contentType, 'HTML');
  assert.equal(Object.hasOwn(message.message, 'from'), false);
});

test('Microsoft Graph mail uses a plain-text body when HTML is absent', async () => {
  const requests = [];
  const transport = await createMicrosoftGraphMailTransport(config, {
    oidcTokenProvider: async () => 'vercel-oidc-assertion',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1
        ? { ok: true, json: async () => ({ access_token: 'graph-token' }) }
        : { status: 202 };
    },
  });

  await transport.sendMail({ to: 'recipient@example.com', subject: 'Text', text: 'Plain text' });
  const payload = JSON.parse(requests[1].options.body);
  assert.equal(payload.message.body.contentType, 'Text');
  assert.equal(payload.message.body.content, 'Plain text');
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
