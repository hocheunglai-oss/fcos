import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentCorrectionItems, canonicalCorrectionInvoice, xeroFinancialDocumentCorrectionApply,
  xeroFinancialDocumentCorrectionPage, xeroFinancialDocumentCorrectionPreview, xeroFinancialDocumentCorrectionVerify } from '../api/_xeroDocumentCorrections.js';
import { buildFinancialClassifications, normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';
import { documentCorrectionHash } from '../api/_xeroDocumentCorrectionPersistence.js';
import { storage } from './xeroFinancialPreviewFixtures.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const tenantId = uuid(1);
const actor = { id: uuid(2), email: 'finance@fixture.invalid' };
const buyerId = 'a01000000000001AAA';
const supplierId = 'a06000000000001AAA';
const buyerAccount = '001000000000001AAA';
const supplierAccount = '001000000000002AAA';

function fixture() {
  const store = storage();
  const stem = { Name: 'STEM-ONE', KeyStem__c: 'STEM-ONE', RefCode__c: 'HK2625070T',
    Account__c: buyerAccount, Account__r: { Name: 'Fixture Buyer' }, Vessel__r: { Name: 'HUAYUE' }, Delivery_Date__c: '2025-12-01' };
  const salesforce = { documentFieldPolicyVersion: 'document_field_correction_v1',
    buyers: [{ Id: buyerId, Name: '25070T-INV-1', STEM__c: 'stem-one', STEM__r: structuredClone(stem),
      CurrencyIsoCode: 'USD', Amount__c: 100, Delivery_Date__c: '2026-01-27', Invoice_Date__c: '2026-01-28',
      Invoice_Due_Date__c: '2026-02-25', Proforma__c: false, Deprecated__c: false, File__c: '069000000000001AAA' }],
    suppliers: [{ Id: supplierId, Name: 'ORIGINAL-SUPPLIER-1', STEM__c: 'stem-one', STEM__r: structuredClone(stem),
      Supplier__c: supplierAccount, Supplier__r: { Name: 'Fixture Supplier' }, CurrencyIsoCode: 'USD', Invoice_Amount__c: 100,
      Invoice_Date__c: null, Delivery_Date__c: '2025-10-01', Invoice_Due_Date__c: '2026-02-28', Invoice_File__c: '069000000000002AAA', Status__c: 'Issued' }],
    lines: [{ Id: 'a02000000000001AAA', STEM__c: 'stem-one', Buyer_Invoice__c: buyerId, Supplier_Invoice__c: supplierId,
      Supplier__c: supplierAccount, CurrencyIsoCode: 'USD', Product__c: 'product-fuel', Product__r: { Name: 'Marine Gas Oil' },
      Quantity__c: 1, Price_Per_Unit__c: 100, Total_Price__c: 100, Cost_Per_Unit__c: 100, Total_Cost__c: 100 }],
    extras: [], products: [], productRecords: [], fingerprintBasis: ['complete-source'] };
  const stored = { productMappings: [
    { id: uuid(10), direction: 'buyer', enabled: true, salesforce_product_id: 'product-fuel', xero_account_code: '200', xero_tax_type: 'NONE' },
    { id: uuid(11), direction: 'supplier', enabled: true, salesforce_product_id: 'product-fuel', xero_account_code: '300', xero_tax_type: 'NONE' },
  ], documentMappings: [], bankMappings: [], documentCorrectionClaims: [], documentCorrectionEvents: [] };
  store.tables.xero_document_field_correction_claims = stored.documentCorrectionClaims;
  store.tables.xero_document_field_correction_events = stored.documentCorrectionEvents;
  const rawLine = (id, amount, code) => ({ LineItemID: id, Description: 'Historic issued description', Quantity: 1,
    UnitAmount: amount, LineAmount: amount, AccountCode: code, AccountID: `account-${code}`, TaxType: 'NONE', TaxAmount: 0,
    Tracking: [{ TrackingCategoryID: 'division-id', TrackingOptionID: 'hk-id', Name: 'Division', Option: 'HK' }], ItemCode: 'MGO' });
  const invoices = ['ACCREC', 'ACCPAY'].map((Type, index) => ({ InvoiceID: uuid(100 + index), Type, Status: index ? 'AUTHORISED' : 'PAID',
    Date: '2026-01-27', DueDate: '2026-01-30', InvoiceNumber: index ? 'OLD-ERP-BILL' : 'OLD-SALES-NUMBER', Reference: 'KEEP SUPPLIER REFERENCE',
    Contact: { ContactID: uuid(200 + index), Name: index ? 'Fixture Supplier' : 'Fixture Buyer', ContactPersons: [] },
    CurrencyCode: 'USD', CurrencyRate: 7.78345, LineAmountTypes: 'NoTax', SubTotal: 100, TotalTax: 0, Total: 100,
    AmountDue: index ? 100 : 0, AmountPaid: index ? 0 : 100, AmountCredited: 0, IsDiscounted: false,
    Payments: index ? [] : [{ PaymentID: uuid(300), Amount: 100, Date: '2026-01-28', CurrencyRate: 7.781 }],
    CreditNotes: [], Prepayments: [], Overpayments: [], BrandingThemeID: uuid(400), HasAttachments: true,
    Attachments: [{ AttachmentID: uuid(401 + index), FileName: 'issued.pdf' }], UpdatedDateUTC: '2026-01-28T00:00:00Z',
    LineItems: index ? [rawLine('bill-line', 100, '300')] : [rawLine('sales-line-one', 60, '200'), rawLine('sales-line-two', 40, '200')] }));
  stored.documentMappings = invoices.map((invoice, index) => ({ id: uuid(500 + index),
    salesforce_object: index ? 'Supplier_Invoice__c' : 'Invoice__c', salesforce_id: index ? supplierId : buyerId,
    salesforce_document_number: index ? 'ORIGINAL-SUPPLIER-1' : '25070T-INV-1', xero_document_type: invoice.Type,
    xero_document_id: invoice.InvoiceID, xero_contact_id: invoice.Contact.ContactID, protected_legacy: false,
    retained_differences: { accountId: index ? supplierAccount : buyerAccount, originalAudit: 'preserve-this-receipt' } }));
  const contacts = invoices.map((invoice) => ({ ContactID: invoice.Contact.ContactID, Name: invoice.Contact.Name, ContactStatus: 'ACTIVE' }));
  const calls = []; const claims = []; const finishes = []; const behavior = {};
  const xero = () => ({ tenantId, rawInvoices: structuredClone(invoices), documents: invoices.map(normalizeXeroInvoice),
    inactiveDocuments: [], contactsComplete: true, contacts: contacts.map((contact) => ({ id: contact.ContactID, name: contact.Name, status: 'ACTIVE' })),
    organisation: { baseCurrency: 'HKD', periodLockDate: null, endOfYearLockDate: null } });
  const dependencies = { client: store.client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, accessContext: { profile: actor },
    getConnection: async () => ({ tenantId, scope: 'accounting.invoices accounting.contacts accounting.settings.read' }),
    loadSalesforce: async (cutoff) => { assert.equal(cutoff, '2026-01-01'); return structuredClone(salesforce); },
    loadControls: async () => structuredClone(stored), loadPages: async (_connection, path) => {
      calls.push({ path, method: 'GET' });
      if (path === '/Contacts') return structuredClone(contacts);
      const params = new URL(path, 'https://fixture.invalid').searchParams;
      assert.equal(params.get('unitdp'), '4'); assert.equal(params.get('summaryOnly'), 'false');
      assert.ok(params.has('where') || params.has('IDs') || params.has('InvoiceNumbers'), 'Every invoice inventory request must have a complete explicit scope');
      const matches = invoices.filter((invoice) => params.has('IDs') ? params.get('IDs').split(',').includes(invoice.InvoiceID)
        : params.has('InvoiceNumbers') ? params.get('InvoiceNumbers').split(',').includes(invoice.InvoiceNumber)
          : invoice.Date >= '2026-01-01');
      return structuredClone(matches);
    },
    accountingFetch: async (_connection, path, options = {}) => {
      calls.push({ path, method: options.method, body: structuredClone(options.body), idempotencyKey: options.idempotencyKey });
      if (path === '/Organisations') return { Organisations: [{ OrganisationID: tenantId, BaseCurrency: 'HKD' }] };
      const targetUrl = new URL(path, 'https://fixture.invalid');
      assert.equal(targetUrl.searchParams.get('unitdp'), '4');
      const invoice = invoices.find((value) => targetUrl.pathname === `/Invoices/${value.InvoiceID}`);
      assert.ok(invoice, `Exact known provider target required: ${path}`);
      if (options.method === 'POST') {
        if (behavior.timeoutBeforeWrite) throw new Error('Provider timeout before confirmation');
        Object.assign(invoice, structuredClone(options.body.Invoices[0]));
        if (behavior.timeoutAfterWrite) throw new Error('Provider timeout after possible mutation');
        if (behavior.badResponse) return { Invoices: [{ ...structuredClone(invoice), InvoiceID: uuid(999) }] };
        if (behavior.validationError) return { Invoices: [{ ...structuredClone(invoice), HasErrors: true, ValidationErrors: [{ Message: 'Rejected' }] }] };
        if (behavior.changeInvariant) invoice.CurrencyRate = 7.9;
        if (behavior.conflictingDateAlias) invoice.DateString = '2026-02-20T00:00:00Z';
      }
      return { Invoices: [structuredClone(invoice)] };
    },
    claim: async (_client, input) => {
      const existing = stored.documentCorrectionClaims.find((value) => value.idempotency_key === input.idempotencyKey);
      claims.push(structuredClone(input));
      if (existing) {
        assert.equal(documentCorrectionHash(input.evidence), existing.evidence_hash, 'Replay must use the identical original intent and authority');
        return { ...existing, alreadyClaimed: true };
      }
      const entry = { id: uuid(600 + claims.length), tenant_id: input.tenantId, xero_invoice_id: input.xeroInvoiceId,
        mapping_id: input.mappingId, idempotency_key: input.idempotencyKey, status: 'intent', evidence: structuredClone(input.evidence),
        evidence_hash: documentCorrectionHash(input.evidence), created_at: new Date().toISOString() };
      stored.documentCorrectionClaims.push(entry);
      return { ...entry, alreadyClaimed: false };
    },
    finish: async (_client, input) => {
      finishes.push(structuredClone(input));
      stored.documentCorrectionEvents.push({ id: uuid(700 + finishes.length), claim_id: input.claimId, sequence: finishes.length,
        status: input.status, evidence: structuredClone(input.evidence), evidence_hash: documentCorrectionHash(input.evidence) });
      stored.documentCorrectionClaims.find((entry) => entry.id === input.claimId).status = input.status;
      return { id: uuid(700 + finishes.length) };
    },
  };
  const preview = () => xeroFinancialDocumentCorrectionPreview({}, dependencies);
  const apply = (result, ids = result.items.filter((item) => item.outcome === 'eligible').map((item) => item.id)) =>
    xeroFinancialDocumentCorrectionApply({ previewId: result.previewId, itemIds: ids }, dependencies);
  return { ...store, salesforce, stored, invoices, xero, dependencies, calls, claims, finishes, behavior, preview, apply };
}

function reserveOverride(f) {
  const grant = { authorityId: uuid(800), actorId: actor.id, tenantId, policy: 'document_field_correction_v1',
    issuedAt: new Date(Date.now() - 5000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), maxBatchSize: 2 };
  f.dependencies.env.FCOS_XERO_DOCUMENT_CORRECTION_RESERVE_OVERRIDE = JSON.stringify(grant);
  return grant;
}

function observedAllowance(f, remaining = 190, status = 200) {
  for (const key of ['accountingFetch', 'loadPages']) {
    const original = f.dependencies[key];
    f.dependencies[key] = async (...args) => {
      const options = args[key === 'loadPages' ? 3 : 2];
      if (status === 429) options.onResponse({ status, headers: new Headers({ 'x-daylimit-remaining': String(remaining), 'x-rate-limit-problem': 'day', 'retry-after': '120' }) });
      const result = await original(...args);
      options.onResponse({ status, headers: new Headers({ 'x-daylimit-remaining': String(f.behavior.dayRemaining ?? remaining) }) });
      return result;
    };
  }
}

function pinCanary(f, preview, grant) {
  const selected = f.tables.xero_document_field_correction_previews.find((row) => row.id === preview.previewId).items.filter((item) => item.outcome === 'eligible');
  f.tables.xero_financial_audit_events.push({ id: 801, event_type: 'document_correction_allowance_canary', actor_id: actor.id,
    actor_email: actor.email, created_at: new Date().toISOString(), fingerprints: { authorityId: grant.authorityId,
      grantHash: documentCorrectionHash(grant), tenantId, previewId: preview.previewId,
      itemIds: selected.map((item) => item.id).sort(), xeroInvoiceIds: selected.map((item) => item.xeroInvoiceId).sort() } });
  return selected;
}

test('ordinary corrections retain 200-call reserve; scoped grant permits a full preview and records its authority', async () => {
  const ordinary = fixture(); observedAllowance(ordinary);
  await assert.rejects(ordinary.preview(), (error) => error.code === 'XERO_FINANCIAL_DAILY_RESERVE');
  const scoped = fixture(); const grant = reserveOverride(scoped); observedAllowance(scoped);
  const preview = await scoped.preview();
  assert.equal(preview.totalCount, 2); assert.equal(preview.rateLimit.dayRemaining, 190);
  assert.deepEqual(preview.summary.allowanceAuthority, grant);
  assert.deepEqual(scoped.tables.xero_financial_audit_events.at(-1).fingerprints.allowanceAuthority, grant);
  assert.equal(scoped.claims.length, 0);
});

test('override apply requires exact saved two-target pin and preserves its authority in immutable intent and readback', async () => {
  const f = fixture(); const grant = reserveOverride(f); observedAllowance(f);
  const preview = await f.preview(); const reads = f.calls.length;
  await assert.rejects(f.apply(preview), (error) => error.code === 'XERO_DOCUMENT_CORRECTION_CANARY_INVALID');
  assert.equal(f.calls.length, reads, 'A missing pin fails before provider reads or writes');
  pinCanary(f, preview, grant);
  const originalMappings = structuredClone(f.stored.documentMappings);
  const payments = structuredClone(f.invoices.map((invoice) => invoice.Payments));
  const result = await f.apply(preview);
  assert.deepEqual(result.items.map((item) => item.outcome), ['applied', 'applied']);
  assert.equal(f.claims.length, 2);
  for (const claim of f.claims) {
    assert.deepEqual(claim.evidence.allowanceAuthority.grant, grant);
    assert.equal(claim.evidence.allowanceAuthority.pin.id, 801);
  }
  assert.deepEqual(f.stored.documentMappings, originalMappings);
  assert.deepEqual(f.invoices.map((invoice) => invoice.Payments), payments);
  const posts = f.calls.filter((call) => call.method === 'POST').length;
  assert.equal((await f.apply(preview)).items.every((item) => item.outcome === 'applied'), true);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, posts, 'Replay only reads existing receipts');
});

