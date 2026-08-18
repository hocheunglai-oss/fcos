import { chunkIds, getApiVersion, getInstanceUrl, sfQuery, sfRequest } from './_salesforce.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';
import { resolveExtraCostSupplierLookup, resolveOriginalSupplierLookup } from './_disputeParties.js';
import { resolveSupplierSettlementSchema, validSupplierSettlementPayment } from './_disputeSupplierSettlement.js';
import { findDashboardUomField } from './_dashboardVolume.js';
import { decodeAccountCreditCursor, encodeAccountCreditCursor, selectUltimateCreditGroup } from './_dashboardAccountCreditStatement.js';
import {
  buildIssuedSupplierRow,
  buildSupplierCreditStatement,
  buildUninvoicedSupplierRows,
  normalizeSupplierCreditScope,
  resolveSupplierInvoiceIdentity,
} from './_dashboardSupplierCreditStatement.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const MAX_ROWS = 50_000;
const MAX_GROUP_DEPTH = 20;
const INTEROFFICE_EXCLUDED_GROUP = 'FRATELLI COSULICH';

function serviceError(message, status = 400, code = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = status < 500 || /SCHEMA|ACCESS|LIMIT/.test(String(code || ''));
  return error;
}

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function idKey(value) {
  const id = text(value);
  return SALESFORCE_ID.test(id) ? id.slice(0, 15) : '';
}

function salesforceId(value, label = 'Salesforce Account') {
  const id = text(value);
  if (!SALESFORCE_ID.test(id)) throw serviceError(`${label} ID is invalid.`, 400, 'SUPPLIER_CREDIT_INVALID_ID');
  return id;
}

function soql(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function fieldMap(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

function selected(fields, names) {
  return names.filter((name) => fields.has(name));
}

function requireFields(fields, names, objectName) {
  const missing = names.filter((name) => !fields.has(name));
  if (missing.length) throw serviceError(`${objectName} is missing required supplier-statement field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`, 503, 'SUPPLIER_CREDIT_SCHEMA');
}

function hongKongToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function oneYearBefore(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value.toISOString().slice(0, 10);
}

async function describeObject(objectName, force = false) {
  const result = await getOrLoadRuntimeCache({
    namespace: 'salesforce-supplier-credit-describe',
    version: '1',
    accessScope: 'schema',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { objectName: objectName.toLowerCase() },
    ttlSeconds: 6 * 60 * 60,
    tags: ['salesforce:schema', `salesforce:schema:${objectName.toLowerCase()}`],
    force,
    loader: async () => {
      const describe = await sfRequest(`/sobjects/${encodeURIComponent(objectName)}/describe/`, { readOnly: true });
      return {
        name: describe.name,
        fields: (describe.fields || []).map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          relationshipName: field.relationshipName || null,
          referenceTo: field.referenceTo || [],
        })),
      };
    },
  });
  return result.value;
}

async function queryAll(query, limit = MAX_ROWS + 1) {
  const result = await sfQuery(query, { clean: true, limit, softFail: false });
  return { records: result.records || [], totalSize: Number(result.totalSize ?? result.records?.length ?? 0) };
}

function accountFields(fields) {
  const values = selected(fields, ['Id', 'Name', 'ParentId', 'Company_Code__c', 'Group_Name__c', 'Inactive_Suspended__c', 'CurrencyIsoCode', 'CreatedDate', 'LastModifiedDate']);
  if (fields.has('ParentId')) values.push('Parent.Name');
  return [...new Set(values)];
}

async function loadAccountChain(accountId, fields) {
  const chain = [];
  const seen = new Set();
  let currentId = accountId;
  for (let depth = 0; depth < MAX_GROUP_DEPTH && currentId; depth += 1) {
    const key = idKey(currentId);
    if (!key || seen.has(key)) throw serviceError('Salesforce Account hierarchy contains a cycle.', 503, 'SUPPLIER_CREDIT_GROUP_CYCLE');
    seen.add(key);
    const result = await queryAll(`SELECT ${accountFields(fields).join(',')} FROM Account WHERE Id = '${soql(currentId)}' LIMIT 1`, 1);
    const account = result.records[0];
    if (!account) throw serviceError(chain.length ? 'A parent Account in the Salesforce GROUP hierarchy is unavailable.' : 'The Salesforce Account no longer exists.', chain.length ? 503 : 404, 'SUPPLIER_CREDIT_ACCOUNT_NOT_FOUND');
    chain.push(account);
    currentId = account.ParentId;
  }
  if (currentId) throw serviceError('The Salesforce GROUP hierarchy exceeds 20 levels.', 503, 'SUPPLIER_CREDIT_GROUP_DEPTH');
  return chain;
}

