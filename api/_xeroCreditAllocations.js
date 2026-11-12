import { createHash } from 'node:crypto';
import { usdFromHkd } from './_companyFxRates.js';
import { accountingDecimalCents } from './_xeroAccountingLineCents.js';
import { paymentSourceFingerprint } from './_xeroFinancialSync.js';
import { exactNativeDecimal as scaled, verifyImmutableDocumentAmounts } from './_xeroNativeDocumentAmounts.js';
import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import { reconcilePrepaymentLedger, prepaymentApprovalEvidence } from './_xeroPrepaymentReconciliation.js';

const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
function cents(value) {
  const result = accountingDecimalCents(value);
  if (result == null || !Number.isSafeInteger(Number(result))) reject('Explicit native balance evidence is required.');
  return Number(result);
}
const sameSource = (left, right) => Boolean(left && right && left.slice(0, 15) === right.slice(0, 15));
const stable = value => value == null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(stable).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
function reject(message, code = 'XERO_CREDIT_ALLOCATION_INVALID', status = 409) { throw Object.assign(new Error(message), { code, status }); }
function requiredAmount(value) {
  const minor = scaled(value, 2);
  if (!Number.isSafeInteger(Number(minor))) reject('Explicit native balance evidence is required.');
  return Number(minor) / 100;
}

function dateOnly(value) {
  const date = xeroPaymentDate(value);
  if (!date) reject('The credit allocation date could not be verified.');
  return date;
}

function allocationsOf(credit) {
  if (!Array.isArray(credit?.Allocations)) reject('Xero credit allocation history is incomplete.');
  const allocations = credit.Allocations.map((row) => {
    if (row?.AllocationID && row.AllocationId && row.AllocationID !== row.AllocationId) reject('Xero returned conflicting allocation IDs.');
    const { AllocationId, ...details } = row || {};
    const id = details.AllocationID || AllocationId;
    if (!uuid(id)) reject('A Xero credit allocation has no exact identity.');
    return { ...details, AllocationID: id };
  });
  if (new Set(allocations.map((row) => row.AllocationID)).size !== allocations.length) reject('Xero returned duplicate allocation IDs.');
  return allocations;
}

function exactInverse(left, right, scale, nullable = false) {
  if (left == null || right == null) return nullable && left == null && right == null;
  return scaled(left, scale) === -scaled(right, scale);
}

