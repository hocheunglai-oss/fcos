import { hkCompanyFxMidnight, roundedDecimalAmount, usdFromHkd } from './_companyFxRates.js';
import { sfQuery, sfRequest } from './_salesforce.js';
import { loadTradeCashLedger, validateTradeCashLedger } from './_tradeCashLedger.js';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const OPERATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REQUEST_FINGERPRINT = /^[a-f0-9]{64}$/i;
const STEM_BATCH_SIZE = 100;
const MONEY = /^-?\d+(?:\.\d{1,2})?$/;
const PAYMENT_TYPES = ['Receivable', 'Bank_Charge', 'Write_Off'];
const INVOICE_NATIVE_FIELDS = [
  'Original_Invoice__c', 'Reissue_Of_Invoice__c', 'Final_Of_Proforma__c',
  'Document_FX_Fingerprint__c', 'Document_FX_Side__c', 'Document_Currency__c',
  'Document_HKD_Amount__c', 'Document_FX_Rate__c', 'Document_FX_Revision__c', 'Document_FX_Confirmed_At__c',
];
const PAYMENT_NATIVE_FIELDS = [
  'Bank_Currency__c', 'Bank_Native_Amount__c', 'Bank_FX_Evidence__c', 'Buyer_Invoice__c', 'Cash_Event__c',
  'Payment_Operation_Id__c', 'Payment_Request_Fingerprint__c', 'Payment_Currency__c', 'Payment_HKD_Amount__c',
  'Payment_FX_Rate__c', 'Payment_FX_Revision__c', 'Payment_FX_Effective_At__c', 'Invoice_Carrying_USD__c',
  'Settlement_FX_USD__c',
];
const INVOICE_FIELDS = [
  'Id', 'Name', 'STEM__c', 'STEM__r.Account__c', 'File__c', 'Amount__c', 'Invoice_Date__c',
  'Invoice_Due_Date__c', 'LastModifiedDate', 'Deprecated__c', 'Proforma__c', ...INVOICE_NATIVE_FIELDS,
];
const PAYMENT_FIELDS = [
  'Id', 'STEM__c', 'Account__c', 'Bank__c', 'Supplier_Invoice__c', 'Amount__c', 'Date__c', 'CreatedDate',
  'LastModifiedDate', 'RecordType.DeveloperName', ...PAYMENT_NATIVE_FIELDS,
];
const SOURCE_OBJECTS = [
  { name: 'Invoice__c', nativeFields: INVOICE_NATIVE_FIELDS, fields: INVOICE_FIELDS },
  { name: 'Payment__c', nativeFields: PAYMENT_NATIVE_FIELDS, fields: PAYMENT_FIELDS },
];
const SCHEMA_ERROR = 'Salesforce native reminder schema could not be verified. Refresh before sending reminders.';
const EVIDENCE_ERROR = 'Salesforce invoice and payment evidence is incomplete or unavailable. Refresh before sending reminders.';

function unavailable(message) {
  return Object.assign(new Error(message), { status: 503, statusCode: 503 });
}

function complete(result) {
  return !result?.error && Array.isArray(result?.records)
    && Number.isSafeInteger(result.totalSize) && result.totalSize === result.records.length
    && result.done !== false && !result.nextRecordsUrl;
}

function fieldNames(names) {
  if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !name)
    || new Set(names).size !== names.length || !names.includes('Id') || !names.includes('STEM__c')) {
    throw unavailable(SCHEMA_ERROR);
  }
  return new Set(names);
}

