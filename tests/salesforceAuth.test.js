import test from 'node:test';
import assert from 'node:assert/strict';
import { salesforceAuthMode } from '../api/_salesforce.js';

const AUTH_ENV_NAMES = [
  'SALESFORCE_ACCESS_TOKEN',
  'SALESFORCE_CLIENT_ID',
  'SALESFORCE_CLIENT_SECRET',
  'SALESFORCE_REFRESH_TOKEN',
  'SALESFORCE_JWT_CLIENT_ID',
  'SALESFORCE_JWT_USERNAME',
  'SALESFORCE_JWT_PRIVATE_KEY',
  'SALESFORCE_USERNAME',
];

function withSalesforceEnv(values, callback) {
  const previous = Object.fromEntries(AUTH_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of AUTH_ENV_NAMES) delete process.env[name];
  Object.assign(process.env, values);
  try {
    callback();
  } finally {
    for (const name of AUTH_ENV_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test('blank optional OAuth variables do not block the Salesforce access-token fallback', () => {
  withSalesforceEnv({
    SALESFORCE_ACCESS_TOKEN: 'active-session-token',
    SALESFORCE_CLIENT_ID: '',
    SALESFORCE_CLIENT_SECRET: '',
    SALESFORCE_REFRESH_TOKEN: '',
    SALESFORCE_JWT_CLIENT_ID: '',
    SALESFORCE_JWT_USERNAME: '',
    SALESFORCE_JWT_PRIVATE_KEY: '',
  }, () => assert.equal(salesforceAuthMode(), 'access_token'));
});

test('a partial durable Salesforce configuration falls back to a valid access token', () => {
  withSalesforceEnv({
    SALESFORCE_ACCESS_TOKEN: 'active-session-token',
    SALESFORCE_CLIENT_ID: 'connected-app-id',
    SALESFORCE_CLIENT_SECRET: '',
    SALESFORCE_REFRESH_TOKEN: '',
  }, () => assert.equal(salesforceAuthMode(), 'access_token'));
});

test('a partial durable Salesforce configuration without a fallback still fails closed', () => {
  withSalesforceEnv({
    SALESFORCE_CLIENT_ID: 'connected-app-id',
    SALESFORCE_CLIENT_SECRET: '',
    SALESFORCE_REFRESH_TOKEN: '',
  }, () => assert.equal(salesforceAuthMode(), 'misconfigured'));
});

test('complete durable Salesforce configurations take precedence over access tokens', () => {
  withSalesforceEnv({
    SALESFORCE_ACCESS_TOKEN: 'active-session-token',
    SALESFORCE_JWT_CLIENT_ID: 'connected-app-id',
    SALESFORCE_JWT_USERNAME: 'user@example.com',
    SALESFORCE_JWT_PRIVATE_KEY: 'private-key',
  }, () => assert.equal(salesforceAuthMode(), 'jwt'));
});
