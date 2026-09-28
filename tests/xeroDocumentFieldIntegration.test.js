import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinancialClassifications, buildXeroAccountingPayload, loadSalesforceFinancialSnapshot, normalizeXeroInvoice,
  toSyncItemRow } from '../api/_xeroFinancialSync.js';
import { documentConfirmationErrors, matchDocumentResponses } from '../api/_xeroDocumentSafety.js';
import { projectAccountingPayload } from '../api/_xeroDocumentFieldPolicy.js';
import { documentCorrectionHash as hash } from '../api/_xeroDocumentCorrectionPersistence.js';
import { issuedPetroleumV2Fixture } from './xeroIssuedPetroleumV2Fixtures.js';

const POLICY = 'document_field_correction_v1';
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const copy = (value) => structuredClone(value);

function fixture() {
  const stem = { Name: 'HK2625070T - VESSEL ONE', KeyStem__c: 'HK2625070T', Delivery_Date__c: '2025-12-01',
    RefCode__c: 'HK2625070T', Vessel__c: 'a0V000000000001', Vessel__r: { Name: 'VESSEL ONE' },
    Account__c: '001000000000001', Account__r: { Name: 'Buyer' } };
  const buyer = { Id: 'a01000000000001', Name: '25070T-INV-1', STEM__c: 'a0H000000000001', STEM__r: copy(stem),
    Amount__c: 120, CurrencyIsoCode: 'USD', Invoice_Date__c: '2026-01-28', Delivery_Date__c: '2026-01-27',
    Invoice_Due_Date__c: '2026-02-25', Proforma__c: false, Deprecated__c: false, File__c: '069000000000001' };
  const supplier = { Id: 'a06000000000001', Name: 'ORIGINAL-SUPPLIER-001', STEM__c: buyer.STEM__c, STEM__r: copy(stem),
    Supplier__c: '001000000000002', Supplier__r: { Name: 'Supplier' }, Invoice_Amount__c: 90, CurrencyIsoCode: 'USD',
    Invoice_Date__c: '2026-01-29', Invoice_Due_Date__c: '2026-02-28', Invoice_File__c: 'issued.pdf' };
  const line = { Id: 'a05000000000001', Name: 'Fuel', Buyer_Invoice__c: buyer.Id, Supplier_Invoice__c: supplier.Id,
    STEM__c: buyer.STEM__c, Product__c: '01t000000000001', Product__r: { Name: 'Fuel' }, CurrencyIsoCode: 'USD',
    Quantity__c: 2, Price_Per_Unit__c: 50, Cost_Per_Unit__c: 40, Total_Price__c: 100, Total_Cost__c: 80, Cancelled__c: false };
  const extra = { Id: 'a04000000000001', Name: 'Service', Buyer_Invoice__c: buyer.Id, Supplier_Invoice__c: supplier.Id,
    STEM__c: buyer.STEM__c, Product2Id__c: '01t000000000002', Product2Id__r: { Name: 'Service' }, CurrencyIsoCode: 'USD',
    Quantity__c: 1, Unit_Price__c: 20, Unit_Cost__c: 10, Line_Total__c: 20, Line_Total_Buy__c: 10, Cancelled__c: false };
  const accounts = [{ Id: '001000000000001', Name: 'Buyer', Inactive_Suspended__c: false }, { Id: '001000000000002', Name: 'Supplier', Inactive_Suspended__c: false }];
  const salesforce = { documentFieldPolicyVersion: POLICY, cutoffDate: '2026-01-01', buyers: [buyer], suppliers: [supplier], lines: [line], extras: [extra],
    safetyContext: { fields: { Invoice__c: ['Delivery_Date__c', 'CurrencyIsoCode'], Supplier_Invoice__c: ['Invoice_File__c', 'CurrencyIsoCode'] } } };
  const xero = { contacts: [{ id: uuid(1), name: 'Buyer', status: 'ACTIVE' }, { id: uuid(2), name: 'Supplier', status: 'ACTIVE' }],
    documents: [], inactiveDocuments: [], organisation: { baseCurrency: 'USD', periodLockDate: null, endOfYearLockDate: null } };
  const stored = { documentMappings: [], productMappings: ['buyer', 'supplier'].flatMap((direction) => [line.Product__c, extra.Product2Id__c]
    .map((salesforce_product_id) => ({ direction, salesforce_product_id, xero_account_code: direction === 'buyer' ? '200' : '300', xero_tax_type: 'NONE' }))) };
  const build = (options) => buildFinancialClassifications(salesforce, xero, stored, options);
  return { buyer, supplier, line, extra, accounts, salesforce, xero, stored, build };
}

