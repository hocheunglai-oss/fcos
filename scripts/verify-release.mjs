import { spawnSync } from 'node:child_process';

const checks = [
  ['Unit and integration tests', ['run', 'test']],
  ['Lint', ['run', 'lint']],
  ['Type checking', ['run', 'typecheck']],
  ['Migration integrity', ['run', 'verify:migrations']],
  ['Graph-only production source', ['run', 'verify:graph-only']],
  ['Production build', ['run', 'build']],
  ['Read-only browser smoke tests', ['run', 'test:e2e']],
];

for (const [label, args] of checks) {
  process.stdout.write(`\n[release gate] ${label}\n`);
  const result = spawnSync('npm', args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write('\nRelease gate passed.\n');
