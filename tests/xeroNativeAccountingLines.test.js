import assert from 'node:assert/strict';
import test from 'node:test';
import { readNativeFinancialDocumentReview, xeroFinancialSyncPreview } from '../api/_xeroFinancialSync.js';
import { loadNativeAccountingSource, resolveNativeDocumentId } from '../api/_xeroNativeDocumentSource.js';
import { buildNativeAccountingLines } from '../api/_xeroNativeAccountingLines.js';

const id = suffix => `a0000000000000${suffix}AAA`;
const tenantId = '10000000-0000-4000-8000-000000000001';
const roundingPolicy = { enabled: true, tenant_id: tenantId, currency: 'HKD', revision: 2,
  account_id: '10000000-0000-4000-8000-000000000002', account_code: '7999', tax_type: 'NONE', max_native_cents: 1 };

function fixture() {
  const record = { Id: id(1), STEM__c: id(2), Proforma__c: false, Deprecated__c: false, File__c: 'issued',
    Document_FX_Side__c: 'Sell', Document_FX_Fingerprint__c: 'snapshot', Document_FX_Confirmed_At__c: '2026-09-10T00:00:00Z',
    Amount__c: 1.01, Document_Currency__c: 'HKD', Document_HKD_Amount__c: 2.01, Document_FX_Rate__c: 2, Document_FX_Revision__c: 'rate' };
  const snapshots = [3, 4].map(index => ({
    Id: id(index), Buyer_Invoice__c: record.Id, Source_Record_Id__c: id(5), Pricing_Mode__c: 'Unit',
    Quantity__c: 1, Native_Unit_Price__c: 1.005, Native_Amount__c: 1.005, Accounting_USD__c: 0.5025,
    Currency__c: 'HKD', FX_Rate__c: 2, FX_Revision__c: 'rate', Description__c: 'Fuel', Unit__c: 'MT',
  }));
  const sourceRows = new Map([[id(5), { Id: id(5), STEM__c: record.STEM__c, Product__c: id(6) }]]);
  const productMappings = new Map([[`buyer:${id(6)}`, { xero_account_code: '41100', xero_tax_type: 'NONE' }]]);
  return { record, direction: 'buyer', snapshots, sourceRows, productMappings, tenantId, roundingPolicy };
}

test('exact native line rounding retains the issued HKD total and original USD basis', () => {
  const f = fixture();
  const result = buildNativeAccountingLines(f);
  assert.equal(result.signedTotal, 2.01);
  assert.equal(result.roundingAdjustment.adjustmentCents, -1);
  assert.equal(result.lines[0].originalPriceEvidence.exactNativeAmount, '1.00500000000000');
  assert.deepEqual(result.lines.map(line => [line.quantity, line.unitAmount, line.accountCode]), [[1, 1.005, '41100'], [1, 1.005, '41100'], [1, -0.01, '7999']]);
  assert.throws(() => buildNativeAccountingLines({ ...f, roundingPolicy: null }), /Finance-approved rounding/);
  assert.throws(() => buildNativeAccountingLines({ ...f, roundingPolicy: { ...roundingPolicy, tenant_id: 'foreign' } }), /Finance-approved rounding/);
});

test('credit carries forward the exact reviewed original rounding evidence', () => {
  const f = fixture();
  const original = buildNativeAccountingLines(f);
  const originalMapping = { id: 'mapping', salesforce_id: f.record.Id, salesforce_object: 'Invoice__c',
    source_fingerprint: 'a'.repeat(64), currency_evidence: { roundingAdjustment: original.roundingAdjustment } };
  const credit = { ...f.record, Id: id(7), Original_Invoice__c: f.record.Id, Amount__c: -1.01, Document_HKD_Amount__c: -2.01 };
  const creditLines = f.snapshots.map((line, index) => ({
    ...line, Id: id(8 + index), Buyer_Invoice__c: credit.Id, Original_Line__c: line.Id,
    Original_Line__r: { Id: line.Id, Buyer_Invoice__c: f.record.Id, Source_Record_Id__c: line.Source_Record_Id__c },
    Native_Unit_Price__c: -1.005, Native_Amount__c: -1.005, Accounting_USD__c: -0.5025,
  }));
  const input = { ...f, record: credit, snapshots: creditLines, originalMapping, roundingPolicy: null };
  const result = buildNativeAccountingLines(input);
  assert.equal(result.signedTotal, -2.01);
  assert.equal(result.roundingAdjustment.originalSourceFingerprint, originalMapping.source_fingerprint);
  assert.equal(result.roundingAdjustment.reversal, true);
  assert.deepEqual(result.lines.map(line => line.unitAmount), [1.005, 1.005, -0.01]);
  assert.throws(() => buildNativeAccountingLines({ ...input, originalMapping: { ...originalMapping, salesforce_id: id(2) } }), /different Salesforce document/);
  creditLines[0].Original_Line__r.Buyer_Invoice__c = id(2);
  assert.throws(() => buildNativeAccountingLines(input), /exact original source/);
});

