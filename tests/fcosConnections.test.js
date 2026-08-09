import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canonicalGitRemote,
  githubCredentialHelperValue,
  providerRuntime,
  validateProviderArgs,
  versionPolicyStatus,
} from '../scripts/fcos-connections.mjs';

test('connection runner resolves GitHub remotes without accepting other hosts', () => {
  assert.equal(canonicalGitRemote('https://github.com/hocheunglai-oss/fcos.git'), 'hocheunglai-oss/fcos');
  assert.equal(canonicalGitRemote('git@github.com:hocheunglai-oss/fcos.git'), 'hocheunglai-oss/fcos');
  assert.equal(canonicalGitRemote('https://example.com/hocheunglai-oss/fcos.git'), '');
});

test('connection runtimes select pinned executables and repo-local provider configuration', () => {
  const github = providerRuntime('github', { requireCredential: false });
  const vercel = providerRuntime('vercel', { requireCredential: false });
  const supabase = providerRuntime('supabase', { requireCredential: false });
  const salesforce = providerRuntime('salesforce', { requireCredential: false });

  assert.match(github.env.GH_CONFIG_DIR, /\/FCOS\/\.fcos-cli\/github$/);
  assert.equal(github.env.GH_REPO, 'github.com/hocheunglai-oss/fcos');
  assert.equal(vercel.command, 'vercel');
  assert.deepEqual(vercel.injectedArgs.slice(0, 2), ['--global-config', `${github.env.GH_CONFIG_DIR.replace(/\/github$/, '')}/vercel`]);
  assert.match(supabase.command, /\/FCOS\/node_modules\/\.bin\/supabase$/);
  assert.match(supabase.env.SUPABASE_HOME, /\/FCOS\/\.fcos-cli\/supabase$/);
  assert.deepEqual(supabase.injectedArgs.slice(0, 2), ['--workdir', github.env.GH_CONFIG_DIR.replace(/\/\.fcos-cli\/github$/, '')]);
  assert.equal(salesforce.env.SF_TARGET_ORG, 'source-salesforce');
  assert.equal(vercel.env.VERCEL_TOKEN, undefined);
  assert.equal(supabase.env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.match(githubCredentialHelperValue(), /GH_CONFIG_DIR='.*\/FCOS\/\.fcos-cli\/github'/);
  assert.match(githubCredentialHelperValue(), /gh auth git-credential/);
});

test('CLI version policy is exact where reproducibility matters and bounded elsewhere', () => {
  assert.equal(versionPolicyStatus('vercel', '54.20.1'), 'approved');
  assert.equal(versionPolicyStatus('vercel', '54.20.2'), 'incompatible');
  assert.equal(versionPolicyStatus('supabase', '2.113.0'), 'approved');
  assert.equal(versionPolicyStatus('supabase', '2.114.0'), 'incompatible');
  assert.equal(versionPolicyStatus('github', '2.96.0'), 'approved');
  assert.equal(versionPolicyStatus('github', '3.0.0'), 'incompatible');
  assert.equal(versionPolicyStatus('salesforce', '2.145.5'), 'incompatible');
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

test('tracked pre-push guard uses the isolated FCOS GitHub identity', async () => {
  const hook = await readFile(new URL('../.githooks/pre-push', import.meta.url), 'utf8');
  assert.match(hook, /GH_CONFIG_DIR="\$repo_root\/\.fcos-cli\/github" gh api user/);
  assert.match(hook, /hocheunglai-oss\/fcos/);
  assert.doesNotMatch(hook, /gh auth switch|gh auth login/);
});
