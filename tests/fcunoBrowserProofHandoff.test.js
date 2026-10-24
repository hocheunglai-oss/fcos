import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setClientSessionOwner } from '../src/lib/clientSessionState.js';

test('provider proof travels only on authenticated bootstrap, never payloads or other requests', async () => {
  let session = { user: { id: 'alice' }, access_token: 'supabase-token', provider_token: 'fcuno-proof' };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.__fcunoHandoff = { auth: { getSession: async () => ({ data: { session } }) } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    let source = await readFile(new URL('../src/api/appClient.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '');
    source = `const supabase = globalThis.__fcunoHandoff;
      const isSupabaseConfigured = true, isLocalAdminAllowed = false, authConfigurationError = 'blocked';
      const navigationCacheDecision = () => 'expired', publishSalesforceFreshness = () => {};
      const FUNCTION_CONTRACT_VERSION = 'fixture', validateFunctionRequest = () => ({ ok: true });
      import { clientSessionState, isCurrentClientSession, onClientSessionReset, setClientSessionOwner } from ${JSON.stringify(new URL('../src/lib/clientSessionState.js', import.meta.url).href)};
      ${source}`;
    const { appClient } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    setClientSessionOwner('alice');
    await appClient.functions.invoke('authContext', {}, { force: true });
    assert.equal(calls[0].headers.authorization, 'Bearer supabase-token');
    assert.equal(calls[0].headers['x-fcos-fcuno-provider-token'], 'fcuno-proof');
    assert.equal(calls[0].body, '{}');
    await appClient.functions.invoke('dashboardSummary');
    assert.equal(calls[1].headers['x-fcos-fcuno-provider-token'], undefined);
    session = { user: { id: 'alice' }, access_token: 'refreshed-token' };
    await appClient.functions.invoke('authContext', {}, { force: true });
    assert.equal(calls[2].headers['x-fcos-fcuno-provider-token'], undefined);
    assert.equal(calls[2].headers.authorization, 'Bearer refreshed-token');
    session = { user: { id: 'alice' }, provider_token: 'orphan-proof' };
    await appClient.functions.invoke('authContext', {}, { force: true });
    assert.equal(calls[3].headers['x-fcos-fcuno-provider-token'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__fcunoHandoff;
    setClientSessionOwner(null);
  }
});
