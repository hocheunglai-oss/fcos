// Remittance headers describe bank movements; invoice allocations are the cash
// evidence used for account balances and performance. Never count both.
const token = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const idKey = (value) => String(value || '').slice(0, 15);

export function paymentRecordTypeToken(payment) {
  return token([payment?.RecordTypeId, payment?.RecordType?.DeveloperName, payment?.RecordType?.Name].filter(Boolean).join(' '));
}

export function isPaymentRemittance(payment, fields = []) {
  return paymentRecordTypeToken(payment).includes('remittance') || [...new Set(fields)].some((field) => /receivableremittance|remittancereceivable|payableremittance|remittancepayable/.test(token(payment?.[field])));
}

export function isBuyerPaymentAllocation(payment, {
  statusFields = [], supplierInvoiceFields = ['Supplier_Invoice__c'],
  amountField = 'Amount__c', buyerAccountId, requireRecordType = false,
} = {}) {
  if (!payment?.STEM__c || isPaymentRemittance(payment)) return false;
  if (statusFields.some((field) => /void|cancel|revers|reject/i.test(String(payment[field] || '')))) return false;
  if (supplierInvoiceFields.some((field) => payment[field])) return false;
  const type = token(payment.RecordType?.DeveloperName || payment.RecordType?.Name);
  if (type && !['receivable', 'buyerpayment', 'receivablepayment'].includes(type)) return false;
  if (requireRecordType && !type) return false;
  if (buyerAccountId !== undefined && (!buyerAccountId || idKey(payment.Account__c) !== idKey(buyerAccountId))) return false;
  return Number.isFinite(Number(payment[amountField])) && Number(payment[amountField]) > 0;
}
