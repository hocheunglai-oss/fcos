import { chunkIds, getApiVersion, getInstanceUrl, sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';
import { resolveExtraCostSupplierLookup, resolveOriginalSupplierLookup } from './_disputeParties.js';
import { findDashboardUomField } from './_dashboardVolume.js';
import { resolveSupplierSettlementSchema, validSupplierSettlementPayment } from './_disputeSupplierSettlement.js';
import { listUnofficialCompensation } from './_unofficialCompensationService.js';
import { listSpecialTerms } from './_specialTerms.js';
import { resolveBuyerReminderRule } from './_buyerInvoiceReminderRules.js';
import { buildDashboardAccountInsight } from './_dashboardAccountInsight.js';
import { classifyExceptionReviewStem } from '../src/lib/exceptionReviewClassifier.js';
import { normalizeExceptionSchedule } from '../src/lib/exceptionReviewSchedule.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const INTEROFFICE_EXCLUDED_GROUP = 'FRATELLI COSULICH';
const MAX_STEMS = 50_000;

function hongKongToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function serviceError(message, status = 400, code = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = status < 500 || /SCHEMA|ACCESS/.test(String(code || ''));
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function salesforceId(value, label = 'Salesforce Account') {
  const id = text(value);
  if (!SALESFORCE_ID.test(id)) throw serviceError(`${label} ID is invalid.`, 400, 'ACCOUNT_INSIGHT_INVALID_ID');
  return id;
}

function soql(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function idKey(value) {
  const id = text(value);
  return SALESFORCE_ID.test(id) ? id.slice(0, 15) : '';
}

function fieldMap(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

function selected(fields, names) {
  const available = fields instanceof Map ? fields : fieldMap(fields);
  return names.filter((name) => available.has(name));
}

function firstAvailable(fields, names) {
  const available = fields instanceof Map ? fields : fieldMap(fields);
  return names.find((name) => available.has(name)) || null;
}

async function describeObject(objectName, force = false) {
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-account-insight-describe',
    version: '1',
    accessScope: 'schema',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { objectName: objectName.toLowerCase() },
    ttlSeconds: 6 * 60 * 60,
    tags: ['salesforce:schema', `salesforce:schema:${objectName.toLowerCase()}`],
    force,
    loader: async () => {
      const result = await sfRequest(`/sobjects/${encodeURIComponent(objectName)}/describe/`, { readOnly: true });
      return {
        name: result.name,
        fields: (result.fields || []).map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          relationshipName: field.relationshipName || null,
          referenceTo: field.referenceTo || [],
        })),
      };
    },
  });
  return cached.value;
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonthWindow(window, monthDelta) {
  const [year, month] = window.start.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + monthDelta, 1));
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = shifted.getUTCMonth() + 1;
  return {
    start: isoDate(shiftedYear, shiftedMonth, 1),
    end: isoDate(shiftedYear, shiftedMonth, monthEnd(shiftedYear, shiftedMonth)),
  };
}

function insightPeriod(body = {}, today = hongKongToday()) {
  const mode = ['dashboard_period', 'trailing_12', 'all_history'].includes(body.periodMode) ? body.periodMode : 'dashboard_period';
  if (mode === 'all_history') return { mode, label: 'All History', windows: [], previousWindows: [] };
  if (mode === 'trailing_12') {
    const [currentYear, currentMonth] = today.split('-').map(Number);
    const start = new Date(Date.UTC(currentYear, currentMonth - 12, 1));
    const previousStart = new Date(Date.UTC(currentYear, currentMonth - 24, 1));
    const previousEnd = new Date(Date.UTC(currentYear, currentMonth - 12, 0));
    return {
      mode,
      label: 'Trailing 12 Months',
      windows: [{ start: isoDate(start.getUTCFullYear(), start.getUTCMonth() + 1, 1), end: today }],
      previousWindows: [{ start: isoDate(previousStart.getUTCFullYear(), previousStart.getUTCMonth() + 1, 1), end: isoDate(previousEnd.getUTCFullYear(), previousEnd.getUTCMonth() + 1, previousEnd.getUTCDate()) }],
    };
  }
  const years = unique((Array.isArray(body.selectedYears) ? body.selectedYears : []).map((value) => String(Number(value)))).map(Number).filter((value) => value >= 2000 && value <= 2100).sort((a, b) => a - b);
  const months = unique((Array.isArray(body.selectedMonths) ? body.selectedMonths : []).map((value) => String(Number(value)))).map(Number).filter((value) => value >= 1 && value <= 12).sort((a, b) => a - b);
  const fallbackDate = today.split('-').map(Number);
  const safeYears = years.length ? years : [fallbackDate[0]];
  const safeMonths = months.length ? months : [fallbackDate[1]];
  const windows = safeYears.flatMap((year) => safeMonths.map((month) => ({ start: isoDate(year, month, 1), end: isoDate(year, month, monthEnd(year, month)) })));
  const formatter = new Intl.DateTimeFormat('en-GB', { month: 'short' });
  const monthLabel = safeMonths.length === 12 ? 'All months' : safeMonths.map((month) => formatter.format(new Date(Date.UTC(2020, month - 1, 1)))).join(', ');
  return {
    mode,
    label: `${safeYears.join(', ')} · ${monthLabel}`,
    windows,
    previousWindows: windows.map((window) => shiftMonthWindow(window, -12)),
  };
}

function effectiveDateCondition(windows, prefix = '') {
  if (!windows?.length) return '';
  const field = (name) => `${prefix}${name}`;
  return windows.map((window) => `(${field('Delivery_Date__c')} >= ${window.start} AND ${field('Delivery_Date__c')} <= ${window.end}) OR (${field('Delivery_Date__c')} = null AND ${field('Expected_Delivery_Date__c')} >= ${window.start} AND ${field('Expected_Delivery_Date__c')} <= ${window.end})`).map((condition) => `(${condition})`).join(' OR ');
}

function combineConditions(conditions) {
  return conditions.filter(Boolean).map((condition) => `(${condition})`).join(' AND ');
}

function accountSelectFields(fields) {
  const values = ['Id', 'Name', ...selected(fields, ['Company_Code__c', 'Inactive_Suspended__c', 'ParentId', 'Group_Name__c', 'Buyer_Payment_Term__c', 'Supplier_Payment_Term__c', 'Credit_Limit__c', 'Credit_Rating__c', 'Insurance_Limit__c', 'CurrencyIsoCode'])];
  if (fields.has('RecordTypeId')) values.push('RecordType.Name');
  if (fields.has('ParentId')) {
    values.push('Parent.Name');
    if (fields.has('Company_Code__c')) values.push('Parent.Company_Code__c');
    if (fields.has('Inactive_Suspended__c')) values.push('Parent.Inactive_Suspended__c');
  }
  return [...new Set(values)];
}

