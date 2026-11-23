import assert from 'node:assert/strict';
import test from 'node:test';
import { externalActionGates } from '../api/_externalActionGates.js';
import {
  getFreshXeroConnection, requestXeroToken, resolveXeroTenant, xeroAccountingFetch,
} from '../api/_xeroContactSync.js';
import { exchangeXeroAuthorizationCode, xeroPortalConnectStart } from '../api/_xeroPortal.js';

test('hosted FCOS blocks every Xero transport before credentials, admission or network access', async () => {
  const env = { VERCEL_ENV: 'production', FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' };
  const unexpectedAccess = () => assert.fail('Suspended FCOS accessed Xero or its saved connection');
  const unavailable = new Proxy({}, { get: unexpectedAccess });
  const options = { env, fetchImpl: unexpectedAccess };
  const error = { code: 'FCOS_XERO_ACCESS_SUSPENDED', status: 403 };

  await assert.rejects(getFreshXeroConnection(unavailable, options), error);
  await assert.rejects(requestXeroToken(unavailable, '', unexpectedAccess, env), error);
  await assert.rejects(resolveXeroTenant({ ...options, stored: unavailable }), error);
  await assert.rejects(xeroAccountingFetch(unavailable, '/Invoices', options), error);
  await assert.rejects(xeroAccountingFetch(unavailable, '/Invoices', { ...options, method: 'POST' }), error);
  await assert.rejects(xeroPortalConnectStart({}, options), error);
  await assert.rejects(exchangeXeroAuthorizationCode(options), error);
  assert.equal(externalActionGates(env).xero_financial_sync.enabled, false);
});
