import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { sfQuery, sfQueryAll } from './_salesforce.js';
import { xeroAccountingFetch } from './_xeroContactSync.js';
import { buildGroupedPreservationContext } from './_xeroGroupedPreservationAdapter.js';
import { normalizeXeroInvoice, normalizeXeroCreditNote, assertXeroFinancialDailyReserve, xeroFinancialRateSnapshot } from './_xeroFinancialSync.js';
import { safetySelectFields } from './_xeroDocumentSafety.js';
import { issuedSupplierSfId as sf, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';

const POLICY = 'issued_petroleum_preserve_v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail = (message) => Object.assign(new Error(message), { code: 'XERO_PETROLEUM_SCOPE_INCOMPLETE', status: 409 });
const uid = (value) => UUID.test(value || '') ? value.toLowerCase() : null;
const quote = (values) => values.map((value) => `'${value}'`).join(',');
const unique = (values) => [...new Set(values)].sort();
const sorted = (rows, key = 'Id') => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
export const PETROLEUM_SCOPE_LIMITS = Object.freeze({ parents: 5000, children: 1000, pageSize: 100, perContact: 5000, totalHistory: 10000, xeroCalls: 120 });

// Retain complete source facts separately; never replace the source projection or
// its legacy fingerprint. This content hash deliberately excludes wall-clock time.
export function petroleumScopeFingerprint(scope) {
  const facts = scope?.sourceFacts instanceof Map ? [...scope.sourceFacts].sort(([a], [b]) => a.localeCompare(b)) : null;
  const coverage = scope?.coverage ? { ...scope.coverage } : null;
  if (coverage) delete coverage.contentFingerprint;
  return hash({ policyVersion: scope?.policyVersion, salesforceOrgId: scope?.salesforceOrgId, tenantId: scope?.tenantId,
    sourceFacts: facts, currencyContext: scope?.currencyContext, sourceClaims: scope?.sourceClaims, targetClaims: scope?.targetClaims, creditClaims: scope?.creditClaims,
    accountTax: scope?.accountTax, coverage });
}

const PARENT_COMPARE = ['Id', 'Name', 'Supplier__c', 'STEM__c', 'Invoice_Amount__c', 'Invoice_Date__c', 'Invoice_Due_Date__c', 'LastModifiedDate', 'CurrencyIsoCode', 'Invoice_File__c', 'File__c'];
const CHILD_COMPARE = ['Id', 'Supplier_Invoice__c', 'Original_Supplier__c', 'STEM__c', 'Cancelled__c', 'Product__c', 'Product2Id__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity__c', 'Unit_of_Measure__c', 'Unit_Buy_At__c', 'Total_Cost__c', 'LastModifiedDate', 'CurrencyIsoCode'];
const agree = (fresh, previous, fields) => fields.every((key) => !Object.hasOwn(previous, key) || (Object.hasOwn(fresh, key) && hash(fresh[key]) === hash(previous[key])));

export async function collectPetroleumPreservationScope({ records, connection, salesforce, xero, sources, stored } = {}, {
  query = sfQuery, queryAll = sfQueryAll, accountingFetch = xeroAccountingFetch, env = process.env, fetchImpl = fetch,
  onResponse = () => {}, requestGate,
} = {}) {
  if (!Array.isArray(records) || !records.length || records.length > 25 || !Array.isArray(sources)
    || !uid(connection?.tenantId) || connection.tenantId !== xero?.tenantId || !Array.isArray(salesforce?.suppliers)
    || !Array.isArray(salesforce.lines) || !Array.isArray(salesforce.extras)) throw fail('Complete current provider snapshots are required.');
  const context = buildGroupedPreservationContext(salesforce, xero, stored, sources);
  if (!context.complete) throw fail('Complete current Account and Contact identities are required.');
  const selections = records.map((record) => {
    const matches = sources.filter((source) => sf(source.salesforceId) === sf(record.sourceId));
    const source = matches[0];
    const targets = [...xero.documents, ...(xero.inactiveDocuments || [])].filter((target) => uid(target.id) === uid(record.xeroDocumentId));
    const account = context.accountsById.get(sf(source?.accountId));
    const contacts = account ? context.matchesFor(account) : [];
    if (!sf(record.sourceId) || !uid(record.xeroDocumentId) || matches.length !== 1 || targets.length !== 1
      || source.salesforceObject !== 'Supplier_Invoice__c' || !sf(source.stemId) || !sf(source.accountId)
      || contacts.length !== 1 || uid(contacts[0].id) !== uid(source.contactId)
      || (context.members.get(uid(source.contactId)) || []).length !== 1 || targets[0].type !== 'ACCPAY'
      || uid(targets[0].contactId) !== uid(source.contactId)) throw fail('A unique current source Account and Xero Contact/target are required.');
    return { source, target: targets[0] };
  });
  if (unique(selections.map(({ source }) => sf(source.salesforceId))).length !== records.length
    || unique(selections.map(({ target }) => uid(target.id))).length !== records.length) throw fail('Repeated selected identities are unsupported.');
  const sourceAccountIds = unique(selections.map(({ source }) => sf(source.accountId)));
  const stemIds = unique(selections.map(({ source }) => sf(source.stemId)));
  const sourceIds = unique(selections.map(({ source }) => sf(source.salesforceId)));
  const xeroContactIds = unique(selections.map(({ source }) => uid(source.contactId)));
  const queryFingerprints = [];
  const read = async (soql, limit, all = false) => {
    const result = await (all ? queryAll : query)(soql, { clean: true, limit });
    if (result?.error || result?.done === false || !Array.isArray(result?.records) || !Number.isSafeInteger(result.totalSize)
      || result.totalSize !== result.records.length || result.records.length > limit
      || result.records.some((row) => !sf(row.Id)) || unique(result.records.map((row) => sf(row.Id))).length !== result.records.length) throw fail('The all-years Salesforce identity scope is incomplete or duplicated.');
    queryFingerprints.push(hash({ soql, all, limit }));
    return sorted(result.records);
  };
  const org = fcosSalesforceEnvironment('production');
  const orgRows = await read('SELECT Id, IsSandbox FROM Organization', 2);
  if (orgRows.length !== 1 || sf(orgRows[0].Id) !== sf(org.orgId) || orgRows[0].IsSandbox !== false) throw fail('The pinned Salesforce Production organisation is required.');
  const extra = (object, fields) => safetySelectFields(salesforce.safetyContext, object, fields);
  const parents = await read(`SELECT Id, IsDeleted, Name, Supplier__c, Supplier__r.Name, Supplier__r.Company_Code__c, STEM__c, STEM__r.KeyStem__c, STEM__r.Delivery_Date__c, STEM__r.Vessel__c, STEM__r.Vessel__r.Name, STEM__r.LastModifiedDate, Invoice_Amount__c, Invoice_Date__c, Invoice_Due_Date__c, CreatedDate, LastModifiedDate${extra('Supplier_Invoice__c', ['CurrencyIsoCode', 'Invoice_File__c', 'File__c', 'Invoice_Upload_Date__c', 'Status__c', 'Invoice_Status__c'])} FROM Supplier_Invoice__c WHERE Supplier__c IN (${quote(sourceAccountIds)}) OR STEM__c IN (${quote(stemIds)}) ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.parents, true);
  if (parents.some((row) => !sourceAccountIds.includes(sf(row.Supplier__c)) && !stemIds.includes(sf(row.STEM__c)))) throw fail('Salesforce returned an out-of-scope supplier obligation.');
  const lines = await read(`SELECT Id, IsDeleted, Name, Supplier_Invoice__c, Original_Supplier__c, STEM__c, Cancelled__c, Product__c, Product__r.Name, Quantity_Delivered_Per_BDN__c, Quantity__c, Unit_of_Measure__c, Unit_Buy_At__c, Total_Cost__c, LastModifiedDate${extra('STEM_Line_Item__c', ['CurrencyIsoCode'])} FROM STEM_Line_Item__c WHERE Supplier_Invoice__c IN (${quote(sourceIds)}) ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.children, true);
  const extras = await read(`SELECT Id, IsDeleted, Supplier_Invoice__c, STEM__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE Supplier_Invoice__c IN (${quote(sourceIds)}) ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.children, true);
  if ([...lines, ...extras].some((row) => !sourceIds.includes(sf(row.Supplier_Invoice__c)))) throw fail('Salesforce returned an out-of-scope child.');
  const productIds = unique(lines.map((row) => sf(row.Product__c)).filter(Boolean));
  const products = productIds.length ? await read(`SELECT Id, Name, RecordType.DeveloperName, LastModifiedDate FROM Product2 WHERE Id IN (${quote(productIds)}) ORDER BY Id`, PETROLEUM_SCOPE_LIMITS.children) : [];
  const sourceFacts = new Map();
  for (const { source } of selections) {
    const selected = parents.filter((row) => sf(row.Id) === sf(source.salesforceId));
    const previous = salesforce.suppliers.filter((row) => sf(row.Id) === sf(source.salesforceId));
    const children = lines.filter((row) => sf(row.Supplier_Invoice__c) === sf(source.salesforceId));
    const sourceExtras = extras.filter((row) => sf(row.Supplier_Invoice__c) === sf(source.salesforceId));
    if (selected.length !== 1 || previous.length !== 1 || selected[0].IsDeleted !== false || !agree(selected[0], previous[0], PARENT_COMPARE)
      || !agree(selected[0].STEM__r || {}, previous[0].STEM__r || {}, ['KeyStem__c', 'Delivery_Date__c'])
      || !agree(selected[0].Supplier__r || {}, previous[0].Supplier__r || {}, ['Name', 'Company_Code__c'])) throw fail('The selected source changed between current reads.');
    const currentLive = [...children, ...sourceExtras].filter((row) => row.IsDeleted === false && row.Cancelled__c === false);
    const previousLive = [...salesforce.lines, ...salesforce.extras].filter((row) => sf(row.Supplier_Invoice__c) === sf(source.salesforceId));
    if (currentLive.length !== previousLive.length || currentLive.some((row) => {
      const old = previousLive.filter((item) => sf(item.Id) === sf(row.Id));
      return old.length !== 1 || !agree(row, old[0], CHILD_COMPARE);
    })) throw fail('The selected raw delivered quantity/price or child associations changed between current reads.');
    const product = children.length === 1 ? products.filter((row) => sf(row.Id) === sf(children[0].Product__c)) : [];
    sourceFacts.set(sf(source.salesforceId), { parent: selected[0], lines: children, extras: sourceExtras, product: product.length === 1 ? product[0] : null });
  }
  let calls = 0; let historyCount = 0; const rate = {}; const contactCounts = new Map();
  const observed = (event) => { Object.assign(rate, xeroFinancialRateSnapshot(event.headers, rate)); onResponse(event); assertXeroFinancialDailyReserve(rate, env); };
  const get = async (path) => {
    assertXeroFinancialDailyReserve(rate, env);
    if (++calls > PETROLEUM_SCOPE_LIMITS.xeroCalls) throw fail('The bounded Xero history call limit was reached.');
    const response = await accountingFetch(connection, path, { method: 'GET', env: { ...env, XERO_TRANSIENT_RETRY_LIMIT: '0' }, fetchImpl, onResponse: observed, requestGate, retryOnRateLimit: false, callsPerMinute: 45 });
    assertXeroFinancialDailyReserve(rate, env);
    return response;
  };
  const history = async (contactId, collection, type, idField, normalize) => {
    const where = `Contact.ContactID==Guid("${contactId}")&&Type=="${type}"`;
    queryFingerprints.push(hash({ collection, where, pageSize: PETROLEUM_SCOPE_LIMITS.pageSize }));
    const rows = []; const seen = new Set(); let expected = null;
    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams({ where, order: `${idField} ASC`, page: String(page), pageSize: String(PETROLEUM_SCOPE_LIMITS.pageSize), ...(collection === 'Invoices' ? { includeArchived: 'true' } : {}) });
      const result = await get(`/${collection}?${params}`);
      const batch = result?.[collection]; const pagination = result?.pagination;
      if (!Array.isArray(batch) || batch.length > PETROLEUM_SCOPE_LIMITS.pageSize) throw fail('Xero history retrieval was incomplete.');
      if (pagination != null) {
        if (typeof pagination !== 'object' || Array.isArray(pagination)) throw fail('Xero pagination metadata is malformed.');
        for (const key of ['page', 'pageSize', 'pageCount', 'itemCount']) if (Object.hasOwn(pagination, key)
          && (!Number.isSafeInteger(pagination[key]) || pagination[key] < (key === 'itemCount' || key === 'pageCount' ? 0 : 1))) throw fail('Xero pagination metadata is malformed.');
        if ((pagination.page != null && pagination.page !== page) || (pagination.pageSize != null && pagination.pageSize !== PETROLEUM_SCOPE_LIMITS.pageSize)) throw fail('Xero returned a different pagination scope.');
        const totals = { pageCount: pagination.pageCount ?? null, itemCount: pagination.itemCount ?? null };
        if (expected && hash(expected) !== hash(totals)) throw fail('Xero history changed during pagination.');
        expected = totals;
      } else if (expected) throw fail('Xero pagination metadata disappeared.');
      for (const raw of batch) {
        const id = uid(raw?.[idField]);
        if (!id || seen.has(id) || uid(raw.Contact?.ContactID) !== contactId || raw.Type !== type) throw fail('Xero history returned duplicated or out-of-scope identities.');
        seen.add(id); rows.push({ raw, document: normalize(raw) });
        contactCounts.set(contactId, (contactCounts.get(contactId) || 0) + 1);
        if (++historyCount > PETROLEUM_SCOPE_LIMITS.totalHistory || contactCounts.get(contactId) > PETROLEUM_SCOPE_LIMITS.perContact) throw fail('The bounded Xero history row limit was reached.');
      }
      if (batch.length < PETROLEUM_SCOPE_LIMITS.pageSize) {
        if ((expected?.itemCount != null && expected.itemCount !== rows.length) || (expected?.pageCount != null && page < expected.pageCount)) throw fail('Xero history ended before its complete scope.');
        return rows.sort((a, b) => a.document.id.localeCompare(b.document.id));
      }
    }
  };
  const targetClaims = []; const creditClaims = [];
  for (const contactId of xeroContactIds) {
    targetClaims.push(...await history(contactId, 'Invoices', 'ACCPAY', 'InvoiceID', normalizeXeroInvoice));
    creditClaims.push(...await history(contactId, 'CreditNotes', 'ACCPAYCREDIT', 'CreditNoteID', normalizeXeroCreditNote));
  }
  for (const { target } of selections) {
    const fresh = targetClaims.filter(({ document }) => uid(document.id) === uid(target.id));
    if (fresh.length !== 1 || hash(fresh[0].document) !== hash(target)) throw fail('The selected Xero bill changed between current reads.');
  }
  const accountResult = await get('/Accounts'); const taxResult = await get('/TaxRates');
  if (!Array.isArray(accountResult?.Accounts) || !Array.isArray(taxResult?.TaxRates)
    || accountResult.Accounts.length > 10000 || taxResult.TaxRates.length > 1000) throw fail('Current ledger account and tax evidence is incomplete.');
  const accountTax = { accounts: sorted(accountResult.Accounts, 'AccountID'), taxRates: sorted(taxResult.TaxRates, 'TaxType') };
  const scope = { policyVersion: POLICY, salesforceOrgId: org.orgId, tenantId: connection.tenantId, sourceFacts,
    sourceClaims: parents, targetClaims, creditClaims, accountTax, currencyContext: { singleCurrency: salesforce.safetyContext?.singleCurrency === true, corporateCurrency: salesforce.safetyContext?.corporateCurrency || null },
    coverage: { sourceAccountIds, stemIds, xeroContactIds, sourceQueryAll: true, sourceCount: parents.length,
      targetCount: targetClaims.length, creditCount: creditClaims.length, sourceComplete: true, targetComplete: true,
      creditComplete: true, accountTaxComplete: true, queryFingerprints } };
  scope.coverage.contentFingerprint = petroleumScopeFingerprint(scope);
  return scope;
}
