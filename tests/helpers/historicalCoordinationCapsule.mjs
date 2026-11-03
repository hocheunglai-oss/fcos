// Offline historical codec replay only. This fixture cannot qualify a release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const hash = b => createHash('sha256').update(b).digest('hex');
export async function historicalCoordinationCapsule(t) {
  const bytes = readFileSync(new URL('../fixtures/coordination-backend-actual/historical-controller-capsule.json', import.meta.url));
  assert.equal(hash(bytes), '755213126e89bc16d90b5e1fd5d07ab07a8d888a719c40805ef07e1fb5ff3693');
  const envelope = JSON.parse(bytes), raw = gunzipSync(Buffer.from(envelope.data, 'base64'), { maxOutputLength: 8 * 1024 * 1024 });
  assert.equal(hash(raw), envelope.payloadSha256);
  const fixture = JSON.parse(raw);
  assert.equal(fixture.controller, '64aa338b04cee7e05bde0ca9bfd10b81ac001a65');
  assert.equal(fixture.executionAuthority, false); assert.equal(fixture.historicalOnly, true);
  assert.equal(fixture.files.length, 41);
  const root = mkdtempSync(path.join(tmpdir(), 'fcos-historical-codec-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const row of fixture.files) {
    const target = path.resolve(root, row.path), body = Buffer.from(row.base64, 'base64');
    assert.ok(target.startsWith(root + path.sep)); assert.equal(body.length, row.bytes); assert.equal(hash(body), row.sha256);
    assert.equal(createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'), row.blob);
    assert.ok(['100644', '100755'].includes(row.mode));
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, body, { flag: 'wx' }); chmodSync(target, row.mode === '100755' ? 0o755 : 0o644);
  }
  const currentRoot = fileURLToPath(new URL('../../', import.meta.url));
  const installedLock = JSON.parse(readFileSync(path.join(currentRoot, 'package-lock.json')));
  const originalLockBytes = readFileSync(path.join(root, 'package-lock.json'));
  assert.equal(hash(originalLockBytes), fixture.dependencies.originalLockSha256);
  const originalLock = JSON.parse(originalLockBytes);
  assert.equal(fixture.dependencies.packageEntries.length, 274);
  for (const row of fixture.dependencies.packageEntries) {
    assert.deepEqual(originalLock.packages[row.path], row.entry);
    assert.deepEqual(installedLock.packages[row.path], row.entry, 'Historical collector dependency changed: ' + row.path);
  }
  symlinkSync(path.join(currentRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const collector = await import(pathToFileURL(path.join(root, 'scripts/lib/preview-email-coordination-action.mjs')).href);
  return { collector, backend: fixture.backend };
}
