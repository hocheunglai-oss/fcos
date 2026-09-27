import assert from 'node:assert/strict';
import test from 'node:test';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { collectPetroleumPreservationScope, petroleumScopeFingerprint, PETROLEUM_SCOPE_LIMITS } from '../api/_xeroIssuedPetroleumScope.js';
import { evaluatePetroleumFinancialDocument } from '../api/_xeroIssuedPetroleumPreservationAdapter.js';

const complete = (records) => ({ records, totalSize: records.length, done: true });
const invalid = { code: 'XERO_PETROLEUM_SCOPE_INCOMPLETE' };
const uuid = (i) => `11111111-0000-4000-8000-${String(i).padStart(12, '0')}`;
function fixture() {
  const f = issuedPetroleumFixture(); const queries = []; const calls = [];
  const rows = { org: [{ Id: f.fileEvidence.orgId, IsSandbox: false }], parents: structuredClone([f.supplier]),
    lines: structuredClone([f.child]), extras: [], products: structuredClone([f.product]) };
  const responseFor = (soql) => soql.includes('FROM Organization') ? rows.org : soql.includes('FROM Supplier_Invoice__c') ? rows.parents
    : soql.includes('FROM STEM_Line_Item__c') ? rows.lines : soql.includes('FROM STEM_Extra_Cost__c') ? rows.extras : rows.products;
  const options = {
    query: async (soql, options) => { queries.push({ soql, all: false, options }); return complete(responseFor(soql)); },
    queryAll: async (soql, options) => { queries.push({ soql, all: true, options }); return complete(responseFor(soql)); },
    accountingFetch: async (_connection, path, options) => {
      calls.push({ path, options });
      if (path.startsWith('/Invoices?')) return { Invoices: structuredClone([f.raw]) };
      if (path.startsWith('/CreditNotes?')) return { CreditNotes: [] };
      if (path === '/Accounts') return { Accounts: f.scope.accountTax.accounts };
      if (path === '/TaxRates') return { TaxRates: f.scope.accountTax.taxRates };
      throw Error(`Unexpected path ${path}`);
    },
  };
  const input = { records: f.packet.records, connection: { tenantId: f.ids.tenant }, salesforce: f.salesforce, xero: f.xero, sources: [f.source], stored: f.stored };
  return { ...f, input, options, rows, queries, calls };
}

test('collector actually fetches all-years source claims, raw BDN price and authoritative STEM/vessel then bounded full contact history', async () => {
  const f = fixture(); const scope = await collectPetroleumPreservationScope(f.input, f.options);
  assert.equal(scope.coverage.contentFingerprint, petroleumScopeFingerprint(scope)); assert.equal(scope.sourceFacts.get(f.ids.source).lines[0].Unit_Buy_At__c, 856.824);
  const parents = f.queries.find((query) => query.soql.includes('FROM Supplier_Invoice__c'));
  assert.equal(parents.all, true); assert.match(parents.soql, /Supplier__c IN .* OR STEM__c IN/); assert.doesNotMatch(parents.soql, /WHERE .*Invoice_Date__c|WHERE .*CreatedDate/);
  assert.match(parents.soql, /STEM__r\.Vessel__c/); assert.match(parents.soql, /STEM__r\.Delivery_Date__c/);
  const lines = f.queries.find((query) => query.soql.includes('FROM STEM_Line_Item__c'));
  assert.equal(lines.all, true); assert.match(lines.soql, /Quantity_Delivered_Per_BDN__c/); assert.match(lines.soql, /Unit_Buy_At__c/); assert.match(lines.soql, /Original_Supplier__c/); assert.doesNotMatch(lines.soql, /[, ]Supplier__c[, ]/); assert.doesNotMatch(lines.soql, /WHERE Cancelled/);
  assert.equal(f.calls.length, 4);
  for (const { path, options } of f.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.retryOnRateLimit, false); assert.equal(options.env.XERO_TRANSIENT_RETRY_LIMIT, '0'); assert.equal(options.callsPerMinute, 45);
    assert.equal(options.body, undefined);
    if (path.includes('?')) { const url = new URL(path, 'https://test.invalid'); assert.doesNotMatch(url.searchParams.get('where'), /Date|Status/);
      assert.match(url.searchParams.get('where'), /Contact\.ContactID==Guid/); assert.equal(url.searchParams.get('pageSize'), '100');
      assert.equal(url.searchParams.get('order'), path.startsWith('/Invoices') ? 'InvoiceID ASC' : 'CreditNoteID ASC');
      if (path.startsWith('/Invoices')) assert.equal(url.searchParams.get('includeArchived'), 'true'); }
  }
  assert.equal(evaluatePetroleumFinancialDocument(f.source, f.candidate, { ...f.context, petroleum: scope }, f.fileEvidence).eligible, true);
  assert.equal((await collectPetroleumPreservationScope(f.input, f.options)).coverage.contentFingerprint, scope.coverage.contentFingerprint);
});

