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
        termsText: { style: 'Numbered', assignments: [{ clauseId: 'a01', clauseVersionId: 'a02' }] },
        confirmationRemark: { style: 'Hyphen', assignments: [{ clauseId: 'a03', clauseVersionId: 'a04' }] },
        nominationRemark: { style: 'Hyphen', assignments: [] },
      },
      rules: [{ id: 'a05', audience: 'Buyer', country: 'CHINA', lastModifiedAt: '2026-08-13T00:00:00.000Z' }],
    },
  });
  assert.equal(revision.status, 'Draft');
  assert.deepEqual(revisionPayload(revision), {
    revisionId: 'a0R000000000001AAA',
    expectedLastModifiedAt: '2026-08-13T01:00:00.000Z',
    projections: [
      { projection: 'termsText', style: 'Numbered', versionIds: ['a02'] },
      { projection: 'confirmationRemark', style: 'Hyphen', versionIds: ['a04'] },
      { projection: 'nominationRemark', style: 'Hyphen', versionIds: [] },
    ],
    rules: [{ sourceRuleId: 'a05', audience: 'Buyer', accountId: null, portId: null, productId: null, country: 'CHINA', lastModifiedAt: '2026-08-13T00:00:00.000Z' }],
  });
});

test('revision contract falls back to the current revision shape without inventing a legacy revision', () => {
  assert.equal(revisionFromDetail({}), null);
  assert.equal(revisionFromDetail({ currentRevision: { id: 'a0R1', projections: {}, rules: [] } }).id, 'a0R1');
});
