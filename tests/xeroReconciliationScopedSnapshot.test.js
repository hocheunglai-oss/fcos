import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFinancialClassifications, loadSalesforceDocumentLinkSnapshot, loadSalesforceFinancialSnapshot,
  loadStoredDocumentLinkControls, loadStoredFinancialControls, normalizeXeroInvoice, xeroReviewFingerprint,
} from '../api/_xeroFinancialSync.js';

const sf = (prefix, n) => `${prefix}${String(n).padStart(12, '0')}`;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cutoff = '2026-01-01';
const clone = (value) => structuredClone(value);
const safetyContext = { singleCurrency: false, fields: {
  Invoice__c: ['CurrencyIsoCode', 'Delivery_Date__c'], Supplier_Invoice__c: ['CurrencyIsoCode', 'Invoice_File__c'],
  STEM__c: ['CurrencyIsoCode'], STEM_Line_Item__c: ['CurrencyIsoCode', 'STEM__c', 'Cancelled__c', 'Unit_Sell_At__c', 'Unit_Buy_At__c'],
  STEM_Extra_Cost__c: ['CurrencyIsoCode', 'STEM__c', 'Cancelled__c'],
} };

function fixture(unrelated = 0) {
  const accounts = [
    { Id: sf('001', 1), Name: 'Buyer Limited', Company_Code__c: 'BUYER', Inactive_Suspended__c: false },
    { Id: sf('001', 2), Name: 'Supplier Limited', Company_Code__c: 'SUPPLIER', Inactive_Suspended__c: false },
    { Id: sf('001', 3), Name: 'Unrelated Limited', Company_Code__c: 'OTHER', Inactive_Suspended__c: false },
    { Id: sf('001', 4), Name: 'Supplier Limited', Company_Code__c: 'OLD-SUPPLIER', Inactive_Suspended__c: true },
  ];
  const stem = (n, account) => ({ Name: `HK260${n}T`, KeyStem__c: `HK260${n}T`, Account__c: account.Id,
    Account__r: { Name: account.Name, Company_Code__c: account.Company_Code__c }, Delivery_Date__c: '2026-06-01',
    CurrencyIsoCode: 'USD', RefCode__c: 'FCOSREF', Vessel__c: sf('a90', n), Vessel__r: { Name: 'Ship One' } });
  const buyer = (n, account = accounts[0]) => ({ Id: sf('a10', n), Name: `BUYER-${n}`, STEM__c: sf('a30', n), STEM__r: stem(n, account),
    Amount__c: 1200, Invoice_Date__c: '2026-06-02', Delivery_Date__c: '2026-06-01', Invoice_Due_Date__c: '2026-07-01',
    CurrencyIsoCode: 'USD', Proforma__c: false, Deprecated__c: false, File__c: 'issued.pdf' });
  const supplier = (n, account = accounts[1]) => ({ Id: sf('a11', n), Name: `SUPPLIER-${n}`, STEM__c: sf('a30', n), STEM__r: stem(n, accounts[0]),
    Supplier__c: account.Id, Supplier__r: { Name: account.Name, Company_Code__c: account.Company_Code__c },
    Invoice_Amount__c: 1200, Invoice_Date__c: '2026-06-02', Invoice_Due_Date__c: '2026-07-01', CurrencyIsoCode: 'USD', Invoice_File__c: 'issued.pdf' });
  const products = [1, 2, 3].map((n) => ({ Id: sf('01t', n), Name: n === 1 ? 'Fuel' : n === 2 ? 'Fee' : 'Unrelated fuel', RecordType: { DeveloperName: 'Petroleum_Product' } }));
  const buyers = [buyer(1), buyer(2)];
  const suppliers = [supplier(1), supplier(2, accounts[3])];
  const line = (n, product = products[0]) => ({ Id: sf('a20', n), Name: `LINE-${n}`, Buyer_Invoice__c: sf('a10', n), Supplier_Invoice__c: sf('a11', n), STEM__c: sf('a30', n),
    Product__c: product.Id, Product__r: { Name: product.Name }, Cancelled__c: false, CurrencyIsoCode: 'USD',
    Quantity__c: 10, Quantity_Delivered_Per_BDN__c: 10, Unit_Sell_At__c: 100, Unit_Buy_At__c: 100,
    Price_Per_Unit__c: 100, Cost_Per_Unit__c: 100, Total_Price__c: 1000, Total_Cost__c: 1000 });
  const lines = [line(1), { ...line(2), Quantity__c: 12, Quantity_Delivered_Per_BDN__c: 12, Total_Price__c: 1200, Total_Cost__c: 1200 }];
  const extras = [{ Id: sf('a21', 1), Name: 'Fee', Product2Id__c: products[1].Id, Product2Id__r: { Name: 'Fee' },
    Buyer_Invoice__c: buyers[0].Id, Supplier_Invoice__c: suppliers[0].Id, STEM__c: buyers[0].STEM__c, Cancelled__c: false,
    Quantity__c: 1, Unit_Price__c: 200, Unit_Cost__c: 200, Line_Total__c: 200, Line_Total_Buy__c: 200, CurrencyIsoCode: 'USD' }];
  for (let n = 100; n < 100 + unrelated; n += 1) {
    buyers.push(buyer(n, accounts[2])); suppliers.push(supplier(n, accounts[2]));
    lines.push({ ...line(n, products[2]), Quantity__c: 12, Quantity_Delivered_Per_BDN__c: 12, Total_Price__c: 1200, Total_Cost__c: 1200 });
  }
  const raw = (n, type, contactId, number, lineItems) => ({ InvoiceID: uuid(n), Type: type, Status: 'AUTHORISED', InvoiceNumber: number,
    Contact: { ContactID: contactId, Name: type === 'ACCPAY' ? accounts[1].Name : accounts[0].Name }, CurrencyCode: 'USD', CurrencyRate: 1,
    Date: '2026-06-01', DueDate: '2026-07-01', Reference: 'Ship One', Total: 1200, SubTotal: 1200, TotalTax: 0,
    AmountDue: 1200, AmountPaid: 0, AmountCredited: 0, LineAmountTypes: 'NoTax', IsDiscounted: false, LineItems: lineItems });
  const accountingLines = (direction) => [{ LineItemID: uuid(20), Description: 'Fee', Quantity: 1, UnitAmount: 200, LineAmount: 200,
    AccountCode: direction === 'supplier' ? '51100' : '41100', TaxType: 'NONE', TaxAmount: 0, Tracking: [] },
  { LineItemID: uuid(21), Description: 'Fuel', Quantity: 10, UnitAmount: 100, LineAmount: 1000,
    AccountCode: direction === 'supplier' ? '51100' : '41100', TaxType: 'NONE', TaxAmount: 0, Tracking: [] }];
  const xero = { complete: true, contactsComplete: true, documentIdentityScopeComplete: true, cutoffDate: cutoff, tenantId: uuid(90),
    contacts: [{ id: uuid(91), name: accounts[0].Name, status: 'ACTIVE', contactNumber: '', accountNumber: '' },
      { id: uuid(92), name: accounts[1].Name, status: 'ACTIVE', contactNumber: '', accountNumber: '' },
      { id: uuid(93), name: accounts[2].Name, status: 'ACTIVE', contactNumber: '', accountNumber: '' }],
    documents: [normalizeXeroInvoice(raw(1, 'ACCREC', uuid(91), buyers[0].Name, accountingLines('buyer'))),
      normalizeXeroInvoice(raw(2, 'ACCPAY', uuid(92), suppliers[0].Name, accountingLines('supplier')))], inactiveDocuments: [], organisation: { baseCurrency: 'USD' } };
  const mappings = products.flatMap((product, i) => ['buyer', 'supplier'].map((direction, j) => ({ id: uuid(200 + i * 2 + j), direction,
    salesforce_product_id: product.Id, xero_account_code: direction === 'buyer' ? '41100' : '51100', xero_tax_type: 'NONE', enabled: true, revision: 1 })));
  const tables = { Account: accounts, Product2: products, Invoice__c: buyers, Supplier_Invoice__c: suppliers, STEM_Line_Item__c: lines, STEM_Extra_Cost__c: extras, ContentDocument: [],
    xero_financial_product_mappings: mappings, xero_financial_document_mappings: [], xero_financial_bank_mappings: [{ id: uuid(300) }],
    xero_document_field_correction_claims: [], xero_document_field_correction_events: [] };
  const links = [{ category: 'link_only', sourceObject: 'Supplier_Invoice__c', sourceId: suppliers[0].Id, targetId: uuid(2) }];
  return { accounts, buyers, suppliers, lines, extras, products, xero, tables, links };
}