test('managed USD holds foreign rate evidence and any line assigned to the opposite invoice', () => {
  const f = fixture();
  Object.assign(f.record, { Document_Currency__c: 'USD', Document_HKD_Amount__c: null,
    Document_FX_Rate__c: null, Document_FX_Revision__c: null, Amount__c: 2 });
  f.snapshots.forEach(line => Object.assign(line, { Currency__c: 'USD', FX_Rate__c: null,
    FX_Revision__c: null, Native_Unit_Price__c: 1, Native_Amount__c: 1, Accounting_USD__c: 1 }));
  assert.equal(buildNativeAccountingLines(f).roundingAdjustment, null);
  f.snapshots[0].Supplier_Invoice__c = id(7);
  assert.throws(() => buildNativeAccountingLines(f), /conflicting identity/);
  f.snapshots[0].Supplier_Invoice__c = null;
  f.record.Document_FX_Rate__c = 2;
  assert.throws(() => buildNativeAccountingLines(f), /complete immutable native currency/);
});

test('reads one exact issued native document and its line products in two scoped Salesforce batches', async () => {
  const f = fixture();
  const results = records => ({ records, totalSize: records.length });
  const calls = [];
  const composite = async queries => {
    calls.push(queries);
    if (calls.length === 1) {
      assert.match(queries[0].soql, /FROM Invoice__c WHERE Id IN /);
      assert.ok(queries[0].soql.endsWith(`('${f.record.Id}')`));
      assert.match(queries[1].soql, /FROM Trade_Document_Line__c WHERE Buyer_Invoice__c IN /);
      return [results([f.record]), results(f.snapshots)];
    }
    assert.equal(queries.length, 2);
    assert.ok(queries.every(query => query.soql.endsWith(`WHERE Id IN ('${id(5)}')`)));
    return [results([...f.sourceRows.values()]), results([])];
  };
  const read = () => loadNativeAccountingSource('Invoice__c', f.record.Id, { ...f, composite });
  const source = await read();
  assert.equal(calls.length, 2);
  assert.equal(source.record.Id, f.record.Id);
  assert.deepEqual(source.lines, buildNativeAccountingLines(f).lines);
  assert.match(source.sourceFingerprint, /^[a-f0-9]{64}$/);
  calls.length = 0;
  f.sourceRows.get(id(5)).Product__r = { Name: 'Changed product name' };
  assert.notEqual((await read()).sourceFingerprint, source.sourceFingerprint);
  assert.equal(calls.length, 2);
});

test('holds incomplete source results before any line-product queries', async () => {
  const f = fixture();
  let calls = 0;
  const composite = async () => {
    calls++;
    return [{ records: [f.record], totalSize: 1 }, { records: [f.snapshots[0]], totalSize: 2, done: false }];
  };
  await assert.rejects(loadNativeAccountingSource('Invoice__c', f.record.Id, { ...f, composite }), /incomplete .* evidence/);
  assert.equal(calls, 1);
  await assert.rejects(loadNativeAccountingSource('Account', f.record.Id, { ...f, composite }), { status: 400 });
  assert.equal(calls, 1);
});

