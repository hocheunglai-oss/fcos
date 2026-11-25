import test from 'node:test';
import assert from 'node:assert/strict';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';
import { interpretDashboardAiSearch } from '../api/_dashboardAi.js';
import { runHedgeAssistant } from '../api/_hedgeAssistant.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';
import dispatcher from '../api/functions/[name].js';

const canonical = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).hostname;
const prod = { VERCEL: '1', VERCEL_ENV: 'production' };
const req = (host, name = 'dashboardAiSearch') => ({ method: 'POST', url: `/api/functions/${name}`, headers: { host } });
const res = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = String(body); } });
const denied = { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' };

test('paid handlers reject staging before authentication or parsing for every account', async () => {
  const old = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    for (const name of ['dashboardAiSearch', 'hedgeDeskAssistant']) {
      assert.equal(registeredHandlerBehavior(name).externalAction, true);
      for (const host of ['fcos-stage.vercel.app', 'invalid host', undefined]) {
        let reads = 0;
        const request = { ...req(host, name), get body() { reads++; throw Error('body accessed'); } };
        const response = res();
        await dispatcher(request, response);
        assert.equal(response.statusCode, 403);
        assert.equal(JSON.parse(response.body).code, denied.code);
        assert.equal(reads, 0);
      }
      const response = res();
      await dispatcher(req(canonical, name), response);
      assert.equal(response.statusCode, 401);
    }
  } finally { if (old === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = old; }
});

test('paid transports fail closed in request scopes before model reads or provider calls', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 503 }; };
  const client = { from() { throw Error('model read must not occur'); } };
  for (const [host, env] of [['fcos-stage.vercel.app', prod], [canonical, { VERCEL_ENV: 'preview' }], [canonical, { ...prod, FCOS_ENABLE_READ_ONLY_CI: 'true' }], [undefined, prod]]) {
    await runWithDeploymentRequestSafety(req(host), async () => {
      await assert.rejects(interpretDashboardAiSearch({ prompt: 'test search', apiKey: 'fixture', fetchImpl }), denied);
      await assert.rejects(runHedgeAssistant(client, { id: 'fixture' }, { messages: [{ content: 'test' }] }, { apiKey: 'fixture', fetchImpl }), denied);
    }, env);
  }
  assert.equal(calls, 0);
});

test('canonical Production and local requests retain paid transport behavior with fake providers', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 503 }; };
  const client = { from() { return { select() { return { eq() { return { async maybeSingle() { return { data: null, error: null }; } }; } }; } }; } };
  for (const env of [prod, {}]) await runWithDeploymentRequestSafety(req(canonical), async () => {
    await assert.rejects(interpretDashboardAiSearch({ prompt: 'test search', apiKey: 'fixture', fetchImpl }), { code: 'DASHBOARD_AI_UNAVAILABLE' });
    await assert.rejects(runHedgeAssistant(client, { id: 'fixture' }, { messages: [{ content: 'test' }] }, { apiKey: 'fixture', fetchImpl }), { code: 'HEDGE_ASSISTANT_FAILED' });
  }, env);
  assert.equal(calls, 4);
});
