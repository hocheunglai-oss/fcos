import { aggregateSupplierCalendarDate } from './_xeroAggregateSupplierDates.js';
import { resolveXeroPaymentAssociation } from './_xeroPaymentAssociation.js';
import { issuedSupplierCents as rawCents, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';

export const SETTLED_SUPPLIER_PAYMENT_CONTRACT = 'existing_xero_ledger_payment_v1';
export const SETTLED_SUPPLIER_PAYMENT_LIMITS = Object.freeze({ packetBytes: 1_000_000, jsonNodes: 100_000, depth: 24 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uid = value => typeof value === 'string' && value.length === 36 && UUID.test(value)
  && value !== '00000000-0000-0000-0000-000000000000' ? value.toLowerCase() : null;
const cents = value => typeof value === 'string' && value.trim() !== value ? null : rawCents(value);
const sameId = (a, b) => uid(a) !== null && uid(a) === uid(b);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
  && !/[\u0000-\u001f\u007f]/.test(value);
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

// Validate descriptors before reading values. Serialisation must neither execute
// accessors/toJSON nor erase missing facts, sparse entries or non-JSON values.
function copyJson(value) {
  let nodes = 0;
  const visiting = new Set();
  const walk = (item, depth) => {
    if (++nodes > SETTLED_SUPPLIER_PAYMENT_LIMITS.jsonNodes || depth > SETTLED_SUPPLIER_PAYMENT_LIMITS.depth) throw Error('bound');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) return item;
    if (typeof item !== 'object' || visiting.has(item)
      || Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype)) throw Error('json');
    visiting.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) throw Error('json');
    const array = Array.isArray(item);
    const result = array ? [] : {};
    if (array && keys.length !== item.length + 1) throw Error('sparse');
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable
        || array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) throw Error('json');
      Object.defineProperty(result, key, { value: walk(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    visiting.delete(item);
    return result;
  };
  const copied = walk(value, 0);
  if (!record(copied) || Buffer.byteLength(JSON.stringify(copied)) > SETTLED_SUPPLIER_PAYMENT_LIMITS.packetBytes) throw Error('bound');
  return copied;
}

/** Pure snapshot proof only. No provider call, freshness, cash-remittance or
 * Salesforce Payment match/link/posting claim, eligibility, approval or payload
 * can be established here. NEVER adapt a paid invoice into aggregate v3's
 * authorised_zero_settlement_v1 contract; retain all original provider fields. */
export function evaluateSettledSupplierPaymentProof(input) {
  const contract = SETTLED_SUPPLIER_PAYMENT_CONTRACT;
  const blockers = [];
  const require = (ok, code, path) => { if (!ok && blockers.length < 64) blockers.push({ code, path }); return Boolean(ok); };
  const result = (evidence = null) => freeze({ contract, proofValid: evidence !== null, workflowEligible: false,
    approvalGranted: false, proposedPayload: null, financialWrites: 0, evidence,
    fingerprint: evidence === null ? null : hash(evidence), blockers });
  let original;
  try { original = copyJson(input); } catch { require(false, 'EVIDENCE_JSON_INVALID_OR_BOUND', 'input'); return result(); }
  const checked = (value, path) => {
    if (!require(record(value), 'EVIDENCE_INCOMPLETE', path)) return {};
    for (const key of ['HasErrors', 'HasValidationErrors', 'IsDeleted']) {
      require(!Object.hasOwn(value, key) || value[key] === false, 'EVIDENCE_ERROR_OR_DELETED', `${path}.${key}`);
    }
    require(!Object.hasOwn(value, 'ValidationErrors') || Array.isArray(value.ValidationErrors) && value.ValidationErrors.length === 0,
      'EVIDENCE_ERROR_OR_DELETED', `${path}.ValidationErrors`);
    return value;
  };
  const noRefunds = (value, path) => {
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      require(!['Refunds', 'AmountRefunded'].includes(key), 'REFUND_OUTSIDE_CONTRACT', `${path}.${key}`);
      noRefunds(child, `${path}.${key}`);
    }
  };
  noRefunds(original, 'input');
  const invoice = checked(original.invoice, 'invoice');
  const organisation = checked(original.organisation, 'organisation');
  require(uid(original.tenantId) && sameId(original.tenantId, organisation.OrganisationID), 'TENANT_IDENTITY_UNPROVEN', 'organisation.OrganisationID');
  // Canonical FCOS connections intentionally pin no Xero tenant constant. The
  // caller must supply its independently verified tenant; this checks binding.
  require(organisation.BaseCurrency === 'USD', 'CURRENCY_UNSUPPORTED', 'organisation.BaseCurrency');
  require(uid(invoice.InvoiceID) && uid(invoice.Contact?.ContactID), 'IDENTITY_INVALID', 'invoice');
  checked(invoice.Contact, 'invoice.Contact');
  require(invoice.Status === 'PAID' && invoice.Type === 'ACCPAY', 'SETTLEMENT_UNSUPPORTED', 'invoice.Status/Type');
  require(invoice.CurrencyCode === 'USD' && cents(invoice.CurrencyRate) === 100n, 'CURRENCY_UNSUPPORTED', 'invoice.CurrencyCode/CurrencyRate');
  const total = cents(invoice.Total);
  require(total !== null && total > 0n && cents(invoice.AmountPaid) === total
    && cents(invoice.AmountDue) === 0n && cents(invoice.AmountCredited) === 0n, 'SETTLEMENT_AMOUNT_MISMATCH', 'invoice');
  for (const key of ['CreditNotes', 'Prepayments', 'Overpayments']) {
    require(Array.isArray(invoice[key]) && invoice[key].length === 0, 'SETTLEMENT_COLLECTION_UNPROVEN', `invoice.${key}`);
  }
  require(aggregateSupplierCalendarDate(invoice, 'Date') && aggregateSupplierCalendarDate(invoice, 'DueDate'), 'DATE_INVALID', 'invoice.Date/DueDate');
  if (!require(Array.isArray(invoice.Payments) && invoice.Payments.length === 1, 'PAYMENT_COUNT_INVALID', 'invoice.Payments')
    || !require(Array.isArray(original.payments) && original.payments.length === 1, 'PAYMENT_COUNT_INVALID', 'payments')
    || !require(Array.isArray(original.accounts) && original.accounts.length === 1, 'ACCOUNT_COUNT_INVALID', 'accounts')) return result();
  const summary = checked(invoice.Payments[0], 'invoice.Payments.0');
  const payment = checked(original.payments[0], 'payments.0');
  const account = checked(original.accounts[0], 'accounts.0');
  const nestedAccount = checked(payment.Account, 'payments.0.Account');
  const nestedInvoice = checked(payment.Invoice, 'payments.0.Invoice');
  checked(nestedInvoice.Contact, 'payments.0.Invoice.Contact');
  for (const key of ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments']) if (Object.hasOwn(nestedInvoice, key)) {
    require(Array.isArray(nestedInvoice[key]) && (key === 'Payments' ? nestedInvoice[key].length <= 1 : nestedInvoice[key].length === 0),
      'SETTLEMENT_COLLECTION_UNPROVEN', `payments.0.Invoice.${key}`);
  }
  require(!Object.hasOwn(nestedInvoice, 'Status') || nestedInvoice.Status === 'PAID', 'SETTLEMENT_UNSUPPORTED', 'payments.0.Invoice.Status');
  for (const key of ['Total', 'AmountPaid', 'AmountDue', 'AmountCredited', 'CurrencyRate']) if (Object.hasOwn(nestedInvoice, key)) {
    require(cents(nestedInvoice[key]) !== null && cents(nestedInvoice[key]) === cents(invoice[key]),
      'SETTLEMENT_AMOUNT_MISMATCH', `payments.0.Invoice.${key}`);
  }
  require(sameId(summary.PaymentID, payment.PaymentID), 'PAYMENT_ID_MISMATCH', 'payments.0.PaymentID');
  require(payment.Status === 'AUTHORISED' && payment.PaymentType === 'ACCPAYPAYMENT', 'PAYMENT_STATE_UNSUPPORTED', 'payments.0');
  require(payment.HasAccount === true && uid(nestedAccount.AccountID), 'PAYMENT_ACCOUNT_UNPROVEN', 'payments.0.Account');
  require(cents(payment.Amount) === total && cents(payment.BankAmount) === total && total !== null && total > 0n
    && cents(summary.Amount) === total, 'PAYMENT_AMOUNT_MISMATCH', 'payments.0.Amount/BankAmount');
  require(!Object.hasOwn(summary, 'BankAmount') || cents(summary.BankAmount) === total, 'PAYMENT_AMOUNT_MISMATCH', 'invoice.Payments.0.BankAmount');
  require(cents(payment.CurrencyRate) === 100n, 'CURRENCY_UNSUPPORTED', 'payments.0.CurrencyRate');
  const day = aggregateSupplierCalendarDate(payment, 'Date');
  require(day && aggregateSupplierCalendarDate(summary, 'Date') === day, 'DATE_INVALID_OR_MISMATCH', 'payments.0.Date');
  const accountProjection = (value, path) => {
    const projected = checked(value, path);
    require(sameId(projected.AccountID, account.AccountID), 'ACCOUNT_UNSUPPORTED_OR_MISMATCH', `${path}.AccountID`);
    for (const key of ['Code', 'CurrencyCode', 'Name', 'Type', 'Status']) if (Object.hasOwn(projected, key)) {
      require(projected[key] === account[key], 'ACCOUNT_UNSUPPORTED_OR_MISMATCH', `${path}.${key}`);
    }
  };
  const paymentProjection = (value, path) => {
    const projected = checked(value, path);
    require(sameId(projected.PaymentID, payment.PaymentID) && total !== null && cents(projected.Amount) === total
      && day && aggregateSupplierCalendarDate(projected, 'Date') === day, 'PAYMENT_SUMMARY_MISMATCH', path);
    for (const key of ['CurrencyRate', 'Reference', 'PaymentType', 'Status']) if (Object.hasOwn(projected, key)) {
      require(Object.hasOwn(payment, key) && (key === 'CurrencyRate' ? cents(projected[key]) === 100n : projected[key] === payment[key]),
        'PAYMENT_SUMMARY_MISMATCH', `${path}.${key}`);
    }
    require(!Object.hasOwn(projected, 'CurrencyCode') || projected.CurrencyCode === 'USD', 'CURRENCY_UNSUPPORTED', `${path}.CurrencyCode`);
    require(!Object.hasOwn(projected, 'BankAmount') || cents(projected.BankAmount) === total, 'PAYMENT_AMOUNT_MISMATCH', `${path}.BankAmount`);
    require(!Object.hasOwn(projected, 'HasAccount') || typeof projected.HasAccount === 'boolean', 'PAYMENT_SUMMARY_MISMATCH', `${path}.HasAccount`);
    if (Object.hasOwn(projected, 'Account')) accountProjection(projected.Account, `${path}.Account`);
    for (const key of ['Invoice', 'InvoiceID', 'CreditNote', 'Prepayment', 'Overpayment']) if (Object.hasOwn(projected, key)) {
      // No recursive document/payment association is silently ignored.
      require(key === 'InvoiceID' && sameId(projected[key], invoice.InvoiceID), 'PAYMENT_ASSOCIATION_UNPROVEN', `${path}.${key}`);
    }
  };
  const invoiceProjection = (value, path) => {
    const projected = checked(value, path);
    require(!Object.hasOwn(projected, 'Status') || projected.Status === 'PAID', 'SETTLEMENT_UNSUPPORTED', `${path}.Status`);
    for (const key of ['Total', 'AmountPaid', 'AmountDue', 'AmountCredited', 'CurrencyRate']) if (Object.hasOwn(projected, key)) {
      require(cents(projected[key]) !== null && cents(projected[key]) === cents(invoice[key]), 'SETTLEMENT_AMOUNT_MISMATCH', `${path}.${key}`);
    }
    for (const key of ['Date', 'DueDate']) if (Object.hasOwn(projected, key) || Object.hasOwn(projected, `${key}String`)) {
      require(aggregateSupplierCalendarDate(projected, key) !== null
        && aggregateSupplierCalendarDate(projected, key) === aggregateSupplierCalendarDate(invoice, key), 'DATE_INVALID_OR_MISMATCH', `${path}.${key}`);
    }
    if (Object.hasOwn(projected, 'FullyPaidOnDate') || Object.hasOwn(projected, 'FullyPaidOnDateString')) {
      const fullyPaid = { Date: projected.FullyPaidOnDate };
      if (Object.hasOwn(projected, 'FullyPaidOnDateString')) fullyPaid.DateString = projected.FullyPaidOnDateString;
      require(day && aggregateSupplierCalendarDate(fullyPaid, 'Date') === day, 'DATE_INVALID_OR_MISMATCH', `${path}.FullyPaidOnDate`);
    }
    for (const key of ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments']) if (Object.hasOwn(projected, key)) {
      require(Array.isArray(projected[key]) && (key === 'Payments' ? projected[key].length <= 1 : projected[key].length === 0),
        'SETTLEMENT_COLLECTION_UNPROVEN', `${path}.${key}`);
    }
    if (Array.isArray(projected.Payments) && projected.Payments.length === 1) paymentProjection(projected.Payments[0], `${path}.Payments.0`);
  };
  invoiceProjection(nestedInvoice, 'payments.0.Invoice');
  if (Array.isArray(nestedInvoice.Payments) && nestedInvoice.Payments.length === 1) {
    const nestedSummary = checked(nestedInvoice.Payments[0], 'payments.0.Invoice.Payments.0');
    require(sameId(nestedSummary.PaymentID, payment.PaymentID) && total !== null && cents(nestedSummary.Amount) === total
      && day && aggregateSupplierCalendarDate(nestedSummary, 'Date') === day, 'PAYMENT_SUMMARY_MISMATCH', 'payments.0.Invoice.Payments.0');
    for (const key of ['CurrencyRate', 'Reference', 'PaymentType', 'Status']) if (Object.hasOwn(nestedSummary, key)) {
      require(Object.hasOwn(payment, key) && (key === 'CurrencyRate' ? cents(nestedSummary[key]) === 100n : nestedSummary[key] === payment[key]),
        'PAYMENT_SUMMARY_MISMATCH', `payments.0.Invoice.Payments.0.${key}`);
    }
    for (const key of ['InvoiceID', 'CreditNote', 'Prepayment', 'Overpayment']) if (Object.hasOwn(nestedSummary, key)) {
      require(key === 'InvoiceID' && sameId(nestedSummary[key], invoice.InvoiceID), 'PAYMENT_ASSOCIATION_UNPROVEN', `payments.0.Invoice.Payments.0.${key}`);
    }
  }
  if (Object.hasOwn(invoice, 'FullyPaidOnDate') || Object.hasOwn(invoice, 'FullyPaidOnDateString')) {
    const paidDate = { Date: invoice.FullyPaidOnDate };
    if (Object.hasOwn(invoice, 'FullyPaidOnDateString')) paidDate.DateString = invoice.FullyPaidOnDateString;
    require(day && aggregateSupplierCalendarDate(paidDate, 'Date') === day, 'DATE_INVALID_OR_MISMATCH', 'invoice.FullyPaidOnDate');
  }
  const association = resolveXeroPaymentAssociation(payment);
  require(association.disposition === 'invoice' && association.documentKind === 'invoice'
    && sameId(association.documentId, invoice.InvoiceID) && association.currency === 'USD'
    && sameId(association.contactId, invoice.Contact?.ContactID), 'PAYMENT_ASSOCIATION_UNPROVEN', 'payments.0.Invoice');
  require(sameId(account.AccountID, nestedAccount.AccountID) && account.Status === 'ACTIVE'
    && account.Type === 'BANK' && account.CurrencyCode === 'USD' && text(account.Code) && text(account.Name),
  'ACCOUNT_UNSUPPORTED_OR_MISMATCH', 'accounts.0');
  for (const key of ['Code', 'CurrencyCode', 'Name', 'Type', 'Status']) {
    if (Object.hasOwn(nestedAccount, key)) require(nestedAccount[key] === account[key], 'ACCOUNT_UNSUPPORTED_OR_MISMATCH', `payments.0.Account.${key}`);
  }
  for (const row of [summary, payment]) {
    require(!Object.hasOwn(row, 'CurrencyCode') || row.CurrencyCode === 'USD', 'CURRENCY_UNSUPPORTED', 'payment.CurrencyCode');
    require(!Object.hasOwn(row, 'InvoiceID') || sameId(row.InvoiceID, invoice.InvoiceID), 'PAYMENT_ASSOCIATION_UNPROVEN', 'payment.InvoiceID');
    require(!Object.hasOwn(row, 'Reference') || typeof row.Reference === 'string' && row.Reference.length <= 2000
      && !/[\u0000-\u001f\u007f]/.test(row.Reference), 'PAYMENT_SUMMARY_MISMATCH', 'payment.Reference');
  }
  for (const key of ['CreditNote', 'Prepayment', 'Overpayment']) {
    require(!Object.hasOwn(summary, key), 'PAYMENT_ASSOCIATION_UNPROVEN', `invoice.Payments.0.${key}`);
  }
  if (Object.hasOwn(summary, 'Invoice')) {
    const summaryInvoice = checked(summary.Invoice, 'invoice.Payments.0.Invoice');
    checked(summaryInvoice.Contact, 'invoice.Payments.0.Invoice.Contact');
    require(sameId(summaryInvoice.InvoiceID, invoice.InvoiceID) && summaryInvoice.Type === 'ACCPAY'
      && summaryInvoice.CurrencyCode === 'USD' && sameId(summaryInvoice.Contact?.ContactID, invoice.Contact?.ContactID),
    'PAYMENT_ASSOCIATION_UNPROVEN', 'invoice.Payments.0.Invoice');
    invoiceProjection(summaryInvoice, 'invoice.Payments.0.Invoice');
  }
  for (const key of ['CurrencyRate', 'Reference', 'PaymentType', 'Status']) {
    if (Object.hasOwn(summary, key)) require(Object.hasOwn(payment, key)
      && (key === 'CurrencyRate' ? cents(summary[key]) === 100n : summary[key] === payment[key]), 'PAYMENT_SUMMARY_MISMATCH', `invoice.Payments.0.${key}`);
  }
  require(!Object.hasOwn(summary, 'HasAccount') || typeof summary.HasAccount === 'boolean', 'PAYMENT_SUMMARY_MISMATCH', 'invoice.Payments.0.HasAccount');
  if (Object.hasOwn(summary, 'Account')) {
    const summaryAccount = checked(summary.Account, 'invoice.Payments.0.Account');
    require(sameId(summaryAccount.AccountID, account.AccountID), 'ACCOUNT_UNSUPPORTED_OR_MISMATCH', 'invoice.Payments.0.Account.AccountID');
    for (const key of ['Code', 'CurrencyCode', 'Name', 'Type', 'Status']) if (Object.hasOwn(summaryAccount, key)) {
      require(summaryAccount[key] === account[key], 'ACCOUNT_UNSUPPORTED_OR_MISMATCH', `invoice.Payments.0.Account.${key}`);
    }
  }
  if (blockers.length) return result();
  return result({ contract, originals: original,
    observation: { tenantId: original.tenantId, invoiceId: invoice.InvoiceID, paymentId: payment.PaymentID,
      accountId: account.AccountID, accountCode: account.Code, accountName: account.Name, paymentDate: day, totalCents: total.toString() },
    limits: { freshnessEstablished: false, providerIdentityIndependentlyVerified: false, bankRemittanceProven: false,
      sourcePaymentMatchProven: false, sourcePaymentLinkProven: false, sourcePaymentPostingProven: false,
      workflowEligible: false, approvalGranted: false, financialAuthorityGranted: false } });
}
