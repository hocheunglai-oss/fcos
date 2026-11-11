import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { requireCondition } from './contract.mjs';

const { environments } = FCOS_CONNECTION_POLICY.providers.find(item => item.id === 'salesforce');

export function authenticateHostedSalesforce({ directory, cwd, env = process.env, spawn = spawnSync }) {
  requireCondition(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted',
    'SALESFORCE_HOSTED_RUNNER_REQUIRED');
  const credentials = environments.map(environment => {
    const prefix = 'FCOS_RAPID_SALESFORCE_' + environment.key.toUpperCase();
    const clientId = env[prefix + '_CLIENT_ID']?.trim();
    const privateKey = env[prefix + '_PRIVATE_KEY'];
    requireCondition(clientId && /^[a-zA-Z0-9._-]+$/u.test(clientId) && privateKey,
      'SALESFORCE_HOSTED_CREDENTIAL_REQUIRED_' + environment.key.toUpperCase());
    let key;
    try { key = createPrivateKey(privateKey); }
    catch { throw new Error('SALESFORCE_HOSTED_PRIVATE_KEY_INVALID_' + environment.key.toUpperCase()); }
    requireCondition(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= 2048,
      'SALESFORCE_HOSTED_PRIVATE_KEY_INVALID_' + environment.key.toUpperCase());
    return { environment, clientId, privateKey };
  });
  const commandEnvironment = {
    PATH: env.PATH,
    HOME: env.HOME,
    SF_DISABLE_AUTOUPDATE: 'true',
    SF_DISABLE_TELEMETRY: 'true',
    SF_USE_GENERIC_UNIX_KEYCHAIN: 'true',
  };
  for (const { environment, clientId, privateKey } of credentials) {
    const keyPath = join(directory, environment.key + '.pem');
    writeFileSync(keyPath, privateKey, { flag: 'wx', mode: 0o600 });
    const result = spawn('sf', ['org', 'login', 'jwt', '--username', environment.username,
      '--client-id', clientId, '--jwt-key-file', keyPath, '--instance-url', environment.instanceUrl,
      '--alias', environment.alias, '--json'], {
      cwd, env: commandEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    });
    let login;
    try { login = JSON.parse(result.stdout); }
    catch { throw new Error('SALESFORCE_HOSTED_LOGIN_FAILED_' + environment.key.toUpperCase()); }
    requireCondition(result.status === 0 && login.status === 0, 'SALESFORCE_HOSTED_LOGIN_FAILED_' + environment.key.toUpperCase());
    requireCondition(login.result?.orgId === environment.orgId && login.result?.username === environment.username
      && login.result?.instanceUrl === environment.instanceUrl, 'SALESFORCE_HOSTED_LOGIN_IDENTITY_MISMATCH_' + environment.key.toUpperCase());
  }
  return commandEnvironment;
}
