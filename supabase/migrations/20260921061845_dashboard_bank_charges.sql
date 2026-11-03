-- Company-wide, configured USD costs per actual supplier remittance.
create function public.valid_company_bank_charges(p_charges jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare v_value numeric; v_bank text;
begin
  if p_charges is null or jsonb_typeof(p_charges) <> 'object'
    or not (p_charges ?& array['UBS','DBS']) or p_charges - 'UBS' - 'DBS' <> '{}'::jsonb then return false; end if;
  foreach v_bank in array array['UBS','DBS'] loop
    if jsonb_typeof(p_charges -> v_bank) <> 'number' then return false; end if;
    v_value := (p_charges ->> v_bank)::numeric;
    if v_value not between 0 and 1000000 or v_value <> round(v_value,2) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.valid_company_bank_charges(jsonb) from public, anon, authenticated;
grant execute on function public.valid_company_bank_charges(jsonb) to service_role;
alter table public.company_finance_settings add column bank_charges_usd jsonb not null default '{"UBS":10,"DBS":15}'::jsonb
  check (public.valid_company_bank_charges(bank_charges_usd));
alter table public.company_finance_setting_events add column previous_bank_charges_usd jsonb,
  add column bank_charges_usd jsonb;
-- Record the introduction of the approved policy without attributing it to a user session.
with saved as (
  update public.company_finance_settings set revision=revision+1, updated_by=null,
    updated_by_email='system:migration:dashboard_bank_charges', updated_at=clock_timestamp() returning *
)
insert into public.company_finance_setting_events(previous_rate_pct,annual_interest_rate_pct,revision,actor_email,bank_charges_usd)
  select annual_interest_rate_pct,annual_interest_rate_pct,revision,updated_by_email,bank_charges_usd from saved;

create function public.save_company_finance_settings_v2(
  p_annual_interest_rate_pct numeric, p_expected_revision bigint, p_actor_user_id uuid, p_bank_charges_usd jsonb
) returns public.company_finance_settings
language plpgsql security invoker set search_path = '' as $$
declare
  v_current public.company_finance_settings%rowtype;
  v_saved public.company_finance_settings%rowtype;
  v_charges jsonb;
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
  v_charges := coalesce(p_bank_charges_usd,v_current.bank_charges_usd);
  if not public.valid_company_bank_charges(v_charges) then
    raise exception 'Enter valid UBS and DBS charges from USD 0 to 1,000,000 with at most two decimal places.' using errcode='22023';
  end if;
  if p_annual_interest_rate_pct = v_current.annual_interest_rate_pct and v_charges = v_current.bank_charges_usd then return v_current; end if;
  update public.company_finance_settings set annual_interest_rate_pct=p_annual_interest_rate_pct, bank_charges_usd=v_charges,
    revision=revision+1, updated_by=p_actor_user_id, updated_by_email=(select email from public.user_profiles where id=p_actor_user_id), updated_at=clock_timestamp()
    where setting_key='company' returning * into v_saved;
  insert into public.company_finance_setting_events(previous_rate_pct,annual_interest_rate_pct,revision,actor_user_id,actor_email,previous_bank_charges_usd,bank_charges_usd)
    values(v_current.annual_interest_rate_pct,v_saved.annual_interest_rate_pct,v_saved.revision,p_actor_user_id,coalesce(v_saved.updated_by_email,p_actor_user_id::text),v_current.bank_charges_usd,v_saved.bank_charges_usd);
  return v_saved;
end;
$$;

revoke all on function public.save_company_finance_settings_v2(numeric,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_company_finance_settings_v2(numeric,bigint,uuid,jsonb) to service_role;
-- Older application instances preserve the latest charges when saving only the rate.
create or replace function public.save_company_finance_settings(
  p_annual_interest_rate_pct numeric, p_expected_revision bigint, p_actor_user_id uuid
) returns public.company_finance_settings
language sql security invoker set search_path='' as $$
  select public.save_company_finance_settings_v2(p_annual_interest_rate_pct,p_expected_revision,p_actor_user_id,null);
$$;
revoke all on function public.save_company_finance_settings(numeric,bigint,uuid) from public, anon, authenticated;
grant execute on function public.save_company_finance_settings(numeric,bigint,uuid) to service_role;
