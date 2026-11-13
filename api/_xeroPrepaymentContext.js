import { requireSupportedXeroPrepaymentCurrency } from './_xeroPrepaymentCurrency.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import { hkStrippedClKeyNameMatchKey, normalizeName, splitScopes } from './_xeroContactSync.js';
import { XERO_PREPAYMENT_POLICY_TABLE, loadPrepaymentPostingSettings } from './_xeroPrepaymentPolicy.js';
import { sfQuery } from './_salesforce.js';
import { loadTradeCashLedger, validateTradeCashLedger } from './_tradeCashLedger.js';
import { loadFinancialSafetyContext } from './_xeroDocumentSafety.js';
import {
  assertXeroFinancialDailyReserve, buildFinancialClassifications, loadSalesforceDocumentLinkSnapshot,
  loadSalesforcePayments, loadStoredDocumentLinkControls, loadXeroFinancialSnapshot, normalizeXeroInvoice,
  XERO_FINANCIAL_CUTOFF, xeroFinancialAccountingFetch, xeroFinancialRateSnapshot,
} from './_xeroFinancialSync.js';

const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const canonicalId = (id) => typeof id === 'string' && SALESFORCE_ID.test(id) ? id.slice(0, 15) : null;
const DOCUMENTS = [
  ['Invoice__c', 'Buyer_Invoice__c', 'Original_Invoice__c,STEM__r.Account__c'],
  ['Supplier_Invoice__c', 'Supplier_Invoice__c', 'Original_Supplier_Invoice__c,Supplier__c'],
];

function fail(message, status = 502) {
  throw Object.assign(new Error(message), { code: 'XERO_PREPAYMENT_SALESFORCE_INCOMPLETE', status });
}

async function exactRecords(query, objectName, fields, ids) {
  const records = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const expected = new Set(batch.map(canonicalId));
    const result = await query(`SELECT ${fields} FROM ${objectName} WHERE Id IN (${batch.map((id) => `'${id}'`).join(',')}) ORDER BY Id`,
      { clean: true, limit: 100 });
    const observed = new Set(Array.isArray(result?.records) ? result.records.map((row) => canonicalId(row?.Id)) : []);
    if (result?.error || result?.done === false || result?.nextRecordsUrl
      || !Array.isArray(result?.records) || result.totalSize !== batch.length
      || result.records.length !== batch.length || observed.size !== expected.size
      || [...observed].some((id) => !expected.has(id))) {
      fail(`Exact prepayment ${objectName} evidence is incomplete.`);
    }
    records.push(...result.records);
  }
  return records;
}

/** Read the Salesforce side of the prepayment graph without provider writes or a tenant-wide scan. */
export async function loadPrepaymentSalesforceContext(stemId, {
  query = sfQuery, queryAll, safetyContext = null,
} = {}) {
  if (!canonicalId(stemId)) fail('Invalid prepayment STEM identity.', 400);
  const [cash, paymentSafety] = await Promise.all([
    loadTradeCashLedger([stemId], query, { direction: null, includeReviewIdentity: true }),
    safetyContext || loadFinancialSafetyContext(),
  ]);
  if (!['Cash_Event__c', 'Buyer_Invoice__c', 'Payment_Currency__c'].every((field) => paymentSafety.fields?.Payment__c?.includes(field))) {
    fail('Required prepayment bridge fields are unavailable in Salesforce.');
  }
  const [invoices, payments] = await Promise.all([
    Promise.all(DOCUMENTS.map(([objectName, field, partyFields]) => {
      const ids = [...new Set(cash.allocations.map((row) => row[field]).filter(Boolean))];
      if (ids.some((id) => !canonicalId(id))) fail('Invalid prepayment invoice identity.');
      return exactRecords(query, objectName, `Id,Name,STEM__c,Document_Currency__c,Proforma__c,${partyFields}`, ids);
    })).then((rows) => rows.flat()),
    loadSalesforcePayments(null, paymentSafety, query, { queryAll, stemId }),
  ]);
  validateTradeCashLedger({ ...cash, payments, invoices });
  return { ...cash, payments, invoices };
}

