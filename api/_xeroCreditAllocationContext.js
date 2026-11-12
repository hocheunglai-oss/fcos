import { SALES_INVOICE_SUMMARY_POLICY } from './_xeroSalesInvoiceSummary.js';
import { nativeReviewedLineView, nativeSalesSummaryLineItems } from './_xeroNativeDocumentDraft.js';
import { nativeReadbackDecimal as decimal, verifyNativeXeroLines } from './_xeroNativeLineComparison.js';
import { loadFinancialSafetyContext } from './_xeroDocumentSafety.js';
import { exactXeroRows, loadXeroPrepaymentContextForStem, scopedRows } from './_xeroPrepaymentContext.js';
import { reviewCreditAllocation } from './_xeroCreditAllocations.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import {
  loadCreditAllocationSalesforceSource, verifyCreditAllocationSourceMappings,
} from './_xeroCreditAllocationSource.js';
import {
  assertXeroFinancialDailyReserve, loadSalesforcePayments, xeroFinancialAccountingFetch, xeroFinancialRateSnapshot,
} from './_xeroFinancialSync.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const isUuid = value => typeof value === 'string' && UUID.test(value);

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status, code: 'XERO_CREDIT_ALLOCATION_CONTEXT_INCOMPLETE' });
}

function verifyMappedLines(row, mapping, snapshots, source) {
  const saved = mapping.currency_evidence?.originalLines;
  const adjustment = mapping.currency_evidence?.roundingAdjustment;
  if (!Array.isArray(saved) || !saved.length) {
    fail('The exact no-tax Xero accounting lines could not be read.');
  }
  const unmatched = new Map(snapshots.map(line => [line.Id, line]));
  const expected = saved.map(line => {
    const snapshot = unmatched.get(line?.snapshotId);
    if (!snapshot || line.sourceId !== snapshot.Source_Record_Id__c || line.currency !== snapshot.Currency__c
        || decimal(line.nativeAmount, 6) == null
        || decimal(line.nativeAmount, 6) !== decimal(snapshot.Native_Amount__c, 6)) {
      fail('The saved accounting lines do not identify the exact immutable Salesforce snapshots.');
    }
    unmatched.delete(line.snapshotId);
    return { quantity: line.accountingQuantity, unitAmount: line.accountingUnitAmount, accountCode: line.accountCode, taxType: line.taxType };
  });
  if ([...unmatched.values()].some(line => decimal(line.Native_Amount__c, 6) !== 0)) {
    fail('The saved accounting lines omit an immutable nonzero Salesforce amount.');
  }
  if (adjustment) {
    if (!Number.isSafeInteger(adjustment.adjustmentCents) || !adjustment.adjustmentCents) {
      fail('The saved Xero rounding amount is invalid.');
    }
    expected.push({ quantity: 1, unitAmount: adjustment.adjustmentCents / 100,
      accountCode: adjustment.policy?.account_code, taxType: adjustment.policy?.tax_type });
  }

  const policy = mapping.currency_evidence?.presentationPolicy;
  const summary = policy === SALES_INVOICE_SUMMARY_POLICY;
  if (policy != null && (!summary || mapping.xero_document_type !== 'ACCREC')) {
    fail('The saved native document presentation policy is not supported.');
  }
  const amount = decimal(source.Document_Currency__c === 'HKD' ? source.Document_HKD_Amount__c : source.Amount__c, 2);
  try {
    const reviewedLines = summary
      ? nativeSalesSummaryLineItems(expected, xeroPaymentDate(source.Invoice_Date__c), amount).map(nativeReviewedLineView)
      : expected;
    verifyNativeXeroLines(row, reviewedLines, { compareDescription: summary });
  } catch (error) {
    if (!['XERO_NATIVE_DOCUMENT_LINES_CHANGED', 'XERO_SALES_SUMMARY_INVALID'].includes(error.code)) throw error;
    fail(error.message);
  }
}

