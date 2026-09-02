begin;

alter table public.market_report_imports
  add column if not exists library_observation_count integer not null default 0;

alter table public.market_report_imports
  drop constraint if exists market_report_imports_library_observation_count_check;
alter table public.market_report_imports
  add constraint market_report_imports_library_observation_count_check
  check (library_observation_count >= 0);

create table if not exists public.market_report_product_observations (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.market_report_imports(id) on delete restrict,
  report_date date not null,
  source_document_type text not null check (source_document_type in ('bunkerwire', 'european_marketscan')),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  source_page integer not null check (source_page > 0),
  source_order integer not null check (source_order > 0),
  row_hash text not null check (row_hash ~ '^[a-f0-9]{64}$'),
  source_symbol text not null check (source_symbol ~ '^[A-Z]{4,6}[0-9]{2,3}$'),
  product_name text not null check (length(trim(product_name)) between 2 and 220),
  section_name text check (section_name is null or length(trim(section_name)) between 2 and 180),
  observation_unit text check (observation_unit is null or length(observation_unit) between 1 and 32),
  quote_state text not null check (quote_state in ('numeric', 'published_na')),
  price numeric(24, 9),
  bid numeric(24, 9),
  ask numeric(24, 9),
  day_change numeric(24, 9),
  created_at timestamptz not null default now(),
  unique (import_id, row_hash),
  check (
    (quote_state = 'numeric' and price is not null)
    or (quote_state = 'published_na' and price is null and bid is null and ask is null and day_change is null)
  ),
  check (price is null or abs(price) <= 1000000000),
  check (bid is null or abs(bid) <= 1000000000),
  check (ask is null or abs(ask) <= 1000000000),
  check (day_change is null or abs(day_change) <= 1000000000)
);

create index if not exists market_report_product_observations_symbol_date_idx
  on public.market_report_product_observations (source_symbol, report_date desc, source_document_type);
create index if not exists market_report_product_observations_name_idx
  on public.market_report_product_observations (lower(product_name), report_date desc);
create index if not exists market_report_product_observations_report_idx
  on public.market_report_product_observations (report_date desc, source_document_type, source_page, source_order);

alter table public.market_report_product_observations enable row level security;
revoke all on table public.market_report_product_observations from public, anon, authenticated;
grant select, insert on table public.market_report_product_observations to service_role;

drop trigger if exists market_report_product_observations_immutable on public.market_report_product_observations;
create trigger market_report_product_observations_immutable
before update or delete on public.market_report_product_observations
for each row execute function public.protect_market_intelligence_immutable();

create or replace view public.market_report_product_catalogue
with (security_invoker = true)
as
select
  source_document_type,
  source_symbol,
  product_name,
  section_name,
  observation_unit,
  min(report_date) as first_report_date,
  max(report_date) as latest_report_date,
  count(*) filter (where quote_state = 'numeric')::bigint as numeric_observation_count,
  count(*) filter (where quote_state = 'published_na')::bigint as published_na_count
from public.market_report_product_observations
group by source_document_type, source_symbol, product_name, section_name, observation_unit;

revoke all on table public.market_report_product_catalogue from public, anon, authenticated;
grant select on table public.market_report_product_catalogue to service_role;

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
  v_item jsonb;
  v_inserted integer := 0;
  v_total integer := 0;
  v_quote_state text;
