import assert from 'node:assert/strict';
import test from 'node:test';
import { serverSupabaseConfig } from '../api/_supabaseConfig.js';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const projectUrl = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;

test('server Supabase configuration prefers canonical server variables', () => {
  const config = serverSupabaseConfig({
    SUPABASE_URL: ` ${projectUrl}/ `,
    VITE_SUPABASE_URL: 'https://browser-fallback.supabase.co',
    SUPABASE_SECRET_KEY: ' sb_secret_current ',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt',
  });

  assert.equal(config.url, `${projectUrl}/`);
  assert.equal(config.key, 'sb_secret_current');
  assert.equal(config.urlEnv, 'SUPABASE_URL');
  assert.equal(config.keyEnv, 'SUPABASE_SECRET_KEY');
  assert.equal(config.keyType, 'secret');
  assert.equal(config.configured, true);
  assert.deepEqual(config.missingEnv, []);
});

test('server Supabase configuration supports the existing legacy deployment contract', () => {
  const config = serverSupabaseConfig({
    VITE_SUPABASE_URL: projectUrl,
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt',
  });

  assert.equal(config.urlEnv, 'VITE_SUPABASE_URL');
  assert.equal(config.keyEnv, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.equal(config.keyType, 'legacy_service_role');
  assert.equal(config.configured, true);
});

test('server Supabase configuration rejects another project and noncanonical endpoints', () => {
  for (const url of ['https://other.supabase.co', `${projectUrl}/auth/v1`, `${projectUrl}?redirect=1`, `http://${new URL(projectUrl).host}`, `https://user:password@${new URL(projectUrl).host}`]) {
    const config = serverSupabaseConfig({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'sb_secret_test' });
    assert.equal(config.configured, false);
    assert.equal(config.targetValid, false);
    assert.equal(config.key, '');
  }
});

test('server Supabase configuration reports both halves of an incomplete contract', () => {
  const config = serverSupabaseConfig({});

  assert.equal(config.configured, false);
  assert.deepEqual(config.missingEnv, [
    'SUPABASE_URL or VITE_SUPABASE_URL',
    'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY',
  ]);
});
