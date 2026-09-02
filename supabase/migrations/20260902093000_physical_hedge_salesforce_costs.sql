create table if not exists public.hedge_physical_salesforce_costs (
  id uuid primary key default gen_random_uuid(),
  physical_trade_id uuid not null references public.hedge_physical_trades(id) on delete restrict,
  venue text not null check (venue in ('ICE', 'FCBS')),
  salesforce_stem_id text,
  stem_key_snapshot text not null,
  generation integer not null default 1 check (generation > 0),
  allocation_key text not null unique,
  supplier_account_id text not null,
  supplier_name_snapshot text not null,
  salesforce_record_id text,
  salesforce_record_name text,
  salesforce_last_modified_at timestamptz,
  gross_pnl numeric(18, 2) not null,
  salesforce_cost numeric(18, 2) not null,
  current_salesforce_cost numeric(18, 2),
  source_hedge_ids jsonb not null default '[]'::jsonb,
  source_hedge_revisions jsonb not null default '{}'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  calculation_fingerprint text not null check (calculation_fingerprint ~ '^[a-f0-9]{64}$'),
  mapping_revision bigint not null default 2 check (mapping_revision > 0),
  sync_state text not null default 'ready_to_add'
    check (sync_state in (
      'ready_to_add', 'waiting_final', 'added', 'update_required', 'removed',
      'changed_salesforce', 'locked_by_invoice', 'conflict', 'failed', 'uncertain'
    )),
  review_issue text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  synced_at timestamptz,
  synced_by uuid references public.user_profiles(id) on delete set null,
  synced_by_email text,
  unique (physical_trade_id, venue),
  check (salesforce_stem_id is null or salesforce_stem_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  check (supplier_account_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  check (salesforce_record_id is null or salesforce_record_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$')
);

create index if not exists hedge_physical_salesforce_costs_state_idx
  on public.hedge_physical_salesforce_costs(sync_state, updated_at desc);

create index if not exists hedge_physical_salesforce_costs_record_idx
  on public.hedge_physical_salesforce_costs(salesforce_record_id)
  where salesforce_record_id is not null;

create table if not exists public.hedge_physical_salesforce_cost_history (
  id uuid primary key default gen_random_uuid(),
  physical_trade_id uuid not null references public.hedge_physical_trades(id) on delete restrict,
  venue text not null check (venue in ('ICE', 'FCBS')),
  event_type text not null check (event_type in ('calculated', 'recalculated', 'create', 'update', 'recreate', 'adopt', 'restore')),
  generation integer not null check (generation > 0),
  allocation_key text not null,
  salesforce_record_id text,
  gross_pnl numeric(18, 2) not null,
  salesforce_cost numeric(18, 2) not null,
  calculation_fingerprint text not null check (calculation_fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_email text,
  created_at timestamptz not null default now(),
  check (salesforce_record_id is null or salesforce_record_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$')
);

create index if not exists hedge_physical_salesforce_cost_history_physical_idx
  on public.hedge_physical_salesforce_cost_history(physical_trade_id, created_at desc);

alter table public.hedge_physical_salesforce_costs enable row level security;
alter table public.hedge_physical_salesforce_cost_history enable row level security;

revoke all on table public.hedge_physical_salesforce_costs from public, anon, authenticated;
revoke all on table public.hedge_physical_salesforce_cost_history from public, anon, authenticated;
revoke all on table public.hedge_physical_salesforce_costs from service_role;
revoke all on table public.hedge_physical_salesforce_cost_history from service_role;

grant select, insert, update on table public.hedge_physical_salesforce_costs to service_role;
grant select, insert on table public.hedge_physical_salesforce_cost_history to service_role;

comment on table public.hedge_physical_salesforce_costs is
  'Service-only calculated and synchronized Salesforce SWAPS costs by Physical Trade and venue.';
comment on table public.hedge_physical_salesforce_cost_history is
  'Immutable service-only history for Physical Trade Salesforce hedge-result calculations and confirmations.';
