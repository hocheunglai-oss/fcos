begin;

create or replace view public.market_report_product_catalogue
with (security_invoker = true)
as
with latest_label as (
  select distinct on (source_document_type, source_symbol, observation_unit)
    source_document_type,
    source_symbol,
    observation_unit,
    product_name,
    section_name
  from public.market_report_product_observations
  order by source_document_type, source_symbol, observation_unit,
    report_date desc, source_page desc, source_order desc
)
select
  observations.source_document_type,
  observations.source_symbol,
  latest_label.product_name,
  latest_label.section_name,
  observations.observation_unit,
  min(observations.report_date) as first_report_date,
  max(observations.report_date) as latest_report_date,
  count(*) filter (where observations.quote_state = 'numeric')::bigint as numeric_observation_count,
  count(*) filter (where observations.quote_state = 'published_na')::bigint as published_na_count
from public.market_report_product_observations observations
join latest_label
  on latest_label.source_document_type = observations.source_document_type
 and latest_label.source_symbol = observations.source_symbol
 and latest_label.observation_unit is not distinct from observations.observation_unit
group by observations.source_document_type, observations.source_symbol,
  latest_label.product_name, latest_label.section_name, observations.observation_unit;

revoke all on table public.market_report_product_catalogue from public, anon, authenticated;
grant select on table public.market_report_product_catalogue to service_role;

commit;
