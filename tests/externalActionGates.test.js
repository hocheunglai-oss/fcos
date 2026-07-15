import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { externalActionGates, isExternalActionEnabled, requireExternalActionGate } from '../api/_externalActionGates.js';
import { sfRequest } from '../api/_salesforce.js';

test('established FCOS integrations stay live while new actions remain UAT gated', () => {
  const gates = externalActionGates({});
  assert.deepEqual(Object.values(gates).map((gate) => gate.enabled), [true, true, true, false, false]);
  assert.equal(isExternalActionEnabled('salesforce_write', { FCOS_DISABLE_SALESFORCE_WRITE: 'TRUE' }), false);
  assert.equal(isExternalActionEnabled('salesforce_write', { FCOS_DISABLE_SALESFORCE_WRITE: 'yes' }), true);
  assert.equal(isExternalActionEnabled('bank_execution', { FCOS_ENABLE_BANK_EXECUTION: 'TRUE' }), true);
});

test('emergency-disabled legacy integrations return a stable conflict without exposing their environment variable', () => {
  assert.throws(
    () => requireExternalActionGate('google_drive', { FCOS_DISABLE_GOOGLE_DRIVE: 'true' }),
    (error) => error.status === 409
      && error.code === 'EXTERNAL_ACTION_GATE_DISABLED'
      && error.gate === 'google_drive'
      && !error.message.includes('FCOS_DISABLE_'),
  );
});

test('an emergency Salesforce pause rejects mutations before authentication or network access', async () => {
  const previous = process.env.FCOS_DISABLE_SALESFORCE_WRITE;
  process.env.FCOS_DISABLE_SALESFORCE_WRITE = 'true';
  try {
    await assert.rejects(
      sfRequest('/sobjects/stem__c/001000000000000', { method: 'PATCH', body: { Name: 'blocked' } }),
      (error) => error.status === 409 && error.gate === 'salesforce_write',
    );
  } finally {
    if (previous == null) delete process.env.FCOS_DISABLE_SALESFORCE_WRITE;
    else process.env.FCOS_DISABLE_SALESFORCE_WRITE = previous;
  }
});

test('retained live paths include emergency controls at their server boundary', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  assert.match(source, /async function googleDriveAccessToken\(\) \{\s*requireExternalActionGate\('google_drive'\)/);
  assert.match(source, /async function sendWithSmtp\([^)]*\) \{\s*requireExternalActionGate\('email_delivery'\)/);
  assert.match(source, /async function outstandingBuyerInvoicesEmailCron[\s\S]*isExternalActionEnabled\('email_delivery'\)/);
  assert.match(source, /async function disputeWorkflowUploadDocument[\s\S]*requireExternalActionGate\('salesforce_write'\)/);
});

test('FCOS keeps its dedicated Supabase extension and scheduled email cadence', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(source, /createClient\(url, serviceRoleKey/);
  assert.deepEqual(vercel.crons, [
    { path: '/api/functions/outstandingBuyerInvoicesEmailCron', schedule: '0 0 * * 1-5' },
    { path: '/api/functions/outstandingBuyerInvoicesEmailCron', schedule: '0 6 * * 1-5' },
  ]);
});
