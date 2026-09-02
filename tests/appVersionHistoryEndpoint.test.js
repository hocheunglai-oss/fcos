import test from 'node:test';
import assert from 'node:assert/strict';
import appVersionHistory from '../api/app-version-history.js';

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
});
