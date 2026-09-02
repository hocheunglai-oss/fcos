const ANCHORAGE_DUES_NAMES = new Set(['ANCHORAGE DUE', 'ANCHORAGE DUES']);
const LIGHT_DUES_NAME = 'LIGHT DUES';
const PORT_CLEARANCE_EXTENSION_NAMES = new Set(['PORT CLEARANCE EXTENSION', 'PORT CLEARANCE FEE']);
const INCLUDED_BASIC_CALLING_NAMES = new Set(['AGENCY FEE', 'LIGHT DUES']);
const LOCKED_BASIC_CALLING_NAMES = new Set(['AGENCY FEE', 'PORT CLEARANCE EXTENSION', 'PORT CLEARANCE FEE', 'LIGHT DUES']);

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
  const calculated = item?.anchorageVerification?.buyerDefault ?? item?.anchorage_verification?.buyer_default;
  if (isHongKongAnchorageDuesItem(item) && calculated?.available === true && calculated?.applyCalculatedDefault === true) {
    return calculated.amountUsd ?? calculated.amount_usd ?? '';
  }
  if (existing != null && existing !== '') return existing;
  const suggested = item?.buyerDefault?.unitOrFixedUsd ?? item?.buyer_default?.unit_or_fixed_usd;
  if (suggested != null && suggested !== '') return suggested;
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
  return PORT_CLEARANCE_EXTENSION_NAMES.has(normalizedProductName(item?.productName ?? item?.Product2Id__r?.Name));
}

export function portClearanceApplicationCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 ? count : 1;
}

export function stepPortClearanceApplicationCount(value, direction) {
  const delta = Number(direction) < 0 ? -1 : 1;
  return Math.max(1, portClearanceApplicationCount(value) + delta);
}

export function supplierInputAmountUsd(value, inputCurrency = 'USD', usdHkdRate = null) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (String(inputCurrency || 'USD').trim().toUpperCase() !== 'HKD') return amount;
  const rate = Number(usdHkdRate);
  return Number.isFinite(rate) && rate > 0 ? amount / rate : null;
}

export function variableChargeQuantityLabel(item, quantity, unitOfMeasure) {
  if (quantity == null || quantity === '') return 'Not set';
  if (isPortClearanceItem(item)) {
    const count = portClearanceApplicationCount(quantity);
    return `${count} ${count === 1 ? 'application' : 'applications'}`;
  }
  const unit = String(unitOfMeasure ?? '').trim() || 'Not set';
  return `${quantity} ${unit}`;
}

function positiveNumber(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function nonNegativeNumber(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function statutorySupplierHkdDefault(item) {
  if (!usesHongKongVariableChargeRules(item)) return null;
  const explicitNativeAmount = item?.supplierCurrency?.inputAmount ?? item?.supplier_currency?.input_amount;
  if (explicitNativeAmount != null && explicitNativeAmount !== '') return null;
  const existingCost = positiveNumber(
    item?.fixedCost ?? item?.fixed_cost ?? item?.Lumpsum_Cost__c
      ?? item?.cost ?? item?.unitCost ?? item?.unit_cost ?? item?.Unit_Cost__c,
  );
  if (existingCost != null) return null;

  const productName = normalizedProductName(item?.productName ?? item?.Product2Id__r?.Name);
  if (productName === LIGHT_DUES_NAME) {
    const calculation = item?.lightDuesVerification?.calculation ?? item?.light_dues_verification?.calculation;
    const amountHkd = nonNegativeNumber(calculation?.complete === true ? calculation?.amountHkd ?? calculation?.amount_hkd : null);
    return amountHkd == null ? null : { amountHkd, source: 'light_dues_calculation' };
  }
  if (ANCHORAGE_DUES_NAMES.has(productName)) {
    const verification = item?.anchorageVerification ?? item?.anchorage_verification;
    const amountHkd = nonNegativeNumber(verification?.allocationHkd ?? verification?.allocation_hkd);
    return amountHkd == null ? null : { amountHkd, source: 'anchorage_dues_calculation' };
  }
  return null;
}

export function canApproveBothVariableChargeLegs({
  commonOwner = false,
  reviewingBothAsGeneralManager = false,
  bothOpen = false,
  canCostEdit = false,
  canBuyerEdit = false,
} = {}) {
  return (commonOwner || reviewingBothAsGeneralManager) && bothOpen && canCostEdit && canBuyerEdit;
}

export function isIncludedBasicCallingItem(item) {
  return (item?.basicCallingBundleSupport === true || item?.managedBasicCallingBundle === true)
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
    { value: 'include', label: 'Charge Buyer', tone: 'bg-blue-100 text-blue-900' },
    { value: 'exclude', label: 'Do Not Charge', tone: 'bg-slate-200 text-slate-900' },
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
