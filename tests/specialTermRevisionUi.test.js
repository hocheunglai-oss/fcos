import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localRevisionFromDetail,
  revisionRuleAudienceRequired,
  revisionDraftSignature,
  revisionFromDetail,
  revisionPayload,
  revisionRuleIssues,
} from '../src/lib/specialTermRevision.js';

const SOURCE_RULE_ID = 'a0S000000000001AAA';
const SNAPSHOT_RULE_ID = 'a0T000000000001AAA';
const ACCOUNT_ID = '001000000000001AAA';
const PORT_ID = 'a09000000000001AAA';
const PRODUCT_ID = '01t000000000001AAA';

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

test('revision payload preserves explicit null source identity for saved new rules', () => {
  const [savedNewRule, legacyRule] = revisionPayload({
    projections: {},
    rules: [
      { id: SNAPSHOT_RULE_ID, sourceRuleId: null, sourceLastModifiedAt: null, lastModifiedAt: 'snapshot-time', audience: 'Buyer', account: { id: ACCOUNT_ID } },
      { id: SOURCE_RULE_ID, audience: '', port: { id: PORT_ID }, lastModifiedAt: 'source-time' },
    ],
  }).rules;
  assert.deepEqual(savedNewRule, {
    sourceRuleId: null,
    lastModifiedAt: null,
    audience: 'Buyer',
    accountId: ACCOUNT_ID,
    portId: null,
    productId: null,
    country: null,
  });
  assert.equal(legacyRule.sourceRuleId, SOURCE_RULE_ID);
  assert.equal(legacyRule.lastModifiedAt, 'source-time');
});

test('revision draft signature tracks ordered projections, rules, legacy content, and reason', () => {
  const revision = {
    projections: {
      termsText: { style: 'Numbered', assignments: [{ clauseVersionId: 'a0V000000000001AAA', shortName: 'Display label' }] },
      confirmationRemark: { style: 'Hyphen', draftAssignments: [{ clauseVersionId: 'a0V000000000002AAA' }] },
      nominationRemark: { style: 'Hyphen', rows: [{ id: 'legacy:nominationRemark:0', legacyCandidate: true, clauseVersionId: 'a0V000000000003AAA', clauseText: 'Legacy wording', shortName: 'Legacy name', category: 'Operational' }] },
    },
    rules: [{ id: SOURCE_RULE_ID, audience: 'Buyer', account: { id: ACCOUNT_ID }, country: '__any__' }],
  };
  const signature = revisionDraftSignature(revision, 'Update wording');
  const changes = [
    { ...revision, projections: { ...revision.projections, termsText: { ...revision.projections.termsText, assignments: [{ clauseVersionId: 'a0V000000000009AAA' }] } } },
    { ...revision, projections: { ...revision.projections, confirmationRemark: { ...revision.projections.confirmationRemark, style: 'Numbered' } } },
    { ...revision, projections: { ...revision.projections, nominationRemark: { ...revision.projections.nominationRemark, rows: [{ legacyCandidate: true, clauseText: 'Changed wording', shortName: 'Legacy name', category: 'Operational' }] } } },
    { ...revision, rules: [{ id: SOURCE_RULE_ID, audience: 'Supplier', accountId: ACCOUNT_ID }] },
  ];
  for (const changed of changes) assert.notEqual(revisionDraftSignature(changed, 'Update wording'), signature);
  assert.notEqual(revisionDraftSignature(revision, 'Different reason'), signature);
  for (const field of ['clauseText', 'shortName', 'category']) {
    const legacy = revision.projections.nominationRemark.rows[0];
    const changed = { ...revision, projections: { ...revision.projections, nominationRemark: { ...revision.projections.nominationRemark, rows: [{ ...legacy, [field]: `${legacy[field]} changed` }] } } };
    assert.notEqual(revisionDraftSignature(changed, 'Update wording'), signature);
  }
});

test('revision draft signature ignores reload timestamps and display labels', () => {
  const before = {
    lastModifiedAt: 'before',
    projections: {
      termsText: { style: 'Numbered', assignments: [{ id: 'assignment-before', clauseVersionId: 'a0V000000000001AAA', shortName: 'Old label', versionLastModifiedAt: 'before' }] },
      confirmationRemark: { style: 'Hyphen', assignments: [] },
      nominationRemark: { style: 'Hyphen', assignments: [] },
    },
    rules: [{ id: SNAPSHOT_RULE_ID, sourceRuleId: SOURCE_RULE_ID, sourceLastModifiedAt: 'source-before', lastModifiedAt: 'snapshot-before', audience: 'Buyer', accountId: ACCOUNT_ID, accountName: 'Old account label', priority: 1 }],
  };
  const after = {
    ...before,
    lastModifiedAt: 'after',
    projections: { ...before.projections, termsText: { ...before.projections.termsText, assignments: [{ id: 'assignment-after', clauseVersionId: 'a0V000000000001AAA', shortName: 'New label', versionLastModifiedAt: 'after' }] } },
    rules: [{ ...before.rules[0], id: 'a0T000000000002AAA', sourceLastModifiedAt: 'source-after', lastModifiedAt: 'snapshot-after', accountName: 'New account label', priority: 99 }],
  };
  assert.equal(revisionDraftSignature(after, '  Update wording  '), revisionDraftSignature(before, 'Update wording'));
});

