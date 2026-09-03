const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(value) {
  const normalized = String(value || '').slice(0, 10);
  return ISO_DATE_RE.test(normalized) ? normalized : null;
}

export function resolveBdnDeliveryDate(products = []) {
  const lineItems = Array.isArray(products)
    ? products.filter((product) => product?.objectName === 'STEM_Line_Item__c')
    : [];
  if (lineItems.length === 0) return { date: null, status: 'none', lineItemCount: 0 };

  const normalizedDates = lineItems.map((product) => dateOnly(product?.bdnDeliveryDate));
  if (normalizedDates.some((date) => !date)) {
    return { date: null, status: 'missing', lineItemCount: lineItems.length };
  }

  const dates = [...new Set(normalizedDates)];
  if (dates.length !== 1) {
    return { date: null, status: 'multiple', lineItemCount: lineItems.length };
  }
  return { date: dates[0], status: 'single', lineItemCount: lineItems.length };
}

export function addInvoiceCalendarDays(value, days) {
  const normalized = dateOnly(value);
  if (!normalized || !Number.isInteger(days)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function invoicePaymentTermDays(value) {
  const match = String(value || '').match(/-?\d+/);
  if (!match) return null;
  const days = Number(match[0]);
  return Number.isInteger(days) ? days : null;
}

export function calculatedStemInvoiceDueDate({
  paymentTerm,
  deliveryDate,
  expectedDeliveryDate,
  extraCostOnly = false,
} = {}) {
  if (extraCostOnly) return null;
  if (String(paymentTerm || '').trim().toUpperCase() === 'CIA') {
    return addInvoiceCalendarDays(expectedDeliveryDate, -1);
  }

  const days = invoicePaymentTermDays(paymentTerm);
  if (days == null || !deliveryDate) return null;
  return addInvoiceCalendarDays(deliveryDate, days > 0 ? days - 1 : days);
}
