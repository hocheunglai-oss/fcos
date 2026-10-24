import { createHash } from 'node:crypto';

export const DOCUMENT_FIELD_POLICY = 'document_field_correction_v1';
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const literal = (value) => typeof value === 'string' && value.trim().length > 0 ? value : null;
const canonical = (value) => JSON.stringify(value, (_key, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const clone = (value) => structuredClone(value);
const directionOf = (direction) => ['buyer', 'sales', 'ACCREC'].includes(direction) ? 'buyer'
  : ['supplier', 'bill', 'ACCPAY'].includes(direction) ? 'supplier' : null;
const credit = (record, direction) => Number(direction === 'buyer' ? record?.Amount__c : record?.Invoice_Amount__c) < 0
  || (direction === 'buyer' && /-CN-/i.test(record?.Name || ''));
const inactive = (record) => record?.IsDeleted === true || record?.Cancelled__c === true
  || [record?.Status__c, record?.Invoice_Status__c].some((value) => ['CANCELLED', 'CANCELED', 'VOIDED', 'DELETED', 'INACTIVE', 'DEPRECATED'].includes(value));
const activeBuyer = (record) => record?.Proforma__c === false && record?.Deprecated__c === false
  && !inactive(record) && !credit(record, 'buyer');

function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function xeroDate(value) {
  if (realDate(value)) return value;
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
    && Number.isFinite(Date.parse(value))) return realDate(value.slice(0, 10));
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]));
  return Number.isFinite(date.getTime()) ? realDate(date.toISOString().slice(0, 10)) : null;
}

function diagnostics() {
  const blockers = []; const blockerCodes = [];
  return { blockers, blockerCodes, fail(code, message) {
    if (!blockerCodes.includes(code)) { blockerCodes.push(code); blockers.push(message); }
  } };
}

function buyerEvidence(record) {
  return { id: record?.Id ?? null, name: record?.Name ?? null, stemId: record?.STEM__c ?? null,
    deliveryDate: record?.Delivery_Date__c ?? null, invoiceDate: record?.Invoice_Date__c ?? null,
    proforma: record?.Proforma__c ?? null, deprecated: record?.Deprecated__c ?? null,
    inactive: inactive(record), credit: credit(record, 'buyer') };
}

