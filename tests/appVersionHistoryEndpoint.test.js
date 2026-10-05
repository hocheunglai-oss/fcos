import test from 'node:test';
import assert from 'node:assert/strict';
import appVersionHistory from '../api/app-version-history.js';
import { fcosUpdateSourceCandidates } from '../api/_fcosUpdates.js';
import { APP_VERSION } from '../src/lib/appVersionMeta.js';
import { assertCurrentReleaseHistory } from '../scripts/lib/app-version-history-guard.mjs';

test('version history is delivered separately from the initial client bundle', () => {
  const headers = new Map();
  let statusCode = null;
  let payload = null;
  const response = {
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return this; },
  };

  appVersionHistory({}, response);
  assert.equal(statusCode, 200);
  assert.match(headers.get('cache-control'), /stale-while-revalidate/);
  assert.ok(Array.isArray(payload.history));
  assert.ok(payload.history.length > 0);
  const release = assertCurrentReleaseHistory(APP_VERSION, payload.history);
  const updateCandidates = fcosUpdateSourceCandidates(payload.history, release.releasedAt)
    .filter((candidate) => candidate.source_version === APP_VERSION);
  assert.equal(updateCandidates.length, release.changes.length);
  assert.ok(updateCandidates.every((candidate) => /^[a-f0-9]{64}$/.test(candidate.source_hash)));
});

test('version writing rejects missing or unusable current release copy', () => {
  const valid = { version: APP_VERSION, releasedAt: '2026-09-30', title: 'A released improvement', changes: ['Explains the completed change to FCOS users.'] };
  assert.equal(assertCurrentReleaseHistory(APP_VERSION, [valid]), valid);
  assert.throws(() => assertCurrentReleaseHistory(APP_VERSION, []), /exactly one release-history entry/);
  assert.throws(() => assertCurrentReleaseHistory(APP_VERSION, [valid, valid]), /exactly one release-history entry/);
  assert.throws(() => assertCurrentReleaseHistory(APP_VERSION, [{ ...valid, version: 'future-candidate' }, valid]), /first release-history entry/);
  for (const invalid of [
    { ...valid, releasedAt: '2026-09-31' },
    { ...valid, title: '   ' },
    { ...valid, changes: [] },
    { ...valid, changes: ['   '] },
  ]) assert.throws(() => assertCurrentReleaseHistory(APP_VERSION, [invalid]), /valid release date, title, and non-empty change text/);
});
