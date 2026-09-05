import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  canonicalGitRemote,
  githubConfigDirectory,
  githubCredentialHelperValue,
  mergeSafeConnectionStatus,
  providerCliRunnable,
  providerRuntime,
  validateProviderArgs,
  versionPolicyStatus,
} from '../scripts/fcos-connections.mjs';

const connectionProviderIds = ['github', 'vercel', 'supabase', 'salesforce'];

function connectionReport(provider, marker = provider) {
  return { provider, marker };
}

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

  const commonDirectory = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  }).stdout.trim();
  const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  const expectedGitHubConfig = path.join(path.dirname(commonDirectory), '.fcos-cli/github');
  assert.equal(githubConfigDirectory(), expectedGitHubConfig);
  assert.equal(
    githubConfigDirectory({ repoRoot: '/tmp/fcos-detached', commonDirectory: '' }),
    '/tmp/fcos-detached/.fcos-cli/github',
  );
  assert.equal(github.env.GH_CONFIG_DIR, expectedGitHubConfig);
  assert.equal(github.env.GH_REPO, 'github.com/hocheunglai-oss/fcos');
  assert.equal(vercel.command, 'vercel');
  assert.deepEqual(vercel.injectedArgs.slice(0, 2), ['--global-config', `${repoRoot}/.fcos-cli/vercel`]);
  assert.equal(supabase.command, new URL('../node_modules/.bin/supabase', import.meta.url).pathname);
  assert.equal(supabase.env.SUPABASE_HOME, `${repoRoot}/.fcos-cli/supabase`);
  assert.deepEqual(supabase.injectedArgs.slice(0, 2), ['--workdir', repoRoot]);
  assert.equal(salesforce.env.SF_TARGET_ORG, 'fcos-devee');
  assert.equal(vercel.env.VERCEL_TOKEN, undefined);
  assert.equal(supabase.env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.match(githubCredentialHelperValue(), /GH_CONFIG_DIR='.*\/\.fcos-cli\/github'/);
  assert.match(githubCredentialHelperValue(), new RegExp(expectedGitHubConfig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(githubCredentialHelperValue(), /env -u GH_TOKEN -u GITHUB_TOKEN/);
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
  assert.equal(validateProviderArgs('salesforce', ['data', 'query', '-o', 'fcos-devee']), true);
  assert.equal(validateProviderArgs('salesforce', ['data', 'query', '--target-org', '00D1s0000008lFEEAY']), true);
  assert.throws(() => validateProviderArgs('supabase', ['login', '--token', 'secret']), /Secret-bearing CLI flags/);
});

test('Salesforce CLI remains available to repair only shared-mirror drift', () => {
  const requiredPermissions = [
    'production.organization.read', 'production.data.query',
    'devee.organization.read', 'devee.data.query',
    'qat.organization.read', 'qat.data.query',
    'shared.repository.read', 'shared.repository.push',
  ];
  const repairable = {
    provider: 'salesforce',
    identityVerified: true,
    identityStatus: 'verified',
    targetPin: 'verified',
    permissionStatus: 'missing',
    permissions: requiredPermissions,
    cliVersionStatus: 'approved',
    warningCodes: ['shared_metadata_out_of_date'],
  };
  assert.equal(providerCliRunnable(repairable), true);
  assert.equal(providerCliRunnable({ ...repairable, targetPin: 'missing' }), false);
  assert.equal(providerCliRunnable({ ...repairable, warningCodes: ['permission_probe_failed'] }), false);
  assert.equal(providerCliRunnable({ ...repairable, permissions: requiredPermissions.slice(0, -1) }), false);
});

test('tracked pre-push guard uses the isolated FCOS GitHub identity', async () => {
  const hook = await readFile(new URL('../.githooks/pre-push', import.meta.url), 'utf8');
  assert.match(hook, /git rev-parse --path-format=absolute --git-common-dir/);
  assert.match(hook, /env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR="\$github_config_dir" gh api user/);
  assert.match(hook, /git merge-base "\$local_sha" "\$origin_main"/);
  assert.match(hook, /hocheunglai-oss\/fcos/);
  assert.doesNotMatch(hook, /gh auth switch|gh auth login/);
});

test('provider-specific checks merge into the safe status without erasing other providers or publication evidence', () => {
  const current = {
    publication: { status: 'published', verifiedAt: '2026-08-30T00:00:00.000Z' },
    providers: Object.fromEntries(connectionProviderIds.map((provider) => [provider, connectionReport(provider, 'old')])),
  };
  const value = mergeSafeConnectionStatus(
    current,
    [connectionReport('salesforce', 'new')],
    undefined,
    '2026-08-30T01:00:00.000Z',
  );

  assert.deepEqual(Object.keys(value.providers).sort(), [...connectionProviderIds].sort());
  assert.equal(value.providers.salesforce.marker, 'new');
  assert.equal(value.providers.github.marker, 'old');
  assert.deepEqual(value.publication, current.publication);
});

test('complete connection checks replace stale providers and publication evidence', () => {
  const current = {
    publication: { status: 'published', verifiedAt: '2026-08-29T00:00:00.000Z' },
    providers: {
      ...Object.fromEntries(connectionProviderIds.map((provider) => [provider, connectionReport(provider, 'old')])),
      obsolete: connectionReport('obsolete', 'old'),
    },
  };
  const reports = connectionProviderIds.map((provider) => connectionReport(provider, 'new'));
  const publication = { status: 'skipped' };
  const value = mergeSafeConnectionStatus(current, reports, publication, '2026-08-30T01:00:00.000Z');

  assert.deepEqual(Object.keys(value.providers).sort(), [...connectionProviderIds].sort());
  assert.ok(Object.values(value.providers).every(({ marker }) => marker === 'new'));
  assert.deepEqual(value.publication, publication);
});

test('full-stack development uses the verified Vercel runner', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts['dev:full'],
    'node scripts/dev-server.mjs -- node scripts/fcos-connections.mjs run vercel -- dev',
  );
});
