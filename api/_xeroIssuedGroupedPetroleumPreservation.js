import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY } from '../config/xeroIssuedPreservationPolicies.js';
import { buyerInvoiceSnapshotComparison } from './_buyerInvoiceApproval.js';
import { issuedPetroleumDecimal, issuedPetroleumVessel } from './_xeroIssuedPetroleumPreservation.js';
import { validatePetroleumOwnership } from './_xeroIssuedPetroleumOwnership.js';
import { issuedSupplierSfId, issuedSupplierCents, issuedSupplierHash, issuedSupplierCanonical,
  issuedSupplierAccountingFingerprint } from './_xeroIssuedSupplierPreservation.js';

export { ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY };
export const issuedGroupedPetroleumAccountingFingerprint = issuedSupplierAccountingFingerprint;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MISSING_FILE = 'Supplier invoice has no verified issued source file.';
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const legalWords = (value) => typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).map((word) => ({ LTD: 'LIMITED', INTL: 'INTERNATIONAL' })[word] || word).join(' ') : '';
const words = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const realDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const freeze = (value) => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

// Trusted-server facts only. This policy proves multiple physical petroleum lines against one existing aggregate
// charge; it never supplies posting readiness, a human actor or a write payload.
// The collector must re-fetch bytes and independently verify checksum/SHA256 and
// complete current linkage. Matching labels or client "verified" flags do not do so.
function evaluate(input = {}) {
  const blockers = [];
  const fail = (code, path, message) => { if (blockers.length < 64) blockers.push({ code, path, message }); };
  const require = (ok, code, path, message) => { if (!ok) fail(code, path, message); return Boolean(ok); };
  const rejected = () => freeze({ eligible: false, policyVersion: ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY, accepted: false,
    requiresExplicitReview: true, fingerprint: null, evidenceFingerprint: null, evidence: null, blockers });
  let root;
  try {
    const json = JSON.stringify(input);
    if (!json || Buffer.byteLength(json) > 300_000 || !plain(input)) throw new Error('invalid');
    root = JSON.parse(json);
  } catch { fail('EVIDENCE_BOUND', 'input', 'Complete bounded JSON evidence is required.'); return rejected(); }
  const source = plain(root.source) ? root.source : {};
  const xero = plain(root.xero) ? root.xero : {};
  const identity = plain(root.identity) ? root.identity : {};
  const file = plain(root.fileEvidence) ? root.fileEvidence : {};
  const review = plain(file.review) ? file.review : {};
  const rawEvidence = plain(root.sourceEvidence) ? root.sourceEvidence : {};
  const direction = root.direction; const buyer = direction === 'buyer';
  require(['buyer', 'supplier'].includes(direction), 'DIRECTION_INVALID', 'direction', 'An exact accounting direction is required.');
  const sourceObject = buyer ? 'Invoice__c' : 'Supplier_Invoice__c';
  const xeroType = buyer ? 'ACCREC' : 'ACCPAY'; const accountCode = buyer ? '41100' : '51100';
  const parent = plain(rawEvidence.parent) ? rawEvidence.parent : {};
  const stem = plain(parent.STEM__r) ? parent.STEM__r : {};
  const delivery = { parentId: parent.Id, stemId: parent.STEM__c, stemKey: stem.KeyStem__c, accountId: buyer ? stem.Account__c : parent.Supplier__c,
    vesselId: stem.Vessel__c, vessel: stem.Vessel__r?.Name, imo: stem.Vessel__r?.IMO__c ?? null, deliveryDate: stem.Delivery_Date__c };
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
  equal(source.salesforceObject, sourceObject, 'source.salesforceObject');
  equal(source.xeroType, xeroType, 'source.xeroType'); equal(source.xeroCollection, 'Invoices', 'source.xeroCollection');
  equal(xero.type, xeroType, 'xero.type'); equal(xero.collection, 'Invoices', 'xero.collection');
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
    require(array(values, path).every((value) => !buyer && value === MISSING_FILE), 'SOURCE_BLOCKED', path, 'Only a missing legacy file pointer is permitted; other source holds remain.');
  }
  const sourceNumber = string(source.documentNumber, 'source.documentNumber');
  const printedNumber = string(review.printedNumber, 'file.review.printedNumber');
  require((buyer && review.numberRule === 'buyer_generated_stem_number' && printedNumber === stem.KeyStem__c
      && /^HK\d{2}\d+[A-Z]$/.test(printedNumber || '') && new RegExp(`^${String(printedNumber).slice(4)}-INV-[1-9]\\d*$`).test(sourceNumber || ''))
    || (!buyer && review.numberRule === 'exact' && printedNumber === sourceNumber)
    || (!buyer && review.numberRule === 'reviewed_ascii_hyphens' && typeof printedNumber === 'string'
      && /^[A-Za-z0-9-]+$/.test(printedNumber) && /^[A-Za-z0-9]+$/.test(sourceNumber || '')
      && printedNumber.includes('-') && printedNumber.replaceAll('-', '') === sourceNumber),
  'ISSUED_NUMBER_MISMATCH', 'file.review.printedNumber', 'Only the exact reviewed invoice-number punctuation bridge is supported.');
  equal(review.sourceNumber, sourceNumber, 'file.review.sourceNumber');
  const vessel = words(string(delivery.vessel, 'deliveryIdentity.vessel'));
  equal(words(review.vessel), vessel, 'file.review.vessel', 'VESSEL_MISMATCH');
  equal(buyer ? words(xero.reference) : issuedPetroleumVessel(xero.invoiceNumber), vessel, buyer ? 'xero.reference' : 'xero.invoiceNumber', 'VESSEL_MISMATCH');
  equal(id(delivery.parentId, 'deliveryIdentity.parentId', true), sourceId, 'deliveryIdentity.parentId');
  equal(id(delivery.stemId, 'deliveryIdentity.stemId', true), stemId, 'deliveryIdentity.stemId');
  equal(id(delivery.accountId, 'deliveryIdentity.accountId', true), accountId, 'deliveryIdentity.accountId');
  const vesselId = id(delivery.vesselId, 'deliveryIdentity.vesselId', true);
  require(vesselId?.startsWith('a0C') && stemId?.startsWith('a0H') && accountId?.startsWith('001')
    && sourceId?.startsWith(buyer ? 'a0K' : 'a06'), 'IDENTITY_INVALID', 'source', 'Typed Salesforce IDs are required.');
  require(review.imo === null || (typeof review.imo === 'string' && /^\d{7}$/.test(review.imo)
    && String(delivery.imo) === review.imo), 'IMO_MISMATCH', 'file.review.imo', 'A printed IMO must match the authoritative vessel exactly; absence remains null.');
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
  equal(legalWords(buyer ? review.buyerName : review.sellerName), legalWords(source.accountName), 'file.review.sellerName', 'SELLER_MISMATCH');
  equal(legalWords(buyer ? review.sellerName : review.buyerName), legalWords('FRATELLI COSULICH BUNKERS (HK) LTD'), 'file.review.buyerName', 'BUYER_MISMATCH');
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
  require(Number.isSafeInteger(file.contentSize) && file.contentSize >= 5 && file.contentSize <= 8_388_608 && file.contentType === 'application/pdf', 'FILE_INVALID', 'file', 'A bounded captured native PDF is required.');
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
  require(paperLines.length >= 2 && paperLines.length <= 50, 'PAPER_LINES_MISSING', 'file.review.lines', 'Two to fifty printed physical petroleum lines are required.');
  const paperAmounts = paperLines.map((line, index) => { string(line?.description, `file.review.lines[${index}].description`); return cents(line?.amount, `file.review.lines[${index}].amount`, true); });
  if (paperAmounts.every((value) => value !== null)) equal(paperAmounts.reduce((sum, value) => sum + value, 0n).toString(), sourceHeader.totalCents, 'file.review.lines', 'PAPER_ARITHMETIC_MISMATCH');
  const normalizedLine = (row, path, fromSource) => {
    const line = plain(row) ? row : {}; const quantity = issuedPetroleumDecimal(line.quantity); const unit = issuedPetroleumDecimal(line.unitAmount); const amount = cents(line.lineAmount, `${path}.lineAmount`, true);
    require(quantity?.value > 0n && unit?.value > 0n, 'LINE_UNITS_INVALID', path, 'Explicit positive quantities and unit amounts are required.');
    if (quantity && unit && amount !== null) {
      const denominator = 10n ** BigInt(quantity.scale + unit.scale);
      equal((2n * quantity.value * unit.value * 100n + denominator) / (2n * denominator), amount, `${path}.lineAmount`, 'LINE_ARITHMETIC_MISMATCH');
    }
    equal(line.accountCode, accountCode, `${path}.accountCode`, 'MAPPING_MISMATCH'); equal(line.taxType, 'NONE', `${path}.taxType`, 'TAX_UNSUPPORTED');
    for (const key of ['taxAmount', 'discountRate', 'discountAmount']) equal(issuedPetroleumDecimal(line[key])?.text, '0', `${path}.${key}`, 'ADJUSTMENT_UNSUPPORTED');
    require(Array.isArray(line.tracking) && line.tracking.length === 0 && line.itemCode === '', 'LINE_UNSUPPORTED', path, 'Tracking and inventory items are outside this policy.');
    if (fromSource) { equal(line.currency, 'USD', `${path}.currency`); string(line.productName, `${path}.productName`); require(line.discountProduct === false, 'ADJUSTMENT_UNSUPPORTED', path, 'Discount products are unsupported.'); }
    return { id: id(line.id, `${path}.id`, fromSource), description: string(line.description, `${path}.description`, true),
      quantity: quantity?.text, unitAmount: unit?.text, lineAmountCents: amount?.toString(), accountCode, taxType: 'NONE',
      taxAmount: '0', discountRate: '0', discountAmount: '0', tracking: [], itemCode: '',
      ...(fromSource ? { productId: id(line.productId, `${path}.productId`, true), productName: line.productName, currency: 'USD' } : {}) };
  };
  const sourceLines = array(source.lines, 'source.lines').map((line, index) => normalizedLine(line, `source.lines[${index}]`, true));
  const xeroLines = array(xero.lines, 'xero.lines', 1).map((line, index) => normalizedLine(line, `xero.lines[${index}]`, false));
  require(sourceLines.length >= 2 && sourceLines.length <= 50 && xeroLines.length === 1, 'LINE_COUNT_UNSUPPORTED', 'lines', 'Two to fifty source physical lines and exactly one target line are supported.');
  require(new Set(sourceLines.map(line => line.id)).size === sourceLines.length, 'LINE_ID_DUPLICATE', 'source.lines', 'Duplicate canonical children are unsupported.');
  if (sourceLines.every(line => /^\d+$/.test(line.lineAmountCents || ''))) equal(sourceLines.reduce((sum, line) => sum + BigInt(line.lineAmountCents), 0n).toString(), sourceHeader.totalCents, 'source.lines', 'LINE_HEADER_MISMATCH');
  equal(xeroLines[0]?.lineAmountCents, xeroHeader.totalCents, 'xero.lines', 'LINE_HEADER_MISMATCH');
  sourceLines.sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const sourceIds = sourceLines.map(line => line.id);
  const sameIds = (values, expected, path) => {
    const actual = array(values, path, 1000).map((value, i) => id(value, `${path}[${i}]`, true)).sort();
    require(new Set(actual).size === actual.length && issuedSupplierCanonical(actual) === issuedSupplierCanonical([...expected].sort()), 'SOURCE_FACTS_INVALID', path, 'The complete exact identity set must agree.');
  };
  sameIds(source.readiness?.linkedChildren, sourceIds, 'source.readiness.linkedChildren');
  sameIds(paperLines.map(line => line?.sourceChildId), sourceIds, 'file.review.lines.sourceChildIds');
  const rawLines = array(rawEvidence.lines, 'sourceEvidence.lines');
  const rawProducts = array(rawEvidence.products, 'sourceEvidence.products');
  const stemLines = array(rawEvidence.stemLines, 'sourceEvidence.stemLines', 1000);
  const stemExtras = array(rawEvidence.stemExtras, 'sourceEvidence.stemExtras', 1000);
  const rawExtras = array(rawEvidence.extras, 'sourceEvidence.extras', 1000);
  const boundKey = buyer ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c';
  const amountKey = buyer ? 'Total_Price__c' : 'Total_Cost__c'; const unitKey = buyer ? 'Unit_Sell_At__c' : 'Unit_Buy_At__c';
  const extraAmount = buyer ? 'Line_Total__c' : 'Line_Total_Buy__c';
  const rawCurrency = row => row?.CurrencyIsoCode ?? (rawEvidence.currencyContext?.singleCurrency === true ? rawEvidence.currencyContext.corporateCurrency : null);
  equal(rawEvidence.direction, direction, 'sourceEvidence.direction');
  equal(parent.IsDeleted, false, 'sourceEvidence.parent.IsDeleted'); equal(id(parent.Id, 'sourceEvidence.parent.Id', true), sourceId, 'sourceEvidence.parent.Id');
  equal(parent.Name, sourceNumber, 'sourceEvidence.parent.Name'); equal(parent.Invoice_Date__c, sourceDate, 'sourceEvidence.parent.Invoice_Date__c'); equal(parent.Invoice_Due_Date__c, source.dueDate, 'sourceEvidence.parent.Invoice_Due_Date__c');
  equal(cents(parent[buyer ? 'Amount__c' : 'Invoice_Amount__c'], 'sourceEvidence.parent.total', true)?.toString(), sourceHeader.totalCents, 'sourceEvidence.parent.total');
  equal(rawCurrency(parent), 'USD', 'sourceEvidence.parent.currency');
  const rawAccount = buyer ? stem.Account__r : parent.Supplier__r;
  equal(rawAccount?.Name, source.accountName, 'sourceEvidence.account.Name'); equal(rawAccount?.Company_Code__c ?? '', source.companyCode, 'sourceEvidence.account.Company_Code__c');
  sameIds(rawLines.map(line => line?.Id), sourceIds, 'sourceEvidence.lines');
  const productIds = [...new Set(sourceLines.map(line => line.productId))].sort();
  sameIds(rawProducts.map(product => product?.Id), productIds, 'sourceEvidence.products');
  require(rawExtras.length === 0, 'EXTRA_UNSUPPORTED', 'sourceEvidence.extras', 'Bound extra charges are outside this policy.');
  for (const [key, rows] of [['stemLines', stemLines], ['stemExtras', stemExtras]]) {
    require(new Set(rows.map(row => issuedSupplierSfId(row?.Id))).size === rows.length, 'SOURCE_FACTS_INVALID', `sourceEvidence.${key}`, 'Complete child inventory must have unique identities.');
    for (const row of rows) {
      id(row?.Id, `sourceEvidence.${key}.Id`, true); equal(id(row?.STEM__c, `sourceEvidence.${key}.STEM__c`, true), stemId, `sourceEvidence.${key}.STEM__c`);
      require(typeof row?.IsDeleted === 'boolean' && typeof row?.Cancelled__c === 'boolean' && Object.hasOwn(row || {}, boundKey), 'SOURCE_FACTS_INVALID', `sourceEvidence.${key}`, 'Deletion, cancellation and invoice binding must be explicit.');
      for (const [field, prefix] of [['Buyer_Invoice__c', 'a0K'], ['Supplier_Invoice__c', 'a06']]) require(row?.[field] === null || Boolean(issuedSupplierSfId(row?.[field])?.startsWith(prefix)), 'SOURCE_FACTS_INVALID', `sourceEvidence.${key}.${field}`, 'Both invoice bindings must be explicit null or valid typed IDs.');
      if (row?.IsDeleted === false && row.Cancelled__c === false && row[boundKey] === null) equal(cents(row[key === 'stemExtras' ? extraAmount : amountKey], `sourceEvidence.${key}.unboundAmount`), 0n, `sourceEvidence.${key}.unboundAmount`, 'UNBOUND_CHARGE');
      if (key === 'stemExtras') {
        require(issuedSupplierSfId(row?.[boundKey]) !== sourceId, 'EXTRA_UNSUPPORTED', 'sourceEvidence.stemExtras', 'A selected-parent extra is outside this policy.');
        if (row?.IsDeleted === false && row.Cancelled__c === false && !row[boundKey]) equal(cents(row[extraAmount], 'sourceEvidence.stemExtras.amount'), 0n, 'sourceEvidence.stemExtras.amount', 'EXTRA_UNSUPPORTED');
      }
    }
  }
  sameIds(stemLines.filter(row => issuedSupplierSfId(row?.[boundKey]) === sourceId).map(row => row.Id), sourceIds, 'sourceEvidence.stemLines.selected');
  const deliveryLines = [];
  for (const line of sourceLines) {
    const child = rawLines.find(row => issuedSupplierSfId(row?.Id) === line.id) || {};
    const product = rawProducts.find(row => issuedSupplierSfId(row?.Id) === line.productId) || {};
    const paper = paperLines.find(row => issuedSupplierSfId(row?.sourceChildId) === line.id) || {};
    require(line.id?.startsWith('a05') && line.productId?.startsWith('01t'), 'SOURCE_FACTS_INVALID', 'source.lines', 'Only physical children and exact Product2 identities are supported.');
    equal(child.IsDeleted, false, 'sourceEvidence.line.IsDeleted'); equal(child.Cancelled__c, false, 'sourceEvidence.line.Cancelled__c');
    equal(id(child[boundKey], 'sourceEvidence.line.invoice', true), sourceId, 'sourceEvidence.line.invoice'); equal(id(child.STEM__c, 'sourceEvidence.line.stem', true), stemId, 'sourceEvidence.line.stem');
    if (!buyer) equal(id(child.Original_Supplier__c, 'sourceEvidence.line.Original_Supplier__c', true), accountId, 'sourceEvidence.line.Original_Supplier__c');
    const inventory = stemLines.find(row => issuedSupplierSfId(row?.Id) === line.id) || {};
    for (const key of ['Id', 'STEM__c', 'Buyer_Invoice__c', 'Supplier_Invoice__c']) {
      require(child[key] === null || Boolean(issuedSupplierSfId(child[key])), 'SOURCE_FACTS_INVALID', `sourceEvidence.line.${key}`, 'Raw child identity observations are required.');
      require((child[key] === null && inventory[key] === null) || (issuedSupplierSfId(child[key]) !== null && issuedSupplierSfId(child[key]) === issuedSupplierSfId(inventory[key])), 'SOURCE_FACTS_INVALID', `sourceEvidence.line.inventory.${key}`, 'The complete STEM inventory must bind the selected raw child.');
    }
    for (const key of ['IsDeleted', 'Cancelled__c', amountKey]) equal(issuedSupplierHash(child[key]), issuedSupplierHash(inventory[key]), `sourceEvidence.line.inventory.${key}`);
    equal(id(child.Product__c, 'sourceEvidence.line.product', true), line.productId, 'sourceEvidence.line.product');
    equal(product.IsDeleted, false, 'sourceEvidence.product.IsDeleted'); require(typeof product.IsActive === 'boolean', 'PRODUCT_UNSUPPORTED', 'sourceEvidence.product.IsActive', 'Actual product state must be retained.');
    equal(product.RecordType?.DeveloperName, 'Petroleum_Product', 'sourceEvidence.product.RecordType', 'PRODUCT_UNSUPPORTED');
    equal(product.Name, line.productName, 'sourceEvidence.product.Name'); equal(child.Product__r?.Name, product.Name, 'sourceEvidence.line.productName');
    equal(rawCurrency(child), 'USD', 'sourceEvidence.line.currency'); equal(child.Unit_of_Measure__c, 'MT', 'sourceEvidence.line.unit');
    equal(date(child.BDN_Delivery_Date__c, 'sourceEvidence.line.BDN_Delivery_Date__c'), delivery.deliveryDate, 'sourceEvidence.line.BDN_Delivery_Date__c');
    equal(issuedPetroleumDecimal(child.Quantity_Delivered_Per_BDN__c)?.text, line.quantity, 'sourceEvidence.line.quantity');
    equal(issuedPetroleumDecimal(child[unitKey])?.text, line.unitAmount, 'sourceEvidence.line.unitAmount'); equal(cents(child[amountKey], 'sourceEvidence.line.amount', true)?.toString(), line.lineAmountCents, 'sourceEvidence.line.amount');
    equal(issuedPetroleumDecimal(paper.quantity)?.text, line.quantity, 'file.review.lines.quantity', 'QUANTITY_MISMATCH');
    equal(issuedPetroleumDecimal(paper.unitPrice)?.text, line.unitAmount, 'file.review.lines.unitPrice', 'PRICE_MISMATCH'); equal(paper.unit, 'MT', 'file.review.lines.unit');
    equal(cents(paper.amount, 'file.review.lines.amount', true)?.toString(), line.lineAmountCents, 'file.review.lines.amount');
    equal(id(paper.sourceProductId, 'file.review.lines.sourceProductId', true), line.productId, 'file.review.lines.sourceProductId'); equal(paper.sourceProductName, product.Name, 'file.review.lines.sourceProductName');
    string(paper.productEvidence, 'file.review.lines.productEvidence');
    deliveryLines.push({ childId: line.id, productId: line.productId, productName: product.Name, productRecordType: 'Petroleum_Product', quantity: line.quantity, unit: 'MT', unitAmount: line.unitAmount, lineAmountCents: line.lineAmountCents });
  }
  let sourceFileDocumentId = null; let buyerSnapshotHash = null;
  if (buyer) {
    equal(parent.Proforma__c, false, 'sourceEvidence.parent.Proforma__c'); equal(parent.Deprecated__c, false, 'sourceEvidence.parent.Deprecated__c');
    sourceFileDocumentId = issuedSupplierSfId(typeof parent.File__c === 'string' ? parent.File__c.split('/').at(-1) : null);
    equal(sourceFileDocumentId, documentId, 'sourceEvidence.parent.File__c');
    require(Object.hasOwn(parent, 'Buyer_Charge_Snapshot__c'), 'BUYER_SNAPSHOT_INVALID', 'sourceEvidence.parent.Buyer_Charge_Snapshot__c', 'Legacy snapshot absence must be observed.');
    if (parent.Buyer_Charge_Snapshot__c !== null && parent.Buyer_Charge_Snapshot__c !== '') {
      require(typeof parent.Buyer_Charge_Snapshot__c === 'string', 'BUYER_SNAPSHOT_INVALID', 'sourceEvidence.parent.Buyer_Charge_Snapshot__c', 'A complete source snapshot is required.');
      try {
        const snapshot = JSON.parse(parent.Buyer_Charge_Snapshot__c);
        const comparison = buyerInvoiceSnapshotComparison({ ...parent, _buyerInvoiceDocument: { Id: parent.File__c.split('/').at(-1), LatestPublishedVersionId: file.versionId } },
          { stem: { ...stem, Id: parent.STEM__c }, allLineItems: rawLines, allExtraCosts: stemExtras });
        require(comparison.kind === 'snapshot' && comparison.matches === true, 'BUYER_SNAPSHOT_INVALID', 'sourceEvidence.parent.Buyer_Charge_Snapshot__c', 'Current approved content has changed.'); buyerSnapshotHash = issuedSupplierHash(snapshot);
      } catch { fail('BUYER_SNAPSHOT_INVALID', 'sourceEvidence.parent.Buyer_Charge_Snapshot__c', 'The buyer snapshot is malformed.'); }
    }
  }
  const ledger = plain(root.accountTax) ? root.accountTax : {};
  const ledgerAccount = plain(ledger.account) ? ledger.account : {};
  const ledgerTax = plain(ledger.tax) ? ledger.tax : {};
  equal(ledgerAccount.Code, accountCode, 'accountTax.account.Code'); equal(ledgerAccount.Type, buyer ? 'REVENUE' : 'DIRECTCOSTS', 'accountTax.account.Type');
  equal(ledgerAccount.Status, 'ACTIVE', 'accountTax.account.Status'); id(ledgerAccount.AccountID, 'accountTax.account.AccountID');
  equal(ledgerTax.TaxType, 'NONE', 'accountTax.tax.TaxType'); equal(ledgerTax.Status, 'ACTIVE', 'accountTax.tax.Status');
  equal(issuedPetroleumDecimal(ledgerTax.DisplayTaxRate)?.text, '0', 'accountTax.tax.DisplayTaxRate');
  equal(issuedPetroleumDecimal(ledgerTax.EffectiveRate)?.text, '0', 'accountTax.tax.EffectiveRate');
  equal(ledgerTax[buyer ? 'CanApplyToRevenue' : 'CanApplyToExpenses'], true, 'accountTax.tax.applicability');
  for (const rawLine of array(xero.rawLineItems, 'xero.rawLineItems', 1)) {
    if (rawLine?.AccountID != null) equal(id(rawLine.AccountID, 'xero.rawLineItems.AccountID'), id(ledgerAccount.AccountID, 'accountTax.account.AccountID'), 'xero.rawLineItems.AccountID', 'MAPPING_MISMATCH');
    const normalized = normalizedLine({ id: rawLine?.LineItemID, description: rawLine?.Description, quantity: rawLine?.Quantity, unitAmount: rawLine?.UnitAmount,
      lineAmount: rawLine?.LineAmount, accountCode: rawLine?.AccountCode, taxType: rawLine?.TaxType, taxAmount: rawLine?.TaxAmount,
      discountRate: Object.hasOwn(rawLine || {}, 'DiscountRate') ? rawLine.DiscountRate : 0,
      discountAmount: Object.hasOwn(rawLine || {}, 'DiscountAmount') ? rawLine.DiscountAmount : 0, tracking: rawLine?.Tracking,
      itemCode: Object.hasOwn(rawLine || {}, 'ItemCode') ? rawLine.ItemCode : '' }, 'xero.rawLineItems', false);
    equal(issuedSupplierCanonical(normalized), issuedSupplierCanonical(xeroLines[0]), 'xero.rawLineItems', 'TARGET_CHANGED');
  }
  const mappings = array(root.productMappings, 'productMappings').map((mapping) => {
    require(mapping?.enabled === true && Number.isSafeInteger(mapping.revision) && mapping.revision > 0, 'MAPPING_INVALID', 'productMappings', 'An enabled current mapping revision is required.');
    id(mapping?.approvedBy, 'productMappings.approvedBy');
    string(mapping?.approvedByEmail, 'productMappings.approvedByEmail', false, 320);
    require(typeof mapping?.approvedAt === 'string' && Number.isFinite(Date.parse(mapping.approvedAt)), 'MAPPING_INVALID', 'productMappings.approvedAt', 'Existing mapping approval evidence is required.');
    equal(mapping?.direction, direction, 'productMappings.direction'); equal(mapping?.xeroAccountCode, accountCode, 'productMappings.account'); equal(mapping?.xeroTaxType, 'NONE', 'productMappings.tax');
    const productId = id(mapping?.salesforceProductId, 'productMappings.productId', true); require(productIds.includes(productId), 'MAPPING_INVALID', 'productMappings.productId', 'Only used products are permitted.');
    return { id: id(mapping?.id, 'productMappings.id'), direction, salesforceProductId: productId, xeroAccountCode: accountCode, xeroTaxType: 'NONE', enabled: true, revision: mapping?.revision, approvedBy: mapping?.approvedBy, approvedByEmail: mapping?.approvedByEmail, approvedAt: mapping?.approvedAt };
  });
  sameIds(mappings.map(row => row.salesforceProductId), productIds, 'productMappings.products');
  require(new Set(mappings.map(row => row.id)).size === mappings.length, 'MAPPING_INVALID', 'productMappings', 'Distinct mapping identities are required.');
  mappings.sort((a, b) => a.salesforceProductId < b.salesforceProductId ? -1 : a.salesforceProductId > b.salesforceProductId ? 1 : 0);
  singleton(identity.candidateContactIds, contactId, 'identity.candidateContactIds');
  const ownershipPresent = Object.hasOwn(identity, 'identityOwnershipPolicy') || Object.hasOwn(identity, 'identityOwnership');
  if (ownershipPresent) {
    require(validatePetroleumOwnership(identity, { tenantId, accountId, contactId, coverageFingerprint: identity.coverageFingerprint,
      accountIdsForContact: identity.accountIdsForContact }), 'CONTACT_OWNERSHIP_UNPROVEN', 'identity.identityOwnership', 'Complete versioned document-specific ownership proof is required.');
    const selectedOwner = Array.isArray(identity.identityOwnership?.owners) ? identity.identityOwnership.owners.find(row => row?.id === accountId) : null;
    equal(selectedOwner?.name, source.accountName, 'identity.identityOwnership.selectedName');
    equal(selectedOwner?.companyCode, source.companyCode, 'identity.identityOwnership.selectedKey');
  } else singleton(identity.accountIdsForContact, accountId, 'identity.accountIdsForContact', true);
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
  if (ownershipPresent) equal(words(identity.identityOwnership?.contact?.name).toUpperCase(), contact.xeroMatchValue, 'identity.identityOwnership.contactName');
  equal(xero.status, 'AUTHORISED', 'xero.status', 'SETTLEMENT_UNSUPPORTED');
  const due = cents(xero.amountDue, 'xero.amountDue'); const paid = cents(xero.amountPaid, 'xero.amountPaid'); const credited = cents(xero.amountCredited, 'xero.amountCredited');
  equal(paid, 0n, 'xero.amountPaid', 'SETTLEMENT_UNSUPPORTED'); equal(credited, 0n, 'xero.amountCredited', 'SETTLEMENT_UNSUPPORTED'); equal(due?.toString(), xeroHeader.totalCents, 'xero.amountDue', 'SETTLEMENT_UNSUPPORTED');
  const accounting = { tenantId, salesforceOrgId: orgId, baseCurrency: 'USD', direction, cutoffDate: root.cutoffDate, source: {
    salesforceObject: sourceObject, salesforceId: sourceId, accountId, contactId, stemId, vessel,
    sourceFingerprint: hash(source.sourceFingerprint, 'source.sourceFingerprint'), financialFingerprint: hash(source.financialFingerprint, 'source.financialFingerprint'),
    accountName: source.accountName, companyCode: source.companyCode, stemKey: source.stemKey, deliveryDate: source.deliveryDate, documentNumber: sourceNumber, invoiceDate: sourceDate, dueDate: source.dueDate, reference: string(source.reference, 'source.reference', true),
    type: xeroType, collection: 'Invoices', currency: 'USD', ...sourceHeader, signedTotalCents: sourceHeader.totalCents, lines: sourceLines },
  xero: { id: xeroId, contactId, type: xeroType, collection: 'Invoices', invoiceNumber: string(xero.invoiceNumber, 'xero.invoiceNumber'),
    date: xero.date, dueDate: xero.dueDate, reference: string(xero.reference, 'xero.reference', true), currency: 'USD', currencyRate: '1',
    ...xeroHeader, lines: xeroLines, rawLineItems: xero.rawLineItems, settlementEvidence: xero.settlementEvidence, unowned: plain(xero.unowned) ? xero.unowned : null },
  productMappings: mappings, contactIdentity, issuedFile: file, matchBasis: 'issued_grouped_petroleum_vessel_delivery_amount',
  sourceEvidence: rawEvidence, sourceEvidenceFingerprint: issuedSupplierHash(rawEvidence),
  issuanceBasis: { kind: buyer ? 'buyer_generated_stem_number' : 'supplier_native', sourceFileDocumentId, buyerSnapshotHash },
  groupedTotals: [{ accountCode, taxType: 'NONE', totalCents: sourceHeader.totalCents }],
  deliveryIdentity: { ...delivery, parentId: sourceId, stemId, accountId, vesselId, vessel, lines: deliveryLines },
  identityScope: { coverageFingerprint: identity.coverageFingerprint, sourceIds: identity.documentIdentitySourceIds, targetIds: identity.candidateXeroDocumentIds, sourceNumberIds: identity.numberCollisionSourceIds, targetNumberIds: identity.numberCollisionXeroIds }, accountTax: ledger,
  ...(ownershipPresent ? { identityOwnershipPolicy: identity.identityOwnershipPolicy, identityOwnership: identity.identityOwnership } : {}) };
  require(Array.isArray(xero.paymentClaims) && xero.paymentClaims.length === 0 && Array.isArray(xero.creditClaims) && xero.creditClaims.length === 0 && Array.isArray(xero.prepaymentClaims) && xero.prepaymentClaims.length === 0 && Array.isArray(xero.overpaymentClaims) && xero.overpaymentClaims.length === 0, 'SETTLEMENT_UNSUPPORTED', 'xero.claims', 'Payments and allocations must be absent in the raw current target.');
  require(xero.settlementEvidence?.basis === 'complete_invoice_zero_balances_optional_collections_v1'
    && ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].every((key) => typeof xero.settlementEvidence?.collections?.[key]?.present === 'boolean'
      && Array.isArray(xero.settlementEvidence.collections[key].rows) && xero.settlementEvidence.collections[key].rows.length === 0),
  'SETTLEMENT_UNSUPPORTED', 'xero.settlementEvidence', 'Complete explicit settlement-collection observations are required.');
  require(plain(xero.unowned), 'EVIDENCE_INCOMPLETE', 'xero.unowned', 'Complete retained Xero metadata is required.');
  require(Array.isArray(xero.rawLineItems) && xero.rawLineItems.length === 1, 'EVIDENCE_INCOMPLETE', 'xero.rawLineItems', 'The complete original Xero line must be retained.');
  require(Buffer.byteLength(issuedSupplierCanonical({ policyVersion: ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY, accounting })) <= 100_000,
    'EVIDENCE_BOUND', 'accounting', 'The complete immutable proof exceeds the bounded transaction size.');
  if (blockers.length) return rejected();
  const evidence = { policyVersion: ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY, accounting,
    observations: { status: 'AUTHORISED', amountDueCents: due.toString(), amountPaidCents: '0', amountCreditedCents: '0', ownership: { kind: 'unlinked' } } };
  require(Buffer.byteLength(issuedSupplierCanonical(evidence)) <= 100_000, 'EVIDENCE_BOUND', 'evidence', 'The complete immutable evidence exceeds the bounded transaction size.');
  if (blockers.length) return rejected();
  return freeze({ eligible: true, policyVersion: ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY, requiresExplicitReview: true,
    fingerprint: issuedSupplierAccountingFingerprint(evidence), evidenceFingerprint: issuedSupplierHash(evidence), evidence, accepted: false, blockers: [] });
}