// Pure projection: supplier dates must be proved by buyer invoices, never by
// supplier/STEM delivery dates, expected dates, created dates or filename text.
export function buildDocumentFieldProjection({ record = {}, direction, buyers = [], lines = [], extras = [], cutoff = '2026-01-01' } = {}) {
  record = plain(record) ? record : {};
  const side = directionOf(direction);
  const { blockers, blockerCodes, fail } = diagnostics();
  const evidence = { direction: side, cutoff, sourceId: record.Id ?? null, originalName: record.Name ?? null,
    stemId: record.STEM__c ?? null, resolution: null, buyers: [], links: [],
    vesselName: record.STEM__r?.Vessel__r?.Name ?? null, refCode: record.STEM__r?.RefCode__c ?? null,
    dueDate: record.Invoice_Due_Date__c ?? null,
    dateSource: 'Invoice__c.Delivery_Date__c', descriptionSource: 'Invoice__c.Invoice_Date__c',
    dueDateSource: side === 'buyer' ? 'Invoice__c.Invoice_Due_Date__c' : 'Supplier_Invoice__c.Invoice_Due_Date__c' };
  const fields = { Date: null, DueDate: null, InvoiceNumber: null, ...(side === 'buyer' ? { Reference: null } : {}), Description: null };
  const finish = (scope) => {
    const projection = { policy: DOCUMENT_FIELD_POLICY, scope, fields, evidence, blockers, blockerCodes };
    return { ...projection, fingerprint: hash(projection) };
  };
  if (!side || credit(record, side)) {
    fail('DOCUMENT_FIELD_UNSUPPORTED', 'Document field corrections support normal sales invoices and bills only.');
    return finish('unsupported');
  }
  if (!realDate(cutoff)) fail('DOCUMENT_FIELD_CUTOFF_INVALID', 'The document field cutoff must be a real ISO calendar date.');
  if (!literal(record.Id)) fail('DOCUMENT_FIELD_SOURCE_ID_MISSING', 'The exact Salesforce document identity is missing.');
  if (!literal(record.Name)) fail('DOCUMENT_FIELD_SOURCE_NAME_MISSING', 'The original Salesforce document number is missing.');
  if (inactive(record)) fail('DOCUMENT_FIELD_SOURCE_INACTIVE', 'The Salesforce document is inactive.');
  let resolved = [];
  if (side === 'buyer') {
    evidence.resolution = 'source_buyer'; resolved = [record];
  } else {
    const children = [...(Array.isArray(lines) ? lines : []), ...(Array.isArray(extras) ? extras : [])]
      .filter((row) => row?.Supplier_Invoice__c === record.Id && row?.Cancelled__c !== true);
    evidence.links = children.map((row) => ({ id: row.Id ?? null, buyerId: row.Buyer_Invoice__c ?? null,
      supplierId: row.Supplier_Invoice__c, stemId: row.STEM__c ?? null })).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    const linkedIds = [...new Set(children.map((row) => literal(row.Buyer_Invoice__c)).filter(Boolean))].sort();
    if (!Array.isArray(buyers) || !Array.isArray(lines) || !Array.isArray(extras)) {
      fail('DOCUMENT_FIELD_BUYER_EVIDENCE_INCOMPLETE', 'Complete buyer, product-line and extra-cost evidence is required.');
    }
    if (linkedIds.length) {
      evidence.resolution = 'linked_buyers';
      for (const id of linkedIds) {
        const matches = (Array.isArray(buyers) ? buyers : []).filter((row) => row?.Id === id);
        if (matches.length !== 1) fail('DOCUMENT_FIELD_LINKED_BUYER_MISSING', 'Each linked buyer identity must resolve to exactly one buyer invoice.');
        else resolved.push(matches[0]);
      }
      if (resolved.length !== linkedIds.length) resolved = [];
    } else {
      evidence.resolution = 'unique_stem_buyer';
      const sameStem = literal(record.STEM__c) ? (Array.isArray(buyers) ? buyers : []).filter((row) => row?.STEM__c === record.STEM__c) : [];
      // Include rejected candidates in the fingerprint, so activation or a new
      // candidate invalidates earlier evidence even if projected values agree.
      evidence.fallbackCandidates = sameStem.map(buyerEvidence).sort((a, b) => canonical(a).localeCompare(canonical(b)));
      resolved = sameStem.filter(activeBuyer);
      if (resolved.length !== 1) {
        fail('DOCUMENT_FIELD_BUYER_AMBIGUOUS', 'A bill without linked buyer invoices requires exactly one active normal buyer invoice on the same STEM.');
        resolved = [];
      }
    }
  }
  evidence.buyers = resolved.map(buyerEvidence).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  if (!resolved.length) fail('DOCUMENT_FIELD_BUYER_UNAVAILABLE', 'Verified buyer invoice evidence is unavailable.');
  for (const buyer of resolved) {
    if (!literal(buyer.Id) || !activeBuyer(buyer)) fail('DOCUMENT_FIELD_BUYER_INACTIVE', 'Every selected buyer invoice must be explicitly non-proforma, non-deprecated and active.');
    if (side === 'supplier' && (!literal(record.STEM__c) || buyer.STEM__c !== record.STEM__c)) {
      fail('DOCUMENT_FIELD_BUYER_STEM_CONFLICT', 'Every linked buyer invoice must belong to the bill STEM.');
    }
  }
  function consensus(key, missingCode, conflictCode) {
    const dates = resolved.map((row) => realDate(row[key]));
    if (!dates.length || dates.some((value) => value === null)) { fail(missingCode, `Every selected buyer invoice requires a valid ${key}.`); return null; }
    if (new Set(dates).size !== 1) { fail(conflictCode, `Selected buyer invoices disagree on ${key}.`); return null; }
    return dates[0];
  }
  fields.Date = consensus('Delivery_Date__c', 'DOCUMENT_FIELD_DELIVERY_DATE_MISSING', 'DOCUMENT_FIELD_DELIVERY_DATE_CONFLICT');
  const issueDate = consensus('Invoice_Date__c', 'DOCUMENT_FIELD_INVOICE_DATE_MISSING', 'DOCUMENT_FIELD_INVOICE_DATE_CONFLICT');
  fields.DueDate = realDate(record.Invoice_Due_Date__c);
  if (!fields.DueDate) fail('DOCUMENT_FIELD_DUE_DATE_MISSING', 'The prescribed invoice due date is missing or invalid.');
  if (issueDate) {
    const [year, month, day] = issueDate.split('-');
    fields.Description = `${side === 'buyer' ? 'INVOICE ' : ''}${Number(day)}/${Number(month)}/${year}`;
  }
  // A due date before the invoice issue date is valid evidence; do not invent a
  // new due date or move the delivery-date cutoff to make dates chronological.
  const vessel = literal(record.STEM__r?.Vessel__r?.Name);
  if (!vessel) fail('DOCUMENT_FIELD_VESSEL_MISSING', 'The exact STEM vessel name is missing.');
  if (side === 'buyer') {
    fields.InvoiceNumber = literal(record.Name); fields.Reference = vessel;
  } else {
    const refCode = literal(record.STEM__r?.RefCode__c);
    if (!refCode || !literal(refCode.slice(4))) fail('DOCUMENT_FIELD_REFCODE_MISSING', 'The STEM RefCode must contain a nonempty suffix after its first four characters.');
    else if (vessel) fields.InvoiceNumber = `${refCode.slice(4)}- ${vessel}`;
  }
  // Conflicting dates cannot select an update date, but fully verified linked
  // buyers can still prove that the whole bill predates the correction scope.
  if (!fields.Date && side === 'supplier' && evidence.resolution === 'linked_buyers' && realDate(cutoff)
    && blockerCodes.includes('DOCUMENT_FIELD_DELIVERY_DATE_CONFLICT')
    && blockerCodes.every((code) => ['DOCUMENT_FIELD_DELIVERY_DATE_CONFLICT', 'DOCUMENT_FIELD_INVOICE_DATE_CONFLICT'].includes(code))
    && resolved.length > 0 && resolved.every((buyer) => realDate(buyer.Delivery_Date__c) && buyer.Delivery_Date__c < cutoff)) {
    return finish('legacy');
  }
  if (!fields.Date || !realDate(cutoff)) return finish('unavailable');
  return finish(fields.Date < cutoff ? 'legacy' : 'current');
}