for (const [name, change] of [
  ['wrong Salesforce org', f => { f.rows.org[0].Id = '00D000000000001'; }],
  ['Salesforce sandbox', f => { f.rows.org[0].IsSandbox = true; }],
  ['wrong Xero tenant', f => { f.input.connection.tenantId = f.ids.contact; }],
  ['duplicate selected record', f => { f.input.records.push(f.input.records[0]); }],
  ['incomplete global contacts', f => { f.xero.contactsComplete = false; }],
  ['missing selected source', f => { f.rows.parents = []; }],
  ['changed selected source header', f => { f.rows.parents[0].Invoice_Amount__c = 1; }],
  ['changed source delivery', f => { f.rows.parents[0].STEM__r.Delivery_Date__c = '2026-03-18'; }],
  ['changed raw BDN quantity', f => { f.rows.lines[0].Quantity_Delivered_Per_BDN__c = 1; }],
  ['changed raw buy rate', f => { f.rows.lines[0].Unit_Buy_At__c = 1; }],
  ['deleted selected parent', f => { f.rows.parents[0].IsDeleted = true; }],
  ['out-of-scope parent', f => { f.rows.parents.push({ ...f.rows.parents[0], Id: 'a06000000000002', Supplier__c: '001000000000002', STEM__c: 'a0H000000000002' }); }],
  ['duplicate historical parent', f => { f.rows.parents.push({ ...f.rows.parents[0] }); }],
  ['source query truncation', f => { f.options.queryAll = async () => ({ ...complete(f.rows.parents), totalSize: 9000 }); }],
  ['source query done false', f => { f.options.queryAll = async () => ({ ...complete(f.rows.parents), done: false }); }],
]) test(`scope fails closed on ${name}`, async () => { const f = fixture(); change(f); await assert.rejects(collectPetroleumPreservationScope(f.input, f.options), invalid); });

for (const [name, response] of [
  ['malformed collection', () => ({ Invoices: null })],
  ['out-of-scope Contact', f => ({ Invoices: [{ ...f.raw, Contact: { ContactID: f.ids.tenant } }] })],
  ['duplicate documents', f => ({ Invoices: [f.raw, f.raw] })],
  ['missing raw identifier', f => ({ Invoices: [{ ...f.raw, InvoiceID: undefined }] })],
  ['selected target race', f => ({ Invoices: [{ ...f.raw, DueDate: '2026-04-01' }] })],
  ['early terminal page', f => ({ Invoices: [f.raw], pagination: { page: 1, pageSize: 100, pageCount: 2, itemCount: 101 } })],
  ['invalid pagination', f => ({ Invoices: [f.raw], pagination: { page: '1' } })],
  ['wrong page', f => ({ Invoices: [f.raw], pagination: { page: 2 } })],
]) test(`scope rejects Xero ${name}`, async () => {
  const f = fixture(); const base = f.options.accountingFetch; f.options.accountingFetch = async (c, path, o) => path.startsWith('/Invoices?') ? response(f) : base(c, path, o);
  await assert.rejects(collectPetroleumPreservationScope(f.input, f.options), invalid);
});

test('past and null invoice dates really survive source retrieval into collision proof', async () => {
  for (const invoiceDate of [null, '2025-01-01']) {
    const f = fixture(); f.rows.parents.push({ ...structuredClone(f.supplier), Id: 'a06000000000002', Invoice_Date__c: invoiceDate, Invoice_Amount__c: 10 });
    const scope = await collectPetroleumPreservationScope(f.input, f.options); assert.equal(scope.sourceClaims.length, 2);
    const result = evaluatePetroleumFinancialDocument(f.source, f.candidate, { ...f.context, petroleum: scope }, f.fileEvidence);
    assert.equal(result.eligible, false); assert(result.blockers.some((row) => row.path === 'identity.numberCollisionSourceIds'));
  }
});

