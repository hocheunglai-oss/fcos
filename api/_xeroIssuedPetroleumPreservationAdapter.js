import { hkStrippedClKeyNameMatchKey, normalizeName } from './_xeroContactSync.js';
import { issuedSupplierSfId as sf, issuedSupplierCents as cents, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';
import { evaluateIssuedPetroleumPreservation, ISSUED_PETROLEUM_PRESERVATION_POLICY as POLICY, issuedPetroleumVessel, issuedPetroleumDecimal } from './_xeroIssuedPetroleumPreservation.js';
import { petroleumScopeFingerprint, petroleumScopeForSource } from './_xeroIssuedPetroleumScope.js';
import { derivePetroleumOwnership, bindPetroleumOwnership, petroleumDistinctStemSuppliers } from './_xeroIssuedPetroleumOwnership.js';

const uuid = (value) => typeof value === 'string' ? value.toLowerCase() : null;
const words = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const claimCents = (value) => {
  if (!['number', 'string'].includes(typeof value)) return null;
  const text = String(value); const amount = cents(text.startsWith('-') ? text.slice(1) : text);
  return amount === null ? null : text.startsWith('-') ? -amount : amount;
};
const numberKey = (value) => typeof value === 'string' && /^[A-Za-z0-9-]+$/.test(value) ? value.replaceAll('-', '') : value;
const hkClaims = (value) => typeof value === 'string' ? value.match(/\bHK\d+[A-Z]\b/gi) || [] : [];
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const reject = (code, message) => ({ eligible: false, policyVersion: POLICY, accepted: false, requiresExplicitReview: true,
  fingerprint: null, evidenceFingerprint: null, evidence: null, blockers: [{ code, path: 'context.petroleum', message }] });
const currencyCode = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
const unique = (rows, key) => new Set(rows.map(key)).size === rows.length;

const sourceVesselDelivery = (row) => {
  const id = sf(row?.STEM__r?.Vessel__c);
  const name = row?.STEM__r?.Vessel__r?.Name;
  const delivery = row?.STEM__r?.Delivery_Date__c;
  return id?.startsWith('a0C') && typeof name === 'string' && name.length <= 1000 && words(name)
    && !/[\u0000-\u001f\u007f-\u009f]/.test(name) && date(delivery)
    ? { id, name: words(name), delivery } : null;
};

function distinctImpreciseSourceClaim(row, parent, source, numbers, currency) {
  const amount = row.Invoice_Amount__c;
  const historicalStem = sf(row.STEM__c); const selectedStem = sf(parent.STEM__c);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount >= 1e12
    || !/^\d{1,12}(?:\.\d+)?$/.test(String(amount)) || claimCents(amount) !== null || currency !== 'USD'
    || !sf(row.Id)?.startsWith('a06') || !historicalStem?.startsWith('a0H') || !selectedStem?.startsWith('a0H')
    || historicalStem === selectedStem || numbers.has(numberKey(row.Name))
    || hkClaims(row.STEM__r?.KeyStem__c).some((key) => key.toUpperCase() === source.stemKey)) return false;
  const selected = sourceVesselDelivery(parent); const historical = sourceVesselDelivery(row);
  return Boolean(selected && historical && selected.id !== historical.id && selected.name !== historical.name
    && selected.delivery !== historical.delivery);
}

