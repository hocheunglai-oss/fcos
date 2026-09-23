import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingPayload, documentConfirmationErrors, documentReadiness, financialSourceCurrency, matchDocumentResponses, matchedXeroLines, normalizePostingMode, reviewedPostingMode, loadFinancialSafetyContext } from '../api/_xeroDocumentSafety.js';
import { buildFinancialClassifications, changedXeroReviewItems, xeroFinancialSyncApply, xeroReviewFingerprint } from '../api/_xeroFinancialSync.js';
import { buyerInvoiceApprovalProjection } from '../api/_buyerInvoiceApproval.js';

function fixture(mode = 'draft') {
  const buyer = { Id: 'buyer-invoice', Name: 'STEM-INV-1', STEM__c: 'stem', Amount__c: 100,
    Invoice_Date__c: '2026-09-01', Invoice_Due_Date__c: '2026-09-30', Proforma__c: false, Deprecated__c: false, File__c: '069000000000001AAA', CurrencyIsoCode: 'USD',
    STEM__r: { Id: 'stem', Name: 'STEM', Account__c: 'account', Account__r: { Name: 'Buyer' } } };
  const line = { Id: 'source-line', Buyer_Invoice__c: buyer.Id, Product__c: 'fuel', Product__r: { Name: 'Fuel' }, Quantity__c: 1, Price_Per_Unit__c: 100, Total_Price__c: 100, CurrencyIsoCode: 'USD' };
  const salesforce = { buyers: [buyer], suppliers: [], lines: [line], extras: [] };
  const xero = { contacts: [{ id: 'contact', name: 'Buyer', status: 'ACTIVE' }], documents: [], inactiveDocuments: [], organisation: { baseCurrency: 'USD' } };
  const stored = { documentMappings: [], productMappings: [{ direction: 'buyer', salesforce_product_id: 'fuel', xero_account_code: '200', xero_tax_type: 'NONE' }] };
  const build = () => buildFinancialClassifications(salesforce, xero, stored, { postingMode: mode }).rows[0];
  return { buyer, line, salesforce, xero, stored, build };
}

function current(row, overrides = {}) {
  return { id: 'xero-id', type: 'ACCREC', status: 'DRAFT', contactId: row.contactId, currency: row.currency, total: row.total,
    invoiceNumber: row.documentNumber, date: row.invoiceDate, dueDate: row.dueDate, reference: row.reference,
    amountDue: row.total, amountPaid: 0, amountCredited: 0, lineItems: row.lines.map((line, i) => ({ LineItemID: `xero-line-${i}`, Description: line.description,
      Quantity: line.quantity, UnitAmount: line.unitAmount, AccountCode: line.accountCode, TaxType: line.taxType, Tracking: [{ TrackingCategoryID: 'category', TrackingOptionID: 'option' }], ItemCode: 'OWNED-IN-XERO' })), ...overrides };
}

function confirmationFixture(type = 'ACCREC') {
  const credit = type.endsWith('CREDIT'); const idKey = credit ? 'CreditNoteID' : 'InvoiceID';
  const numberKey = credit ? 'CreditNoteNumber' : 'InvoiceNumber';
  const source = { xeroCollection: credit ? 'CreditNotes' : 'Invoices', xeroType: type,
    contactId: '22222222-2222-4222-8222-222222222222', currency: 'USD', total: 100, documentNumber: 'DOC-1' };
  const response = { [idKey]: '11111111-1111-4111-8111-111111111111', Type: type, Contact: { ContactID: source.contactId },
    CurrencyCode: 'USD', Total: 100, Status: 'AUTHORISED', [numberKey]: 'DOC-1' };
  return { source, idKey, numberKey, response, row: { id: 'row', proposed_action: 'create_draft', source_payload: source,
    proposed_payload: { Type: type, Contact: { ContactID: source.contactId }, CurrencyCode: 'USD', Status: 'AUTHORISED', [numberKey]: 'DOC-1' } } };
}

