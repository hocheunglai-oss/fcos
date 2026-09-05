begin;

create table public.account_insight_report_presets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.user_profiles(id),
  scope text not null check (scope in ('personal','company')),
  name text not null check (length(btrim(name)) between 1 and 80),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz,
  updated_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index account_insight_report_presets_owner_active on public.account_insight_report_presets(owner_user_id, updated_at desc) where archived_at is null;
create index account_insight_report_presets_company_active on public.account_insight_report_presets(updated_at desc) where archived_at is null and scope = 'company';

create table public.account_insight_report_preset_events (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references public.account_insight_report_presets(id),
  actor_user_id uuid not null references public.user_profiles(id),
  operation text not null check (operation in ('save','archive')),
  resulting_revision integer not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique(actor_user_id,idempotency_key)
);
alter table public.account_insight_report_presets enable row level security;
alter table public.account_insight_report_preset_events enable row level security;
revoke all on public.account_insight_report_presets, public.account_insight_report_preset_events from public, anon, authenticated;
grant select, insert, update on public.account_insight_report_presets to service_role;
grant select, insert on public.account_insight_report_preset_events to service_role;

create function public.save_account_insight_report_preset(
  p_actor_user_id uuid, p_id uuid, p_name text, p_scope text, p_configuration jsonb,
  p_expected_revision integer, p_idempotency_key uuid, p_request_hash text, p_archive boolean default false
) returns public.account_insight_report_presets
language plpgsql security invoker set search_path = public
as $$
declare
  v_profile public.user_profiles%rowtype;
  v_current public.account_insight_report_presets%rowtype;
  v_event public.account_insight_report_preset_events%rowtype;
  v_company_allowed boolean := false;
begin
  select * into v_profile from public.user_profiles where id = p_actor_user_id and active = true;
  if not found then raise exception 'Active user required' using errcode = '42501'; end if;
  v_company_allowed := v_profile.user_type = 'administrator' or (
    v_profile.user_type = 'general_manager'
    and (select count(*) from public.collaboration_roles where role = 'general_manager' and active = true) = 1
    and exists(select 1 from public.collaboration_roles where role = 'general_manager' and active = true and user_id = p_actor_user_id)
  );
  if p_scope is null or p_scope not in ('personal','company') or (p_scope = 'company' and not v_company_allowed) then
    raise exception 'Preset permission denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid idempotency evidence'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || p_idempotency_key::text, 0));
  if p_id is not null then
    select * into v_current from public.account_insight_report_presets where id = p_id for update;
    if not found or v_current.scope <> p_scope or (v_current.scope = 'personal' and v_current.owner_user_id <> p_actor_user_id) then
      raise exception 'Preset not available' using errcode = '42501';
    end if;
  end if;
  select * into v_event from public.account_insight_report_preset_events where actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_event.request_hash <> p_request_hash then raise exception 'Idempotency key was reused with different content' using errcode = '40001'; end if;
    select * into v_current from public.account_insight_report_presets where id = v_event.preset_id;
    return v_current;
  end if;
  if p_id is null and p_archive then raise exception 'Preset is required'; end if;
  if p_id is not null and (v_current.archived_at is not null or p_expected_revision is distinct from v_current.revision) then
    raise exception 'Preset changed. Reload before saving.' using errcode = '40001';
  end if;
  if p_id is null and coalesce(p_expected_revision,0) <> 0 then raise exception 'Preset changed' using errcode = '40001'; end if;
  if not p_archive then
    if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'Preset name required'; end if;
    if p_configuration is null or jsonb_typeof(p_configuration) <> 'object' or octet_length(p_configuration::text) > 12000 then raise exception 'Invalid preset configuration'; end if;
    if exists(select 1 from jsonb_object_keys(p_configuration) k where k not in ('audience','sections','columns','depth','includeExpected','includeCharts')) then
      raise exception 'Only presentation choices may be saved';
    end if;
    if not coalesce(p_configuration->>'audience' = any(array['internal','buyer','supplier']), false)
      or jsonb_typeof(p_configuration->'sections') is distinct from 'array'
      or jsonb_typeof(p_configuration->'columns') is distinct from 'array'
      or not coalesce(p_configuration->>'depth' = any(array['summary','detail']), false)
      or jsonb_typeof(p_configuration->'includeExpected') is distinct from 'boolean'
      or jsonb_typeof(p_configuration->'includeCharts') is distinct from 'boolean' then raise exception 'Invalid presentation choices'; end if;
  end if;
  if p_id is null then
    insert into public.account_insight_report_presets(owner_user_id,scope,name,configuration,updated_by)
    values(p_actor_user_id,p_scope,btrim(p_name),p_configuration,p_actor_user_id) returning * into v_current;
  else
    update public.account_insight_report_presets set
      name = case when p_archive then name else btrim(p_name) end,
      configuration = case when p_archive then configuration else p_configuration end,
      archived_at = case when p_archive then clock_timestamp() else null end,
      revision = revision + 1, updated_by = p_actor_user_id, updated_at = clock_timestamp()
    where id = p_id returning * into v_current;
  end if;
  insert into public.account_insight_report_preset_events(preset_id,actor_user_id,operation,resulting_revision,request_hash,idempotency_key)
  values(v_current.id,p_actor_user_id,case when p_archive then 'archive' else 'save' end,v_current.revision,p_request_hash,p_idempotency_key);
  return v_current;
end;
$$;
revoke all on function public.save_account_insight_report_preset(uuid,uuid,text,text,jsonb,integer,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.save_account_insight_report_preset(uuid,uuid,text,text,jsonb,integer,uuid,text,boolean) to service_role;

commit;
