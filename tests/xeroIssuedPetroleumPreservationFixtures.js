import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { completeGroupedAccountSnapshot, buildGroupedPreservationContext } from '../api/_xeroGroupedPreservationAdapter.js';
import { buildFinancialClassifications, normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';
import { issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';
import { petroleumScopeFingerprint } from '../api/_xeroIssuedPetroleumScope.js';
import { evaluatePetroleumFinancialDocument } from '../api/_xeroIssuedPetroleumPreservationAdapter.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export function issuedPetroleumFixture() {
  const ids = { source: 'a06000000000001', account: '001000000000001', stem: 'a0H000000000001', vessel: 'a0V000000000001',
    child: 'a05000000000001', product: '01t000000000001', document: '069000000000001', version: '068000000000001', link: '06A000000000001',
    tenant: uuid(1), contact: uuid(2), target: uuid(3), line: uuid(4), mapping: uuid(5), ledger: uuid(6), approver: uuid(7) };
  const account = { Id: ids.account, Name: 'EXAMPLE INTERNATIONAL SUPPLY LTD', Company_Code__c: 'HKEXAMPLE', Inactive_Suspended__c: false, RecordType: { DeveloperName: 'Supplier' } };
  const supplier = { Id: ids.source, IsDeleted: false, Name: 'PET26001', STEM__c: ids.stem, Supplier__c: ids.account,
    Supplier__r: { Name: account.Name, Company_Code__c: account.Company_Code__c },
    STEM__r: { KeyStem__c: 'HK2626001T', Name: 'HK2626001T - VESSEL ONE', Delivery_Date__c: '2026-03-17',
      Vessel__c: ids.vessel, Vessel__r: { Name: 'VESSEL ONE' }, LastModifiedDate: '2026-06-01T00:00:00.000Z' },
    Invoice_Amount__c: 1707836.16, Invoice_Date__c: '2026-04-01', Invoice_Due_Date__c: '2026-04-15', Invoice_File__c: null,
    CurrencyIsoCode: 'USD', LastModifiedDate: '2026-06-01T00:00:00.000Z' };
  const child = { Id: ids.child, IsDeleted: false, Cancelled__c: false, Name: 'Fuel', Supplier_Invoice__c: ids.source,
    Original_Supplier__c: ids.account, STEM__c: ids.stem, Product__c: ids.product, Product__r: { Name: 'RMG380 S0.5% (ISO2010)' },
    Quantity_Delivered_Per_BDN__c: 1993.217, Quantity__c: 2000, Unit_of_Measure__c: 'MT', Unit_Buy_At__c: 856.824,
    Total_Cost__c: 1707836.16, CurrencyIsoCode: 'USD', LastModifiedDate: '2026-06-01T00:00:00.000Z' };
  const product = { Id: ids.product, Name: child.Product__r.Name, RecordType: { DeveloperName: 'Petroleum_Product' } };
  const salesforce = { cutoffDate: '2026-01-01', buyers: [], suppliers: [supplier], lines: [child], extras: [], productRecords: [product], products: [{ id: ids.product, name: product.Name }],
    safetyContext: { fields: Object.fromEntries(['Supplier_Invoice__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c'].map((object) => [object, ['CurrencyIsoCode', 'Invoice_File__c']])), singleCurrency: false },
    groupedAccountSnapshot: completeGroupedAccountSnapshot({ records: [account], totalSize: 1 }), fingerprintBasis: { supplier, child } };
  const raw = { InvoiceID: ids.target, Type: 'ACCPAY', Status: 'AUTHORISED', Contact: { ContactID: ids.contact, Name: account.Name },
    InvoiceNumber: '79716P-VESSEL ONE', Reference: '', Date: '2026-03-17', DueDate: '2026-03-17', CurrencyCode: 'USD', CurrencyRate: 1,
    Total: 1707836.16, SubTotal: 1707836.16, TotalTax: 0, LineAmountTypes: 'Exclusive', IsDiscounted: false,
    AmountDue: 1707836.16, AmountPaid: 0, AmountCredited: 0, UpdatedDateUTC: '2026-06-20T00:00:00.000Z', Payments: [], CreditNotes: [],
    LineItems: [{ LineItemID: ids.line, Description: 'HISTORICAL AGGREGATE', Quantity: 1, UnitAmount: 1707836.16, LineAmount: 1707836.16,
      AccountCode: '51100', AccountID: ids.ledger, TaxType: 'NONE', TaxAmount: 0, Tracking: [] }] };
  const candidate = normalizeXeroInvoice(raw);
  const xero = { tenantId: ids.tenant, cutoffDate: '2026-01-01', contactsComplete: true, contacts: [{ id: ids.contact, name: account.Name, status: 'ACTIVE' }],
    documents: [candidate], inactiveDocuments: [], organisation: { baseCurrency: 'USD' } };
  const stored = { bankMappings: [], documentMappings: [], productMappings: [{ id: ids.mapping, direction: 'supplier', salesforce_product_id: ids.product,
    salesforce_product_name: product.Name, xero_account_code: '51100', xero_tax_type: 'NONE', enabled: true, revision: 1,
    approved_by: ids.approver, approved_by_email: 'finance@example.test', approved_at: '2026-09-01T00:00:00.000Z' }] };
  const built = buildFinancialClassifications(salesforce, xero, stored);
  const source = built.sources[0];
  const fileEvidence = { orgId: fcosSalesforceEnvironment('production').orgId, parentId: ids.source, documentId: ids.document, versionId: ids.version,
    sha256: hash('synthetic-pdf-fixture'), checksum: '0'.repeat(32), contentSize: 1234, contentType: 'application/pdf',
    link: { id: ids.link, parentId: ids.source, documentId: ids.document },
    version: { id: ids.version, documentId: ids.document, isLatest: true, latestPublishedVersionId: ids.version, checksum: '0'.repeat(32), contentSize: 1234 },
    review: { reviewer: 'Codex Astra', reviewedAt: '2026-09-27T18:04:25.000Z', reviewRecordHash: hash('synthetic-documentary-review'),
      sourceNumber: supplier.Name, printedNumber: 'PET-26-001', numberRule: 'reviewed_ascii_hyphens', sellerName: 'EXAMPLE INTERNATIONAL SUPPLY LIMITED',
      buyerName: 'FRATELLI COSULICH BUNKERS (HK) LIMITED', invoiceDate: supplier.Invoice_Date__c, dueDate: supplier.Invoice_Due_Date__c,
      deliveryDate: null, currency: 'USD', total: '1707836.16', totalTax: null, taxEvidence: 'no_tax_line_or_increment_observed', vessel: 'VESSEL ONE',
      counterparties: { accountId: ids.account, contactId: ids.contact, tenantId: ids.tenant, sourceName: account.Name, companyCode: account.Company_Code__c,
        printedSeller: 'EXAMPLE INTERNATIONAL SUPPLY LIMITED', printedBuyer: 'FRATELLI COSULICH BUNKERS (HK) LIMITED', basis: 'independently_reviewed_literal_pair' },
      lines: [{ description: 'LSFO', quantity: '1993.217', unit: 'MT', unitPrice: '856.824', amount: '1707836.16', sourceProductId: ids.product,
        sourceProductName: product.Name, productEvidence: 'Printed LSFO family linked to exact current source Product2; full ISO grade not printed.' }] } };
  const scope = { policyVersion: 'issued_petroleum_preserve_v1', salesforceOrgId: fileEvidence.orgId, tenantId: ids.tenant,
    sourceFacts: new Map([[ids.source, { parent: supplier, lines: [child], extras: [], product }]]), sourceClaims: [supplier],
    targetClaims: [{ raw, document: candidate }], creditClaims: [], currencyContext: { singleCurrency: false, corporateCurrency: null },
    accountTax: { accounts: [{ AccountID: ids.ledger, Code: '51100', Type: 'DIRECTCOSTS', Status: 'ACTIVE', Name: 'Purchases' }],
      taxRates: [{ TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, CanApplyToExpenses: true }] },
    coverage: { sourceAccountIds: [ids.account], stemIds: [ids.stem], xeroContactIds: [ids.contact], sourceQueryAll: true,
      sourceCount: 1, targetCount: 1, creditCount: 0, sourceComplete: true, targetComplete: true, creditComplete: true, accountTaxComplete: true,
      queryFingerprints: Array.from({ length: 7 }, (_, i) => hash(`synthetic-query-${i}`)) } };
  scope.coverage.contentFingerprint = petroleumScopeFingerprint(scope);
  const context = { ...buildGroupedPreservationContext(salesforce, xero, stored, built.sources), petroleum: scope };
  const request = { sourceId: ids.source, xeroDocumentId: ids.target, documentId: ids.document, versionId: ids.version, sha256: fileEvidence.sha256, review: fileEvidence.review };
  return { ids, account, supplier, child, product, raw, source, candidate, salesforce, xero, stored, context, scope, fileEvidence,
    files: new Map([[ids.source, fileEvidence]]), packet: { policyVersion: scope.policyVersion, records: [request] },
    refreshScope: () => { scope.coverage.sourceCount = scope.sourceClaims.length; scope.coverage.targetCount = scope.targetClaims.length;
      scope.coverage.creditCount = scope.creditClaims.length; scope.coverage.contentFingerprint = petroleumScopeFingerprint(scope); },
    build: () => evaluatePetroleumFinancialDocument(source, candidate, context, fileEvidence) };
}
