import assert from 'node:assert/strict';
import test from 'node:test';
import { readTradingFxCatalog } from '../scripts/lib/rapid-release/trading-fx-catalog.mjs';

const baseline = {
  columns: [], indexes: [], apiRoles: ['anon', 'authenticated', 'service_role'],
  policies: [], routines: [], triggers: [], relations: [], constraints: [],
  dependencies: ['xero_financial_audit_events:r', 'xero_financial_bank_mappings:r',
    'xero_financial_document_mappings:r', 'xero_financial_payment_mappings:r', 'xero_financial_sync_runs:r'],
  helperPresent: true,
};

function reader(snapshot) {
  const calls = [];
  return {
    calls,
    db: { async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: snapshot === undefined ? [] : [{ snapshot }] };
    } },
  };
}

test('Trading FX baseline is identified by one scoped catalog query', async () => {
  const { db, calls } = reader(baseline);
  assert.equal((await readTradingFxCatalog(db)).state, 'baseline');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sql, 'set local search_path = pg_catalog, pg_temp');
  assert.ok(calls[1].parameters[0].includes('xero_native_document_draft_operations'));
  assert.ok(calls[1].parameters[5].includes('claim_xero_native_hkd_payment_v1'));
});

test('Trading FX rejects absent metadata, partial install and missing prerequisites', async () => {
  for (const snapshot of [
    undefined,
    { ...baseline, columns: [['xero_financial_payment_mappings', 'accounting_usd', 'numeric(18,2)']] },
    { ...baseline, helperPresent: false },
    { ...baseline, apiRoles: ['anon', 'authenticated'] },
  ]) {
    await assert.rejects(readTradingFxCatalog(reader(snapshot).db), { code: 'TRADING_FX_CATALOG_DRIFT' });
  }
});
