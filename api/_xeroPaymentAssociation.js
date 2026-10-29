const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = Object.freeze({
  ACCRECPAYMENT: { kind: 'invoice', type: 'ACCREC', key: 'Invoice', id: 'InvoiceID' },
  ACCPAYPAYMENT: { kind: 'invoice', type: 'ACCPAY', key: 'Invoice', id: 'InvoiceID' },
  ARCREDITPAYMENT: { kind: 'credit_note', type: 'ACCRECCREDIT', key: 'CreditNote', id: 'CreditNoteID' },
  APCREDITPAYMENT: { kind: 'credit_note', type: 'ACCPAYCREDIT', key: 'CreditNote', id: 'CreditNoteID' },
  ARPREPAYMENTPAYMENT: { kind: 'prepayment', type: 'ARPREPAYMENT', dedicatedType: 'RECEIVE-PREPAYMENT', key: 'Prepayment', id: 'PrepaymentID' },
  APPREPAYMENTPAYMENT: { kind: 'prepayment', type: 'APPREPAYMENT', dedicatedType: 'SPEND-PREPAYMENT', key: 'Prepayment', id: 'PrepaymentID' },
  AROVERPAYMENTPAYMENT: { kind: 'overpayment', type: 'AROVERPAYMENT', dedicatedType: 'RECEIVE-OVERPAYMENT', key: 'Overpayment', id: 'OverpaymentID' },
  APOVERPAYMENTPAYMENT: { kind: 'overpayment', type: 'APOVERPAYMENT', dedicatedType: 'SPEND-OVERPAYMENT', key: 'Overpayment', id: 'OverpaymentID' },
});
const ASSOCIATIONS = Object.freeze([
  ['Invoice', 'InvoiceID'], ['CreditNote', 'CreditNoteID'],
  ['Prepayment', 'PrepaymentID'], ['Overpayment', 'OverpaymentID'],
]);
const present = value => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
const validUuid = value => typeof value === 'string' && UUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
export const xeroPaymentSameId = (left, right) => validUuid(left) && validUuid(right)
  ? left.toLowerCase() === right.toLowerCase() : left === right;

// Xero can put a credit/refund in the legacy Invoice field. PaymentType and
// the nested document Type, never the property name, determine the association.
export function resolveXeroPaymentAssociation(row) {
  const paymentType = typeof row?.PaymentType === 'string' ? row.PaymentType : null;
  const expected = Object.hasOwn(TYPES, paymentType) ? TYPES[paymentType] : null;
  const base = { paymentType, documentKind: expected?.kind || null, documentId: null };
  const invalid = (code = 'XERO_PAYMENT_ASSOCIATION_INCOMPLETE') => ({ ...base, disposition: 'invalid', code });
  if (!expected) return invalid('XERO_PAYMENT_TYPE_UNRECOGNISED');
  if (!validUuid(row?.PaymentID)) return invalid();
  const found = [];
  for (const [key, idField] of ASSOCIATIONS) {
    const value = row?.[key];
    if (!present(value)) continue;
    if (!value || Array.isArray(value) || typeof value !== 'object') return invalid();
    const type = value.Type;
    const id = value[idField];
    // A non-invoice in the legacy Invoice field still uses InvoiceID.
    if (type !== (key === 'Invoice' ? expected.type : expected.dedicatedType || expected.type) || !validUuid(id)
      || !/^[A-Z]{3}$/.test(value.CurrencyCode || '')
      || !validUuid(value.Contact?.ContactID)) return invalid();
    if (key !== expected.key && key !== 'Invoice') return invalid('XERO_PAYMENT_ASSOCIATION_CONFLICT');
    found.push({ id, currency: value.CurrencyCode, contactId: value.Contact.ContactID });
  }
  if (!found.length) return invalid();
  if (found.length !== 1) return invalid('XERO_PAYMENT_ASSOCIATION_CONFLICT');
  const first = found[0];
  return {
    ...base, documentId: first.id, currency: first.currency, contactId: first.contactId,
    disposition: expected.kind === 'invoice' ? 'invoice' : 'noninvoice',
    code: expected.kind === 'invoice' ? null : 'XERO_PAYMENT_NONINVOICE_REVIEW_REQUIRED',
  };
}

export function xeroPaymentEvidenceHold(row) {
  const association = resolveXeroPaymentAssociation(row);
  if (association.disposition === 'invoice') return null;
  const amount = typeof row?.Amount === 'number' && Number.isFinite(row.Amount) && row.Amount > 0 ? row.Amount : null;
  const day = xeroPaymentDate(row?.Date);
  return {
    xeroPaymentId: typeof row?.PaymentID === 'string' ? row.PaymentID : null,
    paymentType: association.paymentType,
    documentKind: association.documentKind,
    documentId: association.documentId,
    code: association.code,
    status: 'held',
    currency: association.currency || null,
    amount,
    date: day,
  };
}

export function xeroPaymentTouchesDocument(row, invoiceId) {
  if (!invoiceId) return false;
  const association = resolveXeroPaymentAssociation(row);
  if (xeroPaymentSameId(association.documentId, invoiceId)) return true;
  return ASSOCIATIONS.some(([key, idField]) => xeroPaymentSameId(row?.[key]?.[idField], invoiceId));
}

export function xeroPaymentDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const xeroDate = raw.match(/^\/Date\((-?\d+)(?:[+-](?:[01]\d|2[0-3])[0-5]\d)?\)\/$/);
  if (xeroDate) {
    const parsed = new Date(Number(xeroDate[1]));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
  }
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/);
  if (!iso) return null;
  const day = new Date(`${iso[1]}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== iso[1]) return null;
  if (raw.length === 10) return iso[1];
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}
