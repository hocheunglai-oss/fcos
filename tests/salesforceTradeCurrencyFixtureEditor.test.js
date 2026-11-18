import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL(
  '../force-app/main/default/lwc/fcosTradeCurrencyEditor/fcosTradeCurrencyEditor.js', import.meta.url,
), 'utf8');

const fixtureId = 'a'.repeat(64);
const nextFixtureId = 'b'.repeat(64);
const review = { enabled: true, hongKong: true, currencyCode: 'USD', fingerprint: 'review-digest', rateId: 'fixture-rate' };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the real parent modals pass the supplied fixture to the correct editor direction', () => {
  const template = component => readFileSync(new URL(
    `../force-app/main/default/lwc/${component}/${component}.html`, import.meta.url,
  ), 'utf8');
  const quote = template('fcbEditOfferLineItemModal');
  assert.match(quote, /<c-fcos-trade-currency-editor record-id=\{currentOfferLineItem\.Id\} direction="Buy" fixture-id=\{buyEditorFixtureId\}/u);
  assert.match(quote, /<c-fcos-trade-currency-editor record-id=\{currentOfferLineItem\.Id\} direction="Sell" fixture-id=\{sellEditorFixtureId\}/u);
  const supplier = template('fcbEditSupplierBidModal');
  assert.match(supplier, /<c-fcos-trade-currency-editor key=\{productSupplierBid\.Id\} record-id=\{productSupplierBid\.Id\} direction="Buy" fixture-id=\{editorFixtureId\}/u);
});

function mount(overrides = {}) {
  const events = [];
  const calls = [];
  const names = ['preview', 'previewCurrency', 'saveDraft', 'previewFixture', 'saveFixture', 'previewAmendmentRate', 'amendCurrency'];
  const operations = Object.fromEntries(names.map(name => [name, async input => {
    calls.push({ name, input });
    return overrides[name] ? overrides[name](input) : review;
  }]));
  class LightningElement {
    template = { querySelector: () => ({ checkValidity: () => true }) };
    dispatchEvent(event) { events.push(event); }
  }
  if (!overrides.withoutDomConnectionGetter) LightningElement.prototype.isConnected = true;
  class CustomEvent {
    constructor(name, options) { Object.assign(this, { name, ...options }); }
  }
  const bindings = { ...operations, LightningElement, CustomEvent, canAmendCurrency: true };
  const body = source.replace(/^import .+;$/gmu, '').replace(/^\s*@api\s*$/gmu, '')
    .replace('export default class', 'return class');
  const Editor = new Function(...Object.keys(bindings), body)(...Object.values(bindings));
  return { editor: new Editor(), calls, events };
}

test('ordinary mount coalesces input and connect events and uses only the normal Apex actions', async () => {
  const { editor, calls } = mount({ withoutDomConnectionGetter: true });
  editor.direction = 'Buy';
  editor.recordId = 'ordinary-record';
  editor.connectedCallback();
  await tick();
  await editor.save(false);
  assert.deepEqual(calls.map(call => call.name), ['preview', 'saveDraft']);
  assert.deepEqual(calls[0].input, { direction: 'Buy', recordId: 'ordinary-record' });
  assert.equal(Object.hasOwn(calls[1].input, 'fixtureId'), false);
});

test('review scheduling uses lifecycle callbacks without a DOM connection getter and cancels on disconnect', async () => {
  const { editor, calls } = mount({ withoutDomConnectionGetter: true });
  editor.direction = 'Buy';
  editor.recordId = 'disconnected-record';
  editor.connectedCallback();
  editor.disconnectedCallback();
  await tick();
  assert.deepEqual(calls, []);
});

test('an explicit fixture uses scoped initial preview, currency selection and save', async () => {
  const { editor, calls } = mount();
  editor.recordId = 'offer-line';
  editor.direction = 'Sell';
  editor.fixtureId = fixtureId;
  editor.connectedCallback();
  await tick();
  await editor.handleCurrencyChange({ detail: { value: 'HKD' } });
  await editor.save(true);
  assert.deepEqual(calls.map(call => call.name), ['previewFixture', 'previewFixture', 'saveFixture']);
  assert.deepEqual(calls.map(call => call.input.fixtureId), [fixtureId, fixtureId, fixtureId]);
  assert.equal(calls[0].input.currencyCode, null);
  assert.equal(calls[1].input.currencyCode, 'HKD');
  assert.equal(calls[2].input.reviewedFingerprint, review.fingerprint);
  assert.equal(calls[2].input.confirmSide, true);
});

test('fixture refusal never falls back to ordinary Apex and cannot enter ordinary amendment', async () => {
  const { editor, calls } = mount({
    previewFixture() { throw new Error('Fixture denied'); },
  });
  editor.fixtureId = '';
  editor.recordId = 'unenrolled-record';
  editor.direction = 'Buy';
  editor.connectedCallback();
  await tick();
  assert.equal(editor.error, 'Fixture denied');
  assert.equal(editor.showEditor, false);
  editor.applyReview({ ...review, confirmedAt: 'now' });
  assert.equal(editor.canAmend, false);
  await editor.handleStartAmendment();
  await editor.handleSaveAmendment();
  assert.deepEqual(calls.map(call => call.name), ['previewFixture']);
});

