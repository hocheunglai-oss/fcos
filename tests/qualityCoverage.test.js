import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('React lint includes every FCOS application source file', async () => {
  const eslint = await read('../eslint.config.js');
  assert.match(eslint, /"src\/\*\*\/\*\.\{js,mjs,cjs,jsx\}"/);
  assert.doesNotMatch(eslint, /ignores:\s*\["src\/lib\/\*\*\/\*", "src\/components\/ui\/\*\*\/\*"\]/);
  assert.match(eslint, /"react-hooks\/rules-of-hooks": "error"/);
});

test('type checking describes and expands its real JavaScript coverage', async () => {
  const [editorTypes, coreTypes] = await Promise.all([
    read('../jsconfig.json'),
    read('../jsconfig.core.json'),
  ]);
  assert.match(editorTypes, /checkJs:false\s*\/\/ must not be presented as JavaScript type coverage/);
  assert.match(editorTypes, /"include": \["src\/\*\*\/\*\.ts"\]/);
  assert.match(coreTypes, /"checkJs": true/);
  for (const path of [
    'src/lib/accountDisplay.js',
    'src/lib/workNotificationGroups.js',
  ]) assert.match(coreTypes, new RegExp(`"${path}"`));
});

test('local API-backed development and browser CI are candidate-bound', async () => {
  const [readme, workflow, candidateVerifier, authSetup, workspaceSmoke, trustedWorkflow] = await Promise.all([
    read('../README.md'),
    read('../.github/workflows/quality.yml'),
    read('../scripts/verify-e2e-candidate.mjs'),
    read('../e2e/auth.setup.js'),
    read('../e2e/workspace-smoke.spec.js'),
    read('../.github/workflows/authenticated-release.yml'),
  ]);
  assert.match(readme, /npm ci/);
  assert.match(readme, /npm run dev:full/);
  assert.match(readme, /npm run dev:ui.*only the Vite UI/);
  assert.match(readme, /never silently replaced by a production smoke test/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /const sha = context.payload.pull_request.head.sha/);
  assert.match(workflow, /fcos-ci-evidence-/);
  assert.match(trustedWorkflow, /FCOS_E2E_CANDIDATE_URL: \$\{\{ inputs.candidate_url \}\}/);
  assert.match(trustedWorkflow, /FCOS_E2E_EXPECTED_COMMIT: \$\{\{ inputs.expected_commit \}\}/);
  assert.match(trustedWorkflow, /FCOS_REQUIRE_AUTH_E2E: 1/);
  assert.match(trustedWorkflow, /Verify the exact immutable candidate before test authentication/);
  assert.match(trustedWorkflow, /node scripts\/verify-e2e-candidate\.mjs/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(trustedWorkflow, /Authenticated browser verification is disabled/);
  assert.doesNotMatch(workflow, /FCOS_E2E_BASE_URL: https:\/\/fcos\.fcuno\.com/);
  assert.match(candidateVerifier, /fcosConnectionIdentifier\('vercel', 'Project'\)/);
  assert.match(candidateVerifier, /fcosConnectionIdentifier\('vercel', 'Team'\)/);
  assert.match(candidateVerifier, /redirect: 'error'/);
  assert.match(candidateVerifier, /\^\[a-z0-9\]\{9\}\$/);
  assert.match(candidateVerifier, /deployments\?sha=/);
  assert.match(candidateVerifier, /environment=Preview/);
  assert.match(candidateVerifier, /GITHUB_ENV/);
  assert.match(candidateVerifier, /app-version\.json/);
  assert.match(authSetup, /FCOS_CONNECTION_POLICY\.integrations\.fcunoIdentityFederation\.issuer/);
  assert.match(authSetup, /Continue with FCUNO/);
  assert.match(authSetup, /assertFcunoAdminLocation\(page\);\n  await page\.getByLabel\('Username', \{ exact: true \}\)\.fill\(email\)/);
  assert.match(authSetup, /assertFcunoAdminLocation\(page\);\n  await page\.getByLabel\('Password', \{ exact: true \}\)\.fill\(password\)/);
  assert.match(authSetup, /assertFcunoAdminLocation\(page\);[\s\S]*page\.getByRole\('button', \{ name: 'Login', exact: true \}\)\.click\(\)/);
  assert.match(authSetup, /page\.context\(\)\.storageState/);
  assert.doesNotMatch(authSetup, /signInWithPassword|page\.getByLabel\('Email'\)\.fill/);
  assert.match(workspaceSmoke, /login delegates to the pinned FCUNO identity issuer/);
  assert.match(workspaceSmoke, /Continue with FCUNO/);
});