test('a true provider 429 stops an override preview without saving partial rows or sending a correction', async () => {
  const f = fixture(); reserveOverride(f); observedAllowance(f, 0, 429);
  await assert.rejects(f.preview(), (error) => error.status === 429 && error.code === 'XERO_CONTACT_SYNC_RATE_LIMITED');
  assert.equal((f.tables.xero_document_field_correction_previews || []).length, 0);
  assert.equal(f.claims.length, 0); assert.equal(f.calls.filter((call) => call.method === 'POST').length, 0);
  assert.equal(f.tables.xero_financial_audit_events.at(-1).rate_limit_snapshot.dayRemaining, 0);
});

test('one uncertain canary item recovers through pinned subset readback without resending either target', async () => {
  const f = fixture(); const grant = reserveOverride(f); observedAllowance(f);
  const preview = await f.preview(); pinCanary(f, preview, grant); f.behavior.timeoutAfterWrite = true;
  const result = await f.apply(preview); assert.equal(result.items[0].outcome, 'uncertain');
  assert.equal(result.items[1].outcome, 'blocked');
  const posts = f.calls.filter((call) => call.method === 'POST').length;
  const recovered = await xeroFinancialDocumentCorrectionVerify({ previewId: preview.previewId, itemIds: [result.items[0].id] }, f.dependencies);
  assert.equal(recovered.items[0].outcome, 'applied');
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, posts);
});

