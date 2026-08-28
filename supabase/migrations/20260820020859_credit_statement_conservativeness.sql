alter table public.cashflow_forecast_settings
  add column if not exists credit_statement_conservativeness text not null default 'cautious';

alter table public.cashflow_forecast_settings
  drop constraint if exists cashflow_forecast_settings_credit_statement_conservativeness_check;

alter table public.cashflow_forecast_settings
  add constraint cashflow_forecast_settings_credit_statement_conservativeness_check
  check (credit_statement_conservativeness in ('typical', 'cautious', 'severe'));

create or replace function public.save_credit_statement_conservativeness(
  p_conservativeness text,
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
  v_current public.cashflow_forecast_settings%rowtype;
  v_saved public.cashflow_forecast_settings%rowtype;
  v_level text := lower(btrim(coalesce(p_conservativeness, '')));
begin
  if v_level not in ('typical', 'cautious', 'severe') then
    raise exception using errcode = '22023', message = 'Credit forecast conservativeness is invalid.';
  end if;

  select *
  into v_current
  from public.cashflow_forecast_settings
  where id = 'default'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cashflow forecast settings are unavailable.';
  end if;

  if p_expected_updated_at is not null
    and v_current.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'Credit forecast settings changed after they were opened.';
  end if;

  update public.cashflow_forecast_settings
  set credit_statement_conservativeness = v_level,
      updated_by = p_actor_user_id,
      updated_by_email = nullif(lower(btrim(coalesce(p_actor_email, ''))), ''),
      updated_at = clock_timestamp()
  where id = 'default'
  returning * into v_saved;

  return jsonb_build_object(
    'conservativeness', v_saved.credit_statement_conservativeness,
    'updatedAt', v_saved.updated_at,
    'updatedByEmail', v_saved.updated_by_email
  );
end;
$$;

alter table public.cashflow_forecast_settings enable row level security;
revoke all on table public.cashflow_forecast_settings from anon, authenticated;
grant all on table public.cashflow_forecast_settings to service_role;

revoke all on function public.save_credit_statement_conservativeness(text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_credit_statement_conservativeness(text, uuid, text, timestamptz) to service_role;
