import { createHash } from 'node:crypto';
import { usdFromHkd } from './_companyFxRates.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(\d+)(?:\.(\d{1,2}))?$/;
const SIGNED_MONEY = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const CURRENCIES = new Set(['USD', 'HKD']);

function reject(message, code = 'XERO_PREPAYMENT_INVALID') {
  throw Object.assign(new Error(message), { code, status: 409 });
}

function text(value, label) {
  const result = String(value || '').trim();
  if (!result) reject(`${label} is required.`);
  return result;
}

function textOrNull(value) {
  const result = value == null ? '' : String(value).trim();
  return result || null;
}

function uuid(value, label) {
  const result = text(value, label);
  if (!UUID.test(result)) reject(`${label} must be a UUID.`, 'XERO_PREPAYMENT_ID_INVALID');
  return result;
}

function currency(value, label) {
  const result = String(value || '').trim().toUpperCase();
  if (!CURRENCIES.has(result)) reject(`${label} must be USD or HKD.`, 'XERO_PREPAYMENT_CURRENCY_INVALID');
  return result;
}

function dateOnly(value, label) {
  const result = String(value || '').trim();
  if (!ISO_DATE.test(result) || new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) {
    reject(`${label} must be a valid ISO calendar date.`, 'XERO_PREPAYMENT_DATE_INVALID');
  }
  return result;
}

function isoDate(value, label) {
  const result = String(value || '').trim();
  if (!result || !Number.isFinite(Date.parse(result))) reject(`${label} must be an ISO timestamp.`, 'XERO_PREPAYMENT_RATE_SNAPSHOT_INVALID');
  return new Date(result).toISOString();
}

function minorUnits(value, label, { positive = true } = {}) {
  if (typeof value === 'boolean' || value == null || value === '') reject(`${label} is required.`, 'XERO_PREPAYMENT_AMOUNT_INVALID');
  const source = String(value).trim();
  const match = source.match(MONEY);
  if (!match) reject(`${label} must have no more than two decimal places.`, 'XERO_PREPAYMENT_AMOUNT_INVALID');
  const units = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (positive && units <= 0n) reject(`${label} must be positive.`, 'XERO_PREPAYMENT_AMOUNT_INVALID');
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) reject(`${label} is outside the supported exact range.`, 'XERO_PREPAYMENT_AMOUNT_INVALID');
  return units;
}

function amount(value, label) {
  return Number(minorUnits(value, label)) / 100;
}

function signedMinorUnits(value, label) {
  if (typeof value === 'boolean' || value == null || value === '') reject(`${label} is required.`, 'XERO_PREPAYMENT_AMOUNT_INVALID');
  const match = String(value).trim().match(SIGNED_MONEY);
  if (!match) reject(`${label} must have no more than two decimal places.`, 'XERO_PREPAYMENT_AMOUNT_INVALID');
  const magnitude = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) reject(`${label} is outside the supported exact range.`, 'XERO_PREPAYMENT_AMOUNT_INVALID');
  return match[1] ? -magnitude : magnitude;
}

function nonnegativeAmount(value, label) {
  return Number(minorUnits(value, label, { positive: false })) / 100;
}

function equalMoney(left, right) {
  try { return minorUnits(left, 'Amount', { positive: false }) === minorUnits(right, 'Amount', { positive: false }); }
  catch { return false; }
}

function exactInverse(left, right) {
  try { return signedMinorUnits(left, 'Amount') === -signedMinorUnits(right, 'Amount'); }
  catch { return false; }
}

function subtractMoney(left, right) {
  return Number(minorUnits(left, 'Amount', { positive: false }) - minorUnits(right, 'Amount', { positive: false })) / 100;
}

function addMoney(left, right) {
  return Number(minorUnits(left, 'Amount', { positive: false }) + minorUnits(right, 'Amount', { positive: false })) / 100;
}

function positiveRate(value) {
  if (value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 100) {
    reject('A positive USD/HKD company rate no greater than 100 is required.', 'XERO_PREPAYMENT_RATE_SNAPSHOT_INVALID');
  }
  const source = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(source)) reject('The USD/HKD company rate must have no more than six decimal places.', 'XERO_PREPAYMENT_RATE_SNAPSHOT_INVALID');
  return Number(value);
}

function snapshotFor(event, eventCurrency) {
  if (eventCurrency === 'USD') {
    if ([event.FX_Rate__c, event.FX_Revision__c, event.FX_Effective_At__c].some(value => value != null && value !== '')) {
      reject('USD cash events must not contain HKD company-rate evidence.', 'XERO_PREPAYMENT_RATE_SNAPSHOT_INVALID');
    }
    return { rate: null, revision: null, effectiveAt: null };
  }
  const paymentDate = dateOnly(event.Payment_Date__c, 'Cash event payment date');
  const effectiveAt = isoDate(event.FX_Effective_At__c, 'Company-rate effective time');
  if (Date.parse(effectiveAt) > Date.parse(`${paymentDate}T23:59:59.999+08:00`)) {
    reject('The company rate was not effective on the cash-event date.', 'XERO_PREPAYMENT_RATE_SNAPSHOT_INVALID');
  }
  return {
    rate: positiveRate(event.FX_Rate__c),
    revision: text(event.FX_Revision__c, 'Company-rate revision'),
    effectiveAt,
  };
}

