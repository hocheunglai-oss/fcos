import { exactNativeDecimal } from './_xeroNativeDocumentAmounts.js';
import { accountingDecimalCents, accountingProductCents } from './_xeroAccountingLineCents.js';

function fail(message) {
  throw Object.assign(new Error(message), { code: 'XERO_NATIVE_DOCUMENT_LINES_CHANGED', status: 409 });
}

export function nativeReadbackDecimal(value, precision) {
  return ['number', 'string'].includes(typeof value)
    && new RegExp(`^-?\\d{1,12}(?:\\.\\d{1,${precision}})?$`).test(String(value))
    ? Number(value) : null;
}

function zeroOrAbsent(value) {
  return value == null || nativeReadbackDecimal(value, 12) === 0;
}

function accountingLineKey(quantityValue, unitValue, account, tax, description) {
  const quantity = nativeReadbackDecimal(quantityValue, 4);
  const unitAmount = nativeReadbackDecimal(unitValue, 4);
  if (!(quantity > 0) || unitAmount == null || typeof account !== 'string' || !account.trim()
      || typeof tax !== 'string' || !tax.trim()) {
    fail('The mapped Xero accounting line is incomplete.');
  }
  return JSON.stringify([exactNativeDecimal(quantityValue, 4).toString(),
    exactNativeDecimal(unitValue, 4).toString(), account, tax, description]);
}

const normalizedDescription = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

export function verifyNativeXeroLines(row, lines, { compareDescription = false } = {}) {
  if (!Array.isArray(lines) || !lines.length || !Array.isArray(row?.LineItems)
      || row.LineAmountTypes !== 'NoTax' || nativeReadbackDecimal(row.TotalTax, 2) !== 0
      || !zeroOrAbsent(row.RoundingAmount) || !zeroOrAbsent(row.TotalDiscount)
      || row.IsDiscounted === true || row.HasErrors === true || row.HasValidationErrors === true
      || (row.ValidationErrors != null && (!Array.isArray(row.ValidationErrors) || row.ValidationErrors.length))) {
    fail('The exact no-tax Xero accounting lines could not be read.');
  }
  const expected = lines.map(line => accountingLineKey(line?.quantity, line?.unitAmount, line?.accountCode, line?.taxType,
    compareDescription ? normalizedDescription(line?.description) : undefined));
  let lineTotal = 0n;
  const actual = row.LineItems.map(line => {
    const key = accountingLineKey(line?.Quantity, line?.UnitAmount, line?.AccountCode, line?.TaxType, compareDescription ? normalizedDescription(line?.Description) : undefined);
    const product = accountingProductCents(line.Quantity, line.UnitAmount);
    if (line.HasValidationErrors === true || line.ItemCode || line.Item?.ItemID || product == null || nativeReadbackDecimal(line.LineAmount, 2) == null || accountingDecimalCents(line.LineAmount) !== product
        || !zeroOrAbsent(line.TaxAmount) || !zeroOrAbsent(line.DiscountRate) || !zeroOrAbsent(line.DiscountAmount)
        || (line.Tracking != null && (!Array.isArray(line.Tracking) || line.Tracking.length))
        || (line.ValidationErrors != null && (!Array.isArray(line.ValidationErrors) || line.ValidationErrors.length))) {
      fail('Xero returned changed or incomplete accounting line amounts, taxes or discounts.');
    }
    lineTotal += product;
    return key;
  });
  expected.sort();
  actual.sort();
  if (nativeReadbackDecimal(row.Total, 2) == null || nativeReadbackDecimal(row.SubTotal, 2) == null
      || accountingDecimalCents(row.Total) !== lineTotal || accountingDecimalCents(row.SubTotal) !== lineTotal
      || expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail('Current Xero accounting lines do not match the reviewed native document.');
  }
}
