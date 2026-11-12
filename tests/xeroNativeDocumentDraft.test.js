import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmedNativeDocumentMapping } from '../api/_xeroNativeDocumentMapping.js';
import { prepareNativeDocumentDraft } from '../api/_xeroNativeDocumentDraft.js';

const tenantId = '10000000-0000-4000-8000-000000000001';
const contactId = '10000000-0000-4000-8000-000000000002';
const sourceId = 'a00000000000001AAA';

function fixture() {
  return { tenantId, sourceObject: 'Invoice__c', record: { Id: sourceId, Name: 'INV-100', STEM__r: { KeyStem__c: 'HK001T' } },
    sourceFingerprint: 'a'.repeat(64), currency: 'HKD', organisationCurrency: 'USD', signedTotal: 780,
    invoiceDate: '2026-09-10', dueDate: '2026-09-20', xeroCurrencyRate: 7.8,
    lines: [{ description: 'Marine fuel', quantity: 5, unitAmount: 150, accountCode: '41100', taxType: 'NONE' },
      { description: 'Charges', quantity: 1, unitAmount: 30, accountCode: '41100', taxType: 'NONE' }],
    xeroReview: { status: 'no_exact_number_match', ownershipVerified: true, contact: { id: contactId } } };
}

test('native buyer draft uses the maintained one-line sales policy and keeps source evidence', () => {
  const input = fixture();
  const original = structuredClone(input);
  const result = prepareNativeDocumentDraft(input);
  assert.equal(result.status, 'draft_preview');
  assert.equal(result.path, '/Invoices?unitdp=4&summarizeErrors=false');
  assert.equal(result.payload.Status, 'DRAFT');
  assert.equal(result.payload.CurrencyCode, 'HKD');
  assert.equal(result.payload.CurrencyRate, 7.8);
  assert.deepEqual(result.payload.Contact, { ContactID: contactId });
  assert.deepEqual(result.payload.LineItems, [{ Description: 'INVOICE 10/9/2026', Quantity: 1,
    UnitAmount: 780, AccountCode: '41100', TaxType: 'NONE' }]);
  assert.deepEqual(input, original);
  assert.notEqual(prepareNativeDocumentDraft({ ...input, sourceFingerprint: 'b'.repeat(64) }).reviewFingerprint, result.reviewFingerprint);
  assert.notEqual(prepareNativeDocumentDraft({ ...input, dueDate: '2026-09-21' }).reviewFingerprint, result.reviewFingerprint);
});

test('mixed accounts, protected targets and unresolved foreign rates do not produce a draft payload', () => {
  const input = fixture();
  input.lines[1].accountCode = '7999';
  assert.equal(prepareNativeDocumentDraft(input).status, 'held');
  assert.equal(prepareNativeDocumentDraft(input).payload, undefined);
  assert.equal(prepareNativeDocumentDraft({ ...fixture(), currentMapping: { id: 'saved' } }), null);
  assert.equal(prepareNativeDocumentDraft({ ...fixture(), xeroCurrencyRate: null }).status, 'held');
});

test('supplier credit retains the reviewed detailed line representation', () => {
  const input = { ...fixture(), sourceObject: 'Supplier_Invoice__c', signedTotal: -780 };
  const result = prepareNativeDocumentDraft(input);
  assert.equal(result.path, '/CreditNotes?unitdp=4&summarizeErrors=false');
  assert.equal(result.payload.Type, 'ACCPAYCREDIT');
  assert.equal(result.payload.DueDate, undefined);
  assert.equal(result.payload.Reference, undefined);
  assert.equal(result.payload.LineItems.length, 2);
  assert.equal(result.payload.LineItems[1].Description, 'Charges');
});

test('native mapping binds independent Xero draft evidence and preserves detailed source lines', () => {
  const input = fixture();
  Object.assign(input.record, { Amount__c: 100, Document_FX_Rate__c: 7.8, Document_FX_Revision__c: 'approved-rate',
    Document_FX_Confirmed_At__c: '2026-09-10T00:00:00Z' });
  input.lines = input.lines.map((line, index) => ({ ...line, sourceId: `source-${index}`,
    originalPriceEvidence: { snapshotId: `snapshot-${index}`, currency: 'HKD', nativeAmount: line.quantity * line.unitAmount } }));
  const draft = prepareNativeDocumentDraft(input);
  const expectedXeroId = '10000000-0000-4000-8000-000000000009';
  const observed = { ...draft.payload, InvoiceID: expectedXeroId, SubTotal: 780, Total: 780, TotalTax: 0,
    LineItems: [{ ...draft.payload.LineItems[0], LineAmount: 780 }] };
  const options = { sourceObject: input.sourceObject, source: input, draft, expectedXeroId, observed };
  const mapping = confirmedNativeDocumentMapping(options);
  assert.equal(mapping.xero_document_id, expectedXeroId);
  assert.equal(mapping.currency_evidence.presentationPolicy, 'sales_invoice_summary_v1');
  assert.equal(mapping.currency_evidence.originalLines.length, 2);
  assert.equal(mapping.currency_evidence.originalLines[0].snapshotId, 'snapshot-0');
  assert.equal(mapping.xero_currency_rate, 7.8);
  assert.equal(mapping.company_fx_revision, 'approved-rate');
  assert.equal(mapping.accounting_usd, 100);
  for (const drift of [{ InvoiceID: contactId }, { CurrencyRate: 7.81 }, { SentToContact: true }, { Status: 'AUTHORISED' }]) {
    assert.throws(() => confirmedNativeDocumentMapping({ ...options, observed: { ...observed, ...drift } }),
      { code: 'XERO_NATIVE_DOCUMENT_UNCONFIRMED' });
  }
  assert.throws(() => confirmedNativeDocumentMapping({ ...options,
    observed: { ...observed, LineItems: [{ ...observed.LineItems[0], AccountCode: '50000' }] } }),
    { code: 'XERO_NATIVE_DOCUMENT_LINES_CHANGED' });
});
