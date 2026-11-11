import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  companyFxRateInternals,
  hkdFromUsd,
  loadCompanyFxRateForDate,
  loadCurrentCompanyFxRate,
  usdFromHkd,
} from '../api/_companyFxRates.js';

function query(result, calls) {
  const chain = {
    select(value) { calls.push(['select', value]); return chain; },
    eq(field, value) { calls.push(['eq', field, value]); return chain; },
    lt(field, value) { calls.push(['lt', field, value]); return chain; },
    order(field, options) { calls.push(['order', field, options]); return chain; },
    limit(value) { calls.push(['limit', value]); return chain; },
    async maybeSingle() { return result; },
  };
  return chain;
}

function mockedClient(results) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      return query(results.shift(), calls);
    },
  };
}

async function migration() {
  const name = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .find((value) => value.endsWith('_company_fx_rate_history.sql'));
  return readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
}

test('loads the current FX rate only when current settings and immutable snapshot agree', async () => {
  const client = mockedClient([
    { data: { id: 'company', usd_hkd_rate: '7.840000', revision: 3, updated_at: '2026-09-10T13:00:00.000Z' }, error: null },
    { data: { id: 'rate-3', pair: 'USD/HKD', rate: '7.840000', settings_revision: 3, effective_at: '2026-09-10T13:00:00.000Z' }, error: null },
  ]);
  assert.deepEqual(await loadCurrentCompanyFxRate(client), {
    usdHkdRate: '7.840000', revision: 3, rateId: 'rate-3', effectiveAt: '2026-09-10T13:00:00.000Z',
  });
  assert.deepEqual(client.calls.filter(([name]) => name === 'from'), [
    ['from', 'variable_charge_settings'], ['from', 'company_fx_rate_history'],
  ]);
  assert.ok(client.calls.some((entry) => entry[0] === 'eq' && entry[1] === 'settings_revision' && entry[2] === 3));
});

test('current rate comparison is numeric and bounded, not dependent on decimal display scale', async () => {
  const client = mockedClient([
    { data: { id: 'company', usd_hkd_rate: '8', revision: 3, updated_at: '2026-09-10T13:00:00.000Z' }, error: null },
    { data: { id: 'rate-3', pair: 'USD/HKD', rate: '8.000000', settings_revision: 3, effective_at: '2026-09-10T13:00:00.000Z' }, error: null },
  ]);
  assert.equal((await loadCurrentCompanyFxRate(client)).usdHkdRate, '8.000000');
  assert.throws(() => companyFxRateInternals.validRate(`7.${'1'.repeat(7)}`), /precision/);
  assert.throws(() => usdFromHkd(`1.${'1'.repeat(31)}`, '7.84'), /precision/);
});

test('looks up the latest immutable FX rate through the requested Hong Kong calendar day', async () => {
  const client = mockedClient([
    { data: { id: 'rate-2', pair: 'USD/HKD', rate: '7.800000', settings_revision: 2, effective_at: '2026-09-10T15:59:59.999Z' }, error: null },
  ]);
  const rate = await loadCompanyFxRateForDate(client, '2026-09-10');
  assert.equal(rate.rateId, 'rate-2');
  assert.equal(rate.usdHkdRate, '7.800000');
  assert.ok(client.calls.some((entry) => entry[0] === 'lt' && entry[1] === 'effective_at' && entry[2] === '2026-09-10T16:00:00.000Z'));
  assert.ok(client.calls.some((entry) => entry[0] === 'order' && entry[1] === 'effective_at' && entry[2].ascending === false));
  assert.equal(companyFxRateInternals.hkNextMidnight('1979-06-01'), '1979-06-01T15:00:00.000Z');
  assert.equal(companyFxRateInternals.hkNextMidnight('2026-12-31'), '2026-12-31T16:00:00.000Z');
});

test('fails closed when an FX rate is missing, malformed, or queried with an invalid date', async () => {
  await assert.rejects(() => loadCompanyFxRateForDate(mockedClient([{ data: null, error: null }]), '2026-09-10'), /No company USD\/HKD rate/);
  await assert.rejects(() => loadCompanyFxRateForDate(mockedClient([]), '2026-02-30'), /invalid/);
  assert.throws(() => companyFxRateInternals.serializeHistoryRate({ id: 'bad', pair: 'USD/HKD', rate: '101', effective_at: '2026-09-10T00:00:00Z' }), /no more than 100/);
});

