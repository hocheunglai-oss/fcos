import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeploymentReadOnly, requireDeploymentMutationAllowed } from '../api/_deploymentReadOnly.js';
import { externalActionGates, isExternalActionEnabled } from '../api/_externalActionGates.js';
import { isReadOnlyMarketAction } from '../api/_readOnlyCiAccess.js';
import { sfRequest } from '../api/_salesforce.js';

test('Preview and explicit read-only deployments deny every external-action gate even with enable flags', () => {
  for (const env of [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' }]) {
    const enabled = { ...env, FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true', FCOS_ENABLE_XERO_CONTACT_SYNC: 'true', FCOS_ENABLE_BANK_EXECUTION: 'true' };
    assert.equal(isDeploymentReadOnly(enabled), true);
    for (const gate of Object.values(externalActionGates(enabled))) {
      assert.equal(gate.enabled, false, gate.key);
      assert.equal(gate.control, 'deployment_read_only');
    }
    assert.throws(() => requireDeploymentMutationAllowed(true, enabled), { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' });
    assert.doesNotThrow(() => requireDeploymentMutationAllowed(false, enabled));
  }
});

test('Production retains established controls without introducing financial authority', () => {
  const env = { VERCEL_ENV: 'production' };
  assert.equal(isDeploymentReadOnly(env), false);
  assert.equal(isExternalActionEnabled('salesforce_write', env), true);
  assert.equal(isExternalActionEnabled('xero_financial_sync', env), false);
  assert.equal(isExternalActionEnabled('xero_financial_sync', { ...env, FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }), true);
  assert.equal(isExternalActionEnabled('salesforce_write', { ...env, FCOS_DISABLE_SALESFORCE_WRITE: 'true' }), false);
  assert.doesNotThrow(() => requireDeploymentMutationAllowed(true, env));
});

test('mixed Markets handler permits reviewed reads while unknown or write actions remain mutations', () => {
  for (const action of ['snapshot', 'market_history', 'intelligence_brief', 'intelligence_curve']) assert.equal(isReadOnlyMarketAction({ action }), true);
  for (const action of ['save', 'intelligence_alert_rules_save', 'future_action']) assert.equal(isReadOnlyMarketAction({ action }), false);
});

test('Preview Salesforce mutation is denied before credentials or network calls', async () => {
  const old = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview';
  try {
    await assert.rejects(sfRequest('/sobjects/stem__c/001000000000000', { method: 'PATCH', body: { Name: 'blocked' } }), { status: 409, code: 'EXTERNAL_ACTION_GATE_DISABLED', gate: 'salesforce_write' });
  } finally {
    if (old === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = old;
  }
});
