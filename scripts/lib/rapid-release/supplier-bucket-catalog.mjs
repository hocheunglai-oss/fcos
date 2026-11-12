import { digest, requireCondition } from './contract.mjs';

export const SUPPLIER_BUCKET_MIGRATIONS = Object.freeze([
  Object.freeze({ path: 'supabase/migrations/20261111155100_xero_aggregate_supplier_preservation_v3.sql', digest: 'f0c212ca317c78016495b359e4438d157221f402ca4cc2b28e22459cdea51859' }),
  Object.freeze({ path: 'supabase/migrations/20261111155101_xero_aggregate_supplier_component_literals_v3.sql', digest: 'bd445e3e72afa72586c7be0cf3412b08b0b8235d04d0586371105b0111ebd9a9' }),
  Object.freeze({ path: 'supabase/migrations/20261111155102_xero_settled_supplier_ledger_assert_v1.sql', digest: 'c8e8ca9140cc063df176ae25fc12b923bf4907814208fb5f3b9334e2ff7779d4' }),
  Object.freeze({ path: 'supabase/migrations/20261111155103_xero_supplier_financial_bucket_link_v1.sql', digest: '520eea32ed0da3577f57af2f2fb98557eb7547457fcc69931ee4e5801672d4eb' }),
]);

const targets = [
  [
    'link_xero_aggregate_supplier_document_v3',
    'link_xero_financial_bucket_document_v1',
    'persist_xero_supplier_financial_preview_v1',
    'protect_xero_supplier_financial_mapping_v1',
    'xero_aggregate_supplier_approval_material_v3',
    'xero_aggregate_supplier_assert_v3',
    'xero_aggregate_supplier_calendar_date_v3',
    'xero_aggregate_supplier_money_v3',
    'xero_settled_supplier_cents_v1',
    'xero_settled_supplier_evidence_assert_v1',
    'xero_settled_supplier_snapshot_assert_v1',
    'xero_supplier_financial_approval_material_v1',
    'xero_supplier_financial_cents_v1',
    'xero_supplier_financial_json_bound_v1',
    'xero_supplier_financial_review_assert_v1',
    'xero_supplier_financial_transport_bound_v1',
  ],
  [
    'xero_supplier_financial_link_event_unique',
    'xero_supplier_financial_preview_event_unique',
  ],
  [
    'protect_xero_supplier_financial_mapping',
  ],
];

const catalogSql = `select jsonb_build_object(
 'routines', coalesce((select jsonb_agg(jsonb_build_object(
   'name',p.proname,'argumentTypes',pg_catalog.oidvectortypes(p.proargtypes),
   'owner',pg_catalog.pg_get_userbyid(p.proowner),
   'bodyDigest',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
   'securityDefiner',p.prosecdef,'settings',p.proconfig,
   'unexpectedExecuteGrant',exists(
     select from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) acl
     left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
     where acl.privilege_type='EXECUTE' and acl.grantee<>p.proowner
     and (grantee.rolname is distinct from 'service_role' or acl.is_grantable)
   ),
   'apiExecute',array(select role.rolname from pg_catalog.pg_roles role
     where role.rolname in ('anon','authenticated','service_role') and has_function_privilege(role.oid,p.oid,'EXECUTE') order by role.rolname)
 ) order by p.proname,pg_catalog.oidvectortypes(p.proargtypes))
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any($1::text[])),'[]'::jsonb),
 'indexes', coalesce((select jsonb_agg(jsonb_build_object('name',c.relname,
   'definitionDigest',encode(sha256(convert_to(pg_catalog.pg_get_indexdef(c.oid),'UTF8')),'hex'),
   'unique',i.indisunique,'valid',i.indisvalid) order by c.relname)
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 join pg_catalog.pg_index i on i.indexrelid=c.oid
 where n.nspname='public' and c.relname=any($2::text[])),'[]'::jsonb),
 'triggers', coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'table',c.relname,
   'definitionDigest',encode(sha256(convert_to(pg_catalog.pg_get_triggerdef(t.oid),'UTF8')),'hex'),
   'enabled',t.tgenabled) order by t.tgname)
 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal and t.tgname=any($3::text[])),'[]'::jsonb)
 ) as snapshot`;
const baselineDigest = 'f32098ede55c08ba8713ba8c24f8de6a864c6fa477c9e78d087a901d034e5877';
const migratedDigest = 'a5668fdb93ab633ec5d270aba4c4977eea7524ec478388c72867d402fd25b293';

export async function readSupplierBucketCatalog(db) {
  // Normalize deparser output independently of the connection's search path.
  await db.query('set local search_path = pg_catalog, pg_temp');
  const row = (await db.query(catalogSql, targets)).rows[0]?.snapshot;
  requireCondition(row && Array.isArray(row.routines) && Array.isArray(row.indexes)
    && Array.isArray(row.triggers), 'SUPPLIER_BUCKET_CATALOG_REQUIRED');
  const evidenceDigest = digest(row);
  const state = evidenceDigest === baselineDigest ? 'baseline' : evidenceDigest === migratedDigest ? 'migrated' : 'drift';
  requireCondition(state !== 'drift', 'SUPPLIER_BUCKET_CATALOG_DRIFT');
  return { state, evidenceDigest };
}
