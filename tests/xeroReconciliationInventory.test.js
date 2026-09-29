import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshCampaignInventory } from '../api/_xeroReconciliationInventory.js';

const connection = { tenantId: 'tenant-one' };
const invoice = (id, status = 'AUTHORISED', total = 100) => ({ InvoiceID: id, Type: 'ACCREC', Status: status,
  InvoiceNumber: id, Contact: { ContactID: 'contact-one', Name: 'Buyer' }, CurrencyCode: 'USD',
  Total: total, AmountDue: total, AmountPaid: 0, AmountCredited: 0, Date: '2026-09-01',
  DueDate: '2026-09-30', LineItems: [], UpdatedDateUTC: '2026-09-29T00:00:00Z' });
const credit = (id) => ({ CreditNoteID: id, Type: 'ACCRECCREDIT', Status: 'AUTHORISED',
  CreditNoteNumber: id, Contact: { ContactID: 'contact-one', Name: 'Buyer' }, CurrencyCode: 'USD',
  Total: 10, RemainingCredit: 10, Date: '2026-09-01', LineItems: [], UpdatedDateUTC: '2026-09-29T00:00:00Z' });
const inventory = { complete: true, tenantId: connection.tenantId, contactsComplete: true,
  observedSince: '2026-09-29T10:00:00.500Z', documents: [{ id: 'invoice-one', collection: 'Invoices', status: 'AUTHORISED', total: 100 },
    { id: 'credit-one', collection: 'CreditNotes', status: 'AUTHORISED', total: 10 }], inactiveDocuments: [],
  contacts: [{ id: 'contact-one', name: 'Buyer', status: 'ACTIVE' }], organisation: { baseCurrency: 'USD' },
  paymentReadSnapshot: { invoices: [invoice('invoice-one')], payments: [{ PaymentID: 'payment-one', Amount: 30 }] } };

function fixture(overrides = {}) {
  const paths = [];
  const accountingFetch = async (_connection, path, options) => {
    paths.push({ path, options });
    if (overrides[path]) return overrides[path];
    if (path.startsWith('/Invoices?IDs=')) return { Invoices: [invoice('invoice-one', 'VOIDED', 100)] };
    if (path.startsWith('/CreditNotes?IDs=')) return { CreditNotes: [] };
    if (path.startsWith('/Invoices?')) return { Invoices: [invoice('invoice-one', 'VOIDED', 100)] };
    if (path.startsWith('/CreditNotes?')) return { CreditNotes: [] };
    if (path.startsWith('/Contacts?')) return { Contacts: [{ ContactID: 'contact-one', Name: 'Buyer Updated', ContactStatus: 'ACTIVE' }] };
    if (path.startsWith('/Payments?')) return { Payments: [{ PaymentID: 'payment-one', Amount: 35 }] };
    if (path === '/Organisations') return { Organisations: [{ BaseCurrency: 'USD', PeriodLockDate: '2026-08-31', EndOfYearLockDate: '2025-12-31' }] };
    throw new Error(`Unexpected path ${path}`);
  };
  return { paths, accountingFetch };
}

test('bounded sequential delta merges changed active/inactive evidence and exact missing targets', async () => {
  const f = fixture();
  const result = await refreshCampaignInventory({ connection, inventory, accountingFetch: f.accountingFetch,
    selectedInvoiceIds: ['invoice-one'], selectedCreditNoteIds: ['credit-one'] });
  assert.equal(result.callCount, 7);
  assert.equal(result.documents.some((row) => row.id === 'invoice-one'), false);
  assert.equal(result.inactiveDocuments.find((row) => row.id === 'invoice-one').status, 'VOIDED');
  assert.deepEqual(result.missingTargetIds, { invoices: [], creditNotes: ['credit-one'] });
  assert.equal(result.contacts[0].name, 'Buyer Updated');
  assert.equal(result.paymentReadSnapshot.payments[0].Amount, 35);
  assert.equal(result.organisation.periodLockDate, '2026-08-31');
  assert.ok(f.paths.slice(0, 4).every((row) => row.options.headers['If-Modified-Since']));
  assert.ok(f.paths.every((row) => row.path.includes('?page=') || row.path.includes('?IDs=') || row.path === '/Organisations'));
  assert.ok(f.paths.every((row) => row.options.method === 'GET'));
  assert.ok(Date.parse(result.observedSince) >= Date.parse(inventory.observedSince));
});

test('incomplete or wrong-tenant baseline fails before any provider read', async () => {
  const f = fixture();
  await assert.rejects(refreshCampaignInventory({ connection: { tenantId: 'other' }, inventory,
    accountingFetch: f.accountingFetch }), /same-tenant/);
  await assert.rejects(refreshCampaignInventory({ connection, inventory: { ...inventory, complete: false },
    accountingFetch: f.accountingFetch }), /same-tenant/);
  assert.equal(f.paths.length, 0);
});

test('duplicate delta IDs across pages and unexpected exact target fail closed', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => invoice(`new-${i}`));
  const duplicate = fixture({
    '/Invoices?page=1&pageSize=1000&summaryOnly=false&unitdp=4': { Invoices: full },
    '/Invoices?page=2&pageSize=1000&summaryOnly=false&unitdp=4': { Invoices: [full[0]] },
  });
  await assert.rejects(refreshCampaignInventory({ connection, inventory, accountingFetch: duplicate.accountingFetch }), /repeats an ID/);
  const wrong = fixture({ '/Invoices?IDs=invoice-one&summaryOnly=false&unitdp=4': { Invoices: [invoice('other-invoice')] } });
  await assert.rejects(refreshCampaignInventory({ connection, inventory, accountingFetch: wrong.accountingFetch,
    selectedInvoiceIds: ['invoice-one'] }), /conflicts/);
});

test('malformed page and organisation lock response cannot become a complete inventory', async () => {
  const broken = fixture({ '/Payments?page=1&pageSize=1000': { Payments: null } });
  await assert.rejects(refreshCampaignInventory({ connection, inventory, accountingFetch: broken.accountingFetch }), /malformed/);
  const locks = fixture({ '/Organisations': { Organisations: [] } });
  await assert.rejects(refreshCampaignInventory({ connection, inventory, accountingFetch: locks.accountingFetch }), /period locks/);
});
