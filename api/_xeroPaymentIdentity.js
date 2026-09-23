const PAYABLE_INVOICE_TYPE = 'ACCPAY';
const RECEIVABLE_INVOICE_TYPE = 'ACCREC';

// A durable link identifies a document; it does not replace current accounting
// evidence. Use this check for existing payment links as well as new allocations.
export function paymentDocumentIdentityBlockers(payment, mapping, currentDocument) {
  const blockers = paymentInputBlockers(payment);
  const paymentType = payment?.RecordType?.DeveloperName;
  const expectedType = paymentType === 'Payable' ? PAYABLE_INVOICE_TYPE
    : paymentType === 'Receivable' ? RECEIVABLE_INVOICE_TYPE : null;
  if (!expectedType) blockers.push('Payment type is outside exact Receivable/Payable allocations.');
  if (!mapping) {
    blockers.push('The Salesforce document is not durably linked to Xero. Run the document check again.');
    return blockers;
  }

  if (!hasIdentity(mapping.xero_document_id)) blockers.push('The document mapping has no exact Xero transaction identity. Run the document check again.');
  if (expectedType && mapping.xero_document_type !== expectedType) blockers.push('The mapped Xero transaction type conflicts with the Salesforce payment type.');
  if (paymentType === 'Payable'
    && (!hasIdentity(payment.Supplier_Invoice__c) || mapping.salesforce_object !== 'Supplier_Invoice__c'
      || mapping.salesforce_id !== payment.Supplier_Invoice__c)) {
    blockers.push('Payable payment is not linked to its exact Salesforce Supplier Invoice.');
  }
  if (paymentType === 'Receivable'
    && (!hasIdentity(payment.STEM__c) || mapping.salesforce_object !== 'Invoice__c'
      || !hasIdentity(mapping.salesforce_id) || mapping.retained_differences?.stemId !== payment.STEM__c)) {
    blockers.push('Receivable payment is not linked to its exact Salesforce STEM. Run the document check again.');
  }
  const mappedAccountId = mapping.retained_differences?.accountId;
  if (mappedAccountId && payment?.Account__c !== mappedAccountId) {
    blockers.push('The Salesforce payment Account differs from the linked document Account.');
  }
  if (!hasIdentity(mapping.xero_contact_id)) blockers.push('The document mapping has no verified Xero Contact. Run the document check again.');
  if (!currentDocument) {
    blockers.push('The linked active Xero transaction could not be re-read.');
    return blockers;
  }

  if (!hasIdentity(currentDocument.id) || currentDocument.id !== mapping.xero_document_id) blockers.push('The current Xero transaction does not match the stored document identity.');
  if (expectedType && currentDocument.type !== expectedType) blockers.push('The current Xero transaction type conflicts with the Salesforce payment type.');
  if (!['AUTHORISED', 'PAID'].includes(String(currentDocument.status || '').toUpperCase())) blockers.push('The linked Xero transaction is not authorised for payment.');
  if (!hasIdentity(currentDocument.contactId)) blockers.push('The current Xero transaction has no verified Contact.');
  else if (mapping.xero_contact_id && currentDocument.contactId !== mapping.xero_contact_id) blockers.push('The current Xero Contact differs from the verified document mapping. Run the document check again.');
  const sourceCurrency = paymentCurrency(payment);
  if (sourceCurrency && currentDocument.currency !== sourceCurrency) blockers.push('The linked Xero invoice currency does not match the authoritative Salesforce payment currency.');
  return blockers;
}

// An equal amount on the same day is only a candidate. Bank and reference must
// also agree before choosing between otherwise similar legitimate payments.
export function selectXeroPaymentMatch({ payment, documentMapping, bankAccountId, xeroPayments = [], paymentMappings = [] }) {
  const blockers = paymentInputBlockers(payment);
  const invoiceId = documentMapping?.xero_document_id;
  if (!hasIdentity(invoiceId)) blockers.push('The Salesforce document is not durably linked to Xero. Run the document check again.');
  if (!hasIdentity(bankAccountId)) blockers.push('No approved Xero bank mapping exists for the Salesforce payment.');
  if (blockers.length) return { match: null, blockers };

  const amount = positiveCents(payment.Amount__c);
  const date = paymentDate(payment.Date__c);
  const reference = String(payment.Reference__c || payment.Name || '');
  const similar = xeroPayments.filter((row) => row.Invoice?.InvoiceID === invoiceId
    && positiveCents(row.Amount) === amount
    && paymentDate(row.Date) === date);
  const active = similar.filter((row) => !row.Status || String(row.Status).toUpperCase() === 'AUTHORISED');
  const exact = active.filter((row) => row.Account?.AccountID === bankAccountId
    && String(row.Reference || '') === reference);
  if (exact.length > 1) return { match: null, blockers: ['More than one active Xero payment matches this exact allocation, bank account, and reference.'] };
  if (exact.length === 1) {
    const [match] = exact;
    if (!hasIdentity(match.PaymentID)) return { match: null, blockers: ['The matching Xero payment has no exact PaymentID.'] };
    const otherOwner = paymentMappings.some((row) => row.xero_payment_id === match.PaymentID && row.salesforce_payment_id !== payment.Id);
    if (otherOwner) return { match: null, blockers: ['This Xero payment is already linked to a different Salesforce payment. Resolve the payment identity before linking.'] };
    return { match, blockers: [] };
  }
  if (similar.some((row) => String(row.Status || '').toUpperCase() === 'DELETED')) blockers.push('A deleted Xero payment matches this invoice, amount, and date. Finance must review it before a replacement payment is created.');
  if (active.length) blockers.push('An existing Xero payment matches this invoice, amount, and date but uses a different bank account or reference. Finance must resolve the allocation before another payment is created.');
  if (similar.some((row) => row.Status && !['AUTHORISED', 'DELETED'].includes(String(row.Status).toUpperCase()))) blockers.push('An inactive Xero payment matches this invoice, amount, and date. Finance must review it before another payment is created.');
  if (xeroPayments.some((row) => row.Invoice?.InvoiceID === invoiceId && positiveCents(row.Amount) === amount && !paymentDate(row.Date))) blockers.push('A Xero payment for this invoice and amount has a missing or invalid date. Refresh its evidence before another payment is created.');
  return { match: null, blockers };
}

