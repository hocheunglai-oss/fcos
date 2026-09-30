import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isReadOnlyHedgeDeskAction } from '../api/_hedgeDeskReadOnly.js';
import { handleHedgeDeskEntity } from '../api/_hedgeDeskService.js';
import { prepareManualMopsVerification } from '../api/_hedgeMops.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';
import { tradingDaysInMonth } from '../src/hedge/lib/domain.js';

const profile = { id: 'normal-trader', email: 'trader@example.invalid' };
const capabilities = { hedge_book_manage: true, hedge_settlement_manage: true, hedge_close_approve: true, hedge_admin: true };

async function withDeployment(env, callback) {
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, FCOS_ENABLE_READ_ONLY_CI: process.env.FCOS_ENABLE_READ_ONLY_CI };
  try {
    for (const key of Object.keys(saved)) {
      if (env[key] == null) delete process.env[key];
      else process.env[key] = env[key];
    }
    await callback();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fixture({ cutover = false, allowExpiry = false, failTable = null } = {}) {
  const month = '2026-07';
  const mops = tradingDaysInMonth(month).map((price_date, index) => ({
    id: `price-${index}`, price_date, s380: 400, s05: 500, sgo: 70,
    is_estimate: false, updated_date: `${price_date}T12:00:00Z`,
  }));
  const verification = prepareManualMopsVerification(month, mops, 'Verified third-party monthly average.', {
    now: new Date('2026-07-31T12:00:00Z'),
  });
  assert.equal(verification.verified, true);
  const tables = {
    hedge_physical_trades: [{ id: 'physical-1', product: 'S0.5', qty_min: 10, counterparty: 'TEST', sell_pricing_month: month }],
    hedge_swap_hedges: [{ id: 'swap-1', revision: 1, trade_date: '2026-07-20', trade_type: 'OUTRIGHT', product: 'S0.5', direction: 'Buy', swap_month: month, quantity: 10, unit: 'MT', is_expired: false }],
    hedge_swap_physical_links: [{ swap_id: 'swap-1', physical_trade_id: 'physical-1', link_order: 0 }],
    hedge_market_prices: mops,
    hedge_mops_month_verifications: [{ contract_month: month, calculated_snapshot: verification.calculatedSnapshot, source_snapshot: verification.sourceSnapshot, input_fingerprint: verification.inputFingerprint }],
    hedge_settings: [{ id: 'rates-1', key: 'rates', value: {} }],
    hedge_invoices: [{ id: 'invoice-1' }],
    hedge_invoice_lines: [{ invoice_id: 'invoice-1', product: 'S0.5', quantity: 10, line_order: 0 }],
    hedge_invoice_swaps: [{ invoice_id: 'invoice-1', swap_id: 'swap-1', link_order: 0 }],
    hedge_invoice_physicals: [{ invoice_id: 'invoice-1', physical_trade_id: 'physical-1', link_order: 0 }],
    hedge_events: [{ id: 'event-1', event_type: 'record_created', entity_type: 'SwapHedge', entity_id: 'swap-1', actor_email: profile.email }],
    market_curve_shadow_control: [{ id: 'company', cutover_approved: cutover, reviewed_at: cutover ? '2026-07-31T12:00:00Z' : null, revision: 1 }],
  };
  const reads = [];
  const writes = [];
  const client = {
    from(table) {
      reads.push(table);
      let rows = structuredClone(tables[table] || []);
      let single = false;
      const query = new Proxy({}, { get(_target, method) {
        if (method === 'then') return (resolve) => resolve({
          data: single ? rows[0] || null : rows,
          error: table === failTable ? { message: 'Unavailable test read' } : null,
        });
        if (['insert', 'update', 'upsert', 'delete'].includes(method)) return () => {
          writes.push({ table, method });
          throw new Error(`Unexpected write: ${table}.${method}`);
        };
        if (['select', 'order', 'limit', 'eq', 'in', 'gte', 'lte', 'lt', 'gt', 'range', 'maybeSingle'].includes(method)) return (...args) => {
          if (method === 'eq') rows = rows.filter((row) => row[args[0]] === args[1]);
          if (method === 'in') rows = rows.filter((row) => args[1].includes(row[args[0]]));
          if (method === 'limit') rows = rows.slice(0, args[0]);
          if (method === 'range') rows = rows.slice(args[0], args[1] + 1);
          if (method === 'maybeSingle') single = true;
          return query;
        };
        throw new Error(`Unexpected database method: ${table}.${String(method)}`);
      } });
      return query;
    },
    async rpc(name, body) {
      writes.push({ name, body });
      if (!allowExpiry || name !== 'expire_paper_hedge_with_audit') throw new Error(`Unexpected RPC: ${name}`);
      const swap = tables.hedge_swap_hedges.find((row) => row.id === body.p_hedge_id);
      swap.is_expired = true;
      return { data: { expired: true }, error: null };
    },
  };
  return { client, reads, writes };
}

test('Hedge Desk positively classifies only supported read actions', () => {
  for (const action of ['list', 'filter', 'get', 'snapshot']) assert.equal(isReadOnlyHedgeDeskAction({ action }), true);
  for (const action of ['create', 'update', 'delete', 'brokerSettlementUpdate', 'verify_month', 'future_action']) assert.equal(isReadOnlyHedgeDeskAction({ action }), false);
});

test('normal Preview users load real snapshots and relationships without expiry or other writes, for both valuation modes', async () => {
  await withDeployment({ VERCEL_ENV: 'preview' }, async () => {
    for (const cutover of [false, true]) {
      const { client, reads, writes } = fixture({ cutover });
      const result = await handleHedgeDeskEntity({ action: 'snapshot', readOnly: false, skipExpiry: false, env: { VERCEL_ENV: 'production' } }, profile, { client, capabilities });
      assert.equal(result.physicals[0].id, 'physical-1');
      assert.deepEqual(result.swaps[0].physical_trade_ids, ['physical-1']);
      assert.equal(result.swaps[0].is_expired, false);
      assert.deepEqual(result.invoices[0].swap_ids, ['swap-1']);
      assert.equal(result.invoices[0].line_items[0].quantity, 10);
      assert.equal(result.auditLogs[0].id, 'event-1');
      assert.deepEqual(result.expiryAutomation, { status: 'not_run', reason: 'deployment_read_only' });
      assert.equal(result.deploymentReadOnly, true);
      assert.ok(Object.values(result.capabilities).every((value) => value === false));
      assert.equal(capabilities.hedge_book_manage, true);
      assert.deepEqual(writes, []);
      if (cutover) assert.ok(reads.includes('market_price_observations'));
    }
  });
});

test('explicit read-only deployment also skips expiry while ordinary Production retains audited expiry', async () => {
  await withDeployment({ VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' }, async () => {
    const { client, writes } = fixture();
    const result = await handleHedgeDeskEntity({ action: 'snapshot' }, profile, { client, capabilities });
    assert.equal(result.expiryAutomation.reason, 'deployment_read_only');
    assert.deepEqual(writes, []);
  });
  await withDeployment({ VERCEL_ENV: 'production' }, async () => {
    const { client, writes } = fixture({ allowExpiry: true });
    const result = await handleHedgeDeskEntity({ action: 'snapshot', readOnly: true, skipExpiry: true }, profile, { client, capabilities });
    assert.equal(result.deploymentReadOnly, false);
    assert.equal(result.expiryAutomation.expired, 1);
    assert.equal(result.swaps[0].is_expired, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].name, 'expire_paper_hedge_with_audit');
    assert.equal(result.capabilities, capabilities);
  });
});

