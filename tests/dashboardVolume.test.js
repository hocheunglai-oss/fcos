import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HSFO_VLSFO_MT_PER_KL,
  LSMGO_MT_PER_KL,
  addDashboardMetricTonQuantity,
  dashboardLineItemVolume,
  dashboardMetricTonQuantity,
  dashboardMtPerKl,
  dashboardVolumeLabel,
  findDashboardUomField,
  normalizeDashboardVolume,
  resolveDashboardItemUom,
} from '../api/_dashboardVolume.js';

test('pail quantities retain their own units when mass is missing', () => {
  const options = { lineItemUomField: 'UOM__c', fallbackQuantity: 900 };
  const ordered = dashboardLineItemVolume({ UOM__c: 'pails', Quantity__c: 10, Quantity_Max__c: 20, Is_Quantity_Range__c: true, Quantity_Delivered_Per_BDN__c: 12 }, false, options);
  assert.deepEqual(ordered, { quantity: 15, unitOfMeasure: 'PAILS', minimum: 10, maximum: 20, isRange: true });
  assert.equal(dashboardVolumeLabel(ordered), '10-20 PAILS');
  const delivered = dashboardLineItemVolume({ UOM__c: 'PAIL', Quantity__c: 10, Quantity_Delivered_Per_BDN__c: 12 }, true, options);
  assert.equal(dashboardVolumeLabel(delivered), '12 PAIL');
  assert.equal(dashboardMetricTonQuantity(delivered), null);
  const absent = dashboardLineItemVolume({ UOM__c: 'PAIL' }, true, options);
  assert.equal(absent.quantity, null);
  assert.equal(dashboardVolumeLabel(absent), 'Unavailable PAIL');
});

test('pail mass uses the explicit Salesforce mass including zero', () => {
  for (const mass of [1.25, 0]) {
    const volume = dashboardLineItemVolume({ UOM__c: 'PAILS', Quantity__c: 10, Quantity_in_MT__c: mass }, false, { lineItemUomField: 'UOM__c', fallbackQuantity: 10 });
    assert.equal(volume.quantity, mass);
    assert.equal(volume.unitOfMeasure, 'MT');
    assert.equal(dashboardMetricTonQuantity(volume), mass);
  }
});

test('metric ton aggregation preserves known zero and propagates missing mass', () => {
  assert.equal(addDashboardMetricTonQuantity(0, 0), 0);
  assert.equal(addDashboardMetricTonQuantity(0, dashboardMetricTonQuantity({ unitOfMeasure: 'MT', quantity: 3 })), 3);
  assert.equal(addDashboardMetricTonQuantity(3, dashboardMetricTonQuantity({ unitOfMeasure: 'PAILS', quantity: 5 })), null);
  assert.equal(addDashboardMetricTonQuantity(null, 3), null);
  assert.equal(dashboardMetricTonQuantity({ unitOfMeasure: 'MT', quantity: null }), null);
});

test('unrecognized unit aliases retain their existing fallback behavior', () => {
  const volume = dashboardLineItemVolume({ UOM__c: 'BUCKET', Quantity__c: 7 }, false, { lineItemUomField: 'UOM__c', fallbackQuantity: 7 });
  assert.equal(dashboardVolumeLabel(volume), '7 MT');
});

const apiSource = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8');

test('converts litres to metric tonnes using the product-family density', () => {
  assert.deepEqual(normalizeDashboardVolume(1000, 'L', { productFamily: 'LSMGO' }), {
    quantity: 0.85,
    unitOfMeasure: 'MT',
  });
  assert.deepEqual(normalizeDashboardVolume(1000, 'litres', { productFamily: 'VLSFO' }), {
    quantity: 0.98,
    unitOfMeasure: 'MT',
  });
});

test('keeps quantities already recorded in metric tonnes unchanged', () => {
  assert.deepEqual(normalizeDashboardVolume(12.5, 'MT', { productFamily: 'LSMGO' }), {
    quantity: 12.5,
    unitOfMeasure: 'MT',
  });
  assert.deepEqual(normalizeDashboardVolume(12.5, 'MT', { productFamily: 'HSFO' }), {
    quantity: 12.5,
    unitOfMeasure: 'MT',
  });
});

test('uses 0.98 MT per KL for HSFO and VLSFO', () => {
  assert.equal(HSFO_VLSFO_MT_PER_KL, 0.98);
  assert.equal(dashboardMtPerKl('HSFO'), 0.98);
  assert.equal(dashboardMtPerKl('VLSFO'), 0.98);
  assert.deepEqual(normalizeDashboardVolume(10, 'CBM', { productFamily: 'HSFO' }), {
    quantity: 9.8,
    unitOfMeasure: 'MT',
  });
  assert.deepEqual(normalizeDashboardVolume(10, 'KL', { productFamily: 'VLSFO' }), {
    quantity: 9.8,
    unitOfMeasure: 'MT',
  });
});

test('uses the LSMGO conversion for LSMGO and all other product families', () => {
  assert.equal(LSMGO_MT_PER_KL, 0.85);
  assert.equal(dashboardMtPerKl('LSMGO'), 0.85);
  assert.equal(dashboardMtPerKl('LUBRICANT'), 0.85);
  assert.deepEqual(normalizeDashboardVolume(1, 'CBM', { productFamily: 'LSMGO' }), {
    quantity: 0.85,
    unitOfMeasure: 'MT',
  });
  assert.deepEqual(normalizeDashboardVolume(2, 'KL', { productFamily: 'OTHER' }), {
    quantity: 1.7,
    unitOfMeasure: 'MT',
  });
});

