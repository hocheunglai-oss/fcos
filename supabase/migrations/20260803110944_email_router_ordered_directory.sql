begin;

alter table emailrouter.destination_groups
  add column if not exists redirect_enabled boolean not null default true,
  add column if not exists sort_order integer not null default 0 check (sort_order >= 0);

alter table emailrouter.destinations
  drop constraint if exists emailrouter_destinations_native_routing_check;

alter table emailrouter.destinations
  add constraint emailrouter_destinations_native_routing_check check (
    nickname is null or nickname ~ '^[A-Z0-9]{1,12}$'
  ),
  add constraint emailrouter_destinations_enabled_label_check check (
    redirect_enabled = false
    or (active = true and nickname is not null and nickname ~ '^[A-Z0-9]{1,12}$')
  ),
  add constraint emailrouter_destinations_fcos_label_check check (
    destination_kind <> 'fcos_profile'
    or (nickname is not null and nickname ~ '^[A-Z0-9]{1,12}$')
  );

drop index if exists emailrouter.emailrouter_destinations_active_nickname_key;
create unique index emailrouter_destinations_active_nickname_key
  on emailrouter.destinations (lower(nickname))
  where active = true and nickname is not null;

create temporary table emailrouter_directory_initial_order on commit drop as
select entity_type, id, row_number() over (
  order by sort_order, entity_type, display_label, id
)::integer as position
from (
  select
    'destination'::text as entity_type,
    destination.id,
    destination.sort_order,
    coalesce(destination.nickname, destination.display_name, destination.id::text) as display_label
  from emailrouter.destinations destination
  where destination.active = true
  union all
  select
    'group'::text,
    destination_group.id,
    destination_group.sort_order,
    destination_group.display_name
  from emailrouter.destination_groups destination_group
  where destination_group.active = true
) directory;

update emailrouter.destinations destination
set sort_order = initial_order.position
from emailrouter_directory_initial_order initial_order
where initial_order.entity_type = 'destination'
  and initial_order.id = destination.id;

update emailrouter.destination_groups destination_group
set sort_order = initial_order.position
from emailrouter_directory_initial_order initial_order
where initial_order.entity_type = 'group'
  and initial_order.id = destination_group.id;

create or replace function emailrouter.configuration_actor_authorized(p_actor uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
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
  );
