begin;

create table if not exists emailrouter.routing_preset_versions (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references emailrouter.routing_presets(id) on delete cascade,
  version_label text not null,
  version_kind text not null check (version_kind in ('baseline', 'conditional')),
  match_mode text check (match_mode in ('all', 'any')),
  priority integer not null default 0 check (priority between 0 and 100000),
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(version_label)) between 1 and 120),
  check (
    (version_kind = 'baseline' and match_mode is null and priority = 0)
    or (version_kind = 'conditional' and match_mode is not null)
  )
);
create unique index if not exists emailrouter_routing_preset_versions_label_key
  on emailrouter.routing_preset_versions (preset_id, lower(btrim(version_label)));
create unique index if not exists emailrouter_routing_preset_versions_baseline_key
  on emailrouter.routing_preset_versions (preset_id)
  where version_kind = 'baseline';
create index if not exists emailrouter_routing_preset_versions_resolver_idx
  on emailrouter.routing_preset_versions (preset_id, active, priority desc);

create table if not exists emailrouter.routing_preset_version_conditions (
  version_id uuid not null references emailrouter.routing_preset_versions(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (version_id, user_profile_id)
);
create index if not exists emailrouter_routing_preset_conditions_user_idx
  on emailrouter.routing_preset_version_conditions (user_profile_id, version_id);

create table if not exists emailrouter.routing_preset_version_destinations (
  version_id uuid not null references emailrouter.routing_preset_versions(id) on delete cascade,
  destination_id uuid references emailrouter.destinations(id) on delete restrict,
  group_id uuid references emailrouter.destination_groups(id) on delete restrict,
  recipient_kind text not null check (recipient_kind in ('to', 'cc', 'bcc')),
  position smallint not null check (position > 0),
  created_at timestamptz not null default now(),
  primary key (version_id, recipient_kind, position),
  check ((destination_id is null) <> (group_id is null))
);
create unique index if not exists emailrouter_routing_preset_version_destination_key
  on emailrouter.routing_preset_version_destinations (version_id, destination_id)
  where destination_id is not null;
create unique index if not exists emailrouter_routing_preset_version_group_key
  on emailrouter.routing_preset_version_destinations (version_id, group_id)
  where group_id is not null;

create table if not exists emailrouter.routing_leave_periods (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '',
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (char_length(note) <= 500)
);
create index if not exists emailrouter_routing_leave_user_time_idx
  on emailrouter.routing_leave_periods (user_profile_id, starts_at, ends_at)
  where active = true;

create table if not exists emailrouter.routing_preset_overrides (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references emailrouter.routing_presets(id) on delete cascade,
  version_id uuid not null references emailrouter.routing_preset_versions(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  active boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (char_length(btrim(reason)) between 3 and 500)
);
create index if not exists emailrouter_routing_preset_override_time_idx
  on emailrouter.routing_preset_overrides (preset_id, starts_at, ends_at)
  where active = true;

alter table emailrouter.mail_actions
  add column if not exists preset_version_id uuid references emailrouter.routing_preset_versions(id) on delete set null,
  add column if not exists preset_version_label_snapshot text,
  add column if not exists route_resolution_reason text,
  add column if not exists route_definition_hash text,
  add column if not exists route_recipient_snapshot jsonb,
  add column if not exists route_snapshot_issued_at timestamptz,
  add column if not exists route_snapshot_expires_at timestamptz;

alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_route_definition_hash_check;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_route_definition_hash_check
  check (route_definition_hash is null or route_definition_hash ~ '^[0-9a-f]{64}$');
alter table emailrouter.mail_actions
  drop constraint if exists emailrouter_mail_actions_route_recipient_snapshot_check;
alter table emailrouter.mail_actions
  add constraint emailrouter_mail_actions_route_recipient_snapshot_check
  check (route_recipient_snapshot is null or jsonb_typeof(route_recipient_snapshot) = 'array');

insert into emailrouter.routing_preset_versions (
  preset_id, version_label, version_kind, match_mode, priority, active, created_by, updated_by
)
select preset.id, 'Standard', 'baseline', null, 0, true, preset.created_by, preset.updated_by
from emailrouter.routing_presets preset
where not exists (
  select 1 from emailrouter.routing_preset_versions version
  where version.preset_id = preset.id and version.version_kind = 'baseline'
);

insert into emailrouter.routing_preset_version_destinations (
  version_id, destination_id, group_id, recipient_kind, position
)
select version.id, selection.destination_id, selection.group_id, selection.recipient_kind, selection.position
from emailrouter.routing_preset_versions version
join emailrouter.routing_preset_destinations selection on selection.preset_id = version.preset_id
where version.version_kind = 'baseline'
on conflict (version_id, recipient_kind, position) do nothing;

alter table emailrouter.events
  drop constraint if exists events_entity_type_check;
alter table emailrouter.events
  add constraint events_entity_type_check
  check (entity_type in (
    'mailbox', 'message', 'destination', 'group', 'preset', 'preset_version',
    'preset_override', 'routing_leave', 'setting', 'mail_action', 'subscription',
    'alert', 'ai_usage', 'routing_directory'
  ));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'routing_preset_versions',
    'routing_preset_version_conditions',
    'routing_preset_version_destinations',
    'routing_leave_periods',
    'routing_preset_overrides'
  ] loop
    execute format('alter table emailrouter.%I enable row level security', table_name);
    execute format('revoke all on table emailrouter.%I from public, anon, authenticated', table_name);
    execute format('grant all on table emailrouter.%I to service_role', table_name);
  end loop;
end;
$$;

create or replace function emailrouter.validate_version_destinations(p_selections jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  selection jsonb;
  destination_id_value uuid;
  group_id_value uuid;
  recipient_kind_value text;
  position_value integer;
begin
  if jsonb_typeof(p_selections) <> 'array'
     or jsonb_array_length(p_selections) not between 1 and 50 then
    raise exception 'A routing version requires between one and 50 recipients';
  end if;

  for selection in select value from jsonb_array_elements(p_selections)
  loop
    destination_id_value := nullif(selection->>'destinationId', '')::uuid;
    group_id_value := nullif(selection->>'groupId', '')::uuid;
    recipient_kind_value := coalesce(selection->>'recipientKind', selection->>'kind');
    position_value := coalesce((selection->>'position')::integer, 0);
    if recipient_kind_value not in ('to', 'cc', 'bcc')
       or position_value < 1
       or ((destination_id_value is null) = (group_id_value is null)) then
      raise exception 'Email Router preset version contains an invalid recipient';
    end if;
    if destination_id_value is not null and not exists (
      select 1 from emailrouter.destinations destination
      where destination.id = destination_id_value
        and destination.active = true and destination.redirect_enabled = true
    ) then
      raise exception 'Email Router preset version contains an unavailable destination';
    end if;
    if group_id_value is not null and not exists (
      select 1 from emailrouter.destination_groups destination_group
      where destination_group.id = group_id_value
        and destination_group.active = true and destination_group.redirect_enabled = true
        and exists (
          select 1 from emailrouter.destination_group_members member
          join emailrouter.destinations destination on destination.id = member.destination_id
          where member.group_id = destination_group.id
            and destination.active = true and destination.redirect_enabled = true
        )
    ) then
      raise exception 'Email Router preset version contains an unavailable group';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select coalesce(nullif(value->>'destinationId', ''), 'group:' || nullif(value->>'groupId', '')) recipient_key,
             count(*) use_count
      from jsonb_array_elements(p_selections)
      group by 1
    ) duplicate
    where duplicate.use_count > 1
  ) then
    raise exception 'A routing version recipient can appear only once';
  end if;

  if exists (
    select 1
    from (
      select coalesce(value->>'recipientKind', value->>'kind') recipient_kind,
             (value->>'position')::integer position,
             count(*) position_count
      from jsonb_array_elements(p_selections)
      group by 1, 2
    ) duplicate
    where duplicate.position_count > 1
  ) then
    raise exception 'Routing version recipient positions must be unique';
  end if;