function cashAmounts(event, eventCurrency, snapshot) {
  const bankNative = amount(event.Bank_Native_Amount__c, 'Bank native amount');
  const cashUsd = nonnegativeAmount(event.Cash_USD_Amount__c, 'Cash USD amount');
  if (eventCurrency === 'USD') {
    if (!equalMoney(bankNative, cashUsd) || (event.Cash_HKD_Amount__c != null && event.Cash_HKD_Amount__c !== '')) {
      reject('USD bank cash must equal cash USD and must not contain an HKD amount.', 'XERO_PREPAYMENT_ACCOUNTING_USD_MISMATCH');
    }
    return { nativeAmount: bankNative, cashUsd, cashHkd: null };
  }
  const cashHkd = amount(event.Cash_HKD_Amount__c, 'Cash HKD amount');
  if (!equalMoney(bankNative, cashHkd) || !equalMoney(cashUsd, usdFromHkd(cashHkd, snapshot.rate))) {
    reject('HKD bank cash does not match exact company USD conversion.', 'XERO_PREPAYMENT_ACCOUNTING_USD_MISMATCH');
  }
  return { nativeAmount: bankNative, cashUsd, cashHkd };
}

function requireUsdOrganisation(organisation) {
  if (currency(organisation?.BaseCurrency, 'Xero organisation base currency') !== 'USD') {
    reject('This prepayment contract requires a verified USD-base Xero organisation.', 'XERO_PREPAYMENT_BASE_CURRENCY_INVALID');
  }
  return uuid(organisation.OrganisationID, 'Xero organisation ID');
}

function requireBankAccount(bankAccount, expectedCurrency) {
  const accountCurrency = currency(bankAccount?.CurrencyCode, 'Xero bank-account currency');
  if (bankAccount?.Type !== 'BANK' || bankAccount?.Status !== 'ACTIVE' || accountCurrency !== expectedCurrency) {
    reject('An active Xero bank account in the exact cash currency is required.', 'XERO_PREPAYMENT_BANK_ACCOUNT_INVALID');
  }
  return { id: uuid(bankAccount.AccountID, 'Xero bank-account ID'), currency: accountCurrency };
}

function requireFinancePostingConfig(depositAccount, zeroTaxRate) {
  const id = uuid(depositAccount?.AccountID, 'Finance deposit-account ID');
  const code = text(depositAccount?.Code, 'Finance deposit-account code');
  if (depositAccount?.Status !== 'ACTIVE' || !depositAccount?.Type || depositAccount?.Type === 'BANK') {
    reject('Finance must configure an active non-bank deposit posting account.', 'XERO_PREPAYMENT_POSTING_CONFIG_INVALID');
  }
  const taxType = text(zeroTaxRate?.TaxType, 'Finance zero-tax type');
  if (zeroTaxRate?.Status !== 'ACTIVE' || Number(zeroTaxRate?.EffectiveRate) !== 0) {
    reject('Finance must configure an active zero-rate tax type.', 'XERO_PREPAYMENT_POSTING_CONFIG_INVALID');
  }
  return { id, code, taxType };
}

function requestIdentity(record, action) {
  const operationId = uuid(record?.Operation_Id__c, `${action} operation ID`);
  const requestFingerprint = text(record?.Request_Fingerprint__c, `${action} request fingerprint`).toLowerCase();
  if (!SHA256.test(requestFingerprint)) reject(`${action} request fingerprint must be SHA-256.`, 'XERO_PREPAYMENT_FINGERPRINT_INVALID');
  return {
    operationId,
    requestFingerprint,
    idempotencyKey: xeroPrepaymentIdempotencyKey({ action, operationId, requestFingerprint }),
  };
}

function normalizeCashEvent({ cashEvent, agreedCurrency, organisation, bankAccount, expectedKind }) {
  const organisationId = requireUsdOrganisation(organisation);
  if (!cashEvent || cashEvent.Kind__c !== expectedKind || !['Buy', 'Sell'].includes(cashEvent.Direction__c)) {
    reject(`A ${expectedKind} Trade_Cash_Event__c with Buy or Sell direction is required.`);
  }
  const eventCurrency = currency(cashEvent.Currency__c, 'Cash-event currency');
  const agreed = currency(agreedCurrency, 'Agreed trade currency');
  const bankCurrency = currency(cashEvent.Bank_Currency__c, 'Cash-event bank currency');
  if (eventCurrency !== agreed || bankCurrency !== eventCurrency) {
    reject('Cash-event, agreed-trade and bank currencies must match exactly.', 'XERO_PREPAYMENT_CURRENCY_MISMATCH');
  }
  const bank = requireBankAccount(bankAccount, eventCurrency);
  const snapshot = snapshotFor(cashEvent, eventCurrency);
  const amounts = cashAmounts(cashEvent, eventCurrency, snapshot);
  return {
    eventId: text(cashEvent.Id, 'Cash-event ID'),
    organisationId,
    kind: expectedKind,
    direction: cashEvent.Direction__c,
    currency: eventCurrency,
    partyId: text(cashEvent.Party__c, 'Cash-event party'),
    date: dateOnly(cashEvent.Payment_Date__c, 'Cash-event payment date'),
    reference: text(cashEvent.Reference__c || cashEvent.Name || cashEvent.Id, 'Cash-event reference'),
    bank,
    snapshot,
    ...amounts,
  };
}

function requireContact(contact, partyId) {
  if (text(contact?.SalesforceAccountID, 'Mapped Salesforce party') !== partyId) {
    reject('The Xero contact mapping does not match the cash-event party.', 'XERO_PREPAYMENT_CONTACT_MISMATCH');
  }
  return uuid(contact.ContactID, 'Xero contact ID');
}

function prepaymentType(direction) {
  return direction === 'Sell' ? 'RECEIVE-PREPAYMENT' : 'SPEND-PREPAYMENT';
}

