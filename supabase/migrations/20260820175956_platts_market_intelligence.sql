begin;

alter table public.market_intelligence_series
  add column if not exists tenor text,
  add column if not exists assessment_session text,
  add column if not exists basis_metadata jsonb not null default '{}'::jsonb;

alter table public.market_price_observations
  add column if not exists contract_month date,
  add column if not exists printed_contract_month date,
  add column if not exists tenor text,
  add column if not exists observation_unit text,
  add column if not exists assessment_session text,
  add column if not exists basis_metadata jsonb not null default '{}'::jsonb;
alter table public.market_price_observations
  drop constraint if exists market_price_observations_quality_status_check,
  add constraint market_price_observations_quality_status_check
    check (quality_status in ('verified','estimate','quarantined'));

alter table public.market_observation_evidence
  add column if not exists contract_month date,
  add column if not exists printed_contract_month date,
  add column if not exists tenor text,
  add column if not exists observation_unit text,
  add column if not exists assessment_session text,
  add column if not exists basis_metadata jsonb not null default '{}'::jsonb,
  add column if not exists basis_enriched_at timestamptz;

alter table public.market_intelligence_series
  drop constraint if exists market_intelligence_series_tenor_check,
  add constraint market_intelligence_series_tenor_check
    check (tenor is null or tenor in ('spot','bm','m0','m1','m2','m3','m4','m5','m6','other'));
alter table public.market_price_observations
  drop constraint if exists market_price_observations_tenor_check,
  add constraint market_price_observations_tenor_check
    check (tenor is null or tenor in ('spot','bm','m0','m1','m2','m3','m4','m5','m6','other')),
  drop constraint if exists market_price_observations_contract_month_first_check,
  add constraint market_price_observations_contract_month_first_check
    check (contract_month is null or contract_month = date_trunc('month', contract_month)::date),
  drop constraint if exists market_price_observations_printed_month_first_check,
  add constraint market_price_observations_printed_month_first_check
    check (printed_contract_month is null or printed_contract_month = date_trunc('month', printed_contract_month)::date);
alter table public.market_observation_evidence
  drop constraint if exists market_observation_evidence_tenor_check,
  add constraint market_observation_evidence_tenor_check
    check (tenor is null or tenor in ('spot','bm','m0','m1','m2','m3','m4','m5','m6','other')),
  drop constraint if exists market_observation_evidence_contract_month_first_check,
  add constraint market_observation_evidence_contract_month_first_check
    check (contract_month is null or contract_month=date_trunc('month',contract_month)::date),
  drop constraint if exists market_observation_evidence_printed_month_first_check,
  add constraint market_observation_evidence_printed_month_first_check
    check (printed_contract_month is null or printed_contract_month=date_trunc('month',printed_contract_month)::date);

create index if not exists market_price_observations_contract_idx
  on public.market_price_observations (contract_month desc, series_id, price_date desc);

update public.market_intelligence_series
set tenor = case source_symbol
      when 'FOFS000' then 'bm' when 'FOFS001' then 'm1' when 'FOFS002' then 'm2'
      when 'FPLSM01' then 'm1' when 'FPLSM02' then 'm2'
      when 'FQLSM01' then 'm1' when 'FQLSM02' then 'm2'
      when 'BSGSL00' then 'bm' when 'MSGSL00' then 'm1' when 'MSHSL00' then 'm2'
      else coalesce(tenor, case when market_family in ('delivered','cargo') then 'spot' end)
    end,
    assessment_session = case
      when source_symbol in ('FPLSM01','FPLSM02','FQLSM01','FQLSM02','BSGSL00','MSGSL00','MSHSL00') then 'london_moc'
      when source_type = 'posted' then 'posted'
      when port_key in ('singapore','south-korea','south-korea-west','zhoushan','hong-kong','kaohsiung') then 'asia_moc'
      else coalesce(assessment_session, 'daily_assessment')
    end,
    basis_metadata = coalesce(basis_metadata, '{}'::jsonb)
      || jsonb_build_object('productKey', product_key, 'marketFamily', market_family, 'portKey', port_key)
where active = true;

-- The original family constraint predates deterministic cross-market context.
alter table public.market_intelligence_series
  drop constraint if exists market_intelligence_series_market_family_check;
alter table public.market_intelligence_series
  add constraint market_intelligence_series_market_family_check
  check (market_family in ('delivered','cargo','forward','context','compliance'));

insert into public.market_intelligence_series (
  market_family, port_key, port_label, product_key, product_label, alias_label,
  source_symbol, source_type, unit, value_kind, basis_note, display_order,
  tenor, assessment_session, basis_metadata
) values
  ('forward','singapore','Singapore','lsmgo-bm','Gasoil 10ppm balance month','BM','BSGSL00','assessment','USD/BBL','absolute','Singapore gasoil 10ppm at London MOC',710,'bm','london_moc','{"productKey":"lsmgo","settlementBasis":"outright"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-assessment-p1','ICE LSGO 16:30 prompt 1','Prompt 1','AARIN00','assessment','USD/MT','absolute','Platts ICE 16:30 London assessment',801,'other','london_1630','{"productKey":"lsmgo","contextType":"ice_lsgo_assessment","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-assessment-p2','ICE LSGO 16:30 prompt 2','Prompt 2','AARIO00','assessment','USD/MT','absolute','Platts ICE 16:30 London assessment',802,'other','london_1630','{"productKey":"lsmgo","contextType":"ice_lsgo_assessment","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-assessment-p3','ICE LSGO 16:30 prompt 3','Prompt 3','AARIP00','assessment','USD/MT','absolute','Platts ICE 16:30 London assessment',803,'other','london_1630','{"productKey":"lsmgo","contextType":"ice_lsgo_assessment","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-brent-p1','ICE Brent 16:30 prompt 1','Prompt 1','AAYES00','assessment','USD/BBL','absolute','Platts ICE 16:30 London assessment',811,'other','london_1630','{"contextType":"ice_brent","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-brent-p2','ICE Brent 16:30 prompt 2','Prompt 2','AAYET00','assessment','USD/BBL','absolute','Platts ICE 16:30 London assessment',812,'other','london_1630','{"contextType":"ice_brent","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-brent-p3','ICE Brent 16:30 prompt 3','Prompt 3','AAXZY00','assessment','USD/BBL','absolute','Platts ICE 16:30 London assessment',813,'other','london_1630','{"contextType":"ice_brent","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-brent-p4','ICE Brent 16:30 prompt 4','Prompt 4','AAYAM00','assessment','USD/BBL','absolute','Platts ICE 16:30 London assessment',814,'other','london_1630','{"contextType":"ice_brent","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-settlement-p1','ICE LSGO settlement prompt 1','Prompt 1','ICLO001','assessment','USD/MT','absolute','ICE LSGO settlement',821,'other','london_settlement','{"productKey":"lsmgo","contextType":"ice_lsgo_settlement","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-settlement-p2','ICE LSGO settlement prompt 2','Prompt 2','ICLO002','assessment','USD/MT','absolute','ICE LSGO settlement',822,'other','london_settlement','{"productKey":"lsmgo","contextType":"ice_lsgo_settlement","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-settlement-p3','ICE LSGO settlement prompt 3','Prompt 3','ICLO003','assessment','USD/MT','absolute','ICE LSGO settlement',823,'other','london_settlement','{"productKey":"lsmgo","contextType":"ice_lsgo_settlement","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-settlement-p4','ICE LSGO settlement prompt 4','Prompt 4','ICLO004','assessment','USD/MT','absolute','ICE LSGO settlement',824,'other','london_settlement','{"productKey":"lsmgo","contextType":"ice_lsgo_settlement","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-settlement-p5','ICE LSGO settlement prompt 5','Prompt 5','ICLO005','assessment','USD/MT','absolute','ICE LSGO settlement',825,'other','london_settlement','{"productKey":"lsmgo","contextType":"ice_lsgo_settlement","contractAuthority":"printed"}'::jsonb),
  ('context','ice','ICE','ice-lsgo-settlement-p6','ICE LSGO settlement prompt 6','Prompt 6','ICLO006','assessment','USD/MT','absolute','ICE LSGO settlement',826,'other','london_settlement','{"productKey":"lsmgo","contextType":"ice_lsgo_settlement","contractAuthority":"printed"}'::jsonb),
  ('context','singapore','Singapore','gasoil-efs-bm','Gasoil EFS balance month','BM','MSJSL00','assessment','USD/MT','spread','Gasoil EFS at 16:30 London',831,'bm','london_1630','{"productKey":"lsmgo","contextType":"gasoil_efs"}'::jsonb),
  ('context','singapore','Singapore','gasoil-efs-m0','Gasoil EFS current month','M0','MSKSL00','assessment','USD/MT','spread','Gasoil EFS at 16:30 London',832,'m0','london_1630','{"productKey":"lsmgo","contextType":"gasoil_efs"}'::jsonb),
  ('context','singapore','Singapore','gasoil-efs-m1','Gasoil EFS M1','M1','MSLSL00','assessment','USD/MT','spread','Gasoil EFS at 16:30 London',833,'m1','london_1630','{"productKey":"lsmgo","contextType":"gasoil_efs"}'::jsonb),
  ('context','singapore','Singapore','gasoil-efs-m2','Gasoil EFS M2','M2','MSMSL00','assessment','USD/MT','spread','Gasoil EFS at 16:30 London',834,'m2','london_1630','{"productKey":"lsmgo","contextType":"gasoil_efs"}'::jsonb)
