import { createHash } from 'node:crypto';
import { getApiVersion, getInstanceUrl, sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';
import { expireRuntimeCacheTags, getOrLoadRuntimeCache } from './_runtimeCache.js';
import { buildUnofficialCompensationWorkspace, isSalesforceRecordId, unofficialCompensationAmount } from './_unofficialCompensation.js';

const COMPENSATION_OBJECTS = Object.freeze({
  account: 'Account',
  claim: 'Agreed_Compensation__c',
  recovery: 'Unofficial_Compensation__c',
  stem: 'STEM__c',
  line: 'STEM_Line_Item__c',
  extraCost: 'STEM_Extra_Cost__c',
  buyerBroker: 'STEM_Buyer_Broker__c',
  contact: 'Contact',
});

const OPERATION_TYPES = new Set(['claim_create', 'claim_group_status', 'recovery_create', 'recovery_delete', 'dispute_claim_link']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HK_TIME_ZONE = 'Asia/Hong_Kong';

function serviceError(message, status = 400, code = null, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function soql(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function soqlIds(values = []) {
  return [...new Set(values.map(text).filter(isSalesforceRecordId))].map((value) => `'${soql(value)}'`).join(',');
}

function objectFields(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

function selected(fieldMap, names) {
  return names.filter((name) => fieldMap.has(name));
}

function requireField(fieldMap, objectName, fieldName, { type, referenceTo, createable, updateable } = {}) {
  const field = fieldMap.get(fieldName);
  if (!field) throw serviceError(`Unofficial Compensation requires ${objectName}.${fieldName}.`, 503, 'COMPENSATION_SCHEMA_INVALID');
  if (type && field.type !== type) throw serviceError(`Unofficial Compensation requires ${objectName}.${fieldName} to be ${type}.`, 503, 'COMPENSATION_SCHEMA_INVALID');
  if (referenceTo && (!Array.isArray(field.referenceTo) || !field.referenceTo.includes(referenceTo))) {
    throw serviceError(`Unofficial Compensation requires ${objectName}.${fieldName} to reference ${referenceTo}.`, 503, 'COMPENSATION_SCHEMA_INVALID');
  }
  if (createable === true && field.createable !== true) throw serviceError(`Unofficial Compensation requires ${objectName}.${fieldName} to be createable.`, 503, 'COMPENSATION_SCHEMA_INVALID');
  if (updateable === true && field.updateable !== true) throw serviceError(`Unofficial Compensation requires ${objectName}.${fieldName} to be updateable.`, 503, 'COMPENSATION_SCHEMA_INVALID');
  return field;
}

function accountLookupFields(fieldMap, candidates) {
  return candidates.filter((fieldName) => {
    const field = fieldMap.get(fieldName);
    return field?.type === 'reference' && Array.isArray(field.referenceTo) && field.referenceTo.includes('Account');
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function operationHash(operationType, payload) {
  return createHash('sha256').update(stableJson({ operationType, payload })).digest('hex');
}

function todayInHongKong() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: HK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function cleanRecord(record) {
  if (!record || typeof record !== 'object') return record;
  if (Array.isArray(record)) return record.map(cleanRecord);
  const { attributes, ...rest } = record;
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, cleanRecord(value)]));
}

async function describeObject(objectName, force = false) {
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-compensation-describe',
    version: '1',
    accessScope: 'schema',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { objectName: objectName.toLowerCase() },
    ttlSeconds: 6 * 60 * 60,
    tags: ['salesforce:schema', 'salesforce:compensation:schema', `salesforce:schema:${objectName.toLowerCase()}`],
    force,
    loader: async () => {
      const data = await sfRequest(`/sobjects/${encodeURIComponent(objectName)}/describe/`);
      return {
        name: data.name,
        label: data.label,
        createable: data.createable === true,
        updateable: data.updateable === true,
        deletable: data.deletable === true,
        fields: (data.fields || []).map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          createable: field.createable === true,
          updateable: field.updateable === true,
          nillable: field.nillable === true,
          referenceTo: field.referenceTo || [],
          relationshipName: field.relationshipName || null,
          picklistValues: (field.picklistValues || []).filter((value) => value.active !== false).map((value) => ({ label: value.label, value: value.value })),
        })),
      };
    },
  });
  return cached.value;
}

