export const ANCHORAGE_CALCULATION_VERSION = 'hk-md-2026-v1';
export const ANCHORAGE_BUYER_CALCULATION_VERSION = 'hk-buyer-nrt-hour-2026-v1';
export const ANCHORAGE_BUYER_RATE_USD_PER_NRT_HOUR = 0.002;
export const ANCHORAGE_FREE_MINUTES = 12 * 60;
export const ANCHORAGE_LOCATION_ELSEWHERE = 'Elsewhere in Hong Kong';
export const ANCHORAGE_LOCATION_ELSEWHERE_LABEL = 'Anywhere except Victoria Port';
export const ANCHORAGE_LOCATION_VICTORIA = 'Victoria Port';

const RATES = new Map([
  [ANCHORAGE_LOCATION_ELSEWHERE, 0.015],
  [ANCHORAGE_LOCATION_VICTORIA, 0.02],
]);

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function instant(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function allocateBuyerTotal(totalUsd, supplierAllocations, supplierTotalHkd) {
  if (!supplierAllocations.length) return [];
  if (!(supplierTotalHkd > 0) || !(totalUsd > 0)) {
    return supplierAllocations.map((row) => ({ id: row.id, amountUsd: 0 }));
  }
  let allocatedUsd = 0;
  return supplierAllocations.map((row, index) => {
    const amountUsd = index === supplierAllocations.length - 1
      ? roundMoney(totalUsd - allocatedUsd)
      : roundMoney(totalUsd * (Number(row.amountHkd || 0) / supplierTotalHkd));
    allocatedUsd = roundMoney(allocatedUsd + amountUsd);
    return { id: row.id, amountUsd };
  });
}

export function calculateHongKongAnchorageDues({ nrt, periods = [], allocations = [] } = {}) {
  const tonnage = numberOrNull(nrt);
  const errors = [];
  if (!(Number.isInteger(tonnage) && tonnage > 0)) errors.push('Enter a positive whole-number Vessel NRT.');
  const normalized = periods.map((period, index) => {
    const arrival = instant(period?.arrival);
    const departure = instant(period?.departure);
    const location = RATES.has(period?.location) ? period.location : ANCHORAGE_LOCATION_ELSEWHERE;
    if (!arrival || !departure) errors.push(`Complete arrival and departure for anchorage period ${index + 1}.`);
    else if (departure <= arrival) errors.push(`Anchorage departure must be after arrival for period ${index + 1}.`);
    return {
      id: String(period?.id || index),
      supplierId: period?.supplierId || null,
      arrival,
      departure,
      location,
      durationMinutes: arrival && departure && departure > arrival ? (departure.getTime() - arrival.getTime()) / 60_000 : 0,
    };
  }).sort((a, b) => (a.arrival?.getTime() || 0) - (b.arrival?.getTime() || 0) || a.id.localeCompare(b.id));

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].departure && normalized[index].arrival
      && normalized[index].arrival < normalized[index - 1].departure) {
      errors.push('Anchorage periods within the same STEM cannot overlap.');
      break;
    }
  }
  if (!normalized.length) errors.push('Add at least one anchorage period.');
  if (errors.length) return { complete: false, errors: [...new Set(errors)], version: ANCHORAGE_CALCULATION_VERSION };

  let freeMinutesRemaining = ANCHORAGE_FREE_MINUTES;
  const chargeableMinutesByLocation = new Map([...RATES.keys()].map((key) => [key, 0]));
  const periodBreakdown = normalized.map((period) => {
    const freeMinutes = Math.min(period.durationMinutes, freeMinutesRemaining);
    freeMinutesRemaining -= freeMinutes;
    const chargeableMinutes = Math.max(0, period.durationMinutes - freeMinutes);
    chargeableMinutesByLocation.set(period.location, chargeableMinutesByLocation.get(period.location) + chargeableMinutes);
    return {
      id: period.id,
      supplierId: period.supplierId,
      location: period.location,
      arrival: period.arrival.toISOString(),
      departure: period.departure.toISOString(),
      durationMinutes: period.durationMinutes,
      freeMinutes,
      chargeableMinutes,
    };
  });
  const totalMinutes = normalized.reduce((sum, period) => sum + period.durationMinutes, 0);
  const locations = [...RATES].map(([location, rate]) => {
    const minutes = chargeableMinutesByLocation.get(location);
    const hours = minutes > 0 ? Math.ceil(minutes / 60) : 0;
    return { location, chargeableMinutes: minutes, chargeableHours: hours, rateHkdPerNrtHour: rate, amountHkd: tonnage * hours * rate };
  }).filter((row) => row.chargeableMinutes > 0);
  const rawAmountHkd = locations.reduce((sum, row) => sum + row.amountHkd, 0);
  const statutoryAmountHkd = rawAmountHkd > 0 ? Math.floor(Math.max(100, rawAmountHkd) * 10) / 10 : 0;

  const allocationRows = allocations.map((row) => ({ id: String(row?.id || ''), amountHkd: numberOrNull(row?.amountHkd) }));
  const autoAllocation = normalized.length === 1 ? [{ id: normalized[0].id, amountHkd: statutoryAmountHkd }] : null;
  const effectiveAllocations = autoAllocation || allocationRows;
  const allocationComplete = effectiveAllocations.length === normalized.length
    && effectiveAllocations.every((row) => row.id && row.amountHkd != null && row.amountHkd >= 0)
    && Math.abs(effectiveAllocations.reduce((sum, row) => sum + row.amountHkd, 0) - statutoryAmountHkd) <= 0.1;
  const buyerChargeableHours = locations.reduce((sum, row) => sum + row.chargeableHours, 0);
  const buyerRawAmountUsd = tonnage * buyerChargeableHours * ANCHORAGE_BUYER_RATE_USD_PER_NRT_HOUR;
  const buyerTotalUsd = roundMoney(buyerRawAmountUsd);
  const buyerAllocations = allocationComplete
    ? allocateBuyerTotal(buyerTotalUsd, effectiveAllocations, statutoryAmountHkd)
    : [];
  return {
    complete: true,
    errors: [],
    version: ANCHORAGE_CALCULATION_VERSION,
    nrt: tonnage,
    totalMinutes,
    freeMinutes: Math.min(totalMinutes, ANCHORAGE_FREE_MINUTES),
    chargeableMinutes: Math.max(0, totalMinutes - ANCHORAGE_FREE_MINUTES),
    locations,
    periods: periodBreakdown,
    rawAmountHkd: roundMoney(rawAmountHkd),
    statutoryAmountHkd,
    minimumApplied: rawAmountHkd > 0 && rawAmountHkd < 100,
    allocations: effectiveAllocations,
    automaticAllocation: Boolean(autoAllocation),
    allocationComplete,
    allocationDifferenceHkd: roundMoney(effectiveAllocations.reduce((sum, row) => sum + (row.amountHkd || 0), 0) - statutoryAmountHkd),
    buyer: {
      complete: allocationComplete,
      version: ANCHORAGE_BUYER_CALCULATION_VERSION,
      rateUsdPerNrtHour: ANCHORAGE_BUYER_RATE_USD_PER_NRT_HOUR,
      chargeableHours: buyerChargeableHours,
      rawAmountUsd: buyerRawAmountUsd,
      totalUsd: buyerTotalUsd,
      allocations: buyerAllocations,
    },
  };
}

export function convertAnchorageHkd(amountHkd, currency, usdHkdRate) {
  const amount = numberOrNull(amountHkd);
  const code = String(currency || '').trim().toUpperCase();
  if (amount == null) return { available: false, reason: 'Anchorage dues amount is unavailable.' };
  if (code === 'HKD') return { available: true, amount: roundMoney(amount), rate: 1, basis: 'HKD direct' };
  if (code === 'USD') {
    const rate = numberOrNull(usdHkdRate);
    if (!(rate > 0)) return { available: false, reason: 'The company USD/HKD rate is unavailable.' };
    return { available: true, amount: roundMoney(amount / rate), rate, basis: `USD 1 = HKD ${rate}` };
  }
  return { available: false, reason: `${code || 'This currency'} is not supported for Hong Kong anchorage-dues conversion.` };
}
