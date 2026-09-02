import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const devGuard = fs.readFileSync(new URL('../scripts/dev-server.mjs', import.meta.url), 'utf8');
const localServices = fs.readFileSync(new URL('../scripts/local-services.mjs', import.meta.url), 'utf8');
const qualityWorkflow = fs.readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

test('FCOS development servers are task-owned, observable, and time bounded', () => {
  assert.equal(packageJson.scripts.dev, 'node scripts/dev-server.mjs');
  assert.equal(packageJson.scripts['dev:status'], 'node scripts/dev-server.mjs status');
  assert.equal(packageJson.scripts['dev:stop'], 'node scripts/dev-server.mjs stop');
  assert.match(devGuard, /FCOS_DEV_MAX_MINUTES \?\? 120/);
  assert.match(devGuard, /projectRoot/);
  assert.match(devGuard, /process\.kill\(-Number\(state\.pid\), 'SIGTERM'\)/);
});

test('local Supabase shutdown preserves data and does not stop unrelated containers', () => {
  assert.equal(packageJson.scripts['local:services:start'], 'node scripts/local-services.mjs start');
  assert.equal(packageJson.scripts['local:services:status'], 'node scripts/local-services.mjs status');
  assert.equal(packageJson.scripts['local:services:stop'], 'node scripts/local-services.mjs stop');
  assert.match(localServices, /supabase', 'stop', '--project-id', projectId, '--yes'/);
  assert.doesNotMatch(localServices, /supabase', 'stop'[^\n]*--no-backup/);
  assert.match(localServices, /Docker Desktop remains running because other containers are active/);
});

test('CI always removes its disposable Supabase services', () => {
  assert.match(qualityWorkflow, /name: Stop temporary Supabase services[\s\S]*if: \$\{\{ always\(\) \}\}[\s\S]*supabase stop --no-backup/);
});