async function hasNativeReminderSchema(request) {
  try {
    const describe = await Promise.all(SOURCE_OBJECTS.map(async ({ name }) => {
      const result = await request(`/sobjects/${name}/describe/`, { readOnly: true });
      if (result?.name !== name || result.queryable !== true) throw unavailable(SCHEMA_ERROR);
      return fieldNames(result.fields?.map(field => field?.name));
    }));
    if (SOURCE_OBJECTS.every(({ fields }, index) => fields.every(field => field.includes('.') || describe[index].has(field)))) return true;
    if (SOURCE_OBJECTS.some(({ nativeFields }, index) => nativeFields.some(field => describe[index].has(field)))) {
      throw unavailable(SCHEMA_ERROR);
    }

    // A describe respects field permissions. Confirm absence in the org catalog
    // before allowing the pre-bootstrap USD path.
    const catalog = await Promise.all(SOURCE_OBJECTS.map(async ({ name }) => {
      const soql = `SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${name}'`;
      const result = await request(`/tooling/query/?q=${encodeURIComponent(soql)}`, { readOnly: true });
      if (!complete(result) || result.done !== true) throw unavailable(SCHEMA_ERROR);
      return fieldNames(result.records.map(field => field?.QualifiedApiName));
    }));
    if (SOURCE_OBJECTS.some(({ nativeFields }, index) => nativeFields.some(field => catalog[index].has(field)))) {
      throw unavailable(SCHEMA_ERROR);
    }
    return false;
  } catch {
    throw unavailable(SCHEMA_ERROR);
  }
}

function stemKey(id) {
  return typeof id === 'string' ? id.slice(0, 15) : '';
}

function validId(id) {
  return typeof id === 'string' && SALESFORCE_ID.test(id);
}

function validateScopedRecords(result, fields, stems, seen, recordInScope) {
  if (!complete(result)) throw unavailable(EVIDENCE_ERROR);
  const topLevelFields = fields.filter(field => !field.includes('.'));
  for (const record of result.records) {
    if (!validId(record?.Id) || !validId(record.STEM__c) || !stems.has(stemKey(record.STEM__c)) || seen.has(stemKey(record.Id))
      || !topLevelFields.every(field => Object.hasOwn(record, field)) || !recordInScope(record)) {
      throw unavailable(EVIDENCE_ERROR);
    }
    seen.add(stemKey(record.Id));
  }
  return result.records;
}

export async function loadPaymentReminderCurrencies(rows, { query = sfQuery, request = sfRequest } = {}) {
  if (!rows.length) return rows;
  if (rows.some(row => !validId(row.stemId))) throw new Error('A valid STEM identity is required for native reminder review.');
  const ids = [...new Map(rows.map(row => [stemKey(row.stemId), row.stemId])).values()];
  if (!await hasNativeReminderSchema(request)) return rows;

  const invoices = [];
  const payments = [];
  const invoiceIds = new Set();
  const paymentIds = new Set();
  try {
    for (let offset = 0; offset < ids.length; offset += STEM_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + STEM_BATCH_SIZE);
      const stems = new Set(batch.map(stemKey));
      const scope = batch.map(id => `'${id}'`).join(',');
      const [invoiceResult, paymentResult] = await Promise.all([
        query(`SELECT ${INVOICE_FIELDS.join(',')} FROM Invoice__c
          WHERE STEM__c IN (${scope}) AND Deprecated__c=false AND Proforma__c=false`, { clean: true, limit: 100000 }),
        query(`SELECT ${PAYMENT_FIELDS.join(',')} FROM Payment__c
          WHERE STEM__c IN (${scope}) AND RecordType.DeveloperName IN (${PAYMENT_TYPES.map(type => `'${type}'`).join(',')})`, { clean: true, limit: 100000 }),
      ]);
      invoices.push(...validateScopedRecords(invoiceResult, INVOICE_FIELDS, stems, invoiceIds,
        invoice => invoice.Deprecated__c === false && invoice.Proforma__c === false
          && Object.hasOwn(invoice.STEM__r ?? {}, 'Account__c')
          && (invoice.STEM__r.Account__c === null || validId(invoice.STEM__r.Account__c))));
      payments.push(...validateScopedRecords(paymentResult, PAYMENT_FIELDS, stems, paymentIds,
        payment => PAYMENT_TYPES.includes(payment.RecordType?.DeveloperName)));
    }
    // Unapplied receipts may have no Payment__c bridge yet.
    const ledger = await loadTradeCashLedger(ids, query);
    return projectPaymentReminderCurrencies(rows, invoices, payments, ledger);
  } catch {
    throw unavailable(EVIDENCE_ERROR);
  }
}

