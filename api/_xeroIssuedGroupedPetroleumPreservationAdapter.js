import { normalizeXeroInvoice, normalizeXeroCreditNote } from './_xeroFinancialSync.js';
import { hkStrippedClKeyNameMatchKey, normalizeName } from './_xeroContactSync.js';
import { issuedSupplierSfId as sf, issuedSupplierCents as cents, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';
import { issuedPetroleumVessel, issuedPetroleumDecimal } from './_xeroIssuedPetroleumPreservation.js';
import { evaluateIssuedGroupedPetroleumPreservation, ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY as POLICY } from './_xeroIssuedGroupedPetroleumPreservation.js';
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
  fingerprint: null, evidenceFingerprint: null, evidence: null, blockers: [{ code, path: 'context.groupedPetroleum', message }] });
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

// Bind the entire captured batch before deterministic per-document projection.
export function issuedGroupedPetroleumScopeFingerprint(scope) {
  const coverage = scope?.coverage ? { ...scope.coverage } : null;
  if (coverage) delete coverage.contentFingerprint;
  return hash({ policyVersion: scope?.policyVersion, salesforceOrgId: scope?.salesforceOrgId, tenantId: scope?.tenantId,
    sourceFacts: scope?.sourceFacts instanceof Map ? [...scope.sourceFacts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : null,
    currencyContext: scope?.currencyContext, sourceClaims: scope?.sourceClaims, targetClaims: scope?.targetClaims, creditClaims: scope?.creditClaims, accountTax: scope?.accountTax, coverage });
}
const sourceOwner = (row, buyer) => buyer ? row?.STEM__r?.Account__c : row?.Supplier__c;
const sourceAmount = (row, buyer) => row?.[buyer ? 'Amount__c' : 'Invoice_Amount__c'];
const sourceObjectFor = direction => direction === 'buyer' ? 'Invoice__c' : 'Supplier_Invoice__c';
const targetVessel = (document, buyer) => buyer ? words(document?.reference) : issuedPetroleumVessel(document?.invoiceNumber);

function distinctImpreciseSourceClaim(row, parent, source, numbers, currency, buyer) {
  const amount = sourceAmount(row, buyer); const historicalStem = sf(row.STEM__c); const selectedStem = sf(parent.STEM__c);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount >= 1e12
    || !/^\d{1,12}(?:\.\d+)?$/.test(String(amount)) || claimCents(amount) !== null || currency !== 'USD'
    || !sf(row.Id)?.startsWith(buyer ? 'a0K' : 'a06') || !historicalStem?.startsWith('a0H') || !selectedStem?.startsWith('a0H')
    || historicalStem === selectedStem || numbers.has(numberKey(row.Name))
    || hkClaims(row.STEM__r?.KeyStem__c).some(key => key.toUpperCase() === source.stemKey)) return false;
  const selected = sourceVesselDelivery(parent); const historical = sourceVesselDelivery(row);
  return Boolean(selected && historical && selected.id !== historical.id && selected.name !== historical.name && selected.delivery !== historical.delivery);
}