end;
$$;

create or replace function emailrouter.replace_version_destinations(
  p_version_id uuid,
  p_selections jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  selection jsonb;
begin
  perform emailrouter.validate_version_destinations(p_selections);
  delete from emailrouter.routing_preset_version_destinations where version_id = p_version_id;
  for selection in select value from jsonb_array_elements(p_selections)
  loop
    insert into emailrouter.routing_preset_version_destinations (
      version_id, destination_id, group_id, recipient_kind, position
    ) values (
      p_version_id,
      nullif(selection->>'destinationId', '')::uuid,
      nullif(selection->>'groupId', '')::uuid,
      coalesce(selection->>'recipientKind', selection->>'kind'),
      (selection->>'position')::smallint
    );
  end loop;
end;
$$;

create or replace function public.save_emailrouter_preset(
  p_operation jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  entity_id uuid := nullif(p_operation->>'id', '')::uuid;
  expected_revision bigint := nullif(p_operation->>'expectedRevision', '')::bigint;
  baseline_id uuid := nullif(p_operation->>'baselineVersionId', '')::uuid;
  baseline_expected_revision bigint := nullif(p_operation->>'baselineExpectedRevision', '')::bigint;
  selections jsonb := coalesce(p_operation->'destinations', '[]'::jsonb);
  selection jsonb;
  preset_row emailrouter.routing_presets%rowtype;
  baseline_row emailrouter.routing_preset_versions%rowtype;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;
  if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
     or char_length(coalesce(p_operation->>'description', '')) > 1000 then
    raise exception 'A unique preset name is required';
  end if;
  perform emailrouter.validate_version_destinations(selections);

  if entity_id is null then
    insert into emailrouter.routing_presets (
      preset_key, display_name, description, active, sort_order, created_by, updated_by
    ) values (
      gen_random_uuid()::text,
      btrim(p_operation->>'displayName'),
      coalesce(p_operation->>'description', ''),
      coalesce((p_operation->>'active')::boolean, true),
      greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0),
      p_actor, p_actor
    ) returning * into preset_row;
    insert into emailrouter.routing_preset_versions (
      preset_id, version_label, version_kind, match_mode, priority, active, created_by, updated_by
    ) values (preset_row.id, 'Standard', 'baseline', null, 0, true, p_actor, p_actor)
    returning * into baseline_row;
  else
    update emailrouter.routing_presets preset
    set display_name = btrim(p_operation->>'displayName'),
        description = coalesce(p_operation->>'description', ''),
        active = coalesce((p_operation->>'active')::boolean, true),
        sort_order = greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0),
        revision = preset.revision + 1,
        updated_by = p_actor,
        updated_at = now()
    where preset.id = entity_id and preset.revision = expected_revision
    returning * into preset_row;
    if preset_row.id is null then raise exception 'Email Router preset revision conflict'; end if;

    update emailrouter.routing_preset_versions version
    set revision = version.revision + 1, updated_by = p_actor, updated_at = now()
    where version.id = baseline_id
      and version.preset_id = preset_row.id
      and version.version_kind = 'baseline'
      and version.revision = baseline_expected_revision
    returning * into baseline_row;
    if baseline_row.id is null then raise exception 'Email Router Standard version revision conflict'; end if;
  end if;

  perform emailrouter.replace_version_destinations(baseline_row.id, selections);
  delete from emailrouter.routing_preset_destinations where preset_id = preset_row.id;
  for selection in select value from jsonb_array_elements(selections)
  loop
    insert into emailrouter.routing_preset_destinations (
      preset_id, destination_id, group_id, recipient_kind, position
    ) values (
      preset_row.id,
      nullif(selection->>'destinationId', '')::uuid,
      nullif(selection->>'groupId', '')::uuid,
      coalesce(selection->>'recipientKind', selection->>'kind'),
      (selection->>'position')::smallint
    );
  end loop;

  insert into emailrouter.events (event_type, entity_type, entity_id, actor_user_id, idempotency_key)
  values ('configuration.preset_save', 'preset', preset_row.id, p_actor, gen_random_uuid()::text);
  return jsonb_build_object(
    'id', preset_row.id,
    'type', 'preset_save',
    'revision', preset_row.revision,
    'baselineVersionId', baseline_row.id,
    'baselineRevision', baseline_row.revision
  );
