begin;

create table public.market_intraday_snapshots (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  source_type text not null check (source_type in ('morning_indication','asia_moc_reference')),
  market_date date not null,
  market_at timestamptz not null,
  received_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  supersedes_snapshot_id uuid references public.market_intraday_snapshots(id) on delete restrict,
  revision bigint not null default 1 check (revision > 0),
  actor_user_id uuid not null,
  actor_email text not null check (length(actor_email) between 3 and 320),
  created_at timestamptz not null default now(),
  unique (source_type, market_date, revision)
);

create table public.market_intraday_observations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.market_intraday_snapshots(id) on delete restrict,
  item_order integer not null check (item_order between 1 and 50),
  product_key text not null check (product_key in ('hsfo380','vlsfo','lsmgo','brent','ice_gasoil')),
  quote_state text not null check (quote_state in ('last_close','current_indication','moc_reference')),
  contract_month date not null check (contract_month = date_trunc('month', contract_month)::date),
  unit text not null check (unit in ('USD/MT','USD/BBL')),
  price numeric(18,6) not null check (price > 0),
  reported_change numeric(18,6),
  change_basis text not null default 'prior_published_close' check (change_basis = 'prior_published_close'),
  decimal_precision smallint not null check (decimal_precision between 0 and 6),
  created_at timestamptz not null default now(),
  unique (snapshot_id, product_key, quote_state, contract_month),
  constraint market_intraday_product_unit_check check (
    (product_key in ('hsfo380','vlsfo','ice_gasoil') and unit = 'USD/MT')
    or (product_key in ('lsmgo','brent') and unit = 'USD/BBL')
  )
);

create table public.market_intraday_reconciliations (
  id uuid primary key default gen_random_uuid(),
  reconciliation_key text not null unique check (reconciliation_key ~ '^[a-f0-9]{64}$'),
  intraday_observation_id uuid not null references public.market_intraday_observations(id) on delete restrict,
  official_observation_id uuid references public.market_price_observations(id) on delete restrict,
  status text not null check (status in ('matched','revised_by_official','official_mark_unavailable')),
  official_report_date date not null,
  official_price numeric(18,6),
  difference numeric(18,6),
  unit text not null check (unit in ('USD/MT','USD/BBL')),
  official_source_hash text check (official_source_hash is null or official_source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create table public.market_intraday_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('snapshot_saved','official_reconciled')),
  snapshot_id uuid references public.market_intraday_snapshots(id) on delete restrict,
  actor_user_id uuid,
  actor_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint market_intraday_audit_redacted_check check (
    not (metadata ?| array['sourceText','image','prompt','rawResponse','rows','observations'])
  )
);

create index market_intraday_snapshots_date_idx
  on public.market_intraday_snapshots (market_date desc, source_type, revision desc);
create index market_intraday_observations_snapshot_idx
  on public.market_intraday_observations (snapshot_id, item_order);
create index market_intraday_reconciliations_observation_idx
  on public.market_intraday_reconciliations (intraday_observation_id, created_at desc);

alter table public.market_intraday_snapshots enable row level security;
alter table public.market_intraday_observations enable row level security;
alter table public.market_intraday_reconciliations enable row level security;
alter table public.market_intraday_audit_events enable row level security;

revoke all on table public.market_intraday_snapshots from public, anon, authenticated;
revoke all on table public.market_intraday_observations from public, anon, authenticated;
revoke all on table public.market_intraday_reconciliations from public, anon, authenticated;
revoke all on table public.market_intraday_audit_events from public, anon, authenticated;
grant select, insert on table public.market_intraday_snapshots to service_role;
grant select, insert on table public.market_intraday_observations to service_role;
grant select, insert on table public.market_intraday_reconciliations to service_role;
grant select, insert on table public.market_intraday_audit_events to service_role;

create trigger market_intraday_snapshots_immutable
before update or delete on public.market_intraday_snapshots
for each row execute function public.protect_market_intelligence_immutable();
create trigger market_intraday_observations_immutable
before update or delete on public.market_intraday_observations
for each row execute function public.protect_market_intelligence_immutable();
create trigger market_intraday_reconciliations_immutable
before update or delete on public.market_intraday_reconciliations
for each row execute function public.protect_market_intelligence_immutable();
create trigger market_intraday_audit_events_immutable
before update or delete on public.market_intraday_audit_events
for each row execute function public.protect_market_intelligence_immutable();

