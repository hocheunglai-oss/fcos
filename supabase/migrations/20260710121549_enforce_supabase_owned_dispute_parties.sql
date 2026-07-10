drop index if exists public.dispute_beta_actions_case_party_uidx;

alter table public.dispute_beta_actions
  drop constraint if exists dispute_beta_actions_party_account_id_check,
  drop constraint if exists dispute_beta_actions_party_key_check,
  alter column party_id set not null,
  alter column party_side set not null,
  drop column if exists party_type,
  drop column if exists party_name,
  drop column if exists party_account_id,
  drop column if exists party_key,
  drop column if exists dispute_ids;

alter table public.dispute_workflow_documents
  drop constraint if exists dispute_workflow_documents_party_account_id_check,
  alter column party_id set not null,
  alter column party_side set not null,
  alter column document_direction set not null,
  drop column if exists party_type,
  drop column if exists dispute_id,
  drop column if exists dispute_ids,
  drop column if exists salesforce_linked_record_ids;

drop index if exists public.dispute_workflow_documents_case_party_idx;
