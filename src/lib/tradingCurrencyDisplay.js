function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function existingUsdNumber(value) {
  if (value == null || value === '' || typeof value === 'object') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function immutableRevision(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function confirmedTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function tradingCurrencyDisplay({
  currency,
  hkdUnitPrice,
  fxRate,
  fxRevision,
  fxConfirmedAt,
  existingUsd,
  hasPreciseUsd = false,
} = {}) {
  // Keep the pre-existing USD rendering semantics intact while holding HKD evidence
  // to the stricter numeric check above.
  const existingUsdAmount = existingUsdNumber(existingUsd);
  const nativeHkd = finiteNumber(hkdUnitPrice);
  const savedRate = finiteNumber(fxRate);
  const revision = immutableRevision(fxRevision);
  const preciseUsd = hasPreciseUsd === true;

  if (currency !== 'HKD' || nativeHkd === null || savedRate === null || savedRate <= 0 || revision === null) {
    return { hasHkdEvidence: false, existingUsd: existingUsdAmount, hasPreciseUsd: preciseUsd, nativeHkd: null, usdEquivalent: existingUsdAmount, fxRate: null, fxRevision: null, fxConfirmedAt: null, rateStatus: null };
  }

  const confirmedAt = confirmedTimestamp(fxConfirmedAt);
  return {
    hasHkdEvidence: true,
    existingUsd: existingUsdAmount,
    hasPreciseUsd: preciseUsd,
    nativeHkd,
    usdEquivalent: nativeHkd / savedRate,
    fxRate: savedRate,
    fxRevision: revision,
    fxConfirmedAt: confirmedAt,
    rateStatus: confirmedAt ? 'Confirmed FX rate' : 'Saved FX rate',
  };
}
