import { createHash } from 'node:crypto';
import { getApiVersion, getInstanceUrl, sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';
import { expireRuntimeCacheTags, getOrLoadRuntimeCache } from './_runtimeCache.js';
import { sanitizeRichText } from './_richText.js';

const OBJECTS = Object.freeze({
  term: 'Special_Term__c',
  rule: 'Special_Term_Rule__c',
  account: 'Account',
  port: 'Port__c',
  product: 'Product2',
});
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const OPERATION_TYPES = new Set(['term_create', 'term_update', 'term_delete', 'rule_create', 'rule_update', 'rule_delete']);

function specialTermsError(message, status = 400, code = null, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function soql(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function salesforceId(value, label = 'Salesforce record') {
  const id = text(value, 18);
  if (!SALESFORCE_ID.test(id)) throw specialTermsError(`${label} is invalid.`, 400, 'SPECIAL_TERMS_INVALID_ID');
  return id;
}

function fieldMap(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

function requiredField(fields, objectName, fieldName, { type, referenceTo, createable, updateable } = {}) {
  const field = fields.get(fieldName);
  if (!field) throw specialTermsError(`Special Terms requires ${objectName}.${fieldName}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (type && field.type !== type) throw specialTermsError(`Special Terms requires ${objectName}.${fieldName} to be ${type}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (referenceTo && !(field.referenceTo || []).includes(referenceTo)) throw specialTermsError(`Special Terms requires ${objectName}.${fieldName} to reference ${referenceTo}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (createable === true && field.createable !== true) throw specialTermsError(`Special Terms requires create access to ${objectName}.${fieldName}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (updateable === true && field.updateable !== true) throw specialTermsError(`Special Terms requires update access to ${objectName}.${fieldName}.`, 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  return field;
}

async function describeObject(objectName, force = false) {
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-special-terms-describe',
    version: '1',
    accessScope: 'schema',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { objectName: objectName.toLowerCase() },
    ttlSeconds: 6 * 60 * 60,
    tags: ['salesforce:schema', 'salesforce:special-terms:schema', `salesforce:schema:${objectName.toLowerCase()}`],
    force,
    loader: async () => {
      const data = await sfRequest(`/sobjects/${encodeURIComponent(objectName)}/describe/`, { readOnly: true });
      return {
        name: data.name,
        createable: data.createable === true,
        updateable: data.updateable === true,
        deletable: data.deletable === true,
        fields: (data.fields || []).map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          createable: field.createable === true,
          updateable: field.updateable === true,
          referenceTo: field.referenceTo || [],
          picklistValues: (field.picklistValues || []).filter((option) => option.active !== false).map((option) => ({ label: option.label, value: option.value })),
        })),
      };
    },
  });
  return cached.value;
}

export async function resolveSpecialTermsSchema({ force = false, write = false } = {}) {
  const [termDescribe, ruleDescribe, accountDescribe, portDescribe, productDescribe] = await Promise.all([
    describeObject(OBJECTS.term, force),
    describeObject(OBJECTS.rule, force),
    describeObject(OBJECTS.account, force),
    describeObject(OBJECTS.port, force),
    describeObject(OBJECTS.product, force),
  ]);
  const fields = {
    term: fieldMap(termDescribe),
    rule: fieldMap(ruleDescribe),
    account: fieldMap(accountDescribe),
    port: fieldMap(portDescribe),
    product: fieldMap(productDescribe),
  };
  requiredField(fields.term, OBJECTS.term, 'Name', { type: 'string', ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.term, OBJECTS.term, 'Terms_Text__c', { type: 'textarea', ...(write ? { createable: true, updateable: true } : {}) });
  for (const name of ['Add_to_Confirmation__c', 'Add_to_Nomination__c']) requiredField(fields.term, OBJECTS.term, name, { type: 'boolean', ...(write ? { createable: true, updateable: true } : {}) });
  for (const name of ['Special_Remark_in_Confirmation__c', 'Special_Remark_in_Nomination__c']) requiredField(fields.term, OBJECTS.term, name, { type: 'textarea', ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Special_Term__c', { referenceTo: OBJECTS.term, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Account__c', { referenceTo: OBJECTS.account, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Port__c', { referenceTo: OBJECTS.port, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Product__c', { referenceTo: OBJECTS.product, ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Country__c', { type: 'picklist', ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Supplier_Buyer__c', { type: 'picklist', ...(write ? { createable: true, updateable: true } : {}) });
  requiredField(fields.rule, OBJECTS.rule, 'Priority__c', { type: 'double' });
  for (const [map, objectName, names] of [[fields.account, OBJECTS.account, ['Name', 'Company_Code__c']], [fields.port, OBJECTS.port, ['Name', 'Country__c', 'Offshore__c']], [fields.product, OBJECTS.product, ['Name', 'IsActive']]]) {
    for (const name of names) requiredField(map, objectName, name);
  }
  const audiences = fields.rule.get('Supplier_Buyer__c').picklistValues || [];
  if (!['Buyer', 'Supplier'].every((value) => audiences.some((option) => option.value === value))) throw specialTermsError('Special_Term_Rule__c.Supplier_Buyer__c must provide Buyer and Supplier.', 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  if (write && (!termDescribe.createable || !termDescribe.updateable || !termDescribe.deletable || !ruleDescribe.createable || !ruleDescribe.updateable || !ruleDescribe.deletable)) {
    throw specialTermsError('The FCOS Salesforce user requires create, update, and delete access to Special Terms and Special Term Rules.', 503, 'SPECIAL_TERMS_SCHEMA_INVALID');
  }
  return {
    fields,
    describes: { termDescribe, ruleDescribe },
    countryOptions: fields.rule.get('Country__c').picklistValues || [],
    audienceOptions: audiences,
  };
}

function mapTerm(row) {
  return {
    id: row.Id,
    name: row.Name || '',
    termsText: row.Terms_Text__c || '',
    addToConfirmation: row.Add_to_Confirmation__c === true,
    addToNomination: row.Add_to_Nomination__c === true,
    confirmationRemark: row.Special_Remark_in_Confirmation__c || '',
    nominationRemark: row.Special_Remark_in_Nomination__c || '',
    lastModifiedAt: row.LastModifiedDate || null,
  };
}

function mapRule(row) {
  return {
    id: row.Id,
    name: row.Name || '',
    specialTermId: row.Special_Term__c,
    specialTermName: row.Special_Term__r?.Name || '',
    audience: row.Supplier_Buyer__c || '',
    accountId: row.Account__c || null,
    accountName: row.Account__r?.Name || '',
    accountClKey: row.Account__r?.Company_Code__c || '',
    portId: row.Port__c || null,
    portName: row.Port__r?.Name || '',
    portCountry: row.Port__r?.Country__c || '',
    productId: row.Product__c || null,
    productName: row.Product__r?.Name || '',
    country: row.Country__c || '',
    priority: row.Priority__c == null ? null : Number(row.Priority__c),
    lastModifiedAt: row.LastModifiedDate || null,
  };
}

export async function listSpecialTerms({ force = false } = {}) {
  const schema = await resolveSpecialTermsSchema({ force });
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-special-terms',
    version: '1',
    accessScope: 'global',
    apiVersion: `${getApiVersion()}@${getInstanceUrl()}`,
    payload: { view: 'workspace' },
    ttlSeconds: 60,
    tags: ['salesforce:special-terms'],
    force,
    loader: async () => {
      const [termResult, ruleResult] = await sfCompositeQueries([
        { soql: 'SELECT Id,Name,Terms_Text__c,Add_to_Confirmation__c,Add_to_Nomination__c,Special_Remark_in_Confirmation__c,Special_Remark_in_Nomination__c,LastModifiedDate FROM Special_Term__c ORDER BY Name LIMIT 5000', clean: true, limit: 5000 },
        { soql: 'SELECT Id,Name,Special_Term__c,Special_Term__r.Name,Account__c,Account__r.Name,Account__r.Company_Code__c,Port__c,Port__r.Name,Port__r.Country__c,Product__c,Product__r.Name,Country__c,Supplier_Buyer__c,Priority__c,LastModifiedDate FROM Special_Term_Rule__c ORDER BY Priority__c,Name LIMIT 10000', clean: true, limit: 10000 },
      ]);
      if (termResult.totalSize > termResult.records.length || ruleResult.totalSize > ruleResult.records.length) throw specialTermsError('Special Terms exceeds the current safe result limit.', 503, 'SPECIAL_TERMS_RESULT_LIMIT');
      return { terms: termResult.records.map(mapTerm), rules: ruleResult.records.map(mapRule), fetchedAt: new Date().toISOString(), instanceUrl: getInstanceUrl() };
    },
  });
  return {
    ...cached.value,
    countryOptions: schema.countryOptions,
    audienceOptions: schema.audienceOptions,
    cacheStatus: cached.cacheStatus || cached.status || null,
  };
}

export async function specialTermOptions({ kind, query = '' } = {}) {
  const schema = await resolveSpecialTermsSchema();
  const search = text(query, 100);
  if (search.length < 2) return [];
  const like = `%${soql(search)}%`;
  if (kind === 'account') {
    const result = await sfQuery(`SELECT Id,Name,Company_Code__c FROM Account WHERE Inactive_Suspended__c = false AND (Name LIKE '${like}' OR Company_Code__c LIKE '${like}') ORDER BY Name LIMIT 30`, { clean: true, limit: 30 });
    return result.records.map((row) => ({ id: row.Id, label: row.Name, secondary: row.Company_Code__c || 'No CL Key' }));
  }
  if (kind === 'port') {
    const result = await sfQuery(`SELECT Id,Name,Country__c,Offshore__c FROM Port__c WHERE Name LIKE '${like}' ORDER BY Name LIMIT 30`, { clean: true, limit: 30 });
    return result.records.map((row) => ({ id: row.Id, label: row.Name, secondary: [row.Country__c, row.Offshore__c ? 'Offshore' : null].filter(Boolean).join(' · ') }));
  }
  if (kind === 'product') {
    const result = await sfQuery(`SELECT Id,Name,Family FROM Product2 WHERE IsActive = true AND Name LIKE '${like}' ORDER BY Name LIMIT 30`, { clean: true, limit: 30 });
    return result.records.map((row) => ({ id: row.Id, label: row.Name, secondary: row.Family || '' }));
  }
  void schema;
  throw specialTermsError('Unknown Special Terms option type.');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function reserveOperation(client, profile, body, operationType, payload) {
  if (!OPERATION_TYPES.has(operationType)) throw specialTermsError('Unknown Special Terms operation.');
  const operationId = text(body.operationId, 100);
  if (!operationId) throw specialTermsError('An operation ID is required.');
  const requestHash = createHash('sha256').update(stableJson({ operationType, payload })).digest('hex');
  const existing = await client.from('special_terms_operations').select('*').eq('operation_id', operationId).maybeSingle();
  if (existing.error) throw specialTermsError(`Special Terms operation could not be checked: ${existing.error.message}`, 502);
  if (existing.data) {
    if (existing.data.request_hash !== requestHash) throw specialTermsError('This operation ID was already used for different data.', 409);
    if (existing.data.operation_status === 'succeeded') return { replay: existing.data.result_snapshot };
    if (['pending', 'uncertain'].includes(existing.data.operation_status)) throw specialTermsError('This operation is already processing or requires review.', 409);
  }
  const row = { operation_id: operationId, operation_type: operationType, request_hash: requestHash, operation_status: 'pending', salesforce_object: operationType.startsWith('term_') ? OBJECTS.term : OBJECTS.rule, salesforce_record_id: payload.id || null, audit_reason: text(body.auditReason, 500) || null, actor_user_id: profile.id, actor_email: profile.email, error_code: null, error_message: null, result_snapshot: {}, updated_at: new Date().toISOString(), completed_at: null };
  const result = existing.data ? await client.from('special_terms_operations').update(row).eq('id', existing.data.id).select('*').single() : await client.from('special_terms_operations').insert(row).select('*').single();
  if (result.error) throw specialTermsError(`Special Terms operation could not be reserved: ${result.error.message}`, 502);
  return { operation: result.data };
}

async function finishOperation(client, operation, result) {
  const completedAt = new Date().toISOString();
  await client.from('special_terms_operations').update({ operation_status: 'succeeded', result_snapshot: result, updated_at: completedAt, completed_at: completedAt }).eq('id', operation.id);
  await expireRuntimeCacheTags(['salesforce:special-terms', 'salesforce:schema']);
  return result;
}

async function failOperation(client, operation, error) {
  const uncertain = /timeout|network|fetch failed/i.test(String(error?.message || ''));
  const completedAt = new Date().toISOString();
  await client.from('special_terms_operations').update({ operation_status: uncertain ? 'uncertain' : 'failed', error_code: text(error?.code || 'SPECIAL_TERMS_WRITE_FAILED', 100), error_message: text(error?.message || 'Salesforce write failed.', 500), updated_at: completedAt, completed_at: completedAt }).eq('id', operation.id);
  throw error;
}

async function currentRecord(objectName, id, fields) {
  const result = await sfQuery(`SELECT ${fields.join(',')} FROM ${objectName} WHERE Id = '${soql(id)}' LIMIT 1`, { clean: true, limit: 1 });
  if (!result.records[0]) throw specialTermsError('The Salesforce record no longer exists.', 409, 'SPECIAL_TERMS_STALE');
  return result.records[0];
}

function assertCurrent(record, expectedLastModifiedAt) {
  if (!expectedLastModifiedAt || record.LastModifiedDate !== expectedLastModifiedAt) throw specialTermsError('This Salesforce record changed after it was opened. Refresh before saving.', 409, 'SPECIAL_TERMS_STALE', { currentLastModifiedAt: record.LastModifiedDate });
}

function termPayload(body) {
  const name = text(body.name, 80);
  const termsText = text(body.termsText, 130768) || null;
  if (name.length < 2) throw specialTermsError('Special Term name must contain at least two characters.');
  return {
    Name: name,
    Terms_Text__c: termsText,
    Add_to_Confirmation__c: body.addToConfirmation === true,
    Add_to_Nomination__c: body.addToNomination === true,
    Special_Remark_in_Confirmation__c: sanitizeRichText(body.confirmationRemark),
    Special_Remark_in_Nomination__c: sanitizeRichText(body.nominationRemark),
  };
}

function rulePayload(body, schema) {
  const audience = text(body.audience, 20);
  if (!schema.audienceOptions.some((option) => option.value === audience)) throw specialTermsError('Select Buyer or Supplier for the rule audience.');
  const payload = {
    Special_Term__c: salesforceId(body.specialTermId, 'Special Term'),
    Supplier_Buyer__c: audience,
    Account__c: body.accountId ? salesforceId(body.accountId, 'Account') : null,
    Port__c: body.portId ? salesforceId(body.portId, 'Port') : null,
    Product__c: body.productId ? salesforceId(body.productId, 'Product') : null,
    Country__c: text(body.country, 100) || null,
  };
  if (payload.Country__c && !schema.countryOptions.some((option) => option.value === payload.Country__c)) throw specialTermsError('The selected country is not an active Salesforce picklist value.');
  if (![payload.Account__c, payload.Port__c, payload.Product__c, payload.Country__c].some(Boolean)) throw specialTermsError('A rule requires at least one Account, Port, Product, or Country condition.');
  return payload;
}

async function validateRuleLookups(payload) {
  const [, accountResult, , productResult] = await Promise.all([
    currentRecord(OBJECTS.term, payload.Special_Term__c, ['Id']),
    payload.Account__c ? sfQuery(`SELECT Id FROM Account WHERE Id = '${soql(payload.Account__c)}' AND Inactive_Suspended__c = false LIMIT 1`, { clean: true, limit: 1 }) : null,
    payload.Port__c ? currentRecord(OBJECTS.port, payload.Port__c, ['Id']) : null,
    payload.Product__c ? sfQuery(`SELECT Id FROM Product2 WHERE Id = '${soql(payload.Product__c)}' AND IsActive = true LIMIT 1`, { clean: true, limit: 1 }) : null,
  ]);
  if (payload.Account__c && !accountResult?.records?.[0]) throw specialTermsError('The selected Account is inactive or unavailable.');
  if (payload.Product__c && !productResult?.records?.[0]) throw specialTermsError('The selected Product is inactive or unavailable.');
}

export async function saveSpecialTerm(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const id = body.id ? salesforceId(body.id, 'Special Term') : null;
  const payload = termPayload(body);
  const operationType = id ? 'term_update' : 'term_create';
  const reservation = await reserveOperation(client, profile, body, operationType, { id, payload, expectedLastModifiedAt: body.expectedLastModifiedAt || null });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    let recordId = id;
    if (id) {
      assertCurrent(await currentRecord(OBJECTS.term, id, ['Id', 'LastModifiedDate']), body.expectedLastModifiedAt);
      await sfRequest(`/sobjects/${OBJECTS.term}/${id}`, { method: 'PATCH', body: payload });
    } else {
      const created = await sfRequest(`/sobjects/${OBJECTS.term}`, { method: 'POST', body: payload });
      recordId = salesforceId(created?.id, 'Created Special Term');
    }
    return finishOperation(client, reservation.operation, { success: true, id: recordId });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function deleteSpecialTerm(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const id = salesforceId(body.id, 'Special Term');
  if (text(body.auditReason, 500).length < 3) throw specialTermsError('A deletion reason is required.');
  const reservation = await reserveOperation(client, profile, body, 'term_delete', { id, expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    const current = await currentRecord(OBJECTS.term, id, ['Id', 'Name', 'LastModifiedDate']);
    assertCurrent(current, body.expectedLastModifiedAt);
    if (text(body.confirmationName, 80) !== current.Name) throw specialTermsError(`Type ${current.Name} to confirm deletion.`);
    const linked = await sfQuery(`SELECT Id FROM ${OBJECTS.rule} WHERE Special_Term__c = '${soql(id)}' ORDER BY Id LIMIT 4800`, { clean: true, limit: 4800 });
    if (linked.totalSize > linked.records.length) throw specialTermsError('This term has too many linked rules for one atomic deletion.', 409);
    const ruleChunks = [];
    for (let index = 0; index < linked.records.length; index += 200) ruleChunks.push(linked.records.slice(index, index + 200));
    const requests = [
      ...ruleChunks.map((rules, index) => ({
        method: 'DELETE',
        url: `/services/data/${getApiVersion()}/composite/sobjects?ids=${rules.map((rule) => rule.Id).join(',')}&allOrNone=true`,
        referenceId: `ruleBatch${index}`,
      })),
      { method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.term}/${id}`, referenceId: 'term' },
    ];
    const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    const failure = (result.compositeResponse || []).find((response) => response.httpStatusCode < 200 || response.httpStatusCode >= 300);
    if (failure) throw specialTermsError(failure.body?.[0]?.message || 'Salesforce rejected Special Term deletion.', failure.httpStatusCode || 502);
    return finishOperation(client, reservation.operation, { success: true, id, deletedRuleCount: linked.records.length });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function saveSpecialTermRule(client, profile, body = {}) {
  const schema = await resolveSpecialTermsSchema({ force: true, write: true });
  const id = body.id ? salesforceId(body.id, 'Special Term Rule') : null;
  const payload = rulePayload(body, schema);
  await validateRuleLookups(payload);
  const operationType = id ? 'rule_update' : 'rule_create';
  const reservation = await reserveOperation(client, profile, body, operationType, { id, payload, expectedLastModifiedAt: body.expectedLastModifiedAt || null });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    let recordId = id;
    if (id) {
      assertCurrent(await currentRecord(OBJECTS.rule, id, ['Id', 'LastModifiedDate']), body.expectedLastModifiedAt);
      // Salesforce computes Priority__c only on insert. Replace the rule atomically so
      // Salesforce remains the sole owner of that calculation after an FCOS edit.
      const result = await sfRequest('/composite', {
        method: 'POST',
        body: {
          allOrNone: true,
          compositeRequest: [
            { method: 'DELETE', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.rule}/${id}`, referenceId: 'oldRule' },
            { method: 'POST', url: `/services/data/${getApiVersion()}/sobjects/${OBJECTS.rule}`, referenceId: 'newRule', body: payload },
          ],
        },
      });
      const responses = result.compositeResponse || [];
      const failure = responses.find((response) => response.httpStatusCode < 200 || response.httpStatusCode >= 300);
      if (failure) throw specialTermsError(failure.body?.[0]?.message || 'Salesforce rejected the Special Term rule edit.', failure.httpStatusCode || 502);
      recordId = salesforceId(responses.find((response) => response.referenceId === 'newRule')?.body?.id, 'Updated Special Term Rule');
    } else {
      const created = await sfRequest(`/sobjects/${OBJECTS.rule}`, { method: 'POST', body: payload });
      recordId = salesforceId(created?.id, 'Created Special Term Rule');
    }
    return finishOperation(client, reservation.operation, { success: true, id: recordId, replacedId: id && recordId !== id ? id : null });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}

export async function deleteSpecialTermRule(client, profile, body = {}) {
  await resolveSpecialTermsSchema({ force: true, write: true });
  const id = salesforceId(body.id, 'Special Term Rule');
  if (text(body.auditReason, 500).length < 3) throw specialTermsError('A deletion reason is required.');
  const reservation = await reserveOperation(client, profile, body, 'rule_delete', { id, expectedLastModifiedAt: body.expectedLastModifiedAt });
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  try {
    assertCurrent(await currentRecord(OBJECTS.rule, id, ['Id', 'LastModifiedDate']), body.expectedLastModifiedAt);
    await sfRequest(`/sobjects/${OBJECTS.rule}/${id}`, { method: 'DELETE' });
    return finishOperation(client, reservation.operation, { success: true, id });
  } catch (error) {
    return failOperation(client, reservation.operation, error);
  }
}
