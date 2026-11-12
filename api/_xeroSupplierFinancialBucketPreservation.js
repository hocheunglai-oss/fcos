import { copyPaidSupplierProofJson as copyJson } from './_xeroPaidSupplierProofJson.js';
import { issuedSupplierSfId as sf, issuedSupplierCanonical as canonical, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';
import { accountingProductCents } from './_xeroAccountingLineCents.js';
import { aggregateSupplierCalendarDate } from './_xeroAggregateSupplierDates.js';
import { derivePetroleumOwnership, petroleumDistinctStemSuppliers } from './_xeroIssuedPetroleumOwnership.js';
import { financialSourceCurrency } from './_xeroDocumentSafety.js';
import { supplierFinancialSourcePayload } from './_xeroFinancialSync.js';
import { evaluateSettledSupplierPaymentProof, SETTLED_SUPPLIER_PAYMENT_CONTRACT } from './_xeroSettledSupplierPaymentProof.js';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

export const SUPPLIER_FINANCIAL_BUCKET_POLICY = 'supplier_financial_bucket_preserve_v1';
export const SUPPLIER_FINANCIAL_BUCKET_CONTRACT = 'financial_bucket_preservation_v1';
export const SUPPLIER_FINANCIAL_CLAIM_CONTRACT = 'supplier_financial_local_claim_scope_v1';
const ZERO_SETTLEMENT = 'authorised_zero_settlement_v1';
const HASH = /^[a-f0-9]{64}$/;
const CURRENCY_OBJECTS = Object.freeze(['Invoice__c', 'Supplier_Invoice__c', 'STEM__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c', 'Payment__c']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const uuid = v => typeof v === 'string' && UUID.test(v) && v !== '00000000-0000-0000-0000-000000000000' ? v.toLowerCase() : null;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, empty = false) => typeof v === 'string' && v.length <= 4000 && (empty || v.trim()) && !/[\u0000-\u001f\u007f]/.test(v);
const equal = (a, b) => canonical(a) === canonical(b);
const without = (v, key) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const decimal = v => {
  if (!['string', 'number'].includes(typeof v) || Object.is(v, -0) || !/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(String(v))) return null;
  const s = String(v), negative = s.startsWith('-'), [whole, fraction = ''] = (negative ? s.slice(1) : s).split('.');
  const integer = BigInt(whole + fraction) * (negative ? -1n : 1n);
  return negative && integer === 0n ? null : { integer, scale: fraction.length, fraction };
};
// No tolerance, coercion of null/missing facts, exponent syntax or cent rounding.
export function supplierFinancialSignedCents(value) {
  const p = decimal(value);
  if (!p || /[1-9]/.test(p.fraction.slice(2))) return null;
  return p.scale <= 2 ? p.integer * 10n ** BigInt(2 - p.scale) : p.integer / 10n ** BigInt(p.scale - 2);
}
const cents = supplierFinancialSignedCents;
const sum = rows => rows.some(v => v === null) ? null : rows.reduce((n, v) => n + v, 0n);
const exactProduct = (quantity, unit, amount) => {
  const q = decimal(quantity), u = decimal(unit);
  return q && q.integer > 0n && u && amount !== null
    && q.integer * u.integer * 100n === amount * 10n ** BigInt(q.scale + u.scale);
};
const buckets = lines => {
  const result = new Map();
  for (const l of lines) {
    const key = `${l.accountCode}|${l.taxType}|${l.currencyCode}`;
    const b = result.get(key) || { accountCode: l.accountCode, taxType: l.taxType, currencyCode: l.currencyCode, net: 0n, tax: 0n, gross: 0n };
    b.net += BigInt(l.amountCents); b.tax += BigInt(l.taxAmountCents); b.gross += BigInt(l.grossAmountCents); result.set(key, b);
  }
  return [...result].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, b]) => ({ accountCode: b.accountCode, taxType: b.taxType,
    currencyCode: b.currencyCode, netCents: b.net.toString(), taxCents: b.tax.toString(), grossCents: b.gross.toString() }));
};
const numberKey = v => typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
const inactiveSource = v => v.IsDeleted === true || ['Status__c', 'Invoice_Status__c'].some(k => Object.hasOwn(v, k)
  && ['voided', 'deleted', 'cancelled', 'canceled', 'superseded'].includes(String(v[k]).toLowerCase()));
const inactiveTarget = v => v.IsDeleted === true || ['VOIDED', 'DELETED'].includes(v.Status);

/** Server-private, immutable snapshot proof. Completeness declarations are bound
 * and checked for consistency, never independent provider provenance, freshness,
 * financial authority, a cash claim, source-payment link or an executable action.
 * The entire input passes strict bounded JSON copying BEFORE the old builder.
 * Raw Organisation (including legacy provider identity fields) stays private.
 */
