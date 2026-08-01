import { createHash } from 'node:crypto';
import { sfQuery, sfRequest } from './_salesforce.js';
import { expireRuntimeCacheTags } from './_runtimeCache.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const VENUES = ['ICE', 'FCBS'];

function failure(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function apiName(value, label) {
  const name = String(value || '');
  if (!API_NAME.test(name)) throw failure(`Invalid Salesforce ${label} configuration.`, 503);
  return name;
}

function salesforceId(value, label) {
  const id = String(value || '');
  if (!SALESFORCE_ID.test(id)) throw failure(`Invalid Salesforce ${label}.`, 400);
  return id;
}

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function amount(body, venue) {
  const value = venue === 'ICE' ? body.lumpsum_ice : body.lumpsum_fcbs;
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw failure(`The ${venue} Salesforce amount is invalid.`, 400);
  return number;
}

function parseRecordIds(value) {
  const text = String(value || '').trim();
  if (!text) return {};
  if (SALESFORCE_ID.test(text)) return { ICE: text };
  return Object.fromEntries(text.split('|').map((part) => part.split(':', 2).map((item) => item.trim())).filter(([venue, id]) => VENUES.includes(venue) && SALESFORCE_ID.test(id)));
}

function formatRecordIds(ids) {
  return VENUES.filter((venue) => SALESFORCE_ID.test(String(ids[venue] || ''))).map((venue) => `${venue}:${ids[venue]}`).join('|');
}

function defaultMapping() {
  return {
    objectName: process.env.SALESFORCE_EXTRA_COST_OBJECT || 'STEM_Extra_Cost__c',
    stemObjectName: process.env.SALESFORCE_STEM_OBJECT || 'STEM__c',
    stemNameField: process.env.SALESFORCE_STEM_KEY_FIELD || process.env.SALESFORCE_STEM_NAME_FIELD || 'KeyStem__c',
    stemLookupField: process.env.SALESFORCE_STEM_LOOKUP_FIELD || 'STEM__c',
    amountField: process.env.SALESFORCE_LUMPSUM_COST_FIELD || 'Lumpsum_Cost__c',
    productLookupField: process.env.SALESFORCE_PRODUCT_LOOKUP_FIELD || 'Product2Id__c',
    supplierLookupField: process.env.SALESFORCE_SUPPLIER_LOOKUP_FIELD || 'Supplier__c',
    fixedField: process.env.SALESFORCE_FIXED_FIELD || 'Fixed__c',
    quantityField: process.env.SALESFORCE_QUANTITY_FIELD || 'Quantity_Delivered_Per_BDN__c',
    paymentTermField: process.env.SALESFORCE_PAYMENT_TERM_FIELD || 'Payment_Term__c',
    supplierPaymentTermField: process.env.SALESFORCE_SUPPLIER_PAYMENT_TERM_FIELD || 'Supplier_Payment_Term__c',
    recordTypeId: process.env.SALESFORCE_EXTRA_COST_RECORD_TYPE_ID || '',
    productId: process.env.SALESFORCE_SWAPS_PRODUCT_ID || '',
    quantity: Number(process.env.SALESFORCE_QUANTITY || 1),
    venues: {
      ICE: { supplierId: process.env.SALESFORCE_ICE_SUPPLIER_ID || '', paymentTerm: process.env.SALESFORCE_ICE_PAYMENT_TERM || '' },
      FCBS: { supplierId: process.env.SALESFORCE_FCBS_SUPPLIER_ID || '', paymentTerm: process.env.SALESFORCE_FCBS_PAYMENT_TERM || '' },
    },
  };
}

async function mapping(client) {
  const { data, error } = await client.from('hedge_settings').select('value').eq('key', 'salesforce_mapping').maybeSingle();
  if (error) throw failure(`Hedge Desk Salesforce settings could not be loaded: ${error.message}`, 502);
  const saved = data?.value && typeof data.value === 'object' ? data.value : {};
  const defaults = defaultMapping();
  return { ...defaults, ...saved, venues: { ICE: { ...defaults.venues.ICE, ...(saved.venues?.ICE || {}) }, FCBS: { ...defaults.venues.FCBS, ...(saved.venues?.FCBS || {}) } } };
}

async function validateSchema(config) {
  const [extraDescribe, stemDescribe] = await Promise.all([
    sfRequest(`/sobjects/${apiName(config.objectName, 'extra-cost object')}/describe`, { readOnly: true }),
    sfRequest(`/sobjects/${apiName(config.stemObjectName, 'STEM object')}/describe`, { readOnly: true }),
  ]);
  const fields = new Map((extraDescribe.fields || []).map((field) => [field.name, field]));
  const required = [config.stemLookupField, config.amountField, config.productLookupField, config.supplierLookupField, config.fixedField, config.quantityField, config.paymentTermField];
  const missing = required.filter((field) => !fields.has(field));
  if (missing.length) throw failure(`Salesforce ${config.objectName} is missing required fields: ${missing.join(', ')}.`, 503);
  if (extraDescribe.createable === false || extraDescribe.updateable === false) throw failure(`The FCOS Salesforce user cannot create and update ${config.objectName}.`, 503);
  const lookupTargets = [
    [config.stemLookupField, config.stemObjectName],
    [config.productLookupField, 'Product2'],
    [config.supplierLookupField, 'Account'],
  ];
  for (const [fieldName, target] of lookupTargets) {
    const referenceTo = fields.get(fieldName)?.referenceTo || [];
    if (!referenceTo.includes(target)) throw failure(`Salesforce ${config.objectName}.${fieldName} must reference ${target}.`, 503);
  }
  if (!(stemDescribe.fields || []).some((field) => field.name === config.stemNameField)) throw failure(`Salesforce ${config.stemObjectName}.${config.stemNameField} is unavailable.`, 503);
}

async function reserve(client, profile, body) {
  const key = String(body.idempotencyKey || '').trim();
  if (!key) throw failure('A Hedge Desk Salesforce idempotency key is required.', 400);
  const requestHash = createHash('sha256').update(JSON.stringify({ physicalTradeId: body.physicalTradeId, expectedRevision: body.expectedRevision, stem_number: body.stem_number, lumpsum_ice: body.lumpsum_ice, lumpsum_fcbs: body.lumpsum_fcbs })).digest('hex');
  const existing = await client.from('hedge_integration_operations').select('*').eq('idempotency_key', key).maybeSingle();
  if (existing.error) throw failure(`Salesforce operation could not be checked: ${existing.error.message}`, 502);
  if (existing.data) {
    if (existing.data.request_hash !== requestHash) throw failure('This Salesforce operation key was already used for different data.', 409);
    if (existing.data.status === 'succeeded') return { replay: existing.data.response };
    if (['processing', 'uncertain'].includes(existing.data.status)) throw failure('This Salesforce operation is already running or requires review.', 409);
  }
  const payload = { idempotency_key: key, operation: 'hedge_salesforce_push', actor_user_id: profile.id, actor_email: profile.email, request_hash: requestHash, status: 'processing', error: null };
  const write = existing.data
    ? await client.from('hedge_integration_operations').update(payload).eq('id', existing.data.id).select('*').single()
    : await client.from('hedge_integration_operations').insert(payload).select('*').single();
  if (write.error) throw failure(`Salesforce operation could not be reserved: ${write.error.message}`, 502);
  return { operation: write.data };
}

export async function pushHedgeSalesforce(client, profile, body = {}) {
  const reservation = await reserve(client, profile, body);
  if (reservation.replay) return { ...reservation.replay, idempotency_replayed: true };
  const operation = reservation.operation;
  try {
    const physical = await client.from('hedge_physical_trades').select('id,stem_number,revision').eq('id', body.physicalTradeId).maybeSingle();
    if (physical.error) throw failure(`Physical trade could not be validated: ${physical.error.message}`, 502);
    if (!physical.data || Number(physical.data.revision) !== Number(body.expectedRevision) || physical.data.stem_number !== String(body.stem_number || '').trim()) throw failure('The physical trade changed before Salesforce synchronization. Refresh and try again.', 409);
    const config = await mapping(client);
    await validateSchema(config);
    const stemNumber = String(body.stem_number || '').trim();
    const amounts = Object.fromEntries(VENUES.map((venue) => [venue, amount(body, venue)]));
    const selectedVenues = VENUES.filter((venue) => amounts[venue] != null);
    if (!stemNumber || !selectedVenues.length) throw failure('A STEM number and at least one Hedge Desk amount are required.', 400);
    const stemRows = await sfQuery(`SELECT Id FROM ${apiName(config.stemObjectName, 'STEM object')} WHERE ${apiName(config.stemNameField, 'STEM key field')} = '${escapeSoql(stemNumber)}' LIMIT 2`, { clean: true, limit: 2 });
    if (stemRows.length !== 1) throw failure(stemRows.length ? `Salesforce STEM ${stemNumber} is not unique.` : `Salesforce STEM ${stemNumber} was not found.`, stemRows.length ? 502 : 404);
    const stemId = stemRows[0].Id;
    const productId = salesforceId(config.productId, 'SWAPS Product ID');
    const recordIds = parseRecordIds(body.existing_sf_record_id);
    const results = [];
    for (const venue of selectedVenues) {
      const supplierId = salesforceId(config.venues[venue].supplierId, `${venue} supplier Account ID`);
      const objectName = apiName(config.objectName, 'extra-cost object');
      let recordId = recordIds[venue];
      if (!recordId) {
        const matches = await sfQuery(`SELECT Id FROM ${objectName} WHERE ${apiName(config.stemLookupField, 'STEM lookup')} = '${stemId}' AND ${apiName(config.productLookupField, 'product lookup')} = '${productId}' AND ${apiName(config.supplierLookupField, 'supplier lookup')} = '${supplierId}' LIMIT 2`, { clean: true, limit: 2 });
        if (matches.length > 1) throw failure(`Multiple Salesforce ${venue} SWAPS extra costs match this STEM.`, 409);
        recordId = matches[0]?.Id || null;
      }
      if (recordId) {
        await sfRequest(`/sobjects/${objectName}/${salesforceId(recordId, `${venue} extra-cost ID`)}`, { method: 'PATCH', body: { [apiName(config.amountField, 'amount field')]: amounts[venue] } });
        results.push({ venue, action: 'updated', recordId });
      } else {
        const created = await sfRequest(`/sobjects/${objectName}`, { method: 'POST', body: {
          ...(config.recordTypeId ? { RecordTypeId: salesforceId(config.recordTypeId, 'record type ID') } : {}),
          [apiName(config.stemLookupField, 'STEM lookup')]: stemId,
          [apiName(config.productLookupField, 'product lookup')]: productId,
          [apiName(config.supplierLookupField, 'supplier lookup')]: supplierId,
          [apiName(config.amountField, 'amount field')]: amounts[venue],
          [apiName(config.fixedField, 'fixed field')]: true,
          [apiName(config.quantityField, 'quantity field')]: Number.isFinite(config.quantity) ? config.quantity : 1,
          ...(config.venues[venue].paymentTerm ? { [apiName(config.paymentTermField, 'payment term field')]: config.venues[venue].paymentTerm } : {}),
        } });
        recordId = salesforceId(created?.id, `${venue} created record ID`);
        results.push({ venue, action: 'created', recordId });
      }
      recordIds[venue] = recordId;
    }
    const response = { success: true, sf_record_id: formatRecordIds(recordIds), stem_name: stemNumber, results };
    await client.from('hedge_integration_operations').update({ status: 'succeeded', response }).eq('id', operation.id);
    await expireRuntimeCacheTags(['salesforce:stem', `salesforce:stem:${stemId}`, 'salesforce:dashboard', 'salesforce:documents']);
    return response;
  } catch (pushError) {
    const uncertain = pushError?.mailDeliveryUncertain || /timeout|network|fetch failed/i.test(String(pushError?.message || ''));
    await client.from('hedge_integration_operations').update({ status: uncertain ? 'uncertain' : 'failed', error: String(pushError?.code || pushError?.message || 'Salesforce failure').slice(0, 500) }).eq('id', operation.id);
    throw pushError;
  }
}