test('all document types require actual returned identity, accounting status and money before confirmation', () => {
  for (const type of ['ACCREC', 'ACCPAY', 'ACCRECCREDIT', 'ACCPAYCREDIT']) {
    const f = confirmationFixture(type);
    assert.deepEqual(documentConfirmationErrors(f.row, f.response), []);
    for (const field of [f.idKey, 'Type', 'Contact', 'CurrencyCode', 'Total', 'Status', f.numberKey]) {
      const response = { ...f.response }; delete response[field];
      assert.ok(documentConfirmationErrors(f.row, response).length, `${type} missing ${field}`);
    }
    for (const changes of [{ [f.idKey]: 'not-a-guid' }, { Type: 'WRONG' }, { Contact: { ContactID: 'other-contact' } },
      { CurrencyCode: 'HKD' }, { Total: 99.99 }, { Total: -100 }, { Total: null }, { Total: '' }, { Total: '100' },
      { Total: NaN }, { Total: Infinity }, { Status: 'DRAFT' }, { [f.numberKey]: 'DOC-OTHER' }, { HasErrors: true }]) {
      assert.ok(documentConfirmationErrors(f.row, { ...f.response, ...changes }).length, `${type}: ${JSON.stringify(changes)}`);
    }
  }
});

test('document updates must confirm the exact reviewed transaction ID', () => {
  for (const type of ['ACCREC', 'ACCRECCREDIT']) {
    const f = confirmationFixture(type); f.row.proposed_action = 'safe_update';
    assert.ok(documentConfirmationErrors(f.row, f.response).length, 'an update without reviewed identity fails closed');
    f.row.proposed_payload[f.idKey] = f.response[f.idKey];
    assert.deepEqual(documentConfirmationErrors(f.row, f.response), []);
    assert.ok(documentConfirmationErrors(f.row, { ...f.response, [f.idKey]: '33333333-3333-4333-8333-333333333333' }).length);
  }
});

test('batch response correlation is independent of position and rejects duplicate or missing identities', () => {
  const a = confirmationFixture(); const b = confirmationFixture();
  b.row.id = 'row-b'; b.source.documentNumber = 'DOC-2'; b.row.proposed_payload.InvoiceNumber = 'DOC-2';
  b.response.InvoiceNumber = 'DOC-2'; b.response.InvoiceID = '33333333-3333-4333-8333-333333333333';
  const rows = [a.row, b.row];
  assert.deepEqual(matchDocumentResponses(rows, [b.response, a.response]).map((item) => item.response.InvoiceID), [a.response.InvoiceID, b.response.InvoiceID]);
  for (const responses of [undefined, {}, [], [a.response, a.response], [a.response, { ...b.response, InvoiceID: a.response.InvoiceID }]]) {
    assert.ok(matchDocumentResponses(rows, responses).every((item) => item.errors.length));
  }
  assert.deepEqual(matchDocumentResponses(rows, [a.response]).map((item) => item.errors.length > 0), [false, true]);
  assert.ok(matchDocumentResponses([a.row, a.row], [a.response]).every((item) => item.errors.length));
});

test('posting modes default to draft and reject invalid or escalated apply modes', async () => {
  assert.equal(normalizePostingMode(), 'draft');
  for (const value of ['AUTHORISED', 'paid', '', null]) assert.throws(() => normalizePostingMode(value), { code: 'XERO_FINANCIAL_POSTING_MODE_INVALID' });
  assert.equal(reviewedPostingMode({}), 'draft');
  assert.throws(() => reviewedPostingMode({}, 'authorised'), { code: 'XERO_FINANCIAL_POSTING_MODE_CHANGED' });
  let rpcCalls = 0;
  const client = { from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { control_totals: { postingMode: 'draft' } } }) }; return query; }, rpc: async () => { rpcCalls++; return { data: {} }; } };
  await assert.rejects(xeroFinancialSyncApply({ reviewed: true, selectedItemIds: ['11111111-1111-4111-8111-111111111111'], postingMode: 'authorised' }, { client }), { code: 'XERO_FINANCIAL_POSTING_MODE_CHANGED' });
  assert.equal(rpcCalls, 0);
});

test('chosen mode changes source and review fingerprints and actual reviewed payload', () => {
  const draft = fixture().build(); const authorised = fixture('authorised').build();
  assert.equal(draft.status, 'eligible'); assert.equal(draft.proposedPayload.Status, 'DRAFT');
  assert.equal(authorised.status, 'eligible'); assert.equal(authorised.proposedPayload.Status, 'AUTHORISED');
  assert.notEqual(draft.sourceFingerprint, authorised.sourceFingerprint);
  assert.notEqual(xeroReviewFingerprint(draft), xeroReviewFingerprint(authorised));
  const saved = { id: 'item', source_payload: draft, proposed_action: draft.action, proposed_payload: draft.proposedPayload, xero_payload: {}, blockers: [], differences: [] };
  assert.equal(changedXeroReviewItems([saved], new Map([['Invoice__c:buyer-invoice', authorised]])).length, 1);
});