export function evaluateSupplierFinancialBucketPreservation(input) {
  const policyVersion = SUPPLIER_FINANCIAL_BUCKET_POLICY;
  const financialBlockers = [], blockers = [];
  const check = (ok, code, path, financial = false) => {
    if (!ok) { const b = { code, path }; if (blockers.length < 80) blockers.push(b); if (financial && financialBlockers.length < 80) financialBlockers.push(b); }
    return Boolean(ok);
  };
  const output = (evidence = null, localClaimScope = null) => freeze({ policyVersion, proofValid: evidence !== null && blockers.length === 0,
    financiallyEquivalent: evidence !== null && financialBlockers.length === 0, workflowEligible: false, approvalGranted: false, accepted: false,
    proposedPayload: null, financialWrites: 0, documentVerification: 'UNVERIFIED',
    fingerprint: evidence === null ? null : hash({ policyVersion, accounting: evidence.accounting }),
    evidenceFingerprint: evidence === null ? null : hash(evidence), evidence, localClaimScope,
    limits: { freshnessEstablished: false, providerCompletenessIndependentlyVerified: false, bankRemittanceProven: false,
      sourcePaymentMatchProven: false, sourceTrackingEquivalenceEstablished: false }, blockers, financialBlockers });
  let original;
  try { original = copyJson(input); } catch { check(false, 'EVIDENCE_JSON_INVALID_OR_BOUND', 'input', true); return output(); }
  try {
    const record = (v, path) => check(plain(v), 'EVIDENCE_INCOMPLETE', path) ? v : {};
    const array = (v, path, max = 1000) => check(Array.isArray(v) && v.length <= max, 'EVIDENCE_ARRAY_INCOMPLETE_OR_BOUND', path) ? v : [];
    const flags = (v, path) => {
      for (const k of ['HasErrors', 'HasValidationErrors', 'IsDeleted']) check(!Object.hasOwn(v, k) || v[k] === false, 'EVIDENCE_ERROR_OR_DELETED', `${path}.${k}`);
      check(!Object.hasOwn(v, 'ValidationErrors') || Array.isArray(v.ValidationErrors) && v.ValidationErrors.length === 0, 'EVIDENCE_ERROR_OR_DELETED', `${path}.ValidationErrors`);
    };
    const noRefund = (v, path) => { if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) {
      check(!['Refunds', 'AmountRefunded'].includes(k), 'REFUND_OUTSIDE_CONTRACT', `${path}.${k}`); noRefund(child, `${path}.${k}`);
    } };
    const source = record(original.source, 'source'), parent = record(source.parent, 'source.parent'), raw = record(original.target, 'target');
    const tenantId = uuid(original.tenantId), salesforceOrgId = sf(source.orgId), sourceId = sf(parent.Id), accountId = sf(parent.Supplier__c), stemId = sf(parent.STEM__c);
    const targetId = uuid(raw.InvoiceID), contactId = uuid(raw.Contact?.ContactID);
    check(original.policyVersion === policyVersion, 'POLICY_UNSUPPORTED', 'policyVersion');
    check(tenantId && salesforceOrgId === sf(fcosSalesforceEnvironment('production').orgId), 'PROVIDER_IDENTITY_UNPROVEN', 'tenantId/source.orgId');
    check(source.salesforceObject === 'Supplier_Invoice__c' && sourceId?.startsWith('a06') && accountId?.startsWith('001') && stemId && targetId && contactId,
      'DOCUMENT_IDENTITY_INVALID', 'source/target');
    const identity = record(original.identity, 'identity'), coverage = record(identity.coverage, 'identity.coverage');
    const children = array(source.children, 'source.children', 100), charges = array(source.charges, 'source.charges', 100), buyers = array(source.buyers, 'source.buyers');
    const rows = [...children, ...charges], mappings = array(original.productMappings, 'productMappings', 100);
    const accounts = array(identity.accounts, 'identity.accounts', 25), contacts = array(identity.contacts, 'identity.contacts', 25);
    const organisation = record(original.organisation, 'organisation'); flags(organisation, 'organisation');
    check(uuid(organisation.OrganisationID) === tenantId && organisation.BaseCurrency === 'USD', 'ORGANISATION_IDENTITY_CURRENCY_UNPROVEN', 'organisation');
    flags(parent, 'source.parent'); flags(raw, 'target'); flags(record(raw.Contact, 'target.Contact'), 'target.Contact'); noRefund(raw, 'target');
    check(parent.IsDeleted === false, 'SOURCE_ACTIVE_STATE_UNPROVEN', 'source.parent.IsDeleted');
    check(text(parent.Name) && text(parent.Supplier__r?.Name) && text(parent.Supplier__r?.Company_Code__c), 'SOURCE_IDENTITY_UNPROVEN', 'source.parent');
    const safety = record(source.safetyContext, 'source.safetyContext');
    check(plain(safety.fields) && CURRENCY_OBJECTS.every(k => Array.isArray(safety.fields[k])) && typeof safety.singleCurrency === 'boolean'
      && Object.hasOwn(safety, 'corporateCurrency') && (safety.singleCurrency === true ? safety.corporateCurrency === 'USD'
        && CURRENCY_OBJECTS.every(k => !safety.fields[k].includes('CurrencyIsoCode')) : safety.corporateCurrency === null), 'SOURCE_CURRENCY_SCHEMA_UNPROVEN', 'source.safetyContext', true);
    const currency = financialSourceCurrency(parent, rows, safety, 'Supplier_Invoice__c');
    check(currency.currency === 'USD' && currency.blockers.length === 0 && raw.CurrencyCode === 'USD' && cents(raw.CurrencyRate) === 100n,
      'CURRENCY_OR_FX_UNSUPPORTED', 'currency', true);
    check(raw.Type === 'ACCPAY' && ['AUTHORISED', 'PAID'].includes(raw.Status), 'TARGET_TYPE_STATUS_UNSUPPORTED', 'target.Type/Status');
    check(aggregateSupplierCalendarDate(raw, 'Date') && aggregateSupplierCalendarDate(raw, 'DueDate'), 'TARGET_CALENDAR_DATE_INVALID', 'target.Date/DueDate');
    const total = cents(parent.Invoice_Amount__c), rawAmounts = rows.map((r, i) => cents(i < children.length ? r.Total_Cost__c : r.Line_Total_Buy__c));
    check(total !== null && total > 0n && cents(raw.Total) === total && cents(raw.SubTotal) === total && cents(raw.TotalTax) === 0n,
      'DOCUMENT_SIGNED_HEADER_MISMATCH', 'headers', true);
    check(raw.LineAmountTypes === 'Exclusive' && raw.IsDiscounted === false, 'TARGET_REPRESENTATION_UNSUPPORTED', 'target.LineAmountTypes/IsDiscounted', true);
    check(rows.length > 0 && rows.every(r => sf(r?.Id)) && new Set(rows.map(r => sf(r.Id))).size === rows.length,
      'SOURCE_LINE_IDENTITY_INCOMPLETE_OR_DUPLICATE', 'source.lines', true);
    check(rawAmounts.every(v => v !== null && v !== 0n) && sum(rawAmounts) === total, 'SOURCE_SIGNED_LINES_HEADER_MISMATCH', 'source.lines', true);
    let payload = null;
    try { payload = supplierFinancialSourcePayload({ parent, children, charges, buyers, safetyContext: safety, productMappings: mappings, contacts }); }
    catch { check(false, 'SOURCE_BUILDER_FAILED', 'source.sourcePayload', true); }
    check(payload && equal(payload, source.sourcePayload) && HASH.test(source.sourceFingerprint || '') && HASH.test(source.financialFingerprint || '')
      && payload.sourceFingerprint === source.sourceFingerprint && payload.financialFingerprint === source.financialFingerprint,
    'ORIGINAL_SOURCE_PAYLOAD_OR_FINGERPRINT_CHANGED', 'source.sourcePayload', true);
    check(payload && payload.salesforceObject === 'Supplier_Invoice__c' && sf(payload.salesforceId) === sourceId && sf(payload.accountId) === accountId
      && sf(payload.stemId) === stemId && uuid(payload.contactId) === contactId && payload.xeroType === 'ACCPAY' && payload.documentKind === 'supplier_bill'
      && payload.currency === 'USD' && payload.postingMode === 'draft' && cents(payload.signedTotal) === total && cents(payload.total) === total,
    'ORIGINAL_SOURCE_HEADER_IDENTITY_CHANGED', 'source.sourcePayload', true);
    check(payload && Array.isArray(payload.blockers) && payload.blockers.length === 0, 'ORIGINAL_SOURCE_FINANCIAL_BLOCKER', 'source.sourcePayload.blockers', true);
    check(payload && Array.isArray(payload.readiness?.blockers) && payload.readiness.blockers.every(b => b === 'Supplier invoice has no verified issued source file.')
      && Array.isArray(payload.readiness.linkedChildren) && equal(payload.readiness.linkedChildren.map(sf).sort(), rows.map(r => sf(r.Id)).sort()),
    'SOURCE_NON_DOCUMENTARY_READINESS_HELD', 'source.sourcePayload.readiness');
    const emitted = payload && Array.isArray(payload.lines) ? payload.lines : [];
    check(emitted.length === rows.length && new Set(emitted.map(r => sf(r.sourceId))).size === rows.length, 'SOURCE_BUILDER_LINE_COVERAGE_CHANGED', 'source.sourcePayload.lines', true);
    const sourceLines = [], grants = new Map();
    for (const [i, r] of rows.entries()) {
      const path = `source.${i < children.length ? 'children' : 'charges'}.${i < children.length ? i : i - children.length}`, lineItem = i < children.length;
      flags(r, path); check(r.IsDeleted === false && r.Cancelled__c === false, 'SOURCE_ACTIVE_STATE_UNPROVEN', path);
      check(sf(r.Supplier_Invoice__c) === sourceId && sf(r.STEM__c) === stemId && sf(lineItem ? r.Original_Supplier__c : r.Supplier__c) === accountId,
        'SOURCE_LINE_OWNERSHIP_CONFLICT', path);
      const productId = sf(lineItem ? r.Product__c : r.Product2Id__c), amount = rawAmounts[i], line = emitted.filter(l => sf(l.sourceId) === sf(r.Id));
      const matches = mappings.filter(m => m.direction === 'supplier' && sf(m.salesforce_product_id) === productId);
      const grant = matches.length === 1 ? matches[0] : {};
      check(productId?.startsWith('01t') && matches.length === 1 && grant.enabled === true && uuid(grant.id) && uuid(grant.approved_by)
        && text(grant.approved_by_email) && text(grant.approved_at) && Number.isFinite(Date.parse(grant.approved_at))
        && Number.isSafeInteger(grant.revision) && grant.revision > 0 && text(grant.xero_account_code) && grant.xero_tax_type === 'NONE',
      'APPROVED_PRODUCT_GRANT_UNPROVEN', path);
      if (productId) grants.set(productId, grant);
      check(line.length === 1 && sf(line[0]?.productId) === productId && line[0]?.sourceType === (lineItem ? 'STEM_Line_Item__c' : 'STEM_Extra_Cost__c')
        && line[0]?.accountCode === grant.xero_account_code && line[0]?.taxType === grant.xero_tax_type
        && accountingProductCents(line[0]?.quantity, line[0]?.unitAmount) === amount, 'SOURCE_BUILDER_RAW_AMOUNT_OR_BUCKET_CHANGED', path, true);
      let calculationBasis = null;
      if (lineItem && exactProduct(r.Quantity_Delivered_Per_BDN__c, r.Unit_Buy_At__c, amount)) {
        calculationBasis = { contract: 'explicit_source_unit_arithmetic_v1', quantityField: 'Quantity_Delivered_Per_BDN__c', quantity: r.Quantity_Delivered_Per_BDN__c,
          unitField: 'Unit_Buy_At__c', unitAmount: r.Unit_Buy_At__c, totalField: 'Total_Cost__c', authoritativeTotal: r.Total_Cost__c };
      } else if (lineItem && decimal(r.Quantity_Delivered_Per_BDN__c)?.integer > 0n && decimal(r.Unit_Buy_At__c)
        && amount !== null && accountingProductCents(r.Quantity_Delivered_Per_BDN__c, r.Unit_Buy_At__c) === amount) {
        const q = decimal(r.Quantity_Delivered_Per_BDN__c), u = decimal(r.Unit_Buy_At__c);
        calculationBasis = { contract: 'explicit_source_unit_usd_half_up_v1', quantityField: 'Quantity_Delivered_Per_BDN__c', quantity: r.Quantity_Delivered_Per_BDN__c,
          unitField: 'Unit_Buy_At__c', unitAmount: r.Unit_Buy_At__c, totalField: 'Total_Cost__c', authoritativeTotal: r.Total_Cost__c,
          unroundedProduct: { integer: (q.integer * u.integer).toString(), scale: q.scale + u.scale }, calculatedAmountCents: amount.toString() };
      } else if (!lineItem && cents(r.Quantity__c) === 100n && Object.hasOwn(r, 'Unit_Cost__c') && (r.Unit_Cost__c === null || cents(r.Unit_Cost__c) === 0n)
        && cents(r.Lumpsum_Cost__c) === amount && amount !== null) {
        calculationBasis = { contract: 'explicit_source_quantity_one_lump_sum_v1', quantity: r.Quantity__c, unitCostPlaceholder: r.Unit_Cost__c,
          lumpSum: r.Lumpsum_Cost__c, authoritativeTotal: r.Line_Total_Buy__c };
      } else if (!lineItem && exactProduct(r.Quantity__c, r.Unit_Cost__c, amount)) {
        calculationBasis = { contract: 'explicit_source_unit_arithmetic_v1', quantityField: 'Quantity__c', quantity: r.Quantity__c,
          unitField: 'Unit_Cost__c', unitAmount: r.Unit_Cost__c, totalField: 'Line_Total_Buy__c', authoritativeTotal: r.Line_Total_Buy__c };
      }
      check(calculationBasis !== null, 'SOURCE_ARITHMETIC_NOT_ESTABLISHED', path, true);
      if (amount !== null && productId && text(grant.xero_account_code)) sourceLines.push({ id: sf(r.Id), productId,
        sourceType: lineItem ? 'STEM_Line_Item__c' : 'STEM_Extra_Cost__c', amountCents: amount.toString(), taxAmountCents: '0', grossAmountCents: amount.toString(),
        accountCode: grant.xero_account_code, taxType: grant.xero_tax_type, currencyCode: 'USD', calculationBasis });
    }
    check(mappings.length === grants.size && new Set(mappings.map(m => uuid(m.id))).size === mappings.length, 'GRANT_SCOPE_EXTRA_OR_DUPLICATE', 'productMappings');
    const accountTax = record(original.accountTax, 'accountTax'), ledgers = array(accountTax.accounts, 'accountTax.accounts', 100), taxes = array(accountTax.taxes, 'accountTax.taxes', 100);
    check(taxes.length === 1 && taxes[0].TaxType === 'NONE' && taxes[0].Status === 'ACTIVE' && taxes[0].CanApplyToExpenses === true
      && cents(taxes[0].DisplayTaxRate) === 0n && cents(taxes[0].EffectiveRate) === 0n, 'TAX_METADATA_UNPROVEN', 'accountTax.taxes');
    const codes = [...new Set(sourceLines.map(l => l.accountCode))].sort();
    check(ledgers.length === codes.length && codes.every(code => ledgers.filter(l => l.Code === code && uuid(l.AccountID) && l.Status === 'ACTIVE'
      && text(l.Type) && (!Object.hasOwn(l, 'CurrencyCode') || l.CurrencyCode === 'USD')).length === 1), 'ACCOUNT_METADATA_UNPROVEN', 'accountTax.accounts');
    ledgers.forEach((l, i) => flags(l, `accountTax.accounts.${i}`)); taxes.forEach((t, i) => flags(t, `accountTax.taxes.${i}`));
    const targetRawLines = array(raw.LineItems, 'target.LineItems', 100), targetLines = [], tracking = [];
    check(targetRawLines.length > 0 && targetRawLines.every(l => uuid(l.LineItemID)) && new Set(targetRawLines.map(l => uuid(l.LineItemID))).size === targetRawLines.length,
      'TARGET_LINE_IDENTITY_INCOMPLETE_OR_DUPLICATE', 'target.LineItems', true);
    for (const [i, l] of targetRawLines.entries()) {
      const amount = cents(l.LineAmount), tax = cents(l.TaxAmount), path = `target.LineItems.${i}`; flags(l, path);
      check(amount !== null && tax === 0n && l.TaxType === 'NONE' && text(l.AccountCode) && exactProduct(l.Quantity, l.UnitAmount, amount), 'TARGET_SIGNED_LINE_ARITHMETIC_UNPROVEN', path, true);
      check(['DiscountRate', 'DiscountAmount'].every(k => !Object.hasOwn(l, k) || cents(l[k]) === 0n)
        && (!Object.hasOwn(l, 'ItemCode') || l.ItemCode === ''), 'TARGET_FINANCIAL_COMPONENT_UNSUPPORTED', path, true);
      const matched = ledgers.filter(a => a.Code === l.AccountCode);
      check(matched.length === 1 && (!Object.hasOwn(l, 'AccountID') || uuid(l.AccountID) === uuid(matched[0]?.AccountID)), 'TARGET_ACCOUNT_IDENTITY_CHANGED', path);
      check(Array.isArray(l.Tracking) && l.Tracking.length <= 2 && l.Tracking.every(t => plain(t) && uuid(t.TrackingCategoryID) && text(t.Name) && text(t.Option)),
        'TARGET_TRACKING_INCOMPLETE', `${path}.Tracking`);
      if (Array.isArray(l.Tracking) && l.Tracking.length) tracking.push({ lineItemId: uuid(l.LineItemID), originalTracking: l.Tracking, sourceEquivalenceEstablished: false });
      if (amount !== null && tax !== null) targetLines.push({ id: uuid(l.LineItemID), amountCents: amount.toString(), taxAmountCents: tax.toString(), grossAmountCents: (amount + tax).toString(),
        accountCode: l.AccountCode, taxType: l.TaxType, currencyCode: raw.CurrencyCode });
    }
    const sourceBuckets = buckets(sourceLines), targetBuckets = buckets(targetLines);
    check(sum(targetLines.map(l => BigInt(l.amountCents))) === cents(raw.SubTotal) && sum(targetLines.map(l => BigInt(l.taxAmountCents))) === cents(raw.TotalTax)
      && sum(targetLines.map(l => BigInt(l.grossAmountCents))) === cents(raw.Total), 'TARGET_SIGNED_LINES_HEADER_MISMATCH', 'target.LineItems', true);
    check(equal(sourceBuckets, targetBuckets), 'SIGNED_ACCOUNT_TAX_CURRENCY_BUCKET_MISMATCH', 'buckets', true);

    // Exact reviewed selection is independent of accounting equality. Current
    // provider acquisition/negative completeness is a later trusted boundary.
    const selection = record(identity.selection, 'identity.selection');
    check(selection.contract === 'supplier_financial_selected_identity_v1' && selection.tenantId === tenantId && selection.salesforceOrgId === salesforceOrgId
      && selection.sourceId === sourceId && selection.stemId === stemId && selection.accountId === accountId && selection.contactId === contactId
      && selection.targetId === targetId && selection.sourceFingerprint === source.sourceFingerprint && selection.financialFingerprint === source.financialFingerprint
      && uuid(selection.reviewedBy) && text(selection.reviewedAt) && Number.isFinite(Date.parse(selection.reviewedAt))
      && text(selection.basis), 'SELECTED_DOCUMENT_IDENTITY_UNPROVEN', 'identity.selection');
    const ownership = derivePetroleumOwnership({ tenantId, accountId, contactId, accounts, contacts, complete: true });
    check(ownership.eligible && ownership.owners?.find(a => a.id === accountId)?.name === parent.Supplier__r?.Name
      && ownership.owners?.find(a => a.id === accountId)?.companyCode === parent.Supplier__r?.Company_Code__c
      && ownership.contact?.name === raw.Contact?.Name, 'CONTACT_OWNER_UNION_UNPROVEN', 'identity');
    check(coverage.scope === 'complete_selected_owner_union_v1' && ['sourceQueryAll', 'sourceComplete', 'targetComplete', 'targetIncludesArchived', 'creditComplete',
      'globalAccountsComplete', 'globalContactsComplete', 'claimsComplete', 'mappingsComplete', 'dependenciesComplete'].every(k => coverage[k] === true)
      && HASH.test(coverage.globalDiscoveryFingerprint || '') && Number.isSafeInteger(coverage.globalAccountCount) && coverage.globalAccountCount >= accounts.length
      && Number.isSafeInteger(coverage.globalContactCount) && coverage.globalContactCount >= contacts.length && Array.isArray(coverage.queryFingerprints)
      && coverage.queryFingerprints.length >= 9 && coverage.queryFingerprints.length <= 20 && coverage.queryFingerprints.every(h => HASH.test(h)), 'IDENTITY_SCOPE_INCOMPLETE', 'identity.coverage');
    const coverageFingerprint = hash(without(identity, 'coverageFingerprint'));
    check(identity.coverageFingerprint === coverageFingerprint && equal(coverage.sourceAccountIds, ownership.sourceAccountIds || [])
      && equal(coverage.stemIds, [stemId]) && equal(coverage.xeroContactIds, [contactId]), 'IDENTITY_SCOPE_BINDING_CHANGED', 'identity.coverageFingerprint');
    const sourceClaims = array(identity.sourceClaims, 'identity.sourceClaims'), targetClaims = array(identity.targetClaims, 'identity.targetClaims'), credits = array(identity.creditClaims, 'identity.creditClaims');
    for (const [kind, claims, id] of [['source', sourceClaims, r => sf(r.Id)], ['target', targetClaims, r => uuid(r.InvoiceID)], ['credit', credits, r => uuid(r.CreditNoteID)]]) {
      check(claims.every(r => plain(r) && id(r)) && new Set(claims.map(id)).size === claims.length && coverage[`${kind}Count`] === claims.length,
        'CLAIM_SCOPE_INCOMPLETE_OR_DUPLICATE', `identity.${kind}Claims`);
    }
    check(sourceClaims.filter(c => sf(c.Id) === sourceId).length === 1 && equal(sourceClaims.find(c => sf(c.Id) === sourceId), parent)
      && targetClaims.filter(c => uuid(c.InvoiceID) === targetId).length === 1 && equal(targetClaims.find(c => uuid(c.InvoiceID) === targetId), raw), 'SELECTED_CLAIM_ORIGINAL_CHANGED', 'identity.claims');
    check(petroleumDistinctStemSuppliers(sourceClaims, stemId, ownership, accounts), 'FOREIGN_STEM_OWNER_UNPROVEN', 'identity.sourceClaims');
    const owners = ownership.sourceAccountIds || [], numbers = new Set([parent.Name, raw.InvoiceNumber, ...String(parent.Name || '').split(' ')].map(numberKey));
    for (const c of sourceClaims) {
      check(sf(c.Supplier__c) && sf(c.STEM__c) && text(c.Name) && typeof c.IsDeleted === 'boolean' && cents(c.Invoice_Amount__c) !== null, 'SOURCE_CLAIM_FACTS_INCOMPLETE', 'identity.sourceClaims');
      if (sf(c.Id) === sourceId || inactiveSource(c) || !owners.includes(sf(c.Supplier__c))) continue;
      check(!numbers.has(numberKey(c.Name)) && !String(c.Name).split(' ').some(n => numbers.has(numberKey(n))),
        'SOURCE_DOCUMENT_IDENTITY_COLLISION', 'identity.sourceClaims');
    }
    for (const c of targetClaims) {
      check(!Object.hasOwn(c, 'IsDeleted') || typeof c.IsDeleted === 'boolean', 'TARGET_CLAIM_FACTS_INCOMPLETE', 'identity.targetClaims.IsDeleted');
      check(['HasErrors', 'HasValidationErrors'].every(k => !Object.hasOwn(c, k) || c[k] === false)
        && (!Object.hasOwn(c, 'ValidationErrors') || Array.isArray(c.ValidationErrors) && c.ValidationErrors.length === 0), 'TARGET_CLAIM_ERROR', 'identity.targetClaims');
      check(uuid(c.Contact?.ContactID) && text(c.InvoiceNumber) && text(c.Reference, true) && ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'DELETED'].includes(c.Status) && c.CurrencyCode === 'USD'
        && cents(c.Total) !== null && aggregateSupplierCalendarDate(c, 'Date'), 'TARGET_CLAIM_FACTS_INCOMPLETE', 'identity.targetClaims');
      if (uuid(c.InvoiceID) === targetId || inactiveTarget(c) || uuid(c.Contact?.ContactID) !== contactId) continue;
      check(!numbers.has(numberKey(c.InvoiceNumber)),
        'TARGET_DOCUMENT_IDENTITY_COLLISION', 'identity.targetClaims');
    }
    for (const c of credits) {
      check(!Object.hasOwn(c, 'IsDeleted') || typeof c.IsDeleted === 'boolean', 'CREDIT_CLAIM_FACTS_INCOMPLETE', 'identity.creditClaims.IsDeleted');
      check(['HasErrors', 'HasValidationErrors'].every(k => !Object.hasOwn(c, k) || c[k] === false)
        && (!Object.hasOwn(c, 'ValidationErrors') || Array.isArray(c.ValidationErrors) && c.ValidationErrors.length === 0), 'CREDIT_CLAIM_ERROR', 'identity.creditClaims');
      check(uuid(c.Contact?.ContactID) && c.Type === 'ACCPAYCREDIT' && c.CurrencyCode === 'USD' && cents(c.Total) !== null && ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'DELETED'].includes(c.Status)
        && text(c.CreditNoteNumber) && text(c.Reference, true) && Array.isArray(c.Allocations), 'CREDIT_CLAIM_FACTS_INCOMPLETE', 'identity.creditClaims');
      check(inactiveTarget(c) || uuid(c.Contact?.ContactID) !== contactId || !numbers.has(numberKey(c.CreditNoteNumber))
        && !(c.Allocations || []).some(a => uuid(a.Invoice?.InvoiceID) === targetId), 'CREDIT_DOCUMENT_CLAIM', 'identity.creditClaims');
    }
    for (const k of ['sourceMappings', 'targetMappings', 'referenceClaims', 'postingClaims', 'disputes']) check(array(identity[k], `identity.${k}`).length === 0, 'LOCAL_OWNERSHIP_OR_UNRESOLVED_CLAIM', `identity.${k}`);

    let ledgerPaymentProof = null;
    if (raw.Status === 'PAID') {
      const l = record(original.ledgerPaymentEvidence, 'ledgerPaymentEvidence');
      ledgerPaymentProof = evaluateSettledSupplierPaymentProof({ tenantId, invoice: raw, payments: l.payments, accounts: l.accounts, organisation });
      check(ledgerPaymentProof.proofValid === true, 'EXISTING_XERO_LEDGER_PROOF_HELD', 'settlement', true);
    } else {
      check(raw.Status === 'AUTHORISED' && cents(raw.AmountPaid) === 0n && cents(raw.AmountCredited) === 0n && cents(raw.AmountDue) === total
        && ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].every(k => Array.isArray(raw[k]) && raw[k].length === 0)
        && !Object.hasOwn(original, 'ledgerPaymentEvidence') && !Object.hasOwn(raw, 'FullyPaidOnDate'), 'AUTHORISED_ZERO_SETTLEMENT_HELD', 'settlement', true);
    }
    const deps = record(original.sourceDependencies, 'sourceDependencies'), payments = array(deps.payments, 'sourceDependencies.payments'), families = array(deps.families, 'sourceDependencies.families');
    const depCoverage = record(deps.coverage, 'sourceDependencies.coverage');
    check(depCoverage.contract === 'complete_supplier_payment_family_scope_v1' && depCoverage.complete === true && depCoverage.queryAll === true
      && depCoverage.sourceId === sourceId && depCoverage.stemId === stemId && depCoverage.accountId === accountId && HASH.test(depCoverage.queryFingerprint || '')
      && depCoverage.paymentCount === payments.length && depCoverage.familyCount === families.length, 'SOURCE_DEPENDENCY_SCOPE_INCOMPLETE', 'sourceDependencies.coverage');
    check(payments.every(p => plain(p) && sf(p.Id) && sf(p.Supplier_Invoice__c) === sourceId && sf(p.STEM__c) === stemId && sf(p.Account__c) === accountId
      && typeof p.IsDeleted === 'boolean' && typeof p.Is_Volume_Discount__c === 'boolean' && (p.Remittance__c === null || sf(p.Remittance__c))), 'SOURCE_DEPENDENCY_FACTS_INCOMPLETE', 'sourceDependencies.payments');
    check(new Set(payments.map(p => sf(p.Id))).size === payments.length && new Set(families.map(p => sf(p.Id))).size === families.length,
      'SOURCE_DEPENDENCY_DUPLICATE', 'sourceDependencies');
    check(payments.every(p => families.every(f => sf(f.Id) !== sf(p.Id) || equal(f, p))), 'SOURCE_DEPENDENCY_ORIGINAL_CONFLICT', 'sourceDependencies');
    const remittances = [...new Set(payments.map(p => sf(p.Remittance__c)).filter(Boolean))].sort();
    check(families.every(p => plain(p) && sf(p.Id) && typeof p.IsDeleted === 'boolean' && (remittances.includes(sf(p.Id)) || remittances.includes(sf(p.Remittance__c))))
      && remittances.every(id => families.some(p => sf(p.Id) === id)), 'REMITTANCE_FAMILY_SCOPE_INCOMPLETE', 'sourceDependencies.families');
    const sourceDependencyHash = hash({ payments, families });
    const localClaimScope = { contract: SUPPLIER_FINANCIAL_CLAIM_CONTRACT, tenantId, salesforceOrgId, sourceId, stemId, targetId,
      sourcePaymentIds: [...new Set([...payments, ...families].map(p => sf(p.Id)).filter(Boolean))].sort(),
      xeroPaymentIds: raw.Status === 'PAID' ? (raw.Payments || []).map(p => uuid(p.PaymentID)).sort() : [], sourceDependencyHash, coverageFingerprint };
    const evidence = { policyVersion, accounting: { contract: SUPPLIER_FINANCIAL_BUCKET_CONTRACT, tenantId, salesforceOrgId, sourceId, stemId, accountId, contactId, targetId,
      currency: 'USD', representation: 'Exclusive', totalCents: total === null ? null : total.toString(), subTotalCents: cents(raw.SubTotal)?.toString() ?? null,
      totalTaxCents: cents(raw.TotalTax)?.toString() ?? null, sourceFingerprint: source.sourceFingerprint, financialFingerprint: source.financialFingerprint,
      source, target: raw, sourceLines, targetLines, sourceBuckets, targetBuckets, productMappings: mappings, accountTax, organisation, identity,
      sourceDependencies: deps, settlement: { contract: raw.Status === 'PAID' ? SETTLED_SUPPLIER_PAYMENT_CONTRACT : ZERO_SETTLEMENT, status: raw.Status, ledgerPaymentProof },
      retainedDifferences: { targetTracking: tracking, sourceTrackingEquivalenceEstablished: false, targetHeaderPresentationRetained: true }, documentVerification: 'UNVERIFIED' } };
    try { copyJson({ evidence, localClaimScope }); } catch { check(false, 'EVIDENCE_JSON_INVALID_OR_BOUND', 'derivedEvidence', true); return output(); }
    return output(evidence, localClaimScope);
  } catch { check(false, 'EVIDENCE_INVALID', 'input', true); return output(); }
}

