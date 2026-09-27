import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { issuedSupplierSfId, issuedSupplierCents, issuedSupplierHash, issuedSupplierCanonical,
  issuedSupplierAccountingFingerprint } from './_xeroIssuedSupplierPreservation.js';

export const ISSUED_PETROLEUM_PRESERVATION_POLICY = 'issued_petroleum_preserve_v1';
export const issuedPetroleumAccountingFingerprint = issuedSupplierAccountingFingerprint;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MISSING_FILE = 'Supplier invoice has no verified issued source file.';
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const legalWords = (value) => typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).map((word) => ({ LTD: 'LIMITED', INTL: 'INTERNATIONAL' })[word] || word).join(' ') : '';
const words = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
export function issuedPetroleumDecimal(value) {
  if (!['number', 'string'].includes(typeof value) || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  const significant = fraction.replace(/0+$/, '');
  return { value: BigInt(whole + significant), scale: significant.length, text: whole + (significant ? `.${significant}` : '') };
}

export const issuedPetroleumVessel = (number) => typeof number === 'string' ? words(/^\d+P-(.+)$/.exec(number)?.[1]) : '';
const realDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const freeze = (value) => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

// Trusted-server facts only. This policy proves one existing aggregate petroleum
// charge; it never supplies posting readiness, a human actor or a write payload.
// The collector must re-fetch bytes and independently verify checksum/SHA256 and
// complete current linkage. Matching labels or client "verified" flags do not do so.
export function evaluateIssuedPetroleumPreservation(input = {}) {
  const blockers = [];
  const fail = (code, path, message) => { if (blockers.length < 64) blockers.push({ code, path, message }); };
  const require = (ok, code, path, message) => { if (!ok) fail(code, path, message); return Boolean(ok); };
  const rejected = () => freeze({ eligible: false, policyVersion: ISSUED_PETROLEUM_PRESERVATION_POLICY, accepted: false,
    requiresExplicitReview: true, fingerprint: null, evidenceFingerprint: null, evidence: null, blockers });
  let root;
  try {
    const json = JSON.stringify(input);
    if (!json || Buffer.byteLength(json) > 200_000 || !plain(input)) throw new Error('invalid');
    root = JSON.parse(json);
  } catch { fail('EVIDENCE_BOUND', 'input', 'Complete bounded JSON evidence is required.'); return rejected(); }
  const source = plain(root.source) ? root.source : {};
  const xero = plain(root.xero) ? root.xero : {};
  const identity = plain(root.identity) ? root.identity : {};
  const file = plain(root.fileEvidence) ? root.fileEvidence : {};
  const review = plain(file.review) ? file.review : {};
  const delivery = plain(root.deliveryIdentity) ? root.deliveryIdentity : {};
  const counterparts = plain(review.counterparties) ? review.counterparties : {};
  const link = plain(file.link) ? file.link : {};
  const version = plain(file.version) ? file.version : {};
  const id = (value, path, sf = false) => {
    const normalized = sf ? issuedSupplierSfId(value) : typeof value === 'string' && UUID.test(value)
      && value !== '00000000-0000-0000-0000-000000000000' ? value.toLowerCase() : null;
    require(normalized, 'IDENTITY_INVALID', path, 'A valid provider identity is required.'); return normalized;
  };
  const string = (value, path, empty = false, max = 2000) => {
    require(typeof value === 'string' && value.length <= max && (empty || words(value)) && !/[\u0000-\u001f\u007f]/.test(value),
      'FIELD_INVALID', path, 'An explicit bounded string is required.'); return value;
  };
  const hash = (value, path) => { require(typeof value === 'string' && HASH.test(value), 'FINGERPRINT_INVALID', path, 'A SHA256 fingerprint is required.'); return value; };
  const cents = (value, path, positive = false) => {
    const amount = issuedSupplierCents(value);
    require(amount !== null && (!positive || amount > 0n), 'CENT_PRECISION', path, 'An exact nonnegative cent amount is required.'); return amount;
  };
  const date = (value, path) => { require(realDate(value), 'DATE_INVALID', path, 'A real calendar date is required.'); return value; };
  const array = (value, path, max = 50) => {
    if (require(Array.isArray(value) && value.length <= max, 'EVIDENCE_INCOMPLETE', path, 'A complete bounded array is required.')) return value;
    return [];
  };
  const equal = (left, right, path, code = 'EVIDENCE_MISMATCH') => require(left !== null && left !== undefined && left === right, code, path, 'Current evidence must agree exactly.');
  const singleton = (values, expected, path, sf = false) => {
    const ids = array(values, path).map((value, index) => id(value, `${path}[${index}]`, sf));
    require(ids.length === 1 && ids[0] === expected, 'IDENTITY_AMBIGUOUS', path, 'The complete scope must contain exactly this identity.');
  };
  for (const [path, value] of Object.entries({ source, xero, identity })) require(value.complete === true, 'EVIDENCE_INCOMPLETE', path, 'Complete trusted-server evidence is required.');
  const tenantId = id(root.tenantId, 'tenantId');
  const sourceId = id(source.salesforceId, 'source.salesforceId', true);
  const accountId = id(source.accountId, 'source.accountId', true);
  const contactId = id(source.contactId, 'source.contactId');
  const xeroId = id(xero.id, 'xero.id');
  const stemId = id(source.stemId, 'source.stemId', true);
  const orgId = id(file.orgId, 'file.orgId', true);
  equal(orgId, issuedSupplierSfId(fcosSalesforceEnvironment('production').orgId), 'file.orgId', 'ORG_MISMATCH');
  equal(source.salesforceObject, 'Supplier_Invoice__c', 'source.salesforceObject');
  equal(source.xeroType, 'ACCPAY', 'source.xeroType'); equal(source.xeroCollection, 'Invoices', 'source.xeroCollection');
  equal(xero.type, 'ACCPAY', 'xero.type'); equal(xero.collection, 'Invoices', 'xero.collection');
  equal(id(xero.contactId, 'xero.contactId'), contactId, 'xero.contactId');
  for (const [path, value] of Object.entries({ source: source.currency, xero: xero.currency, organisation: root.organisation?.baseCurrency, paper: review.currency })) equal(value, 'USD', `${path}.currency`, 'CURRENCY_UNSUPPORTED');
  equal(issuedPetroleumDecimal(xero.currencyRate)?.text, '1', 'xero.currencyRate', 'FX_UNSUPPORTED');
  const sourceDate = date(source.invoiceDate, 'source.invoiceDate');
  date(source.dueDate, 'source.dueDate'); date(xero.date, 'xero.date'); date(xero.dueDate, 'xero.dueDate');
  equal(date(delivery.deliveryDate, 'deliveryIdentity.deliveryDate'), xero.date, 'xero.date', 'DELIVERY_DATE_MISMATCH');
  equal(source.deliveryDate, delivery.deliveryDate, 'source.deliveryDate', 'DELIVERY_DATE_MISMATCH');
  require(realDate(xero.date) && xero.date >= root.cutoffDate, 'IDENTITY_SCOPE_INCOMPLETE', 'xero.date', 'The selected target must be in the current accounting scope.');
  require(realDate(root.cutoffDate) && realDate(sourceDate) && sourceDate >= root.cutoffDate, 'IDENTITY_SCOPE_INCOMPLETE', 'cutoffDate', 'The source must be within the complete current accounting scope.');
  for (const [path, values] of [['source.blockers', source.blockers], ['source.readiness.blockers', source.readiness?.blockers]]) {
    require(array(values, path).every((value) => value === MISSING_FILE), 'SOURCE_BLOCKED', path, 'Only a missing legacy file pointer is permitted; other source holds remain.');
  }
  const sourceNumber = string(source.documentNumber, 'source.documentNumber');
  const printedNumber = string(review.printedNumber, 'file.review.printedNumber');
  require((review.numberRule === 'exact' && printedNumber === sourceNumber)
    || (review.numberRule === 'reviewed_ascii_hyphens' && typeof printedNumber === 'string'
      && /^[A-Za-z0-9-]+$/.test(printedNumber) && /^[A-Za-z0-9]+$/.test(sourceNumber || '')
      && printedNumber.includes('-') && printedNumber.replaceAll('-', '') === sourceNumber),
  'ISSUED_NUMBER_MISMATCH', 'file.review.printedNumber', 'Only the exact reviewed invoice-number punctuation bridge is supported.');
  equal(review.sourceNumber, sourceNumber, 'file.review.sourceNumber');
  const vessel = words(string(delivery.vessel, 'deliveryIdentity.vessel'));
  equal(words(review.vessel), vessel, 'file.review.vessel', 'VESSEL_MISMATCH');
  equal(issuedPetroleumVessel(xero.invoiceNumber), vessel, 'xero.invoiceNumber', 'VESSEL_MISMATCH');
  equal(id(delivery.parentId, 'deliveryIdentity.parentId', true), sourceId, 'deliveryIdentity.parentId');
  equal(id(delivery.stemId, 'deliveryIdentity.stemId', true), stemId, 'deliveryIdentity.stemId');
  equal(id(delivery.supplierId, 'deliveryIdentity.supplierId', true), accountId, 'deliveryIdentity.supplierId');
  const vesselId = id(delivery.vesselId, 'deliveryIdentity.vesselId', true);
  equal(string(delivery.stemKey, 'deliveryIdentity.stemKey'), source.stemKey, 'deliveryIdentity.stemKey');
  require(/^HK\d+[A-Z]$/.test(delivery.stemKey || ''), 'STEM_IDENTITY_INVALID', 'deliveryIdentity.stemKey', 'An authoritative exact STEM key is required.');
  const stemClaims = typeof xero.reference === 'string' ? xero.reference.match(/\bHK\d+[A-Z]\b/gi) || [] : [];
  require(stemClaims.every((claim) => claim.toUpperCase() === delivery.stemKey), 'STEM_REFERENCE_CONFLICT', 'xero.reference', 'A stronger conflicting STEM claim cannot be preserved.');
  if (review.deliveryDate !== null) equal(date(review.deliveryDate, 'file.review.deliveryDate'), delivery.deliveryDate, 'file.review.deliveryDate');
  equal(id(counterparts.accountId, 'file.review.counterparties.accountId', true), accountId, 'file.review.counterparties.accountId');
  equal(id(counterparts.contactId, 'file.review.counterparties.contactId'), contactId, 'file.review.counterparties.contactId');
  equal(id(counterparts.tenantId, 'file.review.counterparties.tenantId'), tenantId, 'file.review.counterparties.tenantId');
  equal(string(counterparts.sourceName, 'file.review.counterparties.sourceName'), source.accountName, 'file.review.counterparties.sourceName');
  equal(counterparts.companyCode, source.companyCode, 'file.review.counterparties.companyCode');
  equal(string(counterparts.printedSeller, 'file.review.counterparties.printedSeller'), string(review.sellerName, 'file.review.sellerName'), 'file.review.sellerName');
  equal(string(counterparts.printedBuyer, 'file.review.counterparties.printedBuyer'), string(review.buyerName, 'file.review.buyerName'), 'file.review.buyerName');
  equal(legalWords(review.sellerName), legalWords(source.accountName), 'file.review.sellerName', 'SELLER_MISMATCH');
  equal(legalWords(review.buyerName), legalWords('FRATELLI COSULICH BUNKERS (HK) LTD'), 'file.review.buyerName', 'BUYER_MISMATCH');
  equal(counterparts.basis, 'independently_reviewed_literal_pair', 'file.review.counterparties.basis');
  require(review.taxEvidence === 'no_tax_line_or_increment_observed' || review.taxEvidence === 'explicit_zero_tax', 'TAX_EVIDENCE_INVALID', 'file.review.taxEvidence', 'Literal paper tax evidence is required.');
  equal(review.invoiceDate, sourceDate, 'file.review.invoiceDate'); equal(review.dueDate, source.dueDate, 'file.review.dueDate');
  string(review.reviewer, 'file.review.reviewer', false, 200); hash(review.reviewRecordHash, 'file.review.reviewRecordHash');
  require(typeof review.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(review.reviewedAt) && Number.isFinite(Date.parse(review.reviewedAt)), 'REVIEW_INVALID', 'file.review.reviewedAt', 'A dated factual review is required.');
  const documentId = id(file.documentId, 'file.documentId', true); const versionId = id(file.versionId, 'file.versionId', true);
  require(documentId?.startsWith('069') && versionId?.startsWith('068') && id(link.id, 'file.link.id', true)?.startsWith('06A'), 'FILE_IDENTITY_INVALID', 'file', 'Exact Salesforce file identities are required.');
  equal(id(file.parentId, 'file.parentId', true), sourceId, 'file.parentId'); equal(id(link.parentId, 'file.link.parentId', true), sourceId, 'file.link.parentId');
  equal(id(link.documentId, 'file.link.documentId', true), documentId, 'file.link.documentId');
  equal(id(version.id, 'file.version.id', true), versionId, 'file.version.id'); equal(id(version.documentId, 'file.version.documentId', true), documentId, 'file.version.documentId');
  equal(id(version.latestPublishedVersionId, 'file.version.latestPublishedVersionId', true), versionId, 'file.version.latestPublishedVersionId');
  require(version.isLatest === true, 'FILE_VERSION_STALE', 'file.version.isLatest', 'The captured exact version must still be current.');
  hash(file.sha256, 'file.sha256');
  require(typeof file.checksum === 'string' && /^[a-f0-9]{32}$/.test(file.checksum), 'CHECKSUM_INVALID', 'file.checksum', 'The revalidated Salesforce checksum is required.');
  equal(version.checksum, file.checksum, 'file.version.checksum'); equal(version.contentSize, file.contentSize, 'file.version.contentSize');
  require(Number.isSafeInteger(file.contentSize) && file.contentSize > 0 && file.contentSize <= 8_388_608 && file.contentType === 'application/pdf', 'FILE_INVALID', 'file', 'A bounded captured native PDF is required.');
  const header = (row, path) => {
    const total = cents(row.total, `${path}.total`, true); const subtotal = cents(row.subtotal, `${path}.subtotal`, true);
    equal(subtotal, total, `${path}.subtotal`, 'HEADER_TOTAL_MISMATCH'); equal(cents(row.totalTax, `${path}.totalTax`), 0n, `${path}.totalTax`, 'TAX_UNSUPPORTED');
    require(['NoTax', 'Exclusive'].includes(row.lineAmountTypes) && row.isDiscounted === false, 'HEADER_UNSUPPORTED', path, 'Explicit untaxed, undiscounted accounting is required.');
    return { subtotalCents: subtotal?.toString(), totalCents: total?.toString(), totalTax: '0', lineAmountTypes: row.lineAmountTypes, isDiscounted: false };
  };
  const sourceHeader = header(source, 'source'); const xeroHeader = header(xero, 'xero');
  equal(source.lineAmountTypes, 'NoTax', 'source.lineAmountTypes', 'HEADER_UNSUPPORTED');
  equal(sourceHeader.totalCents, xeroHeader.totalCents, 'xero.total', 'HEADER_TOTAL_MISMATCH');
  equal(cents(source.signedTotal, 'source.signedTotal', true)?.toString(), sourceHeader.totalCents, 'source.signedTotal');
  equal(cents(review.total, 'file.review.total', true)?.toString(), sourceHeader.totalCents, 'file.review.total');
  if (review.taxEvidence === 'explicit_zero_tax') equal(cents(review.totalTax, 'file.review.totalTax'), 0n, 'file.review.totalTax', 'TAX_UNSUPPORTED');
  else require(review.totalTax === null, 'TAX_EVIDENCE_INVALID', 'file.review.totalTax', 'An absent paper tax line must remain null.');
  const paperLines = array(review.lines, 'file.review.lines');
  require(paperLines.length === 1, 'PAPER_LINES_MISSING', 'file.review.lines', 'Exactly one printed petroleum line is required.');
  const paperAmounts = paperLines.map((line, index) => { string(line?.description, `file.review.lines[${index}].description`); return cents(line?.amount, `file.review.lines[${index}].amount`, true); });
  if (paperAmounts.every((value) => value !== null)) equal(paperAmounts.reduce((sum, value) => sum + value, 0n).toString(), sourceHeader.totalCents, 'file.review.lines', 'PAPER_ARITHMETIC_MISMATCH');
  const normalizedLine = (row, path, fromSource) => {
    const line = plain(row) ? row : {}; const quantity = issuedPetroleumDecimal(line.quantity); const unit = issuedPetroleumDecimal(line.unitAmount); const amount = cents(line.lineAmount, `${path}.lineAmount`, true);
    require(quantity?.value > 0n && unit?.value > 0n, 'LINE_UNITS_INVALID', path, 'Explicit positive quantities and unit amounts are required.');
    if (quantity && unit && amount !== null) {
      const denominator = 10n ** BigInt(quantity.scale + unit.scale);
      equal((2n * quantity.value * unit.value * 100n + denominator) / (2n * denominator), amount, `${path}.lineAmount`, 'LINE_ARITHMETIC_MISMATCH');
    }
    equal(line.accountCode, '51100', `${path}.accountCode`, 'MAPPING_MISMATCH'); equal(line.taxType, 'NONE', `${path}.taxType`, 'TAX_UNSUPPORTED');
    for (const key of ['taxAmount', 'discountRate', 'discountAmount']) equal(issuedPetroleumDecimal(line[key])?.text, '0', `${path}.${key}`, 'ADJUSTMENT_UNSUPPORTED');
    require(Array.isArray(line.tracking) && line.tracking.length === 0 && line.itemCode === '', 'LINE_UNSUPPORTED', path, 'Tracking and inventory items are outside this policy.');
    if (fromSource) { equal(line.currency, 'USD', `${path}.currency`); equal(line.productName, delivery.productName, `${path}.productName`, 'PRODUCT_UNSUPPORTED'); }
    return { id: id(line.id, `${path}.id`, fromSource), description: string(line.description, `${path}.description`, true),
      quantity: quantity?.text, unitAmount: unit?.text, lineAmountCents: amount?.toString(), accountCode: '51100', taxType: 'NONE',
      taxAmount: '0', discountRate: '0', discountAmount: '0', tracking: [], itemCode: '',
      ...(fromSource ? { productId: id(line.productId, `${path}.productId`, true), currency: 'USD' } : {}) };
  };
  const sourceLines = array(source.lines, 'source.lines', 1).map((line, index) => normalizedLine(line, `source.lines[${index}]`, true));
  const xeroLines = array(xero.lines, 'xero.lines', 1).map((line, index) => normalizedLine(line, `xero.lines[${index}]`, false));
  require(sourceLines.length === 1 && xeroLines.length === 1, 'LINE_COUNT_UNSUPPORTED', 'lines', 'Exactly one source petroleum line and one Xero aggregate line are supported.');
  equal(sourceLines[0]?.lineAmountCents, sourceHeader.totalCents, 'source.lines', 'LINE_HEADER_MISMATCH'); equal(xeroLines[0]?.lineAmountCents, xeroHeader.totalCents, 'xero.lines', 'LINE_HEADER_MISMATCH');
  singleton(source.readiness?.linkedChildren, sourceLines[0]?.id, 'source.readiness.linkedChildren', true);
  const paperLine = paperLines[0] || {};
  equal(issuedPetroleumDecimal(paperLine.quantity)?.text, sourceLines[0]?.quantity, 'file.review.lines.quantity', 'QUANTITY_MISMATCH');
  equal(issuedPetroleumDecimal(paperLine.unitPrice)?.text, sourceLines[0]?.unitAmount, 'file.review.lines.unitPrice', 'PRICE_MISMATCH');
  equal(paperLine.unit, 'MT', 'file.review.lines.unit', 'UNIT_UNSUPPORTED');
  equal(id(paperLine.sourceProductId, 'file.review.lines.sourceProductId', true), sourceLines[0]?.productId, 'file.review.lines.sourceProductId');
  equal(paperLine.sourceProductName, delivery.productName, 'file.review.lines.sourceProductName', 'PRODUCT_UNSUPPORTED');
  string(paperLine.productEvidence, 'file.review.lines.productEvidence');
  equal(id(delivery.childId, 'deliveryIdentity.childId', true), sourceLines[0]?.id, 'deliveryIdentity.childId');
  equal(id(delivery.productId, 'deliveryIdentity.productId', true), sourceLines[0]?.productId, 'deliveryIdentity.productId');
  equal(delivery.productRecordType, 'Petroleum_Product', 'deliveryIdentity.productRecordType', 'PRODUCT_UNSUPPORTED');
  equal(issuedPetroleumDecimal(delivery.quantity)?.text, sourceLines[0]?.quantity, 'deliveryIdentity.quantity');
  equal(issuedPetroleumDecimal(delivery.unitAmount)?.text, sourceLines[0]?.unitAmount, 'deliveryIdentity.unitAmount');
  equal(delivery.unit, 'MT', 'deliveryIdentity.unit'); equal(delivery.lineAmountCents, sourceLines[0]?.lineAmountCents, 'deliveryIdentity.lineAmountCents');
  hash(delivery.sourceFactsFingerprint, 'deliveryIdentity.sourceFactsFingerprint');
  const ledger = plain(root.accountTax) ? root.accountTax : {};
  const ledgerAccount = plain(ledger.account) ? ledger.account : {};
  const ledgerTax = plain(ledger.tax) ? ledger.tax : {};
  equal(ledgerAccount.Code, '51100', 'accountTax.account.Code'); equal(ledgerAccount.Type, 'DIRECTCOSTS', 'accountTax.account.Type');
  equal(ledgerAccount.Status, 'ACTIVE', 'accountTax.account.Status'); id(ledgerAccount.AccountID, 'accountTax.account.AccountID');
  equal(ledgerTax.TaxType, 'NONE', 'accountTax.tax.TaxType'); equal(ledgerTax.Status, 'ACTIVE', 'accountTax.tax.Status');
  equal(issuedPetroleumDecimal(ledgerTax.DisplayTaxRate)?.text, '0', 'accountTax.tax.DisplayTaxRate');
  equal(issuedPetroleumDecimal(ledgerTax.EffectiveRate)?.text, '0', 'accountTax.tax.EffectiveRate');
  equal(ledgerTax.CanApplyToExpenses, true, 'accountTax.tax.CanApplyToExpenses');
  for (const rawLine of xero.rawLineItems || []) if (rawLine.AccountID != null) equal(id(rawLine.AccountID, 'xero.rawLineItems.AccountID'), id(ledgerAccount.AccountID, 'accountTax.account.AccountID'), 'xero.rawLineItems.AccountID', 'MAPPING_MISMATCH');
  const mappings = array(root.productMappings, 'productMappings', 1).map((mapping) => {
    require(mapping?.enabled === true && Number.isSafeInteger(mapping.revision) && mapping.revision > 0, 'MAPPING_INVALID', 'productMappings', 'An enabled current mapping revision is required.');
    id(mapping?.approvedBy, 'productMappings.approvedBy');
    string(mapping?.approvedByEmail, 'productMappings.approvedByEmail', false, 320);
    require(typeof mapping?.approvedAt === 'string' && Number.isFinite(Date.parse(mapping.approvedAt)), 'MAPPING_INVALID', 'productMappings.approvedAt', 'Existing mapping approval evidence is required.');
    equal(mapping?.direction, 'supplier', 'productMappings.direction'); equal(mapping?.xeroAccountCode, '51100', 'productMappings.account'); equal(mapping?.xeroTaxType, 'NONE', 'productMappings.tax');
    const productId = id(mapping?.salesforceProductId, 'productMappings.productId', true); equal(productId, sourceLines[0]?.productId, 'productMappings.productId');
    return { id: id(mapping?.id, 'productMappings.id'), direction: 'supplier', salesforceProductId: productId, xeroAccountCode: '51100', xeroTaxType: 'NONE', enabled: true, revision: mapping?.revision, approvedBy: mapping?.approvedBy, approvedByEmail: mapping?.approvedByEmail, approvedAt: mapping?.approvedAt };
  });
  require(mappings.length === 1, 'MAPPING_INVALID', 'productMappings', 'Exactly one approved petroleum mapping is required.');
  singleton(identity.candidateContactIds, contactId, 'identity.candidateContactIds'); singleton(identity.accountIdsForContact, accountId, 'identity.accountIdsForContact', true);
  singleton(identity.candidateXeroDocumentIds, xeroId, 'identity.candidateXeroDocumentIds'); singleton(identity.documentIdentitySourceIds, sourceId, 'identity.documentIdentitySourceIds', true);
  require(array(identity.numberCollisionXeroIds, 'identity.numberCollisionXeroIds').length === 1 && identity.numberCollisionXeroIds.every((value) => id(value, 'identity.numberCollisionXeroIds') === xeroId), 'NUMBER_COLLISION', 'identity.numberCollisionXeroIds', 'A conflicting invoice number claim exists.');
  singleton(identity.numberCollisionSourceIds, sourceId, 'identity.numberCollisionSourceIds', true);
  for (const key of ['sourceMappings', 'targetMappings']) require(array(identity[key], `identity.${key}`, 2).length === 0, 'OWNERSHIP_CONFLICT', `identity.${key}`, 'An existing owner requires its separate sticky preservation check.');
  require(array(identity.creditCollisionIds, 'identity.creditCollisionIds').length === 0, 'CREDIT_CLAIM', 'identity.creditCollisionIds', 'A competing credit or allocation claim requires separate evidence.');
  hash(identity.coverageFingerprint, 'identity.coverageFingerprint');
  const contact = plain(identity.contactIdentity) ? identity.contactIdentity : {};
  const contactIdentity = { salesforceAccountId: id(contact.salesforceAccountId, 'contactIdentity.account', true), xeroContactId: id(contact.xeroContactId, 'contactIdentity.contact'),
    status: contact.status, matchBasis: contact.matchBasis, sourceMatchValue: string(contact.sourceMatchValue, 'contactIdentity.source'), xeroMatchValue: string(contact.xeroMatchValue, 'contactIdentity.xero'), evidenceFingerprint: hash(contact.evidenceFingerprint, 'contactIdentity.evidenceFingerprint') };
  equal(contactIdentity.salesforceAccountId, accountId, 'contactIdentity.account'); equal(contactIdentity.xeroContactId, contactId, 'contactIdentity.contact'); equal(contact.status, 'ACTIVE', 'contactIdentity.status');
  require(['account_name', 'company_key'].includes(contact.matchBasis), 'CONTACT_IDENTITY_INVALID', 'contactIdentity.matchBasis', 'Only approved Account/CL-key identity is supported.');
  equal(contact.sourceMatchValue, contact.xeroMatchValue, 'contactIdentity.values');
  equal(xero.status, 'AUTHORISED', 'xero.status', 'SETTLEMENT_UNSUPPORTED');
  const due = cents(xero.amountDue, 'xero.amountDue'); const paid = cents(xero.amountPaid, 'xero.amountPaid'); const credited = cents(xero.amountCredited, 'xero.amountCredited');
  equal(paid, 0n, 'xero.amountPaid', 'SETTLEMENT_UNSUPPORTED'); equal(credited, 0n, 'xero.amountCredited', 'SETTLEMENT_UNSUPPORTED'); equal(due?.toString(), xeroHeader.totalCents, 'xero.amountDue', 'SETTLEMENT_UNSUPPORTED');
  const accounting = { tenantId, salesforceOrgId: orgId, baseCurrency: 'USD', source: {
    salesforceObject: 'Supplier_Invoice__c', salesforceId: sourceId, accountId, contactId, stemId, vessel,
    sourceFingerprint: hash(source.sourceFingerprint, 'source.sourceFingerprint'), financialFingerprint: hash(source.financialFingerprint, 'source.financialFingerprint'),
    documentNumber: sourceNumber, invoiceDate: sourceDate, dueDate: source.dueDate, reference: string(source.reference, 'source.reference', true),
    type: 'ACCPAY', collection: 'Invoices', currency: 'USD', ...sourceHeader, signedTotalCents: sourceHeader.totalCents, lines: sourceLines },
  xero: { id: xeroId, contactId, type: 'ACCPAY', collection: 'Invoices', invoiceNumber: string(xero.invoiceNumber, 'xero.invoiceNumber'),
    date: xero.date, dueDate: xero.dueDate, reference: string(xero.reference, 'xero.reference', true), currency: 'USD', currencyRate: '1',
    ...xeroHeader, lines: xeroLines, rawLineItems: xero.rawLineItems, settlementEvidence: xero.settlementEvidence, unowned: plain(xero.unowned) ? xero.unowned : null },
  productMappings: mappings, contactIdentity, issuedFile: file, matchBasis: 'issued_petroleum_vessel_delivery_amount',
  deliveryIdentity: { ...delivery, parentId: sourceId, stemId, supplierId: accountId, vesselId, vessel, childId: sourceLines[0]?.id, productId: sourceLines[0]?.productId, quantity: sourceLines[0]?.quantity, unitAmount: sourceLines[0]?.unitAmount },
  identityScope: { coverageFingerprint: identity.coverageFingerprint, sourceIds: identity.documentIdentitySourceIds, targetIds: identity.candidateXeroDocumentIds, sourceNumberIds: identity.numberCollisionSourceIds, targetNumberIds: identity.numberCollisionXeroIds }, accountTax: ledger };
  require(Array.isArray(xero.paymentClaims) && xero.paymentClaims.length === 0 && Array.isArray(xero.creditClaims) && xero.creditClaims.length === 0 && Array.isArray(xero.prepaymentClaims) && xero.prepaymentClaims.length === 0 && Array.isArray(xero.overpaymentClaims) && xero.overpaymentClaims.length === 0, 'SETTLEMENT_UNSUPPORTED', 'xero.claims', 'Payments and allocations must be absent in the raw current target.');
  require(xero.settlementEvidence?.basis === 'complete_invoice_zero_balances_optional_collections_v1'
    && ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].every((key) => typeof xero.settlementEvidence?.collections?.[key]?.present === 'boolean'
      && Array.isArray(xero.settlementEvidence.collections[key].rows) && xero.settlementEvidence.collections[key].rows.length === 0),
  'SETTLEMENT_UNSUPPORTED', 'xero.settlementEvidence', 'Complete explicit settlement-collection observations are required.');
  require(plain(xero.unowned), 'EVIDENCE_INCOMPLETE', 'xero.unowned', 'Complete retained Xero metadata is required.');
  require(Array.isArray(xero.rawLineItems) && xero.rawLineItems.length === 1, 'EVIDENCE_INCOMPLETE', 'xero.rawLineItems', 'The complete original Xero line must be retained.');
  require(Buffer.byteLength(issuedSupplierCanonical({ policyVersion: ISSUED_PETROLEUM_PRESERVATION_POLICY, accounting })) <= 100_000,
    'EVIDENCE_BOUND', 'accounting', 'The complete immutable proof exceeds the bounded transaction size.');
  if (blockers.length) return rejected();
  const evidence = { policyVersion: ISSUED_PETROLEUM_PRESERVATION_POLICY, accounting,
    observations: { status: 'AUTHORISED', amountDueCents: due.toString(), amountPaidCents: '0', amountCreditedCents: '0', ownership: { kind: 'unlinked' } } };
  return freeze({ eligible: true, policyVersion: ISSUED_PETROLEUM_PRESERVATION_POLICY, requiresExplicitReview: true,
    fingerprint: issuedSupplierAccountingFingerprint(evidence), evidenceFingerprint: issuedSupplierHash(evidence), evidence, accepted: false, blockers: [] });
}