on conflict (market_family, port_key, product_key) do update set
  product_label = excluded.product_label,
  alias_label = excluded.alias_label,
  source_symbol = excluded.source_symbol,
  source_type = excluded.source_type,
  unit = excluded.unit,
  value_kind = excluded.value_kind,
  basis_note = excluded.basis_note,
  display_order = excluded.display_order,
  tenor = excluded.tenor,
  assessment_session = excluded.assessment_session,
  basis_metadata = excluded.basis_metadata,
  active = true;

create table if not exists public.market_forward_fallback_marks (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 200),
  product_key text not null check (product_key in ('hsfo380','vlsfo','lsmgo')),
  contract_month date not null check (contract_month = date_trunc('month', contract_month)::date),
  unit text not null check (unit in ('USD/MT','USD/BBL')),
  outright_value numeric(18,6) not null check (outright_value > 0),
  as_of_date date not null,
  source_note text not null check (length(trim(source_note)) between 3 and 500),
  reason_hash text not null check (reason_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check (status in ('active','expired','superseded')),
  expires_on date not null,
  expiry_reason text,
  revision bigint not null default 1,
  actor_user_id uuid not null,
  actor_email text not null,
  created_at timestamptz not null default now(),
  expired_at timestamptz
  ,constraint market_forward_fallback_product_unit_check check (
    (product_key in ('hsfo380','vlsfo') and unit='USD/MT') or (product_key='lsmgo' and unit='USD/BBL')
  )
);
create unique index if not exists market_forward_fallback_active_unique
  on public.market_forward_fallback_marks(product_key,contract_month) where status = 'active';

create table if not exists public.market_intelligence_briefs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  as_of_at timestamptz not null,
  completeness jsonb not null default '{}'::jsonb,
  deterministic_metrics jsonb not null default '{}'::jsonb,
  ai_status text not null check (ai_status in ('not_requested','completed','unavailable','failed','invalid')),
  model_id text,
  source_refs jsonb not null default '[]'::jsonb,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  unique(report_date,source_hash,revision)
);

create table if not exists public.market_intelligence_brief_items (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.market_intelligence_briefs(id) on delete restrict,
  item_order integer not null check (item_order between 1 and 100),
  item_kind text not null check (item_kind in ('curve_regime','material_change','port_dislocation','physical_paper','driver','risk','data_quality')),
  title text not null check (length(title) between 1 and 160),
  summary text not null check (length(summary) between 1 and 1200),
  driver_tags text[] not null default '{}',
  direction text check (direction is null or direction in ('supportive','bearish','mixed','neutral','unclear')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  product_key text,
  port_key text,
  horizon text,
  source_refs jsonb not null default '[]'::jsonb,
  numeric_facts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(brief_id,item_order)
);

create table if not exists public.market_intelligence_alert_rules (
  id text primary key default 'company' check (id = 'company'),
  enabled boolean not null default true,
  outright_floor_usd_mt numeric(18,6) not null default 10 check (outright_floor_usd_mt >= 0),
  spread_floor_usd_mt numeric(18,6) not null default 5 check (spread_floor_usd_mt >= 0),
  gasoil_floor_usd_bbl numeric(18,6) not null default 1 check (gasoil_floor_usd_bbl >= 0),
  percentile numeric(5,4) not null default .95 check (percentile between .5 and 1),
  lookback_days integer not null default 60 check (lookback_days between 20 and 366),
  minimum_samples integer not null default 20 check (minimum_samples between 5 and 500),
  curve_deadband_usd_mt numeric(18,6) not null default 2 check (curve_deadband_usd_mt >= 0),
  curve_deadband_usd_bbl numeric(18,6) not null default .25 check (curve_deadband_usd_bbl >= 0),
  revision bigint not null default 1,
  updated_by uuid,
  updated_by_email text,
  updated_at timestamptz not null default now()
);
insert into public.market_intelligence_alert_rules(id) values ('company') on conflict do nothing;

create table if not exists public.market_intelligence_alert_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (length(dedupe_key) between 16 and 200),
  report_id uuid references public.market_report_imports(id) on delete restrict,
  report_date date,
  series_id uuid references public.market_intelligence_series(id) on delete restrict,
  rule_version bigint not null,
  alert_type text not null,
  severity text not null check (severity in ('info','warning','critical')),
  title text not null check (length(title) between 1 and 200),
  message text not null check (length(message) between 1 and 600),
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.market_intelligence_alert_notification_states (
  alert_event_id uuid not null references public.market_intelligence_alert_events(id) on delete restrict,
  user_id uuid not null,
  read_at timestamptz,
  handled_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key(alert_event_id,user_id)
);

create table if not exists public.market_curve_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  publication_date date not null,
  product_key text not null check (product_key in ('hsfo380','vlsfo','lsmgo')),
  contract_month date not null check (contract_month = date_trunc('month',contract_month)::date),
  unit text not null check (unit in ('USD/MT','USD/BBL')),
  comparison_count integer not null default 0 check (comparison_count >= 0),
  legacy_value_hash text not null check (legacy_value_hash ~ '^[a-f0-9]{64}$'),
  curve_value_hash text not null check (curve_value_hash ~ '^[a-f0-9]{64}$'),
  variance_hash text not null check (variance_hash ~ '^[a-f0-9]{64}$'),
  mean_signed_variance numeric not null,
  mean_absolute_variance numeric not null check (mean_absolute_variance >= 0),
  maximum_absolute_variance numeric not null check (maximum_absolute_variance >= mean_absolute_variance),
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  unique(publication_date,product_key,contract_month,unit),
  constraint market_curve_shadow_product_unit_check check (
    (product_key in ('hsfo380','vlsfo') and unit='USD/MT') or (product_key='lsmgo' and unit='USD/BBL')
  )
);

