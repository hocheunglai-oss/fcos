-- Personal market choices and visit baselines are service-only, never shared.
create table if not exists public.market_trader_workspaces (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 250000),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.market_trader_workspaces enable row level security;
revoke all on table public.market_trader_workspaces from public, anon, authenticated;
grant select, insert, update, delete on table public.market_trader_workspaces to service_role;

create or replace function public.save_market_trader_workspace(
  p_user_id uuid, p_actor_user_id uuid, p_state jsonb, p_expected_revision bigint
) returns public.market_trader_workspaces
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_current public.market_trader_workspaces%rowtype; v_result public.market_trader_workspaces%rowtype;
begin
  if p_user_id is null or p_actor_user_id is distinct from p_user_id
    or not exists (select 1 from public.user_profiles where id = p_user_id and active = true) then
    raise exception 'Personal Markets may only be changed by their active owner.' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_state is null
    or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 250000 then
    raise exception 'Invalid personal Markets state.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('market_trader_workspace:' || p_user_id::text, 0));
  select * into v_current from public.market_trader_workspaces where user_id = p_user_id for update;
  if coalesce(v_current.revision, 0) <> p_expected_revision then
    raise exception 'Personal Markets changed in another session. Reload before saving.' using errcode = '40001';
  end if;
  insert into public.market_trader_workspaces(user_id, state, revision, updated_at)
  values (p_user_id, p_state, 1, now())
  on conflict(user_id) do update set state = excluded.state,
    revision = market_trader_workspaces.revision + 1, updated_at = now()
  returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.save_market_trader_workspace(uuid,uuid,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.save_market_trader_workspace(uuid,uuid,jsonb,bigint) to service_role;
