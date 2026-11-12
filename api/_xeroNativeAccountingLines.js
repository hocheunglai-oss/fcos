import { isDeepStrictEqual } from 'node:util';
import { accountingCentsNumber, accountingProductCents } from './_xeroAccountingLineCents.js';
import { exactNativeDecimal, roundNativeHalfUp, verifyImmutableDocumentAmounts } from './_xeroNativeDocumentAmounts.js';

const sfId = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;
const pricingModes = ['Unit', 'Minimum', 'Lumpsum', 'Excluded'];
const absolute = value => value < 0n ? -value : value;

function invalid(message) {
  throw Object.assign(new Error(message), { status: 409, code: 'XERO_NATIVE_ACCOUNTING_LINES_INVALID' });
}

function fourPlaces(value, scale) {
  const units = roundNativeHalfUp(value, 10n ** BigInt(scale - 4));
  if (!Number.isSafeInteger(Number(units))) invalid('Native accounting quantity or unit price exceeds Xero precision.');
  return Number(units) / 10000;
}

function exactNativeText(value) {
  const digits = absolute(value).toString().padStart(15, '0');
  return `${value < 0n ? '-' : ''}${digits.slice(0, -14)}.${digits.slice(-14)}`;
}

function buildRoundingAdjustment({
  currency, tenantId, residual, documentCents, emittedCents, policy, originalMapping, credit,
}) {
  const previous = originalMapping?.currency_evidence?.roundingAdjustment;
  if (!residual && !previous) return null;
  const selected = credit || previous ? previous?.policy : policy;
  if (!selected || selected.tenant_id !== tenantId || selected.currency !== currency
      || !selected.account_id || !selected.account_code || !selected.tax_type
      || !Number.isInteger(selected.revision) || selected.revision < 1
      || !Number.isInteger(selected.max_native_cents) || selected.max_native_cents <= 0
      || absolute(residual) > BigInt(selected.max_native_cents) || (!credit && !previous && selected.enabled !== true)) {
    invalid('A matching Finance-approved rounding policy is required for this native residual.');
  }
  const adjustment = {
    currency, documentCents: Number(documentCents), roundedLineCents: Number(emittedCents), adjustmentCents: Number(residual),
    policy: { tenant_id: selected.tenant_id, currency: selected.currency, revision: selected.revision,
      account_id: selected.account_id, account_code: selected.account_code, tax_type: selected.tax_type,
      max_native_cents: selected.max_native_cents },
  };
  if ((credit || previous) && !isDeepStrictEqual(adjustment, previous)) invalid('The saved original rounding evidence changed.');
  if (credit) {
    if (!originalMapping.id || !/^[a-f0-9]{64}$/.test(originalMapping.source_fingerprint || '')) {
      invalid('Credit rounding requires the exact original mapping and source fingerprint.');
    }
    return { ...adjustment, reversal: true, originalMappingId: originalMapping.id,
      originalSourceFingerprint: originalMapping.source_fingerprint };
  }
  return adjustment;
}