const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

function contextError(message) {
  throw Object.assign(new Error(message), { code: 'XERO_PREPAYMENT_CONTEXT_INCOMPLETE', status: 502 });
}

export async function scopedRows(client, { table, field, ids, key = 'id', tenantId = null, source = false }) {
  const values = [...new Set(ids.map(source ? canonicalId : (id) => uuid(id) ? id : null))];
  if (values.includes(null)) contextError('A prepayment journal or mapping scope contains an invalid identity.');
  const rows = new Map();
  const pageSize = 250;
  for (let offset = 0; offset < values.length; offset += 50) {
    const batch = values.slice(offset, offset + 50);
    const scope = new Set(batch);
    let count = null;
    for (let start = 0; count == null || start < count; start += pageSize) {
      let query = client.from(table).select('*', { count: 'exact' });
      if (tenantId) query = query.eq('tenant_id', tenantId);
      query = source
        ? query.or(batch.map((id) => `${field}.like.${id}%`).join(','))
        : query.in(field, batch);
      const result = await query.order(key).range(start, start + pageSize - 1);
      if (result?.error || !Number.isSafeInteger(result?.count) || result.count < 0 || result.count > 10000
        || (count != null && count !== result.count) || !Array.isArray(result.data)
        || result.data.length !== Math.min(pageSize, result.count - start)) {
        contextError('Prepayment journal or mapping history is incomplete.');
      }
      count = result.count;
      for (const row of result.data) {
        if (!uuid(row?.[key]) || rows.has(row[key]) || (tenantId && row.tenant_id !== tenantId)
          || !scope.has(source ? canonicalId(row[field]) : row[field])) {
          contextError('Prepayment journal or mapping history contains a duplicate or out-of-scope identity.');
        }
        rows.set(row[key], row);
      }
    }
  }
  return [...rows.values()].sort((left, right) => left[key].localeCompare(right[key]));
}

export async function exactXeroRows(read, collection, key, ids) {
  const uniqueIds = [...new Set(ids.filter((id) => id != null))].sort();
  if (uniqueIds.some((id) => !uuid(id))) contextError('A mapped Xero identity is invalid.');
  const rows = [];
  // The accounting transport retains its existing shared admission and reserve controls.
  for (const id of uniqueIds) {
    const response = await read(`/${collection}/${id}`);
    const records = response?.[collection];
    if (!Array.isArray(records) || records.length !== 1 || records[0]?.[key] !== id) {
      contextError(`Exact Xero ${collection} readback is incomplete.`);
    }
    rows.push(records[0]);
  }
  return rows;
}

