import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  decorateMopsMonthVerifications,
  prepareManualMopsVerification,
} from '../api/_hedgeMops.js';
import {
  finalMopsMonthlyAverages,
  mopsMonthFinality,
  paperHedgeExpiryStatus,
  tradingDaysInMonth,
} from '../src/hedge/lib/domain.js';

function completeMonth(month) {
  return tradingDaysInMonth(month).map((priceDate, index) => ({
    id: `${month}-${index}`,
    price_date: priceDate,
    s380: 400 + index,
    s05: 500 + index,
    sgo: 70 + index,
    is_estimate: false,
    updated_date: `${priceDate}T12:00:00Z`,
  }));
}

function verifiedAverage(month, records) {
  const averages = finalMopsMonthlyAverages(month, records);
  const verified = prepareManualMopsVerification(month, records, `${month}\nMOPS Average\nS380: ${averages.s380.toFixed(3)}\nS0.5: ${averages.s05.toFixed(3)}\nSGO: ${averages.sgo.toFixed(3)}`, { now: new Date(`${tradingDaysInMonth(month).at(-1)}T12:00:00Z`) });
  assert.equal(verified.verified, true);
  return decorateMopsMonthVerifications([{
    contract_month: month,
    input_fingerprint: verified.inputFingerprint,
    calculated_snapshot: verified.calculatedSnapshot,
    source_snapshot: verified.sourceSnapshot,
  }], records);
}

test('manual verification stores arbitrary non-empty evidence without parsing or comparing it', () => {
  const month = '2026-07';
  const records = completeMonth(month);
  const sourceMessage = 'Manually checked against the third-party message. Values confirmed.';
  const verified = prepareManualMopsVerification(month, records, sourceMessage, { now: new Date('2026-07-31T12:00:00Z') });
  assert.equal(verified.verified, true);
  assert.equal(verified.sourceMessage, sourceMessage);
  assert.deepEqual(verified.sourceSnapshot, { verification_mode: 'manual_attestation' });

  const empty = prepareManualMopsVerification(month, records, '   ', { now: new Date('2026-07-31T12:00:00Z') });
  assert.equal(empty.verified, false);
  assert.match(empty.issues.join(' '), /Paste the third-party/i);
});

test('a MOPS month becomes final only on its last trading day with complete rows and one verified average', () => {
  const month = '2026-07';
  const records = completeMonth(month);
  const verification = verifiedAverage(month, records);
  assert.equal(tradingDaysInMonth(month).at(-1), '2026-07-31');
  assert.equal(mopsMonthFinality(month, records, new Date('2026-07-30T12:00:00Z'), verification).ready, false);
  assert.equal(mopsMonthFinality(month, records, new Date('2026-07-31T12:00:00Z'), verification).ready, true);

  records[0] = { ...records[0], s380: records[0].s380 + 1, updated_date: '2026-08-01T00:00:00Z' };
  const staleVerification = decorateMopsMonthVerifications(verification, records);
  const stale = mopsMonthFinality(month, records, new Date('2026-07-31T12:00:00Z'), staleVerification);
  assert.equal(stale.ready, false);
  assert.equal(stale.verification.is_current, false);
});

test('spread hedge expiry waits for both contract months', () => {
  const swap = { trade_type: 'SPREAD', leg1_month: '2026-06', leg2_month: '2026-07' };
  const june = completeMonth('2026-06');
  const july = completeMonth('2026-07');
  const records = [...june, ...july];
  const juneVerification = verifiedAverage('2026-06', june);
  const julyVerification = verifiedAverage('2026-07', july);
  assert.equal(paperHedgeExpiryStatus(swap, records, new Date('2026-07-31T12:00:00Z'), juneVerification).ready, false);
  assert.equal(paperHedgeExpiryStatus(swap, records, new Date('2026-07-31T12:00:00Z'), [...juneVerification, ...julyVerification]).ready, true);
});

test('expiry is server-controlled and persisted verification fields are private', async () => {
  const [hedges, service, expiry, migration, manualMigration, salesforce] = await Promise.all([
    readFile(new URL('../src/hedge/views/HedgesView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeDeskService.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeExpiry.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260802113000_hedge_monthly_mops_verification.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260802120000_store_manual_mops_verification_text.sql', import.meta.url), 'utf8'),
    readFile(new URL('../api/_hedgeSalesforce.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(hedges, /Mark as expired/);
  assert.match(hedges, /Expiry is automatic/);
  assert.match(service, /delete sanitized\.is_expired/);
  assert.match(service, /prepareManualMopsVerification/);
  assert.match(expiry, /expire_paper_hedge_with_audit/);
  assert.match(migration, /create table if not exists public\.hedge_mops_month_verifications/);
  assert.match(migration, /verify_mops_month_with_audit/);
  assert.doesNotMatch(migration, /drop column/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on table public\.hedge_mops_month_verifications from public, anon, authenticated/);
  assert.match(manualMigration, /add column if not exists source_message text/);
  assert.match(manualMigration, /security invoker/);
  assert.match(manualMigration, /to_jsonb\(v_after\) - 'source_message'/);
  assert.match(manualMigration, /revoke all on function public\.verify_mops_month_with_audit/);
  assert.match(salesforce, /Manual verification text has not been saved/);
});
