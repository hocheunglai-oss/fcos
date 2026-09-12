import assert from 'node:assert/strict';
import test from 'node:test';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { generateSpecialTermsDocument, generateSpecialTermPdf, specialTermsExportInternals } from '../api/_specialTermsExport.js';
import { compiledTermsText } from '../api/_specialTerms.js';

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

test('Special Terms exports accept PDF only for both live and draft documents', async () => {
  for (const source of ['live', 'draft']) {
    for (const format of ['docx', 'html', 'txt']) {
      await assert.rejects(generateSpecialTermsDocument(term, { source, format }), {
        status: 400,
        code: 'SPECIAL_TERMS_DOCUMENT_FORMAT_INVALID',
        message: 'Special Terms are available as PDF only.',
      });
    }
    const generated = await generateSpecialTermsDocument(term, { source });
    assert.equal(generated.contentType, 'application/pdf');
    assert.equal(generated.source, source);
  }
});

test('the document API rejects removed formats before reading Salesforce or writing audit events', async () => {
  const functions = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const start = functions.indexOf('async function specialTermsDocumentExport(');
  const end = functions.indexOf('/** Retained only for deployed FCOS clients', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    appError: (message, status, code) => Object.assign(new Error(message), { status, code }),
  });
  vm.runInContext(functions.slice(start, end), context);
  // No provider or response methods are available: validation must reject first.
  for (const source of ['live', 'draft']) {
    for (const format of ['docx', ' DOCX ', 'html']) {
      await assert.rejects(context.specialTermsDocumentExport({ format, source }, null, null, {}), {
        status: 400,
        code: 'SPECIAL_TERMS_DOCUMENT_FORMAT_INVALID',
      });
    }
  }
});

test('China and wrapped term headings are centred inside the A4 margins on every live and draft page', async () => {
  for (const name of ['China', 'China Delivery Requirements for Mainland Ports and Offshore Anchorage Operations']) {
    for (const source of ['live', 'draft']) {
      const generated = generateSpecialTermPdf({
        name,
        termsText: Array.from({ length: 45 }, (_, index) => `${index + 1}. Requirement ${index + 1} applies at the agreed delivery location.`).join('\n\n'),
      }, { source });
      let pagesChecked = 0;
      await pdfParse(generated.buffer, { pagerender: async (page) => {
        const { items } = await page.getTextContent();
        const headings = items.filter((item) => item.str === 'SPECIAL TERMS' || Math.abs(item.transform[0] - 15) < 0.01);
        const titleLines = headings.filter((item) => item.str !== 'SPECIAL TERMS');
        assert.equal(titleLines.map((item) => item.str).join(' '), name);
        assert.equal(headings.filter((item) => item.str === 'SPECIAL TERMS').length, 1);
        if (name !== 'China') assert.ok(titleLines.length > 1);
        const centre = (page.view[0] + page.view[2]) / 2;
        const margin = 22 * 72 / 25.4;
        for (const item of headings) {
          assert.ok(Math.abs(item.transform[4] + item.width / 2 - centre) < 1.5, `${item.str} must be centred`);
          assert.ok(item.transform[4] >= margin - 1 && item.transform[4] + item.width <= page.view[2] - margin + 1);
        }
        pagesChecked += 1;
        return '';
      } });
      assert.ok(pagesChecked > 1);
      assert.equal(pagesChecked, generated.pageCount);
    }
  }
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
  const normalizedText = parsed.text.replace(/\s+/g, ' ');
  assert.match(normalizedText, /supporting compliance record 1 upon request/);
  assert.match(normalizedText, /supporting compliance record 100 upon request/);
});

test('Special Term PDF normalizes line endings and suffixes duplicate filenames', () => {
  assert.equal(specialTermsExportInternals.normalizeTermsText(' First\r\n\r\nSecond\tvalue  \r\n'), 'First\n\nSecond value');
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

test('legacy Salesforce rich text becomes readable plain text before numbering and export', () => {
  const legacy = '<p>1.\tFIRST CHINA REQUIREMENT.</p><p>CONTINUATION AT THE SAME CLAUSE INDENT.</p><p>2.\tSECOND CHINA REQUIREMENT.</p>';
  assert.equal(specialTermsExportInternals.normalizeTermsText(legacy), '1. FIRST CHINA REQUIREMENT.\n\nCONTINUATION AT THE SAME CLAUSE INDENT.\n\n2. SECOND CHINA REQUIREMENT.');
  assert.deepEqual(specialTermsExportInternals.safelyParseLegacyNumbering(legacy).clauses, [
    'FIRST CHINA REQUIREMENT.\n\nCONTINUATION AT THE SAME CLAUSE INDENT.',
    'SECOND CHINA REQUIREMENT.',
  ]);
});

test('shared document geometry uses readable type and a compact aligned marker column', () => {
  const tokens = specialTermsExportInternals.SPECIAL_TERMS_DOCUMENT_TOKENS;
  assert.equal(tokens.typography.bodyPt, 12);
  assert.equal(tokens.typography.lineMultiplier, 1.25);
  assert.equal(tokens.typography.bodyAlignment, 'justify');
  assert.equal(tokens.typography.lastLineAlignment, 'left');
  assert.equal(tokens.list.markerRightMm + tokens.list.markerGapMm, tokens.list.textIndentMm);
  assert.equal(tokens.page.leftMm, tokens.page.rightMm);
});

test('Saved draft PDF is visibly marked and preserves legacy hard line breaks', async () => {
  const generated = generateSpecialTermPdf({ ...term, termsText: 'An unnumbered legacy sentence.\nSecond legacy line.' }, {
    source: 'draft',
    generatedAt: new Date('2026-08-06T02:00:00.000Z'),
  });
  const parsed = await pdfParse(generated.buffer);
  assert.match(parsed.text, /DRAFT/);

  assert.match(parsed.text, /An unnumbered legacy sentence\.\nSecond legacy line\./);
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
