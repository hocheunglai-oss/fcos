import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNativeDocumentCandidates } from '../api/_xeroNativeDocumentCandidates.js';

const contact = { ContactID: '10000000-0000-4000-8000-000000000001', ContactStatus: 'ACTIVE', Name: 'Fixture Buyer' };
const lines = [{ description: 'Marine fuel', quantity: 10, unitAmount: 78, accountCode: '41100', taxType: 'NONE' }];
const invoice = { InvoiceID: '10000000-0000-4000-8000-000000000002', Contact: { ContactID: contact.ContactID },
  Status: 'AUTHORISED', Type: 'ACCREC', InvoiceNumber: 'INV-100', Date: '2026-09-10', CurrencyCode: 'HKD', Total: 780, SubTotal: 780, TotalTax: 0,
  LineAmountTypes: 'NoTax', CurrencyRate: 7.8,
  LineItems: [{ Description: 'Marine fuel', Quantity: 10, UnitAmount: 78, AccountCode: '41100', TaxType: 'NONE', LineAmount: 780 }] };
const record = { Id: 'a00000000000001AAA', Name: invoice.InvoiceNumber, Invoice_Date__c: invoice.Date,
  STEM__r: { Account__c: '001000000000001AAA', Account__r: { Name: contact.Name, Inactive_Suspended__c: false } } };

function fixture() {
  const calls = [];
  const responses = { contacts: { Contacts: [contact] }, invoices: { Invoices: [invoice] }, exact: { Invoices: [invoice] },
    accounts: [{ id: record.STEM__r.Account__c, name: contact.Name, companyCode: '', inactiveSuspended: false }], mappings: [] };
  const options = { sourceObject: 'Invoice__c', record, signedTotal: 780, currency: 'HKD', lines, expectedRate: 7.8,
    loadAccounts: async () => responses.accounts,
    loadTargetMappings: async ids => { assert.deepEqual(ids, [invoice.InvoiceID]); return responses.mappings; },
    read: async path => {
      const url = new URL(path, 'https://fixture.invalid');
      calls.push(url);
      if (url.pathname === '/Contacts') {
        assert.equal(url.searchParams.get('where'), 'Name=="Fixture Buyer"');
        assert.equal(url.searchParams.get('includeArchived'), 'true');
        return responses.contacts;
      }
      assert.equal(url.searchParams.get('unitdp'), '4');
      if (url.pathname === '/Invoices') {
        assert.equal(url.searchParams.get('where'), 'InvoiceNumber=="INV-100"');
        return responses.invoices;
      }
      assert.equal(url.pathname, `/Invoices/${invoice.InvoiceID}`);
      return responses.exact;
    },
  };
  return { calls, responses, options };
}

test('native search finds a matching current contact and existing invoice in two bounded reads', async () => {
  const f = fixture();
  const result = await inspectNativeDocumentCandidates(f.options);
  assert.equal(result.status, 'candidate_matches');
  assert.equal(result.contact.id, contact.ContactID);
  assert.equal(result.ownershipVerified, true);
  assert.equal(result.linesVerified, true);
  assert.equal(result.candidates[0].id, invoice.InvoiceID);
  assert.equal(f.calls.length, 2);
});

test('duplicates and changed saved targets are held without treating an exact-number search as an apply decision', async () => {
  const f = fixture();
  f.responses.contacts = { Contacts: [contact, { ...contact, ContactID: invoice.InvoiceID }] };
  assert.match((await inspectNativeDocumentCandidates(f.options)).blockers[0], /More than one active Xero contact/);
  f.responses.contacts = { Contacts: [contact] };
  f.responses.invoices = { Invoices: [] };
  f.responses.exact = { Invoices: [{ ...invoice, InvoiceNumber: 'RENAMED' }] };
  f.options.currentMapping = { id: 'mapping', salesforce_object: 'Invoice__c', salesforce_id: record.Id,
    xero_document_id: invoice.InvoiceID, xero_document_type: 'ACCREC', xero_contact_id: contact.ContactID };
  f.responses.mappings = [f.options.currentMapping];
  f.calls.length = 0;
  const result = await inspectNativeDocumentCandidates(f.options);
  assert.equal(result.status, 'held');
  assert.match(result.blockers[0], /conflicts with the issued document/);
  assert.equal(f.calls.length, 3);
});

test('rejects incomplete Xero pages and retains voided history as a hold', async () => {
  const f = fixture();
  f.responses.invoices = { Invoices: [invoice], pagination: { page: 1, pageCount: 2, itemCount: 1 } };
  await assert.rejects(inspectNativeDocumentCandidates(f.options), { code: 'XERO_NATIVE_DOCUMENT_CANDIDATES_INCOMPLETE' });
  f.responses.invoices = { Invoices: [{ ...invoice, Status: 'VOIDED' }] };
  const result = await inspectNativeDocumentCandidates(f.options);
  assert.equal(result.status, 'held');
  assert.equal(result.candidates[0].status, 'VOIDED');
});

