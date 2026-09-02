import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CASHFLOW_BANK_PROFILES,
  cashflowBankCurrencyAllowed,
  expandCashflowPlannedMovements,
  parseCashflowBankStatementCsv,
  reconcileCashflowBankEntries,
} from '../api/_cashflowBankReconciliation.js';

const migration = readFile(new URL('../supabase/migrations/20260902060000_cashflow_bank_reconciliation.sql', import.meta.url), 'utf8');
const pgcryptoFix = readFile(new URL('../supabase/migrations/20260902061000_cashflow_bank_pgcrypto_search_path.sql', import.meta.url), 'utf8');
const page = readFile(new URL('../src/pages/CashflowForecast.jsx', import.meta.url), 'utf8');
const workspace = readFile(new URL('../src/components/cashflow/CashflowBankReconciliation.jsx', import.meta.url), 'utf8');

test('bank profiles enforce the agreed operating currencies and treasury boundary', () => {
  assert.equal(cashflowBankCurrencyAllowed('UBS', 'USD'), true);
  assert.equal(cashflowBankCurrencyAllowed('UBS', 'EUR'), true);
  assert.equal(cashflowBankCurrencyAllowed('UBS', 'HKD'), false);
  assert.equal(cashflowBankCurrencyAllowed('DBS', 'HKD'), true);
  assert.equal(cashflowBankCurrencyAllowed('DBS', 'CNY'), true);
  assert.equal(CASHFLOW_BANK_PROFILES.ISP.purpose, 'Treasury');
});

test('bank statement preview handles quoted CSV, debit and credit columns, and stable hashes', () => {
  const csv = '\uFEFFBooking Date,Value Date,Currency,Debit,Credit,Reference,Description,Balance\n'
    + '01/09/2026,01/09/2026,USD,,1000.25,RCPT-1,"Buyer, receipt",1500.25\n'
    + '02/09/2026,02/09/2026,USD,250.50,,PAY-1,Supplier payment,1249.75\n';
  const account = { bankCode: 'UBS', currency: 'USD' };
  const first = parseCashflowBankStatementCsv(csv, account);
  const second = parseCashflowBankStatementCsv(csv, account);
  assert.equal(first.sourceHash, second.sourceHash);
  assert.equal(first.statementFrom, '2026-09-01');
  assert.equal(first.statementTo, '2026-09-02');
  assert.equal(first.summary.rowCount, 2);
  assert.equal(first.summary.credits, 1000.25);
  assert.equal(first.summary.debits, 250.5);
  assert.deepEqual(first.rows.map((row) => row.amount), [1000.25, -250.5]);
  assert.equal(first.rows[0].description, 'Buyer, receipt');
});

test('statement parsing fails closed on a currency outside the selected bank account', () => {
  assert.throws(() => parseCashflowBankStatementCsv(
    'Date,Currency,Amount\n2026-09-01,HKD,58\n',
    { bankCode: 'UBS', currency: 'USD' },
  ), /selected account is USD/);
  assert.throws(() => parseCashflowBankStatementCsv(
    'Date,Amount\n2026-09-01,58\n',
    { bankCode: 'UBS', currency: 'HKD' },
  ), /unsupported bank or currency/);
});

test('reconciliation suggests only a unique exact amount, direction, bank, currency and two-day payment', () => {
  const accounts = [{ id: 'account-1', accountLabel: 'UBS USD', bankCode: 'UBS', currency: 'USD' }];
  const entries = [{
    id: 'entry-1',
    bankAccountId: 'account-1',
    bookingDate: '2026-09-02',
    valueDate: null,
    amount: 100,
    currency: 'USD',
    reference: 'Payment PAY-001',
    description: '',
  }];
  const payments = [{
    id: 'payment-1',
    name: 'PAY-001',
    direction: 'inflow',
    date: '2026-09-01',
    amount: 100,
    currency: 'USD',
    bankCode: 'UBS',
    reference: '',
  }, {
    id: 'payment-wrong-bank',
    name: 'PAY-002',
    direction: 'inflow',
    date: '2026-09-02',
    amount: 100,
    currency: 'USD',
    bankCode: 'DBS',
    reference: '',
  }];
  const [result] = reconcileCashflowBankEntries(entries, payments, accounts);
  assert.equal(result.reconciliationStatus, 'suggested');
  assert.equal(result.suggestedPayment.id, 'payment-1');
  assert.equal(result.candidateCount, 1);
});

test('planned monthly operating cash preserves the requested day and clamps month end', () => {
  const rows = expandCashflowPlannedMovements([{
    id: 'payroll',
    bankAccountId: 'dbs-hkd',
    category: 'payroll',
    description: 'Monthly payroll',
    direction: 'outflow',
    amount: 100,
    startDate: '2026-01-31',
    recurrence: 'monthly',
    endDate: '2026-04-30',
    enabled: true,
  }], '2026-01-01', '2026-04-30');
  assert.deepEqual(rows.map((row) => row.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('bank schema is service-only, revision protected, idempotent and audit-redacted', async () => {
  const sql = await migration;
  for (const table of [
    'cashflow_bank_accounts',
    'cashflow_bank_balance_snapshots',
    'cashflow_bank_statement_imports',
    'cashflow_bank_statement_entries',
    'cashflow_bank_matches',
    'cashflow_liquidity_instruments',
    'cashflow_bank_planned_movements',
    'cashflow_bank_audit_events',
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  for (const fn of [
    'save_cashflow_bank_account_v1',
    'save_cashflow_bank_balance_v1',
    'import_cashflow_bank_statement_v1',
    'save_cashflow_bank_match_v1',
    'save_cashflow_liquidity_instrument_v1',
    'save_cashflow_bank_planned_movement_v1',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}`));
  }
  assert.match(sql, /security invoker/g);
  assert.match(sql, /set search_path = public, extensions, pg_temp/g);
  assert.match(sql, /where id = p_id and revision = p_expected_revision/);
  assert.match(sql, /where p_expected_revision is not null[\s\S]+revision = p_expected_revision/);
  assert.match(sql, /unique \(bank_account_id, source_hash\)/);
  assert.match(sql, /unique \(bank_account_id, entry_hash\)/);
  assert.doesNotMatch(sql, /source_file_bytes|raw_file|account_number|access_token|refresh_token|credential/i);
});

test('deployed bank RPCs resolve pgcrypto only through the fixed extensions search path', async () => {
  const sql = await pgcryptoFix;
  for (const fn of [
    'save_cashflow_bank_account_v1',
    'save_cashflow_bank_balance_v1',
    'import_cashflow_bank_statement_v1',
    'save_cashflow_bank_match_v1',
    'save_cashflow_liquidity_instrument_v1',
    'save_cashflow_bank_planned_movement_v1',
  ]) {
    assert.match(sql, new RegExp(`alter function public\\.${fn}`));
  }
  assert.equal((sql.match(/set search_path = public, extensions, pg_temp/g) || []).length, 6);
});

test('Cashflow exposes the governed workspace without loading it for unauthorized users', async () => {
  const [pageSource, workspaceSource] = await Promise.all([page, workspace]);
  assert.match(pageSource, /canReconcileBanks/);
  assert.match(pageSource, /activeView === 'bank' && canReconcileBanks/);
  assert.match(workspaceSource, /cashflowBankOverview/);
  assert.match(workspaceSource, /cashflowBankStatementPreview/);
  assert.match(workspaceSource, /cashflowBankStatementImport/);
  assert.match(workspaceSource, /ISP deposits & guarantees/);
  assert.match(workspaceSource, /Currencies are never netted together/);
});
