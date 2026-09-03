import { chunkIds, getApiVersion, getInstanceUrl, sfQuery, sfRequest } from './_salesforce.js';
import { getOrLoadRuntimeCache } from './_runtimeCache.js';
import { SALESFORCE_CORPORATE_CURRENCY } from './_decisionDashboard.js';
import { resolvedBuyerInvoiceDueDate } from './_buyerInvoiceDates.js';
import {
  buildBuyerPaymentDelayModels,
  normalizeBuyerPaymentConservativeness,
} from './_buyerPaymentPerformance.js';
import {
  accountCreditSnapshot,
  buildAccountCreditStatement,
  CREDIT_EXPOSURE_DELIVERY_START,
  decodeAccountCreditCursor,
  encodeAccountCreditCursor,
  isCreditExposureStemEligible,
  normalizeAccountCreditScope,
  normalizeCreditAccountName,
  reconcileCreditExposure,
  resolveCreditSnapshotCandidate,
  resolveGroupCreditAuthority,
  selectUltimateCreditGroup,
} from './_dashboardAccountCreditStatement.js';
import {
  loadDashboardSupplierCreditDirectory,
  loadDashboardSupplierCreditStatement,
} from './_dashboardSupplierCreditStatementService.js';
import { loadDashboardUnifiedCreditDirectory } from './_dashboardUnifiedCounterpartyService.js';
import { normalizeRequestedGroupAccountIds, resolveGroupAccountScope } from './_dashboardGroupAccountScope.js';
import { paymentDataReliabilityMetadata } from '../src/lib/paymentDataReliability.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const INTEROFFICE_EXCLUDED_GROUP = 'FRATELLI COSULICH';
const MAX_GROUP_OPEN_STEMS = 10_000;
const MAX_EVIDENCE_ROWS = 50_000;
const MAX_GROUP_DEPTH = 20;

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
  const normalized = text(value);
  return SALESFORCE_ID.test(normalized) ? normalized.slice(0, 15) : '';
}

function salesforceId(value, label = 'Salesforce Account') {
  const normalized = text(value);
  if (!SALESFORCE_ID.test(normalized)) throw serviceError(`${label} ID is invalid.`, 400, 'ACCOUNT_CREDIT_INVALID_ID');
  return normalized;
}

function soql(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function directoryFilters(value = {}) {
  const filters = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const accountIds = unique(Array.isArray(filters.accountIds) ? filters.accountIds : []).map((id) => salesforceId(id, 'Dashboard Account'));
  const portIds = unique(Array.isArray(filters.portIds) ? filters.portIds : []).map((id) => salesforceId(id, 'Dashboard Port'));
  const countryCodes = unique(Array.isArray(filters.countryCodes) ? filters.countryCodes : [])
    .map((country) => country.toUpperCase())
    .filter(Boolean);
  if (accountIds.length > 2_000 || portIds.length > 2_000 || countryCodes.length > 200) {
    throw serviceError('Dashboard Account Statement filters exceed the supported scope.', 400, 'ACCOUNT_CREDIT_FILTER_LIMIT');
  }
  return { accountIds, portIds, countryCodes };
}

function fieldMap(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

function selected(fields, names) {
  return names.filter((name) => fields.has(name));
}

function firstAvailable(fields, names) {
  return names.find((name) => fields.has(name)) || null;
}

function hongKongToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function oneYearBefore(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value.toISOString().slice(0, 10);
}

function addCalendarDays(date, days) {
  const value = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`);
  const to = Date.parse(`${String(toDate).slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / 86_400_000) : null;
}

async function describeObject(objectName, force = false) {
  const result = await getOrLoadRuntimeCache({
    namespace: 'salesforce-account-credit-describe',
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
          type: field.type,
          relationshipName: field.relationshipName || null,
          referenceTo: field.referenceTo || [],
        })),
      };
    },
  });
  return result.value;
}

async function queryAll(query, limit = Number.MAX_SAFE_INTEGER) {
  const result = await sfQuery(query, { clean: true, limit, softFail: false });
  return { records: result.records || [], totalSize: Number(result.totalSize ?? result.records?.length ?? 0) };
}

function interofficeAccountCondition(accountFields, prefix = '') {
  const field = (name) => `${prefix}${name}`;
  const conditions = [];
  if (accountFields.has('Group_Name__c')) conditions.push(`(${field('Group_Name__c')} = null OR ${field('Group_Name__c')} != '${soql(INTEROFFICE_EXCLUDED_GROUP)}')`);
  if (accountFields.has('ParentId')) conditions.push(`(${field('Parent.Name')} = null OR ${field('Parent.Name')} != '${soql(INTEROFFICE_EXCLUDED_GROUP)}')`);
  conditions.push(`(${field('Name')} = null OR ${field('Name')} != '${soql(INTEROFFICE_EXCLUDED_GROUP)}')`);
  return conditions.join(' AND ');
}

function ensureInterofficeAccountAccess(account, chain, interoffice) {
  if (!interoffice) return;
  const names = [account?.Name, account?.Group_Name__c, account?.Parent?.Name, ...(chain || []).map((row) => row.Name)];
  if (names.some((name) => text(name).toUpperCase() === INTEROFFICE_EXCLUDED_GROUP)) {
    throw serviceError('This Account is outside the Interoffice access scope.', 403, 'ACCOUNT_CREDIT_ACCESS_DENIED');
  }
}

function accountSelectFields(fields) {
  const names = [
    'Id', 'Name', 'ParentId', 'CreatedDate', 'LastModifiedDate', 'Company_Code__c', 'Inactive_Suspended__c', 'Group_Name__c', 'CurrencyIsoCode',
    'CL_Category__c', 'CL_Group__c', 'CL_Individual__c', 'CL_Special_Group__c',
    'CL_Special__c', 'CL_Used_Customer__c', 'CL_Used_Group__c', 'CL_Available_Credit__c',
  ];
  const result = selected(fields, names);
  if (fields.has('ParentId')) result.push('Parent.Name');
  return [...new Set(result)];
}

function creditExposureDeliveryWhere() {
  return `((Delivery_Date__c >= ${CREDIT_EXPOSURE_DELIVERY_START}) OR (Delivery_Date__c = null AND Expected_Delivery_Date__c >= ${CREDIT_EXPOSURE_DELIVERY_START}))`;
}

function requireFields(fields, names, objectName) {
  const missing = names.filter((name) => !fields.has(name));
  if (missing.length) throw serviceError(`${objectName} is missing required credit field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`, 503, 'ACCOUNT_CREDIT_SCHEMA');
}

function directoryCursorWhere(cursor) {
  if (!cursor) return '';
  const name = `'${soql(cursor.name)}'`;
  return `(Name > ${name} OR (Name = ${name} AND Id > '${soql(cursor.id)}'))`;
}