test('checks supplier credits in CreditNotes and preserves an existing protected link', async () => {
  const number = 'CR-100';
  const supplierId = '001000000000002AAA';
  const sourceId = 'a00000000000002AAA';
  const mapping = { id: 'mapping', salesforce_object: 'Supplier_Invoice__c', salesforce_id: sourceId,
    xero_document_id: invoice.InvoiceID, xero_document_type: 'ACCPAYCREDIT',
    xero_contact_id: contact.ContactID, protected_legacy: true };
  const result = await inspectNativeDocumentCandidates({ sourceObject: 'Supplier_Invoice__c', signedTotal: -780, currency: 'HKD',
    record: { Id: sourceId, Name: number, Invoice_Date__c: invoice.Date, Supplier__c: supplierId,
      Supplier__r: { Name: contact.Name, Inactive_Suspended__c: false } },
    loadAccounts: async () => [{ id: supplierId, name: contact.Name, companyCode: '', inactiveSuspended: false }],
    loadTargetMappings: async () => [mapping],
    currentMapping: mapping,
    read: async path => {
      if (path.startsWith('/Contacts?')) return { Contacts: [contact] };
      const url = new URL(path, 'https://fixture.invalid');
      assert.equal(url.pathname, '/CreditNotes');
      assert.equal(url.searchParams.get('where'), 'CreditNoteNumber=="CR-100"');
      return { CreditNotes: [{ CreditNoteID: invoice.InvoiceID, CreditNoteNumber: number, Type: 'ACCPAYCREDIT',
        Contact: invoice.Contact, Status: 'AUTHORISED', Date: invoice.Date, CurrencyCode: 'HKD', Total: 780 }] };
    } });
  assert.equal(result.status, 'held');
  assert.deepEqual(result.blockers, ['The saved Xero document mapping is protected.']);
});


test('holds normalized Account aliases and explicit contact IDs that belong elsewhere', async () => {
  const f = fixture();
  f.responses.accounts.push({ id: '001000000000003AAA', name: 'fixture  buyer', companyCode: '', inactiveSuspended: true });
  const shared = await inspectNativeDocumentCandidates(f.options);
  assert.equal(shared.status, 'held');
  assert.equal(shared.ownershipVerified, false);
  assert.match(shared.blockers[0], /Another Salesforce Account/);
  f.responses.accounts.pop();
  f.responses.contacts = { Contacts: [{ ...contact, AccountNumber: '001000000000004AAA' }] };
  assert.match((await inspectNativeDocumentCandidates(f.options)).blockers[0], /Another Salesforce Account/);
});

test('holds an exact-number target owned by a different Salesforce document', async () => {
  const f = fixture();
  f.responses.mappings.push({ xero_document_id: invoice.InvoiceID, salesforce_object: 'Invoice__c', salesforce_id: 'a00000000000004AAA' });
  const result = await inspectNativeDocumentCandidates(f.options);
  assert.equal(result.status, 'held');
  assert.match(result.blockers[0], /owned by a different Salesforce document/);
});


test('holds changes to accounting lines, description or rate even with matching header totals', async () => {
  for (const change of [
    row => { row.LineItems[0].AccountCode = '50000'; },
    row => { row.LineItems[0].Description = 'Other fuel'; },
    row => { row.LineItems[0].TaxAmount = 0.001; },
    row => { row.LineItems[0].Quantity = 1; row.LineItems[0].UnitAmount = 780; },
    row => { row.CurrencyRate = 7.9; },
    row => { row.RoundingAmount = 0.01; },
  ]) {
    const f = fixture();
    const changed = structuredClone(invoice);
    change(changed);
    f.responses.invoices = { Invoices: [changed] };
    const result = await inspectNativeDocumentCandidates(f.options);
    assert.equal(result.status, 'held');
    assert.equal(result.linesVerified, false);
    assert.equal(f.calls.length, 2);
  }
});

test('reads detail only for an incomplete number result and holds an intervening document change', async () => {
  const f = fixture();
  const { LineItems: _lines, ...summary } = invoice;
  f.responses.invoices = { Invoices: [summary] };
  const result = await inspectNativeDocumentCandidates(f.options);
  assert.equal(result.linesVerified, true);
  assert.equal(f.calls.length, 3);
  f.responses.exact = { Invoices: [{ ...invoice, Status: 'PAID' }] };
  assert.match((await inspectNativeDocumentCandidates(f.options)).blockers[0], /changed between/);
});

test('a mapped native sales invoice verifies its stored summary presentation', async () => {
  const f = fixture();
  f.options.currentMapping = { id: 'mapping', salesforce_object: 'Invoice__c', salesforce_id: record.Id,
    xero_document_id: invoice.InvoiceID, xero_document_type: 'ACCREC', xero_contact_id: contact.ContactID,
    currency_evidence: { presentationPolicy: 'sales_invoice_summary_v1' } };
  f.responses.mappings = [f.options.currentMapping];
  f.responses.invoices = { Invoices: [{ ...invoice,
    LineItems: [{ ...invoice.LineItems[0], Description: 'INVOICE 10/9/2026', Quantity: 1, UnitAmount: 780 }] }] };
  assert.equal((await inspectNativeDocumentCandidates(f.options)).linesVerified, true);
  assert.equal(f.calls.length, 2);
});
