import { digest, isDigest, requireCondition } from './contract.mjs';
import { SCHEMA_FINGERPRINT_SQL } from './compatibility.mjs';
import { readSupplierBucketCatalog, SUPPLIER_BUCKET_MIGRATIONS } from './supplier-bucket-catalog.mjs';

const readLedger = 'select version,name,idempotency_key,statements from supabase_migrations.schema_migrations where version=any($1::text[]) order by version';
const writeLedger = 'insert into supabase_migrations.schema_migrations(version,name,idempotency_key,statements) values($1,$2,$3,$4)';

function bindMigrations(migrationBytes) {
  requireCondition(Array.isArray(migrationBytes) && migrationBytes.length === SUPPLIER_BUCKET_MIGRATIONS.length,
    'SUPPLIER_BUCKET_MIGRATIONS_REQUIRED');
  return SUPPLIER_BUCKET_MIGRATIONS.map(({ path, digest: expected }, index) => {
    const bytes = migrationBytes[index];
    requireCondition(Buffer.isBuffer(bytes) && digest(bytes) === expected, 'SUPPLIER_BUCKET_MIGRATION_BYTES_CHANGED');
    const [, version, name] = /\/(\d{14})_(.+)\.sql$/.exec(path);
    return { version, name, sql: bytes.toString('utf8') };
  });
}

async function readSchemaDigest(db) {
  const schemaDigest = (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.digest;
  requireCondition(isDigest(schemaDigest), 'SUPPLIER_BUCKET_SCHEMA_FINGERPRINT_REQUIRED');
  return schemaDigest;
}

export async function runSupplierBucketTransaction({
  db, migrationBytes, mode, operationDigest, baselineSchemaDigest, assertConnection, assertWriteAuthorized,
}) {
  const migrations = bindMigrations(migrationBytes);
  requireCondition((mode === 'apply' || mode === 'readback') && isDigest(operationDigest)
    && isDigest(baselineSchemaDigest) && typeof assertConnection === 'function'
    && (mode === 'readback' || typeof assertWriteAuthorized === 'function'),
  'SUPPLIER_BUCKET_OPERATION_BINDING_REQUIRED');

  await db.query('begin isolation level read committed');
  let commitSubmitted = false;
  try {
    await assertConnection();
    await db.query("set local lock_timeout = '5s'; set local statement_timeout = '45s'; set local idle_in_transaction_session_timeout = '60s'");
    // A readback must wait for a disconnected writer's transaction to resolve.
    // SHARE conflicts with the apply lock and lets independent readbacks coexist.
    await db.query(mode === 'apply'
      ? 'lock table supabase_migrations.schema_migrations in share row exclusive mode'
      : 'lock table supabase_migrations.schema_migrations in share mode');
    const versions = migrations.map(({ version }) => version);
    const ledger = (await db.query(readLedger, [versions])).rows;
    const originalSearchPath = (await db.query('show search_path')).rows[0]?.search_path;
    requireCondition(typeof originalSearchPath === 'string', 'SUPPLIER_BUCKET_SEARCH_PATH_REQUIRED');

    let schemaDigest = await readSchemaDigest(db);
    let catalog = await readSupplierBucketCatalog(db);
    await db.query("select set_config('search_path',$1,true)", [originalSearchPath]);

    const isBaseline = ledger.length === 0 && schemaDigest === baselineSchemaDigest && catalog.state === 'baseline';
    let state;
    if (mode === 'readback') {
      if (isBaseline) {
        state = 'absent';
      } else {
        const sameOperation = ledger.length === migrations.length && migrations.every(({ version, name, sql }, index) => {
          const row = ledger[index];
          return row.version === version && row.name === name && row.idempotency_key === `${operationDigest}:${schemaDigest}`
            && Array.isArray(row.statements) && row.statements.length === 1 && row.statements[0] === sql;
        });
        requireCondition(sameOperation && catalog.state === 'migrated', 'SUPPLIER_BUCKET_ORIGINAL_OPERATION_MISMATCH');
        state = 'recovered';
      }
      await db.query('rollback');
    } else {
      requireCondition(isBaseline, 'SUPPLIER_BUCKET_BASELINE_CHANGED');
      await assertWriteAuthorized();
      for (const { sql } of migrations) await db.query(sql);
      catalog = await readSupplierBucketCatalog(db);
      requireCondition(catalog.state === 'migrated', 'SUPPLIER_BUCKET_MIGRATED_SCHEMA_REQUIRED');
      await db.query("select set_config('search_path',$1,true)", [originalSearchPath]);
      schemaDigest = await readSchemaDigest(db);
      requireCondition(schemaDigest !== baselineSchemaDigest, 'SUPPLIER_BUCKET_SCHEMA_UNCHANGED');
      for (const { version, name, sql } of migrations) {
        await db.query(writeLedger, [version, name, `${operationDigest}:${schemaDigest}`, [sql]]);
      }
      commitSubmitted = true;
      const committed = await db.query('commit');
      requireCondition(committed.command === 'COMMIT', 'SUPPLIER_BUCKET_COMMIT_ACKNOWLEDGEMENT_INVALID');
      state = 'applied';
    }
    return { state, schemaDigest, evidenceDigest: digest({ operationDigest, migrations: SUPPLIER_BUCKET_MIGRATIONS,
      schemaDigest, catalogDigest: catalog.evidenceDigest }) };
  } catch (error) {
    if (commitSubmitted) {
      throw Object.assign(new Error('Supplier bucket commit outcome requires original-operation readback.'),
        { code: 'SUPPLIER_BUCKET_COMMIT_OUTCOME_UNKNOWN' });
    }
    try { await db.query('rollback'); } catch { /* The caller closes this connection. */ }
    throw error;
  }
}
