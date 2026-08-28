begin;

create table if not exists public.variable_charge_settings (
  id text primary key check (id = 'company'),
  usd_hkd_rate numeric(12, 6) not null default 7.84 check (usd_hkd_rate > 0),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id)
);

insert into public.variable_charge_settings (id, usd_hkd_rate)
values ('company', 7.84)
on conflict (id) do nothing;

create table if not exists public.variable_charge_setting_events (
  id uuid primary key default gen_random_uuid(),
  setting_id text not null references public.variable_charge_settings(id),
  event_type text not null check (event_type in ('usd_hkd_rate_updated')),
  prior_revision integer not null,
  new_revision integer not null,
  actor_user_id uuid references public.user_profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists variable_charge_setting_events_setting_created_idx
  on public.variable_charge_setting_events (setting_id, created_at desc);

alter table public.variable_charge_settings enable row level security;
alter table public.variable_charge_setting_events enable row level security;
revoke all on table public.variable_charge_settings from public, anon, authenticated;
revoke all on table public.variable_charge_setting_events from public, anon, authenticated;
grant select, insert, update on table public.variable_charge_settings to service_role;
grant select, insert on table public.variable_charge_setting_events to service_role;

create or replace function public.save_variable_charge_settings(
  p_expected_revision integer,
  p_usd_hkd_rate numeric,
  p_actor_user_id uuid,
  p_reason text
)
returns public.variable_charge_settings
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.variable_charge_settings%rowtype;
  v_updated public.variable_charge_settings%rowtype;
begin
  if p_actor_user_id is null then raise exception 'Actor is required'; end if;
  if p_usd_hkd_rate is null or p_usd_hkd_rate <= 0 or p_usd_hkd_rate > 100 then raise exception 'USD/HKD rate is invalid'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'A specific reason is required'; end if;
  select * into v_current from public.variable_charge_settings where id = 'company' for update;
  if not found then raise exception 'Variable Charges settings are unavailable'; end if;
  if v_current.revision <> p_expected_revision then raise exception 'Variable Charges settings changed after they were opened'; end if;
  update public.variable_charge_settings
  set usd_hkd_rate = round(p_usd_hkd_rate, 6),
      revision = revision + 1,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = 'company'
  returning * into v_updated;
  insert into public.variable_charge_setting_events(setting_id, event_type, prior_revision, new_revision, actor_user_id, metadata)
  values ('company', 'usd_hkd_rate_updated', v_current.revision, v_updated.revision, p_actor_user_id,
    jsonb_build_object('reasonPresent', true, 'rateChanged', v_current.usd_hkd_rate <> v_updated.usd_hkd_rate));
  return v_updated;
end;
$$;

revoke all on function public.save_variable_charge_settings(integer, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.save_variable_charge_settings(integer, numeric, uuid, text) to service_role;

commit;