async function loadDirectoryAccountChains(accounts, accountFields) {
  const known = new Map(accounts.map((account) => [idKey(account.Id), account]));
  let parentIds = unique(accounts.map((account) => account.ParentId)).filter((id) => !known.has(idKey(id)));
  for (let depth = 0; depth < MAX_GROUP_DEPTH && parentIds.length; depth += 1) {
    const parents = [];
    for (const ids of chunkIds(parentIds)) {
      const result = await queryAll(`SELECT ${accountSelectFields(accountFields).join(',')} FROM Account WHERE Id IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT 50000`, 50_000);
      parents.push(...result.records);
    }
    for (const parent of parents) known.set(idKey(parent.Id), parent);
    parentIds = unique(parents.map((parent) => parent.ParentId)).filter((id) => !known.has(idKey(id)));
  }
  if (parentIds.length) throw serviceError('The Salesforce GROUP hierarchy exceeds 20 levels.', 503, 'ACCOUNT_CREDIT_GROUP_DEPTH');
  return new Map(accounts.map((account) => {
    const chain = [];
    const seen = new Set();
    let current = account;
    while (current) {
      const key = idKey(current.Id);
      if (!key || seen.has(key)) throw serviceError('Salesforce Account hierarchy contains a cycle.', 503, 'ACCOUNT_CREDIT_GROUP_CYCLE');
      seen.add(key);
      chain.push(current);
      current = current.ParentId ? known.get(idKey(current.ParentId)) : null;
      if (!current && chain.at(-1)?.ParentId) throw serviceError('A parent Account in the Salesforce GROUP hierarchy is unavailable.', 503, 'ACCOUNT_CREDIT_GROUP_INCOMPLETE');
    }
    return [idKey(account.Id), chain];
  }));
}

export async function loadDashboardAccountCreditDirectory({ body = {}, accessContext, force = false }) {
  if (['both', 'buyer', 'supplier'].includes(body.direction) || body.role === 'both') {
    return loadDashboardUnifiedCreditDirectory({ body, accessContext, force });
  }
  if (body.role === 'supplier') return loadDashboardSupplierCreditDirectory({ body, accessContext, force });
  const startedAt = Date.now();
  const query = text(body.query).slice(0, 100);
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const filters = directoryFilters(body.filters);
  const cursor = decodeAccountCreditCursor(body.cursor);
  if (body.cursor && cursor?.kind !== 'directory') throw serviceError('Account Statement directory cursor is invalid.', 400, 'ACCOUNT_CREDIT_CURSOR_INVALID');
  const interoffice = accessContext?.profile?.user_type === 'interoffice';
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-account-credit-directory',
    version: '5',
    accessScope: interoffice ? 'interoffice' : 'standard',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { query, limit, cursor, filters },
    ttlSeconds: 60,
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:stem', 'salesforce:account-credit'],
    force,
    loader: async () => {
      const [accountDescribe, stemDescribe, portDescribe] = await Promise.all([
        describeObject('Account', force),
        describeObject('STEM__c', force),
        filters.countryCodes.length ? describeObject('Port__c', force) : Promise.resolve(null),
      ]);
      const accountFields = fieldMap(accountDescribe);
      const stemFields = fieldMap(stemDescribe);
      const portFields = fieldMap(portDescribe);
      requireFields(accountFields, ['Id', 'Name', 'Inactive_Suspended__c'], 'Account');
      requireFields(stemFields, ['Account__c', 'QLIK_Receivable_Balance__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c'], 'STEM__c');
      const conditions = ['Inactive_Suspended__c = false', 'Id IN (SELECT Account__c FROM STEM__c WHERE Account__c != null)'];
      if (filters.accountIds.length) conditions.push(`Id IN (${filters.accountIds.map((id) => `'${soql(id)}'`).join(',')})`);
      let locationPortIds = [...filters.portIds];
      if (filters.countryCodes.length) {
        requireFields(portFields, ['Id', 'Country__c'], 'Port__c');
        const ports = await queryAll(`SELECT Id FROM Port__c WHERE Country__c IN (${filters.countryCodes.map((country) => `'${soql(country)}'`).join(',')}) LIMIT 50000`, 50_000);
        locationPortIds = unique([...locationPortIds, ...ports.records.map((port) => port.Id)]);
      }
      if (filters.portIds.length || filters.countryCodes.length) {
        requireFields(stemFields, ['Port__c'], 'STEM__c');
        conditions.push(locationPortIds.length
          ? `Id IN (SELECT Account__c FROM STEM__c WHERE Account__c != null AND Port__c IN (${locationPortIds.map((id) => `'${soql(id)}'`).join(',')}))`
          : 'Id = null');
      }
      if (query) {
        const escaped = `%${soql(query)}%`;
        const searchable = [`Name LIKE '${escaped}'`];
        if (accountFields.has('Company_Code__c')) searchable.push(`Company_Code__c LIKE '${escaped}'`);
        conditions.push(`(${searchable.join(' OR ')})`);
      }
      const cursorWhere = directoryCursorWhere(cursor);
      if (cursorWhere) conditions.push(cursorWhere);
      if (interoffice) conditions.push(interofficeAccountCondition(accountFields));
      const where = conditions.map((condition) => `(${condition})`).join(' AND ');
      const fields = accountSelectFields(accountFields);
      const accountsResult = await queryAll(`SELECT ${fields.join(',')} FROM Account WHERE ${where} ORDER BY Name,Id LIMIT ${limit + 1}`, limit + 1);
      const hasMore = accountsResult.records.length > limit;
      let accounts = accountsResult.records.slice(0, limit);
      const chains = await loadDirectoryAccountChains(accounts, accountFields);
      if (interoffice) {
        accounts = accounts.filter((account) => !chains.get(idKey(account.Id))
          ?.some((ancestor) => [ancestor.Name, ancestor.Group_Name__c].some((name) => text(name).toUpperCase() === INTEROFFICE_EXCLUDED_GROUP)));
      }
      const accountIds = accounts.map((account) => account.Id);
      const aggregates = accountIds.length
        ? await queryAll(`SELECT Account__c accountId,COUNT(Id) openStemCount,SUM(QLIK_Receivable_Balance__c) openExposure FROM STEM__c WHERE Account__c IN (${accountIds.map((id) => `'${soql(id)}'`).join(',')}) AND QLIK_Receivable_Balance__c != 0 AND ${creditExposureDeliveryWhere()} GROUP BY Account__c`)
        : { records: [] };
      const exposureByAccount = new Map((aggregates.records || []).map((row) => [idKey(row.accountId ?? row.Account__c), {
        openStemCount: Number(row.openStemCount || 0),
        openExposure: number(row.openExposure),
      }]));
      return {
        accounts: accounts.map((account) => {
          const exposure = exposureByAccount.get(idKey(account.Id)) || { openStemCount: 0, openExposure: 0 };
          const group = selectUltimateCreditGroup(chains.get(idKey(account.Id)) || []);
          return {
            accountId: account.Id,
            name: account.Name,
            clKey: account.Company_Code__c || null,
            groupName: group?.Name || account.Group_Name__c || null,
            category: account.CL_Category__c || null,
            openStemCount: exposure.openStemCount,
            openExposure: exposure.openExposure,
            hasOpenCredit: Math.abs(Number(exposure.openExposure || 0)) > 0.01,
            availableCredit: number(account.CL_Available_Credit__c),
            currency: account.CurrencyIsoCode || SALESFORCE_CORPORATE_CURRENCY,
          };
        }),
        nextCursor: hasMore && accounts.length ? encodeAccountCreditCursor({ kind: 'directory', name: accounts.at(-1).Name, id: accounts.at(-1).Id }) : null,
      };
    },
  });
  return {
    ...cached.value,
    meta: {
      redacted: true,
      cache: cached.cache?.status || null,
      elapsedMs: Date.now() - startedAt,
      returnedCount: cached.value.accounts?.length || 0,
    },
  };
}

