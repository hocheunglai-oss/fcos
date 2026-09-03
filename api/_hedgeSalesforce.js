import { createHash } from 'node:crypto';
import {
  DEFAULT_GENERAL,
  DEFAULT_RATES,
  calcSwapFees,
  calcSwapMtm,
  paperHedgeExpiryStatus,
  physicalMidQuantity,
  roundMoney,
} from '../src/hedge/lib/domain.js';
import { decorateMopsMonthVerifications, mopsMonthDateBounds } from './_hedgeMops.js';
import { getSfsMopsCompleteness } from '../src/hedge/lib/sfsReport.js';
import { getApiVersion, getInstanceUrl, sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';
import { expireRuntimeCacheTags } from './_runtimeCache.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const VENUES = ['ICE', 'FCBS'];
const MAX_ALLOCATIONS = 25;

const APPROVED_MAPPING = Object.freeze({
  mappingRevision: 3,
  objectName: 'STEM_Extra_Cost__c',
  stemObjectName: 'STEM__c',
  stemNameField: 'KeyStem__c',
  stemLookupField: 'STEM__c',
  amountField: 'Lumpsum_Cost__c',
  descriptionField: 'Description__c',
  productLookupField: 'Product2Id__c',
  supplierLookupField: 'Supplier__c',
  fixedField: 'Fixed__c',
  quantityField: 'Quantity_Delivered_Per_BDN__c',
  uomField: 'Unit_of_Measure__c',
  unitOfMeasure: '1.',
  paymentTermField: 'Payment_Term__c',
  externalKeyField: 'FCOS_Hedge_Allocation_Key__c',
  cancelledField: 'Cancelled__c',
  buyerInvoiceField: 'Buyer_Invoice__c',
  supplierInvoiceField: 'Supplier_Invoice__c',
  recordTypeId: '0122x000000cwlgAAA',
  productId: '01tfu000002zAEDAA2',
  quantity: 1,
  venues: {
    ICE: { supplierId: '001fu00000Zo8eHAAR', paymentTerm: '7 I' },
    FCBS: { supplierId: '0012x00000LGhzUAAT', paymentTerm: '7 I' },
  },
});

function failure(message, statusCode = 400, code = null, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function apiName(value, label) {
  const name = String(value || '');
  if (!API_NAME.test(name)) throw failure(`Invalid Salesforce ${label} configuration.`, 503, 'HEDGE_SALESFORCE_MAPPING_INVALID');
  return name;
}

function salesforceId(value, label) {
  const id = String(value || '');
  if (!SALESFORCE_ID.test(id)) throw failure(`Invalid Salesforce ${label}.`, 400, 'HEDGE_SALESFORCE_ID_INVALID');
  return id;
}

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function parseLegacyRecordIds(value) {
  const input = String(value || '').trim();
  if (!input) return {};
  if (SALESFORCE_ID.test(input)) return { ICE: input };
  return Object.fromEntries(input.split('|').map((part) => part.split(':', 2).map((item) => item.trim())).filter(([venue, id]) => VENUES.includes(venue) && SALESFORCE_ID.test(id)));
}

function contractMonths(swap) {
  return [...new Set((swap.trade_type === 'SPREAD' ? [swap.leg1_month, swap.leg2_month] : [swap.swap_month]).filter(Boolean))];
}

function allocateMoney(total, shares) {
  let allocated = 0;
  return shares.map((share, index) => {
    const value = index === shares.length - 1 ? roundMoney(total - allocated) : roundMoney(total * share);
    allocated = roundMoney(allocated + value);
    return value;
  });
}

export function allocateHedgeSalesforceAmounts({ grossPnl, feeAmount, shares }) {
  const normalizedShares = (shares || []).map(Number);
  const gross = allocateMoney(roundMoney(grossPnl), normalizedShares);
  const fees = allocateMoney(roundMoney(feeAmount), normalizedShares);
  const net = allocateMoney(roundMoney(roundMoney(grossPnl) - roundMoney(feeAmount)), normalizedShares);
  return normalizedShares.map((share, index) => ({
    share,
    grossPnl: gross[index],
    feeAmount: fees[index],
    netPnl: net[index],
    salesforceCost: roundMoney(-net[index]),
  }));
}

function mergeMapping(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  return {
    ...APPROVED_MAPPING,
    ...source,
    mappingRevision: Math.max(Number(APPROVED_MAPPING.mappingRevision), Number(source.mappingRevision || 0)),
    venues: {
      ICE: { ...APPROVED_MAPPING.venues.ICE, ...(source.venues?.ICE || {}) },
      FCBS: { ...APPROVED_MAPPING.venues.FCBS, ...(source.venues?.FCBS || {}) },
    },
  };
}

export async function loadValidatedHedgeSalesforceMapping(client) {
  const config = await mapping(client);
  const identities = await validateMapping(config);
  return { config, identities };
}

export async function loadFinalPaperHedgeAllocation(client, swapId) {
  const inputs = await loadInputs(client, swapId);
  const financials = await loadFinalFinancials(client, inputs);
  return { inputs, financials };
}

export function hedgeSalesforceFingerprint(value) {
  return fingerprint(value);
}

export function hedgeSalesforceFailure(message, statusCode = 400, code = null, details = undefined) {
  return failure(message, statusCode, code, details);
}

async function mapping(client) {
  const { data, error } = await client.from('hedge_settings').select('id,value,revision,updated_date').eq('key', 'salesforce_mapping').maybeSingle();
  if (error) throw failure(`Hedge Desk Salesforce settings could not be loaded: ${error.message}`, 502);
  const config = mergeMapping(data?.value);
  return { ...config, settingsRevision: Number(data?.revision || 1), settingsUpdatedAt: data?.updated_date || null };
}

function fieldMap(describe) {
  return new Map((describe?.fields || []).map((field) => [field.name, field]));
}

function requireField(fields, objectName, name, { referenceTo, createable = false, updateable = false } = {}) {
  const field = fields.get(name);
  if (!field) throw failure(`Salesforce ${objectName}.${name} is required for Hedge Desk synchronization.`, 503, 'HEDGE_SALESFORCE_SCHEMA_INVALID');
  if (referenceTo && !(field.referenceTo || []).includes(referenceTo)) throw failure(`Salesforce ${objectName}.${name} must reference ${referenceTo}.`, 503, 'HEDGE_SALESFORCE_SCHEMA_INVALID');
  if (createable && field.createable !== true) throw failure(`Salesforce ${objectName}.${name} is not createable by FCOS.`, 503, 'HEDGE_SALESFORCE_SCHEMA_INVALID');
  if (updateable && field.updateable !== true) throw failure(`Salesforce ${objectName}.${name} is not updateable by FCOS.`, 503, 'HEDGE_SALESFORCE_SCHEMA_INVALID');
  return field;
}

async function validateMapping(config) {
  const objectName = apiName(config.objectName, 'extra-cost object');
  const stemObjectName = apiName(config.stemObjectName, 'STEM object');
  const [extraDescribe, stemDescribe] = await Promise.all([
    sfRequest(`/sobjects/${objectName}/describe`, { readOnly: true }),
    sfRequest(`/sobjects/${stemObjectName}/describe`, { readOnly: true }),
  ]);
  if (extraDescribe.createable !== true || extraDescribe.updateable !== true) throw failure(`The FCOS Salesforce user cannot create and update ${objectName}.`, 503, 'HEDGE_SALESFORCE_SCHEMA_INVALID');
  const fields = fieldMap(extraDescribe);
  requireField(fields, objectName, apiName(config.stemLookupField, 'STEM lookup'), { referenceTo: stemObjectName, createable: true });
  requireField(fields, objectName, apiName(config.productLookupField, 'product lookup'), { referenceTo: 'Product2', createable: true });
  requireField(fields, objectName, apiName(config.supplierLookupField, 'supplier lookup'), { referenceTo: 'Account', createable: true });
  requireField(fields, objectName, apiName(config.amountField, 'cost field'), { createable: true, updateable: true });
  requireField(fields, objectName, apiName(config.descriptionField, 'description field'), { createable: true, updateable: true });
  requireField(fields, objectName, apiName(config.fixedField, 'fixed field'), { createable: true });
  requireField(fields, objectName, apiName(config.quantityField, 'quantity field'), { createable: true });
  const uomField = requireField(fields, objectName, apiName(config.uomField, 'unit-of-measure field'), { createable: true, updateable: true });
  if (uomField.type !== 'picklist' || !(uomField.picklistValues || []).some((option) => option.active === true && option.value === config.unitOfMeasure)) {
    throw failure(`Salesforce ${objectName}.${config.uomField} must allow the unit ${config.unitOfMeasure}.`, 503, 'HEDGE_SALESFORCE_SCHEMA_INVALID');
  }
  requireField(fields, objectName, apiName(config.paymentTermField, 'payment term field'), { createable: true });
  if (!(stemDescribe.fields || []).some((field) => field.name === config.stemNameField)) throw failure(`Salesforce ${stemObjectName}.${config.stemNameField} is unavailable.`, 503, 'HEDGE_SALESFORCE_SCHEMA_INVALID');

  const productId = salesforceId(config.productId, 'SWAPS Product ID');
  const recordTypeId = salesforceId(config.recordTypeId, 'STEM Charge record type ID');
  const supplierIds = VENUES.map((venue) => salesforceId(config.venues[venue]?.supplierId, `${venue} supplier Account ID`));
  const [productResult, recordTypeResult, supplierResult] = await sfCompositeQueries([
    { soql: `SELECT Id,Name,IsActive FROM Product2 WHERE Id = '${productId}' LIMIT 1`, clean: true, limit: 1 },
    { soql: `SELECT Id,Name,SobjectType,IsActive FROM RecordType WHERE Id = '${recordTypeId}' LIMIT 1`, clean: true, limit: 1 },
    { soql: `SELECT Id,Name,Company_Code__c,Inactive_Suspended__c FROM Account WHERE Id IN ('${supplierIds.join("','")}')`, clean: true, limit: 2 },
  ]);
  const product = productResult.records[0];
  const recordType = recordTypeResult.records[0];
  if (!product || product.IsActive !== true || product.Name !== 'SWAPS') throw failure('The configured Hedge Desk Product must be the active Salesforce SWAPS Product.', 503, 'HEDGE_SALESFORCE_MAPPING_INVALID');
  if (!recordType || recordType.IsActive !== true || recordType.SobjectType !== objectName || recordType.Name !== 'STEM Charge') throw failure(`The configured record type must be the active ${objectName} STEM Charge record type.`, 503, 'HEDGE_SALESFORCE_MAPPING_INVALID');
  const accounts = new Map(supplierResult.records.map((row) => [row.Id, row]));
  const suppliers = Object.fromEntries(VENUES.map((venue) => {
    const account = accounts.get(config.venues[venue].supplierId);
    if (!account || account.Inactive_Suspended__c === true) throw failure(`The configured ${venue} supplier Account is inactive or unavailable.`, 503, 'HEDGE_SALESFORCE_MAPPING_INVALID');
    if (String(config.venues[venue].paymentTerm || '') !== '7 I') throw failure(`The configured ${venue} new-record payment term must be 7 I.`, 503, 'HEDGE_SALESFORCE_MAPPING_INVALID');
    return [venue, account];
  }));
  return { product, recordType, suppliers, instanceUrl: getInstanceUrl() };
}

async function loadInputs(client, swapId) {
  const id = String(swapId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw failure('Select a valid paper hedge.');
  const [swapResult, linksResult, configResult] = await Promise.all([
    client.from('hedge_swap_hedges').select('*').eq('id', id).maybeSingle(),
    client.from('hedge_swap_physical_links').select('physical_trade_id,link_order').eq('swap_id', id).order('link_order'),
    client.from('hedge_settings').select('key,value').in('key', ['rates', 'general']),
  ]);
  const inputError = swapResult.error || linksResult.error || configResult.error;
  if (inputError) throw failure(`Hedge allocation inputs could not be loaded: ${inputError.message}`, 502);
  if (!swapResult.data) throw failure('The paper hedge was not found.', 404);
  const physicalIds = (linksResult.data || []).map((row) => row.physical_trade_id);
  const physicalResult = physicalIds.length
    ? await client.from('hedge_physical_trades').select('*').in('id', physicalIds)
    : { data: [], error: null };
  if (physicalResult.error) throw failure(`Linked physical trades could not be loaded: ${physicalResult.error.message}`, 502);
  const config = Object.fromEntries((configResult.data || []).map((row) => [row.key, row.value || {}]));
  const order = new Map((linksResult.data || []).map((row) => [row.physical_trade_id, Number(row.link_order || 0)]));
  return {
    swap: { ...swapResult.data, physical_trade_ids: physicalIds },
    physicals: (physicalResult.data || []).sort((left, right) => (order.get(left.id) || 0) - (order.get(right.id) || 0)),
    rates: { ...DEFAULT_RATES, ...(config.rates || {}) },
    sgoRatio: Number(config.general?.sgo_bbl_per_mt || DEFAULT_GENERAL.sgo_bbl_per_mt),
  };
}

async function loadFinalFinancials(client, inputs) {
  const { swap } = inputs;
  const months = contractMonths(swap);
  const issues = [];
  if (!months.length) issues.push('The paper hedge has no valid contract month.');
  const firstMonth = [...months].sort()[0];
  const lastMonth = [...months].sort().at(-1);
  const firstMonthBounds = months.length ? mopsMonthDateBounds(firstMonth) : null;
  const lastMonthBounds = months.length ? mopsMonthDateBounds(lastMonth) : null;
  const [priceResult, verificationResult] = months.length
    ? await Promise.all([
      client.from('hedge_market_prices').select('*').gte('price_date', firstMonthBounds.start).lt('price_date', lastMonthBounds.endExclusive).order('price_date'),
      client.from('hedge_mops_month_verifications').select('*').in('contract_month', months),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (priceResult.error || verificationResult.error) throw failure(`Final MOPS records could not be loaded: ${(priceResult.error || verificationResult.error).message}`, 502);
  const monthlyVerifications = decorateMopsMonthVerifications(verificationResult.data || [], priceResult.data || []);
  const expiryStatus = paperHedgeExpiryStatus(swap, priceResult.data || [], new Date(), monthlyVerifications);
  if (swap.is_expired !== true) issues.push('The paper hedge has not expired automatically. Complete all scheduled MOPS values and verify the final monthly average after the final trading day.');
  for (const monthStatus of expiryStatus.months) {
    if (!monthStatus.calendarSupported) issues.push(`The Platts publication calendar for ${monthStatus.month.slice(0, 4)} has not been approved.`);
    if (!monthStatus.reachedLastTradingDay) issues.push(`${monthStatus.month} has not reached its final trading day ${monthStatus.lastTradingDay || 'not available'}.`);
    if (!monthStatus.averageVerified) issues.push(`Manual verification text has not been saved for the final MOPS monthly average for ${monthStatus.month}.`);
  }
  for (const month of months) {
    const completeness = getSfsMopsCompleteness(month, priceResult.data || []);
    if (!completeness.complete) issues.push(`Final MOPS is incomplete for ${month}: ${completeness.actual} of ${completeness.total} publication days.`);
  }
  const mtm = issues.length ? null : calcSwapMtm(swap, priceResult.data || [], inputs.sgoRatio);
  if (!mtm) issues.push('Final net P&L could not be calculated from the saved pricing basis and MOPS records.');
  const fees = calcSwapFees(swap, inputs.rates);
  const grossPnl = roundMoney(mtm?.value || 0);
  const feeAmount = roundMoney(fees.total);
  const netPnl = roundMoney(grossPnl - feeAmount);
  return { months, mops: priceResult.data || [], expiryStatus, issues: [...new Set(issues)], mtm, fees, grossPnl, feeAmount, netPnl, salesforceCost: roundMoney(-netPnl) };
}

function groupPhysicals(inputs) {
  const issues = [];
  const groups = new Map();
  for (const physical of inputs.physicals) {
    const stemKey = String(physical.stem_number || '').trim();
    if (!stemKey) {
      issues.push(`Linked physical trade ${physical.vessel_name || physical.id.slice(0, 8)} has no Salesforce STEM key.`);
      continue;
    }
    if (!groups.has(stemKey)) groups.set(stemKey, { stemKey, physicals: [], weight: 0 });
    const group = groups.get(stemKey);
    group.physicals.push(physical);
    group.weight += Math.max(0, physicalMidQuantity(physical, inputs.sgoRatio));
  }
  if (!inputs.physicals.length) issues.push('Link at least one physical trade before Salesforce synchronization.');
  if (!groups.size && inputs.physicals.length) issues.push('No linked physical trade has a usable Salesforce STEM key.');
  const rows = [...groups.values()];
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  rows.forEach((row) => { row.share = totalWeight > 0 ? row.weight / totalWeight : 1 / rows.length; });
  return { rows, issues };
}

async function resolveSalesforceRows(config, identities, groups, previousAllocations) {
  if (!groups.length) return { stemRows: new Map(), extraCosts: [], liveById: new Map(), issues: [] };
  const stemKeys = groups.map((group) => escapeSoql(group.stemKey));
  const stemObject = apiName(config.stemObjectName, 'STEM object');
  const stemField = apiName(config.stemNameField, 'STEM key field');
  const stemsResult = await sfQuery(`SELECT Id,${stemField} FROM ${stemObject} WHERE ${stemField} IN ('${stemKeys.join("','")}')`, { clean: true, limit: Math.max(2, groups.length * 2) });
  const byKey = new Map();
  for (const row of stemsResult.records) {
    const key = row[stemField];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  const issues = [];
  const stemRows = new Map();
  for (const group of groups) {
    const matches = byKey.get(group.stemKey) || [];
    if (matches.length !== 1) issues.push(matches.length ? `Salesforce STEM ${group.stemKey} is not unique.` : `Salesforce STEM ${group.stemKey} was not found.`);
    else stemRows.set(group.stemKey, matches[0]);
  }
  const stemIds = [...stemRows.values()].map((row) => row.Id);
  if (!stemIds.length) return { stemRows, extraCosts: [], liveById: new Map(), issues };
  const objectName = apiName(config.objectName, 'extra-cost object');
  const fields = ['Id', 'Name', 'LastModifiedDate', config.stemLookupField, config.productLookupField, config.supplierLookupField, config.amountField, config.paymentTermField, config.descriptionField, config.uomField].map((field) => apiName(field, 'extra-cost field'));
  const previousIds = previousAllocations.map((row) => row.salesforce_record_id).filter((id) => SALESFORCE_ID.test(String(id || '')));
  const legacyIds = groups.flatMap((group) => group.physicals.flatMap((physical) => Object.values(parseLegacyRecordIds(physical.sf_record_id)))).filter((id) => SALESFORCE_ID.test(String(id || '')));
  const linkedIds = [...new Set([...previousIds, ...legacyIds])];
  const supplierIds = VENUES.map((venue) => config.venues[venue].supplierId);
  const extraResult = await sfQuery(`SELECT ${fields.join(',')} FROM ${objectName} WHERE (${config.stemLookupField} IN ('${stemIds.join("','")}') AND ${config.productLookupField} = '${config.productId}' AND ${config.supplierLookupField} IN ('${supplierIds.join("','")}'))${linkedIds.length ? ` OR Id IN ('${linkedIds.join("','")}')` : ''}`, { clean: true, limit: Math.max(100, stemIds.length * 8 + linkedIds.length) });
  const liveById = new Map(extraResult.records.map((row) => [row.Id, row]));
  void identities;
  return { stemRows, extraCosts: extraResult.records, liveById, issues };
}

function matchesAllocation(record, allocation, config) {
  return record?.[config.stemLookupField] === allocation.salesforceStemId
    && record?.[config.productLookupField] === config.productId
    && record?.[config.supplierLookupField] === allocation.supplierAccountId;
}

function chooseRecord({ allocation, group, previous, salesforce, config }) {
  const exact = salesforce.extraCosts.filter((record) => matchesAllocation(record, allocation, config));
  const previousRecord = previous?.salesforce_record_id ? salesforce.liveById.get(previous.salesforce_record_id) : null;
  if (previous?.salesforce_record_id) {
    if (!previousRecord) return { issue: 'Previously linked Salesforce SWAPS record is missing. Review it before synchronization.', state: 'missing' };
    if (!matchesAllocation(previousRecord, allocation, config)) return { issue: 'Previously linked Salesforce SWAPS record no longer matches the expected STEM, Product, and supplier.', state: 'ambiguous' };
    return { record: previousRecord, state: previous.sync_state === 'synced' ? 'synced' : 'ready' };
  }

  const legacyIds = [...new Set(group.physicals.map((physical) => parseLegacyRecordIds(physical.sf_record_id)[allocation.venue]).filter(Boolean))];
  if (legacyIds.length > 1) return { issue: 'Linked physical trades contain multiple legacy Salesforce SWAPS records for this allocation.', state: 'ambiguous' };
  if (legacyIds.length === 1) {
    const record = salesforce.liveById.get(legacyIds[0]);
    if (!record) return { issue: 'The legacy Salesforce SWAPS record is missing. It will not be recreated automatically.', state: 'missing' };
    if (!matchesAllocation(record, allocation, config)) return { issue: 'The legacy Salesforce SWAPS record does not match the paper hedge STEM, Product, venue supplier, and record mapping.', state: 'ambiguous' };
    return { record, state: 'legacy_adopted' };
  }
  if (exact.length > 1) return { issue: 'Multiple Salesforce SWAPS records match this paper hedge allocation.', state: 'ambiguous' };
  if (exact.length === 1) return { record: exact[0], state: 'ready' };
  return { record: null, state: 'ready' };
}

async function persistPreview(client, profile, swap, rows) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  const payload = rows.map((row) => ({
    paper_hedge_id: swap.id,
    salesforce_stem_id: row.salesforceStemId,
    stem_key_snapshot: row.stemKey,
    venue: row.venue,
    supplier_account_id: row.supplierAccountId,
    supplier_name_snapshot: row.supplierName,
    salesforce_record_id: row.salesforceRecordId,
    salesforce_record_name: row.salesforceRecordName,
    salesforce_last_modified_at: row.salesforceLastModifiedAt,
    allocation_percentage: row.allocationPercentage,
    gross_pnl: row.grossPnl,
    fee_amount: row.feeAmount,
    net_pnl: row.netPnl,
    salesforce_cost: row.salesforceCost,
    calculation_snapshot: row.calculationSnapshot,
    mapping_revision: row.mappingRevision,
    sync_state: row.syncState,
    review_issue: row.reviewIssue,
    updated_at: now,
    updated_by: profile.id,
    updated_by_email: profile.email,
    created_by: profile.id,
    created_by_email: profile.email,
  }));
  const saved = await client.from('hedge_salesforce_allocations').upsert(payload, { onConflict: 'paper_hedge_id,salesforce_stem_id' });
  if (saved.error) throw failure(`Hedge Salesforce allocation preview could not be saved: ${saved.error.message}`, 502);
}

function mappingResponse(config, identities) {
  return {
    mappingRevision: Number(config.mappingRevision || config.settingsRevision || 1),
    object: { apiName: config.objectName, label: 'STEM Extra Cost' },
    product: { id: identities.product.Id, name: identities.product.Name, active: identities.product.IsActive === true },
    recordType: { id: identities.recordType.Id, name: identities.recordType.Name, active: identities.recordType.IsActive === true },
    venues: Object.fromEntries(VENUES.map((venue) => [venue, {
      supplier: { id: identities.suppliers[venue].Id, name: identities.suppliers[venue].Name, clKey: identities.suppliers[venue].Company_Code__c || '' },
      newRecordPaymentTerm: config.venues[venue].paymentTerm,
    }])),
    instanceUrl: identities.instanceUrl,
    validatedAt: new Date().toISOString(),
  };
}

export async function getHedgeSalesforceMapping(client) {
  const { config, identities } = await loadValidatedHedgeSalesforceMapping(client);
  return mappingResponse(config, identities);
}

export async function previewHedgeSalesforce(client, profile, body = {}, { persist = true } = {}) {
  const inputs = await loadInputs(client, body.swapId);
  if (body.expectedRevision != null && Number(body.expectedRevision) !== Number(inputs.swap.revision)) throw failure('The paper hedge changed after it was opened. Refresh before previewing Salesforce synchronization.', 409, 'REVISION_CONFLICT');
  const config = await mapping(client);
  const identities = await validateMapping(config);
  const financials = await loadFinalFinancials(client, inputs);
  const grouped = groupPhysicals(inputs);
  const previousResult = await client.from('hedge_salesforce_allocations').select('*').eq('paper_hedge_id', inputs.swap.id);
  if (previousResult.error) throw failure(`Existing Hedge Salesforce allocations could not be loaded: ${previousResult.error.message}`, 502);
  const previousByStem = new Map((previousResult.data || []).map((row) => [row.salesforce_stem_id, row]));
  const salesforce = await resolveSalesforceRows(config, identities, grouped.rows, previousResult.data || []);
  const amountAllocations = allocateHedgeSalesforceAmounts({ grossPnl: financials.grossPnl, feeAmount: financials.feeAmount, shares: grouped.rows.map((row) => row.share) });
  const rows = grouped.rows.flatMap((group, index) => {
    const stem = salesforce.stemRows.get(group.stemKey);
    if (!stem) return [];
    const venue = VENUES.includes(inputs.swap.venue) ? inputs.swap.venue : null;
    if (!venue) return [];
    const supplier = identities.suppliers[venue];
    const base = {
      stemKey: group.stemKey,
      salesforceStemId: stem.Id,
      venue,
      supplierAccountId: supplier.Id,
      supplierName: supplier.Name,
      supplierClKey: supplier.Company_Code__c || '',
      allocationPercentage: Math.round(group.share * 100000000) / 1000000,
      grossPnl: amountAllocations[index].grossPnl,
      feeAmount: amountAllocations[index].feeAmount,
      netPnl: amountAllocations[index].netPnl,
      salesforceCost: amountAllocations[index].salesforceCost,
      mappingRevision: Number(config.mappingRevision || config.settingsRevision || 1),
    };
    const selected = chooseRecord({ allocation: base, group, previous: previousByStem.get(stem.Id), salesforce, config });
    const record = selected.record || null;
    const description = `FCOS final ${venue} hedge P&L ${base.netPnl.toFixed(2)} USD; ${base.allocationPercentage.toFixed(4)}% allocated to ${group.stemKey}`.slice(0, 255);
    return [{
      ...base,
      action: record ? 'update' : 'create',
      salesforceRecordId: record?.Id || null,
      salesforceRecordName: record?.Name || null,
      salesforceLastModifiedAt: record?.LastModifiedDate || null,
      existingPaymentTerm: record?.[config.paymentTermField] || null,
      description,
      syncState: selected.state,
      reviewIssue: selected.issue || null,
      calculationSnapshot: {
        paperHedgeRevision: Number(inputs.swap.revision),
        physicalTradeIds: group.physicals.map((row) => row.id),
        physicalMidpointQuantity: group.weight,
        grossPnl: base.grossPnl,
        fees: base.feeAmount,
        netPnl: base.netPnl,
        salesforceCost: base.salesforceCost,
        contractMonths: financials.months,
        description,
      },
    }];
  });
  const issues = [...new Set([
    ...financials.issues,
    ...grouped.issues,
    ...salesforce.issues,
    ...(!VENUES.includes(inputs.swap.venue) ? [`Salesforce synchronization supports only ICE or FCBS, not ${inputs.swap.venue || 'an empty venue'}.`] : []),
    ...rows.map((row) => row.reviewIssue).filter(Boolean),
    ...(rows.length > MAX_ALLOCATIONS ? [`A paper hedge may synchronize at most ${MAX_ALLOCATIONS} Salesforce STEM allocations at once.`] : []),
  ])];
  const previewFingerprint = fingerprint({
    swapId: inputs.swap.id,
    revision: inputs.swap.revision,
    grossPnl: financials.grossPnl,
    feeAmount: financials.feeAmount,
    netPnl: financials.netPnl,
    rows: rows.map((row) => ({ stem: row.salesforceStemId, record: row.salesforceRecordId, modified: row.salesforceLastModifiedAt, cost: row.salesforceCost, mapping: row.mappingRevision })),
  });
  if (persist) await persistPreview(client, profile, inputs.swap, rows);
  return {
    ready: issues.length === 0 && rows.length > 0,
    paperHedge: { id: inputs.swap.id, revision: Number(inputs.swap.revision), venue: inputs.swap.venue, product: inputs.swap.product, expired: inputs.swap.is_expired === true },
    mapping: mappingResponse(config, identities),
    financials: { grossPnl: financials.grossPnl, fees: financials.feeAmount, netPnl: financials.netPnl, salesforceCost: financials.salesforceCost, contractMonths: financials.months },
    allocations: rows,
    issues,
    previewFingerprint,
    calculatedAt: new Date().toISOString(),
  };
}

async function reserve(client, profile, body) {
  const key = String(body.idempotencyKey || '').trim();
  if (!key) throw failure('A Hedge Desk Salesforce idempotency key is required.');
  const requestHash = fingerprint({ swapId: body.swapId, expectedRevision: body.expectedRevision, previewFingerprint: body.previewFingerprint });
  const existing = await client.from('hedge_integration_operations').select('*').eq('idempotency_key', key).maybeSingle();
  if (existing.error) throw failure(`Salesforce operation could not be checked: ${existing.error.message}`, 502);
  if (existing.data) {
    if (existing.data.request_hash !== requestHash) throw failure('This Salesforce operation key was already used for different data.', 409);
    if (existing.data.status === 'succeeded') return { replay: existing.data.response };
    if (['processing', 'uncertain'].includes(existing.data.status)) throw failure('This Salesforce operation is already running or requires review.', 409);
  }
  const payload = { idempotency_key: key, operation: 'hedge_salesforce_allocation_sync', actor_user_id: profile.id, actor_email: profile.email, request_hash: requestHash, status: 'processing', error: null };
  const write = existing.data
    ? await client.from('hedge_integration_operations').update(payload).eq('id', existing.data.id).select('*').single()
    : await client.from('hedge_integration_operations').insert(payload).select('*').single();
  if (write.error) throw failure(`Salesforce operation could not be reserved: ${write.error.message}`, 502);
  return { operation: write.data };
}

export async function pushHedgeSalesforce(client, profile, body = {}) {
  const reservation = await reserve(client, profile, body);
  if (reservation.replay) return { ...reservation.replay, idempotencyReplayed: true };
  const operation = reservation.operation;
  let salesforceAccepted = false;
  try {
    const preview = await previewHedgeSalesforce(client, profile, body, { persist: true });
    if (preview.previewFingerprint !== body.previewFingerprint) throw failure('The Hedge Desk calculation or Salesforce records changed after preview. Review the refreshed allocation before synchronizing.', 409, 'HEDGE_SALESFORCE_PREVIEW_STALE', { preview });
    if (!preview.ready) throw failure('Salesforce synchronization is blocked until every preview issue is resolved.', 409, 'HEDGE_SALESFORCE_NOT_READY', { preview });
    const config = await mapping(client);
    const objectName = apiName(config.objectName, 'extra-cost object');
    const requests = preview.allocations.map((allocation, index) => {
      const bodyPayload = {
        [config.amountField]: allocation.salesforceCost,
        [config.descriptionField]: allocation.description,
        [config.uomField]: config.unitOfMeasure,
      };
      if (allocation.action === 'update') {
        return {
          method: 'PATCH',
          url: `/services/data/${getApiVersion()}/sobjects/${objectName}/${salesforceId(allocation.salesforceRecordId, 'SWAPS record ID')}`,
          referenceId: `allocation${index}`,
          body: bodyPayload,
        };
      }
      return {
        method: 'POST',
        url: `/services/data/${getApiVersion()}/sobjects/${objectName}`,
        referenceId: `allocation${index}`,
        body: {
          RecordTypeId: config.recordTypeId,
          [config.stemLookupField]: allocation.salesforceStemId,
          [config.productLookupField]: config.productId,
          [config.supplierLookupField]: allocation.supplierAccountId,
          [config.fixedField]: true,
          [config.quantityField]: Number(config.quantity || 1),
          [config.paymentTermField]: config.venues[allocation.venue].paymentTerm,
          ...bodyPayload,
        },
      };
    });
    const composite = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
    salesforceAccepted = true;
    const responses = composite.compositeResponse || [];
    const rejected = responses.find((response) => response.httpStatusCode < 200 || response.httpStatusCode >= 300);
    if (rejected) throw failure(rejected.body?.[0]?.message || rejected.body?.message || 'Salesforce rejected the Hedge allocation transaction.', rejected.httpStatusCode || 502, 'HEDGE_SALESFORCE_COMPOSITE_FAILED');
    const results = preview.allocations.map((allocation, index) => {
      const response = responses.find((item) => item.referenceId === `allocation${index}`) || responses[index];
      const recordId = allocation.salesforceRecordId || salesforceId(response?.body?.id, 'created SWAPS record ID');
      return { ...allocation, recordId, action: allocation.action === 'create' ? 'created' : 'updated' };
    });
    const now = new Date().toISOString();
    for (const result of results) {
      const saved = await client.from('hedge_salesforce_allocations').update({
        salesforce_record_id: result.recordId,
        sync_state: 'synced',
        review_issue: null,
        synced_at: now,
        synced_by: profile.id,
        synced_by_email: profile.email,
        updated_at: now,
        updated_by: profile.id,
        updated_by_email: profile.email,
      }).eq('paper_hedge_id', preview.paperHedge.id).eq('salesforce_stem_id', result.salesforceStemId);
      if (saved.error) throw failure(`Salesforce accepted the Hedge allocation, but FCOS could not confirm it: ${saved.error.message}`, 502, 'HEDGE_SALESFORCE_CONFIRMATION_FAILED');
    }
    const eventSaved = await client.from('hedge_events').insert({
      event_type: 'salesforce_allocations_synced',
      entity_type: 'SwapHedge',
      entity_id: preview.paperHedge.id,
      label: `${results.length} Salesforce hedge allocation(s) synchronized`,
      after_data: { grossPnl: preview.financials.grossPnl, fees: preview.financials.fees, netPnl: preview.financials.netPnl, allocationCount: results.length },
      metadata: { operationId: operation.id, mappingRevision: preview.mapping.mappingRevision },
      actor_user_id: profile.id,
      actor_email: profile.email,
    });
    if (eventSaved.error) throw failure(`Salesforce accepted the Hedge allocation, but FCOS could not save its audit event: ${eventSaved.error.message}`, 502, 'HEDGE_SALESFORCE_CONFIRMATION_FAILED');
    const response = { success: true, paperHedgeId: preview.paperHedge.id, financials: preview.financials, results: results.map((row) => ({ stemKey: row.stemKey, venue: row.venue, action: row.action, recordId: row.recordId, salesforceCost: row.salesforceCost })) };
    const operationSaved = await client.from('hedge_integration_operations').update({ status: 'succeeded', response, error: null }).eq('id', operation.id);
    if (operationSaved.error) throw failure(`Salesforce accepted the Hedge allocation, but FCOS could not finalize the operation: ${operationSaved.error.message}`, 502, 'HEDGE_SALESFORCE_CONFIRMATION_FAILED');
    await expireRuntimeCacheTags(['salesforce:stem', ...results.map((row) => `salesforce:stem:${row.salesforceStemId}`), 'salesforce:dashboard', 'salesforce:documents']);
    return response;
  } catch (error) {
    const uncertain = salesforceAccepted || /timeout|network|fetch failed/i.test(String(error?.message || ''));
    const tracked = await client.from('hedge_integration_operations').update({ status: uncertain ? 'uncertain' : 'failed', error: String(error?.code || error?.message || 'Salesforce failure').slice(0, 500) }).eq('id', operation.id);
    if (tracked.error) throw failure('The Salesforce outcome and its FCOS operation record could not be reconciled. Review Salesforce before retrying.', 502, 'HEDGE_SALESFORCE_TRACKING_FAILED');
    throw error;
  }
}
