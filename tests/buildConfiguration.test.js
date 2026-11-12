import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('local, CI, and Vercel builds use the same Node major and deterministic installs', async () => {
  const [packageJson, workflow, vercelConfig, nvmrc, authenticatedWorkflow] = await Promise.all([
    readSource('../package.json').then(JSON.parse),
    readSource('../.github/workflows/quality.yml'),
    readSource('../vercel.json').then(JSON.parse),
    readSource('../.nvmrc'),
    readSource('../.github/workflows/authenticated-release.yml'),
  ]);
  assert.equal(packageJson.engines.node, '24.x');
  assert.deepEqual([...(workflow + authenticatedWorkflow).matchAll(/node-version:\s*(\d+)/g)].map((match) => match[1]), ['24', '24']);
  assert.equal(vercelConfig.installCommand, 'npm ci');
  assert.equal(vercelConfig.git.deploymentEnabled, false, 'All Git-triggered deployments are fenced; the qualified release controller stages the artifact');
  assert.deepEqual(vercelConfig.regions, ['sin1']);
  assert.equal(nvmrc.trim(), '24');
});

test('build diagnostics stay visible and global border styling does not generate invalid selectors', async () => {
  const [viteConfig, stylesheet] = await Promise.all([
    readSource('../vite.config.js'),
    readSource('../src/index.css'),
  ]);
  assert.match(viteConfig, /logLevel:\s*'warn'/);
  assert.doesNotMatch(stylesheet, /@apply\s+border-border/);
  assert.match(stylesheet, /border-color:\s*hsl\(var\(--border\)\)/);
});

test('removed packages are absent from direct dependencies', async () => {
  const packageJson = JSON.parse(await readSource('../package.json'));
  const removed = [
    '@hookform/resolvers',
    '@radix-ui/react-toast',
    '@stripe/react-stripe-js',
    '@stripe/stripe-js',
    'canvas-confetti',
    'framer-motion',
    'html2canvas',
    'lodash',
    'moment',
    'quill-delta',
    'react-leaflet',
    'react-markdown',
    'three',
  ];
  for (const dependency of removed) assert.equal(packageJson.dependencies?.[dependency], undefined);
});

test('Vite checks resolved browser Supabase configuration before bundling', () => {
  const url = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
  const secret = 'sb_secret_synthetic_fixture';
  const publicKey = 'sb_publishable_synthetic_fixture';
  const resolve = (env, command = 'build') => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { resolveConfig } from 'vite'; await resolveConfig({}, '${command}', '${command === 'build' ? 'production' : 'development'}');`], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  for (const env of [
    { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: secret },
    { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: publicKey, VITE_SUPABASE_PUBLISHABLE_KEY: secret },
    { VITE_SUPABASE_URL: 'https://other.supabase.co', VITE_SUPABASE_ANON_KEY: publicKey },
  ]) {
    const result = resolve(env);
    assert.equal(result.status, 1, result.error?.message);
    assert.match(result.stderr, /Invalid FCOS browser configuration/);
    assert.ok(!result.stderr.includes(secret));
  }
  assert.equal(resolve({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: publicKey }).status, 0);
  assert.equal(resolve({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: publicKey }, 'serve').status, 0);
  assert.equal(resolve({}).status, 0);
});

test('the Supabase client uses the publishable key and retains the legacy fallback', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createServer } from 'vite';
    const publishableKey = 'sb_publishable_current_fixture';
    const legacyKey = 'sb_publishable_legacy_fixture';
    for (const [current, legacy, expected] of [
      [publishableKey, '', publishableKey],
      [publishableKey, legacyKey, publishableKey],
      ['', legacyKey, legacyKey],
    ]) {
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY = current;
      process.env.VITE_SUPABASE_ANON_KEY = legacy;
      const server = await createServer({
        envDir: false, server: { middlewareMode: true, watch: null, ws: false },
      });
      try {
        const client = await server.ssrLoadModule('/src/lib/supabaseClient.js');
        assert.equal(client.isSupabaseConfigured, true);
        assert.equal(client.supabase.supabaseKey, expected);
      } finally {
        await server.close();
      }
    }
  `], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      VITE_SUPABASE_URL: `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});
