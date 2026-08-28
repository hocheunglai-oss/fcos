alter table public.dispute_beta_cases
  add column if not exists external_closure_detected_at timestamptz null,
  add column if not exists external_closure_salesforce_status text null,
  add column if not exists external_closure_salesforce_modified_at timestamptz null,
  add column if not exists external_closure_accepted_at timestamptz null,
  add column if not exists external_closure_accepted_by uuid null references public.user_profiles(id) on delete set null,
  add column if not exists external_closure_accepted_by_email text null,
  add column if not exists external_closure_acceptance_reason text null;

alter table public.dispute_beta_cases
  drop constraint if exists dispute_beta_cases_salesforce_writeback_status_check;

alter table public.dispute_beta_cases
  add constraint dispute_beta_cases_salesforce_writeback_status_check
  check (salesforce_writeback_status in ('not_started', 'success', 'partial', 'failed', 'external'));

alter table public.dispute_beta_cases
  drop constraint if exists dispute_beta_cases_external_closure_acceptance_check;

alter table public.dispute_beta_cases
  add constraint dispute_beta_cases_external_closure_acceptance_check
  check (
    (external_closure_accepted_at is null and external_closure_acceptance_reason is null)
    or (
      external_closure_accepted_at is not null
      and length(trim(external_closure_acceptance_reason)) > 0
    )
  );

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
    'salesforce_writeback',
    'supplier_hold_created',
    'supplier_hold_acknowledged',
    'supplier_payment_reconciled',
    'supplier_recovery_adjusted',
    'supplier_recovery_method_selected',
    'supplier_recovery_settled',
    'compensation_claim_linked',
    'external_closure_detected',
    'external_closure_accepted'
  ));

comment on column public.dispute_beta_cases.external_closure_detected_at is
  'First time FCOS confirmed that Salesforce was closed before FCOS accounting closure.';

comment on column public.dispute_beta_cases.external_closure_acceptance_reason is
  'Mandatory Administrator or General Manager reason for accepting an external Salesforce closure after FCOS accounting completes.';
