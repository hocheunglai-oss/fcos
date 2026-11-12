import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { SCHEMA_FINGERPRINT_SQL } from '../scripts/lib/rapid-release/compatibility.mjs';
import { runReviewedMigrationTransaction } from '../scripts/lib/rapid-release/reviewed-migration-transaction.mjs';

const baselineSchemaDigest = 'a'.repeat(64);
const migratedSchemaDigest = 'b'.repeat(64);
const operationDigest = 'c'.repeat(64);
const sql = 'create table public.fixture(id integer);\n';

function fixture(source = sql, { changesSchema = true } = {}) {
  const path = 'supabase/migrations/20261111180108_fixture.sql';
  const migrationBytes = [Buffer.from(source)];
  const calls = [];
  let migrated = false;
  let ledger = [];
  const db = {
    async query(query, values) {
      calls.push({ query, values });
      if (query === SCHEMA_FINGERPRINT_SQL) {
        return { rows: [{ digest: migrated && changesSchema ? migratedSchemaDigest : baselineSchemaDigest }] };
      }
      if (query.startsWith('select version')) return { rows: ledger };
      if (query === 'show search_path') return { rows: [{ search_path: 'public' }] };
      if (query === source) migrated = true;
      if (query.startsWith('insert into supabase_migrations')) {
        const [version, name, idempotency_key, statements] = values;
        ledger = [{ version, name, idempotency_key, statements }];
      }
      return { command: query.toUpperCase(), rows: [] };
    },
  };
  const input = { db, migrationBytes, mode: 'apply', operationDigest, baselineSchemaDigest,
    assertConnection: async () => {}, assertWriteAuthorized: async () => {} };
  const options = { reviewedMigrations: [{ path, digest: digest(migrationBytes[0]) }],
    errorPrefix: 'FIXTURE', readCatalog: async () => ({
      state: migrated ? 'migrated' : 'baseline', evidenceDigest: migrated ? migratedSchemaDigest : baselineSchemaDigest,
    }) };
  return { input, options, calls };
}

test('catalog registration preserves the schema through apply and original-operation readback', async () => {
  const registration = 'insert into public.fixture values (1);\n';
  const { input, options, calls } = fixture(registration, { changesSchema: false });
  options.schemaEffect = 'preserve';
  const applied = await runReviewedMigrationTransaction(input, options);
  assert.equal(applied.state, 'applied');
  calls.length = 0;
  const recovered = await runReviewedMigrationTransaction({ ...input, mode: 'readback' }, options);
  assert.deepEqual(recovered, { ...applied, state: 'recovered' });
  assert.equal(calls.some(({ query }) => /insert into/.test(query)), false);
});

test('a schema change rolls back a catalog-only operation before recording migration history', async () => {
  const { input, options, calls } = fixture();
  await assert.rejects(runReviewedMigrationTransaction(input, { ...options, schemaEffect: 'preserve' }),
    { code: 'FIXTURE_SCHEMA_CHANGED' });
  assert.equal(calls.at(-1).query, 'rollback');
  assert.equal(calls.some(({ query }) => query.startsWith('insert into supabase_migrations')), false);
});
