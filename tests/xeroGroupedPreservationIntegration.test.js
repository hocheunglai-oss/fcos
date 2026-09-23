import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildFinancialClassifications, buildXeroAccountingPayload, changedXeroReviewItems, loadSalesforceFinancialSnapshot,
  normalizeXeroInvoice, toSyncItemRow, xeroFinancialSyncLatest, xeroFinancialSyncRun, xeroReviewFingerprint, XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';
import { completeGroupedAccountSnapshot } from '../api/_xeroGroupedPreservationAdapter.js';
import { groupedPreservationCanonical } from '../api/_xeroGroupedPreservation.js';

const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const sha = (value) => createHash('sha256').update(groupedPreservationCanonical(value)).digest('hex');
const now = '2026-09-23T22:00:00.000Z';
const actor = { profile: { id: uuid(90), email: 'finance@example.test' } };

function fixture(mode = 'draft') {
  const account = { Id: '001000000000001', Name: 'Marine Supplier Limited', Company_Code__c: 'SUPPLIER', Inactive_Suspended__c: false, RecordType: { DeveloperName: 'Supplier' } };
  const supplier = { Id: 'a01000000000001', Name: 'INV-2026-100', STEM__c: 'a03000000000001', Supplier__c: account.Id,
    Supplier__r: { Name: account.Name, Company_Code__c: account.Company_Code__c },
    STEM__r: { Name: 'HK2600100T', KeyStem__c: 'HK2600100T', Delivery_Date__c: '2026-01-02' },
    Invoice_Date__c: '2026-01-03', Invoice_Due_Date__c: '2026-02-03', Invoice_Amount__c: 30.03,
    Invoice_File__c: 'https://example.test/issued.pdf', CurrencyIsoCode: 'USD', Status__c: 'Issued' };
  const children = [1, 2].map((n) => ({ Id: `a0200000000000${n}`, Name: `LINE-${n}`, Supplier_Invoice__c: supplier.Id,
    Product__c: '01t000000000001', Product__r: { Name: 'Marine fuel' }, Quantity__c: n, Quantity_Delivered_Per_BDN__c: n,
    Cost_Per_Unit__c: 10.01, Total_Cost__c: n === 1 ? 10.01 : 20.02, CurrencyIsoCode: 'USD',
    Cancelled__c: false, STEM__c: supplier.STEM__c, Supplier__c: account.Id }));
  const salesforce = { cutoffDate: '2026-01-01', buyers: [], suppliers: [supplier], lines: children, extras: [],
    safetyContext: { fields: {}, singleCurrency: false },
    groupedAccountSnapshot: completeGroupedAccountSnapshot({ totalSize: 1, records: [account] }) };
  const rawXero = { InvoiceID: uuid(3), Type: 'ACCPAY', Status: 'AUTHORISED', InvoiceNumber: supplier.Name,
    Contact: { ContactID: uuid(2), Name: account.Name }, Reference: 'Historical reference', CurrencyCode: 'USD', CurrencyRate: 1,
    Date: '2026-01-03', DueDate: '2026-02-02', SubTotal: 30.03, Total: 30.03, TotalTax: 0, LineAmountTypes: 'Exclusive', IsDiscounted: false,
    AmountDue: 30.03, AmountPaid: 0, AmountCredited: 0,
    LineItems: [{ LineItemID: uuid(4), Description: 'Combined historical fuel', Quantity: 1, UnitAmount: 30.03,
      LineAmount: 30.03, AccountCode: '51100', TaxType: 'NONE', TaxAmount: 0, Tracking: [] }] };
  const xero = { tenantId: uuid(1), cutoffDate: '2026-01-01', contactsComplete: true, contacts: [{ id: uuid(2), name: account.Name, status: 'ACTIVE', accountNumber: '', contactNumber: '' }],
    documents: [normalizeXeroInvoice(rawXero)], inactiveDocuments: [], organisation: { baseCurrency: 'USD' } };
  const stored = { documentMappings: [], bankMappings: [], productMappings: [{ id: uuid(5), direction: 'supplier', salesforce_product_id: children[0].Product__c,
    xero_account_code: '51100', xero_tax_type: 'NONE', enabled: true, revision: 1 }] };
  const build = () => buildFinancialClassifications(salesforce, xero, stored, { postingMode: mode }).rows[0];
  const accept = () => {
    const row = build(); assert.equal(row.groupedPreservation?.eligible, true, JSON.stringify(row.blockers));
    stored.documentMappings = [{ id: uuid(10), salesforce_object: row.salesforceObject, salesforce_id: row.salesforceId,
      xero_document_id: row.xero.id, xero_document_type: row.xeroType, xero_contact_id: row.contactId,
      source_fingerprint: row.sourceFingerprint, protected_legacy: true,
      retained_differences: { accountId: row.accountId, stemId: row.stemId, groupedPreservation: { ...row.groupedPreservation,
        reviewFingerprint: xeroReviewFingerprint(row), evidence: row.groupedPreservationProof } } }];
    return row;
  };
  return { account, supplier, children, salesforce, rawXero, xero, stored, build, accept };
}

function savedItem(row) {
  return { ...toSyncItemRow(row, uuid(80), 0, now), selected: true, status: 'selected' };
}

