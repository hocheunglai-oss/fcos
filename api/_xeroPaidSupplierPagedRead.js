import { copyPaidSupplierProofJson as copy } from './_xeroPaidSupplierProofJson.js';
import { issuedSupplierCanonical as canonical } from './_xeroIssuedSupplierPreservation.js';

// Server-only reads through the caller's already admitted shared GET budget.
// Xero July 2024 Accounting API supports pageSize 1,000. Existing V3 readers
// and all full invoice/payment detail reads remain unchanged.
export const PAID_SUPPLIER_PAGED_LIMITS = Object.freeze({ pageSize: 1000, contacts: 3000,
  creditNotes: 5000, contactsPerQuery: 8, queryLength: 1700, responseBytes: 20000000 });
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
  && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value) ? value.toLowerCase() : null;
const fail = (code = 'PAID_PAGED_READ_INCOMPLETE') => Object.assign(new Error('Complete bounded paid supplier history is unavailable.'), { code });
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Copy every original row intact with the original 1 MB per-proof JSON rules.
// A page is separately bounded to 20 MB; no currency/value projection or lossy
// serialization is used to make a larger response fit.
export function copyPaidSupplierPagedResponse(value, collection) {
  if (!['Contacts', 'CreditNotes'].includes(collection) || !plain(value)) throw fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !descriptors[key].enumerable
    || !Object.hasOwn(descriptors[key], 'value'))) throw fail();
  const result = copy(Object.fromEntries(Object.entries(descriptors).filter(([key]) => key !== collection)
    .map(([key, descriptor]) => [key, descriptor.value])));
  const rows = descriptors[collection]?.value;
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1000) throw fail();
  const items = Object.getOwnPropertyDescriptors(rows), keys = Reflect.ownKeys(items);
  if (keys.length !== rows.length + 1 || keys.some(key => typeof key !== 'string' || key !== 'length'
    && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= rows.length))) throw fail();
  let bytes = Buffer.byteLength(JSON.stringify(result));
  const copied = [];
  for (let index = 0; index < rows.length; index += 1) {
    const descriptor = items[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw fail();
    let row; try { row = copy({ row: descriptor.value }).row; } catch { throw fail(); }
    bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes > PAID_SUPPLIER_PAGED_LIMITS.responseBytes) throw fail('PAID_PAGED_RESPONSE_BOUND');
    copied.push(row);
  }
  Object.defineProperty(result, collection, { value: copied, enumerable: true, configurable: true, writable: true });
  if (result.HasErrors === true || result.HasValidationErrors === true || result.ValidationErrors !== undefined
    && (!Array.isArray(result.ValidationErrors) || result.ValidationErrors.length)) throw fail();
  if (result.Pagination !== undefined && result.pagination !== undefined && canonical(result.Pagination) !== canonical(result.pagination)) throw fail();
  if (result.Pagination !== undefined && result.pagination === undefined) result.pagination = result.Pagination;
  return result;
}

