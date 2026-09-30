import { accountingDecimalCents, accountingProductCents, accountingCentsNumber } from './_xeroAccountingLineCents.js';

export const SALES_INVOICE_SUMMARY_POLICY = 'sales_invoice_summary_v1';

function rejected(reason) {
  return Object.assign(new Error(`Sales invoice summary unavailable: ${reason}`), {
    code: 'XERO_SALES_SUMMARY_INVALID', status: 409, expose: true,
  });
}

// New normal sales only. Source lines and accepted financial fingerprints stay intact.
export function salesInvoiceSummaryPayload(payload, total) {
  const lines = payload?.LineItems;
  if (payload?.Type !== 'ACCREC' || payload.InvoiceID || payload.LineAmountTypes !== 'NoTax'
    || !Array.isArray(lines) || !lines.length) throw rejected('complete new no-tax sales lines are required.');
  const first = lines[0];
  if (!first.AccountCode || first.TaxType !== 'NONE' || !first.Description?.trim()) {
    throw rejected('a verified account, NONE tax and invoice-date description are required.');
  }
  const expected = accountingDecimalCents(total);
  let sum = 0n;
  for (const line of lines) {
    if (line.AccountCode !== first.AccountCode || line.TaxType !== 'NONE' || line.Description !== first.Description
      || Object.keys(line).some((key) => !['Description', 'Quantity', 'UnitAmount', 'AccountCode', 'TaxType'].includes(key))) {
      throw rejected('different accounts, taxes or other line attributes require Finance review.');
    }
    const cents = accountingProductCents(line.Quantity, line.UnitAmount);
    if (cents === null || !Number.isFinite(Number(line.Quantity)) || Number(line.Quantity) <= 0) {
      throw rejected('source quantities and amounts must be verified decimals.');
    }
    sum += cents;
  }
  if (expected === null || expected < 0n || sum !== expected) throw rejected('source lines must equal the full invoice total.');
  return { ...payload, LineItems: [{ Description: first.Description, Quantity: 1,
    UnitAmount: accountingCentsNumber(expected), AccountCode: first.AccountCode, TaxType: 'NONE' }] };
}
