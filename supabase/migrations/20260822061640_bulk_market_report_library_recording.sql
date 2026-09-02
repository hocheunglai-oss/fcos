begin;

create or replace function public.record_market_report_product_library(
  p_import_id uuid,
  p_observations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.market_report_imports%rowtype;
  v_inserted integer := 0;
  v_total integer := 0;
begin
  if jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_observations, '[]'::jsonb)) > 2500 then
    raise exception 'INVALID_MARKET_REPORT_PRODUCT_LIBRARY';
  end if;

  select * into strict v_import
  from public.market_report_imports
  where id = p_import_id
  for update;
  if v_import.source_document_type not in ('bunkerwire', 'european_marketscan') then
    raise exception 'INVALID_MARKET_REPORT_LIBRARY_DOCUMENT_TYPE';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as item(
      "sourcePage" text,
      "sourceOrder" text,
      "rowHash" text,
      "sourceSymbol" text,
      "productName" text,
      "sectionName" text,
      "unit" text,
      "quoteState" text,
      "price" text,
      "bid" text,
      "ask" text,
      "dayChange" text
    )
    where coalesce(item."rowHash", '') !~ '^[a-f0-9]{64}$'
       or coalesce(upper(trim(item."sourceSymbol")), '') !~ '^[A-Z]{4,6}[0-9]{2,3}$'
       or length(trim(coalesce(item."productName", ''))) not between 2 and 220
       or coalesce(item."sourcePage", '') !~ '^[1-9][0-9]*$'
       or coalesce(item."sourceOrder", '') !~ '^[1-9][0-9]*$'
       or lower(trim(coalesce(item."quoteState", ''))) not in ('numeric', 'published_na')
       or (lower(trim(coalesce(item."quoteState", ''))) = 'numeric'
         and coalesce(item."price", '') !~ '^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$')
       or (lower(trim(coalesce(item."quoteState", ''))) = 'published_na'
         and (item."price" is not null or item."bid" is not null or item."ask" is not null or item."dayChange" is not null))
  ) then
    raise exception 'INVALID_MARKET_REPORT_PRODUCT_ROW';
  end if;

  insert into public.market_report_product_observations (
    import_id,
    report_date,
    source_document_type,
    source_hash,
    source_page,
    source_order,
    row_hash,
    source_symbol,
    product_name,
    section_name,
    observation_unit,
    quote_state,
    price,
    bid,
    ask,
    day_change
  )
  select
    v_import.id,
    v_import.report_date,
    v_import.source_document_type,
    v_import.source_hash,
    item."sourcePage"::integer,
    item."sourceOrder"::integer,
    lower(item."rowHash"),
    upper(trim(item."sourceSymbol")),
    trim(item."productName"),
    nullif(trim(item."sectionName"), ''),
    nullif(upper(trim(item."unit")), ''),
    lower(trim(item."quoteState")),
    nullif(item."price", '')::numeric,
    nullif(item."bid", '')::numeric,
    nullif(item."ask", '')::numeric,
    nullif(item."dayChange", '')::numeric
  from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as item(
    "sourcePage" text,
    "sourceOrder" text,
    "rowHash" text,
    "sourceSymbol" text,
    "productName" text,
    "sectionName" text,
    "unit" text,
    "quoteState" text,
    "price" text,
    "bid" text,
    "ask" text,
    "dayChange" text
  )
  on conflict (import_id, row_hash) do nothing;
  get diagnostics v_inserted = row_count;

  select count(*) into v_total
  from public.market_report_product_observations
  where import_id = v_import.id;

  update public.market_report_imports
  set library_observation_count = v_total
  where id = v_import.id;

  return jsonb_build_object(
    'importId', v_import.id,
    'libraryObservationCount', v_total,
    'libraryInsertedCount', v_inserted
  );
exception when no_data_found then
  raise exception 'MARKET_REPORT_IMPORT_NOT_FOUND';
end;
$$;

revoke all on function public.record_market_report_product_library(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_market_report_product_library(uuid,jsonb) to service_role;

comment on function public.record_market_report_product_library(uuid,jsonb) is
  'Validates and records one licensed report product library atomically with a bounded bulk insert.';

commit;
