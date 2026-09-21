import { isPaymentDataReliableStem, PAYMENT_DATA_RELIABLE_FROM } from '../src/lib/paymentDataReliability.js';
import { validateAnnualInterestRate, financeError } from './_dashboardFinanceSettings.js';
import { isFinalBuyerInvoice } from './_buyerFinancialAmount.js';
import { SALESFORCE_CORPORATE_CURRENCY } from './_decisionDashboard.js';
import { isPaymentRemittance } from './_paymentClassification.js';

const DAY_MS = 86_400_000;
const idKey = (value) => String(value || '').slice(0, 15);
const unique = (values) => [...new Set(values.filter(Boolean))];
const text = (value) => String(value || '').trim();
const cents = (value) => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
};
const money = (value) => Number(value) / 100;
const typeToken = (value) => text(value).toLowerCase().replace(/[^a-z]/g, '');
const currency = (value) => /^[A-Z]{3}$/.test(text(value)) ? text(value) : null;

export function financeDate(value) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : null;
}

export function financeToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function validateFinanceSnapshot(snapshot, settings, asOfDate) {
  if (snapshot == null) return;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || snapshot.revision !== settings.revision || snapshot.asOfDate !== asOfDate) {
    throw financeError('The financing rate or calculation date changed. Restart the export for a consistent calculation.', 409, 'DASHBOARD_FINANCE_SNAPSHOT_CHANGED');
  }
}

function unavailable(issues) {
  return { financeCost: null, ebit: null, complete: false, status: 'unavailable', issues: unique(issues), accruing: false };
}

