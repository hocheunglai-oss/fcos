import { spawnSync } from 'node:child_process';

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
    ...(label === 'Read-only browser smoke tests' ? { FCOS_REQUIRE_AUTH_E2E: '1' } : {}),
  };
  const result = spawnSync('npm', args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write('\nRelease gate passed.\n');