test('expired canary readback recovers under the ordinary reserve without granting a new write exception', async (t) => {
  const f = fixture(); const grant = reserveOverride(f); observedAllowance(f);
  const preview = await f.preview(); pinCanary(f, preview, grant); f.behavior.timeoutAfterWrite = true;
  const result = await f.apply(preview); const ids = [result.items[0].id];
  const posts = f.calls.filter((call) => call.method === 'POST').length;
  t.mock.method(Date, 'now', () => Date.parse(grant.expiresAt) + 1000);
  const held = await xeroFinancialDocumentCorrectionVerify({ previewId: preview.previewId, itemIds: ids }, f.dependencies);
  assert.equal(held.items[0].outcome, 'uncertain');
  f.behavior.dayRemaining = 500;
  const recovered = await xeroFinancialDocumentCorrectionVerify({ previewId: preview.previewId, itemIds: ids }, f.dependencies);
  assert.equal(recovered.items[0].outcome, 'applied');
  await assert.rejects(f.apply(preview), error => error.code === 'XERO_DOCUMENT_CORRECTION_CANARY_INVALID');
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, posts);
});

test('explicit correction preview saves complete evidence without any provider POST and publishes only review fields', async () => {
  const f = fixture(); const result = await f.preview();
  assert.equal(result.policy, 'document_field_correction_v1'); assert.equal(result.summary.eligible, 2);
  assert.equal(result.totalCount, 2); assert.equal(result.nextOffset, null);
  assert.deepEqual(result.scope, { cutoff: '2026-01-01', totalSourceCount: 2, excludedLegacyCount: 0 });
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
  assert.equal(f.claims.length, 0);
  assert.equal(f.tables.xero_document_field_correction_previews.length, 1);
  assert.equal(Object.hasOwn(result.items[0], 'before'), false); assert.equal(Object.hasOwn(result.items[0], 'source'), false);
  const saved = f.tables.xero_document_field_correction_previews[0].items;
  assert.deepEqual(saved[0].projection.fields, { Date: '2026-01-27', DueDate: '2026-02-25', InvoiceNumber: '25070T-INV-1', Reference: 'HUAYUE', Description: 'INVOICE 28/1/2026' });
  assert.deepEqual(saved[1].projection.fields, { Date: '2026-01-27', DueDate: '2026-02-28', InvoiceNumber: '25070T- HUAYUE', Description: '28/1/2026' });
  assert.equal(saved[1].source.invoiceDate, null, 'Bill projection must use the linked buyer invoice date');
});