test('Finance preview builds one native document without opening the broad workflow or posting', async () => {
  const f = fixture();
  Object.assign(f.record, { Name: 'HK-INV-1', Invoice_Date__c: '2026-09-10', Invoice_Due_Date__c: '2026-09-20',
    STEM__r: { Account__c: '001000000000001AAA', Account__r: { Name: 'Buyer', Inactive_Suspended__c: false } } });
  const selection = { sourceObject: 'Invoice__c', documentId: f.record.Id, tenantId };
  const calls = [];
  const result = records => ({ records, totalSize: records.length });
  const deps = {
    accessContext: { profile: { id: '10000000-0000-4000-8000-000000000003' } },
    env: { XERO_TENANT_ID: tenantId },
    client: {},
    getConnection: async () => ({ tenantId, scope: 'accounting.settings.read accounting.contacts.read accounting.invoices.read' }),
    querySalesforce: async queries => {
      calls.push('salesforce');
      return queries[0].soql.includes('FROM Invoice__c')
        ? [result([f.record]), result(f.snapshots)] : [result([...f.sourceRows.values()]), result([])];
    },
    loadNativeControls: async (_client, tenant, input) => {
      calls.push('controls');
      assert.equal(tenant, tenantId);
      assert.equal(input.record.Id, f.record.Id);
      assert.deepEqual([...input.sourceRows.keys()], [id(5)]);
      return { productMappings: f.productMappings, roundingPolicy };
    },
    accountingFetch: async (_connection, path, options) => {
      const resource = path.split('?')[0];
      calls.push(resource);
      assert.equal(options.method, 'GET');
      if (resource === '/Organisations') return { Organisations: [{ OrganisationID: tenantId, BaseCurrency: 'USD' }] };
      if (resource === '/Contacts') return { Contacts: [{ ContactID: tenantId, Name: 'Buyer', ContactStatus: 'ACTIVE' }] };
      assert.equal(resource, '/Invoices');
      return { Invoices: [] };
    },
    loadNativeAccounts: async () => {
      calls.push('accounts');
      return [{ id: '001000000000001AAA', name: 'Buyer', companyCode: '', inactiveSuspended: false }];
    },
    loadNativeTargetMappings: () => assert.fail('empty target search needs no target ownership lookup'),
    loadSalesforce: () => assert.fail('must not scan financial inventory'),
  };
  const { nativeDocument: preview } = await xeroFinancialSyncPreview({ nativeDocument: selection }, deps);
  assert.deepEqual(calls, ['salesforce', 'salesforce', 'controls', '/Organisations', '/Contacts', 'accounts', '/Invoices']);
  assert.equal(preview.status, 'source_reviewed');
  assert.equal(preview.signedTotal, 2.01);
  assert.equal(preview.accountingUsd, 1.01);
  assert.equal(preview.xeroCurrencyRate, 2);
  assert.equal(preview.roundingAdjustmentCents, -1);
  assert.equal(preview.draftPreview.status, 'held');
  assert.match(preview.draftPreview.message, /different accounts/);
  assert.equal(preview.lines[2].unitAmount, -0.01);
  assert.equal(preview.proposedPayload, undefined);
  assert.equal(preview.lines[0].originalPriceEvidence, undefined);

  await assert.rejects(xeroFinancialSyncPreview({ nativeDocument: selection }, { ...deps, env: { VERCEL_ENV: 'preview' } }),
    { code: 'FCOS_DEPLOYMENT_READ_ONLY' });
  await assert.rejects(xeroFinancialSyncPreview({ nativeDocument: { ...selection, tenantId: 'foreign' } }, deps),
    { code: 'XERO_NATIVE_DOCUMENT_SCOPE_INVALID' });
  assert.equal(preview.xeroReview.status, 'no_exact_number_match');
  assert.equal(calls.length, 7);

  Object.assign(f.record, { Amount__c: 1, Document_HKD_Amount__c: 2 });
  f.snapshots.forEach(line => Object.assign(line, { Native_Unit_Price__c: 1, Native_Amount__c: 1, Accounting_USD__c: 0.5 }));
  const connection = await deps.getConnection();
  const { nativeDocument, privateReview } = await readNativeFinancialDocumentReview(selection, {
    ...deps, connection, getConnection: () => assert.fail('must reuse the verified Xero connection'),
  });
  assert.equal(privateReview.sourceId, f.record.Id);
  assert.equal(privateReview.nativeTotal, 2);
  assert.equal(privateReview.accountingUsd, 1);
  assert.equal(privateReview.draft.payload.Status, 'DRAFT');
  assert.equal(privateReview.draft.reviewFingerprint, nativeDocument.draftPreview.reviewFingerprint);
  assert.deepEqual(await xeroFinancialSyncPreview({ nativeDocument: selection }, deps), { nativeDocument });
});


test('resolves an exact native Salesforce number and rejects duplicates before source review', async () => {
  const number = 'BILL-0100';
  const matches = [{ Id: id(1), Name: number }];
  const query = async soql => {
    assert.match(soql, /FROM Supplier_Invoice__c WHERE Name = 'BILL-0100' AND Document_FX_Fingerprint__c != null LIMIT 2/);
    return { records: matches, totalSize: matches.length };
  };
  assert.equal(await resolveNativeDocumentId('Supplier_Invoice__c', number, { query }), id(1));
  matches.push({ Id: id(2), Name: number });
  await assert.rejects(resolveNativeDocumentId('Supplier_Invoice__c', number, { query }), /exactly one Salesforce document/);
});

test('Finance preview holds a Salesforce number changed between lookup and exact read', async () => {
  const f = fixture();
  const resolved = [];
  const selected = { tenantId, sourceObject: 'Invoice__c', documentNumber: 'INV-0100' };
  const deps = {
    accessContext: { profile: { id: '10000000-0000-4000-8000-000000000003' } }, client: {},
    getConnection: async () => ({ tenantId, scope: 'accounting.settings.read accounting.contacts.read accounting.invoices.read' }),
    resolveNativeId: async (object, number) => {
      resolved.push([object, number]);
      return f.record.Id;
    },
    loadNativeSource: async (_object, documentId) => {
      assert.equal(documentId, f.record.Id);
      return { record: { ...f.record, Name: 'INV-OTHER' }, ...buildNativeAccountingLines(f) };
    },
    accountingFetch: () => assert.fail('stale selection must not reach Xero'),
  };
  await assert.rejects(xeroFinancialSyncPreview({ nativeDocument: selected }, deps), { code: 'XERO_NATIVE_DOCUMENT_SCOPE_CHANGED' });
  assert.deepEqual(resolved, [['Invoice__c', 'INV-0100']]);
});