function minorUnits(value) {
  if (!['number', 'string'].includes(typeof value) || !MONEY.test(String(value))) {
    throw new Error('An invoice or allocation amount must be an explicit two-decimal value.');
  }
  return BigInt(roundedDecimalAmount(value).replace('.', ''));
}

function displayAmount(minor) {
  const value = Number(minor) / 100;
  if (minorUnits(value) !== minor) throw new Error('The payment reminder amount exceeds supported precision.');
  return value;
}

function textPresent(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function documentNeedsProjection(invoice) {
  return (invoice.Document_Currency__c != null && invoice.Document_Currency__c !== 'USD')
    || INVOICE_NATIVE_FIELDS.some(field => !['Document_Currency__c', 'Original_Invoice__c'].includes(field) && invoice[field] != null);
}

function paymentNeedsProjection(payment) {
  return (payment.Payment_Currency__c != null && payment.Payment_Currency__c !== 'USD')
    || PAYMENT_NATIVE_FIELDS.some(field => !['Payment_Currency__c', 'Buyer_Invoice__c'].includes(field) && payment[field] != null);
}

function canonicalEvidence(value) {
  if (Array.isArray(value)) return value.map(canonicalEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalEvidence(value[key])]));
  }
  return value;
}

function groupRecords(records, keyFor) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFor(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const group of groups.values()) group.sort((a, b) => String(a.Id).localeCompare(String(b.Id)));
  return groups;
}

function invoiceAmounts(invoice) {
  const currency = invoice.Document_Currency__c ?? 'USD';
  if (!['USD', 'HKD'].includes(currency)) throw new Error('An invoice has an unsupported currency.');
  if (!textPresent(invoice.File__c)) throw new Error('Complete every invoice and credit document before sending a reminder.');
  if (documentNeedsProjection(invoice) && (!invoice.Document_Currency__c || !textPresent(invoice.Document_FX_Fingerprint__c)
    || !textPresent(invoice.Document_FX_Side__c) || !Number.isFinite(Date.parse(invoice.Document_FX_Confirmed_At__c)))) {
    throw new Error('A confirmed invoice currency snapshot is missing.');
  }
  const usd = minorUnits(invoice.Amount__c);
  if (currency === 'USD') {
    if (invoice.Document_HKD_Amount__c != null || invoice.Document_FX_Rate__c != null || invoice.Document_FX_Revision__c != null) {
      throw new Error('USD invoice evidence cannot contain HKD amounts or company rates.');
    }
    return { currency, native: usd, usd, invoice };
  }
  const native = minorUnits(invoice.Document_HKD_Amount__c);
  if (!textPresent(invoice.Document_FX_Revision__c) || usd !== minorUnits(usdFromHkd(invoice.Document_HKD_Amount__c, invoice.Document_FX_Rate__c))) {
    throw new Error('The invoice amount must match its confirmed company-rate snapshot.');
  }
  return { currency, native, usd, invoice };
}

function validateInvoiceLineage(documents) {
  const creditCount = new Map();
  for (const { invoice, currency, native, usd } of documents.values()) {
    if (native < 0n || invoice.Original_Invoice__c) {
      const original = documents.get(invoice.Original_Invoice__c);
      if (!original || original.native <= 0n || original.invoice.Original_Invoice__c
        || original.currency !== currency || native !== -original.native || usd !== -original.usd
        || (documentNeedsProjection(original.invoice) && !documentNeedsProjection(invoice))
        || ['Document_FX_Rate__c', 'Document_FX_Revision__c', 'Document_FX_Confirmed_At__c', 'Document_FX_Side__c']
          .some(field => invoice[field] !== original.invoice[field])) {
        throw new Error('Each credit must exactly reverse its original invoice in the same currency and original rate.');
      }
      const credits = (creditCount.get(original.invoice.Id) ?? 0) + 1;
      if (credits > 1) throw new Error('Duplicate credits require reconciliation before sending.');
      creditCount.set(original.invoice.Id, credits);
    }
  }
  const reissued = new Set();
  for (const { invoice, native } of documents.values()) {
    if (!invoice.Reissue_Of_Invoice__c) continue;
    if (native <= 0n || invoice.Original_Invoice__c || invoice.Id === invoice.Reissue_Of_Invoice__c
      || !creditCount.has(invoice.Reissue_Of_Invoice__c) || reissued.has(invoice.Reissue_Of_Invoice__c)) {
      throw new Error('Each reissue requires an exact, fully credited original invoice.');
    }
    reissued.add(invoice.Reissue_Of_Invoice__c);
  }
}