/** Load the exact ledger evidence for the selected STEM using an existing verified Xero connection. */
export async function loadXeroPrepaymentContextForStem(stemId, {
  client, connection, env = process.env, fetchImpl, requestGate,
  accountingFetch = xeroFinancialAccountingFetch, verifiedInvoice, currentUnsentCredit, ...salesforceOptions
} = {}) {
  const tenantId = connection?.tenantId;
  if (!client || !uuid(tenantId) || (env.XERO_TENANT_ID && env.XERO_TENANT_ID !== tenantId)) {
    contextError('A verified Xero tenant and service client are required.');
  }
  const source = await loadPrepaymentSalesforceContext(stemId, salesforceOptions);
  const [operations, documentMappings, paymentMappings] = await Promise.all([
    loadPrepaymentOperations(client, tenantId, source.events),
    scopedRows(client, { table: 'xero_financial_document_mappings', field: 'salesforce_id',
      ids: source.invoices.map((row) => row.Id), source: true }),
    scopedRows(client, { table: 'xero_financial_payment_mappings', field: 'salesforce_payment_id',
      ids: source.payments.map((row) => row.Id), source: true }),
  ]);
  const mappingsById = new Map(documentMappings.map((row) => [row.id, row]));
  const documentTypes = new Map(source.allocations.flatMap((row) => DOCUMENTS
    .filter(([, field]) => row[field]).map(([objectName, field]) => [canonicalId(row[field]), objectName])));
  const bridgeIds = new Set(source.payments.filter((row) => row.Cash_Event__c).map((row) => canonicalId(row.Id)));
  if (new Set(documentMappings.map((row) => canonicalId(row.salesforce_id))).size !== documentMappings.length
    || documentMappings.some((row) => documentTypes.get(canonicalId(row.salesforce_id)) !== row.salesforce_object
      || row.xero_document_type !== (row.salesforce_object === 'Invoice__c' ? 'ACCREC' : 'ACCPAY')
      || !uuid(row.xero_document_id))
    || operations.some((row) => row.invoice_mapping_id && !mappingsById.has(row.invoice_mapping_id))
    || paymentMappings.some((row) => bridgeIds.has(canonicalId(row.salesforce_payment_id)) || !uuid(row.xero_payment_id))
    || new Set(paymentMappings.map((row) => canonicalId(row.salesforce_payment_id))).size !== paymentMappings.length) {
    contextError('The prepayment graph contains a conflicting document, payment or bridge mapping.');
  }
  const selectedPayments = paymentMappings.filter((row) => mappingsById.has(row.document_mapping_id));
  const creditAllocationLedger = await scopedRows(client, {
    table: 'xero_financial_credit_allocations', field: 'invoice_mapping_id',
    ids: [...mappingsById.keys()], key: 'operation_id', tenantId,
  });
  const isCurrentUnsentCredit = row => currentUnsentCredit && row.status === 'processing' && !row.send_started_at
    && row.operation_id === currentUnsentCredit.operation_id && row.request_hash === currentUnsentCredit.request_hash
    && row.invoice_mapping_id === currentUnsentCredit.invoice_mapping_id && row.credit_mapping_id === currentUnsentCredit.credit_mapping_id;
  if (creditAllocationLedger.some((row) => !isCurrentUnsentCredit(row)
    && ['processing', 'unknown', 'exception'].includes(row.status))) {
    contextError('Reconcile the unresolved credit allocation before reviewing a prepayment.');
  }

  let rate = {};
  const read = (path) => {
    assertXeroFinancialDailyReserve(rate, env);
    return accountingFetch(connection, path, { method: 'GET', env, fetchImpl, requestGate, onResponse: (response) => {
      rate = xeroFinancialRateSnapshot(response?.headers, rate);
      assertXeroFinancialDailyReserve(rate, env);
    } });
  };
  const reused = documentMappings.some(row => row.xero_document_id === verifiedInvoice?.InvoiceID) ? [verifiedInvoice] : [];
  const [otherInvoices, xeroPrepayments, xeroBankTransactions, xeroPayments] = await Promise.all([
    exactXeroRows(read, 'Invoices', 'InvoiceID', documentMappings.map((row) => row.xero_document_id)
      .filter(id => id !== reused[0]?.InvoiceID)),
    exactXeroRows(read, 'Prepayments', 'PrepaymentID', operations.map((row) => row.xero_prepayment_id)),
    exactXeroRows(read, 'BankTransactions', 'BankTransactionID', operations.map((row) => row.xero_bank_transaction_id)),
    exactXeroRows(read, 'Payments', 'PaymentID', [
      ...operations.map((row) => row.xero_payment_id), ...selectedPayments.map((row) => row.xero_payment_id),
    ]),
  ]);
  return { ...source, tenantId, operations, documentMappings, paymentMappings: selectedPayments,
    creditAllocationLedger: creditAllocationLedger.filter(row => !isCurrentUnsentCredit(row)),
    xeroInvoices: [...otherInvoices, ...reused], xeroPrepayments, xeroBankTransactions, xeroPayments };
}

