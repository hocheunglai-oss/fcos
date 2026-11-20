import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL(
  '../force-app/main/default/lwc/fcbPromotedOfferLineItemExtraCosts/fcbPromotedOfferLineItemExtraCosts.js',
  import.meta.url,
), 'utf8');

test('loading distinct buy and sell transport records keeps both source links in either order', async () => {
  const products = [
    { Id: 'buy-product', Name: 'Transport (Barge)', Family: 'Transportation' },
    { Id: 'sell-product', Name: 'Transport (Truck)', Family: 'Transportation' },
  ];
  const buy = { Id: 'buy-charge', Product__c: 'buy-product', Quantity__c: 2, Unit_Cost__c: 15 };
  const sell = { Id: 'sell-charge', Product__c: 'sell-product', Quantity__c: 3, Unit_Cost__c: 20 };
  const plainClass = source.replace(/^import\b[^;]+;\s*/gmu, '')
    .replace(/@(api|track)\s+/gu, '').replace('export default class', 'return class');

  for (const rows of [[buy, sell], [sell, buy]]) {
    let loaded;
    const completed = new Promise(resolve => { loaded = resolve; });
    const Component = new Function('LightningElement', 'console', 'getUnitOfMeasurePickListValues',
      'loadExtraCostProducts', 'getSTEMCharges', 'getOfferSTEMCharges', plainClass)(
      class {}, { log() {} }, async () => ({}), async () => products,
      async () => { loaded(); return []; }, async () => [],
    );
    const component = new Component();
    component.calculateTotal = () => {};
    component._quoteLineItem = {
      Unit_of_Measure__c: 'MT',
      Transportation_Type_Buy__c: 'Barge (Excluded)',
      Transportation_Type_Sell__c: 'Truck (Excluded)',
      Supplier_Bid_Extra_Costs__r: rows,
    };
    Object.defineProperty(component, 'quoteLineItem', { get: () => component._quoteLineItem, set() {} });
    component.connectedCallback();
    await completed;
    assert.equal(component.transportationExtraCostBuy.supplierBidExtraCostId, buy.Id);
    assert.equal(component.transportationExtraCostSell.supplierBidExtraCostId, sell.Id);
  }
});

test('promoted extra costs only send supplier bid provenance for their source product', async () => {
  let payload;
  const plainClass = source.replace(/^import\b[^;]+;\s*/gmu, '')
    .replace(/@(api|track)\s+/gu, '').replace('export default class', 'return class');
  const Component = new Function('LightningElement', 'upsertProductExtraCosts', 'QUOTE_LINE_ITEM', 'console', plainClass)(
    class {},
    input => { payload = input; },
    { objectApiName: 'QuoteLineItem' },
    { log() {}, error(error) { throw error; } },
  );
  const component = new Component();
  const quoteLine = {
    Id: 'fixture-quote-line', IsQuantityRange__c: false, Quantity__c: 1,
    Unit_of_Measure__c: 'MT', Opportunity_Line_Item__r: { ETA_ETB__c: null },
  };
  const product = { Id: 'fixture-product', Name: 'Transport' };
  const otherProduct = { Id: 'fixture-other-product', Name: 'Other transport' };
  const bid = { Id: 'fixture-bid-extra', Product__c: product.Id, Quantity__c: 1, Fixed__c: false };
  component._quoteLineItem = quoteLine;
  component._getTransportationProductByTransportationType = () => product;
  component.supplierBidIds = [];
  const lookup = async () => {
    await component.upsertExtraCosts(quoteLine.Id, 'fixture-quote', null, null);
    return payload.quoteLineItemExtraCosts.map(row => row.Supplier_Bid_Extra_Cost__c ?? null);
  };

  component.transportationExtraCostBuy = component._addTransportationExtraCost(quoteLine, null, 'Included', 'Buy');
  component.transportationExtraCostSell = component._addTransportationExtraCost(quoteLine, null, 'Included', 'Sell');
  assert.deepEqual(await lookup(), [null, null]);

  component.transportationExtraCostBuy = component._addTransportationExtraCost(bid, null, 'Included', 'Buy', true);
  component.transportationExtraCostSell = component._addTransportationExtraCost(
    { ...bid, Product__c: otherProduct.Id }, null, 'Included', 'Sell', true,
  );
  assert.deepEqual(await lookup(), [null, bid.Id]);

  component.transportationExtraCostBuy.product2Id = otherProduct.Id;
  assert.deepEqual(await lookup(), [null, null]);
  component.transportationExtraCostBuy.product2Id = product.Id;

  component._getTransportationProductByTransportationType = () => otherProduct;
  component.repopulateTransportationExtraCostValue(component.transportationExtraCostBuy, 'Included');
  assert.deepEqual(await lookup(), [null, null]);

  const price = { value: 0 };
  const cost = {
    id: bid.Id, sourceProductId: product.Id, product2Id: product.Id, quantity: { value: 1 },
    quantityMaximum: price, unitPrice: price, lumpsumCostBuyAt: price, lumpsumCostSellAt: price,
    minimumBuyAt: price, minimumSellAt: price,
  };
  component.extraCosts = [cost];
  assert.deepEqual(await lookup(), [bid.Id, null, null]);
  cost.product2Id = otherProduct.Id;
  assert.deepEqual(await lookup(), [null, null, null]);
});
