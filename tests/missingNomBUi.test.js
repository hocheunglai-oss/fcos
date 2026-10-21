import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPendingUpload, createUploadAttempt, displayNomBDate, fingerprintNomBFile, initialPagination, isDefiniteNoWrite, isProvenNoWriteForOperation, isVerifiedUpload, listPayload, paginationReducer, persistPendingUpload, recoverPendingUpload, validateNomBFile } from '../src/lib/missingNomB.js';

const file = (name, size) => ({ name, size });
const fingerprint = 'a'.repeat(64);
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('Nom B selection enforces the decoded 3 MiB cap and allowed file types', () => {
  assert.equal(validateNomBFile(file('nom-b.PDF', 3 * 1024 * 1024)), null);
  assert.equal(validateNomBFile(file('nom-b.docx', 50)), null);
  assert.match(validateNomBFile(file('nom-b.pdf', 3 * 1024 * 1024 + 1)), /3 MiB/);
  assert.match(validateNomBFile(file('nom-b.exe', 50)), /PDF/);
  assert.match(validateNomBFile(file('nom-b.pdf', 0)), /empty/);
});

test('the same selected file and nomination retain their operation ID for uncertain retries', () => {
  const selected = file('nom-b.pdf', 100);
  let ids = 0;
  const idFactory = () => `operation-${++ids}`;
  const first = createUploadAttempt({ nominationId: 'nomination-1', file: selected, fingerprint, idFactory });
  const retry = createUploadAttempt({ nominationId: 'nomination-1', file: selected, fingerprint, previous: first, idFactory });
  assert.equal(retry, first);
  assert.equal(ids, 1);
  const differentFile = createUploadAttempt({ nominationId: 'nomination-1', file: file('nom-b.pdf', 100), fingerprint: 'b'.repeat(64), previous: first, idFactory });
  assert.notEqual(differentFile.operationId, first.operationId);
  assert.equal(ids, 2);
  assert.throws(() => createUploadAttempt({ nominationId: 'nomination-1', file: file('bad.exe', 100), fingerprint, idFactory }), /PDF/);
  assert.equal(ids, 2);
});

test('SHA-256 recovery reuses only the same bytes, nomination and file identity after reload', async () => {
  const makeFile = (text) => ({ name: 'nom-b.pdf', size: text.length, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
  const original = makeFile('Buyer Nom B');
  const digest = await fingerprintNomBFile(original);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const attempt = createUploadAttempt({ nominationId: 'nomination-1', file: original, fingerprint: digest, idFactory: () => 'operation-1' });
  const session = storage();
  persistPendingUpload(session, attempt, { stemName: 'STEM-1' });
  const saved = recoverPendingUpload(session);
  assert.equal(saved.operationId, 'operation-1');
  assert.equal(saved.stemName, 'STEM-1');
  assert.equal(JSON.stringify(saved).includes('Buyer Nom B'), false);
  const reselected = makeFile('Buyer Nom B');
  const recovered = createUploadAttempt({ nominationId: 'nomination-1', file: reselected, fingerprint: await fingerprintNomBFile(reselected), pending: saved, idFactory: () => { throw new Error('new ID forbidden'); } });
  assert.equal(recovered.operationId, attempt.operationId);
  assert.throws(() => createUploadAttempt({ nominationId: 'nomination-1', file: makeFile('Other Nom B'), fingerprint: 'b'.repeat(64), pending: saved, idFactory: () => 'new' }), /does not match/);
  clearPendingUpload(session, 'different-operation');
  assert.equal(recoverPendingUpload(session)?.operationId, attempt.operationId);
  clearPendingUpload(session, attempt.operationId);
  assert.equal(recoverPendingUpload(session), null);
});

test('only explicit no-write rejection codes unlock a new file', () => {
  assert.equal(isDefiniteNoWrite({ data: { code: 'MISSING_NOM_B_FILE_INVALID' }, meta: { cacheLayer: 'server' } }), true);
  assert.equal(isDefiniteNoWrite({ data: { code: 'MISSING_NOM_B_NOT_OWNER' }, meta: { cacheLayer: 'server' } }), true);
  assert.equal(isProvenNoWriteForOperation({ data: { code: 'MISSING_NOM_B_NOT_OWNER' } }, false), true);
  assert.equal(isProvenNoWriteForOperation({ data: { code: 'MISSING_NOM_B_NOT_OWNER' } }, true), false);
  assert.equal(isDefiniteNoWrite({ data: { code: 'CLIENT_FUNCTION_CONTRACT_INVALID' }, meta: { cacheLayer: 'client' } }), true);
  assert.equal(isDefiniteNoWrite({ data: { code: 'MISSING_NOM_B_UPLOAD_UNCERTAIN' }, meta: { cacheLayer: 'server' } }), false);
  assert.equal(isDefiniteNoWrite({ data: { error: 'Network request failed' }, meta: { cacheLayer: 'network' } }), false);
  assert.equal(isDefiniteNoWrite({ data: { code: 'FCOS_INTERNAL_ERROR' }, meta: { cacheLayer: 'server' } }), false);
});

test('only matching, fully verified Salesforce upload evidence counts as success', () => {
  const attempt = { nominationId: 'nomination-1' };
  const complete = { verified: true, nominationId: 'nomination-1', contentDocumentId: '069...', receivedStatus: '🟢' };
  assert.equal(isVerifiedUpload(complete, attempt), true);
  assert.equal(isVerifiedUpload({ ...complete, contentDocumentId: null }, attempt), false);
  assert.equal(isVerifiedUpload({ ...complete, nominationId: 'different' }, attempt), false);
  assert.equal(isVerifiedUpload({ ...complete, receivedStatus: '🟡' }, attempt), false);
  assert.equal(isVerifiedUpload({ ...complete, verified: false }, attempt), false);
});

test('cursor paging and search reset do not reuse a cursor from a different query', () => {
  const pageTwo = paginationReducer(initialPagination, { type: 'next', cursor: 'cursor-1' });
  assert.deepEqual(listPayload(pageTwo), { cursor: 'cursor-1', search: '' });
  const searched = paginationReducer(pageTwo, { type: 'search', search: '  vessel A  ' });
  assert.equal(searched.page, 0);
  assert.deepEqual(listPayload(searched), { cursor: null, search: 'vessel A' });
  const refreshed = paginationReducer(paginationReducer(searched, { type: 'next', cursor: 'cursor-2' }), { type: 'refresh' });
  assert.deepEqual(listPayload(refreshed), { cursor: null, search: 'vessel A' });
  assert.equal(refreshed.page, 0);
});

test('delivery and check times use readable Hong Kong dates', () => {
  assert.equal(displayNomBDate('2026-09-30'), '30 Sept 2026');
  assert.equal(displayNomBDate('2026-09-30T12:34:00Z', true), '30 Sept 2026, 20:34');
});