function fakeStore(f, row, { response, rpcError, allowMappingWrites = false, mappingError = null, itemError = null } = {}) {
  const run = { id: uuid(80), revision: 3, status: 'processing', mode: 'preview', control_totals: {
    postingMode: row.postingMode, workflowSnapshot: { reconciliationVersion: XERO_RECONCILIATION_VERSION } }, created_at: now };
  const tables = { xero_financial_sync_runs: [run], xero_financial_sync_items: [savedItem(row)],
    xero_financial_product_mappings: f.stored.productMappings, xero_financial_document_mappings: f.stored.documentMappings,
    xero_financial_bank_mappings: [], xero_financial_audit_events: [], dispute_beta_cases: [] };
  const calls = []; let xeroPosts = 0; let mappingWrites = 0;
  const client = {
    from(table) {
      let filters = []; let range = null; let mutation = null; let single = false;
      const query = {
        select: () => query, order: () => query, limit: () => query, not: () => query,
        eq: (key, value) => { filters.push((record) => record[key] === value); return query; },
        in: (key, values) => { filters.push((record) => values.includes(record[key])); return query; },
        range: (start, end) => { range = [start, end]; return query; },
        maybeSingle: () => { single = true; return query; },
        update: (value) => { mutation = { update: value }; return query; },
        insert: (value) => { mutation = { insert: value }; return query; },
        upsert: (value) => {
          mappingWrites += 1;
          if (!allowMappingWrites) throw new Error('Ordinary upsert is forbidden for grouped links');
          mutation = { upsert: value }; return query;
        },
        then(resolve, reject) {
          try {
            const selected = (tables[table] || []).filter((record) => filters.every((filter) => filter(record)));
            if (mutation?.upsert && mappingError) return Promise.resolve({ error: mappingError }).then(resolve, reject);
            if (mutation?.update && table === 'xero_financial_sync_items' && itemError && ['created', 'updated'].includes(mutation.update.status)) return Promise.resolve({ error: itemError }).then(resolve, reject);
            if (mutation?.update) for (const record of selected) Object.assign(record, mutation.update);
            if (mutation?.insert) tables[table].push(mutation.insert);
            if (mutation?.upsert) tables[table].push(mutation.upsert);
            const data = range ? selected.slice(range[0], range[1] + 1) : selected;
            return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'start_xero_financial_sync_run_v1') return { data: structuredClone(run), error: null };
      if (name === 'link_xero_grouped_document_v1') return rpcError ? { error: rpcError }
        : { data: response || { id: args.p_item_id, status: 'linked', xeroDocumentId: row.xero.id }, error: null };
      if (name === 'finish_xero_financial_sync_run_v1') return { data: { ...run, status: args.p_status, revision: run.revision + 1 }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const dependencies = { client, accessContext: actor, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
    getConnection: async () => ({ tenantId: f.xero.tenantId, scope: 'accounting.invoices accounting.contacts accounting.settings.read' }),
    loadSalesforce: async () => f.salesforce, loadXero: async () => f.xero,
    accountingFetch: async () => { xeroPosts += 1; throw new Error('A grouped link must never POST to Xero'); } };
  return { client, dependencies, calls, tables, get xeroPosts() { return xeroPosts; }, get mappingWrites() { return mappingWrites; } };
}

test('actual source builder and Xero normalizer produce an explicit protected link in both posting modes', () => {
  for (const mode of ['draft', 'authorised']) {
    const f = fixture(mode); const row = f.build();
    assert.equal(row.action, 'protected_legacy', JSON.stringify(row.blockers));
    assert.equal(row.status, 'eligible', JSON.stringify(row.blockers));
    assert.equal(row.reviewRequired, true); assert.equal(row.acceptedLegacy, false); assert.equal(row.proposedPayload, null);
    assert.equal(row.groupedPreservation.fingerprint.length, 64);
    assert.equal(row.groupedPreservation.sourceLineCount, 2);
    assert.equal(row.groupedPreservationProof.accounting.source.lines[1].lineAmountCents, '2002');
    assert.ok(row.differences.some((difference) => difference.field === 'detailedLines'));
    assert.equal(Object.hasOwn(row.lines[0], 'lineAmount'), false, 'Legacy source.lines fingerprint shape must not change.');
    assert.throws(() => buildXeroAccountingPayload(row, row.xero.id, 'AUTHORISED', row.xero), { code: 'XERO_GROUPED_PRESERVATION_LINK_ONLY' });
  }
});

test('buyer grouped invoices require the same issued-source and accounting proof', () => {
  const f = fixture('authorised');
  const buyer = { ...f.supplier, Amount__c: 30.03, Proforma__c: false, Deprecated__c: false, File__c: f.supplier.Invoice_File__c,
    STEM__r: { ...f.supplier.STEM__r, Account__c: f.account.Id, Account__r: { Name: f.account.Name, Company_Code__c: f.account.Company_Code__c } } };
  f.salesforce.buyers = [buyer]; f.salesforce.suppliers = [];
  for (const line of f.children) Object.assign(line, { Buyer_Invoice__c: buyer.Id, Supplier_Invoice__c: null, Price_Per_Unit__c: line.Cost_Per_Unit__c, Total_Price__c: line.Total_Cost__c });
  f.stored.productMappings[0].direction = 'buyer'; f.xero.documents[0].type = 'ACCREC';
  const row = f.build(); assert.equal(row.status, 'eligible', JSON.stringify(row.blockers));
  assert.equal(row.action, 'protected_legacy'); assert.equal(row.reviewRequired, true); assert.equal(row.proposedPayload, null);
  buyer.Proforma__c = true; assert.notEqual(f.build().status, 'eligible');
});

test('missing complete raw headers, authoritative line totals or readiness cannot use normalized defaults', async (t) => {
  const cases = [
    ['missing raw Xero total', (f) => { delete f.rawXero.Total; f.xero.documents = [normalizeXeroInvoice(f.rawXero)]; }],
    ['missing Xero subtotal', (f) => { delete f.rawXero.SubTotal; f.xero.documents = [normalizeXeroInvoice(f.rawXero)]; }],
    ['missing Xero tax', (f) => { delete f.rawXero.TotalTax; f.xero.documents = [normalizeXeroInvoice(f.rawXero)]; }],
    ['missing Xero discount flag', (f) => { delete f.rawXero.IsDiscounted; f.xero.documents = [normalizeXeroInvoice(f.rawXero)]; }],
    ['missing Xero tracking', (f) => { delete f.xero.documents[0].lineItems[0].Tracking; }],
    ['missing source total reconstructed by old builder', (f) => { delete f.children[0].Total_Cost__c; }],
    ['missing source quantity reconstructed by old builder', (f) => { delete f.children[0].Quantity_Delivered_Per_BDN__c; delete f.children[0].Quantity__c; }],
    ['source half-cent reconstructed by old builder', (f) => { f.children[0].Total_Cost__c = 10.011; }],
    ['missing issued source file', (f) => { delete f.supplier.Invoice_File__c; }],
    ['positive discount product', (f) => { f.children[0].Product__r.Name = 'Special Discount'; }],
    ['source zero quantity hidden by old fallback', (f) => { f.children[0].Quantity_Delivered_Per_BDN__c = 0; }],
    ['source unit mismatch repaired by old builder', (f) => { f.children[0].Cost_Per_Unit__c = 10.00; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const f = fixture(); change(f); const row = f.build();
    assert.notEqual(row.status, 'eligible', JSON.stringify(row)); assert.equal(row.proposedPayload, null);
  });
});

test('an exhaustive global Account population is required, including inactive Accounts absent from the financial snapshot', async (t) => {
  const cases = [
    ['missing global population', (f) => { delete f.salesforce.groupedAccountSnapshot; }],
    ['incomplete population', (f) => { f.salesforce.groupedAccountSnapshot.complete = false; }],
    ['incomplete Contacts', (f) => { f.xero.contactsComplete = false; }],
    ['unverified source cutoff', (f) => { delete f.salesforce.cutoffDate; }],
    ['different provider scopes', (f) => { f.xero.cutoffDate = '2026-02-01'; }],
    ['same-name inactive other Account', (f) => { f.salesforce.groupedAccountSnapshot.accounts.push({ ...f.salesforce.groupedAccountSnapshot.accounts[0], id: '001000000000002', inactiveSuspended: true }); }],
    ['second Account matched by company key', (f) => { f.salesforce.groupedAccountSnapshot.accounts.push({ id: '001000000000002', name: 'Different legal name', companyCode: 'HKMarine Supplier Limited' }); }],
    ['Account name changed outside source snapshot', (f) => { f.salesforce.groupedAccountSnapshot.accounts[0].name += ' changed'; }],
    ['duplicate Xero Contact ID', (f) => { f.xero.contacts.push({ ...f.xero.contacts[0] }); }],
    ['one Account matches several Contacts', (f) => { f.xero.contacts.push({ ...f.xero.contacts[0], id: uuid(25) }); }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const f = fixture(); change(f); const row = f.build(); assert.notEqual(row.status, 'eligible'); assert.equal(row.proposedPayload, null);
  });
});

test('snapshot loader obtains all Accounts without date or active filters and rejects truncation or duplicate aliases', async (t) => {
  const f = fixture();
  const query = async (requests) => {
    assert.equal(requests.length, 6);
    assert.match(requests[5].soql, /FROM Account ORDER BY Id/); assert.doesNotMatch(requests[5].soql, /WHERE|2026/);
    return Array.from({ length: 6 }, (_value, index) => index === 5 ? { records: [f.account], totalSize: 1 } : { records: [], totalSize: 0 });
  };
  const result = await loadSalesforceFinancialSnapshot('2026-01-01', query, { fields: {} });
  assert.equal(result.groupedAccountSnapshot.complete, true); assert.equal(result.groupedAccountSnapshot.accounts.length, 1);
  for (const [name, change] of [
    ['truncated', (result) => { result.totalSize = 2; }], ['missing totalSize', (result) => { delete result.totalSize; }],
    ['duplicated canonical Account', (result) => { result.records.push({ ...f.account, Id: `${f.account.Id}AAA` }); result.totalSize = 2; }],
  ]) await t.test(name, async () => assert.rejects(loadSalesforceFinancialSnapshot('2026-01-01', async (requests) => {
    const data = await query(requests); change(data[5]); return data;
  }, { fields: {} }), { code: 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE' }));
});

test('exact numbers, unique source documents, target ownership and approved mappings remain mandatory', async (t) => {
  const cases = [
    ['equal date/contact/amount but different invoice number', (f) => { f.xero.documents[0].invoiceNumber = 'OTHER'; f.xero.documents[0].date = f.supplier.Invoice_Date__c; }],
    ['same-number historical invoice outside scope', (f) => { f.xero.documents[0].date = '2025-01-03'; }],
    ['source moved outside complete scope', (f) => { f.supplier.Invoice_Date__c = f.xero.documents[0].date = '2025-01-03'; }],
    ['duplicate normalized source identity', (f) => { f.salesforce.suppliers.push({ ...f.supplier, Id: 'a01000000000002', Name: ` ${f.supplier.Name} ` }); }],
    ['duplicate normalized Xero identity', (f) => { f.xero.documents.push({ ...f.xero.documents[0], id: uuid(20), invoiceNumber: ` ${f.supplier.Name} ` }); }],
    ['ordinary existing owner', (f) => { f.stored.documentMappings.push({ id: uuid(20), salesforce_object: 'Supplier_Invoice__c', salesforce_id: f.supplier.Id,
      xero_document_type: 'ACCPAY', xero_document_id: f.xero.documents[0].id, xero_contact_id: uuid(2), protected_legacy: false }); }],
    ['foreign target owner', (f) => { f.stored.documentMappings.push({ id: uuid(20), salesforce_object: 'Invoice__c', salesforce_id: 'a01000000000002',
      xero_document_type: 'ACCREC', xero_document_id: f.xero.documents[0].id, xero_contact_id: uuid(2) }); }],
    ['duplicate product mapping alias', (f) => { f.stored.productMappings.push({ ...f.stored.productMappings[0], salesforce_product_id: `${f.children[0].Product__c}AAA` }); }],
    ['wrong approved account', (f) => { f.stored.productMappings[0].xero_account_code = '51201'; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const f = fixture(); change(f); const row = f.build(); assert.notEqual(row.status, 'eligible'); assert.equal(row.proposedPayload, null);
  });
  const f = fixture(); f.xero.documents[0].invoiceNumber = `  ${f.supplier.Name}  `;
  assert.equal(f.build().groupedPreservation.eligible, true);
});

test('accepted grouped links survive own mapping insertion and later PAID status without losing sticky protection', () => {
  const f = fixture(); const initial = f.accept();
  const accepted = f.build(); assert.equal(accepted.acceptedLegacy, true, JSON.stringify(accepted.blockers));
  assert.equal(accepted.reviewRequired, false); assert.equal(accepted.action, 'protected_legacy'); assert.equal(accepted.proposedPayload, null);
  assert.equal(accepted.groupedPreservation.fingerprint, initial.groupedPreservation.fingerprint);
  Object.assign(f.xero.documents[0], { status: 'PAID', amountPaid: 30.03, amountDue: 0 });
  Object.assign(f.xero.documents[0].groupedAccounting, { amountPaid: 30.03, amountDue: 0 });
  const paid = f.build(); assert.equal(paid.acceptedLegacy, true); assert.equal(paid.proposedPayload, null);
  assert.equal(paid.groupedPreservation.fingerprint, initial.groupedPreservation.fingerprint);
  assert.notEqual(paid.groupedPreservation.evidenceFingerprint, accepted.groupedPreservation.evidenceFingerprint);
});

test('accepted ownership accepts exactly the same canonical SF alias without treating it as a second owner', () => {
  const f = fixture(); f.accept();
  f.stored.documentMappings[0].salesforce_id += 'AAA';
  f.stored.documentMappings[0].retained_differences.accountId += 'AAA';
  const row = f.build(); assert.equal(row.acceptedLegacy, true, JSON.stringify(row.blockers)); assert.equal(row.proposedPayload, null);
});

test('existing accepted normal legacy fingerprint remains compatible when grouped source/header evidence is added', () => {
  const f = fixture();
  const source = f.build();
  const document = f.xero.documents[0];
  document.lineItems = source.lines.map((line, index) => ({ LineItemID: uuid(40 + index), Description: line.description,
    Quantity: line.quantity, UnitAmount: line.unitAmount, LineAmount: line.quantity * line.unitAmount,
    AccountCode: line.accountCode, TaxType: line.taxType, TaxAmount: 0, Tracking: [] }));
  document.status = 'PAID'; document.amountPaid = 30.03; document.amountDue = 0;
  const oldComparable = document.lineItems.map((line) => ({ description: line.Description.trim().replace(/\s+/g, ' '),
    quantity: line.Quantity, unitAmount: line.UnitAmount, accountCode: line.AccountCode, taxType: line.TaxType,
    lineAmount: Math.round(line.LineAmount * 100) / 100, taxAmount: 0, discount: 0 })).sort((a, b) => groupedPreservationCanonical(a).localeCompare(groupedPreservationCanonical(b)));
  const legacyFingerprint = sha({ source: source.sourceFingerprint, accountId: source.accountId, contactId: source.contactId,
    lines: source.lines, document: { id: document.id, type: document.type, contactId: document.contactId,
      number: document.invoiceNumber, currency: document.currency, total: document.total, date: document.date,
      dueDate: document.dueDate, reference: document.reference, lines: oldComparable, tracking: [[], []] } });
  f.stored.documentMappings = [{ id: uuid(10), salesforce_object: source.salesforceObject, salesforce_id: source.salesforceId,
    xero_document_id: document.id, xero_document_type: document.type, xero_contact_id: source.contactId, protected_legacy: true,
    source_fingerprint: source.sourceFingerprint, retained_differences: { accountId: source.accountId, reviewFingerprint: legacyFingerprint } }];
  const accepted = f.build();
  assert.equal(accepted.acceptedLegacy, true, JSON.stringify(accepted.blockers)); assert.equal(accepted.reviewRequired, false);
  assert.equal(accepted.groupedPreservation, undefined); assert.equal(accepted.proposedPayload, null);
  assert.equal(accepted.sourceFingerprint, source.sourceFingerprint);
});

test('stored grouped policy cannot fall through to normal updates after changes, corruption or equal line counts', async (t) => {
  const cases = [
    ['source amendment', (f) => { f.supplier.Invoice_Due_Date__c = '2026-02-04'; }],
    ['source collapses to one line', (f) => { f.children.splice(1); f.children[0].Total_Cost__c = f.children[0].Cost_Per_Unit__c = 30.03; }],
    ['Xero expands to source line count', (f) => { f.xero.documents[0].lineItems = f.children.map((line, index) => ({ ...f.rawXero.LineItems[0], LineItemID: uuid(30 + index), Quantity: line.Quantity__c, UnitAmount: 10.01, LineAmount: line.Total_Cost__c })); }],
    ['protection flag cleared', (f) => { f.stored.documentMappings[0].protected_legacy = false; }],
    ['proof erased', (f) => { f.stored.documentMappings[0].retained_differences.groupedPreservation = null; }],
    ['stored proof tampered', (f) => { f.stored.documentMappings[0].retained_differences.groupedPreservation.evidence = { corrupted: true }; }],
    ['Xero reverted to draft', (f) => { f.xero.documents[0].status = 'DRAFT'; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const f = fixture(); f.accept(); change(f); const row = f.build();
    assert.ok(['protected_legacy', 'blocked'].includes(row.action)); assert.notEqual(row.status, 'eligible');
    assert.equal(row.acceptedLegacy, false); assert.equal(row.proposedPayload, null);
  });
});

test('review staleness binds current headers, source, product and global Contact evidence and posting mode', async (t) => {
  const cases = [
    ['source file', (f) => { f.supplier.Invoice_File__c = 'https://example.test/new.pdf'; }],
    ['Xero header treatment', (f) => { f.xero.documents[0].groupedAccounting.lineAmountTypes = 'NoTax'; }],
    ['product revision', (f) => { f.stored.productMappings[0].revision += 1; }],
    ['Contact metadata', (f) => { f.xero.contacts[0].accountNumber = 'new'; }],
    ['new shared Account', (f) => { f.salesforce.groupedAccountSnapshot.accounts.push({ ...f.salesforce.groupedAccountSnapshot.accounts[0], id: '001000000000002' }); }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const f = fixture(); const saved = savedItem(f.build()); change(f); const current = f.build();
    assert.equal(changedXeroReviewItems([saved], new Map([[`${current.salesforceObject}:${current.salesforceId}`, current]])).length, 1);
  });
  const draft = fixture().build(); const authorised = fixture('authorised').build();
  assert.notEqual(xeroReviewFingerprint(draft), xeroReviewFingerprint(authorised));
  const f = fixture(); f.accept();
  const changedMode = buildFinancialClassifications(f.salesforce, f.xero, f.stored, { postingMode: 'authorised' }).rows[0];
  assert.notEqual(changedMode.status, 'eligible'); assert.equal(changedMode.proposedPayload, null);
});

test('saved preview and browser output retain compact evidence, not duplicate complete grouped proofs', async () => {
  const f = fixture(); const row = f.build(); const store = fakeStore(f, row);
  const item = store.tables.xero_financial_sync_items[0];
  assert.equal(Object.hasOwn(item.source_payload, 'groupedPreservationProof'), false);
  assert.equal(Object.hasOwn(item.source_payload, 'groupedAccounting'), false);
  assert.equal(item.source_payload.groupedReviewFingerprint, xeroReviewFingerprint(row));
  assert.ok(JSON.stringify(item.source_payload.groupedPreservation).length < 1000);
  assert.equal(changedXeroReviewItems([item], new Map([[`${row.salesforceObject}:${row.salesforceId}`, row]])).length, 0);
  const response = await xeroFinancialSyncLatest({}, { client: store.client });
  const browser = response.preview.rows[0];
  assert.deepEqual(browser.groupedPreservation, row.groupedPreservation);
  assert.equal(Object.hasOwn(browser, 'groupedPreservationProof'), false);
  assert.equal(Object.hasOwn(browser, 'groupedAccounting'), false);
  assert.equal(JSON.stringify(browser).includes('readinessFingerprint'), false);
});

test('reviewed grouped run calls only dedicated atomic link RPC and verifies exact returned outcome', async () => {
  const f = fixture(); const row = f.build(); const store = fakeStore(f, row);
  const response = await xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies);
  assert.equal(response.summary.linked, 1); assert.equal(response.summary.created, 0); assert.equal(response.summary.updated, 0);
  assert.equal(store.xeroPosts, 0); assert.equal(store.mappingWrites, 0);
  const call = store.calls.find((item) => item.name === 'link_xero_grouped_document_v1');
  assert.ok(call); assert.equal(call.args.p_expected_run_revision, 3); assert.equal(call.args.p_expected_item_updated_at, now);
  assert.equal(call.args.p_actor_id, actor.profile.id); assert.equal(call.args.p_actor_email, actor.profile.email);
  assert.equal(call.args.p_review.reviewFingerprint, xeroReviewFingerprint(row));
  assert.equal(sha(JSON.parse(call.args.p_review.accountingCanonical)), row.groupedPreservation.fingerprint);
  assert.equal(sha(JSON.parse(call.args.p_review.evidenceCanonical)), row.groupedPreservation.evidenceFingerprint);
  assert.deepEqual(call.args.p_review.evidence, row.groupedPreservationProof);
});

test('stale evidence, closed gate, storage error and mismatched RPC identity never post or report successful completion', async (t) => {
  await t.test('stale source', async () => {
    const f = fixture(); const row = f.build(); const store = fakeStore(f, row); f.supplier.Invoice_Due_Date__c = '2026-02-05';
    const result = await xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies);
    assert.equal(result.summary.failed, 1); assert.equal(result.summary.linked, 0); assert.equal(store.xeroPosts, 0);
    assert.equal(store.calls.some((item) => item.name === 'link_xero_grouped_document_v1'), false);
  });
  await t.test('closed external gate', async () => {
    const f = fixture(); const store = fakeStore(f, f.build());
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, { ...store.dependencies, env: {} }));
    assert.equal(store.calls.length, 0); assert.equal(store.xeroPosts, 0);
  });
  await t.test('stale grouped proof with unchanged source', async () => {
    const f = fixture(); const store = fakeStore(f, f.build());
    f.xero.documents[0].groupedAccounting.lineAmountTypes = 'NoTax';
    const result = await xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies);
    assert.equal(result.summary.failed, 1); assert.equal(result.summary.linked, 0); assert.equal(store.xeroPosts, 0);
    assert.equal(store.calls.some((item) => item.name === 'link_xero_grouped_document_v1'), false);
  });
  for (const [name, options] of [['atomic error', { rpcError: { code: '40001', message: 'CAS changed' } }],
    ['false completion', { response: { id: uuid(44), status: 'linked', xeroDocumentId: uuid(3) } }]]) await t.test(name, async () => {
    const f = fixture(); const store = fakeStore(f, f.build(), options);
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies));
    assert.equal(store.xeroPosts, 0); assert.equal(store.mappingWrites, 0);
    const finish = store.calls.find((call) => call.name === 'finish_xero_financial_sync_run_v1');
    assert.equal(finish.args.p_status, 'failed'); assert.equal(finish.args.p_classification_summary.linked, 0);
  });
});

test('resume skips a durably linked item after the successful atomic RPC response is lost', async () => {
  const f = fixture(); const store = fakeStore(f, f.build());
  const rpc = store.client.rpc; let linkAttempts = 0;
  store.client.rpc = async (name, args) => {
    if (name !== 'link_xero_grouped_document_v1') return rpc(name, args);
    linkAttempts += 1;
    f.accept(); store.tables.xero_financial_document_mappings.push(...f.stored.documentMappings);
    store.tables.xero_financial_sync_items[0].status = 'linked';
    throw new Error('Response lost after atomic mapping, item and audit commit');
  };
  await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), /Response lost/);
  const resumed = await xeroFinancialSyncRun({ runId: uuid(80), revision: 3 }, store.dependencies);
  assert.equal(resumed.run.status, 'completed'); assert.equal(resumed.summary.failed, 0);
  assert.equal(linkAttempts, 1); assert.equal(store.xeroPosts, 0); assert.equal(store.mappingWrites, 0);
  assert.equal(store.tables.xero_financial_document_mappings.length, 1);
});

test('the exact processing-run unique conflict becomes a clear 409 before any provider read', async () => {
  const f = fixture(); const store = fakeStore(f, f.build());
  const constraint = 'xero_financial_one_processing_document_run_uidx';
  let reads = 0;
  const dependencies = { ...store.dependencies, getConnection: async () => { reads += 1; throw new Error('Must not read'); } };
  for (const error of [{ code: '23505', constraint }, { code: '23505', message: `duplicate key violates unique constraint "${constraint}"` }]) {
    store.client.rpc = async () => ({ error });
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, dependencies), (caught) => {
      assert.equal(caught.status, 409); assert.equal(caught.code, 'XERO_FINANCIAL_RUN_BUSY');
      assert.match(caught.message, /Finance must verify its outcome/); return true;
    });
  }
  store.client.rpc = async () => ({ error: { code: '23505', message: `duplicate key violates unique constraint "${constraint}_unrelated"` } });
  await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, dependencies), { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.equal(reads, 0); assert.equal(store.xeroPosts, 0);
});

