create table public.company_finance_settings (
  setting_key text primary key check (setting_key = 'company'),
  annual_interest_rate_pct numeric not null default 5
    check (annual_interest_rate_pct between 0 and 100 and annual_interest_rate_pct = round(annual_interest_rate_pct, 2)),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now()
);
create table public.company_finance_setting_events (
  id uuid primary key default gen_random_uuid(),
  previous_rate_pct numeric not null,
  annual_interest_rate_pct numeric not null,
  revision bigint not null unique,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_email text not null,
  created_at timestamptz not null default now()
);
create index company_finance_setting_events_actor_idx on public.company_finance_setting_events(actor_user_id);
create index company_finance_settings_editor_idx on public.company_finance_settings(updated_by);
alter table public.company_finance_settings enable row level security;
alter table public.company_finance_setting_events enable row level security;
revoke all on public.company_finance_settings, public.company_finance_setting_events from public, anon, authenticated;
grant select, insert, update on public.company_finance_settings to service_role;
grant select, insert on public.company_finance_setting_events to service_role;
insert into public.company_finance_settings(setting_key) values ('company');

create function public.save_company_finance_settings(
  p_annual_interest_rate_pct numeric, p_expected_revision bigint, p_actor_user_id uuid
) returns public.company_finance_settings
language plpgsql security invoker set search_path = '' as $$
declare
  v_current public.company_finance_settings%rowtype;
  v_saved public.company_finance_settings%rowtype;
begin
  if not exists (
    select 1 from public.user_profiles u where u.id = p_actor_user_id and u.active = true
    and (u.user_type in ('administrator','general_manager') or coalesce(
      (select p.can_view from public.user_module_permissions p where p.user_id=u.id and p.module_id='financial_report_settings_manage'),
      (select p.can_view from public.user_type_module_permissions p where p.user_type_id=u.user_type and p.module_id='financial_report_settings_manage'),
      u.user_type='finance'))
  ) then raise exception 'Finance settings management permission is required.' using errcode='42501'; end if;
  if p_annual_interest_rate_pct is null or p_annual_interest_rate_pct not between 0 and 100
    or p_annual_interest_rate_pct <> round(p_annual_interest_rate_pct,2) then
    raise exception 'The annual financing rate must be between 0 and 100 with at most two decimal places.' using errcode='22023';
  end if;
  select * into strict v_current from public.company_finance_settings where setting_key='company' for update;
  if p_expected_revision is distinct from v_current.revision then
    raise exception 'Finance settings changed after they were opened. Refresh before saving.' using errcode='40001';
  end if;
  if p_annual_interest_rate_pct = v_current.annual_interest_rate_pct then return v_current; end if;
  update public.company_finance_settings set annual_interest_rate_pct=p_annual_interest_rate_pct,
    revision=revision+1, updated_by=p_actor_user_id, updated_by_email=(select email from public.user_profiles where id=p_actor_user_id), updated_at=clock_timestamp()
    where setting_key='company' returning * into v_saved;
  insert into public.company_finance_setting_events(previous_rate_pct,annual_interest_rate_pct,revision,actor_user_id,actor_email)
    values(v_current.annual_interest_rate_pct,v_saved.annual_interest_rate_pct,v_saved.revision,p_actor_user_id,coalesce(v_saved.updated_by_email,p_actor_user_id::text));
  return v_saved;
end;
$$;
revoke all on function public.save_company_finance_settings(numeric,bigint,uuid) from public, anon, authenticated;
grant execute on function public.save_company_finance_settings(numeric,bigint,uuid) to service_role;