test('complete source loader includes prior-year linked invoices and children without issue/created-date filters', async () => {
  const f = fixture(); f.buyer.Invoice_Date__c = '2025-12-31'; f.supplier.Invoice_Date__c = '2025-12-01';
  let requests;
  const batches = [[], f.salesforce.buyers, f.salesforce.suppliers, f.salesforce.lines, f.salesforce.extras, f.accounts];
  const snapshot = await loadSalesforceFinancialSnapshot('2026-01-01', async (queries) => {
    requests = queries; return batches.map((records) => ({ records: copy(records), totalSize: records.length }));
  }, f.salesforce.safetyContext);
  assert.equal(snapshot.documentFieldPolicyVersion, POLICY); assert.equal(snapshot.buyers[0].Invoice_Date__c, '2025-12-31');
  assert.equal(snapshot.suppliers[0].Invoice_Date__c, '2025-12-01'); assert.equal(snapshot.lines[0].Buyer_Invoice__c, f.buyer.Id);
  assert.equal(snapshot.extras[0].Supplier_Invoice__c, f.supplier.Id);
  for (const request of requests.slice(1, 5)) assert.doesNotMatch(request.soql, /(?:Invoice_Date__c|CreatedDate|Delivery_Date__c)\s*(?:>=|>|=)/);
  assert.match(requests[1].soql, /\bDelivery_Date__c\b/); assert.match(requests[1].soql, /STEM__r\.Vessel__r\.Name/);
  assert.match(requests[2].soql, /STEM__r\.RefCode__c/);
  const result = buildFinancialClassifications(snapshot, f.xero, f.stored);
  assert.equal(result.rows.length, 2); assert.ok(result.rows.every((row) => row.status === 'eligible'));
  assert.ok(result.rows.every((row) => row.proposedPayload.Date === '2026-01-27'));
});