async function loadActiveGroupMembers(group, fields) {
  if (!group) return [];
  const members = [group];
  const seen = new Set([idKey(group.Id)]);
  let parentIds = [group.Id];
  for (let depth = 0; depth < MAX_GROUP_DEPTH && parentIds.length; depth += 1) {
    const next = [];
    for (const ids of chunkIds(parentIds)) {
      const result = await queryAll(`SELECT ${accountFields(fields).join(',')} FROM Account WHERE ParentId IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) AND Inactive_Suspended__c = false LIMIT ${MAX_ROWS}`, MAX_ROWS);
      for (const account of result.records) {
        if (seen.has(idKey(account.Id))) continue;
        seen.add(idKey(account.Id));
        members.push(account);
        next.push(account.Id);
      }
    }
    parentIds = next;
  }
  if (parentIds.length) throw serviceError('The Salesforce GROUP hierarchy exceeds 20 levels.', 503, 'SUPPLIER_CREDIT_GROUP_DEPTH');
  return members;
}

function ensureAccess(account, chain, interoffice) {
  if (!interoffice) return;
  const names = [account?.Name, account?.Group_Name__c, ...(chain || []).map((row) => row.Name)];
  if (names.some((name) => text(name).toUpperCase() === INTEROFFICE_EXCLUDED_GROUP)) {
    throw serviceError('This Account is outside the Interoffice access scope.', 403, 'SUPPLIER_CREDIT_ACCESS_DENIED');
  }
}

function isInterofficeExcluded(account, chain) {
  return [account?.Name, account?.Group_Name__c, ...(chain || []).flatMap((row) => [row.Name, row.Group_Name__c])]
    .some((name) => text(name).toUpperCase() === INTEROFFICE_EXCLUDED_GROUP);
}

function normalizeFilters(value = {}) {
  const filters = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const accountIds = unique(Array.isArray(filters.accountIds) ? filters.accountIds : []).map((id) => salesforceId(id, 'Dashboard Account'));
  const supplierIds = unique(Array.isArray(filters.supplierIds) ? filters.supplierIds : []).map((id) => salesforceId(id, 'Dashboard Supplier'));
  const portIds = unique(Array.isArray(filters.portIds) ? filters.portIds : []).map((id) => salesforceId(id, 'Dashboard Port'));
  const countryCodes = unique(Array.isArray(filters.countryCodes) ? filters.countryCodes : []).map((value) => value.toUpperCase());
  return { accountIds, supplierIds, portIds, countryCodes };
}

async function resolveLocationPortIds(filters, portFields) {
  const ids = [...filters.portIds];
  if (filters.countryCodes.length) {
    requireFields(portFields, ['Id', 'Country__c'], 'Port__c');
    const rows = await queryAll(`SELECT Id FROM Port__c WHERE Country__c IN (${filters.countryCodes.map((country) => `'${soql(country)}'`).join(',')}) LIMIT ${MAX_ROWS}`, MAX_ROWS);
    ids.push(...rows.records.map((row) => row.Id));
  }
  return unique(ids);
}

function childStemConditions(filters, locationPortIds) {
  const conditions = [];
  if (filters.accountIds.length) conditions.push(`STEM__r.Account__c IN (${filters.accountIds.map((id) => `'${soql(id)}'`).join(',')})`);
  if (filters.portIds.length || filters.countryCodes.length) {
    conditions.push(locationPortIds.length ? `STEM__r.Port__c IN (${locationPortIds.map((id) => `'${soql(id)}'`).join(',')})` : 'Id = null');
  }
  return conditions;
}

function supplierDirectoryCursor(cursor) {
  if (!cursor) return '';
  return `(Name > '${soql(cursor.name)}' OR (Name = '${soql(cursor.name)}' AND Id > '${soql(cursor.id)}'))`;
}