function validateDirectPaymentEvidence(payment, currency, native) {
  if (!textPresent(payment.Bank__c) || !textPresent(payment.Bank_FX_Evidence__c)
    || !['USD', 'HKD'].includes(payment.Bank_Currency__c)
    || !OPERATION_ID.test(payment.Payment_Operation_Id__c ?? '') || !REQUEST_FINGERPRINT.test(payment.Payment_Request_Fingerprint__c ?? '')) {
    throw new Error('A managed payment requires recorded bank and operation evidence.');
  }
  const bank = minorUnits(payment.Bank_Native_Amount__c);
  if (bank <= 0n || (payment.Bank_Currency__c === currency && bank !== absolute(native))) {
    throw new Error('The recorded bank amount must reconcile to the same-currency payment magnitude.');
  }
}

function paymentAmounts(payment, document, cashApplication) {
  const currency = payment.Payment_Currency__c ?? 'USD';
  if (!document || currency !== document.currency || payment.Supplier_Invoice__c) {
    throw new Error('Every payment requires an exact buyer invoice allocation in its agreed currency.');
  }
  const cash = minorUnits(payment.Amount__c);
  const native = currency === 'HKD' ? minorUnits(payment.Payment_HKD_Amount__c) : cash;
  const managed = documentNeedsProjection(document.invoice) || paymentNeedsProjection(payment);
  const carrying = currency === 'USD' && !managed && payment.Invoice_Carrying_USD__c == null
    ? cash : minorUnits(payment.Invoice_Carrying_USD__c);

  if (!cashApplication?.reversal && (native < 0n) !== (document.native < 0n)) {
    throw new Error('A refund must be allocated to its exact credit document.');
  }
  if ((native < 0n && (cash > 0n || carrying > 0n)) || (native >= 0n && (cash < 0n || carrying < 0n))) {
    throw new Error('The cash and carrying amounts must follow the native payment direction.');
  }
  if (managed && (payment.RecordType?.DeveloperName !== 'Receivable'
    || native === 0n || !payment.Payment_Currency__c || !textPresent(payment.Account__c)
    || payment.Account__c !== document.invoice.STEM__r?.Account__c)) {
    throw new Error('Managed payments must identify the invoice buyer and receivable record type.');
  }
  if (managed && minorUnits(payment.Settlement_FX_USD__c) !== cash - carrying) {
    throw new Error('The recorded payment settlement FX does not match cash and carrying amounts.');
  }
  if (managed && !cashApplication) validateDirectPaymentEvidence(payment, currency, native);
  if (currency === 'HKD') {
    const effective = Date.parse(payment.Payment_FX_Effective_At__c);
    if (!textPresent(payment.Payment_FX_Revision__c) || !Number.isFinite(effective)
      || effective >= Date.parse(hkCompanyFxMidnight(payment.Date__c, 1))
      || (!cashApplication && cash !== minorUnits(usdFromHkd(payment.Payment_HKD_Amount__c, payment.Payment_FX_Rate__c)))) {
      throw new Error('The payment amount must match its payment-date company-rate snapshot.');
    }
  } else if (payment.Payment_HKD_Amount__c != null || payment.Payment_FX_Rate__c != null || payment.Payment_FX_Revision__c != null
    || payment.Payment_FX_Effective_At__c != null || cash !== carrying) {
    throw new Error('USD allocation evidence must equal USD carrying without an HKD rate.');
  }
  return { native, carrying, cashApplication, createdAt: Date.parse(payment.CreatedDate) };
}

