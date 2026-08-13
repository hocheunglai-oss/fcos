begin;

-- Compatibility bootstrap: this migration originally landed before the
-- native Email Router base schema. Existing projects already have the schema,
-- while clean installs need the minimum private objects so the historical
-- change remains replayable in timestamp order.
create extension if not exists pgcrypto;
create schema if not exists emailrouter;
revoke all on schema emailrouter from public, anon, authenticated;
grant usage on schema emailrouter to service_role;

create table if not exists emailrouter.destinations (
  id uuid primary key default gen_random_uuid(),
  destination_kind text not null check (destination_kind in ('fcos_profile', 'provider_directory')),
  user_profile_id uuid references public.user_profiles(id) on delete restrict,
  provider_directory_id text,
  display_name text,
  email_address text,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (destination_kind = 'fcos_profile' and user_profile_id is not null and provider_directory_id is null and email_address is null)
    or
    (destination_kind = 'provider_directory' and user_profile_id is null and provider_directory_id is not null and email_address is not null)
  )
);

create unique index if not exists emailrouter_destinations_profile_key
  on emailrouter.destinations (user_profile_id)
  where user_profile_id is not null;
create unique index if not exists emailrouter_destinations_directory_key
  on emailrouter.destinations (provider_directory_id)
  where provider_directory_id is not null;
create unique index if not exists emailrouter_destinations_external_email_key
  on emailrouter.destinations (email_address)
  where email_address is not null;

create table if not exists emailrouter.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z0-9_.-]{1,120}$'),
  entity_type text not null check (entity_type in ('mailbox', 'message', 'destination', 'group', 'preset', 'setting', 'mail_action', 'subscription', 'alert', 'ai_usage')),
  entity_id uuid not null,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  correlation_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (idempotency_key),
  check (char_length(btrim(idempotency_key)) between 16 and 200)
);

alter table emailrouter.destinations enable row level security;
alter table emailrouter.events enable row level security;
revoke all on table emailrouter.destinations, emailrouter.events from public, anon, authenticated;
grant select, insert, update, delete on table emailrouter.destinations, emailrouter.events to service_role;

alter table emailrouter.destinations
  add column if not exists nickname text,
  add column if not exists redirect_enabled boolean not null default true;

create or replace function emailrouter.initials_from_name(p_name text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(
      left(
        string_agg(upper(left(part, 1)), '' order by position),
        10
      ),
      ''
    ),
    'U'
  )
  from regexp_split_to_table(
    btrim(regexp_replace(p_name, '[^[:alnum:]]+', ' ', 'g')),
    '[[:space:]]+'
  ) with ordinality as token(part, position)
  where part <> '';
$$;

revoke all on function emailrouter.initials_from_name(text)
from public, anon, authenticated;
grant execute on function emailrouter.initials_from_name(text)
to service_role;

-- Retain historical provider-directory records for action history, but they
-- are no longer eligible for native FCOS routing.
update emailrouter.destinations
set active = false,
    redirect_enabled = false,
    revision = revision + 1,
    updated_at = now()
where destination_kind <> 'fcos_profile'
  and (active = true or redirect_enabled = true);

do $$
declare
  destination_row record;
  base_nickname text;
  candidate text;
  suffix integer;
begin
  for destination_row in
    select destination.id, profile.full_name
    from emailrouter.destinations destination
    join public.user_profiles profile on profile.id = destination.user_profile_id
    where destination.destination_kind = 'fcos_profile'
    order by profile.full_name, destination.id
  loop
    base_nickname := emailrouter.initials_from_name(destination_row.full_name);
    candidate := base_nickname;
    suffix := 1;
    while exists (
      select 1
      from emailrouter.destinations existing
      where existing.destination_kind = 'fcos_profile'
        and existing.id <> destination_row.id
        and existing.nickname is not null
        and lower(existing.nickname) = lower(candidate)
    ) loop
      suffix := suffix + 1;
      candidate := left(base_nickname, greatest(1, 12 - char_length(suffix::text))) || suffix::text;
    end loop;
    update emailrouter.destinations
    set nickname = candidate,
        redirect_enabled = true
    where id = destination_row.id
      and nickname is null;
  end loop;
end;
$$;

alter table emailrouter.destinations
  drop constraint if exists emailrouter_destinations_native_routing_check,
  add constraint emailrouter_destinations_native_routing_check check (
    (
      destination_kind = 'fcos_profile'
      and nickname is not null
      and nickname ~ '^[A-Z0-9]{1,12}$'
    )
    or (
      destination_kind <> 'fcos_profile'
      and nickname is null
      and redirect_enabled = false
    )
  );

create unique index if not exists emailrouter_destinations_active_nickname_key
  on emailrouter.destinations (lower(nickname))
  where destination_kind = 'fcos_profile' and active = true;

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
        where existing.destination_kind = 'fcos_profile'
          and existing.active = true
          and existing.id is distinct from destination_row.id
          and lower(existing.nickname) = lower(candidate)
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

revoke all on function public.sync_emailrouter_fcos_destinations(uuid)
from public, anon, authenticated;
grant execute on function public.sync_emailrouter_fcos_destinations(uuid)
to service_role;

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
    where btrim(coalesce(value->>'nickname', '')) !~ '^[A-Z0-9]{1,12}$'
      or nullif(value->>'expectedRevision', '') is null
  ) then
    raise exception 'Each routing user requires a 1 to 12 character uppercase nickname and revision';
  end if;
  if (
    select count(distinct lower(value->>'nickname'))
    from jsonb_array_elements(p_items) value
  ) <> requested_count then
    raise exception 'Routing nicknames must be unique';
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
      where existing.destination_kind = 'fcos_profile'
        and existing.active = true
        and existing.id <> destination_row.id
        and lower(existing.nickname) = lower(item->>'nickname')
    ) then
      raise exception 'Routing nicknames must be unique';
    end if;

    update emailrouter.destinations
    set nickname = item->>'nickname',
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

revoke all on function public.save_emailrouter_routing_users(jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.save_emailrouter_routing_users(jsonb, uuid)
to service_role;

notify pgrst, 'reload schema';

commit;
