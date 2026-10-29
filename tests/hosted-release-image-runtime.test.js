import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { inspectCandidateRuntime } from '../scripts/lib/hosted-release/isolation.mjs';

const image = `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${'a'.repeat(64)}`;
const runtime = { node: 'v24.18.0', platform: 'linux', arch: 'x64', python: 'Python 3.11.2', image };
function fixture({ version = '17.7', bindir = `/usr/lib/postgresql/${version.split('.')[0]}/bin`, missing, mismatch } = {}) {
  const calls = [];
  return { calls, execute(command, args, options) {
    assert.equal(command, 'docker'); assert.equal(options.encoding, 'utf8'); calls.push(args);
    if (args[0] === 'image') return JSON.stringify([{ RepoDigests: [image] }]);
    for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) assert.ok(args.includes(flag));
    const program = args.at(-2);
    if (program === 'pg_config') return args.at(-1) === '--version' ? `PostgreSQL ${version} (Debian fixture)` : bindir;
    if (args.at(-1) === '--version' && program.startsWith(bindir)) {
      const name = program.split('/').at(-1);
      if (missing === name) throw new Error('missing binary');
      return `${name} (PostgreSQL) ${mismatch === name ? '15.19' : version} (Debian fixture)`;
    }
    if (args.at(-2) === 'python3') return runtime.python;
    if (args.includes('node')) return JSON.stringify({ node: runtime.node, platform: runtime.platform, arch: runtime.arch });
    assert.fail(`Unexpected command ${JSON.stringify(args)}`);
  } };
}
test('candidate image admits matching native PG16/17 tools without changing the manifest runtime tuple', () => {
  for (const version of ['16.13', '17.7']) {
    const f = fixture({ version });
    assert.deepEqual(inspectCandidateRuntime({ image, execute: f.execute }), runtime);
    assert.equal(f.calls.filter(args => args.includes('node')).length, 1);
  }
});
test('candidate image fails before candidate installation for unsupported, missing or mismatched native PostgreSQL', () => {
  for (const patch of [{ version: '15.19' }, { version: '18.1' }, { version: '17.bad' },
    { bindir: '/tmp/foreign' }, { missing: 'initdb' }, { mismatch: 'postgres' }, { mismatch: 'psql' }]) {
    const f = fixture(patch);
    assert.throws(() => inspectCandidateRuntime({ image, execute: f.execute }), { code: 'CANDIDATE_POSTGRES_NOT_SUPPORTED' });
    assert.equal(f.calls.some(args => args.includes('npm') || args.includes('node')), false);
  }
});
test('toolchain build records actual native versions and exercises a non-root isolated database before saving', () => {
  const yaml = createRequire(import.meta.url)('js-yaml');
  const w = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-toolchain.yml', import.meta.url), 'utf8'));
  const script = w.jobs.build.steps.find(step => step.id === 'build').run;
  assert.equal(spawnSync('/bin/bash', ['-n'], { input: script }).status, 0);
  for (const marker of ['npm-version.txt', 'postgres-version.txt', 'postgres-server-version.txt', 'postgres-client-version.txt', 'postgres-smoke.txt', 'create extension pgcrypto']) assert.ok(script.includes(marker));
  assert.ok(script.indexOf('native_postgres17_pgcrypto_passed') < script.indexOf('docker save'));
  assert.ok(script.includes('--network none --read-only --cap-drop=ALL --security-opt=no-new-privileges --tmpfs'));
});
