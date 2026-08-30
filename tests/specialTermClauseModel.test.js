import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalClauseKey,
  clauseSimilarity,
  compileClauseList,
  compileNumberedClauses,
  hasMaterialDifference,
  normalizeClauseEquivalence,
  parseLegacyClauses,
  shortNameKey,
  suggestClauseCategory,
  suggestClauseShortName,
} from '../api/_specialTermClauseModel.js';

test('clause equivalence ignores only outer numbering, case, and harmless spacing', () => {
  assert.equal(normalizeClauseEquivalence(' 1.  BUYER shall pay.  '), "buyer shall pay.");
  assert.equal(canonicalClauseKey('1. BUYER shall pay.'), canonicalClauseKey('buyer shall pay.'));
  assert.notEqual(canonicalClauseKey('Buyer’s obligation.'), canonicalClauseKey("Buyer's obligation."));
  assert.notEqual(canonicalClauseKey('ＦＵＬＬ WIDTH TEXT.'), canonicalClauseKey('FULL WIDTH TEXT.'));
  assert.notEqual(canonicalClauseKey('Claim within 7 days.'), canonicalClauseKey('Claim within 21 days.'));
  assert.equal(shortNameKey('  Invoice   Due Without BDR '), 'invoice due without bdr');
});

test('numbered compilation derives sequential numbers and rejects embedded top-level numbers', () => {
  assert.equal(compileNumberedClauses(['First clause.', 'Second clause.\n- Supporting point.']), '1. First clause.\n\n2. Second clause.\n- Supporting point.');
  assert.throws(() => compileNumberedClauses(['1. Already numbered.']), /top-level list marker/);
  assert.throws(() => compileNumberedClauses(['- Already bulleted.']), /top-level list marker/);
  assert.throws(() => compileNumberedClauses(['']), /blank/);
});

test('remark compilation derives numbered or hyphen markers without changing clause wording', () => {
  assert.equal(compileClauseList(['First remark.', 'Second remark.'], 'Hyphen'), '- First remark.\n- Second remark.');
  assert.equal(compileClauseList(['First remark.', 'Second remark.'], 'Numbered'), '1. First remark.\n\n2. Second remark.');
  assert.throws(() => compileClauseList(['First remark.'], 'Bullet'), /Numbered or Hyphen/);
});

test('legacy parser preserves clause wording and flags the three known manual-review records', () => {
  const parsed = parseLegacyClauses('1. FIRST CLAUSE.\ncontinued wording\n\n2) SECOND CLAUSE.', { termName: 'Normal term' });
  assert.deepEqual(parsed.clauses, ['FIRST CLAUSE.\ncontinued wording', 'SECOND CLAUSE.']);
  assert.equal(parsed.manualReviewRequired, false);
  const withHeading = parseLegacyClauses('SPECIAL CONDITIONS\n1. FIRST CLAUSE.\n2. SECOND CLAUSE.', { termName: 'Normal term' });
  assert.deepEqual(withHeading.clauses, ['SPECIAL CONDITIONS\nFIRST CLAUSE.', 'SECOND CLAUSE.']);
  assert.equal(withHeading.markerCount, withHeading.clauses.length);
  assert.equal(parseLegacyClauses('<p>1. FIRST</p><p>2. SECOND</p>', { termName: 'China Special Terms' }).manualReviewRequired, true);
  assert.equal(parseLegacyClauses('Unnumbered wording only.', { termName: 'Yudean Special Terms' }).manualReviewRequired, true);
});

test('legacy remark parser recognizes hyphen, numbered, and mixed bullet shapes', () => {
  const hyphen = parseLegacyClauses('- FIRST REMARK.\n- SECOND REMARK.', { markerStyle: 'Auto' });
  assert.deepEqual(hyphen.clauses, ['FIRST REMARK.', 'SECOND REMARK.']);
  assert.equal(hyphen.inferredStyle, 'Hyphen');
  assert.equal(hyphen.manualReviewRequired, false);

  const numbered = parseLegacyClauses('1. FIRST REMARK.\n2. SECOND REMARK.', { markerStyle: 'Auto' });
  assert.equal(numbered.inferredStyle, 'Numbered');
  assert.equal(numbered.manualReviewRequired, false);

  const mixed = parseLegacyClauses('- FIRST REMARK.\n2. SECOND REMARK.', { markerStyle: 'Auto' });
  assert.equal(mixed.manualReviewRequired, true);
  assert.match(mixed.reason, /mixed/);
});

test('material differences keep amounts, deadlines, suppliers, and standards separate', () => {
  assert.equal(hasMaterialDifference('Cancellation charge USD 1,000.', 'Cancellation charge USD 5,000.'), true);
  assert.equal(hasMaterialDifference('Claims within 7 days.', 'Claims within 21 days.'), true);
  assert.equal(hasMaterialDifference('CPC standard specifications.', 'Formosa standard specifications.'), true);
  assert.equal(hasMaterialDifference('No warranty for MARPOL Annex VI.', 'NO WARRANTY FOR MARPOL ANNEX VI.'), false);
  assert.equal(hasMaterialDifference('Delivery at Singapore.', 'Delivery at Hong Kong.'), true);
  assert.equal(hasMaterialDifference('Product must meet ISO 8217:2017.', 'Product must meet ISO 8217:2024.'), true);
  assert.equal(hasMaterialDifference('Physical supplier "SINOPEC Marine" shall deliver.', 'Physical supplier "PETROCHINA Marine" shall deliver.'), true);
  assert.equal(hasMaterialDifference('The supplier will issue its invoice after delivery.', 'The supplier shall issue the invoice after delivery.'), false);
  assert.equal(hasMaterialDifference('SUPPLIER WILL ISSUE ITS INVOICE AFTER DELIVERY.', 'The supplier shall issue the invoice after delivery.'), false);
  assert.ok(clauseSimilarity('Buyer must submit a quality claim within seven days.', 'Quality claims must be submitted within seven days by Buyer.') > 0.5);
});

test('candidate names and categories are concise but remain reviewable Draft suggestions', () => {
  assert.equal(suggestClauseShortName('NO WARRANTY FOR MARPOL ANNEX VI COMPLIANCE.'), 'No MARPOL VI Warranty');
  assert.equal(suggestClauseCategory('Buyer must pay invoice within the due date.'), 'Pricing and Payment');
});