test('a newly introduced special preservation receipt stops narrowed apply before any provider reads or intent', async () => {
  for (const key of ['groupedPreservation', 'issuedSupplierPreservation']) {
    const f = fixture(); const preview = await f.preview(); const reads = f.calls.length;
    f.stored.documentMappings[1].retained_differences[key] = null;
    await assert.rejects(f.apply(preview, [preview.items[1].id]), error => /Preservation evidence changed/.test(error.message));
    assert.equal(f.calls.length, reads); assert.equal(f.claims.length, 0);
  }
});

test('ordinary apply narrows global number lookups to the selection while preserving full current-date and historical mapped identities', async () => {
  const f = fixture();
  const extra = { ...structuredClone(f.salesforce.buyers[0]), Id: 'a01000000000003AAA', Name: 'UNSELECTED-SALE', STEM__c: 'stem-extra',
    STEM__r: { ...structuredClone(f.salesforce.buyers[0].STEM__r), Vessel__r: { Name: 'OTHER VESSEL' } } };
  f.salesforce.buyers.push(extra);
  const preview = await f.preview(); const from = f.calls.length;
  const result = await f.apply(preview, [preview.items.find(item => item.salesforceId === supplierId).id]);
  assert.equal(result.items[0].outcome, 'applied');
  const reads = f.calls.slice(from).filter(call => call.method === 'GET' && call.path.startsWith('/Invoices?'));
  assert.ok(reads.some(call => new URL(call.path, 'https://fixture.invalid').searchParams.get('where')?.startsWith('Date>=')));
  assert.ok(!reads.some(call => new URL(call.path, 'https://fixture.invalid').searchParams.get('InvoiceNumbers')?.includes(extra.Name)));
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

function pageDependencies(response) {
  const calls = [];
  const unexpectedProvider = async () => assert.fail('Saved preview paging must not read or write a provider');
  return { calls, dependencies: { accessContext: { profile: actor }, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'false' },
    client: { from: () => assert.fail('Saved preview paging must use the bounded database RPC'),
      rpc: async (name, parameters) => { calls.push({ name, parameters }); return typeof response === 'function' ? response(parameters) : structuredClone(response); } },
    getConnection: unexpectedProvider, loadSalesforce: unexpectedProvider, loadControls: unexpectedProvider,
    loadPages: unexpectedProvider, accountingFetch: unexpectedProvider, claim: unexpectedProvider, finish: unexpectedProvider } };
}

test('a 205-record preview saves the full inventory and exposes every saved record across bounded database-only pages', async () => {
  const f = fixture(); const buyer = f.salesforce.buyers[0];
  f.salesforce.buyers = Array.from({ length: 205 }, (_, index) => ({ ...structuredClone(buyer),
    Id: `a01${String(index + 1).padStart(12, '0')}AAA`, Name: `INV-${index + 1}`, STEM__c: `stem-${index + 1}` }));
  f.salesforce.suppliers = []; f.salesforce.lines = []; f.salesforce.extras = []; f.stored.documentMappings = [];
  const preview = await f.preview(); const saved = f.tables.xero_document_field_correction_previews[0];
  assert.equal(saved.items.length, 205); assert.equal(preview.items.length, 100);
  assert.equal(preview.totalCount, 205); assert.equal(preview.nextOffset, 100);
  assert.equal(preview.summary.blocked, 205, 'Summary must cover every saved row, including rows beyond the first page');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false); assert.equal(f.claims.length, 0);
  const immutableSaved = structuredClone(saved);
  const paging = pageDependencies(({ p_preview_id, p_offset }) => {
    assert.equal(p_preview_id, saved.id);
    const items = saved.items.slice(p_offset, p_offset + 100);
    return { error: null, data: { id: saved.id, policy: saved.policy, created_at: saved.created_at, summary: saved.summary,
      totalCount: saved.items.length, nextOffset: p_offset + items.length < saved.items.length ? p_offset + 100 : null, items } };
  });
  const pages = [];
  for (const offset of [0, 100, 200]) pages.push(await xeroFinancialDocumentCorrectionPage({ previewId: saved.id, offset }, paging.dependencies));
  assert.deepEqual(pages.map((page) => page.items.length), [100, 100, 5]);
  assert.deepEqual(pages.map((page) => page.nextOffset), [100, 200, null]);
  assert.deepEqual(pages[0].items, preview.items);
  const allItems = pages.flatMap((page) => page.items);
  assert.deepEqual(allItems.map((item) => item.id), saved.items.map((item) => item.id));
  assert.deepEqual(allItems.map((item) => item.salesforceId), f.salesforce.buyers.map((item) => item.Id));
  assert.equal(new Set(allItems.map((item) => item.id)).size, 205);
  for (const page of pages) {
    assert.equal(page.policy, preview.policy); assert.equal(page.previewId, preview.previewId);
    assert.equal(page.createdAt, preview.createdAt); assert.equal(page.totalCount, 205); assert.deepEqual(page.summary, preview.summary);
    assert.deepEqual(page.scope, preview.scope);
    assert.deepEqual(Object.keys(page).sort(), ['createdAt', 'items', 'nextOffset', 'policy', 'previewId', 'scope', 'summary', 'totalCount']);
  }
  for (const [index, item] of allItems.entries()) {
    for (const privateField of ['before', 'source', 'mapping', 'projection']) assert.equal(Object.hasOwn(item, privateField), false);
    assert.deepEqual(item.sourceEvidence, saved.items[index].projection.evidence);
  }
  assert.deepEqual(paging.calls, [0, 100, 200].map((offset) => ({ name: 'read_xero_document_field_correction_page_v1',
    parameters: { p_preview_id: saved.id, p_offset: offset } })));
  assert.deepEqual(saved, immutableSaved, 'Reading pages must preserve the complete immutable correction evidence');
});

test('saved correction pages require an authenticated actor before any database or provider access', async () => {
  for (const accessContext of [undefined, {}, { profile: { id: 'invalid', email: actor.email } }, { profile: { id: actor.id } }]) {
    const paging = pageDependencies({ data: null, error: null }); paging.dependencies.accessContext = accessContext;
    await assert.rejects(xeroFinancialDocumentCorrectionPage({ previewId: uuid(900), offset: 0 }, paging.dependencies),
      { code: 'XERO_DOCUMENT_CORRECTION_ACTOR_REQUIRED', status: 403 });
    assert.equal(paging.calls.length, 0);
  }
});