test('Preview permits settings list/filter/get but rejects mutations and unknown actions before touching storage', async () => {
  await withDeployment({ VERCEL_ENV: 'preview' }, async () => {
    for (const body of [
      { action: 'list', entity: 'AppConfig' },
      { action: 'filter', entity: 'AppConfig', params: { key: 'rates' } },
      { action: 'get', entity: 'AppConfig', id: 'rates-1' },
    ]) {
      const { client, writes } = fixture();
      const result = await handleHedgeDeskEntity(body, profile, { client, capabilities });
      assert.equal((Array.isArray(result) ? result[0] : result).key, 'rates');
      assert.deepEqual(writes, []);
    }
    for (const action of ['create', 'update', 'delete', 'brokerSettlementUpdate', 'future_action']) {
      const { client, reads, writes } = fixture();
      await assert.rejects(handleHedgeDeskEntity({ action, entity: 'AppConfig', readOnly: true }, profile, { client, capabilities }), { status: 403, code: 'FCOS_DEPLOYMENT_READ_ONLY' });
      assert.deepEqual(reads, []);
      assert.deepEqual(writes, []);
    }
  });
});

test('CI identity remains denied Hedge Desk reads before storage access', async () => {
  const { client, reads } = fixture();
  for (const action of ['list', 'filter', 'get', 'snapshot']) {
    await assert.rejects(handleHedgeDeskEntity({ action, entity: 'AppConfig' }, { email: FCOS_READ_ONLY_CI.email }, { client, capabilities }), { status: 403, code: 'FCOS_CI_READ_ONLY' });
  }
  assert.deepEqual(reads, []);
});

test('a failed Preview snapshot read remains an error instead of a successful empty result', async () => {
  await withDeployment({ VERCEL_ENV: 'preview' }, async () => {
    const { client, writes } = fixture({ failTable: 'hedge_physical_trades' });
    await assert.rejects(handleHedgeDeskEntity({ action: 'snapshot' }, profile, { client, capabilities }), /Unavailable test read/);
    assert.deepEqual(writes, []);
  });
});

test('mixed dispatch defers only the body classification and retains normal authentication, module and CI gates', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  assert.match(source, /const context = await requireActiveUser\(req\);[\s\S]*?requireReadOnlyCiOperation\(context\.profile, name/);
  assert.match(source, /userHasAnyModuleAccess\(context\.client, context\.profile, policy\.modules\)/);
  assert.match(source, /name === 'hedgeDeskEntity' \? !isReadOnlyHedgeDeskAction\(body\)/);
  assert.match(source, /requireDeploymentMutationAllowed\(deploymentMutation\);[\s\S]*?const data = await fn\(body, req, accessContext\)/);
});
