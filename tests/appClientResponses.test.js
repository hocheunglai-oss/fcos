import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setClientSessionOwner } from '../src/lib/clientSessionState.js';

const source = await readFile(new URL('../src/api/appClient.js', import.meta.url), 'utf8');
const transformed = source
  .replace(/^import .*supabaseClient';$/m, 'const isSupabaseConfigured = true, isLocalAdminAllowed = false, authConfigurationError = "fixture"; const supabase = globalThis.__responseAuth;')
  .replace("'@/lib/navigationCachePolicy'", JSON.stringify(new URL('../src/lib/navigationCachePolicy.js', import.meta.url).href))
  .replace(/^import .*salesforceFreshness';$/m, 'const publishSalesforceFreshness = () => {};')
  .replace(/^import .*functionContracts';$/m, 'const FUNCTION_CONTRACT_VERSION = "fixture", validateFunctionRequest = () => ({ ok: true });')
  .replace("'../lib/clientSessionState.js'", JSON.stringify(new URL('../src/lib/clientSessionState.js', import.meta.url).href));
globalThis.__responseAuth = { auth: { getSession: async () => ({ data: { session: { user: { id: 'fixture-user' }, access_token: 'fixture-token' } } }) } };
const { appClient } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);
const response = (json) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json', 'x-fcos-request-id': 'fixture-request', 'x-fcos-handler-mutation': '0' }), json });
test.beforeEach(() => { setClientSessionOwner('fixture-user'); appClient.functions.clearCache(); });
test.after(() => { setClientSessionOwner(null); delete globalThis.__responseAuth; });

test('malformed successful JSON fails closed, retains request identity and never populates cache', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(async () => { throw new SyntaxError('private malformed body'); }); };
  const first = await appClient.functions.invoke('snapshot', {}, { cache: true });
  assert.equal(first.data.code, 'FCOS_RESPONSE_INVALID');
  assert.match(first.data.error, /saved result/i);
  assert.equal(first.meta.requestId, 'fixture-request');
  assert.equal(first.meta.cacheStatus, 'UNAVAILABLE');
  assert.doesNotMatch(first.data.error, /private malformed body/);
  await appClient.functions.invoke('snapshot', {}, { cache: true });
  assert.equal(calls, 2);
});

test('aborted JSON body remains cancelled and cannot cache a successful empty response', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }); };
  const result = await appClient.functions.invoke('snapshot', {}, { cache: true });
  assert.equal(result.data.cancelled, true);
  assert.equal(result.meta.cacheStatus, 'CANCELLED');
  await appClient.functions.invoke('snapshot', {}, { cache: true });
  assert.equal(calls, 2);
});

test('identity changes take precedence over network and body read failures', async () => {
  for (const phase of ['fetch', 'body']) {
    setClientSessionOwner('fixture-user');
    globalThis.fetch = async () => {
      const reject = () => { setClientSessionOwner('replacement'); throw new Error('old user connection'); };
      return phase === 'fetch' ? reject() : response(async () => reject());
    };
    const result = await appClient.functions.invoke('snapshot');
    assert.equal(result.data.cancelled, true);
    assert.match(result.data.error, /account changed/);
  }
});

test('valid array responses retain cache and concurrent read deduplication', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(async () => [{ id: 'valid' }]); };
  const results = await Promise.all([appClient.functions.invoke('snapshot', {}, { cache: true }), appClient.functions.invoke('snapshot', {}, { cache: true })]);
  assert.deepEqual(results[0].data, [{ id: 'valid' }]);
  assert.equal(calls, 1);
  assert.equal((await appClient.functions.invoke('snapshot', {}, { cache: true })).meta.cacheStatus, 'HIT');
});

test('unreadable or cancelled mutation outcomes invalidate earlier read snapshots before readback', async () => {
  for (const error of [new SyntaxError('malformed'), Object.assign(new Error('aborted body'), { name: 'AbortError' })]) {
    appClient.functions.clearCache();
    let saved = 'old', reads = 0;
    globalThis.fetch = async (url) => {
      if (url.endsWith('/snapshot')) { reads += 1; return response(async () => ({ saved })); }
      saved = 'new';
      const mutation = response(async () => { throw error; });
      mutation.headers.set('x-fcos-handler-mutation', '1');
      return mutation;
    };
    await appClient.functions.invoke('snapshot', {}, { cache: true });
    await appClient.functions.invoke('save');
    assert.equal((await appClient.functions.invoke('snapshot', {}, { cache: true })).data.saved, 'new');
    assert.equal(reads, 2);
  }
});
