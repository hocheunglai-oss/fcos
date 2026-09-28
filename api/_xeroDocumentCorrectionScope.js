import { buildDocumentFieldProjection } from './_xeroDocumentFieldPolicy.js';
import { documentCorrectionHash } from './_xeroDocumentCorrectionPersistence.js';
import { xeroAccountingFetch } from './_xeroContactSync.js';

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const sf = (value) => typeof value === 'string' ? value.slice(0, 15) : '';
const unique = (values) => [...new Set(values)].sort();
const literal = (value) => typeof value === 'string' && value.trim() ? value : null;
const dateOnly = (value) => {
  if (typeof value !== 'string') return null;
  const ms = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(value);
  const date = ms ? new Date(Number(ms[1])) : new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};
export const DOCUMENT_CORRECTION_SCOPE_LIMITS = Object.freeze({ pageSize: 1000, rowsPerQuery: 10000, previewItems: 3000, previewBytes: 20000000, queryLength: 1700, identifiersPerQuery: 50 });
export const correctionScopeError = (message = 'The complete correction evidence could not be collected. No corrections were applied. Review the evidence scope and try again.') =>
  Object.assign(new Error(message), { code: 'XERO_DOCUMENT_CORRECTION_SCOPE_INCOMPLETE', status: 409 });
