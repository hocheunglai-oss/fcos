import { digest, requireCondition } from './contract.mjs';

export const COMPANY_FX_MIGRATION_PATH = 'supabase/migrations/20261111122500_company_fx_rate_history.sql';
export const COMPANY_FX_MIGRATION_DIGEST = 'cdca45954869d855125cca993a5024418cb1d4a9ca62c9aed5fb06eb825a5507';

export const COMPANY_FX_CATALOG_SQL = `with targets as (
  select to_regclass('public.company_fx_rate_history') as history,
    to_regclass('public.variable_charge_settings') as settings,
    to_regclass('public.variable_charge_setting_events') as events,
    to_regprocedure('public.save_variable_charge_settings(integer,numeric,uuid,text)') as save
), routines as (
  select p.*, p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join targets t
  where n.nspname='public' and (p.oid=t.save or p.proname in ('company_fx_rate_history_protect',
    'company_fx_rate_history_validate_insert', 'company_fx_rate_history_capture_settings_update'))
)
select jsonb_build_object(
  'dependenciesPresent', settings is not null and events is not null and save is not null,
  'history', (select jsonb_build_object(
    'kind', c.relkind, 'rls', c.relrowsecurity, 'forcedRls', c.relforcerowsecurity,
    'grants', array(select coalesce(r.rolname,'PUBLIC') || ':' || acl.privilege_type ||
      case when acl.is_grantable then ':grantable' else '' end
      from aclexplode(c.relacl) acl left join pg_roles r on r.oid=acl.grantee
      where acl.grantee<>c.relowner order by 1),
    'columns', array(select jsonb_build_array(a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid))
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped order by a.attnum),
    'constraints', array(select pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid=c.oid order by k.conname),
    'indexes', array(select jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)
      from pg_index i join pg_class j on j.oid=i.indexrelid where i.indrelid=c.oid order by j.relname),
    'policies', (select count(*) from pg_policy p where p.polrelid=c.oid))
    from pg_class c where c.oid=history),
  'routines', array(select jsonb_build_object(
    'signature', p.signature,
    'body', encode(sha256(convert_to(btrim(p.prosrc, E' \\n\\r\\t'), 'UTF8')), 'hex'),
    'configuration', p.proconfig, 'securityDefiner', p.prosecdef,
    'volatility', p.provolatile, 'strict', p.proisstrict, 'returnsSet', p.proretset,
    'result', pg_get_function_result(p.oid),
    'grants', array(select coalesce(r.rolname,'PUBLIC') || ':' || acl.privilege_type ||
      case when acl.is_grantable then ':grantable' else '' end
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      left join pg_roles r on r.oid=acl.grantee where acl.grantee<>p.proowner order by 1))
    from routines p order by p.signature),
  'triggers', array(select jsonb_build_array(pg_get_triggerdef(g.oid),g.tgenabled)
    from pg_trigger g where g.tgrelid in (history,settings) and not g.tgisinternal
    order by g.tgrelid::regclass::text,g.tgname)
) as catalog from targets`;

export async function readCompanyFxCatalog(db) {
  // The caller owns the pinned, transaction-scoped connection.
  await db.query('set local search_path = pg_catalog, pg_temp');
  const row = (await db.query(COMPANY_FX_CATALOG_SQL)).rows[0];
  requireCondition(row?.catalog?.dependenciesPresent === true, 'COMPANY_FX_CATALOG_DEPENDENCIES_MISSING');
  return { catalog: row.catalog, evidenceDigest: digest(row.catalog) };
}

// The before digest matches the pinned live catalog. The after digest was
// produced by executing the exact migration with the live default grants.
const baselineDigest = 'e5154c6b9d44d053a572fa428a93727c368be9fa32f155c679e121949461d45d';
const migratedDigest = 'fa0eb9b1d48021e79edcbaf0696359dc17623248d419304ea1bcfa30c6736875';

export function classifyCompanyFxCatalog(catalog) {
  const evidenceDigest = digest(catalog ?? null);
  const state = evidenceDigest === baselineDigest ? 'baseline' : evidenceDigest === migratedDigest ? 'migrated' : 'drift';
  requireCondition(state !== 'drift', 'COMPANY_FX_CATALOG_DRIFT');
  return { state, evidenceDigest };
}
