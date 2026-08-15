import assert from 'node:assert/strict';
import test from 'node:test';
import { revisionFromDetail, revisionPayload } from '../src/lib/specialTermRevision.js';

test('whole-term revision payload includes all contractual projections together', () => {
  const revision = revisionFromDetail({
    revision: {
      id: 'a0R000000000001AAA',
      status: 'Draft',
      lastModifiedAt: '2026-08-13T01:00:00.000Z',
      projections: {
        termsText: { style: 'Numbered', assignments: [{ clauseId: 'a01', clauseVersionId: 'a02', versionLastModifiedAt: '2026-08-13T00:10:00.000Z' }] },
        confirmationRemark: { style: 'Hyphen', assignments: [{ clauseId: 'a03', clauseVersionId: 'a04', versionLastModifiedAt: '2026-08-13T00:20:00.000Z' }] },
        nominationRemark: { style: 'Hyphen', assignments: [] },
      },
      rules: [{ id: 'a05', audience: 'Buyer', accountId: '001-example', accountName: 'Example Buyer', portId: 'a09-port', portName: 'Shanghai', productId: '01t-product', productName: 'VLSFO', country: 'CHINA', lastModifiedAt: '2026-08-13T00:00:00.000Z' }],
    },
  });
  assert.equal(revision.status, 'Draft');
  assert.deepEqual(revisionPayload(revision), {
    revisionId: 'a0R000000000001AAA',
    expectedLastModifiedAt: '2026-08-13T01:00:00.000Z',
    expectedRevisionLastModifiedAt: '2026-08-13T01:00:00.000Z',
    projections: [
      { projection: 'termsText', style: 'Numbered', versionIds: ['a02'], versionTimestamps: { a02: '2026-08-13T00:10:00.000Z' } },
      { projection: 'confirmationRemark', style: 'Hyphen', versionIds: ['a04'], versionTimestamps: { a04: '2026-08-13T00:20:00.000Z' } },
      { projection: 'nominationRemark', style: 'Hyphen', versionIds: [], versionTimestamps: {} },
    ],
    rules: [{ sourceRuleId: 'a05', audience: 'Buyer', accountId: '001-example', portId: 'a09-port', productId: '01t-product', country: 'CHINA', lastModifiedAt: '2026-08-13T00:00:00.000Z' }],
  });
});

test('revision contract falls back to the current revision shape without inventing a legacy revision', () => {
  assert.equal(revisionFromDetail({}), null);
  assert.equal(revisionFromDetail({ currentRevision: { id: 'a0R1', projections: {}, rules: [] } }).id, 'a0R1');
});
