import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCreditAllocationSalesforceSource, resolveCreditAllocationSourceId, verifyCreditAllocationSourceMappings } from '../api/_xeroCreditAllocationSource.js';
import { nativeDocumentSourceFingerprint } from "../api/_xeroNativeDocumentFingerprint.js";
import { loadCreditAllocationDocumentContext } from "../api/_xeroCreditAllocationContext.js";


const id = suffix => `a0000000000000${suffix}AAA`;
const [creditId, originalId, stemId, partyId, creditLineId, originalLineId, sourceId, otherId] =
  Array.from({ length: 8 }, (_, index) => id(index + 1));
const result = records => ({ records, totalSize: records.length });

function fixture(supplier = false) {
  const sourceObject = supplier ? 'Supplier_Invoice__c' : 'Invoice__c';
  const lineage = supplier ? 'Original_Supplier_Invoice__c' : 'Original_Invoice__c';
  const parent = supplier ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
  const common = supplier
    ? { Supplier__c: partyId, Invoice_File__c: 'issued' }
    : { STEM__r: { Account__c: partyId }, File__c: 'issued', Deprecated__c: false };
  const original = { ...common, Id: originalId, STEM__c: stemId, Proforma__c: false };
  const credit = { ...common, Id: creditId, STEM__c: stemId, Proforma__c: false, [lineage]: originalId };
  const lookup = { Id: creditId, [lineage]: originalId };
  const originalLine = { Id: originalLineId, [parent]: originalId, Source_Record_Id__c: sourceId };
  const creditLine = { Id: creditLineId, [parent]: creditId, Source_Record_Id__c: sourceId, Original_Line__c: originalLineId };
  const evidence = [result([credit, original]), result([creditLine, originalLine])];
  const calls = [];
  const load = (object = sourceObject, selectedId = creditId) => loadCreditAllocationSalesforceSource(object, selectedId, {
    query: async soql => {
      calls.push(soql);
      return result([lookup]);
    },
    composite: async queries => {
      calls.push(queries.map(query => query.soql));
      return evidence;
    },
  });
  return { load, calls, credit, original, lookup, lineage, parent, creditLine, originalLine, evidence };
}

for (const supplier of [false, true]) {
  test(`loads only the selected ${supplier ? 'supplier' : 'buyer'} document pair and immutable lines`, async () => {
    const f = fixture(supplier);
    const actual = await f.load(undefined, creditId.slice(0, 15));
    assert.deepEqual(actual, { credit: f.credit, original: f.original, documentLines: [f.creditLine, f.originalLine] });
    assert.equal(f.calls.length, 2);
    assert.match(f.calls[0], new RegExp(`SELECT Id, ${f.lineage} FROM `));
    assert.ok(f.calls[1][0].includes(`WHERE Id IN ('${creditId}', '${originalId}')`));
    assert.ok(f.calls[1][1].includes(`WHERE ${f.parent} IN ('${creditId}', '${originalId}')`));
    assert.match(f.calls[1][1], /ORDER BY Id$/);
  });
}

test('rejects untrusted selection and invalid original lineage before the composite', async () => {
  const f = fixture();
  await assert.rejects(f.load('Account'), { status: 400 });
  await assert.rejects(f.load(undefined, "abc' OR Id != null"), { status: 400 });
  assert.equal(f.calls.length, 0);
  f.lookup[f.lineage] = creditId;
  await assert.rejects(f.load(), /distinct exact original/);
  assert.equal(f.calls.length, 1);
});

for (const [name, mutate, expected] of [
  ['changed original', f => { f.credit[f.lineage] = otherId; }, /exact issued/],
  ['cross-party supplier', f => { f.credit.Supplier__c = otherId; }, /exact issued/],
  ['missing document', f => { f.evidence[0] = result([f.credit]); }, /exact issued/],
  ['partial lines', f => { f.evidence[1].totalSize++; }, /incomplete credit/],
  ['duplicate line', f => { f.creditLine.Id = originalLineId; }, /duplicate or out-of-scope/],
  ['cross-parent line', f => { f.creditLine.Buyer_Invoice__c = creditId; }, /duplicate or out-of-scope/],
  ['foreign line', f => { f.creditLine.Supplier_Invoice__c = otherId; }, /duplicate or out-of-scope/],
  ['foreign lineage', f => { f.creditLine.Original_Line__c = otherId; }, /exact immutable original line/],
  ['missing credit lines', f => { f.evidence[1] = result([f.originalLine]); }, /exact immutable original line/],
]) {
  test(`rejects ${name}`, async () => {
    const f = fixture(true);
    mutate(f);
    await assert.rejects(f.load(), expected);
  });
}

