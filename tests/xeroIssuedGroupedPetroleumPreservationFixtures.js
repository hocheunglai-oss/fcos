import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { buildFinancialClassifications, normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';
import { buildGroupedPreservationContext } from '../api/_xeroGroupedPreservationAdapter.js';
import { issuedSupplierHash as hash, issuedSupplierSfId as sf } from '../api/_xeroIssuedSupplierPreservation.js';
import { ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY as POLICY } from '../api/_xeroIssuedGroupedPetroleumPreservation.js';
import { evaluateGroupedPetroleumFinancialDocument, issuedGroupedPetroleumScopeFingerprint } from '../api/_xeroIssuedGroupedPetroleumPreservationAdapter.js';

const uid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export function issuedGroupedPetroleumFixture({ direction = 'supplier', lineCount = 2, repeatedProduct = false } = {}) {
  const f = issuedPetroleumFixture(); const buyer = direction === 'buyer'; const code = buyer ? '41100' : '51100';
  const ids = f.ids; ids.source = buyer ? 'a0K000000000001' : ids.source; ids.vessel = 'a0C000000000001';
  f.direction = direction; f.account.RecordType.DeveloperName = buyer ? 'Buyer' : 'Supplier';
  const parent = { ...f.supplier, Id: ids.source, Name: buyer ? '26001T-INV-1' : 'PET26001',
    STEM__r: { ...f.supplier.STEM__r, Vessel__c: ids.vessel, Vessel__r: { Name: 'VESSEL ONE', IMO__c: '9760639' }, Account__c: ids.account,
      Account__r: { Name: f.account.Name, Company_Code__c: f.account.Company_Code__c } } };
  if (buyer) Object.assign(parent, { Proforma__c: false, Deprecated__c: false, File__c: `https://example.my.salesforce.com/${ids.document}`, Buyer_Charge_Snapshot__c: null, Delivery_Date__c: parent.STEM__r.Delivery_Date__c });
  const lines = Array.from({ length: lineCount }, (_, i) => ({ Id: `a05${String(i + 1).padStart(12, '0')}`, IsDeleted: false, Cancelled__c: false,
    Buyer_Invoice__c: buyer ? ids.source : null, Supplier_Invoice__c: buyer ? null : ids.source, Original_Supplier__c: ids.account,
    STEM__c: ids.stem, Product__c: `01t${String(repeatedProduct ? 1 : i + 1).padStart(12, '0')}`, Product__r: { Name: `Fuel ${repeatedProduct ? 1 : i + 1}` },
    Quantity_Delivered_Per_BDN__c: (i + 1) * 10, Quantity__c: (i + 1) * 11, Unit_of_Measure__c: 'MT', BDN_Delivery_Date__c: parent.STEM__r.Delivery_Date__c,
    Unit_Buy_At__c: 10, Unit_Sell_At__c: 10, Total_Cost__c: (i + 1) * 100, Total_Price__c: (i + 1) * 100, CurrencyIsoCode: 'USD' }));
  const products = [...new Map(lines.map(line => [line.Product__c, { Id: line.Product__c, IsDeleted: false, IsActive: true, Name: line.Product__r.Name, RecordType: { DeveloperName: 'Petroleum_Product' } }])).values()];
  const total = lines.reduce((sum, row) => sum + row.Total_Cost__c, 0); parent.Amount__c = total; parent.Invoice_Amount__c = total;
  Object.assign(f.salesforce, { buyers: buyer ? [parent] : [], suppliers: buyer ? [] : [parent], lines, extras: [], productRecords: products,
    products: products.map(row => ({ id: row.Id, name: row.Name })) });
  f.salesforce.safetyContext.fields.Invoice__c = ['CurrencyIsoCode', 'Proforma__c', 'Deprecated__c', 'File__c', 'Buyer_Charge_Snapshot__c'];
  f.salesforce.safetyContext.fields.STEM__c = ['CurrencyIsoCode']; parent.STEM__r.CurrencyIsoCode = 'USD';
  Object.assign(f.raw, { Type: buyer ? 'ACCREC' : 'ACCPAY', InvoiceNumber: buyer ? '79182S' : '79537P-VESSEL ONE', Reference: buyer ? 'VESSEL ONE' : '', Total: total, SubTotal: total, AmountDue: total });
  Object.assign(f.raw.LineItems[0], { Quantity: 1, UnitAmount: total, LineAmount: total, AccountCode: code });
  f.stored.productMappings = products.map((product, i) => ({ id: uid(100 + i), direction, salesforce_product_id: product.Id, salesforce_product_name: product.Name,
    xero_account_code: code, xero_tax_type: 'NONE', enabled: true, revision: 1, approved_by: ids.approver, approved_by_email: 'finance@example.test', approved_at: '2026-09-01T00:00:00.000Z' }));
  f.fileEvidence.parentId = ids.source; f.fileEvidence.link.parentId = ids.source;
  const review = f.fileEvidence.review;
  Object.assign(review, { sourceNumber: parent.Name, printedNumber: buyer ? parent.STEM__r.KeyStem__c : 'PET-26-001', numberRule: buyer ? 'buyer_generated_stem_number' : 'reviewed_ascii_hyphens',
    sellerName: buyer ? 'FRATELLI COSULICH BUNKERS (HK) LIMITED' : 'EXAMPLE INTERNATIONAL SUPPLY LIMITED',
    buyerName: buyer ? 'EXAMPLE INTERNATIONAL SUPPLY LIMITED' : 'FRATELLI COSULICH BUNKERS (HK) LIMITED', total: String(total), imo: buyer ? '9760639' : null });
  Object.assign(review.counterparties, { printedSeller: review.sellerName, printedBuyer: review.buyerName });
  review.lines = lines.map(line => ({ sourceChildId: line.Id, description: line.Product__r.Name, quantity: String(line.Quantity_Delivered_Per_BDN__c), unit: 'MT', unitPrice: '10', amount: String(line.Total_Cost__c),
    sourceProductId: line.Product__c, sourceProductName: line.Product__r.Name, productEvidence: 'Exact printed grade.' }));
  const stemLines = lines.map(line => Object.fromEntries(['Id', 'IsDeleted', 'Cancelled__c', 'STEM__c', 'Buyer_Invoice__c', 'Supplier_Invoice__c', buyer ? 'Total_Price__c' : 'Total_Cost__c'].map(key => [key, line[key]])));
  const facts = { direction, parent, lines, extras: [], products, stemLines, stemExtras: [], currencyContext: { singleCurrency: false, corporateCurrency: null } };
  const scope = { policyVersion: POLICY, salesforceOrgId: f.fileEvidence.orgId, tenantId: ids.tenant, sourceFacts: new Map([[sf(ids.source), facts]]),
    sourceClaims: [{ direction, salesforceObject: buyer ? 'Invoice__c' : 'Supplier_Invoice__c', raw: parent }], targetClaims: [], creditClaims: [], currencyContext: facts.currencyContext,
    accountTax: { accounts: [{ AccountID: ids.ledger, Code: code, Type: buyer ? 'REVENUE' : 'DIRECTCOSTS', Status: 'ACTIVE', Name: 'Petroleum' }],
      taxRates: [{ TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, CanApplyToRevenue: true, CanApplyToExpenses: true }] },
    coverage: { sourceAccountIds: [sf(ids.account)], stemIds: [sf(ids.stem)], xeroContactIds: [ids.contact], sourceObjects: [buyer ? 'Invoice__c' : 'Supplier_Invoice__c'],
      sourceQueryAll: true, sourceComplete: true, targetComplete: true, creditComplete: true, accountTaxComplete: true, queryFingerprints: Array.from({ length: 8 }, (_, i) => hash(`grouped-query-${i}`)) } };
  Object.assign(f, { parent, lines, products, facts, scope });
  f.refreshScope = () => { scope.coverage.sourceCount = scope.sourceClaims.length; scope.coverage.targetCount = scope.targetClaims.length; scope.coverage.creditCount = scope.creditClaims.length; scope.coverage.contentFingerprint = issuedGroupedPetroleumScopeFingerprint(scope); };
  f.rebuild = () => { f.candidate = normalizeXeroInvoice(f.raw); f.xero.documents = [f.candidate];
    const built = buildFinancialClassifications(f.salesforce, f.xero, f.stored); f.source = built.sources.find(row => sf(row.salesforceId) === sf(ids.source));
    f.context = { ...buildGroupedPreservationContext(f.salesforce, f.xero, f.stored, built.sources), groupedPetroleum: scope };
    scope.targetClaims = [{ raw: f.raw, document: f.candidate }]; f.refreshScope(); return f; };
  f.build = () => evaluateGroupedPetroleumFinancialDocument(f.source, f.candidate, f.context, f.fileEvidence);
  f.rebuild();
  f.files = new Map([[ids.source, f.fileEvidence]]);
  f.packet = { policyVersion: POLICY, records: [{ sourceId: ids.source, xeroDocumentId: ids.target, documentId: ids.document, versionId: ids.version, sha256: f.fileEvidence.sha256, review }] };
  return f;
}