test('revision rule issues require an account role only for new account rules', () => {
  const legacy = { id: SOURCE_RULE_ID, audience: '', country: 'SINGAPORE' };
  const savedNew = { id: SNAPSHOT_RULE_ID, sourceRuleId: null, audience: '', country: '__any__' };
  assert.deepEqual(revisionRuleIssues([legacy]), []);
  assert.deepEqual(revisionRuleIssues([savedNew]).map(({ index, field }) => [index, field]), [[0, 'conditions']]);
});

test('revision rule issues enforce authoritative options, Salesforce IDs, and the 100-rule limit', () => {
  const issues = revisionRuleIssues([
    { id: 'draft:1', audience: 'Charterer', account: { id: 'bad-account' }, country: 'MARS' },
  ], {
    audienceOptions: [{ value: 'Buyer' }, { value: 'Supplier' }],
    countryOptions: [{ value: 'SINGAPORE' }],
  });
  assert.deepEqual(issues.map(({ field }) => field), ['audience', 'accountId', 'country']);
  const tooMany = revisionRuleIssues(Array.from({ length: 101 }, () => ({ audience: 'Buyer', productId: PRODUCT_ID })));
  assert.deepEqual(tooMany[0], { index: -1, field: 'rules', message: 'A Special Term revision cannot exceed 100 proposed rules.' });
  assert.equal(tooMany.length, 1);
});


test('the next revision after publication uses replacement live rules, not historical snapshots', () => {
  const historical = { id: SNAPSHOT_RULE_ID, sourceRuleId: null, sourceLastModifiedAt: '2020-08-26T17:09:45.000+0000', audience: '', country: 'CHINA' };
  const live = { id: SOURCE_RULE_ID, audience: '', country: 'CHINA', lastModifiedAt: '2026-09-12T21:32:40.000+0000' };
  for (const status of ['Active', 'Approved', 'Rolled Back', 'Rejected']) {
    const sourceRevision = { id: 'a0R000000000001AAA', status, rules: [historical] };
    const draft = localRevisionFromDetail({ rules: [live] }, sourceRevision);
    assert.equal(draft.id, null);
    assert.equal(draft.sourceRevisionId, sourceRevision.id);
    assert.deepEqual(revisionPayload(draft).rules[0], {
      sourceRuleId: SOURCE_RULE_ID, lastModifiedAt: live.lastModifiedAt, audience: null,
      accountId: null, portId: null, productId: null, country: 'CHINA',
    });
    assert.deepEqual(revisionRuleIssues(draft.rules), []);
  }
});

test('unfinished revisions retain saved rule additions, edits and removals', () => {
  const proposed = { id: SNAPSHOT_RULE_ID, sourceRuleId: SOURCE_RULE_ID, sourceLastModifiedAt: 'source-before', audience: 'Supplier', accountId: ACCOUNT_ID };
  for (const status of ['Draft', 'In Review', 'Ready for Approval', 'Changes Requested']) {
    for (const rules of [[], [proposed]]) {
      const revision = { id: 'a0R000000000001AAA', status, rules };
      const reopened = localRevisionFromDetail({ rules: [{ id: SOURCE_RULE_ID, audience: 'Buyer' }] }, revision);
      assert.equal(reopened.id, revision.id);
      assert.deepEqual(reopened.rules, rules);
    }
  }
});

test('a rule without a source never sends an orphan historical timestamp', () => {
  const rule = { id: SNAPSHOT_RULE_ID, sourceRuleId: null, sourceLastModifiedAt: '2020-08-26T17:09:45.000+0000', lastModifiedAt: '2026-09-12T21:32:40.000+0000', country: 'CHINA' };
  assert.equal(revisionPayload({ rules: [rule] }).rules[0].lastModifiedAt, null);
});

test('country, port and product rules can omit account role; new account rules cannot', () => {
  for (const condition of [{ country: 'CHINA' }, { portId: PORT_ID }, { productId: PRODUCT_ID }]) {
    const rule = { id: 'draft:1', sourceRuleId: null, audience: '', ...condition };
    assert.equal(revisionRuleAudienceRequired(rule), false);
    assert.deepEqual(revisionRuleIssues([rule]), []);
  }
  const rule = { id: 'draft:1', sourceRuleId: null, audience: '', accountId: ACCOUNT_ID };
  assert.equal(revisionRuleAudienceRequired(rule), true);
  assert.deepEqual(revisionRuleIssues([rule]).map(({ field }) => field), ['audience']);
  assert.deepEqual(revisionRuleIssues([{ ...rule, audience: 'Buyer' }]), []);
  assert.deepEqual(revisionRuleIssues([{ ...rule, audience: 'Supplier' }]), []);
});
