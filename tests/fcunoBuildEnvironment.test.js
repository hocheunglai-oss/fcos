import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFcunoBuildEnvironment } from '../scripts/verify-fcuno-build-environment.mjs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../config/fcosConnections.js';

const approved = {
  VERCEL: '1', VERCEL_ENV: 'production',
  VITE_FCOS_ENABLE_FCUNO_OIDC: 'true', FCOS_ENABLE_FCUNO_FEDERATION: 'true',
  FCUNO_IDENTITY_ISSUER: FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation.issuer,
  VITE_SUPABASE_URL: `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`,
};
test('hosted builds require the same FCUNO consumer and exact FCOS project', () => {
  assert.equal(assertFcunoBuildEnvironment(approved).authentication, 'fcuno');
  assert.equal(assertFcunoBuildEnvironment({ ...approved, VERCEL_ENV: 'preview' }).checked, true);
  for (const key of ['VITE_FCOS_ENABLE_FCUNO_OIDC', 'FCOS_ENABLE_FCUNO_FEDERATION', 'FCUNO_IDENTITY_ISSUER', 'VITE_SUPABASE_URL']) {
    for (const value of ['', undefined, 'false', 'unapproved']) assert.throws(() => assertFcunoBuildEnvironment({ ...approved, [key]: value }), /FCUNO release configuration/);
  }
});
test('local builds remain available but hosted scope cannot bypass via missing VERCEL marker', () => {
  assert.deepEqual(assertFcunoBuildEnvironment({}), { checked: false });
  assert.throws(() => assertFcunoBuildEnvironment({ VERCEL_ENV: 'preview' }), /FCUNO release configuration/);
});
test('configuration errors list names only, never raw environment contents', () => {
  assert.throws(() => assertFcunoBuildEnvironment({ ...approved, FCUNO_IDENTITY_ISSUER: 'private-sentinel', UNRELATED_SECRET: 'private-secret' }), error => !/private-sentinel|private-secret/.test(error.message));
});