async function loadAccountChain(accountId, fields) {
  const select = accountSelectFields(fields);
  const chain = [];
  let currentId = accountId;
  const seen = new Set();
  for (let depth = 0; depth < MAX_GROUP_DEPTH && currentId; depth += 1) {
    const key = idKey(currentId);
    if (!key || seen.has(key)) throw serviceError('Salesforce Account hierarchy contains a cycle.', 503, 'ACCOUNT_CREDIT_GROUP_CYCLE');
    seen.add(key);
    const result = await queryAll(`SELECT ${select.join(',')} FROM Account WHERE Id = '${soql(currentId)}' LIMIT 1`, 1);
    const account = result.records[0];
    if (!account) {
      if (!chain.length) throw serviceError('The Salesforce Account no longer exists.', 404, 'ACCOUNT_CREDIT_ACCOUNT_NOT_FOUND');
      throw serviceError('A parent Account in the Salesforce GROUP hierarchy is unavailable.', 503, 'ACCOUNT_CREDIT_GROUP_INCOMPLETE');
    }
    chain.push(account);
    currentId = account.ParentId;
  }
  if (currentId) throw serviceError('The Salesforce GROUP hierarchy exceeds 20 levels.', 503, 'ACCOUNT_CREDIT_GROUP_DEPTH');
  return chain;
}

async function loadGroupMembers(group, fields) {
  if (!group) return [];
  const select = accountSelectFields(fields);
  const members = [group];
  const seen = new Set([idKey(group.Id)]);
  let parentIds = [group.Id];
  for (let depth = 0; depth < MAX_GROUP_DEPTH && parentIds.length; depth += 1) {
    const next = [];
    for (const ids of chunkIds(parentIds)) {
      const result = await queryAll(`SELECT ${select.join(',')} FROM Account WHERE ParentId IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) AND Inactive_Suspended__c = false LIMIT 50000`, 50_000);
      for (const account of result.records) {
        const key = idKey(account.Id);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        members.push(account);
        next.push(account.Id);
      }
    }
    parentIds = next;
  }
  if (parentIds.length) throw serviceError('The Salesforce GROUP hierarchy exceeds 20 levels.', 503, 'ACCOUNT_CREDIT_GROUP_DEPTH');
  return members;
}

async function loadSameNameCreditCandidates(account, accountFields, interoffice) {
  const normalizedName = normalizeCreditAccountName(account?.Name);
  const namePattern = text(account?.Name).split(/\s+/).filter(Boolean).map((token) => token.replace(/[%_]/g, '\\$&')).join('%');
  if (!normalizedName || !namePattern) return { candidates: [], groupsByAccountId: {} };
  const result = await queryAll(`SELECT ${accountSelectFields(accountFields).join(',')} FROM Account WHERE Name LIKE '${soql(namePattern)}' ORDER BY CreatedDate,Id LIMIT 201`, 201);
  if (result.records.length > 200) throw serviceError('Same-name credit snapshot resolution is too broad to complete safely.', 503, 'ACCOUNT_CREDIT_DUPLICATE_SCOPE');
  const candidates = result.records.filter((candidate) => normalizeCreditAccountName(candidate.Name) === normalizedName);
  const chains = await loadDirectoryAccountChains(candidates, accountFields);
  const groupsByAccountId = {};
  for (const candidate of candidates) {
    const chain = chains.get(idKey(candidate.Id)) || [];
    ensureInterofficeAccountAccess(candidate, chain, interoffice);
    groupsByAccountId[idKey(candidate.Id)] = selectUltimateCreditGroup(chain);
  }
  return { candidates, groupsByAccountId };
}

function creditScopeReconciles({ account, group, openStems, complete }) {
  const snapshot = accountCreditSnapshot(account);
  const selectedId = idKey(account?.Id);
  const accountExposure = openStems
    .filter((stem) => idKey(stem.Account__c) === selectedId)
    .reduce((sum, stem) => sum + Number(stem.QLIK_Receivable_Balance__c || 0), 0);
  const groupExposure = openStems.reduce((sum, stem) => sum + Number(stem.QLIK_Receivable_Balance__c || 0), 0);
  const currencies = new Set(openStems.map((stem) => text(stem.CurrencyIsoCode)).filter(Boolean));
  const projectionComplete = complete && currencies.size <= 1;
  const individual = reconcileCreditExposure(snapshot.usedCustomer, accountExposure, { complete: projectionComplete });
  const groupResult = group
    ? reconcileCreditExposure(snapshot.usedGroup, groupExposure, { complete: projectionComplete })
    : { matches: true, notApplicable: true };
  return { matches: individual.matches && groupResult.matches, individual, group: groupResult };
}

function stemSelectFields(fields) {
  const result = selected(fields, [
    'Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'Account__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c',
    'Expected_Delivery_Date_Payment_Term__c', 'Payment_Term__c', 'Payment_Term_Number__c', 'Invoice_Due_Date__c',
    'QLIK_Invoice_Due_Date__c', 'Due_Date__c', 'Due_Date_Override__c', 'Not_Cancelled_STEM_Line_Item_Quantity__c',
    'Payment_Date__c', 'Invoice_Status__c', 'Total_Invoice_Amount__c',
    'QLIK_Receivable_Balance__c', 'CurrencyIsoCode',
  ]);
  if (fields.has('Account__c')) result.push('Account__r.Name');
  return [...new Set(result)];
}

async function queryStemsForAccountIds(accountIds, stemFields, extraWhere = '', limit = MAX_GROUP_OPEN_STEMS + 1) {
  const rows = [];
  for (const ids of chunkIds(accountIds)) {
    const where = [`Account__c IN (${ids.map((id) => `'${soql(id)}'`).join(',')})`, extraWhere].filter(Boolean).join(' AND ');
    const result = await queryAll(`SELECT ${stemSelectFields(stemFields).join(',')} FROM STEM__c WHERE ${where} ORDER BY CreatedDate DESC,Id DESC LIMIT ${limit}`, limit);
    rows.push(...result.records);
    if (rows.length > MAX_GROUP_OPEN_STEMS) break;
  }
  return rows;
}