function ordinaryFixture(options = {}) {
  const f = fixture(); f.xero.documents = [];
  const row = f.build(); assert.equal(row.action, 'create_draft');
  const store = fakeStore(f, row, { allowMappingWrites: true, ...options });
  const confirmed = { ...f.rawXero, Status: 'DRAFT', InvoiceID: uuid(51), InvoiceNumber: row.documentNumber };
  return { f, row, store, confirmed };
}

function assertBarrierHeld(store) {
  assert.equal(store.calls.some((call) => call.name === 'finish_xero_financial_sync_run_v1'), false);
  assert.equal(store.tables.xero_financial_sync_runs[0].status, 'processing');
  assert.equal(store.tables.xero_financial_sync_runs[0].error_code, 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN');
  assert.match(store.tables.xero_financial_sync_runs[0].error_message, /Finance must verify/);
  assert.equal(store.tables.xero_financial_audit_events.at(-1).event_type, 'document_post_uncertain');
  assert.equal(store.tables.xero_financial_audit_events.at(-1).actor_id, actor.profile.id);
}

test('ambiguous ordinary POST outcomes retain the global processing barrier and safe durable evidence', async (t) => {
  const cases = [
    ['network failure after dispatch', async () => { throw Object.assign(new Error('network failed'), { code: 'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED', status: 502 }); }],
    ['JSON parse failure after success', async (_path, options) => { options.onResponse({ status: 200, headers: new Headers() }); throw new SyntaxError('invalid JSON'); }],
    ['local reserve429 after a successful200 POST', async (_path, options) => {
      options.onResponse({ status: 200, headers: new Headers({ 'x-daylimit-remaining': '100' }) });
      throw new Error('The reserve assertion must have thrown first');
    }],
    ['missing document collection', async () => ({})],
    ['empty confirmation response', async () => ({ Invoices: [] })],
    ['wrong returned total', async (_path, _options, confirmed) => ({ Invoices: [{ ...confirmed, Total: 30.02 }] })],
    ['wrong returned status', async (_path, _options, confirmed) => ({ Invoices: [{ ...confirmed, Status: 'AUTHORISED' }] })],
    ['provider validation ambiguity', async (_path, _options, confirmed) => ({ Invoices: [{ ...confirmed, HasErrors: true, ValidationErrors: [{ Message: 'Validation failed' }] }] })],
    ['HTTP500 with no response body', async () => { throw Object.assign(new Error('server unavailable'), { status: 500, code: 'XERO_CONTACT_SYNC_XERO_REQUEST_FAILED' }); }],
    ['plain local status429 is not authoritative rejection', async () => { throw Object.assign(new Error('local reserve'), { status: 429, code: 'XERO_FINANCIAL_DAILY_RESERVE' }); }],
  ];
  for (const [name, post] of cases) await t.test(name, async () => {
    const { store, confirmed } = ordinaryFixture(); let dispatched = 0;
    store.dependencies.accountingFetch = async (_connection, path, options) => {
      dispatched += 1; return post(path, options, confirmed);
    };
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), { code: 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN' });
    assert.equal(dispatched, 1); assertBarrierHeld(store);
    const item = store.tables.xero_financial_sync_items[0];
    assert.equal(item.error_code, 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN'); assert.equal(item.mutation_attempts, 1);
  });
});

test('confirmed POST still holds the barrier until mapping and item confirmation are durably saved', async (t) => {
  for (const [name, options] of [['mapping persistence', { mappingError: { message: 'Mapping store failed' } }],
    ['item persistence', { itemError: { message: 'Item store failed' } }]]) await t.test(name, async () => {
    const { store, confirmed } = ordinaryFixture(options);
    store.dependencies.accountingFetch = async () => ({ Invoices: [confirmed] });
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), { code: 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN' });
    assertBarrierHeld(store);
    assert.deepEqual(store.tables.xero_financial_audit_events.at(-1).fingerprints.returnedDocumentIds, [confirmed.InvoiceID]);
  });
  const { store, confirmed } = ordinaryFixture();
  store.dependencies.accountingFetch = async () => ({ Invoices: [confirmed] });
  const result = await xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies);
  assert.equal(result.summary.created, 1); assert.equal(result.run.status, 'completed');
  assert.equal(store.tables.xero_financial_audit_events.some((event) => event.event_type === 'document_post_uncertain'), false);
});

test('authoritative rate-limit rejection and failures before any POST release the processing barrier normally', async (t) => {
  for (const code of ['XERO_CONTACT_SYNC_RATE_LIMITED', 'XERO_CONTACT_SYNC_RATE_LIMIT_RETRY_EXHAUSTED']) await t.test(code, async () => {
    const { store } = ordinaryFixture();
    store.dependencies.accountingFetch = async (_connection, _path, options) => {
      options.onResponse({ status: 429, headers: new Headers() });
      throw Object.assign(new Error('Provider rejected request before accepting it'), { code, status: 429 });
    };
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), { code });
    assert.equal(store.calls.some((call) => call.name === 'finish_xero_financial_sync_run_v1' && call.args.p_status === 'failed'), true);
    assert.equal(store.tables.xero_financial_audit_events.some((event) => event.event_type === 'document_post_uncertain'), false);
  });
  await t.test('source GET fails', async () => {
    const { store } = ordinaryFixture(); let posts = 0;
    store.dependencies.loadSalesforce = async () => { throw new Error('read failed'); };
    store.dependencies.accountingFetch = async () => { posts += 1; };
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), /read failed/);
    assert.equal(posts, 0); assert.equal(store.calls.some((call) => call.name === 'finish_xero_financial_sync_run_v1'), true);
  });
});

