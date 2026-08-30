-- Service-only Salesforce-to-Xero accounting cutover ledger.
-- Salesforce remains authoritative; this schema stores reconciliation identity,
-- review state, checkpoints, and redacted audit evidence only.

create extension if not exists pgcrypto;

create table if not exists public.xero_financial_product_mappings (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('buyer', 'supplier')),
  salesforce_product_id text not null,
  salesforce_product_name text not null,
  xero_account_code text not null,
  xero_account_name text not null default '',
  xero_tax_type text not null default 'NONE',
  enabled boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  approved_by uuid,
  approved_by_email text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (direction, salesforce_product_id)
);

create table if not exists public.xero_financial_document_mappings (
  id uuid primary key default gen_random_uuid(),
  salesforce_object text not null check (salesforce_object in ('Invoice__c', 'Supplier_Invoice__c')),
  salesforce_id text not null,
  salesforce_document_number text not null,
  document_kind text not null check (document_kind in ('buyer_invoice', 'buyer_credit', 'supplier_bill', 'supplier_credit')),
  xero_document_type text not null check (xero_document_type in ('ACCREC', 'ACCPAY', 'ACCRECCREDIT', 'ACCPAYCREDIT')),
  xero_document_id text not null,
  xero_document_number text,
  xero_contact_id text,
  xero_status text,
  source_fingerprint text not null,
  financial_fingerprint text not null,
  protected_legacy boolean not null default false,
  retained_differences jsonb not null default '[]'::jsonb,
  last_reconciled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salesforce_object, salesforce_id),
  unique (xero_document_type, xero_document_id)
);

create table if not exists public.xero_financial_bank_mappings (
  id uuid primary key default gen_random_uuid(),
  salesforce_bank_name text not null unique,
  xero_bank_account_id text not null,
  xero_bank_account_code text,
  xero_bank_account_name text not null,
  enabled boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  approved_by uuid,
  approved_by_email text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.xero_financial_sync_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  mode text not null check (mode in ('preview', 'document_apply', 'payment_apply')),
  status text not null check (status in ('building', 'ready_for_review', 'authorised', 'processing', 'completed', 'partial', 'failed', 'cancelled')),
  cutoff_date date not null default date '2026-01-01',
  source_snapshot_at timestamptz,
  xero_snapshot_at timestamptz,
  source_fingerprint text,
  xero_fingerprint text,
  control_totals jsonb not null default '{}'::jsonb,
  classification_summary jsonb not null default '{}'::jsonb,
  rate_limit_snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  revision integer not null default 1 check (revision > 0),
  created_by uuid,
  created_by_email text,
  reviewed_by uuid,
  reviewed_by_email text,
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.xero_financial_sync_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.xero_financial_sync_runs(id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  row_key text not null,
  source_object text not null,
  source_id text not null,
  source_type text not null,
  source_document_number text,
  currency text not null,
  source_total numeric(20, 6),
  proposed_action text not null check (proposed_action in ('link', 'safe_update', 'create_draft', 'protected_legacy', 'blocked', 'payment_link', 'payment_apply')),
  status text not null check (status in ('eligible', 'blocked', 'selected', 'linked', 'updated', 'created', 'protected', 'applied', 'failed', 'skipped')),
  selected boolean not null default false,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  xero_payload jsonb not null default '{}'::jsonb,
  proposed_payload jsonb not null default '{}'::jsonb,
  differences jsonb not null default '[]'::jsonb,
  xero_document_id text,
  xero_document_status text,
  idempotency_key text not null,
  mutation_attempts integer not null default 0 check (mutation_attempts >= 0),
  error_code text,
  error_message text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, row_key),
  unique (run_id, row_index),
  unique (idempotency_key)
);

create table if not exists public.xero_financial_payment_mappings (
  id uuid primary key default gen_random_uuid(),
  salesforce_payment_id text not null unique,
  salesforce_payment_name text,
  document_mapping_id uuid not null references public.xero_financial_document_mappings(id),
  xero_payment_id text not null,
  xero_bank_account_id text,
  source_fingerprint text not null,
  amount numeric(20, 6) not null,
  currency text not null,
  payment_date date not null,
  status text not null check (status in ('linked', 'applied', 'protected', 'exception')),
  exception_reason text,
  last_reconciled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (xero_payment_id)
);

