import assert from 'node:assert/strict';
import test from 'node:test';
import connectionAttestation from '../api/connection-attestation.js';
import emailRouterBackgroundSync from '../api/email-router-background-sync.js';
import emailRouterSync from '../api/email-router-sync.js';
import emailRouterWebhook from '../api/email-router-webhook.js';
import fcunoIdentitySync from '../api/fcuno/identity-sync.js';
import salesforceContactSync from '../api/salesforce/contact-sync.js';
import workNotifications from '../api/work-notifications.js';
import xeroCallback from '../api/xero/callback.js';

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(body = '') { this.body = String(body); },
    headers,
  };
}

function unreadableMutationRequest({ method = 'POST', url = '/api/test' } = {}) {
  let bodyReads = 0;
  return {
    req: {
      method,
      url,
      headers: {},
      get body() {
        bodyReads += 1;
        return undefined;
      },
      async *[Symbol.asyncIterator]() {
        bodyReads += 1;
        throw new Error('A read-only deployment must not parse a mutation body.');
      },
    },
    bodyReads: () => bodyReads,
  };
}

async function withReadOnlyDeployment(env, callback) {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    FCOS_ENABLE_READ_ONLY_CI: process.env.FCOS_ENABLE_READ_ONLY_CI,
  };
  try {
    if (env.VERCEL_ENV == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = env.VERCEL_ENV;
    if (env.FCOS_ENABLE_READ_ONLY_CI == null) delete process.env.FCOS_ENABLE_READ_ONLY_CI;
    else process.env.FCOS_ENABLE_READ_ONLY_CI = env.FCOS_ENABLE_READ_ONLY_CI;
    await callback();
  } finally {
    if (previous.VERCEL_ENV == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous.VERCEL_ENV;
    if (previous.FCOS_ENABLE_READ_ONLY_CI == null) delete process.env.FCOS_ENABLE_READ_ONLY_CI;
    else process.env.FCOS_ENABLE_READ_ONLY_CI = previous.FCOS_ENABLE_READ_ONLY_CI;
  }
}

const protectedMutationRoutes = [
  ['Email Router migration sync', emailRouterSync, {}],
  ['Email Router webhook', emailRouterWebhook, {}],
  ['Email Router background sync', emailRouterBackgroundSync, {}],
  ['FCUNO identity sync', fcunoIdentitySync, {}],
  ['Salesforce contact sync', salesforceContactSync, {}],
  ['connection attestation', connectionAttestation, {}],
  ['Xero OAuth callback', xeroCallback, { url: '/api/xero/callback?code=must-not-exchange&state=must-not-verify' }],
];

test('standalone mutation routes reject Preview and explicit read-only deployments before parsing or invoking services', async () => {
  for (const env of [
    { VERCEL_ENV: 'preview', FCOS_ENABLE_READ_ONLY_CI: undefined },
    { VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' },
  ]) {
    await withReadOnlyDeployment(env, async () => {
      for (const [name, handler, requestOptions] of protectedMutationRoutes) {
        const { req, bodyReads } = unreadableMutationRequest(requestOptions);
        const res = response();
        await handler(req, res);
        assert.equal(res.statusCode, 403, `${name} must be rejected in ${JSON.stringify(env)}`);
        const expectedCode = handler === emailRouterBackgroundSync && env.FCOS_ENABLE_READ_ONLY_CI === 'true'
          ? 'FCOS_CI_READ_ONLY' : 'FCOS_DEPLOYMENT_READ_ONLY';
        assert.equal(JSON.parse(res.body).code, expectedCode);
        assert.equal(bodyReads(), 0, `${name} must not parse the request before rejecting it`);
      }
    });
  }
});

test('Email Router webhook validation remains a non-mutating challenge in Preview', async () => {
  await withReadOnlyDeployment({ VERCEL_ENV: 'preview' }, async () => {
    const res = response();
    await emailRouterWebhook({ method: 'GET', url: '/api/email-router-webhook?validationToken=challenge-token', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'challenge-token');
  });
});

test('authenticated mutation wrapper preserves CI denial before authentication, body parsing or services', async () => {
  for (const [env, expectedCode] of [
    [{ VERCEL_ENV: 'preview' }, 'FCOS_DEPLOYMENT_READ_ONLY'],
    [{ VERCEL_ENV: 'preview', FCOS_ENABLE_READ_ONLY_CI: 'true' }, 'FCOS_CI_READ_ONLY'],
    [{ VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' }, 'FCOS_CI_READ_ONLY'],
  ]) {
    await withReadOnlyDeployment(env, async () => {
      const { req, bodyReads } = unreadableMutationRequest({ url: '/api/work-notifications' });
      const res = response();
      // No bearer token or storage configuration: reaching authentication would
      // return 401, so 403 proves the deployment guard ran first.
      await workNotifications(req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(res.body).code, expectedCode);
      assert.equal(bodyReads(), 0);
    });
  }
  await withReadOnlyDeployment({ VERCEL_ENV: 'production' }, async () => {
    const { req, bodyReads } = unreadableMutationRequest({ url: '/api/work-notifications' });
    const res = response();
    await workNotifications(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).code, 'FCOS_SIGN_IN_REQUIRED');
    assert.equal(bodyReads(), 0);
  });
});