/** Inputs are exact STEM cash allocations, not remittance headers or forecasts. */
export function calculateStemFinance({ stem, payments = [], supplierInvoices = [], supplierAccountIds = [],
  finalBuyerInvoiceIssued = false, sourceComplete = true }, { annualInterestRatePct, asOfDate }) {
  const rate = validateAnnualInterestRate(annualInterestRatePct);
  if (!financeDate(asOfDate)) throw financeError('The financing calculation date is invalid.');
  const issues = [];
  if (!isPaymentDataReliableStem(stem)) issues.push('Payment evidence is unavailable before 1 Jan 2026.');
  // The 2026 delivery cohort may have been funded before the payment cutover.
  // Require the server's actual-delivery provenance, never an expected/created date.
  const actualDeliveryDate = stem.deliveryDateSource === 'delivery' ? financeDate(stem.deliveryDate) : null;
  const allowPre2026Cash = actualDeliveryDate?.startsWith('2026-') === true;
  if (!sourceComplete) issues.push('Payment evidence could not be loaded completely.');
  if (cents(stem.netPnl) == null || !currency(stem.currency)) issues.push('Gross profit or its currency is unavailable.');
  const invoiceById = new Map(supplierInvoices.map((invoice) => [idKey(invoice.id), invoice]));
  const supplierIds = new Set([...supplierAccountIds, ...supplierInvoices.map((invoice) => invoice.supplierId)].map(idKey).filter(Boolean));
  const seen = new Map(); const cashEvents = []; const invoicePaid = new Map();
  let buyerAccounted = 0n; let buyerCash = 0n; let lastBuyerReceipt = null; let lastBuyerCashDate = null;
  for (const payment of payments) {
    const key = idKey(payment.id);
    if (!key) { issues.push('A payment allocation has no stable identifier.'); continue; }
    const signature = JSON.stringify(payment);
    if (seen.has(key)) {
      if (seen.get(key) !== signature) issues.push('Duplicate payment records disagree.');
      continue;
    }
    seen.set(key, signature);
    const type = typeToken(payment.type);
    if (payment.isRemittance || type.includes('remittance') || type === 'commission' || payment.commissionInvoiceId) continue;
    if (/void|cancel|reject/i.test(text(payment.status))) continue;
    if (!['receivable', 'payable', 'bankcharge', 'writeoff'].includes(type)) {
      issues.push('A payment allocation has an unrecognized cash classification.'); continue;
    }
    const amount = cents(payment.amount);
    const date = financeDate(payment.date);
    if (amount == null || !date || date > asOfDate) {
      issues.push('A payment allocation has an invalid amount or actual cash date.'); continue;
    }
    // A separate signed reversal is a cash movement. An original tagged as
    // reversed without its signed counterpart cannot establish cash history.
    if (/revers/i.test(text(payment.status)) && amount >= 0) {
      issues.push('A reversed allocation has no identifiable signed cash reversal.'); continue;
    }
    const nonCash = type !== 'receivable' && type !== 'payable'
      || payment.volumeDiscountId || payment.isVolumeDiscount || payment.isDeposit;
    if (!nonCash && date < PAYMENT_DATA_RELIABLE_FROM && !allowPre2026Cash) issues.push('Cash evidence before 1 Jan 2026 is outside the reliable payment history.');
    if (payment.currency !== stem.currency) { issues.push('Payment currencies cannot be reconciled without conversion.'); continue; }
    if (payment.stemId && idKey(payment.stemId) !== idKey(stem.id)) { issues.push('A payment points to a different STEM.'); continue; }
    if (type === 'receivable' || type === 'bankcharge' || type === 'writeoff') {
      if (!stem.buyerAccountId || idKey(payment.accountId) !== idKey(stem.buyerAccountId) || payment.supplierInvoiceId) {
        issues.push('A buyer allocation cannot be reconciled to this STEM and buyer.'); continue;
      }
      buyerAccounted += BigInt(amount);
      if (type !== 'receivable') continue;
      if (nonCash) { issues.push('A buyer allocation does not establish an actual cash receipt.'); continue; }
      buyerCash += BigInt(amount);
      cashEvents.push({ date, amount: -amount });
      if (amount > 0 && (!lastBuyerReceipt || date > lastBuyerReceipt)) lastBuyerReceipt = date;
      if (amount !== 0 && (!lastBuyerCashDate || date > lastBuyerCashDate)) lastBuyerCashDate = date;
      continue;
    }
    const invoice = payment.supplierInvoiceId ? invoiceById.get(idKey(payment.supplierInvoiceId)) : null;
    if (payment.supplierInvoiceId && !invoice) { issues.push('A supplier payment has no matching invoice evidence.'); continue; }
    if (!payment.accountId || (invoice ? idKey(payment.accountId) !== idKey(invoice.supplierId) : !supplierIds.has(idKey(payment.accountId)))) {
      issues.push('A supplier payment cannot be reconciled to this STEM and supplier.'); continue;
    }
    if (invoice) invoicePaid.set(idKey(invoice.id), (invoicePaid.get(idKey(invoice.id)) || 0n) + BigInt(amount));
    // Salesforce generates and later rewrites these deposit allocations from
    // STEM/invoice amounts. Their Date__c is not proof of the bank funding date.
    if (payment.isDeposit && amount !== 0) issues.push('Supplier deposit allocation has no verified original cash funding history.');
    // Discounts settle payable balances but do not finance a cash outflow.
    if (!nonCash) cashEvents.push({ date, amount });
  }
  for (const invoice of supplierInvoices) {
    const amount = cents(invoice.amount); const balance = cents(invoice.balance);
    if (!invoice.id || !invoice.supplierId || (invoice.stemId && idKey(invoice.stemId) !== idKey(stem.id))) issues.push('Supplier invoice ownership is incomplete.');
    if (invoice.currency !== stem.currency) issues.push('Supplier invoice currencies cannot be reconciled without conversion.');
    const difference = amount == null || balance == null ? null : BigInt(amount) - BigInt(balance) - (invoicePaid.get(idKey(invoice.id)) || 0n);
    if (difference == null || difference > 1n || difference < -1n) {
      issues.push('Supplier payments do not reconcile to the invoice payable balance.');
    }
  }
  let stopDate = asOfDate; let settled = false;
  if (finalBuyerInvoiceIssued) {
    const buyer = cents(stem.buyer); const balance = cents(stem.receivableBalance);
    const difference = buyer == null || balance == null ? null : BigInt(buyer) - BigInt(balance) - buyerAccounted;
    if (difference == null || difference > 1n || difference < -1n) {
      issues.push('Buyer receipts and adjustments do not reconcile to the receivable balance.');
    } else if (balance <= 0) {
      if (lastBuyerReceipt && lastBuyerCashDate === lastBuyerReceipt) { stopDate = lastBuyerReceipt; settled = true; }
      else if (lastBuyerCashDate) issues.push('The final buyer cash movement does not establish a settled receipt date.');
      else if (cashEvents.some((event) => event.amount > 0)) issues.push('The buyer balance is settled without a verifiable final cash receipt date.');
      else settled = true;
    }
  } else if (cents(stem.receivableBalance) == null || (cents(stem.receivableBalance) <= 0 && cashEvents.length)) {
    issues.push('Open or settled buyer status cannot be established without final invoice evidence.');
  }
  if (issues.length) return unavailable(issues);
  const byDate = new Map();
  for (const event of cashEvents) {
    if (event.date > stopDate) continue;
    byDate.set(event.date, (byDate.get(event.date) || 0n) + BigInt(event.amount));
  }
  const dates = [...byDate.keys()].sort();
  let funded = 0n; let amountDays = 0n;
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index]; funded += byDate.get(date);
    const nextDate = dates[index + 1] || stopDate;
    const days = Math.round((Date.parse(`${nextDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
    if (funded > 0n) amountDays += funded * BigInt(days);
  }
  const numerator = amountDays * BigInt(Math.round(rate * 100));
  const denominator = 365n * 10000n;
  const costCents = (numerator + denominator / 2n) / denominator;
  const ebitCents = BigInt(cents(stem.netPnl)) - costCents;
  if ([costCents, ebitCents, funded, buyerCash].some((value) => value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))) return unavailable(['The financing calculation exceeds supported monetary precision.']);
  const financeCost = money(costCents);
  return { financeCost, ebit: money(ebitCents), complete: true,
    status: settled ? 'settled' : funded > 0n ? 'accruing' : 'no_funding', issues: [],
    accruing: !settled && funded > 0n, fundedBalance: money(funded > 0n ? funded : 0n),
    throughDate: stopDate, buyerCashReceived: money(buyerCash) };
}

export function summarizeDashboardFinance(rows, settings, asOfDate, { complete = true } = {}) {
  const buckets = new Map();
  for (const row of rows) {
    const key = row.currency || 'Unspecified';
    if (!buckets.has(key)) buckets.set(key, { currency: key, costCents: 0n, ebitCents: 0n, grossCents: 0n, excludedCents: 0n, excludedComplete: true, complete: true, stemCount: 0, verifiedStemCount: 0, missingEvidenceCount: 0, accruingStemCount: 0 });
    const bucket = buckets.get(key); bucket.stemCount += 1;
    const gross = cents(row.netPnl);
    if (!row.finance?.complete || gross == null || cents(row.finance.financeCost) == null || cents(row.finance.ebit) == null) {
      bucket.complete = false; bucket.missingEvidenceCount += 1;
      if (gross == null) bucket.excludedComplete = false;
      else bucket.excludedCents += BigInt(gross);
    } else {
      bucket.verifiedStemCount += 1; bucket.grossCents += BigInt(gross);
      bucket.costCents += BigInt(cents(row.finance.financeCost)); bucket.ebitCents += BigInt(cents(row.finance.ebit));
      if (row.finance.accruing) bucket.accruingStemCount += 1;
    }
  }
  const safe = (value) => value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER);
  for (const bucket of buckets.values()) if (![bucket.costCents, bucket.ebitCents, bucket.grossCents].every(safe)) bucket.complete = false;
  return { annualInterestRatePct: settings.annualInterestRatePct, revision: settings.revision, asOfDate, dayCountBasis: 'ACT/365',
    complete: complete && [...buckets.values()].every((bucket) => bucket.complete),
    byCurrency: [...buckets.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map(({ costCents, ebitCents, grossCents, excludedCents, excludedComplete, ...bucket }) => {
      // A verified subset is useful, but must never masquerade as the full currency result.
      const verified = complete && bucket.verifiedStemCount > 0 && [costCents, ebitCents, grossCents].every(safe);
      return { ...bucket, complete: complete && bucket.complete,
        financeCost: complete && bucket.complete ? money(costCents) : null,
        ebit: complete && bucket.complete ? money(ebitCents) : null,
        verifiedGrossProfit: verified ? money(grossCents) : null,
        verifiedFinanceCost: verified ? money(costCents) : null,
        verifiedEbit: verified ? money(ebitCents) : null,
        excludedGrossProfit: complete && excludedComplete && safe(excludedCents) ? money(excludedCents) : null,
      };
    }), warnings: [] };
}

/** Dependency injection keeps all Salesforce work read-only and testable. */
export function createDashboardFinanceLoader({ queryAll, describeObject, chunkSize = 150 }) {
  async function queryByIds(objectName, select, field, ids) {
    const result = [];
    const values = unique(ids);
    for (let start = 0; start < values.length; start += chunkSize) {
      const group = values.slice(start, start + chunkSize);
      if (group.some((id) => !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(id))) throw new Error('Invalid source record identifier.');
      result.push(...await queryAll(`SELECT ${select.join(',')} FROM ${objectName} WHERE ${field} IN (${group.map((id) => `'${id}'`).join(',')})`));
    }
    return result;
  }
  return async function enrichDashboardFinance(rows, settings, asOfDate) {
    if (!rows.length) return rows;
    try {
      const [paymentDescribe, invoiceDescribe, stemDescribe, buyerDescribe, lineDescribe, extraDescribe] = await Promise.all(
        ['Payment__c', 'Supplier_Invoice__c', 'STEM__c', 'Invoice__c', 'STEM_Line_Item__c', 'STEM_Extra_Cost__c'].map((objectName) => describeObject(objectName)),
      );
      const fields = (describe) => new Set((describe.fields || []).map((field) => field.name));
      const paymentFields = fields(paymentDescribe); const invoiceFields = fields(invoiceDescribe); const stemFields = fields(stemDescribe);
      const buyerFields = fields(buyerDescribe); const lineFields = fields(lineDescribe); const extraFields = fields(extraDescribe);
      const requireFields = (set, names) => { if (names.some((name) => !set.has(name))) throw new Error('Required finance schema is unavailable.'); };
      requireFields(paymentFields, ['Id', 'STEM__c', 'Account__c', 'RecordTypeId', 'Amount__c', 'Date__c', 'Supplier_Invoice__c', 'Is_Volume_Discount__c', 'Is_Deposit__c', 'Commission_Invoice__c', 'Remittance__c']);
      requireFields(invoiceFields, ['Id', 'STEM__c', 'Supplier__c', 'Invoice_Amount__c', 'Payable_Balance__c']);
      requireFields(stemFields, ['Id', 'Account__c', 'QLIK_Receivable_Balance__c']);
      requireFields(buyerFields, ['Id', 'STEM__c', 'Proforma__c', 'Deprecated__c']);
      requireFields(lineFields, ['Id', 'STEM__c', 'Supplier_Invoice__c', 'Original_Supplier__c', 'Cancelled__c']);
      requireFields(extraFields, ['Id', 'STEM__c', 'Supplier_Invoice__c', 'Supplier__c', 'Cancelled__c']);
      const select = (set, names) => names.filter((name) => set.has(name));
      const stemIds = rows.map((row) => row.id);
      const invoiceSelect = select(invoiceFields, ['Id', 'STEM__c', 'Supplier__c', 'Invoice_Amount__c', 'Payable_Balance__c', 'CurrencyIsoCode']);
      const classificationFields = select(paymentFields, ['Name', 'Reference__c', 'Type__c', 'Payment_Type__c', 'Direction__c', 'Payment_Direction__c', 'Status__c', 'Payment_Status__c']);
      const paymentSelect = [...select(paymentFields, ['Id', 'STEM__c', 'Account__c', 'Amount__c', 'Date__c', 'Supplier_Invoice__c', 'Volume_Discount__c', 'Is_Volume_Discount__c', 'Is_Deposit__c', 'Commission_Invoice__c', 'Remittance__c', 'CurrencyIsoCode']), ...classificationFields, 'RecordType.DeveloperName'];
      const [stems, initialInvoices, stemPayments, buyers, lines, extras] = await Promise.all([
        queryByIds('STEM__c', ['Id', 'Account__c', 'QLIK_Receivable_Balance__c'], 'Id', stemIds),
        queryByIds('Supplier_Invoice__c', invoiceSelect, 'STEM__c', stemIds),
        queryByIds('Payment__c', paymentSelect, 'STEM__c', stemIds),
        queryByIds('Invoice__c', select(buyerFields, ['Id', 'Name', 'STEM__c', 'Proforma__c', 'Deprecated__c', 'Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c']), 'STEM__c', stemIds),
        queryByIds('STEM_Line_Item__c', select(lineFields, ['Id', 'STEM__c', 'Supplier_Invoice__c', 'Original_Supplier__c', 'Cancelled__c']), 'STEM__c', stemIds),
        queryByIds('STEM_Extra_Cost__c', select(extraFields, ['Id', 'STEM__c', 'Supplier_Invoice__c', 'Supplier__c', 'Cancelled__c']), 'STEM__c', stemIds),
      ]);
      const linkedChildren = [...lines, ...extras].filter((row) => row.Cancelled__c !== true);
      const invoiceIds = unique([...initialInvoices.map((row) => row.Id), ...linkedChildren.map((row) => row.Supplier_Invoice__c), ...stemPayments.map((row) => row.Supplier_Invoice__c)]);
      const initialIds = new Set(initialInvoices.map((row) => idKey(row.Id)));
      const [missingInvoices, invoicePayments] = await Promise.all([
        queryByIds('Supplier_Invoice__c', invoiceSelect, 'Id', invoiceIds.filter((id) => !initialIds.has(idKey(id)))),
        queryByIds('Payment__c', paymentSelect, 'Supplier_Invoice__c', invoiceIds),
      ]);
      const invoices = [...initialInvoices, ...missingInvoices];
      const invoiceById = new Map(invoices.map((row) => [idKey(row.Id), row]));
      const payments = [...stemPayments, ...invoicePayments];
      const remittanceIds = new Set(payments.map((payment) => idKey(payment.Remittance__c)).filter(Boolean));
      const stemById = new Map(stems.map((row) => [idKey(row.Id), row]));
      const linkedStemIds = new Map();
      for (const child of linkedChildren) if (child.Supplier_Invoice__c) {
        const key = idKey(child.Supplier_Invoice__c);
        linkedStemIds.set(key, unique([...(linkedStemIds.get(key) || []), idKey(child.STEM__c)]));
      }
      return rows.map((row) => {
        const key = idKey(row.id); const rawStem = stemById.get(key);
        const ownsInvoice = (invoice) => idKey(invoice.STEM__c) === key || (linkedStemIds.get(idKey(invoice.Id)) || []).includes(key);
        const ownInvoices = invoices.filter(ownsInvoice);
        const invoiceKeys = new Set(ownInvoices.map((invoice) => idKey(invoice.Id)));
        const ownPayments = payments.filter((payment) => idKey(payment.STEM__c) === key || invoiceKeys.has(idKey(payment.Supplier_Invoice__c)));
        const normalizedPayments = ownPayments.map((payment) => ({ id: payment.Id, stemId: payment.STEM__c,
          supplierInvoiceId: payment.Supplier_Invoice__c, accountId: payment.Account__c,
          amount: payment.Amount__c, date: payment.Date__c, type: payment.RecordType?.DeveloperName,
          status: payment.Status__c || payment.Payment_Status__c, volumeDiscountId: payment.Volume_Discount__c,
          isVolumeDiscount: payment.Is_Volume_Discount__c === true, isDeposit: payment.Is_Deposit__c === true,
          commissionInvoiceId: payment.Commission_Invoice__c, remittanceId: payment.Remittance__c,
          isRemittance: remittanceIds.has(idKey(payment.Id)) || isPaymentRemittance(payment, classificationFields),
          currency: paymentFields.has('CurrencyIsoCode') ? payment.CurrencyIsoCode : SALESFORCE_CORPORATE_CURRENCY }));
        const ownChildren = linkedChildren.filter((child) => idKey(child.STEM__c) === key);
        const missingLink = ownChildren.some((child) => child.Supplier_Invoice__c && !invoiceById.has(idKey(child.Supplier_Invoice__c)));
        const sharedInvoice = ownInvoices.some((invoice) => (linkedStemIds.get(idKey(invoice.Id)) || []).some((stemKey) => stemKey !== key));
        const finance = calculateStemFinance({ stem: { ...row, buyerAccountId: rawStem?.Account__c, receivableBalance: rawStem?.QLIK_Receivable_Balance__c },
          sourceComplete: Boolean(rawStem) && !missingLink && !sharedInvoice,
          finalBuyerInvoiceIssued: buyers.some((invoice) => idKey(invoice.STEM__c) === key && isFinalBuyerInvoice(invoice)),
          supplierAccountIds: ownChildren.map((child) => child.Original_Supplier__c || child.Supplier__c),
          payments: normalizedPayments,
          supplierInvoices: ownInvoices.map((invoice) => ({ id: invoice.Id, stemId: invoice.STEM__c, supplierId: invoice.Supplier__c,
            amount: invoice.Invoice_Amount__c, balance: invoice.Payable_Balance__c,
            currency: invoiceFields.has('CurrencyIsoCode') ? invoice.CurrencyIsoCode : SALESFORCE_CORPORATE_CURRENCY })),
        }, { annualInterestRatePct: settings.annualInterestRatePct, asOfDate });
        return { ...row, finance };
      });
    } catch {
      return rows.map((row) => ({ ...row, finance: unavailable(['Payment evidence could not be loaded completely. Refresh to retry.']) }));
    }
  };
}