/** Pure review: no contact/name heuristics, no cross-currency netting, no mutation. */
export function reviewCreditAllocation({ credit, original, creditMapping, invoiceMapping, xeroCredit, xeroInvoice, sourceCredit, sourceOriginal, documentLines = [], payments = [], paymentMappings = [], xeroPayments = [], allocationLedger = [], cashLedger = null }) {
  const blockers = [];
  try {
    if (!credit || !original || !creditMapping || !invoiceMapping || !xeroCredit || !xeroInvoice) reject('The exact original invoice, full credit and durable Xero mappings are required.');
    const supplier = Boolean(credit.Original_Supplier_Invoice__c);
    const originalId = credit.Original_Invoice__c || credit.Original_Supplier_Invoice__c;
    if (original.Id !== originalId || !sameSource(creditMapping.salesforce_id, credit.Id) || !sameSource(invoiceMapping.salesforce_id, original.Id)
      || creditMapping.salesforce_object !== (supplier ? 'Supplier_Invoice__c' : 'Invoice__c') || creditMapping.salesforce_object !== invoiceMapping.salesforce_object
      || creditMapping.xero_document_id !== xeroCredit.CreditNoteID || invoiceMapping.xero_document_id !== xeroInvoice.InvoiceID) reject('Exact original-document mapping identity does not match.');
    if (!(supplier ? credit.Invoice_File__c && original.Invoice_File__c : credit.File__c && original.File__c)) reject('Both original and credit must have issued document files.');
    if (!credit.STEM__c || credit.STEM__c !== original.STEM__c || !credit.Document_FX_Side__c || credit.Document_FX_Side__c !== original.Document_FX_Side__c
      || supplier && (!credit.Supplier__c || credit.Supplier__c !== original.Supplier__c)) reject('Credit STEM, supplier or confirmed trading side differs from the original.');
    const currency = credit.Document_Currency__c;
    if (!['HKD', 'USD'].includes(currency) || original.Document_Currency__c !== currency || xeroCredit.CurrencyCode !== currency || xeroInvoice.CurrencyCode !== currency) reject('Credit allocation requires the same explicit document currency.');
    if (!credit.Document_FX_Fingerprint__c || !original.Document_FX_Fingerprint__c || !Number.isFinite(Date.parse(credit.Document_FX_Confirmed_At__c))) reject('Confirmed immutable document fingerprints and timestamps are required.');
    if (currency === 'USD' && [credit, original].some(row => row.Document_HKD_Amount__c != null || row.Document_FX_Rate__c != null || row.Document_FX_Revision__c != null)) reject('Managed USD allocation must not contain HKD or company-rate evidence.');
    const principal = row => requiredAmount(supplier ? row.Invoice_Amount__c : row.Amount__c);
    const native = row => currency === 'HKD' ? requiredAmount(row.Document_HKD_Amount__c) : principal(row);
    if (native(original) <= 0 || cents(native(credit)) !== -cents(native(original)) || cents(principal(credit)) !== -cents(principal(original))) reject('The credit must fully reverse the immutable original native and accounting totals.');
    for (const key of ['Document_FX_Rate__c','Document_FX_Revision__c','Document_FX_Confirmed_At__c']) if (credit[key] !== original[key]) reject('Credit rate evidence differs from the original.');
    if (!sourceCredit || !sourceOriginal || sourceCredit.blockers?.length || sourceOriginal.blockers?.length || sourceCredit.differences?.length || sourceOriginal.differences?.length
      || creditMapping.source_fingerprint !== sourceCredit.sourceFingerprint || invoiceMapping.source_fingerprint !== sourceOriginal.sourceFingerprint) reject(`Reconcile immutable Salesforce document mappings before allocating credit. ${[...(sourceCredit?.blockers || []), ...(sourceOriginal?.blockers || []), ...(sourceCredit?.differences || []), ...(sourceOriginal?.differences || [])].map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('; ')}`);
    const originalLines = new Map(documentLines.filter(line => (supplier ? line.Supplier_Invoice__c : line.Buyer_Invoice__c) === original.Id).map(line => [line.Id, line]));
    const creditLines = documentLines.filter(line => (supplier ? line.Supplier_Invoice__c : line.Buyer_Invoice__c) === credit.Id);
    const parent = supplier ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
    const otherParent = supplier ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c';
    if (!originalLines.size || creditLines.length !== originalLines.size || new Set(creditLines.map(line => line.Original_Line__c)).size !== originalLines.size
      || creditLines.some(line => {
        const prior = originalLines.get(line.Original_Line__c);
        return !prior || !prior.Source_Record_Id__c || prior.Source_Record_Id__c !== line.Source_Record_Id__c
          || line[parent] !== credit.Id || prior[parent] !== original.Id || line[otherParent] || prior[otherParent]
          || !exactInverse(line.Native_Amount__c, prior.Native_Amount__c, 6)
          || !exactInverse(line.Accounting_USD__c, prior.Accounting_USD__c, 6)
          || !exactInverse(line.Native_Unit_Price__c, prior.Native_Unit_Price__c, 8)
          || !exactInverse(line.Native_Minimum__c, prior.Native_Minimum__c, 8, true)
          || !exactInverse(line.Native_Lumpsum__c, prior.Native_Lumpsum__c, 8, true)
          || scaled(line.Quantity__c, 6) !== scaled(prior.Quantity__c, 6)
          || ['Unit__c','Description__c','Pricing_Mode__c','Currency__c','FX_Rate__c','FX_Revision__c'].some(key => (line[key] ?? null) !== (prior[key] ?? null))
          || prior.Currency__c !== currency || (prior.FX_Rate__c ?? null) !== (original.Document_FX_Rate__c ?? null) || (prior.FX_Revision__c ?? null) !== (original.Document_FX_Revision__c ?? null) || !['Unit','Minimum','Lumpsum','Excluded'].includes(prior.Pricing_Mode__c);
      })) reject('Credit lines do not exactly reverse their original immutable line identities and values.');

    const principalField = supplier ? 'Invoice_Amount__c' : 'Amount__c';
    verifyImmutableDocumentAmounts(original, originalLines.values(), principalField);
    verifyImmutableDocumentAmounts(credit, creditLines, principalField);

    if (xeroCredit.Type !== (supplier ? 'ACCPAYCREDIT' : 'ACCRECCREDIT') || xeroInvoice.Type !== (supplier ? 'ACCPAY' : 'ACCREC')
      || xeroCredit.Contact?.ContactID !== xeroInvoice.Contact?.ContactID || !xeroCredit.Contact?.ContactID) reject('Xero contact or document direction differs.');
    if (cents(xeroCredit.Total) !== cents(native(original)) || cents(xeroInvoice.Total) !== cents(native(original))) reject('Xero original and full credit totals differ from immutable native totals.');
    if (currency === 'HKD' && xeroCredit.CurrencyRate !== xeroInvoice.CurrencyRate) reject('Xero original and credit rates differ.');
    if (!['AUTHORISED','PAID'].includes(xeroCredit.Status) || !['AUTHORISED','PAID'].includes(xeroInvoice.Status)) reject('Both Xero documents must be authorised.');
    const due = requiredAmount(xeroInvoice.AmountDue); const remaining = requiredAmount(xeroCredit.RemainingCredit);
    if (due < 0 || remaining < 0) reject('Negative outstanding balances require reconciliation.');
    const allocations = allocationsOf(xeroCredit);
    if (allocations.some(item => item.Invoice?.InvoiceID !== xeroInvoice.InvoiceID)) reject('This credit already allocates to another invoice.');
    const carrying = validateAllocationCash({ credit, original, currency, supplier, payments, paymentMappings, xeroPayments, xeroCredit, xeroInvoice, allocations, allocationLedger, creditMapping, invoiceMapping, cashLedger });
    const allocationDate = [dateOnly(xeroInvoice.Date), dateOnly(xeroCredit.Date)].sort().at(-1);
    const amount = cents(due) / 100;
    if (amount > 0 && (xeroCredit.Status !== 'AUTHORISED' || cents(remaining) < cents(amount))) reject('Remaining credit cannot cover the original outstanding invoice.');
    const evidence = { credit, original, creditMapping, invoiceMapping, xeroCredit, xeroInvoice,
      sourceCredit: sourceCredit.sourceFingerprint, sourceOriginal: sourceOriginal.sourceFingerprint, documentLines, payments, paymentMappings, xeroPayments, allocationLedger,
      ...(cashLedger ? {cashLedger:prepaymentApprovalEvidence(cashLedger)} : {}) };
    const reviewFingerprint = hash(evidence);
    const proposedPayload = { Allocations: [{ Amount: amount, Invoice: { InvoiceID: xeroInvoice.InvoiceID } }] };
    const proposal = amount > 0 ? { method: 'PUT', path: `/CreditNotes/${xeroCredit.CreditNoteID}/Allocations`,
      payload: proposedPayload, headers: { 'Idempotency-Key': `fcos-credit-${reviewFingerprint}` } } : null;
    return { key: credit.Id, creditId: credit.Id, originalId: original.Id, creditNumber: credit.Name ?? null, originalNumber: original.Name ?? null,
      creditMappingId: creditMapping.id, invoiceMappingId: invoiceMapping.id, xeroCreditId: xeroCredit.CreditNoteID, xeroInvoiceId: xeroInvoice.InvoiceID,
      currency, amount, accountingUsd: carrying.remainingUsd,
      invoiceAmountDue: due, creditRemaining: remaining, residualCredit: Math.round((remaining - amount) * 100) / 100,
      allocationDate, status: amount > 0 ? 'eligible' : 'reconciled', action: amount > 0 ? 'credit_allocate' : 'credit_allocation_link',
      reviewFingerprint, evidence, blockers: [], proposedPayload, proposal };
  } catch (error) { blockers.push(error.message); }
  return { key: credit?.Id, creditNumber: credit?.Name, originalNumber: original?.Name, status: 'blocked', action: 'blocked', blockers };
}

