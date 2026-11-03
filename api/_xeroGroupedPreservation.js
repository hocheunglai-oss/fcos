import { createHash } from 'node:crypto';

export const GROUPED_PRESERVATION_POLICY = 'positive_many_to_one_v1';
export const GROUPED_PRESERVATION_MAX_LINES = 50;
const MAX_CENTS = 999999999999n;
const MAX_PROOF_BYTES = 100_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const invoiceIdentity = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : null;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const stableJson = (value) => JSON.stringify(value, (_key, item) => record(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

export function groupedPreservationAccountingFingerprint(evidence) {
  return createHash('sha256').update(stableJson({ policyVersion: evidence?.policyVersion, accounting: evidence?.accounting })).digest('hex');
}

export const groupedPreservationCanonical = stableJson;

// No binary floating-point money comparisons, tolerances, or implicit rounding of
// authoritative amounts. Decimal inputs are deliberately bounded and exponents
// rejected. Quantity x unit price alone uses positive half-up cent rounding.
function decimal(value) {
  if (!['string', 'number'].includes(typeof value)) return null;
  const input = String(value);
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,8})?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  const significant = fraction.replace(/0+$/, '');
  return { value: BigInt(`${whole}${significant}`), scale: significant.length,
    text: `${whole}${significant ? `.${significant}` : ''}` };
}

function sfId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value)) return null;
  const canonical = value.slice(0, 15);
  if (value.length === 18) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    let checksum = '';
    for (let chunk = 0; chunk < 3; chunk += 1) {
      let mask = 0;
      for (let bit = 0; bit < 5; bit += 1) if (/[A-Z]/.test(canonical[chunk * 5 + bit])) mask |= 1 << bit;
      checksum += alphabet[mask];
    }
    if (value.slice(15) !== checksum) return null;
  }
  return canonical;
}

/**
 * Pure eligibility evidence ONLY; never a payload for an invoice update.
 *
 * Required trusted-server adapter contract (no defaults for missing evidence):
 * - tenantId; organisation.baseCurrency; source and xero have complete:true.
 * - source: salesforceObject, salesforceId, accountId, contactId, sourceFingerprint,
 *   documentNumber, reference, invoiceDate, dueDate, deliveryDate (null permitted),
 *   xeroType, xeroCollection, currency, subtotal, total, signedTotal, totalTax,
 *   lineAmountTypes, isDiscounted, readiness:{ready,evidenceFingerprint}, lines.
 * - xero: id, collection, type, status, contactId, invoiceNumber, reference, date,
 *   dueDate, currency, currencyRate, subtotal, total, totalTax, lineAmountTypes,
 *   isDiscounted, amountDue, amountPaid, amountCredited, lines.
 * - Every line: id, description, quantity, unitAmount, authoritative lineAmount,
 *   accountCode, taxType, taxAmount, discountRate, discountAmount, tracking:[],
 *   itemCode:''; source lines additionally productId and authoritative currency.
 * - productMappings: exact used snapshots {id,direction,salesforceProductId,
 *   xeroAccountCode,xeroTaxType,enabled,revision}. No duplicate or unused rows.
 * - identity: complete:true, matchBasis:'invoice_number',
 *   candidateXeroDocumentIds, documentIdentitySourceIds, candidateContactIds,
 *   accountIdsForContact,
 *   contactIdentity:{salesforceAccountId,xeroContactId,status:'ACTIVE',
 *   matchBasis:'account_name'|'company_key',sourceMatchValue,xeroMatchValue,
 *   evidenceFingerprint}, and
 *   sourceMappings/targetMappings containing complete current ownership rows.
 *   Ownership rows: {id,tenantId,salesforceObject,salesforceId,xeroDocumentId,
 *   xeroDocumentType,xeroContactId,accountId,sourceFingerprint,protectedLegacy,
 *   policyVersion,acceptedFingerprint}. Both queries must cover
 *   canonical 15/18 SF aliases and case-insensitive Xero IDs. Only no ownership,
 *   or exactly the same accepted policy row returned by BOTH queries, is valid.
 *
 * Complete scopes, mapping approval and raw response completeness must be
 * established by the server, not supplied by a browser. Global Contact/Account
 * membership is required; the accounts visible in this preview are insufficient.
 * contactIdentity match values must be produced by the current approved identity
 * normalizer from the raw Account name/company key and Contact name. Its evidence
 * fingerprint must bind those complete raw records and the identity policy. The
 * helper requires exact normalized equality; it does not invent mapping IDs or
 * revisions for the current name-based Contact resolution.
 * Raw Salesforce authoritative child amounts must be retained: the existing
 * normalized source discards lineAmount. Raw Xero SubTotal, TotalTax,
 * LineAmountTypes and IsDiscounted must also be retained. An adapter may normalize
 * documented absent optional discount/inventory fields only after reading the
 * complete provider record; an absent amount/tax/header is never inferred.
 *
 * Eligibility ALWAYS requires explicit human review and equal invoice numbers
 * after whitespace normalization only, and the exact same invoice/accounting
 * date. Date/amount-only identity is insufficient.
 * Arithmetic equality is not independent proof of invoice identity. Bind the whole evidence (including
 * observations) into the outer fresh-review fingerprint. fingerprint deliberately
 * excludes ownership insertion and settlement/status changes so an accepted own
 * mapping survives AUTHORISED -> PAID. Fresh observations still invalidate a
 * pending outer review. A changed accounting fingerprint blocks accepted reuse.
 * Keep existing legacyReviewFingerprint unchanged; store this versioned proof
 * separately. Once accepted, sticky protected_legacy must remain set even if a
 * future call fails. Failure must NEVER fall through to an invoice update.
 */
