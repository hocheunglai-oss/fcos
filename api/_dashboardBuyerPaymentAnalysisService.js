import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { buildDashboardBuyerPaymentAnalysis } from './_dashboardBuyerPaymentAnalysis.js';

const ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const MAX_STEMS = 5000;
const MAX_ROWS = 20000;
const MAX_IDS_PER_QUERY = 200;
// Salesforce caps URI + headers at 16 KiB. Leave room for the service URL
// prefix and authorization headers instead of batching only by record count.
const QUERY_PATH_BYTE_BUDGET = 12 * 1024;
function planQueries(ids, objectName, select, lookup, expectedAccounts, stemAccessWhere) {
  const build = (chunk) => {
    const accountPairs = chunk.map((id) => `(Id = '${id}' AND Account__c = '${expectedAccounts[id.slice(0, 15)]}')`).join(' OR ');
    const guardedScope = `(${stemAccessWhere}) AND Account__r.Inactive_Suspended__c = false AND (${accountPairs})`;
    const accessGuard = objectName === 'STEM__c' ? guardedScope : `STEM__c IN (SELECT Id FROM STEM__c WHERE ${guardedScope})`;
    return `SELECT ${select.join(',')} FROM ${objectName} WHERE ${lookup} IN (${chunk.map((id) => `'${id}'`).join(',')}) AND (${accessGuard}) LIMIT ${MAX_ROWS + 1}`;
  };
  const batches = [];
  for (let offset = 0; offset < ids.length;) {
    let low = 1;
    let high = Math.min(MAX_IDS_PER_QUERY, ids.length - offset);
    let batch = null;
    let size = 0;
    // Find the largest complete ID/account batch that fits the encoded path.
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = build(ids.slice(offset, offset + count));
      if (Buffer.byteLength(`/query/?q=${encodeURIComponent(candidate)}`, 'utf8') <= QUERY_PATH_BYTE_BUDGET) {
        batch = candidate;
        size = count;
        low = count + 1;
      } else high = count - 1;
    }
    if (!batch) throw fail('The selected account access scope is too large. Select a smaller scope and retry.', 'DASHBOARD_PAYMENT_ANALYSIS_SCOPE_TOO_LARGE');
    batches.push(batch);
    offset += size;
  }
  return batches;
}
function fail(message, code = 'DASHBOARD_PAYMENT_ANALYSIS_INCOMPLETE') {
  return Object.assign(new Error(message), { status: 503, code, expose: true });
}
function fields(describe, required, optional = []) {
  const available = new Set((describe?.fields || []).map((field) => field.name));
  if (required.some((name) => !available.has(name))) {
    throw fail('Salesforce does not expose the invoice and payment fields needed for this analysis.', 'DASHBOARD_PAYMENT_ANALYSIS_SCHEMA');
  }
  return [...required, ...optional.filter((name) => available.has(name))];
}