function paymentConfiguration(fields) {
  const amountField = firstAvailable(fields, ['Amount__c', 'Payment_Amount__c', 'Paid_Amount__c', 'Received_Amount__c', 'Total_Amount__c', 'Amount_Paid__c', 'Payment_Value__c', 'Actual_Amount__c']);
  const dateField = firstAvailable(fields, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const supplierInvoiceFields = [...fields.values()].filter((field) => field.type === 'reference' && field.referenceTo?.includes('Supplier_Invoice__c')).map((field) => field.name);
  return { amountField, dateField, supplierInvoiceFields, statusFields: selected(fields, ['Status__c', 'Payment_Status__c']) };
}

function paymentSelectFields(fields, config) {
  return [...new Set(['Id', 'STEM__c', 'Account__c', 'Name', 'CreatedDate', 'CurrencyIsoCode', config.amountField, config.dateField, ...config.supplierInvoiceFields, ...config.statusFields].filter((field) => field && fields.has(field)))];
}

function nonVoidedPayment(payment, statusFields) {
  return !statusFields.some((field) => /void|cancel|revers|reject/i.test(text(payment[field])));
}

function validBuyerPayment(payment, config, accountByStem) {
  if (!payment.STEM__c || !nonVoidedPayment(payment, config.statusFields)) return false;
  if (config.supplierInvoiceFields.some((field) => payment[field])) return false;
  if (idKey(payment.Account__c) !== idKey(accountByStem.get(idKey(payment.STEM__c)))) return false;
  return Number(payment[config.amountField]) > 0 && Boolean(payment[config.dateField] || payment.CreatedDate);
}

async function queryPayments(stems, fields, config) {
  if (!stems.length) return { rows: [], complete: true };
  const select = paymentSelectFields(fields, config);
  const rows = [];
  let complete = true;
  for (const ids of chunkIds(stems.map((stem) => stem.Id))) {
    const result = await queryAll(`SELECT ${select.join(',')} FROM Payment__c WHERE STEM__c IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_EVIDENCE_ROWS + 1}`, MAX_EVIDENCE_ROWS + 1);
    rows.push(...result.records);
    if (result.records.length > MAX_EVIDENCE_ROWS || rows.length > MAX_EVIDENCE_ROWS) complete = false;
  }
  const accountByStem = new Map(stems.map((stem) => [idKey(stem.Id), stem.Account__c]));
  return { rows: rows.slice(0, MAX_EVIDENCE_ROWS).filter((payment) => validBuyerPayment(payment, config, accountByStem)), complete };
}

async function queryRecentPaymentStemIds(accountIds, since, fields, config) {
  if (!accountIds.length) return { rows: [], complete: true };
  const select = paymentSelectFields(fields, config);
  const conditions = [`Account__c IN (${accountIds.map((accountId) => `'${soql(accountId)}'`).join(',')})`];
  if (config.dateField === 'CreatedDate') conditions.push(`CreatedDate >= ${since}T00:00:00Z`);
  else conditions.push(`${config.dateField} >= ${since}`);
  for (const field of config.supplierInvoiceFields) conditions.push(`${field} = null`);
  const result = await queryAll(`SELECT ${select.join(',')} FROM Payment__c WHERE ${conditions.join(' AND ')} ORDER BY ${config.dateField} DESC NULLS LAST LIMIT ${MAX_EVIDENCE_ROWS + 1}`, MAX_EVIDENCE_ROWS + 1);
  return {
    rows: result.records.slice(0, MAX_EVIDENCE_ROWS).filter((payment) => nonVoidedPayment(payment, config.statusFields)),
    complete: result.records.length <= MAX_EVIDENCE_ROWS,
  };
}

function cashflowSelectFields(fields) {
  const result = selected(fields, [
    'Id', 'STEM__c', 'Account__c', 'RecordTypeId', 'Scheduled_Payment_Amount__c', 'Scheduled_Payment_Date__c',
    'Payment_Amount__c', 'Payment_Date__c', 'Invoice_Amount__c', 'Invoice_Due_Date__c', 'Received_Paid_Amount__c',
    'Received_Paid_Date__c', 'Receivable_Payable_Balance_Amount__c', 'Payable_Receivable__c', 'CurrencyIsoCode',
  ]);
  if (fields.has('RecordTypeId')) result.push('RecordType.Name');
  return [...new Set(result)];
}

function buyerInvoiceSelectFields(fields) {
  return selected(fields, [
    'Id', 'Name', 'STEM__c', 'Amount__c', 'Invoice_Due_Date__c', 'Invoice_Date__c',
    'Proforma__c', 'Deprecated__c', 'LastModifiedDate',
  ]);
}

function finalBuyerInvoice(invoice) {
  return invoice?.Proforma__c !== true
    && invoice?.Deprecated__c !== true
    && !/-CN-/i.test(text(invoice?.Name));
}

function expectedInvoiceLineItemSelectFields(fields) {
  const result = selected(fields, [
    'Id', 'STEM__c', 'Cancelled__c', 'Quantity__c', 'Quantity_Max__c', 'Quantity_Delivered_Per_BDN__c', 'Is_Quantity_Range__c',
    'Price_Per_Unit__c', 'Unit_Sell_At__c',
  ]);
  const offerLookup = fields.get('Offer_Line_Item__c');
  if (offerLookup?.relationshipName) result.push(`${offerLookup.relationshipName}.UnitPrice`);
  return [...new Set(result)];
}

function expectedInvoiceExtraCostSelectFields(fields) {
  return selected(fields, [
    'Id', 'STEM__c', 'Cancelled__c', 'Quantity__c', 'Quantity_Range_Max__c', 'Quantity_Delivered_Per_BDN__c', 'Is_Quantity_Range__c',
    'Unit_Price__c', 'Line_Total__c', 'Fixed__c', 'Lumpsum_Price__c', 'Minimum_Sell_At__c',
  ]);
}

function validateExpectedInvoiceSchema(lineFields, extraCostFields) {
  requireFields(lineFields, ['Id', 'STEM__c', 'Cancelled__c', 'Quantity__c', 'Quantity_Max__c', 'Quantity_Delivered_Per_BDN__c', 'Is_Quantity_Range__c'], 'STEM Line Item');
  if (!['Price_Per_Unit__c', 'Unit_Sell_At__c', 'Offer_Line_Item__c'].some((field) => lineFields.has(field))) {
    throw serviceError('STEM Line Item does not expose a buyer sell unit price for expected invoice calculations.', 503, 'ACCOUNT_CREDIT_SCHEMA');
  }
  requireFields(extraCostFields, [
    'Id', 'STEM__c', 'Cancelled__c', 'Quantity__c', 'Quantity_Range_Max__c', 'Quantity_Delivered_Per_BDN__c', 'Is_Quantity_Range__c',
    'Unit_Price__c', 'Line_Total__c',
  ], 'STEM Extra Cost');
}

async function queryExpectedInvoiceChildRows(stems, fields, objectName, selectFields) {
  if (!stems.length) return { rows: [], complete: true };
  const rows = [];
  let complete = true;
  for (const ids of chunkIds(stems.map((stem) => stem.Id))) {
    const result = await queryAll(`SELECT ${selectFields(fields).join(',')} FROM ${objectName} WHERE STEM__c IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) AND Cancelled__c = false LIMIT ${MAX_EVIDENCE_ROWS + 1}`, MAX_EVIDENCE_ROWS + 1);
    rows.push(...result.records);
    if (result.totalSize > MAX_EVIDENCE_ROWS || rows.length > MAX_EVIDENCE_ROWS) complete = false;
  }
  return { rows: rows.slice(0, MAX_EVIDENCE_ROWS), complete };
}

async function queryExpectedInvoiceEvidence(stems, lineFields, extraCostFields) {
  if (!stems.length) return { lineItems: [], extraCosts: [], complete: true };
  validateExpectedInvoiceSchema(lineFields, extraCostFields);
  const [lineItems, extraCosts] = await Promise.all([
    queryExpectedInvoiceChildRows(stems, lineFields, 'STEM_Line_Item__c', expectedInvoiceLineItemSelectFields),
    queryExpectedInvoiceChildRows(stems, extraCostFields, 'STEM_Extra_Cost__c', expectedInvoiceExtraCostSelectFields),
  ]);
  return {
    lineItems: lineItems.rows,
    extraCosts: extraCosts.rows,
    complete: lineItems.complete && extraCosts.complete,
  };
}

async function queryBuyerInvoices(stems, fields) {
  if (!stems.length) return { rows: [], complete: true };
  const select = buyerInvoiceSelectFields(fields);
  const rows = [];
  let complete = true;
  for (const ids of chunkIds(stems.map((stem) => stem.Id))) {
    const result = await queryAll(`SELECT ${select.join(',')} FROM Invoice__c WHERE STEM__c IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) AND Proforma__c = false AND Deprecated__c = false LIMIT ${MAX_EVIDENCE_ROWS}`, MAX_EVIDENCE_ROWS);
    rows.push(...result.records);
    if (result.records.length >= MAX_EVIDENCE_ROWS || rows.length > MAX_EVIDENCE_ROWS) complete = false;
  }
  return { rows: rows.slice(0, MAX_EVIDENCE_ROWS).filter(finalBuyerInvoice), complete };
}

async function queryCashflows(stems, fields) {
  if (!stems.length) return { rows: [], complete: true };
  const select = cashflowSelectFields(fields);
  const accountByStem = new Map(stems.map((stem) => [idKey(stem.Id), stem.Account__c]));
  const rows = [];
  let complete = true;
  for (const ids of chunkIds(stems.map((stem) => stem.Id))) {
    const result = await queryAll(`SELECT ${select.join(',')} FROM Cashflow__c WHERE STEM__c IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_EVIDENCE_ROWS + 1}`, MAX_EVIDENCE_ROWS + 1);
    rows.push(...result.records);
    if (result.records.length > MAX_EVIDENCE_ROWS || rows.length > MAX_EVIDENCE_ROWS) complete = false;
  }
  return {
    rows: rows.slice(0, MAX_EVIDENCE_ROWS).filter((row) => idKey(row.Account__c) === idKey(accountByStem.get(idKey(row.STEM__c))) && (!row.RecordType?.Name || /^Buyer\b/i.test(row.RecordType.Name))),
    complete,
  };
}

function indexByStem(rows, serializer = (row) => row) {
  const result = {};
  for (const row of rows) {
    const stemId = row.STEM__c;
    if (!stemId) continue;
    if (!result[stemId]) result[stemId] = [];
    result[stemId].push(serializer(row));
  }
  return result;
}

function serializePayment(row, config) {
  return {
    paymentId: row.Id,
    paymentName: row.Name || null,
    paymentDate: row[config.dateField] || row.CreatedDate || null,
    amount: number(row[config.amountField]),
    currency: row.CurrencyIsoCode || null,
  };
}

function paymentPerformanceStemSelectFields(stemFields, accountFields) {
  const result = stemSelectFields(stemFields);
  if (stemFields.has('Account__c')) {
    if (accountFields.has('ParentId')) result.push('Account__r.ParentId');
    if (accountFields.has('ParentId')) result.push('Account__r.Parent.Name');
    if (accountFields.has('Group_Name__c')) result.push('Account__r.Group_Name__c');
  }
  return [...new Set(result)];
}

async function queryStemsByIds(stemIds, stemFields, accountFields) {
  const rows = [];
  const select = paymentPerformanceStemSelectFields(stemFields, accountFields);
  for (const ids of chunkIds(stemIds)) {
    const result = await queryAll(`SELECT ${select.join(',')} FROM STEM__c WHERE Id IN (${ids.map((id) => `'${soql(id)}'`).join(',')}) LIMIT ${MAX_EVIDENCE_ROWS + 1}`, MAX_EVIDENCE_ROWS + 1);
    rows.push(...result.records);
    if (rows.length > MAX_EVIDENCE_ROWS) break;
  }
  return rows.slice(0, MAX_EVIDENCE_ROWS);
}

async function queryBuyerPaymentPerformanceSamples({
  since,
  scopedAccountIds = null,
  paymentFields,
  paymentConfig,
  stemFields,
  accountFields,
  currentGroup = null,
  currentGroupMembers = [],
}) {
  const select = paymentSelectFields(paymentFields, paymentConfig);
  const dateWhere = paymentConfig.dateField === 'CreatedDate'
    ? `CreatedDate >= ${since}T00:00:00Z`
    : `${paymentConfig.dateField} >= ${since}`;
  const conditions = [dateWhere];
  if (Array.isArray(scopedAccountIds) && scopedAccountIds.length) {
    conditions.push(`Account__c IN (${scopedAccountIds.map((id) => `'${soql(id)}'`).join(',')})`);
  }
  for (const field of paymentConfig.supplierInvoiceFields) conditions.push(`${field} = null`);
  const result = await queryAll(`SELECT ${select.join(',')} FROM Payment__c WHERE ${conditions.join(' AND ')} ORDER BY ${paymentConfig.dateField} DESC NULLS LAST LIMIT ${MAX_EVIDENCE_ROWS + 1}`, MAX_EVIDENCE_ROWS + 1);
  const candidatePayments = result.records.slice(0, MAX_EVIDENCE_ROWS).filter((payment) => nonVoidedPayment(payment, paymentConfig.statusFields));
  const stems = await queryStemsByIds(unique(candidatePayments.map((payment) => payment.STEM__c)), stemFields, accountFields);
  const stemById = new Map(stems.map((stem) => [idKey(stem.Id), stem]));
  const accountByStem = new Map(stems.map((stem) => [idKey(stem.Id), stem.Account__c]));
  const currentGroupMemberIds = new Set(currentGroupMembers.map((member) => idKey(member.Id)));
  const samples = [];
  for (const payment of candidatePayments) {
    const stem = stemById.get(idKey(payment.STEM__c));
    if (!stem || !validBuyerPayment(payment, paymentConfig, accountByStem) || !isCreditExposureStemEligible(stem)) continue;
    const paymentText = [payment.Name, ...paymentConfig.statusFields.map((field) => payment[field])].filter(Boolean).join(' ');
    if (/(bank\s*charge|broker|commission|payable|supplier)/i.test(paymentText)) continue;
    const dueDate = resolvedBuyerInvoiceDueDate(stem);
    const paymentDate = String(payment[paymentConfig.dateField] || payment.CreatedDate || '').slice(0, 10);
    const delayDays = daysBetween(dueDate, paymentDate);
    if (!dueDate || !paymentDate || delayDays == null) continue;
    const exactCurrentGroup = currentGroup && currentGroupMemberIds.has(idKey(stem.Account__c));
    samples.push({
      paymentId: payment.Id,
      stemId: stem.Id,
      buyerAccountId: stem.Account__c,
      buyerName: stem.Account__r?.Name || null,
      buyerGroupId: exactCurrentGroup ? currentGroup.Id : stem.Account__r?.ParentId || null,
      buyerGroupName: exactCurrentGroup ? currentGroup.Name : stem.Account__r?.Group_Name__c || stem.Account__r?.Parent?.Name || null,
      dueDate: String(dueDate).slice(0, 10),
      paymentDate,
      delayDays,
      amount: number(payment[paymentConfig.amountField]),
    });
  }
  return { samples, complete: result.records.length <= MAX_EVIDENCE_ROWS && stems.length <= MAX_EVIDENCE_ROWS };
}

async function loadBuyerPaymentPerformanceModels({
  settings,
  paymentFields,
  paymentConfig,
  stemFields,
  accountFields,
  currentGroup,
  currentGroupMembers,
  interoffice,
  today,
  force,
}) {
  const lookbackMonths = Math.max(1, Math.min(Number(settings.lookbackMonths) || 12, 36));
  const since = [addCalendarDays(today, -lookbackMonths * 31), CREDIT_EXPOSURE_DELIVERY_START].sort().at(-1);
  const scopedAccountIds = interoffice ? currentGroupMembers.map((member) => member.Id) : null;
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-buyer-payment-performance-samples',
    version: '1',
    accessScope: interoffice ? `interoffice:${scopedAccountIds.map(idKey).sort().join(',')}` : 'standard',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { since, lookbackMonths, currentGroupId: idKey(currentGroup?.Id) || null },
    ttlSeconds: 60,
    tags: ['salesforce:account-credit', 'salesforce:payment', 'salesforce:stem', 'salesforce:cashflow'],
    force,
    loader: () => queryBuyerPaymentPerformanceSamples({
      since,
      scopedAccountIds,
      paymentFields,
      paymentConfig,
      stemFields,
      accountFields,
      currentGroup,
      currentGroupMembers,
    }),
  });
  return {
    models: buildBuyerPaymentDelayModels(cached.value.samples, settings, { today }),
    sampleCount: cached.value.samples.length,
    complete: cached.value.complete,
  };
}

