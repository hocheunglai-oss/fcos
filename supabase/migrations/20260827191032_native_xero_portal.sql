begin;

insert into public.app_modules (id, label, path, sort_order)
values
  ('xero_portal', 'Xero Portal', '/xero-portal', 89),
  ('xero_portal_manage', 'Manage Xero Portal', '/xero-portal', 192)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'xero_portal', id in ('general_manager', 'administrator', 'finance')
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'xero_portal_manage', id in ('general_manager', 'administrator', 'finance')
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select id, 'xero_portal', user_type in ('general_manager', 'administrator', 'finance')
from public.user_profiles
where use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select id, 'xero_portal_manage', user_type in ('general_manager', 'administrator', 'finance')
from public.user_profiles
where use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

create table if not exists public.xero_portal_receipts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid null references public.user_profiles(id) on delete set null,
  created_by_email text,
  merchant text not null default 'Unknown supplier',
  receipt_date date not null default current_date,
  total numeric(18, 2),
  currency text not null default 'HKD',
  category text not null default 'General expense',
  account_code text not null default '429',
  tax_type text not null default 'NONE',
  note text not null default '',
  ocr_text text not null default '',
  file_name text not null,
  file_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  storage_bucket text not null default 'xero-portal-receipts',
  storage_path text not null,
  status text not null default 'draft' check (status in ('draft', 'syncing', 'synced', 'failed')),
  auto_synced boolean not null default false,
  xero_invoice_id text,
  xero_invoice_url text,
  error_message text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.xero_contact_usage_cache (
  source text primary key,
  label text not null,
  status text not null check (status in ('missing', 'complete', 'blocked', 'failed')),
  records_scanned integer not null default 0 check (records_scanned >= 0),
  records_with_contact integer not null default 0 check (records_with_contact >= 0),
  xero_calls integer not null default 0 check (xero_calls >= 0),
  contact_usage jsonb not null default '[]'::jsonb check (jsonb_typeof(contact_usage) = 'array'),
  error_message text,
  scanned_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.xero_contact_lifecycle_locks (
  id text primary key default 'primary' check (id = 'primary'),
  run_id uuid,
  locked_by text,
  locked_at timestamptz,
  locked_until timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.xero_contact_lifecycle_runs (
  id uuid primary key,
  state text not null check (state in ('previewed', 'applied', 'failed')),
  created_by uuid null references public.user_profiles(id) on delete set null,
  created_by_email text,
  salesforce jsonb not null default '{}'::jsonb check (jsonb_typeof(salesforce) = 'object'),
  xero jsonb not null default '{}'::jsonb check (jsonb_typeof(xero) = 'object'),
  usage_cache jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_cache) = 'object'),
  xero_call_estimate jsonb not null default '{}'::jsonb check (jsonb_typeof(xero_call_estimate) = 'object'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  row_count integer not null default 0 check (row_count >= 0),
  error_message text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz
);

create table if not exists public.xero_contact_lifecycle_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.xero_contact_lifecycle_runs(id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  row_id text not null,
  action text not null check (action in ('keep', 'rename', 'archive', 'exception')),
  status text not null check (status in ('eligible', 'blocked', 'kept', 'not-selected', 'updated', 'archived', 'failed')),
  reason text,
  selected boolean not null default false,
  salesforce_account_id text,
  salesforce_record_type text,
  salesforce_cl_key text,
  salesforce_name text,
  proposed_name text,
  xero_contact_id text,
  xero_contact_name text,
  xero_contact_number text,
  xero_account_number text,
  xero_contact_status text,
  match_field text,
  usage_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(usage_evidence) = 'array'),
  idempotency_key text,
  applied_at timestamptz,
  message text,
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
  raw_row jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_row) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (run_id, row_index),
  unique (run_id, row_id)
);

create index if not exists xero_portal_receipts_created_idx
  on public.xero_portal_receipts (created_at desc);
create index if not exists xero_portal_receipts_status_idx
  on public.xero_portal_receipts (status, created_at desc);
create index if not exists xero_contact_lifecycle_runs_created_idx
  on public.xero_contact_lifecycle_runs (created_at desc);
create index if not exists xero_contact_lifecycle_rows_run_status_idx
  on public.xero_contact_lifecycle_rows (run_id, status);
create index if not exists xero_contact_lifecycle_rows_run_action_idx
  on public.xero_contact_lifecycle_rows (run_id, action);
create index if not exists xero_contact_lifecycle_rows_xero_contact_idx
  on public.xero_contact_lifecycle_rows (xero_contact_id);

alter table public.xero_portal_receipts enable row level security;
alter table public.xero_contact_usage_cache enable row level security;
alter table public.xero_contact_lifecycle_locks enable row level security;
alter table public.xero_contact_lifecycle_runs enable row level security;
alter table public.xero_contact_lifecycle_rows enable row level security;

alter table public.xero_portal_receipts force row level security;
alter table public.xero_contact_usage_cache force row level security;
alter table public.xero_contact_lifecycle_locks force row level security;
alter table public.xero_contact_lifecycle_runs force row level security;
alter table public.xero_contact_lifecycle_rows force row level security;

revoke all on table public.xero_portal_receipts from public, anon, authenticated;
revoke all on table public.xero_contact_usage_cache from public, anon, authenticated;
revoke all on table public.xero_contact_lifecycle_locks from public, anon, authenticated;
revoke all on table public.xero_contact_lifecycle_runs from public, anon, authenticated;
revoke all on table public.xero_contact_lifecycle_rows from public, anon, authenticated;

grant select, insert, update, delete on table public.xero_portal_receipts to service_role;
grant select, insert, update, delete on table public.xero_contact_usage_cache to service_role;
grant select, insert, update, delete on table public.xero_contact_lifecycle_locks to service_role;
grant select, insert, update, delete on table public.xero_contact_lifecycle_runs to service_role;
grant select, insert, update, delete on table public.xero_contact_lifecycle_rows to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'xero-portal-receipts',
  'xero-portal-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.xero_portal_receipts is
  'Service-only receipt OCR and Xero draft-bill audit records for the FCOS native Xero Portal.';
comment on table public.xero_contact_usage_cache is
  'Service-only cached Xero accounting usage by contact, used to avoid repeated full-history scans.';
comment on table public.xero_contact_lifecycle_locks is
  'Service-only single-run lock for Xero contact lifecycle preview and apply jobs.';
comment on table public.xero_contact_lifecycle_runs is
  'Service-only contact cleanup and Salesforce name-sync preview/apply audit headers.';
comment on table public.xero_contact_lifecycle_rows is
  'Service-only row-level contact cleanup and Salesforce name-sync audit details.';

commit;