// The caller resolves the complete, access-filtered Dashboard scope first.
// No model-generated query or account ID is accepted by this service.
export async function loadDashboardBuyerPaymentAnalysis({ scopedStemIds, complete, today, describe, query, readOrganization, expectedAccounts, stemAccessWhere }) {
  if (!complete) throw fail('The dashboard scope is incomplete. Refine the period and retry.');
  const startedAt = Date.now();
  const idKey = (id) => String(id || "").slice(0, 15);
  const ids = [...new Map((scopedStemIds || []).map((id) => [idKey(id), id])).values()];
  if (ids.some((id) => !ID.test(id))) throw fail('The dashboard returned an invalid STEM identity.');
  if (ids.length > MAX_STEMS) throw fail('Select a smaller period for complete buyer payment analysis (up to 5,000 STEMs).');
  if (ids.some((id) => !ID.test(expectedAccounts?.[idKey(id)] || '')) || typeof stemAccessWhere !== 'string' || !stemAccessWhere.trim()) throw fail('The trusted dashboard account access scope is required.');
  if (!ids.length) return buildDashboardBuyerPaymentAnalysis({ stems: [], invoices: [], payments: [], complete: true, today });
  if (Buffer.byteLength(`/query/?q=${encodeURIComponent(stemAccessWhere)}`, 'utf8') >= QUERY_PATH_BYTE_BUDGET) throw fail('The selected account access scope is too large. Select a smaller scope and retry.', 'DASHBOARD_PAYMENT_ANALYSIS_SCOPE_TOO_LARGE');
  const readProvider = async (operation) => {
    try { return await operation(); }
    catch { throw fail('Buyer invoice and payment history could not be loaded. Refresh and retry.', 'DASHBOARD_PAYMENT_ANALYSIS_READ_FAILED'); }
  };
  const [stem, invoice, payment] = await Promise.all(['STEM__c', 'Invoice__c', 'Payment__c'].map((object) => readProvider(() => describe(object))));
  const stemSelect = fields(stem, ['Id', 'Account__c', 'CreatedDate', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'Total_Invoice_Amount__c', 'QLIK_Receivable_Balance__c'], ['CurrencyIsoCode', 'Status__c']);
  stemSelect.push('Account__r.Name');
  const invoiceSelect = fields(invoice, ['Id', 'Name', 'STEM__c', 'CreatedDate', 'Amount__c', 'Invoice_Due_Date__c', 'Proforma__c', 'Deprecated__c'], ['CurrencyIsoCode', 'Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c']);
  const paymentSelect = fields(payment, ['Id', 'STEM__c', 'Account__c', 'Amount__c', 'Date__c', 'RecordTypeId', 'Supplier_Invoice__c', 'Is_Deposit__c', 'Is_Volume_Discount__c', 'Commission_Invoice__c'], ['CurrencyIsoCode', 'Status__c', 'Payment_Status__c']);
  paymentSelect.push('RecordType.DeveloperName', 'RecordType.Name');
  const references = (payment.fields || []).filter((field) => field.type === 'reference' && field.referenceTo?.includes('Supplier_Invoice__c')).map((field) => field.name);
  paymentSelect.push(...references.filter((name) => !paymentSelect.includes(name)));
  // Plan all evidence reads before issuing any query. A single oversized
  // trusted access guard cannot produce a partial result or an oversized URL.
  const plans = [
    planQueries(ids, 'STEM__c', stemSelect, 'Id', expectedAccounts, stemAccessWhere),
    planQueries(ids, 'Invoice__c', invoiceSelect, 'STEM__c', expectedAccounts, stemAccessWhere),
    planQueries(ids, 'Payment__c', paymentSelect, 'STEM__c', expectedAccounts, stemAccessWhere),
  ];
  let queryCount = 0;
  const readQuery = async (soql, limit) => {
    queryCount++;
    return readProvider(() => query(soql, limit));
  };
  const perRecordCurrency = [stemSelect, invoiceSelect, paymentSelect].map((select) => select.includes('CurrencyIsoCode'));
  let reportingCurrency = null;
  if (perRecordCurrency.some((available) => !available)) {
    if (perRecordCurrency.some(Boolean) || typeof readOrganization !== 'function') throw fail('Salesforce currency metadata is incomplete.', 'DASHBOARD_PAYMENT_ANALYSIS_SCHEMA');
    const [organization, settings] = await Promise.all([
      readQuery('SELECT Id, IsSandbox FROM Organization LIMIT 1', 1), readProvider(() => readOrganization()),
    ]);
    const target = fcosSalesforceEnvironment('production');
    const row = organization?.records?.[0];
    if (organization?.records?.length !== 1 || row.Id !== target.orgId || row.IsSandbox !== target.isSandbox || settings?.features?.multiCurrency !== false || !/^[A-Z]{3}$/.test(settings?.features?.defaultCurrencyIsoCode || '')) throw fail('The Salesforce reporting currency or Production identity could not be verified.', 'DASHBOARD_PAYMENT_ANALYSIS_CURRENCY');
    reportingCurrency = settings.features.defaultCurrencyIsoCode;
  }
  const read = async (batches) => {
    const rows = [];
    for (const soql of batches) {
      const result = await readQuery(soql, MAX_ROWS + 1);
      if (!result || result.error || !Array.isArray(result.records) || Number(result.totalSize ?? result.records.length) !== result.records.length) throw fail('Salesforce returned incomplete payment evidence. Refine the period and retry.');
      rows.push(...result.records);
      if (rows.length > MAX_ROWS) throw fail('Select a smaller period for complete invoice and payment evidence.');
    }
    return rows;
  };
  const [stems, invoices, payments] = await Promise.all(plans.map(read));
  const allowed = new Set(ids.map(idKey));
  if (new Set(stems.map((row) => idKey(row.Id))).size !== ids.length || stems.some((row) => !allowed.has(idKey(row.Id)) || idKey(row.Account__c) !== idKey(expectedAccounts[idKey(row.Id)]))) throw fail('The selected STEM scope changed during analysis. Refresh and retry.');
  if ([...invoices, ...payments].some((row) => !allowed.has(idKey(row.STEM__c)))) throw fail('Salesforce returned evidence outside the selected dashboard scope.');
  // Normalize additional supplier invoice lookups into the canonical blocker.
  const normalizeCurrency = (row) => reportingCurrency ? { ...row, CurrencyIsoCode: reportingCurrency } : row;
  const normalizedPayments = payments.map((row) => ({ ...normalizeCurrency(row), Supplier_Invoice__c: references.map((field) => row[field]).find(Boolean) || row.Supplier_Invoice__c }));
  return {
    ...buildDashboardBuyerPaymentAnalysis({ stems: stems.map(normalizeCurrency), invoices: invoices.map(normalizeCurrency), payments: normalizedPayments, complete: true, today }),
    currencyBasis: reportingCurrency ? { mode: 'verified_single_currency_organization', currency: reportingCurrency } : { mode: 'per_record_currency' },
    timing: { elapsedMs: Date.now() - startedAt, queryCount, organizationReadCount: reportingCurrency ? 1 : 0, describeCount: 3, stemCount: stems.length, invoiceCount: invoices.length, paymentCount: payments.length },
  };
}
