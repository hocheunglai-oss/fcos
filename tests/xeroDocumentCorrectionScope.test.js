import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDocumentCorrectionPreviewBounds, buildDocumentCorrectionScope, collectDocumentCorrectionInvoices,
  compactDocumentCorrectionPreview, loadDocumentCorrectionInvoicePages } from '../api/_xeroDocumentCorrectionScope.js';

const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const buyer = (id = 'buyer-one', date = '2026-01-01') => ({ Id: id, Name: `SALE-${id}`, STEM__c: 'stem-one',
  CreatedDate: '2024-06-01T00:00:00Z', Delivery_Date__c: date, Invoice_Date__c: '2025-12-31', Invoice_Due_Date__c: '2026-01-20',
  Proforma__c: false, Deprecated__c: false, Amount__c: 100, STEM__r: { Vessel__r: { Name: 'Vessel, A' }, RefCode__c: 'HK26BILL-1' } });
const supplier = (id = 'supplier-one') => ({ Id: id, Name: `ORIGINAL-${id}`, STEM__c: 'stem-one', Invoice_Amount__c: 100,
  Delivery_Date__c: '2024-01-01', Invoice_Date__c: '2024-02-01', Invoice_Due_Date__c: '2026-02-01',
  STEM__r: { Vessel__r: { Name: 'Vessel, A' }, RefCode__c: 'HK26BILL-1' } });
const snapshot = () => ({ buyers: [buyer()], suppliers: [supplier()], lines: [],
  extras: [{ Id: 'extra-created-2024', Supplier_Invoice__c: 'supplier-one', Buyer_Invoice__c: 'buyer-one', CreatedDate: '2024-01-01' }] });
const stored = () => ({ documentMappings: [] });
const target = (id, number = 'SALE-buyer-one', date = '2026-01-01', Type = 'ACCREC') => ({ InvoiceID: uuid(id),
  InvoiceNumber: number, Date: date, Type, Status: 'AUTHORISED', Total: 100 });
const held = { code: 'XERO_DOCUMENT_CORRECTION_SCOPE_INCOMPLETE', status: 409 };

test('delivery scope retains old-created sources and all linked buyer facts while classifying legacy and unresolved rows explicitly', () => {
  const sf = snapshot(); sf.buyers.push(buyer('legacy', '2025-12-31'), buyer('unknown', null));
  const plan = buildDocumentCorrectionScope(sf, stored());
  assert.deepEqual(plan.scope, { cutoff: '2026-01-01', totalSourceCount: 4, excludedLegacyCount: 1 });
  assert.equal(plan.readCurrentDates, true);
  assert.deepEqual(plan.invoiceNumbers, ['BILL-1- Vessel, A', 'ORIGINAL-supplier-one', 'SALE-buyer-one']);
  assert.equal(sf.buyers.length, 3, 'Historical sources remain available for ownership proofs');
  sf.buyers[0].Delivery_Date__c = '2025-12-31';
  const legacy = buildDocumentCorrectionScope(sf, stored());
  assert.equal(legacy.scope.excludedLegacyCount, 3); assert.equal(legacy.scope.totalSourceCount, 4);
  assert.equal(legacy.readCurrentDates, false); assert.deepEqual(legacy.invoiceNumbers, []);
});

test('a conflicting historical linked buyer cannot disappear from a current bill projection', () => {
  const sf = snapshot(); sf.buyers.push(buyer('old-linked', '2025-12-31'));
  sf.lines.push({ Id: 'line-old', Supplier_Invoice__c: 'supplier-one', Buyer_Invoice__c: 'old-linked' });
  const plan = buildDocumentCorrectionScope(sf, stored());
  assert.deepEqual(plan.scope, { cutoff: '2026-01-01', totalSourceCount: 3, excludedLegacyCount: 1 });
  assert.deepEqual(plan.invoiceNumbers, ['SALE-buyer-one'], 'Conflicting bill remains visible but never supplies a write candidate query');
});

test('exact mappings hydrate cross-date identities; sales still require global numbers and mapped bills do not require unique references', () => {
  const mappings = stored(); mappings.documentMappings = [
    { salesforce_object: 'Invoice__c', salesforce_id: 'buyer-one', xero_document_id: uuid(1) },
    { salesforce_object: 'Supplier_Invoice__c', salesforce_id: 'supplier-one', xero_document_id: uuid(2) },
    { salesforce_object: 'Invoice__c', salesforce_id: 'unrelated-old', xero_document_id: uuid(3) },
  ];
  const plan = buildDocumentCorrectionScope(snapshot(), mappings);
  assert.deepEqual(plan.invoiceIds, [uuid(1), uuid(2)]); assert.deepEqual(plan.invoiceNumbers, ['SALE-buyer-one']);
});

