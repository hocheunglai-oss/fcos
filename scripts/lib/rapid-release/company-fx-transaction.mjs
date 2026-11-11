import { digest, isDigest, requireCondition } from './contract.mjs';
import { SCHEMA_FINGERPRINT_SQL } from './compatibility.mjs';
import { classifyCompanyFxCatalog, COMPANY_FX_MIGRATION_DIGEST, COMPANY_FX_MIGRATION_PATH, readCompanyFxCatalog } from './company-fx-catalog.mjs';

const migrationVersion = '20261111122500';
const migrationName = 'company_fx_rate_history';
const readLedger = 'select name, idempotency_key, statements from supabase_migrations.schema_migrations where version=$1';
const writeLedger = 'insert into supabase_migrations.schema_migrations(version,name,idempotency_key,statements) values($1,$2,$3,$4)';

export async function applyCompanyFxTransaction({ db, migrationBytes, operationDigest, baselineSchemaDigest, assertConnection, assertWriteAuthorized }) {
  requireCondition(Buffer.isBuffer(migrationBytes) && digest(migrationBytes) === COMPANY_FX_MIGRATION_DIGEST,
    'COMPANY_FX_MIGRATION_BYTES_CHANGED');
  requireCondition(isDigest(operationDigest) && isDigest(baselineSchemaDigest) && typeof assertConnection === 'function'
    && typeof assertWriteAuthorized === 'function',
    'COMPANY_FX_OPERATION_BINDING_REQUIRED');
  const source = migrationBytes.toString('utf8');
  // The pinned file is also runnable standalone. This caller owns the transaction
  // so native migration history and schema changes commit together.
  requireCondition(source.startsWith('begin;\n') && source.endsWith('\ncommit;\n'), 'COMPANY_FX_TRANSACTION_BOUNDARY_CHANGED');
  const sql = source.slice('begin;'.length, -'commit;\n'.length).trim();
  let commitSubmitted = false;
  await db.query('begin isolation level read committed');
  try {
    await assertConnection();
    await db.query("set local lock_timeout = '5s'; set local statement_timeout = '45s'; set local idle_in_transaction_session_timeout = '60s'");
    // This conflicts with ledger inserts from other writers and waits for a prior
    // disconnected attempt before reading the original outcome.
    await db.query('lock table supabase_migrations.schema_migrations in share row exclusive mode');
    const existing = (await db.query(readLedger, [migrationVersion])).rows[0];
    const baseline = existing ? null : (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.digest;
    const before = classifyCompanyFxCatalog((await readCompanyFxCatalog(db)).catalog);
    let state;
    if (existing) {
      requireCondition(existing.name === migrationName && existing.idempotency_key === operationDigest
        && Array.isArray(existing.statements) && existing.statements.length === 1 && existing.statements[0] === sql
        && before.state === 'migrated', 'COMPANY_FX_ORIGINAL_OPERATION_MISMATCH');
      state = before;
    } else {
      requireCondition(baseline === baselineSchemaDigest && before.state === 'baseline', 'COMPANY_FX_BASELINE_SCHEMA_CHANGED');
      await assertWriteAuthorized();
      await db.query(sql);
      state = classifyCompanyFxCatalog((await readCompanyFxCatalog(db)).catalog);
      requireCondition(state.state === 'migrated', 'COMPANY_FX_MIGRATED_SCHEMA_REQUIRED');
      await db.query(writeLedger, [migrationVersion, migrationName, operationDigest, [sql]]);
    }
    commitSubmitted = true;
    const committed = await db.query('commit');
    requireCondition(committed.command === 'COMMIT', 'COMPANY_FX_COMMIT_ACKNOWLEDGEMENT_INVALID');
    return { state: existing ? 'recovered' : 'applied', evidenceDigest: digest({ operationDigest,
      path: COMPANY_FX_MIGRATION_PATH, migrationDigest: COMPANY_FX_MIGRATION_DIGEST, catalogDigest: state.evidenceDigest }) };
  } catch (error) {
    if (commitSubmitted) {
      throw Object.assign(new Error('Company FX commit outcome requires original-operation readback.'), { code: 'COMPANY_FX_COMMIT_OUTCOME_UNKNOWN' });
    }
    try { await db.query('rollback'); } catch { /* The caller closes this connection. */ }
    throw error;
  }
}
