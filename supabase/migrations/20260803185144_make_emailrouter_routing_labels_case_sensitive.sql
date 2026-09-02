begin;

alter table emailrouter.destinations
  drop constraint if exists emailrouter_destinations_native_routing_check,
  drop constraint if exists emailrouter_destinations_enabled_label_check,
  drop constraint if exists emailrouter_destinations_fcos_label_check;

alter table emailrouter.destinations
  add constraint emailrouter_destinations_native_routing_check check (
    nickname is null or nickname ~ '^[A-Za-z0-9]{1,12}$'
  ),
  add constraint emailrouter_destinations_enabled_label_check check (
    redirect_enabled = false
    or (active = true and nickname is not null and nickname ~ '^[A-Za-z0-9]{1,12}$')
  ),
  add constraint emailrouter_destinations_fcos_label_check check (
    destination_kind <> 'fcos_profile'
    or (nickname is not null and nickname ~ '^[A-Za-z0-9]{1,12}$')
  );

drop index if exists emailrouter.emailrouter_destinations_active_nickname_key;
create unique index emailrouter_destinations_active_nickname_key
  on emailrouter.destinations (nickname)
  where active = true and nickname is not null;

create or replace function public.save_emailrouter_routing_directory(
  p_items jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  item jsonb;
  item_count integer;
  active_count integer;
  position integer := 0;
  destination_row emailrouter.destinations%rowtype;
  group_row emailrouter.destination_groups%rowtype;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Email Router directory must be an array';
  end if;
  item_count := jsonb_array_length(p_items);
  select (
    (select count(*) from emailrouter.destinations where active = true)
    + (select count(*) from emailrouter.destination_groups where active = true)
  ) into active_count;
  if item_count <> active_count or item_count > 500 then
    raise exception 'Email Router directory changed after it was loaded';
  end if;
  if (
    select count(distinct (value->>'entityType') || ':' || (value->>'id'))
    from jsonb_array_elements(p_items)
  ) <> item_count then
    raise exception 'Email Router directory contains duplicate entries';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) value
    where value->>'entityType' not in ('destination', 'group')
      or nullif(value->>'id', '') is null
      or nullif(value->>'expectedRevision', '') is null
  ) then
    raise exception 'Email Router directory contains an invalid entry';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) value
    where value->>'entityType' = 'destination'
      and btrim(coalesce(value->>'nickname', '')) !~ '^[A-Za-z0-9]{1,12}$'
  ) then
    raise exception 'Every routing destination requires a 1 to 12 character case-sensitive label';
  end if;
  if (
    select count(distinct btrim(value->>'nickname'))
    from jsonb_array_elements(p_items) value
    where value->>'entityType' = 'destination'
  ) <> (
    select count(*)
    from jsonb_array_elements(p_items) value
    where value->>'entityType' = 'destination'
  ) then
    raise exception 'Routing destination labels must be unique using exact letter case';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    position := position + 1;
    if item->>'entityType' = 'destination' then
      update emailrouter.destinations destination
      set nickname = btrim(item->>'nickname'),
          redirect_enabled = coalesce((item->>'included')::boolean, false),
          sort_order = position,
          revision = destination.revision + 1,
          updated_at = now()
      where destination.id = (item->>'id')::uuid
        and destination.active = true
        and destination.revision = (item->>'expectedRevision')::bigint
      returning * into destination_row;
      if destination_row.id is null then
        raise exception 'Email Router destination revision conflict';
      end if;
      destination_row := null;
    else
      update emailrouter.destination_groups destination_group
      set redirect_enabled = coalesce((item->>'included')::boolean, false),
          sort_order = position,
          revision = destination_group.revision + 1,
          updated_at = now()
      where destination_group.id = (item->>'id')::uuid
        and destination_group.active = true
        and destination_group.revision = (item->>'expectedRevision')::bigint
      returning * into group_row;
      if group_row.id is null then
        raise exception 'Email Router group revision conflict';
      end if;
      group_row := null;
    end if;
  end loop;

  if exists (
    select 1
    from emailrouter.destination_groups destination_group
    where destination_group.active = true
      and destination_group.redirect_enabled = true
      and not exists (
        select 1
        from emailrouter.destination_group_members member
        join emailrouter.destinations destination on destination.id = member.destination_id
        where member.group_id = destination_group.id
          and destination.active = true
          and destination.redirect_enabled = true
      )
  ) then
    raise exception 'An included routing group must contain at least one included destination';
  end if;

  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    'configuration.routing_directory_save',
    'routing_directory',
    gen_random_uuid(),
    p_actor,
    gen_random_uuid()::text
  );

  return jsonb_build_object('updated', item_count);
end;
$$;