test('native mapping fingerprints detect source product drift and preserve archived rounding linkage', async () => {
  const f = fixture();
  Object.assign(f.original, { Name: 'INV', Document_Currency__c: 'HKD', Amount__c: 1, LastModifiedDate: '2026-09-01T00:00:00Z', Original_Invoice__c: null });
  Object.assign(f.credit, { Name: 'CR', Document_Currency__c: 'HKD', Amount__c: -1, LastModifiedDate: '2026-09-02T00:00:00Z',
    Original_Invoice__r: { Id: originalId, Document_Currency__c: 'HKD' } });
  const source = await f.load();
  const product = { Id: sourceId, STEM__c: stemId, Product__c: otherId, Product__r: { Name: 'Fuel' } };
  const adjustment = { currency: 'HKD', adjustmentCents: 1, documentCents: 781, roundedLineCents: 780, policy: { revision: 1 } };
  // Expected hashes were generated with the archived writer, independently of the verifier.
  const originalMapping = {
    id: 'original-mapping', salesforce_object: 'Invoice__c', salesforce_id: originalId, xero_document_type: 'ACCREC', protected_legacy: false,
    source_fingerprint: 'd43804ceb5e07d792ca15af148eef2c0bbdc70cf1863fabb40da347491afa074', currency_evidence: { roundingAdjustment: adjustment },
  };
  const creditMapping = {
    salesforce_object: 'Invoice__c', salesforce_id: creditId, xero_document_type: 'ACCRECCREDIT', protected_legacy: false,
    source_fingerprint: '8462d972f8df7226ca616098792cab4c1f94ae64c2829d89e5f1d2dffe374484',
    currency_evidence: { roundingAdjustment: { ...adjustment, reversal: true,
      originalMappingId: originalMapping.id, originalSourceFingerprint: originalMapping.source_fingerprint } },
  };
  const readProducts = async queries => {
    assert.ok(queries.every(query => query.soql.endsWith(`WHERE Id IN ('${sourceId}')`)));
    return [result([product]), result([])];
  };
  const mappings = [originalMapping, creditMapping];
  const verified = await verifyCreditAllocationSourceMappings('Invoice__c', source, mappings, readProducts);
  assert.equal(verified.sourceCredit.sourceFingerprint, creditMapping.source_fingerprint);
  assert.equal(verified.sourceOriginal.sourceFingerprint, originalMapping.source_fingerprint);
  creditMapping.currency_evidence.roundingAdjustment.originalMappingId = 'another-invoice';
  await assert.rejects(verifyCreditAllocationSourceMappings('Invoice__c', source, mappings, readProducts), /exact original mapping/);
  creditMapping.currency_evidence.roundingAdjustment.originalMappingId = originalMapping.id;
  product.Product__r.Name = 'changed';
  await assert.rejects(verifyCreditAllocationSourceMappings('Invoice__c', source, mappings, readProducts), /saved document mapping/);
  product.STEM__c = otherId;
  await assert.rejects(verifyCreditAllocationSourceMappings('Invoice__c', source, mappings, readProducts), /does not belong/);
});

