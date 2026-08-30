begin;

-- A row-locking SELECT requires UPDATE privilege even when the caller only
-- needs serialization. Brief rows are immutable and service_role is
-- intentionally limited to SELECT/INSERT, so serialize revisions with a
-- transaction-scoped advisory lock keyed by report date instead.
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
  perform pg_advisory_xact_lock(hashtextextended(
    'market-intelligence-brief:' || p_report_date::text,
    0
  ));
  select * into strict v_latest
  from public.market_intelligence_briefs
  where report_date = p_report_date
  order by revision desc
  limit 1;
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

revoke all on function public.revise_market_intelligence_brief(date,text,timestamptz,jsonb,jsonb,text,text,jsonb,jsonb,bigint)
  from public, anon, authenticated;
grant execute on function public.revise_market_intelligence_brief(date,text,timestamptz,jsonb,jsonb,text,text,jsonb,jsonb,bigint)
  to service_role;

comment on function public.revise_market_intelligence_brief(date,text,timestamptz,jsonb,jsonb,text,text,jsonb,jsonb,bigint) is
  'Creates immutable deterministic brief revisions under a transaction advisory lock without granting UPDATE on immutable brief tables.';

commit;
