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

function storedBuyerInvoiceDueDate(stem = {}) {
  return [stem.Invoice_Due_Date__c, stem.Due_Date__c, stem.Buyer_Pay_Term_Date__c, stem.QLIK_Invoice_Due_Date__c, stem.Expected_Delivery_Date_Payment_Term__c]
    .map((value) => String(value || '').slice(0, 10))
    .find((value) => ISO_DATE_PREFIX_RE.test(value)) || null;
}

function isKnownExtraCostOnlyStem(stem = {}) {
  if (!Object.prototype.hasOwnProperty.call(stem, 'Not_Cancelled_STEM_Line_Item_Quantity__c')) return false;
  const productLineCount = Number(stem.Not_Cancelled_STEM_Line_Item_Quantity__c);
  return Number.isFinite(productLineCount) && productLineCount <= 0;
}

export function calculatedBuyerPayTermDate(stem = {}) {
  if (isKnownExtraCostOnlyStem(stem)) return null;
  const paymentTerm = String(stem.Payment_Term__c || '').trim();
  if (paymentTerm.toUpperCase() === 'CIA') {
    return addCalendarDays(stem.Expected_Delivery_Date__c, -1);
  }
  const basisDate = stem.Delivery_Date__c;
  const days = paymentTermDays(paymentTerm);
  if (!basisDate || days == null) return null;

  // Buyer terms count the delivery date as day one.
  const calendarOffset = days > 0 ? days - 1 : days;
  return addCalendarDays(basisDate, calendarOffset);
}

export function resolvedBuyerInvoiceDueDate(stem = {}) {
  if (stem.Due_Date_Override__c === true) {
    const overrideDate = String(stem.Invoice_Due_Date__c || '').slice(0, 10);
    return ISO_DATE_PREFIX_RE.test(overrideDate) ? overrideDate : null;
  }

  const calculatedDate = calculatedBuyerPayTermDate(stem);
  if (calculatedDate || stem.Due_Date_Override__c === false) return calculatedDate;

  // Compatibility for payloads that predate the explicit override field.
  return storedBuyerInvoiceDueDate(stem);
}
