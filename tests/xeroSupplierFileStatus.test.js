import assert from 'node:assert/strict';
import test from 'node:test';
import { supplierFileStatus } from '../src/lib/xeroSupplierFileStatus.js';
import { xeroPortalUiCopy } from '../src/lib/xeroPortalUiCopy.js';
import { reconciliationBucket, documentExplicitReviewEligible, restoreReviewSelection } from '../src/lib/financialWorkflowUi.js';

const MISSING = 'Supplier invoice has no verified issued source file.';
const sourceId = 'a06000000000001';
const copy = xeroPortalUiCopy('en').financial.fileDiscovery;
const candidate = { documentId: '069000000000001', latestPublishedVersionId: '068000000000001', title: 'Original invoice', fileType: 'PDF', fileExtension: 'pdf' };
function row(overrides = {}) {
  return { salesforceObject: 'Supplier_Invoice__c', salesforceId: sourceId, action: 'blocked', status: 'blocked',
    sourceFingerprint: 'source', reviewFingerprint: 'review', blockers: [MISSING], blockerCodes: ['source_not_issued'],
    readiness: { ready: false, file: null, blockers: [MISSING] }, proposedPayload: null,
    sourceFileDiscovery: { version: 1, sourceId, status: 'complete', complete: true, metadataOnly: true,
      authoritative: false, contentVerified: false, linkedPdfCount: 1, candidates: [candidate], reasonCode: 'PDF_CANDIDATES_FOUND' }, ...overrides };
}

test('complete found PDF displays pending verification without supplying readiness, eligibility or new selection', () => {
  const input = row(); const before = structuredClone(input);
  Object.freeze(input.blockers); Object.freeze(input.readiness); Object.freeze(input);
  const output = supplierFileStatus(input, copy);
  assert.equal(output.status, 'complete');
  assert.deepEqual(output.blockers, ['Attached PDF found; issued-document verification pending.']);
  assert.deepEqual(input, before);
  assert.equal(input.readiness.ready, false); assert.equal(input.proposedPayload, null);
  assert.equal(documentExplicitReviewEligible(input), false);
  assert.equal(reconciliationBucket(input), reconciliationBucket(before));
  assert.equal(restoreReviewSelection([{ key: 'Supplier_Invoice__c:' + sourceId, sourceFingerprint: 'source', reviewFingerprint: 'review' }], [input]).size, 0);
});

test('multiple complete PDFs remain candidates awaiting verification', () => {
  const input = row(); input.sourceFileDiscovery.candidates.push({ ...candidate, documentId: '069000000000002' });
  input.sourceFileDiscovery.linkedPdfCount = 2;
  assert.equal(supplierFileStatus(input, copy).status, 'complete');
  assert.deepEqual(supplierFileStatus(input, copy).blockers, [copy.complete]);
});

test('valid PDF metadata casing has the same pending status', () => {
  const input = row(); input.sourceFileDiscovery.candidates = [{ ...candidate, fileType: 'pdf', fileExtension: 'PDF' }];
  assert.equal(supplierFileStatus(input, copy).status, 'complete');
});

test('complete empty PDF lookup reports absence only within the checked attachment scope', () => {
  const input = row(); Object.assign(input.sourceFileDiscovery, { candidates: [], linkedPdfCount: 0, reasonCode: 'NO_PDF_CANDIDATES' });
  const output = supplierFileStatus(input, copy);
  assert.equal(output.status, 'empty'); assert.deepEqual(output.blockers, [copy.empty]);
});

for (const status of ['partial', 'unavailable', 'not_checked']) test(`${status} lookup cannot claim verified content or absence`, () => {
  const input = row(); Object.assign(input.sourceFileDiscovery, { status, complete: false });
  const output = supplierFileStatus(input, copy);
  assert.equal(output.status, status);
  assert.match(output.blockers[0], /Cannot verify issued document/);
  assert.notEqual(output.blockers[0], copy.complete); assert.notEqual(output.blockers[0], copy.empty);
});

