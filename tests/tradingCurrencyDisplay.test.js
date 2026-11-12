import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { tradingCurrencyDisplay } from '../src/lib/tradingCurrencyDisplay.js';

test('HKD evidence shows the native unit price, USD equivalent, and saved confirmation state', () => {
  const value = tradingCurrencyDisplay({
    currency: 'HKD', hkdUnitPrice: '7800', fxRate: '7.8', fxRevision: 'fx-rate-history-001',
    fxConfirmedAt: '2026-09-10T01:02:03.000Z', existingUsd: '999',
  });
  assert.deepEqual(value, {
    hasHkdEvidence: true, existingUsd: 999, hasPreciseUsd: false, nativeHkd: 7800, usdEquivalent: 1000, fxRate: 7.8,
    fxRevision: 'fx-rate-history-001', fxConfirmedAt: '2026-09-10T01:02:03.000Z', rateStatus: 'Confirmed FX rate',
  });
});

test('missing HKD evidence keeps the existing legacy USD value', () => {
  for (const invalid of [
    { currency: 'HKD', hkdUnitPrice: null, fxRate: 7.8, fxRevision: 'revision' },
    { currency: 'HKD', hkdUnitPrice: 7800, fxRate: 0, fxRevision: 'revision' },
    { currency: 'HKD', hkdUnitPrice: 7800, fxRate: 7.8, fxRevision: '   ' },
    { currency: 'USD', hkdUnitPrice: 7800, fxRate: 7.8, fxRevision: 'revision' },
  ]) {
    const value = tradingCurrencyDisplay({ ...invalid, existingUsd: '1000' });
    assert.equal(value.hasHkdEvidence, false);
    assert.equal(value.usdEquivalent, 1000);
    assert.equal(value.rateStatus, null);
  }
});

test('STEM detail confines dual-currency evidence to desktop while retaining cancelled-line filtering', async () => {
  const source = await readFile(new URL('../src/components/dashboard/StemDetailModal.jsx', import.meta.url), 'utf8');
  assert.match(source, /FUEL_CURRENCY_PRICE_CLASS = "hidden md:flex/);
  assert.match(source, /MOBILE_UNIT_PRICE_CLASS = "md:hidden"/);
  assert.match(source, /Sell_HKD_Unit_Price__c/);
  assert.match(source, /Buy_HKD_Unit_Price__c/);
  assert.match(source, /Sell_USD_Unit_Price_Precise__c \?\? sellUsd/);
  assert.match(source, /Buy_USD_Unit_Price_Precise__c \?\? buyUsd/);
  assert.match(source, /activeStemLineItems\(res\.data\.lineItems\)/);
});
