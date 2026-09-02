begin;

create extension if not exists pgcrypto;

insert into public.app_modules (id, label, path, sort_order) values
  ('hedge_desk', 'Hedge Desk', '/hedge-desk', 87),
  ('hedge_book_manage', 'Manage Hedge Book', '/hedge-desk', 187),
  ('hedge_settlement_manage', 'Manage Hedge Settlement', '/hedge-desk', 188),
  ('hedge_close_approve', 'Approve Hedge Close and Reports', '/hedge-desk', 189),
  ('hedge_admin', 'Administer Hedge Desk', '/settings?section=system&panel=hedge-desk', 190)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select
  user_type.id,
  permission.module_id,
  case permission.module_id
    when 'hedge_desk' then user_type.id in ('general_manager', 'administrator', 'manager', 'finance')
    when 'hedge_book_manage' then user_type.id in ('general_manager', 'administrator', 'manager')
    when 'hedge_settlement_manage' then user_type.id in ('general_manager', 'administrator', 'finance')
    when 'hedge_close_approve' then user_type.id in ('general_manager', 'administrator')
    when 'hedge_admin' then user_type.id in ('general_manager', 'administrator')
    else false
  end
from public.user_types user_type
cross join (values
  ('hedge_desk'),
  ('hedge_book_manage'),
  ('hedge_settlement_manage'),
  ('hedge_close_approve'),
  ('hedge_admin')
) permission(module_id)
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