function projectionReady(projection) {
  return projection?.policy === DOCUMENT_FIELD_POLICY && projection.scope === 'current'
    && Array.isArray(projection.blockers) && projection.blockers.length === 0
    && Array.isArray(projection.blockerCodes) && projection.blockerCodes.length === 0
    && realDate(projection.fields?.Date) && realDate(projection.fields?.DueDate)
    && literal(projection.fields?.InvoiceNumber) && literal(projection.fields?.Description)
    && (projection.evidence?.direction === 'supplier' || (projection.evidence?.direction === 'buyer' && literal(projection.fields?.Reference)));
}

export function projectAccountingPayload(payload, projection) {
  const projected = clone(payload);
  if (!plain(projected) || !projectionReady(projection)) return projected;
  for (const field of ['Date', 'DueDate', 'InvoiceNumber']) projected[field] = projection.fields[field];
  if (projection.evidence.direction === 'buyer') projected.Reference = projection.fields.Reference;
  if (Array.isArray(projected.LineItems)) projected.LineItems = projected.LineItems.map((line) => ({ ...line, Description: projection.fields.Description }));
  return projected;
}

export function compareDocumentFieldProjection(projection, rawXeroInvoice) {
  if (!projectionReady(projection) || !plain(rawXeroInvoice)) return [];
  const differences = [];
  const fields = ['Date', 'DueDate', 'InvoiceNumber', ...(projection.evidence.direction === 'buyer' ? ['Reference'] : [])];
  for (const field of fields) {
    const current = ['Date', 'DueDate'].includes(field) ? xeroDate(rawXeroInvoice[field]) : rawXeroInvoice[field] ?? null;
    if (current !== projection.fields[field]) differences.push({ field, current, expected: projection.fields[field] });
  }
  if (!Array.isArray(rawXeroInvoice.LineItems) || !rawXeroInvoice.LineItems.length) {
    differences.push({ field: 'LineItems', current: rawXeroInvoice.LineItems ?? null, expected: 'Existing line items with the required description' });
  } else rawXeroInvoice.LineItems.forEach((line, lineIndex) => {
    if (line?.Description !== projection.fields.Description) differences.push({ field: `LineItems[${lineIndex}].Description`, lineIndex,
      lineItemId: line?.LineItemID ?? null, current: line?.Description ?? null, expected: projection.fields.Description });
  });
  return differences;
}

const nonnegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const LINE_FIELDS = new Set(['LineItemID', 'Description', 'Quantity', 'UnitAmount', 'ItemCode', 'AccountCode', 'AccountID',
  'TaxType', 'TaxAmount', 'Item', 'LineAmount', 'Tracking', 'DiscountRate', 'DiscountAmount', 'RepeatingInvoiceID', 'Taxability', 'SalesTaxCodeId', 'TaxBreakdown']);

// Raw provider detail is mandatory. Normalized list rows omit invariants and
// cannot establish a safe correction. Provider authorization belongs upstream.
export function evaluateDocumentFieldCorrection({ projection, rawXeroInvoice: raw, direction, organisation = {}, expectedInvoiceId, expectedStatus } = {}) {
  organisation = plain(organisation) ? organisation : {};
  const { blockers, blockerCodes, fail } = diagnostics();
  if (!projectionReady(projection)) fail('DOCUMENT_FIELD_PROJECTION_HELD', 'A complete current unblocked document-field projection is required.');
  const side = directionOf(direction ?? projection?.evidence?.direction);
  if (!side || side !== projection?.evidence?.direction) fail('DOCUMENT_FIELD_DIRECTION_CONFLICT', 'Correction direction must match the source projection.');
  if (!plain(raw) || !literal(raw?.InvoiceID)) fail('DOCUMENT_FIELD_TARGET_MISSING', 'A complete existing Xero invoice is required.');
  if (expectedInvoiceId !== undefined && raw?.InvoiceID !== expectedInvoiceId) fail('DOCUMENT_FIELD_TARGET_CHANGED', 'The current Xero document identity differs from the reviewed identity.');
  if (expectedStatus !== undefined && raw?.Status !== expectedStatus) fail('DOCUMENT_FIELD_STATUS_CHANGED', 'The current Xero status differs from the reviewed status.');
  if (raw?.Type !== (side === 'buyer' ? 'ACCREC' : 'ACCPAY')) fail('DOCUMENT_FIELD_TYPE_UNSUPPORTED', 'The Xero invoice type does not match the prescribed direction.');
  if (!['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID'].includes(raw?.Status)) fail('DOCUMENT_FIELD_STATUS_UNSUPPORTED', 'The Xero document status does not support correction.');
  const currentDate = xeroDate(raw?.Date);
  if (!currentDate) fail('DOCUMENT_FIELD_TARGET_DATE_INVALID', 'The current Xero accounting date is unavailable.');
  for (const key of ['periodLockDate', 'endOfYearLockDate']) {
    if (!Object.hasOwn(organisation, key) || (organisation[key] !== null && !xeroDate(organisation[key]))) {
      fail('DOCUMENT_FIELD_LOCK_EVIDENCE_MISSING', 'Explicit current organisation lock dates, or explicit nulls, are required.');
    } else if (organisation[key] !== null) {
      const lock = xeroDate(organisation[key]);
      if ((currentDate && currentDate <= lock) || (projection?.fields?.Date && projection.fields.Date <= lock)) {
        fail('DOCUMENT_FIELD_PERIOD_LOCKED', 'The current or proposed accounting date is in a locked period.');
      }
    }
  }
  const financialKeys = ['SubTotal', 'TotalTax', 'Total', 'AmountDue', 'AmountPaid', 'AmountCredited', 'CurrencyRate'];
  if (financialKeys.some((key) => !nonnegativeNumber(raw?.[key])) || !(raw?.CurrencyRate > 0) || !literal(raw?.CurrencyCode)
    || !literal(raw?.Contact?.ContactID) || !['Exclusive', 'Inclusive', 'NoTax'].includes(raw?.LineAmountTypes)) {
    fail('DOCUMENT_FIELD_ACCOUNTING_INCOMPLETE', 'Complete raw accounting, contact, currency and settlement values are required.');
  }
  const settled = raw?.Status === 'PAID' || raw?.AmountPaid > 0 || raw?.AmountCredited > 0
    || (nonnegativeNumber(raw?.Total) && nonnegativeNumber(raw?.AmountDue) && raw.Total !== raw.AmountDue)
    || ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].some((key) => Array.isArray(raw?.[key]) && raw[key].length > 0);
  // Paid AP nonfinancial edits became supported on 19 March 2026:
  // https://developer.xero.com/changelog ; Date is intentionally excluded.
  if (settled && currentDate !== projection?.fields?.Date) fail('DOCUMENT_FIELD_SETTLED_DATE_CHANGE', 'A paid, credited or partially settled document cannot change its accounting date.');
  if (!Array.isArray(raw?.LineItems) || !raw.LineItems.length) fail('DOCUMENT_FIELD_LINES_INCOMPLETE', 'Existing detailed Xero line items are required.');
  else {
    const ids = raw.LineItems.map((line) => literal(line?.LineItemID));
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) fail('DOCUMENT_FIELD_LINE_ID_INVALID', 'Every existing Xero line needs a distinct exact LineItemID.');
    for (const line of raw.LineItems) {
      if (!plain(line) || Object.keys(line).some((key) => !LINE_FIELDS.has(key) && key !== 'ValidationErrors')) {
        fail('DOCUMENT_FIELD_LINE_FIELDS_UNSUPPORTED', 'The Xero line contains unrecognized fields that cannot be safely replayed.');
      }
      if (Array.isArray(line?.ValidationErrors) && line.ValidationErrors.length) fail('DOCUMENT_FIELD_TARGET_ERRORS', 'Xero reports unresolved validation errors for a document line.');
      if (['Quantity', 'UnitAmount', 'LineAmount', 'TaxAmount', 'DiscountRate', 'DiscountAmount'].some((key) =>
        Object.hasOwn(line || {}, key) && (typeof line[key] !== 'number' || !Number.isFinite(line[key])))) {
        fail('DOCUMENT_FIELD_LINE_ACCOUNTING_INVALID', 'Every supplied line accounting value must be an exact finite provider number.');
      }
    }
  }
  if (raw?.HasErrors === true || (Array.isArray(raw?.ValidationErrors) && raw.ValidationErrors.length)) {
    fail('DOCUMENT_FIELD_TARGET_ERRORS', 'Xero reports unresolved validation errors for this document.');
  }
  const differences = compareDocumentFieldProjection(projection, raw);
  return { eligible: blockers.length === 0, blockers, blockerCodes, differences, settled };
}

