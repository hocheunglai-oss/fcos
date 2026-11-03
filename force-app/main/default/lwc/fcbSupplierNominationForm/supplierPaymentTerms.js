export const SUPPLIER_PARTIAL_CIA_AMOUNT_ERROR = 'Supplier partial CIA requires a positive, valid Partial Lumpsum Buy At amount with two decimal places on every included partial-CIA product line. Correct the amounts, then reopen the nomination.';
export const SUPPLIER_BALANCE_TERM_ERROR = 'Select a valid supplier Payment Term with a name and description. Partial CIA requires a non-CIA balance term. Correct the supplier Payment Term, then reopen the nomination.';
export const SUPPLIER_PARTIAL_CIA_SOURCE_ERROR = 'The supplier partial-CIA source contains duplicate product line IDs or an amount outside the supported currency range. Refresh the source, then reopen the nomination.';
export const SUPPLIER_PARTIAL_CIA_FORM_ERROR = 'The partial CIA PAYMENT row must match the included supplier product amounts and selected balance term. Reopen the nomination to restore the approved wording before previewing or generating.';

export function getIncludedSupplierLines(lineItems, supplierId, paymentTermKey) {
    return (lineItems || []).filter(line => line.Original_Supplier__c === supplierId
        && line.Payment_Term__c === paymentTermKey && line.Cancelled__c !== true);
}

export function buildSupplierPaymentTerm({ lineItems, supplierId, paymentTermKey, paymentTerms }) {
    const includedLines = getIncludedSupplierLines(lineItems, supplierId, paymentTermKey);
    const partialLines = includedLines.filter(line => line.Partial_CIA__c);
    const selectedKey = String(paymentTermKey || '').trim().toUpperCase();
    const matchingTerms = (paymentTerms || []).filter(term => String(term.Name || '').trim().toUpperCase() === selectedKey);
    const paymentTerm = matchingTerms[0];
    if (!selectedKey || !paymentTerm) throw new Error(SUPPLIER_BALANCE_TERM_ERROR);

    if (!partialLines.length) {
        return (paymentTerm.Name.split(' ')[0] + ' ' + paymentTerm.Description__c).toLocaleUpperCase();
    }

    const termToken = selectedKey.split(/\s+/u)[0];
    const description = String(paymentTerm.Description__c || '').trim().toUpperCase();
    if (termToken === 'CIA' || !description
        || matchingTerms.some(term => String(term.Description__c || '').trim().toUpperCase() !== description)) {
        throw new Error(SUPPLIER_BALANCE_TERM_ERROR);
    }

    let totalCents = 0;
    const lineIds = new Set();
    for (const line of partialLines) {
        if (line.Id && lineIds.has(line.Id)) throw new Error(SUPPLIER_PARTIAL_CIA_SOURCE_ERROR);
        if (line.Id) lineIds.add(line.Id);
        const sourceAmount = line.Partial_Lumpsum_Buy_At__c;
        const amount = typeof sourceAmount === 'number' || (typeof sourceAmount === 'string' && sourceAmount.trim())
            ? Number(sourceAmount)
            : NaN;
        const cents = Math.round(amount * 100);
        if (!Number.isFinite(amount) || amount <= 0 || cents / 100 !== amount) {
            throw new Error(SUPPLIER_PARTIAL_CIA_AMOUNT_ERROR);
        }
        if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(totalCents + cents)) {
            throw new Error(SUPPLIER_PARTIAL_CIA_SOURCE_ERROR);
        }
        totalCents += cents;
    }

    const formattedAmount = `${Math.floor(totalCents / 100).toLocaleString('en-US')}.${String(totalCents % 100).padStart(2, '0')}`;
    return `USD ${formattedAmount} BASIS CASH IN ADVANCE, BALANCE ON ${termToken} ${description}`;
}
