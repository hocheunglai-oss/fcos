import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketBookContext } from '../api/_marketBookContext.js';
import { buildExposureRows, buildQuantityCoverageRows, BROKER_EXCHANGE } from '../src/hedge/lib/domain.js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';

const physicals = [
  { id: 'p1', counterparty: 'A', product: 'S380', qty_min: 100, qty_max: 200, unit: 'MT' },
  { id: 'p2', counterparty: 'B', product: 'SGO', qty_min: 10, unit: 'MT' },
  { id: 'p3', counterparty: 'A', product: 'S380', qty_min: 900, unit: 'MT', is_closed: true },
];
const swaps = [
  { id: 's1', counterparty: 'A', product: 'S380', quantity: 100, direction: 'SELL', unit: 'MT' },
  { id: 's2', counterparty: 'A', product: 'S380', quantity: 20, direction: 'BUY', unit: 'MT' },
  { id: 's3', counterparty: 'B', product: 'SGO', quantity: 80, direction: 'SELL', unit: 'BBL' },
  { id: 's4', counterparty: 'A', product: 'S380', quantity: 900, direction: 'SELL', unit: 'MT', is_expired: true },
  { id: 's5', counterparty: BROKER_EXCHANGE[0], product: 'S380', quantity: 900, direction: 'SELL', unit: 'MT' },
  { id: 's6', product: 'S380', quantity: 900, direction: 'SELL', unit: 'MT' },
];

test('book coverage preserves counterparty netting, midpoint, exclusions and native units', () => {
  const rows = buildQuantityCoverageRows(physicals, swaps, 7.5);
  assert.deepEqual(rows.map(({ physicalQty, hedgeQty, netExposure, unit }) => ({ physicalQty, hedgeQty, netExposure, unit })), [
    { physicalQty: 150, hedgeQty: 80, netExposure: 70, unit: 'MT' },
    { physicalQty: 75, hedgeQty: 80, netExposure: -5, unit: 'BBL' },
  ]);
  assert.equal(rows[0].hedgeRatio, 80 / 150 * 100);
  assert.equal(rows[1].hedgeRatio, 80 / 75 * 100);
  const exposure = buildExposureRows(physicals, swaps, [], 7.5);
  for (let index = 0; index < rows.length; index += 1) {
    for (const key of Object.keys(rows[index])) assert.equal(exposure[index][key], rows[index][key]);
  }
  const unassigned = buildQuantityCoverageRows([{ qty_min: 75, product: 'S380', unit: 'BBL' }], [], 7.5)[0];
  assert.equal(unassigned.counterparty, 'Unassigned');
  assert.equal(unassigned.physicalQty, 10);
  const hedgeOnly = buildQuantityCoverageRows([], [swaps[0]])[0];
  assert.equal(hedgeOnly.hedgeRatio, null);
  assert.equal(hedgeOnly.netExposure, -100);
});

function clientMock({ physical = physicals, hedges = swaps, ratio = 7.5, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table }; calls.push(call);
      const query = {
        select(columns) { call.columns = columns; return query; },
        order() { return query; }, limit(limit) { call.limit = limit; return query; },
        gt(_column, id) { call.after = id; return query; }, eq() { return query; },
        maybeSingle() { return Promise.resolve({ data: { value: { sgo_bbl_per_mt: ratio } } }); },
        then(resolve, reject) {
          const rows = table === 'hedge_physical_trades' ? physical : hedges;
          const start = call.after ? rows.findIndex((row) => row.id === call.after) + 1 : 0;
          return Promise.resolve({ data: rows.slice(start, start + call.limit), error: fail ? new Error('sensitive internal failure') : null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('book endpoint denies either missing module and performs no book queries', async () => {
  for (const denied of ['markets', 'hedge_desk']) {
    const client = clientMock(); const checks = [];
    const handler = createMarketBookContext({
      requireActiveUser: async () => ({ client, profile: { id: 'user' } }),
      userHasAnyModuleAccess: async (_client, _profile, modules) => { checks.push(modules); return !modules.includes(denied); },
    });
    await assert.rejects(handler(), { statusCode: 403, code: 'MARKET_BOOK_ACCESS_DENIED' });
    assert.deepEqual(checks, [['markets'], ['hedge_desk']]);
    assert.equal(client.calls.length, 0);
  }
  const handler = createMarketBookContext({ requireActiveUser: async () => { throw Object.assign(new Error('Unauthorized'), { statusCode: 401 }); } });
  await assert.rejects(handler(), { statusCode: 401 });
});

test('book endpoint paginates beyond 1000 and returns only aggregates without writes', async () => {
  const client = clientMock({ physical: Array.from({ length: 1001 }, (_, index) => ({ id: `p${String(index).padStart(4, '0')}`, counterparty: 'A', product: 'S380', qty_min: 1, unit: 'MT' })), hedges: [] });
  const handler = createMarketBookContext({ requireActiveUser: async () => ({ client, profile: {} }), userHasAnyModuleAccess: async () => true });
  const result = await handler();
  assert.equal(result.rows[0].physicalQty, 1001);
  assert.equal(result.totals.openPhysicalCount, 1001);
  assert.equal(result.totals.liveHedgeCount, 0);
  assert.equal(client.calls.filter((row) => row.table === 'hedge_physical_trades').length, 2);
  assert.equal(JSON.stringify(result).includes('p0000'), false);
  assert.equal('physicalPnl' in result.rows[0], false);
  const policy = registeredHandlerBehavior('marketBookContext');
  assert.equal(policy.mutation, false); assert.equal(policy.externalAction, false); assert.equal(policy.cache, 'none');
});

test('book load failure is sanitized and invalid unit settings do not produce misleading coverage', async () => {
  for (const options of [{ fail: true }, { ratio: 0 }, { ratio: 'invalid' }]) {
    const client = clientMock(options);
    const handler = createMarketBookContext({ requireActiveUser: async () => ({ client, profile: {} }), userHasAnyModuleAccess: async () => true });
    await assert.rejects(handler(), (error) => error.statusCode === 502 && !error.message.includes('sensitive'));
  }
});
