import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_ROOT = join(SOURCE_ROOT, 'tests/fixtures/runtime-compatibility-successor-integration');
export const MANIFEST_HASH = '91e8ba3fdacb7cd03a2bed574248920a2d6416aa043c4e5daafd7a5f5ac53257';
export const PACK_HASH = 'edb0c7a0d0ac7f45dba5fcfc8f6d98cbbf9667f01713a5d7f7764dc7e7380628';
const BINDINGS_HASH = '4e33b8b42a002cc46fde0fce41679417f25c58474cf474ca78af753c9b88e379';
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
const bindingBytes = regularFile(FIXTURE_ROOT, 'source-bindings.json');
assert.equal(hash(bindingBytes), BINDINGS_HASH, 'Reviewed source bindings differ.');
export const sourceBindings = JSON.parse(bindingBytes);
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
export const manifestBytes = regularFile(FIXTURE_ROOT, 'fixture-manifest-v2.json');
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