test('selected Apply lookups preserve global source and mapped identity scope while narrowing only number lookups', () => {
  const sf = snapshot(); sf.buyers.push(buyer('buyer-two'), buyer('legacy', '2025-12-31'), buyer('unknown', null));
  const mappings = stored(); mappings.documentMappings = [
    { salesforce_object: 'Invoice__c', salesforce_id: 'buyer-one', xero_document_id: uuid(2) },
    { salesforce_object: 'Invoice__c', salesforce_id: 'buyer-two', xero_document_id: uuid(3) },
    { salesforce_object: 'Supplier_Invoice__c', salesforce_id: 'supplier-one', xero_document_id: uuid(4) },
  ];
  const inputs = structuredClone({ sf, mappings });
  const preview = buildDocumentCorrectionScope(sf, mappings);
  assert.deepEqual(preview, buildDocumentCorrectionScope(sf, mappings, '2026-01-01', null));
  assert.deepEqual(preview.invoiceIds, [uuid(2), uuid(3), uuid(4)]);
  assert.deepEqual(preview.invoiceNumbers, ['SALE-buyer-one', 'SALE-buyer-two']);
  const selected = buildDocumentCorrectionScope(sf, mappings, '2026-01-01', [
    { salesforceObject: 'Invoice__c', salesforceId: 'buyer-one', xeroInvoiceId: uuid(1) },
  ]);
  assert.deepEqual(selected.scope, preview.scope);
  assert.deepEqual(selected.scope, { cutoff: '2026-01-01', totalSourceCount: 5, excludedLegacyCount: 1 });
  assert.equal(selected.readCurrentDates, true);
  assert.deepEqual(selected.invoiceIds, [uuid(1), uuid(2), uuid(3), uuid(4)], 'Saved target, changed mapping and all unselected mappings remain in evidence');
  assert.deepEqual(selected.invoiceNumbers, ['SALE-buyer-one'], 'Unselected source names do not consume cross-date queries');
  assert.deepEqual({ sf, mappings }, inputs, 'All source and control records remain available and unchanged');
});

test('selected collection keeps every current-date candidate, historical exact target and global inactive sales collision', async () => {
  const sf = snapshot(); sf.buyers.push(buyer('buyer-two'));
  const mappings = stored(); mappings.documentMappings = [
    { salesforce_object: 'Invoice__c', salesforce_id: 'buyer-one', xero_document_id: uuid(2) },
    { salesforce_object: 'Invoice__c', salesforce_id: 'buyer-two', xero_document_id: uuid(8) },
    { salesforce_object: 'Supplier_Invoice__c', salesforce_id: 'supplier-one', xero_document_id: uuid(9) },
  ];
  const plan = buildDocumentCorrectionScope(sf, mappings, '2026-01-01', [
    { salesforceObject: 'Invoice__c', salesforceId: 'buyer-one', xeroInvoiceId: uuid(1) },
  ]);
  const inventory = [target(1, 'OLD-SAVED-TARGET', '2023-01-01'), target(2, 'CHANGED-MAPPING-TARGET', '2024-01-01'),
    { ...target(3, 'SALE-buyer-one', '2020-01-01'), Status: 'VOIDED' },
    { ...target(4, 'SALE-buyer-one', '2021-01-01'), Status: 'DELETED' },
    target(5, 'SALE-buyer-two', '2026-01-01'), target(6, 'OLD-ERP-NUMBER', '2026-06-01', 'ACCPAY'),
    target(7, 'CURRENT-COMPETITOR', '2026-07-01'), target(8, 'SALE-buyer-two', '2020-01-01'),
    target(9, ' OLD-ERP-NUMBER ', '2020-01-01', 'ACCPAY')];
  const paths = [];
  const result = await collectDocumentCorrectionInvoices({}, plan, { loadPages: async (_connection, path) => {
    paths.push(path); const params = new URL(path, 'https://fixture.invalid').searchParams;
    return inventory.filter((row) => params.has('IDs') ? params.get('IDs').split(',').includes(row.InvoiceID)
      : params.has('InvoiceNumbers') ? params.get('InvoiceNumbers').split(',').includes(row.InvoiceNumber) : row.Date >= '2026-01-01');
  } });
  assert.deepEqual(result.invoices.map((row) => row.InvoiceID).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9].map(uuid),
    'Unselected historical mapped records remain available, including normalized bill-number collision evidence');
  assert.equal(result.queryCount, 3);
  assert.equal(new URL(paths[0], 'https://fixture.invalid').searchParams.get('where'), 'Date>=DateTime(2026,01,01)',
    'The current-date inventory is not restricted to selected IDs, Contacts or source names');
  assert.equal(new URL(paths[1], 'https://fixture.invalid').searchParams.get('IDs'), [uuid(1), uuid(2), uuid(8), uuid(9)].join(','));
  assert.equal(new URL(paths[2], 'https://fixture.invalid').searchParams.get('InvoiceNumbers'), 'SALE-buyer-one');
});

