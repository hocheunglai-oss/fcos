import { accountingPayload } from './_xeroDocumentSafety.js';
import { salesInvoiceSummaryPayload } from './_xeroSalesInvoiceSummary.js';
import { previewEvidenceHash } from './_xeroPreviewPersistence.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REVIEW_POLICY = 'trading_fx_native_draft_v1';

export function nativeSalesSummaryLineItems(lines, invoiceDate, total) {
  const [year, month, day] = invoiceDate.split('-');
  const description = `INVOICE ${Number(day)}/${Number(month)}/${year}`;
  return salesInvoiceSummaryPayload({ Type: 'ACCREC', LineAmountTypes: 'NoTax',
    LineItems: lines.map(line => ({ Description: description, Quantity: line.quantity, UnitAmount: line.unitAmount,
      AccountCode: line.accountCode, TaxType: line.taxType })) }, total).LineItems;
}

export function nativeReviewedLineView(line) {
  return { description: line.Description, quantity: line.Quantity, unitAmount: line.UnitAmount,
    accountCode: line.AccountCode, taxType: line.TaxType };
}

export function prepareNativeDocumentDraft({
  tenantId, sourceObject, record, sourceFingerprint, currency, organisationCurrency, signedTotal,
  invoiceDate, dueDate, xeroCurrencyRate, lines, xeroReview, currentMapping,
}) {
  if (currentMapping || xeroReview?.status !== 'no_exact_number_match' || xeroReview.ownershipVerified !== true
      || !UUID.test(xeroReview.contact?.id || '')) return null;
  const held = message => ({ status: 'held', message });
  if (currency !== organisationCurrency && (!Number.isFinite(xeroCurrencyRate) || xeroCurrencyRate <= 0)) {
    return held('A foreign-currency draft needs an exact reviewed Xero exchange rate.');
  }
  const buyer = sourceObject === 'Invoice__c';
  const credit = signedTotal < 0;
  const xeroCollection = credit ? 'CreditNotes' : 'Invoices';
  const xeroType = `${buyer ? 'ACCREC' : 'ACCPAY'}${credit ? 'CREDIT' : ''}`;
  const source = {
    postingMode: 'draft', contactId: xeroReview.contact.id, documentNumber: record.Name, invoiceDate, dueDate, currency,
    xeroCollection, xeroType, lines,
    reference: [record.STEM__r?.KeyStem__c || record.STEM__r?.Name,
      buyer ? 'Salesforce buyer invoice' : 'Salesforce supplier invoice'].filter(Boolean).join(' · '),
  };
  let payload = accountingPayload(source);
  if (currency !== organisationCurrency) payload.CurrencyRate = xeroCurrencyRate;
  if (xeroType === 'ACCPAYCREDIT') delete payload.Reference;
  const summary = buyer && !credit;
  if (summary) {
    try {
      payload = { ...payload, LineItems: nativeSalesSummaryLineItems(lines, invoiceDate, signedTotal) };
    } catch (error) {
      if (error.code !== 'XERO_SALES_SUMMARY_INVALID') throw error;
      return held(error.message);
    }
  }
  const reviewFingerprint = previewEvidenceHash({
    policy: REVIEW_POLICY, tenantId, sourceObject, documentId: record.Id, sourceFingerprint,
    organisationCurrency, xeroCollection, payload,
  });
  return { status: 'draft_preview', reviewFingerprint, summary, payload, xeroCollection, path: `/${xeroCollection}?unitdp=4&summarizeErrors=false` };
}