create or replace function public.save_emailrouter_external_destination(
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
  requested_email text := lower(btrim(coalesce(p_operation->>'emailAddress', '')));
  requested_nickname text := btrim(coalesce(p_operation->>'nickname', ''));
  destination_row emailrouter.destinations%rowtype;
  next_order integer;
  restored boolean := false;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;
  if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
     or requested_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or requested_nickname !~ '^[A-Za-z0-9]{1,12}$' then
    raise exception 'A valid contact name, email address, and case-sensitive routing label are required';
  end if;

  if exists (
    select 1
    from emailrouter.destinations destination
    where destination.active = true
      and destination.id is distinct from entity_id
      and destination.nickname = requested_nickname
  ) then
    raise exception 'Another active routing contact already uses this exact routing label';
  end if;

  if entity_id is null then
    select * into destination_row
    from emailrouter.destinations destination
    where destination.email_address = requested_email
    for update;

    if destination_row.id is not null and destination_row.destination_kind <> 'provider_directory' then
      raise exception 'This email address belongs to an FCOS user and cannot be added as an external contact';
    end if;
    if destination_row.id is not null and destination_row.active = true then
      raise exception 'This email address is already in the active routing directory';
    end if;

    select coalesce(max(sort_order), 0) + 1 into next_order
    from (
      select sort_order from emailrouter.destinations where active = true
      union all
      select sort_order from emailrouter.destination_groups where active = true
    ) directory;

    if destination_row.id is not null then
      restored := true;
      update emailrouter.destinations destination
      set display_name = btrim(p_operation->>'displayName'),
          email_address = requested_email,
          nickname = requested_nickname,
          active = true,
          redirect_enabled = coalesce((p_operation->>'included')::boolean, true),
          sort_order = next_order,
          revision = destination.revision + 1,
          updated_at = now()
      where destination.id = destination_row.id
      returning * into destination_row;

      delete from emailrouter.destination_group_members
      where destination_id = destination_row.id;
    else
      insert into emailrouter.destinations (
        destination_kind, provider_directory_id, display_name, email_address,
        nickname, active, redirect_enabled, sort_order, created_by
      ) values (
        'provider_directory', 'manual:' || gen_random_uuid()::text,
        btrim(p_operation->>'displayName'), requested_email,
        requested_nickname, true,
        coalesce((p_operation->>'included')::boolean, true), next_order, p_actor
      ) returning * into destination_row;
    end if;
  else
    if exists (
      select 1
      from emailrouter.destinations destination
      where destination.id <> entity_id
        and destination.email_address = requested_email
    ) then
      raise exception 'Another retained routing contact already uses this email address';
    end if;

    update emailrouter.destinations destination
    set display_name = btrim(p_operation->>'displayName'),
        email_address = requested_email,
        nickname = requested_nickname,
        active = coalesce((p_operation->>'active')::boolean, true),
        redirect_enabled = case
          when coalesce((p_operation->>'active')::boolean, true) then coalesce((p_operation->>'included')::boolean, destination.redirect_enabled)
          else false
        end,
        revision = destination.revision + 1,
        updated_at = now()
    where destination.id = entity_id
      and destination.destination_kind = 'provider_directory'
      and destination.revision = expected_revision
    returning * into destination_row;
    if destination_row.id is null then
      raise exception 'Email Router destination revision conflict';
    end if;

    if destination_row.active = false then
      delete from emailrouter.destination_group_members
      where destination_id = destination_row.id;

      update emailrouter.destination_groups destination_group
      set redirect_enabled = false,
          revision = destination_group.revision + 1,
          updated_at = now()
      where destination_group.active = true
        and destination_group.redirect_enabled = true
        and not exists (
          select 1
          from emailrouter.destination_group_members member
          join emailrouter.destinations destination on destination.id = member.destination_id
          where member.group_id = destination_group.id
            and destination.active = true
            and destination.redirect_enabled = true
        );
    end if;
  end if;

  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    case
      when destination_row.active = false then 'configuration.destination_remove'
      when restored then 'configuration.destination_restore'
      else 'configuration.destination_save'
    end,
    'destination', destination_row.id, p_actor, gen_random_uuid()::text
  );

  return jsonb_build_object(
    'id', destination_row.id,
    'revision', destination_row.revision,
    'restored', restored
  );
end;
$$;

