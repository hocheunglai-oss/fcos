import assert from 'node:assert/strict';
import test from 'node:test';
import { serverSupabaseConfig } from '../api/_supabaseConfig.js';

test('server Supabase configuration prefers canonical server variables', () => {
  const config = serverSupabaseConfig({
    SUPABASE_URL: ' https://project.supabase.co/ ',
    VITE_SUPABASE_URL: 'https://browser-fallback.supabase.co',
    SUPABASE_SECRET_KEY: ' sb_secret_current ',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt',
  });

  assert.equal(config.url, 'https://project.supabase.co/');
  assert.equal(config.key, 'sb_secret_current');
  assert.equal(config.urlEnv, 'SUPABASE_URL');
  assert.equal(config.keyEnv, 'SUPABASE_SECRET_KEY');
  assert.equal(config.keyType, 'secret');
  assert.equal(config.configured, true);
  assert.deepEqual(config.missingEnv, []);
});

test('server Supabase configuration supports the existing legacy deployment contract', () => {
  const config = serverSupabaseConfig({
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt',
  });

  assert.equal(config.urlEnv, 'VITE_SUPABASE_URL');
  assert.equal(config.keyEnv, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.equal(config.keyType, 'legacy_service_role');
  assert.equal(config.configured, true);
});

test('server Supabase configuration reports both halves of an incomplete contract', () => {
  const config = serverSupabaseConfig({});

  assert.equal(config.configured, false);
  assert.deepEqual(config.missingEnv, [
    'SUPABASE_URL or VITE_SUPABASE_URL',
    'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY',
  ]);
});