export function evaluatePetroleumFinancialDocument(source, candidate, context, fileEvidence) {
  let scope = context?.petroleum;
  if (!source || !candidate || context?.complete !== true || !(context.accountsById instanceof Map) || !(context.members instanceof Map)
    || typeof context.matchesFor !== 'function' || !Array.isArray(context.stored?.productMappings) || !Array.isArray(context.stored?.documentMappings)
    || scope?.policyVersion !== POLICY || scope.tenantId !== context.tenantId || sf(scope.salesforceOrgId) !== sf(fileEvidence?.orgId) || !(scope.sourceFacts instanceof Map)
    || !Array.isArray(scope.sourceClaims) || !Array.isArray(scope.targetClaims) || !Array.isArray(scope.creditClaims)
    || !Array.isArray(scope.accountTax?.accounts) || !Array.isArray(scope.accountTax?.taxRates)) return reject('EVIDENCE_INCOMPLETE', 'Complete current petroleum snapshots are required.');
  let coverage = scope.coverage;
  if (!coverage || ['sourceQueryAll', 'sourceComplete', 'targetComplete', 'creditComplete', 'accountTaxComplete'].some((key) => coverage[key] !== true)
    || !coverage.sourceAccountIds?.includes(sf(source.accountId)) || !coverage.stemIds?.includes(sf(source.stemId))
    || !coverage.xeroContactIds?.includes(uuid(source.contactId)) || coverage.sourceCount !== scope.sourceClaims.length
    || coverage.targetCount !== scope.targetClaims.length || coverage.creditCount !== scope.creditClaims.length
    || !Array.isArray(coverage.queryFingerprints) || coverage.queryFingerprints.length < 6 || coverage.queryFingerprints.some((value) => !/^[a-f0-9]{64}$/.test(value || ''))
    || coverage.contentFingerprint !== petroleumScopeFingerprint(scope)
    || !unique(scope.sourceClaims, (row) => sf(row.Id)) || !unique(scope.targetClaims, (row) => uuid(row.document?.id))
    || !unique(scope.creditClaims, (row) => uuid(row.document?.id))) return reject('IDENTITY_SCOPE_INCOMPLETE', 'All-years identity coverage is incomplete, duplicated or changed.');
  const owners = context.members.get(uuid(source.contactId)) || [];
  let ownershipFields = {};
  let sourceAccountIds = [sf(source.accountId)];
  if (owners.length > 1) {
    const ownership = derivePetroleumOwnership({ tenantId: context.tenantId, accountId: source.accountId, contactId: source.contactId,
      accounts: [...context.accountsById.values()], contacts: context.identityContacts, complete: context.complete });
    if (!ownership.eligible || !ownership.requiresProof) return reject('CONTACT_OWNERSHIP_UNPROVEN', ownership.blockers?.[0]?.message || 'Current potential source ownership is incomplete.');
    if (!petroleumDistinctStemSuppliers(scope.sourceClaims, source.stemId, ownership, [...context.accountsById.values()])) return reject('IDENTITY_SCOPE_INCOMPLETE', 'A same-STEM obligation has an unproven or contradictory supplier identity.');
    try { scope = petroleumScopeForSource(scope, source, ownership); } catch { return reject('IDENTITY_SCOPE_INCOMPLETE', 'All retained source owners must be included in complete all-years history.'); }
    coverage = scope.coverage;
    ownershipFields = bindPetroleumOwnership(ownership, coverage);
    if (!ownershipFields) return reject('CONTACT_OWNERSHIP_UNPROVEN', 'Current document ownership proof could not be bound.');
    sourceAccountIds = ownership.sourceAccountIds;
  }
  const facts = scope.sourceFacts.get(sf(source.salesforceId));
  const parent = facts?.parent; const children = facts?.lines; const product = facts?.product;
  if (!parent || parent.IsDeleted !== false || !Array.isArray(children) || children.length !== 1 || !Array.isArray(facts.extras) || facts.extras.length
    || children[0].IsDeleted !== false || children[0].Cancelled__c !== false || sf(parent.Id) !== sf(source.salesforceId)
    || sf(parent.Supplier__c) !== sf(source.accountId) || sf(parent.STEM__c) !== sf(source.stemId)
    || parent.Name !== source.documentNumber || parent.Invoice_Date__c !== source.invoiceDate || parent.Invoice_Due_Date__c !== source.dueDate
    || parent.STEM__r?.KeyStem__c !== source.stemKey || parent.STEM__r?.Delivery_Date__c !== source.deliveryDate
    || cents(parent.Invoice_Amount__c) === null || cents(parent.Invoice_Amount__c) !== cents(source.groupedAccounting?.total)
    || !product || sf(product.Id) !== sf(children[0].Product__c) || product.Name !== children[0].Product__r?.Name
    || product.RecordType?.DeveloperName !== 'Petroleum_Product') return reject('SOURCE_FACTS_INVALID', 'The exact current single petroleum child, product and parent must agree with the normal snapshot.');
  const child = children[0];
  if (sf(child.Supplier_Invoice__c) !== sf(parent.Id) || sf(child.Original_Supplier__c) !== sf(parent.Supplier__c) || sf(child.STEM__c) !== sf(parent.STEM__c)
    || issuedPetroleumDecimal(child.Quantity_Delivered_Per_BDN__c)?.value <= 0n || !issuedPetroleumDecimal(child.Quantity_Delivered_Per_BDN__c)
    || !issuedPetroleumDecimal(child.Unit_Buy_At__c) || child.Unit_of_Measure__c !== 'MT') return reject('SOURCE_FACTS_INVALID', 'Explicit current BDN quantity, buy price, MT and exact Original_Supplier, invoice and STEM associations are required.');
  const displayLines = source.lines || [];
  const display = displayLines[0]; const rawLine = source.groupedAccounting?.lines?.[0];
  if (displayLines.length !== 1 || source.groupedAccounting?.lines?.length !== 1 || sf(display.sourceId) !== sf(child.Id)
    || sf(display.productId) !== sf(product.Id) || display.productName !== product.Name || sf(rawLine.id) !== sf(child.Id)
    || issuedPetroleumDecimal(rawLine.quantity)?.text !== issuedPetroleumDecimal(child.Quantity_Delivered_Per_BDN__c)?.text
    || issuedPetroleumDecimal(rawLine.unitAmount)?.text !== issuedPetroleumDecimal(child.Unit_Buy_At__c)?.text
    || cents(rawLine.lineAmount) !== cents(child.Total_Cost__c) || rawLine.discountProduct !== false) return reject('SOURCE_CHANGED', 'The raw petroleum projection changed or used fallback quantity/price evidence.');
  const currencyFor = (row) => row.CurrencyIsoCode ?? (scope.currencyContext?.singleCurrency === true ? scope.currencyContext.corporateCurrency : null);
  const currency = currencyFor(parent);
  if (currency !== 'USD' || currencyFor(child) !== 'USD') return reject('CURRENCY_UNSUPPORTED', 'Authoritative raw source and child currency must be USD.');
  const currentParentClaims = scope.sourceClaims.filter((row) => sf(row.Id) === sf(parent.Id));
  const currentTargetClaims = scope.targetClaims.filter(({ document }) => uuid(document?.id) === uuid(candidate.id));
  if (currentParentClaims.length !== 1 || hash(currentParentClaims[0]) !== hash(parent) || currentTargetClaims.length !== 1
    || hash(currentTargetClaims[0].document) !== hash(candidate)) return reject('SNAPSHOT_CHANGED', 'Selected facts differ between the normal and all-years snapshot.');
  const rawTarget = currentTargetClaims[0].raw;
  const account = context.accountsById.get(sf(source.accountId));
  const contacts = account ? context.matchesFor(account) : [];
  const contact = contacts.find((row) => uuid(row.id) === uuid(source.contactId));
  const exactAccount = account && account.name === source.accountName && account.companyCode === (source.companyCode || '')
    && parent.Supplier__r?.Name === source.accountName && parent.Supplier__r?.Company_Code__c === (source.companyCode || '') && account.inactiveSuspended === false;
  const vessel = words(parent.STEM__r?.Vessel__r?.Name); const deliveryDate = parent.STEM__r?.Delivery_Date__c;
  const total = cents(parent.Invoice_Amount__c);
  const numbers = new Set([source.documentNumber, fileEvidence?.review?.printedNumber, candidate.invoiceNumber].filter(Boolean).map(numberKey));
  const sourceEnvelope = scope.sourceClaims.filter((row) => sourceAccountIds.includes(sf(row.Supplier__c))
    && (!currencyCode(currencyFor(row)) || currencyFor(row) === 'USD')
    && (claimCents(row.Invoice_Amount__c) === total || claimCents(row.Invoice_Amount__c) === null)
    // Retain the unmodified row in complete history and stronger-claim checks.
    // Three proven identity differences can exclude a bounded positive numeric
    // tail here without assigning it a rounded amount or changing its sign.
    && !distinctImpreciseSourceClaim(row, parent, source, numbers, currencyFor(row)));
  const targetEnvelope = scope.targetClaims.filter(({ raw }) => uuid(raw?.Contact?.ContactID) === uuid(source.contactId)
    && (!currencyCode(raw.CurrencyCode) || raw.CurrencyCode === 'USD')
    && (claimCents(raw.Total) === total || claimCents(raw.Total) === null));
  const scopeComplete = sourceEnvelope.every((row) => claimCents(row.Invoice_Amount__c) !== null && currencyCode(currencyFor(row))
    && words(row.STEM__r?.Vessel__r?.Name) && sf(row.STEM__r?.Vessel__c) && date(row.STEM__r?.Delivery_Date__c))
    && targetEnvelope.every(({ raw, document }) => claimCents(raw.Total) !== null && typeof raw.CurrencyCode === 'string' && /^[A-Z]{3}$/.test(raw.CurrencyCode)
      && issuedPetroleumVessel(document.invoiceNumber) && date(document.date));
  if (!scopeComplete) return reject('IDENTITY_SCOPE_INCOMPLETE', 'A potentially competing historical obligation has an unknown amount, currency, vessel or delivery date.');
  const sourceScope = sourceEnvelope.filter((row) => currencyFor(row) === 'USD' && row.STEM__r?.Delivery_Date__c === deliveryDate
    && words(row.STEM__r?.Vessel__r?.Name) === vessel);
  const targetScope = targetEnvelope.filter(({ raw, document }) => raw.CurrencyCode === 'USD' && document.date === deliveryDate
    && issuedPetroleumVessel(document.invoiceNumber) === vessel);
  const sourceNumberRows = scope.sourceClaims.filter((row) => sourceAccountIds.includes(sf(row.Supplier__c))
    && (numbers.has(numberKey(row.Name)) || sf(row.STEM__c) === sf(source.stemId)));
  const targetNumberRows = scope.targetClaims.filter(({ raw, document }) => uuid(raw.Contact?.ContactID) === uuid(source.contactId)
    && (numbers.has(numberKey(document.invoiceNumber)) || hkClaims(document.reference).some((claim) => claim.toUpperCase() === source.stemKey)));
  if (scope.creditClaims.some(({ raw }) => raw.Allocations != null && !Array.isArray(raw.Allocations))) return reject('CREDIT_CLAIM', 'Credit allocation evidence is malformed.');
  const creditRows = scope.creditClaims.filter(({ raw, document }) => uuid(raw.Contact?.ContactID) === uuid(source.contactId)
    && (numbers.has(numberKey(document.creditNoteNumber)) || hkClaims(document.reference).some((claim) => claim.toUpperCase() === source.stemKey)
      || (raw.Allocations || []).some((allocation) => uuid(allocation.Invoice?.InvoiceID) === uuid(candidate.id))));
  const accounts = scope.accountTax.accounts.filter((row) => row.Code === '51100');
  const taxes = scope.accountTax.taxRates.filter((row) => row.TaxType === 'NONE');
  if (accounts.length !== 1 || taxes.length !== 1) return reject('LEDGER_AMBIGUOUS', 'Exactly one current petroleum account and tax type are required.');
  const nameMatch = normalizeName(account?.name) === normalizeName(contact?.name);
  const sourceLine = { ...rawLine, quantity: child.Quantity_Delivered_Per_BDN__c, unitAmount: child.Unit_Buy_At__c,
    lineAmount: child.Total_Cost__c, currency, productName: product.Name };
  const deliveryIdentity = { parentId: sf(parent.Id), stemId: sf(parent.STEM__c), stemKey: parent.STEM__r?.KeyStem__c,
    supplierId: sf(parent.Supplier__c), vesselId: sf(parent.STEM__r?.Vessel__c), vessel, deliveryDate, childId: sf(child.Id),
    productId: sf(product.Id), productName: product.Name, productRecordType: product.RecordType.DeveloperName,
    quantity: issuedPetroleumDecimal(child.Quantity_Delivered_Per_BDN__c)?.text, unit: child.Unit_of_Measure__c,
    unitAmount: issuedPetroleumDecimal(child.Unit_Buy_At__c)?.text, lineAmountCents: cents(child.Total_Cost__c)?.toString(), sourceFactsFingerprint: hash(facts) };
  // Xero's complete invoice representation omits optional allocation arrays when empty.
  // An explicit null/malformed value is not an omitted empty collection. Required
  // financial headers must independently prove zero paid/credited and full due.
  const claims = (key) => Object.hasOwn(rawTarget, key) ? rawTarget[key] : [];
  const usedProduct = sf(product.Id);
  return evaluateIssuedPetroleumPreservation({ tenantId: context.tenantId, organisation: context.organisation,
    cutoffDate: context.cutoffDate, fileEvidence, deliveryIdentity, accountTax: { account: accounts[0], tax: taxes[0] },
    source: { ...source, complete: source.groupedAccounting?.policy === 'fcos_notax_accounting_v1', total: parent.Invoice_Amount__c,
      signedTotal: parent.Invoice_Amount__c, subtotal: parent.Invoice_Amount__c, totalTax: 0, lineAmountTypes: 'NoTax', isDiscounted: false, lines: [sourceLine] },
    xero: { ...candidate, ...candidate.groupedAccounting, complete: candidate.groupedAccounting?.complete === true,
      rawLineItems: candidate.lineItems, paymentClaims: claims('Payments'), creditClaims: claims('CreditNotes'), prepaymentClaims: claims('Prepayments'), overpaymentClaims: claims('Overpayments'),
      settlementEvidence: { basis: 'complete_invoice_zero_balances_optional_collections_v1', collections: Object.fromEntries(['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].map((key) => [key, { present: Object.hasOwn(rawTarget, key), rows: claims(key) }])) },
      lines: (candidate.lineItems || []).map((line) => ({ id: line.LineItemID, description: line.Description, quantity: line.Quantity,
        unitAmount: line.UnitAmount, lineAmount: line.LineAmount, accountCode: line.AccountCode, taxType: line.TaxType, taxAmount: line.TaxAmount,
        discountRate: line.DiscountRate ?? 0, discountAmount: line.DiscountAmount ?? 0, tracking: line.Tracking, itemCode: line.ItemCode ?? '' })) },
    productMappings: context.stored.productMappings.filter((row) => row.direction === 'supplier' && sf(row.salesforce_product_id) === usedProduct)
      .map((row) => ({ id: row.id, direction: row.direction, salesforceProductId: row.salesforce_product_id, xeroAccountCode: row.xero_account_code,
        xeroTaxType: row.xero_tax_type, enabled: row.enabled, revision: row.revision, approvedBy: row.approved_by,
        approvedByEmail: row.approved_by_email, approvedAt: row.approved_at })),
    identity: { complete: Boolean(exactAccount), coverageFingerprint: coverage.contentFingerprint, ...ownershipFields,
      candidateContactIds: contacts.map((row) => row.id), accountIdsForContact: (context.members.get(uuid(source.contactId)) || []).map((row) => row.id),
      candidateXeroDocumentIds: targetScope.map(({ document }) => document.id), documentIdentitySourceIds: sourceScope.map((row) => row.Id),
      numberCollisionXeroIds: targetNumberRows.map(({ document }) => document.id), numberCollisionSourceIds: sourceNumberRows.map((row) => row.Id),
      creditCollisionIds: creditRows.map(({ document }) => document.id),
      sourceMappings: context.stored.documentMappings.filter((row) => row.salesforce_object === 'Supplier_Invoice__c' && sf(row.salesforce_id) === sf(source.salesforceId)),
      targetMappings: context.stored.documentMappings.filter((row) => uuid(row.xero_document_id) === uuid(candidate.id)),
      contactIdentity: { salesforceAccountId: account?.id, xeroContactId: contact?.id, status: contact?.status,
        matchBasis: nameMatch ? 'account_name' : 'company_key', sourceMatchValue: nameMatch ? normalizeName(account?.name) : hkStrippedClKeyNameMatchKey(account?.companyCode),
        xeroMatchValue: normalizeName(contact?.name), evidenceFingerprint: hash({ policy: 'fcos_contact_name_v1', account, contact }) } },
  });
}