export async function loadDashboardSupplierCreditDirectory({ body = {}, accessContext, force = false }) {
  const startedAt = Date.now();
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const filters = normalizeFilters(body.filters);
  const cursor = decodeAccountCreditCursor(body.cursor);
  if (body.cursor && cursor?.kind !== 'directory') throw serviceError('Supplier Statement directory cursor is invalid.', 400, 'SUPPLIER_CREDIT_CURSOR_INVALID');
  const interoffice = accessContext?.profile?.user_type === 'interoffice';
  const cache = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-supplier-credit-directory',
    version: '1',
    accessScope: interoffice ? 'interoffice' : 'standard',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { cursor, limit, filters },
    ttlSeconds: 60,
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:stem', 'salesforce:line-item', 'salesforce:extra-cost', 'salesforce:supplier-invoice', 'salesforce:supplier-credit'],
    force,
    loader: async () => {
      const [accountDescribe, lineDescribe, extraDescribe, portDescribe] = await Promise.all([
        describeObject('Account', force),
        describeObject('STEM_Line_Item__c', force),
        describeObject('STEM_Extra_Cost__c', force),
        filters.countryCodes.length ? describeObject('Port__c', force) : Promise.resolve({ fields: [] }),
      ]);
      const accountMap = fieldMap(accountDescribe);
      const lineLookup = resolveOriginalSupplierLookup(lineDescribe.fields);
      const extraLookup = resolveExtraCostSupplierLookup(extraDescribe.fields);
      if (!lineLookup.valid || !extraLookup.valid) throw serviceError(lineLookup.issue?.message || extraLookup.issue?.message, 503, 'SUPPLIER_CREDIT_SCHEMA');
      requireFields(accountMap, ['Id', 'Name', 'Inactive_Suspended__c'], 'Account');
      const locationPortIds = await resolveLocationPortIds(filters, fieldMap(portDescribe));
      const childFilters = childStemConditions(filters, locationPortIds);
      const cursorWhere = supplierDirectoryCursor(cursor);
      const base = ['Inactive_Suspended__c = false', cursorWhere].filter(Boolean);
      if (filters.supplierIds.length) base.push(`Id IN (${filters.supplierIds.map((id) => `'${soql(id)}'`).join(',')})`);
      if (interoffice) base.push(`(Group_Name__c = null OR Group_Name__c != '${INTEROFFICE_EXCLUDED_GROUP}')`);
      const select = accountFields(accountMap).join(',');
      const childWhere = childFilters.length ? ` AND ${childFilters.join(' AND ')}` : '';
      const lineCondition = `Id IN (SELECT ${lineLookup.fieldName} FROM STEM_Line_Item__c WHERE Cancelled__c = false AND ${lineLookup.fieldName} != null${childWhere})`;
      const extraCondition = `Id IN (SELECT ${extraLookup.fieldName} FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND ${extraLookup.fieldName} != null${childWhere})`;
      const queries = [lineCondition, extraCondition].map((condition) => `SELECT ${select} FROM Account WHERE ${[...base, condition].map((item) => `(${item})`).join(' AND ')} ORDER BY Name,Id LIMIT ${limit + 1}`);
      const results = await Promise.all(queries.map((query) => queryAll(query, limit + 1)));
      const merged = new Map();
      for (const result of results) for (const account of result.records) merged.set(idKey(account.Id), account);
      const ordered = [...merged.values()].sort((left, right) => text(left.Name).localeCompare(text(right.Name)) || text(left.Id).localeCompare(text(right.Id)));
      const hasMore = ordered.length > limit || results.some((result) => result.records.length > limit);
      let accounts = ordered.slice(0, limit);
      if (interoffice && accounts.length) {
        const chains = await Promise.all(accounts.map((account) => loadAccountChain(account.Id, accountMap)));
        accounts = accounts.filter((account, index) => !isInterofficeExcluded(account, chains[index]));
      }
      const ids = accounts.map((account) => account.Id);
      const stemIdsByAccount = new Map(ids.map((id) => [idKey(id), new Set()]));
      if (ids.length) {
        const inList = ids.map((id) => `'${soql(id)}'`).join(',');
        const [lines, extras] = await Promise.all([
          queryAll(`SELECT ${lineLookup.fieldName},STEM__c,Supplier_Invoice__c FROM STEM_Line_Item__c WHERE Cancelled__c = false AND ${lineLookup.fieldName} IN (${inList})${childWhere} LIMIT ${MAX_ROWS}`, MAX_ROWS),
          queryAll(`SELECT ${extraLookup.fieldName},STEM__c,Supplier_Invoice__c FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND ${extraLookup.fieldName} IN (${inList})${childWhere} LIMIT ${MAX_ROWS}`, MAX_ROWS),
        ]);
        const children = [
          ...lines.records.map((row) => ({ ...row, _supplierId: row[lineLookup.fieldName] })),
          ...extras.records.map((row) => ({ ...row, _supplierId: row[extraLookup.fieldName] })),
        ];
        const childInvoiceIds = unique(children.map((row) => row.Supplier_Invoice__c));
        const openInvoiceIds = new Set();
        for (const invoiceIds of chunkIds(childInvoiceIds)) {
          const invoices = await queryAll(`SELECT Id FROM Supplier_Invoice__c WHERE Id IN (${invoiceIds.map((id) => `'${soql(id)}'`).join(',')}) AND Payable_Balance__c != 0 LIMIT ${MAX_ROWS}`, MAX_ROWS);
          for (const invoice of invoices.records) openInvoiceIds.add(idKey(invoice.Id));
        }
        for (const row of children) {
          if (!row.Supplier_Invoice__c || openInvoiceIds.has(idKey(row.Supplier_Invoice__c))) stemIdsByAccount.get(idKey(row._supplierId))?.add(row.STEM__c);
        }
        for (const supplierIds of chunkIds(ids)) {
          const directInvoices = await queryAll(`SELECT STEM__c,Supplier__c FROM Supplier_Invoice__c WHERE Supplier__c IN (${supplierIds.map((id) => `'${soql(id)}'`).join(',')}) AND Payable_Balance__c != 0 LIMIT ${MAX_ROWS}`, MAX_ROWS);
          for (const invoice of directInvoices.records) stemIdsByAccount.get(idKey(invoice.Supplier__c))?.add(invoice.STEM__c);
        }
      }
      return {
        role: 'supplier',
        accounts: accounts.map((account) => ({
          accountId: account.Id,
          name: account.Name,
          clKey: account.Company_Code__c || null,
          groupName: account.Parent?.Name || account.Group_Name__c || null,
          role: 'supplier',
          openStemCount: stemIdsByAccount.get(idKey(account.Id))?.size || 0,
          openExposure: null,
          hasOpenCredit: (stemIdsByAccount.get(idKey(account.Id))?.size || 0) > 0,
          currency: account.CurrencyIsoCode || 'USD',
          source: 'statement',
        })),
        nextCursor: hasMore && accounts.length ? encodeAccountCreditCursor({ kind: 'directory', name: accounts.at(-1).Name, id: accounts.at(-1).Id }) : null,
      };
    },
  });
  return {
    ...cache.value,
    meta: { redacted: true, cache: cache.cache?.status || null, elapsedMs: Date.now() - startedAt, returnedCount: cache.value.accounts?.length || 0 },
  };
}