function serializeAccount(account, { root = false } = {}) {
  return {
    accountId: account.Id,
    name: account.Name || account.Id,
    clKey: account.Company_Code__c || '',
    inactive: account.Inactive_Suspended__c === true,
    recordType: account.RecordType?.Name || null,
    parentId: account.ParentId || null,
    parentName: account.Parent?.Name || account.Group_Name__c || null,
    parentClKey: account.Parent?.Company_Code__c || null,
    root,
    managerCount: 0,
    creditLimit: number(account.Credit_Limit__c),
    creditRating: account.Credit_Rating__c || null,
    insuranceLimit: number(account.Insurance_Limit__c),
    currency: account.CurrencyIsoCode || null,
  };
}

async function loadAccountScope(accountId, role, accountFields, interoffice) {
  if (interoffice && !accountFields.has('Group_Name__c') && !accountFields.has('ParentId')) {
    throw serviceError('Interoffice Account Insight validation requires Account Group or Parent metadata. No Salesforce records were returned.', 503, 'ACCOUNT_INSIGHT_INTEROFFICE_SCHEMA');
  }
  const fields = accountSelectFields(accountFields);
  const result = await sfQuery(`SELECT ${fields.join(',')} FROM Account WHERE Id = '${soql(accountId)}' LIMIT 1`, { clean: true, limit: 1 });
  const root = result.records[0];
  if (!root) throw serviceError('The Salesforce Account no longer exists.', 404, 'ACCOUNT_INSIGHT_ACCOUNT_NOT_FOUND');
  if (!accountFields.has('Inactive_Suspended__c')) throw serviceError('Account Insight cannot verify active Salesforce Accounts.', 503, 'ACCOUNT_INSIGHT_ACCOUNT_STATUS_SCHEMA');
  if (root.Inactive_Suspended__c === true) throw serviceError('This Salesforce Account is inactive and is not available in FCOS.', 404, 'ACCOUNT_INSIGHT_ACCOUNT_INACTIVE');
  if (interoffice && [root.Group_Name__c, root.Parent?.Name, root.Name].some((value) => text(value).toUpperCase() === INTEROFFICE_EXCLUDED_GROUP)) {
    throw serviceError('This Account is outside the Interoffice access scope.', 403, 'ACCOUNT_INSIGHT_ACCESS_DENIED');
  }
  if (role !== 'group') return { root, accounts: [serializeAccount(root, { root: true })] };
  if (!accountFields.has('ParentId')) throw serviceError('Account Insight requires Account.ParentId for GROUP hierarchy.', 503, 'ACCOUNT_INSIGHT_GROUP_SCHEMA');
  const accounts = [serializeAccount(root, { root: true })];
  let parentIds = [root.Id];
  const seen = new Set(parentIds.map(idKey));
  for (let depth = 0; depth < 20 && parentIds.length; depth += 1) {
    const level = [];
    for (const chunk of chunkIds(parentIds)) {
      const childResult = await sfQuery(`SELECT ${fields.join(',')} FROM Account WHERE ParentId IN (${chunk.map((id) => `'${soql(id)}'`).join(',')}) AND Inactive_Suspended__c = false LIMIT 50000`, { clean: true, limit: 50_000 });
      for (const child of childResult.records) {
        const key = idKey(child.Id);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        level.push(child.Id);
        accounts.push(serializeAccount(child));
      }
    }
    parentIds = level;
  }
  if (parentIds.length) throw serviceError('The Salesforce Account hierarchy exceeds the supported 20-level depth.', 503, 'ACCOUNT_INSIGHT_GROUP_DEPTH');
  return { root, accounts };
}

function interofficeStemCondition(accountFields) {
  const conditions = [];
  if (accountFields.has('Group_Name__c')) conditions.push(`(Account__r.Group_Name__c = null OR Account__r.Group_Name__c != '${soql(INTEROFFICE_EXCLUDED_GROUP)}')`);
  if (accountFields.has('ParentId')) conditions.push(`(Account__r.Parent.Name = null OR Account__r.Parent.Name != '${soql(INTEROFFICE_EXCLUDED_GROUP)}')`);
  if (!conditions.length) {
    throw serviceError('Interoffice Account Insight validation requires Account Group or Parent metadata. No Salesforce records were returned.', 503, 'ACCOUNT_INSIGHT_INTEROFFICE_SCHEMA');
  }
  return combineConditions(conditions);
}