export async function resolveUnofficialCompensationSchema({ force = false } = {}) {
  const [accountDescribe, claimDescribe, recoveryDescribe, stemDescribe, lineDescribe, extraDescribe, brokerDescribe, contactDescribe] = await Promise.all([
    describeObject(COMPENSATION_OBJECTS.account, force),
    describeObject(COMPENSATION_OBJECTS.claim, force),
    describeObject(COMPENSATION_OBJECTS.recovery, force),
    describeObject(COMPENSATION_OBJECTS.stem, force),
    describeObject(COMPENSATION_OBJECTS.line, force),
    describeObject(COMPENSATION_OBJECTS.extraCost, force),
    describeObject(COMPENSATION_OBJECTS.buyerBroker, force),
    describeObject(COMPENSATION_OBJECTS.contact, force),
  ]);
  const fields = {
    account: objectFields(accountDescribe),
    claim: objectFields(claimDescribe),
    recovery: objectFields(recoveryDescribe),
    stem: objectFields(stemDescribe),
    line: objectFields(lineDescribe),
    extraCost: objectFields(extraDescribe),
    buyerBroker: objectFields(brokerDescribe),
    contact: objectFields(contactDescribe),
  };

  for (const [fieldName, options] of Object.entries({
    Account__c: { referenceTo: 'Account', createable: true },
    Amount__c: { type: 'currency', createable: true },
    Deadline_Date__c: { type: 'date', createable: true },
    Status__c: { type: 'picklist', createable: true, updateable: true },
    Buyer_Supplier_Trader__c: { type: 'picklist', createable: true },
  })) requireField(fields.claim, COMPENSATION_OBJECTS.claim, fieldName, options);
  requireField(fields.claim, COMPENSATION_OBJECTS.claim, 'Contact__c', { referenceTo: 'Contact', createable: true });
  requireField(fields.claim, COMPENSATION_OBJECTS.claim, 'Description__c', { createable: true });
  if (!claimDescribe.createable) throw serviceError('Unofficial Compensation requires Agreed_Compensation__c create access.', 503, 'COMPENSATION_SCHEMA_INVALID');
  const claimStatuses = new Set((fields.claim.get('Status__c').picklistValues || []).map((option) => option.value));
  if (!claimStatuses.has('Opened') || !claimStatuses.has('Closed')) throw serviceError('Agreed_Compensation__c.Status__c must provide Opened and Closed.', 503, 'COMPENSATION_SCHEMA_INVALID');

  for (const [fieldName, options] of Object.entries({
    Account__c: { referenceTo: 'Account', createable: true },
    Contact__c: { referenceTo: 'Contact', createable: true },
    STEM__c: { referenceTo: 'STEM__c', createable: true },
    STEM_Line_Item__c: { referenceTo: 'STEM_Line_Item__c', createable: true },
    Product__c: { referenceTo: 'Product2', createable: true },
    Amount__c: { type: 'currency' },
    Fixed__c: { type: 'boolean', createable: true },
    Quantity__c: { type: 'double', createable: true },
    Quantity_Delivered_Per_BDN__c: { type: 'double', createable: true },
    Unit_Price__c: { type: 'currency', createable: true },
    Lumpsum_Price__c: { type: 'currency', createable: true },
    Unit_of_Measure__c: { type: 'picklist', createable: true },
    Buyer_Supplier_Trader__c: { type: 'picklist', createable: true },
  })) requireField(fields.recovery, COMPENSATION_OBJECTS.recovery, fieldName, options);
  if (!recoveryDescribe.createable || !recoveryDescribe.deletable) throw serviceError('Unofficial Compensation requires create and delete access to Unofficial_Compensation__c.', 503, 'COMPENSATION_SCHEMA_INVALID');

  for (const fieldName of ['Name', 'Company_Code__c', 'Inactive_Suspended__c', 'Compensation_Status__c', 'Agreed_Compensation_Total__c', 'Unofficial_Compensation_Total__c', 'Agreed_Compansation_Size__c', 'Unofficial_Compensation_Size__c']) {
    requireField(fields.account, COMPENSATION_OBJECTS.account, fieldName);
  }
  requireField(fields.account, COMPENSATION_OBJECTS.account, 'Compensation_Status__c', { type: 'picklist', updateable: true });
  const accountStatuses = new Set((fields.account.get('Compensation_Status__c').picklistValues || []).map((option) => option.value));
  if (!accountStatuses.has('Opened') || !accountStatuses.has('Closed')) throw serviceError('Account.Compensation_Status__c must provide Opened and Closed.', 503, 'COMPENSATION_SCHEMA_INVALID');
  requireField(fields.stem, COMPENSATION_OBJECTS.stem, 'Account__c', { referenceTo: 'Account' });
  requireField(fields.stem, COMPENSATION_OBJECTS.stem, 'Buyer_Broker__c', { referenceTo: 'Account' });
  requireField(fields.line, COMPENSATION_OBJECTS.line, 'STEM__c', { referenceTo: 'STEM__c' });
  requireField(fields.line, COMPENSATION_OBJECTS.line, 'Original_Supplier__c', { referenceTo: 'Account' });
  requireField(fields.line, COMPENSATION_OBJECTS.line, 'Supplier_Broker__c', { referenceTo: 'Account' });
  const lineBuyerBrokerFields = accountLookupFields(fields.line, ['Buyers_Broker__c', 'Buyer_Broker__c']);
  if (!lineBuyerBrokerFields.length) {
    throw serviceError('Unofficial Compensation requires STEM_Line_Item__c.Buyers_Broker__c or Buyer_Broker__c to reference Account.', 503, 'COMPENSATION_SCHEMA_INVALID');
  }
  requireField(fields.line, COMPENSATION_OBJECTS.line, 'Product__c', { referenceTo: 'Product2' });
  for (const fieldName of ['Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Unit_of_Measure__c']) requireField(fields.line, COMPENSATION_OBJECTS.line, fieldName);
  requireField(fields.extraCost, COMPENSATION_OBJECTS.extraCost, 'STEM__c', { referenceTo: 'STEM__c' });
  requireField(fields.extraCost, COMPENSATION_OBJECTS.extraCost, 'Supplier__c', { referenceTo: 'Account' });
  requireField(fields.buyerBroker, COMPENSATION_OBJECTS.buyerBroker, 'STEM__c', { referenceTo: 'STEM__c' });
  requireField(fields.buyerBroker, COMPENSATION_OBJECTS.buyerBroker, 'Buyer_Broker__c', { referenceTo: 'Account' });

  return {
    fields,
    lineBuyerBrokerFields,
    describes: { accountDescribe, claimDescribe, recoveryDescribe, stemDescribe, lineDescribe, extraDescribe, brokerDescribe, contactDescribe },
    multiCurrency: fields.claim.has('CurrencyIsoCode') && fields.recovery.has('CurrencyIsoCode'),
    picOptions: fields.claim.get('Buyer_Supplier_Trader__c').picklistValues || [],
    recoveryPicOptions: fields.recovery.get('Buyer_Supplier_Trader__c').picklistValues || [],
    recoveryUomOptions: fields.recovery.get('Unit_of_Measure__c').picklistValues || [],
  };
}

