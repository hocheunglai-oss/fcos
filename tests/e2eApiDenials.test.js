import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CI_DENIAL_PROBES, assertCiApiDenials } from '../scripts/e2e-api-denials.mjs';

const candidateUrl = 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app';
const reply = (url, { status = 403, code = 'FCOS_CI_READ_ONLY' } = {}) => ({
  status: () => status, url: () => url, json: async () => ({ code }), dispose: async () => {},
});

test('every fixed denial probe is same-origin, nonredirecting and has no usable mutation payload', async () => {
  const calls = [];
  const results = await assertCiApiDenials({ candidateUrl, fetchProbe: async (options) => {
    calls.push(options);
    return reply(options.url);
  } });
  assert.equal(results.length, 8);
  assert.deepEqual(calls.map(({ postData }) => JSON.parse(postData)), [{}, {}, {}, {}, { action: 'save_spreads' }, {}, {}, {}]);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, candidateUrl);
    assert.equal(call.method, 'POST');
    assert.equal(call.maxRedirects, 0);
    assert.equal(call.maxRetries, 0);
    assert.equal(call.headers, undefined);
  }
});

test('HTTP status alone, auth failures, missing routes and generic validation failures cannot pass', async () => {
  for (const patch of [{ status: 200 }, { status: 400 }, { status: 401 }, { status: 404 }, { status: 500 }, { code: 'ACCESS_DENIED' }, { code: null }]) {
    let count = 0;
    await assert.rejects(assertCiApiDenials({ candidateUrl, fetchProbe: async ({ url }) => {
      count++;
      return reply(url, patch);
    } }), /Read-only CI API denial was not proven/);
    assert.equal(count, 1);
  }
});

test('denial failures never echo request credentials or response contents', async () => {
  for (const fetchProbe of [
    async () => { throw new Error('synthetic-secret'); },
    async ({ url }) => ({ ...reply(url), json: async () => { throw new Error('synthetic-secret'); } }),
    async () => reply('https://elsewhere.example'),
  ]) {
    await assert.rejects(assertCiApiDenials({ candidateUrl, fetchProbe }), (error) => !error.message.includes('synthetic-secret') && error.message.includes(CI_DENIAL_PROBES[0].path));
  }
  await assert.rejects(assertCiApiDenials({ candidateUrl: 'https://fcos.fcuno.com', fetchProbe: () => { throw new Error('must not run'); } }), /immutable/);
});

test('browser adapter uses the app-owned request without token extraction and is mandatory in CI', async () => {
  const source = await readFile(new URL('../e2e/api-denials.spec.js', import.meta.url), 'utf8');
  assert.match(source, /route\.fetch\(options\)/);
  assert.doesNotMatch(source, /\.headers\(|localStorage|sessionStorage|access_token|console\./);
  assert.match(source, /FCOS_REQUIRE_AUTH_E2E === '1' && !hasAuth/);
  assert.match(source, /outcome\.error\)\.toBeUndefined/);
});
