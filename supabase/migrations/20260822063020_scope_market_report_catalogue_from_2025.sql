begin;

truncate table public.market_report_product_catalogue;

with aggregate_rows as (
  select
    source_document_type,
    source_symbol,
    observation_unit,
    min(report_date) as first_report_date,
    max(report_date) as latest_report_date,
    count(*) filter (where quote_state = 'numeric')::bigint as numeric_observation_count,
    count(*) filter (where quote_state = 'published_na')::bigint as published_na_count
  from public.market_report_product_observations
  where report_date >= date '2025-01-01'
  group by source_document_type, source_symbol, observation_unit
)
insert into public.market_report_product_catalogue (
  source_document_type,
  source_symbol,
  series_unit_key,
  product_name,
  section_name,
  observation_unit,
  first_report_date,
  latest_report_date,
  numeric_observation_count,
  published_na_count
)
select
  aggregate_rows.source_document_type,
  aggregate_rows.source_symbol,
  coalesce(aggregate_rows.observation_unit, ''),
  latest_label.product_name,
  latest_label.section_name,
  aggregate_rows.observation_unit,
  aggregate_rows.first_report_date,
  aggregate_rows.latest_report_date,
  aggregate_rows.numeric_observation_count,
  aggregate_rows.published_na_count
from aggregate_rows
cross join lateral (
  select observations.product_name, observations.section_name
  from public.market_report_product_observations observations
  where observations.source_document_type = aggregate_rows.source_document_type
    and observations.source_symbol = aggregate_rows.source_symbol
    and observations.observation_unit is not distinct from aggregate_rows.observation_unit
    and observations.report_date >= date '2025-01-01'
  order by observations.report_date desc, observations.source_page desc, observations.source_order desc
  limit 1
) latest_label;

create or replace function public.refresh_market_report_product_catalogue_for_import()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('market_report_product_catalogue', 0));

  with affected_series as (
    select distinct
      source_document_type,
      source_symbol,
      observation_unit
    from public.market_report_product_observations
    where import_id = new.id
      and report_date >= date '2025-01-01'
  ),
  aggregate_rows as (
    select
      observations.source_document_type,
      observations.source_symbol,
      observations.observation_unit,
      min(observations.report_date) as first_report_date,
      max(observations.report_date) as latest_report_date,
      count(*) filter (where observations.quote_state = 'numeric')::bigint as numeric_observation_count,
      count(*) filter (where observations.quote_state = 'published_na')::bigint as published_na_count
    from public.market_report_product_observations observations
    join affected_series
      on affected_series.source_document_type = observations.source_document_type
     and affected_series.source_symbol = observations.source_symbol
     and affected_series.observation_unit is not distinct from observations.observation_unit
    where observations.report_date >= date '2025-01-01'
    group by observations.source_document_type, observations.source_symbol, observations.observation_unit
  )
  insert into public.market_report_product_catalogue (
    source_document_type,
    source_symbol,
    series_unit_key,
    product_name,
    section_name,
    observation_unit,
    first_report_date,
    latest_report_date,
    numeric_observation_count,
    published_na_count,
    updated_at
  )
  select
    aggregate_rows.source_document_type,
    aggregate_rows.source_symbol,
    coalesce(aggregate_rows.observation_unit, ''),
    latest_label.product_name,
    latest_label.section_name,
    aggregate_rows.observation_unit,
    aggregate_rows.first_report_date,
    aggregate_rows.latest_report_date,
    aggregate_rows.numeric_observation_count,
    aggregate_rows.published_na_count,
    now()
  from aggregate_rows
  cross join lateral (
    select observations.product_name, observations.section_name
    from public.market_report_product_observations observations
    where observations.source_document_type = aggregate_rows.source_document_type
      and observations.source_symbol = aggregate_rows.source_symbol
      and observations.observation_unit is not distinct from aggregate_rows.observation_unit
      and observations.report_date >= date '2025-01-01'
    order by observations.report_date desc, observations.source_page desc, observations.source_order desc
    limit 1
  ) latest_label
  on conflict (source_document_type, source_symbol, series_unit_key)
  do update set
    product_name = excluded.product_name,
    section_name = excluded.section_name,
    observation_unit = excluded.observation_unit,
    first_report_date = excluded.first_report_date,
    latest_report_date = excluded.latest_report_date,
    numeric_observation_count = excluded.numeric_observation_count,
    published_na_count = excluded.published_na_count,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function public.refresh_market_report_product_catalogue_for_import() from public, anon, authenticated;

comment on table public.market_report_product_catalogue is
  'Service-only materialized directory of licensed report product-code/unit series from 1 January 2025 onward; refreshed from immutable observations after each import.';

commit;
