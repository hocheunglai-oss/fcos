import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import {
  canonicalGitRemote,
  githubConfigDirectory,
  githubCredentialHelperValue,
  mergeSafeConnectionStatus,
  providerCliRunnable,
  providerRuntime,
  runManagedConnectionOperation,
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
  assert.match(hook, /git ls-remote --heads "\$remote_url"/);
  assert.match(hook, /git rev-list --stdin/);
  assert.doesNotMatch(hook, /refs\/remotes\/origin\/main|git merge-base/);
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

test('cached diagnostics return one sanitized JSON report without provider or state writes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'fcos-cached-diagnostic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of [
    'config/fcosConnections.js',
    'scripts/fcos-connections.mjs',
    'scripts/lib/supabase-project-access.mjs',
    'scripts/lib/connection-operation.mjs',
    'src/lib/connectionChecklist.js',
  ]) {
    const destination = path.join(root, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(new URL('../' + file, import.meta.url), destination);
  }
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const stateDirectory = path.join(root, FCOS_CONNECTION_POLICY.localStateDirectory);
  const statusFile = path.join(stateDirectory, 'status.json');
  await mkdir(stateDirectory);
  const now = new Date().toISOString();
  const fixture = JSON.stringify({
    schemaVersion: 2, policyVersion: FCOS_CONNECTION_POLICY.policyVersion,
    profile: FCOS_CONNECTION_POLICY.profile, generatedAt: now,
    providers: { github: { identityVerified: true, identityStatus: 'verified', targetPin: 'verified',
      permissionStatus: 'verified', permissions: ['repository.push'], lastVerifiedAt: now,
      cliVersion: 'private-test-value', extra: 'private-test-value' } },
  });
  await writeFile(statusFile, fixture);
  const sentinel = path.join(root, 'no-effects.mjs');
  await writeFile(sentinel, `
    import subprocess from 'node:child_process';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const fail = () => { throw new Error('unexpected diagnostic side effect'); };
    subprocess.spawn = subprocess.spawnSync = globalThis.fetch = fail;
    fs.writeFileSync = fs.mkdirSync = fs.chmodSync = fail;
    syncBuiltinESMExports();
  `);
  const run = (...args) => spawnSync(process.execPath, ['--import', sentinel, 'scripts/fcos-connections.mjs', ...args], {
    cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000,
  });

  const result = run('doctor', 'github', '--read-only', '--json');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /private-test-value|repository\.push/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readOnly, true);
  assert.equal(report.observation, 'cached; not live verified');
  assert.deepEqual(Object.keys(report.providers), ['github']);
  assert.equal(report.providers.github.identityVerified, false);
  assert.equal(report.providers.github.lastVerifiedAt, now);

  const missing = run('verify', 'salesforce', '--read-only', '--json');
  assert.equal(missing.status, 2, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).providers.salesforce.identityStatus, 'unavailable');

  for (const args of [['doctor', '--publish'], ['doctor', '--retarget'], ['bootstrap']]) {
    const invalid = run(...args, '--read-only', '--json');
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stderr, '');
    assert.equal(JSON.parse(invalid.stdout).code, 'connection_command_failed');
  }
  assert.equal(await readFile(statusFile, 'utf8'), fixture);
  assert.deepEqual(await readdir(stateDirectory), ['status.json']);
});

test('provider CLI rejects alternate targets in attached, repeated and relative forms', () => {
  const cases = [
    ['github', ['pr', 'view', '1', '--repo=fixture/unapproved']],
    ['github', ['api', 'repos/fixture/unapproved']],
    ['github', ['api', 'user', '--hostname=fixture.invalid']],
    ['vercel', ['inspect', 'fixture-deployment', '--scope=fixture-team']],
    ['vercel', ['inspect', 'fixture-deployment', '-S=fixture-team']],
    ['supabase', ['projects', 'list', '--profile=fixture']],
    ['supabase', ['db', 'pull', '--project-ref=pjforfvchygdyqfcgpmw', '--project-ref=fixture-ref']],
    ['salesforce', ['data', 'query', '--target-org=fixture-org']],
    ['salesforce', ['data', 'query', '-o=fixture-org']],
  ];
  for (const [provider, args] of cases) {
    assert.throws(() => validateProviderArgs(provider, args), /approved|overrides are blocked/, provider);
  }
  assert.equal(validateProviderArgs('github', ['api', 'repos/hocheunglai-oss/fcos/actions/runs']), true);
  assert.equal(validateProviderArgs('github', ['pr', 'view', '1', '-R', 'hocheunglai-oss/fcos']), true);
  assert.equal(validateProviderArgs('salesforce', ['data', 'query', '--target-org=fcos-devee']), true);
});

