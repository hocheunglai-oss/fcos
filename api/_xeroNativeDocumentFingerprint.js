import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(stableStringify(value)).digest('hex');

// Reproduce the archived native mapping format exactly. The maintained legacy
// document writer uses a different format and must keep its existing fingerprint.
export function nativeDocumentSourceFingerprint(record, lines, sourceRows, roundingAdjustment) {
  const currencyEvidence = Object.fromEntries(Object.entries(record).filter(([key]) =>
    /(?:Currency|HKD|FX|Reissue_Of_|Original_Invoice|Original_Supplier_Invoice|USD_Unit_Price_Precise__c|Fixed__c|Nundination_Type__c)/.test(key)));
  const fingerprint = hash({
    record: {
      currencyEvidence, id: record.Id, updated: record.LastModifiedDate, name: record.Name,
      amount: record.Amount__c ?? record.Invoice_Amount__c,
    },
    immutableLines: [...lines].sort((left, right) => left.Id.localeCompare(right.Id)).map(line => ({
      snapshot: immutableSnapshotFingerprint(line),
      source: immutableSourceIdentity(sourceRows.get(line.Source_Record_Id__c)),
    })),
  });
  return roundingAdjustment ? hash({ source: fingerprint, roundingAdjustment }) : fingerprint;
}

function immutableSourceIdentity(row) {
  if (!row) return null;
  return {
    id: row.Id,
    stemId: row.STEM__c || null,
    productId: row.Product__c || row.Product2Id__c || null,
    productName: row.Product__r?.Name || row.Product2Id__r?.Name || null,
  };
}

function immutableSnapshotFingerprint(row) {
  return {
    id: row?.Id || null,
    buyerInvoiceId: row?.Buyer_Invoice__c || null,
    supplierInvoiceId: row?.Supplier_Invoice__c || null,
    sourceId: row?.Source_Record_Id__c || null,
    originalLineId: row?.Original_Line__c || null,
    ...(row?.Original_Line__r ? { originalLine: row.Original_Line__r } : {}),
    description: row?.Description__c || null,
    unit: row?.Unit__c || null,
    quantity: row?.Quantity__c ?? null,
    nativeUnitPrice: row?.Native_Unit_Price__c ?? null,
    nativeAmount: row?.Native_Amount__c ?? null,
    ...(row?.Pricing_Mode__c ? { pricingMode: row.Pricing_Mode__c, nativeMinimum: row.Native_Minimum__c ?? null, nativeLumpsum: row.Native_Lumpsum__c ?? null } : {}),
    accountingUsd: row?.Accounting_USD__c ?? null,
    currency: row?.Currency__c || null,
    fxRate: row?.FX_Rate__c ?? null,
    fxRevision: row?.FX_Revision__c || null,
    updated: row?.LastModifiedDate || null,
  };
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