function expectedPaymentType(direction) {
  return direction === 'Sell' ? 'ARPREPAYMENTPAYMENT' : 'APPREPAYMENTPAYMENT';
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function xeroPrepaymentEvidenceFingerprint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
    reject('Prepayment evidence is required.', 'XERO_PREPAYMENT_EVIDENCE_INVALID');
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function xeroPrepaymentIdempotencyKey({ action, operationId, requestFingerprint }) {
  const verb = text(action, 'Prepayment action').toLowerCase();
  if (!/^[a-z]{3,10}$/.test(verb)) reject('Prepayment action is invalid.', 'XERO_PREPAYMENT_IDEMPOTENCY_INVALID');
  const operation = uuid(operationId, 'Prepayment operation ID');
  const fingerprint = String(requestFingerprint || '').trim().toLowerCase();
  if (!SHA256.test(fingerprint)) reject('Prepayment request fingerprint must be SHA-256.', 'XERO_PREPAYMENT_IDEMPOTENCY_INVALID');
  const key = `fcos-prepayment:${verb}:${operation}:${fingerprint}`;
  if (key.length > 128) reject('Prepayment idempotency key exceeds Xero limits.', 'XERO_PREPAYMENT_IDEMPOTENCY_INVALID');
  return key;
}

export function buildXeroPrepaymentCreate({
  cashEvent, agreedCurrency, organisation, bankAccount, contact, depositAccount, zeroTaxRate,
}) {
  const event = normalizeCashEvent({ cashEvent, agreedCurrency, organisation, bankAccount, expectedKind: 'Payment' });
  const contactId = requireContact(contact, event.partyId);
  const posting = requireFinancePostingConfig(depositAccount, zeroTaxRate);
  const identity = requestIdentity(cashEvent, 'create');
  const description = `${event.reference} [FCOS cash ${event.eventId}; ${identity.operationId}]`;
  const bankReference = `FCOS-${identity.operationId}`;
  const transaction = {
    Type: prepaymentType(event.direction),
    Contact: { ContactID: contactId },
    Date: event.date,
    BankAccount: { AccountID: event.bank.id },
    Reference: bankReference,
    CurrencyCode: event.currency,
    LineAmountTypes: 'NoTax',
    LineItems: [{
      Description: description,
      Quantity: 1,
      UnitAmount: event.nativeAmount,
      AccountCode: posting.code,
      TaxType: posting.taxType,
    }],
    IsReconciled: false,
    ...(event.currency === 'HKD' ? { CurrencyRate: event.snapshot.rate } : {}),
  };
  return {
    action: 'create', method: 'PUT', path: '/BankTransactions',
    headers: { 'Idempotency-Key': identity.idempotencyKey },
    payload: { BankTransactions: [transaction] },
    evidence: { ...event, description, bankReference, contactId, depositAccountId: posting.id, depositAccountCode: posting.code,
      taxType: posting.taxType, ...identity },
  };
}

function requirePrepayment(prepayment, evidence) {
  if (!prepayment || prepayment.Type !== prepaymentType(evidence.direction)
      || !['AUTHORISED', 'PAID'].includes(prepayment.Status)
      || currency(prepayment.CurrencyCode, 'Xero prepayment currency') !== evidence.currency
      || prepayment.Contact?.ContactID !== evidence.contactId
      || !equalMoney(prepayment.Total, evidence.nativeAmount)
      || !rateMatches(prepayment.CurrencyRate, evidence.snapshot.rate, evidence.currency)) {
    reject('The exact active Xero prepayment does not match the cash event.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  return uuid(prepayment.PrepaymentID, 'Xero prepayment ID');
}

function one(items, label) {
  if (!Array.isArray(items) || items.length !== 1) reject(`Exactly one ${label} is required.`, 'XERO_PREPAYMENT_RESPONSE_AMBIGUOUS');
  return items[0];
}

function rateMatches(actual, expected, currencyCode) {
  return currencyCode === 'USD' ? actual == null || Number(actual) === 1 : Number(actual) === Number(expected);
}

export function validateXeroPrepaymentCreateResult(proposal, { bankTransactionsResponse, prepayment }) {
  if (proposal?.action !== 'create') reject('A create proposal is required.');
  const expected = proposal.evidence;
  const transaction = one(bankTransactionsResponse?.BankTransactions, 'created bank transaction');
  const line = one(transaction.LineItems, 'created bank-transaction line');
  const prepaymentId = uuid(transaction.PrepaymentID, 'Returned prepayment ID');
  const bankTransactionId = uuid(transaction.BankTransactionID, 'Returned bank-transaction ID');
  if (transaction.Type !== prepaymentType(expected.direction) || transaction.Status !== 'AUTHORISED'
      || transaction.Contact?.ContactID !== expected.contactId || transaction.BankAccount?.AccountID !== expected.bank.id
      || dateValue(transaction.Date) !== expected.date || transaction.CurrencyCode !== expected.currency
      || !rateMatches(transaction.CurrencyRate, expected.snapshot.rate, expected.currency)
      || !equalMoney(transaction.Total, expected.nativeAmount) || !equalMoney(line.LineAmount, expected.nativeAmount)
      || (expected.bankReference != null && transaction.Reference !== expected.bankReference)
      || line.Description !== expected.description || line.AccountCode !== expected.depositAccountCode || line.TaxType !== expected.taxType
      || transaction.IsReconciled !== false || transaction.BankAmount != null) {
    reject('Created Xero bank transaction differs from immutable cash evidence.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  if (prepaymentId !== requirePrepayment(prepayment, expected)
      || prepayment.Status !== 'AUTHORISED' || !equalMoney(prepayment.Total, expected.nativeAmount)
      || !equalMoney(prepayment.RemainingCredit, expected.nativeAmount)
      || !rateMatches(prepayment.CurrencyRate, expected.snapshot.rate, expected.currency)
      || (prepayment.Allocations || []).length || (prepayment.Payments || []).length) {
    reject('Created Xero prepayment does not reconcile to the bank transaction.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  return { bankTransactionId, prepaymentId, status: 'created', idempotencyKey: expected.idempotencyKey };
}

function dateValue(value) {
  const date = xeroPaymentDate(value);
  if (!date) reject('Xero returned an invalid date.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  return date;
}

function allocationNative(allocation, event) {
  const value = event.currency === 'HKD' ? allocation.Allocated_HKD__c : allocation.Allocated_Cash_USD__c;
  const native = amount(value, 'Allocation native amount');
  if (!equalMoney(allocation.Bank_Native_Allocation__c, native)) {
    reject('Allocation bank-native amount must equal the same-currency allocation.', 'XERO_PREPAYMENT_ALLOCATION_MISMATCH');
  }
  // The caller reconciles the complete immutable Salesforce cash ledger first.
  // Each application consumes original cash carrying, including its final cent remainder.
  const cashUsd = nonnegativeAmount(allocation.Allocated_Cash_USD__c, 'Allocated cash USD');
  if (minorUnits(cashUsd, 'Allocated cash USD', { positive: false }) > minorUnits(event.cashUsd, 'Original cash USD', { positive: false })
      || event.currency === 'USD' && !equalMoney(cashUsd, native))
    reject('Allocation cash USD exceeds or differs from its original cash basis.', 'XERO_PREPAYMENT_ACCOUNTING_USD_MISMATCH');
  return { native, cashUsd };
}

function requireFinalInvoice(invoice, { direction, currency: expectedCurrency, contactId }) {
  if (!invoice || invoice.Proforma === true || invoice.IsProforma === true || invoice.DocumentType === 'Proforma'
      || invoice.CreditNoteID || invoice.Type !== (direction === 'Sell' ? 'ACCREC' : 'ACCPAY')
      || invoice.Status !== 'AUTHORISED' || currency(invoice.CurrencyCode, 'Final invoice currency') !== expectedCurrency
      || invoice.Contact?.ContactID !== contactId) {
    reject('Allocation requires the exact AUTHORISED final invoice, currency and contact.', 'XERO_PREPAYMENT_INVOICE_INVALID');
  }
  if (expectedCurrency === 'HKD') positiveRate(invoice.CurrencyRate);
  else if (!rateMatches(invoice.CurrencyRate, null, 'USD')) {
    reject('USD final invoice must use the USD organisation base rate.', 'XERO_PREPAYMENT_INVOICE_INVALID');
  }
  return uuid(invoice.InvoiceID, 'Final Xero invoice ID');
}

function requireFinalDocument(document, invoiceMapping, event, salesforceInvoiceId, xeroInvoiceId) {
  const objectName = event.direction === 'Sell' ? 'Invoice__c' : 'Supplier_Invoice__c';
  const documentParty = event.direction === 'Sell' ? document?.STEM__r?.Account__c : document?.Supplier__c;
  if (!document || document.Id !== salesforceInvoiceId || document.Proforma__c !== false
      || document.Original_Invoice__c || document.Original_Supplier_Invoice__c
      || currency(document.Document_Currency__c, 'Final Salesforce document currency') !== event.currency
      || documentParty !== event.partyId
      || invoiceMapping?.salesforce_id?.slice(0, 15) !== salesforceInvoiceId.slice(0, 15) || invoiceMapping?.salesforce_object !== objectName
      || invoiceMapping?.xero_document_id !== xeroInvoiceId) {
    reject('Allocation requires an exact mapped, positive final Salesforce document.', 'XERO_PREPAYMENT_INVOICE_INVALID');
  }
}

function snapshotCollections(prepayment, invoice) {
  return {
    prepaymentAllocations: structuredClone(prepayment.Allocations || []),
    prepaymentPayments: structuredClone(prepayment.Payments || []),
    invoicePrepayments: structuredClone(invoice.Prepayments || []),
    invoicePayments: structuredClone(invoice.Payments || []),
  };
}

export function buildXeroPrepaymentAllocation({
  allocation, cashEvent, agreedCurrency, organisation, bankAccount, contact, prepayment, document, invoiceMapping, invoice,
}) {
  if (allocation?.Kind__c !== 'Applied' || allocation.Cash_Event__c !== cashEvent?.Id
      || allocation.Reverses_Allocation__c || allocation.Buyer_Invoice__c && allocation.Supplier_Invoice__c) {
    reject('An Applied allocation must reference one cash event and one final document.');
  }
  const event = normalizeCashEvent({ cashEvent, agreedCurrency, organisation, bankAccount, expectedKind: 'Payment' });
  event.contactId = requireContact(contact, event.partyId);
  const prepaymentId = requirePrepayment(prepayment, event);
  if (allocation.Currency__c !== event.currency) reject('Allocation currency differs from the cash event.', 'XERO_PREPAYMENT_CURRENCY_MISMATCH');
  const expectedSfInvoice = event.direction === 'Sell' ? allocation.Buyer_Invoice__c : allocation.Supplier_Invoice__c;
  if (!expectedSfInvoice || (event.direction === 'Sell' ? allocation.Supplier_Invoice__c : allocation.Buyer_Invoice__c)) {
    reject('Allocation direction does not identify exactly one final Salesforce invoice.');
  }
  const invoiceId = requireFinalInvoice(invoice, event);
  requireFinalDocument(document, invoiceMapping, event, expectedSfInvoice, invoiceId);
  const amounts = allocationNative(allocation, event);
  if (minorUnits(amounts.native, 'Allocation amount') > minorUnits(prepayment.RemainingCredit, 'Prepayment remaining credit')
      || minorUnits(amounts.native, 'Allocation amount') > minorUnits(invoice.AmountDue, 'Invoice amount due')) {
    reject('Allocation exceeds prepayment credit or invoice amount due.', 'XERO_PREPAYMENT_ALLOCATION_EXCEEDS_BALANCE');
  }
  const identity = requestIdentity(allocation, 'allocation');
  const allocationDate = [dateValue(prepayment.Date), dateValue(invoice.Date)].sort().at(-1);
  return {
    action: 'allocation', method: 'PUT', path: `/Prepayments/${prepaymentId}/Allocations`,
    headers: { 'Idempotency-Key': identity.idempotencyKey },
    payload: { Allocations: [{ Amount: amounts.native, Invoice: { InvoiceID: invoiceId }, Date: allocationDate }] },
    evidence: { ...event, ...amounts, allocationId: text(allocation.Id, 'Allocation ID'), salesforceInvoiceId: expectedSfInvoice,
      prepaymentId, invoiceId, allocationDate, before: {
        prepayment: { Total: amount(prepayment.Total, 'Prepayment total'), RemainingCredit: amount(prepayment.RemainingCredit, 'Prepayment remaining credit'), Status: prepayment.Status },
        invoice: { Total: amount(invoice.Total, 'Invoice total'), AmountDue: amount(invoice.AmountDue, 'Invoice amount due'),
          AmountCredited: nonnegativeAmount(invoice.AmountCredited ?? 0, 'Invoice amount credited'),
          AmountPaid: nonnegativeAmount(invoice.AmountPaid ?? 0, 'Invoice amount paid'), Status: invoice.Status,
          CurrencyRate: invoice.CurrencyRate ?? null },
        collections: snapshotCollections(prepayment, invoice),
      }, ...identity },
  };
}

function collectionFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value || []))).digest('hex');
}

function allocationIdentity(row) {
  return `${row.AllocationID || ''}|${row.Invoice?.InvoiceID || ''}|${Number(row.Amount)}`;
}

function prepaymentApplied(invoice, prepaymentId) {
  return (invoice.Prepayments || []).filter(row => row.PrepaymentID === prepaymentId)
    .reduce((total, row) => addMoney(total, row.AppliedAmount ?? row.Amount ?? 0), 0);
}

function otherPrepayments(rows, prepaymentId) {
  return (rows || []).filter(row => row.PrepaymentID !== prepaymentId);
}

function expectedStatus(balance) { return equalMoney(balance, 0) ? 'PAID' : 'AUTHORISED'; }

export function validateXeroPrepaymentAllocationResult(proposal, { allocationsResponse, prepayment, invoice }) {
  if (proposal?.action !== 'allocation') reject('An allocation proposal is required.');
  const evidence = proposal.evidence;
  requirePrepayment(prepayment, evidence);
  requireFinalInvoice({ ...invoice, Status: invoice.Status === 'PAID' ? 'AUTHORISED' : invoice.Status }, evidence);
  const responseAllocation = one(allocationsResponse?.Allocations, 'created prepayment allocation');
  const allocationId = uuid(responseAllocation.AllocationID, 'Returned allocation ID');
  if (responseAllocation.Invoice?.InvoiceID !== evidence.invoiceId || !equalMoney(responseAllocation.Amount, evidence.native)
      || dateValue(responseAllocation.Date) !== evidence.allocationDate) {
    reject('Xero allocation response differs from the approved request.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  const beforeAllocations = evidence.before.collections.prepaymentAllocations;
  const afterAllocations = prepayment.Allocations || [];
  const additions = afterAllocations.filter(row => !beforeAllocations.some(before => before.AllocationID === row.AllocationID));
  if (additions.length !== 1 || additions[0].AllocationID !== allocationId
      || allocationIdentity(additions[0]) !== allocationIdentity(responseAllocation)
      || beforeAllocations.some(before => !afterAllocations.some(after => allocationIdentity(after) === allocationIdentity(before)))) {
    reject('Xero allocation collection contains unknown, changed or missing entries.', 'XERO_PREPAYMENT_ALLOCATION_UNKNOWN');
  }
  const expectedRemaining = subtractMoney(evidence.before.prepayment.RemainingCredit, evidence.native);
  const expectedDue = subtractMoney(evidence.before.invoice.AmountDue, evidence.native);
  const expectedCredited = addMoney(evidence.before.invoice.AmountCredited, evidence.native);
  if (!equalMoney(prepayment.RemainingCredit, expectedRemaining) || prepayment.Status !== expectedStatus(expectedRemaining)
      || !equalMoney(invoice.AmountDue, expectedDue) || !equalMoney(invoice.AmountCredited, expectedCredited)
      || !equalMoney(prepayment.Total, evidence.before.prepayment.Total)
      || (evidence.currency === 'HKD' && Number(invoice.CurrencyRate) !== Number(evidence.before.invoice.CurrencyRate))
      || invoice.Status !== expectedStatus(expectedDue) || !equalMoney(invoice.AmountPaid ?? 0, evidence.before.invoice.AmountPaid)
      || collectionFingerprint(prepayment.Payments || []) !== collectionFingerprint(evidence.before.collections.prepaymentPayments)
      || collectionFingerprint(invoice.Payments || []) !== collectionFingerprint(evidence.before.collections.invoicePayments)
      || collectionFingerprint(otherPrepayments(invoice.Prepayments, evidence.prepaymentId))
        !== collectionFingerprint(otherPrepayments(evidence.before.collections.invoicePrepayments, evidence.prepaymentId))
      || !equalMoney(subtractMoney(prepaymentApplied(invoice, evidence.prepaymentId),
        evidence.before.collections.invoicePrepayments.filter(row => row.PrepaymentID === evidence.prepaymentId)
          .reduce((total, row) => addMoney(total, row.AppliedAmount ?? row.Amount ?? 0), 0)), evidence.native)) {
    reject('Xero invoice/prepayment balances or payment collections drifted after allocation.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  return { allocationId, status: 'applied', allocationDate: evidence.allocationDate };
}

export function buildXeroPrepaymentRefund({
  refundEvent, originalEvent, agreedCurrency, organisation, bankAccount, contact, prepayment,
}) {
  if (refundEvent?.Original_Cash_Event__c !== originalEvent?.Id) reject('Refund must identify its exact original cash event.');
  const original = normalizeCashEvent({ cashEvent: originalEvent, agreedCurrency, organisation, bankAccount, expectedKind: 'Payment' });
  original.contactId = requireContact(contact, original.partyId);
  const refund = normalizeCashEvent({ cashEvent: refundEvent, agreedCurrency, organisation, bankAccount, expectedKind: 'Refund' });
  refund.contactId = requireContact(contact, refund.partyId);
  if (refund.direction !== original.direction || refund.currency !== original.currency || refund.partyId !== original.partyId) {
    reject('Refund direction, currency and party must match the original cash event.', 'XERO_PREPAYMENT_REFUND_MISMATCH');
  }
  const prepaymentId = requirePrepayment(prepayment, original);
  if (minorUnits(refund.nativeAmount, 'Refund amount') > minorUnits(prepayment.RemainingCredit, 'Prepayment remaining credit')) {
    reject('Refund exceeds remaining prepayment credit.', 'XERO_PREPAYMENT_REFUND_EXCEEDS_BALANCE');
  }
  const identity = requestIdentity(refundEvent, 'refund');
  const payment = {
    Prepayment: { PrepaymentID: prepaymentId }, Account: { AccountID: refund.bank.id },
    Date: refund.date, Amount: refund.nativeAmount, Reference: refund.reference,
    ...(refund.currency === 'HKD' ? { CurrencyRate: refund.snapshot.rate } : {}),
  };
  return {
    action: 'refund', method: 'PUT', path: '/Payments', headers: { 'Idempotency-Key': identity.idempotencyKey },
    payload: { Payments: [payment] },
    evidence: { ...refund, contactId: refund.contactId, prepaymentId, prepaymentEvidence: original,
      expectedPaymentType: expectedPaymentType(refund.direction),
      originalEventId: original.eventId, before: { RemainingCredit: amount(prepayment.RemainingCredit, 'Prepayment remaining credit'),
        Total: amount(prepayment.Total, 'Prepayment total'),
        Status: prepayment.Status, Allocations: structuredClone(prepayment.Allocations || []), Payments: structuredClone(prepayment.Payments || []) }, ...identity },
  };
}

export function validateXeroPrepaymentRefundResult(proposal, { paymentsResponse, prepayment }) {
  if (proposal?.action !== 'refund') reject('A refund proposal is required.');
  const evidence = proposal.evidence;
  const payment = one(paymentsResponse?.Payments, 'created prepayment refund');
  const paymentId = uuid(payment.PaymentID, 'Returned refund payment ID');
  if (payment.PaymentType !== evidence.expectedPaymentType || payment.Status !== 'AUTHORISED'
      || payment.Prepayment?.PrepaymentID !== evidence.prepaymentId || payment.Account?.AccountID !== evidence.bank.id
      || dateValue(payment.Date) !== evidence.date || !equalMoney(payment.Amount, evidence.nativeAmount)
      || !equalMoney(payment.BankAmount, evidence.nativeAmount) || payment.BankAmount == null
      || !rateMatches(payment.CurrencyRate, evidence.snapshot.rate, evidence.currency)) {
    reject('Xero refund differs from immutable refund evidence.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  requirePrepayment(prepayment, evidence.prepaymentEvidence);
  const expectedRemaining = subtractMoney(evidence.before.RemainingCredit, evidence.nativeAmount);
  const afterPayments = prepayment.Payments || [];
  const additions = afterPayments.filter(row => !evidence.before.Payments.some(before => before.PaymentID === row.PaymentID));
  if (!equalMoney(prepayment.RemainingCredit, expectedRemaining) || prepayment.Status !== expectedStatus(expectedRemaining)
      || !equalMoney(prepayment.Total, evidence.before.Total)
      || additions.length !== 1 || additions[0].PaymentID !== paymentId
      || !equalMoney(additions[0].Amount, evidence.nativeAmount)
      || afterPayments.length !== evidence.before.Payments.length + 1
      || collectionFingerprint(afterPayments.filter(row => row.PaymentID !== paymentId))
        !== collectionFingerprint(evidence.before.Payments)
      || collectionFingerprint(prepayment.Allocations || []) !== collectionFingerprint(evidence.before.Allocations)) {
    reject('Xero prepayment balance or collections drifted after refund.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  return { paymentId, status: 'refunded', bankAmount: amount(payment.BankAmount, 'Returned bank amount') };
}

export function buildXeroPrepaymentAllocationReversal({ reversal, originalAllocation, prepayment, invoice }) {
  if (reversal?.Kind__c !== 'Reversal' || reversal.Reverses_Allocation__c !== originalAllocation?.Id
      || reversal.Cash_Event__c !== originalAllocation?.Cash_Event__c) {
    reject('Reversal must identify the exact original allocation and cash event.');
  }
  const prepaymentId = uuid(originalAllocation.Xero_Prepayment_Id__c, 'Original Xero prepayment ID');
  const allocationId = uuid(originalAllocation.Xero_Allocation_Id__c, 'Original Xero allocation ID');
  if (prepayment?.PrepaymentID !== prepaymentId || prepayment.Status === 'VOIDED') reject('The exact active prepayment is required.');
  const originalCurrency = currency(originalAllocation.Currency__c, 'Original allocation currency');
  if (currency(reversal.Currency__c, 'Reversal currency') !== originalCurrency) reject('Reversal currency differs from original allocation.');
  const originalNative = originalCurrency === 'HKD' ? originalAllocation.Allocated_HKD__c : originalAllocation.Allocated_Cash_USD__c;
  const reversalNative = originalCurrency === 'HKD' ? reversal.Allocated_HKD__c : reversal.Allocated_Cash_USD__c;
  const native = amount(originalNative, 'Original allocation native amount');
  if (!exactInverse(reversalNative, originalNative)
      || !exactInverse(reversal.Bank_Native_Allocation__c, originalAllocation.Bank_Native_Allocation__c)
      || !exactInverse(reversal.Allocated_Cash_USD__c, originalAllocation.Allocated_Cash_USD__c)) {
    reject('Reversal amounts must exactly invert the original allocation.', 'XERO_PREPAYMENT_REVERSAL_MISMATCH');
  }
  const invoiceId = uuid(originalAllocation.Xero_Invoice_Id__c, 'Original Xero invoice ID');
  const buyerInvoice = textOrNull(originalAllocation.Buyer_Invoice__c);
  const supplierInvoice = textOrNull(originalAllocation.Supplier_Invoice__c);
  if (Boolean(buyerInvoice) === Boolean(supplierInvoice)) reject('Original allocation must identify exactly one final Salesforce invoice.');
  const direction = buyerInvoice ? 'Sell' : 'Buy';
  if (invoice?.InvoiceID !== invoiceId || invoice.CreditNoteID || invoice.Proforma === true || invoice.IsProforma === true
      || invoice.DocumentType === 'Proforma' || invoice.Type !== (direction === 'Sell' ? 'ACCREC' : 'ACCPAY')
      || !['AUTHORISED', 'PAID'].includes(invoice.Status)
      || currency(invoice.CurrencyCode, 'Final invoice currency') !== originalCurrency
      || currency(prepayment.CurrencyCode, 'Xero prepayment currency') !== originalCurrency
      || prepayment.Type !== prepaymentType(direction)
      || invoice.Contact?.ContactID !== prepayment.Contact?.ContactID
      || originalCurrency === 'HKD' && (!Number.isFinite(Number(invoice.CurrencyRate)) || Number(invoice.CurrencyRate) <= 0)
      || originalCurrency === 'USD' && !rateMatches(invoice.CurrencyRate, null, 'USD')) {
    reject('The exact final Xero invoice is required for allocation reversal.', 'XERO_PREPAYMENT_INVOICE_INVALID');
  }
  const identity = requestIdentity(reversal, 'reversal');
  const matching = (prepayment.Allocations || []).filter(row => row.AllocationID === allocationId
    && row.Invoice?.InvoiceID === invoiceId && equalMoney(row.Amount, native));
  if (matching.length !== 1) reject('The exact live Xero allocation is unavailable for reversal.', 'XERO_PREPAYMENT_ALLOCATION_UNKNOWN');
  return {
    action: 'reversal', method: 'DELETE', path: `/Prepayments/${prepaymentId}/Allocations/${allocationId}`,
    headers: {}, payload: null,
    localIdempotencyKey: identity.idempotencyKey,
    evidence: { prepaymentId, allocationId, invoiceId, currency: originalCurrency, native,
      before: {
        prepayment: { RemainingCredit: nonnegativeAmount(prepayment.RemainingCredit, 'Prepayment remaining credit'),
          Status: prepayment.Status },
        invoice: { AmountDue: nonnegativeAmount(invoice.AmountDue, 'Invoice amount due'),
          AmountCredited: nonnegativeAmount(invoice.AmountCredited ?? 0, 'Invoice amount credited'),
          AmountPaid: nonnegativeAmount(invoice.AmountPaid ?? 0, 'Invoice amount paid'), Status: invoice.Status },
        collections: snapshotCollections(prepayment, invoice),
      }, ...identity },
  };
}

export function validateXeroPrepaymentAllocationReversalResult(proposal, { deleteResponse, prepayment, invoice }) {
  if (proposal?.action !== 'reversal') reject('A reversal proposal is required.');
  const evidence = proposal.evidence;
  if (deleteResponse?.AllocationID !== evidence.allocationId || deleteResponse?.IsDeleted !== true
      || deleteResponse?.Invoice?.InvoiceID !== evidence.invoiceId) {
    reject('Xero did not acknowledge deletion of the exact allocation.', 'XERO_PREPAYMENT_REVERSAL_UNKNOWN');
  }
  return validateXeroPrepaymentAllocationReversalReadback(proposal, { prepayment, invoice });
}

export function validateXeroPrepaymentAllocationReversalReadback(proposal, { prepayment, invoice }) {
  if (proposal?.action !== 'reversal') reject('A reversal proposal is required.');
  const evidence = proposal.evidence;
  if (prepayment?.PrepaymentID !== evidence.prepaymentId
      || !Array.isArray(prepayment.Allocations) || prepayment.Allocations.some(row => row.AllocationID === evidence.allocationId)) {
    reject('Xero readback did not establish deletion of the exact allocation.', 'XERO_PREPAYMENT_REVERSAL_UNKNOWN');
  }
  const afterAllocations = prepayment.Allocations || [];
  const beforeAllocations = evidence.before.collections.prepaymentAllocations;
  const unknownOrChanged = afterAllocations.some(after => !beforeAllocations.some(before =>
    before.AllocationID !== evidence.allocationId && allocationIdentity(before) === allocationIdentity(after)));
  const missingUnchanged = beforeAllocations.some(before => before.AllocationID !== evidence.allocationId
    && !afterAllocations.some(after => allocationIdentity(after) === allocationIdentity(before)));
  const expectedRemaining = addMoney(evidence.before.prepayment.RemainingCredit, evidence.native);
  const expectedDue = addMoney(evidence.before.invoice.AmountDue, evidence.native);
  const expectedCredited = subtractMoney(evidence.before.invoice.AmountCredited, evidence.native);
  if (invoice.InvoiceID !== evidence.invoiceId || !equalMoney(prepayment.RemainingCredit, expectedRemaining)
      || prepayment.Status !== expectedStatus(expectedRemaining) || !equalMoney(invoice.AmountDue, expectedDue)
      || !equalMoney(invoice.AmountCredited, expectedCredited)
      || !equalMoney(invoice.AmountPaid ?? 0, evidence.before.invoice.AmountPaid)
      || invoice.Status !== expectedStatus(expectedDue) || unknownOrChanged || missingUnchanged
      || collectionFingerprint(prepayment.Payments || []) !== collectionFingerprint(evidence.before.collections.prepaymentPayments)
      || collectionFingerprint(invoice.Payments || []) !== collectionFingerprint(evidence.before.collections.invoicePayments)
      || collectionFingerprint(otherPrepayments(invoice.Prepayments, evidence.prepaymentId))
        !== collectionFingerprint(otherPrepayments(evidence.before.collections.invoicePrepayments, evidence.prepaymentId))
      || !equalMoney(subtractMoney(evidence.before.collections.invoicePrepayments
        .filter(row => row.PrepaymentID === evidence.prepaymentId)
        .reduce((total, row) => addMoney(total, row.AppliedAmount ?? row.Amount ?? 0), 0),
      prepaymentApplied(invoice, evidence.prepaymentId)), evidence.native)) {
    reject('Xero balances drifted after allocation reversal.', 'XERO_PREPAYMENT_READBACK_DRIFT');
  }
  return { allocationId: evidence.allocationId, status: 'reversed', localIdempotencyKey: proposal.localIdempotencyKey };
}

export function reconcileXeroPrepaymentInvoice({
  prepayment, invoice, expectedAllocations = [], expectedRefunds = [], expectedInvoicePrepayments, expectedInvoicePayments = [], expectedInvoiceCredits = [], expectedInvoiceOverpayments = [],
}) {
  const liveAllocations = prepayment?.Allocations || [];
  const liveRefunds = prepayment?.Payments || [];
  if (liveAllocations.length !== expectedAllocations.length || liveRefunds.length !== expectedRefunds.length) {
    reject('Xero has unknown or missing prepayment allocations/refunds.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  }
  for (const expected of expectedAllocations) {
    if (!liveAllocations.some(row => row.AllocationID === expected.allocationId && row.Invoice?.InvoiceID === expected.invoiceId
      && equalMoney(row.Amount, expected.amount))) reject('An expected Xero allocation is missing or changed.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  }
  for (const expected of expectedRefunds) {
    if (!liveRefunds.some(row => row.PaymentID === expected.paymentId && equalMoney(row.Amount, expected.amount))) {
      reject('An expected Xero refund is missing or changed.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
    }
  }
  const allocated = liveAllocations.reduce((total, row) => addMoney(total, row.Amount), 0);
  const refunded = liveRefunds.reduce((total, row) => addMoney(total, row.Amount), 0);
  if (!equalMoney(subtractMoney(subtractMoney(prepayment.Total, allocated), refunded), prepayment.RemainingCredit)) {
    reject('Xero prepayment total does not reconcile to allocations, refunds and remaining credit.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  }
  const invoicePrepayment = prepaymentApplied(invoice, prepayment.PrepaymentID);
  const invoiceAllocation = liveAllocations.filter(row => row.Invoice?.InvoiceID === invoice.InvoiceID)
    .reduce((total, row) => addMoney(total, row.Amount), 0);
  if (!equalMoney(invoicePrepayment, invoiceAllocation)) {
    reject('Invoice.Prepayments does not reconcile to Prepayment.Allocations.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  }
  const expectedPrepayments = expectedInvoicePrepayments
    || (equalMoney(invoiceAllocation, 0) ? [] : [{ prepaymentId: prepayment.PrepaymentID, amount: invoiceAllocation }]);
  const liveInvoicePrepayments = invoice.Prepayments || [];
  if (liveInvoicePrepayments.length !== expectedPrepayments.length
      || expectedPrepayments.some(expected => !liveInvoicePrepayments.some(row => row.PrepaymentID === expected.prepaymentId
        && equalMoney(row.AppliedAmount ?? row.Amount, expected.amount)))) {
    reject('Invoice contains unknown credited documents or mismatched prepayments.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  }
  const invoicePayments = invoice.Payments || [];
  if (expectedInvoicePayments && (invoicePayments.length !== expectedInvoicePayments.length
      || expectedInvoicePayments.some(expected => !invoicePayments.some(row => row.PaymentID === expected.paymentId
        && equalMoney(row.Amount, expected.amount))))) {
    reject('Invoice contains unknown or mismatched payments.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  }
  let otherCredits = 0;
  for (const [rows, expected, identity, expectedIdentity] of [
    [invoice.CreditNotes || [], expectedInvoiceCredits, 'CreditNoteID', 'creditNoteId'],
    [invoice.Overpayments || [], expectedInvoiceOverpayments, 'OverpaymentID', 'overpaymentId'],
  ]) {
    if (rows.length !== expected.length || new Set(rows.map(row => row[identity])).size !== rows.length
        || new Set(expected.map(row => row[expectedIdentity])).size !== expected.length
        || expected.some(item => !rows.some(row => row[identity] === item[expectedIdentity] && equalMoney(row.AppliedAmount ?? row.Amount, item.amount))))
      reject('Invoice contains unknown or mismatched credits/overpayments.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
    otherCredits = rows.reduce((total, row) => addMoney(total, row.AppliedAmount ?? row.Amount), otherCredits);
  }
  const credited = liveInvoicePrepayments.reduce((total, row) => addMoney(total, row.AppliedAmount ?? row.Amount), otherCredits);
  const paid = invoicePayments.reduce((total, row) => addMoney(total, row.Amount), 0);
  if (!equalMoney(invoice.AmountCredited ?? 0, credited) || !equalMoney(invoice.AmountPaid ?? 0, paid)) {
    reject('Invoice AmountCredited or AmountPaid does not reconcile to its separate collections.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  }
  if (!equalMoney(invoice.AmountDue, subtractMoney(subtractMoney(invoice.Total, credited), paid)))
    reject('Invoice outstanding balance differs from payments and applied credits.', 'XERO_PREPAYMENT_RECONCILIATION_DRIFT');
  return { allocated, refunded, remainingCredit: nonnegativeAmount(prepayment.RemainingCredit, 'Remaining credit'),
    invoicePrepayment, amountPaid: nonnegativeAmount(invoice.AmountPaid ?? 0, 'Invoice amount paid'),
    amountCredited: nonnegativeAmount(invoice.AmountCredited ?? 0, 'Invoice amount credited') };
}