test('selected mapped bills retain exact identities despite shared derived numbers; unmapped bills query original and proposed names', () => {
  const sf = snapshot(); sf.suppliers.push(supplier('supplier-two'));
  sf.extras.push({ Id: 'extra-two', Supplier_Invoice__c: 'supplier-two', Buyer_Invoice__c: 'buyer-one' });
  const mappings = stored(); mappings.documentMappings = sf.suppliers.map((record, index) => ({
    salesforce_object: 'Supplier_Invoice__c', salesforce_id: record.Id, xero_document_id: uuid(index + 1),
  }));
  const selection = sf.suppliers.map((record, index) => ({ salesforceObject: 'Supplier_Invoice__c', salesforceId: record.Id, xeroInvoiceId: uuid(index + 1) }));
  const mapped = buildDocumentCorrectionScope(sf, mappings, '2026-01-01', selection);
  assert.deepEqual(mapped.invoiceIds, [uuid(1), uuid(2)]); assert.deepEqual(mapped.invoiceNumbers, []);
  assert.equal(mapped.readCurrentDates, true);
  const unmapped = buildDocumentCorrectionScope(sf, stored(), '2026-01-01', selection.slice(0, 1));
  assert.deepEqual(unmapped.invoiceIds, [uuid(1)]);
  assert.deepEqual(unmapped.invoiceNumbers, ['BILL-1- Vessel, A', 'ORIGINAL-supplier-one']);
});

test('invalid, incomplete, unknown or repeated selected identities fail before any provider collection', () => {
  const selection = { salesforceObject: 'Invoice__c', salesforceId: 'buyer-one', xeroInvoiceId: uuid(1) };
  const invalid = [false, {}, [], [null], [[]], [{ ...selection, salesforceObject: 'Credit_Note__c' }],
    [{ ...selection, salesforceId: '' }], [{ ...selection, salesforceId: ' buyer-one' }],
    [{ ...selection, salesforceId: 'buyer-one\n' }], [{ ...selection, salesforceId: 'missing' }],
    [{ ...selection, xeroInvoiceId: 'invalid' }], [{ ...selection, xeroInvoiceId: '00000000-0000-0000-0000-000000000000' }],
    [selection, { ...selection, xeroInvoiceId: uuid(2) }],
    [selection, { salesforceObject: 'Supplier_Invoice__c', salesforceId: 'supplier-one', xeroInvoiceId: uuid(1) }],
    Array.from({ length: 26 }, (_, index) => ({ ...selection, xeroInvoiceId: uuid(index + 1) })),
  ];
  for (const key of Object.keys(selection)) {
    const missing = { ...selection }; delete missing[key]; invalid.push([missing]);
  }
  for (const value of invalid) assert.throws(() => buildDocumentCorrectionScope(snapshot(), stored(), '2026-01-01', value), held, JSON.stringify(value));
  const duplicate = snapshot(); duplicate.buyers.push(structuredClone(duplicate.buyers[0]));
  assert.throws(() => buildDocumentCorrectionScope(duplicate, stored(), '2026-01-01', [selection]), held);
  const aliases = snapshot(); aliases.buyers[0].Id = 'a01000000000001AAA';
  const aliasSelection = { ...selection, salesforceId: 'a01000000000001' };
  assert.throws(() => buildDocumentCorrectionScope(aliases, stored(), '2026-01-01', [aliasSelection,
    { ...aliasSelection, salesforceId: 'a01000000000001AAA', xeroInvoiceId: uuid(2) }]), held);
});

