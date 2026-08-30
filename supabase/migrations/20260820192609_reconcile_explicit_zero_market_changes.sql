begin;

alter table public.market_parser_correction_events
  drop constraint if exists market_parser_correction_events_reason_code_check;
alter table public.market_parser_correction_events
  add constraint market_parser_correction_events_reason_code_check
  check (reason_code in (
    'SOURCE_MIDPOINT_PARSER_CORRECTION',
    'SOURCE_EXPLICIT_ZERO_DAY_CHANGE'
  ));

-- Earlier parser revisions represented an explicitly printed unchanged value
-- as null. Keep the original report evidence immutable, record the reviewed
-- correction separately, and update only the canonical derived observation.
-- Every correction is bound to the same report hash, date, symbol, page and
-- price before the canonical importer is allowed to replay the report.
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
  v_original_publishable jsonb;
  v_publishable jsonb := '[]'::jsonb;
  v_nonpublication jsonb;
  v_result jsonb;
  v_import_id uuid;
  v_existing_import_id uuid;
  v_item jsonb;
  v_normalized_item jsonb;
  v_series public.market_intelligence_series%rowtype;
  v_evidence public.market_observation_evidence%rowtype;
  v_canonical public.market_price_observations%rowtype;
  v_price numeric;
  v_day_change numeric;
  v_zero_corrections jsonb := '[]'::jsonb;
  v_correction_count integer := 0;
begin
  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'INVALID_OBSERVATIONS';
  end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into v_original_publishable
  from jsonb_array_elements(p_observations) item
  where coalesce((item->'basisMetadata'->>'publicationEligible')::boolean, true) = true;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into v_nonpublication
  from jsonb_array_elements(p_observations) item
  where coalesce((item->'basisMetadata'->>'publicationEligible')::boolean, true) = false;

  select id
  into v_existing_import_id
  from public.market_report_imports
  where source_document_type = p_source_document_type
    and source_hash = p_source_hash
    and report_date = p_report_date
  order by created_at desc
  limit 1
  for update;

  for v_item in select * from jsonb_array_elements(v_original_publishable)
  loop
    v_normalized_item := v_item;
    if v_existing_import_id is not null
       and v_item->>'dayChange' is not null
       and (v_item->>'dayChange')::numeric = 0 then
      select *
      into v_series
      from public.market_intelligence_series
      where source_symbol = upper(trim(v_item->>'sourceSymbol'))
        and active = true;

      if found then
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

          v_price := (v_item->>'price')::numeric;
          if found
             and v_evidence.disposition in ('accepted', 'matching')
             and v_evidence.price_date = p_report_date
             and v_evidence.price = v_price
             and v_evidence.day_change is null
             and v_evidence.source_page is not distinct from nullif(v_item->>'sourcePage', '')::integer
             and v_canonical.price = v_price
             and (v_canonical.day_change is null or v_canonical.day_change = 0) then
            v_normalized_item := jsonb_set(v_item, '{dayChange}', 'null'::jsonb, true);
            v_zero_corrections := v_zero_corrections || jsonb_build_array(jsonb_build_object(
              'seriesId', v_series.id,
              'canonicalId', v_canonical.id,
              'sourceSymbol', v_series.source_symbol,
              'price', v_price,
              'sourcePage', v_evidence.source_page
            ));
          end if;
        end if;
      end if;
    end if;
    v_publishable := v_publishable || jsonb_build_array(v_normalized_item);
  end loop;

  v_result := public.save_market_report_import_canonical_core(
    p_idempotency_key,
    p_source_document_type,
    p_source_hash,
    p_report_date,
    v_publishable,
    p_actor_user_id,
    p_actor_email
  );
  v_import_id := (v_result->>'id')::uuid;
  perform public.enrich_market_import_observations(v_import_id, v_publishable);

  for v_item in select * from jsonb_array_elements(v_zero_corrections)
  loop
    update public.market_price_observations
    set day_change = 0
    where id = (v_item->>'canonicalId')::uuid
      and price = (v_item->>'price')::numeric
      and day_change is null;

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
      'explicit-zero-day-change:v1:' || p_source_hash || ':' || (v_item->>'sourceSymbol'),
      v_import_id,
      (v_item->>'seriesId')::uuid,
      p_source_hash,
      p_report_date,
      (v_item->>'price')::numeric,
      (v_item->>'price')::numeric,
      null,
      0,
      'SOURCE_EXPLICIT_ZERO_DAY_CHANGE',
      encode(extensions.digest(
        jsonb_build_object(
          'sourceHash', p_source_hash,
          'reportDate', p_report_date,
          'symbol', v_item->>'sourceSymbol',
          'price', (v_item->>'price')::numeric,
          'previousDayChange', null,
          'correctedDayChange', 0,
          'sourcePage', nullif(v_item->>'sourcePage', '')::integer
        )::text,
        'sha256'
      ), 'hex')
    ) on conflict (correction_key) do nothing;
    v_correction_count := v_correction_count + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(v_nonpublication)
  loop
    select *
    into strict v_series
    from public.market_intelligence_series
    where source_symbol = upper(trim(v_item->>'sourceSymbol'))
      and active = true;
    v_price := (v_item->>'price')::numeric;
    v_day_change := nullif(v_item->>'dayChange', '')::numeric;
    if v_price::text in ('NaN', 'Infinity', '-Infinity')
       or (v_series.value_kind <> 'spread' and v_price <= 0) then
      raise exception 'INVALID_MARKET_PRICE:%', v_series.source_symbol;
    end if;
    insert into public.market_observation_evidence(
      import_id, series_id, price_date, price, day_change, source_hash, source_page,
      disposition, canonical_observation_id, conflict_code, contract_month,
      printed_contract_month, tenor, observation_unit, assessment_session,
      basis_metadata, basis_enriched_at
    ) values (
      v_import_id, v_series.id, p_report_date, v_price, v_day_change, p_source_hash,
      nullif(v_item->>'sourcePage', '')::integer, 'quarantined', null,
      'NON_PUBLICATION_DAY_REPRINT', nullif(v_item->>'contractMonth', '')::date,
      nullif(v_item->>'printedContractMonth', '')::date,
      nullif(lower(v_item->>'tenor'), ''), nullif(v_item->>'unit', ''),
      nullif(v_item->>'assessmentSession', ''),
      coalesce(v_item->'basisMetadata', '{}'::jsonb), now()
    ) on conflict (import_id, series_id) do nothing;
  end loop;

  update public.market_report_imports
  set observation_count = jsonb_array_length(p_observations)
  where id = v_import_id;
  update public.market_intelligence_events
  set observation_count = jsonb_array_length(p_observations)
  where entity_id = v_import_id
    and event_type = 'report_imported';

  return v_result || jsonb_build_object(
    'observationCount', jsonb_array_length(p_observations),
    'nonPublicationEvidenceCount', jsonb_array_length(v_nonpublication),
    'explicitZeroCorrectionCount', v_correction_count
  );
exception
  when no_data_found then
    raise exception 'UNKNOWN_MARKET_SERIES';
end;
$$;

revoke all on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text)
  to service_role;

comment on table public.market_parser_correction_events is
  'Immutable, source-bound corrections for deterministic market parser improvements; no PDF or report prose.';

commit;
