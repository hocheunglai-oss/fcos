begin;

alter table public.user_navigation_preferences
  add column if not exists sidebar_mode text null,
  add column if not exists table_density text null,
  add column if not exists document_show_only_relevant boolean null,
  add column if not exists document_source_groups text[] null,
  add column if not exists workspace_preferences_initialized boolean not null default false;

alter table public.user_navigation_preferences
  drop constraint if exists user_navigation_preferences_sidebar_mode_check,
  add constraint user_navigation_preferences_sidebar_mode_check
    check (sidebar_mode is null or sidebar_mode in ('auto_hide', 'fixed')),
  drop constraint if exists user_navigation_preferences_table_density_check,
  add constraint user_navigation_preferences_table_density_check
    check (table_density is null or table_density in ('compact', 'comfort'));

create table if not exists public.workspace_preference_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  event_type text not null check (event_type in ('preferences_initialized', 'preferences_updated')),
  changed_fields text[] not null default '{}'::text[],
  resulting_revision integer not null check (resulting_revision > 0),
  created_at timestamptz not null default now()
);

create index if not exists workspace_preference_events_user_created_idx
  on public.workspace_preference_events(user_id, created_at desc);

alter table public.workspace_preference_events enable row level security;
revoke all on table public.workspace_preference_events from public, anon, authenticated;
grant all on table public.workspace_preference_events to service_role;

create or replace function public.save_user_workspace_preferences(
  p_user_id uuid,
  p_sidebar_mode text,
  p_table_density text,
  p_document_show_only_relevant boolean,
  p_document_source_groups text[],
  p_expected_revision integer,
  p_actor_user_id uuid
)
returns public.user_navigation_preferences
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.user_navigation_preferences%rowtype;
  v_result public.user_navigation_preferences%rowtype;
  v_changed_fields text[] := '{}'::text[];
  v_event_type text;
begin
  if p_user_id is null or p_actor_user_id is null or p_user_id <> p_actor_user_id then
    raise exception 'Workspace preferences may only be changed by their owner.';
  end if;
  if p_sidebar_mode not in ('auto_hide', 'fixed') then
    raise exception 'Sidebar mode is invalid.';
  end if;
  if p_table_density not in ('compact', 'comfort') then
    raise exception 'Table density is invalid.';
  end if;
  if p_document_show_only_relevant is null then
    raise exception 'Document filtering preference is required.';
  end if;

  select * into v_current
  from public.user_navigation_preferences
  where user_id = p_user_id
  for update;

  if found then
    if p_expected_revision is null or p_expected_revision <> v_current.revision then
      raise exception 'Workspace preferences changed after they were opened. Refresh and try again.';
    end if;
    if v_current.sidebar_mode is distinct from p_sidebar_mode then v_changed_fields := array_append(v_changed_fields, 'sidebar_mode'); end if;
    if v_current.table_density is distinct from p_table_density then v_changed_fields := array_append(v_changed_fields, 'table_density'); end if;
    if v_current.document_show_only_relevant is distinct from p_document_show_only_relevant then v_changed_fields := array_append(v_changed_fields, 'document_filtering'); end if;
    if v_current.document_source_groups is distinct from coalesce(p_document_source_groups, '{}'::text[]) then v_changed_fields := array_append(v_changed_fields, 'document_sources'); end if;
    v_event_type := case when v_current.workspace_preferences_initialized then 'preferences_updated' else 'preferences_initialized' end;

    update public.user_navigation_preferences set
      sidebar_mode = p_sidebar_mode,
      table_density = p_table_density,
      document_show_only_relevant = p_document_show_only_relevant,
      document_source_groups = coalesce(p_document_source_groups, '{}'::text[]),
      workspace_preferences_initialized = true,
      revision = revision + 1,
      updated_by = p_actor_user_id,
      updated_at = clock_timestamp()
    where user_id = p_user_id
    returning * into v_result;
  else
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'Workspace preferences changed after they were opened. Refresh and try again.';
    end if;
    insert into public.user_navigation_preferences (
      user_id,
      section_orders,
      hidden_item_ids,
      sidebar_mode,
      table_density,
      document_show_only_relevant,
      document_source_groups,
      workspace_preferences_initialized,
      revision,
      updated_by
    ) values (
      p_user_id,
      '{}'::jsonb,
      '{}'::text[],
      p_sidebar_mode,
      p_table_density,
      p_document_show_only_relevant,
      coalesce(p_document_source_groups, '{}'::text[]),
      true,
      1,
      p_actor_user_id
    ) returning * into v_result;
    v_changed_fields := array['sidebar_mode', 'table_density', 'document_filtering', 'document_sources'];
    v_event_type := 'preferences_initialized';
  end if;

  insert into public.workspace_preference_events (
    user_id, actor_user_id, event_type, changed_fields, resulting_revision
  ) values (
    p_user_id, p_actor_user_id, v_event_type, v_changed_fields, v_result.revision
  );

  return v_result;
end;
$$;

revoke all on function public.save_user_workspace_preferences(uuid, text, text, boolean, text[], integer, uuid) from public, anon, authenticated;
grant execute on function public.save_user_workspace_preferences(uuid, text, text, boolean, text[], integer, uuid) to service_role;

create or replace function public.save_user_navigation_preferences(
  p_user_id uuid,
  p_section_orders jsonb,
  p_hidden_item_ids text[],
  p_expected_revision integer,
  p_actor_user_id uuid
)
returns public.user_navigation_preferences
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.user_navigation_preferences%rowtype;
  v_result public.user_navigation_preferences%rowtype;
  v_changed_fields text[] := '{}'::text[];
