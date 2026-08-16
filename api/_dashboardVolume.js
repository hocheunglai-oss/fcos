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

export const LSMGO_MT_PER_KL = 0.85;
export const HSFO_VLSFO_MT_PER_KL = 0.98;

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

export function dashboardMtPerKl(productFamily) {
  const family = normalizedUomToken(productFamily);
  return family === 'HSFO' || family === 'VLSFO'
    ? HSFO_VLSFO_MT_PER_KL
    : LSMGO_MT_PER_KL;
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

export function normalizeDashboardVolume(quantity, uom, {
  fallbackUnit = 'MT',
  productFamily = '',
} = {}) {
  const numericQuantity = finiteNumber(quantity);
  const token = normalizedUomToken(uom) || normalizedUomToken(fallbackUnit);
  const mtPerKl = dashboardMtPerKl(productFamily);

  if (['L', 'LTR', 'LITRE', 'LITRES', 'LITER', 'LITERS'].includes(token)) {
    return {
      quantity: numericQuantity == null ? null : (numericQuantity / 1000) * mtPerKl,
      unitOfMeasure: 'MT',
    };
  }
  if (['KL', 'KILOLITRE', 'KILOLITRES', 'KILOLITER', 'KILOLITERS'].includes(token)) {
    return {
      quantity: numericQuantity == null ? null : numericQuantity * mtPerKl,
      unitOfMeasure: 'MT',
    };
  }
  if (['CBM', 'M3', 'M³', 'CUBIC METER', 'CUBIC METERS', 'CUBIC METRE', 'CUBIC METRES'].includes(token)) {
    return {
      quantity: numericQuantity == null ? null : numericQuantity * mtPerKl,
      unitOfMeasure: 'MT',
    };
  }
  if (['MT', 'M/T', 'T', 'TON', 'TONS', 'TONNE', 'TONNES', 'METRIC TON', 'METRIC TONS', 'METRIC TONNE', 'METRIC TONNES'].includes(token)) {
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
  productFamily = '',
} = {}) {
  const explicitUom = resolveDashboardItemUom(item, { lineItemUomField, productUomField });
  if (!explicitUom) {
    const normalized = normalizeDashboardVolume(fallbackQuantity, 'MT', { productFamily });
    return {
      ...normalized,
      minimum: normalized.quantity,
      maximum: normalized.quantity,
      isRange: false,
    };
  }

  const deliveredQuantity = finiteNumber(item?.Quantity_Delivered_Per_BDN__c);
  // A line-level BDN is authoritative even while the parent STEM delivery
  // date is still awaiting completion. Otherwise use the ordered quantity and
  // its range midpoint for an undelivered line.
  const hasDeliveredQuantity = deliveredQuantity != null;
  const orderedNativeQuantities = hasDeliveredQuantity
    ? [deliveredQuantity]
    : [finiteNumber(item?.Quantity__c)];
  const minimumSource = orderedNativeQuantities.find((value) => value != null);
  if (minimumSource == null) {
    const metricTonQuantity = finiteNumber(item?.Quantity_in_MT__c) ?? finiteNumber(fallbackQuantity) ?? 0;
    const normalized = normalizeDashboardVolume(metricTonQuantity, 'MT', { productFamily });
    return {
      ...normalized,
      minimum: normalized.quantity,
      maximum: normalized.quantity,
      isRange: false,
    };
  }
  const maximumSource = !stemHasDelivery && !hasDeliveredQuantity && item?.Is_Quantity_Range__c
    ? finiteNumber(item?.Quantity_Max__c)
    : null;
  const minimum = normalizeDashboardVolume(minimumSource, explicitUom, { productFamily });
  const maximum = maximumSource == null
    ? null
    : normalizeDashboardVolume(maximumSource, explicitUom, { productFamily });
  if (minimum.unitOfMeasure !== 'MT' || (maximum && maximum.unitOfMeasure !== 'MT')) {
    const metricTonQuantity = finiteNumber(item?.Quantity_in_MT__c) ?? finiteNumber(fallbackQuantity) ?? 0;
    const normalized = normalizeDashboardVolume(metricTonQuantity, 'MT', { productFamily });
    return {
      ...normalized,
      minimum: normalized.quantity,
      maximum: normalized.quantity,
      isRange: false,
    };
  }
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
