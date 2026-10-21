export const PARTIAL_CIA_AMOUNT_ERROR = 'Partial CIA requires a positive, valid Partial Lumpsum Sell At amount on the STEM. Correct the amount, then reopen the invoice.';
export const PARTIAL_CIA_BALANCE_TERM_ERROR = 'Partial CIA requires a valid non-CIA balance Payment Term on the STEM, with a name and description. Correct the Payment Term, then reopen the invoice.';
export const PARTIAL_CIA_FORM_TERM_ERROR = 'The partial CIA Payment Term must match the current STEM amount and balance term. Reopen the invoice to restore the approved wording before generating.';

export function buildInvoicePaymentTerm(stem, paymentTerm) {
    if (!stem?.Partial_CIA__c) {
        return paymentTerm.Name !== 'CIA'
            ? paymentTerm.Name?.toUpperCase() + ' ' + paymentTerm.Description__c?.toUpperCase()
            : paymentTerm.Description__c?.toUpperCase();
    }

    const sourceAmount = stem.Partial_Lumpsum_Sell_At__c;
    const amount = typeof sourceAmount === 'number' || (typeof sourceAmount === 'string' && sourceAmount.trim())
        ? Number(sourceAmount)
        : NaN;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(PARTIAL_CIA_AMOUNT_ERROR);

    const selectedTerm = String(stem.Payment_Term__c || '').trim().toUpperCase();
    const name = String(paymentTerm?.Name || '').trim().toUpperCase();
    const description = String(paymentTerm?.Description__c || '').trim().toUpperCase();
    if (!selectedTerm || !name || !description || selectedTerm === 'CIA' || name === 'CIA' || name !== selectedTerm) {
        throw new Error(PARTIAL_CIA_BALANCE_TERM_ERROR);
    }

    const formattedAmount = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `USD ${formattedAmount} BASIS CASH IN ADVANCE, BALANCE ON ${name} ${description}`;
}
