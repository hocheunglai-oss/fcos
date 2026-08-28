export const LIGHT_DUES_CALCULATION_VERSION = 'hk-md-2026-v1';
export const LIGHT_DUES_CATEGORY_ALL_OTHER = 'All Other';
export const LIGHT_DUES_CATEGORY_RIVER_TRADE = 'River Trade Only';

const RATES = new Map([
  [LIGHT_DUES_CATEGORY_ALL_OTHER, 43],
  [LIGHT_DUES_CATEGORY_RIVER_TRADE, 18],
]);

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value) {
  const match = String(value || '').trim().match(/^\d{4}-\d{2}-\d{2}$/);
  return match ? match[0] : null;
}

export function calculateHongKongLightDues({ nrt, category = LIGHT_DUES_CATEGORY_ALL_OTHER, entryDate } = {}) {
  const tonnage = numberOrNull(nrt);
  const normalizedDate = dateOnly(entryDate);
  const errors = [];
  if (!(Number.isInteger(tonnage) && tonnage > 0)) errors.push('Enter a positive whole-number Vessel NRT.');
  if (!RATES.has(category)) errors.push('Choose a valid Light Dues vessel category.');
  if (!normalizedDate) errors.push('Enter the confirmed Hong Kong entry date.');
  if (errors.length) return { complete: false, errors, version: LIGHT_DUES_CALCULATION_VERSION };
  const units = Math.ceil(tonnage / 100);
  const rateHkdPerHundredNrt = RATES.get(category);
  return {
    complete: true,
    errors: [],
    version: LIGHT_DUES_CALCULATION_VERSION,
    nrt: tonnage,
    category,
    entryDate: normalizedDate,
    hundredNrtUnits: units,
    rateHkdPerHundredNrt,
    amountHkd: units * rateHkdPerHundredNrt,
  };
}

export function convertHkdToUsd(amountHkd, usdHkdRate) {
  const amount = numberOrNull(amountHkd);
  const rate = numberOrNull(usdHkdRate);
  if (amount == null || !(rate > 0)) return null;
  return Math.round(((amount / rate) + Number.EPSILON) * 100) / 100;
}

export function supplierDualCurrency({ usdAmount, inputCurrency, inputAmount, savedRate, currentRate } = {}) {
  const usd = numberOrNull(usdAmount);
  const rate = numberOrNull(savedRate) > 0 ? Number(savedRate) : numberOrNull(currentRate);
  const native = numberOrNull(inputAmount);
  const currency = String(inputCurrency || '').trim().toUpperCase();
  const basis = numberOrNull(savedRate) > 0 ? 'reviewed_rate' : 'current_rate';
  if (usd == null || !(rate > 0)) return { complete: false, usdAmount: usd, hkdAmount: null, rate, basis };
  return {
    complete: true,
    usdAmount: Math.round((usd + Number.EPSILON) * 100) / 100,
    hkdAmount: currency === 'HKD' && native != null
      ? Math.round((native + Number.EPSILON) * 100) / 100
      : Math.round(((usd * rate) + Number.EPSILON) * 100) / 100,
    rate,
    basis,
  };
}
