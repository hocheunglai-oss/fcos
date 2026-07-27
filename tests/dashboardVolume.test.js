import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dashboardLineItemVolume,
  dashboardVolumeLabel,
  findDashboardUomField,
  normalizeDashboardVolume,
  resolveDashboardItemUom,
} from '../api/_dashboardVolume.js';

const apiSource = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8');

test('converts litres to kilolitres without treating the source value as kilolitres', () => {
  assert.deepEqual(normalizeDashboardVolume(1, 'L'), {
    quantity: 0.001,
    unitOfMeasure: 'KL',
  });
  assert.deepEqual(normalizeDashboardVolume(1000, 'litres'), {
    quantity: 1,
    unitOfMeasure: 'KL',
  });
});

test('keeps kilolitres and metric tonnes unchanged', () => {
  assert.deepEqual(normalizeDashboardVolume(12.5, 'KL'), {
    quantity: 12.5,
    unitOfMeasure: 'KL',
  });
  assert.deepEqual(normalizeDashboardVolume(12.5, 'MT'), {
    quantity: 12.5,
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

test('uses native delivered quantity for explicit litre UOM', () => {
  const volume = dashboardLineItemVolume({
    Quantity_Delivered_Per_BDN__c: 1250,
    Quantity_in_MT__c: 1.05,
    Product__r: { QuantityUnitOfMeasure: 'L' },
  }, true, {
    productUomField: 'QuantityUnitOfMeasure',
    fallbackQuantity: 1.05,
  });
  assert.equal(volume.quantity, 1.25);
  assert.equal(volume.unitOfMeasure, 'KL');
  assert.equal(dashboardVolumeLabel(volume), '1.25 KL');
});

test('converts both boundaries before averaging a litre range', () => {
  const volume = dashboardLineItemVolume({
    Quantity__c: 1000,
    Quantity_Max__c: 2000,
    Is_Quantity_Range__c: true,
    UOM__c: 'L',
  }, false, {
    lineItemUomField: 'UOM__c',
  });
  assert.equal(volume.minimum, 1);
  assert.equal(volume.maximum, 2);
  assert.equal(volume.quantity, 1.5);
  assert.equal(dashboardVolumeLabel(volume), '1-2 KL');
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

test('dashboard integration reads Salesforce UOM and keeps mixed units separate', () => {
  assert.match(apiSource, /findDashboardUomField/);
  assert.match(apiSource, /dashboardLineItemVolume/);
  assert.match(apiSource, /monthlyProductVolumeSeries/);
  assert.doesNotMatch(apiSource, /productFamilyQuantityByName\\[family\\].*financialQuantity/);
  assert.match(dashboardSource, /Mixed units/);
  assert.match(dashboardSource, /monthlyVolumeHasMixedUnits/);
});