test('managed API reads require current capability and emit only projected evidence', async () => {
  const when = new Date('2026-11-23T01:00:00Z');
  const context = { provider: 'github', environment: 'tooling', operation: 'github.api.read', capability: 'repository.read' };
  const repo = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'github').identifiers
    .find(({ label }) => label === 'Repository').value;
  const args = ['api', `repos/${repo}/actions/runs`];
  const operations = [];
  const safeReport = {
    provider: 'github', cliVersionStatus: 'approved', targetPin: 'missing', readTargetPinned: true,
    identityVerified: true, identityStatus: 'verified', observedAt: when.toISOString(),
    permissions: ['repository.read'], permissionStatus: 'missing',
  };
  const dependencies = {
    now: () => when,
    verifier: async () => { operations.push('verify'); return safeReport; },
    capture: async () => {
      operations.push('read');
      return { ok: true, stdout: JSON.stringify({ workflow_runs: [{ id: 72, status: 'completed',
        workflow_run: { id: 5, workflow_run: { id: 6 } }, secret: 'fixture-private' }], raw: 'fixture-private' }) };
    },
    print: (value) => operations.push(value),
  };
  assert.equal(await runManagedConnectionOperation(context, args, dependencies), 0);
  assert.deepEqual(operations, ['verify', 'read', { workflow_runs: [{ id: 72, status: 'completed', workflow_run: { id: 5 } }] }]);

  await assert.rejects(runManagedConnectionOperation({ ...context, capability: 'repository.push' }, args, {
    ...dependencies, verifier: () => assert.fail('Invalid operation context reached provider verification'),
  }), /operation and capability/);
  await assert.rejects(runManagedConnectionOperation(context, args, {
    ...dependencies, verifier: async () => ({ ...safeReport, observationMode: 'cached' }),
    capture: () => assert.fail('Cached evidence reached the provider'),
  }), /expired, cached or missing/);
  await assert.rejects(runManagedConnectionOperation(context, args, {
    ...dependencies, verifier: async () => ({ ...safeReport, readTargetPinned: false }),
    capture: () => assert.fail('Missing read target reached the provider'),
  }), /exact identity, target/);
  await assert.rejects(runManagedConnectionOperation(context, args, {
    ...dependencies, verifier: async () => ({ ...safeReport, permissions: [] }),
    capture: () => assert.fail('Missing capability reached the provider'),
  }), /capability has not been/);
});

test('managed deployment reads stop before output when exact resource ownership is unverified', async () => {
  const when = new Date('2026-11-23T01:00:00Z');
  const context = { provider: 'vercel', environment: 'preview', operation: 'vercel.api.read', capability: 'deployment.read' };
  const seen = [];
  const deps = {
    now: () => when,
    verifier: async () => ({
      provider: 'vercel', cliVersionStatus: 'approved', targetPin: 'verified',
      identityVerified: true, identityStatus: 'verified', observedAt: when.toISOString(), permissions: ['deployment.read'],
    }),
    verifyResource: async (resource, operation) => { seen.push([resource, operation.environment]); return false; },
    capture: () => assert.fail('Unverified deployment reached the read path'),
    print: () => assert.fail('Unverified deployment output was published'),
  };
  await assert.rejects(runManagedConnectionOperation(context, ['api', '/v13/deployments/dpl_fixture'], deps),
    /ownership or environment/);
  assert.deepEqual(seen, [['dpl_fixture', 'preview']]);

  const project = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'vercel').identifiers
    .find(({ label }) => label === 'Project ID').value;
  await assert.rejects(runManagedConnectionOperation(context, ['api', `/v13/deployments?projectId=${project}&target=production`], {
    ...deps, verifier: () => assert.fail('Mismatched environment reached provider verification'),
  }), /exact operation environment/);
});

test('Keychain reads have a bounded wait and leave failed credentials unavailable', {
  skip: process.platform !== 'darwin',
}, () => {
  const script = `
    import fs from 'node:fs';
    import processes from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const originalExists = fs.existsSync;
    fs.existsSync = (file) => typeof file === 'string' && file.endsWith('/.fcos-cli/bin/fcos-keychain') || originalExists(file);
    processes.spawnSync = (command, args, options) => {
      if (!command.endsWith('/.fcos-cli/bin/fcos-keychain') || args[0] !== 'get') throw new Error('Unexpected child process');
      if (options.timeout !== 20000 || options.killSignal !== 'SIGKILL') throw new Error('Credential read is unbounded');
      return { status: null, error: Object.assign(new Error('fixture timeout'), { code: 'ETIMEDOUT' }) };
    };
    syncBuiltinESMExports();
    const { providerRuntime } = await import('./scripts/fcos-connections.mjs');
    const result = providerRuntime('vercel');
    if (result.credentialAvailable || result.env.VERCEL_TOKEN) throw new Error('Credential incorrectly admitted after timeout');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
});