test('source snapshot truncation, missing populations and provider errors fail closed across every required query', async () => {
  const f = fixture();
  const base = [[], f.salesforce.buyers, f.salesforce.suppliers, f.salesforce.lines, f.salesforce.extras, f.accounts]
    .map((records) => ({ records: copy(records), totalSize: records.length }));
  for (let index = 0; index < base.length; index++) {
    for (const mutate of [(result) => { result.totalSize++; }, (result) => { delete result.totalSize; }, (result) => { result.totalSize = 'unknown'; },
      (result) => { result.totalSize = -1; }, (result) => { delete result.records; }, (result) => { result.error = 'Provider read failed'; }]) {
      await assert.rejects(loadSalesforceFinancialSnapshot('2026-01-01', async () => {
        const result = copy(base); mutate(result[index]); return result;
      }, f.salesforce.safetyContext), { code: 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE' });
    }
  }
});

test('future sales and bill creation applies every prescribed field while preserving source accounting and supplier identity', () => {
  const f = fixture(); const result = f.build(); const [sale, bill] = result.rows;
  for (const row of result.rows) { assert.equal(row.action, 'create_draft'); assert.equal(row.status, 'eligible'); assert.deepEqual(row.blockers, []); }
  assert.equal(sale.proposedPayload.Date, f.buyer.Delivery_Date__c); assert.equal(bill.proposedPayload.Date, f.buyer.Delivery_Date__c);
  assert.equal(sale.proposedPayload.DueDate, f.buyer.Invoice_Due_Date__c); assert.equal(bill.proposedPayload.DueDate, f.supplier.Invoice_Due_Date__c);
  assert.equal(sale.proposedPayload.InvoiceNumber, f.buyer.Name); assert.equal(sale.proposedPayload.Reference, 'VESSEL ONE');
  assert.equal(bill.proposedPayload.InvoiceNumber, '25070T- VESSEL ONE'); assert.equal(bill.documentNumber, 'ORIGINAL-SUPPLIER-001');
  assert.equal(bill.proposedPayload.Reference, bill.reference);
  assert.deepEqual(sale.proposedPayload.LineItems.map((line) => line.Description), ['INVOICE 28/1/2026', 'INVOICE 28/1/2026']);
  assert.deepEqual(bill.proposedPayload.LineItems.map((line) => line.Description), ['28/1/2026', '28/1/2026']);
  for (const row of result.rows) {
    const { documentFieldProjection: _projection, ...legacySource } = row;
    const legacy = buildXeroAccountingPayload(legacySource);
    assert.deepEqual(row.proposedPayload.LineItems.map(({ Description: _description, ...financial }) => financial),
      legacy.LineItems.map(({ Description: _description, ...financial }) => financial));
  }
});

test('new STEM observations and policy activation preserve original source and financial fingerprints', () => {
  const f = fixture(); delete f.salesforce.documentFieldPolicyVersion;
  for (const record of [f.buyer, f.supplier]) for (const key of ['RefCode__c', 'Vessel__c', 'Vessel__r']) delete record.STEM__r[key];
  const legacy = f.build().sources;
  for (const record of [f.buyer, f.supplier]) Object.assign(record.STEM__r, { RefCode__c: 'HK2625070T', Vessel__c: 'a0V000000000001', Vessel__r: { Name: 'VESSEL ONE' } });
  f.salesforce.documentFieldPolicyVersion = POLICY;
  const current = f.build().sources;
  for (let index = 0; index < current.length; index++) {
    assert.equal(current[index].sourceFingerprint, legacy[index].sourceFingerprint);
    assert.equal(current[index].financialFingerprint, legacy[index].financialFingerprint);
    assert.equal(legacy[index].documentFieldProjection, undefined);
    assert.equal(current[index].documentFieldProjection.policy, POLICY);
  }
  const previousProjection = current[1].documentFieldProjection.fingerprint;
  f.supplier.STEM__r.Vessel__r.Name = 'VESSEL TWO';
  const changed = f.build().sources[1];
  assert.equal(changed.sourceFingerprint, legacy[1].sourceFingerprint);
  assert.equal(changed.financialFingerprint, legacy[1].financialFingerprint);
  assert.notEqual(changed.documentFieldProjection.fingerprint, previousProjection);
});

test('source projection activation is explicit; older snapshots retain their old draft payload behavior', () => {
  const f = fixture(); delete f.salesforce.documentFieldPolicyVersion;
  const [sale, bill] = f.build().rows;
  assert.equal(sale.documentFieldProjection, undefined); assert.equal(bill.documentFieldProjection, undefined);
  assert.equal(sale.proposedPayload.Date, f.buyer.Invoice_Date__c); assert.equal(bill.proposedPayload.Date, f.supplier.Invoice_Date__c);
  assert.equal(bill.proposedPayload.InvoiceNumber, f.supplier.Name);
  assert.ok(sale.proposedPayload.LineItems.some((line) => line.Description !== 'INVOICE 28/1/2026'));
});

test('mapped supplier responses confirm the submitted derived number, and an original source number cannot substitute for it', () => {
  const f = fixture(); const rows = f.build().rows.map((row, index) => toSyncItemRow(row, uuid(50), index, '2026-09-28T00:00:00Z'));
  const responses = rows.map((row, index) => ({ ...copy(row.proposed_payload), InvoiceID: uuid(60 + index), Total: row.source_total }));
  const correlated = matchDocumentResponses(rows, [...responses].reverse());
  for (let index = 0; index < rows.length; index++) {
    assert.deepEqual(correlated[index].errors, []); assert.equal(correlated[index].response.InvoiceID, responses[index].InvoiceID);
    assert.deepEqual(documentConfirmationErrors(rows[index], responses[index]), []);
  }
  const wrong = { ...responses[1], InvoiceNumber: f.supplier.Name };
  assert.ok(documentConfirmationErrors(rows[1], wrong).length);
  assert.ok(matchDocumentResponses([rows[1]], [wrong])[0].errors.length);
});

test('separate mapped bills may repeat the derived reference without losing their exact stored target identities', () => {
  const f = fixture();
  const second = { ...copy(f.supplier), Id: 'a06000000000002', Name: 'ORIGINAL-SUPPLIER-002' };
  f.salesforce.suppliers.push(second);
  f.salesforce.lines.push({ ...copy(f.line), Id: 'a05000000000002', Buyer_Invoice__c: null, Supplier_Invoice__c: second.Id });
  f.salesforce.extras.push({ ...copy(f.extra), Id: 'a04000000000002', Buyer_Invoice__c: null, Supplier_Invoice__c: second.Id });
  const bills = f.build().rows.filter((row) => row.xeroType === 'ACCPAY');
  for (const [index, source] of bills.entries()) {
    const raw = { ...copy(source.proposedPayload), InvoiceID: uuid(70 + index), Total: source.total, AmountDue: source.total, AmountPaid: 0, AmountCredited: 0 };
    f.xero.documents.push(normalizeXeroInvoice(raw));
    f.stored.documentMappings.push({ id: uuid(80 + index), salesforce_object: source.salesforceObject, salesforce_id: source.salesforceId,
      xero_document_id: raw.InvoiceID, xero_document_type: 'ACCPAY', xero_contact_id: source.contactId });
  }
  const current = f.build().rows.filter((row) => row.xeroType === 'ACCPAY');
  assert.equal(current.length, 2);
  for (const [index, row] of current.entries()) {
    assert.equal(row.action, 'link'); assert.equal(row.status, 'eligible'); assert.equal(row.xero.id, uuid(70 + index));
    assert.equal(row.proposedPayload, null); assert.deepEqual(row.blockers, []);
  }
});

test('pre-cutoff normal documents are preserved by buyer delivery date even when issue dates are current', () => {
  const f = fixture(); f.buyer.Delivery_Date__c = '2025-12-31';
  const result = f.build();
  assert.deepEqual(result.rows, [], 'known legacy deliveries are outside ordinary 2026 review');
  assert.equal(result.sources.length, 2, 'complete historical sources remain available for identity and correction-scope evidence');
  assert.ok(result.sources.every((source) => source.documentFieldProjection.scope === 'legacy'));
});

test('ordinary review keeps unknown delivery holds and pre-issued invoices delivered at the exact cutoff', () => {
  const f = fixture();
  f.buyer.Invoice_Date__c = '2025-12-10'; f.supplier.Invoice_Date__c = '2025-12-11';
  f.buyer.Delivery_Date__c = '2026-01-01';
  assert.equal(f.build().rows.length, 2, 'invoice issue year cannot exclude delivery in 2026');
  f.buyer.Delivery_Date__c = null;
  const rows = f.build().rows;
  assert.equal(rows.length, 2, 'unknown dates cannot be treated as proven legacy');
  assert.ok(rows.every((row) => row.status === 'blocked' && row.proposedPayload === null));
});

test('pre-cutoff sources remain in shared Contact ownership evidence for current rows', () => {
  const f = fixture();
  const old = copy(f.buyer);
  Object.assign(old, { Id: 'a01000000000002', Name: 'OLDER-INVOICE', Delivery_Date__c: '2025-12-31' });
  old.STEM__r.Account__c = '001000000000003';
  old.STEM__r.Account__r = { Name: 'Buyer' };
  f.salesforce.buyers.push(old);
  const result = f.build();
  assert.equal(result.sources.length, 3); assert.equal(result.rows.length, 2);
  const current = result.rows.find((row) => row.salesforceId === f.buyer.Id);
  assert.equal(current.sharedContactAccounts.length, 2);
  assert.ok(current.sharedContactAccounts.some((account) => account.accountId === old.STEM__r.Account__c));
});

test('expanding normal invoice evidence does not bring pre-2026 credits into routine posting', () => {
  const f = fixture();
  Object.assign(f.buyer, { Name: '25070T-CN-1', Amount__c: -120, Invoice_Date__c: '2025-12-31' });
  Object.assign(f.supplier, { Invoice_Amount__c: -90, Invoice_Date__c: '2025-12-31' });
  for (const key of ['Price_Per_Unit__c', 'Cost_Per_Unit__c', 'Total_Price__c', 'Total_Cost__c']) f.line[key] *= -1;
  for (const key of ['Unit_Price__c', 'Unit_Cost__c', 'Line_Total__c', 'Line_Total_Buy__c']) f.extra[key] *= -1;
  assert.equal(f.build().rows.length, 0);
  f.buyer.Invoice_Date__c = f.supplier.Invoice_Date__c = '2026-01-01';
  const rows = f.build().rows; assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.xeroCollection, 'CreditNotes'); assert.equal(row.documentFieldProjection, undefined);
    assert.equal(row.proposedPayload.Date, '2026-01-01'); assert.equal(row.action, 'create_draft');
  }
});

