export const PAYMENT_DATA_RELIABLE_FROM = '2026-01-01';
export const PAYMENT_DATA_RELIABILITY_POLICY = 'legacy_settled_by_company_confirmation';
export const PAYMENT_DATA_RELIABILITY_LABEL = 'Payment data reliable from 1 Jan 2026';
export const LEGACY_PAYMENT_DATA_LABEL = 'Unavailable before 1 Jan 2026';
export const LEGACY_PAYMENT_SETTLED_LABEL = 'Settled before FCOS cutover';

const HONG_KONG_CUTOFF_UTC = '2025-12-31T16:00:00.000Z';

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value != null && String(value).trim()) return value;
  }
  return null;
}

function dateOnly(value) {
  if (!value) return null;
  const stringValue = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue.slice(0, 10)) && !stringValue.includes('T')) {
    return stringValue.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function paymentDataReliabilityDate(stem = {}) {
  const actual = firstValue(stem, ['Delivery_Date__c', 'deliveryDate', 'actualDeliveryDate']);
  if (actual) return { date: String(actual).slice(0, 10), basis: 'actual_delivery_date' };
  const expected = firstValue(stem, ['Expected_Delivery_Date__c', 'expectedDeliveryDate']);
  if (expected) return { date: String(expected).slice(0, 10), basis: 'expected_delivery_date' };
  const created = firstValue(stem, ['CreatedDate', 'createdDate']);
  const createdDate = dateOnly(created);
  return createdDate ? { date: createdDate, basis: 'created_date_hong_kong' } : { date: null, basis: 'unavailable' };
}

export function paymentDataReliabilityState(stem = {}) {
  const effective = paymentDataReliabilityDate(stem);
  const reliable = Boolean(effective.date && effective.date >= PAYMENT_DATA_RELIABLE_FROM);
  return {
    reliable,
    effectiveDate: effective.date,
    dateBasis: effective.basis,
    status: reliable ? 'reliable' : 'legacy_settled',
    display: reliable ? PAYMENT_DATA_RELIABILITY_LABEL : LEGACY_PAYMENT_DATA_LABEL,
  };
}

export function isPaymentDataReliableStem(stem = {}) {
  return paymentDataReliabilityState(stem).reliable;
}

function safePrefix(prefix = '') {
  const value = String(prefix || '');
  if (value && !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*\.$/.test(value)) {
    throw new Error('Invalid Salesforce relationship prefix.');
  }
  return value;
}

export function paymentDataReliableSoql(prefix = '') {
  const field = safePrefix(prefix);
  return `(${field}Delivery_Date__c >= ${PAYMENT_DATA_RELIABLE_FROM} OR (${field}Delivery_Date__c = NULL AND ${field}Expected_Delivery_Date__c >= ${PAYMENT_DATA_RELIABLE_FROM}) OR (${field}Delivery_Date__c = NULL AND ${field}Expected_Delivery_Date__c = NULL AND ${field}CreatedDate >= ${HONG_KONG_CUTOFF_UTC}))`;
}

export function legacyPaymentDataSoql(prefix = '') {
  const field = safePrefix(prefix);
  return `(${field}Delivery_Date__c < ${PAYMENT_DATA_RELIABLE_FROM} OR (${field}Delivery_Date__c = NULL AND ${field}Expected_Delivery_Date__c < ${PAYMENT_DATA_RELIABLE_FROM}) OR (${field}Delivery_Date__c = NULL AND ${field}Expected_Delivery_Date__c = NULL AND ${field}CreatedDate < ${HONG_KONG_CUTOFF_UTC}))`;
}

export function paymentDataReliabilityMetadata(excludedLegacyRecordCount = 0, reliableRecordCount = null) {
  return {
    reliableFrom: PAYMENT_DATA_RELIABLE_FROM,
    policy: PAYMENT_DATA_RELIABILITY_POLICY,
    excludedLegacyRecordCount: Math.max(0, Number(excludedLegacyRecordCount) || 0),
    reliableRecordCount: reliableRecordCount == null ? null : Math.max(0, Number(reliableRecordCount) || 0),
    displayedTotalsUseReliableEvidenceOnly: true,
    legacyTreatment: LEGACY_PAYMENT_SETTLED_LABEL,
  };
}
