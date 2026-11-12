import { digest, requireCondition } from './contract.mjs';

const introducedRelations = [
  'xero_financial_credit_allocations', 'xero_financial_credit_allocation_audit',
  'xero_financial_credit_allocation_audit_audit_id_seq', 'xero_financial_rounding_policies',
  'xero_financial_prepayment_operations', 'xero_financial_prepayment_operation_audit',
  'xero_financial_prepayment_operation_audit_audit_id_seq', 'xero_prepayment_posting_policies',
  'xero_prepayment_posting_policy_history', 'xero_native_document_draft_operations',
  'xero_native_document_draft_audit', 'xero_native_document_draft_audit_id_seq',
];
const dependencies = [
  'xero_financial_audit_events', 'xero_financial_bank_mappings', 'xero_financial_document_mappings',
  'xero_financial_payment_mappings', 'xero_financial_sync_runs',
];
const addedColumns = {
  xero_financial_payment_mappings: [
    'accounting_usd', 'invoice_carrying_usd', 'settlement_fx_usd', 'company_fx_rate', 'company_fx_revision',
    'currency_evidence', 'currency_reconciliation', 'xero_currency_rate', 'xero_bank_amount', 'xero_warnings',
  ],
  xero_financial_document_mappings: [
    'currency', 'accounting_usd', 'company_fx_rate', 'company_fx_revision', 'currency_evidence', 'xero_currency_rate',
  ],
};
const addedConstraints = [
  'xero_payment_company_fx_rate_valid', 'xero_payment_hkd_evidence_required', 'xero_financial_document_mappings_currency_check',
  'xero_document_company_fx_rate_valid', 'xero_document_hkd_evidence_required',
];
const addedTrigger = 'guard_xero_native_hkd_payment_claim';
const routines = [
  'append_xero_credit_allocation_audit_v1', 'claim_xero_credit_allocation_v1', 'transition_xero_credit_allocation_v1',
  'save_xero_rounding_policy_v1', 'guard_xero_prepayment_operation_v1', 'append_xero_prepayment_operation_audit_v1',
  'guard_xero_prepayment_operation_audit_v1', 'claim_xero_prepayment_operation_v1', 'mark_xero_prepayment_sent_v1',
  'finish_xero_prepayment_operation_v1', 'cancel_xero_prepayment_operation_v1', 'guard_xero_invoice_settlement_claim_v1',
  'reject_xero_prepayment_posting_policy_history_mutation', 'record_xero_prepayment_posting_policy_history',
  'save_xero_prepayment_posting_policy_v1', 'finish_xero_native_hkd_payment_v1', 'guard_xero_native_hkd_payment_claim_v1',
  'claim_xero_native_hkd_payment_v1', 'claim_xero_native_document_draft_v1', 'transition_xero_native_document_draft_v1',
];
const baselineDigest = 'd2e2c8322a19b508a31eb2e7d2067a384fd6fafcd0e83e6ccc015ae746f76b6e';
const migratedDigest = '51017a91877587908b39258792996d87270dcffc26d09b24b6b0e260ade8cce1';

const catalogSql = `with relations as (
 select c.*, c.relname=any($1::text[]) as introduced
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and (c.relname=any($1::text[]) or c.relname=any($2::text[]))
), api_roles as (select oid,rolname from pg_roles where rolname in ('anon','authenticated','service_role'))
select jsonb_build_object(
 'dependencies',array(select relname::text||':'||relkind::text from relations where not introduced order by relname collate "C"),
 'helperPresent',to_regprocedure('public.xero_shared_assert_tenant(text)') is not null,
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
   and (c.introduced or ($3::jsonb->c.relname::text) ? a.attname::text)),'[]'::jsonb),
 'constraints',coalesce((select jsonb_agg(jsonb_build_array(c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid))
   order by c.relname collate "C",k.conname collate "C")
   from relations c join pg_constraint k on k.conrelid=c.oid where c.introduced or k.conname=any($4::text[])),'[]'::jsonb),
 'indexes',coalesce((select jsonb_agg(jsonb_build_array(c.relname,i.relname,x.indisvalid,x.indisready,pg_get_indexdef(i.oid))
   order by c.relname collate "C",i.relname collate "C")
   from relations c join pg_index x on x.indrelid=c.oid join pg_class i on i.oid=x.indexrelid where c.introduced),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(jsonb_build_array(p.tablename,p.policyname,p.permissive,
   array(select name from unnest(p.roles) name order by name collate "C"),p.cmd,p.qual,p.with_check)
   order by p.tablename collate "C",p.policyname collate "C")
   from pg_policies p where p.schemaname='public' and p.tablename=any($1::text[])),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid))
   order by c.relname collate "C",t.tgname collate "C")
   from relations c join pg_trigger t on t.tgrelid=c.oid
   where not t.tgisinternal and (c.introduced or t.tgname=$5)),'[]'::jsonb),
 'routines',coalesce((select jsonb_agg(jsonb_build_object(
   'name',p.proname,'signature',oidvectortypes(p.proargtypes),'owner',pg_get_userbyid(p.proowner),
   'definitionDigest',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
   'grants',array(select (coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||case when a.is_grantable then ':grantable' else '' end) collate "C"
     from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     left join pg_roles r on r.oid=a.grantee where a.grantee<>p.proowner order by 1),
   'apiExecute',array(select rolname from api_roles r where has_function_privilege(r.oid,p.oid,'EXECUTE') order by rolname collate "C")
 ) order by p.proname collate "C",oidvectortypes(p.proargtypes) collate "C")
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname=any($6::text[]) and p.prokind in ('f','p')),'[]'::jsonb)
) as snapshot`;

export async function readTradingFxCatalogSnapshot(db) {
  await db.query('set local search_path = pg_catalog, pg_temp');
  return (await db.query(catalogSql, [
    introducedRelations, dependencies, JSON.stringify(addedColumns), addedConstraints, addedTrigger, routines,
  ])).rows[0]?.snapshot;
}

export async function readTradingFxCatalog(db) {
  const evidenceDigest = digest(await readTradingFxCatalogSnapshot(db) ?? null);
  const state = evidenceDigest === baselineDigest ? 'baseline' : evidenceDigest === migratedDigest ? 'migrated' : 'drift';
  requireCondition(state !== 'drift', 'TRADING_FX_CATALOG_DRIFT');
  return { state, evidenceDigest };
}
