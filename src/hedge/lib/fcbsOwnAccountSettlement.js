import { calcSwapFees, calcSwapMtm, paperHedgeContractMonths, paperHedgeExpiryStatus, roundMoney } from './domain.js';

export const FCBS_OWN_ACCOUNT_BASIS = 'fcbs_own_account_venue';
export const FCBS_FULL_NAME = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
const normalized = (value) => String(value || '').trim().toUpperCase();

export function isFcbsOwnAccountHedge(swap) {
  return normalized(swap?.counterparty) === 'FCBHK' && normalized(swap?.venue) === 'FCBS';
}

// A spread is realized once, when its final contract month can be settled.
export function fcbsSettlementMonth(swap) {
  return paperHedgeContractMonths(swap).sort().at(-1) || null;
}

export function buildFcbsOwnAccountSettlement({ swaps = [], mops = [], rates, month, sgoRatio = 7.45,
  monthlyVerifications = [], now = new Date(), counterparties = [], invoices = [] } = {}) {
  const records = swaps.filter((swap) => isFcbsOwnAccountHedge(swap) && fcbsSettlementMonth(swap) === month)
    .sort((a, b) => `${a.trade_date}:${a.id}`.localeCompare(`${b.trade_date}:${b.id}`));
  if (!records.length) return null;
  const candidates = counterparties.filter((row) => normalized(row.short_name) === 'FCBS');
  const counterpartyRecord = candidates.length === 1 && normalized(candidates[0].full_name) === FCBS_FULL_NAME
    && candidates[0].settlement_mode !== 'internal_no_invoice' ? candidates[0] : null;
  const blockingReasons = [];
  if (!counterpartyRecord) blockingReasons.push('The exact external FCBS counterparty must be configured.');
  const rows = records.map((swap) => {
    const finality = paperHedgeExpiryStatus(swap, mops, now, monthlyVerifications);
    const result = calcSwapMtm(swap, mops, sgoRatio);
    const mtm = result?.value ?? null;
    // Retain the ORIGINAL counterparty. The document recipient is not a fee input.
    const fees = calcSwapFees(swap, rates);
    const fee = fees.fcbsVenueFee;
    const ready = finality.ready && Number.isFinite(mtm) && Number.isFinite(fee) && fee >= 0;
    return { swap, mtm, displayMtm: mtm, fees, attributedFeeAmount: fee,
      attributedFeeImpact: -fee, net: mtm == null ? null : roundMoney(mtm - fee), ready };
  });
  if (rows.some((row) => !row.ready)) blockingReasons.push('Final, complete and currently verified MOPS are required for every hedge.');
  const valuationAvailable = rows.every((row) => row.mtm != null && Number.isFinite(row.net));
  const net = valuationAvailable ? roundMoney(rows.reduce((sum, row) => sum + row.net, 0)) : null;
  if (net === 0) blockingReasons.push('The monthly net is zero; no settlement document is required.');
  const existing = invoices.filter((invoice) => invoice.settlement_basis === FCBS_OWN_ACCOUNT_BASIS
    && invoice.settlement_month === month && !['Cancelled', 'Voided', 'Deleted'].includes(invoice.status));
  if (existing.length > 1) blockingReasons.push('Multiple active monthly settlement documents require resolution.');
  const existingInvoice = existing.length === 1 ? existing[0] : null;
  if (existingInvoice && existingInvoice.status !== 'Draft') blockingReasons.push('The monthly settlement document has already been issued.');
  return { key: `${FCBS_OWN_ACCOUNT_BASIS}:${month}`, settlementBasis: FCBS_OWN_ACCOUNT_BASIS,
    counterparty: 'FCBS', counterpartyRecord, internal: false, records, rows,
    mtm: valuationAvailable ? roundMoney(rows.reduce((sum, row) => sum + row.mtm, 0)) : null,
    fees: roundMoney(rows.reduce((sum, row) => sum + row.attributedFeeAmount, 0)), net,
    valuationAvailable, documentReady: blockingReasons.length === 0, blockingReasons, existingInvoice };
}
