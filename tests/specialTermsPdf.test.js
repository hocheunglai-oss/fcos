import assert from 'node:assert/strict';
import test from 'node:test';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import JSZip from 'jszip';
import { generateSpecialTermDocx, generateSpecialTermPdf, specialTermsExportInternals } from '../api/_specialTermsExport.js';
import { compiledTermsText } from '../api/_specialTerms.js';
import { specialTermsDocumentInternals } from '../api/_specialTermsDocumentModel.js';

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

test('Special Term DOCX contains editable terms, real numbering, A4 geometry, and repeating letterhead parts', async () => {
  const generated = await generateSpecialTermDocx({
    ...term,
    termsText: '1. First contractual requirement.\n- Internal supporting item\n- Second supporting item\n\n2. Second contractual requirement.',
  }, { generatedAt: new Date('2026-08-06T02:00:00.000Z') });
  assert.equal(generated.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(generated.filename, '20260806 Low sulphur requirement.docx');
  assert.equal(generated.buffer.subarray(0, 2).toString(), 'PK');
  const zip = await JSZip.loadAsync(generated.buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const headerXml = await zip.file('word/header1.xml').async('string');
  const footerXml = await zip.file('word/footer1.xml').async('string');
  const numberingXml = await zip.file('word/numbering.xml').async('string');
  assert.match(documentXml, /First contractual requirement/);
  assert.match(documentXml, /Second contractual requirement/);
  assert.match(headerXml, /FRATELLI COSULICH BUNKERS \(HK\) LTD/);
  assert.match(headerXml, /SPECIAL TERMS/);
  assert.match(headerXml, /Low sulphur requirement/);
  assert.match(footerXml, /Page/);
  assert.match(numberingXml, /%1\./);
  assert.equal(specialTermsDocumentInternals.DOCX_BODY_LINE_TWIP, 242);
  assert.match(documentXml, /w:w="11906"/); // 210 mm in twentieths of a point
  assert.match(documentXml, /w:left="1247"/); // 22 mm margin
  assert.doesNotMatch(documentXml, /Must not be exported|Also excluded/);
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
  assert.equal((parsed.text.match(/SPECIAL TERMS/g) || []).length, generated.pageCount);
  assert.match(parsed.text, new RegExp(`Page ${generated.pageCount} of ${generated.pageCount}`));
});

test('Special Term PDF wraps one exceptionally long clause without horizontal clipping', async () => {
  const clause = Array.from({ length: 100 }, (_, index) => `The supplier shall provide supporting compliance record ${index + 1} upon request.`).join(' ');
  const generated = generateSpecialTermPdf({ ...term, termsText: `1. ${clause}`, clauses: [{ text: clause }] }, { generatedAt: new Date('2026-08-06T02:00:00.000Z') });
  assert.ok(generated.pageCount > 1);
  const parsed = await pdfParse(generated.buffer);
  assert.match(parsed.text, /supporting compliance record 1 upon request/);
  assert.match(parsed.text, /supporting compliance record 100 upon request/);
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

test('Special Term PDF only parses safely sequential legacy numbering', () => {
  assert.deepEqual(specialTermsExportInternals.safelyParseLegacyNumbering('1. First\n\n2. Second').clauses, ['First', 'Second']);
  assert.equal(specialTermsExportInternals.safelyParseLegacyNumbering('1. First\n\n3. Different sequence').kind, 'raw');
  assert.equal(specialTermsExportInternals.safelyParseLegacyNumbering('A heading\n1. First').kind, 'raw');
});

test('Saved draft PDF is visibly marked and DOCX preserves legacy hard line breaks', async () => {
  const generated = generateSpecialTermPdf({ ...term, termsText: 'An unnumbered legacy sentence.\nSecond legacy line.' }, {
    source: 'draft',
    generatedAt: new Date('2026-08-06T02:00:00.000Z'),
  });
  const parsed = await pdfParse(generated.buffer);
  assert.match(parsed.text, /DRAFT/);

  const docx = await generateSpecialTermDocx({ ...term, termsText: 'A legacy line.\nA preserved second line.' }, { generatedAt: new Date('2026-08-06T02:00:00.000Z') });
  const zip = await JSZip.loadAsync(docx.buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /<w:br\/>/);
});

test('structured document compilation requires sequential matching approved versions', () => {
  const row = (sequence, overrides = {}) => ({
    Id: `a0A00000000000${sequence}AAA`,
    Sequence__c: sequence,
    Clause__c: `a0B00000000000${sequence}AAA`,
    Clause__r: { Status__c: 'Active' },
    Clause_Version__r: {
      Clause__c: `a0B00000000000${sequence}AAA`,
      Status__c: 'Approved',
      Clause_Text__c: `Requirement ${sequence}.`,
    },
    ...overrides,
  });
  assert.equal(compiledTermsText([row(2), row(1)]), '1. Requirement 1.\n\n2. Requirement 2.');
  assert.throws(() => compiledTermsText([row(1), row(3)]), /non-approved clause version/);
  assert.throws(() => compiledTermsText([row(1, { Clause__c: 'a0B999999999999AAA' })]), /non-approved clause version/);
  assert.throws(() => compiledTermsText([row(1, { Clause__r: { Status__c: 'Retired' } })]), /non-approved clause version/);
  assert.equal(compiledTermsText([row(1, { Clause__r: { Status__c: 'Retired' } })], { historical: true }), '1. Requirement 1.');
});