function mappedDocument(response, collection, idField, numberField, mapping, source, snapshots) {
  const rows = response?.[collection];
  const row = rows?.[0];
  const currency = source.Document_Currency__c;
  const date = xeroPaymentDate(source.Invoice_Date__c);
  if (!Array.isArray(rows) || rows.length !== 1 || row?.[idField] !== mapping.xero_document_id
      || row.Type !== mapping.xero_document_type || row.Contact?.ContactID !== mapping.xero_contact_id
      || row[numberField] !== mapping.xero_document_number || row.CurrencyCode !== currency
      || !date || xeroPaymentDate(row.Date) !== date || !['AUTHORISED', 'PAID'].includes(row.Status)
      || row.HasErrors === true || row.HasValidationErrors === true || row.ValidationErrors?.length
      || (mapping.xero_currency_rate != null && Number(mapping.xero_currency_rate) !== Number(row.CurrencyRate))
      || (currency === 'HKD' && !(Number(mapping.xero_currency_rate) > 0))) {
    fail('Current Xero document details do not match the exact saved native mapping.');
  }
  verifyMappedLines(row, mapping, snapshots, source);
  return row;
}

// Read the issued document pair and original mapping before any cash or write admission.
export async function loadCreditAllocationDocumentContext(sourceObject, creditId, {
  client, connection, env = process.env, fetchImpl, requestGate,
  accountingFetch = xeroFinancialAccountingFetch, query, composite,
} = {}) {
  const tenantId = connection?.tenantId;
  if (!client || !isUuid(tenantId) || (env.XERO_TENANT_ID && env.XERO_TENANT_ID !== tenantId)) {
    fail('An exact Xero tenant and Finance service client are required.', 400);
  }
  const source = await loadCreditAllocationSalesforceSource(sourceObject, creditId, { query, composite });
  const ids = [source.credit.Id, source.original.Id];
  const stored = await client.from('xero_financial_document_mappings').select('*', { count: 'exact' })
    .eq('salesforce_object', sourceObject).in('salesforce_id', ids);
  if (stored?.error || !Array.isArray(stored?.data) || stored.count !== stored.data.length) {
    fail('The exact Finance document mappings could not be read.', 502);
  }
  if (stored.data.some(row => !ids.includes(row?.salesforce_id) || !isUuid(row.id)
      || !isUuid(row.xero_document_id) || !isUuid(row.xero_contact_id)
      || typeof row.xero_document_number !== 'string' || !row.xero_document_number.trim())
      || new Set(stored.data.map(row => row.id)).size !== stored.data.length
      || new Set(stored.data.map(row => row.xero_document_id)).size !== stored.data.length) {
    fail('Finance returned a duplicate, foreign or incomplete document mapping.');
  }
  const verified = await verifyCreditAllocationSourceMappings(sourceObject, source, stored.data, composite);
  const { creditMapping, invoiceMapping } = verified;
  if (creditMapping.xero_contact_id !== invoiceMapping.xero_contact_id) {
    fail('The credit and invoice mappings must identify the same Xero contact.');
  }
  let rate = {};
  const read = (path) => {
    assertXeroFinancialDailyReserve(rate, env);
    return accountingFetch(connection, path, { method: 'GET', env, fetchImpl, requestGate, onResponse: response => {
      rate = xeroFinancialRateSnapshot(response?.headers, rate);
      assertXeroFinancialDailyReserve(rate, env);
    } });
  };
  const parent = sourceObject === 'Invoice__c' ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c';
  const linesFor = document => source.documentLines.filter(line => line[parent] === document.Id);
  const creditResponse = await read(`/CreditNotes/${creditMapping.xero_document_id}?unitdp=4`);
  const xeroCredit = mappedDocument(creditResponse, 'CreditNotes', 'CreditNoteID', 'CreditNoteNumber', creditMapping, source.credit, linesFor(source.credit));
  const invoiceResponse = await read(`/Invoices/${invoiceMapping.xero_document_id}?unitdp=4`);
  const xeroInvoice = mappedDocument(invoiceResponse, 'Invoices', 'InvoiceID', 'InvoiceNumber', invoiceMapping, source.original, linesFor(source.original));
  return { ...source, ...verified, tenantId, xeroCredit, xeroInvoice, readXero: read };
}


function providerPaymentIds(document) {
  const payments = document.Payments;
  if (!Array.isArray(payments) || payments.some(row => !isUuid(row?.PaymentID))
      || new Set(payments.map(row => row.PaymentID)).size !== payments.length) {
    fail('Xero document payment history is incomplete.');
  }
  return payments.map(row => row.PaymentID);
}

