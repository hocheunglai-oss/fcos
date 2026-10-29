import { fixture, ids, now, hash } from './xeroSupplierFinancialSource.fixture.js';
import { supplierFinancialSourcePayload } from '../api/_xeroFinancialSync.js';
import { SUPPLIER_FINANCIAL_BUCKET_POLICY } from '../api/_xeroSupplierFinancialBucketPreservation.js';

export { ids, now, hash };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Synthetic complete identity/grant/claim snapshots. No provider observation,
// registration, documentary fact, approval or current authority is fabricated.
export function financialFixture({ paid = false } = {}) {
  const old = fixture(), source = old.source, target = old.target, identity = old.identity;
  source.children.forEach(r => { r.Cost_Per_Unit__c = null; });
  Object.assign(source.charges[0], { Quantity__c: 1, Unit_Cost__c: 0 });
  delete source.products; delete source.buyerCoverage; delete source.blockers; delete source.readiness;
  Object.assign(target, { Prepayments: [], Overpayments: [], HasErrors: false });
  const input = { policyVersion: SUPPLIER_FINANCIAL_BUCKET_POLICY, tenantId: ids.tenant, source, target, identity,
    organisation: { OrganisationID: ids.tenant, Name: 'Synthetic organisation', BaseCurrency: 'USD', APIKey: 'PRIVATE_SYNTHETIC_PROVIDER_IDENTITY' },
    productMappings: old.input.productMappings.map(m => ({ id: m.id, direction: m.direction, salesforce_product_id: m.salesforceProductId,
      enabled: m.enabled, revision: m.revision, xero_account_code: m.xeroAccountCode, xero_tax_type: m.xeroTaxType,
      approved_by: m.approvedBy, approved_by_email: m.approvedByEmail, approved_at: m.approvedAt })),
    accountTax: { accounts: [old.input.accountTax.account], taxes: [old.input.accountTax.tax] },
    sourceDependencies: { payments: [{ Id: 'a0S000000000001', IsDeleted: false, Supplier_Invoice__c: ids.source, STEM__c: ids.stem, Account__c: ids.account,
      Is_Volume_Discount__c: false, Amount__c: '123.45', Remittance__c: null },
    { Id: 'a0S000000000002', IsDeleted: true, Supplier_Invoice__c: ids.source, STEM__c: ids.stem, Account__c: ids.account,
      Is_Volume_Discount__c: true, Amount__c: 0.46000000000001, Remittance__c: null }], families: [],
    coverage: { contract: 'complete_supplier_payment_family_scope_v1', complete: true, queryAll: true, sourceId: ids.source, stemId: ids.stem,
      accountId: ids.account, queryFingerprint: hash('synthetic complete dependency scope'), paymentCount: 2, familyCount: 0 } } };
  Object.assign(identity.coverage, { dependenciesComplete: true }); delete identity.coverage.filesComplete;
  if (paid) {
    Object.assign(target, { Status: 'PAID', AmountPaid: target.Total, AmountDue: 0, FullyPaidOnDate: '2026-04-20',
      Payments: [{ PaymentID: uuid(40), Date: '2026-04-20', Amount: target.Total, CurrencyRate: 1, Reference: 'Existing ledger only', HasAccount: false }] });
    input.ledgerPaymentEvidence = { payments: [{ ...target.Payments[0], PaymentType: 'ACCPAYPAYMENT', Status: 'AUTHORISED', HasAccount: true, BankAmount: target.Total,
      Account: { AccountID: uuid(41), Code: '12155', CurrencyCode: 'USD' }, Invoice: { InvoiceID: ids.target, Type: 'ACCPAY', CurrencyCode: 'USD',
        Contact: { ContactID: ids.contact }, Payments: [], CreditNotes: [], Prepayments: [], Overpayments: [] } }],
    accounts: [{ AccountID: uuid(41), Code: '12155', Name: 'Prepaid to CPC Taiwan', Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' }] };
  }
  function reseal() {
    const payload = supplierFinancialSourcePayload({ parent: source.parent, children: source.children, charges: source.charges, buyers: source.buyers,
      safetyContext: source.safetyContext, contacts: identity.contacts, productMappings: input.productMappings });
    // Stored source_payload is the original ordinary JSON persistence form.
    source.sourcePayload = JSON.parse(JSON.stringify(payload)); source.sourceFingerprint = payload.sourceFingerprint; source.financialFingerprint = payload.financialFingerprint;
    identity.selection = { contract: 'supplier_financial_selected_identity_v1', tenantId: ids.tenant, salesforceOrgId: source.orgId.slice(0, 15),
      sourceId: ids.source, stemId: ids.stem, accountId: ids.account, contactId: ids.contact, targetId: ids.target, sourceFingerprint: source.sourceFingerprint,
      financialFingerprint: source.financialFingerprint, reviewedBy: ids.observer, reviewedAt: now, basis: 'synthetic independently selected original supplier obligation' };
    identity.sourceClaims = [structuredClone(source.parent)]; identity.targetClaims = [structuredClone(target)];
    identity.coverage.sourceCount = identity.sourceClaims.length; identity.coverage.targetCount = identity.targetClaims.length; identity.coverage.creditCount = identity.creditClaims.length;
    identity.coverageFingerprint = hash(Object.fromEntries(Object.entries(identity).filter(([k]) => k !== 'coverageFingerprint')));
  }
  reseal(); return { input, source, target, identity, reseal };
}
