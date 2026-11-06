import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const names = ['SALESFORCE_ACCESS_TOKEN', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN',
  'SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY', 'SALESFORCE_USERNAME'];
const refresh = { SALESFORCE_CLIENT_ID: 'DUMMY_ONLY_client', SALESFORCE_CLIENT_SECRET: 'DUMMY_ONLY_secret', SALESFORCE_REFRESH_TOKEN: 'DUMMY_ONLY_refresh' };
const canonicalHost = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).hostname;
let sequence = 0;
async function fixture(values, callback) {
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]])), originalFetch = globalThis.fetch;
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  const grants = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/services/oauth2/token');
    grants.push(new URLSearchParams(options.body).get('grant_type'));
    return { ok: true, json: async () => ({ access_token: 'DUMMY_ONLY_refreshed', instance_url: 'https://fixture.salesforce.test', issued_at: String(Date.now()) }) };
  };
  try {
    const salesforce = await import(`../api/_salesforce.js?readonly-auth-fixture=${++sequence}`);
    await callback(salesforce, grants);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
const scoped = (readOnly, callback) => runWithDeploymentRequestSafety({ headers: { host: readOnly ? 'fcos-readonly-auth-fixture.vercel.app' : canonicalHost } }, callback, { VERCEL_ENV: 'production' });

test('read-only Salesforce reads select the existing static token instead of the forbidden rotating grant', async () => {
  await fixture({ ...refresh, SALESFORCE_ACCESS_TOKEN: 'DUMMY_ONLY_static' }, async (salesforce, grants) => scoped(true, async () => {
    assert.equal(await salesforce.getAccessToken(), 'DUMMY_ONLY_static');
    assert.equal(salesforce.salesforceAuthMode(), 'access_token');
    assert.deepEqual(salesforce.salesforceConfiguredAuthModes(), ['refresh_token', 'access_token']);
    assert.deepEqual(grants, []);
  }));
});

test('a read-only request without JWT or static credentials cannot start or borrow the rotating refresh path', async () => {
  await fixture(refresh, async (salesforce, grants) => {
    await scoped(true, () => assert.rejects(salesforce.getAccessToken(), { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' }));
    assert.deepEqual(grants, []);
    await scoped(false, () => salesforce.getAccessToken());
    assert.equal(grants.length, 1);
    await scoped(true, () => assert.rejects(salesforce.getAccessToken(), { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' }));
    assert.equal(grants.length, 1);
  });
});

test('forceRefresh remains forbidden for read-only requests even when a static read token exists', async () => {
  await fixture({ ...refresh, SALESFORCE_ACCESS_TOKEN: 'DUMMY_ONLY_static' }, async (salesforce, grants) => scoped(true, async () => {
    await assert.rejects(salesforce.getAccessToken({ forceRefresh: true }), { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' });
    assert.deepEqual(grants, []);
  }));
});

test('the existing nonrotating JWT path keeps precedence over the read-only static fallback', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  await fixture({ ...refresh, SALESFORCE_ACCESS_TOKEN: 'DUMMY_ONLY_static', SALESFORCE_JWT_CLIENT_ID: 'DUMMY_ONLY_jwt_client',
    SALESFORCE_JWT_USERNAME: 'fixture@example.invalid', SALESFORCE_JWT_PRIVATE_KEY: privateKey }, async (salesforce, grants) => scoped(true, async () => {
    assert.equal(await salesforce.getAccessToken(), 'DUMMY_ONLY_refreshed');
    assert.equal(salesforce.salesforceAuthMode(), 'jwt');
    assert.deepEqual(grants, ['urn:ietf:params:oauth:grant-type:jwt-bearer']);
  }));
});

test('canonical Production keeps durable refresh precedence and its existing force-refresh behavior', async () => {
  await fixture({ ...refresh, SALESFORCE_ACCESS_TOKEN: 'DUMMY_ONLY_static' }, async (salesforce, grants) => scoped(false, async () => {
    assert.equal(await salesforce.getAccessToken(), 'DUMMY_ONLY_refreshed');
    assert.equal(salesforce.salesforceAuthMode(), 'refresh_token');
    assert.equal(await salesforce.getAccessToken({ forceRefresh: true }), 'DUMMY_ONLY_refreshed');
    assert.deepEqual(grants, ['refresh_token', 'refresh_token']);
  }));
});