test('selected missing, legacy or conflicting source projections hold before provider work without hiding global capacity', () => {
  const selection = [{ salesforceObject: 'Supplier_Invoice__c', salesforceId: 'supplier-one', xeroInvoiceId: uuid(1) }];
  for (const mutate of [
    (sf) => { sf.buyers[0].Delivery_Date__c = null; },
    (sf) => { sf.buyers[0].Delivery_Date__c = '2025-12-31'; },
    (sf) => { delete sf.suppliers[0].Invoice_Due_Date__c; },
    (sf) => { sf.buyers.push(buyer('conflict', '2026-02-01')); sf.lines.push({ Supplier_Invoice__c: 'supplier-one', Buyer_Invoice__c: 'conflict' }); },
    (sf) => { sf.buyers = []; },
  ]) {
    const sf = snapshot(); mutate(sf);
    assert.throws(() => buildDocumentCorrectionScope(sf, stored(), '2026-01-01', selection),
      (error) => error.code === held.code && error.details.scopeReason === 'DOCUMENT_CORRECTION_SELECTION_SOURCE_CHANGED');
  }
  const sf = snapshot(); sf.buyers.push(...Array.from({ length: 2999 }, (_, index) => buyer(`missing-${index}`, null)));
  assert.throws(() => buildDocumentCorrectionScope(sf, stored(), '2026-01-01', selection),
    (error) => error.code === held.code && error.details.scopeReason === 'PREVIEW_ITEM_BOUND', 'Selection cannot evade the complete global source bound');
});

test('twelve thousand confirmed legacy sources do not consume current preview capacity; unknown dates do', () => {
  const sf = snapshot();
  sf.buyers.push(...Array.from({ length: 12000 }, (_, index) => ({ ...buyer(`legacy-${index}`, '2025-01-01'), STEM__c: `legacy-stem-${index}` })));
  const plan = buildDocumentCorrectionScope(sf, stored());
  assert.deepEqual(plan.scope, { cutoff: '2026-01-01', totalSourceCount: 12002, excludedLegacyCount: 12000 });
  assert.equal(plan.invoiceNumbers.length, 3);
  const unknown = { buyers: Array.from({ length: 3001 }, (_, index) => buyer(`missing-${index}`, null)), suppliers: [], lines: [], extras: [] };
  assert.throws(() => buildDocumentCorrectionScope(unknown, stored()), held);
});

test('complete union finds historical IDs, cross-date numbers, inactive global collisions and old ERP current-date candidates', async () => {
  const currentSale = target(1); const currentErp = target(2, 'ERP-UNKNOWN', '2026-02-01', 'ACCPAY');
  const oldMappedBill = target(3, 'OLD-BILL', '2024-06-01', 'ACCPAY');
  const oldNamedBill = target(4, 'ORIGINAL-BILL', '2023-01-01', 'ACCPAY');
  const collision = { ...target(5, currentSale.InvoiceNumber, '2020-01-01'), Status: 'VOIDED' };
  const excludedHistory = Array.from({ length: 11000 }, (_, index) => target(100 + index, `UNRELATED-${index}`, '2022-01-01'));
  const inventory = [currentSale, currentErp, oldMappedBill, oldNamedBill, collision, ...excludedHistory]; const paths = [];
  const plan = { scope: { cutoff: '2026-01-01' }, readCurrentDates: true, invoiceIds: [currentSale.InvoiceID, oldMappedBill.InvoiceID],
    invoiceNumbers: [currentSale.InvoiceNumber, oldNamedBill.InvoiceNumber] };
  const result = await collectDocumentCorrectionInvoices({}, plan, { loadPages: async (_connection, path) => {
    paths.push(path); const params = new URL(path, 'https://fixture.invalid').searchParams;
    assert.ok(params.size > 0, 'Never collect unscoped all-history invoices');
    return inventory.filter((row) => params.has('IDs') ? params.get('IDs').split(',').includes(row.InvoiceID)
      : params.has('InvoiceNumbers') ? params.get('InvoiceNumbers').split(',').includes(row.InvoiceNumber) : row.Date >= '2026-01-01');
  } });
  assert.deepEqual(result.invoices.map((row) => row.InvoiceID), [1, 2, 3, 4, 5].map(uuid));
  assert.equal(result.queryCount, 3); assert.match(result.queryFingerprint, /^[a-f\d]{64}$/);
  const hydrated = paths.find((path) => path.includes('IDs='));
  assert.equal(new URL(hydrated, 'https://fixture.invalid').searchParams.get('IDs'), oldMappedBill.InvoiceID, 'Current mapped records are not redundantly fetched');
});

