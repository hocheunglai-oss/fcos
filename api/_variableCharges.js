import { createHash } from 'node:crypto';
import { requireExternalActionGate } from './_externalActionGates.js';
import { getApiVersion, getInstanceUrl, sfCompositeQueries, sfQuery, sfRequest } from './_salesforce.js';
import {
  ANCHORAGE_BUYER_CALCULATION_VERSION,
  ANCHORAGE_BUYER_RATE_USD_PER_NRT_HOUR,
  ANCHORAGE_CALCULATION_VERSION,
  ANCHORAGE_LOCATION_ELSEWHERE,
  calculateHongKongAnchorageDues,
} from '../src/lib/anchorageDues.js';
import {
  LIGHT_DUES_CALCULATION_VERSION,
  LIGHT_DUES_CATEGORY_ALL_OTHER,
  calculateHongKongLightDues,
  convertHkdToUsd,
  supplierDualCurrency,
} from '../src/lib/lightDues.js';
import {
  AGENCY_FEE,
  ANCHORAGE_DUES,
  BASIC_CALLING_COST,
  LEGACY_PORT_CLEARANCE_FEE,
  LIGHT_DUES,
  PORT_CLEARANCE_CALCULATION_VERSION,
  PORT_CLEARANCE_EXTENSION,
  PORT_CLEARANCE_RATE_HKD,
  basicCallingSequence,
  calculatePortClearance,
  isAgencyFee,
  isBasicCallingSupport,
  isPortClearanceExtension,
  normalizedChargeProduct,
} from '../src/lib/hongKongBasicCalling.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const VARIABLE_CHARGE_STEM_CREATED_FROM = '2026-01-01T00:00:00Z';
const VIEW_ONLY_USER_TYPES = new Set(['finance', 'administrator', 'general_manager']);
const CASE_SELECT = [
  'id', 'stem_id', 'stem_name', 'workflow_status', 'confirmation_status',
  'delivery_date', 'due_date', 'revision', 'assigned_buyer_user_id',
  'assigned_buyer_name', 'assigned_buyer_email', 'assignment_source',
  'override_expires_at', 'source_fingerprint', 'supplier_fingerprint',
  'salesforce_stem_last_modified_at', 'invoice_state', 'post_invoice_detected_at',
  'post_invoice_resolution', 'post_invoice_reference', 'created_at', 'updated_at',
].join(',');
const HK_HOLIDAY_CACHE = new Map();
const VARIABLE_CHARGE_SCHEDULE_FIELDS = [
  'ETA_Start_Date__c', 'ETA_End_Date__c',
  'ETB_Start_Date__c', 'ETB_End_Date__c',
  'ETCD_Start_Date__c', 'ETCD_End_Date__c',
  'ETD_Start_Date__c', 'ETD_End_Date__c',
];
const SIMPLE_QUEUE_NAMES = new Set(['my_tasks', 'waiting', 'ready_for_invoice', 'completed', 'all_cases']);
const SUPPLIER_REVIEW_OUTCOMES = new Set(['correct', 'changed', 'cancelled']);

function pairedWorkflowEnabled() {
  return String(process.env.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED || '').trim().toLowerCase() === 'true';
}

function httpError(message, status = 400, code = 'VARIABLE_CHARGE_ERROR', details) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  error.expose = status < 500;
  if (details !== undefined) error.details = details;
  return error;
}

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function apexUtcTimestamp(value, { required = false, label = 'Salesforce record' } = {}) {
  const raw = text(value, 80);
  if (!raw) {
    if (required) throw httpError(`${label} timestamp is unavailable. Refresh and try again.`, 409, 'SALESFORCE_TIMESTAMP_UNAVAILABLE');
    return null;
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    throw httpError(`${label} timestamp is invalid. Refresh and try again.`, 409, 'SALESFORCE_TIMESTAMP_INVALID');
  }
  return new Date(timestamp).toISOString();
}

function isAnchorageDuesRow(row) {
  const productName = text(row?.Product2Id__r?.Name || row?.Product__r?.Name, 255)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toUpperCase();
  return productName === 'ANCHORAGE DUE' || productName === 'ANCHORAGE DUES';
}

function isLightDuesRow(row) {
  if (row?.Product2Id__r?.IsActive === false || row?.Product__r?.IsActive === false) return false;
  const productName = text(row?.Product2Id__r?.Name || row?.Product__r?.Name, 255)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toUpperCase();
  return productName === 'LIGHT DUES';
}

function rowProductName(row) {
  return text(row?.Product2Id__r?.Name || row?.Product__r?.Name, 255);
}

function isManagedBasicCallingRow(row) {
  return row?.Hong_Kong_Bundle_Managed__c === true && isBasicCallingSupport(rowProductName(row));
}

function basicCallingSupplierIds(live) {
  if (!isHongKongStem(live?.stem)) return new Set();
  return new Set((live?.extraCosts || [])
    .filter((row) => row?.Supplier__c && normalizedChargeProduct(rowProductName(row)) === BASIC_CALLING_COST)
    .map((row) => row.Supplier__c));
}

function isBasicCallingBundleSupportRow(row, supplierIds) {
  return Boolean(row?.Supplier__c && supplierIds?.has(row.Supplier__c) && isBasicCallingSupport(rowProductName(row)));
}

function isAgencyFeeRow(row) {
  return isAgencyFee(rowProductName(row));
}

function isPortClearanceRow(row) {
  return isPortClearanceExtension(rowProductName(row));
}

function displayChargeProductName(value) {
  return canonicalChargeProduct(value) === PORT_CLEARANCE_EXTENSION
    ? PORT_CLEARANCE_EXTENSION
    : value;
}

function canonicalChargeProduct(value) {
  const normalized = normalizedChargeProduct(value);
  return normalized === LEGACY_PORT_CLEARANCE_FEE ? PORT_CLEARANCE_EXTENSION : normalized;
}

function configuredAgentCurrency(account) {
  if (account?.Is_Agent__c !== true) return null;
  const currency = text(account?.Agency_Fee_Currency__c, 3).toUpperCase();
  return ['USD', 'HKD'].includes(currency) ? currency : null;
}

function requiredAgentCurrency(live, supplierId) {
  const account = (live?.accounts || []).find((row) => row.Id === supplierId);
  if (account?.Is_Agent__c !== true) return null;
  const currency = configuredAgentCurrency(account);
  if (!currency) {
    throw httpError('Set the Agreed Agency Fee Currency on the supplier Account before reviewing its costs.', 409, 'AGENT_COST_CURRENCY_UNAVAILABLE');
  }
  return currency;
}

function isHongKongStem(stem) {
  const values = [stem?.Port__r?.Name, stem?.Port__r?.Country__c]
    .map((value) => text(value, 255).normalize('NFKC').replace(/\s+/g, ' ').toUpperCase())
    .filter(Boolean);
  return values.some((value) => value === 'HONG KONG' || value === 'HK');
}

function normalizedEmail(value) {
  return text(value, 320).toLowerCase();
}

