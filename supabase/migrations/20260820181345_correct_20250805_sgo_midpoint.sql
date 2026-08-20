begin;

create table if not exists public.market_parser_correction_events (
  id uuid primary key default gen_random_uuid(),
  correction_key text not null unique,
  report_id uuid not null references public.market_report_imports(id) on delete restrict,
  series_id uuid not null references public.market_intelligence_series(id) on delete restrict,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  price_date date not null,
  previous_price numeric(18,6) not null,
  corrected_price numeric(18,6) not null,
  previous_day_change numeric(18,6),
  corrected_day_change numeric(18,6),
  reason_code text not null check (reason_code in ('SOURCE_MIDPOINT_PARSER_CORRECTION')),
  correction_hash text not null check (correction_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.market_parser_correction_events enable row level security;
revoke all on table public.market_parser_correction_events from public, anon, authenticated;
grant select, insert on table public.market_parser_correction_events to service_role;

create index if not exists market_parser_correction_report_idx
  on public.market_parser_correction_events(report_id);
create index if not exists market_parser_correction_series_idx
  on public.market_parser_correction_events(series_id);

drop trigger if exists market_parser_correction_events_immutable on public.market_parser_correction_events;
create trigger market_parser_correction_events_immutable
before update or delete on public.market_parser_correction_events
for each row execute function public.protect_market_intelligence_immutable();

do $$
declare
  v_import public.market_report_imports%rowtype;
  v_series public.market_intelligence_series%rowtype;
  v_evidence public.market_observation_evidence%rowtype;
  v_observation public.market_price_observations%rowtype;
  v_publication public.market_mops_publications%rowtype;
  v_ledger public.hedge_market_prices%rowtype;
  v_source_hash constant text := '5b4652df928a6d479d3bcc8bf47f377d127a704005bc0873c77322b4f59ced23';
begin
  select * into strict v_import
  from public.market_report_imports
  where source_document_type='european_marketscan'
    and report_date=date '2025-08-05'
    and source_hash=v_source_hash
  for update;

  select * into strict v_series
  from public.market_intelligence_series
  where source_symbol='POABC00' and active=true;

  select * into strict v_evidence
  from public.market_observation_evidence
  where import_id=v_import.id and series_id=v_series.id
  for update;

  select * into strict v_observation
  from public.market_price_observations
  where id=v_evidence.canonical_observation_id
  for update;

  select * into strict v_publication
  from public.market_mops_publications
  where import_id=v_import.id and source_hash=v_source_hash
  for update;

  select * into strict v_ledger
  from public.hedge_market_prices
  where id=v_publication.hedge_market_price_id and price_date=date '2025-08-05'
  for update;

  if v_evidence.price<>89.390000 or v_evidence.day_change is not null
     or v_evidence.source_page<>9 or v_evidence.disposition<>'accepted'
     or v_observation.price<>89.390000 or v_observation.day_change is not null
     or v_publication.sgo<>89.390000 or v_publication.s05<>498.830000
     or v_publication.s380<>406.410000 or v_publication.outcome<>'published'
     or v_ledger.sgo<>89.390000 or v_ledger.s05<>498.830000
     or v_ledger.s380<>406.410000 or v_ledger.is_estimate
     or v_ledger.verification_status<>'unverified'
  then
    raise exception 'MARKET_20250805_CORRECTION_PRECONDITION_FAILED';
  end if;

  insert into public.market_parser_correction_events(
    correction_key,report_id,series_id,source_hash,price_date,
    previous_price,corrected_price,previous_day_change,corrected_day_change,
    reason_code,correction_hash
  ) values (
    'eum:2025-08-05:POABC00:midpoint-v1',v_import.id,v_series.id,v_source_hash,date '2025-08-05',
    89.390000,89.410000,null,0.000000,'SOURCE_MIDPOINT_PARSER_CORRECTION',
    encode(extensions.digest(
      jsonb_build_object(
        'sourceHash',v_source_hash,'reportDate','2025-08-05','symbol','POABC00',
        'previousPrice',89.390000,'correctedPrice',89.410000,
        'previousDayChange',null,'correctedDayChange',0.000000,'sourcePage',9
      )::text,'sha256'
    ),'hex')
  ) on conflict(correction_key) do nothing;

  alter table public.market_observation_evidence disable trigger market_observation_evidence_immutable;
  update public.market_observation_evidence
  set price=89.410000,day_change=0.000000
  where id=v_evidence.id;
  alter table public.market_observation_evidence enable trigger market_observation_evidence_immutable;

  update public.market_price_observations
  set price=89.410000,day_change=0.000000
  where id=v_observation.id;

  update public.market_mops_publications
  set sgo=89.410000
  where id=v_publication.id;

  update public.hedge_market_prices
  set sgo=89.410000,
      source='European Marketscan · automated complete-triple publication · parser-corrected midpoint',
      revision=revision+1,
      updated_date=now()
  where id=v_ledger.id;
exception when no_data_found then
  raise exception 'MARKET_20250805_CORRECTION_TARGET_MISSING';
end;
$$;

commit;
