import { createHash } from 'node:crypto';
import { evaluateGroupedPreservation, GROUPED_PRESERVATION_POLICY, groupedPreservationAccountingFingerprint } from './_xeroGroupedPreservation.js';
import { hkStrippedClKeyNameMatchKey, normalizeName } from './_xeroContactSync.js';

const canonicalSf = (value) => typeof value === 'string' && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value) ? value.slice(0, 15) : null;
const canonicalXero = (value) => typeof value === 'string' ? value.toLowerCase() : null;
export const groupedInvoiceNumber = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const hash = (value) => createHash('sha256').update(stable(value)).digest('hex');
const accountKeys = (account) => [...new Set([normalizeName(account.name), hkStrippedClKeyNameMatchKey(account.companyCode)].filter(Boolean))];

// This is a second, strict accounting projection; never modify source.lines or
// the old legacy fingerprint. No fallback reconstructs a missing source total,
// quantity or unit price. Extra-cost lump sums without explicit quantity fail.
export function groupedSourceAccounting(record, children, direction, source, context) {
  const buyer = direction === 'buyer';
  return { policy: 'fcos_notax_accounting_v1', total: buyer ? record.Amount__c : record.Invoice_Amount__c,
    lines: children.map((child) => {
      const product = Boolean(child.Product__c);
      const line = source.lines.find((item) => item.sourceId === child.Id);
      const childCurrency = child.CurrencyIsoCode ?? (context.singleCurrency === true ? context.corporateCurrency : null);
      const delivered = child.Quantity_Delivered_Per_BDN__c;
      return { id: child.Id, productId: child.Product__c || child.Product2Id__c, currency: childCurrency,
        // STEM product total formulas use explicit Quantity when BDN is blank or
        // zero, and Unit_Sell_At / Unit_Buy_At (not the legacy price/cost fields).
        quantity: delivered == null || (product && delivered === 0) ? child.Quantity__c : delivered,
        unitAmount: buyer ? (product ? child.Unit_Sell_At__c : child.Unit_Price__c ?? child.Lumpsum_Price__c)
          : (product ? child.Unit_Buy_At__c : child.Unit_Cost__c ?? child.Lumpsum_Cost__c),
        lineAmount: buyer ? (product ? child.Total_Price__c : child.Line_Total__c) : (product ? child.Total_Cost__c : child.Line_Total_Buy__c),
        description: line?.description, accountCode: line?.accountCode, taxType: line?.taxType,
        // FCOS's approved accounting projection has no discounts, tax amounts,
        // tracking or inventory items. Positive explicit source totals must also
        // reconcile to raw quantity/price and header, so no tax or discount delta
        // can be hidden by the existing tolerant/reconstructed update projection.
        taxAmount: 0, discountRate: 0, discountAmount: 0, tracking: [], itemCode: '',
        discountProduct: /\bdiscount\b/i.test(String(child.Product__r?.Name || child.Product2Id__r?.Name || '')),
      };
    }) };
}

export function completeGroupedAccountSnapshot(result) {
  if (result?.error || !Array.isArray(result?.records) || !Number.isSafeInteger(result.totalSize)
    || result.totalSize !== result.records.length || result.records.length > 100000) return { complete: false, accounts: [] };
  const accounts = result.records.map((row) => ({ id: row.Id, name: row.Name, companyCode: row.Company_Code__c ?? '',
    inactiveSuspended: row.Inactive_Suspended__c, recordType: row.RecordType?.DeveloperName || row['RecordType.DeveloperName'] || '' }));
  if (accounts.some((row) => !canonicalSf(row.id) || typeof row.name !== 'string' || !row.name.trim())
    || new Set(accounts.map((row) => canonicalSf(row.id))).size !== accounts.length) return { complete: false, accounts: [] };
  return { complete: true, accounts };
}

export function hasGroupedPreservation(mapping) {
  return Boolean(mapping?.retained_differences && Object.hasOwn(mapping.retained_differences, 'groupedPreservation'));
}