function absolute(amount) {
  return amount < 0n ? -amount : amount;
}

function proratedCarrying(native, document) {
  const denominator = absolute(document.native);
  const numerator = absolute(native * document.usd);
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  return native < 0n ? -rounded : rounded;
}

function validateHkdCarrying(documents, allocationsByInvoice) {
  const paidByOriginal = new Map();
  const ordered = [...documents.values()].filter(document => document.currency === 'HKD')
    .sort((a, b) => Number(Boolean(a.invoice.Original_Invoice__c)) - Number(Boolean(b.invoice.Original_Invoice__c)));
  for (const document of ordered) {
    const credit = document.invoice.Original_Invoice__c;
    const originalPaid = credit ? paidByOriginal.get(credit) : null;
    const initialNative = credit ? -originalPaid.native : document.native;
    const initialUsd = credit ? -originalPaid.carrying : document.usd;
    let remainingNative = initialNative;
    let remainingUsd = initialUsd;
    const allocations = allocationsByInvoice.get(document.invoice.Id) ?? [];
    if (allocations.some(allocation => !Number.isFinite(allocation.createdAt))) {
      throw new Error('The native payment allocation history is missing its recorded order.');
    }
    allocations.sort((a, b) => a.createdAt - b.createdAt);
    for (const allocation of allocations) {
      // Salesforce prorates against the stored invoice principal and consumes
      // the exact remaining carrying on the final allocation.
      if (!allocation.cashApplication) {
        const expected = allocation.native === remainingNative ? remainingUsd : proratedCarrying(allocation.native, document);
        if (allocation.carrying !== expected) {
          throw new Error('The payment carrying amount does not match the original invoice settlement basis.');
        }
      }
      remainingNative -= allocation.native;
      remainingUsd -= allocation.carrying;
      if ((credit ? remainingNative > 0n || remainingUsd > 0n : remainingNative < 0n || remainingUsd < 0n)
        || (remainingNative === 0n && remainingUsd !== 0n)) {
        throw new Error('The native allocations exceed or do not settle their exact invoice or credit.');
      }
    }
    if (!credit) {
      paidByOriginal.set(document.invoice.Id, { native: initialNative - remainingNative, carrying: initialUsd - remainingUsd });
    }
  }
}

