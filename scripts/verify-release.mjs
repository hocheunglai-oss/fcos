import { spawnSync } from 'node:child_process';
import { assertReleaseBrowserEnvironment, verifyReleasePreviewArtifact } from './lib/release-environment.mjs';

// A release is the only workflow that may use the governed renewable viewer.
// Validate all of its inputs before any release command can begin.
const browserEnvironment = assertReleaseBrowserEnvironment();
await verifyReleasePreviewArtifact(browserEnvironment);

const checks = [
  ['Unit and integration tests', ['run', 'test']],
  ['Lint', ['run', 'lint']],
  ['Type checking', ['run', 'typecheck']],
  ['Compatibility registry', ['run', 'verify:compatibility']],
  ['Migration integrity', ['run', 'verify:migrations']],
  ['Graph-only production source', ['run', 'verify:graph-only']],
  ['Production build', ['run', 'build']],
  ['Performance budgets', ['run', 'verify:performance']],
  ['Read-only browser smoke tests', ['run', 'test:e2e']],
];

for (const [label, args] of checks) {
  process.stdout.write(`\n[release gate] ${label}\n`);
  const env = {
    ...process.env,
    ...(label === 'Migration integrity' ? { FCOS_REQUIRE_LIVE_MIGRATION_CHECK: '1' } : {}),
    ...(label === 'Performance budgets' ? { FCOS_REQUIRE_SERVER_BUNDLES: '1' } : {}),
    ...(label === 'Read-only browser smoke tests' ? {
      FCOS_REQUIRE_AUTH_E2E: '1',
      FCOS_E2E_BASE_URL: browserEnvironment.baseUrl,
      FCOS_E2E_PREVIEW_SHA: browserEnvironment.previewSha,
      FCOS_RELEASE_SHA: browserEnvironment.releaseSha,
      FCOS_E2E_STORAGE_STATE: browserEnvironment.storageState,
      FCOS_E2E_EMAIL: browserEnvironment.email,
      FCOS_E2E_PASSWORD: browserEnvironment.password,
    } : {}),
  };
  const result = spawnSync('npm', args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write('\nRelease gate passed.\n');
