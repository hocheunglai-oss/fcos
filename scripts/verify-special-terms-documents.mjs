import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateSpecialTermsDocument } from '../api/_specialTermsExport.js';

const outputDir = resolve(process.argv[2] || 'tmp/special-terms-document-qa');
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const generatedAt = new Date('2026-08-13T04:00:00.000Z');
const fixtures = [
  {
    key: 'structured-short',
    term: {
      name: 'Quality Claim and Measurement Requirements',
      termsText: '1. Suppliers shall accept quality claims submitted within 14 days after delivery.\n\n2. The supplier measurement shall be final for invoicing purposes.\n- Provide the signed bunker delivery receipt.\n- State the delivered quantity and unit of measure.',
      clauses: [
        { text: 'Suppliers shall accept quality claims submitted within 14 days after delivery.' },
        { text: 'The supplier measurement shall be final for invoicing purposes.\n- Provide the signed bunker delivery receipt.\n- State the delivered quantity and unit of measure.' },
      ],
    },
  },
  {
    key: 'structured-multipage',
    term: {
      name: 'Extended Delivery Requirements',
      termsText: Array.from({ length: 45 }, (_, index) => `${index + 1}. Requirement ${index + 1} shall be observed by all parties and confirmed in the applicable operational correspondence.`).join('\n\n'),
      clauses: Array.from({ length: 45 }, (_, index) => ({ text: `Requirement ${index + 1} shall be observed by all parties and confirmed in the applicable operational correspondence.` })),
    },
  },
  {
    key: 'structured-long-clause',
    term: {
      name: 'Detailed Compliance Warranty',
      termsText: `1. ${Array.from({ length: 38 }, (_, index) => `The supplier shall provide supporting compliance record ${index + 1} upon request.`).join(' ')}\n\n2. The buyer may retain all supporting documents for audit purposes.`,
      clauses: [
        { text: Array.from({ length: 38 }, (_, index) => `The supplier shall provide supporting compliance record ${index + 1} upon request.`).join(' ') },
        { text: 'The buyer may retain all supporting documents for audit purposes.' },
      ],
    },
  },
  {
    key: 'legacy-raw',
    term: {
      name: 'Legacy Port Instructions',
      termsText: 'DELIVERY AT OUTER ANCHORAGE\nSupplier to coordinate with the appointed agent.\n\nOriginal spelling and layout remain unchanged until migration approval.',
    },
  },
  {
    key: 'draft',
    source: 'draft',
    term: {
      name: 'Draft Cancellation Terms',
      termsText: '1. A cancellation charge of USD 1,000 shall apply after supplier confirmation.\n\n2. The supplier may waive the charge in writing.',
      clauses: [
        { text: 'A cancellation charge of USD 1,000 shall apply after supplier confirmation.' },
        { text: 'The supplier may waive the charge in writing.' },
      ],
    },
  },
];

for (const fixture of fixtures) {
  for (const format of ['pdf', 'docx']) {
    if (fixture.source === 'draft' && format === 'docx') continue;
    const generated = await generateSpecialTermsDocument(fixture.term, {
      format,
      source: fixture.source || 'live',
      generatedAt,
    });
    await writeFile(resolve(outputDir, `${fixture.key}.${format}`), generated.buffer);
  }
}

process.stdout.write(`${outputDir}\n`);