function normalizedName(value) {
  return text(value, 320)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function quotedIds(values) {
  return [...new Set((values || []).filter((value) => SALESFORCE_ID.test(String(value || ''))))]
    .map((value) => `'${escapeSoql(value)}'`)
    .join(',');
}

function chunks(values, size = 180) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function queryAll(soql, options = {}) {
  const result = await sfQuery(soql, { limit: options.limit || 50_000, softFail: false });
  return result.records || [];
}

async function queryIds(objectName, fields, ids, suffix = '') {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const results = await sfCompositeQueries(chunks(uniqueIds).map((group) => ({
    soql: `SELECT ${fields} FROM ${objectName} WHERE Id IN (${quotedIds(group)}) ${suffix}`,
    limit: 50_000,
  })));
  return results.flatMap((result) => result.records || []);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function isoDate(value) {
  const match = text(value, 40).match(/^\d{4}-\d{2}-\d{2}$/);
  return match ? match[0] : null;
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hongKongToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function hongKongDateOnly(value) {
  const dateOnly = isoDate(value);
  if (dateOnly) return dateOnly;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

export function variableChargeActionability(liveCase, today = hongKongToday()) {
  const stem = liveCase?.stem || liveCase || {};
  const hasProductLineItems = liveCase?.hasProductLineItems === true
    || (Array.isArray(liveCase?.allLineItems) && liveCase.allLineItems.length > 0);
  if (hasProductLineItems) {
    const basisDate = isoDate(stem.Delivery_Date__c);
    const actionableOn = basisDate ? addUtcDays(basisDate, 1) : null;
    return {
      hasProductLineItems: true,
      deliveryRequired: true,
      actionBasis: 'delivery_date',
      actionBasisDate: basisDate,
      actionableOn,
      ready: Boolean(actionableOn && today >= actionableOn),
    };
  }
  const scheduleDates = VARIABLE_CHARGE_SCHEDULE_FIELDS
    .map((field) => isoDate(stem[field]))
    .filter(Boolean)
    .sort();
  const latestScheduleDate = scheduleDates.at(-1) || null;
  const basisDate = latestScheduleDate || hongKongDateOnly(stem.CreatedDate);
  const actionableOn = basisDate ? addUtcDays(basisDate, 1) : null;
  return {
    hasProductLineItems: false,
    deliveryRequired: false,
    actionBasis: latestScheduleDate ? 'latest_schedule_date' : 'enquiry_created_date',
    actionBasisDate: basisDate,
    actionableOn,
    ready: Boolean(actionableOn && today >= actionableOn),
  };
}

function assertLiveActionable(liveCase) {
  const actionability = variableChargeActionability(liveCase);
  if (actionability.ready) return actionability;
  if (actionability.deliveryRequired) {
    throw httpError('Product-bearing Variable Charges become actionable only after the Salesforce Delivery Date.', 409, 'DELIVERY_NOT_COMPLETE');
  }
  throw httpError(
    actionability.actionableOn
      ? `Extra-cost-only Variable Charges become actionable on ${actionability.actionableOn}, one calendar day after the latest schedule basis.`
      : 'Extra-cost-only Variable Charges readiness could not be calculated from the schedule or Enquiry Created Date.',
    409,
    'SCHEDULE_NOT_COMPLETE',
  );
}

function isWeekend(value) {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function nextHongKongBusinessDay(deliveryDate, holidays = new Set()) {
  const normalized = isoDate(deliveryDate);
  if (!normalized) return null;
  let candidate = addUtcDays(normalized, 1);
  for (let guard = 0; guard < 20; guard += 1) {
    if (!isWeekend(candidate) && !holidays.has(candidate)) return candidate;
    candidate = addUtcDays(candidate, 1);
  }
  throw httpError('Hong Kong business-day calculation could not be completed.', 503, 'HK_BUSINESS_DAY_UNAVAILABLE');
}

async function hongKongHolidays(year) {
  const key = String(year);
  const cached = HK_HOLIDAY_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.dates;
  const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${encodeURIComponent(key)}/HK`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw httpError('Hong Kong public-holiday data is unavailable. Charge due dates were not guessed.', 503, 'HK_HOLIDAY_UNAVAILABLE');
  const rows = await response.json();
  const dates = new Set((Array.isArray(rows) ? rows : []).map((row) => isoDate(row?.date)).filter(Boolean));
  HK_HOLIDAY_CACHE.set(key, { dates, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  return dates;
}

async function dueDateForDelivery(deliveryDate) {
  const date = isoDate(deliveryDate);
  if (!date) return null;
  const years = new Set([Number(date.slice(0, 4)), Number(addUtcDays(date, 14).slice(0, 4))]);
  const dates = new Set();
  for (const year of years) for (const holiday of await hongKongHolidays(year)) dates.add(holiday);
  return nextHongKongBusinessDay(date, dates);
}

function isVariableChargeAccount(account) {
  return account?.Is_Agent__c === true || account?.Is_Variable__c === true;
}

function finalInvoice(invoice) {
  return invoice?.Proforma__c !== true && !/(?:^|-)CN(?:-|$)/i.test(text(invoice?.Name, 255));
}

function lineFingerprint(row) {
  return {
    kind: 'line_item', id: row.Id, supplierId: row.Original_Supplier__c,
    cancelled: row.Cancelled__c === true, productId: row.Product__c || null,
    quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
    quantityMax: row.Quantity_Max__c ?? null,
    uom: row.Unit_of_Measure__c || null, cost: row.Unit_Buy_At__c ?? null,
    price: row.Unit_Sell_At__c ?? null, totalCost: row.Total_Cost__c ?? null,
    totalPrice: row.Total_Price__c ?? null, paymentTerm: row.Payment_Term__c || null,
    currency: row.CurrencyIsoCode || null, unitSellAt: row.Unit_Sell_At__c || null,
    unitBuyAt: row.Unit_Buy_At__c || null, commissionCost: row.Commission_Cost__c ?? null,
  };
}

function extraFingerprint(row) {
  return {
    kind: 'extra_cost', id: row.Id, supplierId: row.Supplier__c,
    cancelled: row.Cancelled__c === true, productId: row.Product2Id__c || null,
    description: row.Description__c || null,
    quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
    quantityRangeMax: row.Quantity_Range_Max__c ?? null,
    uom: row.Unit_of_Measure__c || null, unitCost: row.Unit_Cost__c ?? null,
    unitPrice: row.Unit_Price__c ?? null, fixedCost: row.Lumpsum_Cost__c ?? null,
    fixedPrice: row.Lumpsum_Price__c ?? null, lineCost: row.Line_Total_Buy__c ?? null,
    linePrice: row.Line_Total__c ?? null, paymentTerm: row.Payment_Term__c || null,
    currency: row.CurrencyIsoCode || null, supplierInvoiceId: row.Supplier_Invoice__c || null,
    stemLineItemId: row.STEM_Line_Item__c || null, recordTypeId: row.RecordTypeId || null,
    hongKongBundle: row.Hong_Kong_Bundle_Managed__c === true ? {
      key: row.Hong_Kong_Bundle_Key__c || null,
      sourceId: row.Hong_Kong_Bundle_Source__c || null,
      sequence: row.Hong_Kong_Bundle_Sequence__c ?? null,
      portClearanceRateHkd: row.Port_Clearance_Rate_HKD__c ?? null,
      portClearanceVersion: row.Port_Clearance_Calculation_Version__c || null,
    } : null,
    ...(row.Supplier_Cost_USD_HKD_Rate__c != null ? { supplierCostEvidence: {
      inputCurrency: row.Supplier_Cost_Input_Currency__c || null,
      inputValue: row.Supplier_Cost_Input_Value__c ?? null,
      usdHkdRate: row.Supplier_Cost_USD_HKD_Rate__c,
      fxRevision: row.Supplier_Cost_FX_Settings_Revision__c ?? null,
    } } : {}),
    ...(row.Anchorage_Calculation_Version__c ? { anchorage: {
      arrival: row.Anchorage_Arrival__c || null,
      departure: row.Anchorage_Departure__c || null,
      location: row.Anchorage_Location__c || null,
      allocationHkd: row.Anchorage_Dues_Allocation_HKD__c ?? null,
      nrt: row.Anchorage_NRT_Snapshot__c ?? null,
      usdHkdRate: row.Anchorage_USD_HKD_Rate__c ?? null,
      fxRevision: row.Anchorage_FX_Settings_Revision__c ?? null,
      version: row.Anchorage_Calculation_Version__c,
      buyerDefaultUsd: row.Anchorage_Buyer_Default_USD__c ?? null,
      buyerRateUsd: row.Anchorage_Buyer_Rate_USD__c ?? null,
      buyerVersion: row.Anchorage_Buyer_Calc_Version__c || null,
    } } : {}),
    ...(row.Light_Dues_Calculation_Version__c ? { lightDues: {
      entryDate: row.Light_Dues_Entry_Date__c || null,
      category: row.Light_Dues_Category__c || null,
      nrt: row.Light_Dues_NRT_Snapshot__c ?? null,
      rateHkd: row.Light_Dues_Rate_HKD__c ?? null,
      amountHkd: row.Light_Dues_Amount_HKD__c ?? null,
      usdHkdRate: row.Light_Dues_USD_HKD_Rate__c ?? null,
      fxRevision: row.Light_Dues_FX_Settings_Revision__c ?? null,
      version: row.Light_Dues_Calculation_Version__c,
    } } : {}),
  };
}

function anchorageFingerprintActive(liveCase, supplierId = null) {
  return (liveCase.extraCosts || []).some((row) => (!supplierId || row.Supplier__c === supplierId)
    && isAnchorageDuesRow(row) && Boolean(row.Anchorage_Calculation_Version__c));
}

function statutoryFingerprintActive(liveCase, supplierId = null) {
  return (liveCase.extraCosts || []).some((row) => (!supplierId || row.Supplier__c === supplierId)
    && ((isAnchorageDuesRow(row) && row.Anchorage_Calculation_Version__c)
      || (isLightDuesRow(row) && row.Light_Dues_Calculation_Version__c)));
}

function liveFingerprint(liveCase) {
  return sha256({
    stemId: liveCase.stem.Id,
    ...(statutoryFingerprintActive(liveCase) ? { vesselNrt: liveCase.stem.Vessel__r?.NRT__c ?? null } : {}),
    deliveryDate: liveCase.stem.Delivery_Date__c || null,
    schedule: Object.fromEntries(VARIABLE_CHARGE_SCHEDULE_FIELDS.map((field) => [field, liveCase.stem[field] || null])),
    productLinePresence: (liveCase.allLineItems || []).map((row) => row.Id).sort(),
    stemFinancials: {
      accountId: liveCase.stem.Account__c || null,
      paymentTerm: liveCase.stem.Payment_Term__c || null,
      total: liveCase.stem.Total__c ?? null,
      costsTotal: liveCase.stem.Costs_Total__c ?? null,
      invoiceTotal: liveCase.stem.Total_Invoice_Amount__c ?? null,
      receivableBalance: liveCase.stem.Receivable_Balance__c ?? null,
      payableBalance: liveCase.stem.Payable_Balance__c ?? null,
      currency: liveCase.stem.CurrencyIsoCode || null,
    },
    accounts: liveCase.accounts.map((row) => ({
      id: row.Id,
      isAgent: row.Is_Agent__c === true,
      isVariable: row.Is_Variable__c === true,
      agencyFeeUsd: row.Agency_Fee_USD__c ?? null,
      agencyFeeAmount: row.Agency_Fee_USD__c ?? null,
      agencyFeeCurrency: row.Agency_Fee_Currency__c || 'USD',
      paymentTerm: row.Supplier_Payment_Term__c || null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    supplierStages: (liveCase.supplierStages || []).map((row) => ({ id: row.Id, supplierId: row.Supplier__c, manual: row.Manual_Review_Required__c === true, status: row.Supplier_Status__c, revision: row.Revision__c ?? null, fingerprint: row.Reviewed_Source_Fingerprint__c || null })).sort((a, b) => String(a.supplierId).localeCompare(String(b.supplierId))),
    nominations: liveCase.nominations.map((row) => ({ id: row.Id, trader: row.Buyer_Supplier_Trader__c || null, email: row.BT_ST_Email_Address__c || null, buyerConfirmation: row.Buyer_Confirmation__c || null })).sort((a, b) => a.id.localeCompare(b.id)),
    lineItems: liveCase.lineItems.map(lineFingerprint).sort((a, b) => a.id.localeCompare(b.id)),
    extraCosts: liveCase.extraCosts.map(extraFingerprint).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function supplierLiveFingerprint(liveCase, supplierId) {
  return sha256({
    ...(statutoryFingerprintActive(liveCase, supplierId) ? { vesselNrt: liveCase.stem.Vessel__r?.NRT__c ?? null } : {}),
    readiness: {
      deliveryDate: liveCase.stem.Delivery_Date__c || null,
      schedule: Object.fromEntries(VARIABLE_CHARGE_SCHEDULE_FIELDS.map((field) => [field, liveCase.stem[field] || null])),
      productLinePresence: (liveCase.allLineItems || []).map((row) => row.Id).sort(),
    },
    account: liveCase.accounts.filter((row) => row.Id === supplierId).map((row) => ({
      id: row.Id,
      isAgent: row.Is_Agent__c === true,
      isVariable: row.Is_Variable__c === true,
      agencyFeeUsd: row.Agency_Fee_USD__c ?? null,
      agencyFeeAmount: row.Agency_Fee_USD__c ?? null,
      agencyFeeCurrency: row.Agency_Fee_Currency__c || 'USD',
      paymentTerm: row.Supplier_Payment_Term__c || null,
    })),
    lineItems: liveCase.lineItems.filter((row) => row.Original_Supplier__c === supplierId).map((row) => ({
      kind: 'line_item', id: row.Id, supplierId: row.Original_Supplier__c,
      cancelled: row.Cancelled__c === true, productId: row.Product__c || null,
      quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
      quantityMax: row.Quantity_Max__c ?? null, uom: row.Unit_of_Measure__c || null,
      paymentTerm: row.Payment_Term__c || null, unitCost: row.Unit_Buy_At__c ?? null,
      totalCost: row.Total_Cost__c ?? null, commissionCost: row.Commission_Cost__c ?? null,
      currency: row.CurrencyIsoCode || null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    extraCosts: liveCase.extraCosts.filter((row) => row.Supplier__c === supplierId).map((row) => ({
      kind: 'extra_cost', id: row.Id, supplierId: row.Supplier__c,
      cancelled: row.Cancelled__c === true, productId: row.Product2Id__c || null,
      description: row.Description__c || null, stemLineItemId: row.STEM_Line_Item__c || null,
      quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
      quantityRangeMax: row.Quantity_Range_Max__c ?? null, uom: row.Unit_of_Measure__c || null,
      paymentTerm: row.Payment_Term__c || null, unitCost: row.Unit_Cost__c ?? null,
      fixedCost: row.Lumpsum_Cost__c ?? null, lineCost: row.Line_Total_Buy__c ?? null,
      supplierInvoiceId: row.Supplier_Invoice__c || null, currency: row.CurrencyIsoCode || null,
      ...(row.Supplier_Cost_USD_HKD_Rate__c != null ? { supplierCostEvidence: {
        inputCurrency: row.Supplier_Cost_Input_Currency__c || null,
        inputValue: row.Supplier_Cost_Input_Value__c ?? null,
        usdHkdRate: row.Supplier_Cost_USD_HKD_Rate__c,
        fxRevision: row.Supplier_Cost_FX_Settings_Revision__c ?? null,
      } } : {}),
      ...(row.Anchorage_Calculation_Version__c ? { anchorage: extraFingerprint(row).anchorage } : {}),
      ...(row.Light_Dues_Calculation_Version__c ? { lightDues: extraFingerprint(row).lightDues } : {}),
      ...(row.Hong_Kong_Bundle_Managed__c ? { hongKongBundle: extraFingerprint(row).hongKongBundle } : {}),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function buyerChargeLiveFingerprint(liveCase, supplierId) {
  return sha256({
    ...(statutoryFingerprintActive(liveCase, supplierId) ? { vesselNrt: liveCase.stem.Vessel__r?.NRT__c ?? null } : {}),
    readiness: {
      deliveryDate: liveCase.stem.Delivery_Date__c || null,
      schedule: Object.fromEntries(VARIABLE_CHARGE_SCHEDULE_FIELDS.map((field) => [field, liveCase.stem[field] || null])),
      productLinePresence: (liveCase.allLineItems || []).map((row) => row.Id).sort(),
    },
    account: liveCase.accounts.filter((row) => row.Id === supplierId).map((row) => ({
      id: row.Id, isAgent: row.Is_Agent__c === true, isVariable: row.Is_Variable__c === true,
      agencyFeeUsd: row.Agency_Fee_USD__c ?? null,
      agencyFeeAmount: row.Agency_Fee_USD__c ?? null,
      agencyFeeCurrency: row.Agency_Fee_Currency__c || 'USD',
    })),
    lineItems: liveCase.lineItems.filter((row) => row.Original_Supplier__c === supplierId).map((row) => ({
      kind: 'line_item', id: row.Id, supplierId: row.Original_Supplier__c,
      cancelled: row.Cancelled__c === true, productId: row.Product__c || null,
      quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
      quantityMax: row.Quantity_Max__c ?? null, uom: row.Unit_of_Measure__c || null,
      unitPrice: row.Unit_Sell_At__c ?? null, totalPrice: row.Total_Price__c ?? null,
      currency: row.CurrencyIsoCode || null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    extraCosts: liveCase.extraCosts.filter((row) => row.Supplier__c === supplierId).map((row) => ({
      kind: 'extra_cost', id: row.Id, supplierId: row.Supplier__c,
      cancelled: row.Cancelled__c === true, productId: row.Product2Id__c || null,
      description: row.Description__c || null, stemLineItemId: row.STEM_Line_Item__c || null,
      quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
      quantityRangeMax: row.Quantity_Range_Max__c ?? null, uom: row.Unit_of_Measure__c || null,
      unitPrice: row.Unit_Price__c ?? null, fixedPrice: row.Lumpsum_Price__c ?? null,
      linePrice: row.Line_Total__c ?? null, currency: row.CurrencyIsoCode || null,
      ...(row.Anchorage_Calculation_Version__c ? { anchorage: extraFingerprint(row).anchorage } : {}),
      ...(row.Light_Dues_Calculation_Version__c ? { lightDues: extraFingerprint(row).lightDues } : {}),
      ...(row.Hong_Kong_Bundle_Managed__c ? { hongKongBundle: extraFingerprint(row).hongKongBundle } : {}),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function buyerAggregateFingerprint(liveCase) {
  return sha256({
    stemId: liveCase.stem.Id,
    suppliers: (liveCase.supplierRequirements || []).map((requirement) => ({
      supplierId: requirement.supplierId,
      fingerprint: buyerChargeLiveFingerprint(liveCase, requirement.supplierId),
    })).sort((a, b) => a.supplierId.localeCompare(b.supplierId)),
  });
}

async function activeProfileDirectory(client) {
  const { data, error } = await client.from('user_profiles').select('id,email,full_name,user_type,active').eq('active', true);
  if (error) throw error;
  return data || [];
}

async function salesforceUserEmails(traderNames) {
  const names = [...new Set((traderNames || []).map(text).filter(Boolean))];
  if (!names.length) return new Map();
  const rows = [];
  for (const group of chunks(names, 100)) {
    rows.push(...await queryAll(`SELECT Id, Name, Email FROM User WHERE IsActive = true AND Name IN (${group.map((name) => `'${escapeSoql(name)}'`).join(',')})`));
  }
  const byName = new Map();
  for (const row of rows) {
    const key = normalizedName(row.Name);
    const list = byName.get(key) || [];
    list.push(normalizedEmail(row.Email));
    byName.set(key, list.filter(Boolean));
  }
  return byName;
}

function uniqueMatch(rows, predicate) {
  const matches = rows.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

async function resolveAssignments(client, liveCases) {
  const profiles = await activeProfileDirectory(client);
  const traderNames = liveCases.flatMap((entry) => entry.nominations.map((row) => row.Buyer_Supplier_Trader__c));
  const sfEmails = await salesforceUserEmails(traderNames);
  for (const entry of liveCases) {
    const identities = [];
    for (const nomination of entry.nominations) {
      const name = text(nomination.Buyer_Supplier_Trader__c, 320);
      const formulaEmail = normalizedEmail(nomination.BT_ST_Email_Address__c);
      const emails = [...new Set([formulaEmail, ...(sfEmails.get(normalizedName(name)) || [])].filter(Boolean))];
      identities.push({ name, emails });
    }
    const identityKeys = new Set(identities.map((item) => `${normalizedName(item.name)}|${item.emails.sort().join(',')}`));
    if (!identities.length) {
      entry.assignment = { status: 'missing_nomination', message: 'No active Buyer Confirmation trader is assigned.' };
      continue;
    }
    if (identityKeys.size !== 1) {
      entry.assignment = { status: 'ambiguous_nomination', message: 'Active Buyer Confirmations disagree on the Buyer Trader.' };
      continue;
    }
    const identity = identities[0];
    let profile = null;
    let matchedBy = null;
    for (const email of identity.emails) {
      const byEmail = uniqueMatch(profiles, (row) => normalizedEmail(row.email) === email);
      if (byEmail) { profile = byEmail; matchedBy = 'email'; break; }
    }
    if (!profile) {
      profile = uniqueMatch(profiles, (row) => normalizedName(row.full_name) === normalizedName(identity.name));
      if (profile) matchedBy = 'name';
    }
    entry.assignment = profile ? {
      status: 'resolved', profileId: profile.id, name: profile.full_name || identity.name,
      email: profile.email || null, userType: profile.user_type || null, matchedBy,
    } : {
      status: 'unresolved_profile', name: identity.name,
      message: 'The Buyer Trader does not resolve to one active FCOS profile.',
    };
  }
}

async function resolveSupplierAssignments(client, liveCases) {
  const profiles = await activeProfileDirectory(client);
  const traderNames = liveCases.flatMap((entry) => (entry.supplierNominations || []).map((row) => row.Buyer_Supplier_Trader__c));
  const sfEmails = await salesforceUserEmails(traderNames);
  for (const entry of liveCases) {
    entry.supplierRequirements = entry.accounts.map((account) => {
      const nominations = (entry.supplierNominations || []).filter((row) => row.Account__c === account.Id);
      const identities = nominations.map((nomination) => {
        const name = text(nomination.Buyer_Supplier_Trader__c, 320);
        const formulaEmail = normalizedEmail(nomination.BT_ST_Email_Address__c);
        const emails = [...new Set([formulaEmail, ...(sfEmails.get(normalizedName(name)) || [])].filter(Boolean))].sort();
        return { name, emails };
      });
      const identityKeys = new Set(identities.map((item) => `${normalizedName(item.name)}|${item.emails.join(',')}`));
      const identity = identities[0] || { name: '', emails: [] };
      let profile = null;
      let matchedBy = null;
      if (identityKeys.size === 1) {
        for (const email of identity.emails) {
          profile = uniqueMatch(profiles, (row) => normalizedEmail(row.email) === email);
          if (profile) { matchedBy = 'email'; break; }
        }
        if (!profile && identity.name) {
          profile = uniqueMatch(profiles, (row) => normalizedName(row.full_name) === normalizedName(identity.name));
          if (profile) matchedBy = 'name';
        }
      }
      const stage = (entry.supplierStages || []).find((row) => row.Supplier__c === account.Id) || null;
      const assignmentStatus = !identities.length ? 'missing_nomination'
        : identityKeys.size !== 1 ? 'ambiguous_nomination'
          : profile ? 'resolved' : 'unresolved_profile';
      return {
        supplierId: account.Id,
        supplierName: account.Name,
        isAgent: account.Is_Agent__c === true,
        isVariable: account.Is_Variable__c === true,
        manualReviewRequired: stage?.Manual_Review_Required__c === true,
        effectiveRequired: isVariableChargeAccount(account) || stage?.Manual_Review_Required__c === true,
        requirementSource: account.Is_Agent__c === true
          ? 'Account · Is Agent'
          : account.Is_Variable__c === true ? 'Account · Is Variable' : 'Manual STEM selection',
        stageId: stage?.Id || null,
        status: stage?.Supplier_Status__c || 'Pending',
        revision: Number(stage?.Revision__c || 0),
        verifiedAt: stage?.Verified_At__c || null,
        lastModifiedAt: stage?.LastModifiedDate || null,
        reviewedSourceFingerprint: stage?.Reviewed_Source_Fingerprint__c || null,
        sourceFingerprint: supplierLiveFingerprint(entry, account.Id),
        buyerChargeStatus: stage?.Buyer_Charge_Status__c || 'Pending',
        buyerChargeRevision: Number(stage?.Buyer_Charge_Revision__c || 0),
        buyerChargeConfirmedAt: stage?.Buyer_Charge_Confirmed_At__c || null,
        buyerChargeReviewedSourceFingerprint: stage?.Buyer_Charge_Reviewed_Source_Fingerprint__c || null,
        buyerChargeSourceFingerprint: buyerChargeLiveFingerprint(entry, account.Id),
        assignmentStatus,
        assignmentMessage: assignmentStatus === 'resolved' ? null
          : assignmentStatus === 'missing_nomination' ? 'No active Supplier Nomination is assigned.'
            : assignmentStatus === 'ambiguous_nomination' ? 'Active Supplier Nominations disagree on the Supplier Trader.'
              : 'The Supplier Trader does not resolve to one active FCOS profile.',
        assignedSupplierTrader: profile ? {
          id: profile.id, name: profile.full_name || identity.name, email: profile.email || identity.emails[0] || null,
          matchedBy,
        } : { id: null, name: identity.name || null, email: identity.emails[0] || null, matchedBy: null },
      };
    }).filter((row) => row.effectiveRequired);
  }
}

function candidateWhere(stemIds, fieldName = 'STEM__c') {
  const ids = quotedIds(stemIds || []);
  return ids ? ` AND ${fieldName} IN (${ids})` : '';
}

function compareVariableChargeRows(a, b) {
  const aSequence = Number(a?.Hong_Kong_Bundle_Sequence__c ?? basicCallingSequence(rowProductName(a)) ?? 100);
  const bSequence = Number(b?.Hong_Kong_Bundle_Sequence__c ?? basicCallingSequence(rowProductName(b)) ?? 100);
  if (aSequence !== bSequence) return aSequence - bSequence;
  const aName = text(a?.Product__r?.Name || a?.Product2Id__r?.Name || a?.Description__c, 255).toLocaleLowerCase('en');
  const bName = text(b?.Product__r?.Name || b?.Product2Id__r?.Name || b?.Description__c, 255).toLocaleLowerCase('en');
  return aName.localeCompare(bName, 'en', { sensitivity: 'base' }) || text(a?.Id, 18).localeCompare(text(b?.Id, 18));
}

async function loadLiveCases({ client, stemIds = null, stemAccessCondition = null }) {
  const requested = stemIds ? [...new Set(stemIds.filter((id) => SALESFORCE_ID.test(String(id || ''))))] : null;
  if (stemIds && requested.length !== stemIds.length) throw httpError('A valid Salesforce STEM is required.', 400, 'INVALID_STEM_ID');
  const [allLineItems, allExtraCosts] = await Promise.all([
    queryAll(`SELECT Id, STEM__c, Original_Supplier__c, Product__c, Product__r.Name, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Unit_of_Measure__c, Unit_Sell_At__c, Unit_Buy_At__c, Total_Cost__c, Total_Price__c, Commission_Cost__c, Payment_Term__c, Buyer_Invoice__c, Supplier_Invoice__c, Cancelled__c, LastModifiedDate FROM STEM_Line_Item__c WHERE Cancelled__c = false AND STEM__r.CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${candidateWhere(requested)}`),
    queryAll(`SELECT Id, STEM__c, STEM_Line_Item__c, Supplier__c, Supplier_Invoice__c, Product2Id__c, Product2Id__r.Name, Product2Id__r.IsActive, Description__c, RecordTypeId, RecordType.Name, Fixed__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Range_Max__c, Unit_of_Measure__c, Unit_Cost__c, Unit_Price__c, Lumpsum_Cost__c, Lumpsum_Price__c, Line_Total_Buy__c, Line_Total__c, Payment_Term__c, Buyer_Invoice__c, Cancelled__c, Supplier_Cost_Input_Currency__c, Supplier_Cost_Input_Value__c, Supplier_Cost_USD_HKD_Rate__c, Supplier_Cost_FX_Settings_Revision__c, Anchorage_Arrival__c, Anchorage_Departure__c, Anchorage_Location__c, Anchorage_Dues_Allocation_HKD__c, Anchorage_NRT_Snapshot__c, Anchorage_USD_HKD_Rate__c, Anchorage_FX_Settings_Revision__c, Anchorage_Calculation_Version__c, Anchorage_Buyer_Default_USD__c, Anchorage_Buyer_Rate_USD__c, Anchorage_Buyer_Calc_Version__c, Light_Dues_Entry_Date__c, Light_Dues_Category__c, Light_Dues_NRT_Snapshot__c, Light_Dues_Rate_HKD__c, Light_Dues_Amount_HKD__c, Light_Dues_USD_HKD_Rate__c, Light_Dues_FX_Settings_Revision__c, Light_Dues_Calculation_Version__c, Hong_Kong_Bundle_Key__c, Hong_Kong_Bundle_Managed__c, Hong_Kong_Bundle_Sequence__c, Hong_Kong_Bundle_Source__c, Port_Clearance_Rate_HKD__c, Port_Clearance_Calculation_Version__c, LastModifiedDate FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND Supplier__c != null AND STEM__r.CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${candidateWhere(requested)}`),
  ]);
  const supplierStages = await queryAll(`SELECT Id, STEM__c, Supplier__c, Manual_Review_Required__c, Supplier_Status__c, Verified_At__c, Verified_By_Email__c, Reviewed_Source_Fingerprint__c, Revision__c, Buyer_Charge_Status__c, Buyer_Charge_Reviewed_Source_Fingerprint__c, Buyer_Charge_Confirmed_At__c, Buyer_Charge_Confirmed_By_Email__c, Buyer_Charge_Revision__c, LastModifiedDate FROM STEM_Variable_Charge_Supplier__c WHERE STEM__r.CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${candidateWhere(requested)}`);
  const supplierIds = [...new Set([
    ...allLineItems.map((row) => row.Original_Supplier__c),
    ...allExtraCosts.map((row) => row.Supplier__c), ...supplierStages.map((row) => row.Supplier__c),
  ].filter(Boolean))];
  const accounts = (await queryIds('Account', 'Id, Name, Is_Agent__c, Is_Variable__c, Agency_Fee_USD__c, Agency_Fee_Currency__c, Supplier_Payment_Term__c, Inactive_Suspended__c, LastModifiedDate', supplierIds))
    .filter((account) => account.Inactive_Suspended__c !== true);
  const accountMap = new Map(accounts.map((row) => [row.Id, row]));
  const manualPairKeys = new Set(supplierStages.filter((row) => row.Manual_Review_Required__c === true).map((row) => `${row.STEM__c}:${row.Supplier__c}`));
  const relevantLines = allLineItems.filter((row) => isVariableChargeAccount(accountMap.get(row.Original_Supplier__c)) || manualPairKeys.has(`${row.STEM__c}:${row.Original_Supplier__c}`));
  const relevantExtras = allExtraCosts.filter((row) => isVariableChargeAccount(accountMap.get(row.Supplier__c)) || manualPairKeys.has(`${row.STEM__c}:${row.Supplier__c}`));
  const detectedStemIds = [...new Set([...relevantLines, ...relevantExtras].map((row) => row.STEM__c).filter(Boolean))];
  const targetStemIds = requested || detectedStemIds;
  if (!targetStemIds.length) return [];
  const stemRows = [];
  for (const group of chunks(targetStemIds)) {
    const accessClause = stemAccessCondition ? ` AND (${stemAccessCondition})` : '';
    stemRows.push(...await queryAll(`SELECT Id, Name, KeyStem__c, Account__c, Account__r.Name, Vessel__c, Vessel__r.Name, Vessel__r.NRT__c, Vessel__r.LastModifiedDate, Port__c, Port__r.Name, Port__r.Country__c, CreatedDate, Delivery_Date__c, ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c, ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c, Payment_Term__c, Total__c, Costs_Total__c, Total_Invoice_Amount__c, Receivable_Balance__c, Payable_Balance__c, Variable_Charges_Confirmed__c, LastModifiedDate FROM STEM__c WHERE Id IN (${quotedIds(group)}) AND CreatedDate >= ${VARIABLE_CHARGE_STEM_CREATED_FROM}${accessClause}`));
  }
  const accessibleStemIds = new Set(stemRows.map((row) => row.Id));
  const [nominations, supplierNominations, invoices, supplierInvoices] = await Promise.all([
    accessibleStemIds.size ? queryAll(`SELECT Id, STEM__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c, Buyer_Confirmation__c, LastModifiedDate FROM Nomination__c WHERE STEM__c IN (${quotedIds([...accessibleStemIds])}) AND Deprecated__c = false AND RecordType.DeveloperName = 'Buyer'`) : [],
    accessibleStemIds.size ? queryAll(`SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c, LastModifiedDate FROM Nomination__c WHERE STEM__c IN (${quotedIds([...accessibleStemIds])}) AND Deprecated__c = false AND RecordType.DeveloperName = 'Supplier'`) : [],
    accessibleStemIds.size ? queryAll(`SELECT Id, Name, STEM__c, Proforma__c, Sent__c, File__c, LastModifiedDate FROM Invoice__c WHERE STEM__c IN (${quotedIds([...accessibleStemIds])})`) : [],
    accessibleStemIds.size ? queryAll(`SELECT Id, STEM__c, Supplier__c, LastModifiedDate FROM Supplier_Invoice__c WHERE STEM__c IN (${quotedIds([...accessibleStemIds])})`) : [],
  ]);
  const result = stemRows.map((stem) => {
    const stemLineItems = allLineItems.filter((row) => row.STEM__c === stem.Id).sort(compareVariableChargeRows);
    const lineItems = relevantLines.filter((row) => row.STEM__c === stem.Id).sort(compareVariableChargeRows);
    const extraCosts = relevantExtras.filter((row) => row.STEM__c === stem.Id).sort(compareVariableChargeRows);
    const usedAccountIds = new Set([...lineItems.map((row) => row.Original_Supplier__c), ...extraCosts.map((row) => row.Supplier__c)]);
    const entry = {
      stem, lineItems, extraCosts, allLineItems: stemLineItems,
      accounts: [...usedAccountIds].map((id) => accountMap.get(id)).filter(Boolean),
      nominations: nominations.filter((row) => row.STEM__c === stem.Id),
      supplierNominations: supplierNominations.filter((row) => row.STEM__c === stem.Id && usedAccountIds.has(row.Account__c)),
      supplierStages: supplierStages.filter((row) => row.STEM__c === stem.Id && usedAccountIds.has(row.Supplier__c)),
      invoices: invoices.filter((row) => row.STEM__c === stem.Id),
      supplierInvoices: supplierInvoices.filter((row) => row.STEM__c === stem.Id && usedAccountIds.has(row.Supplier__c)),
      hasVariableCharges: lineItems.length > 0 || extraCosts.length > 0,
      hasShipAgent: lineItems.length > 0 || extraCosts.length > 0,
      hasProductLineItems: stemLineItems.length > 0,
    };
    entry.fingerprint = liveFingerprint(entry);
    return entry;
  });
  await resolveAssignments(client, result);
  await resolveSupplierAssignments(client, result);
  for (const entry of result) entry.buyerFingerprint = buyerAggregateFingerprint(entry);
  return result;
}

function effectiveAssignee(row) {
  return {
    id: row?.assigned_buyer_user_id,
    name: row?.assigned_buyer_name,
    email: row?.assigned_buyer_email,
  };
}

async function activeGeneralManager(client, userId) {
  const { data, error } = await client.from('collaboration_roles').select('user_id').eq('role', 'general_manager').eq('active', true);
  if (error) throw error;
  const ids = [...new Set((data || []).map((row) => row.user_id).filter(Boolean))];
  let activeProfile = null;
  if (userId) {
    const result = await client.from('user_profiles').select('id,user_type,active').eq('id', userId).eq('active', true).maybeSingle();
    if (result.error) throw result.error;
    activeProfile = result.data;
  }
  return {
    isGeneralManager: ids.length === 1 && ids[0] === userId && text(activeProfile?.user_type, 100).toLowerCase() === 'general_manager',
    configured: ids.length === 1,
  };
}

function capabilitiesFor(row, profile, gm) {
  const assignee = effectiveAssignee(row);
  const normalEditor = assignee.id === profile?.id && !VIEW_ONLY_USER_TYPES.has(text(profile?.user_type, 100).toLowerCase());
  return {
    canView: true,
    canEdit: normalEditor,
    canConfirm: normalEditor,
    canGmOverride: gm.isGeneralManager,
    canResolvePostInvoice: normalEditor || gm.isGeneralManager,
    readOnlyReason: normalEditor || gm.isGeneralManager ? null : (assignee.name ? `Assigned to ${assignee.name}.` : 'No active FCOS Buyer Trader is resolved.'),
  };
}

function deriveStatus(live, stored, today = hongKongToday()) {
  const finals = live.invoices.filter(finalInvoice);
  if (!pairedWorkflowEnabled()) {
    const sourceChanged = Boolean(stored?.source_fingerprint && stored.source_fingerprint !== live.fingerprint);
    const confirmed = live.stem.Variable_Charges_Confirmed__c === true
      && stored?.confirmation_status === 'confirmed' && !sourceChanged;
    if (finals.length && (sourceChanged || stored?.workflow_status === 'post_invoice_change')) return 'post_invoice_changes';
    if (!live.hasVariableCharges) return 'completed';
    if (!variableChargeActionability(live, today).ready) return 'awaiting_delivery';
    if ((live.supplierRequirements || []).some((row) => row.assignmentStatus !== 'resolved' || row.status !== 'Verified')) return 'needs_action';
    if (live.assignment?.status !== 'resolved') return 'needs_action';
    if (finals.length) return confirmed || stored?.post_invoice_resolution ? 'completed' : 'post_invoice_changes';
    if (confirmed) return 'ready_for_invoice';
    return 'needs_action';
  }
  const buyerSidesReady = (live.supplierRequirements || []).every((row) => row.buyerChargeStatus === 'Verified');
  const buyerChanged = (live.supplierRequirements || []).some((row) => row.buyerChargeStatus === 'Invalidated');
  const confirmed = live.stem.Variable_Charges_Confirmed__c === true && buyerSidesReady;
  if (finals.length && (buyerChanged || stored?.workflow_status === 'post_invoice_change')) return 'post_invoice_changes';
  if (!live.hasVariableCharges) return 'completed';
  if (!variableChargeActionability(live, today).ready) return 'awaiting_delivery';
  if (finals.length) return confirmed || stored?.post_invoice_resolution ? 'completed' : 'post_invoice_changes';
  if (confirmed) return 'ready_for_invoice';
  return 'needs_action';
}

function agencyFeeAccountDefault(account, settings) {
  const nativeAmount = finiteAmount(account?.Agency_Fee_USD__c);
  const inputCurrency = text(account?.Agency_Fee_Currency__c, 3).toUpperCase() || 'USD';
  const rate = finiteAmount(settings?.usdHkdRate);
  if (!(nativeAmount > 0) || !['USD', 'HKD'].includes(inputCurrency) || !(rate > 0)) return null;
  const usdAmount = inputCurrency === 'HKD' ? nativeAmount / rate : nativeAmount;
  return {
    inputCurrency,
    nativeAmount,
    rate,
    usdAmount: roundedSalesforceCurrency(usdAmount),
    fxSettingsRevision: settings?.revision ?? null,
  };
}

function serializeLiveRow(row, kind, settings = { usdHkdRate: null, revision: null }, options = {}) {
  const supplierId = kind === 'line_item' ? row.Original_Supplier__c : row.Supplier__c;
  const productId = kind === 'line_item' ? row.Product__c : row.Product2Id__c;
  const sourceProductName = kind === 'line_item' ? row.Product__r?.Name : row.Product2Id__r?.Name;
  const productName = displayChargeProductName(sourceProductName);
  const productKey = canonicalChargeProduct(sourceProductName);
  const supplierAccount = options.accountsById?.get(supplierId);
  const agentCurrency = configuredAgentCurrency(supplierAccount);
  const basicCallingBundleSupport = kind === 'extra_cost'
    && isBasicCallingBundleSupportRow(row, options.basicCallingSupplierIds);
  const accountAgencyFee = basicCallingBundleSupport && productKey === AGENCY_FEE
    ? agencyFeeAccountDefault(options.accountsById?.get(supplierId), settings)
    : null;
  const supplierRateUsd = accountAgencyFee?.usdAmount ?? (kind === 'line_item' ? row.Unit_Buy_At__c ?? null
    : row.Lumpsum_Cost__c ?? row.Unit_Cost__c ?? null);
  const supplierTotalUsd = accountAgencyFee?.usdAmount ?? (kind === 'line_item' ? row.Total_Cost__c ?? null : row.Line_Total_Buy__c ?? null);
  const recordedInputCurrency = kind === 'extra_cost' ? text(row.Supplier_Cost_Input_Currency__c, 3).toUpperCase() || null : null;
  const recordedInputValue = kind === 'extra_cost' ? row.Supplier_Cost_Input_Value__c ?? null : null;
  const recordedRateSnapshot = kind === 'extra_cost' ? row.Supplier_Cost_USD_HKD_Rate__c ?? null : null;
  const normalizeAgentCurrency = kind === 'extra_cost' && agentCurrency
    && (recordedInputCurrency !== agentCurrency || recordedInputValue == null);
  const supplierRateSnapshot = accountAgencyFee?.rate
    ?? (normalizeAgentCurrency ? settings.usdHkdRate : recordedRateSnapshot);
  const supplierInputCurrency = accountAgencyFee?.inputCurrency
    ?? (normalizeAgentCurrency ? agentCurrency : recordedInputCurrency);
  const supplierInputValue = accountAgencyFee?.nativeAmount
    ?? (normalizeAgentCurrency && supplierRateUsd != null
      ? Math.round((agentCurrency === 'HKD' ? Number(supplierRateUsd) * Number(settings.usdHkdRate) : Number(supplierRateUsd)) * 1_000_000) / 1_000_000
      : recordedInputValue);
  const supplierRateDual = supplierDualCurrency({ usdAmount: supplierRateUsd, inputCurrency: supplierInputCurrency, inputAmount: supplierInputValue, savedRate: supplierRateSnapshot, currentRate: settings.usdHkdRate });
  const nativeSupplierTotal = kind === 'extra_cost' && supplierInputValue != null
    ? row.Lumpsum_Cost__c != null
      ? supplierInputValue
      : row.Quantity__c != null ? Number(supplierInputValue) * Number(row.Quantity__c) : null
    : null;
  const supplierTotalDual = supplierDualCurrency({ usdAmount: supplierTotalUsd, inputCurrency: supplierInputCurrency, inputAmount: nativeSupplierTotal, savedRate: supplierRateSnapshot, currentRate: settings.usdHkdRate });
  const managedBasicCallingBundle = kind === 'extra_cost' && isManagedBasicCallingRow(row);
  const portClearance = kind === 'extra_cost' && isPortClearanceRow(row)
    ? {
      ...calculatePortClearance({
        applicationCount: row.Quantity__c,
        usdHkdRate: supplierRateSnapshot || settings.usdHkdRate,
      }),
      savedRateHkd: row.Port_Clearance_Rate_HKD__c ?? null,
      savedCalculationVersion: row.Port_Clearance_Calculation_Version__c || null,
      fxSettingsRevision: row.Supplier_Cost_FX_Settings_Revision__c ?? null,
    }
    : null;
  const anchorageBuyerDefaultUsd = kind === 'extra_cost' && productKey === ANCHORAGE_DUES
    ? finiteAmount(row.Anchorage_Buyer_Default_USD__c)
    : null;
  const anchorageCurrentBuyerUsd = kind === 'extra_cost' && productKey === ANCHORAGE_DUES
    ? finiteAmount(row.Lumpsum_Price__c ?? row.Unit_Price__c)
    : null;
  const anchorageFormerPassThroughUsd = kind === 'extra_cost' && productKey === ANCHORAGE_DUES
    ? finiteAmount(row.Lumpsum_Cost__c ?? row.Unit_Cost__c)
    : null;
  const anchorageMatches = (left, right) => left != null && right != null && Math.abs(left - right) <= 0.005;
  const applyAnchorageBuyerDefault = anchorageBuyerDefaultUsd != null && (
    anchorageCurrentBuyerUsd == null || Math.abs(anchorageCurrentBuyerUsd) <= 0.005
    || anchorageMatches(anchorageCurrentBuyerUsd, anchorageFormerPassThroughUsd)
    || anchorageMatches(anchorageCurrentBuyerUsd, anchorageBuyerDefaultUsd)
  );
  const buyerDefault = productKey === BASIC_CALLING_COST
    ? { decision: 'include', unitOrFixedUsd: row.Lumpsum_Price__c ?? row.Unit_Price__c ?? null, totalUsd: row.Line_Total__c ?? null, locked: false }
    : basicCallingBundleSupport && (productKey === AGENCY_FEE || productKey === LIGHT_DUES)
      ? { decision: 'exclude', unitOrFixedUsd: 0, totalUsd: 0, locked: true }
      : basicCallingBundleSupport && productKey === PORT_CLEARANCE_EXTENSION && portClearance?.complete
        ? { decision: portClearance.additionalApplications > 0 ? 'include' : 'exclude', unitOrFixedUsd: portClearance.buyerTotalUsd, totalUsd: portClearance.buyerTotalUsd, locked: true }
      : productKey === ANCHORAGE_DUES && anchorageBuyerDefaultUsd != null
        ? {
          decision: 'include',
          unitOrFixedUsd: anchorageBuyerDefaultUsd,
          totalUsd: anchorageBuyerDefaultUsd,
          rateUsdPerNrtHour: row.Anchorage_Buyer_Rate_USD__c ?? null,
          calculationVersion: row.Anchorage_Buyer_Calc_Version__c || null,
          applyCalculatedDefault: applyAnchorageBuyerDefault,
          adjusted: anchorageCurrentBuyerUsd != null
            && !applyAnchorageBuyerDefault
            && !anchorageMatches(anchorageCurrentBuyerUsd, anchorageBuyerDefaultUsd),
          locked: false,
        }
        : null;
  return {
    id: row.Id, kind, supplierId, productId, productName: productName || null,
    description: kind === 'extra_cost' ? row.Description__c || null : null,
    fixed: kind === 'extra_cost' ? row.Fixed__c === true : false,
    quantity: row.Quantity__c ?? null, deliveredQuantity: row.Quantity_Delivered_Per_BDN__c ?? null,
    unitOfMeasure: row.Unit_of_Measure__c || null,
    cost: kind === 'line_item' ? row.Unit_Buy_At__c ?? null : row.Unit_Cost__c ?? null,
    price: kind === 'line_item' ? row.Unit_Sell_At__c ?? null : row.Unit_Price__c ?? null,
    fixedCost: row.Lumpsum_Cost__c ?? null, fixedPrice: row.Lumpsum_Price__c ?? null,
    lineCost: kind === 'line_item' ? row.Total_Cost__c ?? null : row.Line_Total_Buy__c ?? null,
    linePrice: kind === 'line_item' ? row.Total_Price__c ?? null : row.Line_Total__c ?? null,
    paymentTerm: row.Payment_Term__c || null, buyerInvoiceId: row.Buyer_Invoice__c || null,
    currency: row.CurrencyIsoCode || null, lastModifiedDate: row.LastModifiedDate || null,
    readOnly: kind === 'line_item', cancelled: row.Cancelled__c === true,
    managedBasicCallingBundle,
    basicCallingBundleSupport,
    bundleSequence: kind === 'extra_cost' ? row.Hong_Kong_Bundle_Sequence__c ?? basicCallingSequence(productName) : null,
    bundleSourceId: kind === 'extra_cost' ? row.Hong_Kong_Bundle_Source__c || null : null,
    supplierCostLocked: basicCallingBundleSupport && (isAgencyFeeRow(row) || isPortClearanceRow(row)),
    buyerDefault,
    portClearance,
    supplierCurrency: {
      inputCurrency: supplierInputCurrency || 'USD',
      inputAmount: supplierInputValue,
      requiredInputCurrency: agentCurrency,
      lockedToAgentCurrency: Boolean(agentCurrency),
      normalizedFromStoredUsd: normalizeAgentCurrency,
      usdHkdRate: supplierRateDual.rate,
      fxSettingsRevision: accountAgencyFee?.fxSettingsRevision
        ?? (kind === 'extra_cost' ? row.Supplier_Cost_FX_Settings_Revision__c ?? null : null),
      rateBasis: accountAgencyFee
        ? 'Account agreed fee · current company rate'
        : normalizeAgentCurrency ? 'Agent agreed currency · current company rate' : supplierRateDual.basis,
      unitOrFixed: supplierRateDual,
      total: supplierTotalDual,
    },
    anchorage: kind === 'extra_cost' && isAnchorageDuesRow(row) ? {
      arrival: row.Anchorage_Arrival__c || null,
      departure: row.Anchorage_Departure__c || null,
      location: row.Anchorage_Location__c || ANCHORAGE_LOCATION_ELSEWHERE,
      allocationHkd: row.Anchorage_Dues_Allocation_HKD__c ?? null,
      nrtSnapshot: row.Anchorage_NRT_Snapshot__c ?? null,
      usdHkdRate: row.Anchorage_USD_HKD_Rate__c ?? null,
      fxSettingsRevision: row.Anchorage_FX_Settings_Revision__c ?? null,
      calculationVersion: row.Anchorage_Calculation_Version__c || null,
      buyerDefaultUsd: row.Anchorage_Buyer_Default_USD__c ?? null,
      buyerRateUsd: row.Anchorage_Buyer_Rate_USD__c ?? null,
      buyerCalculationVersion: row.Anchorage_Buyer_Calc_Version__c || null,
    } : null,
    lightDues: kind === 'extra_cost' && isLightDuesRow(row) ? {
      entryDate: row.Light_Dues_Entry_Date__c || null,
      category: row.Light_Dues_Category__c || LIGHT_DUES_CATEGORY_ALL_OTHER,
      nrtSnapshot: row.Light_Dues_NRT_Snapshot__c ?? null,
      rateHkd: row.Light_Dues_Rate_HKD__c ?? null,
      amountHkd: row.Light_Dues_Amount_HKD__c ?? null,
      usdHkdRate: row.Light_Dues_USD_HKD_Rate__c ?? null,
      fxSettingsRevision: row.Light_Dues_FX_Settings_Revision__c ?? null,
      calculationVersion: row.Light_Dues_Calculation_Version__c || null,
    } : null,
  };
}

function finiteAmount(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extraCostFinancialAmount(row, side) {
  const fixed = finiteAmount(side === 'cost' ? row.Lumpsum_Cost__c : row.Lumpsum_Price__c);
  if (fixed != null) return fixed;
  const unit = finiteAmount(side === 'cost' ? row.Unit_Cost__c : row.Unit_Price__c);
  const quantity = finiteAmount(row.Quantity__c);
  if (unit != null && quantity != null) return unit * quantity;
  return finiteAmount(side === 'cost' ? row.Line_Total_Buy__c : row.Line_Total__c);
}

function buyerExtraCostFinancialAmount(row, { hongKongDelivery = false } = {}) {
  const actual = extraCostFinancialAmount(row, 'charge');
  if (!hongKongDelivery || !isAnchorageDuesRow(row)) return actual;
  const calculatedDefault = finiteAmount(row.Anchorage_Buyer_Default_USD__c);
  if (calculatedDefault == null) return actual;
  const supplierPassThrough = extraCostFinancialAmount(row, 'cost');
  const matches = (left, right) => left != null && right != null && Math.abs(left - right) <= 0.005;
  return actual == null || Math.abs(actual) <= 0.005
    || matches(actual, supplierPassThrough) || matches(actual, calculatedDefault)
    ? calculatedDefault
    : actual;
}

function financialSummary(live) {
  const stemCurrency = text(live.stem?.CurrencyIsoCode, 3).toUpperCase() || null;
  const hongKongDelivery = isHongKongStem(live.stem);
  const rows = [
    ...live.lineItems.map((row) => ({
      supplierId: row.Original_Supplier__c,
      cost: finiteAmount(row.Total_Cost__c),
      charge: finiteAmount(row.Total_Price__c),
      currency: text(row.CurrencyIsoCode, 3).toUpperCase() || stemCurrency,
    })),
    ...live.extraCosts.map((row) => ({
      supplierId: row.Supplier__c,
      cost: extraCostFinancialAmount(row, 'cost'),
      charge: buyerExtraCostFinancialAmount(row, { hongKongDelivery })
        ?? (hongKongDelivery && isLightDuesRow(row) ? 0 : null),
      currency: text(row.CurrencyIsoCode, 3).toUpperCase() || stemCurrency,
    })),
  ];
  const summarize = (selected) => {
    const currencies = [...new Set(selected.map((row) => row.currency).filter(Boolean))];
    const currency = stemCurrency || (currencies.length === 1 ? currencies[0] : 'USD');
    const currencyMismatch = currencies.some((value) => value !== currency) || currencies.length > 1;
    const costsComplete = !currencyMismatch && selected.every((row) => row.cost != null);
    const chargesComplete = !currencyMismatch && selected.every((row) => row.charge != null);
    const supplierCostTotal = costsComplete ? selected.reduce((sum, row) => sum + row.cost, 0) : null;
    const buyerChargeTotal = chargesComplete ? selected.reduce((sum, row) => sum + row.charge, 0) : null;
    return {
      supplierCostTotal,
      buyerChargeTotal,
      margin: supplierCostTotal != null && buyerChargeTotal != null ? buyerChargeTotal - supplierCostTotal : null,
      costsComplete,
      chargesComplete,
      currency,
      blockingReason: currencyMismatch ? 'Charge rows use different currencies and cannot be combined.'
        : !costsComplete ? 'One or more supplier totals are unavailable in Salesforce.'
          : !chargesComplete ? 'One or more buyer totals are unavailable in Salesforce.' : null,
      rowCount: selected.length,
    };
  };
  return {
    ...summarize(rows),
    currencyBasis: 'exact_row_currency',
    bySupplier: live.accounts.map((account) => ({
      supplierId: account.Id,
      supplierName: account.Name,
      ...summarize(rows.filter((row) => row.supplierId === account.Id)),
    })),
  };
}

function plainLanguageWorkflow(caseRow) {
  const requirements = caseRow.supplierRequirements || [];
  if (caseRow.pairedWorkflowEnabled !== true) {
    const pendingSuppliers = requirements.filter((row) => row.status !== 'Verified');
    const currentSupplier = pendingSuppliers.find((row) => row.canVerify) || pendingSuppliers[0] || null;
    const status = caseRow.status;
    const postInvoice = status === 'post_invoice_changes';
    const awaiting = status === 'awaiting_delivery';
    const supplierStep = pendingSuppliers.length > 0;
    const buyerStep = !supplierStep && status === 'needs_action' && !postInvoice;
    const isMyTask = postInvoice ? caseRow.capabilities?.canResolvePostInvoice === true
      : awaiting ? false : supplierStep ? pendingSuppliers.some((row) => row.canVerify)
        : buyerStep && caseRow.capabilities?.canBuyerConfirm === true;
    const simplifiedQueue = isMyTask ? 'my_tasks'
      : status === 'ready_for_invoice' ? 'ready_for_invoice'
        : status === 'completed' ? 'completed' : 'waiting';
    const currentStep = postInvoice ? 'invoice_attention' : supplierStep ? 'supplier_costs' : buyerStep ? 'buyer_charges' : 'ready_for_invoices';
    const responsiblePerson = supplierStep ? currentSupplier?.assignedSupplierTrader?.name || 'Needs assignment'
      : buyerStep || postInvoice ? caseRow.assignedBuyerTrader?.name || 'Needs assignment'
        : status === 'ready_for_invoice' ? 'Invoice team' : 'Completed';
    const nextAction = postInvoice ? 'Invoice already issued—action required'
      : awaiting ? (caseRow.actionableOn ? `Available from ${caseRow.actionableOn}` : 'Add the required schedule information')
        : supplierStep ? (isMyTask ? `Confirm ${currentSupplier?.supplierName || 'supplier'} costs` : `Waiting for ${responsiblePerson}`)
          : buyerStep ? (isMyTask ? 'Approve buyer charges' : `Waiting for ${responsiblePerson}`)
            : status === 'ready_for_invoice' ? 'Ready for invoice creation' : status === 'completed' ? 'Completed' : 'Waiting';
    return {
      simplifiedQueue, currentStep, isMyTask, responsiblePerson, nextAction,
      progress: {
        supplierCosts: supplierStep ? 'current' : 'complete',
        buyerCharges: supplierStep ? 'waiting' : buyerStep ? 'current' : 'complete',
        readyForInvoices: status === 'ready_for_invoice' || status === 'completed' ? 'complete' : 'waiting',
      },
    };
  }
  const pendingCosts = requirements.filter((row) => row.sides?.cost?.status !== 'verified');
  const pendingBuyerCharges = requirements.filter((row) => row.sides?.buyerCharge?.status !== 'verified');
  const myCost = pendingCosts.find((row) => row.sides?.cost?.permissions?.canConfirm);
  const myBuyerCharge = pendingBuyerCharges.find((row) => row.sides?.buyerCharge?.permissions?.canConfirm);
  const currentRequirement = myCost || myBuyerCharge || pendingCosts[0] || pendingBuyerCharges[0] || null;
  const status = caseRow.status;
  const postInvoice = status === 'post_invoice_changes';
  const awaiting = status === 'awaiting_delivery';
  const supplierStep = pendingCosts.length > 0;
  const buyerStep = pendingBuyerCharges.length > 0;
  const isMyTask = postInvoice
    ? caseRow.capabilities?.canResolvePostInvoice === true
    : awaiting ? false
      : Boolean(myCost || myBuyerCharge);
  let simplifiedQueue = 'waiting';
  if (isMyTask) simplifiedQueue = 'my_tasks';
  else if (status === 'ready_for_invoice') simplifiedQueue = 'ready_for_invoice';
  else if (status === 'completed') simplifiedQueue = 'completed';
  const currentStep = postInvoice ? 'invoice_attention'
    : supplierStep && buyerStep ? 'paired_charges'
      : supplierStep ? 'supplier_costs'
        : buyerStep ? 'buyer_charges' : 'ready_for_invoices';
  const responsiblePerson = currentRequirement
    ? (myCost ? currentRequirement.sides.cost.currentAssignee?.name
      : myBuyerCharge ? currentRequirement.sides.buyerCharge.currentAssignee?.name
        : currentRequirement.sides.cost.status !== 'verified'
          ? currentRequirement.sides.cost.currentAssignee?.name
          : currentRequirement.sides.buyerCharge.currentAssignee?.name) || 'Needs assignment'
    : postInvoice
      ? caseRow.assignedBuyerTrader?.name || 'Needs assignment'
      : status === 'ready_for_invoice' ? 'Invoice team' : 'Completed';
  let nextAction = 'Waiting';
  if (postInvoice) nextAction = 'Invoice already issued—action required';
  else if (awaiting) nextAction = caseRow.actionableOn ? `Available from ${caseRow.actionableOn}` : 'Add the required schedule information';
  else if (myCost && myBuyerCharge && myCost.supplierId === myBuyerCharge.supplierId) nextAction = `Confirm both sides for ${myCost.supplierName}`;
  else if (myCost) nextAction = `Confirm ${myCost.supplierName} costs`;
  else if (myBuyerCharge) nextAction = `Confirm ${myBuyerCharge.supplierName} buyer charges`;
  else if (supplierStep || buyerStep) nextAction = `Waiting for ${responsiblePerson}`;
  else if (status === 'ready_for_invoice') nextAction = 'Ready for invoice creation';
  else if (status === 'completed') nextAction = 'Completed';
  return {
    simplifiedQueue,
    currentStep,
    isMyTask,
    responsiblePerson,
    nextAction,
    progress: {
      supplierCosts: supplierStep ? 'current' : 'complete',
      buyerCharges: buyerStep ? 'current' : 'complete',
      readyForInvoices: status === 'ready_for_invoice' || status === 'completed' ? 'complete' : 'waiting',
    },
  };
}

function serializeCase(live, stored, profile, gm, dueDate, sideRows = [], profiles = []) {
  const status = deriveStatus(live, stored);
  const actionability = variableChargeActionability(live);
  const assignee = effectiveAssignee(stored || {});
  const supplierAccounts = live.accounts.map((row) => ({
    id: row.Id,
    name: row.Name,
    isAgent: row.Is_Agent__c === true,
    isVariable: row.Is_Variable__c === true,
    agencyFeeUsd: row.Agency_Fee_USD__c ?? null,
    agencyFeeAmount: row.Agency_Fee_USD__c ?? null,
    agencyFeeCurrency: row.Agency_Fee_Currency__c || 'USD',
    paymentTerm: row.Supplier_Payment_Term__c || null,
  }));
  const assignedBuyerTrader = assignee.id ? assignee : {
    id: live.assignment?.profileId || null, name: live.assignment?.name || null, email: live.assignment?.email || null,
  };
  const profileMap = new Map(profiles.map((row) => [row.id, row]));
  const normalTrader = !VIEW_ONLY_USER_TYPES.has(text(profile?.user_type, 100).toLowerCase());
  const hasFinalBuyerInvoice = live.invoices.some(finalInvoice);
  const supplierRequirements = (live.supplierRequirements || []).map((row) => {
    const sideState = (side) => sideRows.find((state) => state.supplier_account_id === row.supplierId && state.side === side) || null;
    const serializeSide = (side) => {
      const state = sideState(side);
      const synchronized = Boolean(state);
      const defaultId = state?.default_assignee_user_id || row.assignedSupplierTrader?.id || null;
      const assignedId = state?.assigned_user_id || defaultId;
      const defaultProfile = profileMap.get(defaultId) || (row.assignedSupplierTrader?.id === defaultId ? row.assignedSupplierTrader : null);
      const assignedProfile = profileMap.get(assignedId) || (row.assignedSupplierTrader?.id === assignedId ? row.assignedSupplierTrader : null);
      const salesforceStatus = side === 'cost' ? row.status : row.buyerChargeStatus;
      const fingerprint = side === 'cost' ? row.sourceFingerprint : row.buyerChargeSourceFingerprint;
      const reviewedFingerprint = side === 'cost' ? row.reviewedSourceFingerprint : row.buyerChargeReviewedSourceFingerprint;
      const confirmedAt = side === 'cost' ? row.verifiedAt : row.buyerChargeConfirmedAt;
      const verified = salesforceStatus === 'Verified';
      const frozen = verified;
      const isCurrentAssignee = synchronized && assignedId === profile?.id && normalTrader;
      const isDefaultAssignee = synchronized && defaultId === profile?.id && normalTrader;
      const supplierInvoiceCreated = (live.supplierInvoices || []).some((invoice) => invoice.Supplier__c === row.supplierId)
        || live.lineItems.some((item) => item.Original_Supplier__c === row.supplierId && item.Supplier_Invoice__c)
        || live.extraCosts.some((item) => item.Supplier__c === row.supplierId && item.Supplier_Invoice__c);
      const invoiceCreated = side === 'cost' ? supplierInvoiceCreated : hasFinalBuyerInvoice;
      return {
        side,
        status: verified ? 'verified' : salesforceStatus === 'Invalidated' ? 'invalidated' : 'pending',
        defaultAssignee: defaultProfile ? { id: defaultProfile.id, name: defaultProfile.full_name || defaultProfile.name || defaultProfile.email, email: defaultProfile.email || null } : { id: defaultId, name: null, email: null },
        currentAssignee: assignedProfile ? { id: assignedProfile.id, name: assignedProfile.full_name || assignedProfile.name || assignedProfile.email, email: assignedProfile.email || null } : { id: assignedId, name: null, email: null },
        assignmentSource: state?.assignment_source || (defaultId ? 'supplier_nomination' : 'unresolved'),
        revision: Number(state?.revision || 0),
        salesforceRevision: Number(side === 'cost' ? row.revision : row.buyerChargeRevision),
        fingerprint,
        reviewedFingerprint: reviewedFingerprint || null,
        confirmationTime: confirmedAt || null,
        invoiceCreated,
        amendBlockedReason: invoiceCreated
          ? side === 'cost'
            ? 'Locked after this supplier invoice was created.'
            : 'Locked after the final Buyer Invoice was created.'
          : null,
        permissions: {
          canEdit: !frozen && isCurrentAssignee,
          canConfirm: !frozen && isCurrentAssignee,
          canReopen: frozen && isCurrentAssignee && !invoiceCreated,
          canAssignToBuyer: !frozen && isDefaultAssignee && Boolean(assignedBuyerTrader.id) && assignedId !== assignedBuyerTrader.id,
          canTakeBack: !frozen && isDefaultAssignee && assignedId !== defaultId,
          canGmOverride: !frozen && gm.isGeneralManager,
        },
      };
    };
    const cost = serializeSide('cost');
    const buyerCharge = serializeSide('buyer_charge');
    return {
      ...row,
      sides: { cost, buyerCharge },
      canVerify: cost.permissions.canConfirm,
    };
  });
  const verifiedSupplierCount = supplierRequirements.filter((row) => row.sides.cost.status === 'verified').length;
  const verifiedBuyerCount = supplierRequirements.filter((row) => row.sides.buyerCharge.status === 'verified').length;
  const baseCapabilities = capabilitiesFor(stored || {
    assigned_buyer_user_id: live.assignment?.profileId,
    assigned_buyer_name: live.assignment?.name,
    assigned_buyer_email: live.assignment?.email,
  }, profile, gm);
  baseCapabilities.canSupplierVerify = supplierRequirements.some((row) => row.canVerify);
  baseCapabilities.canBuyerConfirm = pairedWorkflowEnabled()
    ? supplierRequirements.some((row) => row.sides.buyerCharge.permissions.canConfirm)
    : baseCapabilities.canConfirm && verifiedSupplierCount === supplierRequirements.length;
  const serialized = {
    id: stored?.id || null, stemId: live.stem.Id,
    stemName: live.stem.Name || live.stem.KeyStem__c || live.stem.Id,
    stemReference: live.stem.KeyStem__c || null,
    buyerAccountId: live.stem.Account__c || null,
    buyerAccountName: live.stem.Account__r?.Name || null,
    vesselId: live.stem.Vessel__c || null,
    vesselName: live.stem.Vessel__r?.Name || null,
    portId: live.stem.Port__c || null,
    portName: live.stem.Port__r?.Name || null,
    portCountry: live.stem.Port__r?.Country__c || null,
    hongKongVariableCharges: isHongKongStem(live.stem),
    currency: text(live.stem.CurrencyIsoCode, 3).toUpperCase() || 'USD',
    buyerPaymentTerm: live.stem.Payment_Term__c || null,
    createdDate: live.stem.CreatedDate || null,
    deliveryDate: live.stem.Delivery_Date__c || null, dueDate, status,
    hasProductLineItems: actionability.hasProductLineItems,
    deliveryRequired: actionability.deliveryRequired,
    actionBasis: actionability.actionBasis,
    actionBasisDate: actionability.actionBasisDate,
    actionableOn: actionability.actionableOn,
    salesforceStemLastModifiedAt: live.stem.LastModifiedDate || null,
    revision: Number(stored?.revision || 0), fingerprint: pairedWorkflowEnabled() ? live.buyerFingerprint : live.fingerprint,
    confirmed: live.stem.Variable_Charges_Confirmed__c === true,
    confirmedFingerprint: stored?.confirmation_status === 'confirmed' ? stored?.source_fingerprint || null : null,
    pairedWorkflowEnabled: pairedWorkflowEnabled(),
    assignedBuyerTrader,
    assigneeProfileId: assignedBuyerTrader.id || null,
    assigneeName: assignedBuyerTrader.name || null,
    buyerTraderName: assignedBuyerTrader.name || null,
    assignmentStatus: live.assignment?.status || 'unresolved_profile',
    assignmentMessage: live.assignment?.message || null,
    supplierRequirements,
    supplierStageProgress: { verified: verifiedSupplierCount, required: supplierRequirements.length },
    sideProgress: {
      supplierCosts: { confirmed: verifiedSupplierCount, required: supplierRequirements.length },
      buyerCharges: { confirmed: verifiedBuyerCount, required: supplierRequirements.length },
    },
    invoiceReadiness: {
      buyer: {
        ready: live.stem.Variable_Charges_Confirmed__c === true && verifiedBuyerCount === supplierRequirements.length,
        confirmed: verifiedBuyerCount,
        required: supplierRequirements.length,
      },
      suppliers: supplierRequirements.map((row) => ({
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        ready: row.sides.cost.status === 'verified',
      })),
    },
    supplierAccounts,
    variableChargeSupplierName: supplierAccounts.map((row) => row.name).filter(Boolean).join(', ') || null,
    shipAgentName: supplierAccounts.map((row) => row.name).filter(Boolean).join(', ') || null,
    shipAgentAccountId: supplierAccounts.length === 1 ? supplierAccounts[0].id : null,
    supplierPaymentTerm: supplierAccounts.length === 1 ? supplierAccounts[0].paymentTerm : null,
    lineItemCount: live.lineItems.length, extraCostCount: live.extraCosts.length,
    finalInvoiceCount: live.invoices.filter(finalInvoice).length,
    hasFinalInvoice: live.invoices.some(finalInvoice),
    postInvoiceResolution: stored?.post_invoice_resolution || null,
    postInvoiceReferencePresent: Boolean(stored?.post_invoice_reference),
    urgent: status === 'post_invoice_changes' || Boolean(dueDate && dueDate < hongKongToday()),
    capabilities: baseCapabilities,
    financialSummary: financialSummary(live),
  };
  const workflow = plainLanguageWorkflow(serialized);
  return {
    ...serialized,
    workflow,
    simplifiedQueue: workflow.simplifiedQueue,
    currentStep: workflow.currentStep,
    isMyTask: workflow.isMyTask,
    responsiblePerson: workflow.responsiblePerson,
    nextAction: workflow.nextAction,
  };
}

async function storedCases(client, stemIds = null) {
  let query = client.from('variable_charge_cases').select(CASE_SELECT);
  if (stemIds?.length) query = query.in('stem_id', stemIds);
  const { data, error } = await query;
  if (error) throw httpError('Variable Charges storage is unavailable. Apply the required Supabase migration.', 503, 'VARIABLE_CHARGE_STORAGE_UNAVAILABLE');
  return data || [];
}

async function storedSideStates(client, stemIds) {
  if (!stemIds?.length) return [];
  const { data, error } = await client.from('variable_charge_side_states').select([
    'id', 'stem_id', 'supplier_account_id', 'side', 'default_assignee_user_id',
    'assigned_user_id', 'assignment_source', 'status', 'source_fingerprint',
    'salesforce_stage_last_modified_at', 'revision', 'updated_at',
  ].join(',')).in('stem_id', stemIds);
  if (error) throw httpError('Variable Charges side storage is unavailable. Apply the paired-workflow migration.', 503, 'VARIABLE_CHARGE_SIDE_STORAGE_UNAVAILABLE');
  return data || [];
}

async function serializeCases(client, liveCases, profile) {
  const stemIds = liveCases.map((entry) => entry.stem.Id);
  const [stored, sides, profiles] = await Promise.all([
    storedCases(client, stemIds),
    pairedWorkflowEnabled() ? storedSideStates(client, stemIds) : Promise.resolve([]),
    activeProfileDirectory(client),
  ]);
  const storedMap = new Map(stored.map((row) => [row.stem_id, row]));
  const gm = await activeGeneralManager(client, profile?.id);
  const cases = [];
  for (const live of liveCases) {
    const dueDate = live.hasProductLineItems && live.stem.Delivery_Date__c ? await dueDateForDelivery(live.stem.Delivery_Date__c) : null;
    cases.push(serializeCase(live, storedMap.get(live.stem.Id), profile, gm, dueDate, sides.filter((row) => row.stem_id === live.stem.Id), profiles));
  }
  return { cases, gm, pairedWorkflowEnabled: pairedWorkflowEnabled() };
}

function viewCounts(cases) {
  const counts = {
    my_tasks: 0, waiting: 0, ready_for_invoice: 0, completed: 0, all_cases: cases.length,
    needs_action: 0, awaiting_delivery: 0, post_invoice_changes: 0,
  };
  for (const row of cases) {
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1;
    if (row.simplifiedQueue !== row.status && Object.prototype.hasOwnProperty.call(counts, row.simplifiedQueue)) counts[row.simplifiedQueue] += 1;
  }
  return counts;
}

export async function listVariableCharges(body, context) {
  const live = await loadLiveCases({ client: context.client, stemAccessCondition: context.stemAccessCondition || null });
  const serialized = await serializeCases(context.client, live, context.profile);
  const requestedView = text(body?.view, 60).toLowerCase().replaceAll('-', '_');
  const filtered = !requestedView || requestedView === 'all' || requestedView === 'all_cases'
    ? serialized.cases
    : SIMPLE_QUEUE_NAMES.has(requestedView)
      ? serialized.cases.filter((row) => row.simplifiedQueue === requestedView)
      : serialized.cases.filter((row) => row.status === requestedView);
  return {
    cases: filtered,
    counts: viewCounts(serialized.cases),
    capabilities: { canGmOverride: serialized.gm.isGeneralManager, generalManagerConfigured: serialized.gm.configured, pairedWorkflowEnabled: serialized.pairedWorkflowEnabled },
    retrievedAt: new Date().toISOString(),
  };
}

async function liveCaseForStem(stemId, context) {
  if (!SALESFORCE_ID.test(text(stemId, 18))) throw httpError('A valid Salesforce STEM is required.', 400, 'INVALID_STEM_ID');
  const rows = await loadLiveCases({ client: context.client, stemIds: [stemId] });
  if (!rows.length) throw httpError('No Variable Charges supplier is currently detected for this STEM.', 404, 'VARIABLE_CHARGE_CASE_NOT_FOUND');
  return rows[0];
}

async function linkedSalesforceFiles(live) {
  const entityIds = [live.stem.Id, ...live.lineItems.map((row) => row.Id), ...live.extraCosts.map((row) => row.Id)];
  const links = await queryAll(`SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (${quotedIds(entityIds)})`);
  const documents = await queryIds('ContentDocument', 'Id, Title, FileType, ContentSize, LatestPublishedVersionId, LastModifiedDate', links.map((row) => row.ContentDocumentId));
  const linkMap = new Map();
  for (const link of links) {
    const ids = linkMap.get(link.ContentDocumentId) || [];
    ids.push(link.LinkedEntityId);
    linkMap.set(link.ContentDocumentId, ids);
  }
  return documents.map((row) => ({
    id: row.Id, title: row.Title, fileType: row.FileType, contentSize: row.ContentSize,
    latestVersionId: row.LatestPublishedVersionId, lastModifiedDate: row.LastModifiedDate,
    linkedEntityIds: linkMap.get(row.Id) || [],
  }));
}

async function activeProducts() {
  const rows = await queryAll("SELECT Id, Name, IsActive, LastModifiedDate FROM Product2 WHERE IsActive = true ORDER BY Name");
  return rows.map((row) => ({ id: row.Id, name: row.Name, lastModifiedDate: row.LastModifiedDate }));
}

async function assignmentHistory(client, caseRow) {
  if (!caseRow?.id) return { rows: [], unavailable: false };
  const result = await client.from('variable_charge_events')
    .select('event_type,metadata,created_at')
    .eq('case_id', caseRow.id)
    .in('event_type', ['side_assigned', 'side_taken_back'])
    .order('created_at', { ascending: false })
    .limit(50);
  if (result.error) return { rows: [], unavailable: true };
  const suppliers = new Map((caseRow.supplierAccounts || []).map((row) => [row.id, row.name]));
  return {
    unavailable: false,
    rows: (result.data || []).map((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const side = metadata.side === 'buyer_charge' ? 'Buyer Leg' : metadata.side === 'cost' ? 'Supplier Leg' : 'Review';
      const targetRole = metadata.targetRole === 'buyer_trader' ? 'Buyer Trader'
        : metadata.targetRole === 'supplier_trader' ? 'Supplier Trader'
          : metadata.targetRole === 'gm_override' ? 'Temporary Assignee' : null;
      return {
        occurredAt: row.created_at || null,
        eventType: row.event_type,
        side,
        supplierName: suppliers.get(metadata.supplierAccountId) || null,
        action: row.event_type === 'side_taken_back' ? 'Taken Back' : targetRole ? `Assigned to ${targetRole}` : 'Assignment Changed',
      };
    }),
  };
}

async function variableChargeSettings(client) {
  const { data, error } = await client.from('variable_charge_settings')
    .select('id,usd_hkd_rate,revision,updated_at,updated_by')
    .eq('id', 'company')
    .maybeSingle();
  if (error || !data) throw httpError('Variable Charges settings are unavailable. Apply the required Supabase migration.', 503, 'VARIABLE_CHARGE_SETTINGS_UNAVAILABLE');
  return {
    usdHkdRate: Number(data.usd_hkd_rate),
    revision: Number(data.revision),
    updatedAt: data.updated_at || null,
  };
}

function anchorageEvidence(live, settings) {
  const rows = live.extraCosts.filter((row) => isAnchorageDuesRow(row));
  if (!isHongKongStem(live.stem) || !rows.length) return null;
  const accountNames = new Map((live.accounts || []).map((row) => [row.Id, row.Name]));
  const periods = rows.map((row) => ({
    id: row.Id,
    supplierId: row.Supplier__c,
    arrival: row.Anchorage_Arrival__c,
    departure: row.Anchorage_Departure__c,
    location: row.Anchorage_Location__c || ANCHORAGE_LOCATION_ELSEWHERE,
  }));
  const allocations = rows.map((row) => ({ id: row.Id, amountHkd: row.Anchorage_Dues_Allocation_HKD__c }));
  const calculation = calculateHongKongAnchorageDues({
    nrt: live.stem.Vessel__r?.NRT__c,
    periods,
    allocations,
  });
  const allocatedById = new Map((calculation.allocations || []).map((row) => [row.id, row.amountHkd]));
  const buyerAllocatedById = new Map((calculation.buyer?.allocations || []).map((row) => [row.id, row.amountUsd]));
  return {
    vesselNrt: live.stem.Vessel__r?.NRT__c ?? null,
    companyUsdHkdRate: settings.usdHkdRate,
    fxSettingsRevision: settings.revision,
    calculation,
    rows: rows.map((row) => {
      const currency = text(row.CurrencyIsoCode || live.stem.CurrencyIsoCode, 3).toUpperCase() || 'USD';
      const allocationHkd = allocatedById.get(row.Id) ?? row.Anchorage_Dues_Allocation_HKD__c ?? null;
      const supplierAmount = finiteAmount(row.Line_Total_Buy__c);
      const appliedRate = row.Anchorage_Calculation_Version__c
        ? finiteAmount(row.Anchorage_USD_HKD_Rate__c)
        : settings.usdHkdRate;
      const supplierRate = finiteAmount(row.Supplier_Cost_USD_HKD_Rate__c) || appliedRate;
      const supplierNativeHkd = text(row.Supplier_Cost_Input_Currency__c, 3).toUpperCase() === 'HKD'
        ? finiteAmount(row.Supplier_Cost_Input_Value__c)
        : null;
      const supplierHkd = supplierNativeHkd != null
        ? { available: true, amount: supplierNativeHkd, rate: supplierRate, basis: `Reviewed in HKD · USD 1 = HKD ${supplierRate}` }
        : currency === 'HKD' && supplierAmount != null
          ? { available: true, amount: supplierAmount, rate: 1, basis: 'HKD direct' }
          : currency === 'USD' && supplierAmount != null && supplierRate > 0
            ? { available: true, amount: Math.round(supplierAmount * supplierRate * 100) / 100, rate: supplierRate, basis: `USD 1 = HKD ${supplierRate}` }
            : { available: false, reason: supplierAmount == null ? 'Supplier charge is unavailable.' : `${currency || 'This currency'} is not supported for Hong Kong anchorage-dues comparison.` };
      const supplierEquivalentUsd = supplierHkd.available && supplierRate > 0
        ? Math.round((supplierHkd.amount / supplierRate) * 100) / 100
        : null;
      const buyerDefaultUsd = buyerAllocatedById.get(row.Id) ?? null;
      const currentBuyerUsd = finiteAmount(row.Lumpsum_Price__c ?? row.Unit_Price__c);
      const formerSupplierPassThroughUsd = finiteAmount(row.Lumpsum_Cost__c ?? row.Unit_Cost__c);
      const storedBuyerDefaultUsd = finiteAmount(row.Anchorage_Buyer_Default_USD__c);
      const matches = (left, right) => left != null && right != null && Math.abs(left - right) <= 0.005;
      const applyCalculatedDefault = buyerDefaultUsd != null && (
        currentBuyerUsd == null || Math.abs(currentBuyerUsd) <= 0.005
        || matches(currentBuyerUsd, formerSupplierPassThroughUsd)
        || matches(currentBuyerUsd, storedBuyerDefaultUsd)
      );
      const buyerDefault = buyerDefaultUsd == null
        ? { available: false, reason: 'Complete and allocate the Anchorage Dues evidence before calculating the buyer default.' }
        : {
          available: true,
          amountUsd: buyerDefaultUsd,
          rateUsdPerNrtHour: calculation.buyer.rateUsdPerNrtHour,
          chargeableHours: calculation.buyer.chargeableHours,
          nrt: calculation.nrt,
          version: calculation.buyer.version,
          currentAmountUsd: currentBuyerUsd,
          adjusted: currentBuyerUsd != null
            && !applyCalculatedDefault
            && !matches(currentBuyerUsd, buyerDefaultUsd),
          differenceUsd: currentBuyerUsd == null ? null : Math.round((currentBuyerUsd - buyerDefaultUsd) * 100) / 100,
          applyCalculatedDefault,
        };
      return {
        extraCostId: row.Id,
        supplierId: row.Supplier__c,
        supplierName: accountNames.get(row.Supplier__c) || 'Supplier',
        currency,
        arrival: row.Anchorage_Arrival__c || null,
        departure: row.Anchorage_Departure__c || null,
        location: row.Anchorage_Location__c || ANCHORAGE_LOCATION_ELSEWHERE,
        allocationHkd,
        supplierChargeHkd: supplierHkd,
        supplierEquivalentUsd,
        supplierVarianceHkd: supplierHkd.available && allocationHkd != null ? Math.round((supplierHkd.amount - allocationHkd) * 100) / 100 : null,
        buyerSuggestion: buyerDefault.available
          ? { available: true, amount: buyerDefault.amountUsd, rate: buyerDefault.rateUsdPerNrtHour, basis: 'USD 0.002 per NRT-hour' }
          : buyerDefault,
        buyerDefault,
        appliedNrt: row.Anchorage_NRT_Snapshot__c ?? null,
        appliedUsdHkdRate: row.Anchorage_USD_HKD_Rate__c ?? null,
        appliedFxSettingsRevision: row.Anchorage_FX_Settings_Revision__c ?? null,
        savedCalculationVersion: row.Anchorage_Calculation_Version__c || null,
        appliedBuyerDefaultUsd: row.Anchorage_Buyer_Default_USD__c ?? null,
        appliedBuyerRateUsd: row.Anchorage_Buyer_Rate_USD__c ?? null,
        savedBuyerCalculationVersion: row.Anchorage_Buyer_Calc_Version__c || null,
        lastModifiedDate: row.LastModifiedDate || null,
      };
    }),
  };
}

function lightDuesArrivalEvidence(live, row) {
  const arrival = live.extraCosts
    .filter((candidate) => isAnchorageDuesRow(candidate)
      && candidate.Supplier__c === row.Supplier__c
      && candidate.Anchorage_Arrival__c)
    .map((candidate) => candidate.Anchorage_Arrival__c)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] || null;
  return { arrival, entryDate: hongKongDateOnly(arrival) };
}

function lightDuesEvidence(live, settings) {
  const rows = live.extraCosts.filter((row) => isLightDuesRow(row));
  if (!isHongKongStem(live.stem) || !rows.length) return null;
  const accountNames = new Map((live.accounts || []).map((row) => [row.Id, row.Name]));
  const vesselNrt = live.stem.Vessel__r?.NRT__c ?? null;
  return {
    vesselNrt,
    companyUsdHkdRate: settings.usdHkdRate,
    fxSettingsRevision: settings.revision,
    rows: rows.map((row) => {
      const { arrival, entryDate } = lightDuesArrivalEvidence(live, row);
      const category = LIGHT_DUES_CATEGORY_ALL_OTHER;
      const calculation = calculateHongKongLightDues({ nrt: vesselNrt, entryDate, category });
      const appliedRate = row.Light_Dues_Calculation_Version__c
        ? finiteAmount(row.Light_Dues_USD_HKD_Rate__c)
        : settings.usdHkdRate;
      const supplierUsd = finiteAmount(row.Line_Total_Buy__c);
      const supplierRate = finiteAmount(row.Supplier_Cost_USD_HKD_Rate__c) || appliedRate;
      const supplierNativeHkd = text(row.Supplier_Cost_Input_Currency__c, 3).toUpperCase() === 'HKD'
        ? finiteAmount(row.Supplier_Cost_Input_Value__c)
        : null;
      const supplierHkd = supplierNativeHkd != null
        ? supplierNativeHkd
        : supplierUsd != null && supplierRate > 0 ? Math.round(supplierUsd * supplierRate * 100) / 100 : null;
      const calculatedHkd = calculation.complete ? calculation.amountHkd : null;
      return {
        extraCostId: row.Id,
        supplierId: row.Supplier__c,
        supplierName: accountNames.get(row.Supplier__c) || 'Supplier',
        arrival,
        entryDate,
        entryDateSource: 'anchorage_arrival',
        category,
        calculation,
        calculatedUsd: calculatedHkd == null ? null : convertHkdToUsd(calculatedHkd, appliedRate),
        supplierChargeUsd: supplierUsd,
        supplierChargeHkd: supplierHkd,
        supplierVarianceHkd: supplierHkd != null && calculatedHkd != null ? Math.round((supplierHkd - calculatedHkd) * 100) / 100 : null,
        buyerDefaultUsd: 0,
        appliedNrt: row.Light_Dues_NRT_Snapshot__c ?? null,
        appliedEntryDate: row.Light_Dues_Entry_Date__c || null,
        appliedCategory: row.Light_Dues_Category__c || null,
        appliedRateHkd: row.Light_Dues_Rate_HKD__c ?? null,
        appliedAmountHkd: row.Light_Dues_Amount_HKD__c ?? null,
        appliedUsdHkdRate: row.Light_Dues_USD_HKD_Rate__c ?? null,
        supplierAppliedUsdHkdRate: supplierRate || null,
        appliedFxSettingsRevision: row.Light_Dues_FX_Settings_Revision__c ?? null,
        savedCalculationVersion: row.Light_Dues_Calculation_Version__c || null,
        lastModifiedDate: row.LastModifiedDate || null,
      };
    }),
  };
}

function supplierDualCurrencySummary(live, settings) {
  if (!isHongKongStem(live.stem)) return null;
  const bundleSupplierIds = basicCallingSupplierIds(live);
  const accountsById = new Map((live.accounts || []).map((row) => [row.Id, row]));
  const rows = [
    ...live.lineItems.map((row) => {
      const usd = finiteAmount(row.Total_Cost__c);
      return { supplierId: row.Original_Supplier__c, usd, hkd: usd == null ? null : usd * settings.usdHkdRate, rate: settings.usdHkdRate, reviewed: false };
    }),
    ...live.extraCosts.map((row) => {
      const accountAgencyFee = isBasicCallingBundleSupportRow(row, bundleSupplierIds) && isAgencyFeeRow(row)
        ? agencyFeeAccountDefault(accountsById.get(row.Supplier__c), settings)
        : null;
      const rate = accountAgencyFee?.rate || finiteAmount(row.Supplier_Cost_USD_HKD_Rate__c) || settings.usdHkdRate;
      const inputCurrency = accountAgencyFee?.inputCurrency || text(row.Supplier_Cost_Input_Currency__c, 3).toUpperCase();
      const inputAmount = accountAgencyFee?.nativeAmount ?? finiteAmount(row.Supplier_Cost_Input_Value__c);
      const fixedNativeAmount = isAgencyFeeRow(row) || row.Lumpsum_Cost__c != null;
      const nativeTotal = inputAmount == null ? null : fixedNativeAmount
        ? inputAmount
        : finiteAmount(row.Quantity__c) == null ? null : inputAmount * Number(row.Quantity__c);
      const recordedUsd = accountAgencyFee?.usdAmount ?? finiteAmount(row.Line_Total_Buy__c);
      const usd = inputCurrency === 'HKD' && nativeTotal != null && rate > 0 ? nativeTotal / rate : recordedUsd;
      const hkd = inputCurrency === 'HKD' && nativeTotal != null ? nativeTotal : usd == null ? null : usd * rate;
      return {
        supplierId: row.Supplier__c,
        usd,
        hkd,
        rate,
        reviewed: accountAgencyFee == null && finiteAmount(row.Supplier_Cost_USD_HKD_Rate__c) > 0,
      };
    }),
  ];
  const summarize = (selected) => {
    const complete = selected.every((row) => row.usd != null && row.hkd != null && row.rate > 0);
    const rates = [...new Set(selected.map((row) => row.rate).filter((rate) => rate > 0))];
    return {
      usd: complete ? Math.round(selected.reduce((sum, row) => sum + row.usd, 0) * 100) / 100 : null,
      hkd: complete ? Math.round(selected.reduce((sum, row) => sum + row.hkd, 0) * 100) / 100 : null,
      complete,
      rateLabel: rates.length > 1 ? 'Multiple reviewed rates' : rates.length === 1 ? `USD 1 = HKD ${rates[0]}` : 'Rate unavailable',
    };
  };
  return {
    ...summarize(rows),
    bySupplier: live.accounts.map((account) => ({ supplierId: account.Id, supplierName: account.Name, ...summarize(rows.filter((row) => row.supplierId === account.Id)) })),
  };
}

export async function variableChargeOptions(_body, context) {
  const [products, profiles, recordTypes] = await Promise.all([
    activeProducts(),
    activeProfileDirectory(context.client),
    queryAll("SELECT Id, Name, DeveloperName FROM RecordType WHERE SObjectType = 'STEM_Extra_Cost__c' AND DeveloperName = 'STEM_Charge' LIMIT 1"),
  ]);
  if (recordTypes.length !== 1) throw httpError('The active Salesforce STEM Charge record type is required.', 503, 'STEM_CHARGE_RECORD_TYPE_UNAVAILABLE');
  return {
    products,
    assignees: profiles.filter((row) => !VIEW_ONLY_USER_TYPES.has(text(row.user_type).toLowerCase())).map((row) => ({ id: row.id, name: row.full_name || row.email, email: row.email })),
    pricingModes: [{ id: 'fixed', label: 'Fixed' }, { id: 'per_unit', label: 'Per unit' }],
    recordTypeId: recordTypes[0].Id,
  };
}

export async function getVariableChargeDetail(body, context) {
  const live = await liveCaseForStem(body?.stemId, context);
  const [{ cases }, files, options, settings] = await Promise.all([
    serializeCases(context.client, [live], context.profile),
    linkedSalesforceFiles(live),
    variableChargeOptions({}, context),
    variableChargeSettings(context.client),
  ]);
  const bundleSupplierIds = basicCallingSupplierIds(live);
  const serializeOptions = {
    basicCallingSupplierIds: bundleSupplierIds,
    accountsById: new Map((live.accounts || []).map((row) => [row.Id, row])),
  };
  const history = await assignmentHistory(context.client, cases[0]);
  const gm = await activeGeneralManager(context.client, context.profile?.id);
  const userType = text(context.profile?.user_type, 100).toLowerCase();
  return {
    case: cases[0],
    lineItems: live.lineItems.map((row) => serializeLiveRow(row, 'line_item', settings, serializeOptions)),
    extraCosts: live.extraCosts.map((row) => serializeLiveRow(row, 'extra_cost', settings, serializeOptions)),
    salesforceFiles: files,
    products: options.products,
    assignees: options.assignees,
    pricingModes: options.pricingModes,
    capabilities: cases[0].capabilities,
    pairedWorkflowEnabled: pairedWorkflowEnabled(),
    assignmentHistory: history.rows,
    assignmentHistoryUnavailable: history.unavailable,
    salesforceInstanceUrl: getInstanceUrl(),
    anchorage: anchorageEvidence(live, settings),
    lightDues: lightDuesEvidence(live, settings),
    vessel: {
      id: live.stem.Vessel__c || null,
      name: live.stem.Vessel__r?.Name || null,
      nrt: live.stem.Vessel__r?.NRT__c ?? null,
      lastModifiedDate: live.stem.Vessel__r?.LastModifiedDate || null,
      affectedReviewCount: isHongKongStem(live.stem) ? (live.extraCosts.filter((row) => isAnchorageDuesRow(row) || isLightDuesRow(row)).length) : 0,
      canSaveNrt: isHongKongStem(live.stem),
    },
    supplierDualCurrencySummary: supplierDualCurrencySummary(live, settings),
    basicCallingBundle: {
      active: bundleSupplierIds.size > 0,
      supportRows: live.extraCosts.filter((row) => isBasicCallingBundleSupportRow(row, bundleSupplierIds)).map((row) => ({
        id: row.Id,
        supplierId: row.Supplier__c,
        productName: rowProductName(row),
        sequence: row.Hong_Kong_Bundle_Sequence__c ?? basicCallingSequence(rowProductName(row)),
        managed: isManagedBasicCallingRow(row),
      })),
    },
    variableChargeSettings: {
      ...settings,
      canSave: userType === 'administrator' || gm.isGeneralManager,
    },
  };
}

export async function getVariableChargeSettings(_body, context) {
  const settings = await variableChargeSettings(context.client);
  const gm = await activeGeneralManager(context.client, context.profile?.id);
  return { ...settings, canSave: text(context.profile?.user_type, 100).toLowerCase() === 'administrator' || gm.isGeneralManager };
}

export async function saveVariableChargeSettings(body, context) {
  const gm = await activeGeneralManager(context.client, context.profile?.id);
  if (text(context.profile?.user_type, 100).toLowerCase() !== 'administrator' && !gm.isGeneralManager) {
    throw httpError('Only an Administrator or the active General Manager may change the company USD/HKD rate.', 403, 'VARIABLE_CHARGE_SETTINGS_FORBIDDEN');
  }
  const rate = numeric(body?.usdHkdRate, 'USD/HKD rate', { positive: true, nullable: false });
  const expectedRevision = Number(body?.expectedRevision);
  const reason = text(body?.reason, 1000);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw httpError('The settings revision is required.', 409, 'SETTINGS_REVISION_REQUIRED');
  if (reason.length < 5) throw httpError('Enter a specific reason of at least 5 characters.', 400, 'SETTINGS_REASON_REQUIRED');
  const { data, error } = await context.client.rpc('save_variable_charge_settings', {
    p_expected_revision: expectedRevision,
    p_usd_hkd_rate: rate,
    p_actor_user_id: context.profile.id,
    p_reason: reason,
  });
  if (error) {
    if (/changed after/i.test(error.message || '')) throw httpError(error.message, 409, 'SETTINGS_REVISION_CONFLICT');
    throw error;
  }
  return {
    usdHkdRate: Number(data.usd_hkd_rate),
    revision: Number(data.revision),
    updatedAt: data.updated_at || null,
    canSave: true,
  };
}

function anchorageInputRows(body, liveRows) {
  if (!Array.isArray(body?.rows)) throw httpError('Anchorage periods are required.', 400, 'ANCHORAGE_ROWS_REQUIRED');
  const inputById = new Map(body.rows.map((row) => [text(row?.extraCostId || row?.id, 18), row]));
  if (inputById.size !== liveRows.length || liveRows.some((row) => !inputById.has(row.Id))) {
    throw httpError('Save every active Anchorage Dues period together.', 409, 'ANCHORAGE_SCOPE_CHANGED');
  }
  return liveRows.map((row) => {
    const input = inputById.get(row.Id);
    if (text(input?.expectedLastModifiedDate, 80) !== text(row.LastModifiedDate, 80)) {
      throw httpError('An Anchorage Dues row changed after it was opened. Refresh and try again.', 409, 'ANCHORAGE_ROW_CHANGED');
    }
    const arrival = new Date(input?.arrival);
    const departure = new Date(input?.departure);
    if (Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime())) {
      throw httpError('Complete a valid arrival and departure for every Anchorage Dues row.', 400, 'ANCHORAGE_PERIOD_INVALID');
    }
    const location = text(input?.location, 80) || ANCHORAGE_LOCATION_ELSEWHERE;
    if (![ANCHORAGE_LOCATION_ELSEWHERE, 'Victoria Port'].includes(location)) throw httpError('Choose a valid Hong Kong anchorage location.', 400, 'ANCHORAGE_LOCATION_INVALID');
    return {
      row,
      id: row.Id,
      supplierId: row.Supplier__c,
      arrival: arrival.toISOString(),
      departure: departure.toISOString(),
      location,
      allocationHkd: numeric(input?.allocationHkd, 'Anchorage allocation', { nullable: true }),
    };
  });
}

export async function saveVariableChargeAnchorage(body, context) {
  const live = await liveCaseForStem(body?.stemId, context);
  if (!isHongKongStem(live.stem)) throw httpError('Anchorage-dues verification applies only to Hong Kong deliveries.', 409, 'NOT_HONG_KONG_DELIVERY');
  const liveRows = live.extraCosts.filter((row) => isAnchorageDuesRow(row));
  if (!liveRows.length) throw httpError('No active Anchorage Dues charge was found.', 404, 'ANCHORAGE_DUES_NOT_FOUND');
  const gm = await activeGeneralManager(context.client, context.profile?.id);
  const userType = text(context.profile?.user_type, 100).toLowerCase();
  const trader = (live.supplierRequirements || []).some((row) => row.assignedSupplierTrader?.id === context.profile?.id)
    || live.assignment?.profileId === context.profile?.id;
  if (!trader && userType !== 'administrator' && !gm.isGeneralManager) {
    throw httpError('Only an assigned trader, Administrator, or the active General Manager may save anchorage evidence.', 403, 'ANCHORAGE_SAVE_FORBIDDEN');
  }
  const settings = await variableChargeSettings(context.client);
  const inputs = anchorageInputRows(body, liveRows);
  const calculation = calculateHongKongAnchorageDues({
    nrt: live.stem.Vessel__r?.NRT__c,
    periods: inputs,
    allocations: inputs.map((row) => ({ id: row.id, amountHkd: row.allocationHkd })),
  });
  if (!calculation.complete) throw httpError(calculation.errors[0] || 'Anchorage dues could not be calculated.', 400, 'ANCHORAGE_CALCULATION_INCOMPLETE', calculation.errors);
  if (!calculation.allocationComplete) throw httpError('Allocate the calculated total across all agent rows. Allocations must match within HKD 0.10.', 400, 'ANCHORAGE_ALLOCATION_INCOMPLETE', calculation);
  const allocationById = new Map(calculation.allocations.map((row) => [row.id, row.amountHkd]));
  const buyerAllocationById = new Map(calculation.buyer.allocations.map((row) => [row.id, row.amountUsd]));
  const apiVersion = getApiVersion();
  const compositeRequest = inputs.map((input, index) => ({
    method: 'PATCH',
    url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${input.id}`,
    referenceId: `anchorage${index + 1}`,
    httpHeaders: lastModifiedHeaders(input.row.LastModifiedDate),
    body: {
      Anchorage_Arrival__c: input.arrival,
      Anchorage_Departure__c: input.departure,
      Anchorage_Location__c: input.location,
      Anchorage_Dues_Allocation_HKD__c: allocationById.get(input.id),
      Anchorage_NRT_Snapshot__c: calculation.nrt,
      Anchorage_USD_HKD_Rate__c: settings.usdHkdRate,
      Anchorage_FX_Settings_Revision__c: settings.revision,
      Anchorage_Calculation_Version__c: ANCHORAGE_CALCULATION_VERSION,
      Anchorage_Buyer_Default_USD__c: buyerAllocationById.get(input.id),
      Anchorage_Buyer_Rate_USD__c: ANCHORAGE_BUYER_RATE_USD_PER_NRT_HOUR,
      Anchorage_Buyer_Calc_Version__c: ANCHORAGE_BUYER_CALCULATION_VERSION,
    },
  }));
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest } });
  const failed = (result?.compositeResponse || []).find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
  if (failed) throw httpError(failed.body?.[0]?.message || 'Salesforce could not save the anchorage evidence.', 502, 'ANCHORAGE_SALESFORCE_WRITE_FAILED');
  const refreshed = await liveCaseForStem(body?.stemId, context);
  return {
    anchorage: anchorageEvidence(refreshed, settings),
    savedAt: new Date().toISOString(),
  };
}

