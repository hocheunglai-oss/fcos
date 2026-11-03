import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyCoverage } from '../api/_marketMonthlyCoverage.js';

const SEPTEMBER = '2026-09';
const OCTOBER = '2026-10';

function physical(overrides = {}) {
  return {
    id: 'physical',
    counterparty: 'A',
    product: 'S380',
    qty_min: 100,
    qty_max: 100,
    unit: 'MT',
    delivery_date_from: '2026-09-10',
    delivery_date_to: '2026-09-12',
    buy_price_type: 'Fixed',
    buy_pricing_month: SEPTEMBER,
    buy_pricing_basis: 'WMA',
    sell_price_type: 'Fixed',
    sell_pricing_month: SEPTEMBER,
    sell_pricing_basis: 'WMA',
    ...overrides,
  };
}

function swap(overrides = {}) {
  return {
    id: 'swap',
    counterparty: 'A',
    product: 'S380',
    quantity: 100,
    unit: 'MT',
    direction: 'BUY',
    trade_type: 'STANDARD',
    swap_month: SEPTEMBER,
    pricing_basis: 'WMA',
    ...overrides,
  };
}

function pricingRow(result, expected) {
  const row = result.pricingRows.find((candidate) => Object.entries(expected).every(([field, value]) => candidate[field] === value));
  assert.ok(row, `Expected pricing row ${JSON.stringify(expected)} in ${JSON.stringify(result.pricingRows)}`);
  return row;
}

function deliveryRow(result, expected) {
  const row = result.deliveryRows.find((candidate) => Object.entries(expected).every(([field, value]) => candidate[field] === value));
  assert.ok(row, `Expected delivery row ${JSON.stringify(expected)} in ${JSON.stringify(result.deliveryRows)}`);
  return row;
}

test('fixed legs remain separate while floating physicals and opposite hedge directions form the signed residual', () => {
  const result = buildMonthlyCoverage([
    physical({ sell_price_type: 'MOPS WMA' }),
  ], [
    swap({ id: 'buy-hedge', quantity: 20, direction: 'BUY' }),
    swap({ id: 'sell-hedge', quantity: 60, direction: 'SELL' }),
  ]);

  const fixed = pricingRow(result, { month: SEPTEMBER, basis: 'Fixed' });
  assert.deepEqual({
    fixedBuyQty: fixed.fixedBuyQty,
    fixedSellQty: fixed.fixedSellQty,
    physicalNet: fixed.physicalNet,
    residualNet: fixed.residualNet,
  }, { fixedBuyQty: 100, fixedSellQty: 0, physicalNet: 0, residualNet: 0 });

  const floating = pricingRow(result, { month: SEPTEMBER, basis: 'WMA' });
  assert.deepEqual({
    physicalBuyFloatingQty: floating.physicalBuyFloatingQty,
    physicalSellFloatingQty: floating.physicalSellFloatingQty,
    buyHedgeQty: floating.buyHedgeQty,
    sellHedgeQty: floating.sellHedgeQty,
    physicalNet: floating.physicalNet,
    hedgeNet: floating.hedgeNet,
    residualNet: floating.residualNet,
    uncoveredQty: floating.uncoveredQty,
    excessHedgeQty: floating.excessHedgeQty,
  }, {
    physicalBuyFloatingQty: 0,
    physicalSellFloatingQty: 100,
    buyHedgeQty: 20,
    sellHedgeQty: 60,
    physicalNet: 100,
    hedgeNet: -40,
    residualNet: 60,
    uncoveredQty: 60,
    excessHedgeQty: 0,
  });
});

test('a hedge beyond the opposite floating physical quantity is classified as excess hedge', () => {
  const result = buildMonthlyCoverage([
    physical({ buy_price_type: 'MOPS WMA', sell_price_type: 'Fixed' }),
  ], [swap({ quantity: 140, direction: 'BUY' })]);
  const floating = pricingRow(result, { month: SEPTEMBER, basis: 'WMA' });
  assert.deepEqual({
    physicalNet: floating.physicalNet,
    hedgeNet: floating.hedgeNet,
    residualNet: floating.residualNet,
    uncoveredQty: floating.uncoveredQty,
    excessHedgeQty: floating.excessHedgeQty,
  }, { physicalNet: -100, hedgeNet: 140, residualNet: 40, uncoveredQty: 0, excessHedgeQty: 40 });
});