create table if not exists public.market_curve_shadow_control (
  id text primary key default 'company' check (id='company'),
  minimum_publication_days integer not null default 10 check (minimum_publication_days>=10),
  cutover_approved boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_hash text check (review_hash is null or review_hash ~ '^[a-f0-9]{64}$'),
  revision bigint not null default 1
);
insert into public.market_curve_shadow_control(id) values('company') on conflict do nothing;

create table if not exists public.market_intelligence_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 200),
  operation_type text not null,
  entity_id text,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result_status text not null,
  result_metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  actor_email text,
  created_at timestamptz not null default now()
);

alter table public.market_forward_fallback_marks enable row level security;
alter table public.market_intelligence_briefs enable row level security;
alter table public.market_intelligence_brief_items enable row level security;
alter table public.market_intelligence_alert_rules enable row level security;
alter table public.market_intelligence_alert_events enable row level security;
alter table public.market_intelligence_alert_notification_states enable row level security;
alter table public.market_curve_shadow_runs enable row level security;
alter table public.market_curve_shadow_control enable row level security;
alter table public.market_intelligence_operations enable row level security;

revoke all on table public.market_forward_fallback_marks, public.market_intelligence_briefs,
  public.market_intelligence_brief_items, public.market_intelligence_alert_rules,
  public.market_intelligence_alert_events, public.market_intelligence_alert_notification_states,
  public.market_curve_shadow_runs, public.market_curve_shadow_control, public.market_intelligence_operations
from public, anon, authenticated;
grant select,insert,update on table public.market_forward_fallback_marks to service_role;
grant select,insert on table public.market_intelligence_briefs,public.market_intelligence_brief_items,
  public.market_intelligence_alert_events,public.market_curve_shadow_runs,public.market_intelligence_operations to service_role;
grant select,update on table public.market_intelligence_alert_rules,public.market_curve_shadow_control to service_role;
grant select,insert,update on table public.market_intelligence_alert_notification_states to service_role;

create index if not exists market_intelligence_alert_events_created_idx on public.market_intelligence_alert_events(created_at desc);
create index if not exists market_intelligence_alert_notification_user_idx on public.market_intelligence_alert_notification_states(user_id,updated_at desc);
create index if not exists market_intelligence_briefs_report_idx on public.market_intelligence_briefs(report_date desc,revision desc);
create index if not exists market_forward_fallback_active_expiry_idx on public.market_forward_fallback_marks(expires_on,product_key,contract_month) where status='active';

create or replace function public.protect_market_intelligence_immutable()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  raise exception 'MARKET_INTELLIGENCE_HISTORY_IMMUTABLE';
end; $$;

drop trigger if exists market_intelligence_briefs_immutable on public.market_intelligence_briefs;
create trigger market_intelligence_briefs_immutable before update or delete on public.market_intelligence_briefs
for each row execute function public.protect_market_intelligence_immutable();
drop trigger if exists market_intelligence_brief_items_immutable on public.market_intelligence_brief_items;
create trigger market_intelligence_brief_items_immutable before update or delete on public.market_intelligence_brief_items
for each row execute function public.protect_market_intelligence_immutable();
drop trigger if exists market_intelligence_alert_events_immutable on public.market_intelligence_alert_events;
create trigger market_intelligence_alert_events_immutable before update or delete on public.market_intelligence_alert_events
for each row execute function public.protect_market_intelligence_immutable();
drop trigger if exists market_curve_shadow_runs_immutable on public.market_curve_shadow_runs;
create trigger market_curve_shadow_runs_immutable before update or delete on public.market_curve_shadow_runs
for each row execute function public.protect_market_intelligence_immutable();