async function assertStatutoryEvidenceAuthority(live, context) {
  const gm = await activeGeneralManager(context.client, context.profile?.id);
  const userType = text(context.profile?.user_type, 100).toLowerCase();
  const trader = (live.supplierRequirements || []).some((row) => row.assignedSupplierTrader?.id === context.profile?.id)
    || live.assignment?.profileId === context.profile?.id;
  if (!trader && userType !== 'administrator' && !gm.isGeneralManager) {
    throw httpError('Only an assigned trader, Administrator, or the active General Manager may save Hong Kong statutory-charge evidence.', 403, 'STATUTORY_CHARGE_SAVE_FORBIDDEN');
  }
}

export async function saveVariableChargeVesselNrt(body, context) {
  const live = await liveCaseForStem(body?.stemId, context);
  if (!isHongKongStem(live.stem)) throw httpError('Vessel NRT verification applies only to Hong Kong deliveries.', 409, 'NOT_HONG_KONG_DELIVERY');
  await assertStatutoryEvidenceAuthority(live, context);
  const vesselId = text(live.stem.Vessel__c, 18);
  if (!vesselId) throw httpError('This STEM has no Salesforce Vessel to update.', 409, 'VESSEL_NOT_SET');
  const nrt = numeric(body?.nrt, 'Vessel NRT', { positive: true, nullable: false });
  if (!Number.isInteger(nrt)) throw httpError('Vessel NRT must be a positive whole number.', 400, 'VESSEL_NRT_INVALID');
  const expectedLastModifiedDate = text(body?.expectedLastModifiedDate, 80);
  if (expectedLastModifiedDate !== text(live.stem.Vessel__r?.LastModifiedDate, 80)) {
    throw httpError('The Vessel changed after this task was opened. Refresh before saving NRT.', 409, 'VESSEL_REVISION_CONFLICT');
  }
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest(`/sobjects/Vessel__c/${vesselId}`, {
    method: 'PATCH',
    headers: lastModifiedHeaders(expectedLastModifiedDate),
    body: { NRT__c: nrt },
  });
  const affectedRows = await queryAll(`SELECT Id FROM STEM_Extra_Cost__c WHERE STEM__r.Vessel__c = '${escapeSoql(vesselId)}' AND Cancelled__c = false AND (Anchorage_Calculation_Version__c != null OR Light_Dues_Calculation_Version__c != null)`);
  return {
    vesselId,
    nrt,
    affectedReviewCount: affectedRows.length,
    savedAt: new Date().toISOString(),
    salesforceResult: result || null,
  };
}