async function bankCandidates(read, event) {
  const operationId = event.Operation_Id__c;
  const date = event.Payment_Date__c;
  if (!uuid(operationId) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) contextError('The deposit search has no exact cash identity and date.');
  const type = event.Direction__c === 'Sell' ? 'RECEIVE-PREPAYMENT' : 'SPEND-PREPAYMENT';
  const filters = [`Reference=="FCOS-${operationId}"`, `Type=="${type}"&&Date==DateTime(${date.replaceAll('-', ',')})`];
  const results = await Promise.all(filters.map(async (where, index) => {
    const params = new URLSearchParams({ where, page: '1', pageSize: '100' });
    const response = await read(`/BankTransactions?${params}`);
    const rows = response?.BankTransactions;
    const page = response?.pagination ?? response?.Pagination;
    if (!Array.isArray(rows) || rows.length > 100 || (page == null && rows.length === 100)
      || (page != null && (page.page !== 1 || ![0, 1].includes(page.pageCount) || page.itemCount !== rows.length))
      || rows.some((row) => !uuid(row?.BankTransactionID))
      || new Set(rows.map((row) => row.BankTransactionID)).size !== rows.length
      || (index === 0 && rows.some((row) => row.Reference !== `FCOS-${operationId}`))
      || (index === 1 && rows.some((row) => row.Type !== type || !uuid(row.Contact?.ContactID) || !uuid(row.BankAccount?.AccountID)
        || !row.CurrencyCode || xeroPaymentDate(row.Date) !== date || row.Total == null || !Number.isFinite(Number(row.Total))))) {
      contextError('The Xero deposit search was incomplete or returned unexpected evidence.');
    }
    return rows;
  }));
  return { complete: true, rows: results.flat() };
}

