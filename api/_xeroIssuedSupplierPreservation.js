import { createHash } from 'node:crypto';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';

export const ISSUED_SUPPLIER_PRESERVATION_POLICY = 'issued_supplier_preserve_v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MISSING_FILE = 'Supplier invoice has no verified issued source file.';
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const words = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
export const issuedSupplierCanonical = (value) => JSON.stringify(value, (_key, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
export const issuedSupplierHash = (value) => createHash('sha256').update(issuedSupplierCanonical(value)).digest('hex');
export const issuedSupplierAccountingFingerprint = (value) => issuedSupplierHash({ policyVersion: value?.policyVersion, accounting: value?.accounting });

export function issuedSupplierSfId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value)) return null;
  const short = value.slice(0, 15);
  if (value.length === 18) {
    let suffix = '';
    for (let block = 0; block < 3; block += 1) {
      let mask = 0;
      for (let bit = 0; bit < 5; bit += 1) if (/[A-Z]/.test(short[block * 5 + bit])) mask |= 1 << bit;
      suffix += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[mask];
    }
    if (suffix !== value.slice(15)) return null;
  }
  return short;
}

function decimal(value) {
  if (!['number', 'string'].includes(typeof value) || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  const significant = fraction.replace(/0+$/, '');
  return { value: BigInt(whole + significant), scale: significant.length, text: whole + (significant ? `.${significant}` : '') };
}

export function issuedSupplierCents(value) {
  const parsed = decimal(value);
  return parsed && parsed.scale <= 2 ? parsed.value * 10n ** BigInt(2 - parsed.scale) : null;
}

export const issuedSupplierVessel = (number) => typeof number === 'string' ? words(/^\d+PT-(.+)$/.exec(number)?.[1]) : '';
const realDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const freeze = (value) => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

// Trusted-server facts only. This policy proves one existing aggregate trustee
// charge; it never supplies posting readiness, a human actor or a write payload.
// The collector must re-fetch bytes and independently verify checksum/SHA256 and
// complete current linkage. Matching labels or client "verified" flags do not do so.
export function evaluateIssuedSupplierPreservation(input = {}) {
  const blockers = [];
  const fail = (code, path, message) => { if (blockers.length < 64) blockers.push({ code, path, message }); };
  const require = (ok, code, path, message) => { if (!ok) fail(code, path, message); return Boolean(ok); };
  const rejected = () => freeze({ eligible: false, policyVersion: ISSUED_SUPPLIER_PRESERVATION_POLICY, accepted: false,
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
  equal(decimal(xero.currencyRate)?.text, '1', 'xero.currencyRate', 'FX_UNSUPPORTED');
  const sourceDate = date(source.invoiceDate, 'source.invoiceDate');
  date(source.dueDate, 'source.dueDate'); date(xero.date, 'xero.date'); date(xero.dueDate, 'xero.dueDate');
  equal(sourceDate, xero.date, 'xero.date', 'INVOICE_DATE_MISMATCH');
  require(realDate(root.cutoffDate) && realDate(sourceDate) && sourceDate >= root.cutoffDate, 'IDENTITY_SCOPE_INCOMPLETE', 'cutoffDate', 'The source must be within the complete current accounting scope.');
  for (const [path, values] of [['source.blockers', source.blockers], ['source.readiness.blockers', source.readiness?.blockers]]) {
    require(array(values, path).every((value) => value === MISSING_FILE), 'SOURCE_BLOCKED', path, 'Only a missing legacy file pointer is permitted; other source holds remain.');
  }
  const sourceNumber = string(source.documentNumber, 'source.documentNumber');
  require(/^M\d{7}$/.test(sourceNumber || '') && /^M-\d{2}-\d{2}-\d{3}$/.test(review.printedNumber || '')
    && review.printedNumber.replaceAll('-', '') === sourceNumber, 'ISSUED_NUMBER_MISMATCH', 'file.review.printedNumber', 'Only the exact reviewed trustee punctuation bridge is supported.');
  equal(review.sourceNumber, sourceNumber, 'file.review.sourceNumber');
  const vessel = words(string(source.issuedSupplierVessel, 'source.issuedSupplierVessel'));
  equal(words(review.vessel), vessel, 'file.review.vessel', 'VESSEL_MISMATCH');
  equal(issuedSupplierVessel(xero.invoiceNumber), vessel, 'xero.invoiceNumber', 'VESSEL_MISMATCH');
  equal(words(string(review.sellerName, 'file.review.sellerName')), words(string(source.accountName, 'source.accountName')), 'file.review.sellerName', 'SELLER_MISMATCH');
  equal(words(review.buyerName), 'FRATELLI COSULICH BUNKERS (HK) LTD', 'file.review.buyerName', 'BUYER_MISMATCH');
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
  equal(cents(review.totalTax, 'file.review.totalTax'), 0n, 'file.review.totalTax', 'TAX_UNSUPPORTED');
  const paperLines = array(review.lines, 'file.review.lines');
  require(paperLines.length > 0, 'PAPER_LINES_MISSING', 'file.review.lines', 'Printed fee lines are required.');
  const paperAmounts = paperLines.map((line, index) => { string(line?.description, `file.review.lines[${index}].description`); return cents(line?.amount, `file.review.lines[${index}].amount`, true); });
  if (paperAmounts.every((value) => value !== null)) equal(paperAmounts.reduce((sum, value) => sum + value, 0n).toString(), sourceHeader.totalCents, 'file.review.lines', 'PAPER_ARITHMETIC_MISMATCH');
  const normalizedLine = (row, path, fromSource) => {
    const line = plain(row) ? row : {}; const quantity = decimal(line.quantity); const unit = decimal(line.unitAmount); const amount = cents(line.lineAmount, `${path}.lineAmount`, true);
    require(quantity?.value > 0n && unit?.value > 0n, 'LINE_UNITS_INVALID', path, 'Explicit positive quantities and unit amounts are required.');
    if (quantity && unit && amount !== null) {
      const denominator = 10n ** BigInt(quantity.scale + unit.scale);
      equal((2n * quantity.value * unit.value * 100n + denominator) / (2n * denominator), amount, `${path}.lineAmount`, 'LINE_ARITHMETIC_MISMATCH');
    }
    equal(line.accountCode, '51106', `${path}.accountCode`, 'MAPPING_MISMATCH'); equal(line.taxType, 'NONE', `${path}.taxType`, 'TAX_UNSUPPORTED');
    for (const key of ['taxAmount', 'discountRate', 'discountAmount']) equal(decimal(line[key])?.text, '0', `${path}.${key}`, 'ADJUSTMENT_UNSUPPORTED');
    require(Array.isArray(line.tracking) && line.tracking.length === 0 && line.itemCode === '', 'LINE_UNSUPPORTED', path, 'Tracking and inventory items are outside this policy.');
    if (fromSource) { equal(line.currency, 'USD', `${path}.currency`); equal(line.productName, 'TRUSTEE SERVICE', `${path}.productName`, 'PRODUCT_UNSUPPORTED'); }
    return { id: id(line.id, `${path}.id`, fromSource), description: string(line.description, `${path}.description`, true),
      quantity: quantity?.text, unitAmount: unit?.text, lineAmountCents: amount?.toString(), accountCode: '51106', taxType: 'NONE',
      taxAmount: '0', discountRate: '0', discountAmount: '0', tracking: [], itemCode: '',
      ...(fromSource ? { productId: id(line.productId, `${path}.productId`, true), currency: 'USD' } : {}) };
  };
  const sourceLines = array(source.lines, 'source.lines', 1).map((line, index) => normalizedLine(line, `source.lines[${index}]`, true));
  const xeroLines = array(xero.lines, 'xero.lines', 1).map((line, index) => normalizedLine(line, `xero.lines[${index}]`, false));
  require(sourceLines.length === 1 && xeroLines.length === 1, 'LINE_COUNT_UNSUPPORTED', 'lines', 'Exactly one source trustee line and one Xero aggregate line are supported.');
  equal(sourceLines[0]?.lineAmountCents, sourceHeader.totalCents, 'source.lines', 'LINE_HEADER_MISMATCH'); equal(xeroLines[0]?.lineAmountCents, xeroHeader.totalCents, 'xero.lines', 'LINE_HEADER_MISMATCH');
  singleton(source.readiness?.linkedChildren, sourceLines[0]?.id, 'source.readiness.linkedChildren', true);
  const mappings = array(root.productMappings, 'productMappings', 1).map((mapping) => {
    require(mapping?.enabled === true && Number.isSafeInteger(mapping.revision) && mapping.revision > 0, 'MAPPING_INVALID', 'productMappings', 'An enabled current mapping revision is required.');
    equal(mapping?.direction, 'supplier', 'productMappings.direction'); equal(mapping?.xeroAccountCode, '51106', 'productMappings.account'); equal(mapping?.xeroTaxType, 'NONE', 'productMappings.tax');
    const productId = id(mapping?.salesforceProductId, 'productMappings.productId', true); equal(productId, sourceLines[0]?.productId, 'productMappings.productId');
    return { id: id(mapping?.id, 'productMappings.id'), direction: 'supplier', salesforceProductId: productId, xeroAccountCode: '51106', xeroTaxType: 'NONE', enabled: true, revision: mapping?.revision };
  });
  require(mappings.length === 1, 'MAPPING_INVALID', 'productMappings', 'Exactly one approved trustee mapping is required.');
  singleton(identity.candidateContactIds, contactId, 'identity.candidateContactIds'); singleton(identity.accountIdsForContact, accountId, 'identity.accountIdsForContact', true);
  singleton(identity.candidateXeroDocumentIds, xeroId, 'identity.candidateXeroDocumentIds'); singleton(identity.documentIdentitySourceIds, sourceId, 'identity.documentIdentitySourceIds', true);
  require(array(identity.numberCollisionXeroIds, 'identity.numberCollisionXeroIds').every((value) => id(value, 'identity.numberCollisionXeroIds') === xeroId), 'NUMBER_COLLISION', 'identity.numberCollisionXeroIds', 'A conflicting invoice number claim exists.');
  singleton(identity.numberCollisionSourceIds, sourceId, 'identity.numberCollisionSourceIds', true);
  for (const key of ['sourceMappings', 'targetMappings']) require(array(identity[key], `identity.${key}`, 2).length === 0, 'OWNERSHIP_CONFLICT', `identity.${key}`, 'An existing owner requires its separate sticky preservation check.');
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
    ...xeroHeader, lines: xeroLines, rawLineItems: xero.rawLineItems, unowned: plain(xero.unowned) ? xero.unowned : null },
  productMappings: mappings, contactIdentity, issuedFile: file, matchBasis: 'issued_vessel_date_amount' };
  require(plain(xero.unowned), 'EVIDENCE_INCOMPLETE', 'xero.unowned', 'Complete retained Xero metadata is required.');
  require(Array.isArray(xero.rawLineItems) && xero.rawLineItems.length === 1, 'EVIDENCE_INCOMPLETE', 'xero.rawLineItems', 'The complete original Xero line must be retained.');
  require(Buffer.byteLength(issuedSupplierCanonical({ policyVersion: ISSUED_SUPPLIER_PRESERVATION_POLICY, accounting })) <= 100_000,
    'EVIDENCE_BOUND', 'accounting', 'The complete immutable proof exceeds the bounded transaction size.');
  if (blockers.length) return rejected();
  const evidence = { policyVersion: ISSUED_SUPPLIER_PRESERVATION_POLICY, accounting,
    observations: { status: 'AUTHORISED', amountDueCents: due.toString(), amountPaidCents: '0', amountCreditedCents: '0', ownership: { kind: 'unlinked' } } };
  return freeze({ eligible: true, policyVersion: ISSUED_SUPPLIER_PRESERVATION_POLICY, requiresExplicitReview: true,
    fingerprint: issuedSupplierAccountingFingerprint(evidence), evidenceFingerprint: issuedSupplierHash(evidence), evidence, accepted: false, blockers: [] });
}