export async function saveVariableChargeLightDues(body, context) {
  const live = await liveCaseForStem(body?.stemId, context);
  if (!isHongKongStem(live.stem)) throw httpError('Light Dues verification applies only to Hong Kong deliveries.', 409, 'NOT_HONG_KONG_DELIVERY');
  await assertStatutoryEvidenceAuthority(live, context);
  const liveRows = live.extraCosts.filter((row) => isLightDuesRow(row));
  if (!liveRows.length) throw httpError('No exact active LIGHT DUES charge was found.', 404, 'LIGHT_DUES_NOT_FOUND');
  if (!Array.isArray(body?.rows)) throw httpError('Light Dues entries are required.', 400, 'LIGHT_DUES_ROWS_REQUIRED');
  const byId = new Map(body.rows.map((row) => [text(row?.extraCostId || row?.id, 18), row]));
  if (byId.size !== liveRows.length || liveRows.some((row) => !byId.has(row.Id))) {
    throw httpError('Save every active LIGHT DUES entry together.', 409, 'LIGHT_DUES_SCOPE_CHANGED');
  }
  const settings = await variableChargeSettings(context.client);
  const vesselNrt = live.stem.Vessel__r?.NRT__c;
  const inputs = liveRows.map((row) => {
    const input = byId.get(row.Id);
    if (text(input?.expectedLastModifiedDate, 80) !== text(row.LastModifiedDate, 80)) {
      throw httpError('A Light Dues row changed after it was opened. Refresh and try again.', 409, 'LIGHT_DUES_ROW_CHANGED');
    }
    const { entryDate } = lightDuesArrivalEvidence(live, row);
    const calculation = calculateHongKongLightDues({ nrt: vesselNrt, category: LIGHT_DUES_CATEGORY_ALL_OTHER, entryDate });
    if (!calculation.complete) throw httpError(calculation.errors[0], 400, 'LIGHT_DUES_CALCULATION_INCOMPLETE', calculation.errors);
    return { row, calculation };
  });
  const compositeRequest = inputs.map(({ row, calculation }, index) => ({
    method: 'PATCH',
    url: `/services/data/${getApiVersion()}/sobjects/STEM_Extra_Cost__c/${row.Id}`,
    referenceId: `lightDues${index + 1}`,
    httpHeaders: lastModifiedHeaders(row.LastModifiedDate),
    body: {
      Light_Dues_Entry_Date__c: calculation.entryDate,
      Light_Dues_Category__c: calculation.category,
      Light_Dues_NRT_Snapshot__c: calculation.nrt,
      Light_Dues_Rate_HKD__c: calculation.rateHkdPerHundredNrt,
      Light_Dues_Amount_HKD__c: calculation.amountHkd,
      Light_Dues_USD_HKD_Rate__c: settings.usdHkdRate,
      Light_Dues_FX_Settings_Revision__c: settings.revision,
      Light_Dues_Calculation_Version__c: LIGHT_DUES_CALCULATION_VERSION,
    },
  }));
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest } });
  const failed = (result?.compositeResponse || []).find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
  if (failed) throw httpError(failed.body?.[0]?.message || 'Salesforce could not save the Light Dues evidence.', 502, 'LIGHT_DUES_SALESFORCE_WRITE_FAILED');
  const refreshed = await liveCaseForStem(body?.stemId, context);
  return { lightDues: lightDuesEvidence(refreshed, settings), savedAt: new Date().toISOString() };
}

