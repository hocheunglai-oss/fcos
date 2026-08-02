import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyMopsSourceMessage } from '../api/_hedgeMops.js';
import {
  mopsMonthFinality,
  paperHedgeExpiryStatus,
  tradingDaysInMonth,
} from '../src/hedge/lib/domain.js';

function verifiedMonth(month) {
  return tradingDaysInMonth(month).map((priceDate, index) => ({
    id: `${month}-${index}`,
    price_date: priceDate,
    s380: 400 + index,
    s05: 500 + index,
    sgo: 70 + index,
    is_estimate: false,
    verification_status: 'verified',
    updated_date: `${priceDate}T12:00:00Z`,
  }));
}

test('third-party source verification requires matching date and all three prices', () => {
  const record = { price_date: '2026-07-31', s380: 421.5, s05: 492.25, sgo: 73.45 };
  const verified = verifyMopsSourceMessage(record, '31-Jul-2026\nMOPS\nS380: 421.50\nS0.5: 492.25\nSGO: 73.45');
  assert.equal(verified.verified, true);

  const mismatch = verifyMopsSourceMessage(record, '31-Jul-2026\nMOPS\nS380: 421.50\nS0.5: 492.20\nSGO: 73.45');
  assert.equal(mismatch.verified, false);
  assert.match(mismatch.issues.join(' '), /S05.*does not match/i);
});

test('a MOPS month becomes final only on its last trading day with every row verified', () => {
  const month = '2026-07';
  const records = verifiedMonth(month);
  assert.equal(tradingDaysInMonth(month).at(-1), '2026-07-31');
  assert.equal(mopsMonthFinality(month, records, new Date('2026-07-30T12:00:00Z')).ready, false);
  assert.equal(mopsMonthFinality(month, records, new Date('2026-07-31T12:00:00Z')).ready, true);

  records[0] = { ...records[0], verification_status: 'unverified' };
  const unverified = mopsMonthFinality(month, records, new Date('2026-07-31T12:00:00Z'));
  assert.equal(unverified.ready, false);
  assert.deepEqual(unverified.unverifiedDates, [records[0].price_date]);
});

test('spread hedge expiry waits for both contract months', () => {
  const swap = { trade_type: 'SPREAD', leg1_month: '2026-06', leg2_month: '2026-07' };
  const juneOnly = verifiedMonth('2026-06');
  assert.equal(paperHedgeExpiryStatus(swap, juneOnly, new Date('2026-07-31T12:00:00Z')).ready, false);
  assert.equal(paperHedgeExpiryStatus(swap, [...juneOnly, ...verifiedMonth('2026-07')], new Date('2026-07-31T12:00:00Z')).ready, true);
});

test('expiry is server-controlled and persisted verification fields are private', async () => {
  const [hedges, service, expiry, migration, salesforce] = await Promise.all([
    readFile(new URL('../src/hedge/views/HedgesView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeDeskService.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeExpiry.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260802083037_hedge_mops_verification_auto_expiry.sql', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeSalesforce.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(hedges, /Mark as expired/);
  assert.match(hedges, /Expiry is automatic/);
  assert.match(service, /delete sanitized\.is_expired/);
  assert.match(service, /verifyMopsSourceMessage/);
  assert.match(expiry, /expire_paper_hedge_with_audit/);
  assert.match(migration, /verification_status text not null default 'unverified'/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /paper_hedge_auto_expired/);
  assert.match(migration, /revoke all on table public\.hedge_market_prices from public, anon, authenticated/);
  assert.match(salesforce, /MOPS source verification is missing/);
});
