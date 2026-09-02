begin;

create table if not exists public.market_mops_secondary_imports (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_hash text not null unique check (source_hash ~ '^[a-f0-9]{64}$'),
  source_md5 text not null check (source_md5 ~ '^[a-f0-9]{32}$'),
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  drive_modified_at timestamptz,
  source_row_count integer not null check (source_row_count >= 0),
  comparison_date_count integer not null default 0 check (comparison_date_count >= 0),
  comparison_value_count integer not null default 0 check (comparison_value_count >= 0),
  matched_value_count integer not null default 0 check (matched_value_count >= 0),
  conflict_value_count integer not null default 0 check (conflict_value_count >= 0),
  published_date_count integer not null default 0 check (published_date_count >= 0),
  matched_date_count integer not null default 0 check (matched_date_count >= 0),
  conflict_date_count integer not null default 0 check (conflict_date_count >= 0),
  status text not null check (status in ('completed', 'completed_with_conflicts')),
  created_at timestamptz not null default now()
);

create table if not exists public.market_mops_secondary_evidence (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.market_mops_secondary_imports(id) on delete restrict,
  report_date date not null,
  s05 numeric(18, 6) not null check (s05 > 0),
  s380 numeric(18, 6) not null check (s380 > 0),
  sgo numeric(18, 6) not null check (sgo > 0),
  existing_s05 numeric(18, 6),
  existing_s380 numeric(18, 6),
  existing_sgo numeric(18, 6),
  outcome text not null check (outcome in ('published', 'matched', 'conflict')),
  conflict_symbols text[] not null default '{}'::text[],
  hedge_market_price_id uuid references public.hedge_market_prices(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (import_id, report_date)
);

create index if not exists market_mops_secondary_imports_recent_idx
  on public.market_mops_secondary_imports (drive_modified_at desc, created_at desc);
create index if not exists market_mops_secondary_evidence_date_idx
  on public.market_mops_secondary_evidence (report_date desc, outcome);

alter table public.market_mops_secondary_imports enable row level security;
alter table public.market_mops_secondary_evidence enable row level security;
revoke all on table public.market_mops_secondary_imports from public, anon, authenticated;
revoke all on table public.market_mops_secondary_evidence from public, anon, authenticated;
grant all on table public.market_mops_secondary_imports to service_role;
grant all on table public.market_mops_secondary_evidence to service_role;

create or replace function public.save_market_mops_secondary_csv(
  p_idempotency_key text,
  p_source_hash text,
  p_source_md5 text,
  p_drive_file_id text,
  p_drive_modified_at timestamptz,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_import public.market_mops_secondary_imports%rowtype;
  v_item jsonb;
  v_existing public.hedge_market_prices%rowtype;
  v_report_date date;
  v_s05 numeric;
  v_s380 numeric;
  v_sgo numeric;
  v_source_rows integer;
  v_distinct_dates integer;
  v_comparison_dates integer := 0;
  v_comparison_values integer := 0;
  v_matched_values integer := 0;
  v_conflict_values integer := 0;
  v_recent_conflicts integer := 0;
  v_published_dates integer := 0;
  v_matched_dates integer := 0;
  v_conflict_dates integer := 0;
  v_outcome text;
  v_conflict_symbols text[];
begin
  if coalesce(length(trim(p_idempotency_key)), 0) < 16 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if lower(coalesce(p_source_hash, '')) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_MARKET_SOURCE_HASH'; end if;
  if lower(coalesce(p_source_md5, '')) !~ '^[a-f0-9]{32}$' then raise exception 'INVALID_MARKET_SOURCE_MD5'; end if;
  if coalesce(p_drive_file_id, '') !~ '^[A-Za-z0-9_-]{10,200}$' then raise exception 'INVALID_MARKET_DRIVE_FILE_ID'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 20 or jsonb_array_length(p_rows) > 1000 then
    raise exception 'INVALID_MARKET_SECONDARY_ROWS';
  end if;

  select * into v_import
  from public.market_mops_secondary_imports
  where idempotency_key = p_idempotency_key or source_hash = lower(p_source_hash)
  order by created_at desc
  limit 1;
  if found then
    if v_import.source_hash <> lower(p_source_hash)
       or v_import.source_md5 <> lower(p_source_md5)
       or v_import.drive_file_id <> p_drive_file_id then
      raise exception 'MARKET_SECONDARY_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object(
      'id', v_import.id, 'status', 'replayed',
      'comparisonDateCount', v_import.comparison_date_count,
      'comparisonValueCount', v_import.comparison_value_count,
      'matchedValueCount', v_import.matched_value_count,
      'conflictValueCount', v_import.conflict_value_count,
      'publishedDateCount', v_import.published_date_count,
      'matchedDateCount', v_import.matched_date_count,
      'conflictDateCount', v_import.conflict_date_count
    );
  end if;

  select count(*), count(distinct item->>'reportDate')
  into v_source_rows, v_distinct_dates
  from jsonb_array_elements(p_rows) item;
  if v_source_rows <> v_distinct_dates then raise exception 'DUPLICATE_MARKET_SECONDARY_DATE'; end if;

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    begin
      v_report_date := (v_item->>'reportDate')::date;
      v_s05 := (v_item->>'s05')::numeric;
      v_s380 := (v_item->>'s380')::numeric;
      v_sgo := (v_item->>'sgo')::numeric;
    exception when others then
      raise exception 'INVALID_MARKET_SECONDARY_VALUE';
    end;
    if v_report_date < date '2025-01-01'
       or v_report_date > (now() at time zone 'Asia/Hong_Kong')::date
       or least(v_s05, v_s380, v_sgo) <= 0 then
      raise exception 'INVALID_MARKET_SECONDARY_VALUE';
    end if;
  end loop;

  with supplied as (
    select (item->>'reportDate')::date report_date,
           (item->>'s05')::numeric s05,
           (item->>'s380')::numeric s380,
           (item->>'sgo')::numeric sgo
    from jsonb_array_elements(p_rows) item
  ), compared as (
    select supplied.*,
           ledger.s05 existing_s05, ledger.s380 existing_s380, ledger.sgo existing_sgo
    from supplied
    join public.hedge_market_prices ledger on ledger.price_date = supplied.report_date
    where ledger.is_estimate = false
  )
  select count(*), count(*) * 3,
         sum((s05 = existing_s05)::integer + (s380 = existing_s380)::integer + (sgo = existing_sgo)::integer),
         sum((s05 <> existing_s05)::integer + (s380 <> existing_s380)::integer + (sgo <> existing_sgo)::integer)
  into v_comparison_dates, v_comparison_values, v_matched_values, v_conflict_values
  from compared;

  with supplied as (
    select (item->>'reportDate')::date report_date,
           (item->>'s05')::numeric s05,
           (item->>'s380')::numeric s380,
           (item->>'sgo')::numeric sgo
    from jsonb_array_elements(p_rows) item
  ), recent as (
    select supplied.*, ledger.s05 existing_s05, ledger.s380 existing_s380, ledger.sgo existing_sgo
    from supplied
    join public.hedge_market_prices ledger on ledger.price_date = supplied.report_date
    where ledger.is_estimate = false
    order by supplied.report_date desc
    limit 20
  )
  select count(*) filter (where s05 <> existing_s05 or s380 <> existing_s380 or sgo <> existing_sgo)
  into v_recent_conflicts
  from recent;

  if v_comparison_dates < 20
     or v_comparison_values = 0
     or v_matched_values * 1000 < v_comparison_values * 995
     or v_recent_conflicts > 0 then
    raise exception 'MARKET_SECONDARY_HISTORY_VERIFICATION_FAILED';
  end if;

  insert into public.market_mops_secondary_imports (
    idempotency_key, source_hash, source_md5, drive_file_id, drive_modified_at,
    source_row_count, comparison_date_count, comparison_value_count,
    matched_value_count, conflict_value_count, status
  ) values (
    trim(p_idempotency_key), lower(p_source_hash), lower(p_source_md5), p_drive_file_id, p_drive_modified_at,
    v_source_rows, v_comparison_dates, v_comparison_values,
    v_matched_values, v_conflict_values, 'completed'
  ) returning * into v_import;

  for v_item in
    select item from jsonb_array_elements(p_rows) item order by (item->>'reportDate')::date
  loop
    v_report_date := (v_item->>'reportDate')::date;
    v_s05 := (v_item->>'s05')::numeric;
    v_s380 := (v_item->>'s380')::numeric;
    v_sgo := (v_item->>'sgo')::numeric;
    v_conflict_symbols := '{}'::text[];

    select * into v_existing
    from public.hedge_market_prices
    where price_date = v_report_date
    for update;

    if not found then
      insert into public.hedge_market_prices (
        price_date, s380, s05, sgo, source, raw_input, is_estimate,
        created_by, verification_status
      ) values (
        v_report_date, v_s380, v_s05, v_sgo,
        'S&P Core Export CSV · secondary complete-triple publication', null, false,
        'market-sync@fcos.internal', 'unverified'
      ) returning * into v_existing;
      v_outcome := 'published';
      v_published_dates := v_published_dates + 1;
    elsif v_existing.is_estimate then
      update public.hedge_market_prices
      set s380 = v_s380, s05 = v_s05, sgo = v_sgo,
          source = 'S&P Core Export CSV · secondary complete-triple publication',
          raw_input = null, is_estimate = false, verification_status = 'unverified',
          verification_snapshot = null, verification_hash = null,
          verified_at = null, verified_by_id = null, updated_date = now()
      where id = v_existing.id
      returning * into v_existing;
      v_outcome := 'published';
      v_published_dates := v_published_dates + 1;
    elsif v_existing.s05 = v_s05 and v_existing.s380 = v_s380 and v_existing.sgo = v_sgo then
      v_outcome := 'matched';
      v_matched_dates := v_matched_dates + 1;
    else
      if v_existing.s05 is distinct from v_s05 then v_conflict_symbols := array_append(v_conflict_symbols, 'AMFSA00'); end if;
      if v_existing.s380 is distinct from v_s380 then v_conflict_symbols := array_append(v_conflict_symbols, 'PPXDK00'); end if;
      if v_existing.sgo is distinct from v_sgo then v_conflict_symbols := array_append(v_conflict_symbols, 'POABC00'); end if;
      v_outcome := 'conflict';
      v_conflict_dates := v_conflict_dates + 1;
    end if;

    insert into public.market_mops_secondary_evidence (
      import_id, report_date, s05, s380, sgo,
      existing_s05, existing_s380, existing_sgo,
      outcome, conflict_symbols, hedge_market_price_id
    ) values (
      v_import.id, v_report_date, v_s05, v_s380, v_sgo,
      case when v_outcome = 'published' then null else v_existing.s05 end,
      case when v_outcome = 'published' then null else v_existing.s380 end,
      case when v_outcome = 'published' then null else v_existing.sgo end,
      v_outcome, v_conflict_symbols, v_existing.id
    );
  end loop;

  update public.market_mops_secondary_imports
  set published_date_count = v_published_dates,
      matched_date_count = v_matched_dates,
      conflict_date_count = v_conflict_dates,
      status = case when v_conflict_dates > 0 then 'completed_with_conflicts' else 'completed' end
  where id = v_import.id
  returning * into v_import;

  insert into public.market_intelligence_events (
    event_type, entity_id, source_document_type, source_hash,
    observation_count, result_status, actor_user_id, actor_email
  ) values (
    'mops_secondary_csv_imported', v_import.id, 'market_data_csv', v_import.source_hash,
    v_import.source_row_count, v_import.status, null, 'market-sync@fcos.internal'
  );

  return jsonb_build_object(
    'id', v_import.id, 'status', v_import.status,
    'comparisonDateCount', v_import.comparison_date_count,
    'comparisonValueCount', v_import.comparison_value_count,
    'matchedValueCount', v_import.matched_value_count,
    'conflictValueCount', v_import.conflict_value_count,
    'publishedDateCount', v_import.published_date_count,
    'matchedDateCount', v_import.matched_date_count,
    'conflictDateCount', v_import.conflict_date_count
  );
end;
$$;

create or replace function public.promote_secondary_mops_source_after_primary_match()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.outcome = 'matched' and new.hedge_market_price_id is not null then
    update public.hedge_market_prices
    set source = 'European Marketscan · automated complete-triple publication',
        updated_date = now()
    where id = new.hedge_market_price_id
      and source = 'S&P Core Export CSV · secondary complete-triple publication';
  end if;
  return new;
end;
$$;

drop trigger if exists market_mops_primary_source_promotion on public.market_mops_publications;
create trigger market_mops_primary_source_promotion
after insert on public.market_mops_publications
for each row execute function public.promote_secondary_mops_source_after_primary_match();

revoke all on function public.save_market_mops_secondary_csv(text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.promote_secondary_mops_source_after_primary_match() from public, anon, authenticated;
grant execute on function public.save_market_mops_secondary_csv(text, text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.promote_secondary_mops_source_after_primary_match() to service_role;

comment on table public.market_mops_secondary_imports is
  'Service-only immutable summaries for historically verified S&P Core Export CSV files; source bytes are never stored.';
comment on table public.market_mops_secondary_evidence is
  'Service-only date-level MOPS lineage from historically verified secondary CSV exports.';

commit;