function operationIdentity(body) {
  const operationId = text(body?.operationId, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw httpError('A UUID operation identity is required.', 400, 'INVALID_OPERATION_ID');
  }
  return operationId.toLowerCase();
}

async function reserveOperation(client, { operationId, type, stemId, fingerprint, actorId }) {
  const { data, error } = await client.rpc('reserve_variable_charge_operation', {
    p_operation_id: operationId,
    p_operation_type: type,
    p_stem_id: stemId,
    p_request_fingerprint: fingerprint,
    p_actor_user_id: actorId,
  });
  if (error) {
    if (/fingerprint|different request|already used/i.test(error.message || '')) throw httpError(error.message, 409, 'IDEMPOTENCY_CONFLICT');
    throw error;
  }
  return data || {};
}

async function completeOperation(client, operationId, status, result) {
  const { error } = await client.rpc('complete_variable_charge_operation', {
    p_operation_id: operationId,
    p_status: status,
    p_result: result || {},
  });
  if (error) throw error;
}

function currentCaseRow(rows, stemId) {
  const row = rows.find((item) => item.stem_id === stemId);
  if (!row) throw httpError('The Variable Charges Charge case is not synchronized yet. Refresh Payment Collections.', 409, 'CASE_NOT_SYNCHRONIZED');
  return row;
}

async function requireCaseAuthority(context, stored, body, { allowGeneralManager = true } = {}) {
  const gm = await activeGeneralManager(context.client, context.profile.id);
  const assignee = effectiveAssignee(stored);
  const normal = assignee.id === context.profile.id && !VIEW_ONLY_USER_TYPES.has(text(context.profile.user_type).toLowerCase());
  if (normal) return { generalManagerOverride: false, reason: null };
  const reason = text(body?.gmOverrideReason || body?.reason, 1000);
  if (allowGeneralManager && gm.isGeneralManager && reason.length >= 5) return { generalManagerOverride: true, reason };
  if (gm.isGeneralManager) throw httpError('A General Manager override reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
  throw httpError('Only the assigned Buyer Trader may change or confirm this case.', 403, 'ASSIGNED_TRADER_REQUIRED');
}

function numeric(value, label, { positive = false, nullable = true } = {}) {
  if (value === '' || value == null) {
    if (nullable) return null;
    throw httpError(`${label} is required.`, 400, 'INVALID_FINANCIAL_INPUT');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (positive && parsed <= 0)) throw httpError(`${label} is invalid.`, 400, 'INVALID_FINANCIAL_INPUT');
  return parsed;
}

function lastModifiedHeaders(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw httpError('Salesforce LastModifiedDate is required for a conflict-safe write.', 409, 'LAST_MODIFIED_DATE_REQUIRED');
  }
  return { 'If-Unmodified-Since': parsed.toUTCString() };
}

function reviewEvidence(review) {
  const reference = text(review?.referenceOrNote || review?.reference || review?.note, 1000);
  const evidenceDocumentIds = [...new Set((review?.evidenceDocumentIds || []).map((value) => text(value, 18)).filter(Boolean))];
  return { reference, evidenceDocumentIds };
}

function normalizeSupplierReviewPayload(body, supplierRows) {
  if (!Array.isArray(body?.rowOutcomes)) return body;
  const supplierReviewNote = text(body?.supplierReviewNote, 1000);
  if (!supplierReviewNote) {
    throw httpError('Add one supplier reference or note before confirming the costs.', 400, 'SUPPLIER_REVIEW_NOTE_REQUIRED');
  }
  const outcomes = new Map(body.rowOutcomes.map((row) => [
    text(row?.sourceId || row?.id, 64),
    {
      outcome: text(row?.outcome, 32).toLowerCase(),
      evidenceDocumentIds: Array.isArray(row?.evidenceDocumentIds) ? row.evidenceDocumentIds : [],
    },
  ]));
  const updateIds = new Set((body?.extraCostUpdates || []).map((row) => text(row?.extraCostId || row?.id, 18)));
  const cancellationIds = new Set((body?.cancellations || []).map((row) => text(typeof row === 'string' ? row : row?.extraCostId || row?.id, 18)));
  const reviews = supplierRows.map((row) => {
    const selected = outcomes.get(row.Id);
    if (!selected || !SUPPLIER_REVIEW_OUTCOMES.has(selected.outcome)) {
      throw httpError('Resolve every supplier charge as Correct or Edit Cost before approval.', 400, 'ROW_REVIEW_REQUIRED');
    }
    if (selected.outcome === 'changed' && !updateIds.has(row.Id)) {
      throw httpError('Save the corrected cost fields for every charge marked Edit Cost.', 400, 'ROW_CHANGE_REQUIRED');
    }
    if (selected.outcome === 'cancelled' && !cancellationIds.has(row.Id)) {
      throw httpError('A cancelled outcome must include the matching Salesforce charge cancellation.', 400, 'ROW_CANCELLATION_REQUIRED');
    }
    if (selected.outcome === 'correct' && (updateIds.has(row.Id) || cancellationIds.has(row.Id))) {
      throw httpError('A changed or cancelled charge cannot also be marked Correct.', 400, 'ROW_OUTCOME_CONFLICT');
    }
    return {
      sourceId: row.Id,
      sourceType: row.Original_Supplier__c ? 'line_item' : 'extra_cost',
      reviewed: true,
      referenceOrNote: supplierReviewNote,
      evidenceDocumentIds: selected.evidenceDocumentIds,
    };
  });
  return { ...body, reviews };
}

function normalizeBuyerReviewPayload(body, live) {
  if (!Array.isArray(body?.rowChargeDecisions)) return body;
  const buyerReviewNote = text(body?.buyerReviewNote, 1000);
  if (!buyerReviewNote) {
    throw httpError('Add one case note before approving the buyer charges.', 400, 'BUYER_REVIEW_NOTE_REQUIRED');
  }
  const decisions = new Map(body.rowChargeDecisions.map((row) => [
    text(row?.sourceId || row?.id, 64),
    {
      decision: text(row?.decision || row?.buyerChargeDecision, 32).toLowerCase(),
      evidenceDocumentIds: Array.isArray(row?.evidenceDocumentIds) ? row.evidenceDocumentIds : [],
    },
  ]));
  const rows = [...live.lineItems, ...live.extraCosts];
  const reviews = rows.map((row) => {
    const selected = decisions.get(row.Id);
    if (!selected || !['include', 'exclude'].includes(selected.decision)) {
      throw httpError('Choose Charge Buyer or Do Not Charge for every buyer charge before approval.', 400, 'BUYER_CHARGE_DECISION_REQUIRED');
    }
    return {
      sourceId: row.Id,
      sourceType: row.Original_Supplier__c ? 'line_item' : 'extra_cost',
      reviewed: true,
      buyerChargeDecision: selected.decision,
      referenceOrNote: buyerReviewNote,
      evidenceDocumentIds: selected.evidenceDocumentIds,
    };
  });
  return { ...body, reviews };
}

async function validateReviews(body, live, files) {
  const reviews = Array.isArray(body?.reviews) ? body.reviews : [];
  const existingIds = [...live.lineItems, ...live.extraCosts].map((row) => row.Id);
  const byId = new Map(reviews.map((review) => [text(review?.sourceId || review?.salesforceId || review?.id, 64), review]));
  for (const id of existingIds) {
    const review = byId.get(id);
    if (!review || review.reviewed !== true) throw httpError('Every current Variable Charges row must be reviewed individually.', 400, 'ROW_REVIEW_REQUIRED');
    if (!['include', 'exclude'].includes(review.buyerChargeDecision)) throw httpError('Every reviewed row needs a Charge Buyer or Do Not Charge decision.', 400, 'BUYER_CHARGE_DECISION_REQUIRED');
    const evidence = reviewEvidence(review);
    if (!evidence.reference && !evidence.evidenceDocumentIds.length) throw httpError('Every reviewed row needs a reference, note, or Salesforce File.', 400, 'ROW_EVIDENCE_REQUIRED');
  }
  const fileIds = new Set(files.map((row) => row.id));
  for (const review of reviews) {
    const evidence = reviewEvidence(review);
    if (evidence.evidenceDocumentIds.some((id) => !fileIds.has(id))) throw httpError('A selected Salesforce File is no longer linked to this STEM or charge row.', 409, 'EVIDENCE_CHANGED');
  }
  for (const addition of Array.isArray(body?.extraCostAdds) ? body.extraCostAdds : []) {
    const review = byId.get(text(addition?.reviewLocalId, 64));
    if (!review || review.reviewed !== true) throw httpError('Every new STEM Charge must be reviewed individually.', 400, 'ROW_REVIEW_REQUIRED');
    if (!['include', 'exclude'].includes(review.buyerChargeDecision)) throw httpError('Every new STEM Charge needs a Charge Buyer or Do Not Charge decision.', 400, 'BUYER_CHARGE_DECISION_REQUIRED');
    const evidence = reviewEvidence(review);
    if (!evidence.reference && !evidence.evidenceDocumentIds.length) throw httpError('Every new STEM Charge needs a reference, note, or Salesforce File.', 400, 'ROW_EVIDENCE_REQUIRED');
  }
  return reviews.map((review) => ({
    rowId: text(review.sourceId || review.salesforceId || review.id, 64),
    rowType: review.sourceType === 'line_item' || review.kind === 'line_item' ? 'line_item' : 'extra_cost',
    reviewed: review.reviewed === true,
    buyerChargeDecision: review.buyerChargeDecision,
    referencePresent: Boolean(reviewEvidence(review).reference),
    evidencePresent: reviewEvidence(review).evidenceDocumentIds.length > 0,
  }));
}

function expectedRevision(body, stored) {
  const expected = Number(body?.expectedRevision);
  if (!Number.isInteger(expected) || expected !== Number(stored.revision || 0)) {
    throw httpError('This Variable Charges Charge case changed after it was opened. Refresh and review it again.', 409, 'CASE_REVISION_CONFLICT', { current: { revision: Number(stored.revision || 0) } });
  }
  if (text(body?.expectedFingerprint, 128) !== text(stored.source_fingerprint || body?.expectedFingerprint, 128)) {
    throw httpError('Salesforce charge data changed after this case was opened. Refresh and review every row again.', 409, 'SALESFORCE_FINGERPRINT_CONFLICT');
  }
}

function findExtra(live, id, lastModifiedDate) {
  const row = live.extraCosts.find((item) => item.Id === id);
  if (!row) throw httpError('A Variable Charges extra-cost row changed or is no longer active.', 409, 'EXTRA_COST_CHANGED');
  if (!lastModifiedDate || row.LastModifiedDate !== lastModifiedDate) throw httpError('A Variable Charges extra-cost row changed after it was opened.', 409, 'EXTRA_COST_CONFLICT');
  return row;
}

