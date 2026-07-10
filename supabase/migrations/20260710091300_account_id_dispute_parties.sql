alter table public.dispute_beta_actions
  add column if not exists party_account_id text null,
  add column if not exists party_key text null;

alter table public.dispute_beta_actions
  drop constraint if exists dispute_beta_actions_party_account_id_check,
  drop constraint if exists dispute_beta_actions_party_key_check;

alter table public.dispute_beta_actions
  add constraint dispute_beta_actions_party_account_id_check
    check (party_account_id is null or party_account_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  add constraint dispute_beta_actions_party_key_check
    check (party_key is null or party_key = party_type || ':' || party_account_id);

create unique index if not exists dispute_beta_actions_case_party_uidx
on public.dispute_beta_actions(case_id, party_type, party_account_id)
where party_account_id is not null;

alter table public.dispute_workflow_documents
  add column if not exists party_account_id text null,
  add column if not exists dispute_ids text[] not null default '{}'::text[],
  add column if not exists salesforce_linked_record_ids text[] not null default '{}'::text[];

alter table public.dispute_workflow_documents
  drop constraint if exists dispute_workflow_documents_party_account_id_check;

alter table public.dispute_workflow_documents
  add constraint dispute_workflow_documents_party_account_id_check
    check (party_account_id is null or party_account_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$');

create index if not exists dispute_workflow_documents_case_party_idx
on public.dispute_workflow_documents(case_id, party_type, party_account_id, created_at desc);
