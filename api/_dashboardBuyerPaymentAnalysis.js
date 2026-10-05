const DAY_MS = 86_400_000;
const MONEY_TOLERANCE = 0.01;
const MINIMUM_INVOICES = 3;
const RELIABLE_FROM = '2026-01-01';
const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const INVALID_STATUS = /void|cancel|revers|reject/i;

function idKey(value) {
  const id = String(value ?? '').trim();
  return SALESFORCE_ID.test(id) ? id.slice(0, 15) : null;
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function hongKongCreationDate(value) {
  // CreatedDate is an audit timestamp, never an invoice accounting date.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (!calendarDate(value.slice(0, 10))) return null;
  const clock = value.slice(11, 19).split(':').map(Number);
  if (clock[0] > 23 || clock[1] > 59 || clock[2] > 59) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return calendarDate(`${fields.year}-${fields.month}-${fields.day}`);
}

function dayDifference(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function money(value) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function currency(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function sameMoney(left, right) {
  // One cent is the declared financial reconciliation tolerance. The epsilon
  // allowance only absorbs binary floating-point representation of that cent.
  return Math.abs(left - right) <= MONEY_TOLERANCE + Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function increment(exclusions, reason) {
  exclusions[reason] = (exclusions[reason] || 0) + 1;
}

function signature(row, fields) {
  return JSON.stringify(fields.map((field) => {
    const value = field.split('.').reduce((current, part) => current?.[part], row);
    return /^(?:Id|STEM__c|Account__c|Supplier_Invoice__c|Commission_Invoice__c)$/.test(field)
      ? idKey(value) || value || null : value ?? null;
  }));
}

function uniqueRecords(rows, fields, exclusions, affectedStems, kind) {
  const byId = new Map();
  for (const row of rows) {
    const key = idKey(row?.Id);
    if (!key) {
      increment(exclusions, `invalid_${kind}_identity`);
      const stemKey = idKey(kind === 'stem' ? row?.Id : row?.STEM__c);
      if (stemKey) affectedStems.add(stemKey);
      continue;
    }
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, row);
      continue;
    }
    if (signature(existing, fields) === signature(row, fields)) {
      increment(exclusions, 'duplicate_records');
      continue;
    }
    increment(exclusions, `conflicting_${kind}_records`);
    for (const candidate of [existing, row]) {
      const stemKey = idKey(kind === 'stem' ? candidate.Id : candidate.STEM__c);
      if (stemKey) affectedStems.add(stemKey);
    }
  }
  return [...byId.values()];
}

function groupByStem(rows, knownStems, exclusions, kind) {
  const grouped = new Map();
  for (const row of rows) {
    const key = idKey(row.STEM__c);
    if (!key || !knownStems.has(key)) {
      increment(exclusions, `unlinked_${kind}_records`);
      continue;
    }
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function reliableStem(stem) {
  if (stem.Delivery_Date__c != null && stem.Delivery_Date__c !== '') {
    const date = calendarDate(stem.Delivery_Date__c);
    return Boolean(date && date >= RELIABLE_FROM);
  }
  if (stem.Expected_Delivery_Date__c != null && stem.Expected_Delivery_Date__c !== '') {
    const date = calendarDate(stem.Expected_Delivery_Date__c);
    return Boolean(date && date >= RELIABLE_FROM);
  }
  const created = hongKongCreationDate(stem.CreatedDate);
  return Boolean(created && created >= RELIABLE_FROM);
}

function creditNote(invoice) {
  return /-CN-/i.test(String(invoice.Name || ''))
    || ['Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c'].some((field) => invoice[field] === true)
    || (money(invoice.Amount__c) != null && money(invoice.Amount__c) < 0);
}

function receiptEvidence(rows, accountKey, invoiceCurrency, today) {
  const accepted = [];
  for (const payment of rows) {
    const developerType = String(payment.RecordType?.DeveloperName || '').trim();
    const type = developerType || String(payment.RecordType?.Name || '').trim();
    // Remittances, adjustments, supplier payments and unclassified records are not receipts.
    if (type !== 'Receivable' || payment.Supplier_Invoice__c) continue;
    const amount = money(payment.Amount__c);
    if (amount != null && amount < 0) return { reason: 'negative_buyer_receipt' };
    if ([payment.Status__c, payment.Payment_Status__c].some((status) => INVALID_STATUS.test(String(status || '')))) {
      return { reason: 'invalid_buyer_payment_status' };
    }
    if (payment.Is_Deposit__c === true || payment.Is_Volume_Discount__c === true || payment.Commission_Invoice__c) continue;
    if (payment.Is_Deposit__c !== false || payment.Is_Volume_Discount__c !== false
      || payment.Commission_Invoice__c !== null) {
      return { reason: 'missing_payment_classification' };
    }
    if (idKey(payment.Account__c) !== accountKey) return { reason: 'buyer_identity_mismatch' };
    const paymentCurrency = currency(payment.CurrencyIsoCode);
    if (!paymentCurrency) return { reason: 'missing_currency' };
    if (paymentCurrency !== invoiceCurrency) return { reason: 'currency_mismatch' };
    if (amount == null) return { reason: 'invalid_payment_amount' };
    if (amount === 0) continue;
    const date = calendarDate(payment.Date__c);
    if (!date) return { reason: 'missing_or_invalid_payment_date' };
    if (date > today) return { reason: 'future_payment_date' };
    accepted.push({ id: idKey(payment.Id), date, amount });
  }
  accepted.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  return { accepted };
}

/**
 * Deterministic, read-only invoice settlement analysis. Rates are fractions in [0, 1].
 * Input must include every current invoice and every payment for the selected STEMs.
 * It describes historical payment timing, without claiming invoicing caused payment.
 */
export function buildDashboardBuyerPaymentAnalysis({
  stems = [], invoices = [], payments = [], today, complete = true, minCreationLeadDays = 7,
} = {}) {
  if (!Number.isInteger(minCreationLeadDays) || minCreationLeadDays < 1 || minCreationLeadDays > 3650) {
    throw new TypeError('minCreationLeadDays must be a positive whole number of calendar days.');
  }
  const exclusions = {};
  const methodology = {
    creationDateField: 'Invoice__c.CreatedDate',
    creationDateTimezone: 'Asia/Hong_Kong',
    dueDateField: 'Invoice__c.Invoice_Due_Date__c',
    receiptDateField: 'Payment__c.Date__c',
    comparisonResolution: 'calendar_day',
    minCreationLeadDays,
    minimumInvoiceCount: MINIMUM_INVOICES,
    usuallyThreshold: 'strictly_more_than_half',
    earlyPaymentDefinition: 'full_settlement_strictly_before_invoice_due_date',
    settlementDefinition: 'cumulative_positive_receivable_payments_reconciled_to_invoice_and_STEM_balance',
    denominator: 'eligible_invoices_settled_by_today_or_due_on_or_before_today',
    futureDueUnpaidTreatment: 'excluded_as_censored',
    preCreationSettlementTreatment: 'excluded_as_prepaid',
    medianDaysPaidBeforeDueBasis: 'fully_settled_eligible_invoices_positive_early_zero_on_due_negative_late',
    reliableFrom: RELIABLE_FROM,
    moneyTolerance: MONEY_TOLERANCE,
    rateUnit: 'fraction',
    exclusionsUnit: 'excluded_STEM_invoice_candidates_except_explicit_record_identity_duplicate_or_unlinked_counts',
    causalClaim: false,
    limitation: 'Observed settlement timing after early invoice creation does not establish a causal effect.',
  };
  const result = { kind: 'buyer_payment_timing', buyers: [], exclusions, methodology, complete: complete === true };
  if (complete !== true) {
    increment(exclusions, 'incomplete_evidence');
    return result;
  }
  if (!calendarDate(today)) {
    increment(exclusions, 'invalid_analysis_date');
    result.complete = false;
    return result;
  }
  const conflicted = new Set();
  const uniqueStems = uniqueRecords(stems, [
    'Account__c', 'CurrencyIsoCode', 'CreatedDate', 'Delivery_Date__c', 'Expected_Delivery_Date__c',
    'QLIK_Receivable_Balance__c', 'Total_Invoice_Amount__c', 'Status__c',
  ], exclusions, conflicted, 'stem');
  const uniqueInvoices = uniqueRecords(invoices, [
    'STEM__c', 'Name', 'CurrencyIsoCode', 'CreatedDate', 'Amount__c', 'Invoice_Due_Date__c',
    'Proforma__c', 'Deprecated__c', 'Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c',
  ], exclusions, conflicted, 'invoice');
  const uniquePayments = uniqueRecords(payments, [
    'STEM__c', 'Account__c', 'CurrencyIsoCode', 'Amount__c', 'Date__c', 'RecordType.DeveloperName',
    'RecordType.Name', 'Status__c', 'Payment_Status__c', 'Supplier_Invoice__c',
    'Is_Deposit__c', 'Is_Volume_Discount__c', 'Commission_Invoice__c',
  ], exclusions, conflicted, 'payment');
  const knownStems = new Set(uniqueStems.map((stem) => idKey(stem.Id)));
  const invoicesByStem = groupByStem(uniqueInvoices, knownStems, exclusions, 'invoice');
  const paymentsByStem = groupByStem(uniquePayments, knownStems, exclusions, 'payment');
  const byBuyer = new Map();

  for (const stem of uniqueStems.sort((left, right) => idKey(left.Id).localeCompare(idKey(right.Id)))) {
    const stemKey = idKey(stem.Id);
    const reject = (reason) => increment(exclusions, reason);
    if (conflicted.has(stemKey)) { reject('conflicting_source_evidence'); continue; }
    if (/cancel/i.test(String(stem.Status__c || ''))) { reject('cancelled_STEM'); continue; }
    if (!reliableStem(stem)) { reject('unreliable_payment_history'); continue; }
    const accountKey = idKey(stem.Account__c);
    if (!accountKey) { reject('missing_buyer_identity'); continue; }
    const documents = (invoicesByStem.get(stemKey) || [])
      .filter((invoice) => invoice.Proforma__c !== true && invoice.Deprecated__c !== true);
    if (documents.some((invoice) => invoice.Proforma__c !== false || invoice.Deprecated__c !== false)) {
      reject('missing_invoice_classification'); continue;
    }
    if (documents.some(creditNote)) { reject('credit_note_or_adjustment'); continue; }
    if (documents.length !== 1) { reject(documents.length ? 'multiple_active_invoices' : 'no_active_invoice'); continue; }
    const invoice = documents[0];
    const gross = money(invoice.Amount__c);
    if (!(gross > 0)) { reject('invalid_invoice_amount'); continue; }
    const stemCurrency = currency(stem.CurrencyIsoCode);
    const invoiceCurrency = currency(invoice.CurrencyIsoCode);
    if (!stemCurrency || !invoiceCurrency) { reject('missing_currency'); continue; }
    if (stemCurrency !== invoiceCurrency) { reject('currency_mismatch'); continue; }
    const created = hongKongCreationDate(invoice.CreatedDate);
    const due = calendarDate(invoice.Invoice_Due_Date__c);
    if (!created || !due) { reject('missing_or_invalid_invoice_dates'); continue; }
    if (created > today) { reject('future_invoice_creation'); continue; }
    const leadDays = dayDifference(created, due);
    if (leadDays < minCreationLeadDays) { reject('shorter_creation_lead'); continue; }
    const stemGross = money(stem.Total_Invoice_Amount__c);
    const balance = money(stem.QLIK_Receivable_Balance__c);
    if (stemGross == null || balance == null) { reject('missing_reconciliation_amounts'); continue; }
    if (!sameMoney(stemGross, gross)) { reject('invoice_total_mismatch'); continue; }
    const receipts = receiptEvidence(paymentsByStem.get(stemKey) || [], accountKey, invoiceCurrency, today);
    if (receipts.reason) { reject(receipts.reason); continue; }
    let cumulative = 0;
    let settlementDate = null;
    for (const receipt of receipts.accepted) {
      cumulative += receipt.amount;
      if (!settlementDate && (cumulative >= gross || sameMoney(cumulative, gross))) settlementDate = receipt.date;
    }
    // A zero current balance alone cannot prove cash settlement: it may reflect
    // a credit note or write off. Every counted amount must reconcile to receipts.
    if (!sameMoney(balance, gross - cumulative)) { reject('receivable_balance_mismatch'); continue; }
    if (settlementDate && settlementDate < created) { reject('prepaid_invoices'); continue; }
    if (!settlementDate && due > today) { reject('future_due_unpaid_censored'); continue; }
    const buyerKey = `${accountKey}:${invoiceCurrency}`;
    if (!byBuyer.has(buyerKey)) {
      byBuyer.set(buyerKey, {
        accountId: stem.Account__c,
        name: stem.Account__r?.Name || stem.Buyer_Name__c || stem.Account__c,
        currency: invoiceCurrency,
        samples: [],
      });
    }
    byBuyer.get(buyerKey).samples.push({
      leadDays,
      early: Boolean(settlementDate && settlementDate < due),
      daysPaidBeforeDue: settlementDate ? dayDifference(settlementDate, due) : null,
    });
  }
  result.buyers = [...byBuyer.values()].map(({ samples, ...buyer }) => {
    const invoiceCount = samples.length;
    const earlyPaidCount = samples.filter((sample) => sample.early).length;
    const sampleSufficient = invoiceCount >= MINIMUM_INVOICES;
    return {
      ...buyer,
      invoiceCount,
      earlyPaidCount,
      earlyPaymentRate: earlyPaidCount / invoiceCount,
      medianCreationLeadDays: median(samples.map((sample) => sample.leadDays)),
      medianDaysPaidBeforeDue: median(samples.map((sample) => sample.daysPaidBeforeDue).filter((days) => days != null)),
      sampleSufficient,
      sampleStatus: sampleSufficient ? 'sufficient' : 'insufficient',
      usuallyPaysEarly: sampleSufficient && earlyPaidCount / invoiceCount > 0.5,
    };
  }).sort((left, right) => Number(right.usuallyPaysEarly) - Number(left.usuallyPaysEarly)
    || right.earlyPaymentRate - left.earlyPaymentRate || right.invoiceCount - left.invoiceCount
    || String(left.name).localeCompare(String(right.name)) || left.accountId.localeCompare(right.accountId)
    || left.currency.localeCompare(right.currency));
  return result;
}