async function readPages(connection, read, { collection, idField, cap, contacts = null, signal }) {
  if (!uuid(connection?.tenantId) || typeof read !== 'function') throw fail();
  const tenant = uuid(connection.tenantId), version = connection.tokenVersion;
  const live = () => !signal?.aborted && uuid(connection.tenantId) === tenant && connection.tokenVersion === version;
  const rows = [], seen = new Set(); let expected = null, bytes = 0;
  const pageSize = PAID_SUPPLIER_PAGED_LIMITS.pageSize;
  const maxPages = cap / pageSize + 1;
  for (let page = 1; page <= maxPages; page += 1) {
    if (!live()) throw fail('PAID_PAGED_READ_CANCELLED');
    const params = new URLSearchParams({ includeArchived: 'true', order: `${idField} ASC`, page: String(page), pageSize: String(pageSize) });
    if (contacts) params.set('where', `(${contacts.map(id => `Contact.ContactID==Guid("${id}")`).join('||')})&&Type=="ACCPAYCREDIT"`);
    const path = `/${collection}?${params}`;
    if (path.length > PAID_SUPPLIER_PAGED_LIMITS.queryLength) throw fail();
    const response = copyPaidSupplierPagedResponse(await read(connection, path, { method: 'GET', transientRetryLimit: 0, retryOnRateLimit: false }), collection);
    if (!live()) throw fail('PAID_PAGED_READ_CANCELLED');
    const batch = response[collection], pagination = response.pagination;
    if (pagination !== undefined) {
      if (!plain(pagination) || ['page', 'pageSize', 'itemCount', 'pageCount'].some(key => Object.hasOwn(pagination, key)
        && (!Number.isSafeInteger(pagination[key]) || pagination[key] < (['itemCount', 'pageCount'].includes(key) ? 0 : 1)))
        || pagination.page !== undefined && pagination.page !== page
        || pagination.pageSize !== undefined && pagination.pageSize !== pageSize) throw fail();
      const totals = { itemCount: pagination.itemCount ?? null, pageCount: pagination.pageCount ?? null };
      if (expected && canonical(expected) !== canonical(totals)) throw fail('PAID_PAGED_READ_CHANGED');
      if (totals.itemCount > cap || totals.pageCount > maxPages) throw fail('PAID_PAGED_READ_CAP');
      expected = totals;
    } else if (expected) throw fail();
    for (const row of batch) {
      const id = uuid(row?.[idField]);
      if (!id || seen.has(id) || !plain(row)) throw fail();
      if (collection === 'Contacts' && (typeof row.Name !== 'string' || !row.Name.trim()
        || !['ACTIVE', 'ARCHIVED', 'GDPRREQUEST'].includes(row.ContactStatus))) throw fail();
      if (contacts && (row.Type !== 'ACCPAYCREDIT' || !contacts.includes(uuid(row.Contact?.ContactID)))) throw fail();
      seen.add(id); rows.push(row); bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
      if (rows.length > cap || bytes > PAID_SUPPLIER_PAGED_LIMITS.responseBytes) throw fail('PAID_PAGED_READ_CAP');
    }
    if (expected?.itemCount != null && rows.length > expected.itemCount
      || expected?.pageCount != null && page > expected.pageCount && !(page === 1 && !rows.length && expected.pageCount === 0)) throw fail();
    if (expected?.itemCount != null && expected?.pageCount != null && expected.pageCount !== Math.ceil(expected.itemCount / pageSize)
      && !(expected.itemCount === 0 && expected.pageCount === 1)) throw fail();
    if (expected?.itemCount != null && expected?.pageCount != null && rows.length === expected.itemCount
      && (page === expected.pageCount || (!rows.length && expected.pageCount === 0))) return freeze(rows);
    if (batch.length < pageSize) {
      if (expected?.itemCount != null && expected.itemCount !== rows.length || expected?.pageCount != null && page < expected.pageCount) throw fail();
      return freeze(rows);
    }
  }
  throw fail('PAID_PAGED_READ_CAP');
}

export function readPaidSupplierArchivedCredits(connection, contacts, read, { signal } = {}) {
  if (!Array.isArray(contacts) || contacts.length < 1 || contacts.length > PAID_SUPPLIER_PAGED_LIMITS.contactsPerQuery
    || contacts.some(id => !uuid(id)) || new Set(contacts.map(uuid)).size !== contacts.length) throw fail();
  return readPages(connection, read, { collection: 'CreditNotes', idField: 'CreditNoteID',
    cap: PAID_SUPPLIER_PAGED_LIMITS.creditNotes, contacts: contacts.map(uuid), signal });
}

export function readPaidSupplierContacts(connection, read, { signal } = {}) {
  return readPages(connection, read, { collection: 'Contacts', idField: 'ContactID', cap: PAID_SUPPLIER_PAGED_LIMITS.contacts, signal });
}

export function paidSupplierEfficientReadForecast(caseCount, contactCount) {
  if (!Number.isSafeInteger(caseCount) || caseCount < 1 || caseCount > 25 || !Number.isSafeInteger(contactCount)
    || contactCount < 1 || contactCount > caseCount) throw fail();
  const batches = Math.ceil(contactCount / 8), invoicePages = 11, creditPages = 6;
  const historyCalls = batches * (invoicePages + creditPages), operationCalls = historyCalls + 1 + caseCount + 3;
  const readbackCalls = 1 + caseCount + 3, recoveryCalls = 2;
  const identityCalls = 6; // 3,000 Contacts + terminal page, organisation before/after.
  return freeze({ caseCount, contactCount, batches, historyCalls, exactInvoiceCalls: 1, fullPaymentCalls: caseCount,
    settingsOrganisationCalls: 3, operationCalls, readbackCalls, recoveryCalls, verificationCalls: readbackCalls + recoveryCalls,
    totalCalls: operationCalls + readbackCalls + recoveryCalls, identityCalls,
    combinedCalls: operationCalls + readbackCalls + recoveryCalls + identityCalls,
    minimumAvailableCalls: operationCalls + readbackCalls + recoveryCalls + 200,
    combinedMinimumAvailableCalls: operationCalls + readbackCalls + recoveryCalls + identityCalls + 200,
    reserve: 200, maxConcurrent: 2, callsPerMinute: 45, automaticRetries: 0, writeCalls: 0 });
}
