import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHedgeDateValue } from '../api/_hedgeDeskService.js';

test('blank optional Hedge Desk dates are stored as null', () => {
  assert.equal(normalizeHedgeDateValue('', 'delivery_date_to'), null);
  assert.equal(normalizeHedgeDateValue('   ', 'leg2_bal_date'), null);
  assert.equal(normalizeHedgeDateValue(null, 'issue_date'), null);
});

test('Hedge Desk accepts valid ISO dates and rejects impossible dates before PostgreSQL', () => {
  assert.equal(normalizeHedgeDateValue('2026-08-04', 'trade_date'), '2026-08-04');
  assert.throws(
    () => normalizeHedgeDateValue('2026-06-31', 'trade_date'),
    (error) => error.statusCode === 400 && error.code === 'INVALID_HEDGE_DATE' && /valid trade date/i.test(error.message),
  );
  assert.throws(
    () => normalizeHedgeDateValue('04/08/2026', 'issue_date'),
    (error) => error.statusCode === 400 && /valid issue date/i.test(error.message),
  );
});
