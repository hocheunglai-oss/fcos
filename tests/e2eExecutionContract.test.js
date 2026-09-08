import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const cleanEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(FCOS_E2E_|FCOS_REQUIRE_AUTH_E2E$)/.test(key)));

test('the actual workflow Playwright arguments collect tests without a browser, credential or server', async () => {
  const source = await readFile(new URL('../.github/workflows/authenticated-release.yml', import.meta.url), 'utf8');
  const args = source.match(/run: npm run test:e2e -- ([^\n]+)/)?.[1].trim().split(/\s+/);
  assert.deepEqual(args, ['--trace=off']);
  const run = spawnSync(process.execPath, [cli, 'test', '--list', ...args], {
    cwd: root, env: cleanEnv, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /api-denials\.spec\.js/);
  assert.match(run.stdout, /dashboard\.spec\.js/);
});

test('the governed CI run collects only its read-only suites and renewable authentication dependency', () => {
  const run = spawnSync(process.execPath, [cli, 'test', '--list', '--trace=off'], {
    cwd: root,
    env: { ...cleanEnv, FCOS_REQUIRE_AUTH_E2E: '1', FCOS_E2E_EMAIL: 'synthetic',
      FCOS_E2E_PASSWORD: 'synthetic', FCOS_E2E_STORAGE_STATE: '/synthetic/auth.json' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const collectedFiles = [...new Set([...run.stdout.matchAll(/([\w-]+\.(?:spec|setup)\.js):\d+/g)].map((match) => match[1]))].sort();
  assert.deepEqual(collectedFiles, ['api-denials.spec.js', 'auth.setup.js', 'dashboard.spec.js', 'workspace-smoke.spec.js']);
  assert.match(run.stdout, /Payment Collections is denied/);
  assert.match(run.stdout, /Special Terms is denied/);
  assert.doesNotMatch(run.stdout, /payment-reminders\.spec\.js|special-terms\.spec\.js/);
});

test('authenticated browser projects disable screenshots, traces and video through supported configuration', () => {
  for (const authEnv of [
    { FCOS_REQUIRE_AUTH_E2E: '1' },
    { FCOS_E2E_STORAGE_STATE: '/synthetic/auth.json' },
    { FCOS_E2E_EMAIL: 'synthetic', FCOS_E2E_PASSWORD: 'synthetic' },
    {},
  ]) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import c from './playwright.config.js'; console.log(JSON.stringify(c.projects.map(p=>({...c.use,...p.use})).map(({screenshot,trace,video})=>({screenshot,trace,video}))));"],
    { cwd: root, env: { ...cleanEnv, ...authEnv }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(run.status, 0, run.stderr);
    for (const project of JSON.parse(run.stdout)) {
      assert.deepEqual(project, { screenshot: Object.keys(authEnv).length ? 'off' : 'only-on-failure', trace: 'off', video: 'off' });
    }
  }
});