function interofficeAccountConditions(schema, prefix = '') {
  const conditions = [];
  const fieldPrefix = prefix ? `${prefix}.` : '';
  if (schema.fields.account.has('Group_Name__c')) conditions.push(`(${fieldPrefix}Group_Name__c = null OR ${fieldPrefix}Group_Name__c != 'FRATELLI COSULICH')`);
  if (schema.fields.account.has('ParentId')) conditions.push(`(${fieldPrefix}Parent.Name = null OR ${fieldPrefix}Parent.Name != 'FRATELLI COSULICH')`);
  return conditions;
}

function accountSelectFields(schema, prefix = '') {
  const names = selected(schema.fields.account, ['Id', 'Name', 'Company_Code__c', 'Inactive_Suspended__c', 'Compensation_Status__c', 'Agreed_Compensation_Total__c', 'Unofficial_Compensation_Total__c', 'Agreed_Compansation_Size__c', 'Unofficial_Compensation_Size__c', 'CurrencyIsoCode']);
  const values = names.map((name) => `${prefix}${name}`);
  if (schema.fields.account.has('RecordTypeId')) values.push(`${prefix}RecordType.Name`);
  return values;
}

function claimSelectFields(schema) {
  return selected(schema.fields.claim, ['Id', 'Name', 'Account__c', 'Contact__c', 'Amount__c', 'Deadline_Date__c', 'Status__c', 'Buyer_Supplier_Trader__c', 'Description__c', 'CurrencyIsoCode', 'CreatedDate', 'LastModifiedDate'])
    .concat(accountSelectFields(schema, 'Account__r.'), ['Contact__r.Name']);
}

function recoverySelectFields(schema) {
  return selected(schema.fields.recovery, ['Id', 'Name', 'Account__c', 'Contact__c', 'STEM__c', 'STEM_Line_Item__c', 'Product__c', 'Amount__c', 'Fixed__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Unit_Price__c', 'Lumpsum_Price__c', 'Unit_of_Measure__c', 'Buyer_Supplier_Trader__c', 'CurrencyIsoCode', 'CreatedDate', 'LastModifiedDate'])
    .concat(accountSelectFields(schema, 'Account__r.'), ['Contact__r.Name', 'STEM__r.Name', 'Product__r.Name']);
}

export async function listUnofficialCompensation({ force = false, interoffice = false } = {}) {
  const schema = await resolveUnofficialCompensationSchema({ force });
  const accessScope = interoffice ? 'interoffice' : 'standard';
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-unofficial-compensation',
    version: '1',
    accessScope,
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { view: 'workspace' },
    ttlSeconds: 60,
    tags: ['salesforce:compensation', 'salesforce:account', 'salesforce:stem'],
    force,
    loader: async () => {
      const accountWhere = [
        '(Agreed_Compansation_Size__c > 0 OR Unofficial_Compensation_Size__c > 0)',
        ...(interoffice ? interofficeAccountConditions(schema) : []),
      ].join(' AND ');
      const relatedAccountWhere = interoffice ? interofficeAccountConditions(schema, 'Account__r') : [];
      const [accountResult, claimResult, recoveryResult] = await sfCompositeQueries([
        { soql: `SELECT ${accountSelectFields(schema).join(',')} FROM Account WHERE ${accountWhere} ORDER BY Name LIMIT 5000`, clean: true, limit: 5000 },
        { soql: `SELECT ${claimSelectFields(schema).join(',')} FROM Agreed_Compensation__c${relatedAccountWhere.length ? ` WHERE ${relatedAccountWhere.join(' AND ')}` : ''} ORDER BY Account__c, Contact__c, CreatedDate`, clean: true, limit: 20000 },
        { soql: `SELECT ${recoverySelectFields(schema).join(',')} FROM Unofficial_Compensation__c${relatedAccountWhere.length ? ` WHERE ${relatedAccountWhere.join(' AND ')}` : ''} ORDER BY Account__c, Contact__c, CreatedDate`, clean: true, limit: 20000 },
      ]);
      for (const result of [accountResult, claimResult, recoveryResult]) {
        if (Number(result.totalSize || 0) > result.records.length) throw serviceError('Unofficial Compensation exceeds the current 20,000-record safety limit. Narrow the Salesforce data set before using FCOS.', 503, 'COMPENSATION_RESULT_LIMIT');
      }
      return {
        ...buildUnofficialCompensationWorkspace({ accounts: accountResult.records, claims: claimResult.records, recoveries: recoveryResult.records, today: todayInHongKong() }),
        instanceUrl: getInstanceUrl(),
        fetchedAt: new Date().toISOString(),
      };
    },
  });
  return { ...cached.value, cacheStatus: cached.cacheStatus || cached.status || null };
}

async function activeAccounts(schema, interoffice) {
  const conditions = ['Inactive_Suspended__c = false', ...(interoffice ? interofficeAccountConditions(schema) : [])];
  const rows = await sfQuery(`SELECT ${accountSelectFields(schema).join(',')} FROM Account WHERE ${conditions.join(' AND ')} ORDER BY Name LIMIT 5000`, { clean: true, limit: 5000 });
  if (Number(rows.totalSize || 0) > rows.records.length) throw serviceError('Active Account options exceed 5,000 records.', 503, 'COMPENSATION_OPTION_LIMIT');
  return rows.records.map((account) => ({
    accountId: account.Id,
    accountName: account.Name,
    clKey: account.Company_Code__c || '',
    accountType: account.RecordType?.Name || '',
    currencyIsoCode: account.CurrencyIsoCode || 'USD',
  }));
}

async function contactsForAccount(accountId) {
  const result = await sfQuery(`SELECT Id, Name FROM Contact WHERE AccountId = '${soql(accountId)}' ORDER BY Name LIMIT 500`, { clean: true, limit: 500 });
  return result.records.map((row) => ({ contactId: row.Id, contactName: row.Name }));
}

