import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseBrowserEnvironment, verifyReleasePreviewArtifact } from './lib/release-environment.mjs';
import { preparePrivateE2eState, removePrivateE2eState } from './e2e-private-state.mjs';
import { assertCollectedPreviewParity } from './collect-preview-parity.mjs';
import { createReleaseReadiness } from './lib/release-readiness.mjs';

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
  parity = assertCollectedPreviewParity,
  readiness = createReleaseReadiness,
  record = receipt => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`),
  prepare = preparePrivateE2eState,
  cleanup = removePrivateE2eState,
} = {}) {
  // Run only from reviewed source. This local gate does not create the trusted
  // workflow's evidence artifact or replace its protected environment checks.
  const browser = assertReleaseBrowserEnvironment(environment);
  if (checkedOutCommit() !== browser.expectedCommit) throw new Error('Release checkout must match FCOS_E2E_EXPECTED_COMMIT.');
  const candidate = await verify(browser);
  // This independently collects live configuration. A local pass/review JSON
  // cannot waive missing runtime or normal-role evidence.
  const observations = await parity({ candidateUrl: candidate.candidateUrl, expectedCommit: candidate.commit, protectionBypass: browser.protectionBypass });
  const receipt = readiness({ source: observations?.source, candidate: observations?.candidate, production: observations?.production, parity: observations,
    evidence: observations?.trustedEvidence, quality: observations?.quality, lockHash: observations?.binding?.lockHash,
    configurationRevision: observations?.binding?.configurationRevision });
  if (receipt.ready !== true || receipt.blockers?.length) throw new Error('Release readiness is unresolved or belongs to inconsistent candidate evidence.');
  const publicEnvironment = { ...environment };
  for (const key of Object.keys(publicEnvironment)) if (key.startsWith('FCOS_RELEASE_') || key.startsWith('FCOS_NORMAL_ROLE_')
    || key.startsWith('ACTIONS_ID_TOKEN_')) delete publicEnvironment[key];
  const browserEnv = {
    ...publicEnvironment,
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
  const checkEnv = { ...publicEnvironment };
  for (const key of Object.keys(checkEnv)) {
    if (key.startsWith('FCOS_E2E_') || ['FCOS_AUTH_E2E_ENABLED', 'FCOS_REQUIRE_AUTH_E2E', 'FCOS_VERCEL_AUTOMATION_BYPASS_SECRET', 'GITHUB_TOKEN'].includes(key)) delete checkEnv[key];
  }
  for (const [label, args] of checks) {
    process.stdout.write(`\n[release gate] ${label}\n`);
    const isBrowser = label === 'Read-only browser smoke tests';
    const env = isBrowser ? browserEnv : {
      ...checkEnv,
      ...(label === 'Migration integrity' ? { FCOS_REQUIRE_LIVE_MIGRATION_CHECK: '1' } : {}),
      ...(label === 'Production build' ? { FCOS_REQUIRE_CLEAN_BUILD: '1' } : {}),
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
  await record(receipt);
  process.stdout.write('\nRelease gate passed.\n');
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRelease().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