/** Load private provider settings and identity evidence required by the selected Finance review. */
export async function loadXeroPrepaymentReviewContext(stemId, selection, {
  client, connection, env = process.env, fetchImpl,
  accountingFetch = xeroFinancialAccountingFetch, loadLedger = loadXeroPrepaymentContextForStem,
  loadInventory = loadXeroFinancialSnapshot, loadDocuments = loadSalesforceDocumentLinkSnapshot,
  loadControls = loadStoredDocumentLinkControls, ...salesforceOptions
} = {}) {
  const tenantId = connection?.tenantId;
  const { action, sourceId, contactId } = selection;
  if (!client || !uuid(tenantId) || (env.XERO_TENANT_ID && env.XERO_TENANT_ID !== tenantId)
    || !canonicalId(stemId) || !canonicalId(sourceId) || !['create', 'allocate', 'reverse', 'refund'].includes(action)) {
    contextError('The exact prepayment review scope could not be verified.');
  }
  const scopes = splitScopes(connection.scope || '');
  if (!scopes.some((scope) => ['accounting.settings', 'accounting.settings.read'].includes(scope))) {
    contextError('Xero settings read access is required for a prepayment review.');
  }
  const context = await loadLedger(stemId, { client, connection, env, fetchImpl, accountingFetch, ...salesforceOptions });
  if (context.tenantId !== tenantId) contextError('The prepayment ledger belongs to another tenant.');
  const selected = (['create', 'refund'].includes(action) ? context.events : context.allocations).find((row) => row.Id === sourceId);
  const cash = selected && context.events.find((row) => row.Id === (selected.Cash_Event__c || selected.Original_Cash_Event__c || selected.Id));
  if (!cash || cash.Kind__c !== 'Payment' || canonicalId(cash.STEM__c) !== canonicalId(stemId)) contextError('The selected cash event is missing.');
  requireSupportedXeroPrepaymentCurrency(cash.Currency__c, selected.Currency__c);
  const applied = context.operations.filter((row) => row.action === 'create' && row.status === 'applied' && canonicalId(row.cash_event_id) === canonicalId(cash.Id));
  const exactContact = action === 'create' ? contactId : applied.length === 1 && applied[0].request_evidence?.proposal?.evidence?.contactId;
  if (!uuid(exactContact)) contextError('The selected Xero contact could not be verified.');

  let rate = {};
  const onResponse = (response) => {
    rate = xeroFinancialRateSnapshot(response?.headers, rate);
    assertXeroFinancialDailyReserve(rate, env);
  };
  const read = (path) => {
    assertXeroFinancialDailyReserve(rate, env);
    return accountingFetch(connection, path, { method: 'GET', env, fetchImpl, onResponse });
  };
  const bankControls = async () => {
    const result = await client.from('xero_financial_bank_mappings').select('*', { count: 'exact' }).eq('enabled', true).range(0, 249);
    if (result?.error || !Array.isArray(result?.data) || result.count !== result.data.length
      || result.data.some((row) => row?.enabled !== true)) contextError('Complete enabled Finance bank mappings could not be read.');
    return result.data;
  };
  const policy = async () => {
    const result = await client.from(XERO_PREPAYMENT_POLICY_TABLE).select('*').eq('tenant_id', tenantId)
      .eq('direction', cash.Direction__c).eq('currency', cash.Currency__c).maybeSingle();
    if (result?.error || !result?.data || result.data.tenant_id !== tenantId
      || result.data.direction !== cash.Direction__c || result.data.currency !== cash.Currency__c) {
      contextError('The exact Finance prepayment posting policy could not be read.');
    }
    return [result.data];
  };

  const [orgResponse, contacts, bankMappings, settings, policies, bankDiscovery] = await Promise.all([
    read('/Organisations'), exactXeroRows(read, 'Contacts', 'ContactID', [exactContact]),
    action === 'reverse' ? [] : bankControls(),
    action === 'create' ? loadPrepaymentPostingSettings(connection, { env, fetchImpl, xeroFetch: (_connection, path) => read(path) })
      : action === 'reverse' ? { accounts: [] } : read('/Accounts').then((result) => ({ accounts: result?.Accounts })),
    action === 'create' ? policy() : [],
    action === 'create' ? bankCandidates(read, cash) : null,
  ]);
  const organisation = orgResponse?.Organisations?.[0];
  if (orgResponse?.Organisations?.length !== 1 || !uuid(organisation?.OrganisationID) || organisation.BaseCurrency !== 'USD'
    || !Array.isArray(settings.accounts)) contextError('Current Xero organisation or account evidence is incomplete.');
  let invoiceClassifications = [];
  if (['allocate', 'reverse'].includes(action)) {
    const invoiceId = selected.Buyer_Invoice__c || selected.Supplier_Invoice__c;
    const mappings = context.documentMappings.filter((row) => canonicalId(row.salesforce_id) === canonicalId(invoiceId));
    if (mappings.length !== 1) contextError('The selected final invoice has no unique mapping.');
    const [mapping] = mappings;
    const links = [{ category: 'link_only', sourceObject: mapping.salesforce_object, sourceId: invoiceId, targetId: mapping.xero_document_id }];
    const snapshot = await loadInventory(connection, XERO_FINANCIAL_CUTOFF, { env, fetchImpl, onResponse });
    if (snapshot?.tenantId !== tenantId || snapshot.contactsComplete !== true || !Array.isArray(snapshot.contacts)
      || !Array.isArray(snapshot.documents)
      || !Array.isArray(snapshot.inactiveDocuments)) contextError('The maintained invoice identity inventory is incomplete.');
    const exact = context.xeroInvoices.find((row) => row.InvoiceID === mapping.xero_document_id);
    const observed = snapshot.documents.filter((row) => row.id === mapping.xero_document_id);
    if (!exact || !['AUTHORISED', 'PAID'].includes(exact.Status)
      || snapshot.inactiveDocuments.some((row) => row.id === exact.InvoiceID) || observed.length > 1
      || (observed.length === 1 && observed[0].updatedDateUTC !== exact.UpdatedDateUTC)) {
      contextError('Current invoice details contradict the identity inventory.');
    }
    const xeroSnapshot = { ...snapshot, complete: true,
      documents: [...snapshot.documents.filter((row) => row.id !== exact.InvoiceID), normalizeXeroInvoice(exact)] };
    const salesforce = await loadDocuments(XERO_FINANCIAL_CUTOFF, links, { xeroSnapshot, safetyContext: salesforceOptions.safetyContext });
    const controls = await loadControls(client, { salesforce, xeroSnapshot, documentLinks: links });
    invoiceClassifications = buildFinancialClassifications(salesforce, xeroSnapshot, controls, { linkFirst: true }).rows;
  }
  return { ...context, organisation, contacts, bankMappings, ...settings, policies, bankDiscovery, invoiceClassifications };
}

