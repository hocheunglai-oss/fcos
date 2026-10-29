import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  for (const [name, source] of [['quality', workflow], ['authenticated-release', authenticatedWorkflow]]) {
    const versions = [...source.matchAll(/node-version:\s*(\d+)/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, `${name} must explicitly select its Node runtime`);
    assert.ok(versions.every((version) => version === '24'), `${name} jobs must all use the admitted Node major`);
  }
  assert.equal(vercelConfig.installCommand, 'npm ci');
  assert.equal(vercelConfig.git.deploymentEnabled.main, false, 'Production deployment follows release verification, not an automatic main merge');
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