function evaluate(source, candidate, context, fileEvidence) {
  const buyer = source?.salesforceObject === 'Invoice__c'; const direction = buyer ? 'buyer' : 'supplier';
  const sourceObject = sourceObjectFor(direction); const accountCode = buyer ? '41100' : '51100';
  if (!['Invoice__c', 'Supplier_Invoice__c'].includes(source?.salesforceObject)) return reject('DIRECTION_INVALID', 'An exact buyer or supplier document is required.');
  let scope = context?.groupedPetroleum;
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
    || coverage.contentFingerprint !== issuedGroupedPetroleumScopeFingerprint(scope)
    || scope.sourceClaims.some(row => !['buyer', 'supplier'].includes(row?.direction) || row.salesforceObject !== sourceObjectFor(row.direction) || !sf(row.raw?.Id))
    || !unique(scope.sourceClaims, row => `${row.salesforceObject}:${sf(row.raw?.Id)}`) || !unique(scope.targetClaims, (row) => uuid(row.document?.id))
    || !unique(scope.creditClaims, (row) => uuid(row.document?.id))) return reject('IDENTITY_SCOPE_INCOMPLETE', 'All-years identity coverage is incomplete, duplicated or changed.');
  if (scope.targetClaims.some(row => !row.raw || hash(normalizeXeroInvoice(row.raw)) !== hash(row.document))
    || scope.creditClaims.some(row => !row.raw || hash(normalizeXeroCreditNote(row.raw)) !== hash(row.document))) return reject('SNAPSHOT_CHANGED', 'Raw and normalized current Xero history disagree.');
  if (!Array.isArray(coverage.sourceObjects) || !Array.isArray(coverage.sourceAccountIds) || !Array.isArray(coverage.stemIds) || !Array.isArray(coverage.xeroContactIds)
    || scope.sourceClaims.some(({ direction: kind, salesforceObject, raw }) => !coverage.sourceObjects.includes(salesforceObject)
      || !sf(raw?.Id)?.startsWith(kind === 'buyer' ? 'a0K' : 'a06')
      || (!coverage.sourceAccountIds.includes(sf(sourceOwner(raw, kind === 'buyer'))) && !coverage.stemIds.includes(sf(raw?.STEM__c))))
    || scope.targetClaims.some(({ document }) => !['ACCREC', 'ACCPAY'].includes(document.type) || !coverage.xeroContactIds.includes(uuid(document.contactId)))
    || scope.creditClaims.some(({ document }) => !['ACCRECCREDIT', 'ACCPAYCREDIT'].includes(document.type) || !coverage.xeroContactIds.includes(uuid(document.contactId)))) return reject('IDENTITY_SCOPE_INCOMPLETE', 'Typed history must stay inside the complete queried owner and Contact scope.');
  if (scope.creditClaims.some(({ raw }) => (Object.hasOwn(raw, 'Allocations') && !Array.isArray(raw.Allocations))
    || (raw.Allocations || []).some(row => uuid(row?.Invoice?.InvoiceID) === uuid(candidate.id)))) return reject('CREDIT_CLAIM', 'Current credit allocation evidence is malformed or claims this target.');
  const ownership = derivePetroleumOwnership({ tenantId: context.tenantId, accountId: source.accountId, contactId: source.contactId,
    accounts: [...context.accountsById.values()], contacts: context.identityContacts, complete: context.complete });
  if (!ownership.eligible) return reject('CONTACT_OWNERSHIP_UNPROVEN', ownership.blockers?.[0]?.message || 'Current source ownership is incomplete.');
  const sourceAccountIds = ownership.sourceAccountIds;
  if (!sourceAccountIds.every(id => coverage.sourceAccountIds.includes(id))) return reject('IDENTITY_SCOPE_INCOMPLETE', 'Every retained source owner must have complete all-years history.');
  const typedClaims = scope.sourceClaims.filter(row => row.salesforceObject === sourceObject && row.direction === direction).map(row => row.raw);
  if (!buyer && !petroleumDistinctStemSuppliers(typedClaims, source.stemId, ownership, [...context.accountsById.values()])) return reject('IDENTITY_SCOPE_INCOMPLETE', 'A same-STEM supplier claim has unknown or contradictory ownership.');
  if (buyer && typedClaims.some(row => sf(row.STEM__c) === sf(source.stemId) && sf(sourceOwner(row, true)) !== sf(source.accountId))) return reject('IDENTITY_SCOPE_INCOMPLETE', 'A same-STEM buyer claim has contradictory ownership.');
  const sourceClaims = typedClaims.filter(row => sourceAccountIds.includes(sf(sourceOwner(row, buyer))) || sf(row.STEM__c) === sf(source.stemId));
  const targetClaims = scope.targetClaims.filter(row => uuid(row.document?.contactId) === uuid(source.contactId) && row.document?.type === source.xeroType);
  const creditType = buyer ? 'ACCRECCREDIT' : 'ACCPAYCREDIT';
  const creditClaims = scope.creditClaims.filter(row => uuid(row.document?.contactId) === uuid(source.contactId) && row.document?.type === creditType);
  const facts = scope.sourceFacts.get(sf(source.salesforceId));
  const logical = { direction, sourceObject, sourceId: sf(source.salesforceId), sourceAccountIds, stemId: sf(source.stemId), contactId: uuid(source.contactId) };
  const logicalCoverage = { ...coverage, sourceAccountIds, stemIds: [sf(source.stemId)], xeroContactIds: [uuid(source.contactId)], sourceObjects: [sourceObject],
    sourceCount: sourceClaims.length, targetCount: targetClaims.length, creditCount: creditClaims.length,
    queryFingerprints: ['Organization','typedParents:queryAll','physicalAndExtras:queryAll','Products','Invoices:allYearsArchived','CreditNotes:allYears','Accounts','TaxRates'].map(query => hash({ policy: POLICY, query, ...logical })) };
  scope = { ...scope, sourceFacts: new Map([[sf(source.salesforceId), facts]]), sourceClaims: sourceClaims.map(raw => ({ direction, salesforceObject: sourceObject, raw })), targetClaims, creditClaims,
    accountTax: { accounts: scope.accountTax.accounts.filter(row => row.Code === accountCode), taxRates: scope.accountTax.taxRates.filter(row => row.TaxType === 'NONE') }, coverage: logicalCoverage };
  logicalCoverage.contentFingerprint = issuedGroupedPetroleumScopeFingerprint(scope); coverage = logicalCoverage;
  const ownershipFields = ownership.requiresProof ? bindPetroleumOwnership(ownership, coverage) : {};
  if (!ownershipFields) return reject('CONTACT_OWNERSHIP_UNPROVEN', 'Current ownership proof cannot be bound.');
  const parent = facts?.parent; const children = facts?.lines; const products = facts?.products;
  if (!parent || facts.direction !== direction || parent.IsDeleted !== false || !Array.isArray(children) || children.length < 2 || children.length > 50
    || !Array.isArray(products) || !Array.isArray(facts.extras) || facts.extras.length || !Array.isArray(facts.stemLines) || !Array.isArray(facts.stemExtras)
    || sf(parent.Id) !== sf(source.salesforceId) || sf(sourceOwner(parent, buyer)) !== sf(source.accountId) || sf(parent.STEM__c) !== sf(source.stemId)
    || parent.Name !== source.documentNumber || parent.Invoice_Date__c !== source.invoiceDate || parent.Invoice_Due_Date__c !== source.dueDate
    || parent.STEM__r?.KeyStem__c !== source.stemKey || parent.STEM__r?.Delivery_Date__c !== source.deliveryDate
    || cents(sourceAmount(parent, buyer)) === null || cents(sourceAmount(parent, buyer)) !== cents(source.groupedAccounting?.total)) return reject('SOURCE_FACTS_INVALID', 'Complete raw physical parent, child and product facts must agree with the normal snapshot.');
  const displayLines = source.lines; const rawLines = source.groupedAccounting?.lines;
  if (!Array.isArray(displayLines) || !Array.isArray(rawLines) || displayLines.length !== children.length || rawLines.length !== children.length
    || !unique(children, child => sf(child?.Id)) || !unique(displayLines, line => sf(line?.sourceId)) || !unique(rawLines, line => sf(line?.id))) return reject('SOURCE_CHANGED', 'The complete current child identity sets differ.');
  const sourceLines = [];
  for (const child of children) {
    const productRows = products.filter(row => sf(row?.Id) === sf(child.Product__c)); const product = productRows[0];
    const display = displayLines.find(row => sf(row.sourceId) === sf(child.Id)); const rawLine = rawLines.find(row => sf(row.id) === sf(child.Id));
    if (productRows.length !== 1 || !product || !display || !rawLine || sf(display.productId) !== sf(product.Id) || display.productName !== product.Name
      || child.Product__r?.Name !== product.Name || sf(rawLine.productId) !== sf(product.Id) || rawLine.discountProduct !== false
      || issuedPetroleumDecimal(rawLine.quantity)?.text !== issuedPetroleumDecimal(child.Quantity_Delivered_Per_BDN__c)?.text
      || issuedPetroleumDecimal(rawLine.unitAmount)?.text !== issuedPetroleumDecimal(child[buyer ? 'Unit_Sell_At__c' : 'Unit_Buy_At__c'])?.text
      || cents(rawLine.lineAmount) !== cents(child[buyer ? 'Total_Price__c' : 'Total_Cost__c'])) return reject('SOURCE_CHANGED', 'Physical raw BDN/product/price evidence differs from the source projection.');
    sourceLines.push({ ...rawLine, quantity: child.Quantity_Delivered_Per_BDN__c, unitAmount: child[buyer ? 'Unit_Sell_At__c' : 'Unit_Buy_At__c'],
      lineAmount: child[buyer ? 'Total_Price__c' : 'Total_Cost__c'], productName: product.Name });
  }
  const currencyFor = (row) => row.CurrencyIsoCode ?? (scope.currencyContext?.singleCurrency === true ? scope.currencyContext.corporateCurrency : null);
  const currency = currencyFor(parent);
  if (hash(facts.currencyContext) !== hash(scope.currencyContext) || currency !== 'USD' || children.some(child => currencyFor(child) !== 'USD')) return reject('CURRENCY_UNSUPPORTED', 'Authoritative raw source and child currency must be USD.');
  const currentParentClaims = sourceClaims.filter((row) => sf(row.Id) === sf(parent.Id));
  const currentTargetClaims = scope.targetClaims.filter(({ document }) => uuid(document?.id) === uuid(candidate.id));
  if (currentParentClaims.length !== 1 || hash(currentParentClaims[0]) !== hash(parent) || currentTargetClaims.length !== 1
    || hash(currentTargetClaims[0].document) !== hash(candidate)) return reject('SNAPSHOT_CHANGED', 'Selected facts differ between the normal and all-years snapshot.');
  const rawTarget = currentTargetClaims[0].raw;
  const account = context.accountsById.get(sf(source.accountId));
  const contacts = account ? context.matchesFor(account) : [];
  const contact = contacts.find((row) => uuid(row.id) === uuid(source.contactId));
  const exactAccount = account && account.name === source.accountName && account.companyCode === (source.companyCode || '')
    && (buyer ? parent.STEM__r?.Account__r : parent.Supplier__r)?.Name === source.accountName && ((buyer ? parent.STEM__r?.Account__r : parent.Supplier__r)?.Company_Code__c ?? '') === (source.companyCode || '') && account.inactiveSuspended === false;
  const vessel = words(parent.STEM__r?.Vessel__r?.Name); const deliveryDate = parent.STEM__r?.Delivery_Date__c;
  const total = cents(sourceAmount(parent, buyer));
  const numbers = new Set([source.documentNumber, fileEvidence?.review?.printedNumber, candidate.invoiceNumber].filter(Boolean).map(numberKey));
  const sourceEnvelope = sourceClaims.filter((row) => sourceAccountIds.includes(sf(sourceOwner(row, buyer)))
    && (!currencyCode(currencyFor(row)) || currencyFor(row) === 'USD')
    && (claimCents(sourceAmount(row, buyer)) === total || claimCents(sourceAmount(row, buyer)) === null)
    // Retain the unmodified row in complete history and stronger-claim checks.
    // Three proven identity differences can exclude a bounded positive numeric
    // tail here without assigning it a rounded amount or changing its sign.
    && !distinctImpreciseSourceClaim(row, parent, source, numbers, currencyFor(row), buyer));
  const targetEnvelope = scope.targetClaims.filter(({ raw }) => uuid(raw?.Contact?.ContactID) === uuid(source.contactId)
    && (!currencyCode(raw.CurrencyCode) || raw.CurrencyCode === 'USD')
    && (claimCents(raw.Total) === total || claimCents(raw.Total) === null));
  const scopeComplete = sourceEnvelope.every((row) => claimCents(sourceAmount(row, buyer)) !== null && currencyCode(currencyFor(row))
    && words(row.STEM__r?.Vessel__r?.Name) && sf(row.STEM__r?.Vessel__c) && date(row.STEM__r?.Delivery_Date__c))
    && targetEnvelope.every(({ raw, document }) => claimCents(raw.Total) !== null && typeof raw.CurrencyCode === 'string' && /^[A-Z]{3}$/.test(raw.CurrencyCode)
      && targetVessel(document, buyer) && date(document.date));
  if (!scopeComplete) return reject('IDENTITY_SCOPE_INCOMPLETE', 'A potentially competing historical obligation has an unknown amount, currency, vessel or delivery date.');
  const sourceScope = sourceEnvelope.filter((row) => currencyFor(row) === 'USD' && row.STEM__r?.Delivery_Date__c === deliveryDate
    && words(row.STEM__r?.Vessel__r?.Name) === vessel);
  const targetScope = targetEnvelope.filter(({ raw, document }) => raw.CurrencyCode === 'USD' && document.date === deliveryDate
    && targetVessel(document, buyer) === vessel);
  const sourceNumberRows = sourceClaims.filter((row) => sourceAccountIds.includes(sf(sourceOwner(row, buyer)))
    && (numbers.has(numberKey(row.Name)) || sf(row.STEM__c) === sf(source.stemId) || hkClaims(row.STEM__r?.KeyStem__c).some(key => key.toUpperCase() === source.stemKey)));
  const targetNumberRows = scope.targetClaims.filter(({ raw, document }) => uuid(raw.Contact?.ContactID) === uuid(source.contactId)
    && (numbers.has(numberKey(document.invoiceNumber)) || hkClaims(document.reference).some((claim) => claim.toUpperCase() === source.stemKey)));
  if (scope.creditClaims.some(({ raw }) => Object.hasOwn(raw, 'Allocations') && !Array.isArray(raw.Allocations))) return reject('CREDIT_CLAIM', 'Credit allocation evidence is malformed.');
  const creditRows = scope.creditClaims.filter(({ raw, document }) => uuid(raw.Contact?.ContactID) === uuid(source.contactId)
    && (numbers.has(numberKey(document.creditNoteNumber)) || hkClaims(document.reference).some((claim) => claim.toUpperCase() === source.stemKey)
      || (raw.Allocations || []).some((allocation) => uuid(allocation.Invoice?.InvoiceID) === uuid(candidate.id))));
  const accounts = scope.accountTax.accounts.filter((row) => row.Code === accountCode);
  const taxes = scope.accountTax.taxRates.filter((row) => row.TaxType === 'NONE');
  if (accounts.length !== 1 || taxes.length !== 1) return reject('LEDGER_AMBIGUOUS', 'Exactly one current petroleum account and tax type are required.');
  const nameMatch = normalizeName(account?.name) === normalizeName(contact?.name);
  // Xero's complete invoice representation omits optional allocation arrays when empty.
  // An explicit null/malformed value is not an omitted empty collection. Required
  // financial headers must independently prove zero paid/credited and full due.
  const claims = (key) => Object.hasOwn(rawTarget, key) ? rawTarget[key] : [];
  const usedProducts = new Set(sourceLines.map(line => sf(line.productId)));
  return evaluateIssuedGroupedPetroleumPreservation({ direction, sourceEvidence: facts, tenantId: context.tenantId, organisation: context.organisation,
    cutoffDate: context.cutoffDate, fileEvidence, accountTax: { account: accounts[0], tax: taxes[0] },
    source: { ...source, complete: source.groupedAccounting?.policy === 'fcos_notax_accounting_v1', total: sourceAmount(parent, buyer),
      signedTotal: sourceAmount(parent, buyer), subtotal: sourceAmount(parent, buyer), totalTax: 0, lineAmountTypes: 'NoTax', isDiscounted: false, lines: sourceLines },
    xero: { ...candidate, ...candidate.groupedAccounting, complete: candidate.groupedAccounting?.complete === true,
      rawLineItems: candidate.lineItems, paymentClaims: claims('Payments'), creditClaims: claims('CreditNotes'), prepaymentClaims: claims('Prepayments'), overpaymentClaims: claims('Overpayments'),
      settlementEvidence: { basis: 'complete_invoice_zero_balances_optional_collections_v1', collections: Object.fromEntries(['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].map((key) => [key, { present: Object.hasOwn(rawTarget, key), rows: claims(key) }])) },
      lines: (candidate.lineItems || []).map((line) => ({ id: line.LineItemID, description: line.Description, quantity: line.Quantity,
        unitAmount: line.UnitAmount, lineAmount: line.LineAmount, accountCode: line.AccountCode, taxType: line.TaxType, taxAmount: line.TaxAmount,
        discountRate: line.DiscountRate ?? 0, discountAmount: line.DiscountAmount ?? 0, tracking: line.Tracking, itemCode: line.ItemCode ?? '' })) },
    productMappings: context.stored.productMappings.filter((row) => row.direction === direction && usedProducts.has(sf(row.salesforce_product_id)))
      .map((row) => ({ id: row.id, direction: row.direction, salesforceProductId: row.salesforce_product_id, xeroAccountCode: row.xero_account_code,
        xeroTaxType: row.xero_tax_type, enabled: row.enabled, revision: row.revision, approvedBy: row.approved_by,
        approvedByEmail: row.approved_by_email, approvedAt: row.approved_at })),
    identity: { complete: Boolean(exactAccount), coverageFingerprint: coverage.contentFingerprint, ...ownershipFields,
      candidateContactIds: contacts.map((row) => row.id), accountIdsForContact: (context.members.get(uuid(source.contactId)) || []).map((row) => row.id),
      candidateXeroDocumentIds: targetScope.map(({ document }) => document.id), documentIdentitySourceIds: sourceScope.map((row) => row.Id),
      numberCollisionXeroIds: targetNumberRows.map(({ document }) => document.id), numberCollisionSourceIds: sourceNumberRows.map((row) => row.Id),
      creditCollisionIds: creditRows.map(({ document }) => document.id),
      sourceMappings: context.stored.documentMappings.filter((row) => row.salesforce_object === sourceObject && sf(row.salesforce_id) === sf(source.salesforceId)),
      targetMappings: context.stored.documentMappings.filter((row) => uuid(row.xero_document_id) === uuid(candidate.id)),
      contactIdentity: { salesforceAccountId: account?.id, xeroContactId: contact?.id, status: contact?.status,
        matchBasis: nameMatch ? 'account_name' : 'company_key', sourceMatchValue: nameMatch ? normalizeName(account?.name) : hkStrippedClKeyNameMatchKey(account?.companyCode),
        xeroMatchValue: normalizeName(contact?.name), evidenceFingerprint: hash({ policy: 'fcos_contact_name_v1', account, contact }) } },
  });
}

export function evaluateGroupedPetroleumFinancialDocument(source, candidate, context, fileEvidence) {
  try { return evaluate(source, candidate, context, fileEvidence); }
  catch { return reject('EVIDENCE_INVALID', 'Current raw documentary and identity evidence is malformed or incomplete.'); }
}
