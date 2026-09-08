import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('local, CI, and Vercel builds use the same Node major and deterministic installs', async () => {
  const [packageJson, workflow, authenticatedWorkflow, vercelConfig, nvmrc] = await Promise.all([
    readSource('../package.json').then(JSON.parse),
    readSource('../.github/workflows/quality.yml'),
    readSource('../.github/workflows/authenticated-release.yml'),
    readSource('../vercel.json').then(JSON.parse),
    readSource('../.nvmrc'),
  ]);
  assert.equal(packageJson.engines.node, '24.x');
  for (const source of [workflow, authenticatedWorkflow]) {
    assert.deepEqual([...source.matchAll(/node-version:\s*(\d+)/g)].map((match) => match[1]), ['24']);
    assert.match(source, /run: npm ci/);
  }
  assert.equal(vercelConfig.installCommand, 'npm ci');
  assert.equal(vercelConfig.git.deploymentEnabled.main, false, 'main merges must not replace Production before release verification');
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
