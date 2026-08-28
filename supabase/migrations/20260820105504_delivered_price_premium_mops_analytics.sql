begin;

alter table public.market_intelligence_series
  add column if not exists benchmark_label text,
  add column if not exists usd_mt_factor numeric(12, 6) not null default 1
    check (usd_mt_factor > 0);

alter table public.market_report_imports
  add column if not exists mops_publication_status text not null default 'not_applicable'
    check (mops_publication_status in ('not_applicable', 'incomplete', 'published', 'matched', 'conflict')),
  add column if not exists mops_publication_id uuid;

create table if not exists public.market_observation_evidence (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.market_report_imports(id) on delete restrict,
  series_id uuid not null references public.market_intelligence_series(id) on delete restrict,
  price_date date not null,
  price numeric(18, 6) not null,
  day_change numeric(18, 6),
  source_hash text not null check (length(source_hash) = 64),
  source_page integer check (source_page is null or source_page > 0),
  disposition text not null check (disposition in ('accepted', 'matching', 'quarantined')),
  canonical_observation_id uuid references public.market_price_observations(id) on delete restrict,
  conflict_code text,
  created_at timestamptz not null default now(),
  unique (import_id, series_id)
);

create table if not exists public.market_mops_publications (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null unique references public.market_report_imports(id) on delete restrict,
  report_date date not null,
  source_hash text not null unique check (length(source_hash) = 64),
  symbols jsonb not null,
  source_pages jsonb not null,
  s05 numeric(18, 6) not null,
  s380 numeric(18, 6) not null,
  sgo numeric(18, 6) not null,
  outcome text not null check (outcome in ('published', 'matched', 'conflict')),
  hedge_market_price_id uuid references public.hedge_market_prices(id) on delete restrict,
  conflict_code text,
  created_at timestamptz not null default now()
);

alter table public.market_report_imports
  drop constraint if exists market_report_imports_mops_publication_id_fkey,
  add constraint market_report_imports_mops_publication_id_fkey
    foreign key (mops_publication_id) references public.market_mops_publications(id) on delete restrict;

create table if not exists public.hedge_market_price_superseded_history (
  id uuid primary key default gen_random_uuid(),
  source_row_id uuid not null unique,
  canonical_row_id uuid not null references public.hedge_market_prices(id) on delete restrict,
  price_date date not null,
  row_snapshot jsonb not null,
  superseded_reason text not null,
  superseded_at timestamptz not null default now()
);

alter table public.market_observation_evidence enable row level security;
alter table public.market_mops_publications enable row level security;
alter table public.hedge_market_price_superseded_history enable row level security;

revoke all on table public.market_observation_evidence from public, anon, authenticated;
revoke all on table public.market_mops_publications from public, anon, authenticated;
revoke all on table public.hedge_market_price_superseded_history from public, anon, authenticated;
grant all on table public.market_observation_evidence to service_role;
grant all on table public.market_mops_publications to service_role;
grant all on table public.hedge_market_price_superseded_history to service_role;

create index if not exists market_observation_evidence_date_idx
  on public.market_observation_evidence (price_date desc, series_id);
create index if not exists market_observation_evidence_quarantine_idx
  on public.market_observation_evidence (created_at desc)
  where disposition = 'quarantined';
create index if not exists market_mops_publications_date_idx
  on public.market_mops_publications (report_date desc);

create or replace function public.protect_market_observation_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'MARKET_OBSERVATION_EVIDENCE_IMMUTABLE';
end;
$$;

drop trigger if exists market_observation_evidence_immutable on public.market_observation_evidence;
create trigger market_observation_evidence_immutable
before update or delete on public.market_observation_evidence
for each row execute function public.protect_market_observation_evidence();

update public.market_intelligence_series
set product_label = 'S0.5 MOPS',
    alias_label = 'FOB Singapore 0.5% cargo',
    benchmark_label = 'S0.5 MOPS · FOB Singapore 0.5% cargo',
    usd_mt_factor = 1,
    basis_note = 'FOB Singapore 0.5% cargo MOPS benchmark'
where source_symbol = 'AMFSA00';