export async function loadCreditAllocationReview(sourceObject, creditId, {
  client, connection, env = process.env, query, queryAll, safetyContext,
  loadDocuments = loadCreditAllocationDocumentContext, loadPayments = loadSalesforcePayments,
  loadCashLedger = loadXeroPrepaymentContextForStem, readScopedRows = scopedRows,
  ...providerOptions
} = {}, execution = {}) {
  const context = await loadDocuments(sourceObject, creditId, { client, connection, env, query, ...providerOptions });
  const { credit, original, creditMapping, invoiceMapping, tenantId, xeroCredit, xeroInvoice, readXero } = context;
  const target = sourceObject === 'Invoice__c' ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c';
  const refundIds = providerPaymentIds(xeroCredit);
  const invoicePaymentIds = providerPaymentIds(xeroInvoice);
  const paymentIds = [...refundIds, ...invoicePaymentIds];
  if (new Set(paymentIds).size !== paymentIds.length || !Array.isArray(xeroInvoice.Prepayments)
      || !Array.isArray(xeroInvoice.Overpayments) || xeroInvoice.Overpayments.length) {
    fail('The exact Xero settlement history could not be verified.');
  }
  safetyContext ||= await loadFinancialSafetyContext();
  if (!['Cash_Event__c', 'Buyer_Invoice__c', 'Payment_Currency__c', 'Invoice_Carrying_USD__c']
    .every(field => safetyContext.fields?.Payment__c?.includes(field))) {
    fail('Required Salesforce payment settlement fields are unavailable.');
  }

  const [payments, history] = await Promise.all([
    loadPayments(null, safetyContext, query, { queryAll, stemId: original.STEM__c }),
    readScopedRows(client, { table: 'xero_financial_credit_allocations', field: 'invoice_mapping_id',
      ids: [invoiceMapping.id], key: 'operation_id', tenantId }),
  ]);
  const currentUnsentCredit = history.find(row => row.operation_id === execution.ignoreOperationId
    && row.status === 'processing' && !row.send_started_at && row.reviewed_by === execution.actorId
    && row.credit_mapping_id === creditMapping.id && row.invoice_mapping_id === invoiceMapping.id
    && row.request_evidence?.reviewFingerprint === execution.reviewFingerprint);
  const allocationLedger = history.filter(row => row !== currentUnsentCredit);
  if (allocationLedger.some(row => ['processing', 'unknown', 'exception'].includes(row.status))) {
    fail('Resolve the existing credit allocation before reviewing another.');
  }
  const selectedPayments = payments.filter(row => [original.Id, credit.Id].includes(row[target]));
  const hasCashBridge = selectedPayments.some(row => row.Cash_Event__c);
  if (!hasCashBridge && xeroInvoice.Prepayments.length) fail('Xero holds an unmatched prepayment against the original invoice.');
  const [paymentMappings, xeroPayments, cashLedger] = await Promise.all([
    readScopedRows(client, { table: 'xero_financial_payment_mappings', field: 'salesforce_payment_id',
      ids: selectedPayments.filter(row => !row.Cash_Event__c).map(row => row.Id), source: true }),
    exactXeroRows(readXero, 'Payments', 'PaymentID', paymentIds),
    hasCashBridge ? loadCashLedger(original.STEM__c, {
      client, connection, env, query, queryAll, safetyContext, ...providerOptions,
      verifiedInvoice: xeroInvoice, currentUnsentCredit,
    }) : null,
  ]);
  if (xeroPayments.some(row => refundIds.includes(row.PaymentID)
    ? row.CreditNote?.CreditNoteID !== xeroCredit.CreditNoteID
    : row.Invoice?.InvoiceID !== xeroInvoice.InvoiceID)) {
    fail('A Xero payment detail belongs to a different document than its payment history.');
  }
  const review = reviewCreditAllocation({ ...context, payments, paymentMappings, xeroPayments, allocationLedger, cashLedger });
  if (review.status !== 'eligible') return review;
  const organisation = (await readXero('/Organisations'))?.Organisations;
  const org = organisation?.[0];
  if (!Array.isArray(organisation) || organisation.length !== 1 || !isUuid(org?.OrganisationID)
      || !['USD', 'HKD'].includes(org.BaseCurrency)) {
    fail('Current Xero organisation and accounting lock dates could not be verified.');
  }
  const locks = [org.PeriodLockDate, org.EndOfYearLockDate].filter(value => value != null && value !== '').map(xeroPaymentDate);
  if (locks.some(date => !date || review.allocationDate <= date)) fail('The reviewed Xero allocation date is locked.');
  return review;
}