test('months, pricing bases and distinct balance starts are never netted together', () => {
  const result = buildMonthlyCoverage([], [
    swap({ id: 'sep-wma-buy', quantity: 10 }),
    swap({ id: 'sep-wma-sell', quantity: 2, direction: 'SELL' }),
    swap({ id: 'oct-wma', quantity: 20, swap_month: OCTOBER }),
    swap({ id: 'bal-today-10', quantity: 30, pricing_basis: 'BAL_TODAY', bal_start_date: '2026-09-10' }),
    swap({ id: 'bal-tomorrow-10', quantity: 40, pricing_basis: 'BAL_TOMORROW', bal_start_date: '2026-09-10' }),
    swap({ id: 'bal-today-11', quantity: 50, pricing_basis: 'BAL_TODAY', bal_start_date: '2026-09-11' }),
  ]);

  assert.equal(result.pricingRows.length, 5);
  assert.deepEqual({
    buy: pricingRow(result, { month: SEPTEMBER, basis: 'WMA', balanceStartDate: null }).buyHedgeQty,
    sell: pricingRow(result, { month: SEPTEMBER, basis: 'WMA', balanceStartDate: null }).sellHedgeQty,
  }, { buy: 10, sell: 2 });
  assert.equal(pricingRow(result, { month: OCTOBER, basis: 'WMA', balanceStartDate: null }).buyHedgeQty, 20);
  assert.equal(pricingRow(result, { month: SEPTEMBER, basis: 'BAL_TODAY', balanceStartDate: '2026-09-10' }).buyHedgeQty, 30);
  assert.equal(pricingRow(result, { month: SEPTEMBER, basis: 'BAL_TOMORROW', balanceStartDate: '2026-09-10' }).buyHedgeQty, 40);
  assert.equal(pricingRow(result, { month: SEPTEMBER, basis: 'BAL_TODAY', balanceStartDate: '2026-09-11' }).buyHedgeQty, 50);
});

test('cross-month and invalid delivery windows remain unallocated instead of being guessed', () => {
  const result = buildMonthlyCoverage([
    physical({ id: 'cross-month', counterparty: 'Cross', qty_min: 100, qty_max: 200, delivery_date_from: '2026-09-30', delivery_date_to: '2026-10-02' }),
    physical({ id: 'invalid-end', counterparty: 'Invalid', qty_min: 40, qty_max: 60, delivery_date_to: 'not-a-date' }),
    physical({ id: 'single-month', counterparty: 'Known', qty_min: 70, qty_max: 90 }),
  ]);

  const crossMonth = deliveryRow(result, { counterparty: 'Cross' });
  assert.deepEqual({
    month: crossMonth.month,
    physicalQty: crossMonth.physicalQty,
    tradeCount: crossMonth.tradeCount,
    unallocated: crossMonth.unallocated,
  }, {
    month: null,
    physicalQty: 150,
    tradeCount: 1,
    unallocated: true,
  });
  const invalid = deliveryRow(result, { counterparty: 'Invalid' });
  assert.equal(invalid.month, null);
  assert.equal(invalid.physicalQty, 50);
  assert.equal(invalid.unallocated, true);
  assert.equal(deliveryRow(result, { counterparty: 'Known' }).month, SEPTEMBER);
  assert.match(result.warnings.join(' '), /remain unallocated/i);
});

test('spread hedge quantity is allocated to BUY leg 1 and SELL leg 2', () => {
  const result = buildMonthlyCoverage([], [swap({
    trade_type: 'SPREAD',
    direction: null,
    quantity: 75,
    leg1_month: SEPTEMBER,
    leg1_basis: 'WMA',
    leg2_month: OCTOBER,
    leg2_basis: 'BAL_TOMORROW',
    leg2_bal_date: '2026-10-08',
  })]);

  const leg1 = pricingRow(result, { month: SEPTEMBER, basis: 'WMA', balanceStartDate: null });
  const leg2 = pricingRow(result, { month: OCTOBER, basis: 'BAL_TOMORROW', balanceStartDate: '2026-10-08' });
  assert.deepEqual({ buy: leg1.buyHedgeQty, sell: leg1.sellHedgeQty, net: leg1.hedgeNet }, { buy: 75, sell: 0, net: 75 });
  assert.deepEqual({ buy: leg2.buyHedgeQty, sell: leg2.sellHedgeQty, net: leg2.hedgeNet }, { buy: 0, sell: 75, net: -75 });
});

test('missing or invalid pricing dates, bases and price types make coverage unknown rather than zero', () => {
  const cases = [
    {
      name: 'missing month',
      physical: physical({ buy_price_type: 'MOPS WMA', buy_pricing_month: null }),
      row: { month: null, basis: 'WMA' },
    },
    {
      name: 'invalid balance start',
      physical: physical({ buy_price_type: 'MOPS WMA', buy_pricing_basis: 'BAL_TODAY', buy_bal_date: '2026-10-01' }),
      row: { month: SEPTEMBER, basis: 'BAL_TODAY' },
    },
    {
      name: 'invalid basis',
      physical: physical({ buy_price_type: 'MOPS WMA', buy_pricing_basis: 'NOT_A_BASIS' }),
      row: { month: SEPTEMBER, basis: 'Unknown' },
    },
    {
      name: 'invalid price type',
      physical: physical({ buy_price_type: 'Mystery price type' }),
      row: { month: SEPTEMBER, basis: 'WMA' },
    },
  ];

  for (const fixture of cases) {
    const result = buildMonthlyCoverage([fixture.physical], []);
    const row = pricingRow(result, fixture.row);
    assert.ok(row.unknownCount > 0, `${fixture.name} should increment unknownCount`);
    assert.equal(row.physicalNet, null, `${fixture.name} physical net`);
    assert.equal(row.hedgeNet, null, `${fixture.name} hedge net`);
    assert.equal(row.residualNet, null, `${fixture.name} residual`);
    assert.equal(row.uncoveredQty, null, `${fixture.name} uncovered quantity`);
    assert.equal(row.excessHedgeQty, null, `${fixture.name} excess hedge quantity`);
  }
});

