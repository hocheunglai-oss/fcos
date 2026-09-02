begin;

-- The product library has not yet been released. Clear the first backfill,
-- which was generated before positioned PDF columns were separated, then
-- replay the same immutable source hashes through the corrected parser.
truncate table public.market_report_product_observations;

update public.market_report_imports
set library_observation_count = 0
where library_observation_count <> 0;

drop view if exists public.market_report_product_catalogue;
create view public.market_report_product_catalogue
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
join latest_label using (source_document_type, source_symbol, observation_unit)
group by observations.source_document_type, observations.source_symbol,
  latest_label.product_name, latest_label.section_name, observations.observation_unit;

revoke all on table public.market_report_product_catalogue from public, anon, authenticated;
grant select on table public.market_report_product_catalogue to service_role;

comment on view public.market_report_product_catalogue is
  'Service-only stable product-code/unit series with the latest exact report label and complete licensed observation coverage.';

commit;
