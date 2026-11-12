import { SALES_INVOICE_SUMMARY_POLICY } from './_xeroSalesInvoiceSummary.js';
import { nativeReviewedLineView } from './_xeroNativeDocumentDraft.js';
import { nativeReadbackDecimal, verifyNativeXeroLines } from './_xeroNativeLineComparison.js';
import { previewEvidenceHash } from './_xeroPreviewPersistence.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const DOCUMENT_KINDS = {
  ACCREC: 'buyer_invoice', ACCPAY: 'supplier_bill',
  ACCRECCREDIT: 'buyer_credit', ACCPAYCREDIT: 'supplier_credit',
};

function unconfirmed(message) {
  throw Object.assign(new Error(message), { status: 409, code: 'XERO_NATIVE_DOCUMENT_UNCONFIRMED' });
}

// Builds persistence data from independently read provider evidence. The caller
// must bind expectedXeroId to the original provider operation before invoking.
export function confirmedNativeDocumentMapping({ sourceObject, source, draft, expectedXeroId, observed }) {
  const { record, sourceFingerprint, signedTotal, currency, lines, roundingAdjustment } = source;
  const payload = draft?.payload;
  const credit = signedTotal < 0;
  const expectedType = `${sourceObject === 'Invoice__c' ? 'ACCREC' : 'ACCPAY'}${credit ? 'CREDIT' : ''}`;
  const idField = credit ? 'CreditNoteID' : 'InvoiceID';
  const numberField = credit ? 'CreditNoteNumber' : 'InvoiceNumber';
  const originalLines = lines.filter(line => line.originalPriceEvidence).map(line => ({
    sourceId: line.sourceId, ...line.originalPriceEvidence, accountingQuantity: line.quantity,
    accountingUnitAmount: line.unitAmount, accountCode: line.accountCode, taxType: line.taxType,
  }));
  const companyRate = currency === 'HKD' ? nativeReadbackDecimal(record.Document_FX_Rate__c, 6) : null;
  const rateRevision = currency === 'HKD' ? record.Document_FX_Revision__c : null;
  const accountingUsd = nativeReadbackDecimal(sourceObject === 'Invoice__c' ? record.Amount__c : record.Invoice_Amount__c, 2);
  const rate = nativeReadbackDecimal(observed?.CurrencyRate, 12);
  if (!['Invoice__c', 'Supplier_Invoice__c'].includes(sourceObject) || !['USD', 'HKD'].includes(currency)
      || !Number.isFinite(signedTotal) || !signedTotal || draft?.xeroCollection !== (credit ? 'CreditNotes' : 'Invoices')
      || payload?.Type !== expectedType || payload.Status !== 'DRAFT' || !UUID.test(payload.Contact?.ContactID || '')
      || draft?.status !== 'draft_preview' || !HASH.test(draft.reviewFingerprint || '') || !HASH.test(sourceFingerprint || '')
      || !UUID.test(expectedXeroId || '') || /^0{8}(?:-0{4}){3}-0{12}$/.test(expectedXeroId)
      || observed?.[idField] !== expectedXeroId || observed?.[numberField] !== payload?.[numberField]
      || observed?.[numberField] !== record.Name || !Object.hasOwn(DOCUMENT_KINDS, payload?.Type)
      || observed.Type !== payload.Type || observed.Contact?.ContactID !== payload.Contact?.ContactID
      || observed.CurrencyCode !== currency || payload.CurrencyCode !== currency || observed.Status !== 'DRAFT'
      || !payload.Date || xeroPaymentDate(observed.Date) !== payload.Date
      || (!credit && xeroPaymentDate(observed.DueDate) !== payload.DueDate)
      || (payload.Reference && observed.Reference !== payload.Reference)
      || observed.SentToContact === true || nativeReadbackDecimal(observed.Total, 2) !== Math.abs(signedTotal)
      || rate !== (payload.CurrencyRate ?? 1) || accountingUsd == null || !originalLines.length
      || (currency === 'HKD' && (!(companyRate > 0 && companyRate <= 100) || !rateRevision?.trim()))) {
    unconfirmed('Xero did not confirm the exact original native document draft.');
  }
  verifyNativeXeroLines(observed, payload.LineItems.map(nativeReviewedLineView), { compareDescription: true });
  const currencyEvidence = {
    documentCurrency: currency, nativeAmount: Math.abs(signedTotal), accountingUsd, companyRate, rateRevision,
    confirmedAt: record.Document_FX_Confirmed_At__c,
    ...(currency === 'USD' ? { managedUsdDocument: true } : {}),
    ...(draft.summary ? { presentationPolicy: SALES_INVOICE_SUMMARY_POLICY } : {}),
    ...(roundingAdjustment ? { roundingAdjustment } : {}),
    originalLines,
  };
  return {
    salesforce_object: sourceObject, salesforce_id: record.Id, salesforce_document_number: record.Name,
    document_kind: DOCUMENT_KINDS[payload.Type], xero_document_type: payload.Type,
    xero_document_id: expectedXeroId, xero_document_number: observed[numberField],
    xero_contact_id: observed.Contact.ContactID, xero_status: observed.Status,
    source_fingerprint: sourceFingerprint, financial_fingerprint: previewEvidenceHash({ sourceFingerprint, payload }),
    protected_legacy: false, retained_differences: { differences: [], stemId: record.STEM__c,
      accountId: sourceObject === 'Invoice__c' ? record.STEM__r?.Account__c : record.Supplier__c,
      reviewFingerprint: draft.reviewFingerprint },
    currency, accounting_usd: accountingUsd, company_fx_rate: companyRate, company_fx_revision: rateRevision,
    currency_evidence: currencyEvidence, xero_currency_rate: rate,
  };
}