end;
$$;

create or replace function public.save_emailrouter_preset_version(
  p_operation jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  entity_id uuid := nullif(p_operation->>'id', '')::uuid;
  preset_id_value uuid := nullif(p_operation->>'presetId', '')::uuid;
  expected_revision bigint := nullif(p_operation->>'expectedRevision', '')::bigint;
  condition_ids jsonb := coalesce(p_operation->'conditionUserIds', '[]'::jsonb);
  selections jsonb := coalesce(p_operation->'destinations', '[]'::jsonb);
  condition_value text;
  version_row emailrouter.routing_preset_versions%rowtype;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;
  if not exists (select 1 from emailrouter.routing_presets where id = preset_id_value) then
    raise exception 'Email Router preset is unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('emailrouter:preset:' || preset_id_value::text, 0));
  if lower(btrim(coalesce(p_operation->>'versionLabel', ''))) = 'standard'
     or char_length(btrim(coalesce(p_operation->>'versionLabel', ''))) not between 1 and 120
     or coalesce(p_operation->>'matchMode', '') not in ('all', 'any')
     or jsonb_typeof(condition_ids) <> 'array'
     or jsonb_array_length(condition_ids) not between 1 and 50 then
    raise exception 'A conditional version requires a unique label, match rule, and at least one active FCOS user';
  end if;
  if (select count(*) from jsonb_array_elements_text(condition_ids))
     <> (select count(distinct value) from jsonb_array_elements_text(condition_ids)) then
    raise exception 'A leave condition user can appear only once';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(condition_ids) requested(value)
    where not exists (
      select 1 from public.user_profiles profile
      where profile.id = requested.value::uuid and profile.active = true
    )
  ) then
    raise exception 'A leave condition user is inactive or unavailable';
  end if;
  perform emailrouter.validate_version_destinations(selections);

  if entity_id is null then
    insert into emailrouter.routing_preset_versions (
      preset_id, version_label, version_kind, match_mode, priority, active, created_by, updated_by
    ) values (
      preset_id_value,
      btrim(p_operation->>'versionLabel'),
      'conditional',
      p_operation->>'matchMode',
      greatest(coalesce((p_operation->>'priority')::integer, 0), 0),
      coalesce((p_operation->>'active')::boolean, true),
      p_actor, p_actor
    ) returning * into version_row;
  else
    update emailrouter.routing_preset_versions version
    set version_label = btrim(p_operation->>'versionLabel'),
        match_mode = p_operation->>'matchMode',
        priority = greatest(coalesce((p_operation->>'priority')::integer, 0), 0),
        active = coalesce((p_operation->>'active')::boolean, true),
        revision = version.revision + 1,
        updated_by = p_actor,
        updated_at = now()
    where version.id = entity_id
      and version.preset_id = preset_id_value
      and version.version_kind = 'conditional'
      and version.revision = expected_revision
    returning * into version_row;
    if version_row.id is null then raise exception 'Email Router preset version revision conflict'; end if;
  end if;

  delete from emailrouter.routing_preset_version_conditions where version_id = version_row.id;
  for condition_value in select value from jsonb_array_elements_text(condition_ids)
  loop
    insert into emailrouter.routing_preset_version_conditions (version_id, user_profile_id)
    values (version_row.id, condition_value::uuid);
  end loop;
  perform emailrouter.replace_version_destinations(version_row.id, selections);
  update emailrouter.routing_presets preset
  set revision = preset.revision + 1, updated_by = p_actor, updated_at = now()
  where preset.id = preset_id_value;
  insert into emailrouter.events (event_type, entity_type, entity_id, actor_user_id, idempotency_key)
  values ('configuration.preset_version_save', 'preset_version', version_row.id, p_actor, gen_random_uuid()::text);
  return jsonb_build_object('id', version_row.id, 'type', 'preset_version_save', 'revision', version_row.revision);
