import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_PAYMENT_DATA_LABEL,
  PAYMENT_DATA_RELIABLE_FROM,
  legacyPaymentDataSoql,
  paymentDataReliabilityDate,
  paymentDataReliabilityMetadata,
  paymentDataReliabilityState,
  paymentDataReliableSoql,
} from '../src/lib/paymentDataReliability.js';

test('payment reliability uses actual delivery before expected delivery and Created Date', () => {
  const state = paymentDataReliabilityState({
    Delivery_Date__c: '2025-12-31',
    Expected_Delivery_Date__c: '2026-01-02',
    CreatedDate: '2026-01-03T00:00:00.000Z',
  });
  assert.equal(state.reliable, false);
  assert.equal(state.effectiveDate, '2025-12-31');
  assert.equal(state.dateBasis, 'actual_delivery_date');
  assert.equal(state.display, LEGACY_PAYMENT_DATA_LABEL);
});

test('payment reliability uses expected delivery when actual delivery is absent', () => {
  assert.deepEqual(
    paymentDataReliabilityDate({ Expected_Delivery_Date__c: PAYMENT_DATA_RELIABLE_FROM }),
    { date: '2026-01-01', basis: 'expected_delivery_date' },
  );
  assert.equal(paymentDataReliabilityState({ Expected_Delivery_Date__c: '2026-01-01' }).reliable, true);
});

test('undated STEM Created Date boundary is evaluated in Hong Kong time', () => {
  const before = paymentDataReliabilityState({ CreatedDate: '2025-12-31T15:59:59.999Z' });
  const boundary = paymentDataReliabilityState({ CreatedDate: '2025-12-31T16:00:00.000Z' });
  assert.equal(before.effectiveDate, '2025-12-31');
  assert.equal(before.reliable, false);
  assert.equal(boundary.effectiveDate, '2026-01-01');
  assert.equal(boundary.reliable, true);
  assert.equal(boundary.dateBasis, 'created_date_hong_kong');
});

test('missing payment reliability evidence fails closed as legacy settled', () => {
  const state = paymentDataReliabilityState({});
  assert.equal(state.reliable, false);
  assert.equal(state.effectiveDate, null);
  assert.equal(state.dateBasis, 'unavailable');
});

test('SOQL helpers encode the complete precedence without broadening relationship paths', () => {
  assert.match(paymentDataReliableSoql(), /Delivery_Date__c >= 2026-01-01/);
  assert.match(paymentDataReliableSoql('STEM__r.'), /STEM__r\.CreatedDate >= 2025-12-31T16:00:00\.000Z/);
  assert.match(legacyPaymentDataSoql('Supplier_Invoice__r.STEM__r.'), /Supplier_Invoice__r\.STEM__r\.Expected_Delivery_Date__c < 2026-01-01/);
  assert.throws(() => paymentDataReliableSoql('STEM__r. OR Name LIKE '), /Invalid Salesforce relationship prefix/);
});

test('response metadata declares count, policy, and reliable-only totals', () => {
  assert.deepEqual(paymentDataReliabilityMetadata(12, 8), {
    reliableFrom: '2026-01-01',
    policy: 'legacy_settled_by_company_confirmation',
    excludedLegacyRecordCount: 12,
    reliableRecordCount: 8,
    displayedTotalsUseReliableEvidenceOnly: true,
    legacyTreatment: 'Settled before FCOS cutover',
  });
});