begin
  if p_user_id is null or p_actor_user_id is null or p_user_id <> p_actor_user_id then
    raise exception 'Navigation preferences may only be changed by their owner.';
  end if;
  if jsonb_typeof(coalesce(p_section_orders, '{}'::jsonb)) <> 'object' then
    raise exception 'Navigation section order must be an object.';
  end if;

  select * into v_current
  from public.user_navigation_preferences
  where user_id = p_user_id
  for update;

  if found then
    if p_expected_revision is null or p_expected_revision <> v_current.revision then
      raise exception 'Navigation preferences changed after they were opened. Refresh and try again.';
    end if;
    if v_current.section_orders is distinct from coalesce(p_section_orders, '{}'::jsonb) then
      v_changed_fields := array_append(v_changed_fields, 'navigation_order');
    end if;
    if v_current.hidden_item_ids is distinct from coalesce(p_hidden_item_ids, '{}'::text[]) then
      v_changed_fields := array_append(v_changed_fields, 'navigation_visibility');
    end if;
    update public.user_navigation_preferences set
      section_orders = coalesce(p_section_orders, '{}'::jsonb),
      hidden_item_ids = coalesce(p_hidden_item_ids, '{}'::text[]),
      revision = revision + 1,
      updated_by = p_actor_user_id,
      updated_at = clock_timestamp()
    where user_id = p_user_id
    returning * into v_result;
  else
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'Navigation preferences changed after they were opened. Refresh and try again.';
    end if;
    insert into public.user_navigation_preferences (
      user_id, section_orders, hidden_item_ids, revision, updated_by
    ) values (
      p_user_id,
      coalesce(p_section_orders, '{}'::jsonb),
      coalesce(p_hidden_item_ids, '{}'::text[]),
      1,
      p_actor_user_id
    ) returning * into v_result;
    v_changed_fields := array['navigation_order', 'navigation_visibility'];
  end if;

  insert into public.workspace_preference_events (
    user_id, actor_user_id, event_type, changed_fields, resulting_revision
  ) values (
    p_user_id, p_actor_user_id, 'preferences_updated', v_changed_fields, v_result.revision
  );

  return v_result;
end;
$$;

revoke all on function public.save_user_navigation_preferences(uuid, jsonb, text[], integer, uuid) from public, anon, authenticated;
grant execute on function public.save_user_navigation_preferences(uuid, jsonb, text[], integer, uuid) to service_role;

insert into public.app_modules (id, label, path, sort_order)
values ('broker_settings_manage', 'Manage Broker Commission Settings', '/brokers?tab=configuration', 191)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'broker_settings_manage', id in ('general_manager', 'administrator', 'finance')
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select profile.id, 'broker_settings_manage', profile.user_type in ('general_manager', 'administrator', 'finance')
from public.user_profiles profile
where profile.use_type_defaults = false
on conflict (user_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

update public.app_modules
set path = '/hedge-desk?tab=administration', updated_at = now()
where id = 'hedge_admin';

create table if not exists public.broker_commission_settings (
  setting_key text primary key default 'company' check (setting_key = 'company'),
  exchange_rate_provider text not null default 'blended' check (exchange_rate_provider in ('blended', 'ECB')),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.broker_commission_settings (setting_key, exchange_rate_provider)
values ('company', 'blended')
on conflict (setting_key) do nothing;

create table if not exists public.broker_commission_setting_events (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null default 'company' check (setting_key = 'company'),
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  previous_provider text null,
  next_provider text not null,
  resulting_revision integer not null check (resulting_revision > 0),
  created_at timestamptz not null default now()
);

create index if not exists broker_commission_setting_events_created_idx
  on public.broker_commission_setting_events(created_at desc);

alter table public.broker_commission_settings enable row level security;
alter table public.broker_commission_setting_events enable row level security;
revoke all on table public.broker_commission_settings from public, anon, authenticated;
revoke all on table public.broker_commission_setting_events from public, anon, authenticated;
grant all on table public.broker_commission_settings to service_role;
grant all on table public.broker_commission_setting_events to service_role;

create or replace function public.save_broker_commission_settings(
  p_exchange_rate_provider text,
  p_expected_revision integer,
  p_actor_user_id uuid
)
returns public.broker_commission_settings
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.broker_commission_settings%rowtype;
  v_result public.broker_commission_settings%rowtype;
begin
  if p_actor_user_id is null then raise exception 'Actor is required.'; end if;
  if p_exchange_rate_provider not in ('blended', 'ECB') then raise exception 'Exchange-rate provider is invalid.'; end if;

  select * into v_current
  from public.broker_commission_settings
  where setting_key = 'company'
  for update;

  if not found or p_expected_revision is null or p_expected_revision <> v_current.revision then
    raise exception 'Broker Commission settings changed after they were opened. Refresh and try again.';
  end if;

  update public.broker_commission_settings set
    exchange_rate_provider = p_exchange_rate_provider,
    revision = revision + 1,
    updated_by = p_actor_user_id,
    updated_at = clock_timestamp()
  where setting_key = 'company'
  returning * into v_result;

  insert into public.broker_commission_setting_events (
    setting_key, actor_user_id, previous_provider, next_provider, resulting_revision
  ) values (
    'company', p_actor_user_id, v_current.exchange_rate_provider, p_exchange_rate_provider, v_result.revision
  );

  return v_result;
end;
$$;

revoke all on function public.save_broker_commission_settings(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.save_broker_commission_settings(text, integer, uuid) to service_role;

commit;