end;
$$;

create or replace function public.save_emailrouter_preset_override(
  p_operation jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  entity_id uuid := nullif(p_operation->>'id', '')::uuid;
  preset_id_value uuid := nullif(p_operation->>'presetId', '')::uuid;
  version_id_value uuid := nullif(p_operation->>'versionId', '')::uuid;
  expected_revision bigint := nullif(p_operation->>'expectedRevision', '')::bigint;
  starts_at_value timestamptz := nullif(p_operation->>'startsAt', '')::timestamptz;
  ends_at_value timestamptz := nullif(p_operation->>'endsAt', '')::timestamptz;
  active_value boolean := coalesce((p_operation->>'active')::boolean, true);
  override_row emailrouter.routing_preset_overrides%rowtype;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;
  if preset_id_value is null or not exists (
    select 1 from emailrouter.routing_presets where id = preset_id_value
  ) then
    raise exception 'Email Router preset is unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('emailrouter:preset_override:' || preset_id_value::text, 0));
  if not active_value then
    update emailrouter.routing_preset_overrides preset_override
    set active = false, revision = preset_override.revision + 1, updated_by = p_actor, updated_at = now()
    where preset_override.id = entity_id
      and preset_override.preset_id = preset_id_value
      and preset_override.revision = expected_revision
    returning * into override_row;
    if override_row.id is null then raise exception 'Email Router preset override revision conflict'; end if;
  else
    if starts_at_value is null or ends_at_value is null or ends_at_value <= starts_at_value
       or char_length(btrim(coalesce(p_operation->>'reason', ''))) not between 3 and 500
       or not exists (
         select 1 from emailrouter.routing_preset_versions version
         where version.id = version_id_value and version.preset_id = preset_id_value and version.active = true
       ) then
      raise exception 'A valid preset version, start, end, and override reason are required';
    end if;
    if exists (
      select 1 from emailrouter.routing_preset_overrides existing
      where existing.preset_id = preset_id_value and existing.active = true
        and existing.id is distinct from entity_id
        and tstzrange(existing.starts_at, existing.ends_at, '[)') && tstzrange(starts_at_value, ends_at_value, '[)')
    ) then
      raise exception 'A routing preset cannot have overlapping scheduled overrides';
    end if;
    if entity_id is null then
      insert into emailrouter.routing_preset_overrides (
        preset_id, version_id, starts_at, ends_at, reason, active, created_by, updated_by
      ) values (
        preset_id_value, version_id_value, starts_at_value, ends_at_value,
        btrim(p_operation->>'reason'), true, p_actor, p_actor
      ) returning * into override_row;
    else
      update emailrouter.routing_preset_overrides preset_override
      set version_id = version_id_value,
          starts_at = starts_at_value,
          ends_at = ends_at_value,
          reason = btrim(p_operation->>'reason'),
          active = true,
          revision = preset_override.revision + 1,
          updated_by = p_actor,
          updated_at = now()
      where preset_override.id = entity_id
        and preset_override.preset_id = preset_id_value
        and preset_override.revision = expected_revision
      returning * into override_row;
      if override_row.id is null then raise exception 'Email Router preset override revision conflict'; end if;
    end if;
  end if;
  update emailrouter.routing_presets preset
  set revision = preset.revision + 1, updated_by = p_actor, updated_at = now()
  where preset.id = preset_id_value;
  insert into emailrouter.events (event_type, entity_type, entity_id, actor_user_id, idempotency_key)
  values ('configuration.preset_override_save', 'preset_override', override_row.id, p_actor, gen_random_uuid()::text);
  return jsonb_build_object('id', override_row.id, 'type', 'preset_override_save', 'revision', override_row.revision);
end;
$$;

create or replace function public.save_emailrouter_routing_leave(
  p_operation jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  entity_id uuid := nullif(p_operation->>'id', '')::uuid;
  target_user_id uuid := coalesce(nullif(p_operation->>'userProfileId', '')::uuid, p_actor);
  expected_revision bigint := nullif(p_operation->>'expectedRevision', '')::bigint;
  starts_at_value timestamptz := nullif(p_operation->>'startsAt', '')::timestamptz;
  ends_at_value timestamptz := nullif(p_operation->>'endsAt', '')::timestamptz;
  active_value boolean := coalesce((p_operation->>'active')::boolean, true);
  leave_row emailrouter.routing_leave_periods%rowtype;
begin
  if not exists (select 1 from public.user_profiles where id = p_actor and active = true) then
    raise exception 'Active FCOS user required';
  end if;
  if target_user_id <> p_actor and not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Only Administrators and the General Manager may manage another user''s routing leave';
  end if;
  if not exists (select 1 from public.user_profiles where id = target_user_id and active = true) then
    raise exception 'Routing leave requires an active FCOS user';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('emailrouter:routing_leave:' || target_user_id::text, 0));

  if not active_value then
    update emailrouter.routing_leave_periods leave_period
    set active = false, revision = leave_period.revision + 1, updated_by = p_actor, updated_at = now()
    where leave_period.id = entity_id
      and leave_period.user_profile_id = target_user_id
      and leave_period.revision = expected_revision
    returning * into leave_row;
    if leave_row.id is null then raise exception 'Routing leave revision conflict'; end if;
  else
    if starts_at_value is null or ends_at_value is null or ends_at_value <= starts_at_value
       or char_length(coalesce(p_operation->>'note', '')) > 500 then
      raise exception 'Routing leave requires a valid start and end time';
    end if;
    if exists (
      select 1 from emailrouter.routing_leave_periods existing
      where existing.user_profile_id = target_user_id and existing.active = true
        and existing.id is distinct from entity_id
        and tstzrange(existing.starts_at, existing.ends_at, '[)') && tstzrange(starts_at_value, ends_at_value, '[)')
    ) then
      raise exception 'Routing leave periods for one user cannot overlap';
    end if;
    if entity_id is null then
      insert into emailrouter.routing_leave_periods (
        user_profile_id, starts_at, ends_at, note, active, created_by, updated_by
      ) values (
        target_user_id, starts_at_value, ends_at_value, coalesce(p_operation->>'note', ''), true, p_actor, p_actor
      ) returning * into leave_row;
    else
      update emailrouter.routing_leave_periods leave_period
      set starts_at = starts_at_value,
          ends_at = ends_at_value,
          note = coalesce(p_operation->>'note', ''),
          active = true,
          revision = leave_period.revision + 1,
          updated_by = p_actor,
          updated_at = now()
      where leave_period.id = entity_id
        and leave_period.user_profile_id = target_user_id
        and leave_period.revision = expected_revision
      returning * into leave_row;
      if leave_row.id is null then raise exception 'Routing leave revision conflict'; end if;
    end if;
  end if;
  insert into emailrouter.events (event_type, entity_type, entity_id, actor_user_id, idempotency_key)
  values ('routing_leave.saved', 'routing_leave', leave_row.id, p_actor, gen_random_uuid()::text);
  return jsonb_build_object('id', leave_row.id, 'type', 'routing_leave_save', 'revision', leave_row.revision);
end;
$$;

create or replace function emailrouter.assert_routing_integrity()
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
begin
  if exists (
    select 1 from emailrouter.destination_groups destination_group
    where destination_group.active = true and destination_group.redirect_enabled = true
      and not exists (
        select 1 from emailrouter.destination_group_members member
        join emailrouter.destinations destination on destination.id = member.destination_id
        where member.group_id = destination_group.id
          and destination.active = true and destination.redirect_enabled = true
      )
  ) then raise exception 'An included routing group must contain at least one included destination'; end if;

  if exists (
    select 1 from emailrouter.routing_presets preset
    where preset.active = true and not exists (
      select 1 from emailrouter.routing_preset_versions version
      where version.preset_id = preset.id and version.version_kind = 'baseline' and version.active = true
    )
  ) then raise exception 'An active Email Router preset requires one active Standard version'; end if;

  if exists (
    select 1 from emailrouter.routing_preset_versions version
    join emailrouter.routing_presets preset on preset.id = version.preset_id
    where preset.active = true and version.active = true
      and not exists (
        select 1 from emailrouter.routing_preset_version_destinations selection
        where selection.version_id = version.id
      )
  ) then raise exception 'An active Email Router preset version must contain at least one recipient'; end if;

  if exists (
    select 1 from emailrouter.routing_preset_version_destinations selection
    join emailrouter.routing_preset_versions version on version.id = selection.version_id and version.active = true
    join emailrouter.routing_presets preset on preset.id = version.preset_id and preset.active = true
    left join emailrouter.destinations destination on destination.id = selection.destination_id
    left join emailrouter.destination_groups destination_group on destination_group.id = selection.group_id
    where (selection.destination_id is not null and (destination.id is null or destination.active is not true or destination.redirect_enabled is not true))
       or (selection.group_id is not null and (
         destination_group.id is null or destination_group.active is not true or destination_group.redirect_enabled is not true
         or not exists (
           select 1 from emailrouter.destination_group_members member
           join emailrouter.destinations member_destination on member_destination.id = member.destination_id
           where member.group_id = selection.group_id
             and member_destination.active = true and member_destination.redirect_enabled = true
         )
       ))
  ) then raise exception 'An active Email Router preset version contains an unavailable destination or group'; end if;

  if exists (
    select 1
    from emailrouter.routing_preset_overrides preset_override
    join emailrouter.routing_preset_versions version on version.id = preset_override.version_id
    where preset_override.active = true
      and (version.active is not true or version.preset_id <> preset_override.preset_id)
  ) then raise exception 'An active routing override requires an active version from the same preset'; end if;
end;
$$;

create or replace function public.save_emailrouter_routing_change(
  p_operation jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  result jsonb;
begin
  case p_operation->>'type'
    when 'routing_directory_save' then result := public.save_emailrouter_routing_directory(coalesce(p_operation->'items', '[]'::jsonb), p_actor);
    when 'destination_save' then result := public.save_emailrouter_external_destination(p_operation, p_actor);
    when 'group_save' then result := public.save_emailrouter_group(p_operation, p_actor);
    when 'preset_save' then result := public.save_emailrouter_preset(p_operation, p_actor);
    when 'preset_version_save' then result := public.save_emailrouter_preset_version(p_operation, p_actor);
    when 'preset_override_save' then result := public.save_emailrouter_preset_override(p_operation, p_actor);
    else raise exception 'Unsupported Email Router routing change';
  end case;
  perform emailrouter.assert_routing_integrity();
  return result;
end;
$$;

revoke all on function emailrouter.validate_version_destinations(jsonb) from public, anon, authenticated;
grant execute on function emailrouter.validate_version_destinations(jsonb) to service_role;
revoke all on function emailrouter.replace_version_destinations(uuid, jsonb) from public, anon, authenticated;
grant execute on function emailrouter.replace_version_destinations(uuid, jsonb) to service_role;
revoke all on function public.save_emailrouter_preset(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_emailrouter_preset(jsonb, uuid) to service_role;
revoke all on function public.save_emailrouter_preset_version(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_emailrouter_preset_version(jsonb, uuid) to service_role;
revoke all on function public.save_emailrouter_preset_override(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_emailrouter_preset_override(jsonb, uuid) to service_role;
revoke all on function public.save_emailrouter_routing_leave(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_leave(jsonb, uuid) to service_role;
revoke all on function emailrouter.assert_routing_integrity() from public, anon, authenticated;
grant execute on function emailrouter.assert_routing_integrity() to service_role;
revoke all on function public.save_emailrouter_routing_change(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_change(jsonb, uuid) to service_role;

comment on table emailrouter.routing_leave_periods is
  'Operational Email Router availability periods; not an HR leave approval system.';
comment on column emailrouter.mail_actions.route_recipient_snapshot is
  'Ordered destination identifiers selected from a signed route snapshot; contains no message content.';

notify pgrst, 'reload schema';

commit;
