const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Salesforce STEM fields used to calculate or retain a buyer invoice due date.
 * Date fields are ISO date-time strings because the helper deliberately keeps
 * only their calendar-date prefix.
 *
 * @typedef {object} BuyerInvoiceDateStem
 * @property {string | null | undefined} [Invoice_Due_Date__c]
 * @property {string | null | undefined} [Due_Date__c]
 * @property {string | null | undefined} [Buyer_Pay_Term_Date__c]
 * @property {string | null | undefined} [QLIK_Invoice_Due_Date__c]
 * @property {string | null | undefined} [Expected_Delivery_Date_Payment_Term__c]
 * @property {string | null | undefined} [Delivery_Date__c]
 * @property {string | null | undefined} [Expected_Delivery_Date__c]
 * @property {string | number | null | undefined} [Payment_Term__c]
 * @property {number | string | null | undefined} [Not_Cancelled_STEM_Line_Item_Quantity__c]
 * @property {boolean | null | undefined} [Due_Date_Override__c]
 */

/**
 * Extract a whole number of payment-term days from the persisted term value.
 *
 * @param {string | number | null | undefined} value
 * @returns {number | null}
 */
export function paymentTermDays(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const days = Number(match[0]);
  return Number.isFinite(days) ? Math.trunc(days) : null;
}

/**
 * Add whole calendar days to an ISO calendar-date value.
 *
 * @param {string | null | undefined} value
 * @param {number} days
 * @returns {string | null}
 */
function addCalendarDays(value, days) {
  const dateString = String(value || '').slice(0, 10);
  if (!ISO_DATE_PREFIX_RE.test(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Read a due date supplied by legacy Salesforce payloads.
 *
 * @param {BuyerInvoiceDateStem} [stem]
 * @returns {string | null}
 */
function storedBuyerInvoiceDueDate(stem = {}) {
  return [stem.Invoice_Due_Date__c, stem.Due_Date__c, stem.Buyer_Pay_Term_Date__c, stem.QLIK_Invoice_Due_Date__c, stem.Expected_Delivery_Date_Payment_Term__c]
    .map((value) => String(value || '').slice(0, 10))
    .find((value) => ISO_DATE_PREFIX_RE.test(value)) || null;
}

/**
 * @param {BuyerInvoiceDateStem} [stem]
 * @returns {boolean}
 */
function isKnownExtraCostOnlyStem(stem = {}) {
  if (!Object.prototype.hasOwnProperty.call(stem, 'Not_Cancelled_STEM_Line_Item_Quantity__c')) return false;
  const productLineCount = Number(stem.Not_Cancelled_STEM_Line_Item_Quantity__c);
  return Number.isFinite(productLineCount) && productLineCount <= 0;
}

/**
 * Calculate the calendar date implied by a STEM's buyer payment terms.
 *
 * @param {BuyerInvoiceDateStem} [stem]
 * @returns {string | null}
 */
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

/**
 * Resolve the buyer invoice due date while respecting explicit overrides and
 * legacy payload compatibility.
 *
 * @param {BuyerInvoiceDateStem} [stem]
 * @returns {string | null}
 */
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
