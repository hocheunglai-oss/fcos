const UOM_FIELDS = [
  'UOM__c',
  'UoM__c',
  'Unit_of_Measure__c',
  'Unit_Of_Measure__c',
  'Quantity_UOM__c',
  'Quantity_Unit__c',
];

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nestedValue(record, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => value?.[key], record);
}

export function nativeFinancialUom(item, { lineItemUomField = null, productUomField = null } = {}) {
  const candidates = [
    lineItemUomField ? nestedValue(item, lineItemUomField) : null,
    ...UOM_FIELDS.map((field) => item?.[field]),
    productUomField ? nestedValue(item, `Product__r.${productUomField}`) : null,
    item?.Product__r?.QuantityUnitOfMeasure,
    item?.Product2Id__r?.QuantityUnitOfMeasure,
  ];
  return candidates.map((value) => String(value || '').trim()).find(Boolean) || null;
}

export function nativeFinancialQuantity(item, {
  stemHasDelivery = false,
  maxField = 'Quantity_Max__c',
  lineItemUomField = null,
  productUomField = null,
} = {}) {
  const delivered = finiteNumber(item?.Quantity_Delivered_Per_BDN__c);
  const ordered = finiteNumber(item?.Quantity__c);
  const minimum = stemHasDelivery ? delivered ?? ordered : ordered ?? delivered;
  const maximum = !stemHasDelivery && item?.Is_Quantity_Range__c === true
    ? finiteNumber(item?.[maxField])
    : null;
  const quantity = minimum == null
    ? 0
    : maximum != null
      ? (minimum + maximum) / 2
      : minimum;
  const unitOfMeasure = nativeFinancialUom(item, { lineItemUomField, productUomField });
  return {
    quantity,
    minimum,
    maximum: maximum ?? minimum,
    isRange: minimum != null && maximum != null,
    unitOfMeasure,
    warning: unitOfMeasure ? null : 'Native unit of measure is unavailable; no unit conversion was inferred.',
  };
}

export function financialQuantityValue(item, stemHasDelivery = false, maxField = 'Quantity_Max__c') {
  return nativeFinancialQuantity(item, { stemHasDelivery, maxField }).quantity;
}

// Financial pricing follows the most authoritative quantity available on the
// child row. A BDN quantity can be populated before the parent STEM delivery
// date is completed, so parent delivery status must not force pricing back to
// the ordered range in that case.
export function pricingFinancialQuantityValue(item, stemHasDelivery = false, maxField = 'Quantity_Max__c') {
  const hasDeliveredQuantity = finiteNumber(item?.Quantity_Delivered_Per_BDN__c) != null;
  return nativeFinancialQuantity(item, {
    stemHasDelivery: stemHasDelivery || hasDeliveredQuantity,
    maxField,
  }).quantity;
}

export function financialQuantityLabel(item, stemHasDelivery = false, maxField = 'Quantity_Max__c', options = {}) {
  const result = nativeFinancialQuantity(item, { stemHasDelivery, maxField, ...options });
  const format = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const unit = result.unitOfMeasure || 'UOM not set';
  return result.isRange
    ? `${format(result.minimum)}-${format(result.maximum)} ${unit}`
    : `${format(result.quantity)} ${unit}`;
}