async function assertAccountAccess(schema, accountId, interoffice) {
  if (!interoffice) return;
  const conditions = [`Id = '${soql(accountId)}'`, ...interofficeAccountConditions(schema)];
  const result = await sfQuery(`SELECT Id FROM Account WHERE ${conditions.join(' AND ')} LIMIT 1`, { clean: true, limit: 1 });
  if (!result.records[0]) throw serviceError('This Account is not available for Interoffice users.', 403);
}

function stemBuyerAccessCondition(schema, interoffice) {
  if (!interoffice) return '';
  return interofficeAccountConditions(schema, 'Account__r').join(' AND ');
}

async function findStems(schema, keyword, interoffice) {
  const query = text(keyword);
  if (query.length < 2) return [];
  const fields = selected(schema.fields.stem, ['Id', 'Name', 'Delivery_Date__c', 'Account__c', 'LastModifiedDate']).concat(['Account__r.Name']);
  const conditions = [`Name LIKE '%${soql(query)}%'`];
  const access = stemBuyerAccessCondition(schema, interoffice);
  if (access) conditions.push(access);
  const result = await sfQuery(`SELECT ${fields.join(',')} FROM STEM__c WHERE ${conditions.join(' AND ')} ORDER BY LastModifiedDate DESC LIMIT 30`, { clean: true, limit: 30 });
  return result.records.map((row) => ({ stemId: row.Id, stemName: row.Name, buyerName: row.Account__r?.Name || '', deliveryDate: row.Delivery_Date__c || null }));
}

async function stemRecoveryContext(schema, stemId, interoffice) {
  if (!isSalesforceRecordId(stemId)) throw serviceError('Valid Salesforce STEM is required.');
  const stemFields = selected(schema.fields.stem, ['Id', 'Name', 'Account__c', 'Buyer_Broker__c', 'Delivery_Date__c', 'LastModifiedDate']).concat(['Account__r.Name']);
  const lineFields = [...new Set(selected(schema.fields.line, ['Id', 'Name', 'STEM__c', 'Original_Supplier__c', 'Supplier_Broker__c', 'Product__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Unit_of_Measure__c', 'LastModifiedDate']).concat(schema.lineBuyerBrokerFields, ['Product__r.Name']))];
  const access = stemBuyerAccessCondition(schema, interoffice);
  const stemWhere = [`Id = '${soql(stemId)}'`, ...(access ? [access] : [])].join(' AND ');
  const [stemResult, lineResult, extraResult, brokerResult] = await sfCompositeQueries([
    { soql: `SELECT ${stemFields.join(',')} FROM STEM__c WHERE ${stemWhere} LIMIT 1`, clean: true, limit: 1 },
    { soql: `SELECT ${lineFields.join(',')} FROM STEM_Line_Item__c WHERE STEM__c = '${soql(stemId)}' ORDER BY CreatedDate`, clean: true, limit: 2000 },
    { soql: `SELECT Id, Supplier__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${soql(stemId)}'`, clean: true, limit: 2000 },
    { soql: `SELECT Id, Buyer_Broker__c FROM STEM_Buyer_Broker__c WHERE STEM__c = '${soql(stemId)}'`, clean: true, limit: 2000 },
  ]);
  const stem = stemResult.records[0];
  if (!stem) throw serviceError('STEM was not found or is outside your access scope.', 404);
  const participantIds = [...new Set([
    stem.Account__c,
    stem.Buyer_Broker__c,
    ...lineResult.records.flatMap((row) => [row.Original_Supplier__c, row.Supplier_Broker__c, ...schema.lineBuyerBrokerFields.map((fieldName) => row[fieldName])]),
    ...extraResult.records.map((row) => row.Supplier__c),
    ...brokerResult.records.map((row) => row.Buyer_Broker__c),
  ].filter(isSalesforceRecordId))];
  if (!participantIds.length) return { stem, lineItems: lineResult.records, eligibleAccounts: [] };
  const ids = soqlIds(participantIds);
  const [accountResult, claimResult] = await sfCompositeQueries([
    { soql: `SELECT ${accountSelectFields(schema).join(',')} FROM Account WHERE Id IN (${ids})`, clean: true, limit: 500 },
    { soql: `SELECT ${claimSelectFields(schema).join(',')} FROM Agreed_Compensation__c WHERE Account__c IN (${ids}) AND Status__c = 'Opened' ORDER BY Account__c, Contact__c, CreatedDate`, clean: true, limit: 5000 },
  ]);
  const claimsByAccount = new Map();
  for (const claim of claimResult.records) {
    if (!claimsByAccount.has(claim.Account__c)) claimsByAccount.set(claim.Account__c, []);
    claimsByAccount.get(claim.Account__c).push(claimRowForOption(claim));
  }
  return {
    stem: { stemId: stem.Id, stemName: stem.Name, buyerName: stem.Account__r?.Name || '', deliveryDate: stem.Delivery_Date__c || null },
    lineItems: lineResult.records.map((row) => ({
      lineItemId: row.Id,
      lineItemName: row.Name || row.Product__r?.Name || 'Product line',
      productId: row.Product__c || null,
      productName: row.Product__r?.Name || row.Name || '',
      quantity: row.Quantity__c,
      deliveredQuantity: row.Quantity_Delivered_Per_BDN__c,
      unitOfMeasure: row.Unit_of_Measure__c || '',
      lastModifiedAt: row.LastModifiedDate || null,
    })),
    eligibleAccounts: accountResult.records.filter((row) => claimsByAccount.has(row.Id)).map((row) => ({
      accountId: row.Id,
      accountName: row.Name,
      clKey: row.Company_Code__c || '',
      active: row.Inactive_Suspended__c !== true,
      claims: claimsByAccount.get(row.Id),
    })),
  };
}

function claimRowForOption(row) {
  return {
    claimId: row.Id,
    claimName: row.Name || '',
    accountId: row.Account__c,
    accountName: row.Account__r?.Name || '',
    contactId: row.Contact__c || null,
    contactName: row.Contact__r?.Name || 'No Contact',
    amount: Number(row.Amount__c || 0),
    currencyIsoCode: row.CurrencyIsoCode || 'USD',
    deadlineDate: row.Deadline_Date__c || null,
    status: row.Status__c || '',
    pic: row.Buyer_Supplier_Trader__c || '',
    lastModifiedAt: row.LastModifiedDate || null,
  };
}

