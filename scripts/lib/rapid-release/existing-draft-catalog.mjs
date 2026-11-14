import { digest, requireCondition } from './contract.mjs';

const introducedRelations = [
  'xero_existing_draft_authorisation_approved_records',
  'xero_existing_draft_authorisation_claims',
  'xero_existing_draft_authorisation_events',
  'xero_existing_draft_authorisation_requests',
  'xero_existing_draft_quota_events_v1',
  'xero_existing_draft_quota_grants_v1',
  'xero_existing_draft_quota_requests_v1',
  'xero_existing_draft_quota_scopes_v1',
  'xero_existing_draft_authorisation_events_sequence_seq',
];
const dependencies = [
  'user_profiles',
  'xero_contact_sync_connections',
  'xero_document_field_correction_claims',
  'xero_document_field_correction_events',
  'xero_financial_audit_events',
  'xero_financial_document_mappings',
  'xero_financial_sync_items',
  'xero_financial_sync_runs',
  'xero_shared_budgets',
  'xero_shared_requests',
  'xero_shared_tenant_control',
];
const routines = [
  'bind_xero_existing_draft_authorisation_request_v1',
  'claim_xero_existing_draft_authorisation_v1',
  'finish_xero_existing_draft_authorisation_v1',
  'persist_xero_existing_draft_authorisation_preview_v1',
  'xero_document_correction_active_v1',
  'xero_existing_draft_approved_subset_v1',
  'xero_existing_draft_ascii_canonical_v1',
  'xero_existing_draft_assert_v1',
  'xero_existing_draft_claim_guard_v1',
  'xero_existing_draft_event_guard_v1',
  'xero_existing_draft_finish_effects_v1',
  'xero_existing_draft_hash_assert_v1',
  'xero_existing_draft_mapping_guard_v1',
  'xero_existing_draft_preserved_v1',
  'xero_existing_draft_provider_guard_v1',
  'xero_existing_draft_quota_actor_v1',
  'xero_existing_draft_quota_budget_guard_v1',
  'xero_existing_draft_quota_claim_guard_v1',
  'xero_existing_draft_quota_floor_v1',
  'xero_existing_draft_quota_grant_guard_v1',
  'xero_existing_draft_quota_lock_v1',
  'xero_existing_draft_quota_policy_v1',
  'xero_existing_draft_quota_receipt_guard_v1',
  'xero_existing_draft_quota_release_v1',
  'xero_existing_draft_quota_reserve_v1',
  'xero_existing_draft_quota_targets_v1',
  'xero_existing_draft_request_guard_v1',
  'xero_existing_draft_tenant_lock_v1',
  'xero_existing_draft_timestamp_assert_v1',
  'xero_shared_admit_scoped_v1',
];

const baselineDigest = '07d76bcddfa836ecd80a927beb053cef0f538338c3c3e32c7563b5e09617c3d8';
const migratedDigest = '307e3c97ca0772357a2c1039499dee398ee75a8cc7b1f06f083511da05dc5f77';

