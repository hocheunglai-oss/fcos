import test from 'node:test';
import assert from 'node:assert/strict';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { parseSalesforceCurrencyEvidence, salesforceUserInfoEnvelope } from '../api/_salesforceCurrency.js';
import { sfUserCurrencyInfo } from '../api/_salesforce.js';

const production = fcosSalesforceEnvironment('production');
const envelope = (fields = '') => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getUserInfoResponse><result><organizationId>${production.orgId}</organizationId>${fields}</result></getUserInfoResponse></soap:Body></soap:Envelope>`;
const single = '<organizationMultiCurrency>false</organizationMultiCurrency><orgDefaultCurrencyIsoCode>USD</orgDefaultCurrencyIsoCode>';

test('single-currency evidence requires actual company currency and the pinned org', () => {
  assert.deepEqual(parseSalesforceCurrencyEvidence(envelope(single)), { organizationId: production.orgId, singleCurrency: true, corporateCurrency: 'USD' });
  assert.equal(parseSalesforceCurrencyEvidence(envelope(single).replace(production.orgId, production.orgId.slice(0, 15))).corporateCurrency, 'USD');
  assert.throws(() => parseSalesforceCurrencyEvidence(envelope(single).replace(production.orgId, '00D000000000000AAA')), { code: 'SALESFORCE_ORG_MISMATCH' });
  for (const fields of ['', '<organizationMultiCurrency>false</organizationMultiCurrency>', single.replace('USD', '$'), single + '<orgDefaultCurrencyIsoCode>HKD</orgDefaultCurrencyIsoCode>', single.replace('false', 'unknown')]) {
    assert.throws(() => parseSalesforceCurrencyEvidence(envelope(fields)));
  }
});

test('multi-currency org evidence cannot be mistaken for every record currency', () => {
  assert.deepEqual(parseSalesforceCurrencyEvidence(envelope('<organizationMultiCurrency>true</organizationMultiCurrency>')), { organizationId: production.orgId, singleCurrency: false, corporateCurrency: null });
});

test('SOAP faults and entity declarations fail closed without echoing secret content', () => {
  for (const xml of [`<!DOCTYPE result [<!ENTITY sensitive "secret">]>${envelope(single)}`, '<soap:Fault>private token</soap:Fault>']) {
    assert.throws(() => parseSalesforceCurrencyEvidence(xml), (error) => !error.message.includes('secret') && !error.message.includes('private token'));
  }
  assert.match(salesforceUserInfoEnvelope('token<&"'), /token&lt;&amp;&quot;/);
});

test('read-only SOAP lookup pins destination and retries expired session once', async () => {
  const names = ['SALESFORCE_ACCESS_TOKEN', 'SALESFORCE_INSTANCE_URL', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN', 'SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY', 'SALESFORCE_USERNAME'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const oldFetch = globalThis.fetch;
  try {
    names.forEach((name) => delete process.env[name]);
    process.env.SALESFORCE_ACCESS_TOKEN = 'private-test-token';
    process.env.SALESFORCE_INSTANCE_URL = production.instanceUrl;
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls += 1;
      assert.ok(url.startsWith(production.instanceUrl + '/services/Soap/u/'));
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.SOAPAction, 'getUserInfo');
      return calls === 1 ? new Response('<Fault>INVALID_SESSION_ID</Fault>', { status: 500 }) : new Response(envelope(single));
    };
    assert.equal((await sfUserCurrencyInfo()).corporateCurrency, 'USD');
    assert.equal(calls, 2);
    process.env.SALESFORCE_INSTANCE_URL = 'https://wrong.example';
    await assert.rejects(sfUserCurrencyInfo(), { code: 'SALESFORCE_ORG_MISMATCH' });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
