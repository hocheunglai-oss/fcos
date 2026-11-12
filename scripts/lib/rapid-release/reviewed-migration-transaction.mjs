import { digest, isDigest, requireCondition } from './contract.mjs';
import { SCHEMA_FINGERPRINT_SQL } from './compatibility.mjs';

const readLedger = 'select version,name,idempotency_key,statements from supabase_migrations.schema_migrations where version=any($1::text[]) order by version';
const writeLedger = 'insert into supabase_migrations.schema_migrations(version,name,idempotency_key,statements) values($1,$2,$3,$4)';

function bindMigrations(migrationBytes, reviewedMigrations, check) {
  check(Array.isArray(migrationBytes) && migrationBytes.length === reviewedMigrations.length,
    'MIGRATIONS_REQUIRED');
  return reviewedMigrations.map(({ path, digest: expected, transactionEnvelope }, index) => {
    const bytes = migrationBytes[index];
    check(Buffer.isBuffer(bytes) && digest(bytes) === expected, 'MIGRATION_BYTES_CHANGED');
    const [, version, name] = /\/(\d{14})_(.+)\.sql$/.exec(path);
    const sql = bytes.toString('utf8');
    // Some reviewed files also run independently. Keep their original bytes
    // in migration history and execute the body under the controller's lock.
    const body = transactionEnvelope ? /^begin;\n([\s\S]+)\ncommit;\n?$/.exec(sql)?.[1] : sql;
    check(typeof body === 'string' && body.trim().length > 0, 'MIGRATION_ENVELOPE_INVALID');
    return { version, name, sql, body };
  });
}

async function readSchemaDigest(db, check) {
  const schemaDigest = (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.digest;
  check(isDigest(schemaDigest), 'SCHEMA_FINGERPRINT_REQUIRED');
  return schemaDigest;
}

export async function runReviewedMigrationTransaction({
  db, migrationBytes, mode, operationDigest, baselineSchemaDigest, assertConnection, assertWriteAuthorized,
}, { reviewedMigrations, readCatalog, errorPrefix, schemaEffect = 'change' }) {
  const check = (condition, code) => requireCondition(condition, `${errorPrefix}_${code}`);
  const migrations = bindMigrations(migrationBytes, reviewedMigrations, check);
  check((mode === 'apply' || mode === 'readback') && isDigest(operationDigest)
    && isDigest(baselineSchemaDigest) && typeof assertConnection === 'function'
    && (mode === 'readback' || typeof assertWriteAuthorized === 'function'),
  'OPERATION_BINDING_REQUIRED');
  check(schemaEffect === 'change' || schemaEffect === 'preserve', 'SCHEMA_EFFECT_INVALID');

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
    check(typeof originalSearchPath === 'string', 'SEARCH_PATH_REQUIRED');

    let schemaDigest = await readSchemaDigest(db, check);
    let catalog = await readCatalog(db);
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
        check(sameOperation && catalog.state === 'migrated'
          && (schemaEffect !== 'preserve' || schemaDigest === baselineSchemaDigest), 'ORIGINAL_OPERATION_MISMATCH');
        state = 'recovered';
      }
      await db.query('rollback');
    } else {
      check(isBaseline, 'BASELINE_CHANGED');
      await assertWriteAuthorized();
      for (const { body } of migrations) await db.query(body);
      catalog = await readCatalog(db);
      check(catalog.state === 'migrated', 'MIGRATED_SCHEMA_REQUIRED');
      await db.query("select set_config('search_path',$1,true)", [originalSearchPath]);
      schemaDigest = await readSchemaDigest(db, check);
      if (schemaEffect === 'preserve') {
        check(schemaDigest === baselineSchemaDigest, 'SCHEMA_CHANGED');
      } else {
        check(schemaDigest !== baselineSchemaDigest, 'SCHEMA_UNCHANGED');
      }
      for (const { version, name, sql } of migrations) {
        await db.query(writeLedger, [version, name, `${operationDigest}:${schemaDigest}`, [sql]]);
      }
      commitSubmitted = true;
      const committed = await db.query('commit');
      check(committed.command === 'COMMIT', 'COMMIT_ACKNOWLEDGEMENT_INVALID');
      state = 'applied';
    }
    return { state, schemaDigest, evidenceDigest: digest({ operationDigest, migrations: reviewedMigrations,
      schemaDigest, catalogDigest: catalog.evidenceDigest }) };
  } catch (error) {
    if (commitSubmitted) {
      throw Object.assign(new Error('Database commit outcome requires original-operation readback.'),
        { code: `${errorPrefix}_COMMIT_OUTCOME_UNKNOWN` });
    }
    try { await db.query('rollback'); } catch { /* The caller closes this connection. */ }
    throw error;
  }
}
