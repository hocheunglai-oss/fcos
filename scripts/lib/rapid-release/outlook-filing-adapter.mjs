import { digest, requireCondition } from './contract.mjs';
import { reviewedMigrationAdapter } from './reviewed-migration-adapter.mjs';
import { runReviewedMigrationTransaction } from './reviewed-migration-transaction.mjs';

const historicalVersion = '20261003165804';
const moduleId = 'outlook_nomination_filing';
const historical = {
  path: 'supabase/migrations/20261003165804_outlook_disabled_nomination_filing_0fa87b5aaec2.sql',
  digest: '0fa87b5aaec28d76a7a4875398b15c972fc2460e7ced06f36ed5fe2d8f97f91f',
};
const registration = {
  path: 'supabase/migrations/20261112020044_outlook_nomination_filing_access.sql',
  digest: '4fcadbeecfee25a81be68ef83a2bd1acb78ec7383b8310f88df222622949835f',
};
const tables = ['fcos_nomination_filing_grants', 'fcos_nomination_operations', 'fcos_nomination_slot_locks'];

async function readCatalog(db) {
  const { rows: [state] } = await db.query(`
    with objects as (
      select c.oid, c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($3::text[])
    )
    select
      (select case when cardinality(statements)=1 then encode(sha256(convert_to(statements[1],'UTF8')),'hex') end
         from supabase_migrations.schema_migrations where version=$1) as history,
      exists(select 1 from public.app_modules where id=$2 and path='/outlook-nomination-filing') as module,
      (select kind from public.permission_access_catalog where id=$2) as kind,
      not exists(select 1 from public.permission_groups where permissions->>$2 in ('true','read','full')) as no_group_grants,
      not exists(select 1 from public.fcos_nomination_filing_grants) as no_record_grants,
      (select count(*)=cardinality($3::text[]) and bool_and(relrowsecurity
         and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         and has_table_privilege('service_role',oid,'SELECT')
         and not has_table_privilege('service_role',oid,'TRUNCATE,REFERENCES,TRIGGER')
         and (has_table_privilege('service_role',oid,'INSERT') = (relname <> $4))
         and (has_table_privilege('service_role',oid,'UPDATE') = (relname <> $4))
         and (has_table_privilege('service_role',oid,'DELETE') = (relname <> $4))) from objects) as table_acl,
      exists(select 1 from pg_proc where oid=to_regprocedure('public.fcos_nomination_operation(text,uuid,uuid,jsonb)')
        and not prosecdef and has_function_privilege('service_role',oid,'EXECUTE')
        and not has_function_privilege('anon',oid,'EXECUTE')
        and not has_function_privilege('authenticated',oid,'EXECUTE')) as routine_acl
  `, [historicalVersion, moduleId, tables, tables[0]]);
  requireCondition(state?.history === historical.digest && state.module && state.no_group_grants
    && state.no_record_grants && state.table_acl && state.routine_acl
    && (state.kind === null || state.kind === 'module'), 'OUTLOOK_FILING_CATALOG_MISMATCH');
  return { state: state.kind === null ? 'baseline' : 'migrated', evidenceDigest: digest(state) };
}

export function runOutlookFilingTransaction(input) {
  const bytes = input.migrationBytes;
  requireCondition(bytes?.length === 2 && Buffer.isBuffer(bytes[0]) && digest(bytes[0]) === historical.digest,
    'OUTLOOK_FILING_HISTORICAL_BYTES_CHANGED');
  return runReviewedMigrationTransaction({ ...input, migrationBytes: [bytes[1]] }, {
    reviewedMigrations: [registration], readCatalog, errorPrefix: 'OUTLOOK_FILING', schemaEffect: 'preserve',
  });
}

export const applyReviewedPrerequisites = reviewedMigrationAdapter({
  migrations: [historical, registration], workflowPaths: ['api/outlook/nomination-filing.js'],
  transactMigration: runOutlookFilingTransaction, errorPrefix: 'OUTLOOK_FILING',
  credentialsPrefix: 'OUTLOOK_FILING', purpose: 'rapid_outlook_filing_prerequisite', requiredModule: 'admin',
});
