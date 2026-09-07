import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('PR quality is read-only and blocks rather than executing an authenticated harness', async () => {
  const quality = await read('../.github/workflows/quality.yml');
  assert.match(quality, /authenticated-browser/);
  assert.match(quality, /actions: read/);
  assert.match(quality, /listWorkflowRuns/);
  assert.match(quality, /workflow_id: 'authenticated-release\.yml'/);
  assert.match(quality, /trustedWorkflowPaths = new Set/);
  assert.match(quality, /!trustedWorkflowPaths\.has\(run\.path\)/);
  assert.match(quality, /run\.head_branch !== defaultBranch/);
  assert.match(quality, /fcos-ci-evidence-\$\{sha\}/);
  assert.match(quality, /artifact\.expired !== true/);
  assert.match(quality, /No successful, non-expired trusted authenticated-candidate evidence artifact exists/);
  assert.match(quality, /must be reviewed and installed on the default branch/);
  assert.doesNotMatch(quality, /secrets\.FCOS_E2E_/);
  assert.doesNotMatch(quality, /FCOS_REQUIRE_AUTH_E2E/);
  assert.doesNotMatch(quality, /head\.repo\.full_name/);
  assert.doesNotMatch(quality, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(quality, /persist-credentials: false/);
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
  assert.match(workflow, /--trace=off --screenshot=off/);
  assert.match(workflow, /--screenshot=off/);
  assert.match(workflow, /e2e-private-state\.mjs prepare/);
  assert.match(workflow, /e2e-private-state\.mjs cleanup/);
});

test('trusted harness sources require an explicit repository owner review', async () => {
  const owners = await read('../.github/CODEOWNERS');
  for (const path of ['/.github/', '/e2e/', '/playwright.config.js', '/scripts/e2e-*.mjs', '/scripts/verify-e2e-candidate.mjs']) {
    assert.ok(owners.includes(`${path} @hocheunglai-oss`));
  }
});
