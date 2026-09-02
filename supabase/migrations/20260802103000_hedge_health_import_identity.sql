begin;

create unique index if not exists hedge_health_legacy_source_unique_idx
  on public.hedge_health_history (legacy_source_id);

commit;
