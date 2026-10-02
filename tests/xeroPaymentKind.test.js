import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentKindReview } from '../api/_xeroPaymentKind.js';

const payment = (kind, changes = {}) => ({
  Id: 'a0Sfu0000078sIYEAY', RecordType: { DeveloperName: kind },
  Amount__c: 29, Date__c: '2026-01-02', _currency: { currency: 'USD', blockers: [] },
  ...changes,
});

test('exact Receivable and Payable retain their existing validation path', () => {
  for (const type of ['Receivable', 'Payable']) {
    assert.equal(paymentKindReview(payment(type)), null);
    assert.equal(paymentKindReview({ RecordType: { DeveloperName: type } }), null);
  }
});

test('known unsupported kinds have one truthful primary reason without invoice or bank lookup claims', () => {
  const cases = [
    ['Receivable_Remittance', 'payment_kind_remittance_review', /complete family and individual allocations/],
    ['Payable_Remittance', 'payment_kind_remittance_review', /complete family and individual allocations/],
    ['Bank_Charge', 'payment_kind_bank_charge_review', /related cash movement, gross\/net amounts and actual fee evidence/],
    ['Commission', 'payment_kind_commission_review', /exact Commission Invoice and accounting allocation/],
    ['Write_Off', 'payment_kind_write_off_review', /noncash settlement treatment/],
  ];
  for (const [kind, code, reason] of cases) {
    const result = paymentKindReview(payment(kind));
    assert.equal(result.kind, kind);
    assert.deepEqual(result.blockerCodes, [code]);
    assert.equal(result.blockers.length, 1);
    assert.match(result.blockers[0], reason);
    assert.doesNotMatch(result.blockers.join(' '), /not durably linked|bank is missing|No approved|Refunds require|must be positive/);
    assert.deepEqual(Object.keys(result).sort(), ['blockerCodes', 'blockers', 'kind']);
  }
});

test('signed commission offsets and write-offs never become ordinary refunds or positive amounts', () => {
  for (const kind of ['Commission', 'Write_Off', 'Bank_Charge', 'Payable_Remittance']) {
    for (const amount of [-219467.52, -0.03, 0, 2100]) {
      const input = payment(kind, { Amount__c: amount });
      const before = structuredClone(input);
      const result = paymentKindReview(input);
      assert.equal(result.blockers.length, 1);
      assert.doesNotMatch(result.blockers.join(' '), /cash refund|must be positive|Refunds require/);
      assert.deepEqual(input, before);
      assert.equal(Object.hasOwn(result, 'proposedPayment'), false);
      assert.equal(Object.hasOwn(result, 'eligible'), false);
    }
  }
});

test('unknown and malformed kinds remain explicitly unsupported, without coercion or prototype lookup', () => {
  for (const kind of ['receivable', 'Payable ', 'Other', '', null, undefined, {}, 'constructor', '__proto__']) {
    const result = paymentKindReview(payment(kind));
    assert.equal(result.kind, 'Unknown');
    assert.deepEqual(result.blockerCodes, ['payment_kind_unsupported']);
    assert.match(result.blockers[0], /Unsupported Salesforce payment kind/);
  }
});

test('unsupported review retains independent identity, currency, date and amount data gaps', () => {
  const result = paymentKindReview({ RecordType: { DeveloperName: 'Commission' } });
  assert.equal(result.kind, 'Commission');
  assert.deepEqual(result.blockerCodes, ['payment_kind_commission_review', 'payment_source_identity_invalid',
    'payment_source_currency_invalid', 'payment_source_date_invalid', 'payment_source_amount_invalid']);
  assert.equal(result.blockers.length, result.blockerCodes.length);
  assert.doesNotMatch(result.blockers.join(' '), /bank|durably linked|refund/i);
  for (const input of [null, undefined, 0, 'Commission']) {
    const review = paymentKindReview(input);
    assert.equal(review.kind, 'Unknown');
    assert.equal(review.blockers.length, review.blockerCodes.length);
  }
});

test('invalid numbers are not silently converted to zero or cash', () => {
  for (const amount of [undefined, null, '', '29', '-0.03', false, true, NaN, Infinity, -Infinity, {}]) {
    const result = paymentKindReview(payment('Write_Off', { Amount__c: amount }));
    assert.deepEqual(result.blockerCodes, ['payment_kind_write_off_review', 'payment_source_amount_invalid']);
    assert.match(result.blockers[1], /explicit finite numeric source amount/);
  }
});

test('source currency and real calendar date remain required without selecting a bank', () => {
  for (const currency of [null, undefined, '', 'usd', ' USD', 'US', 123]) {
    const result = paymentKindReview(payment('Bank_Charge', { _currency: { currency } }));
    assert.ok(result.blockerCodes.includes('payment_source_currency_invalid'));
  }
  assert.ok(paymentKindReview(payment('Bank_Charge', { _currency: { currency: 'USD', blockers: ['Unverified source currency'] } }))
    .blockerCodes.includes('payment_source_currency_invalid'));
  assert.equal(paymentKindReview(payment('Bank_Charge', { CurrencyIsoCode: 'HKD' })).blockers.length, 1);
  for (const date of [null, undefined, '', '2026-02-30', '2026-13-01', '02/03/2026', 20260102]) {
    assert.ok(paymentKindReview(payment('Commission', { Date__c: date })).blockerCodes.includes('payment_source_date_invalid'));
  }
  assert.equal(paymentKindReview(payment('Commission', { Date__c: '2024-02-29' })).blockers.length, 1);
});

test('separate remittance family blocker is retained without conferring summary eligibility', () => {
  for (const kind of ['Receivable_Remittance', 'Payable_Remittance']) {
    const reason = 'The complete remittance family contains inconsistent bank evidence.';
    const result = paymentKindReview(payment(kind, { _remittanceSummaryBlocker: reason, _remittanceSummaryEligible: true }));
    assert.equal(result.blockers[1], reason);
    assert.deepEqual(result.blockerCodes, ['payment_kind_remittance_review', 'payment_remittance_family_unverified']);
    assert.equal(Object.hasOwn(result, 'eligible'), false);
    assert.equal(Object.hasOwn(result, 'proposedPayment'), false);
  }
  for (const reason of [null, '', '  ', {}, ['message']]) {
    assert.equal(paymentKindReview(payment('Payable_Remittance', { _remittanceSummaryBlocker: reason })).blockers.length, 1);
  }
  assert.equal(paymentKindReview(payment('Bank_Charge', { _remittanceSummaryBlocker: 'Unrelated marker' })).blockers.length, 1);
});

test('caller and returned objects cannot mutate subsequent kind decisions', () => {
  const input = Object.freeze(payment('Bank_Charge', { RecordType: Object.freeze({ DeveloperName: 'Bank_Charge' }),
    _currency: Object.freeze({ currency: 'USD', blockers: Object.freeze([]) }) }));
  const first = paymentKindReview(input);
  first.blockers.splice(0, 1);
  first.blockerCodes[0] = 'eligible';
  const second = paymentKindReview(input);
  assert.equal(second.blockers.length, 1);
  assert.deepEqual(second.blockerCodes, ['payment_kind_bank_charge_review']);
});
