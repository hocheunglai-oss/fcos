begin;

set local lock_timeout = '5s';
lock table public.variable_charge_settings in share row exclusive mode;

do $check$
declare
  settings_save oid := to_regprocedure('public.save_variable_charge_settings(integer,numeric,uuid,text)');
begin
  if not exists (
    select 1 from pg_proc
    where oid = settings_save and not prosecdef and proconfig = array['search_path=public']
      and encode(sha256(convert_to(btrim(prosrc, E'\n\r\t '), 'UTF8')), 'hex') = 'f4559923385eae4957cfd8233e49c3c5818060f6654d41a8e67928efac09d80f'
  ) or not has_function_privilege('service_role', settings_save, 'EXECUTE')
    or has_function_privilege('anon', settings_save, 'EXECUTE')
    or has_function_privilege('authenticated', settings_save, 'EXECUTE') then
    raise exception 'Company FX history requires the verified Variable Charges settings save routine and grants.';
  end if;
  if not exists (select 1 from public.variable_charge_settings where id = 'company') then
    raise exception 'Company FX history requires the current company settings row.';
  end if;
end;
$check$;

create table public.company_fx_rate_history (
  id uuid primary key default gen_random_uuid(),
  pair text not null check (pair = 'USD/HKD'),
  rate numeric(12, 6) not null check (rate > 0 and rate <= 100),
  settings_revision integer null check (settings_revision > 0),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid null references public.user_profiles(id),
  reason text not null check (char_length(trim(reason)) >= 5),
  unique (pair, effective_at)
);

create unique index company_fx_rate_history_settings_revision_idx
  on public.company_fx_rate_history (pair, settings_revision)
  where settings_revision is not null;

alter table public.company_fx_rate_history enable row level security;
-- The hosted schema grants table privileges by default, including TRUNCATE.
revoke all on table public.company_fx_rate_history from public, anon, authenticated, service_role;
grant select, insert on table public.company_fx_rate_history to service_role;

insert into public.company_fx_rate_history (
  pair, rate, settings_revision, effective_at, actor_user_id, reason
)
select
  'USD/HKD', settings.usd_hkd_rate, settings.revision, settings.updated_at, settings.updated_by,
  'Migration seed from current variable charge settings; earlier FX history is unavailable.'
from public.variable_charge_settings settings
where settings.id = 'company';

create or replace function public.company_fx_rate_history_protect()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Company FX rate history is immutable';
end;
$$;

create or replace function public.company_fx_rate_history_validate_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.actor_user_id is null then
    raise exception 'Company FX history requires an actor.';
  end if;
  return new;
end;
$$;

create trigger company_fx_rate_history_immutable
before update or delete on public.company_fx_rate_history
for each row execute function public.company_fx_rate_history_protect();

create trigger company_fx_rate_history_insert_guard
before insert on public.company_fx_rate_history
for each row execute function public.company_fx_rate_history_validate_insert();

create or replace function public.company_fx_rate_history_capture_settings_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_reason text;
begin
  if new.id <> 'company' then return new; end if;
  if new.revision <> old.revision + 1 or new.updated_at <= old.updated_at then
    raise exception 'Company FX settings revision and effective time must advance for every rate snapshot.';
  end if;
  if new.updated_by is null then
    raise exception 'Company FX settings updates require an actor.';
  end if;
  v_reason := nullif(trim(current_setting('fcos.company_fx_rate_reason', true)), '');
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Company FX settings updates require a specific reason.';
  end if;
  insert into public.company_fx_rate_history (
    pair, rate, settings_revision, effective_at, actor_user_id, reason
  ) values (
    'USD/HKD', new.usd_hkd_rate, new.revision, new.updated_at, new.updated_by, v_reason
  );
  return new;
end;
$$;

create trigger company_fx_rate_history_capture_settings_update
after update on public.variable_charge_settings
for each row execute function public.company_fx_rate_history_capture_settings_update();

revoke all on function public.company_fx_rate_history_protect() from public, anon, authenticated;
revoke all on function public.company_fx_rate_history_validate_insert() from public, anon, authenticated;
revoke all on function public.company_fx_rate_history_capture_settings_update() from public, anon, authenticated;

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
  perform set_config('fcos.company_fx_rate_reason', trim(p_reason), true);
  update public.variable_charge_settings
  set usd_hkd_rate = round(p_usd_hkd_rate, 6),
      revision = revision + 1,
      updated_at = greatest(now(), v_current.updated_at + interval '1 microsecond'),
      updated_by = p_actor_user_id
  where id = 'company'
  returning * into v_updated;
  perform set_config('fcos.company_fx_rate_reason', '', true);
  insert into public.variable_charge_setting_events(setting_id, event_type, prior_revision, new_revision, actor_user_id, metadata)
  values ('company', 'usd_hkd_rate_updated', v_current.revision, v_updated.revision, p_actor_user_id,
    jsonb_build_object('reasonPresent', true, 'rateChanged', v_current.usd_hkd_rate <> v_updated.usd_hkd_rate));
  return v_updated;
end;
$$;

revoke all on function public.save_variable_charge_settings(integer, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.save_variable_charge_settings(integer, numeric, uuid, text) to service_role;

commit;
