import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { SCHEMA_FINGERPRINT_SQL } from '../scripts/lib/rapid-release/compatibility.mjs';
import { runReviewedMigrationTransaction } from '../scripts/lib/rapid-release/reviewed-migration-transaction.mjs';

const baselineSchemaDigest = 'a'.repeat(64);
const migratedSchemaDigest = 'b'.repeat(64);
const operationDigest = 'c'.repeat(64);
const sql = 'begin;\n\ncreate table public.fixture(id integer);\n\ncommit;\n';

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
      if (query === source.slice('begin;\n'.length, -'\ncommit;\n'.length)) migrated = true;
      if (query.startsWith('insert into supabase_migrations')) {
        const [version, name, idempotency_key, statements] = values;
        ledger = [{ version, name, idempotency_key, statements }];
      }
      return { command: query.toUpperCase(), rows: [] };
    },
  };
  const input = { db, migrationBytes, mode: 'apply', operationDigest, baselineSchemaDigest,
    assertConnection: async () => {}, assertWriteAuthorized: async () => {} };
  const options = { reviewedMigrations: [{ path, digest: digest(migrationBytes[0]), transactionEnvelope: true }],
    errorPrefix: 'FIXTURE', readCatalog: async () => ({
      state: migrated ? 'migrated' : 'baseline', evidenceDigest: migrated ? migratedSchemaDigest : baselineSchemaDigest,
    }) };
  return { input, options, calls };
}

test('reviewed standalone SQL keeps its original ledger bytes inside one controller transaction', async () => {
  const { input, options, calls } = fixture();
  const applied = await runReviewedMigrationTransaction(input, options);
  assert.equal(applied.state, 'applied');
  assert.deepEqual(calls.filter(({ query }) => query.includes('create table')).map(({ query }) => query),
    ['\ncreate table public.fixture(id integer);\n']);
  assert.deepEqual(calls.find(({ query }) => query.startsWith('insert into supabase_migrations')).values.at(-1), [sql]);
  assert.equal(calls.filter(({ query }) => query === 'commit').length, 1);
  calls.length = 0;
  const recovered = await runReviewedMigrationTransaction({ ...input, mode: 'readback' }, options);
  assert.equal(recovered.state, 'recovered');
  assert.equal(recovered.evidenceDigest, applied.evidenceDigest);
  assert.equal(calls.some(({ query }) => /create table|^insert into/.test(query)), false);
});

test('malformed or modified wrapped SQL is rejected before a database call', async () => {
  const malformed = fixture(sql.replace('commit;', 'rollback;'));
  await assert.rejects(runReviewedMigrationTransaction(malformed.input, malformed.options), { code: 'FIXTURE_MIGRATION_ENVELOPE_INVALID' });
  assert.deepEqual(malformed.calls, []);
  const changed = fixture();
  changed.input.migrationBytes[0] = Buffer.from(sql + '\n');
  await assert.rejects(runReviewedMigrationTransaction(changed.input, changed.options), { code: 'FIXTURE_MIGRATION_BYTES_CHANGED' });
  assert.deepEqual(changed.calls, []);
});

test('catalog registration preserves the schema through apply and original-operation readback', async () => {
  const registration = 'begin;\n\ninsert into public.fixture values (1);\n\ncommit;\n';
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