function preservedV2() {
  const f = issuedPetroleumV2Fixture(); const proof = f.build();
  assert.equal(proof.eligible, true, JSON.stringify(proof.blockers));
  const mapping = { id: uuid(101), salesforce_object: f.source.salesforceObject, salesforce_id: f.source.salesforceId,
    xero_document_id: f.candidate.id, xero_document_type: 'ACCPAY', xero_contact_id: f.candidate.contactId,
    source_fingerprint: f.source.sourceFingerprint, financial_fingerprint: f.source.financialFingerprint, protected_legacy: true,
    retained_differences: { accountId: f.source.accountId, issuedSupplierPreservation: { ...proof, reviewedXero: copy(f.candidate) } } };
  f.stored.documentMappings.push(mapping);
  return { ...f, mapping };
}

test('unreleased attachment-preservation v2 remains sticky when new projection evidence is unavailable', () => {
  const f = preservedV2(); f.salesforce.documentFieldPolicyVersion = POLICY; f.supplier.STEM__r.RefCode__c = 'HK2626001T';
  let row = buildFinancialClassifications(f.salesforce, f.xero, f.stored).rows[0];
  assert.equal(row.documentFieldProjection.scope, 'unavailable'); assert.equal(row.acceptedLegacy, true);
  assert.equal(row.status, 'protected'); assert.equal(row.proposedPayload, null);
  f.child.Unit_Buy_At__c += 1;
  row = buildFinancialClassifications(f.salesforce, f.xero, f.stored).rows[0];
  assert.equal(row.sourceFingerprint, f.source.sourceFingerprint, 'legacy hash intentionally excludes the authoritative unit');
  assert.equal(row.status, 'blocked'); assert.notEqual(row.acceptedLegacy, true); assert.equal(row.proposedPayload, null);
});

