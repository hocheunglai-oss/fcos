import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { buildGroupedPreservationContext, completeGroupedAccountSnapshot } from '../api/_xeroGroupedPreservationAdapter.js';
import { evaluateIssuedSupplierFinancialDocument } from '../api/_xeroIssuedSupplierPreservationAdapter.js';
import { issuedSupplierHash } from '../api/_xeroIssuedSupplierPreservation.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = (text) => issuedSupplierHash(text);

// Exported for the transaction owner to compare the full proof contract.
export function issuedSupplierFixture() {
  const ids = { source: 'a06000000000001', account: '001000000000001', stem: 'a0H000000000001',
    child: 'a04000000000001', product: '01t000000000001', document: '069000000000001', version: '068000000000001', link: '06A000000000001',
    tenant: uuid(1), contact: uuid(2), target: uuid(3), line: uuid(4), mapping: uuid(5) };
  const account = { Id: ids.account, Name: 'FRATELLI COSULICH BUNKERS (S) PTE LTD', Company_Code__c: 'HKFCBS',
    Inactive_Suspended__c: false, RecordType: { DeveloperName: 'Supplier' } };
  const source = { salesforceObject: 'Supplier_Invoice__c', salesforceId: ids.source, accountId: ids.account,
    accountName: account.Name, companyCode: account.Company_Code__c, contactId: ids.contact, contactName: 'FCBS', stemId: ids.stem,
    issuedSupplierVessel: 'SEA STELLAR', stemKey: 'HK2524197T', documentNumber: 'M2601010', documentKind: 'supplier_bill',
    xeroType: 'ACCPAY', xeroCollection: 'Invoices', currency: 'USD', postingMode: 'draft', invoiceDate: '2026-01-05', dueDate: '2026-02-03',
    deliveryDate: '2026-01-05', reference: 'HK2524197T · Salesforce supplier invoice', total: 124.2, signedTotal: 124.2,
    sourceFingerprint: hash('source'), financialFingerprint: hash('financial'), blockers: [],
    readiness: { ready: false, file: null, snapshot: null, linkedChildren: [ids.child], blockers: ['Supplier invoice has no verified issued source file.'] },
    lines: [{ sourceId: ids.child, productId: ids.product, productName: 'TRUSTEE SERVICE', description: 'TRUSTEE SERVICE · 248.394 MT',
      quantity: 248.394, unitAmount: 0.5, accountCode: '51106', taxType: 'NONE' }],
    groupedAccounting: { policy: 'fcos_notax_accounting_v1', total: '124.20', lines: [{ id: ids.child, productId: ids.product,
      currency: 'USD', description: 'TRUSTEE SERVICE · 248.394 MT', quantity: '248.394', unitAmount: '0.50', lineAmount: '124.20',
      accountCode: '51106', taxType: 'NONE', taxAmount: 0, discountRate: 0, discountAmount: 0, tracking: [], itemCode: '', discountProduct: false }] } };
  const candidate = { id: ids.target, contactId: ids.contact, contactName: 'FCBS', collection: 'Invoices', type: 'ACCPAY',
    status: 'AUTHORISED', invoiceNumber: '79117PT-SEA STELLAR', reference: '', date: '2026-01-05', dueDate: '2026-01-05', currency: 'USD',
    total: 124.2, amountDue: 124.2, amountPaid: 0, amountCredited: 0, unowned: { CurrencyRate: 1 },
    lineItems: [{ LineItemID: ids.line, Description: 'USD124.2', Quantity: 1, UnitAmount: 124.2, LineAmount: 124.2,
      AccountCode: '51106', TaxType: 'NONE', TaxAmount: 0, Tracking: [], AccountID: uuid(10) }],
    groupedAccounting: { complete: true, subtotal: 124.2, total: 124.2, totalTax: 0, lineAmountTypes: 'Exclusive', isDiscounted: false,
      currencyRate: 1, amountDue: 124.2, amountPaid: 0, amountCredited: 0 } };
  const fileEvidence = { orgId: fcosSalesforceEnvironment('production').orgId, parentId: ids.source, documentId: ids.document,
    versionId: ids.version, sha256: hash('captured-pdf'), checksum: '0'.repeat(32), contentSize: 216208, contentType: 'application/pdf',
    link: { id: ids.link, parentId: ids.source, documentId: ids.document },
    version: { id: ids.version, documentId: ids.document, isLatest: true, latestPublishedVersionId: ids.version, checksum: '0'.repeat(32), contentSize: 216208 },
    review: { reviewer: 'Codex Astra', reviewedAt: '2026-09-27T16:13:38.368Z', reviewRecordHash: hash('root-review'),
      sourceNumber: 'M2601010', printedNumber: 'M-26-01-010', sellerName: account.Name, buyerName: 'FRATELLI COSULICH BUNKERS (HK) LTD',
      invoiceDate: '2026-01-05', dueDate: '2026-02-03', currency: 'USD', total: '124.20', totalTax: '0.00', vessel: 'SEA STELLAR',
      lines: [{ description: 'Trustee Service of USD0.50 per mt for SEA STELLAR STEM FC-25-12-058 - LSMGO', amount: '109.58' },
        { description: 'Trustee Service of USD0.50 per mt for SEA STELLAR STEM FC-25-12-058 - LSMGO', amount: '14.62' }] } };
  const stored = { documentMappings: [], productMappings: [{ id: ids.mapping, direction: 'supplier', salesforce_product_id: ids.product,
    xero_account_code: '51106', xero_tax_type: 'NONE', enabled: true, revision: 2 }] };
  const salesforce = { cutoffDate: '2026-01-01', groupedAccountSnapshot: completeGroupedAccountSnapshot({ totalSize: 1, records: [account] }) };
  const xero = { tenantId: ids.tenant, cutoffDate: '2026-01-01', contactsComplete: true,
    contacts: [{ id: ids.contact, name: 'FCBS', status: 'ACTIVE' }], documents: [candidate], organisation: { baseCurrency: 'USD' } };
  const context = buildGroupedPreservationContext(salesforce, xero, stored, [source]);
  return { ids, account, source, candidate, fileEvidence, context, stored, salesforce, xero,
    build: () => evaluateIssuedSupplierFinancialDocument(source, candidate, context, fileEvidence) };
}