export async function unofficialCompensationOptions(body = {}, { interoffice = false } = {}) {
  const schema = await resolveUnofficialCompensationSchema({ force: body.force === true });
  const mode = text(body.mode || 'bootstrap');
  if (mode === 'bootstrap') return { accounts: await activeAccounts(schema, interoffice), picOptions: schema.picOptions, instanceUrl: getInstanceUrl() };
  if (mode === 'contacts') {
    if (!isSalesforceRecordId(body.accountId)) throw serviceError('Valid Account is required.');
    await assertAccountAccess(schema, body.accountId, interoffice);
    return { contacts: await contactsForAccount(body.accountId) };
  }
  if (mode === 'stem_search') return { stems: await findStems(schema, body.keyword, interoffice) };
  if (mode === 'stem_detail') return stemRecoveryContext(schema, body.stemId, interoffice);
  throw serviceError('Unsupported compensation option mode.');
}

async function reserveOperation({ client, profile, operationId, operationType, payload, accountId = null, stemId = null, disputeActionId = null, auditReason = null }) {
  if (!UUID_PATTERN.test(text(operationId))) throw serviceError('A valid operationId is required for this Salesforce change.');
  if (!OPERATION_TYPES.has(operationType)) throw serviceError('Unsupported compensation operation.');
  const requestHash = operationHash(operationType, payload);
  const { data: existing, error: existingError } = await client.from('unofficial_compensation_operations').select('*').eq('operation_id', operationId).maybeSingle();
  if (existingError) throw serviceError('Unofficial Compensation operation storage is unavailable.', 503, 'COMPENSATION_STORAGE_UNAVAILABLE');
  if (existing) {
    if (existing.request_hash !== requestHash) throw serviceError('This operationId was already used for a different request.', 409, 'IDEMPOTENCY_CONFLICT');
    if (existing.operation_status === 'succeeded') return { replayed: true, result: existing.result_snapshot || {} };
    if (existing.operation_status === 'uncertain') throw serviceError('The earlier Salesforce result is uncertain. Review Salesforce before trying a new operation.', 409, 'COMPENSATION_WRITE_UNCERTAIN');
    throw serviceError('This operation has already been processed. Refresh before trying again.', 409, 'COMPENSATION_OPERATION_EXISTS');
  }
  const { data, error } = await client.from('unofficial_compensation_operations').insert({
    operation_id: operationId,
    operation_type: operationType,
    request_hash: requestHash,
    operation_status: 'pending',
    account_id: accountId,
    stem_id: stemId,
    dispute_action_id: disputeActionId,
    audit_reason: text(auditReason) || null,
    actor_user_id: profile.id,
    actor_email: profile.email,
  }).select('*').single();
  if (error) throw serviceError('Unable to reserve this compensation operation.', 503, 'COMPENSATION_STORAGE_UNAVAILABLE');
  return { replayed: false, row: data };
}

