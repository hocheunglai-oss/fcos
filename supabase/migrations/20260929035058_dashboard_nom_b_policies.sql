create table public.dashboard_nom_b_policies (
  stem_id text primary key check (stem_id ~ '^[A-Za-z0-9]{18}$'),
  mode text not null default 'automatic' check (mode in ('automatic','waive','require')),
  reason_code text check (reason_code in ('payment_received','management_exception','other')),
  reason_text text not null default '' check (length(reason_text) <= 1000),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid,
  updated_by_email text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  check ((mode='automatic' and reason_code is null and reason_text='') or
    (mode in ('waive','require') and reason_code is not null and
      ((mode='waive' and reason_code<>'other') or length(btrim(reason_text))>0)))
);
create table public.dashboard_nom_b_observations (
  stem_id text primary key check (stem_id ~ '^[A-Za-z0-9]{18}$'),
  status text not null check (status in ('missing','filed','waived','unable_to_verify')),
  waiver_type text check (waiver_type in ('manual','automatic')),
  policy_revision bigint not null,
  evidence jsonb not null,
  observed_at timestamptz not null,
  check ((status='waived') = (waiver_type is not null))
);
create table public.dashboard_nom_b_events (
  id uuid primary key default gen_random_uuid(),
  stem_id text not null,
  event_type text not null check (event_type in ('policy_changed','status_changed')),
  actor_user_id uuid not null,
  actor_email text not null,
  actor_name text,
  previous_mode text,
  mode text,
  reason_code text,
  reason_text text,
  policy_revision bigint not null,
  previous_status text,
  status text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
comment on column public.dashboard_nom_b_events.actor_user_id is 'Immutable historical actor identity; deliberately not a cascading user_profiles foreign key.';
create index dashboard_nom_b_events_stem_time_idx on public.dashboard_nom_b_events(stem_id,created_at desc,id);
alter table public.dashboard_nom_b_policies enable row level security;
alter table public.dashboard_nom_b_observations enable row level security;
alter table public.dashboard_nom_b_events enable row level security;
revoke all on public.dashboard_nom_b_policies,public.dashboard_nom_b_observations,public.dashboard_nom_b_events from public,anon,authenticated,service_role;
grant select,insert,update on public.dashboard_nom_b_policies,public.dashboard_nom_b_observations to service_role;
grant select,insert on public.dashboard_nom_b_events to service_role;

create function public.dashboard_nom_b_immutable_event() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Nom B audit history is append-only.' using errcode='42501'; end;
$$;
create trigger dashboard_nom_b_events_immutable before update or delete on public.dashboard_nom_b_events
  for each row execute function public.dashboard_nom_b_immutable_event();
revoke all on function public.dashboard_nom_b_immutable_event() from public,anon,authenticated;

create function public.save_dashboard_nom_b_policy(p_stem_id text,p_mode text,p_reason_code text,p_reason_text text,p_expected_revision bigint,p_actor_user_id uuid)
returns public.dashboard_nom_b_policies language plpgsql security invoker set search_path='' as $$
declare v_actor public.user_profiles%rowtype; v_current public.dashboard_nom_b_policies%rowtype; v_saved public.dashboard_nom_b_policies%rowtype;
begin
  select * into v_actor from public.user_profiles where id=p_actor_user_id and active=true;
  if v_actor.id is null or not (v_actor.user_type='administrator' or (v_actor.user_type='general_manager'
    and (select count(*) from public.collaboration_roles where role='general_manager' and active=true)=1
    and exists(select 1 from public.collaboration_roles where role='general_manager' and active=true and user_id=v_actor.id))) then
    raise exception 'Nom B management permission is required.' using errcode='42501';
  end if;
  if p_stem_id is null or p_stem_id !~ '^[A-Za-z0-9]{18}$' or p_mode is null or p_mode not in ('automatic','waive','require')
    or p_reason_text is null or length(p_reason_text)>1000 or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'Invalid Nom B policy.' using errcode='22023'; end if;
  p_reason_text := btrim(p_reason_text);
  if p_mode='automatic' then p_reason_code:=null; p_reason_text:='';
  elsif p_reason_code is null or p_reason_code not in ('payment_received','management_exception','other')
    or ((p_mode='require' or p_reason_code='other') and p_reason_text='') then
    raise exception 'A valid Nom B policy reason is required.' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dashboard_nom_b:'||p_stem_id,0));
  insert into public.dashboard_nom_b_policies(stem_id) values(p_stem_id) on conflict do nothing;
  select * into strict v_current from public.dashboard_nom_b_policies where stem_id=p_stem_id for update;
  if p_expected_revision is distinct from v_current.revision then raise exception 'Nom B policy changed. Refresh before saving.' using errcode='40001'; end if;
  if v_current.mode=p_mode and v_current.reason_code is not distinct from p_reason_code and v_current.reason_text=p_reason_text then return v_current; end if;
  update public.dashboard_nom_b_policies set mode=p_mode,reason_code=p_reason_code,reason_text=p_reason_text,revision=revision+1,
    updated_by=v_actor.id,updated_by_email=v_actor.email,updated_by_name=v_actor.full_name,updated_at=clock_timestamp()
    where stem_id=p_stem_id returning * into v_saved;
  insert into public.dashboard_nom_b_events(stem_id,event_type,actor_user_id,actor_email,actor_name,previous_mode,mode,reason_code,reason_text,policy_revision,evidence)
    values(p_stem_id,'policy_changed',v_actor.id,coalesce(v_actor.email,v_actor.id::text),v_actor.full_name,v_current.mode,p_mode,p_reason_code,p_reason_text,v_saved.revision,
      jsonb_build_object('previousPolicy',jsonb_build_object('mode',v_current.mode,'reasonCode',v_current.reason_code,'reasonText',v_current.reason_text,'revision',v_current.revision),
        'policy',jsonb_build_object('mode',v_saved.mode,'reasonCode',v_saved.reason_code,'reasonText',v_saved.reason_text,'revision',v_saved.revision)));
  return v_saved;
end;
$$;

create function public.observe_dashboard_nom_b(p_observations jsonb,p_actor_user_id uuid,p_observed_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_actor public.user_profiles%rowtype; v_item jsonb; v_revision bigint; v_previous public.dashboard_nom_b_observations%rowtype; v_count integer:=0;
begin
  select * into v_actor from public.user_profiles where id=p_actor_user_id and active=true;
  if v_actor.id is null then raise exception 'An active Nom B viewer is required.' using errcode='42501'; end if;
  if p_observations is null or jsonb_typeof(p_observations)<>'array' or jsonb_array_length(p_observations)>1000
    or p_observed_at is null or p_observed_at>clock_timestamp()+interval '1 minute' then raise exception 'Invalid Nom B observations.' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_observations) order by value->>'stemId' loop
    if v_item->>'stemId' is null or v_item->>'stemId' !~ '^[A-Za-z0-9]{18}$' or v_item->>'status' is null
      or v_item->>'status' not in ('missing','filed','waived','unable_to_verify')
      or jsonb_typeof(v_item->'evidence') is distinct from 'object' then raise exception 'Invalid Nom B observation.' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dashboard_nom_b:'||(v_item->>'stemId'),0));
    select coalesce((select revision from public.dashboard_nom_b_policies where stem_id=v_item->>'stemId'),0) into v_revision;
    if (v_item->>'policyRevision')::bigint is distinct from v_revision then raise exception 'Nom B policy changed while refreshing.' using errcode='40001'; end if;
    select * into v_previous from public.dashboard_nom_b_observations where stem_id=v_item->>'stemId' for update;
    if v_previous.observed_at is not null and v_previous.observed_at>=p_observed_at then continue; end if;
    if v_previous.stem_id is null or v_previous.status is distinct from v_item->>'status' or v_previous.waiver_type is distinct from v_item->>'waiverType' then
      insert into public.dashboard_nom_b_events(stem_id,event_type,actor_user_id,actor_email,actor_name,policy_revision,previous_status,status,evidence)
        values(v_item->>'stemId','status_changed',v_actor.id,coalesce(v_actor.email,v_actor.id::text),v_actor.full_name,v_revision,v_previous.status,v_item->>'status',v_item->'evidence');
      v_count:=v_count+1;
    end if;
    insert into public.dashboard_nom_b_observations(stem_id,status,waiver_type,policy_revision,evidence,observed_at)
      values(v_item->>'stemId',v_item->>'status',v_item->>'waiverType',v_revision,v_item->'evidence',p_observed_at)
      on conflict(stem_id) do update set status=excluded.status,waiver_type=excluded.waiver_type,policy_revision=excluded.policy_revision,evidence=excluded.evidence,observed_at=excluded.observed_at;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.save_dashboard_nom_b_policy(text,text,text,text,bigint,uuid),public.observe_dashboard_nom_b(jsonb,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.save_dashboard_nom_b_policy(text,text,text,text,bigint,uuid),public.observe_dashboard_nom_b(jsonb,uuid,timestamptz) to service_role;