test('a confirmed field correction cannot hide subsequent authoritative petroleum source drift', () => {
  const f = preservedV2();
  f.salesforce.documentFieldPolicyVersion = POLICY; f.supplier.STEM__r.RefCode__c = 'HK2626001T';
  f.salesforce.buyers.push({ Id: 'a01000000000001', Name: '26001T-INV-1', STEM__c: f.supplier.STEM__c, STEM__r: {},
    Proforma__c: false, Deprecated__c: false, Delivery_Date__c: '2026-03-17', Invoice_Date__c: '2026-04-01', Invoice_Due_Date__c: '2026-04-15', Amount__c: 100, CurrencyIsoCode: 'USD' });
  const source = buildFinancialClassifications(f.salesforce, f.xero, f.stored).sources.find((row) => row.salesforceId === f.supplier.Id);
  assert.deepEqual(source.documentFieldProjection.blockers, []);
  const before = copy(f.raw); const after = projectAccountingPayload(before, source.documentFieldProjection);
  const evidence = { policyVersion: POLICY, before, expectedAfter: after, mappingSnapshot: copy(f.mapping),
    source: { object: source.salesforceObject, id: source.salesforceId, accountId: source.accountId,
      sourceFingerprint: source.sourceFingerprint, financialFingerprint: source.financialFingerprint,
      fieldSourceFingerprint: source.documentFieldSourceFingerprint,
      projectionFingerprint: source.documentFieldProjection.fingerprint } };
  const claim = { id: uuid(102), mapping_id: f.mapping.id, xero_invoice_id: f.candidate.id, evidence, evidence_hash: hash(evidence), created_at: '2026-09-28T00:00:00Z' };
  const eventEvidence = { basis: 'exact_provider_readback', observed: copy(after) };
  f.stored.documentCorrectionClaims = [claim];
  f.stored.documentCorrectionEvents = [{ claim_id: claim.id, sequence: 1, status: 'confirmed', evidence: eventEvidence, evidence_hash: hash(eventEvidence) }];
  f.xero.documents = [normalizeXeroInvoice(after)];
  let row = buildFinancialClassifications(f.salesforce, f.xero, f.stored).rows.find((item) => item.salesforceId === f.supplier.Id);
  assert.equal(row.documentFieldCorrection?.claimId, claim.id); assert.equal(row.status, 'protected');
  f.child.Unit_Buy_At__c += 1;
  row = buildFinancialClassifications(f.salesforce, f.xero, f.stored).rows.find((item) => item.salesforceId === f.supplier.Id);
  assert.equal(row.sourceFingerprint, source.sourceFingerprint);
  assert.equal(row.financialFingerprint, source.financialFingerprint);
  assert.equal(row.documentFieldProjection.fingerprint, source.documentFieldProjection.fingerprint);
  assert.equal(row.status, 'blocked'); assert.equal(row.documentFieldCorrection, undefined); assert.equal(row.proposedPayload, null);
});