// The payload is a minimal update envelope, containing existing provider lines
// only when descriptions change. Header totals, payment/credit collections and
// read-only timestamps never enter the write. No financial field is rebuilt.
export function buildDocumentFieldCorrectionPayload(input = {}) {
  const evaluation = evaluateDocumentFieldCorrection(input);
  if (!evaluation.eligible) {
    const error = new Error(evaluation.blockers.join(' '));
    error.code = 'XERO_DOCUMENT_FIELD_CORRECTION_HELD'; error.status = 409;
    error.blockers = evaluation.blockers; error.blockerCodes = evaluation.blockerCodes;
    throw error;
  }
  const { rawXeroInvoice: raw, projection } = input;
  const payload = { InvoiceID: raw.InvoiceID };
  for (const difference of evaluation.differences) {
    if (!difference.field.startsWith('LineItems')) payload[difference.field] = projection.fields[difference.field];
  }
  // Prevent a new accounting date from selecting a different automatic FX rate.
  if (Object.hasOwn(payload, 'Date')) payload.CurrencyRate = raw.CurrencyRate;
  if (evaluation.differences.some((difference) => difference.field.startsWith('LineItems'))) {
    payload.LineAmountTypes = raw.LineAmountTypes;
    payload.LineItems = raw.LineItems.map((line) => Object.fromEntries(Object.entries({ ...clone(line), Description: projection.fields.Description })
      .filter(([key]) => LINE_FIELDS.has(key))));
  }
  return payload;
}

