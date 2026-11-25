export const DEFAULT_BUYER_INVOICE_DAYS_AHEAD = 7;

export function buyerInvoiceDaysAhead(value) {
  const days = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  return Number.isFinite(days) ? Math.max(0, Math.min(Math.trunc(days), 365)) : DEFAULT_BUYER_INVOICE_DAYS_AHEAD;
}