export function validateAllocationCash({ credit, original, currency, supplier, payments, paymentMappings, xeroPayments, xeroCredit, xeroInvoice, allocations, allocationLedger = [], creditMapping, invoiceMapping, cashLedger = null }) {
  const target = supplier ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
  const allCash = payments.filter(payment => [original.Id, credit.Id].includes(payment[target]));
  const bridges = allCash.filter(row=>row.Cash_Event__c);
  if(bridges.length) {
    if(!cashLedger) reject('Read and reconcile the complete original prepayment history before allocating this credit.');
    reconcilePrepaymentLedger(cashLedger);
    if(hash(cashLedger.xeroInvoices.find(row=>row.InvoiceID===xeroInvoice.InvoiceID))!==hash(xeroInvoice)) reject('Xero invoice balances changed between cash and credit review. Refresh again.');
    if(bridges.some(row=>!cashLedger.payments.some(saved=>saved.Id===row.Id && paymentSourceFingerprint(saved)===paymentSourceFingerprint(row)))
      || cashLedger.payments.some(row=>row.Cash_Event__c && row[target]===original.Id && !bridges.some(saved=>saved.Id===row.Id)))
      reject('The credit and prepayment reviews contain different Salesforce cash applications.');
    const nativeNet=bridges.reduce((sum,row)=>sum+cents(requiredAmount(currency==='HKD'?row.Payment_HKD_Amount__c:row.Amount__c)),0);
    const carryingNet=bridges.reduce((sum,row)=>sum+cents(requiredAmount(row.Invoice_Carrying_USD__c)),0);
    if(nativeNet!==0 || carryingNet!==0 || (xeroInvoice.Prepayments || []).length)
      reject('Reverse the invoice cash applications in Salesforce and Xero before allocating the full credit.');
  }
  if (allocationLedger.some((row) => ['processing', 'unknown', 'exception'].includes(row.status))) {
    reject('Resolve the existing credit allocation before reviewing another.');
  }
  const cash = allCash.filter(row=>!row.Cash_Event__c);
  const ambiguous = payments.some(payment => payment.STEM__c === original.STEM__c && !payment[target]
    && payment.RecordType?.DeveloperName === (supplier ? 'Payable' : 'Receivable')
    && (!supplier || payment.Account__c === original.Supplier__c));
  if (ambiguous) reject('Allocate historical Salesforce cash to its exact invoice before applying a credit.');
  let paidCents = 0; let refundedCents = 0; let paidCarryingCents = 0; const matched = new Set();
  for (const payment of cash) {
    const refund = payment[target] === credit.Id;
    const mappings = paymentMappings.filter(row => sameSource(row.salesforce_payment_id, payment.Id));
    const mapping = mappings.length === 1 ? mappings[0] : null;
    const matches = mapping ? xeroPayments.filter(row => row.PaymentID === mapping.xero_payment_id && row.Status === 'AUTHORISED') : [];
    const live = matches.length === 1 ? matches[0] : null;
    const amount = requiredAmount(currency === 'HKD' ? payment.Payment_HKD_Amount__c : payment.Amount__c);
    if ((payment.Payment_Currency__c || 'USD') !== currency || (amount < 0) !== refund || amount === 0
      || !mapping || mapping.document_mapping_id !== (refund ? creditMapping.id : invoiceMapping.id)
      || mapping.source_fingerprint !== paymentSourceFingerprint(payment) || !live
      || (refund ? live.CreditNote?.CreditNoteID : live.Invoice?.InvoiceID) !== (refund ? xeroCredit.CreditNoteID : xeroInvoice.InvoiceID)
      || cents(live.Amount) !== Math.abs(cents(amount)) || dateOnly(live.Date) !== dateOnly(payment.Date__c)
      || mapping.xero_bank_account_id !== live.Account?.AccountID)
      reject('Salesforce cash/refunds require exact reconciled Xero payment mappings before credit allocation.');
    const documentCurrency = (refund ? live.CreditNote : live.Invoice)?.CurrencyCode;
    if (documentCurrency && documentCurrency !== currency) reject('A reconciled payment has a different native currency.');
    if (matched.has(live.PaymentID)) reject('More than one Salesforce payment claims the same Xero payment.');
    matched.add(live.PaymentID);
    if (currency === 'HKD') {
      if (cents(requiredAmount(payment.Amount__c)) !== cents(usdFromHkd(amount, payment.Payment_FX_Rate__c))
        || Math.abs(cents(requiredAmount(payment.Invoice_Carrying_USD__c)) - cents(usdFromHkd(amount, original.Document_FX_Rate__c))) > 1
        || !(Number(mapping.xero_currency_rate) > 0) || Number(live.CurrencyRate) !== Number(mapping.xero_currency_rate)
        || mapping.xero_bank_amount == null || cents(live.BankAmount) !== cents(mapping.xero_bank_amount)) {
        reject('Native HKD payment carrying, Xero rate or bank evidence changed.');
      }
    } else if (cents(payment.Amount__c) !== cents(requiredAmount(payment.Invoice_Carrying_USD__c))) reject('Managed USD cash and carrying must match.');
    if (refund) refundedCents += Math.abs(cents(amount)); else { paidCents += cents(amount); paidCarryingCents += cents(requiredAmount(payment.Invoice_Carrying_USD__c)); }
  }
  const relevantXero = xeroPayments.filter(row => row.Status !== 'DELETED' && (row.Invoice?.InvoiceID === xeroInvoice.InvoiceID || row.CreditNote?.CreditNoteID === xeroCredit.CreditNoteID));
  if (relevantXero.some(row => !matched.has(row.PaymentID))) reject('Xero contains cash or refunds missing from exact Salesforce allocations.');
  const allocatedCents = allocations.reduce((sum, row) => sum + cents(requiredAmount(row.Amount)), 0);
  if (allocations.some(row => !row.AllocationID || Number(row.Amount) <= 0) || new Set(allocations.map(row => row.AllocationID)).size !== allocations.length) reject('Existing Xero allocation identities are invalid.');
  if (refundedCents > paidCents) reject('Refunds exceed cash received on the original invoice.');
  if (cents(xeroInvoice.Total) - paidCents - allocatedCents !== cents(xeroInvoice.AmountDue)
    || cents(xeroCredit.Total) - refundedCents - allocatedCents !== cents(xeroCredit.RemainingCredit)) reject('Xero outstanding balances do not reconcile to Salesforce cash, refunds and exact credit allocations.');
  let allocatedCarryingCents = 0;
  for (const allocation of allocations) {
    const matches = allocationLedger.filter(row => row.status === 'applied' && row.xero_allocation_id === allocation.AllocationID);
    const prior = matches[0];
    if (matches.length !== 1 || prior.credit_mapping_id !== creditMapping?.id || prior.invoice_mapping_id !== invoiceMapping?.id
      || prior.currency !== currency || cents(prior.native_amount) !== cents(allocation.Amount)
      || prior.request_evidence?.xeroCreditId !== xeroCredit.CreditNoteID || prior.request_evidence?.xeroInvoiceId !== xeroInvoice.InvoiceID
      || ['Id','Document_Currency__c','Document_FX_Rate__c','Document_FX_Revision__c','Document_FX_Confirmed_At__c','Document_FX_Fingerprint__c'].some(key => (prior.request_evidence?.evidence?.original?.[key] ?? null) !== (original[key] ?? null))
      || prior.accounting_usd == null || Number(prior.accounting_usd) < 0
      || cents(prior.accounting_usd) !== cents(prior.request_evidence?.accountingUsd))
      reject('Prior Xero allocation USD carrying requires exact applied durable evidence.');
    allocatedCarryingCents += cents(requiredAmount(prior.accounting_usd));
  }
  const remainingCents = cents(requiredAmount(supplier ? original.Invoice_Amount__c : original.Amount__c)) - paidCarryingCents - allocatedCarryingCents;
  if (remainingCents < 0 || cents(xeroInvoice.AmountDue) === 0 && remainingCents !== 0)
    reject('Original invoice USD carrying does not reconcile to its remaining native balance.');
  return { remainingUsd: remainingCents / 100 };

}

