import { contactMatchesSalesforceIdentity } from './_xeroContactIdentity.js';
import { hkStrippedClKeyNameMatchKey, normalizeName } from './_xeroContactSync.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import { SALES_INVOICE_SUMMARY_POLICY } from './_xeroSalesInvoiceSummary.js';
import { nativeReviewedLineView, nativeSalesSummaryLineItems } from './_xeroNativeDocumentDraft.js';
import { verifyNativeXeroLines } from './_xeroNativeLineComparison.js';
import { accountingDecimalCents } from './_xeroAccountingLineCents.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const activeStatuses = new Set(['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID']);
const terminalStatuses = new Set(['VOIDED', 'DELETED']);
const pageSize = 100;

function invalid(message) {
  throw Object.assign(new Error(message), { status: 502, code: 'XERO_NATIVE_DOCUMENT_CANDIDATES_INCOMPLETE' });
}

function filterText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || /["\\\u0000-\u001f\u007f]/.test(value)) {
    invalid('An exact Xero search value could not be verified.');
  }
  return JSON.stringify(value);
}

function completePage(response, collection, idField, matches) {
  const rows = response?.[collection];
  const page = response?.pagination ?? response?.Pagination;
  if (!Array.isArray(rows) || rows.length >= pageSize || (page != null &&
      (page.page !== 1 || ![0, 1].includes(page.pageCount) || page.itemCount !== rows.length))
      || rows.some(row => !uuid.test(row?.[idField] || '') || !matches(row))
      || new Set(rows.map(row => row[idField].toLowerCase())).size !== rows.length) {
    invalid(`Xero ${collection} returned incomplete or out-of-scope evidence.`);
  }
  return rows;
}

async function contactCandidates(account, read) {
  const values = [account?.Name, hkStrippedClKeyNameMatchKey(account?.Company_Code__c)]
    .filter(value => typeof value === 'string' && value.trim());
  const names = new Map(values.map(value => [normalizeName(value), value.trim()]));
  const observed = new Map();
  for (const [key, name] of names) {
    const params = new URLSearchParams({ where: `Name==${filterText(name)}`, includeArchived: 'true', page: '1', pageSize: String(pageSize) });
    const rows = completePage(await read(`/Contacts?${params}`), 'Contacts', 'ContactID',
      row => normalizeName(row.Name) === key);
    for (const row of rows) {
      const id = row.ContactID.toLowerCase();
      if (observed.has(id)) invalid('A Xero contact changed across exact Account searches.');
      observed.set(id, row);
    }
  }
  return [...observed.values()].filter(row => row.ContactStatus === 'ACTIVE' && !row.MergedToContactID);
}

const accountIdentity = value => /^001[a-z0-9]{12}(?:[a-z0-9]{3})?$/i.test(value || '') ? value.slice(0, 15) : null;

function contactOwnership(accountId, sourceAccount, contact, accounts) {
  if (!Array.isArray(accounts) || !accounts.length
      || accounts.some(row => !accountIdentity(row?.id) || typeof row.inactiveSuspended !== 'boolean')
      || new Set(accounts.map(row => accountIdentity(row.id))).size !== accounts.length) {
    invalid('The Salesforce Account ownership inventory is incomplete.');
  }
  const selected = accounts.find(row => accountIdentity(row.id) === accountIdentity(accountId));
  const identity = { name: contact.Name, contactNumber: contact.ContactNumber, accountNumber: contact.AccountNumber };
  if (!selected || selected.inactiveSuspended !== false
      || selected.name !== sourceAccount.Name || selected.companyCode !== (sourceAccount.Company_Code__c || '')
      || !contactMatchesSalesforceIdentity(identity, [selected])) {
    return 'The selected Salesforce Account changed or no longer matches the Xero contact.';
  }
  const explicit = [identity.contactNumber, identity.accountNumber].map(accountIdentity).filter(Boolean);
  if (explicit.some(id => id !== accountIdentity(selected.id))
      || accounts.some(row => row !== selected && contactMatchesSalesforceIdentity(identity, [row]))) {
    return 'Another Salesforce Account can claim this Xero contact.';
  }
  return null;
}