test('issued buyer invoice and credit readiness blocks missing file, proforma and deprecated evidence', () => {
  for (const change of [{ File__c: '' }, { Proforma__c: true }, { Deprecated__c: true }, { Proforma__c: undefined }]) {
    const f = fixture('authorised'); Object.assign(f.buyer, change);
    assert.equal(f.build().status, 'blocked'); assert.equal(f.build().proposedPayload, null);
  }
  const draft = fixture(); draft.buyer.File__c = ''; assert.equal(draft.build().proposedPayload.Status, 'DRAFT');
  const credit = fixture('authorised'); Object.assign(credit.buyer, { Name: 'STEM-CN-1', Amount__c: -100 });
  credit.line.Total_Price__c = -100; credit.line.Price_Per_Unit__c = -100;
  assert.equal(credit.build().proposedPayload.Type, 'ACCRECCREDIT');
  assert.equal(credit.build().proposedPayload.Status, 'AUTHORISED');
});

test('buyer snapshots reuse immutable projection and fail closed when file, line or snapshot changes', () => {
  const f = fixture('authorised'); f.buyer._buyerInvoiceDocument = { Id: f.buyer.File__c, LatestPublishedVersionId: 'version' };
  const live = { stem: f.buyer.STEM__r, allLineItems: [f.line], allExtraCosts: [] };
  f.buyer.Buyer_Charge_Snapshot__c = JSON.stringify(buyerInvoiceApprovalProjection(f.buyer, live));
  assert.equal(f.build().status, 'eligible');
  f.buyer._buyerInvoiceDocument.LatestPublishedVersionId = 'new-version'; assert.equal(f.build().status, 'blocked');
  f.buyer.Buyer_Charge_Snapshot__c = '{'; assert.equal(f.build().status, 'blocked');
});

test('supplier readiness requires exact linked issued children and available supplier file evidence', () => {
  const invoice = { Id: 'supplier-invoice', STEM__c: 'stem', Supplier__c: 'supplier', Invoice_File__c: 'source.pdf' };
  const children = [{ Id: 'child', Supplier_Invoice__c: invoice.Id, STEM__c: 'stem', Supplier__c: 'supplier' }];
  const context = { fields: { Supplier_Invoice__c: ['Invoice_File__c'] } };
  assert.equal(documentReadiness(invoice, 'supplier', children, context).ready, true);
  for (const changes of [{ Supplier_Invoice__c: 'wrong' }, { Cancelled__c: true }, { STEM__c: 'wrong' }, { Supplier__c: 'wrong' }]) {
    assert.equal(documentReadiness(invoice, 'supplier', [{ ...children[0], ...changes }], context).ready, false);
  }
  assert.equal(documentReadiness({ ...invoice, Invoice_File__c: null }, 'supplier', children, context).ready, false);
  assert.equal(documentReadiness(invoice, 'supplier', [], context).ready, false);
});

test('routine currency uses source or verified single-currency org and blocks missing, mixed or FX evidence', () => {
  assert.equal(financialSourceCurrency({}, [], {}).currency, null);
  assert.equal(financialSourceCurrency({}, [], { singleCurrency: true, corporateCurrency: 'HKD' }).currency, 'HKD');
  assert.equal(financialSourceCurrency({}, [], { singleCurrency: false, corporateCurrency: 'USD' }).currency, null);
  assert.ok(financialSourceCurrency({ CurrencyIsoCode: 'USD' }, [{ CurrencyIsoCode: 'HKD' }]).blockers.length);
  for (const change of ['missing', 'fx', 'org']) {
    const f = fixture('authorised');
    if (change === 'missing') delete f.buyer.CurrencyIsoCode;
    if (change === 'fx') { f.buyer.CurrencyIsoCode = 'HKD'; f.line.CurrencyIsoCode = 'HKD'; }
    if (change === 'org') delete f.xero.organisation.baseCurrency;
    assert.equal(f.build().status, 'blocked'); assert.equal(f.build().proposedPayload, null);
  }
});