async function salesforceChargeWrites(body, live) {
  const updates = Array.isArray(body?.extraCostUpdates) ? body.extraCostUpdates : [];
  const additions = Array.isArray(body?.extraCostAdds) ? body.extraCostAdds : [];
  const cancellations = Array.isArray(body?.cancellations) ? body.cancellations : [];
  if (additions.length || cancellations.length) {
    throw httpError('The assigned Supplier Trader must complete supplier additions and cancellations before buyer charges can be approved.', 409, 'SUPPLIER_STAGE_WRITE_REQUIRED');
  }
  const requests = [];
  const apiVersion = getApiVersion();
  let reference = 0;
  for (const update of updates) {
    const id = text(update?.extraCostId || update?.id, 18);
    const current = findExtra(live, id, text(update?.expectedLastModifiedDate || update?.lastModifiedDate, 80));
    const currentMode = current.Lumpsum_Cost__c != null || current.Lumpsum_Price__c != null ? 'fixed' : 'per_unit';
    const requestedMode = (update.pricingType || update.pricingMode) === 'per_unit' ? 'per_unit' : 'fixed';
    if (requestedMode !== currentMode) {
      throw httpError('The Buyer Trader cannot change supplier pricing basis, quantity, or UOM. Reverify the supplier stage first.', 409, 'SUPPLIER_PRICING_BASIS_LOCKED');
    }
    const patch = {};
    if (currentMode === 'fixed') {
      patch.Lumpsum_Price__c = numeric(update.buyerPrice ?? update.price ?? update.fixedAmount, 'Fixed buyer price');
    } else {
      patch.Unit_Price__c = numeric(update.buyerPrice ?? update.price ?? update.unitPrice, 'Unit buyer price');
    }
    requests.push({ method: 'PATCH', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`, referenceId: `update${reference++}`, httpHeaders: lastModifiedHeaders(current.LastModifiedDate), body: patch });
  }
  if (!requests.length) return { changed: false, responses: [] };
  if (requests.length > 25) throw httpError('A maximum of 25 Salesforce charge changes may be confirmed in one atomic operation.', 400, 'COMPOSITE_LIMIT_EXCEEDED');
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
  const responses = result?.compositeResponse || [];
  const failed = responses.find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
  if (failed) throw httpError(failed.body?.[0]?.message || failed.body?.message || 'Salesforce rejected the atomic charge update.', 502, 'SALESFORCE_COMPOSITE_FAILED');
  return { changed: true, responses };
}

function roundedSalesforceCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function supplierInputEvidence(input, settings, label, requiredCurrency = null) {
  const inputCurrency = text(input?.inputCurrency || input?.supplierInputCurrency, 3).toUpperCase() || 'USD';
  if (!['USD', 'HKD'].includes(inputCurrency)) throw httpError('Supplier Input Currency must be HKD or USD.', 400, 'SUPPLIER_INPUT_CURRENCY_INVALID');
  if (requiredCurrency && inputCurrency !== requiredCurrency) {
    throw httpError(`This agent's supplier costs must be entered in its agreed ${requiredCurrency} currency. Refresh and review the charge again.`, 409, 'AGENT_COST_CURRENCY_MISMATCH');
  }
  const nativeAmount = numeric(input?.supplierCost ?? input?.cost ?? input?.fixedAmount ?? input?.unitPrice, label, { nullable: false });
  if (Number(input?.expectedFxSettingsRevision) !== Number(settings.revision)) {
    throw httpError('The company USD/HKD rate changed after this charge was opened. Refresh before saving.', 409, 'FX_SETTINGS_REVISION_CONFLICT');
  }
  const usdAmount = inputCurrency === 'HKD' ? nativeAmount / settings.usdHkdRate : nativeAmount;
  return {
    usdAmount: roundedSalesforceCurrency(usdAmount),
    fields: {
      Supplier_Cost_Input_Currency__c: inputCurrency,
      Supplier_Cost_Input_Value__c: nativeAmount,
      Supplier_Cost_USD_HKD_Rate__c: settings.usdHkdRate,
      Supplier_Cost_FX_Settings_Revision__c: settings.revision,
    },
  };
}

function managedAgencyFeeFields(live, supplierId, settings, { includeBuyerFields = false } = {}) {
  const supplier = (live.accounts || []).find((row) => row.Id === supplierId);
  const nativeAmount = finiteAmount(supplier?.Agency_Fee_USD__c);
  if (!(nativeAmount > 0)) {
    throw httpError('Set the Agreed Agency Fee and Currency on the supplier Account before approving Agency Fee.', 409, 'AGENCY_FEE_UNAVAILABLE');
  }
  const inputCurrency = text(supplier?.Agency_Fee_Currency__c, 3).toUpperCase() || 'USD';
  if (!['USD', 'HKD'].includes(inputCurrency)) {
    throw httpError('The supplier Account Agency Fee Currency must be USD or HKD.', 409, 'AGENCY_FEE_CURRENCY_INVALID');
  }
  if (!(finiteAmount(settings?.usdHkdRate) > 0)) {
    throw httpError('The company USD/HKD rate is unavailable. Refresh Variable Charges settings before approval.', 503, 'VARIABLE_CHARGE_SETTINGS_UNAVAILABLE');
  }
  const usdAmount = inputCurrency === 'HKD' ? nativeAmount / settings.usdHkdRate : nativeAmount;
  return {
    Lumpsum_Cost__c: roundedSalesforceCurrency(usdAmount),
    Supplier_Cost_Input_Currency__c: inputCurrency,
    Supplier_Cost_Input_Value__c: nativeAmount,
    Supplier_Cost_USD_HKD_Rate__c: settings.usdHkdRate,
    Supplier_Cost_FX_Settings_Revision__c: settings.revision,
    ...(includeBuyerFields ? { Lumpsum_Price__c: 0 } : {}),
  };
}

async function salesforceSupplierChargeWrites(body, live, supplierId, context, { includeBuyerFields = false } = {}) {
  const updates = Array.isArray(body?.extraCostUpdates) ? body.extraCostUpdates : [];
  const additions = Array.isArray(body?.extraCostAdds) ? body.extraCostAdds : [];
  const cancellations = Array.isArray(body?.cancellations) ? body.cancellations : [];
  const products = new Map((await activeProducts()).map((row) => [row.id, row]));
  const recordTypes = await queryAll("SELECT Id FROM RecordType WHERE SObjectType = 'STEM_Extra_Cost__c' AND DeveloperName = 'STEM_Charge' LIMIT 1");
  if (recordTypes.length !== 1) throw httpError('The Salesforce STEM Charge record type is unavailable.', 503, 'STEM_CHARGE_RECORD_TYPE_UNAVAILABLE');
  const requests = [];
  const hongKongDelivery = isHongKongStem(live.stem);
  const agentCurrency = requiredAgentCurrency(live, supplierId);
  const bundleSupplierIds = basicCallingSupplierIds(live);
  const settings = hongKongDelivery || agentCurrency ? await variableChargeSettings(context.client) : null;
  const apiVersion = getApiVersion();
  let reference = 0;
  const explicitlyUpdatedIds = new Set();
  const explicitlyCancelledIds = new Set();
  for (const update of updates) {
    const id = text(update?.extraCostId || update?.id, 18);
    const current = findExtra(live, id, text(update?.expectedLastModifiedDate || update?.lastModifiedDate, 80));
    if (current.Supplier__c !== supplierId) throw httpError('A Supplier Trader may edit only their exact supplier rows.', 403, 'SUPPLIER_SCOPE_MISMATCH');
    explicitlyUpdatedIds.add(id);
    if (isBasicCallingBundleSupportRow(current, bundleSupplierIds) && isAgencyFeeRow(current)) {
      const buyerOnly = includeBuyerFields
        && update.supplierCost == null && update.cost == null && update.fixedAmount == null
        && update.inputCurrency == null && update.supplierInputCurrency == null;
      if (buyerOnly) {
        requests.push({
          method: 'PATCH',
          url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`,
          referenceId: `buyerUpdate${reference++}`,
          httpHeaders: lastModifiedHeaders(current.LastModifiedDate),
          body: managedAgencyFeeFields(live, supplierId, settings, { includeBuyerFields: true }),
        });
        continue;
      }
      throw httpError('Agency Fee is locked to the Agreed Agency Fee and Currency on the supplier Account.', 409, 'AGENCY_FEE_LOCKED');
    }
    if (isBasicCallingBundleSupportRow(current, bundleSupplierIds) && isPortClearanceRow(current)) {
      const calculation = calculatePortClearance({
        applicationCount: update.quantity,
        usdHkdRate: settings?.usdHkdRate,
      });
      if (!calculation.complete) throw httpError(calculation.errors[0], 400, 'PORT_CLEARANCE_APPLICATION_COUNT_INVALID');
      requests.push({
        method: 'PATCH',
        url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`,
        referenceId: `supplierUpdate${reference++}`,
        httpHeaders: lastModifiedHeaders(current.LastModifiedDate),
        body: {
          Fixed__c: true,
          Quantity__c: calculation.applicationCount,
          Quantity_Delivered_Per_BDN__c: calculation.applicationCount,
          Unit_of_Measure__c: '1.',
          Lumpsum_Cost__c: calculation.supplierTotalUsd,
          Lumpsum_Price__c: calculation.buyerTotalUsd,
          Unit_Cost__c: null,
          Unit_Price__c: null,
          Supplier_Cost_Input_Currency__c: agentCurrency || 'HKD',
          Supplier_Cost_Input_Value__c: agentCurrency === 'USD' ? calculation.supplierTotalUsd : calculation.supplierHkd,
          Supplier_Cost_USD_HKD_Rate__c: settings.usdHkdRate,
          Supplier_Cost_FX_Settings_Revision__c: settings.revision,
          Port_Clearance_Rate_HKD__c: PORT_CLEARANCE_RATE_HKD,
          Port_Clearance_Calculation_Version__c: PORT_CLEARANCE_CALCULATION_VERSION,
        },
      });
      continue;
    }
    const mode = (update.pricingType || update.pricingMode) === 'per_unit' ? 'per_unit' : 'fixed';
    const supplierEditRequested = ['supplierCost', 'cost', 'fixedAmount', 'unitPrice', 'inputCurrency', 'supplierInputCurrency', 'description', 'quantity', 'unitOfMeasure']
      .some((field) => Object.prototype.hasOwnProperty.call(update, field));
    if (includeBuyerFields && !supplierEditRequested) {
      requests.push({
        method: 'PATCH',
        url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`,
        referenceId: `buyerUpdate${reference++}`,
        httpHeaders: lastModifiedHeaders(current.LastModifiedDate),
        body: mode === 'fixed'
          ? { Lumpsum_Price__c: numeric(update.buyerPrice ?? update.price ?? update.fixedBuyerAmount, 'Fixed buyer price') }
          : { Unit_Price__c: numeric(update.buyerPrice ?? update.price ?? update.buyerUnitPrice, 'Unit buyer price') },
      });
      continue;
    }
    const bodyPatch = { Description__c: text(update.description, 32_000) || null };
    const supplierInput = hongKongDelivery || agentCurrency
      ? supplierInputEvidence(update, settings, mode === 'fixed' ? 'Fixed supplier cost' : 'Supplier unit cost', agentCurrency)
      : null;
    if (supplierInput) Object.assign(bodyPatch, supplierInput.fields);
    if (mode === 'fixed') {
      bodyPatch.Lumpsum_Cost__c = supplierInput?.usdAmount ?? numeric(update.supplierCost ?? update.cost ?? update.fixedAmount, 'Fixed supplier cost');
      bodyPatch.Unit_Cost__c = null;
      if (includeBuyerFields) bodyPatch.Lumpsum_Price__c = numeric(update.buyerPrice ?? update.price ?? update.fixedBuyerAmount, 'Fixed buyer price');
    } else {
      bodyPatch.Quantity__c = numeric(update.quantity, 'Quantity', { positive: true, nullable: false });
      bodyPatch.Unit_of_Measure__c = text(update.unitOfMeasure || current.Unit_of_Measure__c, 40) || '1.';
      bodyPatch.Unit_Cost__c = supplierInput?.usdAmount ?? numeric(update.supplierCost ?? update.cost ?? update.unitPrice, 'Supplier unit cost');
      bodyPatch.Lumpsum_Cost__c = null;
      if (includeBuyerFields) bodyPatch.Unit_Price__c = numeric(update.buyerPrice ?? update.price ?? update.buyerUnitPrice, 'Buyer unit price');
    }
    requests.push({ method: 'PATCH', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`, referenceId: `supplierUpdate${reference++}`, httpHeaders: lastModifiedHeaders(current.LastModifiedDate), body: bodyPatch });
  }
  for (const cancel of cancellations) {
    const id = text(typeof cancel === 'string' ? cancel : cancel?.extraCostId || cancel?.id, 18);
    const current = findExtra(live, id, text(typeof cancel === 'string' ? '' : cancel?.expectedLastModifiedDate || cancel?.lastModifiedDate, 80));
    if (current.Supplier__c !== supplierId) throw httpError('A Supplier Trader may cancel only their exact supplier rows.', 403, 'SUPPLIER_SCOPE_MISMATCH');
    if (isManagedBasicCallingRow(current)) throw httpError('A Basic Calling Cost support row is managed automatically and cannot be cancelled here.', 409, 'BASIC_CALLING_ROW_MANAGED');
    explicitlyCancelledIds.add(id);
    requests.push({ method: 'PATCH', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${id}`, referenceId: `supplierCancel${reference++}`, httpHeaders: lastModifiedHeaders(current.LastModifiedDate), body: { Cancelled__c: true } });
  }
  const supplier = live.accounts.find((row) => row.Id === supplierId);
  for (const addition of additions) {
    const productId = text(addition?.productId, 18);
    if (text(addition?.supplierAccountId || addition?.supplierId, 18) !== supplierId) throw httpError('New supplier charges must use the exact stage Supplier Account.', 403, 'SUPPLIER_SCOPE_MISMATCH');
    if (!products.has(productId)) throw httpError('New STEM Charges require an active Salesforce Product.', 409, 'PRODUCT_INACTIVE');
    const childTerms = [...new Set([...live.lineItems.filter((row) => row.Original_Supplier__c === supplierId), ...live.extraCosts.filter((row) => row.Supplier__c === supplierId)].map((row) => text(row.Payment_Term__c, 255)).filter(Boolean))];
    const paymentTerm = text(supplier?.Supplier_Payment_Term__c, 255) || (childTerms.length === 1 ? childTerms[0] : null);
    if (!paymentTerm) throw httpError('The supplier payment term is unavailable or ambiguous and cannot be guessed.', 409, 'PAYMENT_TERM_UNAVAILABLE');
    const mode = (addition.pricingType || addition.pricingMode) === 'per_unit' ? 'per_unit' : 'fixed';
    const create = { STEM__c: live.stem.Id, Supplier__c: supplierId, Product2Id__c: productId, RecordTypeId: recordTypes[0].Id, Payment_Term__c: paymentTerm, Cancelled__c: false, Description__c: text(addition.description, 32_000) || 'STEM Charge' };
    const supplierInput = hongKongDelivery || agentCurrency
      ? supplierInputEvidence(addition, settings, mode === 'fixed' ? 'Fixed supplier cost' : 'Supplier unit cost', agentCurrency)
      : null;
    if (supplierInput) Object.assign(create, supplierInput.fields);
    if (mode === 'fixed') {
      create.Lumpsum_Cost__c = supplierInput?.usdAmount ?? numeric(addition.supplierCost ?? addition.cost ?? addition.fixedAmount, 'Fixed supplier cost');
      if (includeBuyerFields) create.Lumpsum_Price__c = numeric(addition.buyerPrice ?? addition.price ?? addition.fixedBuyerAmount, 'Fixed buyer price');
      create.Quantity__c = numeric(addition.quantity ?? 1, 'Quantity', { positive: true, nullable: false });
      create.Unit_of_Measure__c = text(addition.unitOfMeasure, 40) || '1.';
    } else {
      create.Quantity__c = numeric(addition.quantity, 'Quantity', { positive: true, nullable: false });
      create.Unit_of_Measure__c = text(addition.unitOfMeasure, 40) || '1.';
      create.Unit_Cost__c = supplierInput?.usdAmount ?? numeric(addition.supplierCost ?? addition.cost ?? addition.unitPrice, 'Supplier unit cost');
      if (includeBuyerFields) create.Unit_Price__c = numeric(addition.buyerPrice ?? addition.price ?? addition.buyerUnitPrice, 'Buyer unit price');
    }
    requests.push({ method: 'POST', url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c`, referenceId: `supplierCreate${reference++}`, body: create });
  }
  if (hongKongDelivery || agentCurrency) {
    for (const current of live.extraCosts) {
      if (current.Supplier__c !== supplierId || explicitlyUpdatedIds.has(current.Id) || explicitlyCancelledIds.has(current.Id)) continue;
      if (isBasicCallingBundleSupportRow(current, bundleSupplierIds) && isAgencyFeeRow(current)) {
        requests.push({
          method: 'PATCH',
          url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${current.Id}`,
          referenceId: `agencyFeeSnapshot${reference++}`,
          httpHeaders: lastModifiedHeaders(current.LastModifiedDate),
          body: managedAgencyFeeFields(live, supplierId, settings, { includeBuyerFields: true }),
        });
        continue;
      }
      const currentSupplierCost = current.Lumpsum_Cost__c ?? current.Unit_Cost__c ?? null;
      if (finiteAmount(currentSupplierCost) == null) continue;
      const currentInputCurrency = text(current.Supplier_Cost_Input_Currency__c, 3).toUpperCase();
      const currentInputValue = finiteAmount(current.Supplier_Cost_Input_Value__c);
      const currentRate = finiteAmount(current.Supplier_Cost_USD_HKD_Rate__c);
      if (agentCurrency && currentInputCurrency === agentCurrency && currentInputValue != null && currentRate > 0) continue;
      if (!agentCurrency && currentInputValue != null && currentRate > 0) continue;
      const snapshotCurrency = agentCurrency || currentInputCurrency || 'USD';
      const snapshotValue = snapshotCurrency === 'HKD'
        ? Math.round(Number(currentSupplierCost) * Number(settings.usdHkdRate) * 1_000_000) / 1_000_000
        : Number(currentSupplierCost);
      const snapshotCurrent = text(current.Supplier_Cost_Input_Currency__c, 3).toUpperCase() === snapshotCurrency
        && finiteAmount(current.Supplier_Cost_Input_Value__c) != null
        && Math.abs(Number(current.Supplier_Cost_Input_Value__c) - snapshotValue) <= 0.000001
        && Math.abs((finiteAmount(current.Supplier_Cost_USD_HKD_Rate__c) ?? 0) - Number(settings.usdHkdRate)) <= 0.000001;
      if (snapshotCurrent) continue;
      requests.push({
        method: 'PATCH',
        url: `/services/data/${apiVersion}/sobjects/STEM_Extra_Cost__c/${current.Id}`,
        referenceId: `supplierSnapshot${reference++}`,
        httpHeaders: lastModifiedHeaders(current.LastModifiedDate),
        body: {
          Supplier_Cost_Input_Currency__c: snapshotCurrency,
          Supplier_Cost_Input_Value__c: snapshotValue,
          Supplier_Cost_USD_HKD_Rate__c: settings.usdHkdRate,
          Supplier_Cost_FX_Settings_Revision__c: settings.revision,
        },
      });
    }
  }
  if (!requests.length) return { changed: false, responses: [] };
  if (requests.length > 25) throw httpError('A maximum of 25 supplier charge changes may be verified atomically.', 400, 'COMPOSITE_LIMIT_EXCEEDED');
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', { method: 'POST', body: { allOrNone: true, compositeRequest: requests } });
  const responses = result?.compositeResponse || [];
  const failed = responses.find((row) => row.httpStatusCode < 200 || row.httpStatusCode >= 300);
  if (failed) throw httpError(failed.body?.[0]?.message || failed.body?.message || 'Salesforce rejected the atomic supplier charge update.', 502, 'SALESFORCE_COMPOSITE_FAILED');
  return { changed: true, responses };
}

async function setSalesforceConfirmed(stemId, confirmed, expectedLastModifiedDate) {
  requireExternalActionGate('salesforce_write');
  const result = await sfRequest('/composite', {
    method: 'POST',
    body: {
      allOrNone: true,
      compositeRequest: [{
        method: 'PATCH', url: `/services/data/${getApiVersion()}/sobjects/STEM__c/${stemId}`,
        referenceId: 'confirmStem', httpHeaders: lastModifiedHeaders(expectedLastModifiedDate),
        body: { Variable_Charges_Confirmed__c: confirmed === true },
      }],
    },
  });
  const response = result?.compositeResponse?.[0];
  if (!response || response.httpStatusCode < 200 || response.httpStatusCode >= 300) {
    throw httpError(response?.body?.[0]?.message || 'Salesforce could not record the Variable Charges confirmation.', 502, 'SALESFORCE_CONFIRMATION_FAILED');
  }
}

export async function saveAndConfirmVariableCharges(body, context) {
  const stemId = text(body?.stemId, 18);
  const operationId = operationIdentity(body);
  const liveBefore = await liveCaseForStem(stemId, context);
  const stored = currentCaseRow(await storedCases(context.client, [stemId]), stemId);
  const authority = await requireCaseAuthority(context, stored, body);
  const requestFingerprint = sha256({
    stemId,
    expectedRevision: body.expectedRevision,
    expectedFingerprint: body.expectedFingerprint,
    reviews: body.reviews || [],
    extraCostUpdates: body.extraCostUpdates || [],
    extraCostAdds: body.extraCostAdds || [],
    cancellations: body.cancellations || [],
    overrideReason: authority.reason,
  });
  const reservation = await reserveOperation(context.client, { operationId, type: 'confirm', stemId, fingerprint: requestFingerprint, actorId: context.profile.id });
  if (reservation?.status === 'succeeded') return reservation.result || reservation.result_payload || {};
  if (reservation?.status === 'uncertain') throw httpError('This operation has an uncertain Salesforce outcome. Refresh the live case before taking another action.', 409, 'OPERATION_UNCERTAIN');
  if (reservation?.status === 'failed') throw httpError('This operation already failed. Refresh the live case and submit a new confirmation.', 409, 'OPERATION_FAILED');
  assertLiveActionable(liveBefore);
  let reviews;
  if (reservation?.status === 'salesforce_written') {
    const writtenFingerprint = text(reservation?.result?.sourceFingerprint, 128);
    if (!writtenFingerprint || writtenFingerprint !== liveBefore.fingerprint) {
      throw httpError('Salesforce data changed after the atomic charge write. Refresh before resuming this confirmation.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
    }
    reviews = (Array.isArray(body?.reviews) ? body.reviews : []).map((review) => ({
      reviewed: review?.reviewed === true,
      buyerChargeDecision: review?.buyerChargeDecision,
      referencePresent: Boolean(reviewEvidence(review).reference),
      evidencePresent: reviewEvidence(review).evidenceDocumentIds.length > 0,
    }));
  } else {
    expectedRevision(body, stored);
    if (text(body?.expectedStemLastModifiedAt, 80) !== text(liveBefore.stem.LastModifiedDate, 80)) {
      throw httpError('The Salesforce STEM changed after it was opened. Refresh and review the current case.', 409, 'STEM_LAST_MODIFIED_CONFLICT');
    }
    if (text(body?.expectedFingerprint, 128) !== liveBefore.fingerprint) throw httpError('Salesforce data changed after this case was opened. Refresh and review every row again.', 409, 'LIVE_DATA_CONFLICT');
    const files = await linkedSalesforceFiles(liveBefore);
    reviews = await validateReviews(body, liveBefore, files);
  }
  let salesforceWriteAttempted = false;
  let salesforceWritten = reservation?.status === 'salesforce_written';
  let postWriteFingerprint = reservation?.status === 'salesforce_written'
    ? text(reservation?.result?.sourceFingerprint, 128)
    : null;
  let databaseConfirmed = false;
  try {
    if (reservation?.status !== 'salesforce_written') {
      salesforceWriteAttempted = true;
      await salesforceChargeWrites(body, liveBefore);
      const liveAfterWrite = await liveCaseForStem(stemId, context);
      postWriteFingerprint = liveAfterWrite.fingerprint;
      await completeOperation(context.client, operationId, 'salesforce_written', {
        stemId, sourceFingerprint: postWriteFingerprint,
      });
      salesforceWritten = true;
    }
    const liveAfter = await liveCaseForStem(stemId, context);
    if (!postWriteFingerprint || liveAfter.fingerprint !== postWriteFingerprint) {
      throw httpError('Salesforce data changed after the atomic charge write. Refresh before confirming it.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
    }
    const included = reviews.filter((row) => row.buyerChargeDecision === 'include');
    const { data, error } = await context.client.rpc('confirm_variable_charge_case', {
      p_stem_id: stemId,
      p_expected_revision: Number(stored.revision || 0),
      p_expected_fingerprint: stored.source_fingerprint,
      p_confirmation: {
        chargeToBuyer: included.length > 0,
        rowByRowReviewed: reviews.length > 0 && reviews.every((row) => row.reviewed),
        reviewedSourceFingerprint: liveAfter.fingerprint,
        referenceOrNote: reviews.some((row) => row.referencePresent) ? 'Reference or review note recorded for every applicable row.' : null,
        evidencePresent: reviews.some((row) => row.evidencePresent),
      },
      p_event: {
        eventKey: `confirm:${operationId}`,
        summary: 'Variable Charges charges confirmed.',
        metadata: {
          caseState: 'ready_for_invoice',
          chargeToBuyer: included.length > 0,
          evidencePresent: reviews.some((row) => row.evidencePresent),
          reasonProvided: authority.generalManagerOverride,
        },
      },
      p_operation_id: operationId,
      p_request_fingerprint: requestFingerprint,
      p_actor_user_id: context.profile.id,
      p_actor_email: context.profile.email,
      p_override_reason: authority.reason,
    });
    if (error) {
      if (/changed after it was opened|revision|fingerprint/i.test(error.message || '')) throw httpError(error.message, 409, 'CASE_REVISION_CONFLICT');
      throw error;
    }
    databaseConfirmed = true;
    await setSalesforceConfirmed(stemId, true, liveAfter.stem.LastModifiedDate);
    const confirmedCase = data?.case || data;
    await completeOperation(context.client, operationId, 'succeeded', {
      caseId: confirmedCase?.id,
      stemId,
      revision: confirmedCase?.revision,
      status: confirmedCase?.workflow_status || 'ready_for_invoice',
      eventId: data?.event?.id,
      duplicate: data?.duplicate === true,
    });
    const result = { case: data?.case || data, confirmation: data?.confirmation || null, operationId };
    return result;
  } catch (error) {
    if (!databaseConfirmed && salesforceWriteAttempted && !salesforceWritten) {
      const operationStatus = error.code === 'SALESFORCE_COMPOSITE_FAILED' ? 'failed' : 'uncertain';
      await completeOperation(context.client, operationId, operationStatus, { stemId, errorCode: error.code || 'SALESFORCE_WRITE_UNCERTAIN' }).catch(() => {});
    }
    throw error;
  }
}

export async function verifyVariableChargeSupplier(body, context) {
  const stemId = text(body?.stemId, 18);
  const supplierId = text(body?.supplierId, 18);
  const operationId = operationIdentity(body);
  const live = await liveCaseForStem(stemId, context);
  const requirement = (live.supplierRequirements || []).find((row) => row.supplierId === supplierId);
  if (!requirement?.effectiveRequired) throw httpError('This exact supplier is not currently required in Variable Charges.', 409, 'SUPPLIER_STAGE_NOT_REQUIRED');
  const gm = await activeGeneralManager(context.client, context.profile.id);
  const assigned = requirement.assignedSupplierTrader?.id === context.profile.id
    && !VIEW_ONLY_USER_TYPES.has(text(context.profile?.user_type, 100).toLowerCase());
  const overrideReason = text(body?.gmOverrideReason || body?.reason, 1000);
  if (!assigned && !(gm.isGeneralManager && overrideReason.length >= 5)) {
    if (gm.isGeneralManager) throw httpError('A General Manager override reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
    throw httpError('Only the assigned Supplier Trader may verify this supplier stage.', 403, 'ASSIGNED_SUPPLIER_TRADER_REQUIRED');
  }
  assertLiveActionable(live);
  await assertStatutoryApprovalReady(live, supplierId, context, 'cost');
  if (text(body?.expectedStemLastModifiedAt, 80) !== text(live.stem.LastModifiedDate, 80)) {
    throw httpError('The Salesforce STEM changed after this supplier stage was opened.', 409, 'STEM_LAST_MODIFIED_CONFLICT');
  }
  if (requirement.lastModifiedAt && text(body?.expectedStageLastModifiedAt, 80) !== text(requirement.lastModifiedAt, 80)) {
    throw httpError('This supplier stage changed after it was opened.', 409, 'SUPPLIER_STAGE_CONFLICT');
  }
  const supplierRows = [...live.lineItems, ...live.extraCosts].filter((row) => (row.Original_Supplier__c || row.Supplier__c) === supplierId);
  body = normalizeSupplierReviewPayload(body, supplierRows);
  const reviews = Array.isArray(body?.reviews) ? body.reviews : [];
  const reviewById = new Map(reviews.map((row) => [text(row?.sourceId || row?.id, 64), row]));
  for (const row of supplierRows) {
    const review = reviewById.get(row.Id);
    const evidence = reviewEvidence(review);
    if (!review || review.reviewed !== true) throw httpError('Review every current row for this supplier before verifying.', 400, 'ROW_REVIEW_REQUIRED');
    if (!evidence.reference) throw httpError('Every reviewed supplier row needs a reference or note. Salesforce Files are optional evidence.', 400, 'ROW_REFERENCE_REQUIRED');
  }
  const requestFingerprint = sha256({ stemId, supplierId, expectedStageLastModifiedAt: body?.expectedStageLastModifiedAt, reviews, extraCostUpdates: body?.extraCostUpdates || [], extraCostAdds: body?.extraCostAdds || [], cancellations: body?.cancellations || [], overrideReason: gm.isGeneralManager ? overrideReason : null });
  const reservation = await reserveOperation(context.client, { operationId, type: 'supplier_verify', stemId, fingerprint: requestFingerprint, actorId: context.profile.id });
  if (reservation?.status === 'succeeded') return reservation.result || {};
  const foreignSupplierWrite = [...(body?.extraCostUpdates || []), ...(body?.extraCostAdds || []), ...(body?.cancellations || [])].some((row) => {
    const id = text(typeof row === 'string' ? row : row?.extraCostId || row?.id, 18);
    const current = id ? live.extraCosts.find((item) => item.Id === id) : null;
    const requestedSupplier = text(row?.supplierAccountId || row?.supplierId, 18);
    return current ? current.Supplier__c !== supplierId : requestedSupplier !== supplierId;
  });
  if (foreignSupplierWrite) throw httpError('A Supplier Trader may change only the exact supplier assigned to this stage.', 403, 'SUPPLIER_SCOPE_MISMATCH');
  let writeAttempted = false;
  try {
    writeAttempted = true;
    await salesforceSupplierChargeWrites(body, live, supplierId, context);
    const refreshed = await liveCaseForStem(stemId, context);
    await assertBasicCallingApprovalReady(refreshed, supplierId, context, 'cost');
    const refreshedRequirement = (refreshed.supplierRequirements || []).find((row) => row.supplierId === supplierId);
    const readinessSnapshot = await sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/fingerprint`, { readOnly: true });
    const result = await sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/verify`, {
      method: 'POST',
      body: {
        stemId,
        supplierId,
        verifierEmail: context.profile.email,
        expectedFingerprint: readinessSnapshot?.fingerprint,
        expectedStemLastModifiedAt: apexUtcTimestamp(refreshed.stem.LastModifiedDate, { required: true, label: 'STEM' }),
        expectedStageLastModifiedAt: apexUtcTimestamp(refreshedRequirement?.lastModifiedAt, { label: 'Supplier stage' }),
        gmOverrideReason: gm.isGeneralManager && !assigned ? overrideReason : null,
      },
    });
    const referencesRecorded = reviews.length > 0 && reviews.every((review) => Boolean(reviewEvidence(review).reference));
    const evidencePresent = reviews.some((review) => reviewEvidence(review).evidenceDocumentIds.length > 0);
    const { error: confirmationError } = await context.client.rpc('record_variable_charge_supplier_confirmation', {
      p_stem_id: stemId,
      p_supplier_account_id: supplierId,
      p_assigned_supplier_user_id: requirement.assignedSupplierTrader?.id || null,
      p_assignment_source: !assigned && gm.isGeneralManager
        ? 'manual_gm_override'
        : requirement.assignedSupplierTrader?.matchedBy === 'name' ? 'nomination_name' : 'nomination_email',
      p_requirement_source: requirement.isAgent ? 'is_agent' : requirement.isVariable ? 'is_variable' : 'manual',
      p_source_fingerprint: result?.fingerprint || readinessSnapshot?.fingerprint,
      p_salesforce_stage_last_modified_at: result?.lastModifiedAt || null,
      p_reference_recorded: referencesRecorded,
      p_evidence_present: evidencePresent,
      p_actor_user_id: context.profile.id,
      p_actor_email: context.profile.email,
      p_override_reason_recorded: !assigned && gm.isGeneralManager,
    });
    if (confirmationError) throw confirmationError;
    const completed = { stemId, supplierId, status: 'Verified', revision: result?.revision ?? null };
    await completeOperation(context.client, operationId, 'succeeded', completed);
    return { supplierStage: result, operationId };
  } catch (error) {
    await completeOperation(context.client, operationId, writeAttempted ? 'uncertain' : 'failed', { stemId, errorCode: error.code || 'SUPPLIER_VERIFY_FAILED' }).catch(() => {});
    throw error;
  }
}

function selectedSides(body) {
  const raw = Array.isArray(body?.sides) ? body.sides : body?.side ? [body.side] : [];
  const sides = [...new Set(raw.map((value) => text(value, 40).toLowerCase().replaceAll('-', '_')))];
  if (!sides.length || sides.some((side) => !['cost', 'buyer_charge'].includes(side))) {
    throw httpError('Select the cost side, buyer-charge side, or both sides.', 400, 'INVALID_VARIABLE_CHARGE_SIDE');
  }
  return sides;
}

function expectedSideRevisions(body, sides) {
  const source = body?.expectedRevisions || {};
  const result = {};
  for (const side of sides) {
    const revision = Number(source[side] ?? (side === 'buyer_charge' ? source.buyerCharge : undefined));
    if (!Number.isInteger(revision) || revision < 1) {
      throw httpError('Refresh before changing this side; its workflow revision is unavailable.', 409, 'SIDE_REVISION_REQUIRED');
    }
    result[side] = revision;
  }
  return result;
}

async function sideStatesForSupplier(context, stemId, supplierId, sides) {
  const rows = await storedSideStates(context.client, [stemId]);
  const selected = rows.filter((row) => row.supplier_account_id === supplierId && sides.includes(row.side));
  if (selected.length !== sides.length) {
    throw httpError('The paired workflow is not synchronized yet. Refresh Variable Charges and retry.', 409, 'SIDE_STATE_NOT_SYNCHRONIZED');
  }
  return selected;
}

function sideBody(body, side) {
  const nested = side === 'cost' ? body?.cost : body?.buyerCharge || body?.buyer_charge;
  return nested && typeof nested === 'object' ? { ...body, ...nested } : body;
}

function mergePairedWrites(costBody, buyerBody) {
  const byId = new Map();
  for (const update of [...(costBody?.extraCostUpdates || []), ...(buyerBody?.extraCostUpdates || [])]) {
    const id = text(update?.extraCostId || update?.id, 18);
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) || {}), ...update, extraCostId: id });
  }
  const additionsByKey = new Map();
  for (const addition of [...(costBody?.extraCostAdds || []), ...(buyerBody?.extraCostAdds || [])]) {
    const key = text(addition?.reviewLocalId || addition?.localId, 64);
    if (!key) throw httpError('Every new paired charge needs a stable local identity.', 400, 'ADDITION_ID_REQUIRED');
    additionsByKey.set(key, { ...(additionsByKey.get(key) || {}), ...addition, reviewLocalId: key });
  }
  return {
    ...costBody,
    extraCostUpdates: [...byId.values()],
    extraCostAdds: [...additionsByKey.values()],
    cancellations: costBody?.cancellations || [],
  };
}

async function validateCostSide(body, supplierRows) {
  const normalized = normalizeSupplierReviewPayload(body, supplierRows);
  const reviews = Array.isArray(normalized?.reviews) ? normalized.reviews : [];
  const byId = new Map(reviews.map((row) => [text(row?.sourceId || row?.id, 64), row]));
  for (const row of supplierRows) {
    const review = byId.get(row.Id);
    if (!review || review.reviewed !== true) throw httpError('Review every current cost row for this supplier.', 400, 'COST_ROW_REVIEW_REQUIRED');
    if (!reviewEvidence(review).reference) throw httpError('The cost side requires a supplier note for every reviewed row.', 400, 'COST_NOTE_REQUIRED');
  }
  const costNote = text(normalized?.supplierReviewNote || normalized?.note, 1000);
  for (const addition of Array.isArray(normalized?.extraCostAdds) ? normalized.extraCostAdds : []) {
    if (!text(addition?.reviewLocalId || addition?.localId, 64)) throw httpError('Every new supplier charge needs a stable local identity.', 400, 'ADDITION_ID_REQUIRED');
    if (!text(addition?.productId, 18)) throw httpError('Choose a Salesforce Product for every new supplier charge.', 400, 'PRODUCT_REQUIRED');
    numeric(addition?.supplierCost ?? addition?.cost ?? addition?.fixedAmount ?? addition?.unitPrice, 'Supplier cost', { nullable: false });
    if ((addition?.pricingType || addition?.pricingMode) === 'per_unit') numeric(addition?.quantity, 'Quantity', { positive: true, nullable: false });
    if (!costNote && !reviewEvidence(addition).reference) throw httpError('The cost side requires a supplier note for every new charge.', 400, 'COST_NOTE_REQUIRED');
  }
  return { body: normalized, reviews };
}

function normalizeBuyerSide(body, supplierRows) {
  if (!Array.isArray(body?.rowChargeDecisions)) return body;
  const note = text(body?.buyerReviewNote || body?.note, 1000);
  if (!note) throw httpError('Add a buyer-charge note before confirmation.', 400, 'BUYER_NOTE_REQUIRED');
  const decisions = new Map(body.rowChargeDecisions.map((row) => [
    text(row?.sourceId || row?.id, 64),
    { decision: text(row?.decision || row?.buyerChargeDecision, 32).toLowerCase(), evidenceDocumentIds: row?.evidenceDocumentIds || [] },
  ]));
  return {
    ...body,
    reviews: supplierRows.map((row) => {
      const selected = decisions.get(row.Id);
      return {
        sourceId: row.Id,
        sourceType: row.Original_Supplier__c ? 'line_item' : 'extra_cost',
        reviewed: true,
        buyerChargeDecision: selected?.decision,
        referenceOrNote: note,
        evidenceDocumentIds: selected?.evidenceDocumentIds || [],
      };
    }),
  };
}

function applyHongKongBuyerDefaults(body, supplierRows, { hongKongDelivery = false, usdHkdRate = null } = {}) {
  if (!hongKongDelivery) return body;
  const bundleSupplierIds = new Set(supplierRows
    .filter((row) => row?.Supplier__c && normalizedChargeProduct(rowProductName(row)) === BASIC_CALLING_COST)
    .map((row) => row.Supplier__c));
  const reviews = (Array.isArray(body?.reviews) ? body.reviews : []).map((review) => ({ ...review }));
  const reviewById = new Map(reviews.map((row) => [text(row?.sourceId || row?.id, 64), row]));
  const updatesById = new Map((Array.isArray(body?.extraCostUpdates) ? body.extraCostUpdates : []).map((update) => [
    text(update?.extraCostId || update?.id, 18),
    { ...update },
  ]));
  for (const row of supplierRows) {
    if (!row?.Supplier__c) continue;
    const review = reviewById.get(row.Id);
    if (!review) continue;
    const product = canonicalChargeProduct(rowProductName(row));
    const bundleSupport = isBasicCallingBundleSupportRow(row, bundleSupplierIds);
    const storedPricingType = row.Lumpsum_Cost__c != null || row.Lumpsum_Price__c != null ? 'fixed' : 'per_unit';
    const pricingType = bundleSupport && product === PORT_CLEARANCE_EXTENSION ? 'fixed' : storedPricingType;
    const existing = updatesById.get(row.Id) || {};
    let buyerPrice = null;
    if (product === BASIC_CALLING_COST) {
      if (!['include', 'exclude'].includes(review.buyerChargeDecision)) review.buyerChargeDecision = 'include';
    } else if (bundleSupport && (product === AGENCY_FEE || product === LIGHT_DUES)) {
      review.buyerChargeDecision = 'exclude';
      buyerPrice = 0;
    } else if (bundleSupport && product === PORT_CLEARANCE_EXTENSION) {
      const calculation = calculatePortClearance({
        applicationCount: row.Quantity__c,
        usdHkdRate: row.Supplier_Cost_USD_HKD_Rate__c || usdHkdRate,
      });
      if (calculation.complete) {
        review.buyerChargeDecision = calculation.additionalApplications > 0 ? 'include' : 'exclude';
        buyerPrice = calculation.buyerTotalUsd;
      }
    } else if (isAnchorageDuesRow(row)) {
      const calculatedBuyerDefault = finiteAmount(row.Anchorage_Buyer_Default_USD__c);
      const formerSupplierPassThrough = finiteAmount(pricingType === 'fixed' ? row.Lumpsum_Cost__c : row.Unit_Cost__c);
      const storedBuyerPrice = finiteAmount(pricingType === 'fixed' ? row.Lumpsum_Price__c : row.Unit_Price__c);
      const matches = (left, right) => left != null && right != null && Math.abs(left - right) <= 0.005;
      if (calculatedBuyerDefault != null) {
        if (!['include', 'exclude'].includes(review.buyerChargeDecision)) {
          review.buyerChargeDecision = 'include';
        }
        if (!updatesById.has(row.Id)) {
          const identifiableDefault = storedBuyerPrice == null || Math.abs(storedBuyerPrice) <= 0.005
            || matches(storedBuyerPrice, formerSupplierPassThrough)
            || matches(storedBuyerPrice, calculatedBuyerDefault);
          if (review.buyerChargeDecision === 'exclude') buyerPrice = 0;
          else if (identifiableDefault) buyerPrice = calculatedBuyerDefault;
        }
      }
    }
    if (buyerPrice == null) continue;
    const storedBuyerPrice = bundleSupport && product === PORT_CLEARANCE_EXTENSION
      ? extraCostFinancialAmount(row, 'charge')
      : finiteAmount(pricingType === 'fixed' ? row.Lumpsum_Price__c : row.Unit_Price__c);
    if (!updatesById.has(row.Id) && storedBuyerPrice != null && Math.abs(storedBuyerPrice - buyerPrice) <= 0.005) continue;
    updatesById.set(row.Id, {
      ...existing,
      extraCostId: row.Id,
      expectedLastModifiedDate: text(existing.expectedLastModifiedDate || existing.lastModifiedDate || row.LastModifiedDate, 80),
      pricingType,
      buyerPrice,
    });
  }
  return { ...body, reviews, extraCostUpdates: [...updatesById.values()] };
}

// Compatibility helper retained for existing API-contract tests and rollback clients.
// Its behavior now follows the permanent Hong Kong pass-through rules.
function applyAnchorageBuyerDefaults(body, supplierRows, reviews, options) {
  return applyHongKongBuyerDefaults({ ...body, reviews }, supplierRows, options);
}

async function validateBuyerSide(body, supplierRows, files, { hongKongDelivery = false, usdHkdRate = null } = {}) {
  const normalized = applyHongKongBuyerDefaults(normalizeBuyerSide(body, supplierRows), supplierRows, { hongKongDelivery, usdHkdRate });
  const reviews = Array.isArray(normalized?.reviews) ? normalized.reviews : [];
  const byId = new Map(reviews.map((row) => [text(row?.sourceId || row?.id, 64), row]));
  const extraCostUpdates = new Map((Array.isArray(normalized?.extraCostUpdates) ? normalized.extraCostUpdates : []).map((row) => [
    text(row?.extraCostId || row?.id, 18),
    row,
  ]));
  const fileIds = new Set(files.map((row) => row.id));
  for (const row of supplierRows) {
    const review = byId.get(row.Id);
    if (!review || review.reviewed !== true) throw httpError('Review every current buyer-charge row for this supplier.', 400, 'BUYER_ROW_REVIEW_REQUIRED');
    const decision = text(review.buyerChargeDecision, 32).toLowerCase();
    if (!['include', 'exclude'].includes(decision)) throw httpError('Choose Charge Buyer or Do Not Charge for every buyer charge.', 400, 'BUYER_CHARGE_DECISION_REQUIRED');
    if (hongKongDelivery && row?.Supplier__c && isAnchorageDuesRow(row) && decision === 'include') {
      const pricingType = row.Lumpsum_Cost__c != null || row.Lumpsum_Price__c != null ? 'fixed' : 'per_unit';
      const update = extraCostUpdates.get(row.Id);
      const buyerPrice = update
        ? finiteAmount(update.buyerPrice ?? update.price ?? update.fixedBuyerAmount ?? update.buyerUnitPrice)
        : finiteAmount(pricingType === 'fixed' ? row.Lumpsum_Price__c : row.Unit_Price__c);
      if (buyerPrice == null || buyerPrice < 0) throw httpError('Enter a valid non-negative Anchorage Dues buyer charge.', 400, 'ANCHORAGE_BUYER_CHARGE_REQUIRED');
    }
    const evidence = reviewEvidence(review);
    if (!evidence.reference) throw httpError('The buyer-charge side requires a note for every reviewed row.', 400, 'BUYER_NOTE_REQUIRED');
    if (evidence.evidenceDocumentIds.some((id) => !fileIds.has(id))) throw httpError('A selected Salesforce File is no longer linked to this charge.', 409, 'EVIDENCE_CHANGED');
  }
  const buyerNote = text(normalized?.buyerReviewNote || normalized?.note, 1000);
  for (const addition of Array.isArray(normalized?.extraCostAdds) ? normalized.extraCostAdds : []) {
    if (!text(addition?.reviewLocalId || addition?.localId, 64)) throw httpError('Every new paired charge needs a stable local identity.', 400, 'ADDITION_ID_REQUIRED');
    const decision = text(addition?.buyerChargeDecision || addition?.decision, 32).toLowerCase();
    if (!['include', 'exclude'].includes(decision)) throw httpError('Choose Charge Buyer or Do Not Charge for every new buyer charge.', 400, 'BUYER_CHARGE_DECISION_REQUIRED');
    if (decision === 'include') numeric(addition?.buyerPrice ?? addition?.price ?? addition?.fixedBuyerAmount ?? addition?.buyerUnitPrice, 'Buyer price', { nullable: false });
    const evidence = reviewEvidence(addition);
    if (!buyerNote && !evidence.reference) throw httpError('The buyer-charge side requires a note for every new charge.', 400, 'BUYER_NOTE_REQUIRED');
    if (evidence.evidenceDocumentIds.some((id) => !fileIds.has(id))) throw httpError('A selected Salesforce File is no longer linked to this charge.', 409, 'EVIDENCE_CHANGED');
  }
  return { body: normalized, reviews };
}

async function assertAnchorageApprovalReady(live, supplierId, context, side) {
  const rows = live.extraCosts.filter((row) => row.Supplier__c === supplierId && isAnchorageDuesRow(row));
  if (!isHongKongStem(live.stem) || !rows.length) return;
  const evidence = anchorageEvidence(live, await variableChargeSettings(context.client));
  if (!evidence?.calculation?.complete) {
    throw httpError(evidence?.calculation?.errors?.[0] || 'Save complete anchorage details before approval.', 409, 'ANCHORAGE_EVIDENCE_INCOMPLETE');
  }
  if (!evidence.calculation.allocationComplete) {
    throw httpError('Allocate the calculated anchorage dues across all agent rows before approval.', 409, 'ANCHORAGE_ALLOCATION_INCOMPLETE');
  }
  if (evidence.rows.some((row) => !row.savedCalculationVersion || Number(row.appliedNrt) !== Number(evidence.vesselNrt))) {
    throw httpError('The Vessel NRT or anchorage evidence changed. Save the anchorage details again before approval.', 409, 'ANCHORAGE_EVIDENCE_STALE');
  }
  const selected = evidence.rows.filter((row) => row.supplierId === supplierId);
  if (side === 'cost' && selected.some((row) => row.supplierChargeHkd?.available !== true)) {
    throw httpError('The supplier Anchorage Dues charge cannot be compared in its current currency.', 409, 'ANCHORAGE_SUPPLIER_COMPARISON_UNAVAILABLE');
  }
  if (side === 'buyer_charge' && selected.some((row) => row.buyerDefault?.available !== true)) {
    throw httpError('The buyer Anchorage Dues default cannot be calculated until the complete anchorage evidence is saved.', 409, 'ANCHORAGE_BUYER_DEFAULT_UNAVAILABLE');
  }
  if (side === 'buyer_charge' && selected.some((row) => (
    row.savedBuyerCalculationVersion !== ANCHORAGE_BUYER_CALCULATION_VERSION
    || Math.abs(Number(row.appliedBuyerRateUsd) - ANCHORAGE_BUYER_RATE_USD_PER_NRT_HOUR) > 0.0000005
    || Math.abs(Number(row.appliedBuyerDefaultUsd) - Number(row.buyerDefault?.amountUsd)) > 0.005
  ))) {
    throw httpError('The buyer Anchorage Dues calculation changed. Save the anchorage details again before approval.', 409, 'ANCHORAGE_BUYER_EVIDENCE_STALE');
  }
}

async function assertLightDuesApprovalReady(live, supplierId, context, side) {
  const rows = live.extraCosts.filter((row) => row.Supplier__c === supplierId && isLightDuesRow(row));
  if (!isHongKongStem(live.stem) || !rows.length) return;
  const evidence = lightDuesEvidence(live, await variableChargeSettings(context.client));
  const selected = (evidence?.rows || []).filter((row) => row.supplierId === supplierId);
  if (selected.some((row) => !row.calculation?.complete)) {
    throw httpError(selected.find((row) => !row.calculation?.complete)?.calculation?.errors?.[0] || 'Save complete Light Dues evidence before approval.', 409, 'LIGHT_DUES_EVIDENCE_INCOMPLETE');
  }
  if (selected.some((row) => !row.savedCalculationVersion
    || Number(row.appliedNrt) !== Number(evidence.vesselNrt)
    || row.appliedEntryDate !== row.entryDate
    || row.appliedCategory !== LIGHT_DUES_CATEGORY_ALL_OTHER
    || row.appliedAmountHkd == null
    || Math.abs(Number(row.appliedAmountHkd) - Number(row.calculation?.amountHkd)) > 0.005
    || !(Number(row.appliedUsdHkdRate) > 0))) {
    throw httpError('The Vessel NRT or Light Dues evidence changed. Save the Light Dues details again before approval.', 409, 'LIGHT_DUES_EVIDENCE_STALE');
  }
  if (side === 'cost' && selected.some((row) => row.supplierChargeHkd == null)) {
    throw httpError('The supplier LIGHT DUES charge cannot be compared in HKD.', 409, 'LIGHT_DUES_SUPPLIER_COMPARISON_UNAVAILABLE');
  }
}

async function assertAgentCostCurrencyReady(live, supplierId, context, side) {
  if (side !== 'cost') return;
  const account = (live.accounts || []).find((row) => row.Id === supplierId);
  if (account?.Is_Agent__c !== true) return;
  const requiredCurrency = requiredAgentCurrency(live, supplierId);
  const settings = await variableChargeSettings(context.client);
  for (const row of live.extraCosts.filter((item) => item.Supplier__c === supplierId)) {
    const product = displayChargeProductName(rowProductName(row)) || 'Supplier charge';
    const inputCurrency = text(row.Supplier_Cost_Input_Currency__c, 3).toUpperCase();
    const inputValue = finiteAmount(row.Supplier_Cost_Input_Value__c);
    const rate = finiteAmount(row.Supplier_Cost_USD_HKD_Rate__c);
    const storedUsd = finiteAmount(row.Lumpsum_Cost__c ?? row.Unit_Cost__c);
    if (inputCurrency !== requiredCurrency || inputValue == null || !(rate > 0) || storedUsd == null) {
      throw httpError(`${product} must be reviewed in the supplier Account's agreed ${requiredCurrency} currency.`, 409, 'AGENT_COST_CURRENCY_EVIDENCE_INCOMPLETE');
    }
    const expectedUsd = roundedSalesforceCurrency(requiredCurrency === 'HKD' ? inputValue / rate : inputValue);
    if (Math.abs(storedUsd - expectedUsd) > 0.005) {
      throw httpError(`${product} no longer reconciles to its reviewed ${requiredCurrency} supplier cost. Refresh and review it again.`, 409, 'AGENT_COST_CURRENCY_EVIDENCE_STALE');
    }
    if (Math.abs(rate - Number(settings.usdHkdRate)) > 0.000001 && row.Supplier_Cost_FX_Settings_Revision__c == null) {
      throw httpError(`${product} has incomplete reviewed exchange-rate evidence. Refresh and review it again.`, 409, 'AGENT_COST_FX_EVIDENCE_INCOMPLETE');
    }
  }
}

async function assertBasicCallingApprovalReady(live, supplierId, context, side) {
  await assertAgentCostCurrencyReady(live, supplierId, context, side);
  if (!isHongKongStem(live.stem)) return;
  const supplierRows = live.extraCosts.filter((row) => row.Supplier__c === supplierId);
  if (!supplierRows.some((row) => normalizedChargeProduct(rowProductName(row)) === BASIC_CALLING_COST)) return;
  const rows = supplierRows.filter((row) => isBasicCallingSupport(rowProductName(row)));
  const settings = await variableChargeSettings(context.client);
  if (side === 'cost') {
    const expectedAgencyFee = agencyFeeAccountDefault(
      (live.accounts || []).find((row) => row.Id === supplierId),
      settings,
    );
    for (const agency of rows.filter(isAgencyFeeRow)) {
      if (!expectedAgencyFee) {
        throw httpError('Set the Agreed Agency Fee and Currency on the supplier Account before approving Agency Fee.', 409, 'AGENCY_FEE_ACCOUNT_SETUP_REQUIRED');
      }
      if (Math.abs((finiteAmount(agency.Lumpsum_Cost__c) ?? 0) - expectedAgencyFee.usdAmount) > 0.005
        || text(agency.Supplier_Cost_Input_Currency__c, 3).toUpperCase() !== expectedAgencyFee.inputCurrency
        || Math.abs((finiteAmount(agency.Supplier_Cost_Input_Value__c) ?? 0) - expectedAgencyFee.nativeAmount) > 0.005
        || Math.abs((finiteAmount(agency.Supplier_Cost_USD_HKD_Rate__c) ?? 0) - expectedAgencyFee.rate) > 0.000001) {
        throw httpError('Agency Fee no longer matches the supplier Account’s Agreed Agency Fee and Currency. Refresh before approval.', 409, 'AGENCY_FEE_EVIDENCE_STALE');
      }
    }
  }
  if (side === 'buyer_charge') {
    for (const row of rows.filter((item) => isAgencyFeeRow(item) || isLightDuesRow(item))) {
      if (Math.abs(finiteAmount(row.Lumpsum_Price__c) ?? 0) > 0.005) {
        throw httpError(`${rowProductName(row)} is included in Basic Calling Cost and must remain USD 0 on the Buyer Leg.`, 409, 'BASIC_CALLING_BUYER_PRICE_INVALID');
      }
    }
  }
  for (const portClearance of rows.filter(isPortClearanceRow)) {
    const calculation = calculatePortClearance({
      applicationCount: portClearance.Quantity__c,
      usdHkdRate: portClearance.Supplier_Cost_USD_HKD_Rate__c || settings?.usdHkdRate,
    });
    if (!calculation.complete) throw httpError(calculation.errors[0], 409, 'PORT_CLEARANCE_EVIDENCE_INCOMPLETE');
    const supplierAccount = (live.accounts || []).find((row) => row.Id === supplierId);
    const requiredCurrency = configuredAgentCurrency(supplierAccount) || 'HKD';
    const expectedNativeTotal = requiredCurrency === 'HKD' ? calculation.supplierHkd : calculation.supplierTotalUsd;
    if (side === 'cost' && (finiteAmount(portClearance.Port_Clearance_Rate_HKD__c) !== PORT_CLEARANCE_RATE_HKD
      || portClearance.Port_Clearance_Calculation_Version__c !== PORT_CLEARANCE_CALCULATION_VERSION
      || text(portClearance.Supplier_Cost_Input_Currency__c, 3).toUpperCase() !== requiredCurrency
      || portClearance.Fixed__c !== true
      || Math.abs((finiteAmount(portClearance.Supplier_Cost_Input_Value__c) ?? 0) - expectedNativeTotal) > 0.005
      || Math.abs((finiteAmount(portClearance.Lumpsum_Cost__c) ?? 0) - calculation.supplierTotalUsd) > 0.005)) {
      throw httpError('Confirm the supplier-reported Port Clearance Extension application count before approval.', 409, 'PORT_CLEARANCE_EVIDENCE_STALE');
    }
    if (side === 'buyer_charge' && (portClearance.Fixed__c !== true
      || Math.abs((finiteAmount(portClearance.Lumpsum_Price__c) ?? 0) - calculation.buyerTotalUsd) > 0.005)) {
      throw httpError('The Port Clearance Extension buyer pass-through changed. Refresh and review the Buyer Leg again.', 409, 'PORT_CLEARANCE_BUYER_PRICE_STALE');
    }
  }
}

async function assertStatutoryApprovalReady(live, supplierId, context, side) {
  await assertAnchorageApprovalReady(live, supplierId, context, side);
  await assertLightDuesApprovalReady(live, supplierId, context, side);
}

export async function assignVariableChargeSides(body, context) {
  if (!pairedWorkflowEnabled()) throw httpError('The paired Variable Charges workflow is not enabled yet.', 409, 'PAIRED_WORKFLOW_DISABLED');
  const stemId = text(body?.stemId, 18);
  const supplierId = text(body?.supplierId, 18);
  const sides = selectedSides(body);
  const targetRole = text(body?.target, 40).toLowerCase();
  if (!['buyer_trader', 'supplier_trader', 'gm_override'].includes(targetRole)) throw httpError('Choose Buyer Trader, Supplier Trader, or an authorized Temporary Assignee.', 400, 'INVALID_SIDE_ASSIGNMENT_TARGET');
  const operationId = operationIdentity(body);
  const live = await liveCaseForStem(stemId, context);
  const requirement = (live.supplierRequirements || []).find((row) => row.supplierId === supplierId && row.effectiveRequired);
  if (!requirement) throw httpError('This exact supplier is not required in Variable Charges.', 409, 'SUPPLIER_STAGE_NOT_REQUIRED');
  const revisions = expectedSideRevisions(body, sides);
  const states = await sideStatesForSupplier(context, stemId, supplierId, sides);
  for (const state of states) {
    if (Number(state.revision) !== revisions[state.side]) throw httpError('This responsibility changed after it was opened. Refresh and retry.', 409, 'SIDE_REVISION_CONFLICT');
  }
  const gm = await activeGeneralManager(context.client, context.profile.id);
  const reason = text(body?.gmOverrideReason || body?.reason, 1000);
  const supplierOwner = requirement.assignedSupplierTrader?.id === context.profile.id
    && !VIEW_ONLY_USER_TYPES.has(text(context.profile?.user_type).toLowerCase());
  const explicitGmOverride = targetRole === 'gm_override';
  if (explicitGmOverride && !(gm.isGeneralManager && reason.length >= 5)) {
    if (gm.isGeneralManager) throw httpError('A General Manager override reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
    throw httpError('Only the active General Manager may apply a Temporary Assignee.', 403, 'GENERAL_MANAGER_REQUIRED');
  }
  if (!explicitGmOverride && !supplierOwner && !(gm.isGeneralManager && reason.length >= 5)) {
    if (gm.isGeneralManager) throw httpError('A General Manager override reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
    throw httpError('Only the resolved Supplier Trader may delegate or take back these sides.', 403, 'DEFAULT_SUPPLIER_TRADER_REQUIRED');
  }
  let targetUserId = targetRole === 'buyer_trader' ? live.assignment?.profileId : requirement.assignedSupplierTrader?.id;
  if (explicitGmOverride) {
    const requestedAssigneeId = text(body?.assigneeProfileId, 64);
    const profiles = await activeProfileDirectory(context.client);
    const requestedAssignee = profiles.find((row) => row.id === requestedAssigneeId && !VIEW_ONLY_USER_TYPES.has(text(row.user_type).toLowerCase()));
    if (!requestedAssignee) throw httpError('Choose an active trader as the Temporary Assignee.', 400, 'INVALID_ASSIGNEE');
    targetUserId = requestedAssignee.id;
  }
  if (!targetUserId) throw httpError(`The resolved ${targetRole === 'buyer_trader' ? 'Buyer' : 'Supplier'} Trader is unavailable.`, 409, 'SIDE_TARGET_UNRESOLVED');
  const requestFingerprint = sha256({ stemId, supplierId, sides, targetRole, targetUserId, revisions, reason: gm.isGeneralManager ? reason : null });
  const reservation = await reserveOperation(context.client, { operationId, type: 'side_assign', stemId, fingerprint: requestFingerprint, actorId: context.profile.id });
  if (reservation?.status === 'succeeded') return reservation.result || {};
  if (['failed', 'uncertain'].includes(reservation?.status)) throw httpError('This assignment operation cannot be resumed safely. Refresh and use a new operation.', 409, 'OPERATION_NOT_RESUMABLE');
  const { data, error } = await context.client.rpc('assign_variable_charge_sides', {
    p_operation_id: operationId,
    p_stem_id: stemId,
    p_supplier_account_id: supplierId,
    p_sides: sides,
    p_target_role: explicitGmOverride || (!supplierOwner && gm.isGeneralManager) ? 'gm_override' : targetRole,
    p_target_user_id: targetUserId,
    p_expected_revisions: revisions,
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email,
    p_override_reason: explicitGmOverride || (!supplierOwner && gm.isGeneralManager) ? reason : null,
  });
  if (error) {
    if (/changed after it was opened|revision/i.test(error.message || '')) throw httpError(error.message, 409, 'SIDE_REVISION_CONFLICT');
    throw error;
  }
  const result = { stemId, supplierId, sides: data?.sides || [], operationId };
  await completeOperation(context.client, operationId, 'succeeded', { stemId, supplierId, status: 'assigned' });
  return result;
}

export async function confirmVariableChargeSides(body, context) {
  if (!pairedWorkflowEnabled()) throw httpError('The paired Variable Charges workflow is not enabled yet.', 409, 'PAIRED_WORKFLOW_DISABLED');
  const stemId = text(body?.stemId, 18);
  const supplierId = text(body?.supplierId, 18);
  const sides = selectedSides(body);
  const operationId = operationIdentity(body);
  const revisions = expectedSideRevisions(body, sides);
  const liveBefore = await liveCaseForStem(stemId, context);
  const requirement = (liveBefore.supplierRequirements || []).find((row) => row.supplierId === supplierId && row.effectiveRequired);
  if (!requirement) throw httpError('This exact supplier is not required in Variable Charges.', 409, 'SUPPLIER_STAGE_NOT_REQUIRED');
  assertLiveActionable(liveBefore);
  const states = await sideStatesForSupplier(context, stemId, supplierId, sides);
  const gm = await activeGeneralManager(context.client, context.profile.id);
  const overrideReason = text(body?.gmOverrideReason || body?.reason, 1000);
  const normalAuthority = states.every((state) => state.assigned_user_id === context.profile.id)
    && !VIEW_ONLY_USER_TYPES.has(text(context.profile?.user_type).toLowerCase());
  if (!normalAuthority && !(gm.isGeneralManager && overrideReason.length >= 5)) {
    if (gm.isGeneralManager) throw httpError('A General Manager override reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
    throw httpError('Only the current assignee may confirm each selected side.', 403, 'SIDE_ASSIGNEE_REQUIRED');
  }
  for (const state of states) {
    if (Number(state.revision) !== revisions[state.side]) throw httpError('This side changed after it was opened. Refresh and review it again.', 409, 'SIDE_REVISION_CONFLICT');
  }
  if (text(body?.expectedStemLastModifiedAt, 80) !== text(liveBefore.stem.LastModifiedDate, 80)) throw httpError('The Salesforce STEM changed after it was opened.', 409, 'STEM_LAST_MODIFIED_CONFLICT');
  const supplierRows = [...liveBefore.lineItems, ...liveBefore.extraCosts].filter((row) => (row.Original_Supplier__c || row.Supplier__c) === supplierId);
  const hongKongDelivery = isHongKongStem(liveBefore.stem);
  const hongKongSettings = hongKongDelivery ? await variableChargeSettings(context.client) : null;
  for (const side of sides) await assertStatutoryApprovalReady(liveBefore, supplierId, context, side);
  const files = await linkedSalesforceFiles(liveBefore);
  const costReview = sides.includes('cost') ? await validateCostSide(sideBody(body, 'cost'), supplierRows) : null;
  const buyerReview = sides.includes('buyer_charge')
    ? await validateBuyerSide(sideBody(body, 'buyer_charge'), supplierRows, files, {
      hongKongDelivery,
      usdHkdRate: hongKongSettings?.usdHkdRate,
    })
    : null;
  const expectedFingerprints = body?.expectedFingerprints || {};
  const expectedCostFingerprint = text(expectedFingerprints.cost || body?.expectedCostFingerprint, 128);
  const expectedBuyerFingerprint = text(expectedFingerprints.buyer_charge || expectedFingerprints.buyerCharge || body?.expectedBuyerFingerprint, 128);
  if (sides.includes('cost') && expectedCostFingerprint !== requirement.sourceFingerprint) throw httpError('Supplier costs changed after review.', 409, 'COST_FINGERPRINT_CONFLICT');
  if (sides.includes('buyer_charge') && expectedBuyerFingerprint !== requirement.buyerChargeSourceFingerprint) throw httpError('Buyer charges changed after review.', 409, 'BUYER_FINGERPRINT_CONFLICT');
  const requestFingerprint = sha256({
    stemId, supplierId, sides, revisions, expectedCostFingerprint, expectedBuyerFingerprint,
    costReviews: costReview?.reviews || [], buyerReviews: buyerReview?.reviews || [],
    costWrites: costReview?.body?.extraCostUpdates || [], buyerWrites: buyerReview?.body?.extraCostUpdates || [],
    additions: costReview?.body?.extraCostAdds || [], cancellations: costReview?.body?.cancellations || [],
    overrideReason: normalAuthority ? null : overrideReason,
  });
  const reservation = await reserveOperation(context.client, { operationId, type: 'side_confirm', stemId, fingerprint: requestFingerprint, actorId: context.profile.id });
  if (reservation?.status === 'succeeded') return reservation.result || {};
  if (['failed', 'uncertain'].includes(reservation?.status)) throw httpError('This confirmation has an uncertain outcome. Refresh before taking another action.', 409, 'OPERATION_UNCERTAIN');
  let salesforceResult = null;
  let ledgerFingerprints = null;
  let salesforceWritten = reservation?.status === 'salesforce_written';
  try {
    if (reservation?.status !== 'salesforce_written') {
      if (sides.length === 2) {
        await salesforceSupplierChargeWrites(mergePairedWrites(costReview.body, buyerReview.body), liveBefore, supplierId, context, { includeBuyerFields: true });
      } else if (sides[0] === 'cost') {
        await salesforceSupplierChargeWrites(costReview.body, liveBefore, supplierId, context);
      } else {
        await salesforceChargeWrites(buyerReview.body, liveBefore);
      }
      const refreshed = await liveCaseForStem(stemId, context);
      for (const side of sides) await assertBasicCallingApprovalReady(refreshed, supplierId, context, side);
      const refreshedRequirement = (refreshed.supplierRequirements || []).find((row) => row.supplierId === supplierId);
      const [costSnapshot, buyerSnapshot] = await Promise.all([
        sides.includes('cost') ? sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/cost/fingerprint`, { readOnly: true }) : null,
        sides.includes('buyer_charge') ? sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/buyer-charge/fingerprint`, { readOnly: true }) : null,
      ]);
      salesforceResult = await sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/confirm`, {
        method: 'POST',
        body: {
          stemId, supplierId, sides, verifierEmail: context.profile.email,
          expectedCostFingerprint: costSnapshot?.costFingerprint || costSnapshot?.fingerprint || null,
          expectedBuyerFingerprint: buyerSnapshot?.buyerFingerprint || buyerSnapshot?.fingerprint || null,
          expectedStemLastModifiedAt: apexUtcTimestamp(refreshed.stem.LastModifiedDate, { required: true, label: 'STEM' }),
          expectedStageLastModifiedAt: apexUtcTimestamp(refreshedRequirement?.lastModifiedAt, { label: 'Supplier stage' }),
          gmOverrideReason: normalAuthority ? null : overrideReason,
        },
      });
      const confirmedLive = await liveCaseForStem(stemId, context);
      const confirmedRequirement = (confirmedLive.supplierRequirements || []).find((row) => row.supplierId === supplierId);
      ledgerFingerprints = {
        cost: confirmedRequirement?.sourceFingerprint,
        buyer_charge: confirmedRequirement?.buyerChargeSourceFingerprint,
      };
      await completeOperation(context.client, operationId, 'salesforce_written', {
        stemId, supplierId, sourceFingerprint: sha256({ cost: salesforceResult?.costFingerprint, buyer: salesforceResult?.buyerFingerprint }),
      });
      salesforceWritten = true;
    } else {
      const refreshed = await liveCaseForStem(stemId, context);
      for (const side of sides) await assertBasicCallingApprovalReady(refreshed, supplierId, context, side);
      const refreshedRequirement = (refreshed.supplierRequirements || []).find((row) => row.supplierId === supplierId);
      if (sides.includes('cost') && refreshedRequirement?.status !== 'Verified') throw httpError('The cost-side Salesforce confirmation changed before recovery.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
      if (sides.includes('buyer_charge') && refreshedRequirement?.buyerChargeStatus !== 'Verified') throw httpError('The buyer-side Salesforce confirmation changed before recovery.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
      ledgerFingerprints = {
        cost: refreshedRequirement?.sourceFingerprint,
        buyer_charge: refreshedRequirement?.buyerChargeSourceFingerprint,
      };
      salesforceResult = {
        costFingerprint: refreshedRequirement?.reviewedSourceFingerprint,
        buyerFingerprint: refreshedRequirement?.buyerChargeReviewedSourceFingerprint,
        lastModifiedAt: refreshedRequirement?.lastModifiedAt,
      };
    }
    const confirmationRows = sides.map((side) => ({
      side,
      expectedRevision: revisions[side],
      sourceFingerprint: ledgerFingerprints?.[side],
      salesforceStageLastModifiedAt: salesforceResult?.lastModifiedAt || null,
      rowByRowReviewed: true,
      noteRecorded: true,
      evidencePresent: (side === 'cost' ? costReview?.reviews : buyerReview?.reviews)?.some((review) => reviewEvidence(review).evidenceDocumentIds.length > 0) || false,
    }));
    const { data, error } = await context.client.rpc('record_variable_charge_side_confirmations', {
      p_operation_id: operationId,
      p_stem_id: stemId,
      p_supplier_account_id: supplierId,
      p_sides: confirmationRows,
      p_actor_user_id: context.profile.id,
      p_actor_email: context.profile.email,
      p_override_reason: normalAuthority ? null : overrideReason,
    });
    if (error) {
      if (/changed after it was opened|revision/i.test(error.message || '')) throw httpError(error.message, 409, 'SIDE_REVISION_CONFLICT');
      throw error;
    }
    const result = { stemId, supplierId, sides: data?.sides || [], operationId, buyerInvoiceReady: salesforceResult?.buyerConfirmed === true };
    await completeOperation(context.client, operationId, 'succeeded', { stemId, supplierId, status: 'verified' });
    return result;
  } catch (error) {
    if (!salesforceWritten) {
      await completeOperation(context.client, operationId, 'uncertain', { stemId, supplierId, errorCode: error.code || 'SIDE_CONFIRM_UNCERTAIN' }).catch(() => {});
    }
    throw error;
  }
}

export async function reopenVariableChargeSides(body, context) {
  if (!pairedWorkflowEnabled()) throw httpError('The paired Variable Charges workflow is not enabled yet.', 409, 'PAIRED_WORKFLOW_DISABLED');
  const stemId = text(body?.stemId, 18);
  const supplierId = text(body?.supplierId, 18);
  const sides = selectedSides(body);
  const operationId = operationIdentity(body);
  const revisions = expectedSideRevisions(body, sides);
  const reason = text(body?.reason, 1000);
  if (reason.length < 5) throw httpError('Enter an amendment reason of at least 5 characters.', 400, 'AMENDMENT_REASON_REQUIRED');

  const liveBefore = await liveCaseForStem(stemId, context);
  const requirement = (liveBefore.supplierRequirements || []).find((row) => row.supplierId === supplierId && row.effectiveRequired);
  if (!requirement) throw httpError('This exact supplier is not required in Variable Charges.', 409, 'SUPPLIER_STAGE_NOT_REQUIRED');
  const states = await sideStatesForSupplier(context, stemId, supplierId, sides);
  const gm = await activeGeneralManager(context.client, context.profile.id);
  const normalAuthority = states.every((state) => state.assigned_user_id === context.profile.id)
    && !VIEW_ONLY_USER_TYPES.has(text(context.profile?.user_type).toLowerCase());
  if (!normalAuthority && !gm.isGeneralManager) throw httpError('Only the currently assigned trader may amend an approved Variable Charges leg.', 403, 'SIDE_ASSIGNEE_REQUIRED');
  for (const state of states) {
    if (state.status !== 'verified') throw httpError('Only an approved Variable Charges leg may be amended.', 409, 'SIDE_NOT_APPROVED');
    if (Number(state.revision) !== revisions[state.side]) throw httpError('This leg changed after it was opened. Refresh and try again.', 409, 'SIDE_REVISION_CONFLICT');
  }
  if (text(body?.expectedStemLastModifiedAt, 80) !== text(liveBefore.stem.LastModifiedDate, 80)) {
    throw httpError('The Salesforce STEM changed after it was opened. Refresh and try again.', 409, 'STEM_LAST_MODIFIED_CONFLICT');
  }
  const supplierInvoiceCreated = (liveBefore.supplierInvoices || []).some((invoice) => invoice.Supplier__c === supplierId)
    || liveBefore.lineItems.some((row) => row.Original_Supplier__c === supplierId && row.Supplier_Invoice__c)
    || liveBefore.extraCosts.some((row) => row.Supplier__c === supplierId && row.Supplier_Invoice__c);
  if (sides.includes('cost') && supplierInvoiceCreated) {
    throw httpError('Supplier costs cannot be amended after this supplier invoice has been created.', 409, 'SUPPLIER_INVOICE_ALREADY_CREATED');
  }
  if (sides.includes('buyer_charge') && liveBefore.invoices.some(finalInvoice)) {
    throw httpError('Buyer charges cannot be amended after the final Buyer Invoice has been created.', 409, 'BUYER_INVOICE_ALREADY_CREATED');
  }
  requireExternalActionGate('salesforce_write');

  const requestFingerprint = sha256({ stemId, supplierId, sides, revisions, reason });
  const reservation = await reserveOperation(context.client, {
    operationId, type: 'side_reopen', stemId, fingerprint: requestFingerprint, actorId: context.profile.id,
  });
  if (reservation?.status === 'succeeded') return reservation.result || {};
  if (['failed', 'uncertain'].includes(reservation?.status)) {
    throw httpError('This amendment operation cannot be resumed safely. Refresh and use a new operation.', 409, 'OPERATION_NOT_RESUMABLE');
  }

  let salesforceWritten = reservation?.status === 'salesforce_written';
  try {
    if (!salesforceWritten) {
      const refreshedRequirement = (liveBefore.supplierRequirements || []).find((row) => row.supplierId === supplierId);
      const salesforceResult = await sfRequest(`/apexrest/fcos/variable-charges/${encodeURIComponent(stemId)}/supplier/${encodeURIComponent(supplierId)}/reopen`, {
        method: 'POST',
        body: {
          stemId,
          supplierId,
          sides,
          verifierEmail: context.profile.email,
          expectedStemLastModifiedAt: apexUtcTimestamp(liveBefore.stem.LastModifiedDate, { required: true, label: 'STEM' }),
          expectedStageLastModifiedAt: apexUtcTimestamp(refreshedRequirement?.lastModifiedAt, { required: true, label: 'Supplier stage' }),
          gmOverrideReason: normalAuthority ? null : reason,
        },
      });
      await completeOperation(context.client, operationId, 'salesforce_written', {
        stemId, supplierId, sides, stageLastModifiedAt: salesforceResult?.lastModifiedAt || null,
      });
      salesforceWritten = true;
    }

    const refreshed = await liveCaseForStem(stemId, context);
    const refreshedRequirement = (refreshed.supplierRequirements || []).find((row) => row.supplierId === supplierId);
    if (!refreshedRequirement) throw httpError('The supplier stage changed during amendment.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
    if (sides.includes('cost') && refreshedRequirement.status !== 'Invalidated') {
      throw httpError('The Supplier Leg did not reopen in Salesforce.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
    }
    if (sides.includes('buyer_charge') && refreshedRequirement.buyerChargeStatus !== 'Invalidated') {
      throw httpError('The Buyer Leg did not reopen in Salesforce.', 409, 'POST_WRITE_LIVE_DATA_CONFLICT');
    }
    const reopenRows = sides.map((side) => ({
      side,
      expectedRevision: revisions[side],
      sourceFingerprint: side === 'cost' ? refreshedRequirement.sourceFingerprint : refreshedRequirement.buyerChargeSourceFingerprint,
      salesforceStageLastModifiedAt: refreshedRequirement.lastModifiedAt || null,
    }));
    const { data, error } = await context.client.rpc('record_variable_charge_side_reopens', {
      p_operation_id: operationId,
      p_stem_id: stemId,
      p_supplier_account_id: supplierId,
      p_sides: reopenRows,
      p_actor_user_id: context.profile.id,
      p_actor_email: context.profile.email,
      p_override_reason: normalAuthority ? null : reason,
    });
    if (error) {
      if (/changed after it was opened|revision/i.test(error.message || '')) throw httpError(error.message, 409, 'SIDE_REVISION_CONFLICT');
      throw error;
    }
    await syncVariableCharges(context, { stemIds: [stemId] }).catch(() => null);
    return { stemId, supplierId, sides: data?.sides || [], operationId, status: 'reopened' };
  } catch (error) {
    if (!salesforceWritten) {
      await completeOperation(context.client, operationId, 'uncertain', {
        stemId, supplierId, errorCode: error.code || 'SIDE_REOPEN_UNCERTAIN',
      }).catch(() => {});
    }
    throw error;
  }
}

export async function confirmVariableChargeBuyer(body, context) {
  if (pairedWorkflowEnabled()) throw httpError('The Variable Charges workflow changed. Refresh FCOS and confirm each supplier buyer-charge side.', 409, 'PAIRED_WORKFLOW_REFRESH_REQUIRED');
  const live = await liveCaseForStem(text(body?.stemId, 18), context);
  if ((live.supplierRequirements || []).some((row) => row.status !== 'Verified')) {
    throw httpError('Every required Supplier Trader must verify their supplier before Buyer Trader confirmation.', 409, 'SUPPLIER_STAGES_INCOMPLETE');
  }
  for (const requirement of live.supplierRequirements || []) {
    await assertStatutoryApprovalReady(live, requirement.supplierId, context, 'buyer_charge');
    await assertBasicCallingApprovalReady(live, requirement.supplierId, context, 'buyer_charge');
  }
  return saveAndConfirmVariableCharges(normalizeBuyerReviewPayload(body, live), context);
}

export async function overrideVariableChargeAssignment(body, context) {
  if (pairedWorkflowEnabled()) throw httpError('Use the audited side-level General Manager override in the paired workflow.', 409, 'PAIRED_WORKFLOW_REFRESH_REQUIRED');
  const stemId = text(body?.stemId, 18);
  const operationId = operationIdentity(body);
  const reason = text(body?.reason, 1000);
  const assigneeProfileId = text(body?.assigneeProfileId, 64);
  if (reason.length < 5) throw httpError('A General Manager reason of at least 5 characters is required.', 400, 'GM_REASON_REQUIRED');
  const live = await liveCaseForStem(stemId, context);
  const gm = await activeGeneralManager(context.client, context.profile.id);
  if (!gm.isGeneralManager) throw httpError('Only the active General Manager may temporarily reassign a Variable Charges Charge case.', 403, 'GENERAL_MANAGER_REQUIRED');
  const stored = currentCaseRow(await storedCases(context.client, [stemId]), stemId);
  const profiles = await activeProfileDirectory(context.client);
  const assignee = profiles.find((row) => row.id === assigneeProfileId && !VIEW_ONLY_USER_TYPES.has(text(row.user_type).toLowerCase()));
  if (!assignee) throw httpError('Choose an active FCOS Buyer Trader profile.', 400, 'INVALID_ASSIGNEE');
  const requestFingerprint = sha256({ stemId, assigneeProfileId, reason, revision: body?.expectedRevision });
  const reservation = await reserveOperation(context.client, {
    operationId, type: 'gm_override', stemId, fingerprint: requestFingerprint, actorId: context.profile.id,
  });
  if (reservation?.status === 'succeeded') return reservation.result || {};
  if (reservation?.status === 'failed' || reservation?.status === 'uncertain') {
    throw httpError('This reassignment operation cannot be resumed safely. Refresh and use a new operation.', 409, 'OPERATION_NOT_RESUMABLE');
  }
  expectedRevision(body, stored);
  if (text(body?.expectedFingerprint, 128) !== live.fingerprint) throw httpError('Salesforce data changed after this case was opened. Refresh before reassigning it.', 409, 'LIVE_DATA_CONFLICT');
  if (reservation?.status !== 'salesforce_written') {
    await setSalesforceConfirmed(stemId, false, live.stem.LastModifiedDate);
    await completeOperation(context.client, operationId, 'salesforce_written', { stemId });
  }
  const { data, error } = await context.client.rpc('override_variable_charge_assignment', {
    p_stem_id: stemId, p_assignee_user_id: assigneeProfileId, p_reason: reason,
    p_expected_revision: Number(stored.revision || 0), p_operation_id: operationId,
    p_request_fingerprint: requestFingerprint, p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email,
  });
  if (error) {
    if (/changed after it was opened|revision|fingerprint/i.test(error.message || '')) throw httpError(error.message, 409, 'CASE_REVISION_CONFLICT');
    throw error;
  }
  return data;
}

export async function resolveVariableChargePostInvoiceChange(body, context) {
  const stemId = text(body?.stemId, 18);
  const operationId = operationIdentity(body);
  const resolution = text(body?.resolution, 40);
  const reference = text(body?.reference, 1000);
  const note = text(body?.note, 1000);
  if (!['no_adjustment', 'revised_invoice', 'credit_note'].includes(resolution)) throw httpError('Choose No adjustment, Revised invoice, or Credit note.', 400, 'INVALID_POST_INVOICE_RESOLUTION');
  if (!reference) throw httpError('A resolution reference is required.', 400, 'RESOLUTION_REFERENCE_REQUIRED');
  const live = await liveCaseForStem(stemId, context);
  const stored = currentCaseRow(await storedCases(context.client, [stemId]), stemId);
  const currentFingerprint = pairedWorkflowEnabled() ? live.buyerFingerprint : live.fingerprint;
  if (text(body?.expectedFingerprint, 128) !== currentFingerprint) throw httpError('Salesforce buyer-charge data changed after this case was opened. Refresh before resolving it.', 409, 'LIVE_DATA_CONFLICT');
  await requireCaseAuthority(context, stored, body);
  if (!live.invoices.some(finalInvoice)) throw httpError('A final buyer invoice is required before post-invoice resolution.', 409, 'FINAL_INVOICE_REQUIRED');
  const requestFingerprint = sha256({ stemId, resolution, reference, note, revision: body?.expectedRevision, live: currentFingerprint });
  const { data, error } = await context.client.rpc('resolve_variable_charge_post_invoice_change', {
    p_stem_id: stemId, p_resolution: resolution, p_reference: reference, p_note: note,
    p_expected_revision: Number(stored.revision || 0), p_operation_id: operationId,
    p_request_fingerprint: requestFingerprint, p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email, p_override_reason: text(body?.reason, 1000) || null,
  });
  if (error) {
    if (/changed after it was opened|revision/i.test(error.message || '')) throw httpError(error.message, 409, 'CASE_REVISION_CONFLICT');
    throw error;
  }
  return data;
}

function syncPayload(live, stored, dueDate) {
  const status = deriveStatus(live, stored);
  const sourceFingerprint = pairedWorkflowEnabled() ? live.buyerFingerprint : live.fingerprint;
  return {
    stemId: live.stem.Id,
    stemName: live.stem.Name || live.stem.KeyStem__c || live.stem.Id,
    workflowStatus: status === 'post_invoice_changes' ? 'post_invoice_change' : status,
    deliveryDate: live.stem.Delivery_Date__c || null,
    dueDate,
    assignedBuyerUserId: live.assignment?.profileId || null,
    assignedBuyerName: live.assignment?.name || null,
    assignedBuyerEmail: live.assignment?.email || null,
    assignmentSource: live.assignment?.status === 'resolved'
      ? (live.assignment?.matchedBy === 'name' ? 'nomination_name' : 'nomination_email')
      : 'unresolved',
    sourceFingerprint,
    supplierFingerprint: pairedWorkflowEnabled()
      ? sourceFingerprint
      : sha256(live.accounts.map((row) => ({
        id: row.Id,
        isAgent: row.Is_Agent__c === true,
        isVariable: row.Is_Variable__c === true,
        paymentTerm: row.Supplier_Payment_Term__c || null,
      }))),
    salesforceStemLastModifiedAt: live.stem.LastModifiedDate || null,
    invoiceState: live.invoices.some(finalInvoice) ? 'invoiced' : 'not_invoiced',
    postInvoiceDetectedAt: live.invoices.some(finalInvoice) && stored?.source_fingerprint && stored.source_fingerprint !== sourceFingerprint
      ? new Date().toISOString()
      : stored?.post_invoice_detected_at || null,
  };
}

export async function syncVariableCharges(context, { stemIds = null } = {}) {
  const existing = await storedCases(context.client, stemIds);
  const existingIds = existing.map((row) => row.stem_id);
  const requested = stemIds?.length ? stemIds : null;
  const detected = await loadLiveCases({ client: context.client, stemIds: requested, stemAccessCondition: context.stemAccessCondition || null });
  let live = detected;
  if (!requested) {
    const detectedIds = new Set(detected.map((row) => row.stem.Id));
    const missingExisting = existingIds.filter((id) => !detectedIds.has(id));
    if (missingExisting.length) live = [...detected, ...await loadLiveCases({ client: context.client, stemIds: missingExisting, stemAccessCondition: context.stemAccessCondition || null })];
  }
  const storedMap = new Map(existing.map((row) => [row.stem_id, row]));
  const results = [];
  for (const entry of live) {
    const dueDate = entry.hasProductLineItems && entry.stem.Delivery_Date__c ? await dueDateForDelivery(entry.stem.Delivery_Date__c) : null;
    const payload = syncPayload(entry, storedMap.get(entry.stem.Id), dueDate);
    if (context.profile?.id) {
      payload.actorUserId = context.profile.id;
      payload.actorEmail = context.profile.email || null;
    }
    const { data, error } = await context.client.rpc('sync_variable_charge_case', {
      p_case: payload,
      p_event: {
        eventType: 'synced',
        eventKey: `sync:${payload.stemId}:${payload.sourceFingerprint}:${payload.workflowStatus}`,
        summary: 'Variable Charges case synchronized from live Salesforce data.',
        metadata: {
          caseState: payload.workflowStatus,
          sourceChanged: Boolean(storedMap.get(entry.stem.Id)?.source_fingerprint && storedMap.get(entry.stem.Id).source_fingerprint !== payload.sourceFingerprint),
        },
      },
    });
    if (error) throw error;
    const { error: supplierStageError } = await context.client.rpc('sync_variable_charge_supplier_stages', {
      p_stem_id: entry.stem.Id,
      p_stages: (entry.supplierRequirements || []).map((row) => ({
        supplierAccountId: row.supplierId,
        assignedSupplierUserId: row.assignedSupplierTrader?.id || null,
        assignmentSource: row.assignmentStatus === 'resolved'
          ? row.assignedSupplierTrader?.matchedBy === 'name' ? 'nomination_name' : 'nomination_email'
          : 'unresolved',
        requirementSource: row.isAgent ? 'is_agent' : row.isVariable ? 'is_variable' : 'manual',
        status: text(row.status, 32).toLowerCase(),
        sourceFingerprint: row.status === 'Verified' && row.reviewedSourceFingerprint
          ? row.reviewedSourceFingerprint
          : row.sourceFingerprint,
        salesforceStageLastModifiedAt: row.lastModifiedAt || null,
      })),
    });
    if (supplierStageError) throw supplierStageError;
    const sidePayload = (entry.supplierRequirements || []).flatMap((row) => {
      const costStatus = row.status === 'Verified' ? 'verified' : row.status === 'Invalidated' ? 'invalidated' : 'pending';
      const buyerStatus = row.buyerChargeStatus === 'Verified' ? 'verified' : row.buyerChargeStatus === 'Invalidated' ? 'invalidated' : 'pending';
      const common = {
        supplierAccountId: row.supplierId,
        defaultAssigneeUserId: row.assignedSupplierTrader?.id || null,
        buyerTraderUserId: entry.assignment?.profileId || null,
        salesforceStageLastModifiedAt: row.lastModifiedAt || null,
      };
      return [
        { ...common, side: 'cost', status: costStatus, sourceFingerprint: row.sourceFingerprint },
        { ...common, side: 'buyer_charge', status: buyerStatus, sourceFingerprint: row.buyerChargeSourceFingerprint },
      ];
    });
    if (pairedWorkflowEnabled()) {
      const { error: sideStateError } = await context.client.rpc('sync_variable_charge_side_states', {
        p_stem_id: entry.stem.Id,
        p_sides: sidePayload,
      });
      if (sideStateError) throw sideStateError;
    }
    results.push(data);
  }
  return {
    checked: live.length,
    needsAction: results.filter((row) => (row?.case || row)?.workflow_status === 'needs_action').length,
    readyForInvoice: results.filter((row) => (row?.case || row)?.workflow_status === 'ready_for_invoice').length,
    postInvoiceChanges: results.filter((row) => (row?.case || row)?.workflow_status === 'post_invoice_change').length,
    results,
  };
}

// Temporary rollback aliases. Remove only after 24 hours with no legacy traffic.
export const listShipAgentCharges = listVariableCharges;
export const getShipAgentChargeDetail = getVariableChargeDetail;
export const shipAgentChargeOptions = variableChargeOptions;
export const saveAndConfirmShipAgentCharges = saveAndConfirmVariableCharges;
export const overrideShipAgentChargeAssignment = overrideVariableChargeAssignment;
export const resolveShipAgentPostInvoiceChange = resolveVariableChargePostInvoiceChange;
export const syncShipAgentCharges = syncVariableCharges;

function isShipAgentAccount(account) {
  return isVariableChargeAccount(account);
}

export const variableChargeInternals = {
  apexUtcTimestamp,
  applyAnchorageBuyerDefaults,
  applyHongKongBuyerDefaults,
  basicCallingSupplierIds,
  buyerAggregateFingerprint,
  buyerChargeLiveFingerprint,
  deriveStatus,
  effectiveAssignee,
  financialSummary,
  finalInvoice,
  isShipAgentAccount,
  isAnchorageDuesRow,
  isLightDuesRow,
  isHongKongStem,
  isVariableChargeAccount,
  lightDuesArrivalEvidence,
  liveFingerprint,
  normalizedEmail,
  normalizedName,
  normalizeBuyerReviewPayload,
  normalizeSupplierReviewPayload,
  nextHongKongBusinessDay,
  variableChargeActionability,
  plainLanguageWorkflow,
  supplierLiveFingerprint,
  sha256,
  serializeLiveRow,
  supplierDualCurrencySummary,
  SHIP_AGENT_STEM_CREATED_FROM: VARIABLE_CHARGE_STEM_CREATED_FROM,
  VARIABLE_CHARGE_STEM_CREATED_FROM,
};

export const shipAgentChargeInternals = variableChargeInternals;