test('a repeated derived bill number collects every matching exact ID rather than limiting results by requested number count', async () => {
  const bills = [target(1, 'BILL- VESSEL', '2024-01-01', 'ACCPAY'), target(2, 'BILL- VESSEL', '2025-01-01', 'ACCPAY')];
  const result = await collectDocumentCorrectionInvoices({}, { scope: { cutoff: '2026-01-01' }, readCurrentDates: false,
    invoiceIds: [], invoiceNumbers: ['BILL- VESSEL'] }, { loadPages: async () => bills });
  assert.deepEqual(result.invoices, bills);
});

test('literal commas use one equality name and query batches preserve every requested identity', async () => {
  const name = 'BILL- Vessel, A'; const many = Array.from({ length: 150 }, (_, index) => `NUMBER-${index}-${'x'.repeat(70)}`);
  const paths = [];
  await collectDocumentCorrectionInvoices({}, { scope: { cutoff: '2026-01-01' }, readCurrentDates: false,
    invoiceIds: [], invoiceNumbers: [...many, name] }, { loadPages: async (_connection, path) => { paths.push(path); return []; } });
  assert.ok(paths.every((path) => path.length <= 1800));
  const names = paths.flatMap((path) => new URL(path, 'https://fixture.invalid').searchParams.get('InvoiceNumbers')?.split(',') || []);
  assert.deepEqual(names, many);
  const where = new URL(paths.at(-1), 'https://fixture.invalid').searchParams.get('where');
  assert.equal(where, `InvoiceNumber=="${name}"`);
});

test('undocumented quote, backslash and control-character number syntax holds before any Xero reads', async () => {
  for (const name of ['SALE-"A"', 'SALE-\\A', 'BILL, "A"', 'SALE-\nA']) {
    let calls = 0;
    await assert.rejects(collectDocumentCorrectionInvoices({}, { scope: { cutoff: '2026-01-01' }, readCurrentDates: true,
      invoiceIds: [], invoiceNumbers: [name] }, { loadPages: async () => { calls += 1; return []; } }),
    (error) => error.code === held.code && error.details.scopeReason === 'DOCUMENT_CORRECTION_NUMBER_SYNTAX_UNSUPPORTED');
    assert.equal(calls, 0);
    const sf = snapshot(); sf.buyers[0].Name = name;
    assert.throws(() => buildDocumentCorrectionScope(sf, stored()), held);
  }
});

test('out-of-scope responses, repeated IDs and conflicting overlap facts never yield a partial inventory', async () => {
  const plan = { scope: { cutoff: '2026-01-01' }, readCurrentDates: true, invoiceIds: [], invoiceNumbers: ['SALE-buyer-one'] };
  for (const loadPages of [
    async () => [target(1, 'OTHER', '2020-01-01')],
    async () => [target(1), target(1)],
    async () => [{ ...target(1), InvoiceID: 'invalid' }],
    async (_connection, path) => path.includes('InvoiceNumbers') ? [{ ...target(1), Total: 999 }] : [target(1)],
    async (_connection, path) => path.includes('InvoiceNumbers') ? [target(2, 'UNREQUESTED')] : [target(1)],
  ]) await assert.rejects(collectDocumentCorrectionInvoices({}, plan, { loadPages }), held);
});

test('provider pagination returns all matching bills even when one requested number spans multiple pages', async () => {
  const invoices = Array.from({ length: 1002 }, (_, index) => target(index + 1, 'SAME-NUMBER', '2024-01-01', 'ACCPAY'));
  const requests = [];
  const rows = await loadDocumentCorrectionInvoicePages({}, '/Invoices?InvoiceNumbers=SAME-NUMBER', { accountingFetch: async (_connection, path, options) => {
    requests.push(path); assert.equal(options.method, 'GET');
    const params = new URL(path, 'https://fixture.invalid').searchParams; const page = Number(params.get('page'));
    assert.equal(params.get('pageSize'), '1000'); assert.equal(params.get('includeArchived'), 'true'); assert.equal(params.get('order'), 'InvoiceID ASC');
    assert.equal(params.get('unitdp'), '4'); assert.equal(params.get('summaryOnly'), 'false');
    assert.equal(params.get('InvoiceNumbers'), 'SAME-NUMBER');
    return { Invoices: invoices.slice((page - 1) * 1000, page * 1000), pagination: { page, pageSize: 1000, pageCount: 2, itemCount: 1002 } };
  } });
  assert.equal(requests.length, 2); assert.deepEqual(rows, invoices);
});