$$;

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
      and btrim(coalesce(value->>'nickname', '')) !~ '^[A-Z0-9]{1,12}$'
  ) then
    raise exception 'Every routing destination requires a 1 to 12 character uppercase label';
  end if;
  if (
    select count(distinct lower(value->>'nickname'))
    from jsonb_array_elements(p_items) value
    where value->>'entityType' = 'destination'
  ) <> (
    select count(*)
    from jsonb_array_elements(p_items) value
    where value->>'entityType' = 'destination'
  ) then
    raise exception 'Routing destination labels must be unique';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    position := position + 1;
    if item->>'entityType' = 'destination' then
      update emailrouter.destinations destination
      set nickname = item->>'nickname',
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
  destination_row emailrouter.destinations%rowtype;
  next_order integer;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;
  if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
     or lower(btrim(coalesce(p_operation->>'emailAddress', ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or btrim(coalesce(p_operation->>'nickname', '')) !~ '^[A-Z0-9]{1,12}$' then
    raise exception 'A valid contact name, email address, and routing label are required';
  end if;

  if entity_id is null then
    select coalesce(max(sort_order), 0) + 1 into next_order
    from (
      select sort_order from emailrouter.destinations where active = true
      union all
      select sort_order from emailrouter.destination_groups where active = true
    ) directory;
    insert into emailrouter.destinations (
      destination_kind, provider_directory_id, display_name, email_address,
      nickname, active, redirect_enabled, sort_order, created_by
    ) values (
      'provider_directory', 'manual:' || gen_random_uuid()::text,
      btrim(p_operation->>'displayName'), lower(btrim(p_operation->>'emailAddress')),
      p_operation->>'nickname', true,
      coalesce((p_operation->>'included')::boolean, true), next_order, p_actor
    ) returning * into destination_row;
  else
    update emailrouter.destinations destination
    set display_name = btrim(p_operation->>'displayName'),
        email_address = lower(btrim(p_operation->>'emailAddress')),
        nickname = p_operation->>'nickname',
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
  end if;

  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    case when destination_row.active then 'configuration.destination_save' else 'configuration.destination_remove' end,
    'destination', destination_row.id, p_actor, gen_random_uuid()::text
  );

  return jsonb_build_object('id', destination_row.id, 'revision', destination_row.revision);
end;
$$;

create or replace function public.save_emailrouter_group(
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
  group_row emailrouter.destination_groups%rowtype;
  selected_count integer;
  next_order integer;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;
  if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
     or btrim(coalesce(p_operation->>'groupKey', '')) !~ '^[a-z0-9][a-z0-9_.-]{0,119}$'
     or jsonb_typeof(coalesce(p_operation->'destinationIds', '[]'::jsonb)) <> 'array' then
    raise exception 'A valid group name, key, and destination list are required';
  end if;
  select count(*) into selected_count
  from emailrouter.destinations destination
  where destination.id in (
    select value::text::uuid
    from jsonb_array_elements_text(coalesce(p_operation->'destinationIds', '[]'::jsonb))
  )
    and destination.active = true
    and destination.redirect_enabled = true;
  if selected_count <> jsonb_array_length(coalesce(p_operation->'destinationIds', '[]'::jsonb))
     or (coalesce((p_operation->>'active')::boolean, true)
         and coalesce((p_operation->>'included')::boolean, true)
         and selected_count = 0) then
    raise exception 'An included routing group requires available included destinations';
  end if;

  if entity_id is null then
    select coalesce(max(sort_order), 0) + 1 into next_order
    from (
      select sort_order from emailrouter.destinations where active = true
      union all
      select sort_order from emailrouter.destination_groups where active = true
    ) directory;
    insert into emailrouter.destination_groups (
      group_key, display_name, active, redirect_enabled, sort_order, created_by
    ) values (
      p_operation->>'groupKey', btrim(p_operation->>'displayName'),
      true, coalesce((p_operation->>'included')::boolean, true), next_order, p_actor
    ) returning * into group_row;
  else
    update emailrouter.destination_groups destination_group
    set group_key = p_operation->>'groupKey',
        display_name = btrim(p_operation->>'displayName'),
        active = coalesce((p_operation->>'active')::boolean, true),
        redirect_enabled = case
          when coalesce((p_operation->>'active')::boolean, true) then coalesce((p_operation->>'included')::boolean, destination_group.redirect_enabled)
          else false
        end,
        revision = destination_group.revision + 1,
        updated_at = now()
    where destination_group.id = entity_id
      and destination_group.revision = expected_revision
    returning * into group_row;
    if group_row.id is null then
      raise exception 'Email Router group revision conflict';
    end if;
  end if;

  delete from emailrouter.destination_group_members where group_id = group_row.id;
  if group_row.active then
    insert into emailrouter.destination_group_members (group_id, destination_id, added_by)
    select group_row.id, value::text::uuid, p_actor
    from jsonb_array_elements_text(coalesce(p_operation->'destinationIds', '[]'::jsonb));
  end if;

  insert into emailrouter.events (
    event_type, entity_type, entity_id, actor_user_id, idempotency_key
  ) values (
    case when group_row.active then 'configuration.group_save' else 'configuration.group_remove' end,
    'group', group_row.id, p_actor, gen_random_uuid()::text
  );

  return jsonb_build_object('id', group_row.id, 'revision', group_row.revision);
end;
$$;

revoke all on function emailrouter.configuration_actor_authorized(uuid)
from public, anon, authenticated;
grant execute on function emailrouter.configuration_actor_authorized(uuid)
to service_role;

revoke all on function public.save_emailrouter_routing_directory(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_directory(jsonb, uuid)
to service_role;

revoke all on function public.save_emailrouter_external_destination(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_external_destination(jsonb, uuid)
to service_role;

revoke all on function public.save_emailrouter_group(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_group(jsonb, uuid)
to service_role;

notify pgrst, 'reload schema';

commit;