test('finds the authoritative Salesforce UOM fields', () => {
  assert.equal(findDashboardUomField([
    { name: 'Unrelated__c', label: 'Unrelated' },
    { name: 'UOM__c', label: 'UOM' },
  ]), 'UOM__c');
  assert.equal(findDashboardUomField([
    { name: 'QuantityUnitOfMeasure', label: 'Quantity Unit of Measure' },
  ], 'product'), 'QuantityUnitOfMeasure');
  assert.equal(findDashboardUomField([
    { name: 'Custom_Unit__c', label: 'Unit of Measure' },
  ]), 'Custom_Unit__c');
});

test('line-item UOM takes precedence over the Product UOM', () => {
  const item = {
    UOM__c: 'L',
    Product__r: { QuantityUnitOfMeasure: 'MT' },
  };
  assert.equal(resolveDashboardItemUom(item, {
    lineItemUomField: 'UOM__c',
    productUomField: 'QuantityUnitOfMeasure',
  }), 'L');
});

test('uses native delivered quantity and reports its normalized MT volume', () => {
  const volume = dashboardLineItemVolume({
    Quantity_Delivered_Per_BDN__c: 1250,
    Quantity_in_MT__c: 1.05,
    Product__r: { QuantityUnitOfMeasure: 'L' },
  }, true, {
    productUomField: 'QuantityUnitOfMeasure',
    fallbackQuantity: 1.05,
    productFamily: 'LSMGO',
  });
  assert.equal(volume.quantity, 1.0625);
  assert.equal(volume.unitOfMeasure, 'MT');
  assert.equal(dashboardVolumeLabel(volume), '1.063 MT');
});

test('converts both litre boundaries to MT before averaging a range', () => {
  const volume = dashboardLineItemVolume({
    Quantity__c: 1000,
    Quantity_Max__c: 2000,
    Is_Quantity_Range__c: true,
    UOM__c: 'L',
  }, false, {
    lineItemUomField: 'UOM__c',
    productFamily: 'LSMGO',
  });
  assert.equal(volume.minimum, 0.85);
  assert.equal(volume.maximum, 1.7);
  assert.equal(volume.quantity, 1.275);
  assert.equal(dashboardVolumeLabel(volume), '0.85-1.7 MT');
});

test('uses the ordered range until the parent STEM delivery date is completed', () => {
  const volume = dashboardLineItemVolume({
    Quantity__c: 50,
    Quantity_Max__c: 100,
    Quantity_Delivered_Per_BDN__c: 98,
    Is_Quantity_Range__c: true,
    UOM__c: 'MT',
  }, false, { lineItemUomField: 'UOM__c', productFamily: 'LSMGO' });
  assert.equal(volume.quantity, 75);
  assert.equal(volume.isRange, true);
});

test('retains the existing MT fallback when Salesforce has no explicit UOM', () => {
  const volume = dashboardLineItemVolume({
    Quantity_Delivered_Per_BDN__c: 1030,
    Quantity_in_MT__c: 1,
  }, true, {
    fallbackQuantity: 1,
  });
  assert.equal(volume.quantity, 1);
  assert.equal(volume.unitOfMeasure, 'MT');
});

test('does not reinterpret the explicit Quantity_in_MT field as litres', () => {
  const volume = dashboardLineItemVolume({
    Quantity_in_MT__c: 1.05,
    Product__r: { QuantityUnitOfMeasure: 'L' },
  }, true, {
    productUomField: 'QuantityUnitOfMeasure',
    fallbackQuantity: 1.05,
  });
  assert.equal(volume.quantity, 1.05);
  assert.equal(volume.unitOfMeasure, 'MT');
});

test('keeps an LSMGO Quantity_in_MT dashboard fallback in metric tonnes', () => {
  const volume = dashboardLineItemVolume({
    Quantity_in_MT__c: 8.5,
    Product__r: { QuantityUnitOfMeasure: 'L' },
  }, true, {
    productUomField: 'QuantityUnitOfMeasure',
    fallbackQuantity: 8.5,
    productFamily: 'LSMGO',
  });
  assert.equal(volume.quantity, 8.5);
  assert.equal(volume.unitOfMeasure, 'MT');
});

test('falls back to Quantity_in_MT when the explicit UOM cannot be normalized', () => {
  const volume = dashboardLineItemVolume({
    Quantity_Delivered_Per_BDN__c: 50,
    Quantity_in_MT__c: 42.5,
    UOM__c: 'UNKNOWN',
  }, true, {
    lineItemUomField: 'UOM__c',
    fallbackQuantity: 50,
    productFamily: 'OTHER',
  });
  assert.equal(volume.quantity, 42.5);
  assert.equal(volume.unitOfMeasure, 'MT');
});

test('dashboard integration reads Salesforce UOM and normalizes KPI volume to MT', () => {
  assert.match(apiSource, /findDashboardUomField/);
  assert.match(apiSource, /dashboardLineItemVolume/);
  assert.match(apiSource, /productFamily: dashboardFamily/);
  assert.ok((apiSource.match(/dashboardLineItemVolume\(/g)?.length || 0) >= 2);
  assert.match(apiSource, /monthlyProductVolumeSeries/);
  assert.doesNotMatch(apiSource, /productFamilyQuantityByName\\[family\\].*financialQuantity/);
  assert.match(dashboardSource, /productVolumeKpi\.unitOfMeasure/);
  assert.match(dashboardSource, /monthlyVolumeAxisUnit/);
});
