import assert from 'node:assert/strict';
import test from 'node:test';
import { parseParityEnvironment, collectPreviewParity } from '../scripts/collect-preview-parity.mjs';

test('environment pulls keep opaque secrets unknown and deployed keys missing from current settings unresolved', () => {
  const result = parseParityEnvironment('VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED="true"\nSUPABASE_SERVICE_ROLE_KEY=""\nXERO_CLIENT_SECRET="must-never-persist"\n', ['SALESFORCE_CLIENT_SECRET']);
  assert.deepEqual(result.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED, { state: 'known', value: 'true' });
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'XERO_CLIENT_SECRET', 'SALESFORCE_CLIENT_SECRET']) assert.deepEqual(result[key], { state: 'unknown', present: true });
  assert.ok(!JSON.stringify(result).includes('must-never-persist'));
});

test('parity collector rejects mutable or foreign targets before provider access', async () => {
  for (const candidateUrl of ['https://fcos.fcuno.com', 'https://foreign.example', 'https://fcos-git-main-hocheunglai-6535s-projects.vercel.app']) {
    await assert.rejects(() => collectPreviewParity({ candidateUrl, expectedCommit: 'a'.repeat(40) }), /immutable FCOS/);
  }
});