test('a partial batch holds only unresolved items after confirmed items are durable', async () => {
  const { f, store, confirmed } = ordinaryFixture();
  const secondInvoice = { ...f.supplier, Id: 'a01000000000002', Name: 'INV-2026-101' };
  f.salesforce.suppliers.push(secondInvoice);
  f.salesforce.lines.push(...f.children.slice(0, 2).map((line, index) => ({ ...line, Id: `a0200000000000${index + 3}`, Supplier_Invoice__c: secondInvoice.Id })));
  const rows = buildFinancialClassifications(f.salesforce, f.xero, f.stored).rows;
  store.tables.xero_financial_sync_items = rows.map((row, index) => ({ ...savedItem(row), row_index: index }));
  store.dependencies.accountingFetch = async () => ({ Invoices: [confirmed] });
  await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), { code: 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN' });
  assertBarrierHeld(store);
  assert.equal(store.tables.xero_financial_sync_items[0].status, 'created');
  assert.equal(store.tables.xero_financial_sync_items[1].error_code, 'XERO_FINANCIAL_CONFIRMATION_UNCERTAIN');
  assert.deepEqual(store.tables.xero_financial_audit_events.at(-1).fingerprints.uncertainItemIds, [store.tables.xero_financial_sync_items[1].id]);
});

