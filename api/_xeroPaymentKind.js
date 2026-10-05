import { xeroPaymentDate } from './_xeroPaymentAssociation.js';
import { paymentCurrency } from './_xeroPaymentIdentity.js';

const REVIEWS = {
  Receivable_Remittance: {
    code: 'payment_kind_remittance_review',
    reason: 'Remittance is a batch header. Verify the complete family and individual allocations before reconciliation; do not post the header as an additional payment.',
  },
  Payable_Remittance: {
    code: 'payment_kind_remittance_review',
    reason: 'Remittance is a batch header. Verify the complete family and individual allocations before reconciliation; do not post the header as an additional payment.',
  },
  Bank_Charge: {
    code: 'payment_kind_bank_charge_review',
    reason: 'Bank charge requires the exact related cash movement, gross/net amounts and actual fee evidence without creating a duplicate payment.',
  },
  Commission: {
    code: 'payment_kind_commission_review',
    reason: 'Commission requires its exact Commission Invoice and accounting allocation, including any signed offsets, before reconciliation.',
  },
  Write_Off: {
    code: 'payment_kind_write_off_review',
    reason: 'Write-off requires verified noncash settlement treatment. It cannot be reconciled as an ordinary cash payment.',
  },
};
const UNKNOWN = {
  code: 'payment_kind_unsupported',
  reason: 'Unsupported Salesforce payment kind. Review its accounting meaning before choosing a reconciliation workflow.',
};

// This review only explains why ordinary cash allocation is unavailable. It
// never infers a bank, matches a document, or makes a payment proposal.
export function paymentKindReview(payment) {
  const type = payment?.RecordType?.DeveloperName;
  if (type === 'Receivable' || type === 'Payable') return null;
  const known = typeof type === 'string' && Object.hasOwn(REVIEWS, type);
  const kind = known ? type : 'Unknown';
  const review = known ? REVIEWS[type] : UNKNOWN;
  const blockers = [review.reason];
  const blockerCodes = [review.code];
  const add = (code, reason) => { blockerCodes.push(code); blockers.push(reason); };
  if (typeof payment?.Id !== 'string' || !/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(payment.Id)) {
    add('payment_source_identity_invalid', 'The exact Salesforce payment identity is missing or invalid.');
  }
  if (!paymentCurrency(payment) || (Array.isArray(payment?._currency?.blockers) && payment._currency.blockers.length)) {
    add('payment_source_currency_invalid', 'Authoritative Salesforce payment currency is missing or unverified.');
  }
  if (!xeroPaymentDate(payment?.Date__c)) {
    add('payment_source_date_invalid', 'The source payment date is missing or invalid.');
  }
  if (typeof payment?.Amount__c !== 'number' || !Number.isFinite(payment.Amount__c)) {
    add('payment_source_amount_invalid', 'An explicit finite numeric source amount is required; retain its recorded sign for review.');
  }
  if ((kind === 'Receivable_Remittance' || kind === 'Payable_Remittance')
    && typeof payment?._remittanceSummaryBlocker === 'string' && payment._remittanceSummaryBlocker.trim()) {
    add('payment_remittance_family_unverified', payment._remittanceSummaryBlocker);
  }
  return { kind, blockers, blockerCodes };
}