export async function inspectNativeDocumentCandidates({ sourceObject, record, signedTotal, currency, currentMapping, lines, expectedRate, read, loadAccounts, loadTargetMappings }) {
  const buyer = sourceObject === 'Invoice__c';
  const account = buyer ? record.STEM__r?.Account__r : record.Supplier__r;
  const accountId = buyer ? record.STEM__r?.Account__c : record.Supplier__c;
  const blockers = [];
  const validAccount = accountIdentity(accountId) && account?.Inactive_Suspended__c === false;
  if (!validAccount) blockers.push('The Salesforce Account is missing or inactive.');
  const contacts = validAccount ? await contactCandidates(account, read) : [];
  if (contacts.length !== 1) blockers.push(contacts.length ? 'More than one active Xero contact matches this Account.' : 'No active Xero contact matches this Account.');
  const contact = contacts.length === 1 ? contacts[0] : null;
  let ownershipVerified = false;
  if (contact) {
    const blocker = contactOwnership(accountId, account, contact, await loadAccounts());
    if (blocker) blockers.push(blocker);
    else ownershipVerified = true;
  }

  const credit = signedTotal < 0;
  const collection = credit ? 'CreditNotes' : 'Invoices';
  const idField = credit ? 'CreditNoteID' : 'InvoiceID';
  const numberField = credit ? 'CreditNoteNumber' : 'InvoiceNumber';
  const expectedType = `${buyer ? 'ACCREC' : 'ACCPAY'}${credit ? 'CREDIT' : ''}`;
  const params = new URLSearchParams({ where: `${numberField}==${filterText(record.Name)}`,
    page: '1', pageSize: String(pageSize), unitdp: '4' });
  const rows = completePage(await read(`/${collection}?${params}`), collection, idField,
    row => row[numberField] === record.Name);
  const detailsRead = new Set();
  const readDetail = async target => {
    const response = await read(`/${collection}/${target}?unitdp=4`);
    const mapped = response?.[collection];
    if (!Array.isArray(mapped) || mapped.length !== 1 || !uuid.test(mapped[0]?.[idField] || '')
        || mapped[0][idField].toLowerCase() !== target.toLowerCase()) {
      invalid('The exact Xero document could not be verified by ID.');
    }
    detailsRead.add(target.toLowerCase());
    return mapped[0];
  };
  if (currentMapping) {
    if (currentMapping.protected_legacy === true) blockers.push('The saved Xero document mapping is protected.');
    const target = currentMapping.xero_document_id;
    if (!uuid.test(target || '') || currentMapping.xero_document_type !== expectedType) {
      blockers.push('The saved Xero document mapping has a different type or invalid target.');
    } else if (!rows.some(row => row[idField].toLowerCase() === target.toLowerCase())) {
      rows.push(await readDetail(target));
    }
  }
  const candidates = rows.map(row => {
    if (!activeStatuses.has(row.Status) && !terminalStatuses.has(row.Status)) invalid('Xero returned an unknown document status.');
    return { id: row[idField], number: row[numberField], status: row.Status, type: row.Type, currency: row.CurrencyCode,
      contactId: row.Contact?.ContactID ?? null, total: row.Total };
  });
  const active = rows.filter(row => activeStatuses.has(row.Status));
  if (active.length) {
    const targets = new Set(active.map(row => row[idField].toLowerCase()));
    const mappings = await loadTargetMappings([...targets]);
    if (!Array.isArray(mappings) || mappings.some(row => !uuid.test(row?.xero_document_id || '')
      || !targets.has(row.xero_document_id.toLowerCase()))) {
      invalid('The existing Xero target ownership inventory is incomplete.');
    }
    if (mappings.some(row => row.salesforce_object !== sourceObject
      || !row.salesforce_id || row.salesforce_id.slice(0, 15) !== record.Id?.slice(0, 15))) {
      blockers.push('An existing Xero target is owned by a different Salesforce document.');
    } else if ((!currentMapping && mappings.length) || (currentMapping && targets.has(currentMapping.xero_document_id?.toLowerCase())
      && (mappings.length !== 1 || mappings[0].id !== currentMapping.id || mappings[0].source_fingerprint !== currentMapping.source_fingerprint))) {
      blockers.push('The saved Xero target mapping changed during review.');
    }
  }
  if (active.length > 1) blockers.push('More than one active Xero document matches this number or saved target.');
  if (active.length === 0 && (currentMapping || rows.length)) blockers.push('A saved or historical Xero document needs review before another document can be considered.');
  if (active.length === 1) {
    const row = active[0];
    if (!contact || row.Contact?.ContactID !== contact.ContactID || row.Type !== expectedType
        || row[numberField] !== record.Name || row.CurrencyCode !== currency
        || !/^\d+(?:\.\d{1,2})?$/.test(String(row.Total ?? ''))
        || accountingDecimalCents(row.Total) !== accountingDecimalCents(Math.abs(signedTotal))
        || xeroPaymentDate(row.Date) !== xeroPaymentDate(record.Invoice_Date__c)
        || (currentMapping && (row[idField].toLowerCase() !== currentMapping.xero_document_id?.toLowerCase()
          || contact.ContactID !== currentMapping.xero_contact_id))) {
      blockers.push('The existing Xero document conflicts with the issued document or saved mapping.');
    }
  }
  let linesVerified = false;
  if (active.length === 1 && !blockers.length) {
    const candidate = active[0];
    const needsDetails = !Array.isArray(candidate.LineItems) || !candidate.LineItems.length
      || candidate.SubTotal == null || candidate.TotalTax == null || candidate.LineAmountTypes == null
      || ((expectedRate != null || currentMapping?.xero_currency_rate != null) && candidate.CurrencyRate == null);
    const full = needsDetails && !detailsRead.has(candidate[idField].toLowerCase())
      ? await readDetail(candidate[idField]) : candidate;
    const stableHeader = row => [row[numberField], row.Status, row.Type, row.CurrencyCode, row.Contact?.ContactID,
      accountingDecimalCents(row.Total), xeroPaymentDate(row.Date)];
    const before = stableHeader(candidate);
    const after = stableHeader(full);
    if (before.some((field, index) => field !== after[index])
        || (candidate.UpdatedDateUTC && full.UpdatedDateUTC && candidate.UpdatedDateUTC !== full.UpdatedDateUTC)) {
      blockers.push('The Xero document changed between its number search and exact detail read.');
    } else if ([expectedRate, currentMapping?.xero_currency_rate, candidate.CurrencyRate].some(rate => rate != null
        && (!(Number(rate) > 0) || Number(full.CurrencyRate) !== Number(rate)))) {
      blockers.push('The Xero document exchange rate differs from the reviewed or saved rate.');
    } else {
      const policy = currentMapping?.currency_evidence?.presentationPolicy;
      const summary = policy === SALES_INVOICE_SUMMARY_POLICY && expectedType === 'ACCREC';
      if (policy != null && !summary) blockers.push('The saved native document presentation policy is not supported.');
      else try {
        const expected = summary
          ? nativeSalesSummaryLineItems(lines, xeroPaymentDate(record.Invoice_Date__c), signedTotal).map(nativeReviewedLineView)
          : lines;
        verifyNativeXeroLines(full, expected, { compareDescription: true });
        linesVerified = true;
      } catch (error) {
        if (!['XERO_NATIVE_DOCUMENT_LINES_CHANGED', 'XERO_SALES_SUMMARY_INVALID'].includes(error.code)) throw error;
        blockers.push(error.message);
      }
    }
  }
  return { ownershipVerified, linesVerified, contact: contact ? { id: contact.ContactID, name: contact.Name } : null, candidates, blockers,
    status: blockers.length ? 'held' : active.length ? 'candidate_matches' : 'no_exact_number_match' };
}