create or replace function public.save_market_intraday_snapshot(
  p_idempotency_key text,
  p_payload_hash text,
  p_source_type text,
  p_market_date date,
  p_market_at timestamptz,
  p_received_at timestamptz,
  p_source_hash text,
  p_supersedes_snapshot_id uuid,
  p_observations jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_snapshot public.market_intraday_snapshots%rowtype;
  v_existing public.market_intraday_snapshots%rowtype;
  v_previous public.market_intraday_snapshots%rowtype;
  v_item jsonb;
  v_revision bigint := 1;
  v_count integer := 0;
begin
  if length(coalesce(p_idempotency_key, '')) not between 16 and 200 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if coalesce(p_payload_hash, '') !~ '^[a-f0-9]{64}$' or coalesce(p_source_hash, '') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_SOURCE_HASH'; end if;
  if p_source_type not in ('morning_indication','asia_moc_reference') then raise exception 'INVALID_SOURCE_TYPE'; end if;
  if p_market_date is null or p_market_at is null or p_received_at is null then raise exception 'INVALID_MARKET_TIME'; end if;
  if p_received_at < p_market_at - interval '7 days' then raise exception 'INVALID_RECEIPT_TIME'; end if;
  if jsonb_typeof(p_observations) <> 'array' or jsonb_array_length(p_observations) not between 1 and 50 then raise exception 'INVALID_INTRADAY_OBSERVATIONS'; end if;

  perform pg_advisory_xact_lock(hashtextextended('market-intraday-idempotency:' || p_idempotency_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('market-intraday-scope:' || p_source_type || ':' || p_market_date::text, 0));

  select * into v_existing from public.market_intraday_snapshots where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.payload_hash <> p_payload_hash then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('snapshot',to_jsonb(v_existing),'replayed',true,'observationCount',(select count(*) from public.market_intraday_observations where snapshot_id=v_existing.id));
  end if;

  if p_supersedes_snapshot_id is not null then
    select * into v_previous from public.market_intraday_snapshots where id=p_supersedes_snapshot_id for share;
    if not found then raise exception 'SUPERSEDED_SNAPSHOT_NOT_FOUND'; end if;
    if v_previous.source_type <> p_source_type or v_previous.market_date <> p_market_date then raise exception 'SUPERSEDED_SNAPSHOT_SCOPE_MISMATCH'; end if;
    v_revision := v_previous.revision + 1;
  else
    select coalesce(max(revision),0)+1 into v_revision
    from public.market_intraday_snapshots
    where source_type=p_source_type and market_date=p_market_date;
  end if;

  insert into public.market_intraday_snapshots(
    idempotency_key,payload_hash,source_type,market_date,market_at,received_at,source_hash,
    supersedes_snapshot_id,revision,actor_user_id,actor_email
  ) values (
    p_idempotency_key,p_payload_hash,p_source_type,p_market_date,p_market_at,p_received_at,p_source_hash,
    p_supersedes_snapshot_id,v_revision,p_actor_user_id,lower(trim(p_actor_email))
  ) returning * into v_snapshot;

  for v_item in select * from jsonb_array_elements(p_observations) loop
    v_count := v_count + 1;
    insert into public.market_intraday_observations(
      snapshot_id,item_order,product_key,quote_state,contract_month,unit,price,reported_change,decimal_precision
    ) values (
      v_snapshot.id,v_count,v_item->>'productKey',v_item->>'quoteState',(v_item->>'contractMonth')::date,
      upper(v_item->>'unit'),(v_item->>'price')::numeric,nullif(v_item->>'reportedChange','')::numeric,
      (v_item->>'decimalPrecision')::smallint
    );
  end loop;

  insert into public.market_intraday_audit_events(event_type,snapshot_id,actor_user_id,actor_email,metadata)
  values ('snapshot_saved',v_snapshot.id,p_actor_user_id,lower(trim(p_actor_email)),jsonb_build_object(
    'sourceType',p_source_type,'marketDate',p_market_date,'observationCount',v_count,'sourceHash',p_source_hash,'revision',v_revision
  ));

  return jsonb_build_object('snapshot',to_jsonb(v_snapshot),'replayed',false,'observationCount',v_count);
end;
$$;

create or replace function public.record_market_intraday_reconciliations(
  p_rows jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_inserted integer := 0;
  v_snapshot_ids uuid[] := '{}';
  v_snapshot_id uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250 then raise exception 'INVALID_RECONCILIATIONS'; end if;
  for v_item in select * from jsonb_array_elements(p_rows) loop
    select snapshot_id into v_snapshot_id from public.market_intraday_observations where id=(v_item->>'intradayObservationId')::uuid;
    if v_snapshot_id is null then raise exception 'INTRADAY_OBSERVATION_NOT_FOUND'; end if;
    insert into public.market_intraday_reconciliations(
      reconciliation_key,intraday_observation_id,official_observation_id,status,official_report_date,
      official_price,difference,unit,official_source_hash
    ) values (
      v_item->>'reconciliationKey',(v_item->>'intradayObservationId')::uuid,nullif(v_item->>'officialObservationId','')::uuid,
      v_item->>'status',(v_item->>'officialReportDate')::date,nullif(v_item->>'officialPrice','')::numeric,
      nullif(v_item->>'difference','')::numeric,upper(v_item->>'unit'),nullif(v_item->>'officialSourceHash','')
    ) on conflict (reconciliation_key) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
    if not (v_snapshot_id = any(v_snapshot_ids)) then v_snapshot_ids := array_append(v_snapshot_ids,v_snapshot_id); end if;
  end loop;
  if v_inserted > 0 then
    insert into public.market_intraday_audit_events(event_type,snapshot_id,actor_user_id,actor_email,metadata)
    select 'official_reconciled',snapshot_id,p_actor_user_id,lower(trim(p_actor_email)),jsonb_build_object('insertedCount',count(*))
    from unnest(v_snapshot_ids) as snapshot_id group by snapshot_id;
  end if;
  return jsonb_build_object('insertedCount',v_inserted);
end;
$$;

revoke all on function public.save_market_intraday_snapshot(text,text,text,date,timestamptz,timestamptz,text,uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.save_market_intraday_snapshot(text,text,text,date,timestamptz,timestamptz,text,uuid,jsonb,uuid,text) to service_role;
revoke all on function public.record_market_intraday_reconciliations(jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.record_market_intraday_reconciliations(jsonb,uuid,text) to service_role;

comment on table public.market_intraday_snapshots is 'Immutable reviewed provisional paper-price snapshot metadata. Raw source content is never stored.';
comment on table public.market_intraday_observations is 'Reviewed provisional structured prices. These rows are excluded from official MOPS and hedge valuation.';
comment on table public.market_intraday_reconciliations is 'Immutable exact-contract comparison with later official observations; neither source is overwritten.';

commit;
