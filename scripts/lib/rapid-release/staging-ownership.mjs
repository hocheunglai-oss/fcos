import { requireCondition } from './contract.mjs';

// Two fixed 32-bit keys keep this release-purpose lock separate from existing
// application and financial locks. The transaction owns its automatic release.
const lockScope = [1178816339, 1398030663];

export async function lockStagingTransition(db, { staging = false } = {}) {
  const name = staging ? 'pg_try_advisory_xact_lock_shared' : 'pg_try_advisory_xact_lock';
  const result = await db.query(`select pg_catalog.${name}($1::integer, $2::integer) as acquired`, lockScope);
  requireCondition(result.rows?.[0]?.acquired === true, 'RAPID_STAGING_HANDOVER_OVERLAP');
}