test('an invalid hedge direction is unknown and cannot silently become zero coverage', () => {
  const result = buildMonthlyCoverage([], [swap({ direction: 'SIDEWAYS' })]);
  const row = pricingRow(result, { month: SEPTEMBER, basis: 'WMA' });
  assert.equal(row.buyHedgeQty, 0);
  assert.equal(row.sellHedgeQty, 0);
  assert.equal(row.unknownCount, 1);
  assert.equal(row.hedgeNet, null);
  assert.equal(row.residualNet, null);
  assert.equal(row.uncoveredQty, null);
  assert.equal(row.excessHedgeQty, null);
});

test('missing, non-numeric and zero quantities are unavailable rather than zero coverage', () => {
  for (const [name, quantity] of [['missing', null], ['non-numeric', 'many'], ['zero', 0]]) {
    const result = buildMonthlyCoverage([physical({ qty_min: quantity, qty_max: quantity, buy_price_type: 'MOPS WMA' })], []);
    assert.equal(result.deliveryRows[0].physicalQty, null, `${name} delivery quantity`);
    const row = pricingRow(result, { month: SEPTEMBER, basis: 'WMA' });
    assert.ok(row.unknownCount > 0, `${name} quantity should increment unknownCount`);
    assert.equal(row.residualNet, null, `${name} residual`);
    assert.equal(row.uncoveredQty, null, `${name} uncovered quantity`);
    assert.equal(row.excessHedgeQty, null, `${name} excess hedge quantity`);
  }

  const invalidSwap = buildMonthlyCoverage([], [swap({ quantity: 0 })]);
  const hedge = pricingRow(invalidSwap, { month: SEPTEMBER, basis: 'WMA' });
  assert.ok(hedge.unknownCount > 0);
  assert.equal(hedge.residualNet, null);
});

test('native product units are preserved while MT and BBL inputs use the configured gasoil conversion', () => {
  const result = buildMonthlyCoverage([
    physical({ id: 'sgo-physical', counterparty: 'SGO physical', product: 'SGO', unit: 'MT', qty_min: 10, qty_max: 20 }),
    physical({ id: 'fuel-physical', counterparty: 'Fuel physical', product: 'S380', unit: 'BBL', qty_min: 75, qty_max: 75 }),
  ], [
    swap({ id: 'sgo-hedge', counterparty: 'SGO hedge', product: 'SGO', unit: 'MT', quantity: 10 }),
    swap({ id: 'fuel-hedge', counterparty: 'Fuel hedge', product: 'S0.5', unit: 'BBL', quantity: 75 }),
  ], 7.5);

  assert.deepEqual({
    unit: deliveryRow(result, { counterparty: 'SGO physical' }).unit,
    quantity: deliveryRow(result, { counterparty: 'SGO physical' }).physicalQty,
  }, { unit: 'BBL', quantity: 112.5 });
  assert.deepEqual({
    unit: deliveryRow(result, { counterparty: 'Fuel physical' }).unit,
    quantity: deliveryRow(result, { counterparty: 'Fuel physical' }).physicalQty,
  }, { unit: 'MT', quantity: 10 });
  assert.deepEqual({
    unit: pricingRow(result, { counterparty: 'SGO hedge', basis: 'WMA' }).unit,
    quantity: pricingRow(result, { counterparty: 'SGO hedge', basis: 'WMA' }).buyHedgeQty,
  }, { unit: 'BBL', quantity: 75 });
  assert.deepEqual({
    unit: pricingRow(result, { counterparty: 'Fuel hedge', basis: 'WMA' }).unit,
    quantity: pricingRow(result, { counterparty: 'Fuel hedge', basis: 'WMA' }).buyHedgeQty,
  }, { unit: 'MT', quantity: 10 });
});

test('closed physicals and expired hedges are excluded from delivery and pricing coverage', () => {
  const result = buildMonthlyCoverage([
    physical({ id: 'open', counterparty: 'Open', qty_min: 10, qty_max: 10 }),
    physical({ id: 'closed', counterparty: 'Closed only', qty_min: 999, qty_max: 999, is_closed: true }),
  ], [
    swap({ id: 'live', counterparty: 'Live', quantity: 20 }),
    swap({ id: 'expired', counterparty: 'Expired only', quantity: 888, is_expired: true }),
  ]);

  assert.equal(deliveryRow(result, { counterparty: 'Open' }).physicalQty, 10);
  assert.equal(result.deliveryRows.some((row) => row.counterparty === 'Closed only'), false);
  assert.equal(pricingRow(result, { counterparty: 'Live', basis: 'WMA' }).buyHedgeQty, 20);
  assert.equal(result.pricingRows.some((row) => row.counterparty === 'Expired only'), false);
});