test('saved correction page identities and offsets are validated before the database RPC', async () => {
  const paging = pageDependencies({ data: null, error: null });
  for (const previewId of [undefined, '', 'not-a-uuid']) {
    await assert.rejects(xeroFinancialDocumentCorrectionPage({ previewId, offset: 0 }, paging.dependencies), /valid saved correction preview page/);
  }
  for (const offset of [undefined, null, '100', -100, -1, 1, 99, 101, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(xeroFinancialDocumentCorrectionPage({ previewId: uuid(900), offset }, paging.dependencies), /valid saved correction preview page/);
  }
  assert.equal(paging.calls.length, 0);
});

test('unknown previews, database errors, wrong policies and incomplete saved pages fail closed', async () => {
  const good = { id: uuid(900), policy: 'document_field_correction_v1', created_at: '2026-09-28T00:00:00Z',
    summary: { blocked: 205, legacyPreserved: 10, scope: { cutoff: '2026-01-01', totalSourceCount: 215, excludedLegacyCount: 10 } },
    totalCount: 205, nextOffset: 200, items: Array.from({ length: 100 }, (_, index) => ({ id: uuid(1000 + index), outcome: 'blocked' })) };
  const responses = [
    { data: null, error: null },
    { data: null, error: { code: 'P0002', message: 'Preview not found' } },
    { data: good, error: { message: 'Database page read failed' } },
    ...[
      { id: uuid(901) }, { policy: 'document_field_correction_v0' }, { items: null },
      { totalCount: '205' }, { totalCount: 99 }, { totalCount: -1 }, { totalCount: 205.5 },
      { items: good.items.slice(0, 99) }, { items: [...good.items, { id: uuid(1200) }] },
      { nextOffset: null }, { nextOffset: 100 }, { nextOffset: 201 },
      { summary: { ...good.summary, scope: null } },
      { summary: { ...good.summary, scope: { ...good.summary.scope, excludedLegacyCount: 11 } } },
      { summary: { ...good.summary, legacyPreserved: 11 } },
    ].map((change) => ({ data: { ...good, ...change }, error: null })),
  ];
  for (const response of responses) {
    const paging = pageDependencies(response);
    await assert.rejects(xeroFinancialDocumentCorrectionPage({ previewId: good.id, offset: 100 }, paging.dependencies),
      { code: 'XERO_DOCUMENT_CORRECTION_INVALID', status: 409 });
    assert.equal(paging.calls.length, 1);
  }
  const beyond = pageDependencies({ data: { ...good, items: [], nextOffset: null }, error: null });
  await assert.rejects(xeroFinancialDocumentCorrectionPage({ previewId: good.id, offset: 300 }, beyond.dependencies), /complete saved correction page/);
});

test('an empty saved preview remains a complete terminal page without requiring provider access or the write gate', async () => {
  const data = { id: uuid(900), policy: 'document_field_correction_v1', created_at: '2026-09-28T00:00:00Z',
    summary: { eligible: 0, alreadyCompliant: 0, legacyPreserved: 0, blocked: 0, applied: 0, uncertain: 0,
      scope: { cutoff: '2026-01-01', totalSourceCount: 0, excludedLegacyCount: 0 } }, totalCount: 0, nextOffset: null, items: [] };
  const paging = pageDependencies({ data, error: null });
  const result = await xeroFinancialDocumentCorrectionPage({ previewId: data.id, offset: 0 }, paging.dependencies);
  assert.deepEqual(result, { policy: data.policy, previewId: data.id, createdAt: data.created_at, summary: data.summary,
    scope: data.summary.scope, totalCount: 0, nextOffset: null, items: [] });
  assert.equal(paging.calls.length, 1);
});

test('a large legacy source cohort is counted explicitly while every current or unresolved source remains reviewable', async () => {
  const f = fixture(); const original = structuredClone(f.salesforce.buyers[0]);
  f.salesforce.buyers.push(...Array.from({ length: 12000 }, (_, index) => ({ ...structuredClone(original),
    Id: `a01${String(100000 + index).padStart(12, '0')}AAA`, Name: `LEGACY-${index}`, STEM__c: `old-stem-${index}`,
    Delivery_Date__c: '2025-01-01', Invoice_Date__c: '2025-02-01' })));
  f.salesforce.buyers.push({ ...structuredClone(original), Id: 'a01000000999999AAA', Name: 'UNRESOLVED', Delivery_Date__c: null });
  const result = await f.preview(); const saved = f.tables.xero_document_field_correction_previews[0];
  assert.equal(result.totalCount, 3); assert.equal(result.items.length, 3); assert.equal(saved.items.length, 3);
  assert.deepEqual(result.scope, { cutoff: '2026-01-01', totalSourceCount: 12003, excludedLegacyCount: 12000 });
  assert.equal(result.summary.legacyPreserved, 12000); assert.equal(result.summary.eligible, 2); assert.equal(result.summary.blocked, 1);
  assert.equal(result.items.find((item) => item.documentNumber === 'UNRESOLVED').outcome, 'blocked');
  const held = saved.items.find((item) => item.documentNumber === 'UNRESOLVED');
  assert.equal(Object.hasOwn(held, 'source'), false); assert.equal(Object.hasOwn(held, 'before'), false); assert.equal(Object.hasOwn(held, 'mapping'), false);
  assert.ok(held.projection.evidence.buyers.length); assert.ok(saved.items.filter((item) => item.outcome === 'eligible').every((item) => item.source && item.before));
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) < 50000, 'Historical source rows must not reappear inside saved eligible evidence');
  const audit = f.tables.xero_financial_audit_events.at(-1);
  assert.equal(audit.run_id, null); assert.equal(audit.event_type, 'document_correction_preview'); assert.equal(audit.outcome, 'complete');
  assert.equal(audit.record_counts.totalSourceCount, 12003); assert.equal(audit.record_counts.excludedLegacyCount, 12000);
  assert.equal(f.calls.some((call) => call.path === '/Invoices' || call.method === 'POST'), false);
});

