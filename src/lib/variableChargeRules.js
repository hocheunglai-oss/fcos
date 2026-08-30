const ANCHORAGE_DUES_NAMES = new Set(['ANCHORAGE DUE', 'ANCHORAGE DUES']);
const INCLUDED_BASIC_CALLING_NAMES = new Set(['AGENCY FEE', 'LIGHT DUES']);
const LOCKED_BASIC_CALLING_NAMES = new Set(['AGENCY FEE', 'PORT CLEARANCE FEE', 'LIGHT DUES']);

function normalizedProductName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function isAnchorageDuesItem(item) {
  return ANCHORAGE_DUES_NAMES.has(normalizedProductName(
    item?.productName ?? item?.Product2Id__r?.Name ?? item?.Product__r?.Name,
  ));
}

export function usesHongKongVariableChargeRules(item) {
  return item?.hongKongVariableCharges === true || item?.hong_kong_variable_charges === true;
}

export function isHongKongAnchorageDuesItem(item) {
  return usesHongKongVariableChargeRules(item) && isAnchorageDuesItem(item);
}

export function buyerPriceWithAnchorageDefault(item, pricingType = 'fixed') {
  const existing = pricingType === 'fixed'
    ? item?.fixedPrice ?? item?.fixed_price ?? item?.Lumpsum_Price__c
    : item?.price ?? item?.unitPrice ?? item?.unit_price ?? item?.Unit_Price__c;
  if (existing != null && existing !== '') return existing;
  const suggested = item?.buyerDefault?.unitOrFixedUsd ?? item?.buyer_default?.unit_or_fixed_usd;
  if (suggested != null && suggested !== '') return suggested;
  if (isHongKongAnchorageDuesItem(item)) {
    return pricingType === 'fixed'
      ? item?.fixedCost ?? item?.fixed_cost ?? item?.Lumpsum_Cost__c ?? ''
      : item?.cost ?? item?.unitCost ?? item?.unit_cost ?? item?.Unit_Cost__c ?? '';
  }
  return '';
}

export function buyerDecisionDefaultForItem(item) {
  return item?.buyerDefault?.decision ?? item?.buyer_default?.decision ?? '';
}

export function buyerDecisionLockedForItem(item) {
  return item?.buyerDefault?.locked === true || item?.buyer_default?.locked === true
    || (item?.managedBasicCallingBundle === true
      && LOCKED_BASIC_CALLING_NAMES.has(normalizedProductName(item?.productName ?? item?.Product2Id__r?.Name)));
}

export function supplierCostLockedForItem(item) {
  return item?.supplierCostLocked === true || item?.supplier_cost_locked === true;
}

export function isPortClearanceItem(item) {
  return normalizedProductName(item?.productName ?? item?.Product2Id__r?.Name) === 'PORT CLEARANCE FEE';
}

export function isIncludedBasicCallingItem(item) {
  return item?.managedBasicCallingBundle === true
    && INCLUDED_BASIC_CALLING_NAMES.has(normalizedProductName(item?.productName ?? item?.Product2Id__r?.Name));
}

export function buyerDecisionOptionsForItem(item) {
  if (!isHongKongAnchorageDuesItem(item)) {
    return [
      { value: '', label: 'Pending', tone: 'bg-slate-100 text-slate-800' },
      { value: 'include', label: 'Charge Buyer', tone: 'bg-blue-100 text-blue-900' },
      { value: 'exclude', label: 'Do Not Charge', tone: 'bg-slate-200 text-slate-900' },
    ];
  }
  return [
    { value: '', label: 'Pending', tone: 'bg-slate-100 text-slate-800' },
    { value: 'include', label: 'Pass Through', tone: 'bg-blue-100 text-blue-900' },
    { value: 'exclude', label: 'No Supplier Charge', tone: 'bg-slate-200 text-slate-900' },
  ];
}

export function buyerAmountWithAnchorageDecision(item, decision, amount) {
  return isHongKongAnchorageDuesItem(item) && decision !== 'include' ? 0 : amount;
}

export function anchorageBuyerTotalAdjustment(rows = []) {
  return rows.reduce((adjustment, row) => {
    if (!isHongKongAnchorageDuesItem(row?.item) || row?.decision === 'include') return adjustment;
    const currentTotal = Number(row?.currentTotal);
    return adjustment - (Number.isFinite(currentTotal) ? currentTotal : 0);
  }, 0);
}