test('proven validation rejections persist normal failures and release without weakening successful identity matching', async (t) => {
  for (const flag of ['HasErrors', 'HasValidationErrors', 'StatusAttributeString']) await t.test(flag, async () => {
    const { store, confirmed } = ordinaryFixture();
    const rejected = { ...confirmed, [flag]: flag === 'StatusAttributeString' ? 'ERROR' : true, ValidationErrors: [{ Message: 'The account is archived.' }] };
    delete rejected.InvoiceID;
    store.dependencies.accountingFetch = async () => ({ Invoices: [rejected] });
    const result = await xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies);
    assert.equal(result.run.status, 'partial'); assert.equal(result.summary.failed, 1); assert.equal(result.summary.created, 0);
    assert.equal(store.mappingWrites, 0); assert.equal(store.tables.xero_financial_sync_items[0].error_code, 'XERO_FINANCIAL_VALIDATION_REJECTED');
    assert.equal(store.tables.xero_financial_audit_events.some((event) => event.event_type === 'document_post_uncertain'), false);
  });
  for (const variant of ['two_rejected', 'mixed']) await t.test(variant, async () => {
    const { f, store, confirmed } = ordinaryFixture();
    const second = { ...f.supplier, Id: 'a01000000000002', Name: 'INV-2026-101' };
    f.salesforce.suppliers.push(second);
    f.salesforce.lines.push(...f.children.slice(0, 2).map((line, index) => ({ ...line, Id: `a0200000000000${index + 3}`, Supplier_Invoice__c: second.Id })));
    const rows = buildFinancialClassifications(f.salesforce, f.xero, f.stored).rows;
    store.tables.xero_financial_sync_items = rows.map((row, index) => ({ ...savedItem(row), row_index: index }));
    const rejection = { ...confirmed, InvoiceID: '00000000-0000-0000-0000-000000000000', HasErrors: true, ValidationErrors: [{ Message: 'The account is archived.' }] };
    store.dependencies.accountingFetch = async () => ({ Invoices: [variant === 'mixed' ? confirmed : rejection, { ...rejection, InvoiceNumber: second.Name }] });
    const result = await xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies);
    assert.equal(result.run.status, 'partial'); assert.equal(result.summary.failed, variant === 'mixed' ? 1 : 2);
    assert.equal(result.summary.created, variant === 'mixed' ? 1 : 0);
    assert.equal(store.tables.xero_financial_audit_events.some((event) => event.event_type === 'document_post_uncertain'), false);
  });
});

