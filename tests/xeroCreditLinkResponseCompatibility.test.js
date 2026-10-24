import assert from 'node:assert/strict';
import test from 'node:test';
import { creditLinkReviewCompatibility } from '../api/_xeroCreditLinkResponseCompatibility.js';
import { xeroReviewFingerprint } from '../api/_xeroFinancialSync.js';

const originalLine = { LineItemID: 'line-one', Description: 'Discount credit', Quantity: 1, UnitAmount: 100,
  LineAmount: 100, TaxAmount: 0, TaxType: 'NONE', AccountCode: '41202', Tracking: [] };

function fixture() {
  const saved = { xeroCollection: 'CreditNotes', action: 'protected_legacy', sourceFingerprint: 'source-one',
    postingMode: 'draft', proposedPayload: {}, blockers: [], differences: [{ field: 'reference', xero: 'retained' }],
    xero: { id: 'credit-one', type: 'ACCRECCREDIT', collection: 'CreditNotes', total: 100,
      contactId: 'contact-one', currency: 'USD', amountDue: 100, lineItems: [structuredClone(originalLine)] } };
  const current = structuredClone(saved);
  Object.assign(current.xero.lineItems[0], { ValidationErrors: [], DiscountEnteredAsPercent: true });
  const rawTarget = { CreditNoteID: 'credit-one', Type: 'ACCRECCREDIT', LineItems: structuredClone(current.xero.lineItems) };
  return { category: 'link_only', saved, current, rawTarget };
}

function syncRaw(f) { f.rawTarget.LineItems = structuredClone(f.current.xero.lineItems); }

test('credit compatibility accepts only the two additive defaults and leaves all input evidence intact', () => {
  for (const added of ['both', 'ValidationErrors', 'DiscountEnteredAsPercent']) {
    const f = fixture();
    if (added !== 'both') delete f.current.xero.lineItems[0][added === 'ValidationErrors' ? 'DiscountEnteredAsPercent' : 'ValidationErrors'];
    syncRaw(f);
    const before = structuredClone(f);
    const result = creditLinkReviewCompatibility(f);
    assert.equal(result.reviewFingerprint, xeroReviewFingerprint(f.saved));
    assert.equal(result.currentReviewFingerprint, xeroReviewFingerprint(f.current));
    assert.equal(result.removedFields.length, added === 'both' ? 2 : 1);
    assert.deepEqual(f, before);
  }
  const exact = fixture(); exact.current = structuredClone(exact.saved); delete exact.rawTarget;
  assert.deepEqual(creditLinkReviewCompatibility(exact), { reviewFingerprint: xeroReviewFingerprint(exact.saved),
    currentReviewFingerprint: xeroReviewFingerprint(exact.saved), removedFields: [] });
});

