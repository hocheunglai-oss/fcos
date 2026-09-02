begin;

-- Consolidation lineage and all contractual wording remain in Salesforce. This
-- migration only permits the existing service-only operation ledger to record
-- redacted lifecycle outcomes for the new authenticated handlers.
alter table public.special_terms_operations
  drop constraint if exists special_terms_operations_operation_type_check;

alter table public.special_terms_operations
  add constraint special_terms_operations_operation_type_check
  check (operation_type in (
    'term_create', 'term_update', 'term_delete', 'rule_create', 'rule_update', 'rule_delete',
    'composition_save', 'clause_draft_create', 'clause_draft_revise', 'clause_approve', 'clause_retire',
    'clause_consolidation_start', 'clause_consolidation_relink',
    'clause_consolidation_cancel', 'clause_consolidation_complete',
    'migration_review_save', 'migration_activate', 'migration_rollback',
    'revision_save', 'revision_approve', 'revision_rollback', 'migration_batch_review', 'clause_ai_draft'
  ));

-- Reassert the service-only boundary in case a later platform default exposes a
-- public-schema table through the Data API.
alter table public.special_terms_operations enable row level security;
alter table public.special_terms_notification_states enable row level security;
revoke all on table public.special_terms_operations from anon, authenticated;
revoke all on table public.special_terms_notification_states from anon, authenticated;
grant all on table public.special_terms_operations to service_role;
grant all on table public.special_terms_notification_states to service_role;

commit;
