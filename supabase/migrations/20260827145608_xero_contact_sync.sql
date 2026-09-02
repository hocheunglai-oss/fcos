create extension if not exists pgcrypto;

create table if not exists public.xero_contact_sync_connections (
  id text primary key default 'primary' check (id = 'primary'),
  tenant_id text,
  tenant_name text,
  access_token text,
  refresh_token text not null,
  scope text,
  expires_at timestamptz,
  token_version integer not null default 1 check (token_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.xero_contact_name_cache (
  id text primary key default 'primary' check (id = 'primary'),
  tenant_id text,
  tenant_name text,
  contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(contacts) = 'array'),
  contact_count integer not null default 0 check (contact_count >= 0),
  refreshed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.xero_contact_sync_events (
  event_id text primary key,
  org_id text not null,
  run_id uuid,
  status text not null check (status in ('processing', 'processed', 'failed')),
  received_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  error_message text
);

create table if not exists public.xero_contact_sync_runs (
  id uuid primary key,
  event_id text not null unique references public.xero_contact_sync_events(event_id),
  org_id text not null,
  received_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  salesforce jsonb not null default '{}'::jsonb check (jsonb_typeof(salesforce) = 'object'),
  xero jsonb not null default '{}'::jsonb check (jsonb_typeof(xero) = 'object'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  row_count integer not null default 0 check (row_count >= 0)
);

create table if not exists public.xero_contact_sync_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.xero_contact_sync_runs(id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  status text not null check (status in ('pending', 'created', 'already-exists', 'skipped', 'failed')),
  reason text,
  salesforce_account_id text,
  salesforce_record_type text,
  salesforce_cl_key text,
  salesforce_name text,
  source_records jsonb not null default '[]'::jsonb check (jsonb_typeof(source_records) = 'array'),
  xero_contact_id text,
  xero_contact_name text,
  xero_contact_number text,
  xero_account_number text,
  xero_contact_status text,
  match_field text,
  idempotency_key text,
  applied_at timestamptz,
  message text,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
  raw_row jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_row) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (run_id, row_index)
);

create index if not exists xero_contact_sync_runs_received_idx
  on public.xero_contact_sync_runs (received_at desc);

create index if not exists xero_contact_sync_rows_run_status_idx
  on public.xero_contact_sync_rows (run_id, status);

alter table public.xero_contact_sync_connections enable row level security;
alter table public.xero_contact_name_cache enable row level security;
alter table public.xero_contact_sync_events enable row level security;
alter table public.xero_contact_sync_runs enable row level security;
alter table public.xero_contact_sync_rows enable row level security;

alter table public.xero_contact_sync_connections force row level security;
alter table public.xero_contact_name_cache force row level security;
alter table public.xero_contact_sync_events force row level security;
alter table public.xero_contact_sync_runs force row level security;
alter table public.xero_contact_sync_rows force row level security;

revoke all on table public.xero_contact_sync_connections from public, anon, authenticated;
revoke all on table public.xero_contact_name_cache from public, anon, authenticated;
revoke all on table public.xero_contact_sync_events from public, anon, authenticated;
revoke all on table public.xero_contact_sync_runs from public, anon, authenticated;
revoke all on table public.xero_contact_sync_rows from public, anon, authenticated;

grant select, insert, update, delete on table public.xero_contact_sync_connections to service_role;
grant select, insert, update, delete on table public.xero_contact_name_cache to service_role;
grant select, insert, update, delete on table public.xero_contact_sync_events to service_role;
grant select, insert, update, delete on table public.xero_contact_sync_runs to service_role;
grant select, insert, update, delete on table public.xero_contact_sync_rows to service_role;

comment on table public.xero_contact_sync_connections is
  'Service-only Xero OAuth state for the Salesforce-triggered contact auto-create integration. Never expose this table to browser roles.';
comment on table public.xero_contact_name_cache is
  'Service-only cached Xero contact names used to avoid one full Xero Contacts scan on every Salesforce trigger event.';
comment on table public.xero_contact_sync_events is
  'Service-only idempotency ledger for signed Salesforce contact-sync webhook events.';
comment on table public.xero_contact_sync_runs is
  'Service-only audit header for Salesforce-triggered Xero contact auto-create runs.';
comment on table public.xero_contact_sync_rows is
  'Service-only row-level audit for Salesforce-triggered Xero contact auto-create decisions and results.';