test('cross-date mapped targets and global inactive sales-number collisions remain in the scoped preview evidence', async () => {
  const f = fixture(); f.invoices[1].Date = '2025-12-31';
  const preview = await f.preview(); assert.equal(preview.items[1].outcome, 'eligible');
  assert.ok(f.calls.some((call) => new URL(call.path, 'https://fixture.invalid').searchParams.get('IDs') === f.invoices[1].InvoiceID));
  f.invoices.push({ ...structuredClone(f.invoices[0]), InvoiceID: uuid(999), InvoiceNumber: f.salesforce.buyers[0].Name,
    Date: '2020-01-01', Status: 'DELETED' });
  const blocked = await f.preview(); assert.equal(blocked.items[0].outcome, 'blocked'); assert.match(blocked.items[0].reason, /already uses/);
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
});

test('an incomplete inventory returns a curated hold and durably records the last observed allowance without a preview or provider write', async () => {
  const f = fixture(); const loadPages = f.dependencies.loadPages;
  f.dependencies.loadPages = async (connection, path, collection, options) => {
    if (collection === 'Invoices') {
      options.onResponse({ headers: new Headers({ 'x-daylimit-remaining': '431', 'x-minlimit-remaining': '39' }) });
      throw Object.assign(new Error('Private upstream details must never escape'), { code: 'XERO_FINANCIAL_XERO_INCOMPLETE', status: 502 });
    }
    return loadPages(connection, path, collection, options);
  };
  await assert.rejects(f.preview(), (error) => error.code === 'XERO_DOCUMENT_CORRECTION_SCOPE_INCOMPLETE' && error.status === 409
    && error.details.rateLimit.dayRemaining === 431 && !error.message.includes('Private'));
  assert.equal((f.tables.xero_document_field_correction_previews || []).length, 0);
  const audit = f.tables.xero_financial_audit_events.at(-1);
  assert.equal(audit.outcome, 'failed'); assert.equal(audit.run_id, null); assert.equal(audit.rate_limit_snapshot.dayRemaining, 431);
  assert.equal(audit.record_counts.providerCalls, 1); assert.equal(audit.error_code, 'XERO_DOCUMENT_CORRECTION_SCOPE_INCOMPLETE');
  assert.equal(f.calls.some((call) => call.method === 'POST'), false); assert.equal(f.claims.length, 0);
});

test('failure to persist an allowance observation prevents publishing a correction preview', async () => {
  const f = fixture();
  f.dependencies.recordAudit = async () => { throw Object.assign(new Error('Audit persistence unavailable'), { code: 'XERO_FINANCIAL_STORAGE_FAILED' }); };
  await assert.rejects(f.preview(), (error) => error.code === 'XERO_FINANCIAL_STORAGE_FAILED' && error.details.allowanceAuditUnavailable === true);
  assert.equal((f.tables.xero_document_field_correction_previews || []).length, 0); assert.equal(f.claims.length, 0);
  assert.equal(f.calls.some((call) => call.method === 'POST'), false);
});

test('curated unsupported-number evidence holds keep their specific safe reason before any provider reads', async () => {
  const f = fixture(); f.salesforce.buyers[0].Name = 'SALE-"UNSUPPORTED"';
  await assert.rejects(f.preview(), (error) => error.code === 'XERO_DOCUMENT_CORRECTION_SCOPE_INCOMPLETE'
    && error.message === 'A document number uses unsupported query syntax. Complete exact-number evidence is required; no corrections were applied.'
    && error.details.scopeReason === 'DOCUMENT_CORRECTION_NUMBER_SYNTAX_UNSUPPORTED');
  assert.equal(f.calls.length, 0); assert.equal((f.tables.xero_document_field_correction_previews || []).length, 0);
  assert.equal(f.tables.xero_financial_audit_events.at(-1).outcome, 'failed');
});

test('four-decimal supplier unit prices are preserved through scoped preview, exact reads, POST and confirmed readback', async () => {
  const f = fixture(); f.salesforce.suppliers[0].Invoice_Amount__c = 100.12;
  Object.assign(f.salesforce.lines[0], { Cost_Per_Unit__c: 100.1234, Total_Cost__c: 100.12 });
  Object.assign(f.invoices[1], { SubTotal: 100.12, Total: 100.12, AmountDue: 100.12 });
  Object.assign(f.invoices[1].LineItems[0], { UnitAmount: 100.1234, LineAmount: 100.12 });
  const preview = await f.preview(); assert.equal(preview.items[1].outcome, 'eligible', preview.items[1].reason);
  const result = await f.apply(preview, [preview.items[1].id]); assert.equal(result.items[0].outcome, 'applied');
  const post = f.calls.find((call) => call.method === 'POST'); assert.equal(post.body.Invoices[0].LineItems[0].UnitAmount, 100.1234);
  assert.equal(f.invoices[1].LineItems[0].UnitAmount, 100.1234);
  assert.ok(f.calls.filter((call) => call.path.startsWith('/Invoices')).every((call) => new URL(call.path, 'https://fixture.invalid').searchParams.get('unitdp') === '4'));
  assert.equal(f.finishes.at(-1).status, 'confirmed');
});

test('buyer and aggregate bill corrections preserve complete foreign FX, settlement collections and raw accounting lines', async () => {
  const f = fixture(); const before = structuredClone(f.invoices); const mappings = structuredClone(f.stored.documentMappings);
  const result = await f.apply(await f.preview());
  assert.deepEqual(result.items.map((item) => item.outcome), ['applied', 'applied']);
  assert.equal(f.finishes.filter((entry) => entry.status === 'confirmed').length, 2);
  const posts = f.calls.filter((call) => call.method === 'POST'); assert.equal(posts.length, 2);
  for (const [index, post] of posts.entries()) {
    const payload = post.body.Invoices[0]; assert.equal(post.path, `/Invoices/${before[index].InvoiceID}?unitdp=4`);
    assert.equal(payload.InvoiceID, before[index].InvoiceID); assert.equal(Object.hasOwn(payload, 'Date'), false);
    for (const key of ['Total', 'SubTotal', 'TotalTax', 'AmountDue', 'AmountPaid', 'AmountCredited', 'Payments', 'CreditNotes', 'Prepayments', 'Overpayments', 'CurrencyCode', 'CurrencyRate', 'Status', 'Contact']) {
      assert.equal(Object.hasOwn(payload, key), false, `${key} must not enter a metadata-only write`);
      assert.deepEqual(f.invoices[index][key], before[index][key]);
    }
    assert.deepEqual(payload.LineItems.map(({ Description: _description, ...line }) => line), before[index].LineItems.map(({ Description: _description, ...line }) => line));
    assert.deepEqual(f.invoices[index].LineItems.map(({ Description: _description, ...line }) => line), before[index].LineItems.map(({ Description: _description, ...line }) => line));
  }
  assert.equal(f.invoices[0].Reference, 'HUAYUE'); assert.equal(f.invoices[1].Reference, before[1].Reference);
  assert.deepEqual(f.stored.documentMappings, mappings, 'Existing mapping and its historical receipt must be immutable');
});

