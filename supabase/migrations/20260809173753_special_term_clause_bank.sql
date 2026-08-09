begin;

insert into public.app_modules (id, label, path, sort_order) values
  ('special_terms_clause_approve', 'Approve Special Term Clauses', '/special-terms', 188)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'special_terms_clause_approve', id in ('general_manager', 'administrator')
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select profile.id, 'special_terms_clause_approve', profile.user_type in ('general_manager', 'administrator')
from public.user_profiles profile
where profile.use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

alter table public.special_terms_operations
  drop constraint if exists special_terms_operations_operation_type_check;

alter table public.special_terms_operations
  add constraint special_terms_operations_operation_type_check
  check (operation_type in (
    'term_create',
    'term_update',
    'term_delete',
    'rule_create',
    'rule_update',
    'rule_delete',
    'composition_save',
    'clause_draft_create',
    'clause_draft_revise',
    'clause_approve',
    'clause_retire',
    'migration_review_save',
    'migration_activate',
    'migration_rollback'
  ));

alter table public.special_terms_operations
  drop constraint if exists special_terms_operations_salesforce_object_check;

alter table public.special_terms_operations
  add constraint special_terms_operations_salesforce_object_check
  check (salesforce_object in (
    'Special_Term__c',
    'Special_Term_Rule__c',
    'Special_Term_Clause__c',
    'Special_Term_Clause_Version__c',
    'Special_Term_Clause_Assignment__c'
  ));

alter table public.special_terms_operations enable row level security;
revoke all on table public.special_terms_operations from anon, authenticated;
grant all on table public.special_terms_operations to service_role;

commit;
