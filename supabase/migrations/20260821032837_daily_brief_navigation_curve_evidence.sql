begin;

-- The original forward series were intentionally tenor-qualified in
-- product_key.  Curve consumers use a canonical product identity and keep the
-- tenor separately, so normalize only the governed basis metadata while
-- retaining every series id and historical observation.
update public.market_intelligence_series
set basis_metadata = coalesce(basis_metadata, '{}'::jsonb) || jsonb_build_object(
      'productKey', case
        when source_symbol in ('FPLSM01', 'FPLSM02') then 'hsfo380'
        when source_symbol in ('FOFS000', 'FOFS001', 'FOFS002') then 'vlsfo'
        when source_symbol in ('BSGSL00', 'MSGSL00', 'MSHSL00') then 'lsmgo'
      end
    )
where active = true
  and source_symbol in ('FPLSM01', 'FPLSM02', 'FOFS000', 'FOFS001', 'FOFS002', 'BSGSL00', 'MSGSL00', 'MSHSL00');

create table if not exists public.market_report_series_availability (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.market_report_imports(id) on delete restrict,
  series_id uuid not null references public.market_intelligence_series(id) on delete restrict,
  report_date date not null,
  availability_status text not null check (availability_status in ('published_na', 'not_detected')),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  source_page integer check (source_page is null or source_page > 0),
  contract_month date,
  printed_contract_month date,
  tenor text,
  observation_unit text,
  assessment_session text,
  basis_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (import_id, series_id)
);

create index if not exists market_report_series_availability_report_idx
  on public.market_report_series_availability (report_date desc, availability_status, series_id);

alter table public.market_report_series_availability enable row level security;
revoke all on table public.market_report_series_availability from public, anon, authenticated;
grant select, insert on table public.market_report_series_availability to service_role;

drop trigger if exists market_report_series_availability_immutable on public.market_report_series_availability;
create trigger market_report_series_availability_immutable
before update or delete on public.market_report_series_availability
for each row execute function public.protect_market_intelligence_immutable();

create or replace function public.record_market_report_series_availability(
  p_import_id uuid,
  p_availability jsonb
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
  v_inserted integer := 0;
begin
  if jsonb_typeof(coalesce(p_availability, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_availability, '[]'::jsonb)) > 250 then
    raise exception 'INVALID_MARKET_AVAILABILITY';
  end if;
  select * into strict v_import from public.market_report_imports where id = p_import_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_availability, '[]'::jsonb))
  loop
    if v_item->>'status' not in ('published_na', 'not_detected') then
      raise exception 'INVALID_MARKET_AVAILABILITY_STATUS';
    end if;
    select * into strict v_series
    from public.market_intelligence_series
    where source_symbol = upper(trim(v_item->>'sourceSymbol')) and active = true;
    insert into public.market_report_series_availability (
      import_id, series_id, report_date, availability_status, source_hash,
      source_page, contract_month, printed_contract_month, tenor,
      observation_unit, assessment_session, basis_metadata
    ) values (
      v_import.id, v_series.id, v_import.report_date, v_item->>'status', v_import.source_hash,
      nullif(v_item->>'sourcePage', '')::integer,
      nullif(v_item->>'contractMonth', '')::date,
      nullif(v_item->>'printedContractMonth', '')::date,
      nullif(lower(v_item->>'tenor'), ''), nullif(v_item->>'unit', ''),
      nullif(v_item->>'assessmentSession', ''), coalesce(v_item->'basisMetadata', '{}'::jsonb)
    )
    on conflict (import_id, series_id) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;
  return jsonb_build_object('importId', v_import.id, 'insertedCount', v_inserted,
    'availabilityCount', jsonb_array_length(coalesce(p_availability, '[]'::jsonb)));
exception when no_data_found then
  raise exception 'MARKET_AVAILABILITY_IDENTITY_NOT_FOUND';
end;
$$;

-- Compatibility overload: existing callers can keep using the seven-argument
-- importer while updated callers persist availability evidence atomically.
create or replace function public.save_market_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_report_date date,
  p_observations jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_availability jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_result jsonb; v_availability jsonb;
begin
  v_result := public.save_market_report_import(
    p_idempotency_key, p_source_document_type, p_source_hash, p_report_date,
    p_observations, p_actor_user_id, p_actor_email
  );
  v_availability := public.record_market_report_series_availability(
    (v_result->>'id')::uuid, coalesce(p_availability, '[]'::jsonb)
  );
  return v_result || jsonb_build_object(
    'availabilityCount', v_availability->'availabilityCount',
    'availabilityInsertedCount', v_availability->'insertedCount'
  );
end;
$$;

