const SF_ID_RE = /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/;

export const MASTER_CONTRACT_PRODUCT_ORDER = ['hsfo', 'mgo'];

function externalKeyPart(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export function masterContractLineKey(contractKey, deliveryKey, productKey) {
  const contract = externalKeyPart(contractKey, 'CONTRACT');
  const delivery = externalKeyPart(deliveryKey, 'DELIVERY');
  const product = externalKeyPart(productKey, 'PRODUCT');
  const qualifiedDelivery = delivery.startsWith(`${contract}-`)
    ? delivery
    : `${contract}-${delivery}`;
  return `${qualifiedDelivery}-${product}`.slice(0, 160);
}

export const MASTER_CONTRACT_BENCHMARKS = Object.freeze({
  hsfo: Object.freeze({ code: 'PPXDK00', label: 'S380 MOPS', unit: 'USD/MT', conversionFactor: 1 }),
  mgo: Object.freeze({ code: 'POABC00', label: 'SGO MOPS', unit: 'USD/bbl', conversionFactor: 7.45 }),
});

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function quantityRange(item = {}) {
  const minimum = numberOrNull(item.quantityMin ?? item.min ?? item.quantity);
  const maximum = numberOrNull(item.quantityMax ?? item.max ?? item.quantity ?? minimum);
  return { minimum, maximum };
}

export function masterContractQuantitySummary(snapshot = {}, liveActuals = {}) {
  const terms = new Map((snapshot.products || []).map((item) => [item.productKey, item]));
  const result = {};
  for (const productKey of new Set([...terms.keys(), ...Object.keys(liveActuals || {})])) {
    const term = terms.get(productKey) || {};
    let allocatedMin = 0;
    let allocatedMax = 0;
    for (const delivery of snapshot.deliveries || []) {
      if (delivery.status === 'cancelled') continue;
      const product = (delivery.products || []).find((item) => item.productKey === productKey);
      if (!product) continue;
      const range = quantityRange(product);
      if (range.minimum != null) allocatedMin += range.minimum;
      if (range.maximum != null) allocatedMax += range.maximum;
    }
    const contractedMin = numberOrNull(term.contractedMinQty) ?? 0;
    const contractedMax = numberOrNull(term.contractedMaxQty) ?? contractedMin;
    const delivered = Math.max(0, numberOrNull(liveActuals?.[productKey]?.deliveredQty) ?? 0);
    result[productKey] = {
      contractedMin,
      contractedMax,
      allocatedMin,
      allocatedMax,
      delivered,
      // Range subtraction may cross zero even when neither approved range is
      // invalid. A balance cannot be negative; excess is reported separately.
      unallocatedMin: Math.max(0, contractedMin - allocatedMax),
      unallocatedMax: Math.max(0, contractedMax - allocatedMin),
      remainingMin: Math.max(0, contractedMin - delivered),
      remainingMax: Math.max(0, contractedMax - delivered),
      overAllocated: Math.max(0, allocatedMax - contractedMax),
      overDelivered: Math.max(0, delivered - contractedMax),
    };
  }
  return result;
}

export function masterContractDonWindow(preliminaryEta, minimumDays, maximumDays) {
  const eta = new Date(`${preliminaryEta}T00:00:00Z`);
  const minimum = Number(minimumDays);
  const maximum = Number(maximumDays);
  if (Number.isNaN(eta.getTime()) || !Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum < minimum) return null;
  const latest = new Date(eta);
  latest.setUTCDate(latest.getUTCDate() - minimum);
  const earliest = new Date(eta);
  earliest.setUTCDate(earliest.getUTCDate() - maximum);
  return { earliest: earliest.toISOString().slice(0, 10), latest: latest.toISOString().slice(0, 10) };
}

export function calculateMasterContractDonPrice({ productKey, benchmarkValue, conversionFactor, buyPremium, sellPremium }) {
  const benchmark = Number(benchmarkValue);
  const conversion = Number(conversionFactor ?? MASTER_CONTRACT_BENCHMARKS[productKey]?.conversionFactor ?? 1);
  const buy = Number(buyPremium);
  const sell = Number(sellPremium);
  if (![benchmark, conversion, buy, sell].every(Number.isFinite) || conversion <= 0) return null;
  const convertedBenchmark = benchmark * conversion;
  const buyUnrounded = convertedBenchmark + buy;
  const sellUnrounded = convertedBenchmark + sell;
  return {
    benchmarkValue: benchmark,
    conversionFactor: conversion,
    convertedBenchmark,
    buyUnrounded,
    sellUnrounded,
    buyRounded: Math.round((buyUnrounded + Number.EPSILON) * 100) / 100,
    sellRounded: Math.round((sellUnrounded + Number.EPSILON) * 100) / 100,
  };
}

export function masterContractPreflight(snapshot = {}, { selectedDeliveryIds = null, featureEnabled = true } = {}) {
  const blockers = [];
  const parties = snapshot.parties || {};
  const terms = snapshot.terms || {};
  const selected = selectedDeliveryIds ? new Set(selectedDeliveryIds) : null;
  const allDeliveries = snapshot.deliveries || [];
  const deliveryIdentities = (delivery) => [
    delivery.id,
    delivery.deliveryId,
    delivery.deliveryKey,
  ].filter(Boolean);
  const deliveries = allDeliveries.filter(
    (delivery) =>
      !selected ||
      deliveryIdentities(delivery).some((identity) => selected.has(identity)),
  );
  if (!featureEnabled) blockers.push({ code: 'FEATURE_DISABLED', message: 'Master Contracts is not enabled for Salesforce creation.' });
  if (!SF_ID_RE.test(parties?.buyer?.accountId || '')) blockers.push({ code: 'BUYER_REQUIRED', message: 'Resolve the exact active Buyer Account.' });
  if (!SF_ID_RE.test(parties?.supplier?.accountId || '') || parties?.supplier?.confirmed !== true) blockers.push({ code: 'SUPPLIER_CONFIRMATION_REQUIRED', message: 'Confirm the exact active Supplier Account.' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.ownerUserId || '')) blockers.push({ code: 'OWNER_REQUIRED', message: 'Assign the exact active contract owner.' });
  const donMin = Number(terms?.don?.minDays);
  const donMax = Number(terms?.don?.maxDays);
  if (!Number.isInteger(donMin) || !Number.isInteger(donMax) || donMin < 0 || donMax > 365 || donMin > donMax) blockers.push({ code: 'DON_WINDOW_REQUIRED', message: 'Enter a valid DON X–Y day window between 0 and 365 days.' });
  if (!['contract', 'per_delivery'].includes(terms?.variableCharges?.mode)) blockers.push({ code: 'VARIABLE_CHARGES_MODE_REQUIRED', message: 'Choose the Variable Charges selection mode.' });
  if (terms?.variableCharges?.mode === 'contract' && (!Array.isArray(terms?.variableCharges?.supplierIds) || terms.variableCharges.supplierIds.some((id) => !SF_ID_RE.test(id)))) blockers.push({ code: 'VARIABLE_CHARGES_REQUIRED', message: 'Complete the contract-wide Variable Charges supplier selection with exact Account identities.' });
  if (!deliveries.length) blockers.push({ code: 'DELIVERY_REQUIRED', message: 'Select at least one uncreated delivery.' });
  if (selected) {
    const known = new Set(
      allDeliveries.flatMap((delivery) => deliveryIdentities(delivery)),
    );
    for (const requested of selected) if (!known.has(requested)) blockers.push({ code: 'DELIVERY_UNKNOWN', deliveryKey: requested, message: `${requested}: the selected delivery is not part of this contract revision.` });
  }
  const productKeys = new Set();
  if (!(snapshot.products || []).length) blockers.push({ code: 'PRODUCT_REQUIRED', message: 'Add at least one contracted product.' });
  for (const product of snapshot.products || []) {
    if (!/^[a-z0-9_]{2,40}$/.test(product.productKey || '') || productKeys.has(product.productKey)) blockers.push({ code: 'PRODUCT_KEY_INVALID', productKey: product.productKey, message: 'Every contracted product needs a unique stable product key.' });
    productKeys.add(product.productKey);
    if (!SF_ID_RE.test(product.salesforceProductId || '')) blockers.push({ code: 'PRODUCT_REQUIRED', productKey: product.productKey, message: `Resolve the exact Salesforce Product for ${product.productName || product.productKey}.` });
    const range = quantityRange({ quantityMin: product.contractedMinQty, quantityMax: product.contractedMaxQty });
    if (range.minimum == null || range.maximum == null || range.minimum < 0 || range.maximum < range.minimum) blockers.push({ code: 'CONTRACTED_QUANTITY_INVALID', productKey: product.productKey, message: `Correct the contracted quantity range for ${product.productName || product.productKey}.` });
  }
  for (const charge of snapshot.chargeRules || []) {
    const label = charge.chargeName || charge.chargeKey || 'Charge';
    if (!/^[a-z0-9_]{2,60}$/.test(charge.chargeKey || '')) blockers.push({ code: 'CHARGE_KEY_INVALID', chargeKey: charge.chargeKey, message: `${label}: assign a valid stable charge key.` });
    if (!SF_ID_RE.test(charge.salesforceProductId || '')) blockers.push({ code: 'CHARGE_PRODUCT_REQUIRED', chargeKey: charge.chargeKey, message: `${label}: resolve the exact active Salesforce Product.` });
    if (!SF_ID_RE.test(charge.supplierAccountId || '')) blockers.push({ code: 'CHARGE_SUPPLIER_REQUIRED', chargeKey: charge.chargeKey, message: `${label}: resolve the exact active Supplier Account.` });
    if (!['every_delivery', 'berth', 'anchorage'].includes(charge.appliesWhen)) blockers.push({ code: 'CHARGE_APPLICATION_INVALID', chargeKey: charge.chargeKey, message: `${label}: select when this charge applies.` });
    if (![charge.fixedCost, charge.fixedSell].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)) blockers.push({ code: 'CHARGE_AMOUNT_INVALID', chargeKey: charge.chargeKey, message: `${label}: enter valid non-negative cost and sell amounts.` });
  }
  for (const delivery of deliveries) {
    const label = delivery.vesselName || delivery.deliveryKey || 'Delivery';
    if (!SF_ID_RE.test(delivery.vesselId || '')) blockers.push({ code: 'VESSEL_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: resolve or create the Vessel with IMO duplicate checks.` });
    if (!SF_ID_RE.test(delivery.portId || '')) blockers.push({ code: 'PORT_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: resolve the exact Port.` });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(delivery.preliminaryEta || '') || Number.isNaN(new Date(`${delivery.preliminaryEta}T00:00:00Z`).getTime())) blockers.push({ code: 'ETA_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: enter a valid preliminary ETA.` });
    if (!['Berth', 'Anchorage', 'TBD'].includes(delivery.supplyLocation)) blockers.push({ code: 'SUPPLY_LOCATION_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: select Berth, Anchorage, or TBD.` });
    if (!delivery.buyerPaymentTerm) blockers.push({ code: 'BUYER_TERM_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: select the Buyer payment term.` });
    if (!delivery.supplierPaymentTerm) blockers.push({ code: 'SUPPLIER_TERM_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: select the Supplier payment term.` });
    const variableSuppliers = terms?.variableCharges?.mode === 'contract'
      ? terms?.variableCharges?.supplierIds
      : delivery.variableChargeSupplierIds;
    if (!Array.isArray(variableSuppliers) || variableSuppliers.some((id) => !SF_ID_RE.test(id))) blockers.push({ code: 'VARIABLE_CHARGES_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: complete the Variable Charges selection with exact Supplier Accounts.` });
    if (!(delivery.products || []).length) blockers.push({ code: 'DELIVERY_PRODUCT_REQUIRED', deliveryKey: delivery.deliveryKey, message: `${label}: add at least one contracted product allocation.` });
    for (const product of delivery.products || []) {
      if (!(snapshot.products || []).some((term) => term.productKey === product.productKey)) blockers.push({ code: 'DELIVERY_PRODUCT_UNKNOWN', deliveryKey: delivery.deliveryKey, productKey: product.productKey, message: `${label}: ${product.productKey || 'the delivery product'} is not an active contract product.` });
      if (!/^[A-Z0-9][A-Z0-9_-]{5,159}$/.test(product.contractLineKey || '')) blockers.push({ code: 'CONTRACT_LINE_KEY_REQUIRED', deliveryKey: delivery.deliveryKey, productKey: product.productKey, message: `${label}: assign a stable unique line key for ${product.productKey || 'the delivery product'}.` });
      const range = quantityRange(product);
      if (range.minimum == null || range.maximum == null || range.minimum < 0 || range.maximum < range.minimum) blockers.push({ code: 'QUANTITY_INVALID', deliveryKey: delivery.deliveryKey, productKey: product.productKey, message: `${label}: correct the ${product.productKey} quantity range.` });
    }
  }
  return { ready: blockers.length === 0, blockers };
}

export function masterContractInvoicePriceReady(lineItems = []) {
  const applicable = lineItems.filter((line) => line.masterContractLine === true || line.contractLineKey);
  const blocked = applicable.filter((line) => line.priceStatus !== 'applied');
  return { ready: blocked.length === 0, blockedCount: blocked.length, blockedKeys: blocked.map((line) => line.contractLineKey).filter(Boolean) };
}

function liveValue(row, ...keys) {
  for (const key of keys) if (row?.[key] !== undefined) return row[key];
  return null;
}

function comparableNumber(value) {
  if (value === '' || value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

/**
 * Produces deterministic, field-level approved-versus-live differences. The
 * caller persists only these structured values; Salesforce IDs and licensed
 * financial documents never become the legal contract baseline implicitly.
 */
export function masterContractLiveVariances(snapshot = {}, live = {}) {
  const liveByDelivery = new Map((live.deliveries || []).map((row) => [row.deliveryKey, row]));
  const variances = [];
  const add = (delivery, fieldPath, approvedValue, currentValue, consequential) => {
    const left = approvedValue == null ? null : approvedValue;
    const right = currentValue == null ? null : currentValue;
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    variances.push({
      deliveryId: delivery.id || null,
      deliveryKey: delivery.deliveryKey,
      varianceKey: `${delivery.deliveryKey}:${fieldPath}`,
      fieldPath,
      approvedValue: left,
      liveValue: right,
      consequentialFinancialRecord: consequential === true,
    });
  };

  for (const delivery of snapshot.deliveries || []) {
    if (delivery.status === 'cancelled') continue;
    const current = liveByDelivery.get(delivery.deliveryKey);
    if (!current) continue;
    const consequential = Number(current.financialRecordCount || 0) > 0;
    add(delivery, 'buyer.accountId', snapshot.parties?.buyer?.accountId || null, liveValue(current, 'accountId', 'Account__c'), consequential);
    add(delivery, 'vessel.id', delivery.vesselId || null, liveValue(current, 'vesselId', 'Vessel__c'), consequential);
    add(delivery, 'port.id', delivery.portId || null, liveValue(current, 'portId', 'Port__c'), consequential);
    add(delivery, 'preliminaryEta', delivery.preliminaryEta || null, liveValue(current, 'expectedDeliveryDate', 'Expected_Delivery_Date__c'), consequential);
    add(delivery, 'buyerPaymentTerm', delivery.buyerPaymentTerm || '', liveValue(current, 'buyerPaymentTerm', 'Payment_Term__c') || '', consequential);

    const liveProducts = new Map((current.products || []).map((row) => [liveValue(row, 'Master_Contract_Line_Key__c', 'contractLineKey'), row]));
    for (const product of delivery.products || []) {
      const line = liveProducts.get(product.contractLineKey);
      const base = `products.${product.contractLineKey}`;
      if (!line) {
        add(delivery, `${base}.present`, true, false, consequential);
        continue;
      }
      const term = (snapshot.products || []).find((row) => row.productKey === product.productKey);
      add(delivery, `${base}.productId`, term?.salesforceProductId || null, liveValue(line, 'Product__c', 'productId'), consequential);
      add(delivery, `${base}.supplierId`, snapshot.parties?.supplier?.accountId || null, liveValue(line, 'Original_Supplier__c', 'supplierId'), consequential);
      add(delivery, `${base}.quantityMin`, comparableNumber(product.quantityMin), comparableNumber(liveValue(line, 'Quantity__c', 'quantityMin')), consequential);
      add(delivery, `${base}.quantityMax`, comparableNumber(product.quantityMax), comparableNumber(liveValue(line, 'Quantity_Max__c', 'quantityMax')), consequential);
      add(delivery, `${base}.supplierPaymentTerm`, delivery.supplierPaymentTerm || '', liveValue(line, 'Payment_Term__c', 'paymentTerm') || '', consequential);
    }

    const liveCharges = new Map((current.charges || []).map((row) => [liveValue(row, 'Master_Contract_Charge_Key__c', 'contractChargeKey'), row]));
    for (const rule of snapshot.chargeRules || []) {
      const applies = rule.appliesWhen === 'every_delivery'
        || (rule.appliesWhen === 'berth' && delivery.supplyLocation === 'Berth')
        || (rule.appliesWhen === 'anchorage' && delivery.supplyLocation === 'Anchorage');
      if (!applies) continue;
      const key = `${delivery.deliveryKey}:${rule.chargeKey}`;
      const charge = liveCharges.get(key);
      const base = `charges.${key}`;
      if (!charge) {
        add(delivery, `${base}.present`, true, false, consequential);
        continue;
      }
      add(delivery, `${base}.productId`, rule.salesforceProductId || null, liveValue(charge, 'Product2Id__c', 'productId'), consequential);
      add(delivery, `${base}.supplierId`, rule.supplierAccountId || null, liveValue(charge, 'Supplier__c', 'supplierId'), consequential);
      add(delivery, `${base}.fixedCost`, comparableNumber(rule.fixedCost), comparableNumber(liveValue(charge, 'Lumpsum_Cost__c', 'fixedCost')), consequential);
      add(delivery, `${base}.fixedSell`, comparableNumber(rule.fixedSell), comparableNumber(liveValue(charge, 'Lumpsum_Price__c', 'fixedSell')), consequential);
    }
  }
  return variances;
}
