alter table public.dispute_beta_cases
  drop constraint if exists dispute_beta_cases_workflow_status_check;

update public.dispute_beta_cases
set workflow_status = case workflow_status
  when 'Approved - Pending Execution' then 'Approved - Pending Accounting'
  when 'Executed' then 'Settled - Ready to Close'
  else workflow_status
end;

alter table public.dispute_beta_cases
  add constraint dispute_beta_cases_workflow_status_check
  check (workflow_status in (
    'Draft',
    'Pending Approval',
    'Revision Requested',
    'Rejected',
    'Approved - Pending Accounting',
    'Accounting In Progress',
    'Settled - Ready to Close',
    'Closed'
  ));

alter table public.dispute_beta_actions
  drop constraint if exists dispute_beta_actions_execution_status_check;

update public.dispute_beta_actions
set execution_status = case execution_status
  when 'Pending Execution' then 'Pending Accounting'
  when 'Executed' then 'Settled'
  else execution_status
end;

alter table public.dispute_beta_actions
  alter column execution_status set default 'Pending Accounting',
  add column if not exists instruction_reference text null,
  add column if not exists instruction_date date null,
  add column if not exists instruction_amount numeric(18, 2) null,
  add column if not exists settlement_reference text null,
  add column if not exists settlement_date date null,
  add column if not exists settlement_amount numeric(18, 2) null,
  add column if not exists accounting_note text null,
  add column if not exists accounting_by uuid null references public.user_profiles(id) on delete set null,
  add column if not exists accounting_by_email text null,
  add column if not exists accounting_at timestamptz null,
  add constraint dispute_beta_actions_execution_status_check
  check (execution_status in ('Pending Accounting', 'Instruction Issued', 'Settled', 'Not Required'));

alter table public.dispute_beta_events
  drop constraint if exists dispute_beta_events_event_type_check;

alter table public.dispute_beta_events
  add constraint dispute_beta_events_event_type_check
  check (event_type in (
    'draft_saved',
    'submitted',
    'approved',
    'rejected',
    'revision_requested',
    'action_executed',
    'accounting_updated',
    'document_uploaded',
    'closed',
    'salesforce_writeback'
  ));

create table if not exists public.dispute_workflow_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_beta_cases(id) on delete cascade,
  action_id uuid null references public.dispute_beta_actions(id) on delete set null,
  stem_id text not null,
  party_type text not null check (party_type in ('buyer', 'supplier')),
  party_name text not null default '',
  dispute_id text null,
  document_type text not null check (document_type in (
    'settlement_agreement',
    'buyer_credit_note',
    'supplier_credit_note',
    'payment_instruction',
    'proof_of_payment',
    'correspondence',
    'other_support'
  )),
  original_filename text not null,
  smart_filename text not null,
  content_type text not null default 'application/octet-stream',
  file_extension text null,
  content_size bigint not null default 0 check (content_size >= 0),
  salesforce_content_version_id text not null,
  salesforce_content_document_id text null,
  salesforce_linked_record_id text not null,
  salesforce_url text null,
  uploaded_by uuid null references public.user_profiles(id) on delete set null,
  uploaded_by_email text null,
  created_at timestamptz not null default now(),
  unique (salesforce_content_version_id)
);

create index if not exists dispute_workflow_documents_case_idx
on public.dispute_workflow_documents(case_id, created_at desc);

create index if not exists dispute_workflow_documents_action_idx
on public.dispute_workflow_documents(action_id, created_at desc);

create index if not exists dispute_workflow_documents_stem_idx
on public.dispute_workflow_documents(stem_id, created_at desc);

alter table public.dispute_workflow_documents enable row level security;

revoke all on table public.dispute_workflow_documents from anon, authenticated;
grant all on table public.dispute_workflow_documents to service_role;