create table if not exists public.hedge_physical_trades (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text not null default '',
  created_by_id uuid references public.user_profiles(id) on delete set null,
  updated_by_id uuid references public.user_profiles(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  trade_date date,
  product text,
  counterparty text,
  qty_min numeric,
  qty_max numeric,
  unit text,
  vessel_name text,
  delivery_date_from date,
  delivery_date_to date,
  sell_price_type text,
  sell_price numeric,
  sell_premium numeric,
  sell_pricing_month text,
  sell_pricing_basis text,
  sell_bal_date date,
  buy_price_type text,
  buy_price numeric,
  buy_premium numeric,
  buy_pricing_month text,
  buy_pricing_basis text,
  buy_bal_date date,
  notes text,
  stem_number text,
  sf_record_id text,
  is_closed boolean not null default false
);

create table if not exists public.hedge_swap_hedges (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text not null default '',
  created_by_id uuid references public.user_profiles(id) on delete set null,
  updated_by_id uuid references public.user_profiles(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  trade_date date,
  product text,
  direction text,
  swap_month text,
  quantity numeric,
  unit text,
  price numeric,
  venue text,
  broker text,
  counterparty text,
  notes text,
  is_expired boolean not null default false,
  round_trip boolean not null default false,
  initial_margin numeric,
  current_margin numeric,
  pricing_basis text,
  bal_start_date date,
  trade_type text,
  leg1_month text,
  leg1_price numeric,
  leg1_basis text,
  leg1_bal_date date,
  leg2_month text,
  leg2_price numeric,
  leg2_basis text,
  leg2_bal_date date,
  sf_record_id text
);

create table if not exists public.hedge_swap_physical_links (
  swap_id uuid not null references public.hedge_swap_hedges(id) on delete cascade,
  physical_trade_id uuid not null references public.hedge_physical_trades(id) on delete restrict,
  link_order integer not null default 0 check (link_order >= 0),
  created_at timestamptz not null default now(),
  primary key (swap_id, physical_trade_id)
);

create table if not exists public.hedge_market_prices (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text not null default '',
  created_by_id uuid references public.user_profiles(id) on delete set null,
  updated_by_id uuid references public.user_profiles(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  price_date date,
  s380 numeric,
  s05 numeric,
  sgo numeric,
  source text,
  raw_input text,
  is_estimate boolean not null default false
);

create table if not exists public.hedge_clearing_entries (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text not null default '',
  created_by_id uuid references public.user_profiles(id) on delete set null,
  updated_by_id uuid references public.user_profiles(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  entry_date date,
  type text,
  amount numeric,
  notes text,
  status text not null default 'confirmed'
);

create table if not exists public.hedge_counterparties (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text not null default '',
  created_by_id uuid references public.user_profiles(id) on delete set null,
  updated_by_id uuid references public.user_profiles(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  short_name text,
  full_name text,
  address_line1 text,
  address_line2 text,
  address_line3 text,
  attention text,
  emails text,
  bank_name text,
  bank_swift text,
  intermediary_bank text,
  intermediary_swift text,
  account_number text,
  notes text
);

create table if not exists public.hedge_invoices (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text not null default '',
  created_by_id uuid references public.user_profiles(id) on delete set null,
  updated_by_id uuid references public.user_profiles(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  invoice_number text,
  invoice_type text,
  issue_date date,
  settlement_month text,
  counterparty text,
  section text,
  subtotal numeric,
  status text,
  notes text,
  email_sent_at timestamptz,
  email_sent_to text,
  email_sent_cc text,
  sender_mailbox_snapshot text,
  pdf_payload jsonb,
  pdf_data_url text
);

create table if not exists public.hedge_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.hedge_invoices(id) on delete cascade,
  line_order integer not null check (line_order >= 0),
  product text,
  direction text,
  quantity numeric,
  unit text,
  price numeric,
  mtm_avg numeric,
  mtm_value numeric,
  handling_fee numeric,
  net_value numeric,
  source_snapshot jsonb not null default '{}'::jsonb,
  unique (invoice_id, line_order)
);

create table if not exists public.hedge_invoice_swaps (
  invoice_id uuid not null references public.hedge_invoices(id) on delete cascade,
  swap_id uuid not null references public.hedge_swap_hedges(id) on delete restrict,
  link_order integer not null default 0 check (link_order >= 0),
  primary key (invoice_id, swap_id)
);

create table if not exists public.hedge_invoice_physicals (
  invoice_id uuid not null references public.hedge_invoices(id) on delete cascade,
  physical_trade_id uuid not null references public.hedge_physical_trades(id) on delete restrict,
  link_order integer not null default 0 check (link_order >= 0),
  primary key (invoice_id, physical_trade_id)
);

create table if not exists public.hedge_settings (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  label text,
  notes text,
  revision bigint not null default 1 check (revision > 0),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text not null default '',
  created_by_id uuid references public.user_profiles(id) on delete set null,
  updated_by_id uuid references public.user_profiles(id) on delete set null,
  check (key <> 'google_auth')
);

create table if not exists public.hedge_month_closes (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  report_month text not null check (report_month ~ '^[0-9]{4}-[0-9]{2}$'),
  revision integer not null check (revision > 0),
  input_fingerprint text not null,
  status text not null,
  snapshot_json jsonb not null,
  finalized_at timestamptz not null,
  finalized_by text not null,
  finalized_by_id uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  approved_by text,
  approved_by_id uuid references public.user_profiles(id) on delete set null,
  sent_at timestamptz,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (report_month, revision),
  unique (report_month, input_fingerprint)
);

create table if not exists public.hedge_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  close_id uuid not null unique references public.hedge_month_closes(id) on delete restrict,
  recipient text not null,
  sender_mailbox_id uuid,
  sender_mailbox_snapshot text,
  status text not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  graph_message_id text,
  graph_request_id text,
  last_error text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create table if not exists public.hedge_documents (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  invoice_id uuid references public.hedge_invoices(id) on delete restrict,
  close_id uuid references public.hedge_month_closes(id) on delete restrict,
  bucket text not null default 'hedge-documents',
  storage_path text not null unique,
  display_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text,
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  check (invoice_id is not null or close_id is not null)
);

create table if not exists public.hedge_integration_operations (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  idempotency_key text not null unique,
  operation text not null,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_email text not null,
  request_hash text not null,
  sender_mailbox_id uuid,
  sender_mailbox_snapshot text,
  status text not null default 'processing',
  response jsonb,
  error text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table if not exists public.hedge_health_history (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text,
  service_key text not null,
  label text not null,
  category text not null default 'external',
  status text not null,
  detail text,
  checked_at timestamptz not null,
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  imported boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.hedge_migration_runs (
  id uuid primary key default gen_random_uuid(),
  source_project_ref text not null,
  source_commit text,
  mode text not null check (mode in ('dry_run', 'initial', 'delta', 'verification')),
  status text not null check (status in ('running', 'verified', 'failed')),
  table_counts jsonb not null default '{}'::jsonb,
  storage_counts jsonb not null default '{}'::jsonb,
  reconciliation jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_email text
);

create table if not exists public.hedge_events (
  id uuid primary key default gen_random_uuid(),
  legacy_source_id text unique,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  entity_legacy_id text,
  label text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_email text,
  source text not null default 'fcos',
  created_at timestamptz not null default now()
);

create table if not exists public.hedge_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  model_id text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(18, 8) not null default 0 check (estimated_cost_usd >= 0),
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.email_sender_mailboxes (
  id uuid primary key default gen_random_uuid(),
  email_address text not null unique,
  label text not null,
  active boolean not null default true,
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'verified', 'warning', 'failed')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  check (email_address = lower(btrim(email_address))),
  check (email_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create table if not exists public.email_sender_purposes (
  purpose_key text primary key,
  label text not null,
  description text not null default '',
  module_id text,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_sender_routes (
  purpose_key text primary key references public.email_sender_purposes(purpose_key) on delete cascade,
  mailbox_id uuid references public.email_sender_mailboxes(id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text
);

create table if not exists public.email_sender_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  mailbox_id uuid references public.email_sender_mailboxes(id) on delete set null,
  purpose_key text references public.email_sender_purposes(purpose_key) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_email text,
  created_at timestamptz not null default now()
);

alter table public.hedge_report_deliveries
  add constraint hedge_report_deliveries_sender_mailbox_id_fkey
  foreign key (sender_mailbox_id) references public.email_sender_mailboxes(id) on delete set null;

alter table public.hedge_integration_operations
  add constraint hedge_integration_operations_sender_mailbox_id_fkey
  foreign key (sender_mailbox_id) references public.email_sender_mailboxes(id) on delete set null;

alter table if exists public.fcos_update_deliveries
  add column if not exists sender_mailbox_id uuid references public.email_sender_mailboxes(id) on delete set null,
  add column if not exists sender_mailbox_snapshot text;

alter table if exists public.growth_email_deliveries
  add column if not exists sender_mailbox_id uuid references public.email_sender_mailboxes(id) on delete set null,
  add column if not exists sender_mailbox_snapshot text;

alter table if exists public.incoming_payment_interest_notifications
  add column if not exists sender_mailbox_id uuid references public.email_sender_mailboxes(id) on delete set null,
  add column if not exists sender_mailbox_snapshot text;

insert into public.email_sender_purposes (purpose_key, label, description, module_id, sort_order) values
  ('payment_reminders', 'Payment reminders', 'External payment reminders sent from Payment Collections.', 'buyer_invoices', 10),
  ('outstanding_invoice_reports', 'Outstanding invoice reports', 'Scheduled and manually generated outstanding buyer invoice reports.', 'buyer_invoices', 20),
  ('incoming_payment_reports', 'Incoming payment reports and interest notices', 'Incoming payment reports and late-payment interest notices.', 'incoming_payments', 30),
  ('growth_coaching', 'Growth & Coaching notifications', 'Goal, coaching, and reminder notifications.', null, 40),
  ('fcos_updates', 'FCOS Updates', 'Administrator-prepared product update emails sent by the General Manager.', 'admin', 50),
  ('hedge_settlement', 'Hedge settlement invoices and notices', 'Settlement documents and counterparty notices from Hedge Desk.', 'hedge_desk', 60),
  ('hedge_sfs_reports', 'Hedge SFS reports', 'Approved monthly realised P&L reports from Hedge Desk.', 'hedge_desk', 70)
on conflict (purpose_key) do update set
  label = excluded.label,
  description = excluded.description,
  module_id = excluded.module_id,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.email_sender_routes (purpose_key)
select purpose_key from public.email_sender_purposes
on conflict (purpose_key) do nothing;

insert into public.hedge_settings (key, value, label, created_by)
values ('assistant_model', '"gpt-5-mini-2025-08-07"'::jsonb, 'Trading assistant model', 'system')
on conflict (key) do nothing;

create index if not exists hedge_physical_trade_date_idx on public.hedge_physical_trades(trade_date desc);
create index if not exists hedge_physical_stem_idx on public.hedge_physical_trades(stem_number);
create index if not exists hedge_swap_month_idx on public.hedge_swap_hedges(swap_month);
create index if not exists hedge_swap_trade_date_idx on public.hedge_swap_hedges(trade_date desc);
create index if not exists hedge_market_price_date_idx on public.hedge_market_prices(price_date desc);
create index if not exists hedge_clearing_date_idx on public.hedge_clearing_entries(entry_date desc);
create index if not exists hedge_invoice_month_idx on public.hedge_invoices(settlement_month);
create index if not exists hedge_event_entity_idx on public.hedge_events(entity_type, entity_id, created_at desc);
create index if not exists hedge_event_created_idx on public.hedge_events(created_at desc);
create index if not exists hedge_ai_usage_created_idx on public.hedge_ai_usage_events(created_at desc);
create index if not exists hedge_health_service_idx on public.hedge_health_history(service_key, checked_at desc);
create index if not exists hedge_operation_expiry_idx on public.hedge_integration_operations(expires_at);
create index if not exists email_sender_events_created_idx on public.email_sender_events(created_at desc);

create or replace function public.hedge_touch_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_date = clock_timestamp();
  new.revision = old.revision + 1;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hedge_physical_trades',
    'hedge_swap_hedges',
    'hedge_market_prices',
    'hedge_clearing_entries',
    'hedge_counterparties',
    'hedge_invoices',
    'hedge_settings'
  ] loop
    execute format('drop trigger if exists %I_touch_revision on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_touch_revision before update on public.%I for each row execute function public.hedge_touch_revision()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create or replace function public.email_sender_actor_is_admin(p_actor_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_actor_user_id
      and profile.active = true
      and profile.user_type in ('administrator', 'general_manager')
  );
$$;

create or replace function public.save_email_sender_mailbox(
  p_mailbox_id uuid,
  p_email_address text,
  p_label text,
  p_active boolean,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mailbox public.email_sender_mailboxes%rowtype;
  v_email text := lower(btrim(coalesce(p_email_address, '')));
  v_label text := btrim(coalesce(p_label, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.email_sender_actor_is_admin(p_actor_user_id) then
    raise exception 'Only an active Administrator or General Manager may manage email senders.';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid Microsoft 365 mailbox email address.';
  end if;
  if char_length(v_label) not between 1 and 100 then
    raise exception 'Mailbox label must contain between 1 and 100 characters.';
  end if;
  if char_length(v_reason) not between 8 and 255 then
    raise exception 'Audit reason must contain between 8 and 255 characters.';
  end if;

  if p_mailbox_id is null then
    insert into public.email_sender_mailboxes (
      email_address, label, active, created_by, created_by_email, updated_by, updated_by_email
    ) values (
      v_email, v_label, coalesce(p_active, true), p_actor_user_id, lower(btrim(p_actor_email)), p_actor_user_id, lower(btrim(p_actor_email))
    ) returning * into v_mailbox;
  else
    select * into v_mailbox
    from public.email_sender_mailboxes
    where id = p_mailbox_id
    for update;
    if not found then raise exception 'Email sender mailbox was not found.'; end if;
    if p_expected_revision is null or v_mailbox.revision <> p_expected_revision then
      raise exception 'This mailbox changed after it was opened. Refresh before saving.';
    end if;
    if coalesce(p_active, false) = false and exists (
      select 1 from public.email_sender_routes route
      join public.email_sender_purposes purpose using (purpose_key)
      where route.mailbox_id = p_mailbox_id and purpose.enabled = true
    ) then
      raise exception 'Reassign every enabled email purpose before disabling this mailbox.';
    end if;
    update public.email_sender_mailboxes set
      email_address = v_email,
      label = v_label,
      active = coalesce(p_active, false),
      verification_state = case when email_address is distinct from v_email then 'unverified' else verification_state end,
      last_error = case when email_address is distinct from v_email then null else last_error end,
      revision = revision + 1,
      updated_at = clock_timestamp(),
      updated_by = p_actor_user_id,
      updated_by_email = lower(btrim(p_actor_email))
    where id = p_mailbox_id
    returning * into v_mailbox;
  end if;

  insert into public.email_sender_events (
    event_type, mailbox_id, reason, actor_user_id, actor_email,
    metadata
  ) values (
    case when p_mailbox_id is null then 'mailbox_created' else 'mailbox_updated' end,
    v_mailbox.id,
    v_reason,
    p_actor_user_id,
    lower(btrim(p_actor_email)),
    jsonb_build_object('active', v_mailbox.active, 'revision', v_mailbox.revision)
  );
  return to_jsonb(v_mailbox);
end;
$$;

create or replace function public.save_email_sender_route(
  p_purpose_key text,
  p_mailbox_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_route public.email_sender_routes%rowtype;
  v_mailbox public.email_sender_mailboxes%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.email_sender_actor_is_admin(p_actor_user_id) then
    raise exception 'Only an active Administrator or General Manager may assign email senders.';
  end if;
  if char_length(v_reason) not between 8 and 255 then
    raise exception 'Audit reason must contain between 8 and 255 characters.';
  end if;

  select * into v_route
  from public.email_sender_routes
  where purpose_key = p_purpose_key
  for update;
  if not found then raise exception 'Email purpose was not found.'; end if;
  if p_expected_revision is null or v_route.revision <> p_expected_revision then
    raise exception 'This email purpose changed after it was opened. Refresh before saving.';
  end if;

  if p_mailbox_id is not null then
    select * into v_mailbox
    from public.email_sender_mailboxes
    where id = p_mailbox_id and active = true;
    if not found then raise exception 'Select an active Microsoft Graph mailbox.'; end if;
  end if;

  update public.email_sender_routes set
    mailbox_id = p_mailbox_id,
    revision = revision + 1,
    updated_at = clock_timestamp(),
    updated_by = p_actor_user_id,
    updated_by_email = lower(btrim(p_actor_email))
  where purpose_key = p_purpose_key
  returning * into v_route;

  insert into public.email_sender_events (
    event_type, mailbox_id, purpose_key, reason, actor_user_id, actor_email,
    metadata
  ) values (
    'purpose_sender_assigned', p_mailbox_id, p_purpose_key, v_reason,
    p_actor_user_id, lower(btrim(p_actor_email)),
    jsonb_build_object('revision', v_route.revision)
  );
  return to_jsonb(v_route);
end;
$$;

create or replace function public.record_email_sender_delivery(
  p_purpose_key text,
  p_mailbox_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.email_sender_mailboxes set
    verification_state = case when p_succeeded then 'verified' else 'failed' end,
    last_success_at = case when p_succeeded then clock_timestamp() else last_success_at end,
    last_failure_at = case when p_succeeded then last_failure_at else clock_timestamp() end,
    last_error = case when p_succeeded then null else left(coalesce(p_error, 'Microsoft Graph delivery failed.'), 500) end,
    updated_at = clock_timestamp()
  where id = p_mailbox_id;

  insert into public.email_sender_events (
    event_type, mailbox_id, purpose_key, metadata
  ) values (
    case when p_succeeded then 'delivery_succeeded' else 'delivery_failed' end,
    p_mailbox_id,
    p_purpose_key,
    case when p_succeeded then '{}'::jsonb else jsonb_build_object('error_code', left(coalesce(p_error, ''), 100)) end
  );
end;
$$;

create or replace function public.protect_hedge_month_close_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Hedge month-close snapshots cannot be deleted.';
  end if;
  if new.report_month is distinct from old.report_month
    or new.revision is distinct from old.revision
    or new.input_fingerprint is distinct from old.input_fingerprint
    or new.snapshot_json is distinct from old.snapshot_json
    or new.finalized_at is distinct from old.finalized_at
    or new.finalized_by is distinct from old.finalized_by then
    raise exception 'Hedge month-close snapshots are immutable.';
  end if;
  new.updated_date = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists protect_hedge_month_close_snapshot on public.hedge_month_closes;
create trigger protect_hedge_month_close_snapshot
before update or delete on public.hedge_month_closes
for each row execute function public.protect_hedge_month_close_snapshot();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hedge-documents',
  'hedge-documents',
  false,
  20971520,
  array['application/pdf', 'text/csv', 'text/plain', 'image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hedge_physical_trades', 'hedge_swap_hedges', 'hedge_swap_physical_links',
    'hedge_market_prices', 'hedge_clearing_entries', 'hedge_counterparties',
    'hedge_invoices', 'hedge_invoice_lines', 'hedge_invoice_swaps',
    'hedge_invoice_physicals', 'hedge_settings', 'hedge_month_closes',
    'hedge_report_deliveries', 'hedge_documents', 'hedge_integration_operations',
    'hedge_health_history', 'hedge_migration_runs', 'hedge_events', 'hedge_ai_usage_events',
    'email_sender_mailboxes', 'email_sender_purposes', 'email_sender_routes',
    'email_sender_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke update, delete on table public.hedge_events from service_role;
revoke delete on table public.hedge_month_closes from service_role;
revoke delete on table public.hedge_report_deliveries from service_role;

revoke all on function public.hedge_touch_revision() from public, anon, authenticated;
revoke all on function public.email_sender_actor_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.save_email_sender_mailbox(uuid, text, text, boolean, text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.save_email_sender_route(text, uuid, text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.record_email_sender_delivery(text, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.protect_hedge_month_close_snapshot() from public, anon, authenticated;

grant execute on function public.email_sender_actor_is_admin(uuid) to service_role;
grant execute on function public.save_email_sender_mailbox(uuid, text, text, boolean, text, uuid, text, bigint) to service_role;
grant execute on function public.save_email_sender_route(text, uuid, text, uuid, text, bigint) to service_role;
grant execute on function public.record_email_sender_delivery(text, uuid, boolean, text) to service_role;

commit;