create table if not exists public.xero_financial_audit_events (
  id bigint generated always as identity primary key,
  run_id uuid references public.xero_financial_sync_runs(id) on delete set null,
  event_type text not null,
  outcome text not null,
  actor_id uuid,
  actor_email text,
  record_counts jsonb not null default '{}'::jsonb,
  fingerprints jsonb not null default '{}'::jsonb,
  rate_limit_snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists xero_financial_document_mappings_sf_idx
  on public.xero_financial_document_mappings (salesforce_object, salesforce_id);
create index if not exists xero_financial_sync_runs_created_idx
  on public.xero_financial_sync_runs (created_at desc);
create index if not exists xero_financial_sync_items_run_status_idx
  on public.xero_financial_sync_items (run_id, status, row_index);
create index if not exists xero_financial_payment_mappings_document_idx
  on public.xero_financial_payment_mappings (document_mapping_id);
create index if not exists xero_financial_audit_events_run_idx
  on public.xero_financial_audit_events (run_id, created_at desc);

alter table public.xero_financial_product_mappings enable row level security;
alter table public.xero_financial_document_mappings enable row level security;
alter table public.xero_financial_bank_mappings enable row level security;
alter table public.xero_financial_sync_runs enable row level security;
alter table public.xero_financial_sync_items enable row level security;
alter table public.xero_financial_payment_mappings enable row level security;
alter table public.xero_financial_audit_events enable row level security;

alter table public.xero_financial_product_mappings force row level security;
alter table public.xero_financial_document_mappings force row level security;
alter table public.xero_financial_bank_mappings force row level security;
alter table public.xero_financial_sync_runs force row level security;
alter table public.xero_financial_sync_items force row level security;
alter table public.xero_financial_payment_mappings force row level security;
alter table public.xero_financial_audit_events force row level security;

revoke all on table public.xero_financial_product_mappings from public, anon, authenticated;
revoke all on table public.xero_financial_document_mappings from public, anon, authenticated;
revoke all on table public.xero_financial_bank_mappings from public, anon, authenticated;
revoke all on table public.xero_financial_sync_runs from public, anon, authenticated;
revoke all on table public.xero_financial_sync_items from public, anon, authenticated;
revoke all on table public.xero_financial_payment_mappings from public, anon, authenticated;
revoke all on table public.xero_financial_audit_events from public, anon, authenticated;
revoke all on sequence public.xero_financial_audit_events_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.xero_financial_product_mappings to service_role;
grant select, insert, update, delete on table public.xero_financial_document_mappings to service_role;
grant select, insert, update, delete on table public.xero_financial_bank_mappings to service_role;
grant select, insert, update, delete on table public.xero_financial_sync_runs to service_role;
grant select, insert, update, delete on table public.xero_financial_sync_items to service_role;
grant select, insert, update, delete on table public.xero_financial_payment_mappings to service_role;
grant select, insert on table public.xero_financial_audit_events to service_role;
grant usage, select on sequence public.xero_financial_audit_events_id_seq to service_role;

create or replace function public.save_xero_financial_product_mapping_v1(
  p_mapping_id uuid,
  p_direction text,
  p_salesforce_product_id text,
  p_salesforce_product_name text,
  p_xero_account_code text,
  p_xero_account_name text,
  p_xero_tax_type text,
  p_enabled boolean,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.xero_financial_product_mappings
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.xero_financial_product_mappings;
begin
  if p_direction not in ('buyer', 'supplier') then
    raise exception 'Invalid Xero mapping direction' using errcode = '22023';
  end if;
  if nullif(btrim(p_salesforce_product_id), '') is null
     or nullif(btrim(p_salesforce_product_name), '') is null
     or nullif(btrim(p_xero_account_code), '') is null
     or nullif(btrim(p_xero_tax_type), '') is null then
    raise exception 'Product, Xero account, and tax type are required' using errcode = '22023';
  end if;

  if p_mapping_id is null then
    insert into public.xero_financial_product_mappings (
      direction, salesforce_product_id, salesforce_product_name,
      xero_account_code, xero_account_name, xero_tax_type, enabled,
      approved_by, approved_by_email, approved_at
    ) values (
      p_direction, btrim(p_salesforce_product_id), btrim(p_salesforce_product_name),
      btrim(p_xero_account_code), coalesce(btrim(p_xero_account_name), ''), btrim(p_xero_tax_type), coalesce(p_enabled, true),
      p_actor_id, lower(nullif(btrim(p_actor_email), '')), now()
    )
    on conflict (direction, salesforce_product_id) do update set
      salesforce_product_name = excluded.salesforce_product_name,
      xero_account_code = excluded.xero_account_code,
      xero_account_name = excluded.xero_account_name,
      xero_tax_type = excluded.xero_tax_type,
      enabled = excluded.enabled,
      approved_by = excluded.approved_by,
      approved_by_email = excluded.approved_by_email,
      approved_at = now(),
      revision = public.xero_financial_product_mappings.revision + 1,
      updated_at = now()
    where p_expected_revision is not null
      and public.xero_financial_product_mappings.revision = p_expected_revision
    returning * into v_row;
  else
    update public.xero_financial_product_mappings set
      direction = p_direction,
      salesforce_product_id = btrim(p_salesforce_product_id),
      salesforce_product_name = btrim(p_salesforce_product_name),
      xero_account_code = btrim(p_xero_account_code),
      xero_account_name = coalesce(btrim(p_xero_account_name), ''),
      xero_tax_type = btrim(p_xero_tax_type),
      enabled = coalesce(p_enabled, true),
      approved_by = p_actor_id,
      approved_by_email = lower(nullif(btrim(p_actor_email), '')),
      approved_at = now(),
      revision = revision + 1,
      updated_at = now()
    where id = p_mapping_id and revision = p_expected_revision
    returning * into v_row;
  end if;

  if v_row.id is null then
    raise exception 'Xero product mapping changed after it was loaded' using errcode = '40001';
  end if;
  return v_row;
end;
$$;

create or replace function public.save_xero_financial_bank_mapping_v1(
  p_mapping_id uuid,
  p_salesforce_bank_name text,
  p_xero_bank_account_id text,
  p_xero_bank_account_code text,
  p_xero_bank_account_name text,
  p_enabled boolean,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.xero_financial_bank_mappings
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.xero_financial_bank_mappings;
begin
  if nullif(btrim(p_salesforce_bank_name), '') is null
     or nullif(btrim(p_xero_bank_account_id), '') is null
     or nullif(btrim(p_xero_bank_account_name), '') is null then
    raise exception 'Salesforce bank and Xero bank account are required' using errcode = '22023';
  end if;
  if p_mapping_id is null then
    insert into public.xero_financial_bank_mappings (
      salesforce_bank_name, xero_bank_account_id, xero_bank_account_code,
      xero_bank_account_name, enabled, approved_by, approved_by_email, approved_at
    ) values (
      btrim(p_salesforce_bank_name), btrim(p_xero_bank_account_id), nullif(btrim(p_xero_bank_account_code), ''),
      btrim(p_xero_bank_account_name), coalesce(p_enabled, true), p_actor_id,
      lower(nullif(btrim(p_actor_email), '')), now()
    )
    on conflict (salesforce_bank_name) do update set
      xero_bank_account_id = excluded.xero_bank_account_id,
      xero_bank_account_code = excluded.xero_bank_account_code,
      xero_bank_account_name = excluded.xero_bank_account_name,
      enabled = excluded.enabled,
      approved_by = excluded.approved_by,
      approved_by_email = excluded.approved_by_email,
      approved_at = now(),
      revision = public.xero_financial_bank_mappings.revision + 1,
      updated_at = now()
    where p_expected_revision is not null
      and public.xero_financial_bank_mappings.revision = p_expected_revision
    returning * into v_row;
  else
    update public.xero_financial_bank_mappings set
      salesforce_bank_name = btrim(p_salesforce_bank_name),
      xero_bank_account_id = btrim(p_xero_bank_account_id),
      xero_bank_account_code = nullif(btrim(p_xero_bank_account_code), ''),
      xero_bank_account_name = btrim(p_xero_bank_account_name),
      enabled = coalesce(p_enabled, true),
      approved_by = p_actor_id,
      approved_by_email = lower(nullif(btrim(p_actor_email), '')),
      approved_at = now(),
      revision = revision + 1,
      updated_at = now()
    where id = p_mapping_id and revision = p_expected_revision
    returning * into v_row;
  end if;
  if v_row.id is null then
    raise exception 'Xero bank mapping changed after it was loaded' using errcode = '40001';
  end if;
  return v_row;
end;
$$;

create or replace function public.authorise_xero_financial_sync_run_v1(
  p_run_id uuid,
  p_expected_revision integer,
  p_selected_item_ids uuid[],
  p_actor_id uuid,
  p_actor_email text
)
returns public.xero_financial_sync_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.xero_financial_sync_runs;
begin
  if coalesce(array_length(p_selected_item_ids, 1), 0) = 0 then
    raise exception 'At least one eligible row must be selected' using errcode = '22023';
  end if;

  update public.xero_financial_sync_runs set
    status = 'authorised',
    reviewed_by = p_actor_id,
    reviewed_by_email = lower(nullif(btrim(p_actor_email), '')),
    reviewed_at = now(),
    revision = revision + 1,
    updated_at = now()
  where id = p_run_id
    and revision = p_expected_revision
    and status = 'ready_for_review'
  returning * into v_run;

  if v_run.id is null then
    raise exception 'Xero sync preview changed after it was loaded' using errcode = '40001';
  end if;

  if exists (
    select 1 from unnest(p_selected_item_ids) selected_id
    left join public.xero_financial_sync_items item
      on item.id = selected_id and item.run_id = p_run_id
    where item.id is null or item.status <> 'eligible'
  ) then
    raise exception 'Selection contains a missing or ineligible row' using errcode = '22023';
  end if;

  update public.xero_financial_sync_items
  set selected = id = any(p_selected_item_ids),
      status = case when id = any(p_selected_item_ids) then 'selected' else status end,
      updated_at = now()
  where run_id = p_run_id and status = 'eligible';

  insert into public.xero_financial_audit_events (
    run_id, event_type, outcome, actor_id, actor_email, record_counts
  ) values (
    p_run_id, 'run_authorised', 'success', p_actor_id,
    lower(nullif(btrim(p_actor_email), '')),
    jsonb_build_object('selected', array_length(p_selected_item_ids, 1))
  );

  return v_run;
end;
$$;

create or replace function public.start_xero_financial_sync_run_v1(
  p_run_id uuid,
  p_expected_revision integer
)
returns public.xero_financial_sync_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.xero_financial_sync_runs;
begin
  update public.xero_financial_sync_runs set
    status = 'processing',
    revision = revision + 1,
    updated_at = now()
  where id = p_run_id
    and revision = p_expected_revision
    and status in ('authorised', 'partial', 'failed')
  returning * into v_run;
  if v_run.id is null then
    raise exception 'Xero sync run is not authorised, resumable, or changed after review' using errcode = '40001';
  end if;
  return v_run;
end;
$$;

create or replace function public.finish_xero_financial_sync_run_v1(
  p_run_id uuid,
  p_status text,
  p_expected_revision integer,
  p_classification_summary jsonb,
  p_rate_limit_snapshot jsonb,
  p_error_code text,
  p_error_message text
)
returns public.xero_financial_sync_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.xero_financial_sync_runs;
begin
  if p_status not in ('completed', 'partial', 'failed') then
    raise exception 'Invalid terminal Xero sync status' using errcode = '22023';
  end if;
  update public.xero_financial_sync_runs set
    status = p_status,
    classification_summary = coalesce(p_classification_summary, classification_summary),
    rate_limit_snapshot = coalesce(p_rate_limit_snapshot, rate_limit_snapshot),
    error_code = nullif(btrim(p_error_code), ''),
    error_message = nullif(btrim(p_error_message), ''),
    completed_at = now(),
    revision = revision + 1,
    updated_at = now()
  where id = p_run_id
    and revision = p_expected_revision
    and status = 'processing'
  returning * into v_run;
  if v_run.id is null then
    raise exception 'Xero sync run changed while processing' using errcode = '40001';
  end if;
  return v_run;
end;
$$;

revoke all on function public.save_xero_financial_product_mapping_v1(uuid,text,text,text,text,text,text,boolean,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.save_xero_financial_bank_mapping_v1(uuid,text,text,text,text,boolean,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.authorise_xero_financial_sync_run_v1(uuid,integer,uuid[],uuid,text) from public, anon, authenticated;
revoke all on function public.start_xero_financial_sync_run_v1(uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_xero_financial_sync_run_v1(uuid,text,integer,jsonb,jsonb,text,text) from public, anon, authenticated;

grant execute on function public.save_xero_financial_product_mapping_v1(uuid,text,text,text,text,text,text,boolean,integer,uuid,text) to service_role;
grant execute on function public.save_xero_financial_bank_mapping_v1(uuid,text,text,text,text,boolean,integer,uuid,text) to service_role;
grant execute on function public.authorise_xero_financial_sync_run_v1(uuid,integer,uuid[],uuid,text) to service_role;
grant execute on function public.start_xero_financial_sync_run_v1(uuid,integer) to service_role;
grant execute on function public.finish_xero_financial_sync_run_v1(uuid,text,integer,jsonb,jsonb,text,text) to service_role;

comment on table public.xero_financial_document_mappings is
  'Service-only durable Salesforce-to-Xero accounting document identity and retained-difference ledger.';
comment on table public.xero_financial_sync_runs is
  'Service-only reviewed, resumable manual Xero accounting sync runs; no scheduler posts financial data.';
comment on table public.xero_financial_sync_items is
  'Service-only immutable preview evidence plus mutation checkpoint state for one Xero accounting sync run.';
comment on table public.xero_financial_payment_mappings is
  'Service-only exact Salesforce payment to Xero payment allocation identity.';