function stemSelect(fields) {
  const values = selected(fields, ['Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'Account__c', 'Port__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'CurrencyIsoCode']);
  if (fields.has('Account__c')) values.push('Account__r.Name', 'Account__r.Group_Name__c', 'Account__r.Parent.Name');
  return [...new Set(values)];
}

function stemMatchesStatementScope(stem, filters, locationPortIds, interoffice) {
  if (filters.accountIds.length && !filters.accountIds.some((id) => idKey(id) === idKey(stem.Account__c))) return false;
  if ((filters.portIds.length || filters.countryCodes.length) && !locationPortIds.some((id) => idKey(id) === idKey(stem.Port__c))) return false;
  if (interoffice && [stem.Account__r?.Name, stem.Account__r?.Group_Name__c, stem.Account__r?.Parent?.Name]
    .some((name) => text(name).toUpperCase() === INTEROFFICE_EXCLUDED_GROUP)) return false;
  return true;
}

function childSelect({ fields, accountFieldsMap, productFields, lookup, kind }) {
  const values = ['Id', 'STEM__c', lookup.fieldName, ...selected(fields, [
    'Name', 'Description__c', 'CreatedDate', 'Cancelled__c', 'Supplier_Invoice__c', 'Payment_Term__c', 'Payment_Term_Number__c',
    'Quantity__c', 'Quantity_Delivered_Per_BDN__c', kind === 'extra_cost' ? 'Quantity_Range_Max__c' : 'Quantity_Max__c',
    'Is_Quantity_Range__c', 'CurrencyIsoCode', 'Cost_Per_Unit__c', 'Unit_Buy_At__c', 'Unit_Cost__c', 'Lumpsum_Cost__c', 'Line_Total_Buy__c', 'Product__c', 'Product2Id__c',
  ])];
  if (lookup.relationshipName) {
    values.push(`${lookup.relationshipName}.Name`);
    if (accountFieldsMap.has('Inactive_Suspended__c')) values.push(`${lookup.relationshipName}.Inactive_Suspended__c`);
  }
  const offer = fields.get('Offer_Line_Item__c');
  if (offer?.relationshipName) values.push(`${offer.relationshipName}.Supplier_Unit_Price__c`);
  const productLookup = fields.get(kind === 'extra_cost' ? 'Product2Id__c' : 'Product__c') || fields.get('Product__c');
  if (productLookup?.relationshipName) {
    values.push(`${productLookup.relationshipName}.Name`);
    const productUom = findDashboardUomField([...productFields.values()], 'product');
    if (productUom) values.push(`${productLookup.relationshipName}.${productUom}`);
  }
  const uom = findDashboardUomField([...fields.values()], 'lineItem');
  if (uom) values.push(uom);
  return { values: [...new Set(values)], uom, productRelationship: productLookup?.relationshipName || null, productUom: findDashboardUomField([...productFields.values()], 'product') };
}

async function querySupplierChildren({ accountIds, filters, locationPortIds, lineFields, extraFields, accountFieldsMap, productFields, lineLookup, extraLookup }) {
  const conditions = childStemConditions(filters, locationPortIds);
  const suffix = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
  const lineConfig = childSelect({ fields: lineFields, accountFieldsMap, productFields, lookup: lineLookup, kind: 'line_item' });
  const extraConfig = childSelect({ fields: extraFields, accountFieldsMap, productFields, lookup: extraLookup, kind: 'extra_cost' });
  const rows = [];
  let complete = true;
  for (const ids of chunkIds(accountIds)) {
    const inList = ids.map((id) => `'${soql(id)}'`).join(',');
    const [lines, extras] = await Promise.all([
      queryAll(`SELECT ${lineConfig.values.join(',')} FROM STEM_Line_Item__c WHERE Cancelled__c = false AND ${lineLookup.fieldName} IN (${inList})${suffix} LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1),
      queryAll(`SELECT ${extraConfig.values.join(',')} FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND ${extraLookup.fieldName} IN (${inList})${suffix} LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1),
    ]);
    complete = complete && lines.records.length <= MAX_ROWS && extras.records.length <= MAX_ROWS;
    for (const [records, config, lookup, kind] of [[lines.records, lineConfig, lineLookup, 'line_item'], [extras.records, extraConfig, extraLookup, 'extra_cost']]) {
      for (const row of records.slice(0, MAX_ROWS)) {
        const relationship = lookup.relationshipName ? row[lookup.relationshipName] : null;
        const product = config.productRelationship ? row[config.productRelationship] : null;
        rows.push({
          ...row,
          _kind: kind,
          _supplierAccountId: row[lookup.fieldName],
          _supplierName: relationship?.Name || null,
          _supplierInactive: relationship?.Inactive_Suspended__c === true,
          _label: product?.Name || row.Name || row.Description__c || (kind === 'extra_cost' ? 'Extra cost' : 'Product'),
          _uom: config.uom ? row[config.uom] : config.productUom ? product?.[config.productUom] : null,
        });
        if (rows.length > MAX_ROWS) complete = false;
      }
    }
  }
  return { rows: rows.slice(0, MAX_ROWS), complete };
}

