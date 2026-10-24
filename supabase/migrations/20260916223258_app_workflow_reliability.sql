begin;

-- Aggregate signals only: no actors, record identifiers, form data or errors.
create table public.workflow_daily_metrics (
  event_day date not null default (now() at time zone 'Asia/Hong_Kong')::date,
  handler text not null check (handler ~ '^[a-zA-Z][a-zA-Z0-9]{0,99}$'),
  outcome text not null check (outcome in ('completed','conflict','denied','invalid','failed','uncertain')),
  request_count bigint not null default 0 check (request_count >= 0),
  duration_ms bigint not null default 0 check (duration_ms >= 0),
  primary key (event_day, handler, outcome)
);
alter table public.workflow_daily_metrics enable row level security;
revoke all on public.workflow_daily_metrics from public, anon, authenticated;
grant select, insert, update, delete on public.workflow_daily_metrics to service_role;

create function public.record_workflow_metric(p_handler text, p_outcome text, p_duration_ms integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.workflow_daily_metrics(event_day, handler, outcome, request_count, duration_ms)
  values ((now() at time zone 'Asia/Hong_Kong')::date, p_handler, p_outcome, 1, greatest(0, least(1800000, p_duration_ms)))
  on conflict (event_day, handler, outcome) do update
    set request_count = workflow_daily_metrics.request_count + 1,
        duration_ms = workflow_daily_metrics.duration_ms + excluded.duration_ms;
  delete from public.workflow_daily_metrics where event_day < (now() at time zone 'Asia/Hong_Kong')::date - 90;
end;
$$;
revoke all on function public.record_workflow_metric(text,text,integer) from public, anon, authenticated;
grant execute on function public.record_workflow_metric(text,text,integer) to service_role;

-- Keep completed request identities even if a task is later deleted. An old
-- network retry must not resurrect deleted work.
create table public.collaboration_create_requests (
  actor_id uuid not null references public.user_profiles(id),
  request_id uuid not null,
  request_hash text not null,
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
alter table public.collaboration_create_requests enable row level security;
revoke all on public.collaboration_create_requests from public, anon, authenticated;
grant select, insert on public.collaboration_create_requests to service_role;

create function public.create_collaboration_item_once(p_request_id uuid, p_values jsonb, p_actor_user_id uuid, p_actor_email text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_hash text := md5(coalesce(p_values, '{}'::jsonb)::text);
  v_previous public.collaboration_create_requests%rowtype;
  v_result jsonb;
begin
  if p_request_id is null or p_actor_user_id is null then
    raise exception 'A stable request and active actor are required.' using errcode = '22023';
  end if;
  if not exists(select 1 from public.user_profiles where id = p_actor_user_id and active = true) then
    raise exception 'Active user required.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || p_request_id::text, 0));
  select * into v_previous from public.collaboration_create_requests
    where actor_id = p_actor_user_id and request_id = p_request_id;
  if found then
    if v_previous.request_hash <> v_hash then
      raise exception 'This create request already saved different values. Open the saved work item before making changes.' using errcode = '40001';
    end if;
    return jsonb_build_object('item', jsonb_build_object('id', v_previous.item_id), 'replayed', true);
  end if;
  if p_values ? '_templateId' then
    v_result := public.save_collaboration_template(jsonb_build_object('mode', 'use', 'id', p_values->>'_templateId', 'project', p_values - '_templateId'), p_actor_user_id, p_actor_email);
    v_result := jsonb_build_object('item', v_result->'project');
  else
    v_result := public.create_collaboration_item(p_values, p_actor_user_id, p_actor_email);
  end if;
  insert into public.collaboration_create_requests(actor_id, request_id, request_hash, item_id)
    values (p_actor_user_id, p_request_id, v_hash, (v_result->'item'->>'id')::uuid);
  return v_result;
end;
$$;
revoke all on function public.create_collaboration_item_once(uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.create_collaboration_item_once(uuid,jsonb,uuid,text) to service_role;

commit;
