import { xeroAccountingFetch } from './_xeroContactSync.js';
import { normalizeXeroCreditNote, normalizeXeroInvoice, XERO_FINANCIAL_CUTOFF } from './_xeroFinancialSync.js';

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const ACTIVE = new Set(['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID']);

function incomplete(message) {
  return Object.assign(new Error(message), { status: 502, code: 'XERO_CAMPAIGN_INVENTORY_INCOMPLETE', expose: true });
}

function identifier(row, field, collection) {
  const id = row?.[field];
  if (typeof id !== 'string' || !id) throw incomplete(`${collection} returned a record without its exact ID.`);
  return id.toLowerCase();
}

function uniqueIds(ids, name) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.trim())) throw incomplete(`${name} target IDs are invalid.`);
  const normalized = ids.map((id) => id.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw incomplete(`${name} target IDs repeat.`);
  return normalized;
}

function rowsById(rows, field, collection) {
  if (!Array.isArray(rows)) throw incomplete(`${collection} baseline is incomplete.`);
  const map = new Map();
  for (const row of rows) {
    const id = identifier(row, field, collection);
    if (map.has(id)) throw incomplete(`${collection} contains duplicate IDs.`);
    map.set(id, row);
  }
  return map;
}

function normalizedById(rows, collection) {
  if (!Array.isArray(rows)) throw incomplete(`${collection} baseline is incomplete.`);
  const map = new Map();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !row.id) throw incomplete(`${collection} baseline has no exact ID.`);
    const id = row.id.toLowerCase();
    if (map.has(id)) throw incomplete(`${collection} baseline contains duplicate IDs.`);
    map.set(id, row);
  }
  return map;
}

function merge(target, changes, field, collection) {
  for (const row of changes) target.set(identifier(row, field, collection), row);
}

function ordered(map) {
  return [...map.values()].sort((a, b) => String(a.id || a.InvoiceID || a.PaymentID || a.ContactID || a.CreditNoteID)
    .localeCompare(String(b.id || b.InvoiceID || b.PaymentID || b.ContactID || b.CreditNoteID)));
}

function contact(row) {
  return { id: row.ContactID, name: row.Name || '', status: String(row.ContactStatus || '').toUpperCase(),
    accountNumber: row.AccountNumber || '', contactNumber: row.ContactNumber || '', mergedToContactId: row.MergedToContactID || null };
}