function invariantSnapshot(raw, side) {
  const output = clone(raw);
  for (const key of ['Date', 'DateString', 'DueDate', 'DueDateString', 'InvoiceNumber', 'UpdatedDateUTC', 'UpdatedDateUTCString']) delete output[key];
  if (side === 'buyer') delete output.Reference;
  if (Array.isArray(output.LineItems)) output.LineItems = output.LineItems.map((line) => {
    const result = { ...line }; delete result.Description; return result;
  });
  return output;
}

function compareInvariants(before, after, path = '') {
  if (canonical(before) === canonical(after)) return [];
  if (plain(before) && plain(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .flatMap((key) => compareInvariants(before[key], after[key], path ? `${path}.${key}` : key));
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) return before.flatMap((value, index) => compareInvariants(value, after[index], `${path}[${index}]`));
  return [{ field: path, before: before ?? null, after: after ?? null }];
}

export function verifyDocumentFieldCorrectionReadback({ before, after, projection, direction } = {}) {
  const { blockers, blockerCodes, fail } = diagnostics();
  const side = directionOf(direction ?? projection?.evidence?.direction);
  if (!projectionReady(projection) || !side || side !== projection?.evidence?.direction) fail('DOCUMENT_FIELD_READBACK_PROJECTION_INVALID', 'Readback requires the same complete current source projection.');
  if (!plain(before) || !plain(after) || !literal(before?.InvoiceID) || !literal(after?.InvoiceID)) fail('DOCUMENT_FIELD_READBACK_MISSING', 'Complete before and after Xero detail is required.');
  const differences = compareDocumentFieldProjection(projection, after);
  const invariantDifferences = plain(before) && plain(after) ? compareInvariants(invariantSnapshot(before, side), invariantSnapshot(after, side)) : [];
  if (differences.length) fail('DOCUMENT_FIELD_READBACK_MISMATCH', 'Xero did not retain every prescribed document field exactly.');
  if (invariantDifferences.length) fail('DOCUMENT_FIELD_INVARIANT_CHANGED', 'A Xero field outside the authorized correction changed.');
  for (const [alias, key] of [['DateString', 'Date'], ['DueDateString', 'DueDate']]) {
    if (after && Object.hasOwn(after, alias) && xeroDate(after[alias]) !== xeroDate(after[key])) fail('DOCUMENT_FIELD_DATE_ALIAS_CONFLICT', 'Xero date aliases conflict with the corrected date fields.');
  }
  return { ok: blockers.length === 0, differences, invariantDifferences, blockers, blockerCodes };
}