insert into public.market_intelligence_series (
  market_family, port_key, port_label, product_key, product_label, alias_label,
  source_symbol, source_type, unit, basis_note, benchmark_label, usd_mt_factor, display_order
) values
  ('delivered', 'hong-kong', 'Hong Kong', 'vlsfo', 'VLSFO 0.5%', null,
   'MFHKD00', 'assessment', 'USD/MT', 'Delivered bunker assessment', null, 1, 601),
  ('delivered', 'hong-kong', 'Hong Kong', 'hsfo380', 'HSFO 380', null,
   'PUAER00', 'assessment', 'USD/MT', 'Delivered bunker assessment', null, 1, 602),
  ('delivered', 'hong-kong', 'Hong Kong', 'lsmgo', 'LSMGO 0.1%', null,
   'AAXYQ00', 'assessment', 'USD/MT', 'Delivered bunker assessment', null, 1, 603),
  ('cargo', 'singapore', 'Singapore', 'hsfo380', 'S380 MOPS', 'FOB Singapore 380 CST cargo',
   'PPXDK00', 'assessment', 'USD/MT', 'FOB Singapore HSFO 380 CST cargo MOPS benchmark',
   'S380 MOPS · FOB Singapore 380 CST cargo', 1, 611),
  ('cargo', 'singapore', 'Singapore', 'lsmgo', 'SGO MOPS', 'FOB Singapore gasoil',
   'POABC00', 'assessment', 'USD/BBL', 'FOB Singapore gasoil MOPS benchmark; source unit USD/BBL',
   'SGO MOPS · FOB Singapore gasoil × 7.45', 7.45, 612)
on conflict (market_family, port_key, product_key) do update set
  port_label = excluded.port_label,
  product_label = excluded.product_label,
  alias_label = excluded.alias_label,
  source_symbol = excluded.source_symbol,
  source_type = excluded.source_type,
  unit = excluded.unit,
  basis_note = excluded.basis_note,
  benchmark_label = excluded.benchmark_label,
  usd_mt_factor = excluded.usd_mt_factor,
  display_order = excluded.display_order,
  active = true;

create unique index if not exists market_intelligence_series_source_symbol_unique
  on public.market_intelligence_series (source_symbol)
  where source_symbol is not null and active = true;

do $$
begin
  if exists (
    select 1
    from public.hedge_market_prices
    where price_date is not null
    group by price_date
    having count(*) > 1
       and count(distinct jsonb_build_object(
         's380', s380, 's05', s05, 'sgo', sgo, 'source', source,
         'raw_input', raw_input, 'is_estimate', is_estimate
       )::text) > 1
  ) then
    raise exception 'MOPS_DUPLICATE_VALUES_REQUIRE_REVIEW';
  end if;
end;
$$;

with ranked as (
  select row_value.*,
         first_value(id) over (
           partition by price_date
           order by is_estimate asc, updated_date desc nulls last, created_date desc nulls last, id
         ) as canonical_id,
         row_number() over (
           partition by price_date
           order by is_estimate asc, updated_date desc nulls last, created_date desc nulls last, id
         ) as row_number
  from public.hedge_market_prices row_value
  where price_date is not null
), archived as (
  insert into public.hedge_market_price_superseded_history (
    source_row_id, canonical_row_id, price_date, row_snapshot, superseded_reason
  )
  select id, canonical_id, price_date,
         jsonb_build_object(
           'id', id, 'revision', revision, 'price_date', price_date,
           's380', s380, 's05', s05, 'sgo', sgo, 'source', source,
           'raw_input_hash', case when raw_input is null then null else encode(extensions.digest(raw_input, 'sha256'), 'hex') end,
           'is_estimate', is_estimate, 'created_date', created_date, 'updated_date', updated_date
         ),
         'Identical same-date duplicate reconciled before canonical date enforcement'
  from ranked
  where row_number > 1
  on conflict (source_row_id) do nothing
  returning source_row_id
)
delete from public.hedge_market_prices
where id in (select source_row_id from archived);

create unique index if not exists hedge_market_prices_canonical_date_unique
  on public.hedge_market_prices (price_date)
  where price_date is not null;

