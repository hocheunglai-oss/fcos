create index if not exists market_intelligence_alert_events_report_idx
  on public.market_intelligence_alert_events(report_id)
  where report_id is not null;

create index if not exists market_intelligence_alert_events_series_idx
  on public.market_intelligence_alert_events(series_id)
  where series_id is not null;
