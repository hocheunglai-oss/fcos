const ANCHORAGE_DUES_NAMES = new Set(['ANCHORAGE DUE', 'ANCHORAGE DUES']);

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

export function buyerPriceWithAnchorageDefault(item, pricingType = 'fixed') {
  const existing = pricingType === 'fixed'
    ? item?.fixedPrice ?? item?.fixed_price ?? item?.Lumpsum_Price__c
    : item?.price ?? item?.unitPrice ?? item?.unit_price ?? item?.Unit_Price__c;
  if (existing != null && existing !== '') return existing;
  return isAnchorageDuesItem(item) ? 0 : '';
}

export function buyerDecisionOptionsForItem(item) {
  if (!isAnchorageDuesItem(item)) {
    return [
      { value: '', label: 'Pending', tone: 'bg-slate-100 text-slate-800' },
      { value: 'include', label: 'Charge Buyer', tone: 'bg-blue-100 text-blue-900' },
      { value: 'exclude', label: 'Do Not Charge', tone: 'bg-slate-200 text-slate-900' },
    ];
  }
  return [
    { value: '', label: 'Pending', tone: 'bg-slate-100 text-slate-800' },
    { value: 'include', label: 'Charge Excess', tone: 'bg-blue-100 text-blue-900' },
    { value: 'exclude', label: 'No Charge · 12h or less', tone: 'bg-slate-200 text-slate-900' },
  ];
}