create or replace function public.publish_market_mops_from_import(p_import_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.market_report_imports%rowtype;
  v_existing public.hedge_market_prices%rowtype;
  v_publication public.market_mops_publications%rowtype;
  v_s05 numeric;
  v_s380 numeric;
  v_sgo numeric;
  v_pages jsonb;
  v_outcome text;
  v_conflict text;
begin
  select * into v_import
  from public.market_report_imports
  where id = p_import_id
  for update;
  if not found or v_import.source_document_type <> 'european_marketscan' then
    return jsonb_build_object('status', 'not_applicable');
  end if;

  select * into v_publication
  from public.market_mops_publications
  where import_id = p_import_id;
  if found then
    return jsonb_build_object(
      'id', v_publication.id,
      'status', v_publication.outcome,
      'reportDate', v_publication.report_date,
      'hedgeMarketPriceId', v_publication.hedge_market_price_id,
      'conflictCode', v_publication.conflict_code
    );
  end if;

  select
    max(case when series.source_symbol = 'AMFSA00' then evidence.price end),
    max(case when series.source_symbol = 'PPXDK00' then evidence.price end),
    max(case when series.source_symbol = 'POABC00' then evidence.price end),
    jsonb_object_agg(series.source_symbol, evidence.source_page)
      filter (where series.source_symbol in ('AMFSA00', 'PPXDK00', 'POABC00'))
  into v_s05, v_s380, v_sgo, v_pages
  from public.market_observation_evidence evidence
  join public.market_intelligence_series series on series.id = evidence.series_id
  where evidence.import_id = p_import_id
    and series.source_symbol in ('AMFSA00', 'PPXDK00', 'POABC00')
    and evidence.disposition <> 'quarantined';

  if v_s05 is null or v_s380 is null or v_sgo is null then
    update public.market_report_imports
    set mops_publication_status = case when exists (
      select 1
      from public.market_observation_evidence evidence
      join public.market_intelligence_series series on series.id = evidence.series_id
      where evidence.import_id = p_import_id
        and series.source_symbol in ('AMFSA00', 'PPXDK00', 'POABC00')
        and evidence.disposition = 'quarantined'
    ) then 'conflict' else 'incomplete' end
    where id = p_import_id;
    return jsonb_build_object(
      'status', case when (select mops_publication_status from public.market_report_imports where id = p_import_id) = 'conflict' then 'conflict' else 'incomplete' end
    );
  end if;

  select * into v_existing
  from public.hedge_market_prices
  where price_date = v_import.report_date
  for update;

  if not found then
    insert into public.hedge_market_prices (
      price_date, s380, s05, sgo, source, raw_input, is_estimate,
      created_by, verification_status
    ) values (
      v_import.report_date, v_s380, v_s05, v_sgo,
      'European Marketscan · automated complete-triple publication', null, false,
      'system@fcos.local', 'unverified'
    ) returning * into v_existing;
    v_outcome := 'published';
  elsif v_existing.is_estimate then
    update public.hedge_market_prices
    set s380 = v_s380,
        s05 = v_s05,
        sgo = v_sgo,
        source = 'European Marketscan · automated complete-triple publication',
        raw_input = null,
        is_estimate = false,
        verification_status = 'unverified',
        verification_snapshot = null,
        verification_hash = null,
        verified_at = null,
        verified_by_id = null,
        updated_date = now()
    where id = v_existing.id
    returning * into v_existing;
    v_outcome := 'published';
  elsif v_existing.s380 is not distinct from v_s380
    and v_existing.s05 is not distinct from v_s05
    and v_existing.sgo is not distinct from v_sgo then
    v_outcome := 'matched';
  else
    v_outcome := 'conflict';
    v_conflict := 'MOPS_LEDGER_VALUE_MISMATCH';
  end if;

  insert into public.market_mops_publications (
    import_id, report_date, source_hash, symbols, source_pages,
    s05, s380, sgo, outcome, hedge_market_price_id, conflict_code
  ) values (
    v_import.id, v_import.report_date, v_import.source_hash,
    jsonb_build_array('AMFSA00', 'PPXDK00', 'POABC00'), coalesce(v_pages, '{}'::jsonb),
    v_s05, v_s380, v_sgo, v_outcome, v_existing.id, v_conflict
  ) returning * into v_publication;

  update public.market_report_imports
  set mops_publication_status = v_outcome,
      mops_publication_id = v_publication.id
  where id = v_import.id;

  insert into public.market_intelligence_events (
    event_type, entity_id, source_document_type, source_hash,
    observation_count, result_status, actor_user_id, actor_email
  ) values (
    'mops_publication', v_publication.id, v_import.source_document_type, v_import.source_hash,
    3, v_outcome, v_import.actor_user_id, lower(coalesce(v_import.actor_email, 'system@fcos.local'))
  );

  return jsonb_build_object(
    'id', v_publication.id,
    'status', v_publication.outcome,
    'reportDate', v_publication.report_date,
    'hedgeMarketPriceId', v_publication.hedge_market_price_id,
    'conflictCode', v_publication.conflict_code
  );
end;
$$;

create or replace function public.save_market_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_report_date date,
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
  v_import public.market_report_imports%rowtype;
  v_item jsonb;
  v_series public.market_intelligence_series%rowtype;
  v_canonical public.market_price_observations%rowtype;
  v_evidence public.market_observation_evidence%rowtype;
  v_price numeric;
  v_day_change numeric;
  v_count integer := 0;
  v_quarantined integer := 0;
  v_replayed boolean := false;
  v_disposition text;
  v_publication jsonb;
begin
  if coalesce(length(trim(p_idempotency_key)), 0) < 16 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_source_document_type not in ('bunkerwire', 'european_marketscan', 'manual') then
    raise exception 'INVALID_SOURCE_DOCUMENT_TYPE';
  end if;
  if coalesce(length(p_source_hash), 0) <> 64 then
    raise exception 'INVALID_SOURCE_HASH';
  end if;
  if jsonb_typeof(p_observations) <> 'array' or jsonb_array_length(p_observations) > 250 then
    raise exception 'INVALID_OBSERVATIONS';
  end if;

  select * into v_import
  from public.market_report_imports
  where idempotency_key = p_idempotency_key
     or (source_document_type = p_source_document_type and source_hash = p_source_hash)
  order by created_at desc
  limit 1
  for update;

  if found then
    if v_import.source_document_type <> p_source_document_type
       or v_import.source_hash <> p_source_hash
       or v_import.report_date <> p_report_date then
      raise exception 'MARKET_REPORT_REPLAY_CONFLICT';
    end if;
    v_replayed := true;
  else
    insert into public.market_report_imports (
      idempotency_key, source_document_type, source_hash, report_date,
      observation_count, actor_user_id, actor_email,
      mops_publication_status
    ) values (
      p_idempotency_key, p_source_document_type, p_source_hash, p_report_date,
      jsonb_array_length(p_observations), p_actor_user_id, lower(trim(p_actor_email)),
      case when p_source_document_type = 'european_marketscan' then 'incomplete' else 'not_applicable' end
    ) returning * into v_import;
  end if;

  for v_item in select * from jsonb_array_elements(p_observations)
  loop
    select * into strict v_series
    from public.market_intelligence_series
    where source_symbol = upper(trim(v_item->>'sourceSymbol')) and active = true;

    begin
      v_price := (v_item->>'price')::numeric;
      v_day_change := nullif(v_item->>'dayChange', '')::numeric;
    exception when others then
      raise exception 'INVALID_MARKET_PRICE:%', v_series.source_symbol;
    end;
    if v_price::text in ('NaN', 'Infinity', '-Infinity')
       or (v_series.value_kind <> 'spread' and v_price <= 0) then
      raise exception 'INVALID_MARKET_PRICE:%', v_series.source_symbol;
    end if;

    select * into v_evidence
    from public.market_observation_evidence
    where import_id = v_import.id and series_id = v_series.id;
    if found then
      if v_evidence.price <> v_price
         or v_evidence.day_change is distinct from v_day_change
         or v_evidence.price_date <> p_report_date then
        raise exception 'MARKET_EVIDENCE_REPLAY_CONFLICT:%', v_series.source_symbol;
      end if;
      v_count := v_count + 1;
      if v_evidence.disposition = 'quarantined' then v_quarantined := v_quarantined + 1; end if;
      continue;
    end if;

    select * into v_canonical
    from public.market_price_observations
    where series_id = v_series.id and price_date = p_report_date
    for update;

    if not found then
      insert into public.market_price_observations (
        series_id, import_id, price_date, price, day_change, quality_status,
        source_hash, source_page
      ) values (
        v_series.id, v_import.id, p_report_date, v_price, v_day_change,
        case when coalesce((v_item->>'isEstimate')::boolean, false) then 'estimate' else 'verified' end,
        p_source_hash, nullif(v_item->>'sourcePage', '')::integer
      ) returning * into v_canonical;
      v_disposition := 'accepted';
    elsif v_canonical.price = v_price then
      v_disposition := 'matching';
      if v_canonical.quality_status = 'estimate'
         and not coalesce((v_item->>'isEstimate')::boolean, false) then
        update public.market_price_observations
        set quality_status = 'verified'
        where id = v_canonical.id
        returning * into v_canonical;
      end if;
    else
      v_disposition := 'quarantined';
      v_quarantined := v_quarantined + 1;
    end if;

    insert into public.market_observation_evidence (
      import_id, series_id, price_date, price, day_change, source_hash,
      source_page, disposition, canonical_observation_id, conflict_code
    ) values (
      v_import.id, v_series.id, p_report_date, v_price, v_day_change, p_source_hash,
      nullif(v_item->>'sourcePage', '')::integer, v_disposition, v_canonical.id,
      case when v_disposition = 'quarantined' then 'SAME_DATE_SOURCE_VALUE_MISMATCH' else null end
    );

    if v_disposition = 'quarantined' then
      insert into public.market_intelligence_events (
        event_type, entity_id, source_document_type, source_hash,
        observation_count, result_status, actor_user_id, actor_email
      ) values (
        'observation_conflict', v_import.id, p_source_document_type, p_source_hash,
        1, 'quarantined', p_actor_user_id, lower(coalesce(p_actor_email, 'system@fcos.local'))
      );
    end if;
    v_count := v_count + 1;
  end loop;

  update public.market_report_imports
  set observation_count = v_count
  where id = v_import.id;

  if v_replayed then
    update public.market_intelligence_events
    set observation_count = v_count,
        result_status = case when v_quarantined > 0 then 'completed_with_conflicts' else 'completed' end
    where entity_id = v_import.id and event_type = 'report_imported';
    if not found then
      insert into public.market_intelligence_events (
        event_type, entity_id, source_document_type, source_hash,
        observation_count, result_status, actor_user_id, actor_email
      ) values (
        'report_imported', v_import.id, p_source_document_type, p_source_hash,
        v_count, case when v_quarantined > 0 then 'completed_with_conflicts' else 'completed' end,
        p_actor_user_id, lower(coalesce(p_actor_email, 'system@fcos.local'))
      );
    end if;
  else
    insert into public.market_intelligence_events (
      event_type, entity_id, source_document_type, source_hash,
      observation_count, result_status, actor_user_id, actor_email
    ) values (
      'report_imported', v_import.id, p_source_document_type, p_source_hash,
      v_count, case when v_quarantined > 0 then 'completed_with_conflicts' else 'completed' end,
      p_actor_user_id, lower(coalesce(p_actor_email, 'system@fcos.local'))
    );
  end if;

  v_publication := public.publish_market_mops_from_import(v_import.id);
  return jsonb_build_object(
    'id', v_import.id,
    'status', case when v_replayed then 'replayed' else 'completed' end,
    'observationCount', v_count,
    'quarantinedCount', v_quarantined,
    'mopsPublication', v_publication
  );
exception
  when no_data_found then
    raise exception 'UNKNOWN_MARKET_SERIES';
  when too_many_rows then
    raise exception 'DUPLICATE_MARKET_SERIES_SYMBOL';
end;
$$;

revoke all on function public.protect_market_observation_evidence() from public, anon, authenticated;
revoke all on function public.publish_market_mops_from_import(uuid) from public, anon, authenticated;
revoke all on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.protect_market_observation_evidence() to service_role;
grant execute on function public.publish_market_mops_from_import(uuid) to service_role;
grant execute on function public.save_market_report_import(text, text, text, date, jsonb, uuid, text) to service_role;

comment on table public.market_observation_evidence is
  'Immutable report-specific observation lineage. Conflicting same-date values remain quarantined and never overwrite the canonical observation.';
comment on table public.market_mops_publications is
  'Redacted complete-triple European Marketscan publication evidence for the authoritative FCOS MOPS ledger.';

commit;
