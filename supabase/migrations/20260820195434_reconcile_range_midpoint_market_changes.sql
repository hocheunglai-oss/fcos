begin;

alter table public.market_parser_correction_events
  drop constraint if exists market_parser_correction_events_reason_code_check;
alter table public.market_parser_correction_events
  add constraint market_parser_correction_events_reason_code_check
  check (reason_code in (
    'SOURCE_MIDPOINT_PARSER_CORRECTION',
    'SOURCE_EXPLICIT_ZERO_DAY_CHANGE',
    'SOURCE_RANGE_MIDPOINT_PARSER_CORRECTION'
  ));

alter function public.save_market_report_import(text, text, text, date, jsonb, uuid, text)
  rename to save_market_report_import_explicit_zero_core;

-- A legacy Bunkerwire parser selected the low end of a one-dollar assessment
-- range when the printed daily change was zero. Accept only the exact reviewed
-- shape: same report hash/date/symbol/page, delivered assessment, unchanged
-- evidence, explicit zero change, and a midpoint exactly USD 0.50 above the
-- retained low endpoint. Every accepted correction is immutable and auditable.
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
  v_existing_import_id uuid;
  v_normalized_observations jsonb := '[]'::jsonb;
  v_corrections jsonb := '[]'::jsonb;
  v_item jsonb;
  v_normalized_item jsonb;
  v_series public.market_intelligence_series%rowtype;
  v_evidence public.market_observation_evidence%rowtype;
  v_canonical public.market_price_observations%rowtype;
  v_incoming_price numeric;
  v_result jsonb;
  v_import_id uuid;
  v_correction_count integer := 0;
begin
  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'INVALID_OBSERVATIONS';
  end if;

  select id
  into v_existing_import_id
  from public.market_report_imports
  where source_document_type = p_source_document_type
    and source_hash = p_source_hash
    and report_date = p_report_date
  order by created_at desc
  limit 1
  for update;

  for v_item in select * from jsonb_array_elements(p_observations)
  loop
    v_normalized_item := v_item;
    if v_existing_import_id is not null
       and p_source_document_type = 'bunkerwire'
       and v_item->>'dayChange' is not null
       and (v_item->>'dayChange')::numeric = 0 then
      select *
      into v_series
      from public.market_intelligence_series
      where source_symbol = upper(trim(v_item->>'sourceSymbol'))
        and active = true;

      if found
         and v_series.market_family = 'delivered'
         and v_series.source_type = 'assessment' then
        select *
        into v_evidence
        from public.market_observation_evidence
        where import_id = v_existing_import_id
          and series_id = v_series.id;

        if found and v_evidence.canonical_observation_id is not null then
          select *
          into v_canonical
          from public.market_price_observations
          where id = v_evidence.canonical_observation_id
          for update;

          v_incoming_price := (v_item->>'price')::numeric;
          if found
             and v_evidence.disposition in ('accepted', 'matching')
             and v_evidence.price_date = p_report_date
             and v_evidence.day_change is null
             and v_evidence.source_page is not distinct from nullif(v_item->>'sourcePage', '')::integer
             and v_incoming_price - v_evidence.price = 0.5
             and v_canonical.price in (v_evidence.price, v_incoming_price)
             and (v_canonical.day_change is null or v_canonical.day_change = 0) then
            v_normalized_item := jsonb_set(
              jsonb_set(v_item, '{price}', to_jsonb(v_evidence.price), true),
              '{dayChange}',
              'null'::jsonb,
              true
            );
            v_corrections := v_corrections || jsonb_build_array(jsonb_build_object(
              'seriesId', v_series.id,
              'canonicalId', v_canonical.id,
              'sourceSymbol', v_series.source_symbol,
              'previousPrice', v_evidence.price,
              'correctedPrice', v_incoming_price,
              'sourcePage', v_evidence.source_page
            ));
          end if;
        end if;
      end if;
    end if;
    v_normalized_observations := v_normalized_observations || jsonb_build_array(v_normalized_item);
  end loop;

  v_result := public.save_market_report_import_explicit_zero_core(
    p_idempotency_key,
    p_source_document_type,
    p_source_hash,
    p_report_date,
    v_normalized_observations,
    p_actor_user_id,
    p_actor_email
  );
  v_import_id := (v_result->>'id')::uuid;

  for v_item in select * from jsonb_array_elements(v_corrections)
  loop
    update public.market_price_observations
    set price = (v_item->>'correctedPrice')::numeric,
        day_change = 0
    where id = (v_item->>'canonicalId')::uuid
      and price in (
        (v_item->>'previousPrice')::numeric,
        (v_item->>'correctedPrice')::numeric
      )
      and (day_change is null or day_change = 0);

    insert into public.market_parser_correction_events(
      correction_key,
      report_id,
      series_id,
      source_hash,
      price_date,
      previous_price,
      corrected_price,
      previous_day_change,
      corrected_day_change,
      reason_code,
      correction_hash
    ) values (
      'range-midpoint:v1:' || p_source_hash || ':' || (v_item->>'sourceSymbol'),
      v_import_id,
      (v_item->>'seriesId')::uuid,
      p_source_hash,
      p_report_date,
      (v_item->>'previousPrice')::numeric,
      (v_item->>'correctedPrice')::numeric,
      null,
      0,
      'SOURCE_RANGE_MIDPOINT_PARSER_CORRECTION',
      encode(extensions.digest(
        jsonb_build_object(
          'sourceHash', p_source_hash,
          'reportDate', p_report_date,
          'symbol', v_item->>'sourceSymbol',
          'previousPrice', (v_item->>'previousPrice')::numeric,
          'correctedPrice', (v_item->>'correctedPrice')::numeric,
          'previousDayChange', null,
          'correctedDayChange', 0,
          'sourcePage', nullif(v_item->>'sourcePage', '')::integer
        )::text,
        'sha256'
      ), 'hex')
    ) on conflict (correction_key) do nothing;
    v_correction_count := v_correction_count + 1;
  end loop;

  return v_result || jsonb_build_object(
    'rangeMidpointCorrectionCount', v_correction_count
  );
end;
$$;

revoke all on function public.save_market_report_import_explicit_zero_core(text, text, text, date, jsonb, uuid, text)
  from public, anon, authenticated;
revoke all on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_market_report_import_explicit_zero_core(text, text, text, date, jsonb, uuid, text)
  to service_role;
grant execute on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text)
  to service_role;

commit;