function dateOnly(value) {
  if (!value) return null;
  const slash = String(value).match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (slash) return new Date(Number(slash[1])).toISOString().slice(0, 10);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function validateBaseline(connection, inventory) {
  if (!connection?.tenantId || inventory?.tenantId !== connection.tenantId || inventory.complete !== true
    || inventory.contactsComplete !== true || !inventory.paymentReadSnapshot
    || !Number.isFinite(Date.parse(inventory.observedSince || ''))
    || !inventory.organisation || !Array.isArray(inventory.documents)
    || !Array.isArray(inventory.inactiveDocuments) || !Array.isArray(inventory.contacts)) {
    throw incomplete('A complete same-tenant financial inventory is required.');
  }
  const documents = normalizedById([...inventory.documents, ...inventory.inactiveDocuments], 'documents');
  normalizedById(inventory.contacts, 'contacts');
  rowsById(inventory.paymentReadSnapshot.invoices, 'InvoiceID', 'invoices');
  rowsById(inventory.paymentReadSnapshot.payments, 'PaymentID', 'payments');
  return documents;
}

// Xero supports IDs on Invoices, but CreditNotes requires the single-ID route.
export function campaignDocumentReadPath(collection, id) {
  return collection === 'CreditNotes' ? `/CreditNotes/${encodeURIComponent(id)}?unitdp=4`
    : `/${collection}?IDs=${encodeURIComponent(id)}&summaryOnly=false&unitdp=4`;
}

/** Refresh changed records and exact selected targets without a whole-org rescan. */
export async function refreshCampaignInventory({ connection, inventory, env = process.env, fetchImpl,
  accountingFetch = xeroAccountingFetch, onResponse = () => {}, selectedInvoiceIds = [], selectedCreditNoteIds = [] } = {}) {
  const documents = validateBaseline(connection, inventory);
  const invoiceIds = uniqueIds(selectedInvoiceIds, 'Invoice');
  const creditIds = uniqueIds(selectedCreditNoteIds, 'Credit note');
  if (invoiceIds.some((id) => creditIds.includes(id))) throw incomplete('One target ID cannot name both an invoice and a credit note.');
  const requestStartedAt = new Date().toISOString();
  // The header has second precision. Re-read one preceding second so changes
  // made while the original full inventory started cannot fall through a gap.
  const since = new Date(Date.parse(inventory.observedSince) - 1000).toUTCString();
  const invoiceRaw = rowsById(inventory.paymentReadSnapshot.invoices, 'InvoiceID', 'invoices');
  const paymentRaw = rowsById(inventory.paymentReadSnapshot.payments, 'PaymentID', 'payments');
  const contacts = normalizedById(inventory.contacts, 'contacts');
  let callCount = 0;
  const read = async (path, headers = {}) => {
    callCount += 1;
    return accountingFetch(connection, path, { method: 'GET', headers, env, fetchImpl, onResponse });
  };
  const changed = async (collection, field, suffix = '') => {
    const rows = [];
    const seen = new Set();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await read(`/${collection}?page=${page}&pageSize=${PAGE_SIZE}${suffix}`, { 'If-Modified-Since': since });
      const chunk = response?.[collection];
      if (!Array.isArray(chunk) || chunk.length > PAGE_SIZE) throw incomplete(`${collection} delta page is malformed.`);
      if (response.Pagination && (response.Pagination.page !== page || response.Pagination.pageSize !== PAGE_SIZE
        || !Number.isSafeInteger(response.Pagination.pageCount) || response.Pagination.pageCount < page)) {
        throw incomplete(`${collection} pagination is inconsistent.`);
      }
      for (const row of chunk) {
        const id = identifier(row, field, collection);
        if (seen.has(id)) throw incomplete(`${collection} delta repeats an ID across pages.`);
        seen.add(id); rows.push(row);
      }
      const hasMore = response.Pagination ? page < response.Pagination.pageCount : chunk.length === PAGE_SIZE;
      if (!hasMore) return rows;
    }
    throw incomplete(`${collection} delta exceeds the bounded page limit.`);
  };
  const invoiceChanges = await changed('Invoices', 'InvoiceID', '&summaryOnly=false&unitdp=4');
  const creditChanges = await changed('CreditNotes', 'CreditNoteID', '&summaryOnly=false&unitdp=4');
  const contactChanges = await changed('Contacts', 'ContactID', '&includeArchived=true&summaryOnly=false');
  const paymentChanges = await changed('Payments', 'PaymentID');

  const exact = async (collection, field, ids) => {
    const found = new Map();
    const groupSize = collection === 'CreditNotes' ? 1 : 50;
    for (let offset = 0; offset < ids.length; offset += groupSize) {
      const group = ids.slice(offset, offset + groupSize);
      const suffix = collection === 'Payments' ? '' : '&summaryOnly=false&unitdp=4';
      let response;
      try {
        response = await read(collection === 'CreditNotes' ? campaignDocumentReadPath(collection, group[0])
          : `/${collection}?IDs=${encodeURIComponent(group.join(','))}${suffix}`);
      } catch (error) {
        // A missing single credit is explicit target evidence, not a failed delta.
        if (collection !== 'CreditNotes' || error?.status !== 404) throw error;
        continue;
      }
      if (!Array.isArray(response?.[collection])) throw incomplete(`${collection} exact target response is incomplete.`);
      for (const row of response[collection]) {
        const id = identifier(row, field, collection);
        if (!group.includes(id) || found.has(id)) throw incomplete(`${collection} exact target response conflicts with the requested IDs.`);
        found.set(id, row);
      }
    }
    return { rows: ordered(found), missingIds: ids.filter((id) => !found.has(id)) };
  };
  const exactInvoices = await exact('Invoices', 'InvoiceID', invoiceIds);
  const exactCredits = await exact('CreditNotes', 'CreditNoteID', creditIds);
  const organisationResponse = await read('/Organisations');
  if (!Array.isArray(organisationResponse?.Organisations) || organisationResponse.Organisations.length !== 1) {
    throw incomplete('The current Xero organisation and period locks are incomplete.');
  }
  const organisation = organisationResponse.Organisations[0];
  for (const row of [...invoiceChanges, ...exactInvoices.rows]) {
    invoiceRaw.set(identifier(row, 'InvoiceID', 'Invoices'), row);
    const id = row.InvoiceID.toLowerCase();
    if (dateOnly(row.Date) >= XERO_FINANCIAL_CUTOFF || documents.has(id) || invoiceIds.includes(id)) documents.set(id, normalizeXeroInvoice(row));
  }
  for (const row of [...creditChanges, ...exactCredits.rows]) {
    const id = identifier(row, 'CreditNoteID', 'CreditNotes');
    if (dateOnly(row.Date) >= XERO_FINANCIAL_CUTOFF || documents.has(id) || creditIds.includes(id)) documents.set(id, normalizeXeroCreditNote(row));
  }
  merge(paymentRaw, paymentChanges, 'PaymentID', 'Payments');
  for (const row of contactChanges) contacts.set(identifier(row, 'ContactID', 'Contacts'), contact(row));
  const normalized = ordered(documents);
  if (new Set(normalized.map((row) => row.id.toLowerCase())).size !== normalized.length) throw incomplete('Xero document IDs overlap across collections.');
  const rawInvoices = ordered(invoiceRaw);
  const rawPayments = ordered(paymentRaw);
  const normalizedContacts = ordered(contacts);
  return {
    ...inventory, complete: true, tenantId: connection.tenantId, observedSince: requestStartedAt,
    documents: normalized.filter((row) => ACTIVE.has(row.status)),
    inactiveDocuments: normalized.filter((row) => !ACTIVE.has(row.status)),
    contacts: normalizedContacts,
    organisation: { periodLockDate: dateOnly(organisation.PeriodLockDate),
      endOfYearLockDate: dateOnly(organisation.EndOfYearLockDate), baseCurrency: organisation.BaseCurrency || null },
    paymentReadSnapshot: { ...inventory.paymentReadSnapshot, invoices: rawInvoices, payments: rawPayments },
    fingerprintBasis: { documents: normalized.map((row) => ({ id: row.id, status: row.status,
      updated: row.updatedDateUTC, total: row.total, number: row.invoiceNumber || row.creditNoteNumber || '' })),
    contacts: normalizedContacts.map((row) => ({ id: row.id, name: row.name, status: row.status })),
      organisation: { periodLockDate: organisation.PeriodLockDate || null,
        endOfYearLockDate: organisation.EndOfYearLockDate || null, baseCurrency: organisation.BaseCurrency || null } },
    rawTargets: { invoices: exactInvoices.rows, creditNotes: exactCredits.rows },
    missingTargetIds: { invoices: exactInvoices.missingIds, creditNotes: exactCredits.missingIds },
    callCount,
  };
}