function calculateReminder(row, invoices, payments, events, allocations) {
  if (!invoices.length) throw new Error('Buyer invoice evidence is missing.');
  if ((row.currency != null && row.currency !== 'USD') || !validId(row.buyerAccountId) || invoices.some(
    invoice => stemKey(invoice.STEM__r?.Account__c) !== stemKey(row.buyerAccountId)
  ) || events.some(event => stemKey(event.Party__c) !== stemKey(row.buyerAccountId))) {
    throw new Error('Invoice accounting currency or buyer identity has changed. Refresh before sending.');
  }
  const cashLedger = validateTradeCashLedger({ events, allocations, payments, invoices });
  const documents = new Map(invoices.map(invoice => [invoice.Id, invoiceAmounts(invoice)]));
  validateInvoiceLineage(documents);

  const groups = new Map();
  let accountingInvoice = 0n;
  for (const { currency, native, usd } of documents.values()) {
    if (!groups.has(currency)) groups.set(currency, { currency, total: 0n, balance: 0n, carrying: 0n });
    const group = groups.get(currency);
    group.total += native;
    group.balance += native;
    group.carrying += usd;
    accountingInvoice += usd;
  }
  if (accountingInvoice !== minorUnits(row.invoiceAmount)) {
    throw new Error('Final invoice evidence must reconcile to the Salesforce USD invoice total.');
  }
  const allocationsByInvoice = new Map();
  for (const payment of payments) {
    const document = documents.get(payment.Buyer_Invoice__c);
    const allocation = paymentAmounts(payment, document, cashLedger.paymentEvidence.get(payment.Id));
    if (!allocationsByInvoice.has(document.invoice.Id)) allocationsByInvoice.set(document.invoice.Id, []);
    allocationsByInvoice.get(document.invoice.Id).push(allocation);
    const group = groups.get(document.currency);
    group.balance -= allocation.native;
    group.carrying -= allocation.carrying;
  }
  validateHkdCarrying(documents, allocationsByInvoice);

  const balances = [...groups.values()];
  if (balances.reduce((sum, group) => sum + group.carrying, 0n) !== minorUnits(row.receivableBalance)) {
    throw new Error('All currency allocations must reconcile to the Salesforce USD receivable.');
  }
  if (balances.some(group => group.balance < 0n || group.carrying < 0n)) {
    throw new Error('Resolve the credit or refund balance in each currency before sending a reminder.');
  }
  const active = balances.filter(group => group.balance !== 0n || group.carrying !== 0n);
  if (active.length !== 1 || active[0].balance <= 0n) {
    throw new Error(active.length
      ? 'Resolve outstanding balances in each currency before sending a reminder.'
      : 'The invoice balance is fully settled or in credit.');
  }
  const [{ currency, total, balance }] = active;
  if (events.some(event => event.Currency__c === currency && cashLedger.balances.get(event.Id)?.native > 0)) {
    throw new Error('Allocate the available customer cash to its final invoice before sending a payment reminder.');
  }
  return { currency, invoiceAmount: displayAmount(total), receivableBalance: displayAmount(balance) };
}

export function projectPaymentReminderCurrencies(rows, invoices, payments, ledger = { events: [], allocations: [] }) {
  const invoiceGroups = groupRecords(invoices, invoice => stemKey(invoice.STEM__c));
  const paymentGroups = groupRecords(payments, payment => stemKey(payment.STEM__c));
  const eventGroups = groupRecords(ledger.events, event => stemKey(event.STEM__c));
  const allocationGroups = groupRecords(ledger.allocations, allocation => allocation.Cash_Event__c);
  return rows.map(row => {
    const stem = stemKey(row.stemId);
    const documents = invoiceGroups.get(stem) ?? [];
    const receipts = paymentGroups.get(stem) ?? [];
    const events = eventGroups.get(stem) ?? [];
    if (!events.length && !documents.some(documentNeedsProjection) && !receipts.some(paymentNeedsProjection)) return row;
    const cashAllocations = events.flatMap(event => allocationGroups.get(event.Id) ?? []);
    const result = {
      ...row,
      accountingInvoiceUsd: row.invoiceAmount,
      accountingReceivableUsd: row.receivableBalance,
      nativeCurrencyEvidence: canonicalEvidence({ invoices: documents, payments: receipts, cashEvents: events, cashAllocations }),
    };
    try {
      return { ...result, ...calculateReminder(row, documents, receipts, events, cashAllocations) };
    } catch (error) {
      return { ...result, paymentReminderEligible: false, paymentReminderBlockingReason: error.message };
    }
  });
}

export function paymentReminderMoney(value, currency = 'USD') {
  if (value == null || value === '') return '-';
  const formatted = Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'HKD' ? `HKD ${formatted}` : `$${formatted}`;
}

export function paymentReminderCurrencyTotal(rows) {
  const totals = new Map();
  for (const row of rows) {
    const currency = row.currency === 'HKD' ? 'HKD' : 'USD';
    totals.set(currency, (totals.get(currency) ?? 0) + Number(row.receivableBalance || 0));
  }
  if (!totals.size) return paymentReminderMoney(0);
  return [...totals.keys()].sort().map(currency => {
    const money = paymentReminderMoney(totals.get(currency), currency);
    return totals.size > 1 && currency === 'USD' ? `USD ${money.slice(1)}` : money;
  }).join(' / ');
}
