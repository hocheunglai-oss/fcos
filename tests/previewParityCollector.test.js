import assert from 'node:assert/strict';
import test from 'node:test';
import { parseParityEnvironment, collectPreviewParity, discoverParitySwitches } from '../scripts/collect-preview-parity.mjs';

test('environment pulls keep opaque secrets unknown and deployed keys missing from current settings unresolved', () => {
  const result = parseParityEnvironment('VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED="true"\nSUPABASE_SERVICE_ROLE_KEY=""\nXERO_CLIENT_SECRET="must-never-persist"\n', ['VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED', 'SUPABASE_SERVICE_ROLE_KEY', 'XERO_CLIENT_SECRET', 'SALESFORCE_CLIENT_SECRET']);
  assert.deepEqual(result.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED, { state: 'known', value: 'true' });
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'XERO_CLIENT_SECRET', 'SALESFORCE_CLIENT_SECRET']) assert.deepEqual(result[key], { state: 'unknown', present: true });
  assert.ok(!JSON.stringify(result).includes('must-never-persist'));
});

test('source inventory includes generic future switches and literal external-gate names', () => {
  assert.deepEqual(discoverParitySwitches("process.env.BUSINESS_WORKFLOW_ENABLED; env['PAYMENT_FEATURE']; environment?.NEW_READ_ONLY; 'FCOS_DISABLE_SALESFORCE_WRITE'; import.meta.env.VITE_NEW_FEATURE;"),
    ['BUSINESS_WORKFLOW_ENABLED', 'FCOS_DISABLE_SALESFORCE_WRITE', 'NEW_READ_ONLY', 'PAYMENT_FEATURE', 'VITE_NEW_FEATURE']);
});

test('parity collector rejects mutable or foreign targets before provider access', async () => {
  for (const candidateUrl of ['https://fcos.fcuno.com', 'https://foreign.example', 'https://fcos-git-main-hocheunglai-6535s-projects.vercel.app']) {
    await assert.rejects(() => collectPreviewParity({ candidateUrl, expectedCommit: 'a'.repeat(40) }), /immutable FCOS/);
  }
});

test('current settings absent from immutable deployment inventory cannot attest deployed values or credential presence', () => {
  const result = parseParityEnvironment('VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED=\"true\"\nXERO_CLIENT_SECRET=\"private\"\n', ['OTHER_KEY']);
  assert.deepEqual(result.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED, { state: 'unknown', present: false });
  assert.deepEqual(result.XERO_CLIENT_SECRET, { state: 'unknown', present: false });
});

test('switch inventory includes declared envName gates and spaced optional bracket references', () => {
  assert.deepEqual(discoverParitySwitches("envName: 'NEW_WORKFLOW_ENABLED'; process.env [ 'OTHER_FEATURE_ENABLED' ]; environment?.['NEW_FEATURE_ENABLED'];"), ['NEW_FEATURE_ENABLED', 'NEW_WORKFLOW_ENABLED', 'OTHER_FEATURE_ENABLED']);
});
