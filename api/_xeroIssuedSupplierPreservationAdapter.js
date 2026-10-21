import { hkStrippedClKeyNameMatchKey, normalizeName } from './_xeroContactSync.js';
import { evaluateIssuedSupplierPreservation, ISSUED_SUPPLIER_PRESERVATION_POLICY, issuedSupplierCents,
  issuedSupplierHash, issuedSupplierSfId, issuedSupplierVessel } from './_xeroIssuedSupplierPreservation.js';

const sf = issuedSupplierSfId;
const uuid = (value) => typeof value === 'string' ? value.toLowerCase() : null;
const words = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const sameAmount = (left, right) => issuedSupplierCents(left) !== null && issuedSupplierCents(left) === issuedSupplierCents(right);
const paperNumber = (value) => /^M-\d{2}-\d{2}-\d{3}$/.test(value || '') ? value.replaceAll('-', '') : value;

export const hasIssuedSupplierPreservation = (mapping) => Boolean(mapping?.retained_differences
  && Object.hasOwn(mapping.retained_differences, 'issuedSupplierPreservation'));

// context is produced from complete current server snapshots by the grouped
// context builder. Do not pass browser-created identity scopes here. Sources
// must carry the independently queried current issuedSupplierVessel.
export function evaluateIssuedSupplierFinancialDocument(source, candidate, context, fileEvidence) {
  const unavailable = () => ({ eligible: false, policyVersion: ISSUED_SUPPLIER_PRESERVATION_POLICY, accepted: false,
    fingerprint: null, evidenceFingerprint: null, evidence: null, requiresExplicitReview: true,
    blockers: [{ code: 'EVIDENCE_INCOMPLETE', path: 'context', message: 'Complete current preservation snapshots are required.' }] });
  if (!source || !candidate || !context || !Array.isArray(context.sources) || !Array.isArray(context.documents)
    || !Array.isArray(context.stored?.productMappings) || !Array.isArray(context.stored?.documentMappings)
    || !(context.accountsById instanceof Map) || !(context.members instanceof Map) || typeof context.matchesFor !== 'function') return unavailable();
  const account = context.accountsById.get(sf(source.accountId));
  const contactMatches = account ? context.matchesFor(account) : [];
  if (!Array.isArray(contactMatches)) return unavailable();
  const contact = contactMatches.find((row) => uuid(row.id) === uuid(source.contactId));
  const exactAccount = account && account.name === source.accountName && account.companyCode === (source.companyCode || '');
  const rawSource = source.groupedAccounting;
  const rawXero = candidate.groupedAccounting;
  const vessel = words(source.issuedSupplierVessel);
  // Reuse the existing financial matcher's known HK STEM token shape. A
  // stronger contradictory reference cannot be waived by date/amount/vessel.
  // Only the authoritative stemKey may resolve it; never infer from stemName.
  const stemClaims = typeof candidate.reference === 'string' ? candidate.reference.match(/\bHK\d+[A-Z]\b/gi) || [] : [];
  if (stemClaims.length && (!/^HK\d+[A-Z]$/i.test(source.stemKey || '')
    || stemClaims.some((claim) => normalizeName(claim) !== normalizeName(source.stemKey)))) {
    return { ...unavailable(), blockers: [{ code: 'STEM_REFERENCE_CONFLICT', path: 'xero.reference',
      message: 'The historical Xero reference contains a different or unverified exact STEM identity.' }] };
  }
  const sourceScope = context.sources.filter((row) => row.salesforceObject === 'Supplier_Invoice__c'
    && sf(row.accountId) === sf(source.accountId) && row.invoiceDate === source.invoiceDate
    && row.currency === source.currency && sameAmount(row.groupedAccounting?.total, rawSource?.total));
  const targetScope = context.documents.filter((row) => row.type === 'ACCPAY' && uuid(row.contactId) === uuid(source.contactId)
    && row.date === source.invoiceDate && row.currency === source.currency && sameAmount(row.groupedAccounting?.total, rawSource?.total));
  // An unknown vessel on another same-date/amount obligation is not evidence
  // that it is different. Incomplete competing identities fail closed.
  const scopeComplete = sourceScope.every((row) => words(row.issuedSupplierVessel))
    && targetScope.every((row) => issuedSupplierVessel(row.invoiceNumber));
  const numbers = new Set([source.documentNumber, fileEvidence?.review?.printedNumber, candidate.invoiceNumber].filter((value) => typeof value === 'string'));
  const usedProducts = new Set((source.lines || []).map((row) => sf(row.productId)));
  const sourceLines = Array.isArray(rawSource?.lines) ? rawSource.lines.map((line) => ({ ...line,
    productName: source.lines?.find((row) => sf(row.sourceId) === sf(line.id))?.productName })) : null;
  const targetLines = Array.isArray(candidate.lineItems) ? candidate.lineItems.map((line) => ({
    id: line.LineItemID, description: line.Description, quantity: line.Quantity, unitAmount: line.UnitAmount,
    lineAmount: line.LineAmount, accountCode: line.AccountCode, taxType: line.TaxType, taxAmount: line.TaxAmount,
    discountRate: line.DiscountRate ?? 0, discountAmount: line.DiscountAmount ?? 0,
    tracking: line.Tracking, itemCode: line.ItemCode ?? '',
  })) : null;
  const nameMatch = normalizeName(account?.name) === normalizeName(contact?.name);
  return evaluateIssuedSupplierPreservation({
    tenantId: context.tenantId, organisation: context.organisation, cutoffDate: context.cutoffDate, fileEvidence,
    source: { ...source, complete: rawSource?.policy === 'fcos_notax_accounting_v1' && Array.isArray(sourceLines)
      && sourceLines.every((line) => line.discountProduct === false),
    total: rawSource?.total, signedTotal: rawSource?.total, subtotal: rawSource?.total, totalTax: 0,
    lineAmountTypes: 'NoTax', isDiscounted: false, lines: sourceLines },
    xero: { ...candidate, ...rawXero, complete: rawXero?.complete === true, lines: targetLines, rawLineItems: candidate.lineItems },
    productMappings: context.stored.productMappings.filter((row) => row.direction === 'supplier' && usedProducts.has(sf(row.salesforce_product_id)))
      .map((row) => ({ id: row.id, direction: row.direction, salesforceProductId: row.salesforce_product_id,
        xeroAccountCode: row.xero_account_code, xeroTaxType: row.xero_tax_type, enabled: row.enabled, revision: row.revision })),
    identity: { complete: context.complete === true && Boolean(exactAccount) && scopeComplete,
      candidateContactIds: contactMatches.map((row) => row.id),
      accountIdsForContact: (context.members.get(uuid(source.contactId)) || []).map((row) => row.id),
      candidateXeroDocumentIds: targetScope.filter((row) => issuedSupplierVessel(row.invoiceNumber) === vessel).map((row) => row.id),
      documentIdentitySourceIds: sourceScope.filter((row) => words(row.issuedSupplierVessel) === vessel).map((row) => row.salesforceId),
      numberCollisionXeroIds: context.documents.filter((row) => row.type === 'ACCPAY' && uuid(row.contactId) === uuid(source.contactId)
        && (numbers.has(row.invoiceNumber) || paperNumber(row.invoiceNumber) === source.documentNumber)).map((row) => row.id),
      numberCollisionSourceIds: context.sources.filter((row) => row.salesforceObject === 'Supplier_Invoice__c' && sf(row.accountId) === sf(source.accountId)
        && (numbers.has(row.documentNumber) || paperNumber(row.documentNumber) === source.documentNumber)).map((row) => row.salesforceId),
      contactIdentity: { salesforceAccountId: account?.id, xeroContactId: contact?.id, status: contact?.status,
        matchBasis: nameMatch ? 'account_name' : 'company_key', sourceMatchValue: nameMatch ? normalizeName(account?.name) : hkStrippedClKeyNameMatchKey(account?.companyCode),
        xeroMatchValue: normalizeName(contact?.name), evidenceFingerprint: issuedSupplierHash({ policy: 'fcos_contact_name_v1', account, contact }) },
      sourceMappings: context.stored.documentMappings.filter((row) => row.salesforce_object === 'Supplier_Invoice__c' && sf(row.salesforce_id) === sf(source.salesforceId)),
      targetMappings: context.stored.documentMappings.filter((row) => uuid(row.xero_document_id) === uuid(candidate.id)),
    },
  });
}