test('complete page pagination carries pre-cutoff archived number claim into adapter, with explicit archived flag', async () => {
  const f = fixture(); const base = f.options.accountingFetch; const first = [f.raw, ...Array.from({ length: 99 }, (_, i) => ({ ...f.raw, InvoiceID: uuid(i + 1), InvoiceNumber: `OTHER-${i}`, Total: 1 }))];
  f.options.accountingFetch = async (c, path, o) => {
    if (!path.startsWith('/Invoices?')) return base(c, path, o);
    const params = new URL(path, 'https://test.invalid').searchParams; assert.equal(params.get('includeArchived'), 'true');
    const page = Number(params.get('page')); return { Invoices: page === 1 ? first : [{ ...f.raw, InvoiceID: uuid(100), Date: '2025-01-01', Status: 'ARCHIVED', Total: 2 }], pagination: { page, pageSize: 100, pageCount: 2, itemCount: 101 } };
  };
  const scope = await collectPetroleumPreservationScope(f.input, f.options); assert.equal(scope.targetClaims.length, 101);
  const result = evaluatePetroleumFinancialDocument(f.source, f.candidate, { ...f.context, petroleum: scope }, f.fileEvidence); assert.equal(result.eligible, false);
  assert(result.blockers.some((row) => row.code === 'NUMBER_COLLISION'));
});

test('repeated page and changed pagination totals fail before eligibility', async () => {
  for (const repeated of [true, false]) {
    const f = fixture(); const base = f.options.accountingFetch;
    f.options.accountingFetch = async (c, path, o) => {
      if (!path.startsWith('/Invoices?')) return base(c, path, o);
      const page = Number(new URL(path, 'https://test.invalid').searchParams.get('page'));
      return { Invoices: Array.from({ length: 100 }, (_, i) => ({ ...f.raw, InvoiceID: uuid((repeated ? 0 : page * 100) + i) })), pagination: { page, pageSize: 100, pageCount: 3, itemCount: page === 2 && !repeated ? 201 : 200 } };
    };
    await assert.rejects(collectPetroleumPreservationScope(f.input, f.options), invalid);
  }
});

test('hard per-contact history bound cannot return a fabricated complete scope', async () => {
  const f = fixture(); let invoiceCalls = 0;
  f.options.accountingFetch = async (_c, path) => {
    assert(path.startsWith('/Invoices?')); const page = ++invoiceCalls;
    return { Invoices: Array.from({ length: 100 }, (_, i) => ({ ...f.raw, InvoiceID: uuid(page * 100 + i) })) };
  };
  await assert.rejects(collectPetroleumPreservationScope(f.input, f.options), invalid);
  assert.equal(invoiceCalls, PETROLEUM_SCOPE_LIMITS.perContact / PETROLEUM_SCOPE_LIMITS.pageSize + 1);
});

test('daily reserve callback halts before another read and carries the existing transport gate', async () => {
  const f = fixture(); let calls = 0; const gate = async () => {};
  f.options.requestGate = gate; f.options.accountingFetch = async (_c, _path, options) => {
    calls += 1; assert.equal(options.requestGate, gate); options.onResponse({ headers: new Headers({ 'x-daylimit-remaining': '0' }) }); return { Invoices: [f.raw] };
  };
  await assert.rejects(collectPetroleumPreservationScope(f.input, f.options), { code: 'XERO_FINANCIAL_DAILY_RESERVE' }); assert.equal(calls, 1);
});


test('actual single-currency schema needs no fictional child Supplier__c or optional extras monetary fields', async () => {
  const f = fixture();
  assert.equal(Object.hasOwn(f.child, 'Supplier__c'), false); assert.equal(f.child.Original_Supplier__c, f.ids.account);
  delete f.supplier.CurrencyIsoCode; delete f.child.CurrencyIsoCode; delete f.rows.parents[0].CurrencyIsoCode; delete f.rows.lines[0].CurrencyIsoCode;
  f.salesforce.safetyContext = { fields: { Supplier_Invoice__c: ['Invoice_File__c'], STEM_Line_Item__c: [], STEM_Extra_Cost__c: [] }, singleCurrency: true, corporateCurrency: 'USD' };
  const scope = await collectPetroleumPreservationScope(f.input, f.options);
  assert.equal(evaluatePetroleumFinancialDocument(f.source, f.candidate, { ...f.context, petroleum: scope }, f.fileEvidence).eligible, true);
  const extras = f.queries.find((row) => row.soql.includes('FROM STEM_Extra_Cost__c'));
  assert.doesNotMatch(extras.soql, /Quantity|Unit_|Supplier__c|Product2Id|CurrencyIsoCode/);
  assert(f.queries.every((row) => !row.soql.includes('CurrencyIsoCode')));
  scope.currencyContext.singleCurrency = false; scope.coverage.contentFingerprint = petroleumScopeFingerprint(scope);
  assert.equal(evaluatePetroleumFinancialDocument(f.source, f.candidate, { ...f.context, petroleum: scope }, f.fileEvidence).eligible, false);
});
