function finiteAmount(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return String(value || '').trim();
}

/** Prefer explicit credit-note flags when available; retain legacy CN names. */
export function isBuyerCreditNote(invoice) {
  return Boolean(invoice)
    && (invoice.Is_Credit_Note__c === true
      || invoice.Credit_Note__c === true
      || invoice.CreditNote__c === true
      || /(?:^|-)CN(?:-|$)/i.test(text(invoice.Name)));
}

export function isFinalBuyerInvoice(invoice) {
  return Boolean(invoice)
    && invoice.Proforma__c !== true
    && invoice.Deprecated__c !== true
    && !isBuyerCreditNote(invoice);
}

export function resolveBuyerFinancialAmount({
  salesforceAmount,
  calculatedAmount,
  finalInvoiceIssued,
} = {}) {
  const issuedAmount = finiteAmount(salesforceAmount);
  const expectedAmount = finiteAmount(calculatedAmount);
  if (finalInvoiceIssued === true) {
    return {
      amount: issuedAmount,
      source: 'issued_invoice',
      calculatedAmount: expectedAmount,
    };
  }
  if (expectedAmount != null && expectedAmount > 0) {
    return {
      amount: expectedAmount,
      source: 'calculated_unissued',
      calculatedAmount: expectedAmount,
    };
  }
  return {
    amount: issuedAmount,
    source: issuedAmount == null ? 'unavailable' : 'salesforce_unissued_fallback',
    calculatedAmount: expectedAmount,
  };
}