create or replace function public.enrich_market_import_observations(p_import_id uuid,p_observations jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_item jsonb; v_series_id uuid; v_count integer:=0; v_changed integer:=0;
  v_contract_month date; v_printed_contract_month date; v_tenor text; v_unit text; v_session text; v_basis jsonb;
  v_canonical public.market_price_observations%rowtype;
begin
  if jsonb_typeof(p_observations) <> 'array' or jsonb_array_length(p_observations)>250 then raise exception 'INVALID_OBSERVATIONS'; end if;
  if not exists(select 1 from public.market_report_imports where id=p_import_id) then raise exception 'MARKET_IMPORT_NOT_FOUND'; end if;
  for v_item in select * from jsonb_array_elements(p_observations) loop
    select id into v_series_id from public.market_intelligence_series
      where source_symbol=upper(trim(v_item->>'sourceSymbol')) and active=true;
    if v_series_id is null then raise exception 'UNKNOWN_MARKET_SERIES'; end if;
    v_contract_month:=nullif(v_item->>'contractMonth','')::date;
    v_printed_contract_month:=nullif(v_item->>'printedContractMonth','')::date;
    v_tenor:=nullif(lower(v_item->>'tenor'),'');
    v_unit:=nullif(v_item->>'unit','');
    v_session:=nullif(v_item->>'assessmentSession','');
    v_basis:=coalesce(v_item->'basisMetadata','{}'::jsonb);
    select * into v_canonical from public.market_price_observations
      where series_id=v_series_id and price_date=(select report_date from public.market_report_imports where id=p_import_id)
      for update;
    if v_canonical.basis_metadata <> '{}'::jsonb and
       (v_canonical.contract_month is distinct from v_contract_month
        or v_canonical.tenor is distinct from v_tenor
        or v_canonical.observation_unit is distinct from v_unit
        or v_canonical.assessment_session is distinct from v_session) then
      update public.market_observation_evidence set
        contract_month=v_contract_month,printed_contract_month=v_printed_contract_month,tenor=v_tenor,
        observation_unit=v_unit,assessment_session=v_session,basis_metadata=v_basis,
        disposition='quarantined',conflict_code='CONTRACT_BASIS_MISMATCH',basis_enriched_at=now()
      where import_id=p_import_id and series_id=v_series_id and basis_enriched_at is null;
      v_count:=v_count+1;
      continue;
    end if;
    if exists(select 1 from public.market_observation_evidence where import_id=p_import_id and series_id=v_series_id and disposition in ('accepted','matching')) then
      update public.market_price_observations set
        contract_month=v_contract_month,printed_contract_month=v_printed_contract_month,tenor=v_tenor,
        observation_unit=v_unit,assessment_session=v_session,basis_metadata=v_basis
      where id=v_canonical.id
        and (contract_month is distinct from v_contract_month or printed_contract_month is distinct from v_printed_contract_month
          or tenor is distinct from v_tenor or observation_unit is distinct from v_unit
          or assessment_session is distinct from v_session or basis_metadata is distinct from v_basis);
      get diagnostics v_changed=row_count; v_count:=v_count+v_changed;
    end if;
    update public.market_observation_evidence set
      contract_month=v_contract_month,printed_contract_month=v_printed_contract_month,tenor=v_tenor,
      observation_unit=v_unit,assessment_session=v_session,basis_metadata=v_basis,basis_enriched_at=now()
    where import_id=p_import_id and series_id=v_series_id and basis_enriched_at is null;
  end loop;
  return jsonb_build_object('importId',p_import_id,'enrichedCount',v_count);
end; $$;

create or replace function public.protect_market_observation_evidence()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'MARKET_OBSERVATION_EVIDENCE_IMMUTABLE'; end if;
  if new.import_id<>old.import_id or new.series_id<>old.series_id or new.price_date<>old.price_date
     or new.price<>old.price or new.day_change is distinct from old.day_change
     or new.source_hash<>old.source_hash or new.source_page is distinct from old.source_page
     or new.canonical_observation_id is distinct from old.canonical_observation_id then
    raise exception 'MARKET_OBSERVATION_EVIDENCE_IMMUTABLE';
  end if;
  if old.basis_enriched_at is not null then raise exception 'MARKET_OBSERVATION_EVIDENCE_IMMUTABLE'; end if;
  if new.disposition<>old.disposition and not(new.disposition='quarantined' and new.conflict_code='CONTRACT_BASIS_MISMATCH') then
    raise exception 'MARKET_OBSERVATION_EVIDENCE_IMMUTABLE';
  end if;
  return new;
end; $$;

create or replace function public.market_next_reviewed_publication_date(p_after date,p_session text)
returns date language plpgsql immutable security invoker set search_path=public as $$
declare v_date date := p_after+1; v_attempt integer := 0;
begin
  if extract(year from p_after)::integer not in (2025,2026) then return null; end if;
  while v_attempt<12 loop
    if extract(year from v_date)::integer not in (2025,2026) then return null; end if;
    if extract(isodow from v_date)::integer between 1 and 5
       and not (
         p_session='asia_moc' and v_date in (
           date '2025-01-01',date '2025-01-29',date '2025-01-30',date '2025-03-31',date '2025-04-18',date '2025-05-01',date '2025-05-12',date '2025-10-20',date '2025-12-25',
           date '2026-01-01',date '2026-02-17',date '2026-02-18',date '2026-04-03',date '2026-05-01',date '2026-05-27',date '2026-06-01',date '2026-08-10',date '2026-11-09',date '2026-12-25'
         )
       )
       and not (
         p_session='london_moc' and v_date in (
           date '2025-01-01',date '2025-04-18',date '2025-04-21',date '2025-05-05',date '2025-05-26',date '2025-08-25',date '2025-12-25',date '2025-12-26',
           date '2026-01-01',date '2026-04-03',date '2026-04-06',date '2026-05-04',date '2026-05-25',date '2026-08-31',date '2026-12-25',date '2026-12-28'
         )
       ) then return v_date; end if;
    v_date := v_date+1; v_attempt := v_attempt+1;
  end loop;
  return null;
end; $$;
revoke all on function public.market_next_reviewed_publication_date(date,text) from public,anon,authenticated;
grant execute on function public.market_next_reviewed_publication_date(date,text) to service_role;

create or replace function public.market_is_reviewed_publication_date(p_date date,p_session text)
returns boolean language sql immutable security invoker set search_path=public as $$
  select public.market_next_reviewed_publication_date(p_date-1,p_session)=p_date
$$;
revoke all on function public.market_is_reviewed_publication_date(date,text) from public,anon,authenticated;
grant execute on function public.market_is_reviewed_publication_date(date,text) to service_role;

create or replace function public.save_market_forward_fallback(
 p_idempotency_key text,p_product_key text,p_contract_month date,p_unit text,p_outright_value numeric,
 p_as_of_date date,p_source_note text,p_reason_hash text,p_expires_on date,p_expected_revision bigint,
 p_actor_user_id uuid,p_actor_email text,p_request_hash text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_existing public.market_forward_fallback_marks%rowtype; v_row public.market_forward_fallback_marks%rowtype; v_operation public.market_intelligence_operations%rowtype;
  v_hong_kong_today date := (clock_timestamp() at time zone 'Asia/Hong_Kong')::date;
  v_expected_expiry date;
begin
  select * into v_operation from public.market_intelligence_operations where idempotency_key=p_idempotency_key;
  if found then
    if v_operation.request_hash<>lower(p_request_hash) or v_operation.operation_type<>'forward_fallback_save' then raise exception 'MARKET_FALLBACK_REPLAY_CONFLICT'; end if;
    select * into strict v_row from public.market_forward_fallback_marks where id::text=v_operation.entity_id;
    return jsonb_build_object('id',v_row.id,'status',v_row.status,'revision',v_row.revision,'replayed',true);
  end if;
  v_expected_expiry := public.market_next_reviewed_publication_date(p_as_of_date,case when p_product_key='vlsfo' then 'asia_moc' else 'london_moc' end);
  if p_contract_month<date_trunc('month',v_hong_kong_today)::date
     or v_expected_expiry is null or p_expires_on<>v_expected_expiry
     or p_as_of_date<>v_hong_kong_today or p_expires_on<=v_hong_kong_today then
    raise exception 'INVALID_MARKET_FALLBACK_EXPIRY';
  end if;
  if exists (
    select 1
    from public.market_price_observations o
    join public.market_intelligence_series s on s.id=o.series_id
    where o.contract_month=p_contract_month
      and o.quality_status='verified'
      and coalesce((o.basis_metadata->>'publicationEligible')::boolean,true)
      and s.active=true
      and s.market_family='forward'
      and coalesce(o.observation_unit,s.unit)=p_unit
      and coalesce(o.basis_metadata->>'productKey',s.basis_metadata->>'productKey',split_part(s.product_key,'-',1))=p_product_key
      and o.price_date=(
        select max(o2.price_date)
        from public.market_price_observations o2
        join public.market_intelligence_series s2 on s2.id=o2.series_id
        where o2.quality_status='verified'
          and coalesce((o2.basis_metadata->>'publicationEligible')::boolean,true)
          and s2.active=true and s2.market_family='forward'
          and coalesce(o2.observation_unit,s2.unit)=p_unit
          and coalesce(o2.basis_metadata->>'productKey',s2.basis_metadata->>'productKey',split_part(s2.product_key,'-',1))=p_product_key
      )
  ) then raise exception 'MARKET_FALLBACK_VERIFIED_OUTRIGHT_EXISTS'; end if;
  update public.market_forward_fallback_marks set status='expired',expiry_reason='publication_or_contract_roll',expired_at=now(),revision=revision+1
    where status='active' and expires_on<=v_hong_kong_today;
  select * into v_existing from public.market_forward_fallback_marks
    where product_key=p_product_key and contract_month=p_contract_month and status='active' for update;
  if found and (p_expected_revision is null or v_existing.revision<>p_expected_revision) then raise exception 'MARKET_FALLBACK_STALE'; end if;
  if found then
    update public.market_forward_fallback_marks set status='superseded',expiry_reason='replacement_saved',expired_at=now(),revision=revision+1 where id=v_existing.id;
  elsif coalesce(p_expected_revision,0)<>0 then raise exception 'MARKET_FALLBACK_STALE'; end if;
  insert into public.market_forward_fallback_marks(idempotency_key,product_key,contract_month,unit,outright_value,as_of_date,source_note,reason_hash,expires_on,expiry_reason,actor_user_id,actor_email)
    values(p_idempotency_key,p_product_key,p_contract_month,p_unit,p_outright_value,p_as_of_date,trim(p_source_note),lower(p_reason_hash),p_expires_on,'publication_or_contract_roll',p_actor_user_id,lower(trim(p_actor_email))) returning * into v_row;
  insert into public.market_intelligence_operations(idempotency_key,operation_type,entity_id,request_hash,result_status,result_metadata,actor_user_id,actor_email)
    values(p_idempotency_key,'forward_fallback_save',v_row.id::text,lower(p_request_hash),'completed',jsonb_build_object('productKey',p_product_key,'contractMonth',p_contract_month,'revision',v_row.revision),p_actor_user_id,lower(trim(p_actor_email)));
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'revision',v_row.revision,'expiresOn',v_row.expires_on,'replayed',false);
end; $$;

create or replace function public.save_market_intelligence_alert_rules(
 p_expected_revision bigint,p_settings jsonb,p_actor_user_id uuid,p_actor_email text,p_idempotency_key text,p_request_hash text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_row public.market_intelligence_alert_rules%rowtype; v_operation public.market_intelligence_operations%rowtype;
begin
  select * into v_operation from public.market_intelligence_operations where idempotency_key=p_idempotency_key;
  if found then
    if v_operation.request_hash<>lower(p_request_hash) or v_operation.operation_type<>'alert_rules_save' then raise exception 'MARKET_ALERT_RULES_REPLAY_CONFLICT'; end if;
    select * into v_row from public.market_intelligence_alert_rules where id='company';
    return to_jsonb(v_row)||jsonb_build_object('replayed',true);
  end if;
  select * into v_row from public.market_intelligence_alert_rules where id='company' for update;
  if v_row.revision<>p_expected_revision then raise exception 'MARKET_ALERT_RULES_STALE'; end if;
  update public.market_intelligence_alert_rules set
    enabled=coalesce((p_settings->>'enabled')::boolean,enabled),
    outright_floor_usd_mt=coalesce((p_settings->>'outrightFloorUsdMt')::numeric,outright_floor_usd_mt),
    spread_floor_usd_mt=coalesce((p_settings->>'spreadFloorUsdMt')::numeric,spread_floor_usd_mt),
    gasoil_floor_usd_bbl=coalesce((p_settings->>'gasoilFloorUsdBbl')::numeric,gasoil_floor_usd_bbl),
    percentile=coalesce((p_settings->>'percentile')::numeric,percentile),
    lookback_days=coalesce((p_settings->>'lookbackDays')::integer,lookback_days),
    minimum_samples=coalesce((p_settings->>'minimumSamples')::integer,minimum_samples),
    curve_deadband_usd_mt=coalesce((p_settings->>'curveDeadbandUsdMt')::numeric,curve_deadband_usd_mt),
    curve_deadband_usd_bbl=coalesce((p_settings->>'curveDeadbandUsdBbl')::numeric,curve_deadband_usd_bbl),
    revision=revision+1,updated_by=p_actor_user_id,updated_by_email=lower(trim(p_actor_email)),updated_at=now()
    where id='company' returning * into v_row;
  insert into public.market_intelligence_operations(idempotency_key,operation_type,entity_id,request_hash,result_status,result_metadata,actor_user_id,actor_email)
    values(p_idempotency_key,'alert_rules_save','company',lower(p_request_hash),'completed',jsonb_build_object('revision',v_row.revision),p_actor_user_id,lower(trim(p_actor_email)));
  return to_jsonb(v_row)||jsonb_build_object('replayed',false);
end; $$;

create or replace function public.save_market_intelligence_brief(
 p_report_date date,p_source_hash text,p_as_of_at timestamptz,p_completeness jsonb,p_deterministic_metrics jsonb,
 p_ai_status text,p_model_id text,p_source_refs jsonb,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_brief public.market_intelligence_briefs%rowtype; v_item jsonb; v_order integer:=0; v_revision bigint:=1;
begin
  select * into v_brief from public.market_intelligence_briefs where report_date=p_report_date and source_hash=p_source_hash order by revision desc limit 1;
  if found and (v_brief.ai_status='completed' or p_ai_status<>'completed') then return jsonb_build_object('id',v_brief.id,'status','replayed','revision',v_brief.revision,'itemCount',(select count(*) from public.market_intelligence_brief_items where brief_id=v_brief.id)); end if;
  if found then v_revision:=v_brief.revision+1; end if;
  if p_ai_status not in ('not_requested','completed','unavailable','failed','invalid') then raise exception 'INVALID_MARKET_BRIEF_AI_STATUS'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'INVALID_MARKET_BRIEF_ITEMS'; end if;
  if p_items::text ~* '"(prompt|rawResponse|sourceText|quote|participantName)"\s*:' then raise exception 'MARKET_BRIEF_PROHIBITED_SOURCE_CONTENT'; end if;
  insert into public.market_intelligence_briefs(report_date,source_hash,as_of_at,completeness,deterministic_metrics,ai_status,model_id,source_refs,revision)
    values(p_report_date,lower(p_source_hash),p_as_of_at,coalesce(p_completeness,'{}'),coalesce(p_deterministic_metrics,'{}'),p_ai_status,p_model_id,coalesce(p_source_refs,'[]'),v_revision) returning * into v_brief;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_order:=v_order+1;
    insert into public.market_intelligence_brief_items(brief_id,item_order,item_kind,title,summary,driver_tags,direction,confidence,product_key,port_key,horizon,source_refs,numeric_facts)
    values(v_brief.id,v_order,v_item->>'kind',v_item->>'title',v_item->>'summary',coalesce(array(select jsonb_array_elements_text(v_item->'driverTags')),'{}'),nullif(v_item->>'direction',''),nullif(v_item->>'confidence','')::numeric,nullif(v_item->>'productKey',''),nullif(v_item->>'portKey',''),nullif(v_item->>'horizon',''),coalesce(v_item->'sourceRefs','[]'),coalesce(v_item->'numericFacts','[]'));
  end loop;
  return jsonb_build_object('id',v_brief.id,'status','completed','revision',v_brief.revision,'itemCount',v_order);
end; $$;

create or replace function public.publish_market_intelligence_alert(
 p_dedupe_key text,p_report_id uuid,p_report_date date,p_series_id uuid,p_rule_version bigint,
 p_alert_type text,p_severity text,p_title text,p_message text,p_evidence_metadata jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_row public.market_intelligence_alert_events%rowtype;
begin
  insert into public.market_intelligence_alert_events(dedupe_key,report_id,report_date,series_id,rule_version,alert_type,severity,title,message,evidence_metadata)
  values(p_dedupe_key,p_report_id,p_report_date,p_series_id,p_rule_version,p_alert_type,p_severity,p_title,p_message,coalesce(p_evidence_metadata,'{}'))
  on conflict(dedupe_key) do nothing returning * into v_row;
  if not found then select * into v_row from public.market_intelligence_alert_events where dedupe_key=p_dedupe_key; end if;
  return jsonb_build_object('id',v_row.id,'created',v_row.created_at=transaction_timestamp());
end; $$;

create or replace function public.record_market_curve_shadow(
 p_publication_date date,p_product_key text,p_contract_month date,p_unit text,p_comparison_count integer,
 p_legacy_value_hash text,p_curve_value_hash text,p_variance_hash text,
 p_mean_signed_variance numeric,p_mean_absolute_variance numeric,p_maximum_absolute_variance numeric)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_row public.market_curve_shadow_runs%rowtype;
begin
  if p_comparison_count<1 or p_mean_signed_variance is null or p_mean_absolute_variance is null or p_maximum_absolute_variance is null
     or p_mean_absolute_variance<0 or p_maximum_absolute_variance<p_mean_absolute_variance then
    raise exception 'MARKET_CURVE_SHADOW_VARIANCE_INVALID';
  end if;
  insert into public.market_curve_shadow_runs(publication_date,product_key,contract_month,unit,comparison_count,legacy_value_hash,curve_value_hash,variance_hash,mean_signed_variance,mean_absolute_variance,maximum_absolute_variance)
  values(p_publication_date,p_product_key,p_contract_month,p_unit,p_comparison_count,lower(p_legacy_value_hash),lower(p_curve_value_hash),lower(p_variance_hash),p_mean_signed_variance,p_mean_absolute_variance,p_maximum_absolute_variance)
  on conflict(publication_date,product_key,contract_month,unit) do nothing returning * into v_row;
  if not found then
    select * into v_row from public.market_curve_shadow_runs where publication_date=p_publication_date and product_key=p_product_key and contract_month=p_contract_month and unit=p_unit;
    if v_row.comparison_count<>p_comparison_count or v_row.legacy_value_hash<>lower(p_legacy_value_hash)
       or v_row.curve_value_hash<>lower(p_curve_value_hash) or v_row.variance_hash<>lower(p_variance_hash)
       or v_row.mean_signed_variance<>p_mean_signed_variance or v_row.mean_absolute_variance<>p_mean_absolute_variance
       or v_row.maximum_absolute_variance<>p_maximum_absolute_variance then
      raise exception 'MARKET_CURVE_SHADOW_REPLAY_CONFLICT';
    end if;
  end if;
  return jsonb_build_object('id',v_row.id,'publicationDate',v_row.publication_date,'comparisonCount',v_row.comparison_count,
    'meanSignedVariance',v_row.mean_signed_variance,'meanAbsoluteVariance',v_row.mean_absolute_variance,'maximumAbsoluteVariance',v_row.maximum_absolute_variance);
end; $$;

create or replace function public.expire_market_forward_fallbacks_for_report(p_report_date date)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_expired integer := 0;
begin
  with expired as (
    update public.market_forward_fallback_marks fallback
    set status='expired',expiry_reason='verified_report_arrived',expired_at=now(),revision=revision+1
    where fallback.status='active' and fallback.as_of_date<=p_report_date
      and exists (
        select 1 from public.market_price_observations observation
        join public.market_intelligence_series series on series.id=observation.series_id
        where observation.price_date=p_report_date
          and observation.contract_month=fallback.contract_month
          and observation.quality_status='verified'
          and coalesce((observation.basis_metadata->>'publicationEligible')::boolean,true)
          and series.active=true and series.market_family='forward'
          and coalesce(observation.basis_metadata->>'settlementBasis',series.basis_metadata->>'settlementBasis')='outright'
          and coalesce(observation.observation_unit,series.unit)=fallback.unit
          and coalesce(observation.basis_metadata->>'productKey',series.basis_metadata->>'productKey',split_part(series.product_key,'-',1))=fallback.product_key
      )
    returning id
  ) select count(*) into v_expired from expired;
  return jsonb_build_object('expiredCount',v_expired,'reportDate',p_report_date);
end; $$;

create or replace function public.save_market_curve_shadow_cutover(
 p_expected_revision bigint,p_approved boolean,p_review_hash text,p_actor_user_id uuid,p_actor_email text,
 p_idempotency_key text,p_request_hash text,p_required_scopes jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_row public.market_curve_shadow_control%rowtype;
  v_operation public.market_intelligence_operations%rowtype;
  v_expected_scopes jsonb := '[]'::jsonb;
  v_supplied_scopes jsonb := '[]'::jsonb;
  v_scope record;
  v_complete_days integer;
begin
  select * into v_operation from public.market_intelligence_operations where idempotency_key=p_idempotency_key;
  if found then
    if v_operation.request_hash<>lower(p_request_hash) or v_operation.operation_type<>'curve_shadow_cutover_save' then raise exception 'MARKET_CURVE_CUTOVER_REPLAY_CONFLICT'; end if;
    select * into v_row from public.market_curve_shadow_control where id='company';
    return to_jsonb(v_row)||jsonb_build_object('replayed',true);
  end if;
  select * into v_row from public.market_curve_shadow_control where id='company' for update;
  if v_row.revision<>p_expected_revision then raise exception 'MARKET_CURVE_CUTOVER_STALE'; end if;
  if lower(coalesce(p_review_hash,'')) !~ '^[a-f0-9]{64}$' then raise exception 'MARKET_CURVE_CUTOVER_REVIEW_REQUIRED'; end if;
  if p_approved then
    if jsonb_typeof(p_required_scopes)<>'array' then raise exception 'MARKET_CURVE_SHADOW_SCOPE_CHANGED'; end if;
    with eligible as (
      select
        coalesce(o.basis_metadata->>'productKey',s.basis_metadata->>'productKey',split_part(s.product_key,'-',1)) as product_key,
        upper(coalesce(o.tenor,s.tenor)) as tenor,
        o.contract_month,
        coalesce(o.observation_unit,s.unit) as unit,
        coalesce(o.assessment_session,s.assessment_session) as assessment_session,
        o.price_date
      from public.market_price_observations o
      join public.market_intelligence_series s on s.id=o.series_id
      where o.quality_status='verified'
        and coalesce((o.basis_metadata->>'publicationEligible')::boolean,true)
        and s.active=true and s.market_family='forward'
        and coalesce(o.basis_metadata->>'settlementBasis',s.basis_metadata->>'settlementBasis')='outright'
    ), latest_dates as (
      select product_key,assessment_session,max(price_date) as price_date
      from eligible group by product_key,assessment_session
    ), latest_required as (
      select distinct e.product_key,e.contract_month,e.unit,e.assessment_session,e.price_date
      from eligible e join latest_dates d using(product_key,assessment_session,price_date)
      where (e.product_key in ('vlsfo','lsmgo') and e.tenor in ('BM','M1','M2'))
         or (e.product_key='hsfo380' and e.tenor in ('M1','M2'))
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'productKey',product_key,
      'contractMonth',to_char(contract_month,'YYYY-MM'),
      'unit',unit,
      'assessmentSession',assessment_session,
      'reviewedThrough',to_char(price_date,'YYYY-MM-DD')
    ) order by product_key,contract_month,unit),'[]'::jsonb)
    into v_expected_scopes from latest_required;

    if jsonb_array_length(v_expected_scopes)<>8 then raise exception 'MARKET_CURVE_SHADOW_INCOMPLETE'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'productKey',scope.product_key,
      'contractMonth',scope.contract_month,
      'unit',scope.unit,
      'assessmentSession',scope.assessment_session,
      'reviewedThrough',scope.reviewed_through
    ) order by scope.product_key,scope.contract_month,scope.unit),'[]'::jsonb)
    into v_supplied_scopes
    from jsonb_to_recordset(p_required_scopes) as scope(
      product_key text,contract_month text,unit text,assessment_session text,reviewed_through text
    );
    if v_supplied_scopes<>v_expected_scopes then raise exception 'MARKET_CURVE_SHADOW_SCOPE_CHANGED'; end if;

    for v_scope in
      select * from jsonb_to_recordset(v_expected_scopes) as scope(
        product_key text,contract_month text,unit text,assessment_session text,reviewed_through text
      )
    loop
      select count(*) into v_complete_days from (
        select day::date as publication_date
        from generate_series(v_scope.reviewed_through::date-45,v_scope.reviewed_through::date,interval '1 day') day
        where public.market_is_reviewed_publication_date(day::date,v_scope.assessment_session)
        order by day desc limit v_row.minimum_publication_days
      ) expected_day
      where exists (
        select 1 from public.market_curve_shadow_runs shadow
        where shadow.product_key=v_scope.product_key
          and shadow.contract_month=to_date(v_scope.contract_month||'-01','YYYY-MM-DD')
          and shadow.unit=v_scope.unit
          and shadow.publication_date=expected_day.publication_date
          and shadow.comparison_count>0
      );
      if v_complete_days<>v_row.minimum_publication_days then raise exception 'MARKET_CURVE_SHADOW_INCOMPLETE'; end if;
    end loop;
  end if;
  update public.market_curve_shadow_control set cutover_approved=p_approved,reviewed_at=now(),reviewed_by=p_actor_user_id,
    review_hash=lower(p_review_hash),revision=revision+1 where id='company' returning * into v_row;
  insert into public.market_intelligence_operations(idempotency_key,operation_type,entity_id,request_hash,result_status,result_metadata,actor_user_id,actor_email)
    values(p_idempotency_key,'curve_shadow_cutover_save','company',lower(p_request_hash),'completed',jsonb_build_object('approved',p_approved,'revision',v_row.revision),p_actor_user_id,lower(trim(p_actor_email)));
  return to_jsonb(v_row)||jsonb_build_object('replayed',false);
