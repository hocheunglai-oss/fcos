function invalid(message) {
  throw Object.assign(new Error(message), { code: 'XERO_NATIVE_DOCUMENT_EVIDENCE_INVALID', status: 409 });
}

export function exactNativeDecimal(value, scale) {
  const parts = String(value ?? '').match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!parts) invalid('Exact immutable decimal evidence is missing.');
  const shift = scale + Number(parts[4] || 0) - (parts[3] || '').length;
  if (Math.abs(shift) > 100) invalid('Immutable decimal evidence is outside supported precision.');
  let digits = BigInt(parts[2] + (parts[3] || ''));
  if (shift >= 0) digits *= 10n ** BigInt(shift);
  else { const divisor = 10n ** BigInt(-shift); if (digits % divisor !== 0n) invalid('Immutable decimal evidence exceeds its saved precision.'); digits /= divisor; }
  return parts[1] ? -digits : digits;
}

export function roundNativeHalfUp(value, divisor) {
  const magnitude = value < 0n ? -value : value;
  const rounded = (2n * magnitude + divisor) / (2n * divisor);
  return value < 0n ? -rounded : rounded;
}

// Match Salesforce's immutable line calculation. For HKD, the header converts
// the rounded native total while each line converts its unrounded native amount.
export function verifyImmutableDocumentAmounts(record, lines, principalField) {
  const currency = record.Document_Currency__c;
  if (!['HKD', 'USD'].includes(currency)) invalid('An explicit HKD or USD native document currency is required.');
  const hkd = currency === 'HKD';
  const exactLines = [];
  const principalCents = exactNativeDecimal(record[principalField], 2);
  let nativeTotal = 0n;
  let rate = null;
  if (hkd) {
    rate = exactNativeDecimal(record.Document_FX_Rate__c, 8);
    if (rate <= 0n || !String(record.Document_FX_Revision__c ?? '').trim()) {
      invalid('The immutable HKD document requires a positive company rate and revision.');
    }
  }
  for (const line of lines) {
    const native = exactNativeDecimal(line.Native_Amount__c, 6);
    const accounting = exactNativeDecimal(line.Accounting_USD__c, 6);
    if (!hkd) {
      if (native !== accounting) invalid('Managed USD line amounts must equal their accounting USD values.');
      exactLines.push(native * 100_000_000n);
      nativeTotal += native;
      continue;
    }
    let exactNative = 0n;
    switch (line.Pricing_Mode__c) {
      case 'Unit':
        exactNative = exactNativeDecimal(line.Quantity__c, 6) * exactNativeDecimal(line.Native_Unit_Price__c, 8);
        break;
      case 'Minimum':
        exactNative = exactNativeDecimal(line.Native_Minimum__c, 8) * 1_000_000n;
        break;
      case 'Lumpsum':
        exactNative = exactNativeDecimal(line.Native_Lumpsum__c, 8) * 1_000_000n;
        break;
      case 'Excluded':
        break;
      default:
        invalid('The immutable HKD line pricing mode could not be verified.');
    }
    if (roundNativeHalfUp(exactNative, 100_000_000n) !== native || roundNativeHalfUp(exactNative, rate) !== accounting) {
      invalid('Immutable HKD pricing does not reproduce the saved native and USD line amounts.');
    }
    exactLines.push(exactNative);
    nativeTotal += exactNative;
  }
  if (hkd) {
    const nativeCents = exactNativeDecimal(record.Document_HKD_Amount__c, 2);
    if (roundNativeHalfUp(nativeTotal, 1_000_000_000_000n) !== nativeCents
        || roundNativeHalfUp(nativeCents * 100_000_000n, rate) !== principalCents) {
      invalid('Immutable HKD lines and confirmed company rate do not reproduce the document totals.');
    }
  } else if (roundNativeHalfUp(nativeTotal, 10_000n) !== principalCents) {
    invalid('Immutable USD lines do not reproduce the document total.');
  }
  return { exactLines, signedCents: hkd ? exactNativeDecimal(record.Document_HKD_Amount__c, 2) : principalCents };
}
