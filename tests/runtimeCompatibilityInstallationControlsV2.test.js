import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SOURCE_ROOT, FIXTURE_ROOT, installationControls, installationControlsV2, installationV2ManifestBytes,
  installationControlSource, installationCurrentV2Body, validateInstallationControlsV2, sourceBindings, validateSourceBindings,
  assertBoundSource, hash, cleanGitEnvironment } from './helpers/runtimeCompatibilitySuccessorPortable.mjs';

const packed = readFileSync(join(FIXTURE_ROOT, 'installation-controls-v2.pack'));

test('cheap fixture preflight keeps the original supplement and complete case body immutable', () => {
  validateSourceBindings();
  assert.equal(installationControls.sources.length, 8);
  for (const [path, expected] of [
    ['installation-controls-v1.json', '264a4d0e71fbee494b1e610fa2517a443c9f073501efd23fa848d8305e0c5030'],
    ['installation-controls-v1.pack', '0ec3ae9fa1a643f76d00fc5f35c27919ed08bdbb6e375e45fe9b378f09cabe53'],
    ['source-bindings-v26.json', '75207edeeba173c6bee65c72a74ced848da8c8c13d8b476ffda7d8074621fceb'],
  ]) assert.equal(hash(readFileSync(join(FIXTURE_ROOT, path))), expected);
  assert.equal(hash(readFileSync(join(SOURCE_ROOT, 'tests/runtimeCompatibilitySuccessorLive.historical.mjs'))),
    '9a76061a46773c0b1ffdd3d86dbfb08d730387ce0c80fab24118b34a86ff8dfc');
});

test('v2 substitutes only the already-bound config with exact retained and current pins', () => {
  assert.deepEqual(installationControlsV2.sources.map(row => row.path), ['config/fcosConnections.js']);
  const entry = installationControlsV2.sources[0], current = installationCurrentV2Body();
  const actual = readFileSync(join(SOURCE_ROOT, entry.path)), actualHash=hash(actual);
  assert.ok(sourceBindings.sources.some(row => row.path === entry.path && row.sha256 === entry.sha256));
  assert.equal(current.length, entry.currentByteLength); assert.equal(hash(current), entry.currentSha256);
  const retained = installationControlSource(entry.path, current);
  assertBoundSource(entry.path, retained); assert.equal(hash(retained), entry.sha256);
  assert.notEqual(hash(retained), hash(current));
  assert.equal(hash(installationControlSource(entry.path, retained)), entry.sha256);
  retained[0] ^= 1;
  assert.equal(hash(installationControlSource(entry.path, current)), entry.sha256, 'Returned bytes cannot mutate retained evidence.');
  assert.equal(hash(installationControlSource(entry.path, actual)), entry.sha256, 'Actual current config is separately source-bound.');
  assert.equal(hash(readFileSync(join(SOURCE_ROOT, entry.path))), actualHash, 'Actual executing config stays current.');
  assert.throws(() => { entry.currentSha256 = entry.sha256; }, TypeError);
  assert.throws(() => installationControlSource('api/_deploymentReadOnly.js', readFileSync(join(SOURCE_ROOT, 'api/_deploymentReadOnly.js'))), /Unreviewed source path/);
});

test('changed current bytes, manifest, pack and truncated pack fail closed', () => {
  const entry = installationControlsV2.sources[0], current = readFileSync(join(SOURCE_ROOT, entry.path));
  const sameLength = Buffer.from(current); sameLength[0] ^= 1;
  for (const bytes of [sameLength, Buffer.concat([current, Buffer.from('\n')])])
    assert.throws(() => installationControlSource(entry.path, bytes), /Unreviewed current installation control/);
  const changedManifest = JSON.parse(installationV2ManifestBytes); changedManifest.sources.push({ ...entry, path: 'api/_deploymentReadOnly.js' });
  assert.throws(() => validateInstallationControlsV2(Buffer.from(JSON.stringify(changedManifest)), packed), /Installation v2 supplement differs/);
  const corrupted = Buffer.from(packed); corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => validateInstallationControlsV2(installationV2ManifestBytes, corrupted), /Installation v2 pack differs/);
  assert.throws(() => validateInstallationControlsV2(installationV2ManifestBytes, packed.subarray(0, -1)), /Installation v2 pack length differs/);
});

test('the non-thin v2 carrier contains exactly its one retained config blob without shared objects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-v2-installation-pack-'));
  const git = (args, input) => execFileSync('git', ['--no-replace-objects', ...args], {
    cwd: directory, input, env: cleanGitEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    git(['-c', 'init.templateDir=', 'init', '--bare', '--quiet']);
    git(['index-pack', '--stdin'], packed);
    const entry = installationControlsV2.sources[0];
    assert.deepEqual(git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']).toString().trim().split('\n'), [`${entry.oid} blob`]);
    assertBoundSource(entry.path, git(['cat-file', 'blob', entry.oid]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