create or replace function public.save_market_drive_report_import(
  p_idempotency_key text,
  p_source_document_type text,
  p_source_hash text,
  p_source_md5 text,
  p_drive_file_id text,
  p_drive_modified_at timestamptz,
  p_report_date date,
  p_observations jsonb,
  p_availability jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_result jsonb; v_availability jsonb;
begin
  v_result := public.save_market_drive_report_import(
    p_idempotency_key, p_source_document_type, p_source_hash, p_source_md5,
    p_drive_file_id, p_drive_modified_at, p_report_date, p_observations
  );
  v_availability := public.record_market_report_series_availability(
    (v_result->>'id')::uuid, coalesce(p_availability, '[]'::jsonb)
  );
  return v_result || jsonb_build_object(
    'availabilityCount', v_availability->'availabilityCount',
    'availabilityInsertedCount', v_availability->'insertedCount'
  );
end;
$$;

-- Creates a new immutable deterministic revision while preserving the same
-- licensed-report source hash. Identical retries replay the latest revision.
create or replace function public.revise_market_intelligence_brief(
  p_report_date date,
  p_source_hash text,
  p_as_of_at timestamptz,
  p_completeness jsonb,
  p_deterministic_metrics jsonb,
  p_ai_status text,
  p_model_id text,
  p_source_refs jsonb,
  p_items jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_latest public.market_intelligence_briefs%rowtype;
  v_brief public.market_intelligence_briefs%rowtype;
  v_item jsonb;
  v_order integer := 0;
begin
  select * into strict v_latest
  from public.market_intelligence_briefs
  where report_date = p_report_date
  order by revision desc
  limit 1
  for update;
  if v_latest.source_hash <> lower(p_source_hash) then raise exception 'MARKET_BRIEF_SOURCE_CHANGED'; end if;
  if v_latest.revision <> p_expected_revision then raise exception 'MARKET_BRIEF_REVISION_STALE'; end if;
  if v_latest.completeness = coalesce(p_completeness, '{}'::jsonb)
     and v_latest.deterministic_metrics = coalesce(p_deterministic_metrics, '{}'::jsonb) then
    return jsonb_build_object('id', v_latest.id, 'status', 'replayed', 'revision', v_latest.revision,
      'itemCount', (select count(*) from public.market_intelligence_brief_items where brief_id = v_latest.id));
  end if;
  if p_ai_status not in ('not_requested','completed','unavailable','failed','invalid','reused') then
    raise exception 'INVALID_MARKET_BRIEF_AI_STATUS';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'INVALID_MARKET_BRIEF_ITEMS'; end if;
  if p_items::text ~* '"(prompt|rawResponse|sourceText|quote|participantName)"\s*:' then raise exception 'MARKET_BRIEF_PROHIBITED_SOURCE_CONTENT'; end if;
  insert into public.market_intelligence_briefs (
    report_date, source_hash, as_of_at, completeness, deterministic_metrics,
    ai_status, model_id, source_refs, revision
  ) values (
    p_report_date, lower(p_source_hash), p_as_of_at, coalesce(p_completeness, '{}'::jsonb),
    coalesce(p_deterministic_metrics, '{}'::jsonb),
    case when p_ai_status = 'reused' then v_latest.ai_status else p_ai_status end,
    coalesce(p_model_id, v_latest.model_id), coalesce(p_source_refs, '[]'::jsonb), v_latest.revision + 1
  ) returning * into v_brief;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_order := v_order + 1;
    insert into public.market_intelligence_brief_items (
      brief_id,item_order,item_kind,title,summary,driver_tags,direction,confidence,
      product_key,port_key,horizon,source_refs,numeric_facts
    ) values (
      v_brief.id,v_order,v_item->>'kind',v_item->>'title',v_item->>'summary',
      coalesce(array(select jsonb_array_elements_text(v_item->'driverTags')),'{}'),
      nullif(v_item->>'direction',''),nullif(v_item->>'confidence','')::numeric,
      nullif(v_item->>'productKey',''),nullif(v_item->>'portKey',''),
      nullif(v_item->>'horizon',''),coalesce(v_item->'sourceRefs','[]'),
      coalesce(v_item->'numericFacts','[]')
    );
  end loop;
  return jsonb_build_object('id',v_brief.id,'status','completed','revision',v_brief.revision,'itemCount',v_order);
end;
$$;

revoke all on function public.record_market_report_series_availability(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.save_market_report_import(text,text,text,date,jsonb,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.save_market_drive_report_import(text,text,text,text,text,timestamptz,date,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.revise_market_intelligence_brief(date,text,timestamptz,jsonb,jsonb,text,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.record_market_report_series_availability(uuid,jsonb) to service_role;
grant execute on function public.save_market_report_import(text,text,text,date,jsonb,uuid,text,jsonb) to service_role;
grant execute on function public.save_market_drive_report_import(text,text,text,text,text,timestamptz,date,jsonb,jsonb) to service_role;
grant execute on function public.revise_market_intelligence_brief(date,text,timestamptz,jsonb,jsonb,text,text,jsonb,jsonb,bigint) to service_role;

comment on table public.market_report_series_availability is
  'Immutable service-only evidence that a configured report symbol was explicitly published N/A or was not detected; no report text or PDF bytes.';

commit;
