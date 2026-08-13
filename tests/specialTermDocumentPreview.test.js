import assert from 'node:assert/strict';
import test from 'node:test';
import { documentPreviewKey, normalizeDocumentPreviewText, paginateDocumentText, specialTermDocumentModel } from '../src/lib/specialTermDocumentPreview.js';

test('document preview compiles only the Terms Text projection as numbered clauses', () => {
  const model = specialTermDocumentModel({
    term: { name: 'Hong Kong delivery', termsText: '1. Live clause' },
    revision: {
      id: 'a0R000000000001AAA',
      projections: {
        termsText: { style: 'Numbered', assignments: [{ clauseText: 'Draft first clause' }, { clauseText: 'Draft second clause' }] },
        confirmationRemark: { style: 'Hyphen', assignments: [{ clauseText: 'Must not appear' }] },
        nominationRemark: { style: 'Hyphen', assignments: [{ clauseText: 'Must not appear either' }] },
      },
    },
  });

  assert.deepEqual(model, {
    title: 'Hong Kong delivery',
    mode: 'draft',
    revisionId: 'a0R000000000001AAA',
    termsText: '1. Draft first clause\n\n2. Draft second clause',
    isDraft: true,
  });
  assert.doesNotMatch(JSON.stringify(model), /Must not appear/);
});

test('document preview key ignores remarks and changes only with document-facing content', () => {
  const base = { title: 'Term', mode: 'draft', termsText: '1. Clause', isDraft: true };
  assert.equal(documentPreviewKey(base), documentPreviewKey({ ...base, confirmationRemark: '- ignored', nominationRemark: '- ignored' }));
  assert.notEqual(documentPreviewKey(base), documentPreviewKey({ ...base, termsText: '1. Updated clause' }));
});

test('document preview paginates locally without clipping short clauses or orphaning markers', () => {
  const shortClauses = Array.from({ length: 30 }, (_, index) => `${index + 1}. Clause ${index + 1} requires a concise contractual action.`).join('\n\n');
  const pages = paginateDocumentText(shortClauses, { title: 'Multi-page delivery requirements' });
  assert.ok(pages.length > 1);
  assert.match(pages[0], /^1\. Clause 1/);
  assert.match(pages.at(-1), /30\. Clause 30/);
  assert.equal(pages.some((page) => /(?:^|\n)\d+\.\s*$/.test(page)), false);
});

test('document preview keeps a clause together when it fits on a fresh page', () => {
  const leading = `1. ${'First requirement '.repeat(180)}`;
  const second = `2. ${'Second requirement '.repeat(25)}`;
  const pages = paginateDocumentText(`${leading}\n\n${second}`, { title: 'Long terms' });
  const secondPageIndex = pages.findIndex((page) => page.includes('2. Second requirement'));
  assert.ok(secondPageIndex > 0);
  const secondClausePage = pages[secondPageIndex];
  assert.match(secondClausePage, /(?:^|\n\n)2\. Second requirement/);
  assert.doesNotMatch(secondClausePage, /2\.\s*$/m);
});

test('document preview strips Salesforce rich-text markup and tab spacing', () => {
  const china = '<p>1.\tFIRST REQUIREMENT &amp; LOCATION.</p><p>CONTINUATION.</p><p>2.\tSECOND REQUIREMENT.</p>';
  assert.equal(normalizeDocumentPreviewText(china), '1. FIRST REQUIREMENT & LOCATION.\n\nCONTINUATION.\n\n2. SECOND REQUIREMENT.');
  const model = specialTermDocumentModel({ term: { name: 'China', termsText: china }, mode: 'live' });
  assert.equal(model.termsText, '1. FIRST REQUIREMENT & LOCATION.\n\nCONTINUATION.\n\n2. SECOND REQUIREMENT.');
});
