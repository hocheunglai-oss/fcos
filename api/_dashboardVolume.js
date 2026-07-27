const LINE_ITEM_UOM_FIELD_NAMES = [
  'UOM__c',
  'UoM__c',
  'Unit_of_Measure__c',
  'Unit_Of_Measure__c',
  'Quantity_UOM__c',
  'Quantity_Unit__c',
];

const PRODUCT_UOM_FIELD_NAMES = [
  'QuantityUnitOfMeasure',
  ...LINE_ITEM_UOM_FIELD_NAMES,
];

const UOM_FIELD_LABELS = new Set([
  'uom',
  'unit of measure',
  'quantity uom',
  'quantity unit',
  'quantity unit of measure',
]);

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nestedValue(record, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((value, key) => value?.[key], record);
}

function normalizedUomToken(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

export function findDashboardUomField(fields, scope = 'lineItem') {
  const availableFields = Array.isArray(fields) ? fields : [];
  const preferredNames = scope === 'product' ? PRODUCT_UOM_FIELD_NAMES : LINE_ITEM_UOM_FIELD_NAMES;
  for (const name of preferredNames) {
    const match = availableFields.find((field) => field?.name === name);
    if (match) return match.name;
  }
  const labelMatch = availableFields.find((field) => UOM_FIELD_LABELS.has(
    String(field?.label || '').trim().toLowerCase(),
  ));
  return labelMatch?.name || null;
}

export function normalizeDashboardVolume(quantity, uom, fallbackUnit = 'MT') {
  const numericQuantity = finiteNumber(quantity);
  const token = normalizedUomToken(uom);
  if (numericQuantity == null) {
    return {
      quantity: null,
      unitOfMeasure: token || fallbackUnit,
    };
  }

  if (['L', 'LTR', 'LITRE', 'LITRES', 'LITER', 'LITERS'].includes(token)) {
    return {
      quantity: numericQuantity / 1000,
      unitOfMeasure: 'KL',
    };
  }
  if (['KL', 'KILOLITRE', 'KILOLITRES', 'KILOLITER', 'KILOLITERS'].includes(token)) {
    return {
      quantity: numericQuantity,
      unitOfMeasure: 'KL',
    };
  }
  if (['MT', 'M/T', 'METRIC TON', 'METRIC TONS', 'METRIC TONNE', 'METRIC TONNES'].includes(token)) {
    return {
      quantity: numericQuantity,
      unitOfMeasure: 'MT',
    };
  }
  return {
    quantity: numericQuantity,
    unitOfMeasure: token || fallbackUnit,
  };
}

export function resolveDashboardItemUom(item, {
  lineItemUomField = null,
  productUomField = null,
} = {}) {
  const lineItemUom = lineItemUomField ? nestedValue(item, lineItemUomField) : null;
  if (String(lineItemUom || '').trim()) return lineItemUom;
  const productUom = productUomField
    ? nestedValue(item, `Product__r.${productUomField}`)
    : null;
  return String(productUom || '').trim() ? productUom : null;
}

export function dashboardLineItemVolume(item, stemHasDelivery, {
  lineItemUomField = null,
  productUomField = null,
  fallbackQuantity = 0,
} = {}) {
  const explicitUom = resolveDashboardItemUom(item, { lineItemUomField, productUomField });
  if (!explicitUom) {
    const normalized = normalizeDashboardVolume(fallbackQuantity, null);
    return {
      ...normalized,
      minimum: normalized.quantity,
      maximum: normalized.quantity,
      isRange: false,
    };
  }

  const deliveredQuantity = finiteNumber(item?.Quantity_Delivered_Per_BDN__c);
  const orderedNativeQuantities = stemHasDelivery
    ? [deliveredQuantity, finiteNumber(item?.Quantity__c)]
    : [finiteNumber(item?.Quantity__c), deliveredQuantity];
  const minimumSource = orderedNativeQuantities.find((value) => value != null);
  if (minimumSource == null) {
    const metricTonQuantity = finiteNumber(item?.Quantity_in_MT__c) ?? finiteNumber(fallbackQuantity) ?? 0;
    const normalized = normalizeDashboardVolume(metricTonQuantity, 'MT');
    return {
      ...normalized,
      minimum: normalized.quantity,
      maximum: normalized.quantity,
      isRange: false,
    };
  }
  const maximumSource = !stemHasDelivery && item?.Is_Quantity_Range__c
    ? finiteNumber(item?.Quantity_Max__c)
    : null;
  const minimum = normalizeDashboardVolume(minimumSource, explicitUom);
  const maximum = maximumSource == null
    ? null
    : normalizeDashboardVolume(maximumSource, explicitUom);
  const isRange = maximum?.quantity != null && minimum.quantity != null;

  return {
    quantity: isRange ? (minimum.quantity + maximum.quantity) / 2 : minimum.quantity,
    unitOfMeasure: minimum.unitOfMeasure,
    minimum: minimum.quantity,
    maximum: maximum?.quantity ?? minimum.quantity,
    isRange,
  };
}

export function dashboardVolumeLabel(volume) {
  const format = (value) => Number(value || 0).toLocaleString('en-US', {
    maximumFractionDigits: 3,
  });
  if (volume?.isRange) {
    return `${format(volume.minimum)}-${format(volume.maximum)} ${volume.unitOfMeasure}`;
  }
  return `${format(volume?.quantity)} ${volume?.unitOfMeasure || 'MT'}`;
}