end; $$;

-- Wrap the existing canonical importer so Asia-session holiday reprints remain
-- immutable evidence without becoming canonical history or settlement inputs.
alter function public.save_market_report_import(text,text,text,date,jsonb,uuid,text)
  rename to save_market_report_import_canonical_core;

create or replace function public.save_market_report_import(
  p_idempotency_key text,p_source_document_type text,p_source_hash text,p_report_date date,
  p_observations jsonb,p_actor_user_id uuid,p_actor_email text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_publishable jsonb; v_nonpublication jsonb; v_result jsonb; v_import_id uuid;
  v_item jsonb; v_series public.market_intelligence_series%rowtype; v_price numeric; v_day_change numeric;
begin
  if jsonb_typeof(p_observations)<>'array' then raise exception 'INVALID_OBSERVATIONS'; end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_publishable
    from jsonb_array_elements(p_observations) item
    where coalesce((item->'basisMetadata'->>'publicationEligible')::boolean,true)=true;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_nonpublication
    from jsonb_array_elements(p_observations) item
    where coalesce((item->'basisMetadata'->>'publicationEligible')::boolean,true)=false;
  v_result:=public.save_market_report_import_canonical_core(p_idempotency_key,p_source_document_type,p_source_hash,p_report_date,v_publishable,p_actor_user_id,p_actor_email);
  v_import_id:=(v_result->>'id')::uuid;
  perform public.enrich_market_import_observations(v_import_id,v_publishable);
  for v_item in select * from jsonb_array_elements(v_nonpublication) loop
    select * into strict v_series from public.market_intelligence_series where source_symbol=upper(trim(v_item->>'sourceSymbol')) and active=true;
    v_price:=(v_item->>'price')::numeric; v_day_change:=nullif(v_item->>'dayChange','')::numeric;
    if v_price::text in ('NaN','Infinity','-Infinity') or (v_series.value_kind<>'spread' and v_price<=0) then raise exception 'INVALID_MARKET_PRICE:%',v_series.source_symbol; end if;
    insert into public.market_observation_evidence(import_id,series_id,price_date,price,day_change,source_hash,source_page,disposition,canonical_observation_id,conflict_code,contract_month,printed_contract_month,tenor,observation_unit,assessment_session,basis_metadata,basis_enriched_at)
    values(v_import_id,v_series.id,p_report_date,v_price,v_day_change,p_source_hash,nullif(v_item->>'sourcePage','')::integer,'quarantined',null,'NON_PUBLICATION_DAY_REPRINT',nullif(v_item->>'contractMonth','')::date,nullif(v_item->>'printedContractMonth','')::date,nullif(lower(v_item->>'tenor'),''),nullif(v_item->>'unit',''),nullif(v_item->>'assessmentSession',''),coalesce(v_item->'basisMetadata','{}'),now())
    on conflict(import_id,series_id) do nothing;
  end loop;
  update public.market_report_imports set observation_count=jsonb_array_length(p_observations) where id=v_import_id;
  update public.market_intelligence_events set observation_count=jsonb_array_length(p_observations)
    where entity_id=v_import_id and event_type='report_imported';
  return v_result||jsonb_build_object('observationCount',jsonb_array_length(p_observations),'nonPublicationEvidenceCount',jsonb_array_length(v_nonpublication));
exception when no_data_found then raise exception 'UNKNOWN_MARKET_SERIES';
end; $$;

create or replace function public.set_market_intelligence_alert_notification_state(
 p_alert_event_id uuid,p_user_id uuid,p_state text,p_snoozed_until timestamptz default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_row public.market_intelligence_alert_notification_states%rowtype;
begin
  if not exists(select 1 from public.market_intelligence_alert_events where id=p_alert_event_id) then raise exception 'MARKET_ALERT_NOT_FOUND'; end if;
  if not exists(select 1 from public.user_profiles where id=p_user_id and active=true) then raise exception 'ACTIVE_USER_REQUIRED'; end if;
  if p_state not in ('read','unread','handled','unhandled','snoozed') then raise exception 'INVALID_NOTIFICATION_STATE'; end if;
  insert into public.market_intelligence_alert_notification_states(alert_event_id,user_id,read_at,handled_at,snoozed_until,updated_at)
  values(p_alert_event_id,p_user_id,case when p_state='read' then now() end,case when p_state='handled' then now() end,case when p_state='snoozed' then p_snoozed_until end,now())
  on conflict(alert_event_id,user_id) do update set
    read_at=case when p_state='read' then now() when p_state='unread' then null else market_intelligence_alert_notification_states.read_at end,
    handled_at=case when p_state='handled' then now() when p_state='unhandled' then null else market_intelligence_alert_notification_states.handled_at end,
    snoozed_until=case when p_state='snoozed' then p_snoozed_until when p_state in ('read','unread','handled','unhandled') then null else market_intelligence_alert_notification_states.snoozed_until end,
    updated_at=now() returning * into v_row;
  return jsonb_build_object('alertEventId',v_row.alert_event_id,'readAt',v_row.read_at,'handledAt',v_row.handled_at,'snoozedUntil',v_row.snoozed_until);
end; $$;

-- Demote any reviewed-session non-publication rows imported before this policy
-- was installed. The immutable evidence remains; false canonical history is removed.
alter table public.market_observation_evidence disable trigger market_observation_evidence_immutable;
insert into public.market_observation_evidence(
  import_id,series_id,price_date,price,day_change,source_hash,source_page,
  disposition,canonical_observation_id,conflict_code,contract_month,
  printed_contract_month,tenor,observation_unit,assessment_session,basis_metadata,basis_enriched_at
)
select observation.import_id,observation.series_id,observation.price_date,observation.price,
  observation.day_change,observation.source_hash,observation.source_page,'quarantined',null,
  'NON_PUBLICATION_DAY_REPRINT',observation.contract_month,observation.printed_contract_month,
  observation.tenor,observation.observation_unit,observation.assessment_session,
  coalesce(observation.basis_metadata,'{}'::jsonb)||jsonb_build_object('publicationEligible',false),now()
from public.market_price_observations observation
join public.market_intelligence_series series on series.id=observation.series_id
where (
  (coalesce(observation.assessment_session,series.assessment_session)='asia_moc' and observation.price_date in (
    date '2025-01-01',date '2025-01-29',date '2025-01-30',date '2025-03-31',date '2025-04-18',date '2025-05-01',date '2025-05-12',date '2025-10-20',date '2025-12-25',
    date '2026-01-01',date '2026-02-17',date '2026-02-18',date '2026-04-03',date '2026-05-01',date '2026-05-27',date '2026-06-01',date '2026-08-10',date '2026-11-09',date '2026-12-25'
  )) or
  (coalesce(observation.assessment_session,series.assessment_session) in ('london_moc','london_1630','ice_settlement','london_settlement') and observation.price_date in (
    date '2025-01-01',date '2025-04-18',date '2025-04-21',date '2025-05-05',date '2025-05-26',date '2025-08-25',date '2025-12-25',date '2025-12-26',
    date '2026-01-01',date '2026-04-03',date '2026-04-06',date '2026-05-04',date '2026-05-25',date '2026-08-31',date '2026-12-25',date '2026-12-28'
  ))
)
on conflict(import_id,series_id) do update set
  disposition='quarantined',canonical_observation_id=null,conflict_code='NON_PUBLICATION_DAY_REPRINT',
  contract_month=excluded.contract_month,printed_contract_month=excluded.printed_contract_month,
  tenor=excluded.tenor,observation_unit=excluded.observation_unit,
  assessment_session=excluded.assessment_session,basis_metadata=excluded.basis_metadata,
  basis_enriched_at=coalesce(market_observation_evidence.basis_enriched_at,now());
update public.market_price_observations observation
set quality_status='quarantined',
    basis_metadata=coalesce(observation.basis_metadata,'{}'::jsonb)||jsonb_build_object('publicationEligible',false)
from public.market_intelligence_series series
where series.id=observation.series_id and (
  (coalesce(observation.assessment_session,series.assessment_session)='asia_moc' and observation.price_date in (
    date '2025-01-01',date '2025-01-29',date '2025-01-30',date '2025-03-31',date '2025-04-18',date '2025-05-01',date '2025-05-12',date '2025-10-20',date '2025-12-25',
    date '2026-01-01',date '2026-02-17',date '2026-02-18',date '2026-04-03',date '2026-05-01',date '2026-05-27',date '2026-06-01',date '2026-08-10',date '2026-11-09',date '2026-12-25'
  )) or
  (coalesce(observation.assessment_session,series.assessment_session) in ('london_moc','london_1630','ice_settlement','london_settlement') and observation.price_date in (
    date '2025-01-01',date '2025-04-18',date '2025-04-21',date '2025-05-05',date '2025-05-26',date '2025-08-25',date '2025-12-25',date '2025-12-26',
    date '2026-01-01',date '2026-04-03',date '2026-04-06',date '2026-05-04',date '2026-05-25',date '2026-08-31',date '2026-12-25',date '2026-12-28'
  ))
);
alter table public.market_observation_evidence enable trigger market_observation_evidence_immutable;

create or replace function public.save_market_drive_report_import(
  p_idempotency_key text,p_source_document_type text,p_source_hash text,p_source_md5 text,
  p_drive_file_id text,p_drive_modified_at timestamptz,p_report_date date,p_observations jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_result jsonb; v_import_id uuid; v_enriched jsonb;
begin
  if lower(coalesce(p_source_md5,'')) !~ '^[a-f0-9]{32}$' then raise exception 'INVALID_MARKET_SOURCE_MD5'; end if;
  if coalesce(p_drive_file_id,'') !~ '^[A-Za-z0-9_-]{10,200}$' then raise exception 'INVALID_MARKET_DRIVE_FILE_ID'; end if;
  v_result:=public.save_market_report_import(p_idempotency_key,p_source_document_type,p_source_hash,p_report_date,p_observations,null::uuid,'system@fcos.local');
  v_import_id:=(v_result->>'id')::uuid;
  update public.market_report_imports set source_md5=lower(p_source_md5),drive_file_id=p_drive_file_id,drive_modified_at=p_drive_modified_at where id=v_import_id;
  v_enriched:=public.enrich_market_import_observations(v_import_id,p_observations);
  return v_result||jsonb_build_object('driveRecorded',true,'metadata',v_enriched);
end; $$;

revoke all on function public.protect_market_intelligence_immutable() from public,anon,authenticated;
revoke all on function public.enrich_market_import_observations(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.save_market_forward_fallback(text,text,date,text,numeric,date,text,text,date,bigint,uuid,text,text) from public,anon,authenticated;
revoke all on function public.save_market_intelligence_alert_rules(bigint,jsonb,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.save_market_intelligence_brief(date,text,timestamptz,jsonb,jsonb,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.publish_market_intelligence_alert(text,uuid,date,uuid,bigint,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.record_market_curve_shadow(date,text,date,text,integer,text,text,text,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.expire_market_forward_fallbacks_for_report(date) from public,anon,authenticated;
revoke all on function public.save_market_curve_shadow_cutover(bigint,boolean,text,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.save_market_report_import_canonical_core(text,text,text,date,jsonb,uuid,text) from public,anon,authenticated;
revoke all on function public.save_market_report_import(text,text,text,date,jsonb,uuid,text) from public,anon,authenticated;
revoke all on function public.set_market_intelligence_alert_notification_state(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.save_market_drive_report_import(text,text,text,text,text,timestamptz,date,jsonb) from public,anon,authenticated;
grant execute on function public.protect_market_intelligence_immutable() to service_role;
grant execute on function public.enrich_market_import_observations(uuid,jsonb) to service_role;
grant execute on function public.save_market_forward_fallback(text,text,date,text,numeric,date,text,text,date,bigint,uuid,text,text) to service_role;
grant execute on function public.save_market_intelligence_alert_rules(bigint,jsonb,uuid,text,text,text) to service_role;
grant execute on function public.save_market_intelligence_brief(date,text,timestamptz,jsonb,jsonb,text,text,jsonb,jsonb) to service_role;
grant execute on function public.publish_market_intelligence_alert(text,uuid,date,uuid,bigint,text,text,text,text,jsonb) to service_role;
grant execute on function public.record_market_curve_shadow(date,text,date,text,integer,text,text,text,numeric,numeric,numeric) to service_role;
grant execute on function public.expire_market_forward_fallbacks_for_report(date) to service_role;
grant execute on function public.save_market_curve_shadow_cutover(bigint,boolean,text,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.save_market_report_import_canonical_core(text,text,text,date,jsonb,uuid,text) to service_role;
grant execute on function public.save_market_report_import(text,text,text,date,jsonb,uuid,text) to service_role;
grant execute on function public.set_market_intelligence_alert_notification_state(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.save_market_drive_report_import(text,text,text,text,text,timestamptz,date,jsonb) to service_role;

comment on table public.market_forward_fallback_marks is 'Authorized exact-contract outright fallbacks. Verified report observations always take precedence.';
comment on table public.market_intelligence_briefs is 'Immutable deterministic and non-verbatim derived market brief metadata; no licensed report text or PDF content.';
comment on table public.market_curve_shadow_runs is 'Ten-publication-day legacy/new shadow evidence storing counts, one-way value hashes, and auditable signed/absolute variance metrics, never source prices.';

commit;
