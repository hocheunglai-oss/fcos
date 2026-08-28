export const BASIC_CALLING_COST = 'BASIC CALLING COST';
export const AGENCY_FEE = 'AGENCY FEE';
export const PORT_CLEARANCE_FEE = 'PORT CLEARANCE FEE';
export const LIGHT_DUES = 'LIGHT DUES';
export const ANCHORAGE_DUES = 'ANCHORAGE DUES';
export const PORT_CLEARANCE_RATE_HKD = 58;
export const PORT_CLEARANCE_CALCULATION_VERSION = 'HK-PC-2026-01';

const ORDER = new Map([
  [AGENCY_FEE, 1],
  [PORT_CLEARANCE_FEE, 2],
  [LIGHT_DUES, 3],
  [ANCHORAGE_DUES, 4],
]);

export function normalizedChargeProduct(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function isAgencyFee(value) {
  return normalizedChargeProduct(value) === AGENCY_FEE;
}

export function isPortClearanceFee(value) {
  return normalizedChargeProduct(value) === PORT_CLEARANCE_FEE;
}

export function isBasicCallingSupport(value) {
  return ORDER.has(normalizedChargeProduct(value));
}

export function basicCallingSequence(value) {
  return ORDER.get(normalizedChargeProduct(value)) ?? null;
}

export function calculatePortClearance({ applicationCount, usdHkdRate }) {
  const count = Number(applicationCount);
  const rate = Number(usdHkdRate);
  const errors = [];
  if (!Number.isInteger(count) || count < 1) errors.push('Enter the whole-number application count reported by the supplier.');
  if (!Number.isFinite(rate) || rate <= 0) errors.push('The reviewed USD/HKD rate is unavailable.');
  if (errors.length) return { complete: false, errors, applicationCount: Number.isFinite(count) ? count : null, rateHkd: PORT_CLEARANCE_RATE_HKD };
  const supplierHkd = count * PORT_CLEARANCE_RATE_HKD;
  const buyerHkd = Math.max(count - 1, 0) * PORT_CLEARANCE_RATE_HKD;
  const supplierUnitUsd = Math.round((PORT_CLEARANCE_RATE_HKD / rate) * 100) / 100;
  const buyerTotalUsd = Math.round((buyerHkd / rate) * 100) / 100;
  const buyerUnitUsd = Math.round((buyerTotalUsd / count) * 100) / 100;
  return {
    complete: true,
    errors: [],
    applicationCount: count,
    rateHkd: PORT_CLEARANCE_RATE_HKD,
    supplierHkd,
    buyerHkd,
    supplierUnitUsd,
    supplierTotalUsd: Math.round((supplierHkd / rate) * 100) / 100,
    buyerUnitUsd,
    buyerTotalUsd,
    includedApplications: 1,
    additionalApplications: Math.max(count - 1, 0),
    usdHkdRate: rate,
  };
}
