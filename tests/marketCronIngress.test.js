import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentRequestSafety } from '../api/_deploymentReadOnly.js';
import { deploymentHeader, relayLiveMarketCron } from '../api/_marketCronIngress.js';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const origin = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin;
const path = '/api/functions/marketReportDriveSyncCron';
const env = { VERCEL_ENV: 'production', VERCEL_URL: 'fcos-example.vercel.app', VERCEL_DEPLOYMENT_ID: 'dpl_active', CRON_SECRET: 'fixture-only' };
const headers = { host: env.VERCEL_URL, authorization: 'Bearer fixture-only' };
const req = { method: 'GET', url: path, headers };
const tryRelay = (request, environment, fetchImpl) => relayLiveMarketCron(request, {
  env: environment, safety: deploymentRequestSafety(request,environment), fetchImpl,
});

test('only the authenticated generated domain of the live deployment relays the Market cron', async () => {
  const requests = [];
  const result = await tryRelay(req, env, async (url, init) => {
    requests.push({ url: String(url), init });
    return requests.length === 1
      ? new Response('{}', { headers: { [deploymentHeader]: 'dpl_active' } })
      : new Response('{"importedCount":2}');
  });
  assert.deepEqual(requests.map(r => r.url), [origin + '/api/release-identity', origin + path]);
  assert.equal(requests[0].init.headers, undefined);
  assert.deepEqual(requests[1].init.headers, { authorization: headers.authorization, [deploymentHeader]: 'dpl_active' });
  assert.ok(requests.every(r => r.init.redirect === 'error'));
  assert.deepEqual(await result.json(), { importedCount: 2 });
  assert.equal(deploymentRequestSafety(req,env).readOnly, true);
});

test('preview, explicit read-only, forged authority, wrong paths and unauthenticated calls cannot relay', async () => {
  const unexpected = async () => assert.fail('network access before authority established');
  for (const [request, environment] of [
    [req, {...env, VERCEL_ENV:'preview'}], [req, {...env, FCOS_ENABLE_READ_ONLY_CI:'true'}],
    [req, {...env, VERCEL_DEPLOYMENT_ID:undefined}], [{...req, method:'POST'}, env],
    [{...req, url:path+'?retry=true'}, env], [{...req, headers:{...headers,authorization:'Bearer different'}}, env],
    [{...req, headers:{...headers, [deploymentHeader]:'dpl_active'}}, env],
    [{...req, headers:{...headers, 'x-forwarded-host':'example.com'}}, env],
    [{...req, headers:{...headers, host:'fcos-other.vercel.app'}}, env],
  ]) assert.equal(await tryRelay(request,environment,unexpected), null);
});

test('unpromoted, stale and unavailable deployment identity cannot trigger the canonical job', async () => {
  for (const identity of [
    () => new Response('{}', { headers:{ [deploymentHeader]:'dpl_other' } }),
    () => new Response('{}'),
    () => new Response('{}',{status:503,headers:{[deploymentHeader]:'dpl_active'}}),
  ]) {
    let calls = 0;
    assert.equal(await tryRelay(req,env,async (url, init) => {
      calls += 1;
      assert.equal(String(url),origin+'/api/release-identity');
      assert.equal(init.headers,undefined);
      return identity();
    }),null);
    assert.equal(calls,1);
  }
});