const pathValue = (row, field) => field.split('.').reduce((value, key) => value?.[key], row);
function salesforceReader(tables, mutate = (_result) => {}) {
  const log = [];
  const query = async (requests) => requests.map((request) => {
    const table = /\bFROM\s+(\w+)/i.exec(request.soql)[1];
    const predicates = [...request.soql.matchAll(/([\w.]+) IN \(([^)]+)\)/g)].map((match) => {
      const ids = [...match[2].matchAll(/'([^']+)'/g)].map((value) => value[1]);
      return (row) => ids.some((id) => String(pathValue(row, match[1]) || '').slice(0, 15) === id.slice(0, 15));
    });
    for (const match of request.soql.matchAll(/Name LIKE '([^']+)'/g)) {
      const regex = new RegExp(`^${match[1].split('%').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
      predicates.push((row) => regex.test(row.Name));
    }
    const records = clone((tables[table] || []).filter((row) => (!predicates.length || predicates.some((predicate) => predicate(row)))
      && (table !== 'Invoice__c' || row.Proforma__c === false && row.Deprecated__c === false)
      && (!table.startsWith('STEM_') || row.Cancelled__c === false)));
    const result = { totalSize: records.length, records };
    log.push({ table, soql: request.soql, limit: request.limit, returnedRows: records.length });
    mutate(result, request, log.length);
    return result;
  });
  return { query, log };
}

function controlClient(tables, corrupt = null) {
  const log = [];
  return { log, from(table) {
    let filter = () => true; let enabled = false; let range = null; let filterExpression = null;
    const query = { select: () => query, order: () => query,
      eq(key, value) { if (key === 'enabled') enabled = value; return query; },
      or(expression) {
        filterExpression = expression;
        const predicates = expression.split(',').map((part) => {
          const [field, operation, value] = part.split('.');
          const uuidColumn = table === 'xero_document_field_correction_claims' && field === 'xero_invoice_id'
            || table === 'xero_document_field_correction_events' && field === 'claim_id';
          if (uuidColumn) assert.equal(operation, 'eq', 'PostgreSQL UUID columns support exact equality, not LIKE operators');
          return (row) => { const actual = String(row[field] || ''); const prefix = value.endsWith('%');
            const target = prefix ? value.slice(0, -1) : value;
            const a = operation === 'ilike' || uuidColumn ? actual.toLowerCase() : actual;
            const b = operation === 'ilike' || uuidColumn ? target.toLowerCase() : target;
            return prefix ? a.startsWith(b) : a === b; };
        });
        filter = (row) => predicates.some((predicate) => predicate(row)); return query;
      },
      range(start, end) { range = [start, end]; return query; },
      then(resolve, reject) {
        const selected = (tables[table] || []).filter((row) => filter(row) && (!enabled || row.enabled === true)).sort((a, b) => a.id.localeCompare(b.id));
        const result = { data: clone(range ? selected.slice(range[0], range[1] + 1) : selected), error: null };
        log.push({ table, range, returnedRows: result.data.length, expression: filterExpression });
        corrupt?.(result, table, range);
        return Promise.resolve(result).then(resolve, reject);
      },
    }; return query;
  } };
}

async function scoped(f) {
  const reader = salesforceReader(f.tables);
  const salesforce = await loadSalesforceDocumentLinkSnapshot(cutoff, f.links, { querySalesforce: reader.query, safetyContext, xeroSnapshot: f.xero });
  const client = controlClient(f.tables);
  const controls = await loadStoredDocumentLinkControls(client, { salesforce, xeroSnapshot: f.xero, documentLinks: f.links });
  return { salesforce, controls, reader, client, classified: buildFinancialClassifications(salesforce, f.xero, controls, { linkFirst: true }) };
}

async function full(f) {
  const reader = salesforceReader(f.tables);
  const salesforce = await loadSalesforceFinancialSnapshot(cutoff, reader.query, safetyContext);
  const client = controlClient(f.tables);
  const controls = await loadStoredFinancialControls(client);
  return { salesforce, controls, reader, client, classified: buildFinancialClassifications(salesforce, f.xero, controls, { linkFirst: true }) };
}

test('scoped supplier link is byte-equivalent to full classification and excludes unrelated hydration', async (t) => {
  const f = fixture(1000); const baseline = await full(f); const current = await scoped(f);
  const expected = baseline.classified.rows.find((row) => row.salesforceId === f.links[0].sourceId);
  assert.equal(expected.status, 'eligible', JSON.stringify(expected.blockers));
  assert.deepEqual(current.classified.rows, [expected]);
  assert.equal(current.salesforce.suppliers.length, 2, 'same-name inactive Account family remains observable');
  assert.equal(current.salesforce.buyers.length, 2, 'linked buyers and same-STEM fallback candidates are current');
  assert.equal(current.salesforce.lines.length, 2); assert.equal(current.salesforce.extras.length, 1);
  assert.equal(current.controls.productMappings.length, 4); assert.equal(current.controls.bankMappings.length, 0);
  assert.equal(current.salesforce.groupedAccountSnapshot.accounts.length, 4, 'global ownership identities remain complete');
  assert.ok(current.reader.log.every((entry) => entry.limit === 100000));
  assert.ok(current.reader.log.filter((entry) => entry.table.startsWith('STEM_')).every((entry) => /_Invoice__c IN/.test(entry.soql)));
  assert.throws(() => buildFinancialClassifications(current.salesforce, f.xero, current.controls), { code: 'XERO_FINANCIAL_LINK_SCOPE_INVALID' });
  const count = (reader) => reader.log.reduce((sum, entry) => sum + entry.returnedRows, 0);
  assert.ok(count(current.reader) < count(baseline.reader) / 20);
  t.diagnostic(JSON.stringify({ fullQueries: baseline.reader.log.length, fullRows: count(baseline.reader), scopedQueries: current.reader.log.length,
    scopedRows: count(current.reader), scoped: current.salesforce.scopedReadCounts }));
});

test('linked and fallback sibling buyer changes cannot escape the selected supplier proof', async () => {
  for (const mode of ['linked_missing', 'fallback_ambiguous']) {
    const f = fixture();
    if (mode === 'linked_missing') f.buyers.splice(0, 1);
    else {
      f.lines[0].Buyer_Invoice__c = null; f.extras[0].Buyer_Invoice__c = null;
      f.buyers[1].STEM__c = f.suppliers[0].STEM__c;
    }
    const current = await scoped(f); const baseline = await full(f);
    assert.deepEqual(current.classified.rows, baseline.classified.rows.filter((row) => row.salesforceId === f.links[0].sourceId));
    assert.ok(current.classified.rows[0].blockers.length);
    assert.equal(current.classified.rows[0].documentFieldProjection.scope, 'unavailable');
  }
});

test('global buyer number collisions and canonical target owners survive family scoping', async () => {
  const f = fixture();
  f.links = [{ category: 'link_only', sourceObject: 'Invoice__c', sourceId: f.buyers[0].Id, targetId: uuid(1) }];
  const foreign = { ...clone(f.buyers[0]), Id: sf('a10', 999), STEM__c: sf('a30', 999), STEM__r: { ...clone(f.buyers[0].STEM__r),
    Account__c: f.accounts[2].Id, Account__r: { Name: f.accounts[2].Name, Company_Code__c: f.accounts[2].Company_Code__c } } };
  f.buyers.push(foreign);
  f.lines.push({ ...clone(f.lines[0]), Id: sf('a20', 999), Buyer_Invoice__c: foreign.Id, Supplier_Invoice__c: null });
  f.tables.xero_financial_document_mappings.push({ id: uuid(700), salesforce_object: 'Invoice__c', salesforce_id: sf('a10', 777),
    xero_document_id: uuid(1).toUpperCase(), xero_document_type: 'ACCREC', xero_contact_id: uuid(91), retained_differences: {} });
  const current = await scoped(f); const baseline = await full(f);
  assert.deepEqual(current.classified.rows, baseline.classified.rows.filter((row) => row.salesforceId === f.links[0].sourceId));
  assert.equal(current.classified.rows[0].status, 'blocked');
  assert.ok(current.salesforce.buyers.some((row) => row.Id === foreign.Id));
  assert.equal(current.controls.documentMappings.length, 1, 'target owner outside all loaded sources is retained');
});

test('source aliases, preservation receipts, and every correction event page are retained', async () => {
  const f = fixture();
  const original = { id: uuid(700), salesforce_object: 'Supplier_Invoice__c', salesforce_id: `${f.suppliers[0].Id}AAA`,
    xero_document_id: uuid(2), xero_document_type: 'ACCPAY', xero_contact_id: uuid(92), retained_differences: { issuedSupplierPreservation: { policyVersion: 'immutable' } } };
  f.tables.xero_financial_document_mappings.push(original);
  f.tables.xero_financial_document_mappings.push({ ...original, id: uuid(701), salesforce_id: sf('a11', 900), xero_document_id: uuid(800) });
  f.tables.xero_document_field_correction_claims.push({ id: uuid(710), xero_invoice_id: uuid(2), mapping_id: original.id },
    { id: uuid(711), xero_invoice_id: uuid(800) });
  for (let n = 0; n < 701; n += 1) f.tables.xero_document_field_correction_events.push({ id: uuid(2000 + n), claim_id: uuid(710), sequence: n });
  const current = await scoped(f);
  assert.deepEqual(current.controls.documentMappings, [original]);
  assert.equal(current.controls.documentCorrectionClaims.length, 1);
  assert.equal(current.controls.documentCorrectionEvents.length, 701);
  assert.deepEqual(current.client.log.filter((entry) => entry.table === 'xero_document_field_correction_events').map((entry) => entry.range), [[0, 499], [500, 999]]);
  assert.ok(current.classified.rows[0].blockers.length, 'malformed immutable receipt remains held');
});

test('control filters use column-compatible source-prefix, text-target and UUID operators', async () => {
  const f = fixture();
  f.tables.xero_document_field_correction_claims.push({ id: uuid(710), xero_invoice_id: uuid(2).toUpperCase() });
  f.tables.xero_document_field_correction_events.push({ id: uuid(711), claim_id: uuid(710).toUpperCase(), sequence: 1 });
  const current = await scoped(f);
  const expressions = current.client.log.filter((row) => row.expression);
  assert.ok(expressions.filter((row) => row.table === 'xero_financial_product_mappings').every((row) => row.expression.includes('salesforce_product_id.like.')));
  assert.ok(expressions.filter((row) => row.table === 'xero_financial_document_mappings').some((row) => row.expression.includes('salesforce_id.like.')));
  assert.ok(expressions.filter((row) => row.table === 'xero_financial_document_mappings').some((row) => row.expression.includes('xero_document_id.ilike.')));
  assert.ok(expressions.filter((row) => row.table === 'xero_document_field_correction_claims').every((row) => row.expression.includes('xero_invoice_id.eq.')));
  assert.ok(expressions.filter((row) => row.table === 'xero_document_field_correction_events').every((row) => row.expression.includes('claim_id.eq.')));
  assert.equal(current.controls.documentCorrectionClaims.length, 1);
  assert.equal(current.controls.documentCorrectionEvents.length, 1);
});

test('an accepted grouped preservation proof stays byte-equivalent with scoped current evidence', async () => {
  const f = fixture(100);
  f.accounts.splice(3, 1);
  f.suppliers[1].Supplier__c = f.accounts[2].Id;
  f.suppliers[1].Supplier__r = { Name: f.accounts[2].Name, Company_Code__c: f.accounts[2].Company_Code__c };
  f.xero.documents[1].date = f.suppliers[0].Invoice_Date__c;
  f.xero.documents[1].lineItems = [{ LineItemID: uuid(30), Description: 'Historical aggregate', Quantity: 1, UnitAmount: 1200,
    LineAmount: 1200, AccountCode: '51100', TaxType: 'NONE', TaxAmount: 0, Tracking: [] }];
  const before = (await full(f)).classified.rows.find((row) => row.salesforceId === f.links[0].sourceId);
  assert.equal(before.groupedPreservation?.eligible, true, JSON.stringify(before.blockers));
  f.tables.xero_financial_document_mappings.push({ id: uuid(720), salesforce_object: before.salesforceObject, salesforce_id: before.salesforceId,
    xero_document_id: before.xero.id, xero_document_type: before.xeroType, xero_contact_id: before.contactId,
    source_fingerprint: before.sourceFingerprint, protected_legacy: true,
    retained_differences: { accountId: before.accountId, stemId: before.stemId, groupedPreservation: {
      ...before.groupedPreservation, reviewFingerprint: xeroReviewFingerprint(before), evidence: before.groupedPreservationProof } } });
  const baseline = (await full(f)).classified.rows.find((row) => row.salesforceId === f.links[0].sourceId);
  const current = await scoped(f);
  assert.equal(baseline.acceptedLegacy, true);
  assert.deepEqual(current.classified.rows, [baseline]);
  f.lines[0].Unit_Buy_At__c += 1;
  const changed = await scoped(f); const fullChanged = (await full(f)).classified.rows.find((row) => row.salesforceId === f.links[0].sourceId);
  assert.deepEqual(changed.classified.rows, [fullChanged]);
  assert.equal(changed.classified.rows[0].acceptedLegacy, false);
  assert.equal(changed.classified.rows[0].proposedPayload, null);
});

test('Company-key Contact families include different literal names without relaxing their identity holds', async () => {
  const f = fixture();
  f.accounts[3].Name = 'Historical Supplier Name'; f.accounts[3].Company_Code__c = 'HKSupplier Limited';
  f.suppliers[1].Supplier__r = { Name: f.accounts[3].Name, Company_Code__c: f.accounts[3].Company_Code__c };
  const current = await scoped(f); const baseline = await full(f);
  assert.equal(current.salesforce.suppliers.length, 2);
  assert.deepEqual(current.classified.rows, baseline.classified.rows.filter((row) => row.salesforceId === f.links[0].sourceId));
  assert.equal(current.classified.rows[0].sharedContactAccounts.length, 2);
});

test('scoped source loading fails closed for missing sources, partial pages, duplicated identities and changed reads', async () => {
  for (const mode of ['missing', 'truncated', 'next_page', 'done_false', 'duplicate', 'changed']) {
    const f = fixture(); let supplierReads = 0;
    const reader = salesforceReader(f.tables, (result, request) => {
      if (!/FROM Supplier_Invoice__c/.test(request.soql)) return;
      supplierReads += 1;
      if (mode === 'missing') { result.records = []; result.totalSize = 0; }
      if (mode === 'truncated') result.totalSize += 1;
      if (mode === 'next_page') result.nextRecordsUrl = '/query/next';
      if (mode === 'done_false') result.done = false;
      if (mode === 'duplicate') { result.records.push(clone(result.records[0])); result.totalSize += 1; }
      if (mode === 'changed' && supplierReads > 1) result.records[0].Invoice_Amount__c += 1;
    });
    await assert.rejects(loadSalesforceDocumentLinkSnapshot(cutoff, f.links, { querySalesforce: reader.query, safetyContext, xeroSnapshot: f.xero }),
      (error) => ['XERO_FINANCIAL_LINK_SOURCE_MISSING', 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE', 'XERO_FINANCIAL_LINK_SCOPE_CHANGED'].includes(error.code), mode);
  }
});

test('invalid mixed, duplicate, oversized scopes and incomplete Xero identities make no Salesforce reads', async () => {
  const f = fixture(); let reads = 0;
  const invalidScopes = [[{ ...f.links[0], sourceObject: 'Payment__c' }], [{ ...f.links[0], category: 'draft' }],
    [{ ...f.links[0], sourceId: 'unsafe\' OR Id != null' }], [...f.links, ...f.links], Array.from({ length: 26 }, (_v, i) => ({ ...f.links[0], sourceId: sf('a11', i) }))];
  for (const links of invalidScopes) await assert.rejects(loadSalesforceDocumentLinkSnapshot(cutoff, links,
    { querySalesforce: async () => { reads += 1; }, safetyContext, xeroSnapshot: f.xero }), { code: 'XERO_FINANCIAL_LINK_SCOPE_INVALID' });
  for (const xero of [{ ...f.xero, contactsComplete: false }, { ...f.xero, documentIdentityScopeComplete: false }, { ...f.xero, cutoffDate: '2025-01-01' }]) {
    await assert.rejects(loadSalesforceDocumentLinkSnapshot(cutoff, f.links, { querySalesforce: async () => { reads += 1; }, safetyContext, xeroSnapshot: xero }),
      { code: 'XERO_FINANCIAL_LINK_SCOPE_INCOMPLETE' });
  }
  assert.equal(reads, 0);
});

test('missing control result and late pagination failures cannot appear as empty evidence', async () => {
  const f = fixture(); const current = await scoped(f);
  const options = { salesforce: current.salesforce, xeroSnapshot: f.xero, documentLinks: f.links };
  await assert.rejects(loadStoredDocumentLinkControls(controlClient(f.tables, (result) => { result.data = null; }), options),
    { code: 'XERO_FINANCIAL_LINK_SCOPE_INCOMPLETE' });
  f.tables.xero_document_field_correction_claims.push({ id: uuid(710), xero_invoice_id: uuid(2) });
  for (let n = 0; n < 501; n += 1) f.tables.xero_document_field_correction_events.push({ id: uuid(2000 + n), claim_id: uuid(710) });
  await assert.rejects(loadStoredDocumentLinkControls(controlClient(f.tables, (result, table, range) => {
    if (table === 'xero_document_field_correction_events' && range[0] > 0) result.error = { message: 'page unavailable' };
  }), options), /page unavailable/);
});

test('duplicate control pages and an owner changing between source and target queries fail closed', async () => {
  const f = fixture();
  f.tables.xero_financial_document_mappings.push({ id: uuid(700), salesforce_object: 'Supplier_Invoice__c', salesforce_id: f.suppliers[0].Id,
    xero_document_id: uuid(2), xero_document_type: 'ACCPAY', xero_contact_id: uuid(92), retained_differences: {} });
  const current = await scoped(f);
  const options = { salesforce: current.salesforce, xeroSnapshot: f.xero, documentLinks: f.links };
  let reads = 0;
  await assert.rejects(loadStoredDocumentLinkControls(controlClient(f.tables, (result, table) => {
    if (table === 'xero_financial_document_mappings' && ++reads === 2) result.data[0].xero_contact_id = uuid(93);
  }), options), { code: 'XERO_FINANCIAL_LINK_SCOPE_CHANGED' });
  await assert.rejects(loadStoredDocumentLinkControls(controlClient(f.tables, (result, table) => {
    if (table === 'xero_financial_document_mappings' && result.data.length) result.data.push(clone(result.data[0]));
  }), options), { code: 'XERO_FINANCIAL_LINK_SCOPE_INCOMPLETE' });
});