function stemSelectFields(stemFields, accountFields) {
  const values = ['Id', 'Name', 'CreatedDate', ...selected(stemFields, ['LastModifiedDate', 'KeyStem__c', 'Account__c', 'Port__c', 'Vessel__c', 'Buyer_Name__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'ETA_ETB__c', 'ETA_Start_Date__c', 'ETA_End_Date__c', 'ETB_Start_Date__c', 'ETB_End_Date__c', 'Original_Invoice_Sent_Date__c', 'Status__c', 'Type__c', 'Dispute__c', 'Dispute_Status__c', 'Dispute_Type__c', 'Total_Invoice_Amount__c', 'Total_Invoiced_Amount_From_Suppliers__c', 'Costs_Total__c', 'QLIK_STEM_Line_Item_Total_Cost__c', 'QLIK_Costs_Total_Cost__c', 'QLIK_Total_Profit__c', 'Receivable_Balance__c', 'Payable_Balance__c', 'Payment_Term__c', 'Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c', 'Payment_Date__c', 'CurrencyIsoCode'])];
  if (stemFields.has('Account__c')) {
    values.push('Account__r.Name');
    if (accountFields.has('Company_Code__c')) values.push('Account__r.Company_Code__c');
    if (accountFields.has('Inactive_Suspended__c')) values.push('Account__r.Inactive_Suspended__c');
    if (accountFields.has('RecordTypeId')) values.push('Account__r.RecordType.Name');
    if (accountFields.has('Group_Name__c')) values.push('Account__r.Group_Name__c');
    if (accountFields.has('ParentId')) {
      values.push('Account__r.ParentId', 'Account__r.Parent.Name');
      if (accountFields.has('Company_Code__c')) values.push('Account__r.Parent.Company_Code__c');
    }
  }
  if (stemFields.has('Port__c')) values.push('Port__r.Name', 'Port__r.Country__c');
  if (stemFields.has('Vessel__c')) values.push('Vessel__r.Name');
  return [...new Set(values)];
}

async function supplierStemIds(accountId, lookup, extraLookup) {
  const queries = [];
  if (lookup.valid) queries.push({ soql: `SELECT STEM__c FROM STEM_Line_Item__c WHERE Original_Supplier__c = '${soql(accountId)}' LIMIT 50000`, clean: true, limit: MAX_STEMS });
  if (extraLookup.valid) queries.push({ soql: `SELECT STEM__c FROM STEM_Extra_Cost__c WHERE ${extraLookup.fieldName} = '${soql(accountId)}' LIMIT 50000`, clean: true, limit: MAX_STEMS });
  const results = queries.length ? await sfCompositeQueries(queries) : [];
  return {
    ids: unique(results.flatMap((result) => result.records.map((row) => row.STEM__c))),
    truncated: results.some((result) => result.totalSize > result.records.length),
  };
}

async function queryInsightStems({ role, scopeAccountIds, supplierIds, dateWindows, fields, accessCondition }) {
  const conditions = [];
  const selectorIds = role === 'supplier' ? supplierIds : scopeAccountIds;
  for (const chunk of chunkIds(selectorIds)) {
    const identityCondition = role === 'supplier'
      ? `Id IN (${chunk.map((id) => `'${soql(id)}'`).join(',')})`
      : `Account__c IN (${chunk.map((id) => `'${soql(id)}'`).join(',')})`;
    conditions.push(combineConditions([identityCondition, effectiveDateCondition(dateWindows), accessCondition]));
  }
  if (!conditions.length) return { records: [], truncated: false, totalSize: 0 };
  const results = await sfCompositeQueries(conditions.map((condition) => ({
    soql: `SELECT ${fields.join(',')} FROM STEM__c WHERE ${condition} ORDER BY Delivery_Date__c DESC NULLS LAST, Expected_Delivery_Date__c DESC NULLS LAST, CreatedDate DESC LIMIT 50000`,
    clean: true,
    limit: MAX_STEMS,
  })));
  const records = new Map();
  for (const result of results) for (const row of result.records) records.set(idKey(row.Id), row);
  return {
    records: [...records.values()],
    truncated: results.some((result) => result.totalSize > result.records.length),
    totalSize: results.reduce((sum, result) => sum + Number(result.totalSize || result.records.length), 0),
  };
}

function lineItemSelectFields(lineFields, accountFields, productFields, lookup) {
  const values = ['Id', 'STEM__c', ...selected(lineFields, ['Name', 'Supplier_Name__c', 'Supplier_Invoice__c', 'Cancelled__c', 'Payment_Term__c', 'Product__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Max__c', 'Quantity_in_MT__c', 'Is_Quantity_Range__c', 'Price_Per_Unit__c', 'Cost_Per_Unit__c', 'Unit_Sell_At__c', 'Unit_Buy_At__c', 'Unit_Cost__c', 'Subtotal_Sell_At__c', 'Subtotal_Buy_At__c', 'Total_Price__c', 'Total_Cost__c', 'Commission_Cost__c', 'Buyers_Brokers_Commission_Per_Unit__c', 'Suppliers_Brokers_Commission_Per_Unit__c'])];
  if (lineFields.has('Product__c')) {
    values.push('Product__r.Name');
    if (productFields.has('Family')) values.push('Product__r.Family');
  }
  if (lookup.valid) {
    values.push('Original_Supplier__c', `${lookup.relationshipName}.Name`);
    if (accountFields.has('Company_Code__c')) values.push(`${lookup.relationshipName}.Company_Code__c`);
  }
  const offerLookup = lineFields.get('Offer_Line_Item__c');
  if (offerLookup?.relationshipName) {
    values.push(`${offerLookup.relationshipName}.UnitPrice`, `${offerLookup.relationshipName}.Supplier_Unit_Price__c`);
  }
  for (const lookupName of ['Supplier_Broker__c', 'Buyers_Broker__c']) {
    const field = lineFields.get(lookupName);
    if (field?.relationshipName) values.push(`${field.relationshipName}.Name`);
  }
  return [...new Set(values)];
}

function extraCostSelectFields(extraFields, accountFields, productFields, lookup, {
  extraCostUomField = null,
  productUomField = null,
} = {}) {
  const values = ['Id', 'STEM__c', ...selected(extraFields, ['Name', 'Description__c', 'Supplier_Name__c', 'Supplier_Invoice__c', 'Cancelled__c', 'Payment_Term__c', 'Product__c', 'Product2Id__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_in_MT__c', 'Quantity_Range_Max__c', 'Is_Quantity_Range__c', 'Unit_Price__c', 'Unit_Cost__c', 'Line_Total__c', 'Line_Total_Buy__c'])];
  if (extraCostUomField) values.push(extraCostUomField);
  const productField = extraFields.get('Product2Id__c') || extraFields.get('Product__c');
  if (productField?.relationshipName) {
    values.push(`${productField.relationshipName}.Name`);
    if (productFields.has('Family')) values.push(`${productField.relationshipName}.Family`);
    if (productUomField) values.push(`${productField.relationshipName}.${productUomField}`);
  }
  if (lookup.valid) {
    values.push(lookup.fieldName, `${lookup.relationshipName}.Name`);
    if (accountFields.has('Company_Code__c')) values.push(`${lookup.relationshipName}.Company_Code__c`);
  }
  return [...new Set(values)];
}

function buyerBrokerQueryConfiguration(brokerFields, accountFields) {
  if (!brokerFields.has('STEM__c')) {
    return {
      fields: [],
      commissionField: null,
      relationshipName: null,
      warning: null,
    };
  }
  const values = ['Id', 'STEM__c'];
  const brokerLookup = brokerFields.get('Buyer_Broker__c');
  if (brokerLookup?.type === 'reference' && brokerLookup.referenceTo?.includes('Account')) {
    values.push('Buyer_Broker__c');
    if (brokerLookup.relationshipName) {
      values.push(`${brokerLookup.relationshipName}.Name`);
      if (accountFields.has('Company_Code__c')) values.push(`${brokerLookup.relationshipName}.Company_Code__c`);
    }
  }
  const commissionField = firstAvailable(brokerFields, [
    'Commission_Lumpsum__c',
    'Buyers_Brokers_Commission_Lumpsum__c',
    'Buyer_Broker_Commission_Lumpsum__c',
    'Lumpsum_Commission__c',
    'Commission_Amount__c',
  ]);
  if (commissionField) values.push(commissionField);
  return {
    fields: [...new Set(values)],
    commissionField,
    relationshipName: brokerLookup?.relationshipName || null,
    warning: null,
  };
}

async function queryChildren(stemIds, fields, objectName, limit = 50_000) {
  if (!stemIds.length) return [];
  const results = await sfCompositeQueries(chunkIds(stemIds).map((chunk) => ({
    soql: `SELECT ${fields.join(',')} FROM ${objectName} WHERE STEM__c IN (${chunk.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${limit}`,
    clean: true,
    limit,
    softFail: false,
  })));
  if (results.some((result) => result.totalSize > result.records.length)) {
    throw serviceError(`${objectName} exceeded the Account Insight retrieval limit. Refine the selected period.`, 413, 'ACCOUNT_INSIGHT_CHILD_LIMIT');
  }
  return results.flatMap((result) => result.records);
}

function paymentFieldConfiguration(paymentFields) {
  return {
    amountField: firstAvailable(paymentFields, ['Amount__c', 'Payment_Amount__c', 'Paid_Amount__c', 'Received_Amount__c', 'Total_Amount__c', 'Amount_Paid__c', 'Payment_Value__c', 'Actual_Amount__c']),
    dateField: firstAvailable(paymentFields, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']),
    statusFields: selected(paymentFields, ['Status__c', 'Payment_Status__c']),
    supplierInvoiceFields: [...paymentFields.values()].filter((field) => field.type === 'reference' && field.referenceTo?.includes('Supplier_Invoice__c')).map((field) => field.name),
  };
}

function nonVoidedPayment(payment, statusFields) {
  return !statusFields.some((field) => /void|cancel|revers|reject/i.test(text(payment[field])));
}

async function queryBuyerPayments(stemIds, paymentFields) {
  const config = paymentFieldConfiguration(paymentFields);
  if (!paymentFields.has('STEM__c') || !config.amountField || !config.dateField || !stemIds.length) return { byStem: {}, warning: 'Buyer Payment evidence is unavailable because required Payment fields were not found.' };
  const selectFields = ['Id', 'STEM__c', ...selected(paymentFields, ['Name', 'CreatedDate', 'CurrencyIsoCode']), config.amountField, config.dateField, ...config.statusFields, ...config.supplierInvoiceFields];
  const results = await sfCompositeQueries(chunkIds(stemIds).map((chunk) => ({
    soql: `SELECT ${[...new Set(selectFields)].join(',')} FROM Payment__c WHERE STEM__c IN (${chunk.map((id) => `'${soql(id)}'`).join(',')}) ORDER BY ${config.dateField} DESC NULLS LAST LIMIT 5000`,
    clean: true,
    limit: 5000,
    softFail: true,
  })));
  const byStem = {};
  for (const payment of results.flatMap((result) => result.records)) {
    if (!nonVoidedPayment(payment, config.statusFields)) continue;
    if (config.supplierInvoiceFields.some((field) => payment[field])) continue;
    const amount = number(payment[config.amountField]);
    if (!(amount > 0) || !payment.STEM__c) continue;
    if (!byStem[payment.STEM__c]) byStem[payment.STEM__c] = [];
    byStem[payment.STEM__c].push({ paymentId: payment.Id, paymentName: payment.Name || null, paymentDate: payment[config.dateField] || payment.CreatedDate || null, amount, currency: payment.CurrencyIsoCode || null });
  }
  return { byStem, warning: null };
}

async function querySupplierInvoices({ stemIds, accountId, lineItems, extraCosts, invoiceDescribe, paymentDescribe, schema }) {
  const invoiceFields = fieldMap(invoiceDescribe);
  if (!stemIds.length || !invoiceFields.has('STEM__c')) return { rows: [], warning: 'Supplier invoice linkage is unavailable.' };
  const supplierSources = [...lineItems, ...extraCosts].filter((row) => {
    const supplierId = row.Original_Supplier__c || row[schema.extraCostSupplierField];
    return idKey(supplierId) === idKey(accountId);
  });
  const sourceInvoiceIds = new Set(supplierSources.map((row) => row.Supplier_Invoice__c).filter((id) => SALESFORCE_ID.test(text(id))));
  const paymentTermsByInvoice = new Map();
  for (const source of supplierSources) {
    if (!source.Supplier_Invoice__c || !source.Payment_Term__c) continue;
    const terms = paymentTermsByInvoice.get(source.Supplier_Invoice__c) || [];
    if (!terms.includes(source.Payment_Term__c)) terms.push(source.Payment_Term__c);
    paymentTermsByInvoice.set(source.Supplier_Invoice__c, terms);
  }
  const invoiceAccountFields = schema.supplierSettlement.supplierAccountFields || [];
  const invoiceAccountRelationships = invoiceAccountFields.map((field) => invoiceFields.get(field)?.relationshipName).filter(Boolean);
  const selectFields = ['Id', 'Name', 'STEM__c', ...selected(invoiceFields, ['CreatedDate', 'CurrencyIsoCode', 'Supplier_Name__c']), schema.supplierSettlement.invoiceAmountField, schema.supplierSettlement.invoicePayableField, ...schema.supplierSettlement.invoiceDueDateFields, ...schema.supplierSettlement.invoiceDateFields, ...schema.supplierSettlement.invoiceStatusFields, ...invoiceAccountFields, ...invoiceAccountRelationships.map((relationship) => `${relationship}.Name`)].filter(Boolean);
  const invoiceResults = await sfCompositeQueries(chunkIds(stemIds).map((chunk) => ({
    soql: `SELECT ${[...new Set(selectFields)].join(',')} FROM Supplier_Invoice__c WHERE STEM__c IN (${chunk.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 5000`,
    clean: true,
    limit: 5000,
    softFail: true,
  })));
  const invoices = invoiceResults.flatMap((result) => result.records).filter((invoice) => {
    if (sourceInvoiceIds.has(invoice.Id)) return true;
    return invoiceAccountFields.some((field) => idKey(invoice[field]) === idKey(accountId));
  });
  const paymentFields = fieldMap(paymentDescribe);
  const paymentSelectFields = ['Id', ...selected(paymentFields, ['Name', 'CreatedDate', 'CurrencyIsoCode']), schema.supplierSettlement.paymentAmountField, schema.supplierSettlement.paymentDateField, ...schema.supplierSettlement.paymentStatusFields, ...schema.supplierSettlement.paymentSupplierInvoiceFields].filter(Boolean);
  const paymentsByInvoice = new Map();
  if (invoices.length && schema.supplierSettlement.paymentAmountField && schema.supplierSettlement.paymentSupplierInvoiceFields.length) {
    for (const lookupField of schema.supplierSettlement.paymentSupplierInvoiceFields) {
      const results = await sfCompositeQueries(chunkIds(invoices.map((invoice) => invoice.Id)).map((chunk) => ({
        soql: `SELECT ${[...new Set(paymentSelectFields)].join(',')} FROM Payment__c WHERE ${lookupField} IN (${chunk.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 5000`,
        clean: true,
        limit: 5000,
        softFail: true,
      })));
      for (const payment of results.flatMap((result) => result.records)) {
        if (!validSupplierSettlementPayment(payment, schema.supplierSettlement.paymentStatusFields)) continue;
        const invoiceId = payment[lookupField];
        if (!invoiceId) continue;
        const values = paymentsByInvoice.get(invoiceId) || [];
        if (!values.some((value) => value.id === payment.Id)) values.push({ id: payment.Id, name: payment.Name || null, amount: number(payment[schema.supplierSettlement.paymentAmountField]) || 0, date: payment[schema.supplierSettlement.paymentDateField] || payment.CreatedDate || null });
        paymentsByInvoice.set(invoiceId, values);
      }
    }
  }
  return {
    rows: invoices.map((invoice) => {
      const accountField = invoiceAccountFields.find((field) => invoice[field]);
      const relationship = accountField ? invoiceFields.get(accountField)?.relationshipName : null;
      const invoiceAmount = number(invoice[schema.supplierSettlement.invoiceAmountField]);
      const payableBalance = number(invoice[schema.supplierSettlement.invoicePayableField]);
      return {
        invoiceId: invoice.Id,
        invoiceName: invoice.Name || invoice.Id,
        stemId: invoice.STEM__c,
        supplierAccountId: accountField ? invoice[accountField] : accountId,
        supplierName: relationship ? invoice[relationship]?.Name : invoice.Supplier_Name__c || null,
        currency: invoice.CurrencyIsoCode || 'USD',
        invoiceAmount,
        payableBalance,
        dueDate: schema.supplierSettlement.invoiceDueDateFields.map((field) => invoice[field]).find(Boolean) || null,
        invoiceDate: schema.supplierSettlement.invoiceDateFields.map((field) => invoice[field]).find(Boolean) || invoice.CreatedDate || null,
        status: schema.supplierSettlement.invoiceStatusFields.map((field) => invoice[field]).find(Boolean) || null,
        paymentTerm: (paymentTermsByInvoice.get(invoice.Id) || []).join(' · ') || null,
        payments: paymentsByInvoice.get(invoice.Id) || [],
      };
    }),
    warning: schema.supplierSettlement.valid ? null : schema.supplierSettlement.issues.join(' '),
  };
}

async function loadSalesforceDataset({ accountId, role, period, interoffice, force }) {
  const [accountDescribe, stemDescribe, lineDescribe, productDescribe, extraDescribe, buyerBrokerDescribe, invoiceDescribe, paymentDescribe] = await Promise.all([
    describeObject('Account', force),
    describeObject('STEM__c', force),
    describeObject('STEM_Line_Item__c', force),
    describeObject('Product2', force),
    describeObject('STEM_Extra_Cost__c', force),
    describeObject('STEM_Buyer_Broker__c', force).catch(() => ({ fields: [] })),
    describeObject('Supplier_Invoice__c', force).catch(() => ({ fields: [] })),
    describeObject('Payment__c', force).catch(() => ({ fields: [] })),
  ]);
  const accountFields = fieldMap(accountDescribe);
  const stemFields = fieldMap(stemDescribe);
  const lineFields = fieldMap(lineDescribe);
  const productFields = fieldMap(productDescribe);
  const extraFields = fieldMap(extraDescribe);
  const buyerBrokerFields = fieldMap(buyerBrokerDescribe);
  const invoiceFields = fieldMap(invoiceDescribe);
  const paymentFields = fieldMap(paymentDescribe);
  const buyerLookup = stemFields.get('Account__c');
  if (buyerLookup?.type !== 'reference' || !buyerLookup.referenceTo?.includes('Account')) {
    throw serviceError('Account Insight requires STEM__c.Account__c to be a Salesforce Account lookup.', 503, 'ACCOUNT_INSIGHT_SCHEMA_INVALID');
  }
  if (!stemFields.has('Delivery_Date__c') || !stemFields.has('Expected_Delivery_Date__c')) throw serviceError('Account Insight requires Delivery Date and Expected Delivery Date on STEM.', 503, 'ACCOUNT_INSIGHT_SCHEMA_INVALID');
  const originalSupplierLookup = resolveOriginalSupplierLookup(lineDescribe.fields || []);
  const extraCostSupplierLookup = resolveExtraCostSupplierLookup(extraDescribe.fields || []);
  if (!originalSupplierLookup.valid) throw serviceError(originalSupplierLookup.issue.message, 503, 'ACCOUNT_INSIGHT_SCHEMA_INVALID');
  if (!extraCostSupplierLookup.valid) throw serviceError(extraCostSupplierLookup.issue.message, 503, 'ACCOUNT_INSIGHT_SCHEMA_INVALID');
  const scope = await loadAccountScope(accountId, role, accountFields, interoffice);
  if (role === 'group' && !/group/i.test(text(scope.root.RecordType?.Name))) throw serviceError('The selected Account is not a Salesforce GROUP Account.', 400, 'ACCOUNT_INSIGHT_NOT_GROUP');
  const supplierScope = await supplierStemIds(accountId, originalSupplierLookup, extraCostSupplierLookup);
  const accessCondition = interoffice ? interofficeStemCondition(accountFields) : '';
  const fields = stemSelectFields(stemFields, accountFields);
  const scopeIds = scope.accounts.map((account) => account.accountId);
  const current = await queryInsightStems({ role, scopeAccountIds: scopeIds, supplierIds: supplierScope.ids, dateWindows: period.windows, fields, accessCondition });
  const previous = period.previousWindows.length ? await queryInsightStems({ role, scopeAccountIds: scopeIds, supplierIds: supplierScope.ids, dateWindows: period.previousWindows, fields, accessCondition }) : { records: [], truncated: false, totalSize: 0 };
  const allStemIds = unique([...current.records, ...previous.records].map((stem) => stem.Id));
  const lineItemUomField = findDashboardUomField(lineDescribe.fields || [], 'lineItem');
  const extraCostUomField = findDashboardUomField(extraDescribe.fields || [], 'lineItem');
  const productUomField = findDashboardUomField(productDescribe.fields || [], 'product');
  const lineFieldsToQuery = lineItemSelectFields(lineFields, accountFields, productFields, originalSupplierLookup);
  if (lineItemUomField) lineFieldsToQuery.push(lineItemUomField);
  if (productUomField) lineFieldsToQuery.push(`Product__r.${productUomField}`);
  const extraFieldsToQuery = extraCostSelectFields(extraFields, accountFields, productFields, extraCostSupplierLookup, {
    extraCostUomField,
    productUomField,
  });
  const buyerBrokerConfig = buyerBrokerQueryConfiguration(buyerBrokerFields, accountFields);
  const [lineItems, extraCosts, buyerBrokerRows] = await Promise.all([
    queryChildren(allStemIds, [...new Set(lineFieldsToQuery)], 'STEM_Line_Item__c'),
    queryChildren(allStemIds, extraFieldsToQuery, 'STEM_Extra_Cost__c'),
    buyerBrokerConfig.fields.length
      ? queryChildren(allStemIds, buyerBrokerConfig.fields, 'STEM_Buyer_Broker__c')
      : Promise.resolve([]),
  ]);
  const buyerBrokers = buyerBrokerRows.map((row) => ({
    ...row,
    _Commission_Amount: buyerBrokerConfig.commissionField ? row[buyerBrokerConfig.commissionField] : null,
    _Buyer_Broker_Name: buyerBrokerConfig.relationshipName ? row[buyerBrokerConfig.relationshipName]?.Name || null : null,
    _Buyer_Broker_CL_Key: buyerBrokerConfig.relationshipName ? row[buyerBrokerConfig.relationshipName]?.Company_Code__c || null : null,
  }));
  const currentIds = new Set(current.records.map((stem) => stem.Id));
  const previousIds = new Set(previous.records.map((stem) => stem.Id));
  const buyerPayments = role === 'supplier' ? { byStem: {}, warning: null } : await queryBuyerPayments([...currentIds], paymentFields);
  const supplierSettlement = resolveSupplierSettlementSchema({ supplierInvoiceFields: invoiceDescribe.fields || [], paymentFields: paymentDescribe.fields || [] });
  const schema = {
    originalSupplierRelationship: originalSupplierLookup.relationshipName || 'Original_Supplier__r',
    extraCostSupplierField: extraCostSupplierLookup.fieldName,
    extraCostSupplierRelationship: extraCostSupplierLookup.relationshipName,
    lineItemUomField,
    extraCostUomField,
    productUomField,
    supplierSettlement,
  };
  const supplierInvoices = role === 'supplier'
    ? await querySupplierInvoices({ stemIds: [...currentIds], accountId, lineItems: lineItems.filter((row) => currentIds.has(row.STEM__c)), extraCosts: extraCosts.filter((row) => currentIds.has(row.STEM__c)), invoiceDescribe, paymentDescribe, schema })
    : { rows: [], warning: null };
  const buyerCount = await sfQuery(`SELECT COUNT(Id) total FROM STEM__c WHERE ${combineConditions([`Account__c = '${soql(accountId)}'`, accessCondition])}`, { clean: true, limit: 1, softFail: true });
  const availableRoles = role === 'group'
    ? ['group']
    : [buyerCount.records?.[0]?.total > 0 ? 'buyer' : null, supplierScope.ids.length ? 'supplier' : null, role].filter(Boolean);
  const warnings = unique([
    originalSupplierLookup.issue?.message,
    extraCostSupplierLookup.issue?.message,
    buyerPayments.warning,
    supplierInvoices.warning,
    buyerBrokerConfig.warning,
  ]);
  return {
    identity: {
      ...serializeAccount(scope.root, { root: true }),
      accountId: scope.root.Id,
      active: scope.root.Inactive_Suspended__c !== true,
      group: scope.root.Parent && scope.root.Parent.Inactive_Suspended__c !== true ? { accountId: scope.root.ParentId, name: scope.root.Parent.Name, clKey: scope.root.Parent.Company_Code__c || '' } : null,
    },
    role,
    availableRoles: unique(availableRoles),
    period,
    scopeAccounts: scope.accounts,
    stems: current.records,
    matchedStemCount: current.totalSize,
    previousStems: previous.records,
    lineItems: lineItems.filter((row) => currentIds.has(row.STEM__c)),
    previousLineItems: lineItems.filter((row) => previousIds.has(row.STEM__c)),
    extraCosts: extraCosts.filter((row) => currentIds.has(row.STEM__c)),
    previousExtraCosts: extraCosts.filter((row) => previousIds.has(row.STEM__c)),
    buyerBrokers: buyerBrokers.filter((row) => currentIds.has(row.STEM__c)),
    previousBuyerBrokers: buyerBrokers.filter((row) => previousIds.has(row.STEM__c)),
    buyerPaymentsByStem: buyerPayments.byStem,
    supplierInvoices: supplierInvoices.rows,
    schema,
    warnings,
    truncated: current.truncated || previous.truncated || supplierScope.truncated,
    meta: { salesforceFetchedAt: new Date().toISOString(), instanceUrl: getInstanceUrl() },
  };
}

function serializeCollectionItem(row) {
  if (!row) return null;
  return {
    status: row.status,
    nextFollowUpDate: row.next_follow_up_date,
    promisedPaymentDate: row.promised_payment_date,
    adviceVerificationDate: row.advice_verification_date,
    reconciliationState: row.reconciliation_state,
  };
}

function serializeCollectionEvent(row) {
  return { eventType: row.event_type, createdAt: row.created_at };
}

function chunks(values, size = 150) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function selectSupabaseRowsByStem(client, table, columns, stemIds, { order = null, maxRows = 50_000, field = 'stem_id' } = {}) {
  if (!stemIds.length) return { data: [], error: null };
  try {
    const batches = await Promise.all(chunks(unique(stemIds)).map(async (ids) => {
      const rows = [];
      for (let from = 0; from < maxRows; from += 1000) {
        let query = client.from(table).select(columns).in(field, ids);
        if (order) query = query.order(order.column, { ascending: order.ascending });
        const result = await query.range(from, Math.min(from + 999, maxRows - 1));
        if (result.error) throw result.error;
        const page = result.data || [];
        rows.push(...page);
        if (page.length < 1000) break;
        if (rows.length >= maxRows) throw new Error(`${table} exceeded the Account Insight live-data limit.`);
      }
      return rows;
    }));
    return { data: batches.flat(), error: null };
  } catch (error) {
    return { data: [], error };
  }
}

async function loadAccountManagerState(client, scopeAccounts) {
  try {
    const accountIds = unique(scopeAccounts.flatMap((account) => [account.accountId, idKey(account.accountId)]));
    if (!accountIds.length) return { accountState: new Map(), managers: [], note: null };
    const groupsResult = await client
      .from('account_manager_groups')
      .select('account_name_key,account_name,salesforce_account_ids')
      .overlaps('salesforce_account_ids', accountIds);
    if (groupsResult.error) throw groupsResult.error;
    const accountKeys = unique((groupsResult.data || []).map((group) => group.account_name_key));
    if (!accountKeys.length) return { accountState: new Map(), managers: [], note: null };
    const [assignmentsResult, notesResult] = await Promise.all([
      client.from('account_manager_assignments').select('account_name_key,manager_user_id,assignment_order').in('account_name_key', accountKeys).order('assignment_order'),
      client.from('account_manager_notes').select('account_name_key,account_note,source_group_account_name_key,source_group_account_name').in('account_name_key', accountKeys),
    ]);
    if (assignmentsResult.error || notesResult.error) throw assignmentsResult.error || notesResult.error;
    const managerIds = unique((assignmentsResult.data || []).map((assignment) => assignment.manager_user_id));
    const profilesResult = managerIds.length
      ? await client.from('user_profiles').select('id,full_name,email,active').in('id', managerIds)
      : { data: [], error: null };
    if (profilesResult.error) throw profilesResult.error;
    const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
    const assignmentsByKey = new Map();
    for (const assignment of assignmentsResult.data || []) {
      const values = assignmentsByKey.get(assignment.account_name_key) || [];
      const profile = profileMap.get(assignment.manager_user_id);
      if (profile) values.push({ userId: profile.id, name: profile.full_name || profile.email, email: profile.email, active: profile.active === true, priority: assignment.assignment_order });
      assignmentsByKey.set(assignment.account_name_key, values);
    }
    const notesByKey = new Map((notesResult.data || []).map((note) => [note.account_name_key, note]));
    const accountState = new Map();
    for (const group of groupsResult.data || []) {
      for (const id of group.salesforce_account_ids || []) accountState.set(idKey(id), { managers: assignmentsByKey.get(group.account_name_key) || [], note: notesByKey.get(group.account_name_key)?.account_note || null });
    }
    const rootState = accountState.get(idKey(scopeAccounts.find((account) => account.root)?.accountId)) || { managers: [], note: null };
    return { accountState, managers: rootState.managers, note: rootState.note };
  } catch (error) {
    console.warn('[account-insight] scoped Account Manager load failed', { code: error?.code || null });
    return { accountState: new Map(), managers: [], note: null, warning: 'Account Manager information is temporarily unavailable.' };
  }
}

async function loadReminderPolicy(client, identity, role) {
  if (role === 'supplier') return { policy: null, source: null, note: null };
  try {
    const accountIds = unique([identity.accountId, idKey(identity.accountId), identity.parentId, idKey(identity.parentId)]);
    const { data, error } = await client
      .from('buyer_invoice_reminder_rules')
      .select('salesforce_account_id,account_name,parent_salesforce_account_id,policy,note,inherit_to_children,revision,updated_at')
      .in('salesforce_account_id', accountIds);
    if (error) throw error;
    const rule = resolveBuyerReminderRule({
      buyerAccountId: identity.accountId,
      buyerParentAccountId: identity.parentId,
      buyerName: identity.name,
      buyerGroupName: identity.parentName,
    }, data || []);
    return { policy: rule.policy, source: rule.source, sourceAccountName: rule.sourceAccountName || null, note: rule.note || null };
  } catch (error) {
    console.warn('[account-insight] scoped reminder-rule load failed', { code: error?.code || null });
    return { policy: null, source: 'unavailable', note: null, warning: 'Payment reminder policy is temporarily unavailable.' };
  }
}

async function loadWorkflowState(client, salesforceData, interoffice, force) {
  const stemIds = salesforceData.stems.map((stem) => stem.Id);
  const warnings = [];
  const collectionByStem = {};
  const workflows = { cases: [], parties: [], actions: [], instructions: [] };
  const hedgeByStem = {};
  let exceptions = { count: 0, overdue: 0, reasons: [] };
  if (stemIds.length) {
    const [collectionItems, collectionEvents, cases, parties, actions, instructions, exceptionItems, hedgeAllocations] = await Promise.all([
      selectSupabaseRowsByStem(client, 'buyer_invoice_collection_items', 'stem_id,status,next_follow_up_date,promised_payment_date,advice_verification_date,reconciliation_state', stemIds),
      selectSupabaseRowsByStem(client, 'buyer_invoice_collection_events', 'stem_id,event_type,created_at', stemIds, { order: { column: 'created_at', ascending: false } }),
      selectSupabaseRowsByStem(client, 'dispute_beta_cases', 'id,stem_id,workflow_status,approval_status,submitted_at,created_at,closed_at', stemIds),
      selectSupabaseRowsByStem(client, 'dispute_workflow_parties', 'id,case_id,stem_id,account_id,roles', stemIds),
      selectSupabaseRowsByStem(client, 'dispute_beta_actions', 'id,case_id,stem_id,party_id,action_type,action_label,amount,close_reason,execution_status,settlement_amount', stemIds),
      selectSupabaseRowsByStem(client, 'dispute_workflow_supplier_instructions', 'id,case_id,stem_id,party_id,instruction_type,status,currency_iso_code,planned_amount,recovery_method,created_at,settled_at', stemIds),
      selectSupabaseRowsByStem(client, 'exception_review_items', 'stem_id,status,department,priority,due_date', stemIds),
      selectSupabaseRowsByStem(client, 'hedge_salesforce_allocations', 'salesforce_stem_id,paper_hedge_id,venue,allocation_percentage,net_pnl,sync_state', stemIds, { field: 'salesforce_stem_id' }),
    ]);
    const unavailableWorkflowSources = [collectionItems, collectionEvents, cases, parties, actions, instructions, exceptionItems, hedgeAllocations]
      .filter((result) => result.error).length;
    if (unavailableWorkflowSources) {
      warnings.push(`${unavailableWorkflowSources} internal workflow source${unavailableWorkflowSources === 1 ? ' is' : 's are'} temporarily unavailable.`);
    }
    for (const item of collectionItems.data || []) collectionByStem[item.stem_id] = { item: serializeCollectionItem(item), events: [] };
    for (const event of collectionEvents.data || []) {
      if (!collectionByStem[event.stem_id]) collectionByStem[event.stem_id] = { item: null, events: [] };
      collectionByStem[event.stem_id].events.push(serializeCollectionEvent(event));
    }
    workflows.cases = cases.data || [];
    workflows.parties = parties.data || [];
    workflows.actions = actions.data || [];
    workflows.instructions = instructions.data || [];
    for (const allocation of hedgeAllocations.data || []) {
      const values = hedgeByStem[allocation.salesforce_stem_id] || [];
      values.push({ venue: allocation.venue, allocationPercentage: number(allocation.allocation_percentage), netPnl: number(allocation.net_pnl), syncState: allocation.sync_state });
      hedgeByStem[allocation.salesforce_stem_id] = values;
    }
    const uncancelledLineStemIds = new Set(salesforceData.lineItems
      .filter((item) => item.Cancelled__c !== true && Boolean(item.Product__c))
      .map((item) => item.STEM__c));
    const classifiedExceptions = salesforceData.stems.map((stem) => classifyExceptionReviewStem({
      ...stem,
      _Exception_Schedule: normalizeExceptionSchedule(stem),
      _Has_Uncancelled_Line_Product_Item: uncancelledLineStemIds.has(stem.Id),
    })).filter((stem) => stem.reviewReasons.length > 0);
    const reasonCounts = new Map();
    for (const stem of classifiedExceptions) {
      for (const reason of stem.reviewReasons) reasonCounts.set(reason.label, (reasonCounts.get(reason.label) || 0) + 1);
    }
    const today = hongKongToday();
    exceptions = { count: classifiedExceptions.length, overdue: (exceptionItems.data || []).filter((item) => item.due_date && item.due_date < today && !/resolved|dismissed/i.test(text(item.status))).length, reasons: [...reasonCounts.entries()].map(([label, value]) => ({ label, value })) };
  }
  const [managers, reminderPolicy] = await Promise.all([
    loadAccountManagerState(client, salesforceData.scopeAccounts),
    loadReminderPolicy(client, salesforceData.identity, salesforceData.role),
  ]);
  if (managers.warning) warnings.push(managers.warning);
  if (reminderPolicy.warning) warnings.push(reminderPolicy.warning);
  const scopeAccounts = salesforceData.scopeAccounts.map((account) => ({ ...account, managerCount: managers.accountState.get(idKey(account.accountId))?.managers?.length || 0 }));
  let compensation = { accounts: [] };
  try {
    compensation = await listUnofficialCompensation({ force, interoffice, accountIds: scopeAccounts.map((account) => account.accountId) });
  } catch (error) {
    console.warn('[account-insight] scoped compensation load failed', { code: error?.code || null });
    warnings.push('Unofficial Compensation is temporarily unavailable.');
  }
  let specialTerms = { count: 0, terms: [] };
  try {
    const accountIds = new Set(scopeAccounts.map((account) => idKey(account.accountId)));
    const portIds = new Set(salesforceData.stems.map((stem) => idKey(stem.Port__c)).filter(Boolean));
    const countries = new Set(salesforceData.stems.map((stem) => text(stem.Port__r?.Country__c).toLowerCase()).filter(Boolean));
    const productIds = new Set(salesforceData.lineItems.map((item) => idKey(item.Product__c)).filter(Boolean));
    const audience = salesforceData.role === 'supplier' ? 'Supplier' : 'Buyer';
    const workspace = await listSpecialTerms({
      force,
      scope: {
        accountIds: [...accountIds],
        portIds: [...portIds],
        productIds: [...productIds],
        countries: [...countries],
        audience,
      },
    });
    const matchedRules = (workspace.rules || []).filter((rule) => rule.audience === audience
      && (!rule.accountId || accountIds.has(idKey(rule.accountId)))
      && (!rule.portId || portIds.has(idKey(rule.portId)))
      && (!rule.productId || productIds.has(idKey(rule.productId)))
      && (!rule.country || countries.has(text(rule.country).toLowerCase())));
    const termMap = new Map((workspace.terms || []).map((term) => [idKey(term.id), term]));
    specialTerms = { count: matchedRules.length, terms: matchedRules.map((rule) => ({ ruleId: rule.id, ruleName: rule.name, termName: termMap.get(idKey(rule.specialTermId))?.name || rule.specialTermName, audience: rule.audience, priority: rule.priority })) };
  } catch (error) {
    console.warn('[account-insight] scoped Special Terms load failed', { code: error?.code || null });
    warnings.push('Special Terms are temporarily unavailable.');
  }
  return { collectionByStem, workflows, hedgeByStem, exceptions, managers, reminderPolicy, scopeAccounts, compensation, specialTerms, warnings };
}

export async function loadDashboardAccountInsight({ body = {}, accessContext, force = false, includeExportRows = false }) {
  const accountId = salesforceId(body.accountId);
  const role = ['buyer', 'supplier', 'group'].includes(body.contextRole) ? body.contextRole : 'buyer';
  const period = insightPeriod(body);
  const interoffice = accessContext?.profile?.user_type === 'interoffice';
  const cachePayload = { accountId: idKey(accountId), role, period };
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-account-insight',
    version: '2',
    accessScope: interoffice ? 'interoffice' : 'standard',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: cachePayload,
    ttlSeconds: 60,
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:stem', `salesforce:account:${idKey(accountId)}`],
    force,
    loader: () => loadSalesforceDataset({ accountId, role, period, interoffice, force }),
  });
  const live = await loadWorkflowState(accessContext.client, cached.value, interoffice, force);
  const dataset = {
    ...cached.value,
    scopeAccounts: live.scopeAccounts,
    accountManagers: live.managers.managers,
    accountNote: live.managers.note,
    reminderPolicy: live.reminderPolicy,
    collectionByStem: live.collectionByStem,
    workflows: live.workflows,
    hedgeByStem: live.hedgeByStem,
    compensation: live.compensation,
    exceptions: live.exceptions,
    specialTerms: live.specialTerms,
    warnings: unique([...(cached.value.warnings || []), ...(live.warnings || [])]),
    qlik: { discrepancies: null },
    meta: {
      ...cached.value.meta,
      cacheStatus: cached.cacheStatus || cached.status || null,
      workflowFetchedAt: new Date().toISOString(),
    },
  };
  const result = buildDashboardAccountInsight(dataset, { cursor: body.cursor, pageSize: body.pageSize, today: hongKongToday() });
  if (!includeExportRows) delete result.exportRows;
  return result;
}

export const dashboardAccountInsightServiceInternals = {
  insightPeriod,
  effectiveDateCondition,
  buyerBrokerQueryConfiguration,
  extraCostSelectFields,
};
