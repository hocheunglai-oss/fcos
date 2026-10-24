import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
// Fixture-only constants and pure record hash preserve the sealed synthetic cases.
const POLICY = 'issued_petroleum_preserve_v3';
const AGGREGATE_ZERO_SETTLEMENT_CONTRACT = 'authorised_zero_settlement_v1';
const aggregateSupplierReviewRecordHash = record => hash({ policyVersion: POLICY, record });
import { issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';

// All provider identities, source facts, grade evidence, paper coordinates,
// attachments and provenance adapters below are SYNTHETIC. No real cohort case
// is admitted or supplied missing documentary/registration/current evidence.
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { tenant: uuid(1), contact: uuid(2), target: uuid(3), line: uuid(4), ledger: uuid(5), observer: uuid(7),
  source: 'a06000000000001', account: '001000000000001', company: 'a0B000000000001', stem: 'a0H000000000001', vessel: 'a0V000000000001',
  fuel1: 'a05000000000001', fuel2: 'a05000000000002', charge: 'a04000000000001', product: '01t000000000001', chargeProduct: '01t000000000002',
  document: '069000000000001', version: '068000000000001', link: '06A000000000001' };
const now = '2026-10-04T09:00:00.000Z';
const currencyObjects = ['Invoice__c', 'Supplier_Invoice__c', 'STEM__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c', 'Payment__c'];
const fuelLine = (id, q, price, amount, ordinal = 1) => ({ id, ordinal, kind: 'fuel', description: 'SYNTHETIC LSFO', quantity: q, unit: 'MT', unitPrice: price,
  netUnitPrice: price, amount, coordinates: { page: 1, x0: 10, y0: 10, x1: 100, y1: 30 } });
const adjustment = (kind, amount, ordinal, appliesToLineId) => ({ id: `${kind}-line`, ordinal, kind, description: kind === 'discount' ? 'Less Discount' : 'SYNTHETIC LIGHTERAGE',
  amount, quantity: kind === 'discount' ? '10' : null, unit: kind === 'discount' ? 'MT' : null, unitPrice: kind === 'discount' ? '0.1' : null, netUnitPrice: null, coordinates: { page: 1, x0: 10, y0: 40, x1: 100, y1: 60 },
  ...(appliesToLineId ? { appliesToLineId } : {}) });
function fixture() {
  const orgId = fcosSalesforceEnvironment('production').orgId;
  const parent = { Id: ids.source, IsDeleted: false, Name: 'SYN26001', Supplier__c: ids.account, STEM__c: ids.stem,
    Supplier__r: { Name: 'EXAMPLE SUPPLY LTD', Company_Code__c: 'HKEXAMPLE', Company__c: ids.company, Company__r: { Full_Name__c: 'EXAMPLE SUPPLY LTD' } },
    STEM__r: { KeyStem__c: 'HK2626001T', Vessel__c: ids.vessel, Vessel__r: { Name: 'VESSEL ONE' }, Delivery_Date__c: '2026-03-17' },
    Invoice_Amount__c: '30050.00', Invoice_Date__c: '2026-04-01', Invoice_Due_Date__c: '2026-04-15', CurrencyIsoCode: 'USD', LastModifiedDate: now };
  const child = (id, q, amount) => ({ Id: id, IsDeleted: false, Cancelled__c: false, Supplier_Invoice__c: ids.source, STEM__c: ids.stem, Original_Supplier__c: ids.account,
    Buyer_Invoice__c: 'a0K000000000001', Product__c: ids.product, Product__r: { Name: 'SYNTHETIC RMG380 S0.5%' }, Quantity_Delivered_Per_BDN__c: q, Quantity__c: '999',
    Unit_Buy_At__c: '100', Total_Cost__c: amount, Unit_of_Measure__c: 'MT', CurrencyIsoCode: 'USD', LastModifiedDate: now });
  const source = { orgId, salesforceObject: 'Supplier_Invoice__c', sourceFingerprint: hash('synthetic-original-source'), financialFingerprint: hash('synthetic-original-financial'), parent,
    safetyContext: { fields: Object.fromEntries(currencyObjects.map(object => [object, ['Id', 'CurrencyIsoCode']])), singleCurrency: false, corporateCurrency: null },
    children: [child(ids.fuel1, '100', '10000'), child(ids.fuel2, '200', '20000')],
    charges: [{ Id: ids.charge, IsDeleted: false, Cancelled__c: false, Supplier_Invoice__c: ids.source, STEM__c: ids.stem, Supplier__c: ids.account,
      Buyer_Invoice__c: null, Product2Id__c: ids.chargeProduct, Product2Id__r: { Name: 'SYNTHETIC SURCHARGE' }, Line_Total_Buy__c: '50', Lumpsum_Cost__c: '50', CurrencyIsoCode: 'USD' }],
    products: [{ Id: ids.product, Name: 'SYNTHETIC RMG380 S0.5%', RecordType: { DeveloperName: 'Petroleum_Product' } }, { Id: ids.chargeProduct, Name: 'SYNTHETIC SURCHARGE' }],
    buyers: [{ Id: 'a0K000000000001', Name: 'SYN-BUYER-INV', STEM__c: ids.stem, IsDeleted: false, Proforma__c: false, Deprecated__c: false, Amount__c: '30050', Delivery_Date__c: '2026-03-17', Invoice_Date__c: '2026-03-19' }],
    buyerCoverage: { scope: 'same_stem_and_direct_links_all_dates_v1', complete: true, allDates: true, sameStemComplete: true, stemId: ids.stem, buyerCount: 1, queriedBuyerIds: ['a0K000000000001'], queryFingerprint: hash('synthetic-complete-all-date-buyer-query') } };
  const target = { InvoiceID: ids.target, Type: 'ACCPAY', Status: 'AUTHORISED', Contact: { ContactID: ids.contact, Name: 'EXAMPLE SUPPLY LTD' },
    InvoiceNumber: '79716P-VESSEL ONE', Reference: '', Date: '2026-03-01', DueDate: '2026-03-05', CurrencyCode: 'USD', CurrencyRate: 1,
    Total: '30050', SubTotal: '30050', TotalTax: 0, IsDiscounted: false, LineAmountTypes: 'Exclusive', AmountPaid: 0, AmountCredited: 0, AmountDue: '30050',
    Payments: [], CreditNotes: [], UpdatedDateUTC: now, SentToContact: false, LegacyExtension: { unchanged: 'original' },
    LineItems: [{ LineItemID: ids.line, Description: 'UNMODIFIED LEGACY', Quantity: 1, UnitAmount: '30050', LineAmount: '30050', AccountCode: '51100',
      AccountID: ids.ledger, TaxType: 'NONE', TaxAmount: 0, Tracking: [], UnownedField: 'original line' }] };
  const review = { reviewer: 'Synthetic documentary reviewer', reviewedAt: now, sourceTokens: ['SYN26001'],
    identityFacts: { accountId: ids.account, companyId: ids.company, companyName: parent.Supplier__r.Company__r.Full_Name__c, companyCode: 'HKEXAMPLE',
      sourceSeller: parent.Supplier__r.Name, printedSeller: 'EXAMPLE SUPPLY LIMITED', sourceVessel: 'VESSEL ONE', printedVessel: 'VESSEL ONE', targetVessel: 'VESSEL ONE',
      actualBuyerLegalIdentity: 'FRATELLI COSULICH BUNKERS (HK) LTD', printedBuyer: 'FRATELLI COSULICH BUNKERS (HK) LIMITED', vesselId: ids.vessel,
      basis: 'independently_reviewed_literal_pairs', financialApprovalGranted: false, contactId: ids.contact, tenantId: ids.tenant, sourceId: ids.source, stemId: ids.stem,
      versionId: ids.version, pdfSha256: hash('synthetic-original-pdf'), targetDate: target.Date, deliveryDate: source.buyers[0].Delivery_Date__c, invoiceDate: source.buyers[0].Invoice_Date__c },
    components: [{ id: 'component-1', ordinal: 1, page: 1, documentType: 'INVOICE', sourceToken: 'SYN26001', printedNumber: 'SYN-26-001', numberRule: 'reviewed_ascii_hyphens',
      sellerName: 'EXAMPLE SUPPLY LIMITED', buyerName: 'FRATELLI COSULICH BUNKERS (HK) LIMITED', vessel: 'VESSEL ONE', invoiceDate: null, dueDate: null, deliveryDate: null,
      currency: 'USD', total: '30050', totalTax: null, taxEvidence: 'no_tax_line_or_increment_observed', lines: [fuelLine('fuel-line', '300', '100', '30000'), adjustment('charge', '50', 2)] }],
    allocations: [{ componentId: 'component-1', paperLineId: 'fuel-line', sourceId: ids.fuel1, quantity: '100', amount: '10000', productEvidenceId: 'fuel-proof' },
      { componentId: 'component-1', paperLineId: 'fuel-line', sourceId: ids.fuel2, quantity: '200', amount: '20000', productEvidenceId: 'fuel-proof' },
      { componentId: 'component-1', paperLineId: 'charge-line', sourceId: ids.charge, quantity: null, amount: '50', productEvidenceId: 'charge-proof' }],
    productEvidence: [{ id: 'fuel-proof', componentId: 'component-1', paperLineId: 'fuel-line', sourceProductId: ids.product, sourceProductName: source.products[0].Name,
      productFactsHash: hash(source.products[0]), sourceIds: [ids.fuel1, ids.fuel2], independentEvidence: 'Synthetic independent reviewed grade facts; not inferred from arithmetic.',
      reviewRecordHash: hash('synthetic-grade-review'), basis: 'independently_reviewed_product_grade', sourceGrade: 'RMG380 S0.5%', printedGrade: 'LSFO', printedDescription: 'SYNTHETIC LSFO', netUnitPrice: '100' },
    { id: 'charge-proof', componentId: 'component-1', paperLineId: 'charge-line', sourceProductId: ids.chargeProduct, sourceProductName: source.products[1].Name,
      productFactsHash: hash(source.products[1]), sourceIds: [ids.charge], independentEvidence: 'Synthetic scoped printed lighterage/source surcharge review.',
      reviewRecordHash: hash('synthetic-charge-review'), basis: 'independently_reviewed_charge_description', printedDescription: 'SYNTHETIC LIGHTERAGE' }] };
  const fileEvidence = { orgId, parentId: ids.source, documentId: ids.document, versionId: ids.version, sha256: review.identityFacts.pdfSha256,
    checksum: '0'.repeat(32), contentSize: 1234, contentType: 'application/pdf', link: { id: ids.link, parentId: ids.source, documentId: ids.document },
    version: { id: ids.version, documentId: ids.document, latestPublishedVersionId: ids.version, isLatest: true, checksum: '0'.repeat(32), contentSize: 1234 }, review };
  const identity = { accounts: [{ id: ids.account, name: 'EXAMPLE SUPPLY LTD', companyCode: 'HKEXAMPLE', recordType: 'Supplier', inactiveSuspended: false }],
    contacts: [{ id: ids.contact, name: 'EXAMPLE SUPPLY LTD', status: 'ACTIVE', contactNumber: '', accountNumber: '' }],
    sourceClaims: [structuredClone(parent)], targetClaims: [structuredClone(target)], creditClaims: [], sourceMappings: [], targetMappings: [], referenceClaims: [], postingClaims: [], disputes: [],
    coverage: { scope: 'complete_selected_owner_union_v1', globalDiscoveryFingerprint: hash('synthetic-global-discovery'), globalAccountCount: 13564, globalContactCount: 779, sourceAccountIds: [ids.account], stemIds: [ids.stem], xeroContactIds: [ids.contact], sourceQueryAll: true, sourceComplete: true, targetComplete: true,
      targetIncludesArchived: true, creditComplete: true, globalAccountsComplete: true, globalContactsComplete: true, claimsComplete: true, mappingsComplete: true, filesComplete: true,
      sourceCount: 1, targetCount: 1, creditCount: 0, queryFingerprints: Array.from({ length: 9 }, (_, i) => hash(`synthetic-query-${i}`)) } };
  const input = { policyVersion: POLICY, settlementContract: AGGREGATE_ZERO_SETTLEMENT_CONTRACT, tenantId: ids.tenant, source, target, fileEvidence, identity,
    organisation: { baseCurrency: 'USD' }, productMappings: [ids.product, ids.chargeProduct].map((productId, i) => ({ id: uuid(10 + i), direction: 'supplier', salesforceProductId: productId,
      enabled: true, revision: 1, xeroAccountCode: '51100', xeroTaxType: 'NONE', approvedBy: uuid(20), approvedByEmail: 'finance@example.test', approvedAt: now })),
    accountTax: { account: { AccountID: ids.ledger, Code: '51100', Type: 'DIRECTCOSTS', Status: 'ACTIVE' }, tax: { TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, CanApplyToExpenses: true } } };
  const documentaryRecord = () => ({ sourceId: parent.Id, xeroDocumentId: target.InvoiceID, documentId: fileEvidence.documentId,
    versionId: fileEvidence.versionId, sha256: fileEvidence.sha256, review, attachments: fileEvidence.attachmentManifest.entries });
  // FIXTURE-ONLY registry: resealing explicitly registers revised synthetic
  // documentary facts. No actual cohort hash or production registry is changed.
  const approvedReviewHashes = new Set();
  const reseal = () => {
    review.reviewRecordHash = hash(Object.fromEntries(Object.entries(review).filter(([key]) => key !== 'reviewRecordHash')));
    const entry = { linkId: ids.link, documentId: ids.document, versionId: ids.version, sha256: fileEvidence.sha256, checksum: fileEvidence.checksum,
      contentSize: fileEvidence.contentSize, fileType: 'PDF', fileExtension: 'pdf', role: 'issued_invoice', reviewRecordHash: review.reviewRecordHash };
    fileEvidence.attachmentManifest = { complete: true, selectedDocumentId: ids.document, selectedVersionId: ids.version, entries: [entry] };
    input.currentFiles = [{ parentId: ids.source, linkId: ids.link, latestPublishedVersionId: ids.version, isLatest: true, nativeBytesVerified: true, entryHash: hash(entry) }];
    source.blockers = ['Supplier invoice has no verified issued source file.'];
    source.buyerCoverage.buyerCount = source.buyers.length;
    source.buyerCoverage.queriedBuyerIds = [...new Set([...source.children, ...source.charges].filter(row => row.IsDeleted === false && row.Cancelled__c === false).map(row => row.Buyer_Invoice__c).filter(value => typeof value === 'string'))].sort();
    source.readiness = { blockers: [...source.blockers], linkedChildren: [...source.children, ...source.charges].filter(row => row.IsDeleted === false && row.Cancelled__c === false).map(row => row.Id) };
    identity.sourceClaims[0] = structuredClone(parent); identity.targetClaims[0] = structuredClone(target);
    identity.coverage.sourceCount = identity.sourceClaims.length; identity.coverage.targetCount = identity.targetClaims.length; identity.coverage.creditCount = identity.creditClaims.length;
    identity.coverageFingerprint = hash(Object.fromEntries(Object.entries(identity).filter(([key]) => key !== 'coverageFingerprint')));
    approvedReviewHashes.add(aggregateSupplierReviewRecordHash(documentaryRecord()));
  };
  // This function stands in only for a trusted server/DB-backed adapter. Tests
  // deliberately keep it outside the client packet and include failed bindings.
  const provenance = binding => ({ registration: approvedReviewHashes.has(binding.approvedReviewRecordHash)
    ? { purpose: 'documentary_review_registration', policyVersion: POLICY, reviewer: review.reviewer, reviewedAt: review.reviewedAt, at: now,
      approvedReviewRecordHash: binding.approvedReviewRecordHash, financialApprovalGranted: false, binding: structuredClone(binding.documentaryBinding), cases: [{ sourceId: ids.source, targetId: ids.target }] } : null,
  current: { purpose: 'current_aggregate_observation', coverageScope: 'complete_selected_owner_union_v1', actorId: ids.observer, at: now, binding: structuredClone(binding), cases: [{ sourceId: ids.source, targetId: ids.target }] } });
  const trust = { now, actorId: ids.observer, maxAgeMs: 300000, verifyProvenance: provenance };
  reseal();
  return { input, trust, reseal, review, parent, source, target, identity, provenance, approvedReviewHashes, documentaryRecord };
}

export { fixture, ids, now, hash, POLICY };