test('payment lookup includes the last microsecond before Hong Kong midnight', async () => {
  const rows = [
    { id: 'next-day', pair: 'USD/HKD', rate: '7.810000', settings_revision: 4, effective_at: '2026-09-10T16:00:00.000000Z' },
    { id: 'last-tick', pair: 'USD/HKD', rate: '7.800000', settings_revision: 3, effective_at: '2026-09-10T15:59:59.999999Z' },
    { id: 'older', pair: 'USD/HKD', rate: '7.790000', settings_revision: 2, effective_at: '2026-09-10T15:59:59.998000Z' },
  ];
  let eligible = rows;
  const filter = (cutoff, includeEqual) => {
    const ticks = cutoff.replace(/\.(\d{3})Z$/, '.$1000Z');
    eligible = rows.filter(row => row.effective_at < ticks || (includeEqual && row.effective_at === ticks));
    return chain;
  };
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    lte: (_field, cutoff) => filter(cutoff, true), lt: (_field, cutoff) => filter(cutoff, false),
    maybeSingle: async () => ({ data: eligible[0], error: null }),
  };
  const rate = await loadCompanyFxRateForDate({ from: () => chain }, '2026-09-10');
  assert.equal(rate.rateId, 'last-tick');
});

test('current settings reject a mismatch within the same millisecond', async () => {
  const client = mockedClient([
    { data: { usd_hkd_rate: '7.84', revision: 3, updated_at: '2026-09-10T21:00:00.001001+08:00' } },
    { data: { id: 'rate-3', pair: 'USD/HKD', rate: '7.84', settings_revision: 3, effective_at: '2026-09-10T13:00:00.001002Z' } },
  ]);
  await assert.rejects(() => loadCurrentCompanyFxRate(client), { code: 'COMPANY_FX_RATE_MISMATCH' });
  const matching = mockedClient([
    { data: { usd_hkd_rate: '7.84', revision: 3, updated_at: '2026-09-10T21:00:00.001001+08:00' } },
    { data: { id: 'rate-3', pair: 'USD/HKD', rate: '7.84', settings_revision: 3, effective_at: '2026-09-10T13:00:00.001001Z' } },
  ]);
  assert.equal((await loadCurrentCompanyFxRate(matching)).rateId, 'rate-3');
});

test('currency arithmetic uses decimal strings and BigInt rounding rather than float storage', () => {
  assert.equal(usdFromHkd('784.00', '7.84'), '100.00');
  assert.equal(hkdFromUsd('100.00', '7.84'), '784.00');
  assert.equal(usdFromHkd('1.00', '7.84'), '0.13');
  assert.equal(hkdFromUsd('0.01', '7.84'), '0.08');
  assert.equal(usdFromHkd('1.005', '1', { scale: 2 }), '1.01');
});

test('FX migration makes rate history immutable, service-only, and settings-revision backed', async () => {
  const sql = await migration();
  assert.match(sql, /create table public\.company_fx_rate_history/i);
  assert.match(sql, /pair text not null check \(pair = 'USD\/HKD'\)/i);
  assert.match(sql, /rate numeric\(12, 6\) not null check \(rate > 0 and rate <= 100\)/i);
  assert.match(sql, /unique \(pair, effective_at\)/i);
  assert.match(sql, /settings_revision integer null check \(settings_revision > 0\)/i);
  assert.match(sql, /company_fx_rate_history_immutable/i);
  assert.match(sql, /revoke all on table public\.company_fx_rate_history from public, anon, authenticated, service_role;/i);
  assert.match(sql, /grant select, insert on table public\.company_fx_rate_history to service_role/i);
  assert.match(sql, /company_fx_rate_history_capture_settings_update/i);
  const seed = sql.indexOf('Migration seed from current variable charge settings');
  const insertGuard = sql.indexOf('create trigger company_fx_rate_history_insert_guard');
  assert.ok(seed >= 0 && insertGuard > seed);
  assert.match(sql, /set_config\('fcos\.company_fx_rate_reason'/i);
  assert.match(sql, /clock_timestamp\(\)/i);
  assert.doesNotMatch(sql, /on conflict \(pair, effective_at\) do nothing/i);
  assert.doesNotMatch(sql, /security definer/i);
});
