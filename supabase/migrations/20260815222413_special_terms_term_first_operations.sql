begin;

-- The term-first editor records only redacted operation identity and counts.
-- Contractual wording, rules, and revision lineage remain exclusively in Salesforce.
alter table public.special_terms_operations
  drop constraint if exists special_terms_operations_operation_type_check;

alter table public.special_terms_operations
  add constraint special_terms_operations_operation_type_check
  check (operation_type in (
    'term_create', 'term_update', 'term_delete', 'rule_create', 'rule_update', 'rule_delete',
    'composition_save', 'clause_draft_create', 'clause_draft_revise',
    'clause_draft_delete', 'clause_version_discard', 'clause_approve', 'clause_global_publish', 'clause_retire',
    'clause_consolidation_start', 'clause_consolidation_relink',
    'clause_consolidation_cancel', 'clause_consolidation_complete',
    'migration_review_save', 'migration_activate', 'migration_rollback',
    'revision_save', 'revision_approve', 'revision_submit', 'revision_approve_publish', 'revision_rollback',
    'migration_batch_review', 'clause_ai_draft'
  ));

alter table public.special_terms_operations enable row level security;
revoke all on table public.special_terms_operations from anon, authenticated;
grant all on table public.special_terms_operations to service_role;

revoke all on function public.reserve_special_terms_operation_v2(text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_special_terms_operation(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.reserve_special_terms_operation_v2(text, text, text, text, text, uuid, text, text) to service_role;
grant execute on function public.complete_special_terms_operation(text, text, jsonb, text, text) to service_role;

commit;
