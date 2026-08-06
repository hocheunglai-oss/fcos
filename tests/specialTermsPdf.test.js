import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSpecialTermsExport, generateSpecialTermsPdf, specialTermsExportInternals } from '../api/_specialTermsExport.js';

const workspace = {
  fetchedAt: '2026-08-06T01:00:00.000Z',
  terms: [
    {
      id: 'a01000000000001AAA',
      name: 'Low sulphur requirement',
      termsText: 'Maximum sulphur content is 0.10%.',
      addToConfirmation: true,
      addToNomination: false,
      confirmationRemark: '<p><strong>Confirmation:</strong> attach the certificate.</p>',
      nominationRemark: '<p>Advise before delivery.</p>',
      lastModifiedAt: '2026-08-05T08:00:00.000Z',
    },
    {
      id: 'a01000000000002AAA',
      name: 'Survey requirement',
      termsText: 'Joint survey is required.',
      addToConfirmation: false,
      addToNomination: true,
      confirmationRemark: '',
      nominationRemark: '<ul><li>Nominate surveyor</li><li>Share report</li></ul>',
      lastModifiedAt: '2026-08-04T08:00:00.000Z',
    },
  ],
  rules: [
    {
      id: 'a02000000000001AAA',
      name: 'Buyer Singapore VLSFO',
      specialTermId: 'a01000000000001AAA',
      specialTermName: 'Low sulphur requirement',
      audience: 'Buyer',
      accountName: 'Buyer One',
      accountClKey: 'BUY001',
      portName: 'Singapore',
      portCountry: 'Singapore',
      productName: 'VLSFO',
      country: '',
      priority: 4,
    },
    {
      id: 'a02000000000002AAA',
      name: 'Supplier survey',
      specialTermId: 'a01000000000002AAA',
      specialTermName: 'Survey requirement',
      audience: 'Supplier',
      accountName: 'Supplier One',
      accountClKey: 'SUP001',
      portName: '',
      productName: '',
      country: 'China',
      priority: 2,
    },
  ],
};

test('Special Terms PDF scope follows the current view and search text', () => {
  const termScope = filterSpecialTermsExport(workspace, { view: 'terms', search: 'sulphur' });
  assert.deepEqual(termScope.terms.map((row) => row.name), ['Low sulphur requirement']);
  assert.deepEqual(termScope.rules.map((row) => row.name), ['Buyer Singapore VLSFO']);

  const ruleScope = filterSpecialTermsExport(workspace, { view: 'rules', search: 'China' });
  assert.deepEqual(ruleScope.terms.map((row) => row.name), ['Survey requirement']);
  assert.deepEqual(ruleScope.rules.map((row) => row.name), ['Supplier survey']);
});

test('Special Terms PDF converts rich text and produces a valid downloadable document', () => {
  assert.equal(
    specialTermsExportInternals.plainRichText('<p>Hello &amp; welcome</p><ul><li>First</li><li>Second</li></ul>'),
    'Hello & welcome\n- First\n- Second',
  );
  const generated = generateSpecialTermsPdf(workspace, {
    view: 'terms',
    actorName: 'Vincent Lee',
    generatedAt: new Date('2026-08-06T02:00:00.000Z'),
  });
  assert.equal(generated.contentType, 'application/pdf');
  assert.equal(generated.filename, '20260806 Special Terms.pdf');
  assert.equal(generated.termCount, 2);
  assert.equal(generated.ruleCount, 2);
  assert.equal(generated.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(generated.buffer.length > 2000);
});
