const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

export function paymentTermDays(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const days = Number(match[0]);
  return Number.isFinite(days) ? Math.trunc(days) : null;
}

function addCalendarDays(value, days) {
  const dateString = String(value || '').slice(0, 10);
  if (!ISO_DATE_PREFIX_RE.test(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calculatedBuyerPayTermDate(stem = {}) {
  const basisDate = stem.Delivery_Date__c || stem.Delivery_Date_Or_Expected__c || stem.Expected_Delivery_Date__c;
  const days = paymentTermDays(stem.Payment_Term__c);
  if (!basisDate || days == null) return null;

  // Buyer terms count the delivery date as day one.
  const calendarOffset = days > 0 ? days - 1 : days;
  return addCalendarDays(basisDate, calendarOffset);
}