function assertNumberSyntax(numbers) {
  if (numbers.some((value) => !literal(value) || /["\\\u0000-\u001f\u007f]/u.test(value))) {
    const error = correctionScopeError('A document number uses unsupported query syntax. Complete exact-number evidence is required; no corrections were applied.');
    error.details = { scopeReason: 'DOCUMENT_CORRECTION_NUMBER_SYNTAX_UNSUPPORTED' };
    throw error;
  }
}

// All source records remain available for link resolution, shared-contact proofs
// and ownership checks. Only confirmed legacy *output rows* are omitted.
export function buildDocumentCorrectionScope(salesforce, stored, cutoff = '2026-01-01') {
  if (!['buyers', 'suppliers', 'lines', 'extras'].every((key) => Array.isArray(salesforce?.[key]))
    || !Array.isArray(stored?.documentMappings) || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || dateOnly(cutoff) !== cutoff) throw correctionScopeError();
  const entries = [];
  for (const [direction, records, object] of [['buyer', salesforce.buyers, 'Invoice__c'], ['supplier', salesforce.suppliers, 'Supplier_Invoice__c']]) {
    for (const record of records) {
      const projection = buildDocumentFieldProjection({ record, direction, buyers: salesforce.buyers, lines: salesforce.lines, extras: salesforce.extras, cutoff });
      if (projection.scope !== 'unsupported') entries.push({ object, id: record.Id, originalNumber: record.Name, projection });
    }
  }
  const scope = { cutoff, totalSourceCount: entries.length, excludedLegacyCount: entries.filter((entry) => entry.projection.scope === 'legacy').length };
  if (scope.totalSourceCount - scope.excludedLegacyCount > DOCUMENT_CORRECTION_SCOPE_LIMITS.previewItems) {
    const error = correctionScopeError('The current and unresolved correction scope exceeds its complete preview bound. No preview was saved and no corrections were applied.');
    error.details = { scopeReason: 'PREVIEW_ITEM_BOUND', scope };
    throw error;
  }
  const targets = entries.filter((entry) => entry.projection.scope === 'current' && !entry.projection.blockers.length);
  const invoiceIds = []; const invoiceNumbers = [];
  for (const entry of targets) {
    const mappings = stored.documentMappings.filter((mapping) => mapping.salesforce_object === entry.object && sf(mapping.salesforce_id) === sf(entry.id));
    for (const mapping of mappings) {
      if (!UUID.test(mapping.xero_document_id || '')) throw correctionScopeError();
      invoiceIds.push(mapping.xero_document_id.toLowerCase());
    }
    // Sales numbers require a global duplicate check even with an exact mapping.
    // Mapped bills use their exact target IDs; shared derived bill numbers are valid.
    if (entry.object === 'Invoice__c' || !mappings.length) {
      invoiceNumbers.push(...[entry.originalNumber, entry.projection.fields.InvoiceNumber].filter(literal));
    }
  }
  assertNumberSyntax(invoiceNumbers);
  return { scope, invoiceIds: unique(invoiceIds), invoiceNumbers: unique(invoiceNumbers), readCurrentDates: targets.length > 0 };
}

function batches(values, pathFor) {
  const output = []; let batch = [];
  for (const value of values) {
    if (pathFor([value]).length > DOCUMENT_CORRECTION_SCOPE_LIMITS.queryLength) throw correctionScopeError();
    if (batch.length && (batch.length === DOCUMENT_CORRECTION_SCOPE_LIMITS.identifiersPerQuery
      || pathFor([...batch, value]).length > DOCUMENT_CORRECTION_SCOPE_LIMITS.queryLength)) { output.push(batch); batch = []; }
    batch.push(value);
  }
  if (batch.length) output.push(batch);
  return output;
}

// Dedicated complete invoice paging: stable identity order, duplicate detection,
// optional provider count validation, and the existing 10k bound per exact scope.
export async function loadDocumentCorrectionInvoicePages(connection, path, options = {}) {
  const { accountingFetch = xeroAccountingFetch, ...requestOptions } = options;
  const rows = []; const ids = new Set(); let expected = null;
  const { pageSize, rowsPerQuery } = DOCUMENT_CORRECTION_SCOPE_LIMITS;
  for (let page = 1; page <= rowsPerQuery / pageSize + 1; page += 1) {
    const params = new URLSearchParams(path.split('?')[1] || '');
    params.set('page', String(page)); params.set('pageSize', String(pageSize)); params.set('order', 'InvoiceID ASC'); params.set('includeArchived', 'true');
    params.set('unitdp', '4'); params.set('summaryOnly', 'false');
    const result = await accountingFetch(connection, `/Invoices?${params}`, { ...requestOptions, method: 'GET' });
    const values = result?.Invoices; const pagination = result?.pagination;
    if (!Array.isArray(values) || values.length > pageSize) throw correctionScopeError();
    if (pagination != null) {
      if (typeof pagination !== 'object' || Array.isArray(pagination)) throw correctionScopeError();
      for (const key of ['page', 'pageSize', 'pageCount', 'itemCount']) if (Object.hasOwn(pagination, key)
        && (!Number.isSafeInteger(pagination[key]) || pagination[key] < (['pageCount', 'itemCount'].includes(key) ? 0 : 1))) throw correctionScopeError();
      if ((pagination.page != null && pagination.page !== page) || (pagination.pageSize != null && pagination.pageSize !== pageSize)) throw correctionScopeError();
      const totals = { pageCount: pagination.pageCount ?? null, itemCount: pagination.itemCount ?? null };
      if (expected && documentCorrectionHash(expected) !== documentCorrectionHash(totals)) throw correctionScopeError();
      expected = totals;
    } else if (expected) throw correctionScopeError();
    for (const row of values) {
      const id = typeof row?.InvoiceID === 'string' ? row.InvoiceID.toLowerCase() : '';
      if (!UUID.test(id) || ids.has(id)) throw correctionScopeError();
      ids.add(id); rows.push(row);
    }
    if (rows.length > rowsPerQuery) throw correctionScopeError();
    if ((expected?.itemCount != null && rows.length > expected.itemCount)
      || (expected?.pageCount != null && page > expected.pageCount && !(page === 1 && !rows.length && expected.pageCount === 0))) throw correctionScopeError();
    if (expected?.itemCount != null && expected?.pageCount != null) {
      const totalPages = Math.ceil(expected.itemCount / pageSize);
      if (expected.pageCount !== totalPages && !(expected.itemCount === 0 && expected.pageCount === 1)) throw correctionScopeError();
      if (rows.length === expected.itemCount && (page === expected.pageCount || (!rows.length && expected.pageCount === 0))) return rows;
    }
    if (values.length < pageSize) {
      if ((expected?.itemCount != null && expected.itemCount !== rows.length) || (expected?.pageCount != null && page < expected.pageCount)) throw correctionScopeError();
      return rows;
    }
  }
  throw correctionScopeError();
}

// A complete union of current accounting dates and cross-date identities covers
// every matching rule used by the correction service. No amount-only lookup.
export async function collectDocumentCorrectionInvoices(connection, plan, options = {}) {
  const { loadPages, canonicalizeInvoice = (row) => row, ...requestOptions } = options;
  const read = loadPages || ((current, path, _collection, request) => loadDocumentCorrectionInvoicePages(current, path, request));
  assertNumberSyntax(plan.invoiceNumbers);
  const invoices = new Map(); const queryPaths = [];
  const collect = async (path, accepts) => {
    const scopedPath = `${path}&unitdp=4&summaryOnly=false`;
    const rows = await read(connection, scopedPath, 'Invoices', requestOptions);
    if (!Array.isArray(rows) || rows.length > DOCUMENT_CORRECTION_SCOPE_LIMITS.rowsPerQuery) throw correctionScopeError();
    const seen = new Set();
    for (const row of rows) {
      const id = typeof row?.InvoiceID === 'string' ? row.InvoiceID.toLowerCase() : '';
      if (!UUID.test(id) || seen.has(id) || !['ACCREC', 'ACCPAY'].includes(row.Type) || !accepts(row)) throw correctionScopeError();
      seen.add(id);
      const previous = invoices.get(id);
      if (previous && documentCorrectionHash(canonicalizeInvoice(previous)) !== documentCorrectionHash(canonicalizeInvoice(row))) throw correctionScopeError();
      invoices.set(id, row);
    }
    queryPaths.push(scopedPath);
  };
  if (plan.readCurrentDates) {
    const where = `Date>=DateTime(${plan.scope.cutoff.replaceAll('-', ',')})`;
    await collect(`/Invoices?where=${encodeURIComponent(where)}`, (row) => dateOnly(row.Date) >= plan.scope.cutoff);
  }
  // Current inventory already contains exact raw target records. Hydrate only
  // missing IDs across dates; apply rechecks exact details before each intent.
  const idsPath = (values) => `/Invoices?IDs=${encodeURIComponent(values.join(','))}`;
  for (const values of batches(plan.invoiceIds.filter((id) => !invoices.has(id)), idsPath)) await collect(idsPath(values), (row) => values.includes(row.InvoiceID.toLowerCase()));
  // InvoiceNumbers is the provider's exact list filter. A literal comma uses
  // a single equality; undocumented quote/backslash escaping is held above.
  const namesPath = (values) => `/Invoices?InvoiceNumbers=${encodeURIComponent(values.join(','))}`;
  const ordinary = plan.invoiceNumbers.filter((name) => !name.includes(','));
  for (const values of batches(ordinary, namesPath)) await collect(namesPath(values), (row) => values.includes(row.InvoiceNumber));
  for (const name of plan.invoiceNumbers.filter((value) => value.includes(','))) {
    const path = `/Invoices?where=${encodeURIComponent(`InvoiceNumber=="${name}"`)}`;
    if (path.length > DOCUMENT_CORRECTION_SCOPE_LIMITS.queryLength) throw correctionScopeError();
    await collect(path, (row) => row.InvoiceNumber === name);
  }
  return { invoices: [...invoices.values()], queryCount: queryPaths.length, queryFingerprint: documentCorrectionHash(queryPaths) };
}

const jsonbText = (value) => Array.isArray(value) ? `[${value.map(jsonbText).join(', ')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${jsonbText(entry)}`).join(', ')}}` : JSON.stringify(value);

export function compactDocumentCorrectionPreview(items, scope) {
  const visible = items.filter((item) => item.projection?.scope !== 'legacy').map((item) => {
    if (item.outcome === 'eligible') return item;
    const { source: _source, before: _before, mapping: _mapping, ...review } = item;
    return review;
  });
  if (items.length !== scope.totalSourceCount || items.length - visible.length !== scope.excludedLegacyCount
    || visible.length > DOCUMENT_CORRECTION_SCOPE_LIMITS.previewItems) throw correctionScopeError();
  return visible;
}

export function assertDocumentCorrectionPreviewBounds(items, summary) {
  // Match jsonb's separator spacing; all source values are JSON before storage.
  const bytes = Buffer.byteLength(jsonbText(JSON.parse(JSON.stringify(items))), 'utf8')
    + Buffer.byteLength(jsonbText(JSON.parse(JSON.stringify(summary))), 'utf8');
  if (items.length > DOCUMENT_CORRECTION_SCOPE_LIMITS.previewItems || bytes > DOCUMENT_CORRECTION_SCOPE_LIMITS.previewBytes) {
    const error = correctionScopeError('The current and unresolved correction scope exceeds its complete preview bound. No preview was saved and no corrections were applied.');
    error.details = { scopeReason: items.length > DOCUMENT_CORRECTION_SCOPE_LIMITS.previewItems ? 'PREVIEW_ITEM_BOUND' : 'PREVIEW_BYTE_BOUND', totalCount: items.length, bytes };
    throw error;
  }
}
