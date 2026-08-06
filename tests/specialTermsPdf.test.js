import assert from 'node:assert/strict';
import test from 'node:test';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { generateSpecialTermPdf, specialTermsExportInternals } from '../api/_specialTermsExport.js';

const term = {
  id: 'a01000000000001AAA',
  name: 'Low sulphur requirement',
  termsText: 'Maximum sulphur content is 0.10%.\n\n- Certificate required\n1. Share before delivery.',
  addToConfirmation: true,
  addToNomination: false,
  confirmationRemark: '<p>Must not be exported.</p>',
  nominationRemark: '<p>Also excluded.</p>',
  lastModifiedAt: '2026-08-05T08:00:00.000Z',
};

test('Special Term PDF preserves Terms Text and creates a safe individual filename', async () => {
  const generated = generateSpecialTermPdf(term, {
    generatedAt: new Date('2026-08-06T02:00:00.000Z'),
  });
  assert.equal(generated.contentType, 'application/pdf');
  assert.equal(generated.filename, '20260806 Low sulphur requirement.pdf');
  assert.equal(generated.termName, 'Low sulphur requirement');
  assert.equal(generated.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(generated.buffer.length > 2_000);

  const parsed = await pdfParse(generated.buffer);
  assert.match(parsed.text, /FRATELLI COSULICH BUNKERS \(HK\) LTD/);
  assert.match(parsed.text, /Low sulphur requirement/);
  assert.match(parsed.text, /Maximum sulphur content is 0\.10%/);
  assert.match(parsed.text, /Certificate required/);
  assert.doesNotMatch(parsed.text, /Must not be exported|Also excluded|Confirmation|Nomination|Last modified|Salesforce/);
});

test('Special Term PDF repeats the full letterhead and term heading on every page', async () => {
  const longTerm = {
    ...term,
    name: 'Extended delivery requirements',
    termsText: Array.from({ length: 150 }, (_, index) => `${index + 1}. Requirement line ${index + 1} must be observed by all parties.`).join('\n'),
  };
  const generated = generateSpecialTermPdf(longTerm, { generatedAt: new Date('2026-08-06T02:00:00.000Z') });
  assert.ok(generated.pageCount > 1);
  const parsed = await pdfParse(generated.buffer);
  assert.equal(parsed.numpages, generated.pageCount);
  assert.equal((parsed.text.match(/FRATELLI COSULICH BUNKERS \(HK\) LTD/g) || []).length, generated.pageCount);
  assert.equal((parsed.text.match(/Extended delivery requirements/g) || []).length, generated.pageCount);
  assert.match(parsed.text, new RegExp(`Page ${generated.pageCount} of ${generated.pageCount}`));
});

test('Special Term PDF normalizes line endings and suffixes duplicate filenames', () => {
  assert.equal(specialTermsExportInternals.normalizeTermsText(' First\r\n\r\nSecond\tvalue  \r\n'), 'First\n\nSecond    value');
  assert.equal(specialTermsExportInternals.safeFilenamePart('  Port / Product: Terms?  '), 'Port Product Terms');
  assert.equal(specialTermsExportInternals.duplicateSuffix(1), '-1');
  assert.equal(specialTermsExportInternals.duplicateSuffix(0), '');
  assert.equal(
    generateSpecialTermPdf({ name: 'Port / Product: Terms?', termsText: '' }, { generatedAt: new Date('2026-08-06T02:00:00.000Z'), duplicateIndex: 1 }).filename,
    '20260806 Port Product Terms-1.pdf',
  );
});