// Full raw provider-shaped source data for the dedicated workflow's real builder.
export function issuedSupplierWorkflowFixture() {
  const f = issuedSupplierFixture();
  const { ids } = f;
  const supplier = { Id: ids.source, Name: 'M2601010', STEM__c: ids.stem, Supplier__c: ids.account,
    Supplier__r: { Name: f.account.Name, Company_Code__c: f.account.Company_Code__c },
    STEM__r: { Name: 'HK2524197T - SEA STELLAR - SINGAPORE', KeyStem__c: 'HK2524197T', Delivery_Date__c: '2026-01-05' },
    Invoice_Date__c: '2026-01-05', Invoice_Due_Date__c: '2026-02-03', Invoice_Amount__c: 124.2,
    Invoice_File__c: null, CurrencyIsoCode: 'USD', LastModifiedDate: '2026-06-29T12:19:11.000+0000' };
  const child = { Id: ids.child, Name: 'EXTRA-1', Product2Id__c: ids.product, Product2Id__r: { Name: 'TRUSTEE SERVICE' },
    Supplier_Invoice__c: ids.source, Supplier__c: ids.account, STEM__c: ids.stem, Cancelled__c: false,
    Quantity_Delivered_Per_BDN__c: 248.394, Quantity__c: 248.394, Unit_Cost__c: 0.5,
    Line_Total_Buy__c: 124.2, CurrencyIsoCode: 'USD', Unit_of_Measure__c: 'MT' };
  Object.assign(f.salesforce, { buyers: [], suppliers: [supplier], lines: [], extras: [child],
    safetyContext: { fields: {}, singleCurrency: false }, productRecords: [], fingerprintBasis: { supplier, child } });
  f.xero.inactiveDocuments = [];
  f.stored.bankMappings = [];
  const request = { sourceId: ids.source, xeroDocumentId: ids.target, documentId: ids.document, versionId: ids.version,
    sha256: f.fileEvidence.sha256, review: f.fileEvidence.review };
  return { ...f, supplier, child, packet: { records: [request] },
    files: new Map([[ids.source, f.fileEvidence]]), vessels: new Map([[ids.source, { stemId: ids.stem, vessel: 'SEA STELLAR' }]]) };
}

// Keep the legacy cent-only fixture stable; this is the actual source precision
// observed for M2601010, not a pre-rounded reconstruction of that provider row.
export function issuedSupplierRoundedWorkflowFixture() {
  const f = issuedSupplierWorkflowFixture();
  f.child.Line_Total_Buy__c = 124.197;
  return f;
}