const catalogSql = `with relations as (
 select c.*, c.relname=any($1::text[]) as introduced
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and (c.relname=any($1::text[]) or c.relname=any($2::text[]))
), api_roles as (select oid,rolname from pg_roles where rolname in ('anon','authenticated','service_role'))
select jsonb_build_object(
 'dependencies',array(select relname::text||':'||relkind::text from relations where not introduced order by relname collate "C"),
 'helperPresent',to_regprocedure('public.xero_shared_assert_tenant(text)') is not null
   and to_regprocedure('public.fcos_has_access(uuid,text)') is not null,
 'apiRoles',array(select rolname from api_roles order by rolname collate "C"),
 'relations',coalesce((select jsonb_agg(jsonb_build_object(
   'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'grants',array(select (coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||case when a.is_grantable then ':grantable' else '' end) collate "C"
     from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a
     left join pg_roles r on r.oid=a.grantee where a.grantee<>c.relowner order by 1),
   'apiGrants',array(select (r.rolname||':'||p) collate "C" from api_roles r
     cross join unnest(case when c.relkind='S' then array['SELECT','UPDATE','USAGE']
       else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] end) p
     where case when c.relkind='S' then has_sequence_privilege(r.oid,c.oid,p)
       else has_table_privilege(r.oid,c.oid,p) end order by 1),
   'sequence',(select jsonb_build_array(format_type(s.seqtypid,null),s.seqstart,s.seqincrement,s.seqmin,s.seqmax,s.seqcache,s.seqcycle)
     from pg_sequence s where s.seqrelid=c.oid)
 ) order by c.relname collate "C") from relations c where c.introduced),'[]'::jsonb),
 'columns',coalesce((select jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),
   a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
   array(select (coalesce(r.rolname,'PUBLIC')||':'||acl.privilege_type||case when acl.is_grantable then ':grantable' else '' end) collate "C"
     from aclexplode(a.attacl) acl left join pg_roles r on r.oid=acl.grantee order by 1))
   order by c.relname collate "C",a.attnum)
   from relations c join pg_attribute a on a.attrelid=c.oid
   left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
   where c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
   and c.introduced),'[]'::jsonb),
 'constraints',coalesce((select jsonb_agg(jsonb_build_array(c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid))
   order by c.relname collate "C",k.conname collate "C")
   from relations c join pg_constraint k on k.conrelid=c.oid where c.introduced),'[]'::jsonb),
 'indexes',coalesce((select jsonb_agg(jsonb_build_array(c.relname,i.relname,x.indisvalid,x.indisready,pg_get_indexdef(i.oid))
   order by c.relname collate "C",i.relname collate "C")
   from relations c join pg_index x on x.indrelid=c.oid join pg_class i on i.oid=x.indexrelid where c.introduced or i.relname = 'xero_existing_draft_preview_event_unique'),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(jsonb_build_array(p.tablename,p.policyname,p.permissive,
   array(select name from unnest(p.roles) name order by name collate "C"),p.cmd,p.qual,p.with_check)
   order by p.tablename collate "C",p.policyname collate "C")
   from pg_policies p where p.schemaname='public' and p.tablename=any($1::text[])),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid))
   order by c.relname collate "C",t.tgname collate "C")
   from relations c join pg_trigger t on t.tgrelid=c.oid
   where not t.tgisinternal and (c.introduced or t.tgname like 'existing_draft_%')),'[]'::jsonb),
 'routines',coalesce((select jsonb_agg(jsonb_build_object(
   'name',p.proname,'signature',oidvectortypes(p.proargtypes),'owner',pg_get_userbyid(p.proowner),
   'definitionDigest',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
   'grants',array(select (coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||case when a.is_grantable then ':grantable' else '' end) collate "C"
     from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     left join pg_roles r on r.oid=a.grantee where a.grantee<>p.proowner order by 1),
   'apiExecute',array(select rolname from api_roles r where has_function_privilege(r.oid,p.oid,'EXECUTE') order by rolname collate "C")
 ) order by p.proname collate "C",oidvectortypes(p.proargtypes) collate "C")
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and (p.proname=any($3::text[]) or p.proname like 'xero_existing_draft_%') and p.prokind in ('f','p')),'[]'::jsonb)
) as snapshot`;

export async function readExistingDraftCatalogSnapshot(db) {
  await db.query('set local search_path = pg_catalog, pg_temp');
  return (await db.query(catalogSql, [introducedRelations, dependencies, routines])).rows[0]?.snapshot;
}

export async function readExistingDraftCatalog(db) {
  const evidenceDigest = digest(await readExistingDraftCatalogSnapshot(db) ?? null);
  const state = evidenceDigest === baselineDigest ? 'baseline' : evidenceDigest === migratedDigest ? 'migrated' : 'drift';
  requireCondition(state !== 'drift', 'EXISTING_DRAFT_CATALOG_DRIFT');
  return { state, evidenceDigest };
}
