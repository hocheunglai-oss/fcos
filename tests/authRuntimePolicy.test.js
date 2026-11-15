import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveAuthRuntimePolicy } from '../shared/authRuntimePolicy.js';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const ref = fcosConnectionIdentifier('supabase', 'Project ref');
const url = `https://${ref}.supabase.co`;
const jwt = claims => `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
test('only an unconfigured loopback Vite development server permits local administrator UI', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(resolveAuthRuntimePolicy({ development: true, hostname }).localAdminAllowed, true);
    assert.equal(resolveAuthRuntimePolicy({ development: false, hostname }).localAdminAllowed, false);
    assert.equal(resolveAuthRuntimePolicy({ development: true, hostname, url }).localAdminAllowed, false);
  }
  for (const hostname of ['fcos.fcuno.com', 'localhost.example.com', '192.168.1.5', '']) {
    const policy = resolveAuthRuntimePolicy({ development: true, hostname });
    assert.equal(policy.localAdminAllowed, false);
    assert.equal(policy.configured, false);
    assert.ok(policy.error);
  }
});
test('configured authentication is target locked and permits public keys only', () => {
  assert.equal(resolveAuthRuntimePolicy({ url, publicKey: 'sb_publishable_fixture' }).configured, true);
  for (const overrides of [{ url: 'https://other.supabase.co' }, { publicKey: '' }, { publicKey: 'sb_secret_fixture' }]) {
    assert.equal(resolveAuthRuntimePolicy({ url, publicKey: 'sb_publishable_fixture', ...overrides }).configured, false);
  }
  for (const role of ['anon', 'service_role', 'authenticated']) {
    const publicKey = jwt({ role, ref });
    assert.equal(resolveAuthRuntimePolicy({ url, publicKey }).configured, role === 'anon');
  }
  for (const claims of [{ role: 'anon' }, { role: 'anon', ref: 'different-project' }]) {
    assert.equal(resolveAuthRuntimePolicy({ url, publicKey: jwt(claims) }).configured, false);
    assert.equal(resolveAuthRuntimePolicy({ url, publicKey: jwt(claims), development: true, hostname: 'localhost' }).configured, false);
  }
  const local = { url: 'http://127.0.0.1:54321', development: true, hostname: 'localhost' };
  assert.equal(resolveAuthRuntimePolicy({ ...local, publicKey: jwt({ role: 'anon' }) }).configured, true);
  assert.equal(resolveAuthRuntimePolicy({ ...local, publicKey: jwt({ role: 'service_role' }) }).configured, false);
  assert.equal(resolveAuthRuntimePolicy({ url, publicKey: 'malformed' }).configured, false);
  assert.equal(resolveAuthRuntimePolicy({ url: 'http://127.0.0.1:54321', publicKey: 'sb_publishable_local', development: true, hostname: 'localhost' }).configured, true);
  assert.equal(resolveAuthRuntimePolicy({ url: 'http://127.0.0.1:54321', publicKey: 'sb_publishable_local', development: false, hostname: 'localhost' }).configured, false);
});
test('both administrator fallbacks are guarded and hosted builds require authentication configuration', async () => {
  const auth = await readFile(new URL('../src/lib/AuthContext.jsx', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/api/appClient.js', import.meta.url), 'utf8');
  assert.match(auth, /const applyLocalAdmin = useCallback\(\(\) => \{\s*if \(!isLocalAdminAllowed\) throw/);
  assert.match(client, /if \(!isLocalAdminAllowed\) throw new Error\(authConfigurationError\);\s*return \{\s*id: 'local-admin'/);
  assert.match(client, /if \(!isSupabaseConfigured\) \{\s*if \(!isLocalAdminAllowed\) throw/);
});
