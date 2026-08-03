begin;

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
  selections jsonb := coalesce(p_operation->'destinations', '[]'::jsonb);
  selection jsonb;
  destination_id_value uuid;
  group_id_value uuid;
  recipient_kind_value text;
  position_value integer;
  preset_row emailrouter.routing_presets%rowtype;
begin
  if not emailrouter.configuration_actor_authorized(p_actor) then
    raise exception 'Email Router configuration authority required';
  end if;

  if char_length(btrim(coalesce(p_operation->>'displayName', ''))) not between 1 and 255
     or btrim(coalesce(p_operation->>'presetKey', '')) !~ '^[a-z0-9][a-z0-9_.-]{0,119}$'
     or char_length(coalesce(p_operation->>'description', '')) > 1000
     or jsonb_typeof(selections) <> 'array'
     or jsonb_array_length(selections) < 1 then
    raise exception 'A valid preset name, key, and at least one recipient are required';
  end if;

  for selection in select value from jsonb_array_elements(selections)
  loop
    destination_id_value := nullif(selection->>'destinationId', '')::uuid;
    group_id_value := nullif(selection->>'groupId', '')::uuid;
    recipient_kind_value := selection->>'recipientKind';
    position_value := coalesce((selection->>'position')::integer, 0);

    if recipient_kind_value not in ('to', 'cc', 'bcc')
       or position_value < 1
       or ((destination_id_value is null) = (group_id_value is null)) then
      raise exception 'Email Router preset contains an invalid recipient';
    end if;

    if destination_id_value is not null and not exists (
      select 1
      from emailrouter.destinations destination
      where destination.id = destination_id_value
        and destination.active = true
        and destination.redirect_enabled = true
    ) then
      raise exception 'Email Router preset contains an unavailable destination';
    end if;

    if group_id_value is not null and not exists (
      select 1
      from emailrouter.destination_groups destination_group
      where destination_group.id = group_id_value
        and destination_group.active = true
        and destination_group.redirect_enabled = true
        and exists (
          select 1
          from emailrouter.destination_group_members member
          join emailrouter.destinations destination
            on destination.id = member.destination_id
          where member.group_id = destination_group.id
            and destination.active = true
            and destination.redirect_enabled = true
        )
    ) then
      raise exception 'Email Router preset contains an unavailable group';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select
        coalesce(nullif(value->>'destinationId', ''), 'group:' || nullif(value->>'groupId', '')) as recipient_key,
        count(*) as use_count
      from jsonb_array_elements(selections)
      group by 1
    ) duplicates
    where duplicates.use_count > 1
  ) then
    raise exception 'An Email Router preset recipient can appear only once';
  end if;

  if exists (
    select 1
    from (
      select value->>'recipientKind' as recipient_kind,
             (value->>'position')::integer as position,
             count(*) as position_count
      from jsonb_array_elements(selections)
      group by 1, 2
    ) duplicates
    where duplicates.position_count > 1
  ) then
    raise exception 'Email Router preset recipient positions must be unique';
  end if;

  if entity_id is null then
    insert into emailrouter.routing_presets (
      preset_key,
      display_name,
      description,
      active,
      sort_order,
      created_by,
      updated_by
    ) values (
      p_operation->>'presetKey',
      btrim(p_operation->>'displayName'),
      coalesce(p_operation->>'description', ''),
      coalesce((p_operation->>'active')::boolean, true),
      greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0),
      p_actor,
      p_actor
    )
    returning * into preset_row;
  else
    update emailrouter.routing_presets preset
    set preset_key = p_operation->>'presetKey',
        display_name = btrim(p_operation->>'displayName'),
        description = coalesce(p_operation->>'description', ''),
        active = coalesce((p_operation->>'active')::boolean, true),
        sort_order = greatest(coalesce((p_operation->>'sortOrder')::integer, 0), 0),
        revision = preset.revision + 1,
        updated_by = p_actor,
        updated_at = now()
    where preset.id = entity_id
      and preset.revision = expected_revision
    returning * into preset_row;

    if preset_row.id is null then
      raise exception 'Email Router preset revision conflict';
    end if;
  end if;

  delete from emailrouter.routing_preset_destinations
  where preset_id = preset_row.id;

  for selection in select value from jsonb_array_elements(selections)
  loop
    insert into emailrouter.routing_preset_destinations (
      preset_id,
      destination_id,
      group_id,
      recipient_kind,
      position
    ) values (
      preset_row.id,
      nullif(selection->>'destinationId', '')::uuid,
      nullif(selection->>'groupId', '')::uuid,
      selection->>'recipientKind',
      (selection->>'position')::smallint
    );
  end loop;

  insert into emailrouter.events (
    event_type,
    entity_type,
    entity_id,
    actor_user_id,
    idempotency_key
  ) values (
    'configuration.preset_save',
    'preset',
    preset_row.id,
    p_actor,
    gen_random_uuid()::text
  );

  return jsonb_build_object(
    'id', preset_row.id,
    'type', 'preset_save',
    'revision', preset_row.revision
  );
end;
$$;

revoke all on function public.save_emailrouter_preset(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_preset(jsonb, uuid)
to service_role;

notify pgrst, 'reload schema';

commit;
