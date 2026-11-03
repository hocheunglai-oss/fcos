export const CAMPAIGN_RESERVE = 200;
export const amountFor = (value, currency) => {
  if (value == null || value === '') return 'Amount unavailable';
  const number = Number(value);
  return Number.isFinite(number) ? `${currency || ''} ${number.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() : 'Amount unavailable';
};
export function quotaMessage(allowance, forecast) {
  const remaining = allowance?.remaining;
  const reserve = allowance?.reserve ?? CAMPAIGN_RESERVE;
  const observedAt = allowance?.observedAt;
  const forecastCalls = forecast?.callsNeeded == null ? NaN : Number(forecast.callsNeeded);
  if (allowance?.holdReason) return allowance.holdReason;
  if (remaining == null || !Number.isFinite(Number(remaining)) || !observedAt) return 'Xero allowance is not verified. Check the connection before running an approved batch.';
  if (!Number.isFinite(forecastCalls) || forecast?.canProceed !== true) return forecast?.reason || 'A verified call forecast is required before running an approved batch.';
  if (Number(remaining) - Number(allowance?.reservedCalls || 0) - forecastCalls < reserve) return 'This batch would cross the 200-call Xero reserve. Continue after verified capacity returns.';
  return null;
}