async function finalizeOperation(client, operationId, { status, objectName = null, recordId = null, result = {}, error = null }) {
  const { error: updateError } = await client.from('unofficial_compensation_operations').update({
    operation_status: status,
    salesforce_object: objectName,
    salesforce_record_id: recordId,
    result_snapshot: result || {},
    error_code: error?.code || null,
    error_message: error?.message ? text(error.message).slice(0, 2000) : null,
    completed_at: status === 'pending' ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('operation_id', operationId);
  if (updateError && status === 'succeeded') throw serviceError('Salesforce changed successfully, but FCOS could not confirm the audit record. Do not repeat the action until reviewed.', 503, 'COMPENSATION_CONFIRMATION_FAILED');
}

async function runOperation(context, operation, mutate) {
  const reservation = await reserveOperation({ ...context, ...operation });
  if (reservation.replayed) return { ...reservation.result, replayed: true };
  let writeStarted = false;
  try {
    const result = await mutate(() => { writeStarted = true; });
    await finalizeOperation(context.client, operation.operationId, { status: 'succeeded', objectName: result.objectName, recordId: result.recordId, result: result.response });
    return result.response;
  } catch (error) {
    const uncertain = writeStarted && (!error.status || Number(error.status) >= 500);
    await finalizeOperation(context.client, operation.operationId, { status: uncertain ? 'uncertain' : 'failed', error }).catch(() => null);
    throw error;
  }
}

async function liveAccount(schema, accountId, { requireActive = false, interoffice = false } = {}) {
  if (!isSalesforceRecordId(accountId)) throw serviceError('Valid Salesforce Account is required.');
  const conditions = [`Id = '${soql(accountId)}'`];
  if (requireActive) conditions.push('Inactive_Suspended__c = false');
  const result = await sfQuery(`SELECT ${accountSelectFields(schema).join(',')} FROM Account WHERE ${conditions.join(' AND ')} LIMIT 1`, { clean: true, limit: 1 });
  const account = result.records[0];
  if (!account) throw serviceError(requireActive ? 'Only an active Salesforce Account can receive a new compensation claim.' : 'Salesforce Account was not found.', 409);
  await assertAccountAccess(schema, accountId, interoffice);
  return account;
}

async function liveClaim(schema, claimId) {
  if (!isSalesforceRecordId(claimId)) throw serviceError('Valid Salesforce compensation claim is required.');
  const result = await sfQuery(`SELECT ${claimSelectFields(schema).join(',')} FROM Agreed_Compensation__c WHERE Id = '${soql(claimId)}' LIMIT 1`, { clean: true, limit: 1 });
  const claim = result.records[0];
  if (!claim) throw serviceError('The Salesforce compensation claim was not found.', 404);
  return claim;
}

async function validateContact(accountId, contactId) {
  if (!contactId) return null;
  if (!isSalesforceRecordId(contactId)) throw serviceError('Valid Salesforce Contact is required.');
  const result = await sfQuery(`SELECT Id, Name, AccountId FROM Contact WHERE Id = '${soql(contactId)}' AND AccountId = '${soql(accountId)}' LIMIT 1`, { clean: true, limit: 1 });
  if (!result.records[0]) throw serviceError('The selected Contact does not belong to the selected Account.', 409);
  return result.records[0];
}

function validDate(value) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export async function createUnofficialCompensationClaim(body, context) {
  const schema = await resolveUnofficialCompensationSchema();
  const accountId = text(body.accountId);
  const amount = number(body.amount);
  const deadlineDate = validDate(body.deadlineDate);
  const pic = text(body.pic);
  if (!(amount > 0)) throw serviceError('Claim amount must be greater than zero.');
  if (!deadlineDate) throw serviceError('Claim deadline is required.');
  if (!pic || !schema.picOptions.some((option) => option.value === pic)) throw serviceError('Select a valid Salesforce PIC.');
  if (text(body.description).length > 32768) throw serviceError('Description exceeds the Salesforce 32,768-character limit.');
  const account = await liveAccount(schema, accountId, { requireActive: true, interoffice: context.interoffice === true });
  const contact = await validateContact(accountId, body.contactId);
  const payload = { accountId, amount, deadlineDate, pic, contactId: contact?.Id || null, description: text(body.description) };
  return runOperation(context, { operationId: body.operationId, operationType: 'claim_create', payload, accountId }, async (markWriteStarted) => {
    const record = {
      Account__c: accountId,
      Amount__c: amount,
      Deadline_Date__c: deadlineDate,
      Status__c: 'Opened',
      Buyer_Supplier_Trader__c: pic,
      Contact__c: contact?.Id || null,
      Description__c: text(body.description) || null,
    };
    if (schema.multiCurrency && account.CurrencyIsoCode) record.CurrencyIsoCode = account.CurrencyIsoCode;
    markWriteStarted();
    const created = await sfRequest('/sobjects/Agreed_Compensation__c', { method: 'POST', body: record });
    await expireRuntimeCacheTags(['salesforce:compensation', 'salesforce:account', `salesforce:account:${accountId}`]);
    const response = { claim: { claimId: created.id, accountId, accountName: account.Name, amount, currencyIsoCode: account.CurrencyIsoCode || 'USD', deadlineDate, status: 'Opened', contactId: contact?.Id || null, contactName: contact?.Name || 'No Contact', pic } };
    return { objectName: 'Agreed_Compensation__c', recordId: created.id, response };
  });
}

export async function updateUnofficialCompensationClaimGroupStatus(body, context) {
  const schema = await resolveUnofficialCompensationSchema();
  const accountId = text(body.accountId);
  const contactId = text(body.contactId) || null;
  const status = text(body.status);
  const reason = text(body.reason);
  if (!isSalesforceRecordId(accountId)) throw serviceError('Valid Account is required.');
  if (contactId && !isSalesforceRecordId(contactId)) throw serviceError('Valid Contact is required.');
  if (!['Opened', 'Closed'].includes(status)) throw serviceError('Claim status must be Opened or Closed.');
  if (reason.length < 3) throw serviceError('A reason is required for this status change.');
  await assertAccountAccess(schema, accountId, context.interoffice === true);
  const contactWhere = contactId ? `Contact__c = '${soql(contactId)}'` : 'Contact__c = null';
  const claimResult = await sfQuery(`SELECT ${claimSelectFields(schema).join(',')} FROM Agreed_Compensation__c WHERE Account__c = '${soql(accountId)}' AND ${contactWhere} ORDER BY CreatedDate`, { clean: true, limit: 5000 });
  if (!claimResult.records.length) throw serviceError('No compensation claims were found for this Account and Contact.', 404);
  const currentVersion = claimResult.records.map((row) => row.LastModifiedDate || '').sort().at(-1) || '';
  if (text(body.expectedLastModifiedAt) !== currentVersion) throw serviceError('Claims changed after they were opened. Refresh before changing status.', 409, 'STALE_COMPENSATION_RECORD');
  const allClaims = await sfQuery(`SELECT Id, Contact__c, Status__c FROM Agreed_Compensation__c WHERE Account__c = '${soql(accountId)}'`, { clean: true, limit: 10000 });
  const targetIds = new Set(claimResult.records.map((row) => row.Id));
  const accountStatus = allClaims.records.some((row) => targetIds.has(row.Id) ? status === 'Opened' : row.Status__c === 'Opened') ? 'Opened' : 'Closed';
  const payload = { accountId, contactId, status, reason, expectedLastModifiedAt: currentVersion };
  return runOperation(context, { operationId: body.operationId, operationType: 'claim_group_status', payload, accountId, auditReason: reason }, async (markWriteStarted) => {
    const records = [
      ...claimResult.records.map((row) => ({ attributes: { type: 'Agreed_Compensation__c' }, Id: row.Id, Status__c: status })),
      { attributes: { type: 'Account' }, Id: accountId, Compensation_Status__c: accountStatus },
    ];
    if (records.length > 200) throw serviceError('This Account has more than 199 claims and cannot be updated atomically.', 409);
    markWriteStarted();
    const result = await sfRequest('/composite/sobjects', { method: 'PATCH', body: { allOrNone: true, records } });
    const failures = (Array.isArray(result) ? result : []).filter((row) => row.success !== true);
    if (failures.length) throw serviceError(failures.flatMap((row) => row.errors || []).map((row) => row.message).filter(Boolean).join('; ') || 'Salesforce rejected the claim status update.', 502);
    await expireRuntimeCacheTags(['salesforce:compensation', 'salesforce:account', `salesforce:account:${accountId}`]);
    const response = { accountId, contactId, status, accountStatus, updatedClaimCount: claimResult.records.length };
    return { objectName: 'Agreed_Compensation__c', recordId: claimResult.records[0].Id, response };
  });
}

export async function createUnofficialCompensationRecovery(body, context) {
  const schema = await resolveUnofficialCompensationSchema();
  const stemId = text(body.stemId);
  const lineItemId = text(body.lineItemId);
  const accountId = text(body.accountId);
  const claim = await liveClaim(schema, body.claimId);
  if (claim.Status__c !== 'Opened') throw serviceError('The selected compensation claim is no longer Opened.', 409);
  if (claim.Account__c !== accountId) throw serviceError('The selected claim does not belong to the selected Account.', 409);
  const contextData = await stemRecoveryContext(schema, stemId, context.interoffice === true);
  const eligible = contextData.eligibleAccounts.find((row) => row.accountId === accountId);
  if (!eligible) throw serviceError('The selected Account is not an eligible participant with an open claim on this STEM.', 409);
  const eligibleClaim = eligible.claims.find((row) => row.claimId === claim.Id);
  if (!eligibleClaim) throw serviceError('The selected claim is stale or does not match this STEM participant.', 409);
  const line = contextData.lineItems.find((row) => row.lineItemId === lineItemId);
  if (!line) throw serviceError('The selected STEM line item is stale or invalid.', 409);
  if (!isSalesforceRecordId(line.productId)) throw serviceError('The selected STEM line item does not have a valid Salesforce Product.', 409);
  const fixed = body.fixed === true;
  const unitPrice = number(body.unitPrice);
  const lumpSumPrice = number(body.lumpSumPrice);
  if (fixed ? !(lumpSumPrice > 0) : !(unitPrice > 0)) throw serviceError(fixed ? 'Lump-sum price must be greater than zero.' : 'Unit price must be greater than zero.');
  const amount = unofficialCompensationAmount({ fixed, lumpSumPrice, unitPrice, quantity: line.quantity, deliveredQuantity: line.deliveredQuantity });
  if (!(amount < 0)) throw serviceError('The calculated UOC recovery must reduce the outstanding balance.');
  const pic = text(body.pic || claim.Buyer_Supplier_Trader__c);
  if (pic && !schema.recoveryPicOptions.some((option) => option.value === pic)) throw serviceError('Select a valid Salesforce PIC.');
  const unitOfMeasure = fixed ? '1.' : text(line.unitOfMeasure);
  if (!unitOfMeasure || !schema.recoveryUomOptions.some((option) => option.value === unitOfMeasure)) {
    throw serviceError(`The derived unit of measure ${unitOfMeasure || 'is missing'} is not valid for Unofficial Compensation.`, 409);
  }
  const payload = { stemId, lineItemId, accountId, claimId: claim.Id, fixed, unitPrice: fixed ? null : unitPrice, lumpSumPrice: fixed ? lumpSumPrice : null, amount, pic };
  return runOperation(context, { operationId: body.operationId, operationType: 'recovery_create', payload, accountId, stemId }, async (markWriteStarted) => {
    const record = {
      Account__c: accountId,
      Contact__c: claim.Contact__c || null,
      Buyer_Supplier_Trader__c: pic || null,
      Quantity__c: fixed ? 1 : line.quantity,
      Quantity_Delivered_Per_BDN__c: line.deliveredQuantity,
      Unit_Price__c: fixed ? null : unitPrice,
      Unit_of_Measure__c: unitOfMeasure,
      Lumpsum_Price__c: fixed ? lumpSumPrice : null,
      STEM__c: stemId,
      STEM_Line_Item__c: lineItemId,
      Product__c: line.productId,
      Fixed__c: fixed,
    };
    if (schema.multiCurrency && claim.CurrencyIsoCode) record.CurrencyIsoCode = claim.CurrencyIsoCode;
    markWriteStarted();
    const created = await sfRequest('/sobjects/Unofficial_Compensation__c', { method: 'POST', body: record });
    await expireRuntimeCacheTags(['salesforce:compensation', 'salesforce:account', 'salesforce:stem', `salesforce:account:${accountId}`, `salesforce:stem:${stemId}`]);
    const response = { recovery: { recoveryId: created.id, accountId, stemId, stemName: contextData.stem.stemName, lineItemId, productName: line.productName, amount, recoveredAmount: -amount, currencyIsoCode: claim.CurrencyIsoCode || 'USD' } };
    return { objectName: 'Unofficial_Compensation__c', recordId: created.id, response };
  });
}

export async function deleteUnofficialCompensationRecovery(body, context) {
  const schema = await resolveUnofficialCompensationSchema();
  const recoveryId = text(body.recoveryId);
  const reason = text(body.reason);
  if (!isSalesforceRecordId(recoveryId)) throw serviceError('Valid UOC recovery is required.');
  if (reason.length < 3) throw serviceError('A reason is required to delete an erroneous recovery.');
  const result = await sfQuery(`SELECT ${recoverySelectFields(schema).join(',')} FROM Unofficial_Compensation__c WHERE Id = '${soql(recoveryId)}' LIMIT 1`, { clean: true, limit: 1 });
  const recovery = result.records[0];
  if (!recovery) throw serviceError('The UOC recovery was not found.', 404);
  await assertAccountAccess(schema, recovery.Account__c, context.interoffice === true);
  if (text(body.expectedLastModifiedAt) !== text(recovery.LastModifiedDate)) throw serviceError('The recovery changed after it was opened. Refresh before deleting it.', 409, 'STALE_COMPENSATION_RECORD');
  const payload = { recoveryId, expectedLastModifiedAt: recovery.LastModifiedDate, reason };
  return runOperation(context, { operationId: body.operationId, operationType: 'recovery_delete', payload, accountId: recovery.Account__c, stemId: recovery.STEM__c, auditReason: reason }, async (markWriteStarted) => {
    markWriteStarted();
    await sfRequest(`/sobjects/Unofficial_Compensation__c/${encodeURIComponent(recoveryId)}`, { method: 'DELETE' });
    await expireRuntimeCacheTags(['salesforce:compensation', 'salesforce:account', 'salesforce:stem', `salesforce:account:${recovery.Account__c}`, `salesforce:stem:${recovery.STEM__c}`]);
    const response = { recoveryId, deleted: true };
    return { objectName: 'Unofficial_Compensation__c', recordId: recoveryId, response };
  });
}

export async function agreedCompensationClaimsForAccount(accountId, { includeClosed = false } = {}) {
  const schema = await resolveUnofficialCompensationSchema();
  if (!isSalesforceRecordId(accountId)) throw serviceError('Valid Salesforce Account is required.');
  const status = includeClosed ? '' : " AND Status__c = 'Opened'";
  const result = await sfQuery(`SELECT ${claimSelectFields(schema).join(',')} FROM Agreed_Compensation__c WHERE Account__c = '${soql(accountId)}'${status} ORDER BY Status__c DESC, Deadline_Date__c, CreatedDate`, { clean: true, limit: 5000 });
  return result.records.map(claimRowForOption);
}

export async function validateAgreedCompensationClaimLink(claimId, accountId, { requireOpen = true } = {}) {
  const schema = await resolveUnofficialCompensationSchema();
  const claim = await liveClaim(schema, claimId);
  if (claim.Account__c !== accountId) throw serviceError('The compensation claim belongs to a different dispute-party Account.', 409);
  if (requireOpen && claim.Status__c !== 'Opened') throw serviceError('Only an Opened compensation claim can be linked.', 409);
  return claimRowForOption(claim);
}

export async function linkDisputeAgreedCompensationClaim(body, context) {
  const actionId = text(body.actionId);
  const claimId = text(body.claimId) || null;
  if (!UUID_PATTERN.test(actionId)) throw serviceError('Valid dispute action is required.');
  const { data: action, error: actionError } = await context.client
    .from('dispute_beta_actions')
    .select('id,case_id,stem_id,party_id,party_side,action_type,close_reason,updated_at,dispute_workflow_parties(account_id,account_name)')
    .eq('id', actionId)
    .maybeSingle();
  if (actionError) throw serviceError('Unable to read the dispute action.', 503, 'COMPENSATION_STORAGE_UNAVAILABLE');
  if (!action) throw serviceError('Dispute action was not found.', 404);
  if (!['close_buyer_dispute', 'close_supplier_dispute'].includes(action.action_type) || text(action.close_reason).toLowerCase() !== 'uoc opened') {
    throw serviceError('An Agreed Compensation claim can be linked only to a UOC opened closure action.', 409);
  }
  if (text(body.expectedActionUpdatedAt) && text(body.expectedActionUpdatedAt) !== text(action.updated_at)) {
    throw serviceError('The dispute action changed after it was opened. Refresh before linking the claim.', 409, 'STALE_DISPUTE_ACTION');
  }
  const accountId = text(action.dispute_workflow_parties?.account_id);
  if (!isSalesforceRecordId(accountId)) throw serviceError('The dispute action does not have a valid party Account.', 409);
  const claim = claimId ? await validateAgreedCompensationClaimLink(claimId, accountId, { requireOpen: true }) : null;
  const payload = { actionId, claimId, accountId, expectedActionUpdatedAt: text(action.updated_at) };
  return runOperation(context, { operationId: body.operationId, operationType: 'dispute_claim_link', payload, accountId, disputeActionId: actionId }, async (markWriteStarted) => {
    const now = new Date().toISOString();
    const snapshot = claim ? { ...claim, linkedWhileOpen: true, accountName: action.dispute_workflow_parties?.account_name || claim.accountName || '' } : {};
    markWriteStarted();
    const { data: updated, error: updateError } = await context.client
      .from('dispute_beta_actions')
      .update({
        linked_agreed_compensation_id: claim?.claimId || null,
        linked_compensation_snapshot: snapshot,
        linked_compensation_by: claim ? context.profile.id : null,
        linked_compensation_by_email: claim ? context.profile.email : null,
        linked_compensation_at: claim ? now : null,
        updated_by: context.profile.id,
        updated_by_email: context.profile.email,
        updated_at: now,
      })
      .eq('id', actionId)
      .eq('updated_at', action.updated_at)
      .select('id,updated_at')
      .maybeSingle();
    if (updateError) throw serviceError('Unable to save the dispute compensation claim link.', 503, 'COMPENSATION_STORAGE_UNAVAILABLE');
    if (!updated) throw serviceError('The dispute action changed while the claim was being linked. Refresh and try again.', 409, 'STALE_DISPUTE_ACTION');
    const { error: eventError } = await context.client.from('dispute_beta_events').insert({
      case_id: action.case_id,
      action_id: action.id,
      stem_id: action.stem_id,
      event_type: 'compensation_claim_linked',
      note: claim ? 'Agreed Compensation claim linked to UOC opened closure.' : 'Agreed Compensation claim link removed.',
      metadata: claim ? { claimId: claim.claimId, accountId, claimStatus: claim.status, amount: claim.amount, currencyIsoCode: claim.currencyIsoCode } : { claimRemoved: true, accountId },
      actor_user_id: context.profile.id,
      actor_email: context.profile.email,
    });
    if (eventError) throw serviceError('The claim link was saved, but its dispute audit event could not be confirmed.', 503, 'COMPENSATION_CONFIRMATION_FAILED');
    const response = { actionId, claim, linked: Boolean(claim), updatedAt: updated.updated_at };
    return { objectName: claim ? 'Agreed_Compensation__c' : null, recordId: claim?.claimId || null, response };
  });
}

export { COMPENSATION_OBJECTS };