export function evaluateGroupedPreservation(input = {}) {
  const blockers = [];
  const fail = (code, path, message) => {
    if (blockers.length < 64) blockers.push({ code, path, message });
  };
  const object = (value, path) => {
    if (record(value)) return value;
    fail('EVIDENCE_MISSING', path, 'A complete evidence object is required.');
    return {};
  };
  const string = (value, path, max = 200, empty = false) => {
    if (typeof value === 'string' && value.length <= max && (empty || value.length > 0)
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return value;
    fail('FIELD_INVALID', path, 'A bounded explicit string is required.');
    return null;
  };
  const id = (value, path, salesforce = false) => {
    const normalized = salesforce ? sfId(value) : typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
    if (!normalized) fail('IDENTITY_INVALID', path, 'A valid canonical provider identity is required.');
    return normalized;
  };
  const hash = (value, path) => {
    if (typeof value === 'string' && HASH.test(value)) return value.toLowerCase();
    fail('FINGERPRINT_INVALID', path, 'An explicit SHA-256 evidence fingerprint is required.');
    return null;
  };
  const enumeration = (value, values, path) => {
    if (values.includes(value)) return value;
    fail('SCOPE_UNSUPPORTED', path, `Expected ${values.join(' or ')}.`);
    return null;
  };
  const date = (value, path, nullable = false) => {
    if (nullable && value === null) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
    }
    fail('DATE_INVALID', path, 'An explicit real calendar date is required.');
    return null;
  };
  const currency = (value, path) => {
    if (typeof value === 'string' && /^[A-Z]{3}$/.test(value)) return value;
    fail('CURRENCY_INVALID', path, 'An authoritative uppercase currency code is required.');
    return null;
  };
  const number = (value, path, positive = false) => {
    const parsed = decimal(value);
    if (!parsed || (positive && parsed.value <= 0n)) fail('AMOUNT_INVALID', path, 'A bounded finite nonnegative decimal (positive where required) is required.');
    return parsed && (!positive || parsed.value > 0n) ? parsed : null;
  };
  const cents = (value, path, positive = false) => {
    const parsed = number(value, path, positive);
    if (!parsed) return null;
    if (parsed.scale > 2) {
      fail('CENT_PRECISION', path, 'Authoritative amounts must be exact integer cents.');
      return null;
    }
    const result = parsed.value * 10n ** BigInt(2 - parsed.scale);
    if (result > MAX_CENTS) {
      fail('AMOUNT_BOUND', path, 'Amount exceeds the bounded preservation policy.');
      return null;
    }
    return result;
  };
  const zero = (value, path, code) => {
    const parsed = number(value, path);
    if (parsed && parsed.value !== 0n) fail(code, path, 'Only explicit zero is supported by this preservation policy.');
    return parsed?.text ?? null;
  };
  const array = (value, path, max = GROUPED_PRESERVATION_MAX_LINES) => {
    if (Array.isArray(value) && value.length <= max) return value;
    fail('EVIDENCE_BOUND', path, 'A complete bounded array is required.');
    return [];
  };
  const revision = (value, path) => {
    if (Number.isSafeInteger(value) && value > 0) return value;
    fail('MAPPING_INVALID', path, 'A positive approved mapping revision is required.');
    return null;
  };
  const enabled = (value, path) => {
    if (value !== true) fail('MAPPING_INVALID', path, 'An enabled approved mapping is required.');
    return value === true;
  };
  const account = (value, path) => {
    if (typeof value === 'string' && /^[a-zA-Z0-9._-]{1,32}$/.test(value)) return value;
    fail('ACCOUNT_INVALID', path, 'An explicit approved accounting code is required.');
    return null;
  };
  const same = (left, right, code, path, message) => {
    if (left !== right) fail(code, path, message);
  };
  const root = object(input, 'input');
  const source = object(root.source, 'source');
  const xero = object(root.xero, 'xero');
  const identity = object(root.identity, 'identity');
  const organisation = object(root.organisation, 'organisation');
  for (const [key, value] of Object.entries({ source, xero, identity })) {
    if (value.complete !== true) fail('EVIDENCE_INCOMPLETE', `${key}.complete`, 'The server must establish a complete current evidence scope.');
  }
  const tenantId = id(root.tenantId, 'tenantId');
  const baseCurrency = currency(organisation.baseCurrency, 'organisation.baseCurrency');
  const sourceObject = enumeration(source.salesforceObject, ['Invoice__c', 'Supplier_Invoice__c'], 'source.salesforceObject');
  const sourceId = id(source.salesforceId, 'source.salesforceId', true);
  const accountId = id(source.accountId, 'source.accountId', true);
  const contactId = id(source.contactId, 'source.contactId');
  const xeroId = id(xero.id, 'xero.id');
  same(id(xero.contactId, 'xero.contactId'), contactId, 'CONTACT_MISMATCH', 'xero.contactId', 'Source and Xero must identify the exact same Contact.');
  const type = sourceObject === 'Invoice__c' ? 'ACCREC' : 'ACCPAY';
  enumeration(source.xeroType, [type], 'source.xeroType');
  enumeration(xero.type, [type], 'xero.type');
  enumeration(source.xeroCollection, ['Invoices'], 'source.xeroCollection');
  enumeration(xero.collection, ['Invoices'], 'xero.collection');
  const sourceCurrency = currency(source.currency, 'source.currency');
  const xeroCurrency = currency(xero.currency, 'xero.currency');
  same(sourceCurrency, baseCurrency, 'FX_UNSUPPORTED', 'source.currency', 'Source currency must equal verified organisation base currency.');
  same(xeroCurrency, sourceCurrency, 'CURRENCY_MISMATCH', 'xero.currency', 'Source and Xero currencies must match exactly.');
  const rate = number(xero.currencyRate, 'xero.currencyRate', true);
  if (rate && rate.text !== '1') fail('FX_UNSUPPORTED', 'xero.currencyRate', 'Only an explicit currency rate of one is supported.');
  const readiness = object(source.readiness, 'source.readiness');
  if (readiness.ready !== true) fail('SOURCE_NOT_READY', 'source.readiness.ready', 'Issued source evidence must be current and ready.');
  const sourceFingerprint = hash(source.sourceFingerprint, 'source.sourceFingerprint');
  const readinessFingerprint = hash(readiness.evidenceFingerprint, 'source.readiness.evidenceFingerprint');

  const headers = (document, prefix) => {
    const subtotal = cents(document.subtotal, `${prefix}.subtotal`, true);
    const total = cents(document.total, `${prefix}.total`, true);
    const totalTax = zero(document.totalTax, `${prefix}.totalTax`, 'TAX_UNSUPPORTED');
    same(subtotal, total, 'HEADER_TOTAL_MISMATCH', prefix, 'Untaxed subtotal and total must match exactly.');
    const lineAmountTypes = enumeration(document.lineAmountTypes, ['NoTax', 'Exclusive'], `${prefix}.lineAmountTypes`);
    if (document.isDiscounted !== false) fail('DISCOUNT_UNSUPPORTED', `${prefix}.isDiscounted`, 'The complete document must explicitly have no discounts.');
    return { subtotalCents: subtotal?.toString() ?? null, totalCents: total?.toString() ?? null, totalTax,
      lineAmountTypes, isDiscounted: document.isDiscounted === false ? false : null };
  };
  const sourceHeader = headers(source, 'source');
  const xeroHeader = headers(xero, 'xero');
  const signedTotal = cents(source.signedTotal, 'source.signedTotal', true);
  same(signedTotal?.toString() ?? null, sourceHeader.totalCents, 'HEADER_TOTAL_MISMATCH', 'source.signedTotal', 'Signed source total must be positive and equal the authoritative header.');
  same(sourceHeader.totalCents, xeroHeader.totalCents, 'HEADER_TOTAL_MISMATCH', 'xero.total', 'Source and Xero totals must match to the exact cent.');

  const line = (raw, index, fromSource) => {
    const prefix = `${fromSource ? 'source' : 'xero'}.lines[${index}]`;
    const item = object(raw, prefix);
    const quantity = number(item.quantity, `${prefix}.quantity`, true);
    const unitAmount = number(item.unitAmount, `${prefix}.unitAmount`, true);
    const amount = cents(item.lineAmount, `${prefix}.lineAmount`, true);
    if (quantity && unitAmount && amount !== null) {
      const numerator = quantity.value * unitAmount.value * 100n;
      const denominator = 10n ** BigInt(quantity.scale + unitAmount.scale);
      const rounded = (2n * numerator + denominator) / (2n * denominator);
      same(rounded, amount, 'LINE_ARITHMETIC_MISMATCH', `${prefix}.lineAmount`, 'Authoritative line amount must equal quantity times unit price rounded half up to cents.');
    }
    if (!Array.isArray(item.tracking) || item.tracking.length !== 0) fail('TRACKING_UNSUPPORTED', `${prefix}.tracking`, 'Explicit empty tracking is required.');
    if (item.itemCode !== '') fail('INVENTORY_UNSUPPORTED', `${prefix}.itemCode`, 'Explicit absence of an inventory item is required.');
    const normalized = {
      id: id(item.id, `${prefix}.id`, fromSource),
      description: string(item.description, `${prefix}.description`, 2000, true),
      quantity: quantity?.text ?? null, unitAmount: unitAmount?.text ?? null,
      lineAmountCents: amount?.toString() ?? null,
      accountCode: account(item.accountCode, `${prefix}.accountCode`),
      taxType: enumeration(item.taxType, ['NONE'], `${prefix}.taxType`),
      taxAmount: zero(item.taxAmount, `${prefix}.taxAmount`, 'TAX_UNSUPPORTED'),
      discountRate: zero(item.discountRate, `${prefix}.discountRate`, 'DISCOUNT_UNSUPPORTED'),
      discountAmount: zero(item.discountAmount, `${prefix}.discountAmount`, 'DISCOUNT_UNSUPPORTED'),
      tracking: [], itemCode: '',
    };
    if (fromSource) {
      normalized.productId = id(item.productId, `${prefix}.productId`, true);
      normalized.currency = currency(item.currency, `${prefix}.currency`);
      same(normalized.currency, sourceCurrency, 'CURRENCY_MISMATCH', `${prefix}.currency`, 'Each authoritative source line must use the document currency.');
    }
    return normalized;
  };
  const sourceLines = array(source.lines, 'source.lines').map((value, index) => line(value, index, true));
  const xeroLines = array(xero.lines, 'xero.lines', 1).map((value, index) => line(value, index, false));
  if (sourceLines.length < 2 || xeroLines.length !== 1) fail('LINE_COUNT_UNSUPPORTED', 'lines', 'This policy requires two to fifty source lines and exactly one existing Xero line.');
  for (const [key, lines] of Object.entries({ source: sourceLines, xero: xeroLines })) {
    if (new Set(lines.map((item) => item.id)).size !== lines.length) fail('LINE_ID_DUPLICATE', `${key}.lines`, 'Canonical line identities must be unique; duplicates are never deduplicated.');
    if (lines.every((item) => item.lineAmountCents !== null)) {
      const sum = lines.reduce((total, item) => total + BigInt(item.lineAmountCents), 0n).toString();
      same(sum, key === 'source' ? sourceHeader.subtotalCents : xeroHeader.subtotalCents, 'LINE_HEADER_MISMATCH', `${key}.subtotal`, 'The sum of authoritative lines must exactly equal the header subtotal.');
    }
  }
  sourceLines.sort((left, right) => compare(String(left.id), String(right.id)));
  const direction = sourceObject === 'Invoice__c' ? 'buyer' : 'supplier';
  const mappings = array(root.productMappings, 'productMappings').map((raw, index) => {
    const prefix = `productMappings[${index}]`;
    const item = object(raw, prefix);
    return { id: id(item.id, `${prefix}.id`), direction: enumeration(item.direction, [direction], `${prefix}.direction`),
      salesforceProductId: id(item.salesforceProductId, `${prefix}.salesforceProductId`, true),
      xeroAccountCode: account(item.xeroAccountCode, `${prefix}.xeroAccountCode`),
      xeroTaxType: enumeration(item.xeroTaxType, ['NONE'], `${prefix}.xeroTaxType`),
      enabled: enabled(item.enabled, `${prefix}.enabled`), revision: revision(item.revision, `${prefix}.revision`) };
  }).sort((left, right) => compare(String(left.salesforceProductId), String(right.salesforceProductId)));
  if (new Set(mappings.map((item) => item.id)).size !== mappings.length
    || new Set(mappings.map((item) => item.salesforceProductId)).size !== mappings.length) fail('MAPPING_DUPLICATE', 'productMappings', 'Every used product must have exactly one approved mapping identity.');
  for (const item of sourceLines) {
    const matches = mappings.filter((mapping) => mapping.salesforceProductId === item.productId);
    if (matches.length !== 1 || matches[0].xeroAccountCode !== item.accountCode || matches[0].xeroTaxType !== item.taxType) fail('MAPPING_MISMATCH', 'source.lines', 'Every source line must exactly match its current approved product accounting mapping.');
  }
  if (mappings.some((mapping) => !sourceLines.some((item) => item.productId === mapping.salesforceProductId))) fail('MAPPING_UNUSED', 'productMappings', 'Only the exact set of used product mappings is permitted.');
  const groups = (lines) => {
    const totals = new Map();
    for (const item of lines) if (item.lineAmountCents !== null) {
      const key = `${item.accountCode}:${item.taxType}`;
      totals.set(key, (totals.get(key) || 0n) + BigInt(item.lineAmountCents));
    }
    return [...totals].sort(([left], [right]) => compare(left, right))
      .map(([key, total]) => ({ accountCode: key.split(':')[0], taxType: 'NONE', totalCents: total.toString() }));
  };
  const groupedTotals = groups(sourceLines);
  same(stableJson(groupedTotals), stableJson(groups(xeroLines)), 'ACCOUNT_GROUP_MISMATCH', 'lines', 'Exact cents must match within each approved account; cross-account netting is prohibited.');

  const singletonIds = (raw, path, expected, salesforce = false) => {
    const values = array(raw, path).map((value, index) => id(value, `${path}[${index}]`, salesforce));
    if (values.length !== 1 || values[0] !== expected) fail('IDENTITY_AMBIGUOUS', path, 'The complete identity scope must contain exactly the expected identity, with no aliases or shared Accounts.');
    return values;
  };
  singletonIds(identity.candidateXeroDocumentIds, 'identity.candidateXeroDocumentIds', xeroId);
  singletonIds(identity.documentIdentitySourceIds, 'identity.documentIdentitySourceIds', sourceId, true);
  singletonIds(identity.candidateContactIds, 'identity.candidateContactIds', contactId);
  singletonIds(identity.accountIdsForContact, 'identity.accountIdsForContact', accountId, true);
  const contact = object(identity.contactIdentity, 'identity.contactIdentity');
  const contactIdentity = {
    salesforceAccountId: id(contact.salesforceAccountId, 'identity.contactIdentity.salesforceAccountId', true),
    xeroContactId: id(contact.xeroContactId, 'identity.contactIdentity.xeroContactId'),
    status: enumeration(contact.status, ['ACTIVE'], 'identity.contactIdentity.status'),
    matchBasis: enumeration(contact.matchBasis, ['account_name', 'company_key'], 'identity.contactIdentity.matchBasis'),
    sourceMatchValue: string(contact.sourceMatchValue, 'identity.contactIdentity.sourceMatchValue'),
    xeroMatchValue: string(contact.xeroMatchValue, 'identity.contactIdentity.xeroMatchValue'),
    evidenceFingerprint: hash(contact.evidenceFingerprint, 'identity.contactIdentity.evidenceFingerprint'),
  };
  same(contactIdentity.salesforceAccountId, accountId, 'CONTACT_IDENTITY_MISMATCH', 'identity.contactIdentity', 'Verified Contact identity must belong to the exact source Account.');
  same(contactIdentity.xeroContactId, contactId, 'CONTACT_IDENTITY_MISMATCH', 'identity.contactIdentity', 'Verified Contact identity must identify the exact Xero Contact.');
  if (!contactIdentity.sourceMatchValue?.trim() || contactIdentity.sourceMatchValue !== contactIdentity.xeroMatchValue) {
    fail('CONTACT_IDENTITY_MISMATCH', 'identity.contactIdentity', 'The server-verified normalized Account and Contact match values must agree exactly.');
  }
  const sourceDocument = { documentNumber: string(source.documentNumber, 'source.documentNumber'),
    reference: string(source.reference, 'source.reference', 2000, true),
    invoiceDate: date(source.invoiceDate, 'source.invoiceDate'), dueDate: date(source.dueDate, 'source.dueDate'),
    deliveryDate: date(source.deliveryDate, 'source.deliveryDate', true) };
  const xeroDocument = { invoiceNumber: string(xero.invoiceNumber, 'xero.invoiceNumber'),
    reference: string(xero.reference, 'xero.reference', 2000, true),
    date: date(xero.date, 'xero.date'), dueDate: date(xero.dueDate, 'xero.dueDate') };
  const matchBasis = enumeration(identity.matchBasis, ['invoice_number'], 'identity.matchBasis');
  if (!invoiceIdentity(sourceDocument.documentNumber) || invoiceIdentity(sourceDocument.documentNumber) !== invoiceIdentity(xeroDocument.invoiceNumber)) {
    fail('MATCH_BASIS_INVALID', 'identity.matchBasis', 'Exact invoice numbers after whitespace normalization are mandatory; matching dates, amounts and Contact alone are insufficient.');
  }
  same(sourceDocument.invoiceDate, xeroDocument.date, 'INVOICE_DATE_MISMATCH', 'xero.date', 'Grouped preservation requires the exact source invoice date; a historical namesake outside the complete accounting-date scope cannot qualify.');

  const accounting = { tenantId, baseCurrency, source: { salesforceObject: sourceObject, salesforceId: sourceId,
    accountId, contactId, sourceFingerprint, readinessFingerprint, type, collection: 'Invoices', currency: sourceCurrency,
    ...sourceDocument, ...sourceHeader, signedTotalCents: signedTotal?.toString() ?? null, lines: sourceLines },
  xero: { id: xeroId, contactId, type, collection: 'Invoices', currency: xeroCurrency, currencyRate: rate?.text ?? null,
    ...xeroDocument, ...xeroHeader, lines: xeroLines }, productMappings: mappings, contactIdentity, matchBasis, groupedTotals };
  const proof = { policyVersion: GROUPED_PRESERVATION_POLICY, accounting };
  const serialized = stableJson(proof);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PROOF_BYTES) fail('EVIDENCE_BOUND', 'evidence', 'The complete accounting proof exceeds the bounded evidence size.');
  const fingerprint = groupedPreservationAccountingFingerprint(proof);
  const ownershipRows = (raw, prefix) => array(raw, prefix, 2).map((rawRow, index) => {
    const path = `${prefix}[${index}]`;
    const row = object(rawRow, path);
    return { id: id(row.id, `${path}.id`), tenantId: id(row.tenantId, `${path}.tenantId`),
      salesforceObject: enumeration(row.salesforceObject, ['Invoice__c', 'Supplier_Invoice__c'], `${path}.salesforceObject`),
      salesforceId: id(row.salesforceId, `${path}.salesforceId`, true), xeroDocumentId: id(row.xeroDocumentId, `${path}.xeroDocumentId`),
      xeroDocumentType: enumeration(row.xeroDocumentType, ['ACCREC', 'ACCPAY'], `${path}.xeroDocumentType`),
      xeroContactId: id(row.xeroContactId, `${path}.xeroContactId`), accountId: id(row.accountId, `${path}.accountId`, true),
      sourceFingerprint: hash(row.sourceFingerprint, `${path}.sourceFingerprint`),
      protectedLegacy: row.protectedLegacy === true,
      policyVersion: enumeration(row.policyVersion, [GROUPED_PRESERVATION_POLICY], `${path}.policyVersion`),
      acceptedFingerprint: hash(row.acceptedFingerprint, `${path}.acceptedFingerprint`) };
  });
  const sourceMappings = ownershipRows(identity.sourceMappings, 'identity.sourceMappings');
  const targetMappings = ownershipRows(identity.targetMappings, 'identity.targetMappings');
  const owned = sourceMappings.length > 0 || targetMappings.length > 0;
  const own = sourceMappings[0];
  const accepted = owned && sourceMappings.length === 1 && targetMappings.length === 1
    && stableJson(own) === stableJson(targetMappings[0]) && own.tenantId === tenantId
    && own.salesforceObject === sourceObject && own.salesforceId === sourceId && own.xeroDocumentId === xeroId
    && own.xeroDocumentType === type && own.xeroContactId === contactId && own.accountId === accountId
    && own.sourceFingerprint === sourceFingerprint
    && own.protectedLegacy && own.policyVersion === GROUPED_PRESERVATION_POLICY && own.acceptedFingerprint === fingerprint;
  if (owned && !accepted) fail('OWNERSHIP_CONFLICT', 'identity', 'Only one verified same-source accepted grouped mapping may own this document; changed proof requires separate review and must remain protected.');
  const status = enumeration(xero.status, accepted ? ['AUTHORISED', 'PAID'] : ['AUTHORISED'], 'xero.status');
  const due = cents(xero.amountDue, 'xero.amountDue');
  const paid = cents(xero.amountPaid, 'xero.amountPaid');
  const credited = cents(xero.amountCredited, 'xero.amountCredited');
  if (due !== null && paid !== null && credited !== null) {
    same((due + paid + credited).toString(), xeroHeader.totalCents, 'SETTLEMENT_INVALID', 'xero', 'Explicit settlement totals must reconcile exactly to the invoice total.');
    if (status === 'PAID' && due !== 0n) fail('SETTLEMENT_INVALID', 'xero.amountDue', 'A paid document cannot retain an amount due.');
  }
  const result = blockers.length ? { eligible: false, policyVersion: GROUPED_PRESERVATION_POLICY,
    requiresExplicitReview: true, accepted: false, fingerprint: null, evidence: null, blockers }
    : { eligible: true, policyVersion: GROUPED_PRESERVATION_POLICY, requiresExplicitReview: true, accepted,
      fingerprint, evidence: { ...proof, observations: { status, amountDueCents: due.toString(),
        amountPaidCents: paid.toString(), amountCreditedCents: credited.toString(),
        ownership: accepted ? { kind: 'accepted_grouped', mappingId: own.id } : { kind: 'unlinked' } } }, blockers: [] };
  return freeze(result);
}
