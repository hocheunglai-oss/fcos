-- Governed master term contracts. FCOS owns legal/commercial revisions and
-- Salesforce owns the generated operational and financial records.

begin;

insert into public.app_modules (id, label, path, sort_order)
values ('master_contracts', 'Master Contracts', '/master-contracts', 84)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = clock_timestamp();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select user_type.id, 'master_contracts', user_type.id in ('manager', 'administrator', 'general_manager')
from public.user_types user_type
on conflict (user_type_id, module_id) do nothing;

create table public.master_contract_settings (
  id text primary key default 'company' check (id = 'company'),
  feature_enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

insert into public.master_contract_settings (id, feature_enabled)
values ('company', false)
on conflict (id) do nothing;

create table public.master_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_key text not null unique check (contract_key ~ '^[A-Z0-9][A-Z0-9_-]{5,79}$'),
  title text not null check (btrim(title) <> '' and char_length(title) <= 300),
  status text not null default 'draft' check (status in (
    'draft', 'pending_supplier_approval', 'pending_owner_approval', 'approved',
    'active', 'completed', 'cancelled'
  )),
  buyer_account_id text null check (buyer_account_id is null or buyer_account_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  buyer_account_name text not null default '' check (char_length(buyer_account_name) <= 300),
  buyer_cl_key text not null default '' check (char_length(buyer_cl_key) <= 160),
  supplier_account_id text null check (supplier_account_id is null or supplier_account_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  supplier_account_name text not null default '' check (char_length(supplier_account_name) <= 300),
  supplier_cl_key text not null default '' check (char_length(supplier_cl_key) <= 160),
  supplier_identity_confirmed boolean not null default false,
  buyer_pic text not null default '' check (char_length(buyer_pic) <= 300),
  buyer_contact_id text null check (buyer_contact_id is null or buyer_contact_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  owner_user_id uuid null references public.user_profiles(id) on delete restrict,
  don_min_days integer null check (don_min_days is null or don_min_days between 0 and 365),
  don_max_days integer null check (don_max_days is null or don_max_days between 0 and 365),
  variable_charges_mode text null check (variable_charges_mode is null or variable_charges_mode in ('contract', 'per_delivery')),
  current_revision bigint not null default 1 check (current_revision > 0),
  approved_revision bigint null check (approved_revision is null or approved_revision > 0),
  current_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(current_snapshot) = 'object'),
  created_by uuid null references public.user_profiles(id) on delete set null,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (don_min_days is null or don_max_days is null or don_min_days <= don_max_days)
);

create table public.master_contract_product_terms (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  product_key text not null check (product_key ~ '^[a-z0-9_]{2,40}$'),
  salesforce_product_id text null check (salesforce_product_id is null or salesforce_product_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  product_name text not null default '' check (char_length(product_name) <= 300),
  benchmark_code text not null check (benchmark_code ~ '^[A-Z0-9.%-]{2,40}$'),
  benchmark_unit text not null check (benchmark_unit in ('USD/MT', 'USD/bbl')),
  conversion_factor numeric(18,8) not null default 1 check (conversion_factor > 0),
  buy_premium numeric(18,6) not null,
  sell_premium numeric(18,6) not null,
  contracted_min_qty numeric(18,6) not null check (contracted_min_qty >= 0),
  contracted_max_qty numeric(18,6) not null check (contracted_max_qty >= contracted_min_qty),
  uom text not null default 'MT' check (btrim(uom) <> '' and char_length(uom) <= 40),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, product_key)
);

create table public.master_contract_deliveries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  delivery_key text not null unique check (delivery_key ~ '^[A-Z0-9][A-Z0-9_-]{5,119}$'),
  sequence integer not null check (sequence > 0),
  vessel_name text not null check (btrim(vessel_name) <> '' and char_length(vessel_name) <= 300),
  vessel_imo text not null default '' check (char_length(vessel_imo) <= 40),
  vessel_id text null check (vessel_id is null or vessel_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  port_id text null check (port_id is null or port_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  port_name text not null default '' check (char_length(port_name) <= 300),
  preliminary_eta date not null,
  supply_location text not null default 'TBD' check (supply_location in ('Berth', 'Anchorage', 'TBD')),
  buyer_payment_term text not null default '' check (char_length(buyer_payment_term) <= 160),
  supplier_payment_term text not null default '' check (char_length(supplier_payment_term) <= 160),
  variable_charge_supplier_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(variable_charge_supplier_ids) = 'array'),
  don_date date null,
  don_alternate_reason text not null default '' check (char_length(don_alternate_reason) <= 2000),
  status text not null default 'planned' check (status in ('planned', 'created', 'delivered', 'cancelled')),
  active boolean not null default true,
  last_live_refresh_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, sequence)
);

create table public.master_contract_delivery_products (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.master_contract_deliveries(id) on delete restrict,
  product_term_id uuid not null references public.master_contract_product_terms(id) on delete restrict,
  contract_line_key text not null unique check (contract_line_key ~ '^[A-Z0-9][A-Z0-9_-]{5,159}$'),
  quantity_min numeric(18,6) not null check (quantity_min >= 0),
  quantity_max numeric(18,6) not null check (quantity_max >= quantity_min),
  price_status text not null default 'unresolved' check (price_status in ('unresolved', 'review_required', 'reviewed', 'applied', 'conflict')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id, product_term_id)
);

create table public.master_contract_charge_rules (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  charge_key text not null check (charge_key ~ '^[a-z0-9_]{2,60}$'),
  salesforce_product_id text null check (salesforce_product_id is null or salesforce_product_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  supplier_account_id text null check (supplier_account_id is null or supplier_account_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  supplier_name text not null default '' check (char_length(supplier_name) <= 300),
  charge_name text not null check (btrim(charge_name) <> '' and char_length(charge_name) <= 300),
  applies_when text not null check (applies_when in ('every_delivery', 'berth', 'anchorage')),
  fixed_cost numeric(18,2) not null check (fixed_cost >= 0),
  fixed_sell numeric(18,2) not null check (fixed_sell >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  unique (contract_id, charge_key)
);

create table public.master_contract_revisions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  revision bigint not null check (revision > 0),
  revision_kind text not null check (revision_kind in ('draft', 'submitted', 'supplier_approved', 'owner_approved', 'ratified', 'gm_override')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  supplier_approved_at timestamptz null,
  supplier_evidence_id uuid null,
  owner_approved_at timestamptz null,
  reason_recorded boolean not null default false,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now(),
  unique (contract_id, revision)
);

create table public.master_contract_supplier_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  revision bigint not null check (revision > 0),
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  evidence_kind text not null check (evidence_kind in ('file', 'reference_note')),
  storage_path text null check (storage_path is null or char_length(storage_path) <= 800),
  content_hash text null check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  reference_label text not null default '' check (char_length(reference_label) <= 500),
  recorded_by uuid null references public.user_profiles(id) on delete set null,
  recorded_at timestamptz not null default now()
);

alter table public.master_contract_revisions
  add constraint master_contract_revisions_supplier_evidence_fk
  foreign key (supplier_evidence_id) references public.master_contract_supplier_evidence(id) on delete restrict;

create table public.master_contract_price_resolutions (
  id uuid primary key default gen_random_uuid(),
  delivery_product_id uuid not null references public.master_contract_delivery_products(id) on delete restrict,
  resolution_revision bigint not null check (resolution_revision > 0),
  benchmark_date date not null,
  benchmark_code text not null check (benchmark_code ~ '^[A-Z0-9.%-]{2,40}$'),
  benchmark_unit text not null check (benchmark_unit in ('USD/MT', 'USD/bbl')),
  benchmark_value numeric(24,10) not null,
  conversion_factor numeric(18,8) not null check (conversion_factor > 0),
  buy_unrounded numeric(24,10) not null,
  sell_unrounded numeric(24,10) not null,
  buy_rounded numeric(18,2) not null,
  sell_rounded numeric(18,2) not null,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  official_observation_id uuid null,
  alternate_publication_reason text not null default '' check (char_length(alternate_publication_reason) <= 2000),
  status text not null check (status in ('review_required', 'reviewed', 'applied', 'superseded', 'conflict')),
  reviewed_by uuid null references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz null,
  applied_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (delivery_product_id, resolution_revision)
);

create table public.master_contract_salesforce_links (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  delivery_id uuid null references public.master_contract_deliveries(id) on delete restrict,
  entity_type text not null check (entity_type in ('opportunity', 'stem', 'line_item', 'charge', 'nomination', 'buyer_confirmation')),
  external_key text not null check (btrim(external_key) <> '' and char_length(external_key) <= 160),
  salesforce_id text not null check (salesforce_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  salesforce_last_modified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, external_key),
  unique (entity_type, salesforce_id)
);

create table public.master_contract_variances (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  delivery_id uuid null references public.master_contract_deliveries(id) on delete restrict,
  variance_key text not null check (btrim(variance_key) <> '' and char_length(variance_key) <= 240),
  field_path text not null check (btrim(field_path) <> '' and char_length(field_path) <= 300),
  approved_value jsonb null,
  live_value jsonb null,
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'open' check (status in ('open', 'ratified', 'reverted', 'superseded', 'blocked_financial_consequence')),
  consequential_financial_record boolean not null default false,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz null,
  unique (contract_id, variance_key, source_fingerprint)
);

create table public.master_contract_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.master_contracts(id) on delete restrict,
  job_type text not null check (job_type in ('create_batch', 'apply_prices', 'revert_variance', 'hourly_reconcile')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'salesforce_committed', 'succeeded', 'failed', 'uncertain')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  redacted_result jsonb not null default '{}'::jsonb check (jsonb_typeof(redacted_result) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.master_contract_operations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid null references public.master_contracts(id) on delete restrict,
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  operation text not null check (operation in ('save', 'record_evidence', 'submit', 'approve_supplier', 'approve_owner', 'reject', 'ratify', 'gm_override', 'resolve_price', 'apply_price', 'revert', 'enable_feature', 'import_draft')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result_revision bigint null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index master_contracts_status_updated_idx on public.master_contracts(status, updated_at desc);
create index master_contracts_owner_status_idx on public.master_contracts(owner_user_id, status, updated_at desc);
create index master_contract_settings_updated_by_idx on public.master_contract_settings(updated_by);
create index master_contracts_created_by_idx on public.master_contracts(created_by);
create index master_contracts_updated_by_idx on public.master_contracts(updated_by);
create index master_contract_deliveries_contract_eta_idx on public.master_contract_deliveries(contract_id, preliminary_eta, sequence);
create index master_contract_delivery_products_delivery_idx on public.master_contract_delivery_products(delivery_id);
create index master_contract_delivery_products_term_idx on public.master_contract_delivery_products(product_term_id);
create index master_contract_revisions_contract_idx on public.master_contract_revisions(contract_id, revision desc);
create index master_contract_revisions_evidence_idx on public.master_contract_revisions(supplier_evidence_id) where supplier_evidence_id is not null;
create index master_contract_revisions_actor_idx on public.master_contract_revisions(actor_user_id) where actor_user_id is not null;
create index master_contract_evidence_contract_idx on public.master_contract_supplier_evidence(contract_id, revision, recorded_at desc);
create index master_contract_evidence_actor_idx on public.master_contract_supplier_evidence(recorded_by) where recorded_by is not null;
create index master_contract_prices_line_idx on public.master_contract_price_resolutions(delivery_product_id, resolution_revision desc);
create index master_contract_prices_actor_idx on public.master_contract_price_resolutions(reviewed_by) where reviewed_by is not null;
create index master_contract_links_contract_idx on public.master_contract_salesforce_links(contract_id, delivery_id, entity_type);
create index master_contract_variances_open_idx on public.master_contract_variances(contract_id, status, detected_at desc);
create index master_contract_sync_ready_idx on public.master_contract_sync_jobs(status, next_attempt_at, created_at);
create index master_contract_sync_actor_idx on public.master_contract_sync_jobs(actor_user_id) where actor_user_id is not null;
create index master_contract_operations_contract_idx on public.master_contract_operations(contract_id, created_at desc);
create index master_contract_operations_actor_idx on public.master_contract_operations(actor_user_id) where actor_user_id is not null;

alter table public.master_contract_settings enable row level security;
alter table public.master_contracts enable row level security;
alter table public.master_contract_product_terms enable row level security;
alter table public.master_contract_deliveries enable row level security;
alter table public.master_contract_delivery_products enable row level security;
alter table public.master_contract_charge_rules enable row level security;
alter table public.master_contract_revisions enable row level security;
alter table public.master_contract_supplier_evidence enable row level security;
alter table public.master_contract_price_resolutions enable row level security;
alter table public.master_contract_salesforce_links enable row level security;
alter table public.master_contract_variances enable row level security;
alter table public.master_contract_sync_jobs enable row level security;
alter table public.master_contract_operations enable row level security;

revoke all on table public.master_contract_settings from public, anon, authenticated;
revoke all on table public.master_contracts from public, anon, authenticated;
revoke all on table public.master_contract_product_terms from public, anon, authenticated;
revoke all on table public.master_contract_deliveries from public, anon, authenticated;
revoke all on table public.master_contract_delivery_products from public, anon, authenticated;
revoke all on table public.master_contract_charge_rules from public, anon, authenticated;
revoke all on table public.master_contract_revisions from public, anon, authenticated;
revoke all on table public.master_contract_supplier_evidence from public, anon, authenticated;
revoke all on table public.master_contract_price_resolutions from public, anon, authenticated;
revoke all on table public.master_contract_salesforce_links from public, anon, authenticated;
revoke all on table public.master_contract_variances from public, anon, authenticated;
revoke all on table public.master_contract_sync_jobs from public, anon, authenticated;
revoke all on table public.master_contract_operations from public, anon, authenticated;

grant all on table public.master_contract_settings to service_role;
grant all on table public.master_contracts to service_role;
grant all on table public.master_contract_product_terms to service_role;
grant all on table public.master_contract_deliveries to service_role;
grant all on table public.master_contract_delivery_products to service_role;
grant all on table public.master_contract_charge_rules to service_role;
grant all on table public.master_contract_revisions to service_role;
grant all on table public.master_contract_supplier_evidence to service_role;
grant all on table public.master_contract_price_resolutions to service_role;
grant all on table public.master_contract_salesforce_links to service_role;
grant all on table public.master_contract_variances to service_role;
grant all on table public.master_contract_sync_jobs to service_role;
grant all on table public.master_contract_operations to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'master-contract-evidence',
  'master-contract-evidence',
  false,
  20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'message/rfc822', 'text/plain']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.master_contract_immutable_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Master Contract legal evidence and revision history are immutable.' using errcode = '23514';
end;
$$;

create trigger master_contract_revision_immutable
before update or delete on public.master_contract_revisions
for each row execute function public.master_contract_immutable_guard();

create trigger master_contract_evidence_immutable
before update or delete on public.master_contract_supplier_evidence
for each row execute function public.master_contract_immutable_guard();

create or replace function public.save_master_contract_snapshot(
  p_contract_id uuid,
  p_contract_key text,
  p_title text,
  p_expected_revision bigint,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_request_hash text,
  p_operation text default 'save'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract public.master_contracts%rowtype;
  v_operation public.master_contract_operations%rowtype;
  v_revision bigint;
  v_contract_id uuid := p_contract_id;
  v_now timestamptz := clock_timestamp();
  v_item jsonb;
  v_delivery jsonb;
  v_delivery_product jsonb;
  v_product_term_id uuid;
  v_delivery_id uuid;
begin
  if btrim(coalesce(p_contract_key, '')) !~ '^[A-Z0-9][A-Z0-9_-]{5,79}$'
    or nullif(btrim(p_title), '') is null
    or p_actor_user_id is null
    or jsonb_typeof(coalesce(p_snapshot, '{}'::jsonb)) <> 'object'
    or lower(btrim(coalesce(p_snapshot_hash, ''))) !~ '^[a-f0-9]{64}$'
    or lower(btrim(coalesce(p_request_hash, ''))) !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200
    or p_operation not in ('save', 'import_draft') then
    raise exception 'A complete valid Master Contract snapshot is required.' using errcode = '22023';
  end if;

  select * into v_operation
  from public.master_contract_operations
  where idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_operation.operation <> p_operation or v_operation.request_hash <> lower(btrim(p_request_hash)) then
      raise exception 'This Master Contract idempotency key belongs to a different request.' using errcode = '40001';
    end if;
    return jsonb_build_object('replay', true, 'contractId', v_operation.contract_id, 'revision', v_operation.result_revision);
  end if;

  if v_contract_id is not null then
    select * into v_contract from public.master_contracts where id = v_contract_id for update;
    if not found then raise exception 'The Master Contract is unavailable.' using errcode = 'P0002'; end if;
    if p_expected_revision is null or v_contract.current_revision <> p_expected_revision then
      raise exception 'The Master Contract changed after it was opened. Refresh before saving.' using errcode = '40001';
    end if;
    v_revision := v_contract.current_revision + 1;
    update public.master_contracts set
      title = btrim(p_title),
      status = 'draft',
      buyer_account_id = nullif(p_snapshot#>>'{parties,buyer,accountId}', ''),
      buyer_account_name = coalesce(p_snapshot#>>'{parties,buyer,name}', ''),
      buyer_cl_key = coalesce(p_snapshot#>>'{parties,buyer,clKey}', ''),
      supplier_account_id = nullif(p_snapshot#>>'{parties,supplier,accountId}', ''),
      supplier_account_name = coalesce(p_snapshot#>>'{parties,supplier,name}', ''),
      supplier_cl_key = coalesce(p_snapshot#>>'{parties,supplier,clKey}', ''),
      supplier_identity_confirmed = coalesce((p_snapshot#>>'{parties,supplier,confirmed}')::boolean, false),
      buyer_pic = coalesce(p_snapshot#>>'{parties,buyer,pic}', ''),
      buyer_contact_id = nullif(p_snapshot#>>'{parties,buyer,contactId}', ''),
      owner_user_id = nullif(p_snapshot->>'ownerUserId', '')::uuid,
      don_min_days = nullif(p_snapshot#>>'{terms,don,minDays}', '')::integer,
      don_max_days = nullif(p_snapshot#>>'{terms,don,maxDays}', '')::integer,
      variable_charges_mode = nullif(p_snapshot#>>'{terms,variableCharges,mode}', ''),
      current_revision = v_revision,
      current_snapshot = p_snapshot,
      updated_by = p_actor_user_id,
      updated_at = v_now
    where id = v_contract_id
    returning * into v_contract;
  else
    v_revision := 1;
    insert into public.master_contracts (
      contract_key, title, buyer_account_id, buyer_account_name, buyer_cl_key,
      supplier_account_id, supplier_account_name, supplier_cl_key, supplier_identity_confirmed,
      buyer_pic, buyer_contact_id, owner_user_id, don_min_days, don_max_days,
      variable_charges_mode, current_revision, current_snapshot, created_by, updated_by, updated_at
    ) values (
      btrim(p_contract_key), btrim(p_title), nullif(p_snapshot#>>'{parties,buyer,accountId}', ''),
      coalesce(p_snapshot#>>'{parties,buyer,name}', ''), coalesce(p_snapshot#>>'{parties,buyer,clKey}', ''),
      nullif(p_snapshot#>>'{parties,supplier,accountId}', ''), coalesce(p_snapshot#>>'{parties,supplier,name}', ''),
      coalesce(p_snapshot#>>'{parties,supplier,clKey}', ''), coalesce((p_snapshot#>>'{parties,supplier,confirmed}')::boolean, false),
      coalesce(p_snapshot#>>'{parties,buyer,pic}', ''), nullif(p_snapshot#>>'{parties,buyer,contactId}', ''),
      nullif(p_snapshot->>'ownerUserId', '')::uuid, nullif(p_snapshot#>>'{terms,don,minDays}', '')::integer,
      nullif(p_snapshot#>>'{terms,don,maxDays}', '')::integer, nullif(p_snapshot#>>'{terms,variableCharges,mode}', ''),
      1, p_snapshot, p_actor_user_id, p_actor_user_id, v_now
    ) returning * into v_contract;
    v_contract_id := v_contract.id;
  end if;

  update public.master_contract_product_terms set active = false, updated_at = v_now where contract_id = v_contract_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_snapshot->'products', '[]'::jsonb)) loop
    if nullif(v_item->>'productKey', '') is null
      or nullif(v_item->>'benchmarkCode', '') is null
      or coalesce(v_item->>'benchmarkUnit', '') not in ('USD/MT', 'USD/bbl') then
      raise exception 'Every Master Contract product requires a key, benchmark code, and native unit.' using errcode = '22023';
    end if;
    insert into public.master_contract_product_terms (
      contract_id, product_key, salesforce_product_id, product_name, benchmark_code, benchmark_unit,
      conversion_factor, buy_premium, sell_premium, contracted_min_qty, contracted_max_qty,
      uom, sort_order, active, updated_at
    ) values (
      v_contract_id, v_item->>'productKey', nullif(v_item->>'salesforceProductId', ''), coalesce(v_item->>'productName', ''),
      v_item->>'benchmarkCode', v_item->>'benchmarkUnit', coalesce(nullif(v_item->>'conversionFactor', '')::numeric, 1),
      coalesce(nullif(v_item->>'buyPremium', '')::numeric, 0), coalesce(nullif(v_item->>'sellPremium', '')::numeric, 0),
      coalesce(nullif(v_item->>'contractedMinQty', '')::numeric, 0), coalesce(nullif(v_item->>'contractedMaxQty', '')::numeric, 0),
      coalesce(nullif(v_item->>'uom', ''), 'MT'), coalesce(nullif(v_item->>'sortOrder', '')::integer, 0), true, v_now
    ) on conflict (contract_id, product_key) do update set
      salesforce_product_id = excluded.salesforce_product_id,
      product_name = excluded.product_name,
      benchmark_code = excluded.benchmark_code,
      benchmark_unit = excluded.benchmark_unit,
      conversion_factor = excluded.conversion_factor,
      buy_premium = excluded.buy_premium,
      sell_premium = excluded.sell_premium,
      contracted_min_qty = excluded.contracted_min_qty,
      contracted_max_qty = excluded.contracted_max_qty,
      uom = excluded.uom,
      sort_order = excluded.sort_order,
      active = true,
      updated_at = excluded.updated_at;
  end loop;

  update public.master_contract_deliveries set active = false, updated_at = v_now where contract_id = v_contract_id;
  update public.master_contract_delivery_products dp set active = false, updated_at = v_now
  from public.master_contract_deliveries d where dp.delivery_id = d.id and d.contract_id = v_contract_id;
  for v_delivery in select value from jsonb_array_elements(coalesce(p_snapshot->'deliveries', '[]'::jsonb)) loop
    if nullif(v_delivery->>'deliveryKey', '') is null
      or nullif(v_delivery->>'vesselName', '') is null
      or nullif(v_delivery->>'preliminaryEta', '') is null then
      raise exception 'Every Master Contract delivery requires a key, vessel, and preliminary ETA.' using errcode = '22023';
    end if;
    v_delivery_id := null;
    insert into public.master_contract_deliveries (
      contract_id, delivery_key, sequence, vessel_name, vessel_imo, vessel_id, port_id, port_name,
      preliminary_eta, supply_location, buyer_payment_term, supplier_payment_term,
      variable_charge_supplier_ids, don_date, don_alternate_reason, status, active, updated_at
    ) values (
      v_contract_id, v_delivery->>'deliveryKey', coalesce(nullif(v_delivery->>'sequence', '')::integer, 1),
      v_delivery->>'vesselName', coalesce(v_delivery->>'vesselImo', ''), nullif(v_delivery->>'vesselId', ''),
      nullif(v_delivery->>'portId', ''), coalesce(v_delivery->>'portName', ''), (v_delivery->>'preliminaryEta')::date,
      coalesce(nullif(v_delivery->>'supplyLocation', ''), 'TBD'), coalesce(v_delivery->>'buyerPaymentTerm', ''),
      coalesce(v_delivery->>'supplierPaymentTerm', ''), coalesce(v_delivery->'variableChargeSupplierIds', '[]'::jsonb),
      nullif(v_delivery->>'donDate', '')::date, coalesce(v_delivery->>'donAlternateReason', ''),
      coalesce(nullif(v_delivery->>'status', ''), 'planned'), true, v_now
    ) on conflict (delivery_key) do update set
      sequence = excluded.sequence,
      vessel_name = excluded.vessel_name,
      vessel_imo = excluded.vessel_imo,
      vessel_id = excluded.vessel_id,
      port_id = excluded.port_id,
      port_name = excluded.port_name,
      preliminary_eta = excluded.preliminary_eta,
      supply_location = excluded.supply_location,
      buyer_payment_term = excluded.buyer_payment_term,
      supplier_payment_term = excluded.supplier_payment_term,
      variable_charge_supplier_ids = excluded.variable_charge_supplier_ids,
      don_date = excluded.don_date,
      don_alternate_reason = excluded.don_alternate_reason,
      status = excluded.status,
      active = true,
      updated_at = excluded.updated_at
    where public.master_contract_deliveries.contract_id = excluded.contract_id
    returning id into v_delivery_id;
    if v_delivery_id is null then
      raise exception 'A delivery key cannot be moved between Master Contracts.' using errcode = '23514';
    end if;

    for v_delivery_product in select value from jsonb_array_elements(coalesce(v_delivery->'products', '[]'::jsonb)) loop
      select id into v_product_term_id from public.master_contract_product_terms
      where contract_id = v_contract_id and product_key = v_delivery_product->>'productKey' and active = true;
      if v_product_term_id is null or nullif(v_delivery_product->>'contractLineKey', '') is null then
        raise exception 'Every delivery product requires an active contract product and unique line key.' using errcode = '22023';
      end if;
      insert into public.master_contract_delivery_products (
        delivery_id, product_term_id, contract_line_key, quantity_min, quantity_max, price_status, active, updated_at
      ) values (
        v_delivery_id, v_product_term_id, v_delivery_product->>'contractLineKey',
        coalesce(nullif(v_delivery_product->>'quantityMin', '')::numeric, 0),
        coalesce(nullif(v_delivery_product->>'quantityMax', '')::numeric, 0),
        coalesce(nullif(v_delivery_product->>'priceStatus', ''), 'unresolved'), true, v_now
      ) on conflict (contract_line_key) do update set
        product_term_id = excluded.product_term_id,
        quantity_min = excluded.quantity_min,
        quantity_max = excluded.quantity_max,
        price_status = excluded.price_status,
        active = true,
        updated_at = excluded.updated_at
      where public.master_contract_delivery_products.delivery_id = excluded.delivery_id;
      if not found then
        raise exception 'A contract line key cannot be moved between deliveries.' using errcode = '23514';
      end if;
    end loop;
  end loop;

  update public.master_contract_charge_rules set active = false where contract_id = v_contract_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_snapshot->'chargeRules', '[]'::jsonb)) loop
    insert into public.master_contract_charge_rules (
      contract_id, charge_key, salesforce_product_id, supplier_account_id, supplier_name, charge_name, applies_when,
      fixed_cost, fixed_sell, currency, active
    ) values (
      v_contract_id, v_item->>'chargeKey', nullif(v_item->>'salesforceProductId', ''), nullif(v_item->>'supplierAccountId', ''), coalesce(v_item->>'supplierName', ''),
      v_item->>'chargeName', v_item->>'appliesWhen', coalesce(nullif(v_item->>'fixedCost', '')::numeric, 0),
      coalesce(nullif(v_item->>'fixedSell', '')::numeric, 0), coalesce(nullif(v_item->>'currency', ''), 'USD'), true
    ) on conflict (contract_id, charge_key) do update set
      salesforce_product_id = excluded.salesforce_product_id,
      supplier_account_id = excluded.supplier_account_id,
      supplier_name = excluded.supplier_name,
      charge_name = excluded.charge_name,
      applies_when = excluded.applies_when,
      fixed_cost = excluded.fixed_cost,
      fixed_sell = excluded.fixed_sell,
      currency = excluded.currency,
      active = true;
  end loop;

  insert into public.master_contract_revisions (
    contract_id, revision, revision_kind, snapshot, snapshot_hash, actor_user_id, actor_email
  ) values (
    v_contract_id, v_revision, 'draft', p_snapshot, lower(btrim(p_snapshot_hash)),
    p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), '')
  );

  insert into public.master_contract_operations (
    contract_id, idempotency_key, operation, request_hash, result_revision, actor_user_id
  ) values (
    v_contract_id, btrim(p_idempotency_key), p_operation, lower(btrim(p_request_hash)), v_revision, p_actor_user_id
  );

  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
    case when p_operation = 'import_draft' then 'master_contract_draft_imported' else 'master_contract_draft_saved' end,
    jsonb_build_object('contract_id', v_contract_id, 'contract_key', btrim(p_contract_key), 'revision', v_revision, 'snapshot_hash', lower(btrim(p_snapshot_hash)))
  );

  return jsonb_build_object('replay', false, 'contractId', v_contract_id, 'revision', v_revision);
end;
$$;

create or replace function public.enqueue_master_contract_sync(
  p_contract_id uuid,
  p_job_type text,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.master_contract_sync_jobs%rowtype;
begin
  if p_job_type not in ('create_batch', 'apply_prices', 'revert_variance', 'hourly_reconcile')
    or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
    or lower(btrim(coalesce(p_request_hash, ''))) !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200 then
    raise exception 'A complete valid Master Contract sync request is required.' using errcode = '22023';
  end if;
  insert into public.master_contract_sync_jobs (
    contract_id, job_type, payload, actor_user_id, actor_email, idempotency_key, request_hash
  ) values (
    p_contract_id, p_job_type, p_payload, p_actor_user_id,
    nullif(lower(btrim(coalesce(p_actor_email, ''))), ''), btrim(p_idempotency_key), lower(btrim(p_request_hash))
  ) on conflict (idempotency_key) do nothing
  returning * into v_job;
  if found then
    return jsonb_build_object('replay', false, 'jobId', v_job.id, 'status', v_job.status);
  end if;
  select * into v_job from public.master_contract_sync_jobs where idempotency_key = btrim(p_idempotency_key);
  if v_job.contract_id <> p_contract_id or v_job.job_type <> p_job_type or v_job.request_hash <> lower(btrim(p_request_hash)) then
    raise exception 'This Master Contract sync idempotency key belongs to a different request.' using errcode = '40001';
  end if;
  return jsonb_build_object('replay', true, 'jobId', v_job.id, 'status', v_job.status);
end;
$$;

create or replace function public.record_master_contract_supplier_evidence(
  p_contract_id uuid,
  p_expected_revision bigint,
  p_evidence_kind text,
  p_storage_path text,
  p_content_hash text,
  p_reference_label text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract public.master_contracts%rowtype;
  v_operation public.master_contract_operations%rowtype;
  v_evidence public.master_contract_supplier_evidence%rowtype;
begin
  if p_evidence_kind not in ('file', 'reference_note')
    or p_actor_user_id is null
    or nullif(btrim(coalesce(p_reference_label, '')), '') is null
    or (p_evidence_kind = 'file' and (
      nullif(btrim(coalesce(p_storage_path, '')), '') is null
      or lower(btrim(coalesce(p_content_hash, ''))) !~ '^[a-f0-9]{64}$'
    ))
    or (p_evidence_kind = 'reference_note' and p_storage_path is not null)
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200
    or lower(btrim(coalesce(p_request_hash, ''))) !~ '^[a-f0-9]{64}$' then
    raise exception 'Complete supplier approval evidence and idempotency identity are required.' using errcode = '22023';
  end if;

  select * into v_operation
  from public.master_contract_operations
  where idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_operation.operation <> 'record_evidence' or v_operation.request_hash <> lower(btrim(p_request_hash)) then
      raise exception 'This Master Contract idempotency key belongs to a different request.' using errcode = '40001';
    end if;
    select * into v_evidence
    from public.master_contract_supplier_evidence
    where idempotency_key = btrim(p_idempotency_key);
    return jsonb_build_object('replay', true, 'evidenceId', v_evidence.id, 'revision', p_expected_revision);
  end if;

  select * into v_contract from public.master_contracts where id = p_contract_id for update;
  if not found then raise exception 'The Master Contract is unavailable.' using errcode = 'P0002'; end if;
  if v_contract.current_revision <> p_expected_revision then
    raise exception 'The Master Contract changed after it was opened. Refresh before recording evidence.' using errcode = '40001';
  end if;

  insert into public.master_contract_supplier_evidence (
    contract_id, revision, idempotency_key, evidence_kind, storage_path, content_hash, reference_label, recorded_by
  ) values (
    p_contract_id, p_expected_revision, btrim(p_idempotency_key), p_evidence_kind, nullif(btrim(coalesce(p_storage_path, '')), ''),
    nullif(lower(btrim(coalesce(p_content_hash, ''))), ''), btrim(p_reference_label), p_actor_user_id
  ) returning * into v_evidence;

  insert into public.master_contract_operations (
    contract_id, idempotency_key, operation, request_hash, result_revision, actor_user_id
  ) values (
    p_contract_id, btrim(p_idempotency_key), 'record_evidence', lower(btrim(p_request_hash)),
    p_expected_revision, p_actor_user_id
  );

  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
    'master_contract_supplier_evidence_recorded',
    jsonb_build_object('contract_id', p_contract_id, 'revision', p_expected_revision,
      'evidence_kind', p_evidence_kind, 'content_hash', v_evidence.content_hash,
      'reference_recorded', true)
  );

  return jsonb_build_object('replay', false, 'evidenceId', v_evidence.id, 'revision', p_expected_revision);
end;
$$;

create or replace function public.decide_master_contract_revision(
  p_contract_id uuid,
  p_expected_revision bigint,
  p_action text,
  p_supplier_evidence_id uuid,
  p_actor_user_id uuid,
  p_actor_email text,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract public.master_contracts%rowtype;
  v_operation public.master_contract_operations%rowtype;
  v_revision bigint;
  v_kind text;
  v_status text;
  v_supplier_at timestamptz;
  v_owner_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_action not in ('submit', 'approve_supplier', 'approve_owner', 'reject', 'ratify', 'gm_override')
    or p_actor_user_id is null
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200
    or lower(btrim(coalesce(p_request_hash, ''))) !~ '^[a-f0-9]{64}$'
    or (p_action in ('reject', 'gm_override') and char_length(btrim(coalesce(p_reason, ''))) < 8) then
    raise exception 'A valid approval action, actor, reason, and idempotency identity are required.' using errcode = '22023';
  end if;

  select * into v_operation
  from public.master_contract_operations
  where idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_operation.operation <> p_action or v_operation.request_hash <> lower(btrim(p_request_hash)) then
      raise exception 'This Master Contract idempotency key belongs to a different request.' using errcode = '40001';
    end if;
    select * into v_contract from public.master_contracts where id = v_operation.contract_id;
    return jsonb_build_object('replay', true, 'contractId', v_contract.id, 'revision', v_operation.result_revision, 'status', v_contract.status);
  end if;

  select * into v_contract from public.master_contracts where id = p_contract_id for update;
  if not found then raise exception 'The Master Contract is unavailable.' using errcode = 'P0002'; end if;
  if v_contract.current_revision <> p_expected_revision then
    raise exception 'The Master Contract changed after it was opened. Refresh before deciding.' using errcode = '40001';
  end if;

  if p_action = 'submit' then
    if v_contract.status not in ('draft', 'approved') then raise exception 'Only a draft or amended contract can be submitted.' using errcode = '23514'; end if;
    v_kind := 'submitted'; v_status := 'pending_supplier_approval';
  elsif p_action = 'approve_supplier' then
    if v_contract.status <> 'pending_supplier_approval' then raise exception 'Supplier approval is not currently expected.' using errcode = '23514'; end if;
    if p_supplier_evidence_id is null or not exists (
      select 1 from public.master_contract_supplier_evidence
      where id = p_supplier_evidence_id and contract_id = p_contract_id and revision = p_expected_revision
    ) then raise exception 'Supplier approval requires evidence for this exact revision.' using errcode = '23514'; end if;
    v_kind := 'supplier_approved'; v_status := 'pending_owner_approval'; v_supplier_at := v_now;
  elsif p_action = 'approve_owner' then
    if v_contract.status <> 'pending_owner_approval' or not exists (
      select 1 from public.master_contract_revisions
      where contract_id = p_contract_id and revision = p_expected_revision and revision_kind = 'supplier_approved'
    ) then raise exception 'Owner approval requires the supplier-approved current revision.' using errcode = '23514'; end if;
    v_kind := 'owner_approved'; v_status := 'approved'; v_owner_at := v_now;
  elsif p_action = 'ratify' then
    if v_contract.status <> 'pending_owner_approval' or not exists (
      select 1 from public.master_contract_revisions
      where contract_id = p_contract_id and revision = p_expected_revision and revision_kind = 'supplier_approved'
    ) then raise exception 'Ratification requires supplier approval of the current Salesforce variance.' using errcode = '23514'; end if;
    v_kind := 'ratified'; v_status := 'approved'; v_owner_at := v_now;
  elsif p_action = 'gm_override' then
    v_kind := 'gm_override'; v_status := 'approved'; v_supplier_at := v_now; v_owner_at := v_now;
  else
    if v_contract.status not in ('pending_supplier_approval', 'pending_owner_approval') then raise exception 'Only a pending approval can be rejected.' using errcode = '23514'; end if;
    v_kind := 'draft'; v_status := 'draft';
  end if;

  v_revision := v_contract.current_revision + 1;
  insert into public.master_contract_revisions (
    contract_id, revision, revision_kind, snapshot, snapshot_hash, supplier_approved_at,
    supplier_evidence_id, owner_approved_at, reason_recorded, actor_user_id, actor_email
  ) values (
    p_contract_id, v_revision, v_kind, v_contract.current_snapshot,
    encode(digest(v_contract.current_snapshot::text, 'sha256'), 'hex'), v_supplier_at,
    case when p_action = 'approve_supplier' then p_supplier_evidence_id else null end,
    v_owner_at, nullif(btrim(coalesce(p_reason, '')), '') is not null, p_actor_user_id,
    nullif(lower(btrim(coalesce(p_actor_email, ''))), '')
  );

  update public.master_contracts set
    status = v_status,
    current_revision = v_revision,
    approved_revision = case when v_status = 'approved' then v_revision else approved_revision end,
    updated_by = p_actor_user_id,
    updated_at = v_now
  where id = p_contract_id
  returning * into v_contract;

  insert into public.master_contract_operations (
    contract_id, idempotency_key, operation, request_hash, result_revision, actor_user_id
  ) values (
    p_contract_id, btrim(p_idempotency_key), p_action, lower(btrim(p_request_hash)), v_revision, p_actor_user_id
  );
  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
    'master_contract_revision_decided',
    jsonb_build_object('contract_id', p_contract_id, 'revision', v_revision, 'decision', p_action,
      'result_status', v_status, 'supplier_evidence_recorded', p_supplier_evidence_id is not null,
      'reason_recorded', nullif(btrim(coalesce(p_reason, '')), '') is not null)
  );
  return jsonb_build_object('replay', false, 'contractId', p_contract_id, 'revision', v_revision, 'status', v_status);
end;
$$;

create or replace function public.complete_master_contract_sync(
  p_job_id uuid,
  p_status text,
  p_redacted_result jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.master_contract_sync_jobs%rowtype;
  v_key text;
begin
  if p_status not in ('salesforce_committed', 'succeeded', 'failed', 'uncertain')
    or jsonb_typeof(coalesce(p_redacted_result, '{}'::jsonb)) <> 'object' then
    raise exception 'A valid redacted Master Contract sync result is required.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_redacted_result, '{}'::jsonb)) loop
    if v_key not in ('contractId', 'jobId', 'createdCount', 'reconciledCount', 'deliveryKeys', 'errorCode', 'duplicate', 'sourceFingerprint') then
      raise exception 'Master Contract sync results may contain only redacted workflow fields.' using errcode = '22023';
    end if;
  end loop;
  select * into v_job from public.master_contract_sync_jobs where id = p_job_id for update;
  if not found then raise exception 'The Master Contract sync job is unavailable.' using errcode = 'P0002'; end if;
  update public.master_contract_sync_jobs set
    status = p_status,
    redacted_result = coalesce(p_redacted_result, '{}'::jsonb),
    attempt_count = attempt_count + 1,
    completed_at = case when p_status in ('succeeded', 'failed') then clock_timestamp() else null end,
    updated_at = clock_timestamp()
  where id = p_job_id
  returning * into v_job;
  return jsonb_build_object('jobId', v_job.id, 'status', v_job.status, 'attemptCount', v_job.attempt_count);
end;
$$;

create or replace function public.finalize_master_contract_salesforce_batch(
  p_job_id uuid,
  p_links jsonb,
  p_source_fingerprint text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.master_contract_sync_jobs%rowtype;
  v_link jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_links, '[]'::jsonb)) > 250
    or lower(btrim(coalesce(p_source_fingerprint, ''))) !~ '^[a-f0-9]{64}$' then
    raise exception 'Complete redacted Salesforce link evidence is required.' using errcode = '22023';
  end if;
  select * into v_job from public.master_contract_sync_jobs where id = p_job_id for update;
  if not found or v_job.job_type <> 'create_batch' then
    raise exception 'The Master Contract creation job is unavailable.' using errcode = 'P0002';
  end if;
  if v_job.status = 'succeeded' then
    return jsonb_build_object('replay', true, 'jobId', v_job.id, 'createdCount', coalesce((v_job.redacted_result->>'createdCount')::integer, 0));
  end if;
  if v_job.status not in ('pending', 'processing', 'salesforce_committed', 'uncertain') then
    raise exception 'The Master Contract creation job cannot be finalized from its current state.' using errcode = '23514';
  end if;

  for v_link in select value from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if coalesce(v_link->>'entityType', '') not in ('opportunity', 'stem', 'line_item', 'charge', 'nomination', 'buyer_confirmation')
      or nullif(v_link->>'externalKey', '') is null
      or coalesce(v_link->>'salesforceId', '') !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
      or not exists (
        select 1 from public.master_contract_deliveries
        where id = nullif(v_link->>'deliveryId', '')::uuid and contract_id = v_job.contract_id
      ) then
      raise exception 'Salesforce returned an invalid or cross-contract Master Contract link.' using errcode = '23514';
    end if;
    insert into public.master_contract_salesforce_links (
      contract_id, delivery_id, entity_type, external_key, salesforce_id, salesforce_last_modified_at, updated_at
    ) values (
      v_job.contract_id, (v_link->>'deliveryId')::uuid, v_link->>'entityType', v_link->>'externalKey',
      v_link->>'salesforceId', nullif(v_link->>'lastModifiedAt', '')::timestamptz, clock_timestamp()
    ) on conflict (entity_type, external_key) do update set
      salesforce_id = excluded.salesforce_id,
      salesforce_last_modified_at = excluded.salesforce_last_modified_at,
      updated_at = excluded.updated_at
    where public.master_contract_salesforce_links.contract_id = excluded.contract_id
      and public.master_contract_salesforce_links.delivery_id = excluded.delivery_id;
    if not found then
      raise exception 'A Salesforce external key is already bound to another Master Contract delivery.' using errcode = '23514';
    end if;
    if (v_link->>'entityType') = 'stem' then
      update public.master_contract_deliveries set status = 'created', updated_at = clock_timestamp()
      where id = (v_link->>'deliveryId')::uuid and contract_id = v_job.contract_id;
    end if;
    v_count := v_count + 1;
  end loop;

  update public.master_contract_sync_jobs set
    status = 'succeeded',
    redacted_result = jsonb_build_object(
      'contractId', v_job.contract_id, 'jobId', v_job.id, 'createdCount', v_count,
      'sourceFingerprint', lower(btrim(p_source_fingerprint))
    ),
    attempt_count = attempt_count + 1,
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_job_id;
  update public.master_contracts set
    status = case when status = 'approved' then 'active' else status end,
    updated_at = clock_timestamp()
  where id = v_job.contract_id;
  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    v_job.actor_user_id, v_job.actor_email, 'master_contract_salesforce_batch_finalized',
    jsonb_build_object('contract_id', v_job.contract_id, 'job_id', v_job.id,
      'created_link_count', v_count, 'source_fingerprint', lower(btrim(p_source_fingerprint)))
  );
  return jsonb_build_object('replay', false, 'jobId', v_job.id, 'createdCount', v_count);
end;
$$;

create or replace function public.save_master_contract_price_resolution(
  p_contract_id uuid,
  p_expected_revision bigint,
  p_delivery_product_id uuid,
  p_benchmark_date date,
  p_benchmark_code text,
  p_benchmark_unit text,
  p_benchmark_value numeric,
  p_conversion_factor numeric,
  p_buy_unrounded numeric,
  p_sell_unrounded numeric,
  p_buy_rounded numeric,
  p_sell_rounded numeric,
  p_evidence_hash text,
  p_official_observation_id uuid,
  p_alternate_publication_reason text,
  p_status text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contract public.master_contracts%rowtype;
  v_operation public.master_contract_operations%rowtype;
  v_resolution public.master_contract_price_resolutions%rowtype;
  v_resolution_revision bigint;
  v_operation_name text;
begin
  v_operation_name := case when p_status = 'applied' then 'apply_price' else 'resolve_price' end;
  if p_status not in ('review_required', 'reviewed', 'applied', 'conflict')
    or p_actor_user_id is null
    or p_benchmark_date is null
    or coalesce(p_benchmark_code, '') !~ '^[A-Z0-9.%-]{2,40}$'
    or p_benchmark_unit not in ('USD/MT', 'USD/bbl')
    or p_conversion_factor is null or p_conversion_factor <= 0
    or lower(btrim(coalesce(p_evidence_hash, ''))) !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200
    or lower(btrim(coalesce(p_request_hash, ''))) !~ '^[a-f0-9]{64}$' then
    raise exception 'Complete reviewed DON price evidence is required.' using errcode = '22023';
  end if;
  select * into v_operation from public.master_contract_operations
  where idempotency_key = btrim(p_idempotency_key) for update;
  if found then
    if v_operation.operation <> v_operation_name or v_operation.request_hash <> lower(btrim(p_request_hash)) then
      raise exception 'This Master Contract idempotency key belongs to a different request.' using errcode = '40001';
    end if;
    select * into v_resolution from public.master_contract_price_resolutions
    where delivery_product_id = p_delivery_product_id and resolution_revision = v_operation.result_revision;
    return jsonb_build_object('replay', true, 'resolutionId', v_resolution.id,
      'resolutionRevision', v_resolution.resolution_revision, 'status', v_resolution.status);
  end if;
  select * into v_contract from public.master_contracts where id = p_contract_id for update;
  if not found then raise exception 'The Master Contract is unavailable.' using errcode = 'P0002'; end if;
  if v_contract.current_revision <> p_expected_revision then
    raise exception 'The Master Contract changed after it was opened. Refresh before resolving prices.' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.master_contract_delivery_products dp
    join public.master_contract_deliveries d on d.id = dp.delivery_id
    where dp.id = p_delivery_product_id and d.contract_id = p_contract_id and dp.active and d.active
  ) then raise exception 'The delivery product is not part of this active Master Contract.' using errcode = '23514'; end if;
  select coalesce(max(resolution_revision), 0) + 1 into v_resolution_revision
  from public.master_contract_price_resolutions where delivery_product_id = p_delivery_product_id;
  insert into public.master_contract_price_resolutions (
    delivery_product_id, resolution_revision, benchmark_date, benchmark_code, benchmark_unit,
    benchmark_value, conversion_factor, buy_unrounded, sell_unrounded, buy_rounded, sell_rounded,
    evidence_hash, official_observation_id, alternate_publication_reason, status, reviewed_by,
    reviewed_at, applied_at
  ) values (
    p_delivery_product_id, v_resolution_revision, p_benchmark_date, p_benchmark_code, p_benchmark_unit,
    p_benchmark_value, p_conversion_factor, p_buy_unrounded, p_sell_unrounded, p_buy_rounded, p_sell_rounded,
    lower(btrim(p_evidence_hash)), p_official_observation_id, coalesce(p_alternate_publication_reason, ''),
    p_status, p_actor_user_id, case when p_status in ('reviewed', 'applied') then clock_timestamp() else null end,
    case when p_status = 'applied' then clock_timestamp() else null end
  ) returning * into v_resolution;
  update public.master_contract_delivery_products set price_status = p_status, updated_at = clock_timestamp()
  where id = p_delivery_product_id;
  insert into public.master_contract_operations (
    contract_id, idempotency_key, operation, request_hash, result_revision, actor_user_id
  ) values (
    p_contract_id, btrim(p_idempotency_key), v_operation_name, lower(btrim(p_request_hash)),
    v_resolution_revision, p_actor_user_id
  );
  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
    'master_contract_don_price_recorded',
    jsonb_build_object('contract_id', p_contract_id, 'delivery_product_id', p_delivery_product_id,
      'resolution_revision', v_resolution_revision, 'status', p_status, 'benchmark_code', p_benchmark_code,
      'benchmark_date', p_benchmark_date, 'evidence_hash', lower(btrim(p_evidence_hash)),
      'alternate_reason_recorded', nullif(btrim(coalesce(p_alternate_publication_reason, '')), '') is not null)
  );
  return jsonb_build_object('replay', false, 'resolutionId', v_resolution.id,
    'resolutionRevision', v_resolution.resolution_revision, 'status', v_resolution.status);
end;
$$;

create or replace function public.set_master_contract_feature(
  p_enabled boolean,
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_actor_email text,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_setting public.master_contract_settings%rowtype;
  v_operation public.master_contract_operations%rowtype;
begin
  if p_actor_user_id is null or nullif(btrim(p_reason), '') is null
    or char_length(btrim(p_reason)) < 8
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 16 and 200
    or lower(btrim(coalesce(p_request_hash, ''))) !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid feature change, actor, reason, and idempotency identity are required.' using errcode = '22023';
  end if;
  select * into v_operation from public.master_contract_operations
  where idempotency_key = btrim(p_idempotency_key) for update;
  if found then
    if v_operation.operation <> 'enable_feature' or v_operation.request_hash <> lower(btrim(p_request_hash)) then
      raise exception 'This Master Contract idempotency key belongs to a different request.' using errcode = '40001';
    end if;
    select * into v_setting from public.master_contract_settings where id = 'company';
    return jsonb_build_object('replay', true, 'enabled', v_setting.feature_enabled, 'revision', v_setting.revision);
  end if;
  select * into v_setting from public.master_contract_settings where id = 'company' for update;
  if v_setting.revision <> p_expected_revision then
    raise exception 'Master Contracts feature settings changed after they were opened.' using errcode = '40001';
  end if;
  update public.master_contract_settings set
    feature_enabled = p_enabled,
    revision = revision + 1,
    updated_by = p_actor_user_id,
    updated_by_email = nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
    updated_at = clock_timestamp()
  where id = 'company'
  returning * into v_setting;
  insert into public.master_contract_operations (idempotency_key, operation, request_hash, result_revision, actor_user_id)
  values (btrim(p_idempotency_key), 'enable_feature', lower(btrim(p_request_hash)), v_setting.revision, p_actor_user_id);
  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), ''), 'master_contract_feature_changed',
    jsonb_build_object('enabled', p_enabled, 'revision', v_setting.revision, 'reason_recorded', true));
  return jsonb_build_object('replay', false, 'enabled', v_setting.feature_enabled, 'revision', v_setting.revision);
end;
$$;

create or replace function public.reconcile_master_contract_live_state(
  p_contract_id uuid,
  p_links jsonb,
  p_variances jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_link jsonb;
  v_variance jsonb;
  v_link_count integer := 0;
  v_variance_count integer := 0;
  v_resolved_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (select 1 from public.master_contracts where id = p_contract_id)
    or jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_variances, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_links, '[]'::jsonb)) > 500
    or jsonb_array_length(coalesce(p_variances, '[]'::jsonb)) > 500 then
    raise exception 'A bounded exact Master Contract reconciliation payload is required.' using errcode = '22023';
  end if;

  for v_link in select value from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if coalesce(v_link->>'entityType', '') not in ('opportunity', 'stem', 'line_item', 'charge', 'nomination', 'buyer_confirmation')
      or nullif(v_link->>'externalKey', '') is null
      or coalesce(v_link->>'salesforceId', '') !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
      or not exists (
        select 1 from public.master_contract_deliveries
        where id = nullif(v_link->>'deliveryId', '')::uuid and contract_id = p_contract_id and active
      ) then
      raise exception 'Salesforce returned an invalid or cross-contract reconciliation link.' using errcode = '23514';
    end if;
    insert into public.master_contract_salesforce_links (
      contract_id, delivery_id, entity_type, external_key, salesforce_id,
      salesforce_last_modified_at, updated_at
    ) values (
      p_contract_id, (v_link->>'deliveryId')::uuid, v_link->>'entityType', v_link->>'externalKey',
      v_link->>'salesforceId', nullif(v_link->>'lastModifiedAt', '')::timestamptz, v_now
    ) on conflict (entity_type, external_key) do update set
      salesforce_id = excluded.salesforce_id,
      salesforce_last_modified_at = excluded.salesforce_last_modified_at,
      updated_at = excluded.updated_at
    where public.master_contract_salesforce_links.contract_id = excluded.contract_id
      and public.master_contract_salesforce_links.delivery_id = excluded.delivery_id;
    if not found then
      raise exception 'A Salesforce external key is already bound to another Master Contract delivery.' using errcode = '23514';
    end if;
    if (v_link->>'entityType') = 'stem' then
      update public.master_contract_deliveries set status = case when status = 'planned' then 'created' else status end
      where id = (v_link->>'deliveryId')::uuid;
    end if;
    v_link_count := v_link_count + 1;
  end loop;

  for v_variance in select value from jsonb_array_elements(coalesce(p_variances, '[]'::jsonb)) loop
    if nullif(v_variance->>'varianceKey', '') is null
      or nullif(v_variance->>'fieldPath', '') is null
      or coalesce(v_variance->>'sourceFingerprint', '') !~ '^[a-f0-9]{64}$'
      or not exists (
        select 1 from public.master_contract_deliveries
        where id = nullif(v_variance->>'deliveryId', '')::uuid and contract_id = p_contract_id and active
      ) then
      raise exception 'An invalid or cross-contract live variance was supplied.' using errcode = '23514';
    end if;
    update public.master_contract_variances set status = 'superseded', resolved_at = v_now
    where contract_id = p_contract_id
      and variance_key = v_variance->>'varianceKey'
      and source_fingerprint <> v_variance->>'sourceFingerprint'
      and status = 'open';
    insert into public.master_contract_variances (
      contract_id, delivery_id, variance_key, field_path, approved_value, live_value,
      source_fingerprint, status, consequential_financial_record, detected_at
    ) values (
      p_contract_id, (v_variance->>'deliveryId')::uuid, v_variance->>'varianceKey',
      v_variance->>'fieldPath', v_variance->'approvedValue', v_variance->'liveValue',
      v_variance->>'sourceFingerprint', 'open',
      coalesce((v_variance->>'consequentialFinancialRecord')::boolean, false), v_now
    ) on conflict (contract_id, variance_key, source_fingerprint) do update set
      live_value = excluded.live_value,
      consequential_financial_record = excluded.consequential_financial_record,
      status = 'open',
      resolved_at = null;
    v_variance_count := v_variance_count + 1;
  end loop;

  update public.master_contract_variances existing set status = 'reverted', resolved_at = v_now
  where existing.contract_id = p_contract_id
    and existing.status = 'open'
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_variances, '[]'::jsonb)) candidate
      where candidate->>'varianceKey' = existing.variance_key
        and candidate->>'sourceFingerprint' = existing.source_fingerprint
    );
  get diagnostics v_resolved_count = row_count;
  update public.master_contract_deliveries set last_live_refresh_at = v_now
  where contract_id = p_contract_id and active;
  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id, nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
    'master_contract_live_reconciled',
    jsonb_build_object('contract_id', p_contract_id, 'link_count', v_link_count,
      'open_variance_count', v_variance_count, 'resolved_variance_count', v_resolved_count)
  );
  return jsonb_build_object('linkCount', v_link_count, 'openVarianceCount', v_variance_count,
    'resolvedVarianceCount', v_resolved_count, 'checkedAt', v_now);
end;
$$;

revoke all on function public.save_master_contract_snapshot(uuid, text, text, bigint, jsonb, text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_master_contract_supplier_evidence(uuid, bigint, text, text, text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.decide_master_contract_revision(uuid, bigint, text, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_master_contract_sync(uuid, text, jsonb, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_master_contract_sync(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_master_contract_salesforce_batch(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_master_contract_price_resolution(uuid, bigint, uuid, date, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.set_master_contract_feature(boolean, bigint, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.reconcile_master_contract_live_state(uuid, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.master_contract_immutable_guard() from public, anon, authenticated;
grant execute on function public.save_master_contract_snapshot(uuid, text, text, bigint, jsonb, text, uuid, text, text, text, text) to service_role;
grant execute on function public.record_master_contract_supplier_evidence(uuid, bigint, text, text, text, text, uuid, text, text, text) to service_role;
grant execute on function public.decide_master_contract_revision(uuid, bigint, text, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.enqueue_master_contract_sync(uuid, text, jsonb, uuid, text, text, text) to service_role;
grant execute on function public.complete_master_contract_sync(uuid, text, jsonb) to service_role;
grant execute on function public.finalize_master_contract_salesforce_batch(uuid, jsonb, text) to service_role;
grant execute on function public.save_master_contract_price_resolution(uuid, bigint, uuid, date, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, text, text, text) to service_role;
grant execute on function public.set_master_contract_feature(boolean, bigint, uuid, text, text, text, text) to service_role;
grant execute on function public.reconcile_master_contract_live_state(uuid, jsonb, jsonb, uuid, text) to service_role;

commit;
