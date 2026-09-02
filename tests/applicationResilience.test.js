import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const layoutSource = fs.readFileSync(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
const boundarySource = fs.readFileSync(new URL('../src/components/WorkspaceErrorBoundary.jsx', import.meta.url), 'utf8');

test('unexpected rendering failures are isolated at application and page scope', () => {
  assert.match(appSource, /<WorkspaceErrorBoundary[\s\S]*scope="application"/);
  assert.match(layoutSource, /<WorkspaceErrorBoundary[\s\S]*scope="page"/);
  assert.match(boundarySource, /static getDerivedStateFromError/);
  assert.match(boundarySource, /componentDidCatch/);
  assert.match(boundarySource, /previousProps\.resetKey !== this\.props\.resetKey/);
  assert.match(boundarySource, /role="alert"/);
  assert.match(boundarySource, /Try Again/);
  assert.match(boundarySource, /Go to Dashboard/);
  assert.match(boundarySource, /Reload FCOS/);
});

test('render failure telemetry excludes error messages and component stacks', () => {
  assert.match(boundarySource, /safeErrorName\(error\)/);
  assert.doesNotMatch(boundarySource, /error\?\.message/);
  assert.doesNotMatch(boundarySource, /componentStack/);
});

test('the application shell provides a keyboard skip link and focus target', () => {
  assert.match(layoutSource, /href="#fcos-main-content"/);
  assert.match(layoutSource, />\s*Skip to main content\s*<\/a>/);
  assert.match(layoutSource, /<main id="fcos-main-content" tabIndex=\{-1\}/);
});
