create table if not exists public.hedge_broker_settlements (
  id uuid primary key default gen_random_uuid(),
  trade_month text not null check (trade_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  broker_key text not null check (broker_key = lower(trim(broker_key)) and broker_key <> ''),
  broker_name text not null check (trim(broker_name) <> ''),
  status text not null default 'open' check (status in ('open', 'settled')),
  trade_count integer not null default 0 check (trade_count >= 0),
  commission_amount numeric(18, 2) not null default 0 check (commission_amount >= 0),
  calculation_fingerprint text,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  settled_at timestamptz,
  settled_by_id uuid references public.user_profiles(id) on delete set null,
  settled_by_email text,
  reopened_at timestamptz,
  reopened_by_id uuid references public.user_profiles(id) on delete set null,
  reopened_by_email text,
  revision bigint not null default 1 check (revision > 0),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (trade_month, broker_key),
  check (
    (status = 'open')
    or (
      status = 'settled'
      and trade_count > 0
      and calculation_fingerprint is not null
      and settled_at is not null
    )
  )
);

create index if not exists hedge_broker_settlements_month_status_idx
  on public.hedge_broker_settlements (trade_month desc, status, broker_key);

alter table public.hedge_broker_settlements enable row level security;
revoke all on table public.hedge_broker_settlements from public, anon, authenticated;
grant all on table public.hedge_broker_settlements to service_role;

drop trigger if exists hedge_broker_settlements_touch_revision on public.hedge_broker_settlements;
create trigger hedge_broker_settlements_touch_revision
before update on public.hedge_broker_settlements
for each row execute function public.hedge_touch_revision();

insert into public.hedge_broker_settlements (
  trade_month,
  broker_key,
  broker_name,
  status,
  reopened_at,
  reopened_by_email
)
select
  to_char(trade_date, 'YYYY-MM'),
  lower(trim(broker)),
  min(trim(broker)),
  'open',
  clock_timestamp(),
  'system:migration'
from public.hedge_swap_hedges
where trade_date is not null
  and upper(coalesce(trim(venue), '')) = 'ICE'
  and coalesce(trim(broker), '') <> ''
group by to_char(trade_date, 'YYYY-MM'), lower(trim(broker))
on conflict (trade_month, broker_key) do update set
  broker_name = excluded.broker_name,
  status = 'open',
  trade_count = 0,
  commission_amount = 0,
  calculation_fingerprint = null,
  calculation_snapshot = '{}'::jsonb,
  settled_at = null,
  settled_by_id = null,
  settled_by_email = null,
  reopened_at = excluded.reopened_at,
  reopened_by_id = null,
  reopened_by_email = excluded.reopened_by_email;

insert into public.hedge_events (
  event_type,
  entity_type,
  label,
  metadata,
  actor_email,
  source
)
select
  'broker_settlements_reopened',
  'BrokerSettlement',
  'Historical broker settlements reopened using trade-date month.',
  jsonb_build_object(
    'basis', 'trade_date',
    'reopened_pairs', count(*)
  ),
  'system:migration',
  'fcos'
from public.hedge_broker_settlements;

create or replace function public.save_hedge_broker_settlement(
  p_trade_month text,
  p_broker_key text,
  p_broker_name text,
  p_status text,
  p_trade_count integer,
  p_commission_amount numeric,
  p_calculation_fingerprint text,
  p_calculation_snapshot jsonb,
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_actor_email text
)
returns public.hedge_broker_settlements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.hedge_broker_settlements%rowtype;
  v_saved public.hedge_broker_settlements%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_trade_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_broker_key is null
    or p_broker_key <> lower(trim(p_broker_key))
    or p_broker_key = ''
    or trim(coalesce(p_broker_name, '')) = ''
    or p_status not in ('open', 'settled')
    or coalesce(p_expected_revision, -1) < 0 then
    raise exception 'INVALID_BROKER_SETTLEMENT';
  end if;

  if p_status = 'settled' and (
    coalesce(p_trade_count, 0) <= 0
    or coalesce(p_commission_amount, 0) < 0
    or nullif(trim(coalesce(p_calculation_fingerprint, '')), '') is null
  ) then
    raise exception 'INVALID_BROKER_SETTLEMENT_CALCULATION';
  end if;

  select *
  into v_existing
  from public.hedge_broker_settlements
  where trade_month = p_trade_month
    and broker_key = p_broker_key
  for update;

  if found then
    if v_existing.revision <> p_expected_revision then
      raise exception 'REVISION_CONFLICT';
    end if;

    update public.hedge_broker_settlements
    set
      broker_name = trim(p_broker_name),
      status = p_status,
      trade_count = case when p_status = 'settled' then p_trade_count else 0 end,
      commission_amount = case when p_status = 'settled' then round(p_commission_amount, 2) else 0 end,
      calculation_fingerprint = case when p_status = 'settled' then p_calculation_fingerprint else null end,
      calculation_snapshot = case when p_status = 'settled' then coalesce(p_calculation_snapshot, '{}'::jsonb) else '{}'::jsonb end,
      settled_at = case when p_status = 'settled' then v_now else null end,
      settled_by_id = case when p_status = 'settled' then p_actor_user_id else null end,
      settled_by_email = case when p_status = 'settled' then lower(trim(p_actor_email)) else null end,
      reopened_at = case when p_status = 'open' then v_now else reopened_at end,
      reopened_by_id = case when p_status = 'open' then p_actor_user_id else reopened_by_id end,
      reopened_by_email = case when p_status = 'open' then lower(trim(p_actor_email)) else reopened_by_email end
    where id = v_existing.id
    returning * into v_saved;
  else
    if p_expected_revision <> 0 then
      raise exception 'REVISION_CONFLICT';
    end if;

    insert into public.hedge_broker_settlements (
      trade_month,
      broker_key,
      broker_name,
      status,
      trade_count,
      commission_amount,
      calculation_fingerprint,
      calculation_snapshot,
      settled_at,
      settled_by_id,
      settled_by_email,
      reopened_at,
      reopened_by_id,
      reopened_by_email
    ) values (
      p_trade_month,
      p_broker_key,
      trim(p_broker_name),
      p_status,
      case when p_status = 'settled' then p_trade_count else 0 end,
      case when p_status = 'settled' then round(p_commission_amount, 2) else 0 end,
      case when p_status = 'settled' then p_calculation_fingerprint else null end,
      case when p_status = 'settled' then coalesce(p_calculation_snapshot, '{}'::jsonb) else '{}'::jsonb end,
      case when p_status = 'settled' then v_now else null end,
      case when p_status = 'settled' then p_actor_user_id else null end,
      case when p_status = 'settled' then lower(trim(p_actor_email)) else null end,
      case when p_status = 'open' then v_now else null end,
      case when p_status = 'open' then p_actor_user_id else null end,
      case when p_status = 'open' then lower(trim(p_actor_email)) else null end
    )
    returning * into v_saved;
  end if;

  insert into public.hedge_events (
    event_type,
    entity_type,
    entity_id,
    label,
    before_data,
    after_data,
    metadata,
    actor_user_id,
    actor_email,
    source
  ) values (
    case when p_status = 'settled' then 'broker_settlement_completed' else 'broker_settlement_reopened' end,
    'BrokerSettlement',
    v_saved.id,
    trim(p_broker_name) || ' ' || p_trade_month || case when p_status = 'settled' then ' settled.' else ' reopened.' end,
    case when v_existing.id is null then null else to_jsonb(v_existing) end,
    to_jsonb(v_saved),
    jsonb_build_object('basis', 'trade_date'),
    p_actor_user_id,
    lower(trim(p_actor_email)),
    'fcos'
  );

  return v_saved;
end;
$$;

revoke all on function public.save_hedge_broker_settlement(
  text, text, text, text, integer, numeric, text, jsonb, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.save_hedge_broker_settlement(
  text, text, text, text, integer, numeric, text, jsonb, bigint, uuid, text
) to service_role;
