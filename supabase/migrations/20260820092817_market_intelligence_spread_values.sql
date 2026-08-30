begin;

alter table public.market_intelligence_series
  add column if not exists value_kind text not null default 'absolute'
  check (value_kind in ('absolute', 'spread'));

update public.market_intelligence_series
set value_kind = 'spread'
where source_symbol in ('FQLSM01', 'FQLSM02');

alter table public.market_price_observations
  drop constraint if exists market_price_observations_price_check;

create or replace function public.validate_market_observation_value()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_value_kind text;
begin
  select value_kind into v_value_kind
  from public.market_intelligence_series
  where id = new.series_id;

  if not found then
    raise exception 'UNKNOWN_MARKET_SERIES_ID';
  end if;
  if new.price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'INVALID_MARKET_PRICE_VALUE';
  end if;
  if v_value_kind <> 'spread' and new.price <= 0 then
    raise exception 'INVALID_ABSOLUTE_MARKET_PRICE';
  end if;
  return new;
end;
$$;

drop trigger if exists market_price_observations_validate_value on public.market_price_observations;
create trigger market_price_observations_validate_value
before insert or update of series_id, price on public.market_price_observations
for each row execute function public.validate_market_observation_value();

create or replace function public.save_market_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_report_date date,
  p_observations jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.market_report_imports%rowtype;
  v_item jsonb;
  v_series public.market_intelligence_series%rowtype;
  v_price numeric;
  v_count integer := 0;
begin
  if coalesce(length(trim(p_idempotency_key)), 0) < 16 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_source_document_type not in ('bunkerwire', 'european_marketscan', 'manual') then
    raise exception 'INVALID_SOURCE_DOCUMENT_TYPE';
  end if;
  if coalesce(length(p_source_hash), 0) <> 64 then
    raise exception 'INVALID_SOURCE_HASH';
  end if;
  if jsonb_typeof(p_observations) <> 'array' or jsonb_array_length(p_observations) > 250 then
    raise exception 'INVALID_OBSERVATIONS';
  end if;

  select * into v_import
  from public.market_report_imports
  where idempotency_key = p_idempotency_key
     or (source_document_type = p_source_document_type and source_hash = p_source_hash)
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('id', v_import.id, 'status', 'replayed', 'observationCount', v_import.observation_count);
  end if;

  insert into public.market_report_imports (
    idempotency_key, source_document_type, source_hash, report_date,
    observation_count, actor_user_id, actor_email
  ) values (
    p_idempotency_key, p_source_document_type, p_source_hash, p_report_date,
    jsonb_array_length(p_observations), p_actor_user_id, lower(trim(p_actor_email))
  ) returning * into v_import;

  for v_item in select * from jsonb_array_elements(p_observations)
  loop
    select * into v_series
    from public.market_intelligence_series
    where source_symbol = upper(trim(v_item->>'sourceSymbol')) and active = true;
    if not found then
      raise exception 'UNKNOWN_MARKET_SERIES:%', coalesce(v_item->>'sourceSymbol', '');
    end if;

    begin
      v_price := (v_item->>'price')::numeric;
    exception when others then
      raise exception 'INVALID_MARKET_PRICE:%', v_series.source_symbol;
    end;
    if v_price::text in ('NaN', 'Infinity', '-Infinity')
       or (v_series.value_kind <> 'spread' and v_price <= 0) then
      raise exception 'INVALID_MARKET_PRICE:%', v_series.source_symbol;
    end if;

    insert into public.market_price_observations (
      series_id, import_id, price_date, price, day_change, quality_status,
      source_hash, source_page
    ) values (
      v_series.id, v_import.id, p_report_date, v_price,
      nullif(v_item->>'dayChange', '')::numeric,
      case when coalesce((v_item->>'isEstimate')::boolean, false) then 'estimate' else 'verified' end,
      p_source_hash, nullif(v_item->>'sourcePage', '')::integer
    )
    on conflict (series_id, price_date) do update set
      import_id = excluded.import_id,
      price = excluded.price,
      day_change = excluded.day_change,
      quality_status = excluded.quality_status,
      source_hash = excluded.source_hash,
      source_page = excluded.source_page;
    v_count := v_count + 1;
  end loop;

  insert into public.market_intelligence_events (
    event_type, entity_id, source_document_type, source_hash,
    observation_count, result_status, actor_user_id, actor_email
  ) values (
    'report_imported', v_import.id, p_source_document_type, p_source_hash,
    v_count, 'completed', p_actor_user_id, lower(trim(p_actor_email))
  );

  return jsonb_build_object('id', v_import.id, 'status', 'completed', 'observationCount', v_count);
end;
$$;

revoke all on function public.validate_market_observation_value() from public, anon, authenticated;
revoke all on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.validate_market_observation_value() to service_role;
grant execute on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text) to service_role;

commit;
