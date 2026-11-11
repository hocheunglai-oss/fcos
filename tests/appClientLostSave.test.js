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

test('malformed successful JSON retains request identity and never populates the read cache', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(async () => { throw new SyntaxError('private malformed body'); });
  };
  const result = await appClient.functions.invoke('snapshot', {}, { cache: true });
  assert.equal(result.data.code, 'FCOS_RESPONSE_INVALID');
  assert.match(result.data.error, /saved result/i);
  assert.doesNotMatch(result.data.error, /private malformed body/);
  assert.equal(result.meta.requestId, 'fixture-request');
  assert.equal(result.meta.cacheStatus, 'UNAVAILABLE');
  await appClient.functions.invoke('snapshot', {}, { cache: true });
  assert.equal(calls, 2);
});

test('an aborted mutation response stays cancelled and invalidates the previous snapshot', async () => {
  let saved = 'old';
  globalThis.fetch = async (url) => {
    if (url.endsWith('/snapshot')) return response(async () => ({ saved }));
    saved = 'new';
    const result = response(async () => { throw new DOMException('body aborted', 'AbortError'); });
    result.headers.set('x-fcos-handler-mutation', '1');
    return result;
  };
  assert.equal((await appClient.functions.invoke('snapshot', {}, { cache: true })).data.saved, 'old');
  const result = await appClient.functions.invoke('save');
  assert.equal(result.data.cancelled, true);
  assert.equal(result.meta.cacheStatus, 'CANCELLED');
  assert.equal(result.meta.requestId, 'fixture-request');
  assert.equal((await appClient.functions.invoke('snapshot', {}, { cache: true })).data.saved, 'new');
});

test('lost save responses invalidate snapshots even when fetch itself fails or aborts', async () => {
  const previousWindow = globalThis.window, previousEvent = globalThis.CustomEvent;
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.CustomEvent = class {};
  try {
  for (const error of [new TypeError('Failed to fetch'), Object.assign(new Error('aborted fetch'), { name: 'AbortError' }), null]) {
    for (const options of [{ invalidateCache: true }, {}, { invalidateCache: false, invalidateNames: ['snapshot'] }]) {
      appClient.functions.clearCache();
      let saved = 'old', reads = 0;
      globalThis.fetch = async (url) => {
        if (url.endsWith('/snapshot')) { reads += 1; return response(async () => ({ saved })); }
        saved = 'new';
        if (!error) { const result = response(async () => ({ error: 'Save response lost' })); result.ok = false; result.status = 500; result.headers.set('x-fcos-handler-mutation', '1'); return result; }
        throw error;
      };
      await appClient.functions.invoke('snapshot', {}, { cache: true });
      const result = await appClient.functions.invoke('save', {}, options);
      if (error) assert.equal(result.meta.cacheStatus, error.name === 'AbortError' ? 'CANCELLED' : 'UNAVAILABLE');
      else assert.equal(result.data.error, 'Save response lost');
      assert.equal((await appClient.functions.invoke('snapshot', {}, { cache: true })).data.saved, 'new');
      assert.equal(reads, 2);
    }
  }
  } finally { globalThis.window = previousWindow; globalThis.CustomEvent = previousEvent; }
});
