import test from 'node:test';
import assert from 'node:assert/strict';
import { vercelProvider } from '../scripts/lib/rapid-release/providers.mjs';
import { targets } from '../scripts/lib/rapid-release/contract.mjs';
const pins = targets(), branch = 'codex/rapid-controller-install-20261106';
function fixture({ wrongAccount = false, wrongProject = false } = {}) {
  const calls = [];
  const execute = (binary, args) => {
    calls.push(args);
    assert.equal(binary, 'vercel');
    if (args[0] === '--version') return '54.20.1';
    if (args[0] === 'whoami') return wrongAccount ? 'OTHER_ACCOUNT' : pins.vercelAccount;
    assert.equal(args[0], 'api');
    assert.equal(args[args.indexOf('--method') + 1], 'GET');
    if (args[1].startsWith(`/v9/projects/${pins.projectId}?`)) return JSON.stringify({ id: wrongProject ? 'OTHER_PROJECT' : pins.projectId,
      accountId: pins.teamId, autoAssignCustomDomains: false, framework: 'vite', privateField: 'PRIVATE_PROJECT_VALUE' });
    assert.equal(args[1], `/v10/projects/${pins.projectId}/env?decrypt=false&teamId=${pins.teamId}`);
    const row = (key, value, extra = {}) => ({ id: key, key, value, type: 'plain', target: ['preview'], updatedAt: 1, ...extra });
    return JSON.stringify({ envs: [row('FCOS_ENABLE_READ_ONLY_CI', 'true', { gitBranch: branch }),
      row('VITE_FCOS_ENABLE_FCUNO_OIDC', 'true'), row('FCOS_ENABLE_FCUNO_FEDERATION', 'true'),
      row('FCUNO_IDENTITY_ISSUER', 'https://fcuno.com'), row('SALESFORCE_CLIENT_SECRET', 'PRIVATE_ENV_VALUE'),
      row('PRIVATE_TOKEN', 'PRIVATE_SENSITIVE_VALUE', { type: 'sensitive' }),
      row('PRODUCTION_ONLY', 'PRIVATE_PRODUCTION_VALUE', { target: ['production'] }),
      row('OTHER_BRANCH', 'PRIVATE_OTHER_BRANCH', { gitBranch: 'codex/unrelated' })] });
  };
  return { calls, provider: vercelProvider({ env: { VERCEL_TOKEN: 'fixture-provider-token' }, execute }) };
}
test('Preview configuration exposes only relevant native metadata and four explicit public values', async () => {
  const { provider } = fixture(), result = await provider.previewConfiguration(branch), serialized = JSON.stringify(result);
  assert.equal(result.project.id, pins.projectId);
  assert.equal(result.rows.find(row => row.key === 'FCOS_ENABLE_READ_ONLY_CI').value, 'true');
  assert.equal(result.rows.find(row => row.key === 'FCUNO_IDENTITY_ISSUER').value, 'https://fcuno.com');
  for (const name of ['VITE_FCOS_ENABLE_FCUNO_OIDC', 'FCOS_ENABLE_FCUNO_FEDERATION']) assert.equal(result.rows.find(row => row.key === name).value, 'true');
  assert.equal(result.rows.find(row => row.key === 'SALESFORCE_CLIENT_SECRET').value, undefined);
  assert.equal(result.rows.length, 6);
  assert.equal(serialized.includes('PRIVATE_'), true); // A variable NAME is metadata, never its value.
  for (const value of ['PRIVATE_PROJECT_VALUE', 'PRIVATE_ENV_VALUE', 'PRIVATE_SENSITIVE_VALUE', 'PRIVATE_PRODUCTION_VALUE', 'PRIVATE_OTHER_BRANCH']) assert.equal(serialized.includes(value), false);
});
test('wrong account or project refuses before reading Preview environment metadata', async () => {
  for (const condition of [{ wrongAccount: true }, { wrongProject: true }]) {
    const { provider, calls } = fixture(condition);
    await assert.rejects(provider.previewConfiguration(branch), /VERCEL_ACCOUNT_OR_VERSION_MISMATCH|VERCEL_PROJECT_OR_AUTO_ASSIGNMENT_MISMATCH/);
    assert.equal(calls.some(args => args[1]?.startsWith('/v10/')), false);
  }
});
test('invalid branch refuses before invoking any CLI command', async () => {
  const { provider, calls } = fixture();
  for (const value of ['', 'main', 'codex/../main', 'codex/a?decrypt=true', 'codex/a/', 'codex/a//b', 'codex/a.lock', 'codex/a.', 'codex/a/.b']) await assert.rejects(provider.previewConfiguration(value), /PREVIEW_CONFIGURATION_BRANCH_REQUIRED/);
  assert.equal(calls.length, 0);
});
