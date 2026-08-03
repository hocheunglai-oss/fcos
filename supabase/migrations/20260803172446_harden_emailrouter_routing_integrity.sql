begin;

create or replace function emailrouter.assert_routing_integrity()
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, emailrouter
as $$
begin
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

  if exists (
    select 1
    from emailrouter.routing_presets preset
    where preset.active = true
      and not exists (
        select 1 from emailrouter.routing_preset_destinations selection
        where selection.preset_id = preset.id
      )
  ) then
    raise exception 'An active Email Router preset must contain at least one recipient';
  end if;

  if exists (
    select 1
    from emailrouter.routing_presets preset
    join emailrouter.routing_preset_destinations selection on selection.preset_id = preset.id
    left join emailrouter.destinations destination on destination.id = selection.destination_id
    where preset.active = true
      and selection.destination_id is not null
      and (destination.id is null or destination.active is not true or destination.redirect_enabled is not true)
  ) then
    raise exception 'An active Email Router preset contains an unavailable destination';
  end if;

  if exists (
    select 1
    from emailrouter.routing_presets preset
    join emailrouter.routing_preset_destinations selection on selection.preset_id = preset.id
    left join emailrouter.destination_groups destination_group on destination_group.id = selection.group_id
    where preset.active = true
      and selection.group_id is not null
      and (
        destination_group.id is null
        or destination_group.active is not true
        or destination_group.redirect_enabled is not true
        or not exists (
          select 1
          from emailrouter.destination_group_members member
          join emailrouter.destinations destination on destination.id = member.destination_id
          where member.group_id = selection.group_id
            and destination.active = true
            and destination.redirect_enabled = true
        )
      )
  ) then
    raise exception 'An active Email Router preset contains an unavailable group';
  end if;
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
    when 'routing_directory_save' then
      result := public.save_emailrouter_routing_directory(coalesce(p_operation->'items', '[]'::jsonb), p_actor);
    when 'destination_save' then
      result := public.save_emailrouter_external_destination(p_operation, p_actor);
    when 'group_save' then
      result := public.save_emailrouter_group(p_operation, p_actor);
    when 'preset_save' then
      result := public.save_emailrouter_preset(p_operation, p_actor);
    else
      raise exception 'Unsupported Email Router routing change';
  end case;

  perform emailrouter.assert_routing_integrity();
  return result;
end;
$$;

revoke all on function emailrouter.assert_routing_integrity()
from public, anon, authenticated;
grant execute on function emailrouter.assert_routing_integrity()
to service_role;

revoke all on function public.save_emailrouter_routing_change(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_change(jsonb, uuid)
to service_role;

notify pgrst, 'reload schema';

commit;