test('old saved preview without discovery says cannot verify rather than absent', () => {
  const output = supplierFileStatus(row({ sourceFileDiscovery: null }), copy);
  assert.equal(output.status, 'not_checked'); assert.deepEqual(output.blockers, [copy.not_checked]);
});

test('ordinary supplier with an issued file and no missing-file hold gets no unnecessary lookup warning', () => {
  const input = row({ action: 'link', status: 'eligible', blockers: [], sourceFileDiscovery: null,
    readiness: { ready: true, file: '/issued.pdf', blockers: [] } });
  assert.deepEqual(supplierFileStatus(input, copy), { status: null, blockers: [] });
});

for (const [name, change] of [
  ['foreign parent', value => { value.sourceId = 'a06000000000002'; }],
  ['unknown completeness', value => { delete value.complete; }],
  ['wrong count', value => { value.linkedPdfCount = 2; }],
  ['malformed list', value => { value.candidates = null; }],
  ['non-PDF metadata', value => { value.candidates = [{ ...candidate, fileType: 'WORD_X', fileExtension: 'docx' }]; }],
]) test(`inconsistent ${name} metadata remains unverified`, () => {
  const input = row(); change(input.sourceFileDiscovery);
  const output = supplierFileStatus(input, copy);
  assert.equal(output.status, 'unavailable'); assert.deepEqual(output.blockers, [copy.unavailable]);
});

test('accepted existing preservation link hides only the obsolete missing-file display despite nested readiness false', () => {
  for (const status of ['protected', 'linked']) {
    const input = row({ acceptedLegacy: true, reviewRequired: false, action: 'protected_legacy', status, blockers: [], blockerCodes: [] });
    const before = structuredClone(input); const output = supplierFileStatus(input, copy);
    assert.equal(output.status, null); assert.deepEqual(output.blockers, []);
    assert.equal(reconciliationBucket(input), 'matched'); assert.deepEqual(input, before);
    assert.equal(input.readiness.ready, false); assert.deepEqual(input.readiness.blockers, [MISSING]);
  }
});

test('accepted marker never hides unrelated blockers, and changed/blocked acceptance retains file verification hold', () => {
  const input = row({ acceptedLegacy: true, action: 'protected_legacy', status: 'protected', blockers: [MISSING, 'Current bank changed', ''] });
  assert.deepEqual(supplierFileStatus(input, copy).blockers, ['Current bank changed', '']);
  for (const changes of [{ reviewRequired: true }, { status: 'blocked' }, { status: 'failed' }, { action: 'safe_update' }]) {
    const output = supplierFileStatus({ ...input, ...changes }, copy);
    assert.equal(output.status, 'complete'); assert.deepEqual(output.blockers, [copy.complete, 'Current bank changed', '']);
  }
});

test('only the exact supplier missing-file blocker changes, with order and all other server reasons retained', () => {
  const other = 'Supplier posting requires current non-cancelled children linked to this exact issued invoice.';
  const input = row({ blockers: [other, MISSING, 'Prefix: ' + MISSING] }); const before = structuredClone(input);
  assert.deepEqual(supplierFileStatus(input, copy).blockers, [other, copy.complete, 'Prefix: ' + MISSING]);
  assert.deepEqual(input, before);
  const buyer = { ...input, salesforceObject: 'Invoice__c' };
  assert.deepEqual(supplierFileStatus(buyer, copy), { status: null, blockers: buyer.blockers });
});

test('English file status copy remains explicit for English and legacy Chinese preferences', () => {
  for (const language of ['en', 'zh-Hant']) {
    const labels = xeroPortalUiCopy(language).financial.fileDiscovery;
    for (const key of ['complete', 'empty', 'partial', 'unavailable', 'not_checked']) assert.ok(labels[key].trim());
    assert.deepEqual(supplierFileStatus(row(), labels).blockers, [labels.complete]);
    assert.deepEqual(supplierFileStatus(row({ sourceFileDiscovery: null }), labels).blockers, [labels.not_checked]);
  }
});
