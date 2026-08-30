begin;

alter table public.user_navigation_preferences
  add column if not exists appearance_mode text not null default 'system',
  add column if not exists glass_intensity text not null default 'balanced';

alter table public.user_navigation_preferences
  drop constraint if exists user_navigation_preferences_appearance_mode_check,
  add constraint user_navigation_preferences_appearance_mode_check
    check (appearance_mode in ('system', 'light', 'dark')),
  drop constraint if exists user_navigation_preferences_glass_intensity_check,
  add constraint user_navigation_preferences_glass_intensity_check
    check (glass_intensity in ('clear', 'balanced', 'tinted'));

create or replace function public.save_user_workspace_preferences_v2(
  p_user_id uuid,
  p_sidebar_mode text,
  p_table_density text,
  p_document_show_only_relevant boolean,
  p_document_source_groups text[],
  p_appearance_mode text,
  p_glass_intensity text,
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
  if p_appearance_mode not in ('system', 'light', 'dark') then
    raise exception 'Appearance mode is invalid.';
  end if;
  if p_glass_intensity not in ('clear', 'balanced', 'tinted') then
    raise exception 'Glass intensity is invalid.';
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
    if v_current.appearance_mode is distinct from p_appearance_mode then v_changed_fields := array_append(v_changed_fields, 'appearance_mode'); end if;
    if v_current.glass_intensity is distinct from p_glass_intensity then v_changed_fields := array_append(v_changed_fields, 'glass_intensity'); end if;
    v_event_type := case when v_current.workspace_preferences_initialized then 'preferences_updated' else 'preferences_initialized' end;

    update public.user_navigation_preferences set
      sidebar_mode = p_sidebar_mode,
      table_density = p_table_density,
      document_show_only_relevant = p_document_show_only_relevant,
      document_source_groups = coalesce(p_document_source_groups, '{}'::text[]),
      appearance_mode = p_appearance_mode,
      glass_intensity = p_glass_intensity,
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
      appearance_mode,
      glass_intensity,
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
      p_appearance_mode,
      p_glass_intensity,
      true,
      1,
      p_actor_user_id
    ) returning * into v_result;
    v_changed_fields := array['sidebar_mode', 'table_density', 'document_filtering', 'document_sources', 'appearance_mode', 'glass_intensity'];
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

revoke all on function public.save_user_workspace_preferences_v2(uuid, text, text, boolean, text[], text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.save_user_workspace_preferences_v2(uuid, text, text, boolean, text[], text, text, integer, uuid) to service_role;

commit;