begin
  if jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_observations, '[]'::jsonb)) > 2500 then
    raise exception 'INVALID_MARKET_REPORT_PRODUCT_LIBRARY';
  end if;
  select * into strict v_import from public.market_report_imports where id = p_import_id for update;
  if v_import.source_document_type not in ('bunkerwire', 'european_marketscan') then
    raise exception 'INVALID_MARKET_REPORT_LIBRARY_DOCUMENT_TYPE';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_observations, '[]'::jsonb))
  loop
    v_quote_state := lower(trim(v_item->>'quoteState'));
    if coalesce(v_item->>'rowHash', '') !~ '^[a-f0-9]{64}$'
       or coalesce(upper(trim(v_item->>'sourceSymbol')), '') !~ '^[A-Z]{4,6}[0-9]{2,3}$'
       or length(trim(coalesce(v_item->>'productName', ''))) not between 2 and 220
       or v_quote_state not in ('numeric', 'published_na')
       or nullif(v_item->>'sourcePage', '')::integer <= 0
       or nullif(v_item->>'sourceOrder', '')::integer <= 0 then
      raise exception 'INVALID_MARKET_REPORT_PRODUCT_ROW';
    end if;
    if v_quote_state = 'numeric' and nullif(v_item->>'price', '') is null then
      raise exception 'INVALID_MARKET_REPORT_PRODUCT_PRICE';
    end if;
    if v_quote_state = 'published_na' and (
      nullif(v_item->>'price', '') is not null
      or nullif(v_item->>'bid', '') is not null
      or nullif(v_item->>'ask', '') is not null
      or nullif(v_item->>'dayChange', '') is not null
    ) then
      raise exception 'INVALID_MARKET_REPORT_PRODUCT_NA';
    end if;

    insert into public.market_report_product_observations (
      import_id, report_date, source_document_type, source_hash,
      source_page, source_order, row_hash, source_symbol, product_name, section_name,
      observation_unit, quote_state, price, bid, ask, day_change
    ) values (
      v_import.id, v_import.report_date, v_import.source_document_type, v_import.source_hash,
      (v_item->>'sourcePage')::integer, (v_item->>'sourceOrder')::integer,
      lower(v_item->>'rowHash'), upper(trim(v_item->>'sourceSymbol')), trim(v_item->>'productName'), nullif(trim(v_item->>'sectionName'), ''),
      nullif(upper(trim(v_item->>'unit')), ''), v_quote_state,
      nullif(v_item->>'price', '')::numeric, nullif(v_item->>'bid', '')::numeric,
      nullif(v_item->>'ask', '')::numeric, nullif(v_item->>'dayChange', '')::numeric
    )
    on conflict (import_id, row_hash) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

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

create or replace function public.save_market_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_report_date date,
  p_observations jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_availability jsonb,
  p_library_observations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_result jsonb; v_library jsonb;
begin
  v_result := public.save_market_report_import(
    p_idempotency_key, p_source_document_type, p_source_hash, p_report_date,
    p_observations, p_actor_user_id, p_actor_email, p_availability
  );
  v_library := public.record_market_report_product_library(
    (v_result->>'id')::uuid, coalesce(p_library_observations, '[]'::jsonb)
  );
  return v_result || jsonb_build_object(
    'libraryObservationCount', v_library->'libraryObservationCount',
    'libraryInsertedCount', v_library->'libraryInsertedCount'
  );
end;
$$;

create or replace function public.save_market_drive_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_source_md5 text,
  p_drive_file_id text,
  p_drive_modified_at timestamptz,
  p_report_date date,
  p_observations jsonb,
  p_availability jsonb,
  p_library_observations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_result jsonb; v_library jsonb;
begin
  v_result := public.save_market_drive_report_import(
    p_idempotency_key, p_source_document_type, p_source_hash, p_source_md5,
    p_drive_file_id, p_drive_modified_at, p_report_date, p_observations, p_availability
  );
  v_library := public.record_market_report_product_library(
    (v_result->>'id')::uuid, coalesce(p_library_observations, '[]'::jsonb)
  );
  return v_result || jsonb_build_object(
    'libraryObservationCount', v_library->'libraryObservationCount',
    'libraryInsertedCount', v_library->'libraryInsertedCount'
  );
end;
$$;

revoke all on function public.record_market_report_product_library(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.save_market_report_import(text,text,text,date,jsonb,uuid,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.save_market_drive_report_import(text,text,text,text,text,timestamptz,date,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_market_report_product_library(uuid,jsonb) to service_role;
grant execute on function public.save_market_report_import(text,text,text,date,jsonb,uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.save_market_drive_report_import(text,text,text,text,text,timestamptz,date,jsonb,jsonb,jsonb) to service_role;

comment on table public.market_report_product_observations is
  'Immutable service-only structured product names, codes and reported prices extracted from licensed market reports; no PDF bytes, report prose, prompts or model responses.';
comment on view public.market_report_product_catalogue is
  'Service-only catalogue of exact product-name/code/unit variants present in licensed structured report observations.';

commit;