export function paymentCurrency(payment) {
  const value = payment?.CurrencyIsoCode ?? payment?._currency?.currency;
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
}

const paymentUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
const exactAmount = (actual, expected) => typeof actual === 'number' && typeof expected === 'number'
  && Number.isFinite(actual) && Number.isFinite(expected) && actual > 0 && expected > 0 && Math.abs(actual - expected) < 0.0000001;

export function paymentConfirmationErrors(row, result, expectedPaymentId = null) {
  const errors = []; const proposed = row.proposedPayment || {};
  const type = row.type === 'Payable' ? 'ACCPAY' : row.type === 'Receivable' ? 'ACCREC' : null;
  if (!paymentUuid(result.PaymentID) || (expectedPaymentId && result.PaymentID !== expectedPaymentId)) errors.push('Xero did not confirm the exact payment identity.');
  if (!paymentUuid(result.Invoice?.InvoiceID) || result.Invoice.InvoiceID !== proposed.Invoice?.InvoiceID) errors.push('Xero did not confirm the reviewed invoice identity.');
  if (!paymentUuid(result.Account?.AccountID) || result.Account.AccountID !== proposed.Account?.AccountID) errors.push('Xero did not confirm the reviewed bank account identity.');
  if (!type || result.Invoice?.Type !== type || result.PaymentType !== `${type}PAYMENT`) errors.push('Xero did not confirm the reviewed payment and invoice types.');
  if (result.Status !== 'AUTHORISED') errors.push('Xero did not confirm an authorised payment.');
  if (!exactAmount(result.Amount, proposed.Amount)) errors.push('Xero did not confirm the exact reviewed payment amount.');
  if (!exactAmount(result.BankAmount, proposed.Amount)) errors.push('Xero did not confirm the exact same-currency bank amount.');
  if (!/^[A-Z]{3}$/.test(row.currency || '') || result.Invoice?.CurrencyCode !== row.currency
    || (result.Account?.CurrencyCode !== undefined && result.Account.CurrencyCode !== row.currency)
    || (result.CurrencyRate !== undefined && result.CurrencyRate !== 1)) errors.push('Xero did not confirm the reviewed currency without FX.');
  if (!paymentDate(result.Date) || paymentDate(result.Date) !== paymentDate(proposed.Date)) errors.push('Xero did not confirm the reviewed payment date.');
  if (typeof result.Reference !== 'string' || !proposed.Reference || result.Reference !== proposed.Reference) errors.push('Xero did not confirm the reviewed payment reference.');
  if (result.HasValidationErrors === true || result.HasErrors === true || (result.ValidationErrors !== undefined
    && (!Array.isArray(result.ValidationErrors) || result.ValidationErrors.length))) errors.push('Xero reported payment validation errors. Review the provider outcome before retrying.');
  return errors;
}

export function matchPaymentResponses(rows, responses) {
  const returned = Array.isArray(responses) ? responses.filter((item) => item && typeof item === 'object') : [];
  const matches = rows.map((row) => returned.filter((result) => {
    const proposed = row.proposedPayment || {};
    return result.Invoice?.InvoiceID === proposed.Invoice?.InvoiceID && result.Account?.AccountID === proposed.Account?.AccountID
      && result.Invoice?.CurrencyCode === row.currency && exactAmount(result.Amount, proposed.Amount)
      && paymentDate(result.Date) !== null && paymentDate(result.Date) === paymentDate(proposed.Date) && result.Reference === proposed.Reference;
  }));
  return matches.map((items) => {
    const response = items[0];
    const ambiguous = items.length !== 1 || matches.filter((candidates) => candidates.includes(response)).length !== 1
      || returned.filter((item) => item.PaymentID === response?.PaymentID).length !== 1;
    return ambiguous ? { response: {}, errors: ['Xero did not return a unique payment matching the reviewed invoice, bank, currency, amount, date and reference.'] }
      : { response, errors: [] };
  });
}

export function confirmedPaymentValues(result) {
  return { xero_payment_id: result.PaymentID, xero_bank_account_id: result.Account.AccountID,
    amount: result.Amount, currency: result.Invoice.CurrencyCode, payment_date: paymentDate(result.Date) };
}

function paymentInputBlockers(payment) {
  const blockers = [];
  if (!paymentCurrency(payment)) blockers.push('Authoritative Salesforce payment currency is missing or invalid.');
  if (!hasIdentity(payment?.Id)) blockers.push('The exact Salesforce payment identity is missing.');
  if (positiveCents(payment?.Amount__c) === null) blockers.push('Payment amount must be positive and finite. Refunds require Finance allocation.');
  if (!paymentDate(payment?.Date__c)) blockers.push('Payment date is missing or invalid.');
  if (!String(payment?.Reference__c || payment?.Name || '').trim()) blockers.push('The Salesforce payment reference is missing.');
  return blockers;
}

function positiveCents(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const amount = Number(value);
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function hasIdentity(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function paymentDate(value) {
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
