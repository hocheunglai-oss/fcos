import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_ROOT = join(SOURCE_ROOT, 'tests/fixtures/runtime-compatibility-successor-integration');
export const MANIFEST_HASH = '8cb6ecd4be8b5a62576e1142242df1c22dcd27678580b69b6404419eeb6d144d';
export const PACK_HASH = 'edb0c7a0d0ac7f45dba5fcfc8f6d98cbbf9667f01713a5d7f7764dc7e7380628';
const BINDINGS_HASH = '45544b75bf83a1ebfb8f4a636bbf164cae73b63429d0f8e5f2d388be6fd4e608';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function regularFile(root, path) {
  const parts = path.split('/');
  assert.ok(!path.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(path)
    && parts.every(part => part && !['.', '..'].includes(part)), 'Exact relative source path required.');
  for (let index = 1; index <= parts.length; index++) {
    const info = fs.lstatSync(join(root, ...parts.slice(0, index)));
    assert.ok(!info.isSymbolicLink() && (index === parts.length ? info.isFile() : info.isDirectory()), `Regular source path required: ${path}`);
  }
  return fs.readFileSync(join(root, path));
}
const historicalManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v2.json');
assert.equal(hash(historicalManifestBytes), '91e8ba3fdacb7cd03a2bed574248920a2d6416aa043c4e5daafd7a5f5ac53257', 'Historical public manifest differs.');
const historicalManifest = JSON.parse(historicalManifestBytes);
const thirdManifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v3.json');
assert.equal(hash(thirdManifestBytes), '7335cb2d1482974c9dda3ee5552bcfc07befc5422329f0c0b2bc246635c4a71a', 'Third public manifest differs.');
const historicalBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v2.json');
assert.equal(hash(historicalBindingBytes), 'e83c88a3b42d2252c3462f9ed4ce7d5a3c7d6b0d6bf6d8879ec1502d5054e126', 'Historical source bindings differ.');
const previousBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v3.json');
assert.equal(hash(previousBindingBytes), 'f380529fc56450a521ac2d83dc0d8b4de55b05a40f7f1e7835c47db7662fb3cb', 'Previous source bindings differ.');
assert.equal(JSON.parse(previousBindingBytes).previousSourceBindingsSha256, hash(historicalBindingBytes), 'Historical binding chain differs.');
const fourthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v4.json');
assert.equal(hash(fourthBindingBytes), 'd425a033ca56ca867f8b36e5d0d68b1e313280c2d15933b2b4d6b4549695c992', 'Fourth source bindings differ.');
assert.equal(JSON.parse(fourthBindingBytes).previousSourceBindingsSha256, hash(previousBindingBytes), 'Fourth binding history differs.');
const fifthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v5.json');
assert.equal(hash(fifthBindingBytes), 'fcbd9735f0813d1e5fcb94cc69786b2363e6013d8ccf6fcf0cd62465acf41b63', 'Fifth source bindings differ.');
assert.equal(JSON.parse(fifthBindingBytes).previousSourceBindingsSha256, hash(fourthBindingBytes), 'Fifth binding history differs.');
const sixthBindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v6.json');
assert.equal(hash(sixthBindingBytes), '9f12806a65cd820a0752974b01ddb003cc6380dd4524039e1c1e8d7b78798c97', 'Sixth source bindings differ.');
assert.equal(JSON.parse(sixthBindingBytes).previousSourceBindingsSha256, hash(fifthBindingBytes), 'Sixth binding history differs.');
const bindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings-v7.json');
assert.equal(hash(bindingBytes), BINDINGS_HASH, 'Reviewed source bindings differ.');
export const sourceBindings = JSON.parse(bindingBytes);
assert.equal(sourceBindings.previousSourceBindingsSha256, hash(sixthBindingBytes), 'Previous source binding history differs.');
const rows = new Map(sourceBindings.sources.map(row => [row.path, row]));
assert.equal(rows.size, sourceBindings.sources.length, 'Duplicate source binding.');
export function assertBoundSource(path, bytes) {
  const row = rows.get(path);
  assert.ok(row, `Unreviewed source path: ${path}`);
  assert.equal(bytes.length, row.byteLength, `Bound source length differs: ${path}`);
  assert.equal(hash(bytes), row.sha256, `Bound source hash differs: ${path}`);
}
export function validateSourceBindings() {
  for (const row of rows.values()) assertBoundSource(row.path, regularFile(SOURCE_ROOT, row.path));
}
export function validatePublicManifest(bytes) {
  assert.equal(hash(bytes), MANIFEST_HASH, 'Immutable public manifest differs.');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.previousManifestSha256, hash(thirdManifestBytes), 'Public manifest history differs.');
  assert.deepEqual(manifest.objects, historicalManifest.objects, 'Immutable packed objects differ.');
  assert.deepEqual(manifest.observationBindings, historicalManifest.observationBindings, 'Immutable observation bindings differ.');
  assert.deepEqual(manifest.pack, historicalManifest.pack, 'Immutable public pack differs.');
  assert.equal(manifest.pack.count, 272);
  assert.equal(manifest.objects.length, 272);
  assert.equal(new Set(manifest.objects.map(row => row.oid)).size, 272);
  assert.equal(manifest.pack.byteLength, 552150);
  assert.equal(manifest.pack.sha256, PACK_HASH);
  for (const member of manifest.members) {
    const path = member.path.startsWith('checkout/') ? member.path.slice('checkout/'.length) : member.path;
    const bytes = regularFile(member.path.startsWith('checkout/') ? SOURCE_ROOT : FIXTURE_ROOT, path);
    assert.equal(bytes.length, member.byteLength, `Public member length differs: ${path}`);
    assert.equal(hash(bytes), member.sha256, `Public member hash differs: ${path}`);
  }
  return manifest;
}
export const manifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v4.json');
export const manifest = validatePublicManifest(manifestBytes);
export const pack = regularFile(FIXTURE_ROOT, 'objects-v2.pack');
assert.equal(pack.length, 552150); assert.equal(hash(pack), PACK_HASH);
// Run before any test body or module evaluation. All source is the actual
// repository source; no historical checkout/module copies are versioned here.
validateSourceBindings();
export function copyBoundSource(targetRoot, path, targetPath = path) {
  const bytes = regularFile(SOURCE_ROOT, path); assertBoundSource(path, bytes);
  const destination = join(targetRoot, targetPath);
  assert.ok(!relative(targetRoot, destination).startsWith('..'), 'Temporary copy escaped fixture root.');
  fs.mkdirSync(dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}
export const cleanGitEnvironment = () => ({ PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });

const CONTROL_MANIFEST_HASH = '635b20628f0e43f9ded35b6a64dbfed7610b17454302288dd29927a3cd9da7fc';
export const controlManifestBytes = regularFile(FIXTURE_ROOT, 'control-objects-v1.json');
export function validateControlManifest(bytes) {
  assert.equal(hash(bytes), CONTROL_MANIFEST_HASH, 'Frozen control supplement manifest differs.');
  const value = JSON.parse(bytes);
  assert.equal(value.pack.count, 3); assert.equal(value.objects.length, 3);
  assert.equal(new Set(value.objects.map(row => row.oid)).size, 3);
  assert.equal(value.mandatoryCandidateControls.length, 13);
  assert.equal(new Set(value.mandatoryCandidateControls.map(row => row.path)).size, 13);
  assert.equal(value.original272PackSha256, PACK_HASH);
  return value;
}
export const controlManifest = validateControlManifest(controlManifestBytes);
export const controlPack = regularFile(FIXTURE_ROOT, controlManifest.pack.path);
assert.equal(controlPack.length, controlManifest.pack.byteLength); assert.equal(hash(controlPack), controlManifest.pack.sha256);

// Only fresh disposable test repositories call this helper. Both immutable
// public carriers are consumed by native Git with no alternates or fetch.
export function installPortableObjects(cwd) {
  assert.equal(fs.existsSync(join(cwd, '.git/objects/info/alternates')), false);
  const git = (args, input) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, input, env: cleanGitEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)']).length, 0, 'Empty fixture object store required.');
  git(['index-pack', '--stdin'], pack);
  const count = () => git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)']).toString().trim().split('\n').length;
  assert.equal(count(), 272);
  for (const row of manifest.objects) {
    assert.equal(git(['cat-file', '-t', row.oid]).toString().trim(), row.type);
    const bytes = git(['cat-file', row.type, row.oid]);
    assert.equal(bytes.length, row.byteLength); assert.equal(hash(bytes), row.sha256);
  }
  git(['index-pack', '--stdin'], controlPack); assert.equal(count(), 275);
  for (const row of controlManifest.objects) {
    assert.equal(row.type, 'blob'); assert.equal(git(['cat-file', '-t', row.oid]).toString().trim(), 'blob');
    const bytes = git(['cat-file', 'blob', row.oid]);
    assert.equal(bytes.length, row.byteLength); assert.equal(hash(bytes), row.sha256);
  }
  for (const row of controlManifest.mandatoryCandidateControls) {
    const tree = git(['ls-tree', controlManifest.candidateSha, '--', row.path]).toString().trim();
    assert.equal(tree, `${row.mode} blob ${row.oid}\t${row.path}`);
    const bytes = git(['show', `${controlManifest.candidateSha}:${row.path}`]);
    assert.equal(bytes.length, row.byteLength); assert.equal(hash(bytes), row.sha256);
  }
  // This existing current public file is byte-identical to its frozen04ee
  // signer blob. Authenticate it through the current-source binding and the
  // candidate raw tree OID, without expanding either immutable carrier.
  const signerPath = 'api/_emailRouterHandlers.js';
  const signerBytes = regularFile(SOURCE_ROOT, signerPath);
  assertBoundSource(signerPath, signerBytes);
  const signerOid = git(['rev-parse', `${controlManifest.candidateSha}:${signerPath}`]).toString().trim();
  assert.equal(signerOid, '5429dc7062ea2a14155a99915b20176801a66449');
  assert.equal(hash(signerBytes), '4d3e301b18fba542e9cb8adc982a7653f0f338c704501780df9b146698a644ee');
  assert.equal(git(['hash-object', '-w', '--stdin'], signerBytes).toString().trim(), signerOid);
  assert.equal(count(), 276);
}