// Malformed trusted snapshots must hold, never throw through an ordinary classifier.
export function evaluateIssuedGroupedPetroleumPreservation(input = {}) {
  try { return evaluate(input); } catch { return freeze({ eligible: false, policyVersion: ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY, accepted: false, requiresExplicitReview: true,
    fingerprint: null, evidenceFingerprint: null, evidence: null, blockers: [{ code: 'EVIDENCE_INVALID', path: 'input', message: 'Complete well-formed documentary evidence is required.' }] }); }
}

const money = value => typeof value === 'string' && /^\d+$/.test(value) ? `${BigInt(value) / 100n}.${String(BigInt(value) % 100n).padStart(2, '0')}` : null;
const headerInput = row => ({ ...row, total: money(row?.totalCents), subtotal: money(row?.subtotalCents), totalTax: row?.totalTax,
  lines: Array.isArray(row?.lines) ? row.lines.map(line => ({ ...line, lineAmount: money(line?.lineAmountCents), discountProduct: false })) : null });
// Recompute the policy, including embedded raw evidence and literal paper, rather
// than accepting a rehashed marker or canonical JSON as semantic validation.
export function validateIssuedGroupedPetroleumEvidence(evidence) {
  try {
    if (!plain(evidence) || evidence.policyVersion !== ISSUED_GROUPED_PETROLEUM_PRESERVATION_POLICY || !plain(evidence.accounting)) return false;
    const a = evidence.accounting; const s = a.source; const x = a.xero; const scope = a.identityScope;
    const result = evaluateIssuedGroupedPetroleumPreservation({ direction: a.direction, tenantId: a.tenantId, organisation: { baseCurrency: a.baseCurrency }, cutoffDate: a.cutoffDate,
      fileEvidence: a.issuedFile, sourceEvidence: a.sourceEvidence, accountTax: a.accountTax, productMappings: a.productMappings,
      source: { ...headerInput(s), xeroType: s.type, xeroCollection: s.collection, complete: true, signedTotal: money(s.signedTotalCents), blockers: [], readiness: { blockers: [], linkedChildren: s.lines.map(line => line.id) } },
      xero: { ...headerInput(x), complete: true, ...evidence.observations, amountDue: money(evidence.observations?.amountDueCents), amountPaid: money(evidence.observations?.amountPaidCents), amountCredited: money(evidence.observations?.amountCreditedCents),
        paymentClaims: x.settlementEvidence?.collections?.Payments?.rows, creditClaims: x.settlementEvidence?.collections?.CreditNotes?.rows, prepaymentClaims: x.settlementEvidence?.collections?.Prepayments?.rows, overpaymentClaims: x.settlementEvidence?.collections?.Overpayments?.rows },
      identity: { complete: true, coverageFingerprint: scope.coverageFingerprint, candidateContactIds: [s.contactId], accountIdsForContact: a.identityOwnership?.sourceAccountIds || [s.accountId],
        candidateXeroDocumentIds: scope.targetIds, documentIdentitySourceIds: scope.sourceIds, numberCollisionSourceIds: scope.sourceNumberIds, numberCollisionXeroIds: scope.targetNumberIds,
        creditCollisionIds: [], sourceMappings: [], targetMappings: [], contactIdentity: a.contactIdentity,
        ...(Object.hasOwn(a, 'identityOwnershipPolicy') || Object.hasOwn(a, 'identityOwnership') ? { identityOwnershipPolicy: a.identityOwnershipPolicy, identityOwnership: a.identityOwnership } : {}) } });
    return result.eligible && issuedSupplierCanonical(result.evidence) === issuedSupplierCanonical(evidence);
  } catch { return false; }
}