test('an unpaid date change pins the existing CurrencyRate while paid date changes are held', async () => {
  const f = fixture(); f.invoices[1].Date = '2026-01-20';
  const preview = await f.preview(); const result = await f.apply(preview, [preview.items[1].id]);
  assert.equal(result.items[0].outcome, 'applied');
  const payload = f.calls.find((call) => call.method === 'POST').body.Invoices[0];
  assert.equal(payload.Date, '2026-01-27'); assert.equal(payload.CurrencyRate, 7.78345);
  const paid = fixture(); paid.invoices[0].Date = '2026-01-20';
  const held = await paid.preview(); assert.equal(held.items[0].outcome, 'blocked'); assert.match(held.items[0].reason, /paid|settled/i);
});

test('delivery cutoff and absent/conflicting buyer facts hold both directions without creating transactions', () => {
  for (const date of ['2025-12-31', null]) {
    const f = fixture(); f.salesforce.buyers[0].Delivery_Date__c = date;
    const items = buildDocumentCorrectionItems({ salesforce: f.salesforce, stored: f.stored, xero: f.xero() });
    assert.deepEqual(items.map((item) => item.outcome), date ? ['legacy_preserved', 'legacy_preserved'] : ['blocked', 'blocked']);
  }
  const f = fixture(); const other = { ...structuredClone(f.salesforce.buyers[0]), Id: 'a01000000000002AAA', Name: '25070T-INV-2', Delivery_Date__c: '2026-01-29' };
  f.salesforce.buyers.push(other);
  f.salesforce.lines.push({ ...structuredClone(f.salesforce.lines[0]), Id: 'a02000000000002AAA', Buyer_Invoice__c: other.Id });
  f.salesforce.suppliers[0].Invoice_Amount__c = 200;
  const bill = buildDocumentCorrectionItems({ salesforce: f.salesforce, stored: f.stored, xero: f.xero() }).find((item) => item.kind === 'supplier_bill');
  assert.equal(bill.outcome, 'blocked'); assert.match(bill.reason, /disagree/);
});

test('equal amount alone cannot own a Xero transaction; conflicting saved owners and account evidence fail closed', () => {
  const f = fixture(); f.stored.documentMappings = [];
  for (const invoice of f.invoices) { invoice.InvoiceNumber = 'UNRELATED'; invoice.Reference = 'OTHER VESSEL'; }
  const items = buildDocumentCorrectionItems({ salesforce: f.salesforce, stored: f.stored, xero: f.xero() });
  assert.deepEqual(items.map((item) => item.outcome), ['blocked', 'blocked']);
  assert.ok(items.every((item) => /No verified existing/.test(item.reason)));
  const owner = fixture(); owner.stored.documentMappings.push({ ...owner.stored.documentMappings[0], id: uuid(950), salesforce_id: 'a01000000000099AAA' });
  const claimed = buildDocumentCorrectionItems({ salesforce: owner.salesforce, stored: owner.stored, xero: owner.xero() })[0];
  assert.equal(claimed.outcome, 'blocked'); assert.match(claimed.reason, /different Salesforce/);
});

test('legitimate distinct stored bill mappings may share the prescribed derived bill number', () => {
  const f = fixture(); const second = { ...structuredClone(f.salesforce.suppliers[0]), Id: 'a06000000000002AAA', Name: 'ORIGINAL-SUPPLIER-2' };
  f.salesforce.suppliers.push(second);
  f.salesforce.lines.push({ ...structuredClone(f.salesforce.lines[0]), Id: 'a02000000000002AAA', Supplier_Invoice__c: second.Id, Buyer_Invoice__c: null });
  f.invoices[1].InvoiceNumber = '25070T- HUAYUE';
  const another = { ...structuredClone(f.invoices[1]), InvoiceID: uuid(102) }; f.invoices.push(another);
  f.stored.documentMappings.push({ ...structuredClone(f.stored.documentMappings[1]), id: uuid(502), salesforce_id: second.Id, xero_document_id: another.InvoiceID });
  const bills = buildDocumentCorrectionItems({ salesforce: f.salesforce, stored: f.stored, xero: f.xero() }).filter((item) => item.kind === 'supplier_bill');
  assert.equal(bills.length, 2); assert.ok(bills.every((item) => item.outcome === 'eligible'), bills.map((item) => item.reason).join('\n'));
  assert.equal(new Set(bills.map((item) => item.xeroInvoiceId)).size, 2);
});

test('source, target, mapping and immutable target-ID drift block before a correction claim or provider write', async () => {
  for (const mutate of [
    (f) => { f.salesforce.buyers[0].Delivery_Date__c = '2026-01-29'; },
    (f) => { f.invoices[0].CurrencyRate = 7.8; },
    (f) => { f.stored.documentMappings[0].retained_differences.originalAudit = 'changed'; },
    (f) => { f.invoices[0].InvoiceID = uuid(888); },
  ]) {
    const f = fixture(); const preview = await f.preview(); mutate(f);
    const result = await f.apply(preview, [preview.items[0].id]);
    assert.equal(result.items[0].outcome, 'blocked'); assert.equal(f.claims.length, 0); assert.equal(f.calls.some((call) => call.method === 'POST'), false);
  }
});

test('uncertain timeouts never resend on replay and stop untouched later selected records', async () => {
  for (const timeout of ['timeoutBeforeWrite', 'timeoutAfterWrite']) {
    const f = fixture(); f.behavior[timeout] = true; const preview = await f.preview();
    const result = await f.apply(preview);
    assert.deepEqual(result.items.map((item) => item.outcome), ['uncertain', 'blocked']);
    assert.match(result.items[1].reason, /no update attempted/);
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
    f.behavior[timeout] = false;
    const replay = await f.apply(preview, [preview.items[0].id]);
    assert.equal(replay.items[0].outcome, timeout === 'timeoutAfterWrite' ? 'applied' : 'uncertain');
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1, 'A durable intent forbids replaying the provider write');
  }
});