test('contradictory or malformed rejection evidence stays uncertain', async (t) => {
  for (const [name, change] of [
    ['success marker', (row) => { row.StatusAttributeString = 'OK'; }],
    ['explicit success flag', (row) => { row.HasValidationErrors = false; }],
    ['missing currency identity', (row) => { delete row.CurrencyCode; }],
    ['empty errors', (row) => { row.ValidationErrors = []; }],
    ['malformed errors', (row) => { row.ValidationErrors = [{ Code: 'INVALID' }]; }],
    ['real newly assigned ID', (row) => { row.InvoiceID = uuid(52); }],
    ['paid status', (row) => { row.Status = 'PAID'; }],
  ]) await t.test(name, async () => {
    const { store, confirmed } = ordinaryFixture();
    const rejected = { ...confirmed, HasErrors: true, ValidationErrors: [{ Message: 'Rejected' }] }; delete rejected.InvoiceID; change(rejected);
    store.dependencies.accountingFetch = async () => ({ Invoices: [rejected] });
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), { code: 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN' });
    assertBarrierHeld(store);
  });
});

test('diagnostic write failures and rate-limit-coded errors after observed non429 responses cannot unlock an uncertain run', async (t) => {
  await t.test('diagnostics return storage errors', async () => {
    const { store } = ordinaryFixture();
    const from = store.client.from;
    store.client.from = (table) => {
      const query = from(table);
      for (const method of ['update', 'insert']) if (['xero_financial_sync_runs', 'xero_financial_sync_items', 'xero_financial_audit_events'].includes(table)) {
        query[method] = () => { query.then = (resolve, reject) => Promise.resolve({ error: { message: 'Diagnostic storage unavailable' } }).then(resolve, reject); return query; };
      }
      return query;
    };
    store.dependencies.accountingFetch = async () => { throw new Error('transport lost'); };
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), { code: 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN' });
    assert.equal(store.tables.xero_financial_sync_runs[0].status, 'processing');
    assert.equal(store.calls.some((call) => call.name === 'finish_xero_financial_sync_run_v1'), false);
  });
  await t.test('rate-limit code after200 observation', async () => {
    const { store } = ordinaryFixture();
    store.dependencies.accountingFetch = async (_connection, _path, options) => {
      options.onResponse({ status: 200, headers: new Headers() });
      throw Object.assign(new Error('Unexpected later rate-limit error'), { code: 'XERO_CONTACT_SYNC_RATE_LIMITED', status: 429 });
    };
    await assert.rejects(xeroFinancialSyncRun({ runId: uuid(80), revision: 2 }, store.dependencies), { code: 'XERO_FINANCIAL_DOCUMENT_POST_UNCERTAIN' });
    assertBarrierHeld(store);
  });
});
