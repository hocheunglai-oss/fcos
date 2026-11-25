import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';
import { fetchOpenAiResponses } from '../api/_openAiResponses.js';

const host = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).hostname;
const request = (hostname) => ({ headers: { host: hostname }, url: '/api/functions/example' });
const production = { VERCEL: '1', VERCEL_ENV: 'production' };

test('the protected transport is the only server entry to the OpenAI API', async () => {
  const api = new URL('../api/', import.meta.url);
  const files = (await readdir(api, { recursive: true })).filter(name => name.endsWith('.js'));
  const providers = [];
  for (const name of files) {
    if ((await readFile(new URL(name, api), 'utf8')).includes('api.openai.com/')) providers.push(name);
  }
  assert.deepEqual(providers, ['_openAiResponses.js']);
});

test('guard checks each request scope and forwards exact transport arguments and result', async () => {
  const calls = [];
  const result = { ok: true };
  const fetchImpl = (...args) => { calls.push(args); return Promise.resolve(result); };
  const url = 'https://api.openai.com/v1/responses';
  const init = { method: 'POST', headers: { authorization: 'fixture' }, signal: new AbortController().signal, body: '{}' };
  for (const [hostname, env] of [['stage.vercel.app', production], [undefined, production], [host, { VERCEL_ENV: 'preview' }], [host, { ...production, FCOS_ENABLE_READ_ONLY_CI: 'true' }]]) {
    await runWithDeploymentRequestSafety(request(hostname), async () => {
      assert.throws(() => fetchOpenAiResponses(fetchImpl, init), { code: 'FCOS_DEPLOYMENT_READ_ONLY', status: 403 });
    }, env);
  }
  assert.equal(calls.length, 0);
  for (const env of [production, {}]) await runWithDeploymentRequestSafety(request(host), async () => {
    assert.equal(await fetchOpenAiResponses(fetchImpl, init), result);
  }, env);
  assert.equal(calls.length, 2);
  for (const args of calls) { assert.equal(args[0], url); assert.equal(args[1], init); }
  const failure = new Error('fixture failure');
  await runWithDeploymentRequestSafety(request(host), async () => {
    await assert.rejects(fetchOpenAiResponses(() => Promise.reject(failure), init), error => error === failure);
  }, production);
});