test('a full final page stops only when provider counts prove the complete scope', async () => {
  let calls = 0; const invoices = Array.from({ length: 1000 }, (_, index) => target(index + 1));
  const rows = await loadDocumentCorrectionInvoicePages({}, '/Invoices?InvoiceNumbers=EXACT', { accountingFetch: async () => {
    assert.equal(++calls, 1, 'Complete count metadata avoids an unnecessary sentinel request');
    return { Invoices: invoices, pagination: { page: 1, pageSize: 1000, pageCount: 1, itemCount: 1000 } };
  } });
  assert.equal(rows.length, 1000);
});

test('short, drifting, duplicate and malformed provider pages fail closed', async () => {
  const full = Array.from({ length: 1000 }, (_, index) => target(index + 1));
  for (const response of [
    { Invoices: [target(1)], pagination: { page: 1, pageSize: 1000, pageCount: 2, itemCount: 1001 } },
    { Invoices: [target(1), target(1)] },
    { Invoices: [target(1)], pagination: { page: 2, pageSize: 1000, pageCount: 1, itemCount: 1 } },
    { Invoices: [target(1)], pagination: { page: 1, pageSize: 100, pageCount: 1, itemCount: 1 } },
    { Invoices: [target(1)], pagination: { itemCount: '1' } },
  ]) await assert.rejects(loadDocumentCorrectionInvoicePages({}, '/Invoices?IDs=exact', { accountingFetch: async () => response }), held);
  for (const second of [
    { Invoices: [target(1)] },
    { Invoices: [target(1001)], pagination: { page: 2, pageSize: 1000, pageCount: 2, itemCount: 1002 } },
    { Invoices: [target(1001)] },
  ]) {
    let calls = 0;
    await assert.rejects(loadDocumentCorrectionInvoicePages({}, '/Invoices?InvoiceNumbers=exact', { accountingFetch: async () => ++calls === 1
      ? { Invoices: full, pagination: { page: 1, pageSize: 1000, pageCount: 2, itemCount: 1001 } } : second }), held);
  }
});

test('the existing ten-thousand-per-query limit remains a hard completeness failure', async () => {
  let calls = 0;
  await assert.rejects(loadDocumentCorrectionInvoicePages({}, '/Invoices?InvoiceNumbers=EXACT', { accountingFetch: async () => {
    const start = calls++ * 1000; return { Invoices: Array.from({ length: 1000 }, (_, index) => target(start + index + 1)) };
  } }), held);
  assert.equal(calls, 11);
});

test('noneligible preview compaction preserves visible reason/source projection; eligible evidence stays exact and bounds never truncate', () => {
  const eligible = { id: 'one', outcome: 'eligible', source: { money: 100 }, before: { Total: 100 }, mapping: { id: uuid(1) }, projection: { scope: 'current', evidence: { id: 'buyer' } } };
  const unavailable = { ...structuredClone(eligible), id: 'two', outcome: 'blocked', reason: 'Missing buyer date', projection: { scope: 'unavailable', evidence: { id: 'unknown' } } };
  const legacy = { ...structuredClone(eligible), id: 'three', outcome: 'legacy_preserved', projection: { scope: 'legacy' } };
  const compact = compactDocumentCorrectionPreview([eligible, unavailable, legacy], { totalSourceCount: 3, excludedLegacyCount: 1 });
  assert.equal(compact.length, 2); assert.deepEqual(compact[0], eligible);
  assert.deepEqual(compact[1], { id: 'two', outcome: 'blocked', reason: 'Missing buyer date', projection: unavailable.projection });
  assertDocumentCorrectionPreviewBounds(compact, {});
  assert.throws(() => assertDocumentCorrectionPreviewBounds(Array.from({ length: 3001 }, () => ({})), {}), held);
  assert.throws(() => assertDocumentCorrectionPreviewBounds([{ reason: 'x'.repeat(20000000) }], {}), held);
  assert.throws(() => compactDocumentCorrectionPreview([eligible, unavailable, legacy], { totalSourceCount: 2, excludedLegacyCount: 0 }), held);
});