export function buildGroupedPreservationContext(salesforce, xero, stored, sources) {
  const accounts = salesforce.groupedAccountSnapshot?.accounts || [];
  const contacts = xero.contacts || [];
  const contactsByName = new Map();
  for (const contact of contacts.filter((row) => row.status === 'ACTIVE')) {
    const key = normalizeName(contact.name);
    const matches = contactsByName.get(key) || [];
    matches.push(contact); contactsByName.set(key, matches);
  }
  const matchesFor = (account) => [...new Map(accountKeys(account).flatMap((key) => contactsByName.get(key) || [])
    .map((contact) => [canonicalXero(contact.id), contact])).values()];
  const members = new Map();
  for (const account of accounts) for (const contact of matchesFor(account)) {
    const key = canonicalXero(contact.id); const rows = members.get(key) || [];
    rows.push(account); members.set(key, rows);
  }
  const accountsById = new Map(accounts.map((account) => [canonicalSf(account.id), account]));
  const contactIds = contacts.map((contact) => canonicalXero(contact.id));
  const complete = salesforce.groupedAccountSnapshot?.complete === true && xero.contactsComplete === true
    && /^\d{4}-\d{2}-\d{2}$/.test(salesforce.cutoffDate || '') && salesforce.cutoffDate === xero.cutoffDate
    && new Set(contactIds).size === contacts.length && contactIds.every(Boolean);
  return { tenantId: xero.tenantId, complete, accountsById, matchesFor, members, sources, stored,
    cutoffDate: salesforce.cutoffDate, documents: xero.documents || [], organisation: xero.organisation || {} };
}

function ownershipRow(mapping, tenantId) {
  const saved = mapping.retained_differences?.groupedPreservation;
  const validProof = saved?.policyVersion === GROUPED_PRESERVATION_POLICY && saved.evidence
    && saved.fingerprint === groupedPreservationAccountingFingerprint(saved.evidence)
    && saved.evidenceFingerprint === hash(saved.evidence)
    && saved.evidence.policyVersion === GROUPED_PRESERVATION_POLICY
    && saved.evidence.accounting?.tenantId === tenantId
    && /^[a-f0-9]{64}$/.test(saved.reviewFingerprint || '');
  return { id: mapping.id, tenantId: saved?.evidence?.accounting?.tenantId || tenantId,
    salesforceObject: mapping.salesforce_object, salesforceId: mapping.salesforce_id,
    xeroDocumentId: mapping.xero_document_id, xeroDocumentType: mapping.xero_document_type,
    xeroContactId: mapping.xero_contact_id, accountId: mapping.retained_differences?.accountId,
    sourceFingerprint: mapping.source_fingerprint, protectedLegacy: mapping.protected_legacy,
    policyVersion: saved?.policyVersion, acceptedFingerprint: validProof ? saved.fingerprint : null };
}