/** Re-read recovery never sends a second allocation request. */
export function reconcileCreditAllocation(operation, xeroCredit, xeroInvoice) {
  const request = operation.request_evidence;
  if (xeroCredit?.CreditNoteID !== request.xeroCreditId || xeroInvoice?.InvoiceID !== request.xeroInvoiceId
    || xeroCredit.CurrencyCode !== request.currency || xeroInvoice.CurrencyCode !== request.currency) reject('Allocation readback identity or currency differs.');
  const baseline = request.evidence;
  if ([['xeroCredit', xeroCredit], ['xeroInvoice', xeroInvoice]].some(([key, current]) => {
    const previous = baseline[key];
    return !['AUTHORISED', 'PAID'].includes(current.Status) || current.Type !== previous.Type
      || current.Contact?.ContactID !== previous.Contact?.ContactID || cents(current.Total) !== cents(previous.Total)
      || Number(current.CurrencyRate ?? 1) !== Number(previous.CurrencyRate ?? 1);
  })) reject('Credit or invoice account, amount or exchange-rate evidence changed.');
  const currentAllocations = allocationsOf(xeroCredit);
  const priorAllocations = allocationsOf(request.evidence.xeroCredit);
  const matches = currentAllocations.filter(row => row.Invoice?.InvoiceID === request.xeroInvoiceId && cents(row.Amount) === cents(request.amount));
  const priorIds = new Set(priorAllocations.map(row => row.AllocationID));
  const fresh = matches.filter(row => row.AllocationID && !priorIds.has(row.AllocationID));
  const allocationIdentity = row => ({ id: row.AllocationID, invoiceId: row.Invoice?.InvoiceID, amount: cents(row.Amount), date: dateOnly(row.Date) });
  for (const prior of priorAllocations) {
    const current = currentAllocations.find(row => row.AllocationID === prior.AllocationID);
    if (!current || hash(allocationIdentity(current)) !== hash(allocationIdentity(prior))) reject('An existing credit allocation changed during execution.', 'XERO_CREDIT_ALLOCATION_UNKNOWN');
  }
  if (currentAllocations.filter(row => !priorIds.has(row.AllocationID)).length !== 1) reject('More than one new allocation appeared during execution.', 'XERO_CREDIT_ALLOCATION_UNKNOWN');
  if (fresh.length !== 1 || operation.xero_allocation_id && fresh[0].AllocationID !== operation.xero_allocation_id) reject('The allocation outcome is uncertain or ambiguous. Reconcile in Xero before retrying.','XERO_CREDIT_ALLOCATION_UNKNOWN');
  if (dateOnly(fresh[0].Date) !== request.allocationDate) reject('The returned allocation date differs from the document dates.', 'XERO_CREDIT_ALLOCATION_UNKNOWN');
  if (cents(xeroInvoice.AmountDue) !== cents(request.invoiceAmountDue) - cents(request.amount) || cents(xeroCredit.RemainingCredit) !== cents(request.creditRemaining) - cents(request.amount)) reject('Xero balances do not match the reviewed allocation outcome.','XERO_CREDIT_ALLOCATION_UNKNOWN');
  return { allocationId: fresh[0].AllocationID, allocation: fresh[0], invoice: xeroInvoice, credit: xeroCredit };
}
