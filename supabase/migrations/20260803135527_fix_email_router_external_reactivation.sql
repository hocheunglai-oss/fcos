begin;

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
     or requested_nickname !~ '^[A-Z0-9]{1,12}$' then
    raise exception 'A valid contact name, email address, and routing label are required';
  end if;

  if exists (
    select 1
    from emailrouter.destinations destination
    where destination.active = true
      and destination.id is distinct from entity_id
      and lower(destination.nickname) = lower(requested_nickname)
  ) then
    raise exception 'Another active routing contact already uses this routing label';
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

revoke all on function public.save_emailrouter_external_destination(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_external_destination(jsonb, uuid)
to service_role;

notify pgrst, 'reload schema';

commit;