test('later-clock replay binds the original authority and scope without a second provider POST', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T01:00:00Z') });
  const f = fixture(); const preview = await f.preview(); const first = await f.apply(preview, [preview.items[0].id]);
  assert.equal(first.items[0].outcome, 'applied'); const authority = structuredClone(f.claims[0].evidence.authority);
  t.mock.timers.tick(3600000);
  const replay = await f.apply(preview, [preview.items[0].id]);
  assert.equal(replay.items[0].outcome, 'applied'); assert.deepEqual(f.stored.documentCorrectionClaims[0].evidence.authority, authority);
  assert.equal(f.claims.length, 1, 'A confirmed replay resolves the existing original claim without replacing its intent');
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

test('readback-only recovery confirms the original approved intent despite changed source and disabled write gate', async () => {
  const f = fixture(); f.behavior.timeoutAfterWrite = true; const preview = await f.preview();
  const first = await f.apply(preview, [preview.items[0].id]); assert.equal(first.items[0].outcome, 'uncertain');
  f.behavior.timeoutAfterWrite = false; f.salesforce.buyers[0].Delivery_Date__c = '2026-02-10';
  f.dependencies.env.FCOS_ENABLE_XERO_FINANCIAL_SYNC = 'false';
  f.dependencies.loadSalesforce = async () => { throw new Error('Recovery must not substitute current source intent'); };
  const callsBefore = f.calls.length;
  const recovered = await xeroFinancialDocumentCorrectionVerify({ previewId: preview.previewId, itemIds: [preview.items[0].id] }, f.dependencies);
  assert.equal(recovered.items[0].outcome, 'applied'); assert.match(recovered.items[0].reason, /Recovered through exact readback/);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  assert.ok(f.calls.slice(callsBefore).every((call) => call.method === 'GET'));
  assert.equal(f.finishes.at(-1).status, 'confirmed'); assert.equal(f.claims.length, 1);
});

test('readback-only recovery never sends an update for an unresolved or missing original intent', async () => {
  const f = fixture(); f.behavior.timeoutBeforeWrite = true; const preview = await f.preview();
  await f.apply(preview, [preview.items[0].id]);
  const result = await xeroFinancialDocumentCorrectionVerify({ previewId: preview.previewId, itemIds: preview.items.map((item) => item.id) }, f.dependencies);
  assert.deepEqual(result.items.map((item) => item.outcome), ['uncertain', 'blocked']);
  assert.match(result.items[0].reason, /barrier remains/); assert.match(result.items[1].reason, /No previous intent exists/);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1); assert.equal(f.claims.length, 1);
  const before = f.calls.length;
  f.dependencies.getConnection = async () => ({ tenantId: uuid(999), scope: 'accounting.invoices' });
  await assert.rejects(xeroFinancialDocumentCorrectionVerify({ previewId: preview.previewId, itemIds: [preview.items[0].id] }, f.dependencies), /organisation changed/);
  assert.equal(f.calls.length, before);
});

test('readback-only recovery holds a conflicting provider date alias while preserving the original uncertain barrier', async () => {
  const f = fixture(); f.behavior.timeoutAfterWrite = true; const preview = await f.preview();
  await f.apply(preview, [preview.items[0].id]);
  f.invoices[0].DateString = '2026-02-20T00:00:00Z';
  const result = await xeroFinancialDocumentCorrectionVerify({ previewId: preview.previewId, itemIds: [preview.items[0].id] }, f.dependencies);
  assert.equal(result.items[0].outcome, 'uncertain');
  assert.equal(f.finishes.some((entry) => entry.status === 'confirmed'), false);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

test('mismatched provider responses, validation failures, conflicting aliases and changed financial readback remain uncertain', async () => {
  for (const behavior of ['badResponse', 'validationError', 'changeInvariant', 'conflictingDateAlias']) {
    const f = fixture(); f.behavior[behavior] = true;
    const preview = await f.preview(); const result = await f.apply(preview, [preview.items[0].id]);
    assert.equal(result.items[0].outcome, 'uncertain');
    assert.equal(f.finishes.at(-1).status, 'uncertain'); assert.equal(f.finishes.some((entry) => entry.status === 'confirmed'), false);
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  }
});

test('unknown, duplicated, blocked and over-25 selected identities reject before loading or writing provider evidence', async () => {
  const f = fixture(); const preview = await f.preview(); const prior = f.calls.length;
  for (const ids of [[uuid(900)], [preview.items[0].id, preview.items[0].id], Array.from({ length: 26 }, (_, index) => uuid(900 + index)), []]) {
    await assert.rejects(f.apply(preview, ids), /eligible|between 1 and 25/);
  }
  assert.equal(f.calls.length, prior); assert.equal(f.claims.length, 0);
  f.dependencies.env.FCOS_ENABLE_XERO_FINANCIAL_SYNC = 'false';
  await assert.rejects(f.apply(preview), { code: 'EXTERNAL_ACTION_GATE_DISABLED' });
});

test('scope and organisation mismatches hold preview and canonical dates discard only provider timestamp aliases', async () => {
  const f = fixture(); f.dependencies.getConnection = async () => ({ tenantId, scope: 'accounting.contacts' });
  await assert.rejects(f.preview(), /invoice scope/); assert.equal(f.calls.length, 0);
  const canonical = canonicalCorrectionInvoice({ Date: '/Date(1769472000000+0000)/', DateString: '2026-01-27T00:00:00Z',
    DueDate: '2026-02-25T00:00:00Z', DueDateString: '2026-02-25T00:00:00Z', UpdatedDateUTC: 'yesterday', AmountPaid: 100, Payments: [{ Amount: 100 }] });
  assert.deepEqual(canonical, { Date: '2026-01-27', DueDate: '2026-02-25', AmountPaid: 100, Payments: [{ Amount: 100 }] });
});

test('source classifications continue to expose immutable source identity and complete economics separately from correction projection', () => {
  const f = fixture(); const result = buildFinancialClassifications(f.salesforce, f.xero(), f.stored);
  assert.equal(result.sources.length, 2);
  for (const source of result.sources) {
    assert.ok(source.salesforceId); assert.match(source.sourceFingerprint, /^[a-f0-9]{64}$/); assert.match(source.financialFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(source.total, 100); assert.equal(source.lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0), 100);
    assert.match(source.documentFieldProjection.fingerprint, /^[a-f0-9]{64}$/);
  }
});