// This only builds immutable accounting evidence. Provider admission and
// approval of any new rounding account remain at the Finance apply boundary.
export function buildNativeAccountingLines({
  record, direction, snapshots, sourceRows, productMappings, tenantId, roundingPolicy, originalMapping,
}) {
  if (!['buyer', 'supplier'].includes(direction) || !Array.isArray(snapshots) || !snapshots.length) {
    invalid('An exact issued native document and its immutable lines are required.');
  }
  const buyer = direction === 'buyer';
  const currency = record?.Document_Currency__c;
  const parent = buyer ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c';
  const otherParent = buyer ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c';
  const lineage = buyer ? 'Original_Invoice__c' : 'Original_Supplier_Invoice__c';
  const reissue = buyer ? 'Reissue_Of_Invoice__c' : 'Reissue_Of_Supplier_Invoice__c';
  const sourceObject = buyer ? 'Invoice__c' : 'Supplier_Invoice__c';
  if (!sfId.test(record?.Id || '') || !sfId.test(record.STEM__c || '') || record.Proforma__c !== false
      || (buyer && record.Deprecated__c !== false) || !record[buyer ? 'File__c' : 'Invoice_File__c']
      || !record.Document_FX_Side__c || !Number.isFinite(Date.parse(record.Document_FX_Confirmed_At__c))
      || !String(record.Document_FX_Fingerprint__c || '').trim()
      || (currency === 'USD' && [record.Document_HKD_Amount__c, record.Document_FX_Rate__c, record.Document_FX_Revision__c]
        .some(value => value != null))) {
    invalid('The issued document lacks complete immutable native currency evidence.');
  }
  const expectedMappingSource = record[lineage] || record.Id;
  if (originalMapping && (originalMapping.salesforce_id !== expectedMappingSource || originalMapping.salesforce_object !== sourceObject)) {
    invalid('The supplied rounding mapping belongs to a different Salesforce document.');
  }
  const rows = [...snapshots].sort((left, right) => String(left.Id).localeCompare(String(right.Id)));
  const { exactLines, signedCents } = verifyImmutableDocumentAmounts(record, rows, buyer ? 'Amount__c' : 'Invoice_Amount__c');
  const documentCents = absolute(signedCents);
  const credit = signedCents < 0n;
  if (!documentCents || accountingCentsNumber(documentCents) == null || credit !== Boolean(record[lineage])) {
    invalid('The signed native total does not match the issued document lineage.');
  }
  const seen = new Set();
  const lines = [];
  let emittedCents = 0n;
  for (const [index, line] of rows.entries()) {
    const exactAmount = exactLines[index];
    if (!sfId.test(line.Id || '') || seen.has(line.Id.slice(0, 15)) || line[parent] !== record.Id || line[otherParent]
        || !pricingModes.includes(line.Pricing_Mode__c) || line.Currency__c !== currency
        || (line.FX_Rate__c ?? null) !== (record.Document_FX_Rate__c ?? null)
        || (line.FX_Revision__c ?? null) !== (record.Document_FX_Revision__c ?? null)) {
      invalid('An immutable line has conflicting identity, currency, pricing mode or rate evidence.');
    }
    seen.add(line.Id.slice(0, 15));
    const ancestor = line.Original_Line__r;
    if ((credit && !line.Original_Line__c) || (line.Original_Line__c &&
        (!ancestor || ancestor.Id !== line.Original_Line__c || ancestor[parent] !== (record[lineage] || record[reissue])
          || ancestor[otherParent] || ancestor.Source_Record_Id__c !== line.Source_Record_Id__c))) {
      invalid('An immutable line does not identify its exact original source and document.');
    }
    const source = sourceRows.get(line.Source_Record_Id__c);
    const productId = source?.Product__c || source?.Product2Id__c;
    if (!source || source.Id !== line.Source_Record_Id__c || source.STEM__c !== record.STEM__c || !sfId.test(productId || '')) {
      invalid('The immutable line lacks an exact original Salesforce product in this STEM.');
    }
    if (!exactAmount) continue;
    const mapping = productMappings.get(`${direction}:${productId}`);
    if (!mapping?.xero_account_code || !mapping?.xero_tax_type) {
      invalid('An immutable product needs an explicit Finance-approved Xero account and tax mapping.');
    }
    const cents = roundNativeHalfUp((credit ? -exactAmount : exactAmount), 1_000_000_000_000n);
    const amount = accountingCentsNumber(cents);
    if (amount == null) invalid('The immutable accounting line amount exceeds Xero precision.');
    const quantity = exactNativeDecimal(line.Quantity__c, 6);
    const nativeUnitPrice = exactNativeDecimal(line.Native_Unit_Price__c, 8);
    const roundedQuantity = fourPlaces(absolute(quantity), 6);
    const roundedUnitPrice = fourPlaces((credit ? -1n : 1n) * (quantity < 0n ? -nativeUnitPrice : nativeUnitPrice), 8);
    const useQuantity = roundedQuantity > 0 && accountingProductCents(roundedQuantity, roundedUnitPrice) === cents;
    const productName = source.Product__r?.Name || source.Product2Id__r?.Name || source.Name || line.Description__c;
    const unit = line.Unit__c || '';
    const rawQuantity = Number(line.Quantity__c);
    const rawPrice = Number(line.Native_Unit_Price__c);
    const label = String(line.Description__c || productName || '').trim();
    const description = [
      useQuantity ? null : `Agreed: ${rawQuantity} ${unit} @ ${currency} ${rawPrice}; amount-based accounting line`,
      label, unit ? `${Math.abs(rawQuantity)} ${unit}` : null,
    ].filter(Boolean).join(' · ').slice(0, 4000);
    if (!description) invalid('The immutable accounting line is missing a description.');
    lines.push({
      sourceId: source.Id, description, quantity: useQuantity ? roundedQuantity : 1,
      unitAmount: useQuantity ? roundedUnitPrice : amount, accountCode: mapping.xero_account_code, taxType: mapping.xero_tax_type,
      originalPriceEvidence: {
        currency, ...(currency === 'USD' ? { originalLineId: line.Original_Line__c || null } : {}),
        pricingMode: line.Pricing_Mode__c, nativeMinimum: line.Native_Minimum__c ?? null,
        nativeLumpsum: line.Native_Lumpsum__c ?? null, quantity: rawQuantity, unit, unitPrice: rawPrice,
        nativeAmount: line.Native_Amount__c, ...(currency === 'HKD' ? { exactNativeAmount: exactNativeText(exactAmount) } : {}),
        snapshotId: line.Id,
      },
    });
    emittedCents += cents;
  }
  const roundingAdjustment = buildRoundingAdjustment({
    currency, tenantId, documentCents, emittedCents, residual: documentCents - emittedCents,
    policy: roundingPolicy, originalMapping, credit,
  });
  if (roundingAdjustment) {
    const { adjustmentCents, policy } = roundingAdjustment;
    lines.push({ sourceId: 'rounding-adjustment', description: `Document rounding adjustment (${currency}; policy revision ${policy.revision})`,
      quantity: 1, unitAmount: adjustmentCents / 100, accountCode: policy.account_code, taxType: policy.tax_type });
  }
  return { currency, signedTotal: accountingCentsNumber(signedCents), lines, roundingAdjustment };
}