test('read-only schema checks never query unavailable currency fields and require authoritative org evidence', async () => {
  const context = await loadFinancialSafetyContext({ request: async () => ({ fields: [{ name: 'Id' }] }), userCurrency: async () => ({ singleCurrency: true, corporateCurrency: 'USD' }) });
  assert.equal(context.corporateCurrency, 'USD'); assert.equal(context.singleCurrency, true);
  const multi = await loadFinancialSafetyContext({ request: async () => ({ fields: [{ name: 'CurrencyIsoCode' }] }), userCurrency: async () => ({ singleCurrency: true, corporateCurrency: 'USD' }) });
  assert.equal(multi.singleCurrency, false); assert.equal(multi.corporateCurrency, null);
});

test('exact draft is authorised only in reviewed authorised mode with readiness rechecked', () => {
  const f = fixture('authorised'); f.xero.documents = [current(f.build())];
  const row = f.build(); assert.equal(row.action, 'safe_update'); assert.equal(row.proposedPayload.Status, 'AUTHORISED');
  f.buyer.File__c = ''; assert.equal(f.build().status, 'blocked');
});

test('updates preserve Xero line identity, tracking, item metadata and document metadata', () => {
  const f = fixture(); const baseline = f.build(); f.xero.documents = [current(baseline, { reference: 'old', unowned: { BrandingThemeID: 'brand', Url: 'https://example.test/source' } })];
  const row = f.build(); assert.equal(row.action, 'safe_update');
  assert.equal(row.proposedPayload.LineItems[0].LineItemID, 'xero-line-0');
  assert.deepEqual(row.proposedPayload.LineItems[0].Tracking, f.xero.documents[0].lineItems[0].Tracking);
  assert.equal(row.proposedPayload.LineItems[0].ItemCode, 'OWNED-IN-XERO');
  assert.equal(row.proposedPayload.BrandingThemeID, 'brand'); assert.equal(row.proposedPayload.Url, 'https://example.test/source');
});

test('line matching resolves reordered unique lines but blocks ambiguous correspondence and removal', () => {
  const line = { description: 'Fuel A', quantity: 1, unitAmount: 100, accountCode: '200', taxType: 'NONE' };
  const lines = [line, { ...line, description: 'Fuel B', unitAmount: 200 }];
  const originals = [{ LineItemID: 'b', Description: 'Fuel B', Quantity: 1, UnitAmount: 200, AccountCode: '200', TaxType: 'NONE' }, { LineItemID: 'a', Description: 'Fuel A', Quantity: 1, UnitAmount: 100, AccountCode: '200', TaxType: 'NONE' }];
  assert.deepEqual(matchedXeroLines(lines, originals).lines.map((row) => row.LineItemID), ['a', 'b']);
  assert.ok(matchedXeroLines([line], originals).blockers.length);
  assert.ok(matchedXeroLines([line, line], [{ ...originals[1], LineItemID: 'a' }, { ...originals[1], LineItemID: 'b' }]).blockers.length);
  assert.ok(matchedXeroLines([line], [{ ...originals[1], LineItemID: null }]).blockers.length);
  assert.throws(() => accountingPayload({ ...fixture().build(), lines }, 'existing', 'DRAFT'), { code: 'XERO_FINANCIAL_LINE_IDENTITY_UNSAFE' });
});

test('paid or locked accounting can only link unchanged history and target locked dates cannot post', () => {
  for (const protection of [{ status: 'PAID', amountPaid: 100, amountDue: 0 }, { status: 'AUTHORISED', date: '2026-08-01' }]) {
    const f = fixture('authorised'); f.xero.documents = [current(f.build(), protection)]; f.xero.organisation.periodLockDate = '2026-08-31';
    const row = f.build(); assert.equal(row.action, 'protected_legacy'); assert.equal(row.proposedPayload, null);
  }
  const f = fixture('authorised'); f.xero.organisation.periodLockDate = '2026-09-30'; assert.equal(f.build().status, 'blocked');
});

test('fresh source and Xero tracking changes invalidate a saved reviewed update', () => {
  const f = fixture('authorised'); f.xero.documents = [current(f.build(), { reference: 'old' })];
  const row = f.build();
  const saved = { id: 'item', source_payload: row, proposed_action: row.action, proposed_payload: row.proposedPayload, xero_payload: structuredClone(row.xero), blockers: row.blockers, differences: row.differences };
  f.xero.documents[0].lineItems[0].Tracking[0].TrackingOptionID = 'changed';
  assert.equal(changedXeroReviewItems([saved], new Map([['Invoice__c:buyer-invoice', f.build()]])).length, 1);
});