export function supplierFinancialBucketApprovalMaterial(evidence, localClaimScope) {
  const copied = copyJson({ evidence, localClaimScope });
  return freeze({ policyVersion: SUPPLIER_FINANCIAL_BUCKET_POLICY, evidence: copied.evidence, localClaimScope: copied.localClaimScope });
}

// A canonical review is still preparation. Execution independently checks the
// selected human run approval and freshly collected full material/claim scope.
export function supplierFinancialBucketReview(proof, { reviewFingerprint, legacyReviewFingerprint } = {}) {
  try {
    if (proof?.proofValid !== true || proof.policyVersion !== SUPPLIER_FINANCIAL_BUCKET_POLICY || !HASH.test(reviewFingerprint || '') || !HASH.test(legacyReviewFingerprint || '')) return null;
    const p = copyJson(proof), evidence = p.evidence, localClaimScope = p.localClaimScope, a = evidence.accounting;
    const fresh = evaluateSupplierFinancialBucketPreservation({ policyVersion: p.policyVersion, tenantId: a.tenantId, source: a.source, target: a.target, identity: a.identity,
      organisation: a.organisation, productMappings: a.productMappings, accountTax: a.accountTax, sourceDependencies: a.sourceDependencies,
      ...(a.settlement.status === 'PAID' ? { ledgerPaymentEvidence: { payments: a.settlement.ledgerPaymentProof.evidence.originals.payments,
        accounts: a.settlement.ledgerPaymentProof.evidence.originals.accounts } } : {}) });
    if (!fresh.proofValid || !equal(fresh.evidence, evidence) || !equal(fresh.localClaimScope, localClaimScope)
      || p.fingerprint !== fresh.fingerprint || p.evidenceFingerprint !== fresh.evidenceFingerprint) return null;
    return freeze({ policyVersion: p.policyVersion, fingerprint: p.fingerprint, evidenceFingerprint: p.evidenceFingerprint,
      approvalMaterialHash: hash(supplierFinancialBucketApprovalMaterial(evidence, localClaimScope)), reviewFingerprint, legacyReviewFingerprint, evidence,
      accountingCanonical: canonical({ policyVersion: p.policyVersion, accounting: a }), evidenceCanonical: canonical(evidence),
      localClaimScope, localClaimScopeCanonical: canonical(localClaimScope) });
  } catch { return null; }
}

// This is the ONLY public/business projection; full proof/review/originals must
// remain in service-restricted evidence storage and never reach generic APIs.
export function supplierFinancialBucketDiagnostics(proof) {
  return freeze({ policyVersion: SUPPLIER_FINANCIAL_BUCKET_POLICY, proofValid: proof?.proofValid === true, financiallyEquivalent: proof?.financiallyEquivalent === true,
    workflowEligible: false, approvalGranted: false, proposedPayload: null, financialWrites: 0, documentVerification: 'UNVERIFIED',
    fingerprint: proof?.fingerprint || null, evidenceFingerprint: proof?.evidenceFingerprint || null,
    retainedTargetTrackingLines: proof?.evidence?.accounting?.retainedDifferences?.targetTracking?.length || 0,
    blockers: (proof?.blockers || []).map(b => ({ code: b.code, path: b.path })) });
}
