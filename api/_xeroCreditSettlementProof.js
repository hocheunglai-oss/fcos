import { resolveXeroPaymentAssociation, xeroPaymentDate } from './_xeroPaymentAssociation.js';

const SCALE = 10n ** 12n;
const MAX_AMOUNT = 999_999_999_999n * SCALE + 99n * SCALE / 100n;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && value.length > 0 && !/[\s,]/.test(value)
  && value !== '00000000-0000-0000-0000-000000000000' ? value.toLowerCase() : null;
const sameId = (left, right) => id(left) !== null && id(left) === id(right);
const validEvidence = (row) => record(row)
  && ['HasErrors', 'HasValidationErrors', 'IsDeleted'].every((key) => !Object.hasOwn(row, key) || row[key] === false)
  && (!Object.hasOwn(row, 'ValidationErrors') || Array.isArray(row.ValidationErrors) && row.ValidationErrors.length === 0);

// Exact bounded decimals: settlement equality must never round away a mismatch.
function amount(value) {
  if (!['number', 'string'].includes(typeof value)) return null;
  const text = String(value);
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
  return scaled <= MAX_AMOUNT ? scaled : null;
}

function amountText(value) {
  const fraction = String(value % SCALE).padStart(12, '0').replace(/0+$/, '');
  return `${value / SCALE}${fraction ? `.${fraction}` : ''}`;
}

/** CreditNotes have no AmountPaid. Prove the balance from explicit allocations
 * and refunds, keeping incomplete or reversed settlement evidence held. */
export function creditSettlementProof(raw) {
  if (!validEvidence(raw) || !id(raw.CreditNoteID) || !id(raw.Contact?.ContactID)
    || !['ACCRECCREDIT', 'ACCPAYCREDIT'].includes(raw.Type) || !/^[A-Z]{3}$/.test(raw.CurrencyCode || '')
    || !Array.isArray(raw.LineItems) || !Array.from(raw.LineItems).every(record)
    || !Object.hasOwn(raw, 'Total') || !Object.hasOwn(raw, 'RemainingCredit')
    || !Array.isArray(raw.Allocations) || !Array.isArray(raw.Payments)) return null;
  const total = amount(raw.Total); const remaining = amount(raw.RemainingCredit);
  if (total === null || remaining === null) return null;
  let allocated = 0n; let refunded = 0n;
  const seen = new Set();
  for (const allocation of raw.Allocations) {
    if (!validEvidence(allocation) || !id(allocation.AllocationID) || seen.has(id(allocation.AllocationID))
      || !xeroPaymentDate(allocation.Date) || !validEvidence(allocation.Invoice)
      || !id(allocation.Invoice.InvoiceID) || allocation.Invoice.CurrencyCode !== raw.CurrencyCode
      || allocation.Invoice.Type !== (raw.Type === 'ACCRECCREDIT' ? 'ACCREC' : 'ACCPAY')
      || !sameId(allocation.Invoice.Contact?.ContactID, raw.Contact.ContactID)
      || ['Overpayment', 'Prepayment'].some((key) => Object.hasOwn(allocation, key))
      || Object.hasOwn(allocation, 'CreditNote') && (!validEvidence(allocation.CreditNote)
        || !sameId(allocation.CreditNote.CreditNoteID, raw.CreditNoteID)
        || Object.hasOwn(allocation.CreditNote, 'Type') && allocation.CreditNote.Type !== raw.Type
        || Object.hasOwn(allocation.CreditNote, 'CurrencyCode') && allocation.CreditNote.CurrencyCode !== raw.CurrencyCode
        || Object.hasOwn(allocation.CreditNote, 'Contact') && !sameId(allocation.CreditNote.Contact?.ContactID, raw.Contact.ContactID))) return null;
    const value = amount(allocation.Amount);
    if (value === null || value <= 0n) return null;
    seen.add(id(allocation.AllocationID)); allocated += value;
  }
  for (const payment of raw.Payments) {
    if (!validEvidence(payment) || payment.Status !== 'AUTHORISED' || !xeroPaymentDate(payment.Date)
      || !id(payment.PaymentID) || seen.has(id(payment.PaymentID))
      || ['Invoice', 'CreditNote'].some((key) => Object.hasOwn(payment, key) && !validEvidence(payment[key]))) return null;
    const association = resolveXeroPaymentAssociation(payment);
    if (association.disposition !== 'noninvoice' || association.documentKind !== 'credit_note'
      || association.paymentType !== (raw.Type === 'ACCRECCREDIT' ? 'ARCREDITPAYMENT' : 'APCREDITPAYMENT')
      || !sameId(association.documentId, raw.CreditNoteID) || association.currency !== raw.CurrencyCode
      || !sameId(association.contactId, raw.Contact.ContactID)) return null;
    const value = amount(payment.Amount);
    if (value === null || value <= 0n) return null;
    seen.add(id(payment.PaymentID)); refunded += value;
  }
  if (total !== remaining + allocated + refunded
    || Object.hasOwn(raw, 'AppliedAmount') && amount(raw.AppliedAmount) !== allocated
    || Object.hasOwn(raw, 'AmountPaid') && amount(raw.AmountPaid) !== refunded) return null;
  return { amountPaid: amountText(refunded), amountCredited: amountText(allocated) };
}