test('changing the enrollment on the same record discards an earlier save result', async () => {
  let resolveSave;
  const { editor, calls, events } = mount({
    previewFixture: input => ({ ...review, fingerprint: input.fixtureId }),
    saveFixture: () => new Promise(resolve => { resolveSave = resolve; }),
  });
  editor.recordId = 'same-record';
  editor.direction = 'Sell';
  editor.fixtureId = fixtureId;
  editor.connectedCallback();
  await tick();
  const save = editor.save(false);
  editor.fixtureId = nextFixtureId;
  await tick();
  assert.equal(editor.review.fingerprint, nextFixtureId);
  resolveSave({ ...review, fingerprint: 'stale-result' });
  await save;
  assert.equal(editor.review.fingerprint, nextFixtureId);
  assert.equal(events.filter(event => event.name === 'currencychange').length, 0);
  assert.deepEqual(calls.map(call => call.name), ['previewFixture', 'saveFixture', 'previewFixture']);
});

test('the sandbox host mounts only the enrolled native modal and ignores a stale enrollment', async () => {
  const host = new URL('../e2e/fixtures/salesforce/lwc/fcosTradeCurrencyFixtureHost/', import.meta.url);
  const native = readFileSync(new URL('fcosTradeCurrencyFixtureHost.js', host), 'utf8')
    .replace(/^import .+;$/gmu, '').replace(/^\s*@wire\(.+\)\s*$/gmu, '')
    .replace('export default class', 'return class');
  const calls = [];
  let finish;
  const Host = new Function('LightningElement', 'previewFixture', native)(class {}, async args => {
    calls.push(args);
    if (args.fixtureId === nextFixtureId) await new Promise(resolve => { finish = resolve; });
  });
  const wrapper = new Host();
  const recordId = '0QL000000000001GAA';
  const page = {
    type: 'standard__component',
    attributes: { componentName: 'c__fcosTradeCurrencyFixtureHost' },
    state: { c__surface: 'quote', c__recordId: recordId, c__direction: 'Sell', c__fixtureId: fixtureId },
  };
  await wrapper.receiveScope(page);
  assert.deepEqual(calls, [{ fixtureId, recordId, direction: 'Sell', currencyCode: null }]);
  const fields = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
  const data = { id: recordId, apiName: 'QuoteLineItem', fields: fields({
    Port__r: { fields: fields({ Name: 'Hong Kong' }) },
    Product2: { fields: fields({ Name: 'Fuel' }) },
    QuoteId: 'quote',
  }) };
  wrapper.receiveRecord({ data: { ...data, id: 'another-record' } });
  assert.equal(wrapper.offerLine, undefined);
  wrapper.receiveRecord({ data });
  assert.equal(wrapper.offerLine.ProductName, 'Fuel');
  assert.equal(wrapper.quote.Id, 'quote');
  assert.equal(wrapper.sellFixtureId, fixtureId);
  assert.equal(wrapper.buyFixtureId, undefined);
  assert.equal(wrapper.bid, undefined);

  const delayed = wrapper.receiveScope({ ...page, state: { ...page.state, c__fixtureId: nextFixtureId } });
  assert.equal(wrapper.recordId, undefined);
  await wrapper.receiveScope({ ...page, state: { ...page.state, c__surface: 'supplier' } });
  finish();
  await delayed;
  assert.equal(wrapper.invalidScope, true);
  assert.equal(wrapper.recordId, undefined);

  await wrapper.receiveScope({ ...page, state: { ...page.state, c__surface: 'supplier', c__direction: 'Buy' } });
  wrapper.receiveRecord({ data: { id: recordId, apiName: 'Supplier_Bid__c',
    fields: fields({ Quote__c: 'quote', Supplier__c: 'supplier', Product__r: { fields: fields({ Name: 'Fuel' }) } }) } });
  assert.deepEqual(wrapper.bids.map(row => row.supplierBidIds), [[recordId]]);
  assert.equal(wrapper.bidQuoteId, 'quote');
  assert.equal(wrapper.buyFixtureId, fixtureId);
  assert.equal(wrapper.offerLine, undefined);
});

test('a refused fixture enrollment never loads or mounts a parent record', async () => {
  const host = new URL('../e2e/fixtures/salesforce/lwc/fcosTradeCurrencyFixtureHost/', import.meta.url);
  const native = readFileSync(new URL('fcosTradeCurrencyFixtureHost.js', host), 'utf8')
    .replace(/^import .+;$/gmu, '').replace(/^\s*@wire\(.+\)\s*$/gmu, '')
    .replace('export default class', 'return class');
  const Host = new Function('LightningElement', 'previewFixture', native)(class {}, async () => { throw new Error('denied'); });
  const wrapper = new Host();
  await wrapper.receiveScope({
    type: 'standard__component', attributes: { componentName: 'c__fcosTradeCurrencyFixtureHost' },
    state: { c__surface: 'quote', c__recordId: '0QL000000000001GAA', c__direction: 'Sell', c__fixtureId: fixtureId },
  });
  assert.equal(wrapper.invalidScope, true);
  assert.equal(wrapper.recordId, undefined);
  assert.equal(wrapper.offerLine, undefined);
  assert.equal(wrapper.bid, undefined);
});
