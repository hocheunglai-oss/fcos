begin;

-- The feature remains unreleased. Replace the staged library once more so a
-- multi-table page can never borrow a neighbouring table's unit. The replay
-- stores an unknown unit when page geometry cannot establish it uniquely.
truncate table public.market_report_product_observations;

update public.market_report_imports
set library_observation_count = 0
where library_observation_count <> 0;

commit;