export function evaluateGroupedFinancialDocument(source, candidate, context) {
  if (!context) return { eligible: false, blockers: [{ message: 'Complete current grouped-preservation identity and accounting evidence is unavailable.' }] };
  if (!context.cutoffDate || !source.invoiceDate || source.invoiceDate < context.cutoffDate) {
    return { eligible: false, blockers: [{ code: 'IDENTITY_SCOPE_INCOMPLETE', message: 'The source invoice date must be inside the verified complete accounting-date scope.' }] };
  }
  const account = context.accountsById.get(canonicalSf(source.accountId));
  const contactMatches = account ? context.matchesFor(account) : [];
  const contact = contactMatches.find((row) => canonicalXero(row.id) === canonicalXero(source.contactId));
  const exactSourceAccount = account && account.name === source.accountName && account.companyCode === (source.companyCode || '');
  const accounting = source.groupedAccounting;
  const raw = candidate.groupedAccounting;
  const input = {
    tenantId: context.tenantId, organisation: context.organisation,
    source: { ...source, complete: Boolean(Array.isArray(accounting?.lines) && accounting.policy === 'fcos_notax_accounting_v1'
      && !accounting.lines.some((line) => line.discountProduct)),
    subtotal: accounting?.total, total: accounting?.total, signedTotal: accounting?.total,
    totalTax: 0, lineAmountTypes: 'NoTax', isDiscounted: false,
    readiness: { ready: source.readiness?.ready, evidenceFingerprint: hash(source.readiness || {}) }, lines: accounting?.lines },
    xero: { ...candidate, ...raw, complete: raw?.complete === true, lines: (candidate.lineItems || []).map((line) => ({
      id: line.LineItemID, description: line.Description, quantity: line.Quantity, unitAmount: line.UnitAmount,
      lineAmount: line.LineAmount, accountCode: line.AccountCode, taxType: line.TaxType, taxAmount: line.TaxAmount,
      // Xero omits these optional fields on non-discounted/non-inventory lines.
      // Header IsDiscounted and required complete financial headers still gate use.
      discountRate: line.DiscountRate ?? 0, discountAmount: line.DiscountAmount ?? 0,
      tracking: line.Tracking, itemCode: line.ItemCode ?? '',
    })) },
    productMappings: context.stored.productMappings.filter((mapping) => source.lines.some((line) => canonicalSf(line.productId) === canonicalSf(mapping.salesforce_product_id))
      && mapping.direction === (source.salesforceObject === 'Invoice__c' ? 'buyer' : 'supplier'))
      .map((mapping) => ({ id: mapping.id, direction: mapping.direction, salesforceProductId: mapping.salesforce_product_id,
        xeroAccountCode: mapping.xero_account_code, xeroTaxType: mapping.xero_tax_type, enabled: mapping.enabled, revision: mapping.revision })),
    identity: {
      complete: context.complete && Boolean(exactSourceAccount), matchBasis: 'invoice_number',
      candidateContactIds: contactMatches.map((row) => row.id),
      accountIdsForContact: (context.members.get(canonicalXero(source.contactId)) || []).map((row) => row.id),
      candidateXeroDocumentIds: context.documents.filter((row) => row.type === source.xeroType
        && groupedInvoiceNumber(row.invoiceNumber) === groupedInvoiceNumber(source.documentNumber)
        && (source.xeroType !== 'ACCPAY' || canonicalXero(row.contactId) === canonicalXero(source.contactId))).map((row) => row.id),
      documentIdentitySourceIds: context.sources.filter((row) => row.xeroType === source.xeroType
        && groupedInvoiceNumber(row.documentNumber) === groupedInvoiceNumber(source.documentNumber)
        && (source.xeroType !== 'ACCPAY' || canonicalSf(row.accountId) === canonicalSf(source.accountId))).map((row) => row.salesforceId),
      contactIdentity: { salesforceAccountId: account?.id, xeroContactId: contact?.id, status: contact?.status,
        matchBasis: normalizeName(account?.name) === normalizeName(contact?.name) ? 'account_name' : 'company_key',
        sourceMatchValue: normalizeName(account?.name) === normalizeName(contact?.name) ? normalizeName(account?.name) : hkStrippedClKeyNameMatchKey(account?.companyCode),
        xeroMatchValue: normalizeName(contact?.name), evidenceFingerprint: hash({ policy: 'fcos_contact_name_v1', account, contact }) },
      sourceMappings: context.stored.documentMappings.filter((mapping) => canonicalSf(mapping.salesforce_id) === canonicalSf(source.salesforceId)).map((mapping) => ownershipRow(mapping, context.tenantId)),
      targetMappings: context.stored.documentMappings.filter((mapping) => canonicalXero(mapping.xero_document_id) === canonicalXero(candidate.id)).map((mapping) => ownershipRow(mapping, context.tenantId)),
    },
  };
  return evaluateGroupedPreservation(input);
}

export function groupedPreservationReview(result) {
  if (!result.eligible) return { policyVersion: GROUPED_PRESERVATION_POLICY, eligible: false, fingerprint: null,
    blockerCodes: [...new Set(result.blockers.map((blocker) => blocker.code).filter(Boolean))] };
  return { policyVersion: result.policyVersion, eligible: true, fingerprint: result.fingerprint,
    evidenceFingerprint: hash(result.evidence), accepted: result.accepted,
    sourceLineCount: result.evidence.accounting.source.lines.length, xeroLineCount: result.evidence.accounting.xero.lines.length,
    groupedTotals: result.evidence.accounting.groupedTotals, requiresExplicitReview: true };
}
