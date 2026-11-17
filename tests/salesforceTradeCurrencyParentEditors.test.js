import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lwc = new URL('../force-app/main/default/lwc/', import.meta.url);
function methods(component, startMarker, endMarker, bindings = {}) {
  const source = readFileSync(new URL(`${component}/${component}.js`, lwc), 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return new Function(...Object.keys(bindings), `return class Fixture {\n${source.slice(start, end)}\n}`)(
    ...Object.values(bindings),
  );
}

function reviewEvent(recordId, direction, review) {
  return { detail: { recordId, direction, review } };
}

test('quote preview preserves ordinary price and a persisted managed price uses only the currency editor', () => {
  const QuoteEditor = methods('fcbEditOfferLineItemModal', '  get showBuyUsdPrice()', '  _convertDate(date)');
  const quote = new QuoteEditor();
  quote._currentOfferLineItem = { Id: 'quote-line', Supplier_Unit_Price__c: 500, UnitPrice: 520 };
  quote.handleCurrencyReview(reviewEvent('quote-line', 'Buy', {
    enabled: false, managedPrice: false, usdUnitPrice: 0,
  }));
  quote.handleCurrencyReview(reviewEvent('quote-line', 'Buy', {
    enabled: true, managedPrice: false, currencyCode: 'HKD', usdUnitPrice: 502,
  }));
  assert.equal(quote.showBuyUsdPrice, true);
  assert.equal(quote._currentOfferLineItem.Supplier_Unit_Price__c, 500);

  quote.handleCurrencyChange(reviewEvent('another-line', 'Buy', { enabled: true, managedPrice: true, usdUnitPrice: 503 }));
  assert.equal(quote._currentOfferLineItem.Supplier_Unit_Price__c, 500);
  quote.handleCurrencyChange(reviewEvent('quote-line', 'Buy', { enabled: true, managedPrice: true, usdUnitPrice: 504 }));
  assert.equal(quote._currentOfferLineItem.Supplier_Unit_Price__c, 504);
  assert.equal(quote.showBuyUsdPrice, false);
  assert.equal(quote.showSellUsdPrice, true);

  const fields = { ...quote._currentOfferLineItem, Buy_USD_Unit_Price_Precise__c: 504, Sell_FX_Side__c: 'managed' };
  quote.stripManagedFxFields(fields);
  assert.deepEqual(fields, { Id: 'quote-line', UnitPrice: 520 });
});

test('supplier preview keeps ordinary prices and a saved review updates only its bid', () => {
  const SupplierEditor = methods('fcbEditSupplierBidModal', '  handleCurrencyReview(event)', '  handleCompanyChange(event)');
  const supplier = new SupplierEditor();
  supplier.productSupplierBids = [
    { Id: 'bid', Supplier_Unit_Price__c: 500, showUsdPrice: true },
    { Id: 'other', Supplier_Unit_Price__c: 510, showUsdPrice: true },
  ];
  const refreshed = [];
  supplier.template = { querySelector: () => ({ refreshData: bids => refreshed.push(...bids) }) };
  supplier.handleCurrencyReview(reviewEvent('bid', 'Buy', { enabled: false, managedPrice: false, usdUnitPrice: 0 }));
  assert.equal(supplier.productSupplierBids[0].Supplier_Unit_Price__c, 500);
  assert.deepEqual(refreshed, []);

  supplier.handleCurrencyChange(reviewEvent('bid', 'Buy', { enabled: true, managedPrice: true, usdUnitPrice: 504 }));
  assert.equal(supplier.productSupplierBids[0].Supplier_Unit_Price__c, 504);
  assert.equal(supplier.productSupplierBids[1].Supplier_Unit_Price__c, 510);
  assert.deepEqual(refreshed.map(bid => bid.Id), ['bid']);
  const fields = { Id: 'bid', Supplier_Unit_Price__c: 504, Buy_USD_Unit_Price_Precise__c: 504 };
  supplier.stripManagedFxFields(fields, supplier.productSupplierBids[0].showUsdPrice);
  assert.deepEqual(fields, { Id: 'bid' });
});

test('a currency save result cannot update a different record after the editor switches', async () => {
  let finish;
  let submitted;
  const Editor = methods('fcosTradeCurrencyEditor', '    async save(confirmSide)', '    handleSaveDraft()', {
    saveDraft: input => {
      submitted = input;
      return new Promise(resolve => { finish = resolve; });
    },
  });
  const editor = new Editor();
  const events = [];
  Object.assign(editor, {
    recordId: 'original', direction: 'Buy', nativeUnitPrice: '504', currency: 'USD',
    review: { fingerprint: 'fixture-review' },
    template: { querySelector: () => ({ checkValidity: () => true }) },
    applyReview(review) { this.review = review; },
    dispatchEvent(event) { events.push(event.detail); },
  });

  const save = editor.save(false);
  assert.equal(submitted.recordId, 'original');
  assert.equal(submitted.reviewedFingerprint, 'fixture-review');
  editor.recordId = 'next';
  editor.review = { fingerprint: 'next-review' };
  finish({ managedPrice: true, usdUnitPrice: 504 });
  await save;
  assert.deepEqual(editor.review, { fingerprint: 'next-review' });
  assert.deepEqual(events, []);
  assert.equal(editor.isSaving, false);
});