function mergeStems(rows) {
  const values = new Map();
  for (const row of rows) if (row?.Id) values.set(idKey(row.Id), row);
  return [...values.values()].sort(compareStatementStems);
}

function statementDeliveryDate(stem) {
  return text(stem?.Delivery_Date__c || stem?.Expected_Delivery_Date__c).slice(0, 10);
}

function compareStatementStems(left, right) {
  const leftDelivery = statementDeliveryDate(left);
  const rightDelivery = statementDeliveryDate(right);
  if (leftDelivery && rightDelivery && leftDelivery !== rightDelivery) return rightDelivery.localeCompare(leftDelivery);
  if (leftDelivery && !rightDelivery) return -1;
  if (!leftDelivery && rightDelivery) return 1;
  return String(right.CreatedDate || '').localeCompare(String(left.CreatedDate || '')) || String(right.Id).localeCompare(String(left.Id));
}

async function statementRows({ accountIds = null, accountId = null, scope, cursor, limit, openStems, recentPayments, stemFields }) {
  const scopedAccountIds = Array.isArray(accountIds) ? accountIds : [accountId].filter(Boolean);
  if (!scopedAccountIds.length) return { rows: [], total: 0, nextCursor: null };
  const accountIdSet = new Set(scopedAccountIds.map(idKey));
  if (scope === 'all') {
    if (cursor && (cursor.kind !== 'statement' || cursor.scope !== scope)) throw serviceError('Account Statement cursor does not match the selected scope.', 400, 'ACCOUNT_CREDIT_CURSOR_INVALID');
    const result = await queryAll(`SELECT ${stemSelectFields(stemFields).join(',')} FROM STEM__c WHERE Account__c IN (${scopedAccountIds.map((scopedAccountId) => `'${soql(scopedAccountId)}'`).join(',')}) AND ${creditExposureDeliveryWhere()} LIMIT ${MAX_GROUP_OPEN_STEMS + 1}`, MAX_GROUP_OPEN_STEMS + 1);
    if (result.records.length > MAX_GROUP_OPEN_STEMS) throw serviceError('The Account Statement exceeds the supported delivery-sorted history scope. Narrow the statement filter.', 503, 'ACCOUNT_CREDIT_STATEMENT_LIMIT');
    const sorted = mergeStems(result.records).filter((stem) => isCreditExposureStemEligible(stem));
    const offset = cursor?.offset || 0;
    const rows = sorted.slice(offset, offset + limit);
    return {
      rows,
      total: sorted.length,
      nextCursor: offset + rows.length < sorted.length ? encodeAccountCreditCursor({ kind: 'statement', scope, offset: offset + rows.length }) : null,
    };
  }
  if (cursor && (cursor.kind !== 'statement' || cursor.scope !== scope)) throw serviceError('Account Statement cursor does not match the selected scope.', 400, 'ACCOUNT_CREDIT_CURSOR_INVALID');
  const selectedOpen = openStems.filter((stem) => accountIdSet.has(idKey(stem.Account__c)) && isCreditExposureStemEligible(stem));
  let rows = selectedOpen;
  if (scope === 'open_recent') {
    const recentStemIds = unique(recentPayments.map((payment) => payment.STEM__c).filter((id) => SALESFORCE_ID.test(text(id))));
    const recentStems = recentStemIds.length ? await queryStemsForAccountIds(scopedAccountIds, stemFields, `Id IN (${recentStemIds.map((id) => `'${soql(id)}'`).join(',')}) AND ${creditExposureDeliveryWhere()}`, 50_000) : [];
    rows = mergeStems([...selectedOpen, ...recentStems]).filter((stem) => isCreditExposureStemEligible(stem));
  } else rows = mergeStems(selectedOpen);
  const offset = cursor?.offset || 0;
  const page = rows.slice(offset, offset + limit);
  return {
    rows: page,
    total: rows.length,
    nextCursor: offset + page.length < rows.length ? encodeAccountCreditCursor({ kind: 'statement', scope, offset: offset + page.length }) : null,
  };
}

