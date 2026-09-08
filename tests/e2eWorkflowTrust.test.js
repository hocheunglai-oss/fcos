import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('bootstrap PR quality is secret-free and preserves normal gates without circular evidence consumption', async () => {
  const quality = await read('../.github/workflows/quality.yml');
  assert.doesNotMatch(quality, /authenticated-browser:|listWorkflowRuns|secrets\.|FCOS_REQUIRE_AUTH_E2E|environment:/);
  assert.doesNotMatch(quality, /head\.repo\.full_name|pull_request_target|checks: write|contents: write/);
  assert.match(quality, /persist-credentials: false/);
  assert.match(quality, /contents: read/);
  for (const command of ['npm ci', 'npm run verify:fcuno-contract', 'npm test', 'npm run lint', 'npm run typecheck', 'npm run verify:graph-only', 'npm run build', 'npm run verify:performance', 'npm run verify:migrations']) {
    assert.ok(quality.includes(command), `Preserve ${command}`);
  }
  assert.match(quality, /dependency-review-action@v4/);
  assert.match(quality, /FCOS_REQUIRE_LIVE_MIGRATION_CHECK=1/);
});

test('manual authenticated evidence runs only a protected default-branch harness', async () => {
  const workflow = await read('../.github/workflows/authenticated-release.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /expected_commit:/);
  assert.match(workflow, /candidate_url:/);
  assert.match(workflow, /\[ "\$GITHUB_REF" != "refs\/heads\/\$DEFAULT_BRANCH" \]/);
  assert.match(workflow, /TRUSTED_REF_PROTECTED: \$\{\{ github\.ref_protected \}\}/);
  assert.match(workflow, /\[ "\$TRUSTED_REF_PROTECTED" != "true" \]/);
  assert.match(workflow, /environment: fcos-ci-readonly/);
  assert.match(workflow, /deployments: read/);
  assert.equal((workflow.match(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/g) || []).length, 2);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head/);
  assert.match(workflow, /node scripts\/verify-e2e-candidate\.mjs/);
  assert.match(workflow, /FCOS_E2E_EXPECTED_COMMIT: \$\{\{ inputs\.expected_commit \}\}/);
  assert.match(workflow, /FCOS_E2E_CANDIDATE_URL: \$\{\{ inputs\.candidate_url \}\}/);
  assert.doesNotMatch(workflow, /checks: write/);
  assert.match(workflow, /fcos-ci-evidence-\$\{\{ inputs\.expected_commit \}\}/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /FCOS_E2E_HARNESS_SHA/);
  assert.match(workflow, /candidateSha: process\.env\.FCOS_E2E_EXPECTED_COMMIT/);
  assert.match(workflow, /run: npm run test:e2e -- --trace=off\s/);
  assert.doesNotMatch(workflow, /--screenshot/);
  assert.match(workflow, /e2e-private-state\.mjs prepare/);
  assert.match(workflow, /e2e-private-state\.mjs cleanup/);
});

test('trusted harness sources require an explicit repository owner review', async () => {
  const owners = await read('../.github/CODEOWNERS');
  for (const path of ['/.github/', '/e2e/', '/playwright.config.js', '/scripts/e2e-*.mjs', '/scripts/verify-e2e-candidate.mjs']) {
    assert.ok(owners.includes(`${path} @hocheunglai-oss`));
  }
});
