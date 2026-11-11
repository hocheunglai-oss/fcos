import { digest, requireCondition } from './contract.mjs';

export const GROUPED_PETROLEUM_MIGRATIONS = Object.freeze([Object.freeze({
  path: 'supabase/migrations/20261111164003_xero_issued_grouped_petroleum_preservation.sql',
  digest: 'adac56ff60139076f117ebb5d6d966a273deb787a108a29a7247a0e9745e1002',
})]);

const names = [
  'link_xero_issued_grouped_petroleum_document_v1',
  'protect_xero_issued_grouped_petroleum_audit_v1',
  'xero_issued_grouped_canonical_v1',
  'xero_issued_grouped_cents_v1',
  'xero_issued_grouped_legal_words_v1',
];
const trigger = 'xero_issued_grouped_petroleum_audit_guard';
const dependencies = [
  'xero_contact_sync_connections',
  'xero_financial_audit_events',
  'xero_financial_document_mappings',
  'xero_financial_product_mappings',
  'xero_financial_sync_items',
  'xero_financial_sync_runs',
];
const catalogSql = `select jsonb_build_object(
 'missingRelations',array(select name from unnest($3::text[]) name where to_regclass('public.'||name) is null),
 'helperPresent',to_regprocedure('public.xero_grouped_salesforce_id_v1(text)') is not null,
 'routines',coalesce((select jsonb_agg(jsonb_build_object(
  'name',p.proname,'signature',oidvectortypes(p.proargtypes),'owner',pg_get_userbyid(p.proowner),
  'bodyDigest',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'result',pg_get_function_result(p.oid),
  'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'settings',p.proconfig,
  'grants',array(select coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||case when a.is_grantable then ':grantable' else '' end
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   left join pg_roles r on r.oid=a.grantee where a.grantee<>p.proowner order by 1),
  'apiExecute',array(select r.rolname from pg_roles r where r.rolname in ('anon','authenticated','service_role')
   and has_function_privilege(r.oid,p.oid,'EXECUTE') order by r.rolname)
 ) order by p.proname,oidvectortypes(p.proargtypes)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any($1::text[])),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'table',c.relname,'enabled',t.tgenabled,
  'definitionDigest',encode(sha256(convert_to(pg_get_triggerdef(t.oid),'UTF8')),'hex')) order by c.relname)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal and t.tgname=$2),'[]'::jsonb)
 ) snapshot`;
const baselineDigest = 'aec57cd07472bc1cb965e928f0de049b9c953cc130a372a4b96102642f057f62';
const migratedDigest = 'd494d316a8b2bd0e52c55e18bbb9a87a31fa7e4bfcfe0b6550968f3c8682df05';

export async function readGroupedPetroleumCatalog(db) {
  await db.query('set local search_path = pg_catalog, pg_temp');
  const snapshot = (await db.query(catalogSql, [names, trigger, dependencies])).rows[0]?.snapshot;
  const evidenceDigest = digest(snapshot ?? null);
  const state = evidenceDigest === baselineDigest ? 'baseline' : evidenceDigest === migratedDigest ? 'migrated' : 'drift';
  requireCondition(state !== 'drift', 'GROUPED_PETROLEUM_CATALOG_DRIFT');
  return { state, evidenceDigest };
}