async function loadAccountCreditStatementUncached({ body, accessContext, force }) {
  const startedAt = Date.now();
  const timings = {};
  const accountId = salesforceId(body.accountId);
  const entityType = body.entityType === 'group' ? 'group' : 'account';
  const requestedAccountIds = normalizeRequestedGroupAccountIds(body.includedAccountIds);
  const scope = normalizeAccountCreditScope(body.scope);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const cursor = decodeAccountCreditCursor(body.cursor);
  if (body.cursor && !cursor) throw serviceError('Account Statement cursor is invalid.', 400, 'ACCOUNT_CREDIT_CURSOR_INVALID');
  const interoffice = accessContext?.profile?.user_type === 'interoffice';
  const today = hongKongToday();
  let stageStartedAt = Date.now();
  const [accountDescribe, stemDescribe, paymentDescribe, cashflowDescribe, buyerInvoiceDescribe, lineItemDescribe, extraCostDescribe] = await Promise.all([
    describeObject('Account', force),
    describeObject('STEM__c', force),
    describeObject('Payment__c', force),
    describeObject('Cashflow__c', force),
    describeObject('Invoice__c', force),
    describeObject('STEM_Line_Item__c', force),
    describeObject('STEM_Extra_Cost__c', force),
  ]);
  timings.schemaMs = Date.now() - stageStartedAt;
  const accountFields = fieldMap(accountDescribe);
  const stemFields = fieldMap(stemDescribe);
  const paymentFields = fieldMap(paymentDescribe);
  const cashflowFields = fieldMap(cashflowDescribe);
  const buyerInvoiceFields = fieldMap(buyerInvoiceDescribe);
  const lineItemFields = fieldMap(lineItemDescribe);
  const extraCostFields = fieldMap(extraCostDescribe);
  requireFields(accountFields, ['Id', 'Name', 'ParentId', 'Inactive_Suspended__c', 'CL_Category__c', 'CL_Group__c', 'CL_Individual__c', 'CL_Special_Group__c', 'CL_Special__c', 'CL_Used_Customer__c', 'CL_Used_Group__c', 'CL_Available_Credit__c'], 'Account');
  requireFields(stemFields, ['Id', 'Name', 'CreatedDate', 'Account__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'QLIK_Receivable_Balance__c'], 'STEM__c');
  requireFields(paymentFields, ['Id', 'STEM__c', 'Account__c'], 'Payment__c');
  requireFields(cashflowFields, ['Id', 'STEM__c', 'Account__c'], 'Cashflow__c');
  requireFields(buyerInvoiceFields, ['Id', 'Name', 'STEM__c', 'Amount__c', 'Invoice_Due_Date__c', 'Proforma__c', 'Deprecated__c'], 'Invoice__c');
  const paymentConfig = paymentConfiguration(paymentFields);
  if (!paymentConfig.amountField || !paymentConfig.dateField) throw serviceError('Payment__c does not expose an authoritative amount and date for credit releases.', 503, 'ACCOUNT_CREDIT_PAYMENT_SCHEMA');

  stageStartedAt = Date.now();
  const chain = await loadAccountChain(accountId, accountFields);
  const account = chain[0];
  if (account.Inactive_Suspended__c === true) throw serviceError('This Salesforce Account is inactive and is not available in FCOS.', 404, 'ACCOUNT_CREDIT_ACCOUNT_INACTIVE');
  const group = selectUltimateCreditGroup(chain);
  ensureInterofficeAccountAccess(account, chain, interoffice);
  const groupMembers = group ? await loadGroupMembers(group, accountFields) : [account];
  timings.hierarchyMs = Date.now() - stageStartedAt;
  if (!groupMembers.some((member) => idKey(member.Id) === idKey(account.Id))) groupMembers.push(account);
  const groupScope = resolveGroupAccountScope({ entityType, group, groupMembers, requestedAccountIds });
  const fullGroupAccountIds = unique(groupMembers.map((member) => member.Id));
  const groupAccountIds = entityType === 'group' ? groupScope.includedAccountIds : fullGroupAccountIds;
  const statementAccountIds = entityType === 'group' ? groupScope.includedAccountIds : [accountId];
  const companyConservativeness = normalizeBuyerPaymentConservativeness(body._forecastSettings?.creditStatementConservativeness);
  const requestedConservativeness = body.forecastConservativeness == null || body.forecastConservativeness === ''
    ? companyConservativeness
    : normalizeBuyerPaymentConservativeness(body.forecastConservativeness, null);
  if (!requestedConservativeness) {
    throw serviceError('Credit forecast conservativeness must be typical, cautious, or severe.', 400, 'ACCOUNT_CREDIT_FORECAST_INVALID');
  }
  const forecastSettings = {
    ...(body._forecastSettings || {}),
    companyConservativeness,
    effectiveConservativeness: requestedConservativeness,
    canManage: body._canManageForecastSettings === true,
  };
  stageStartedAt = Date.now();
  const [fullOpenStemsRaw, paymentPerformance] = await Promise.all([
    queryStemsForAccountIds(fullGroupAccountIds, stemFields, `QLIK_Receivable_Balance__c != 0 AND ${creditExposureDeliveryWhere()}`),
    loadBuyerPaymentPerformanceModels({
      settings: forecastSettings,
      paymentFields,
      paymentConfig,
      stemFields,
      accountFields,
      currentGroup: group,
      currentGroupMembers: groupMembers,
      interoffice,
      today,
      force,
    }),
  ]);
  const openStemScopeComplete = fullOpenStemsRaw.length <= MAX_GROUP_OPEN_STEMS;
  const fullOpenStems = fullOpenStemsRaw.slice(0, MAX_GROUP_OPEN_STEMS).filter((stem) => isCreditExposureStemEligible(stem));
  const selectedGroupAccountKeys = new Set(groupAccountIds.map(idKey));
  const openStems = fullOpenStems.filter((stem) => selectedGroupAccountKeys.has(idKey(stem.Account__c)));
  let creditAccount = account;
  let creditOpenStems = openStems;
  let creditResolution = null;
  if (entityType === 'group' && group) {
    const authority = resolveGroupCreditAuthority({
      group,
      members: groupMembers,
      openStems: fullOpenStems,
      complete: openStemScopeComplete,
    });
    if (authority.status === 'resolved') {
      creditAccount = authority.candidate;
      creditResolution = {
        mode: 'group_hierarchy_authority',
        accountId: authority.candidate.Id,
        accountName: authority.candidate.Name,
        clKey: authority.candidate.Company_Code__c || null,
        matchingSnapshotCount: authority.matchingAccountIds.length,
        reconciliationWindowStart: null,
        reconciliation: authority.reconciliation,
        notice: `Salesforce GROUP credit is held on ${authority.candidate.Name}${authority.candidate.Company_Code__c ? ` · ${authority.candidate.Company_Code__c}` : ''}. The GROUP limit and used-credit snapshot remain fixed while child Account selections change only the displayed exposure.`,
      };
    } else {
      creditResolution = {
        mode: authority.status === 'ambiguous' ? 'group_hierarchy_ambiguous' : 'group_hierarchy_unresolved',
        accountId: null,
        accountName: null,
        clKey: null,
        matchingSnapshotCount: authority.candidates?.length || 0,
        reconciliationWindowStart: null,
        reconciliation: null,
        notice: null,
      };
    }
  }
  const selectedReconciliation = creditScopeReconciles({ account, group, openStems: fullOpenStems, complete: openStemScopeComplete });
  if (entityType !== 'group' && !groupScope.partial && !selectedReconciliation.matches) {
    const duplicateScope = await loadSameNameCreditCandidates(account, accountFields, interoffice);
    const resolution = resolveCreditSnapshotCandidate({
      selectedAccount: account,
      selectedGroup: group,
      candidates: duplicateScope.candidates,
      candidateGroupsById: duplicateScope.groupsByAccountId,
      openStems: fullOpenStems,
      complete: openStemScopeComplete,
    });
    if (resolution.status === 'resolved') {
      creditAccount = resolution.candidate;
      creditOpenStems = resolution.windowStems;
      creditResolution = {
        mode: 'same_name_fallback',
        accountId: resolution.candidate.Id,
        clKey: resolution.candidate.Company_Code__c || null,
        reconciliationWindowStart: resolution.windowStart,
        notice: `Salesforce credit fields were reconciled from the unique same-name Account lineage snapshot ${resolution.candidate.Company_Code__c || 'without a CL Key'}, effective ${resolution.windowStart}. Historical nonzero balances outside that lineage window remain visible as evidence but are excluded from the current credit projection. Buyer-leg STEM membership remains restricted to the selected active Account ID.`,
      };
    } else {
      creditResolution = {
        mode: resolution.status === 'ambiguous' ? 'ambiguous' : 'unresolved',
        accountId: account.Id,
        clKey: account.Company_Code__c || null,
        reconciliationWindowStart: null,
        notice: null,
      };
    }
  }
  const recentPayments = scope === 'open_recent'
    ? await queryRecentPaymentStemIds(statementAccountIds, oneYearBefore(today), paymentFields, paymentConfig)
    : { rows: [], complete: true };
  const statement = await statementRows({ accountIds: statementAccountIds, scope, cursor, limit, openStems, recentPayments: recentPayments.rows, stemFields });
  timings.statementScopeMs = Date.now() - stageStartedAt;
  const relevantStems = mergeStems([...openStems, ...statement.rows]);
  stageStartedAt = Date.now();
  const [payments, cashflows, buyerInvoices] = await Promise.all([
    queryPayments(relevantStems, paymentFields, paymentConfig),
    queryCashflows(relevantStems, cashflowFields),
    queryBuyerInvoices(relevantStems, buyerInvoiceFields),
  ]);
  const complete = openStemScopeComplete && recentPayments.complete && payments.complete && cashflows.complete;
  const paymentsByStem = indexByStem(payments.rows, (row) => serializePayment(row, paymentConfig));
  const cashflowsByStem = indexByStem(cashflows.rows);
  const buyerInvoicesByStem = indexByStem(buyerInvoices.rows);
  timings.releaseEvidenceMs = Date.now() - stageStartedAt;
  stageStartedAt = Date.now();
  const notIssuedStems = buyerInvoices.complete
    ? relevantStems.filter((stem) => !(buyerInvoicesByStem[stem.Id] || []).length)
    : [];
  const expectedInvoiceEvidence = buyerInvoices.complete
    ? await queryExpectedInvoiceEvidence(notIssuedStems, lineItemFields, extraCostFields)
    : { lineItems: [], extraCosts: [], complete: false };
  const expectedInvoiceLineItemsByStem = indexByStem(expectedInvoiceEvidence.lineItems);
  const expectedInvoiceExtraCostsByStem = indexByStem(expectedInvoiceEvidence.extraCosts);
  timings.expectedInvoiceMs = Date.now() - stageStartedAt;
  const modelComplete = complete && paymentPerformance.complete;
  const model = buildAccountCreditStatement({
    account,
    creditAccount,
    creditResolution,
    group,
    groupMembers,
    groupScope: group ? { ...groupScope, operationalSubset: true } : groupScope,
    openStems: creditOpenStems,
    reconciliationOpenStems: fullOpenStems,
    statementStems: statement.rows,
    paymentsByStem,
    cashflowsByStem,
    buyerInvoicesByStem,
    buyerInvoiceScopeComplete: buyerInvoices.complete,
    expectedInvoiceLineItemsByStem,
    expectedInvoiceExtraCostsByStem,
    expectedInvoiceScopeComplete: expectedInvoiceEvidence.complete,
    paymentPerformanceModels: paymentPerformance.models,
    forecastSettings,
    blockedForecastDates: Array.isArray(body._blockedForecastDates) ? body._blockedForecastDates : [],
    today,
    complete: modelComplete,
  });
  return {
    ...model,
    groupScope: {
      selectable: groupScope.selectable,
      availableAccounts: groupScope.availableAccounts,
      includedAccountIds: groupScope.includedAccountIds,
      allSelected: groupScope.allSelected,
      partial: groupScope.partial,
    },
    scope,
    paymentDataReliability: paymentDataReliabilityMetadata(0),
    statement: {
      rows: model.rows,
      total: statement.total,
      nextCursor: statement.nextCursor,
      pageSize: limit,
    },
    meta: {
      redacted: true,
      elapsedMs: Date.now() - startedAt,
      groupMemberCount: groupMembers.length,
      openStemCount: openStems.length,
      statementRowCount: model.rows.length,
      complete: modelComplete,
      buyerInvoiceScopeComplete: buyerInvoices.complete,
      expectedInvoiceScopeComplete: expectedInvoiceEvidence.complete,
      paymentPerformanceSampleCount: paymentPerformance.sampleCount,
      paymentPerformanceComplete: paymentPerformance.complete,
      timings,
      salesforceFetchedAt: new Date().toISOString(),
    },
  };
}

function combinedExposurePoints(buyer, supplier, currencyCode, entityType) {
  const buyerPoints = Array.isArray(buyer?.chart?.points) ? buyer.chart.points : [];
  const supplierSeries = (supplier?.chart?.currencies || []).find((row) => row.currency === currencyCode);
  const supplierPoints = entityType === 'group' ? supplierSeries?.group?.points : supplierSeries?.account?.points;
  if (!buyerPoints.length || !Array.isArray(supplierPoints) || !supplierPoints.length) return [];
  const dates = [...new Set([...buyerPoints.map((row) => row.date), ...supplierPoints.map((row) => row.date)].filter(Boolean))].sort();
  let buyerValue = null; let supplierValue = null; let buyerEvents = []; let buyerIndex = 0; let supplierIndex = 0;
  return dates.map((date) => {
    while (buyerIndex < buyerPoints.length && buyerPoints[buyerIndex].date <= date) {
      buyerValue = entityType === 'group' ? buyerPoints[buyerIndex].groupExposure : buyerPoints[buyerIndex].individualExposure;
      buyerEvents = buyerPoints[buyerIndex].events || [];
      buyerIndex += 1;
    }
    while (supplierIndex < supplierPoints.length && supplierPoints[supplierIndex].date <= date) { supplierValue = supplierPoints[supplierIndex].remaining; supplierIndex += 1; }
    return buyerValue == null || supplierValue == null
      ? { date, buyer: buyerValue, supplier: supplierValue, net: null, buyerEvents }
      : { date, buyer: buyerValue, supplier: supplierValue, net: buyerValue - supplierValue, buyerEvents };
  });
}

export async function loadDashboardAccountCreditStatement({ body = {}, accessContext, force = false }) {
  const entityType = body.entityType === 'group' ? 'group' : 'account';
  const entityId = body.entityId || body.accountId;
  if (body.side === 'both') {
    const accountId = salesforceId(entityId);
    const [buyer, supplier] = await Promise.all([
      loadDashboardAccountCreditStatement({ body: { ...body, side: 'buyer', entityType, entityId: accountId, accountId }, accessContext, force }),
      loadDashboardSupplierCreditStatement({ body: { ...body, side: 'supplier', entityType, entityId: accountId, accountId, includeGroup: entityType === 'group' || body.includeGroup === true }, accessContext, force }),
    ]);
    const buyerByCurrency = new Map(Object.entries(buyer.exposureByCurrency || {}).map(([code, value]) => [code, Number((entityType === 'group' ? value.group : value.individual) ?? 0)]));
    const supplierByCurrency = new Map((supplier.chart?.currencies || []).map((row) => [row.currency, entityType === 'group' ? row.group?.opening : row.account?.opening]));
    const currencies = [...new Set([...buyerByCurrency.keys(), ...supplierByCurrency.keys()])].sort().map((code) => {
      const buyerOpening = buyerByCurrency.get(code) ?? 0;
      const supplierOpening = supplierByCurrency.get(code);
      const evidenceComplete = buyer.meta?.complete === true && supplier.meta?.complete === true && supplierOpening != null;
      const buyerChartMatchesCurrency = Array.isArray(buyer.currencies) && buyer.currencies.length === 1 && buyer.currencies[0] === code;
      return { currency: code, buyerOpening, supplierOpening: supplierOpening ?? null, netOpening: evidenceComplete ? buyerOpening - supplierOpening : null, points: evidenceComplete && buyerChartMatchesCurrency ? combinedExposurePoints(buyer, supplier, code, entityType) : [] };
    });
    return {
      side: 'both',
      identity: { accountId, entityType, name: buyer.identity?.name || supplier.identity?.name || accountId, clKey: buyer.identity?.clKey || supplier.identity?.clKey || null },
      roles: ['buyer', 'supplier'], buyer, supplier,
      forecastSettings: buyer.forecastSettings || null,
      creditResolution: buyer.creditResolution || null,
      groupScope: buyer.groupScope || supplier.groupScope || null,
      combined: { currencies, warning: currencies.every((row) => row.netOpening != null) ? null : 'Combined net exposure is suppressed where either buyer or supplier evidence is incomplete.' },
      complete: buyer.meta?.complete === true && supplier.meta?.complete === true,
      paymentDataReliability: {
        buyer: buyer.paymentDataReliability || paymentDataReliabilityMetadata(0),
        supplier: supplier.paymentDataReliability || paymentDataReliabilityMetadata(0),
      },
      meta: { redacted: true, cache: buyer.meta?.cache || supplier.meta?.cache || null },
    };
  }
  if (body.side === 'supplier') return loadDashboardSupplierCreditStatement({ body, accessContext, force });
  const accountId = salesforceId(entityId);
  const includedAccountIds = normalizeRequestedGroupAccountIds(body.includedAccountIds);
  const scope = normalizeAccountCreditScope(body.scope);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const interoffice = accessContext?.profile?.user_type === 'interoffice';
  const cache = await getOrLoadRuntimeCache({
    namespace: 'salesforce-dashboard-account-credit-statement',
    version: '15-payment-reliability',
    accessScope: interoffice ? 'interoffice' : 'standard',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: {
      accountId: idKey(accountId),
      entityType,
      includedAccountIds: includedAccountIds?.map(idKey).sort() || null,
      scope,
      cursor: body.cursor || null,
      limit,
      forecastConservativeness: normalizeBuyerPaymentConservativeness(body.forecastConservativeness || body._forecastSettings?.creditStatementConservativeness),
      forecastSettingsUpdatedAt: body._forecastSettings?.updatedAt || null,
      blockedForecastDates: Array.isArray(body._blockedForecastDates) ? body._blockedForecastDates : [],
    },
    ttlSeconds: 60,
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:group', 'salesforce:stem', 'salesforce:cashflow', 'salesforce:payment', 'salesforce:invoice', 'salesforce:account-credit', `salesforce:account:${idKey(accountId)}`],
    force,
    loader: () => loadAccountCreditStatementUncached({ body: { ...body, accountId, entityType, includedAccountIds, scope, limit }, accessContext, force }),
  });
  return {
    ...cache.value,
    meta: { ...cache.value.meta, cache: cache.cache?.status || null },
  };
}

export const dashboardAccountCreditStatementServiceInternals = {
  compareStatementStems,
  interofficeAccountCondition,
  paymentConfiguration,
  validBuyerPayment,
  finalBuyerInvoice,
  creditExposureDeliveryWhere,
  statementRows,
  resolveGroupAccountScope,
};