function documentContextFixture(adjustment = null) {
  const f = fixture();
  const tenantId = '10000000-0000-4000-8000-000000000001';
  const contactId = '10000000-0000-4000-8000-000000000002';
  const product = { Id: sourceId, STEM__c: stemId, Product__c: otherId, Product__r: { Name: 'Fuel' } };
  for (const [index, doc] of [f.credit, f.original].entries()) {
    Object.assign(doc, { Name: index === 0 ? 'CR' : 'INV', Document_Currency__c: 'HKD',
      Amount__c: index === 0 ? -1 : 1, Document_HKD_Amount__c: index === 0 ? -7.8 : 7.8, Invoice_Date__c: '2026-09-02', LastModifiedDate: '2026-09-02T00:00:00Z' });
  }
  Object.assign(f.creditLine, { Native_Amount__c: -7.8, Currency__c: 'HKD' });
  Object.assign(f.originalLine, { Native_Amount__c: 7.8, Currency__c: 'HKD' });
  const mappings = [f.credit, f.original].map((doc, index) => ({
    id: `10000000-0000-4000-8000-00000000000${index + 3}`, salesforce_id: doc.Id, salesforce_object: 'Invoice__c',
    xero_document_id: `10000000-0000-4000-8000-00000000000${index + 5}`, xero_contact_id: contactId,
    xero_document_number: doc.Name, xero_document_type: index === 0 ? 'ACCRECCREDIT' : 'ACCREC',
    protected_legacy: false, xero_currency_rate: 7.8,
    currency_evidence: { originalLines: [{ sourceId, currency: 'HKD',
      snapshotId: index === 0 ? creditLineId : originalLineId, nativeAmount: index === 0 ? -7.8 : 7.8,
      accountingQuantity: 2, accountingUnitAmount: 3.9, accountCode: '41100', taxType: 'NONE' }] },
    source_fingerprint: nativeDocumentSourceFingerprint(doc, f.evidence[1].records.filter(row => row.Buyer_Invoice__c === doc.Id), new Map([[sourceId, product]])),
  }));
  const documents = mappings.map(mapping => ({
    Type: mapping.xero_document_type, Contact: { ContactID: contactId }, CurrencyCode: 'HKD', CurrencyRate: 7.8,
    Date: '2026-09-02', Status: 'AUTHORISED', LineAmountTypes: 'NoTax', TotalTax: 0, SubTotal: 7.8, Total: 7.8,
    LineItems: [{ Quantity: 2, UnitAmount: 3.9, LineAmount: 7.8, AccountCode: '41100', TaxType: 'NONE', TaxAmount: 0 }],
  }));
  Object.assign(documents[0], { CreditNoteID: mappings[0].xero_document_id, CreditNoteNumber: 'CR' });
  Object.assign(documents[1], { InvoiceID: mappings[1].xero_document_id, InvoiceNumber: 'INV' });
  if (adjustment) {
    const originalMapping = mappings[1];
    originalMapping.currency_evidence.roundingAdjustment = adjustment;
    originalMapping.source_fingerprint = nativeDocumentSourceFingerprint(f.original, [f.originalLine],
      new Map([[sourceId, product]]), adjustment);
    const creditMapping = mappings[0];
    const reversal = { ...adjustment, reversal: true, originalMappingId: originalMapping.id,
      originalSourceFingerprint: originalMapping.source_fingerprint };
    creditMapping.currency_evidence.roundingAdjustment = reversal;
    creditMapping.source_fingerprint = nativeDocumentSourceFingerprint(f.credit, [f.creditLine],
      new Map([[sourceId, product]]), reversal);
    for (const doc of documents) {
      const amount = adjustment.adjustmentCents / 100;
      doc.Total = doc.SubTotal = 7.79;
      doc.LineItems.unshift({ Quantity: 1, UnitAmount: amount, LineAmount: amount,
        AccountCode: adjustment.policy.account_code, TaxType: adjustment.policy.tax_type });
    }
  }
  const mappingResult = { data: mappings, count: 2 };
  const calls = [];
  const connection = { tenantId };
  const requestGate = {};
  const options = {
    env: { XERO_TENANT_ID: tenantId },
    connection, requestGate,
    query: async () => result([f.lookup]),
    composite: async queries => queries[0].soql.includes('FROM Invoice__c') ? f.evidence : [result([product]), result([])],
    client: { from(table) {
      assert.equal(table, 'xero_financial_document_mappings');
      return {
        select(fields, options) { assert.equal(fields, '*'); assert.deepEqual(options, { count: 'exact' }); return this; },
        eq(field, value) { assert.equal(field, 'salesforce_object'); assert.equal(value, 'Invoice__c'); return this; },
        in(field, values) { assert.equal(field, 'salesforce_id'); assert.deepEqual(values, [creditId, originalId]); return mappingResult; },
      };
    } },
    accountingFetch: async (observedConnection, path, observedOptions) => {
      assert.equal(observedConnection, connection);
      assert.equal(observedOptions.method, 'GET');
      assert.equal(observedOptions.requestGate, requestGate);
      calls.push(path);
      const credit = path.startsWith('/CreditNotes/');
      const mapping = mappings[credit ? 0 : 1];
      assert.equal(path, `/${credit ? 'CreditNotes' : 'Invoices'}/${mapping.xero_document_id}?unitdp=4`);
      if (options.reserveHit) observedOptions.onResponse({ headers: new Headers({ 'x-daylimit-remaining': '200' }) });
      return credit ? { CreditNotes: [documents[0]] } : { Invoices: [documents[1]] };
    },
  };
  return { documents, mappingResult, options, calls, load: () => loadCreditAllocationDocumentContext('Invoice__c', creditId, options) };
}

test('readback scopes stored mappings and performs exactly two protected Xero GETs', async () => {
  const f = documentContextFixture();
  const result = await f.load();
  assert.equal(result.xeroCredit, f.documents[0]);
  assert.equal(result.xeroInvoice, f.documents[1]);
  assert.equal(f.calls.length, 2);
});

