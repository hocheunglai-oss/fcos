import assert from 'node:assert/strict';
import test from 'node:test';
import { lockStagingTransition } from '../scripts/lib/rapid-release/staging-ownership.mjs';

test('the stage and handover use the same advisory key and fail closed if acquisition is refused', async () => {
  const queries = [];
  const db = { async query(sql, values) {
    queries.push({ sql, values });
    return { rows: [{ acquired: queries.length < 3 }] };
  } };
  await lockStagingTransition(db, { staging: true });
  await lockStagingTransition(db);
  assert.match(queries[0].sql, /pg_catalog.pg_try_advisory_xact_lock_shared\(/);
  assert.match(queries[1].sql, /pg_catalog.pg_try_advisory_xact_lock\(/);
  assert.deepEqual(queries[0].values, queries[1].values);
  assert.equal(queries[0].values.length, 2);
  await assert.rejects(lockStagingTransition(db), { code: 'RAPID_STAGING_HANDOVER_OVERLAP' });
});