function invoiceSelect(fields, schema) {
  const values = ['Id', 'Name', 'STEM__c', ...selected(fields, [
    'CreatedDate', 'LastModifiedDate', 'CurrencyIsoCode', 'Supplier__c', 'Partial_Amount__c', 'Partial_Invoice_Due_Date__c',
    schema.invoiceAmountField, schema.invoicePayableField, ...schema.invoiceDueDateFields, ...schema.invoiceDateFields, ...schema.invoiceStatusFields,
  ].filter(Boolean))];
  const supplier = fields.get('Supplier__c');
  if (supplier?.relationshipName) values.push(`${supplier.relationshipName}.Name`);
  return [...new Set(values)];
}

function voidedInvoice(invoice, fields) {
  return fields.some((field) => /void|cancel|revers|reject|deleted/i.test(text(invoice[field])));
}

async function querySupplierInvoices({ accountIds, invoiceIds, invoiceFields, schema }) {
  const select = invoiceSelect(invoiceFields, schema);
  const rows = new Map();
  let complete = true;
  if (invoiceFields.has('Supplier__c')) {
    for (const ids of chunkIds(accountIds)) {
      const result = await queryAll(`SELECT ${select.join(',')} FROM Supplier_Invoice__c WHERE Supplier__c IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1);
      complete = complete && result.records.length <= MAX_ROWS;
      for (const row of result.records.slice(0, MAX_ROWS)) rows.set(idKey(row.Id), row);
    }
  }
  for (const ids of chunkIds(invoiceIds)) {
    const result = await queryAll(`SELECT ${select.join(',')} FROM Supplier_Invoice__c WHERE Id IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1);
    complete = complete && result.records.length <= MAX_ROWS;
    for (const row of result.records.slice(0, MAX_ROWS)) rows.set(idKey(row.Id), row);
  }
  complete = complete && rows.size <= MAX_ROWS;
  return { rows: [...rows.values()].slice(0, MAX_ROWS).filter((row) => !voidedInvoice(row, schema.invoiceStatusFields)), complete };
}

function paymentSelect(fields, schema) {
  return [...new Set(['Id', 'Name', 'CreatedDate', 'CurrencyIsoCode', schema.paymentAmountField, schema.paymentDateField, ...schema.paymentStatusFields, ...schema.paymentSupplierInvoiceFields].filter((field) => field && fields.has(field)))];
}

async function querySupplierPayments(invoiceIds, paymentFields, schema) {
  const byInvoice = {};
  let complete = true;
  let retainedCount = 0;
  for (const lookupField of schema.paymentSupplierInvoiceFields) {
    for (const ids of chunkIds(invoiceIds)) {
      const result = await queryAll(`SELECT ${paymentSelect(paymentFields, schema).join(',')} FROM Payment__c WHERE ${lookupField} IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1);
      complete = complete && result.records.length <= MAX_ROWS;
      for (const payment of result.records.slice(0, MAX_ROWS)) {
        if (!validSupplierSettlementPayment(payment, schema.paymentStatusFields)) continue;
        const invoiceId = payment[lookupField];
        if (!byInvoice[invoiceId]) byInvoice[invoiceId] = [];
        if (!byInvoice[invoiceId].some((row) => row.Id === payment.Id)) {
          retainedCount += 1;
          if (retainedCount <= MAX_ROWS) byInvoice[invoiceId].push({ ...payment, Amount__c: payment[schema.paymentAmountField], Date__c: payment[schema.paymentDateField] || payment.CreatedDate });
          else complete = false;
        }
      }
    }
  }
  return { byInvoice, complete };
}

function cashflowSelect(fields) {
  return selected(fields, [
    'Id', 'Account__c', 'STEM__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c', 'Supplier_Invoice__c', 'CurrencyIsoCode',
    'Scheduled_Payment_Amount__c', 'Scheduled_Payment_Date__c', 'Payment_Amount__c', 'Payment_Date__c', 'Invoice_Amount__c',
    'Invoice_Due_Date__c', 'Receivable_Payable_Balance_Amount__c', 'Received_Paid_Amount__c', 'Received_Paid_Date__c',
  ]);
}

async function queryCashflows({ invoiceIds, children, cashflowFields }) {
  const select = cashflowSelect(cashflowFields);
  const byInvoice = {};
  const byChild = {};
  let complete = true;
  let retainedCount = 0;
  for (const ids of chunkIds(invoiceIds)) {
    const result = await queryAll(`SELECT ${select.join(',')} FROM Cashflow__c WHERE Supplier_Invoice__c IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1);
    complete = complete && result.records.length <= MAX_ROWS;
    for (const row of result.records.slice(0, MAX_ROWS)) {
      retainedCount += 1;
      if (retainedCount > MAX_ROWS) { complete = false; continue; }
      if (!byInvoice[row.Supplier_Invoice__c]) byInvoice[row.Supplier_Invoice__c] = [];
      byInvoice[row.Supplier_Invoice__c].push(row);
    }
  }
  for (const [field, kind] of [['STEM_Line_Item__c', 'line_item'], ['STEM_Extra_Cost__c', 'extra_cost']]) {
    const childIds = children.filter((child) => child._kind === kind).map((child) => child.Id);
    if (!cashflowFields.has(field)) continue;
    for (const ids of chunkIds(childIds)) {
      const result = await queryAll(`SELECT ${select.join(',')} FROM Cashflow__c WHERE ${field} IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1);
      complete = complete && result.records.length <= MAX_ROWS;
      for (const row of result.records.slice(0, MAX_ROWS)) {
        retainedCount += 1;
        if (retainedCount > MAX_ROWS) { complete = false; continue; }
        const childId = row[field];
        if (!byChild[childId]) byChild[childId] = [];
        byChild[childId].push(row);
      }
    }
  }
  return { byInvoice, byChild, complete };
}

function paginateRows(rows, scope, cursor, limit) {
  if (cursor && (cursor.kind !== 'statement' || cursor.scope !== scope)) throw serviceError('Supplier Statement cursor does not match the selected scope.', 400, 'SUPPLIER_CREDIT_CURSOR_INVALID');
  const offset = cursor?.offset || 0;
  const page = rows.slice(offset, offset + limit);
  return {
    rows: page,
    total: rows.length,
    nextCursor: offset + page.length < rows.length ? encodeAccountCreditCursor({ kind: 'statement', scope, offset: offset + page.length }) : null,
  };
}

async function loadSupplierCreditStatementUncached({ body, accessContext, force }) {
  const startedAt = Date.now();
  const timings = {};
  const accountId = salesforceId(body.accountId);
  const includeGroup = body.includeGroup === true;
  const scope = normalizeSupplierCreditScope(body.scope);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const cursor = decodeAccountCreditCursor(body.cursor);
  if (body.cursor && !cursor) throw serviceError('Supplier Statement cursor is invalid.', 400, 'SUPPLIER_CREDIT_CURSOR_INVALID');
  const filters = normalizeFilters(body.filters);
  const interoffice = accessContext?.profile?.user_type === 'interoffice';
  const today = hongKongToday();
  let stage = Date.now();
  const [accountDescribe, stemDescribe, lineDescribe, extraDescribe, productDescribe, invoiceDescribe, paymentDescribe, cashflowDescribe, portDescribe] = await Promise.all([
    describeObject('Account', force), describeObject('STEM__c', force), describeObject('STEM_Line_Item__c', force),
    describeObject('STEM_Extra_Cost__c', force), describeObject('Product2', force), describeObject('Supplier_Invoice__c', force),
    describeObject('Payment__c', force), describeObject('Cashflow__c', force),
    filters.countryCodes.length ? describeObject('Port__c', force) : Promise.resolve({ fields: [] }),
  ]);
  timings.schemaMs = Date.now() - stage;
  const accountMap = fieldMap(accountDescribe);
  const stemMap = fieldMap(stemDescribe);
  const lineMap = fieldMap(lineDescribe);
  const extraMap = fieldMap(extraDescribe);
  const productMap = fieldMap(productDescribe);
  const invoiceMap = fieldMap(invoiceDescribe);
  const paymentMap = fieldMap(paymentDescribe);
  const cashflowMap = fieldMap(cashflowDescribe);
  requireFields(accountMap, ['Id', 'Name', 'ParentId', 'Inactive_Suspended__c'], 'Account');
  requireFields(stemMap, ['Id', 'Name', 'Account__c', 'Port__c'], 'STEM__c');
  requireFields(invoiceMap, ['Id', 'Name', 'STEM__c', 'Supplier__c', 'Invoice_Amount__c', 'Payable_Balance__c', 'Invoice_Due_Date__c'], 'Supplier_Invoice__c');
  const lineLookup = resolveOriginalSupplierLookup(lineDescribe.fields);
  const extraLookup = resolveExtraCostSupplierLookup(extraDescribe.fields);
  if (!lineLookup.valid || !extraLookup.valid) throw serviceError(lineLookup.issue?.message || extraLookup.issue?.message, 503, 'SUPPLIER_CREDIT_SCHEMA');
  const settlement = resolveSupplierSettlementSchema({ supplierInvoiceFields: invoiceDescribe.fields, paymentFields: paymentDescribe.fields });
  if (!settlement.valid) throw serviceError(settlement.issues.join(' '), 503, 'SUPPLIER_CREDIT_SCHEMA');

  stage = Date.now();
  const chain = await loadAccountChain(accountId, accountMap);
  const account = chain[0];
  if (account.Inactive_Suspended__c === true) throw serviceError('This Salesforce Account is inactive and is not available in FCOS.', 404, 'SUPPLIER_CREDIT_ACCOUNT_INACTIVE');
  ensureAccess(account, chain, interoffice);
  const group = selectUltimateCreditGroup(chain);
  const groupMembers = includeGroup && group ? await loadActiveGroupMembers(group, accountMap) : [account];
  if (!groupMembers.some((member) => idKey(member.Id) === idKey(account.Id))) groupMembers.push(account);
  const targetAccounts = includeGroup ? groupMembers : [account];
  const targetAccountIds = unique(targetAccounts.map((row) => row.Id));
  const accountById = new Map(targetAccounts.map((row) => [idKey(row.Id), row]));
  timings.hierarchyMs = Date.now() - stage;

  stage = Date.now();
  const locationPortIds = await resolveLocationPortIds(filters, fieldMap(portDescribe));
  const childrenResult = await querySupplierChildren({
    accountIds: targetAccountIds, filters, locationPortIds, lineFields: lineMap, extraFields: extraMap,
    accountFieldsMap: accountMap, productFields: productMap, lineLookup, extraLookup,
  });
  const activeChildren = childrenResult.rows.filter((child) => child._supplierInactive !== true);
  const linkedInvoiceIds = unique(activeChildren.map((child) => child.Supplier_Invoice__c));
  const linkedSupplierIdsByInvoice = {};
  for (const child of activeChildren) {
    if (!child.Supplier_Invoice__c) continue;
    if (!linkedSupplierIdsByInvoice[child.Supplier_Invoice__c]) linkedSupplierIdsByInvoice[child.Supplier_Invoice__c] = [];
    linkedSupplierIdsByInvoice[child.Supplier_Invoice__c].push(child._supplierAccountId);
  }
  const invoicesResult = await querySupplierInvoices({ accountIds: targetAccountIds, invoiceIds: linkedInvoiceIds, invoiceFields: invoiceMap, schema: settlement });
  const identities = new Map();
  const conflicts = [];
  const includedInvoices = [];
  for (const invoice of invoicesResult.rows) {
    const identity = resolveSupplierInvoiceIdentity({ invoice, linkedSupplierAccountIds: linkedSupplierIdsByInvoice[invoice.Id] || [], selectedAccountIds: targetAccountIds });
    if (identity.status === 'included') {
      identities.set(invoice.Id, identity);
      includedInvoices.push(invoice);
    } else if (identity.status === 'conflict') conflicts.push({ invoiceId: invoice.Id, invoiceName: invoice.Name, warning: identity.warning });
  }
  const stemIds = unique([...activeChildren.map((child) => child.STEM__c), ...includedInvoices.map((invoice) => invoice.STEM__c)]);
  const stems = [];
  for (const ids of chunkIds(stemIds)) {
    const result = await queryAll(`SELECT ${stemSelect(stemMap).join(',')} FROM STEM__c WHERE Id IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_ROWS + 1}`, MAX_ROWS + 1);
    stems.push(...result.records.slice(0, MAX_ROWS));
  }
  const scopedStems = stems.filter((stem) => stemMatchesStatementScope(stem, filters, locationPortIds, interoffice));
  const allowedStemIds = new Set(scopedStems.map((stem) => idKey(stem.Id)));
  const stemsById = Object.fromEntries(scopedStems.map((stem) => [stem.Id, stem]));
  const scopedInvoices = includedInvoices.filter((invoice) => allowedStemIds.has(idKey(invoice.STEM__c)));
  const scopedChildren = activeChildren.filter((child) => allowedStemIds.has(idKey(child.STEM__c)));
  timings.scopeMs = Date.now() - stage;

  stage = Date.now();
  const invoiceIds = scopedInvoices.map((invoice) => invoice.Id);
  const [paymentsResult, cashflowsResult] = await Promise.all([
    querySupplierPayments(invoiceIds, paymentMap, settlement),
    queryCashflows({ invoiceIds, children: scopedChildren, cashflowFields: cashflowMap }),
  ]);
  const issuedRows = scopedInvoices.map((invoice) => {
    const identity = identities.get(invoice.Id);
    const owner = accountById.get(idKey(identity.supplierAccountId));
    return buildIssuedSupplierRow({
      invoice: {
        ...invoice,
        Invoice_Amount__c: invoice[settlement.invoiceAmountField],
        Payable_Balance__c: invoice[settlement.invoicePayableField],
        Invoice_Due_Date__c: settlement.invoiceDueDateFields.map((field) => invoice[field]).find(Boolean),
        Invoice_Date__c: settlement.invoiceDateFields.map((field) => invoice[field]).find(Boolean),
      },
      identity,
      stem: stemsById[invoice.STEM__c] || {},
      payments: paymentsResult.byInvoice[invoice.Id] || [],
      cashflows: (cashflowsResult.byInvoice[invoice.Id] || []).filter((row) => !row.Account__c || idKey(row.Account__c) === idKey(identity.supplierAccountId)),
      accountName: owner?.Name || invoice.Supplier__r?.Name || null,
      today,
    });
  });
  const issuedWithoutLinkedChild = new Set(issuedRows
    .filter((row) => !(linkedSupplierIdsByInvoice[row.supplierInvoiceId] || []).some((supplierId) => idKey(supplierId) === idKey(row.ownerAccountId)))
    .map((row) => `${idKey(row.stemId)}:${idKey(row.ownerAccountId)}`));
  const uninvoicedChildren = scopedChildren.filter((child) => !child.Supplier_Invoice__c).map((child) => ({
    ...child,
    _ambiguousInvoiceLinkage: issuedWithoutLinkedChild.has(`${idKey(child.STEM__c)}:${idKey(child._supplierAccountId)}`),
  }));
  const cashflowsByExactChild = Object.fromEntries(uninvoicedChildren.map((child) => [child.Id, (cashflowsResult.byChild[child.Id] || [])
    .filter((row) => !row.Account__c || idKey(row.Account__c) === idKey(child._supplierAccountId))]));
  const uninvoicedRows = buildUninvoicedSupplierRows({ children: uninvoicedChildren, stemsById, cashflowsByChildId: cashflowsByExactChild, today });
  timings.evidenceMs = Date.now() - stage;

  const recentStart = oneYearBefore(today);
  const openRows = [...issuedRows.filter((row) => number(row.currentExposure) > 0.005), ...uninvoicedRows];
  const recentSettled = issuedRows.filter((row) => number(row.currentExposure) <= 0.005 && row.payments.some((payment) => payment.date >= recentStart));
  const scopedIssued = scope === 'all' ? issuedRows : scope === 'open_recent' ? [...openRows.filter((row) => row.rowType === 'issued'), ...recentSettled] : openRows.filter((row) => row.rowType === 'issued');
  const scopedUninvoiced = scope === 'all' || scope === 'open_recent' || scope === 'open' ? uninvoicedRows : [];
  const complete = childrenResult.complete && invoicesResult.complete && paymentsResult.complete && cashflowsResult.complete;
  if (!complete) throw serviceError('The Supplier Credit Statement exceeds the complete Salesforce evidence limit. Narrow the Dashboard filters before calculating payable exposure.', 503, 'SUPPLIER_CREDIT_SCOPE_LIMIT');
  const model = buildSupplierCreditStatement({
    account, group, groupMembers, issuedRows: scopedIssued, uninvoicedRows: scopedUninvoiced,
    includeGroup, today, complete,
    warnings: conflicts.map((row) => `${row.invoiceName || 'Supplier Invoice'}: ${row.warning}`),
  });
  const statement = paginateRows(model.rows, scope, cursor, limit);
  return {
    ...model,
    scope,
    statement: { ...statement, pageSize: limit },
    conflicts,
    meta: {
      redacted: true,
      elapsedMs: Date.now() - startedAt,
      complete,
      accountCount: targetAccounts.length,
      supplierInvoiceCount: issuedRows.length,
      uninvoicedGroupCount: uninvoicedRows.length,
      conflictCount: conflicts.length,
      timings,
      salesforceFetchedAt: new Date().toISOString(),
    },
  };
}

export async function loadDashboardSupplierCreditStatement({ body = {}, accessContext, force = false }) {
  const accountId = salesforceId(body.accountId);
  const scope = normalizeSupplierCreditScope(body.scope);
  const includeGroup = body.includeGroup === true;
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const filters = normalizeFilters(body.filters);
  const interoffice = accessContext?.profile?.user_type === 'interoffice';
  const cache = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-supplier-credit-statement',
    version: '1',
    accessScope: interoffice ? 'interoffice' : 'standard',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { accountId: idKey(accountId), scope, includeGroup, cursor: body.cursor || null, limit, filters },
    ttlSeconds: 60,
    tags: [
      'salesforce:dashboard', 'salesforce:account', 'salesforce:group', 'salesforce:stem', 'salesforce:cashflow', 'salesforce:payment',
      'salesforce:supplier-invoice', 'salesforce:line-item', 'salesforce:extra-cost', 'salesforce:supplier-credit',
      `salesforce:account:${idKey(accountId)}`,
    ],
    force,
    loader: () => loadSupplierCreditStatementUncached({ body: { ...body, accountId, scope, includeGroup, limit, filters }, accessContext, force }),
  });
  return { ...cache.value, meta: { ...cache.value.meta, cache: cache.cache?.status || null } };
}

export const dashboardSupplierCreditStatementServiceInternals = {
  childStemConditions,
  isInterofficeExcluded,
  normalizeFilters,
  paginateRows,
  supplierDirectoryCursor,
};
