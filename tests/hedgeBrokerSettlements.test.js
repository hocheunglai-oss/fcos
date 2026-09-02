import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { brokerSettlementCalculation } from '../api/_hedgeDeskService.js';
import { DEFAULT_RATES } from '../src/hedge/lib/domain.js';

test('broker settlement uses trade date month instead of swap pricing month', () => {
  const swaps = [
    { id: 'trade-july', trade_date: '2026-07-31', swap_month: '2026-08', venue: 'ICE', broker: 'Ginga', quantity: 100, unit: 'MT' },
    { id: 'trade-august', trade_date: '2026-08-01', swap_month: '2026-07', venue: 'ICE', broker: 'Ginga', quantity: 200, unit: 'MT' },
    { id: 'other-broker', trade_date: '2026-07-15', swap_month: '2026-07', venue: 'ICE', broker: 'FIS', quantity: 300, unit: 'MT' },
  ];
  const rates = { ...DEFAULT_RATES, broker_mt: 0.05 };

  const july = brokerSettlementCalculation(swaps, rates, '2026-07', 'ginga');
  assert.equal(july.tradeCount, 1);
  assert.equal(july.commissionAmount, 5);
  assert.equal(july.lines[0].id, 'trade-july');

  const august = brokerSettlementCalculation(swaps, rates, '2026-08', 'ginga');
  assert.equal(august.tradeCount, 1);
  assert.equal(august.commissionAmount, 10);
  assert.equal(august.lines[0].id, 'trade-august');
});

test('broker settlements are service-only, revisioned, audited, and reopened on migration', async () => {
  const [migration, service, view] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260806122507_broker_settlement_trade_date_basis.sql', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeDeskService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/hedge/views/SettlementView.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(migration, /create table if not exists public\.hedge_broker_settlements/);
  assert.match(migration, /unique \(trade_month, broker_key\)/);
  assert.match(migration, /alter table public\.hedge_broker_settlements enable row level security/);
  assert.match(migration, /revoke all on table public\.hedge_broker_settlements from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.hedge_broker_settlements to service_role/);
  assert.match(migration, /to_char\(trade_date, 'YYYY-MM'\)/);
  assert.doesNotMatch(migration, /to_char\(swap_month/);
  assert.match(migration, /'open'[\s\S]*'system:migration'/);
  assert.match(migration, /create or replace function public\.save_hedge_broker_settlement/);
  assert.match(migration, /for update/);
  assert.match(migration, /REVISION_CONFLICT/);
  assert.match(migration, /broker_settlement_(completed|reopened)/);
  assert.match(service, /brokerSettlementCalculation/);
  assert.match(service, /hedge_settlement_manage[\s\S]*hedge_close_approve/);
  assert.match(view, /Independent broker status/);
  assert.match(view, /tab !== "fees"[\s\S]*Mark settled/);
  assert.match(view, /Changed - review/);
});