create or replace function public.sync_emailrouter_fcos_destinations(p_actor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  profile_row record;
  destination_row emailrouter.destinations%rowtype;
  base_nickname text;
  candidate text;
  suffix integer;
  inserted_count integer := 0;
  reactivated_count integer := 0;
  disabled_count integer := 0;
begin
  if not exists (
    select 1 from public.user_profiles
    where id = p_actor and active = true
  ) then
    raise exception 'Active FCOS user required';
  end if;

  for profile_row in
    select profile.id, profile.full_name
    from public.user_profiles profile
    where profile.active = true
    order by profile.full_name, profile.id
  loop
    select * into destination_row
    from emailrouter.destinations destination
    where destination.user_profile_id = profile_row.id;

    if destination_row.id is null or destination_row.active = false then
      base_nickname := coalesce(destination_row.nickname, emailrouter.initials_from_name(profile_row.full_name));
      candidate := base_nickname;
      suffix := 1;
      while exists (
        select 1
        from emailrouter.destinations existing
        where existing.active = true
          and existing.id is distinct from destination_row.id
          and existing.nickname = candidate
      ) loop
        suffix := suffix + 1;
        candidate := left(base_nickname, greatest(1, 12 - char_length(suffix::text))) || suffix::text;
      end loop;

      if destination_row.id is null then
        insert into emailrouter.destinations (
          destination_kind,
          user_profile_id,
          nickname,
          active,
          redirect_enabled,
          created_by
        ) values (
          'fcos_profile',
          profile_row.id,
          candidate,
          true,
          true,
          p_actor
        );
        inserted_count := inserted_count + 1;
      else
        update emailrouter.destinations
        set nickname = candidate,
            active = true,
            revision = revision + 1,
            updated_at = now()
        where id = destination_row.id;
        reactivated_count := reactivated_count + 1;
      end if;
    end if;
  end loop;

  update emailrouter.destinations destination
  set active = false,
      revision = destination.revision + 1,
      updated_at = now()
  where destination.destination_kind = 'fcos_profile'
    and destination.active = true
    and not exists (
      select 1 from public.user_profiles profile
      where profile.id = destination.user_profile_id and profile.active = true
    );
  get diagnostics disabled_count = row_count;

  return jsonb_build_object(
    'activeProfilesAdded', inserted_count,
    'activeProfilesReactivated', reactivated_count,
    'inactiveProfilesDisabled', disabled_count
  );
end;
$$;

create or replace function public.save_emailrouter_routing_users(
  p_items jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
declare
  item jsonb;
  destination_row emailrouter.destinations%rowtype;
  requested_count integer;
  updated_count integer := 0;
  actor_authorized boolean := false;
begin
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_actor
      and profile.active = true
      and (
        profile.user_type = 'administrator'
        or exists (
          select 1
          from public.collaboration_roles role_row
          where role_row.user_id = profile.id
            and role_row.role = 'general_manager'
            and role_row.active = true
        )
      )
  ) into actor_authorized;
  if not actor_authorized then
    raise exception 'Email Router configuration authority required';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Email Router routing users must be an array';
  end if;
  requested_count := jsonb_array_length(p_items);
  if requested_count < 1 or requested_count > 500 then
    raise exception 'Email Router routing user batch must contain between 1 and 500 users';
  end if;
  if (
    select count(distinct value->>'id')
    from jsonb_array_elements(p_items)
  ) <> requested_count then
    raise exception 'Email Router routing user batch contains duplicate users';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) value
    where btrim(coalesce(value->>'nickname', '')) !~ '^[A-Za-z0-9]{1,12}$'
      or nullif(value->>'expectedRevision', '') is null
  ) then
    raise exception 'Each routing user requires a 1 to 12 character case-sensitive label and revision';
  end if;
  if (
    select count(distinct btrim(value->>'nickname'))
    from jsonb_array_elements(p_items) value
  ) <> requested_count then
    raise exception 'Routing labels must be unique using exact letter case';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    select destination.* into destination_row
    from emailrouter.destinations destination
    join public.user_profiles profile on profile.id = destination.user_profile_id
    where destination.id = (item->>'id')::uuid
      and destination.destination_kind = 'fcos_profile'
      and destination.active = true
      and profile.active = true
    for update;
    if destination_row.id is null then
      raise exception 'Email Router routing user is unavailable';
    end if;
    if destination_row.revision <> (item->>'expectedRevision')::bigint then
      raise exception 'Email Router routing user revision conflict';
    end if;
    if exists (
      select 1
      from emailrouter.destinations existing
      where existing.active = true
        and existing.id <> destination_row.id
        and existing.nickname = btrim(item->>'nickname')
    ) then
      raise exception 'Routing labels must be unique using exact letter case';
    end if;

    update emailrouter.destinations
    set nickname = btrim(item->>'nickname'),
        redirect_enabled = coalesce((item->>'included')::boolean, false),
        revision = revision + 1,
        updated_at = now()
    where id = destination_row.id;
    updated_count := updated_count + 1;

    insert into emailrouter.events (
      event_type,
      entity_type,
      entity_id,
      actor_user_id,
      idempotency_key
    ) values (
      'configuration.routing_user_save',
      'destination',
      destination_row.id,
      p_actor,
      gen_random_uuid()::text
    );
  end loop;

  return jsonb_build_object('updated', updated_count);
end;
$$;

revoke all on function public.save_emailrouter_routing_directory(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_directory(jsonb, uuid)
to service_role;

revoke all on function public.save_emailrouter_external_destination(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_external_destination(jsonb, uuid)
to service_role;

revoke all on function public.sync_emailrouter_fcos_destinations(uuid)
from public, anon, authenticated;
grant execute on function public.sync_emailrouter_fcos_destinations(uuid)
to service_role;

revoke all on function public.save_emailrouter_routing_users(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_users(jsonb, uuid)
to service_role;

notify pgrst, 'reload schema';

commit;
