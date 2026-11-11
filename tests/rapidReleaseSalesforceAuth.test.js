import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { authenticateHostedSalesforce } from '../scripts/lib/rapid-release/salesforce-hosted-auth.mjs';

const { environments } = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
  PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_TOKEN: 'workflow-fixture',
  FCOS_RAPID_SALESFORCE_MIRROR_TOKEN: 'mirror-fixture' };
for (const { key } of environments) {
  const prefix = 'FCOS_RAPID_SALESFORCE_' + key.toUpperCase();
  env[prefix + '_CLIENT_ID'] = 'fixture-' + key;
  env[prefix + '_PRIVATE_KEY'] = privateKey;
}

test('hosted Salesforce validates every credential and the runner before making a CLI call', () => {
  const spawn = () => assert.fail('Unexpected Salesforce CLI call');
  const directory = mkdtempSync(join(tmpdir(), 'fcos-sf-auth-test-'));
  try {
    const input = { directory, cwd: directory, spawn };
    assert.throws(() => authenticateHostedSalesforce({ ...input, env: { ...env, RUNNER_ENVIRONMENT: 'self-hosted' } }),
      /SALESFORCE_HOSTED_RUNNER_REQUIRED/);
    assert.throws(() => authenticateHostedSalesforce({ ...input, env: { ...env, FCOS_RAPID_SALESFORCE_PRODUCTION_PRIVATE_KEY: '' } }),
      /SALESFORCE_HOSTED_CREDENTIAL_REQUIRED_PRODUCTION/);
    assert.throws(() => authenticateHostedSalesforce({ ...input, env: { ...env, FCOS_RAPID_SALESFORCE_QAT_PRIVATE_KEY: 'invalid' } }),
      /SALESFORCE_HOSTED_PRIVATE_KEY_INVALID_QAT/);
    assert.throws(() => authenticateHostedSalesforce({ ...input, env: { ...env, FCOS_RAPID_SALESFORCE_MIRROR_TOKEN: '' } }),
      /SALESFORCE_HOSTED_MIRROR_CREDENTIAL_REQUIRED/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hosted Salesforce authenticates pinned orgs with private files and stops on an identity mismatch', () => {
  for (const mismatch of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'fcos-sf-auth-test-'));
    let calls = 0;
    try {
      const input = { directory, cwd: directory, env, spawn(program, args, options) {
        const environment = environments[calls++];
        const path = join(directory, environment.key + '.pem');
        assert.equal(program, 'sf');
        assert.deepEqual(args, ['org', 'login', 'jwt', '--username', environment.username, '--client-id', 'fixture-' + environment.key,
          '--jwt-key-file', path, '--instance-url', environment.instanceUrl, '--alias', environment.alias, '--json']);
        assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.equal(readFileSync(path, 'utf8'), privateKey);
        assert.equal(options.env.GITHUB_TOKEN, undefined);
        assert.equal(options.env.FCOS_RAPID_SALESFORCE_MIRROR_TOKEN, undefined);
        assert.equal(options.env.FCOS_RAPID_SALESFORCE_DEVEE_PRIVATE_KEY, undefined);
        return { status: 0, stdout: JSON.stringify({ status: 0, result: { orgId: mismatch ? 'wrong' : environment.orgId,
          username: environment.username, instanceUrl: environment.instanceUrl } }) };
      } };
      if (mismatch) {
        assert.throws(() => authenticateHostedSalesforce(input), /SALESFORCE_HOSTED_LOGIN_IDENTITY_MISMATCH_DEVEE/);
        assert.equal(calls, 1);
      } else {
        authenticateHostedSalesforce(input);
        assert.equal(calls, environments.length);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('hosted Salesforce can reconnect for existing job readback when the mirror token is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-sf-auth-test-'));
  let calls = 0;
  try {
    authenticateHostedSalesforce({ directory, cwd: directory, env: { ...env, FCOS_RAPID_SALESFORCE_MIRROR_TOKEN: '' },
      requireMirrorCredential: false, spawn() {
        const environment = environments[calls++];
        return { status: 0, stdout: JSON.stringify({ status: 0, result: {
          orgId: environment.orgId, username: environment.username, instanceUrl: environment.instanceUrl,
        } }) };
      } });
    assert.equal(calls, environments.length);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