test('stale Xero identity or exhausted reserve stops document readback immediately', async () => {
  for (const mutate of [
    f => { f.documents[0].CurrencyRate = 7.9; },
    f => { f.documents[0].Date = '2026-09-01'; },
    f => { f.documents[0].Contact.ContactID = 'foreign'; },
    f => { f.options.reserveHit = true; },
  ]) {
    const f = documentContextFixture();
    mutate(f);
    await assert.rejects(f.load(), /exact saved native mapping|daily allowance reserve/);
    assert.equal(f.calls.length, 1);
  }
});

test('incomplete mapping results and a foreign tenant stop before Xero readback', async () => {
  for (const mutate of [
    f => { f.mappingResult.count = 3; },
    f => { f.options.env.XERO_TENANT_ID = 'foreign'; },
  ]) {
    const f = documentContextFixture();
    mutate(f);
    await assert.rejects(f.load(), /exact Finance document mappings|exact Xero tenant/);
    assert.equal(f.calls.length, 0);
  }
});

test('holds changed Xero accounting even when the original credit total is unchanged', async () => {
  for (const mutate of [
    (doc) => { doc.LineItems[0].AccountCode = '50000'; },
    (doc) => { Object.assign(doc.LineItems[0], { Quantity: 1, UnitAmount: 7.8 }); },
    (doc) => { doc.LineItems[0].DiscountRate = '0.001'; },
    (doc) => { doc.LineItems[0].TaxAmount = '0.001'; },
    (doc) => { doc.LineItems[0].LineAmount = 7.79; },
    (doc) => { doc.LineItems = []; },
    (doc) => { doc.LineItems.push({ ...doc.LineItems[0] }); },
  ]) {
    const f = documentContextFixture();
    mutate(f.documents[0]);
    await assert.rejects(f.load(), /accounting line/);
    assert.equal(f.calls.length, 1);
  }
});

test('rejects a saved accounting line that no longer identifies its source snapshot', async () => {
  const f = documentContextFixture();
  f.mappingResult.data[0].currency_evidence.originalLines[0].snapshotId = originalLineId;
  await assert.rejects(f.load(), /exact immutable Salesforce snapshots/);
});

test('accepts the exact linked negative rounding line in either position and holds a changed rounding account', async () => {
  const f = documentContextFixture({ currency: 'HKD', adjustmentCents: -1, documentCents: 779,
    roundedLineCents: 780, policy: { account_code: '7999', tax_type: 'NONE' } });
  f.documents[0].LineItems.reverse();
  await f.load();
  f.documents[1].LineItems[0].AccountCode = '41100';
  await assert.rejects(f.load(), /accounting lines do not match/);
});


test('resolves an exact Salesforce credit number and rejects duplicates and query injection', async () => {
  const matches = [{ Id: creditId, Name: 'CN-0100' }];
  const query = async soql => {
    assert.match(soql, /FROM Supplier_Invoice__c WHERE Name = 'CN-0100' AND Original_Supplier_Invoice__c != null LIMIT 2/);
    return result(matches);
  };
  assert.equal(await resolveCreditAllocationSourceId('Supplier_Invoice__c', 'CN-0100', query), creditId);
  matches.push({ Id: otherId, Name: 'CN-0100' });
  await assert.rejects(resolveCreditAllocationSourceId('Supplier_Invoice__c', 'CN-0100', query), /exactly one/);
  await assert.rejects(resolveCreditAllocationSourceId('Supplier_Invoice__c', "CN' OR Id != null", query), { status: 400 });
});

test('credit settlement reconstructs the original one-line invoice from retained detailed evidence', async () => {
  const f = documentContextFixture();
  const mapping = f.mappingResult.data[1];
  mapping.currency_evidence.presentationPolicy = 'sales_invoice_summary_v1';
  const [originalLine] = f.documents[1].LineItems;
  f.documents[1].LineItems = [{ ...originalLine, Description: 'INVOICE 2/9/2026', Quantity: 1, UnitAmount: 7.8 }];
  const context = await f.load();
  assert.equal(context.xeroInvoice.LineItems[0].Description, 'INVOICE 2/9/2026');
  assert.equal(f.calls.length, 2);
  f.documents[1].LineItems[0].Description = 'INVOICE 3/9/2026';
  await assert.rejects(f.load(), /accounting lines do not match/);
  f.documents[1].LineItems[0].Description = 'INVOICE 2/9/2026';
  mapping.currency_evidence.originalLines[0].accountingUnitAmount = 3.89;
  await assert.rejects(f.load(), /full invoice total/);
});
