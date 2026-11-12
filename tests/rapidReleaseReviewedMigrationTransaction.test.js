import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../scripts/lib/rapid-release/contract.mjs';
import { SCHEMA_FINGERPRINT_SQL } from '../scripts/lib/rapid-release/compatibility.mjs';
import { runReviewedMigrationTransaction } from '../scripts/lib/rapid-release/reviewed-migration-transaction.mjs';

const baselineSchemaDigest = 'a'.repeat(64);
const migratedSchemaDigest = 'b'.repeat(64);
const operationDigest = 'c'.repeat(64);
const sql = 'begin;\n\ncreate table public.fixture(id integer);\n\ncommit;\n';

function fixture(source = sql, { changesSchema = true, uniqueKeys = true } = {}) {
  const sources = Array.isArray(source) ? source : [source];
  const migrationBytes = sources.map(item => Buffer.from(item));
  const reviewedMigrations = migrationBytes.map((bytes, index) => ({
    path: `supabase/migrations/${20261111180108 + index}_fixture.sql`,
    digest: digest(bytes),
    transactionEnvelope: sources[index].startsWith('begin;\n'),
  }));
  const statements = sources.map((item, index) => reviewedMigrations[index].transactionEnvelope
    ? item.slice('begin;\n'.length, -'\ncommit;\n'.length) : item);
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
      if (statements.includes(query)) migrated = true;
      if (query.startsWith('insert into supabase_migrations')) {
        const [version, name, idempotency_key, statements] = values;
        if (uniqueKeys && ledger.some(row => row.idempotency_key === idempotency_key)) {
          throw Object.assign(new Error('duplicate ledger key'), { code: '23505' });
        }
        ledger.push({ version, name, idempotency_key, statements });
      }
      return { command: query.toUpperCase(), rows: [] };
    },
  };
  const input = { db, migrationBytes, mode: 'apply', operationDigest, baselineSchemaDigest,
    assertConnection: async () => {}, assertWriteAuthorized: async () => {} };
  const options = { reviewedMigrations,
    errorPrefix: 'FIXTURE', readCatalog: async () => ({
      state: migrated ? 'migrated' : 'baseline', evidenceDigest: migrated ? migratedSchemaDigest : baselineSchemaDigest,
    }) };
  return { input, options, calls, ledger };
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


test('a multi-file package records a distinct key per migration and recovers the original operation', async () => {
  const { input, options, calls, ledger } = fixture([sql, 'alter table public.fixture add column note text;']);
  const applied = await runReviewedMigrationTransaction(input, options);
  assert.deepEqual(ledger.map(row => row.idempotency_key), [
    `${operationDigest}:${migratedSchemaDigest}:20261111180108`,
    `${operationDigest}:${migratedSchemaDigest}:20261111180109`,
  ]);
  calls.length = 0;
  const recovered = await runReviewedMigrationTransaction({ ...input, mode: 'readback' }, options);
  assert.deepEqual(recovered, { ...applied, state: 'recovered' });
  assert.equal(calls.some(({ query }) => /insert into/.test(query)), false);
  ledger[1].idempotency_key = ledger[0].idempotency_key;
  await assert.rejects(runReviewedMigrationTransaction({ ...input, mode: 'readback' }, options),
    { code: 'FIXTURE_ORIGINAL_OPERATION_MISMATCH' });
});

test('readback retains compatibility with a complete legacy multi-file operation', async () => {
  const { input, options, ledger } = fixture([sql, 'alter table public.fixture add column note text;'], { uniqueKeys: false });
  const applied = await runReviewedMigrationTransaction(input, options);
  ledger.forEach(row => { row.idempotency_key = `${operationDigest}:${migratedSchemaDigest}`; });
  const recovered = await runReviewedMigrationTransaction({ ...input, mode: 'readback' }, options);
  assert.deepEqual(recovered, { ...applied, state: 'recovered' });
});
