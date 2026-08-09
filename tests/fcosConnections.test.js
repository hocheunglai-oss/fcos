import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalGitRemote,
  providerRuntime,
  validateProviderArgs,
} from '../scripts/fcos-connections.mjs';

test('connection runner resolves GitHub remotes without accepting other hosts', () => {
  assert.equal(canonicalGitRemote('https://github.com/hocheunglai-oss/fcos.git'), 'hocheunglai-oss/fcos');
  assert.equal(canonicalGitRemote('git@github.com:hocheunglai-oss/fcos.git'), 'hocheunglai-oss/fcos');
  assert.equal(canonicalGitRemote('https://example.com/hocheunglai-oss/fcos.git'), '');
});

test('connection runtimes select only repo-local provider configuration', () => {
  const github = providerRuntime('github');
  const vercel = providerRuntime('vercel');
  const supabase = providerRuntime('supabase');
  const salesforce = providerRuntime('salesforce');

  assert.match(github.env.GH_CONFIG_DIR, /\/FCOS\/\.fcos-cli\/github$/);
  assert.equal(github.env.GH_REPO, 'github.com/hocheunglai-oss/fcos');
  assert.deepEqual(vercel.injectedArgs.slice(0, 2), ['--global-config', `${github.env.GH_CONFIG_DIR.replace(/\/github$/, '')}/vercel`]);
  assert.match(supabase.command, /\/FCOS\/node_modules\/\.bin\/supabase$/);
  assert.match(supabase.env.SUPABASE_HOME, /\/FCOS\/\.fcos-cli\/supabase$/);
  assert.deepEqual(supabase.injectedArgs.slice(0, 2), ['--workdir', github.env.GH_CONFIG_DIR.replace(/\/\.fcos-cli\/github$/, '')]);
  assert.equal(salesforce.env.SF_TARGET_ORG, 'source-salesforce');
});

test('verified runner blocks secret output and target overrides', () => {
  assert.equal(validateProviderArgs('github', ['repo', 'view']), true);
  assert.throws(() => validateProviderArgs('github', ['auth', 'token']), /reveal GitHub tokens/);
  assert.throws(() => validateProviderArgs('github', ['repo', 'view', 'https://github.com/other/repo']), /outside the approved/);
  assert.throws(() => validateProviderArgs('vercel', ['deploy', '--scope', 'other-team']), /overrides are blocked/);
  assert.throws(() => validateProviderArgs('supabase', ['db', 'push', '--project-ref', 'wrong']), /unapproved project ref/);
  assert.throws(() => validateProviderArgs('salesforce', ['org', 'display']), /expose access tokens/);
  assert.throws(() => validateProviderArgs('salesforce', ['data', 'query', '-o', 'other-org']), /unapproved org/);
  assert.throws(() => validateProviderArgs('supabase', ['login', '--token', 'secret']), /Secret-bearing CLI flags/);
});