function loadPrepaymentOperations(client, tenantId, events) {
  return scopedRows(client, { table: 'xero_financial_prepayment_operations', field: 'cash_event_id',
    ids: events.map((row) => row.Id), key: 'operation_id', tenantId, source: true });
}

export async function resolvePrepaymentStemKey(stemKey, query = sfQuery) {
  if (typeof stemKey !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/i.test(stemKey)) contextError('Enter an exact STEM reference.');
  const result = await query(`SELECT Id,KeyStem__c FROM STEM__c WHERE KeyStem__c = '${stemKey}' LIMIT 2`, { clean: true, limit: 2 });
  const row = result?.records?.[0];
  if (result?.error || !Array.isArray(result?.records) || result.totalSize !== 1 || result.records.length !== 1
    || !canonicalId(row?.Id) || String(row.KeyStem__c).toUpperCase() !== stemKey.toUpperCase()) {
    contextError('The STEM reference did not resolve to one exact record.');
  }
  return row.Id;
}

/** Queue discovery reads only the selected Salesforce STEM and its durable journal. */
export async function loadPrepaymentQueueContext(stemId, { client, tenantId, query = sfQuery } = {}) {
  if (!canonicalId(stemId) || !uuid(tenantId) || !client) contextError('The exact prepayment queue scope is required.');
  const cash = await loadTradeCashLedger([stemId], query, { direction: null, includeReviewIdentity: true });
  return { ...cash, operations: await loadPrepaymentOperations(client, tenantId, cash.events) };
}

export async function loadPrepaymentContactChoices(stemId, sourceId, {
  connection, query = sfQuery, env = process.env, fetchImpl, accountingFetch = xeroFinancialAccountingFetch,
} = {}) {
  if (!canonicalId(stemId) || !canonicalId(sourceId)) contextError('An exact cash event and STEM are required.');
  const cash = await loadTradeCashLedger([stemId], query, { direction: null, includeReviewIdentity: true });
  const event = cash.events.find((row) => row.Id === sourceId && row.Kind__c === 'Payment');
  if (!event || event.Party__r?.Inactive_Suspended__c !== false) contextError('An active deposit party is required.');
  const names = [...new Map([event.Party__r.Name, hkStrippedClKeyNameMatchKey(event.Party__r.Company_Code__c)]
    .filter((name) => typeof name === 'string' && name.trim()).map((name) => [normalizeName(name), name.trim()])).values()];
  if (!names.length) contextError('The deposit party has no exact contact search name.');
  const found = new Map();
  let rate = {};
  for (const name of names) {
    const params = new URLSearchParams({ where: `Name==${JSON.stringify(name)}`, includeArchived: 'true', page: '1', pageSize: '100' });
    const response = await accountingFetch(connection, `/Contacts?${params}`, { method: 'GET', env, fetchImpl,
      onResponse: ({ headers }) => {
        rate = xeroFinancialRateSnapshot(headers, rate);
        assertXeroFinancialDailyReserve(rate, env);
      } });
    const rows = response?.Contacts;
    const page = response?.pagination ?? response?.Pagination;
    if (!Array.isArray(rows) || rows.length >= 100 || (page != null && (page.page !== 1 || ![0, 1].includes(page.pageCount)
      || page.itemCount !== rows.length)) || rows.some((row) => !uuid(row?.ContactID) || normalizeName(row.Name) !== normalizeName(name))
      || new Set(rows.map((row) => row.ContactID)).size !== rows.length) {
      contextError('The exact-name Xero contact search was incomplete.');
    }
    for (const row of rows.filter((contact) => contact.ContactStatus === 'ACTIVE' && !contact.MergedToContactID)) {
      found.set(row.ContactID, { id: row.ContactID, name: row.Name, accountNumber: row.AccountNumber || null });
    }
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
