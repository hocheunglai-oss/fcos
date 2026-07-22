create table if not exists public.buyer_trader_accounts (
  buyer_account_key text primary key
    check (buyer_account_key ~ '^[A-Za-z0-9]{15}$'),
  buyer_account_id text not null
    check (buyer_account_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  buyer_account_name text not null,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buyer_trader_assignments (
  buyer_account_key text not null
    references public.buyer_trader_accounts(buyer_account_key) on delete cascade,
  trader_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  assignment_order smallint not null
    check (assignment_order between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (buyer_account_key, trader_user_id),
  unique (buyer_account_key, assignment_order)
);

create index if not exists buyer_trader_assignments_user_idx
on public.buyer_trader_assignments(trader_user_id);

alter table public.buyer_trader_accounts enable row level security;
alter table public.buyer_trader_assignments enable row level security;

revoke all on table public.buyer_trader_accounts from public, anon, authenticated;
revoke all on table public.buyer_trader_assignments from public, anon, authenticated;
grant all on table public.buyer_trader_accounts to service_role;
grant all on table public.buyer_trader_assignments to service_role;

insert into public.app_modules (id, label, path, sort_order) values
  ('buyers_administrator', 'Buyers Administrator', '/buyers-administrator', 85)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'buyers_administrator', id = 'administrator'
from public.user_types
on conflict (user_type_id, module_id) do nothing;

create or replace function public.save_buyer_trader_account(
  p_buyer_account_id text,
  p_buyer_account_name text,
  p_trader_user_ids uuid[],
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_key text := left(trim(coalesce(p_buyer_account_id, '')), 15);
  v_account_id text := trim(coalesce(p_buyer_account_id, ''));
  v_account_name text := trim(coalesce(p_buyer_account_name, ''));
  v_trader_user_ids uuid[] := coalesce(p_trader_user_ids, '{}'::uuid[]);
  v_current public.buyer_trader_accounts%rowtype;
  v_account public.buyer_trader_accounts%rowtype;
  v_previous_trader_user_ids uuid[] := '{}'::uuid[];
  v_active_user_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_account_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' then
    raise exception 'A valid Salesforce buyer Account ID is required.';
  end if;
  if v_account_name = '' then
    raise exception 'Buyer account name is required.';
  end if;
  if cardinality(v_trader_user_ids) > 3 then
    raise exception 'A buyer can have at most three traders.';
  end if;
  if array_position(v_trader_user_ids, null) is not null then
    raise exception 'Trader user IDs cannot be empty.';
  end if;
  if cardinality(v_trader_user_ids) <> (
    select count(distinct trader_user_id)
    from unnest(v_trader_user_ids) as trader_user_id
  ) then
    raise exception 'The same trader cannot be assigned more than once.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_account_key, 0));

  select * into v_current
  from public.buyer_trader_accounts
  where buyer_account_key = v_account_key
  for update;

  if found then
    if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
      raise exception 'This buyer assignment changed after it was opened. Refresh and review the latest update before saving.';
    end if;
  elsif p_expected_updated_at is not null then
    raise exception 'This buyer assignment changed after it was opened. Refresh and review the latest update before saving.';
  end if;

  select coalesce(array_agg(trader_user_id order by assignment_order), '{}'::uuid[])
  into v_previous_trader_user_ids
  from public.buyer_trader_assignments
  where buyer_account_key = v_account_key;

  if cardinality(v_trader_user_ids) > 0 then
    select count(*) into v_active_user_count
    from public.user_profiles
    where id = any(v_trader_user_ids)
      and active = true;

    if v_active_user_count <> cardinality(v_trader_user_ids) then
      raise exception 'Every assigned trader must be an active FCOS user.';
    end if;
  end if;

  insert into public.buyer_trader_accounts (
    buyer_account_key,
    buyer_account_id,
    buyer_account_name,
    updated_by,
    updated_by_email,
    updated_at
  ) values (
    v_account_key,
    v_account_id,
    v_account_name,
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_email, '')), ''),
    v_now
  )
  on conflict (buyer_account_key) do update set
    buyer_account_id = excluded.buyer_account_id,
    buyer_account_name = excluded.buyer_account_name,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into v_account;

  delete from public.buyer_trader_assignments
  where buyer_account_key = v_account_key;

  insert into public.buyer_trader_assignments (
    buyer_account_key,
    trader_user_id,
    assignment_order,
    updated_at
  )
  select
    v_account_key,
    trader_user_id,
    assignment_order::smallint,
    v_now
  from unnest(v_trader_user_ids) with ordinality as selected(trader_user_id, assignment_order);

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_email, '')), ''),
    'buyer_traders_updated',
    jsonb_build_object(
      'buyer_account_id', v_account_id,
      'buyer_account_key', v_account_key,
      'buyer_account_name', v_account_name,
      'previous_trader_user_ids', to_jsonb(v_previous_trader_user_ids),
      'trader_user_ids', to_jsonb(v_trader_user_ids)
    )
  );

  return jsonb_build_object(
    'account', to_jsonb(v_account),
    'trader_user_ids', to_jsonb(v_trader_user_ids)
  );
end;
$$;

revoke all on function public.save_buyer_trader_account(text, text, uuid[], uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.save_buyer_trader_account(text, text, uuid[], uuid, text, timestamptz)
to service_role;