test('compatible flags still require every other review field and original line identity/order', () => {
  const changes = [
    (f) => { f.current.sourceFingerprint = 'changed'; },
    (f) => { f.current.action = 'create'; },
    (f) => { f.current.proposedPayload = { Total: 100 }; },
    (f) => { f.current.differences = []; },
    (f) => { f.current.blockers = ['blocked']; },
    (f) => { f.current.xero.contactId = 'different-contact'; },
    (f) => { f.current.xero.currency = 'HKD'; },
    (f) => { f.current.xero.amountDue = 80; },
    (f) => { f.current.xero.updatedDateUTC = 'changed'; },
    (f) => { f.current.xero.unowned = { CurrencyRate: 2 }; },
    (f) => { f.current.xero.lineItems[0].LineAmount = 99; syncRaw(f); },
    (f) => { f.current.xero.lineItems[0].LineItemID = 'different-line'; syncRaw(f); },
    (f) => { f.current.xero.lineItems[0].DiscountRate = 0; syncRaw(f); },
    (f) => { f.current.xero.lineItems[0].DiscountAmount = 0; syncRaw(f); },
    (f) => { f.current.xero.lineItems[0].OtherResponseFlag = []; syncRaw(f); },
    (f) => { f.current.xero.lineItems.push({ ...f.current.xero.lineItems[0], LineItemID: 'line-two' }); syncRaw(f); },
    (f) => { f.saved.xero.lineItems.push({ ...originalLine, LineItemID: 'line-two' });
      f.current.xero.lineItems.push({ ...f.current.xero.lineItems[0], LineItemID: 'line-two' }); f.current.xero.lineItems.reverse(); syncRaw(f); },
    (f) => { delete f.saved.xero.lineItems[0].LineItemID; delete f.current.xero.lineItems[0].LineItemID; syncRaw(f); },
    (f) => { f.saved.xero.lineItems.push(structuredClone(originalLine)); f.current.xero.lineItems.push(structuredClone(f.current.xero.lineItems[0])); syncRaw(f); },
    (f) => { f.saved.xero.lineItems[0].DiscountEnteredAsPercent = false; },
    (f) => { f.category = 'draft'; },
    (f) => { f.current.xeroCollection = 'Invoices'; },
    (f) => { f.saved.xero.collection = 'Invoices'; },
    (f) => { delete f.rawTarget; },
    (f) => { f.rawTarget.CreditNoteID = 'other-credit'; },
    (f) => { f.rawTarget.LineItems = []; },
    (f) => { f.rawTarget.LineItems[0].DiscountRate = 0; },
  ];
  changes.forEach((change, index) => { const f = fixture(); change(f); assert.equal(creditLinkReviewCompatibility(f), null, `change ${index}`); });
});

test('fallback rejects nonempty or malformed errors and substantive raw validation/discount flags', () => {
  for (const value of [[{ Message: 'invalid' }], null, {}, false, '']) {
    for (const location of ['saved', 'current', 'raw']) {
      const f = fixture();
      if (location === 'raw') f.rawTarget.ValidationErrors = value;
      else { f[location].xero.lineItems[0].ValidationErrors = value; syncRaw(f); }
      assert.equal(creditLinkReviewCompatibility(f), null);
    }
  }
  for (const key of ['HasErrors', 'HasValidationErrors', 'IsDiscounted', 'HasDiscount', 'HasDiscounts']) {
    for (const value of [true, 'false', 0, null]) {
      const f = fixture(); f.rawTarget[key] = value;
      assert.equal(creditLinkReviewCompatibility(f), null, `${key}=${value}`);
    }
  }
  for (const value of ['ERROR', null, false]) { const f = fixture(); f.rawTarget.StatusAttributeString = value; assert.equal(creditLinkReviewCompatibility(f), null); }
  for (const value of [false, null, 1, 'true']) { const f = fixture(); f.current.xero.lineItems[0].DiscountEnteredAsPercent = value; syncRaw(f); assert.equal(creditLinkReviewCompatibility(f), null); }
});

test('discounts must be absent or exact valid zero, and missing versus zero remains a review change', () => {
  for (const field of ['DiscountRate', 'DiscountAmount', 'TotalDiscount']) {
    for (const value of [1, -1, 0.00001, '0.00001', null, false, '', '0x0', '0e0', 'bad', NaN, Infinity]) {
      const f = fixture(); f.saved.xero.lineItems[0][field] = value; f.current.xero.lineItems[0][field] = value; syncRaw(f);
      assert.equal(creditLinkReviewCompatibility(f), null, `${field}=${value}`);
    }
    for (const value of [0, -0, '0', '0.00', '-0.0000']) {
      const f = fixture(); f.saved.xero.lineItems[0][field] = value; f.current.xero.lineItems[0][field] = value; syncRaw(f);
      assert.equal(creditLinkReviewCompatibility(f)?.reviewFingerprint, xeroReviewFingerprint(f.saved));
    }
    const raw = fixture(); raw.rawTarget[field] = 0.00001; assert.equal(creditLinkReviewCompatibility(raw), null);
  }
});
