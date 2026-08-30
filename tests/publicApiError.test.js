import test from 'node:test';
import assert from 'node:assert/strict';
import { publicApiErrorPayload } from '../api/_publicApiError.js';

test('public API errors redact unexpected server messages and retain request references', () => {
  assert.deepEqual(publicApiErrorPayload(new Error('database credential leaked'), 500, 'request-1'), {
    error: 'FCOS could not complete this operation. Use the request reference when reporting the problem.',
    message: 'FCOS could not complete this operation. Use the request reference when reporting the problem.',
    code: 'FCOS_INTERNAL_ERROR',
    requestId: 'request-1',
  });
});

test('public API errors clone conflict details and retain the compatibility current field', () => {
  const details = { current: { revision: 3 } };
  const result = publicApiErrorPayload(Object.assign(new Error('Reload first.'), { code: 'stale write', details }), 409, 'request-2');
  details.current.revision = 4;
  assert.equal(result.error, 'Reload first.');
  assert.equal(result.code, 'STALE_WRITE');
  assert.equal(result.details.current.revision, 3);
  assert.equal(result.current.revision, 4);
});
