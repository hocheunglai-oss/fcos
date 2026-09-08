import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseBrowserEnvironment, verifyReleasePreviewArtifact } from './lib/release-environment.mjs';
import { preparePrivateE2eState, removePrivateE2eState } from './e2e-private-state.mjs';

const checks = [
  ['Unit and integration tests', ['run', 'test']],
  ['Lint', ['run', 'lint']],
  ['Type checking', ['run', 'typecheck']],
  ['Compatibility registry', ['run', 'verify:compatibility']],
  ['Migration integrity', ['run', 'verify:migrations']],
  ['Graph-only production source', ['run', 'verify:graph-only']],
  ['Production build', ['run', 'build']],
  ['Performance budgets', ['run', 'verify:performance']],
  ['Read-only browser smoke tests', ['run', 'test:e2e', '--', '--trace=off']],
];

export async function verifyRelease({
  environment = process.env,
  run = spawnSync,
  checkedOutCommit = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  verify = verifyReleasePreviewArtifact,
  prepare = preparePrivateE2eState,
  cleanup = removePrivateE2eState,
} = {}) {
  // Run only from reviewed source. This local gate does not create the trusted
  // workflow's evidence artifact or bypass its protected environment review.
  const browser = assertReleaseBrowserEnvironment(environment);
  if (checkedOutCommit() !== browser.expectedCommit) throw new Error('Release checkout must match FCOS_E2E_EXPECTED_COMMIT.');
  const candidate = await verify(browser);
  const browserEnv = {
    ...environment,
    FCOS_REQUIRE_AUTH_E2E: '1',
    FCOS_E2E_BASE_URL: candidate.candidateUrl,
    FCOS_E2E_CANDIDATE_URL: candidate.candidateUrl,
    FCOS_E2E_EXPECTED_COMMIT: candidate.commit,
    FCOS_E2E_STATE_DIR: browser.directory,
    FCOS_E2E_STORAGE_STATE: browser.storageState,
    FCOS_E2E_PROTECTION_STATE: browser.protectionState,
    FCOS_E2E_EMAIL: browser.email,
    FCOS_E2E_PASSWORD: browser.password,
    FCOS_E2E_VERCEL_BYPASS: browser.protectionBypass,
  };
  // Tests/builds receive no renewable login or protection credential. GitHub's
  // read-only token is needed only by the candidate resolver/browser bootstrap.
  const checkEnv = { ...environment };
  for (const key of Object.keys(checkEnv)) {
    if (key.startsWith('FCOS_E2E_') || ['FCOS_AUTH_E2E_ENABLED', 'FCOS_REQUIRE_AUTH_E2E', 'FCOS_VERCEL_AUTOMATION_BYPASS_SECRET', 'GITHUB_TOKEN'].includes(key)) delete checkEnv[key];
  }
  for (const [label, args] of checks) {
    process.stdout.write(`\n[release gate] ${label}\n`);
    const isBrowser = label === 'Read-only browser smoke tests';
    const env = isBrowser ? browserEnv : {
      ...checkEnv,
      ...(label === 'Migration integrity' ? { FCOS_REQUIRE_LIVE_MIGRATION_CHECK: '1' } : {}),
      ...(label === 'Performance budgets' ? { FCOS_REQUIRE_SERVER_BUNDLES: '1' } : {}),
    };
    if (isBrowser) await prepare({ env, dependencies: { allowExisting: false } });
    let result;
    try {
      result = run('npm', args, { stdio: 'inherit', env });
    } finally {
      if (isBrowser) await cleanup({ env });
    }
    if (result.status !== 0) throw new Error(`Release gate failed: ${label}.`);
  }
  process.stdout.write('\nRelease gate passed.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRelease().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
