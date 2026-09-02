insert into public.app_modules (id, label, path, sort_order)
values ('unofficial_compensation', 'Unofficial Compensation', '/unofficial-compensation', 42)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select source.user_type_id, 'unofficial_compensation', source.can_view
from public.user_type_module_permissions source
where source.module_id = 'buyer_invoices'
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select source.user_id, 'unofficial_compensation', source.can_view
from public.user_module_permissions source
where source.module_id = 'buyer_invoices'
on conflict (user_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

create table public.unofficial_compensation_operations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  operation_type text not null check (operation_type in (
    'claim_create',
    'claim_group_status',
    'recovery_create',
    'recovery_delete',
    'dispute_claim_link'
  )),
  request_hash text not null,
  operation_status text not null default 'pending' check (operation_status in (
    'pending',
    'succeeded',
    'failed',
    'uncertain'
  )),
  salesforce_object text null,
  salesforce_record_id text null,
  account_id text null,
  stem_id text null,
  dispute_action_id uuid null references public.dispute_beta_actions(id) on delete set null,
  audit_reason text null,
  result_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(result_snapshot) = 'object'),
  error_code text null,
  error_message text null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint unofficial_compensation_operations_salesforce_id_check
    check (salesforce_record_id is null or salesforce_record_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  constraint unofficial_compensation_operations_account_id_check
    check (account_id is null or account_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  constraint unofficial_compensation_operations_stem_id_check
    check (stem_id is null or stem_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$')
);

create index unofficial_compensation_operations_actor_idx
on public.unofficial_compensation_operations(actor_user_id, created_at desc);

create index unofficial_compensation_operations_status_idx
on public.unofficial_compensation_operations(operation_status, updated_at desc);

create index unofficial_compensation_operations_account_idx
on public.unofficial_compensation_operations(account_id, created_at desc);

alter table public.unofficial_compensation_operations enable row level security;
revoke all on table public.unofficial_compensation_operations from public, anon, authenticated;
grant all on table public.unofficial_compensation_operations to service_role;

alter table public.dispute_beta_actions
  add column if not exists linked_agreed_compensation_id text null,
  add column if not exists linked_compensation_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists linked_compensation_by uuid null references public.user_profiles(id) on delete set null,
  add column if not exists linked_compensation_by_email text null,
  add column if not exists linked_compensation_at timestamptz null;

alter table public.dispute_beta_actions
  drop constraint if exists dispute_beta_actions_linked_agreed_compensation_id_check,
  drop constraint if exists dispute_beta_actions_linked_compensation_snapshot_check;

alter table public.dispute_beta_actions
  add constraint dispute_beta_actions_linked_agreed_compensation_id_check
    check (linked_agreed_compensation_id is null or linked_agreed_compensation_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  add constraint dispute_beta_actions_linked_compensation_snapshot_check
    check (jsonb_typeof(linked_compensation_snapshot) = 'object');

create index dispute_beta_actions_compensation_link_idx
on public.dispute_beta_actions(linked_agreed_compensation_id)
where linked_agreed_compensation_id is not null;

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
    'compensation_claim_linked'
  ));
