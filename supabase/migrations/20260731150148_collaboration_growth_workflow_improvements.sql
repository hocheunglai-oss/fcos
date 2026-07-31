-- Collaboration and Growth & Coaching workflow improvements.
-- All tables remain service-only. RPC callers must supply an active FCOS user
-- identity; each function validates its own collaboration or coaching boundary.

alter table public.collaboration_items
  add column if not exists blocked_reason text not null default ''
    check (char_length(blocked_reason) <= 2000),
  add column if not exists health_status text null
    check (health_status in ('On track', 'At risk', 'Blocked')),
  add column if not exists health_note text not null default ''
    check (char_length(health_note) <= 2000);

alter table public.collaboration_items
  add constraint collaboration_project_health_only_check
  check (item_type = 'project' or (health_status is null and health_note = ''));

alter table public.collaboration_notifications
  add column if not exists handled_at timestamptz null,
  add column if not exists snoozed_until timestamptz null;

alter table public.growth_notifications
  add column if not exists handled_at timestamptz null,
  add column if not exists snoozed_until timestamptz null;

create index if not exists collaboration_notifications_actionable_idx
on public.collaboration_notifications(user_id, handled_at, snoozed_until, read_at, created_at desc);

create index if not exists growth_notifications_actionable_idx
on public.growth_notifications(user_id, handled_at, snoozed_until, read_at, created_at desc);

create table public.collaboration_followers (
  item_id uuid not null references public.collaboration_items(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table public.collaboration_dependencies (
  id uuid primary key default gen_random_uuid(),
  blocked_item_id uuid not null references public.collaboration_items(id) on delete cascade,
  blocking_item_id uuid not null references public.collaboration_items(id) on delete cascade,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (blocked_item_id <> blocking_item_id),
  unique (blocked_item_id, blocking_item_id)
);

create table public.collaboration_project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.collaboration_items(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 255),
  description text not null default '' check (char_length(description) <= 5000),
  due_date date not null,
  status text not null default 'To Do'
    check (status in ('To Do', 'In Progress', 'At Risk', 'Done', 'Cancelled')),
  completed_at timestamptz null,
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collaboration_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 255),
  description text not null default '' check (char_length(description) <= 5000),
  archived_at timestamptz null,
  revision bigint not null default 1 check (revision > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  last_used_at timestamptz null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collaboration_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.collaboration_templates(id) on delete cascade,
  parent_template_item_id uuid null references public.collaboration_template_items(id) on delete cascade,
  item_type text not null check (item_type in ('task', 'subtask')),
  item_order integer not null default 0 check (item_order >= 0),
  title text not null check (length(btrim(title)) between 1 and 255),
  description text not null default '' check (char_length(description) <= 20000),
  priority text not null default 'Medium'
    check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  relative_due_days integer null check (relative_due_days is null or relative_due_days between 0 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (item_type = 'task' and parent_template_item_id is null)
    or (item_type = 'subtask' and parent_template_item_id is not null)
  )
);

create table public.collaboration_template_events (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.collaboration_templates(id) on delete cascade,
  event_type text not null check (event_type in ('template_saved', 'template_used', 'template_archived')),
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists collaboration_followers_user_idx
on public.collaboration_followers(user_id, item_id);
create index if not exists collaboration_dependencies_blocked_idx
on public.collaboration_dependencies(blocked_item_id, created_at);
create index if not exists collaboration_dependencies_blocking_idx
on public.collaboration_dependencies(blocking_item_id, created_at);
create index if not exists collaboration_milestones_project_idx
on public.collaboration_project_milestones(project_id, due_date, status);
create index if not exists collaboration_templates_active_idx
on public.collaboration_templates(archived_at, updated_at desc);
create index if not exists collaboration_template_items_template_idx
on public.collaboration_template_items(template_id, item_order, created_at);
create index if not exists collaboration_template_events_template_idx
on public.collaboration_template_events(template_id, created_at desc);

alter table public.growth_development_plans
  add column if not exists closeout_status text not null default 'Open'
    check (closeout_status in ('Open', 'Closed', 'Carried Forward')),
  add column if not exists closed_at timestamptz null,
  add column if not exists carried_forward_plan_id uuid null references public.growth_development_plans(id) on delete restrict;

alter table public.growth_development_plans
  add constraint growth_plan_carry_forward_not_self_check
  check (carried_forward_plan_id is null or carried_forward_plan_id <> id);

create table public.growth_goal_collaboration_evidence (
  goal_id uuid not null references public.growth_goals(id) on delete cascade,
  item_id uuid not null references public.collaboration_items(id) on delete restrict,
  linked_by uuid not null references public.user_profiles(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key (goal_id, item_id)
);

alter table public.growth_coaching_actions
  add column if not exists proposed_by uuid null references public.user_profiles(id) on delete restrict,
  add column if not exists proposed_for uuid null references public.user_profiles(id) on delete restrict,
  add column if not exists proposal_status text not null default 'not_required'
    check (proposal_status in ('not_required', 'pending', 'accepted', 'declined', 'cancelled')),
  add column if not exists proposal_note text not null default ''
    check (char_length(proposal_note) <= 2000),
  add column if not exists proposal_responded_at timestamptz null,
  add column if not exists proposal_responded_by uuid null references public.user_profiles(id) on delete restrict;

alter table public.growth_coaching_actions
  add constraint growth_coaching_action_proposal_check
  check (
    (proposal_status = 'not_required' and proposed_by is null and proposed_for is null)
    or (proposal_status <> 'not_required' and proposed_by is not null and proposed_for is not null and proposed_by <> proposed_for)
  );

alter table public.growth_coaching_agenda_items
  add column if not exists rolled_over_from_agenda_item_id uuid null
    references public.growth_coaching_agenda_items(id) on delete set null,
  add column if not exists rolled_over_at timestamptz null,
  add column if not exists rolled_over_by uuid null references public.user_profiles(id) on delete restrict;

alter table public.growth_coaching_agenda_items
  add constraint growth_coaching_agenda_rollover_not_self_check
  check (rolled_over_from_agenda_item_id is null or rolled_over_from_agenda_item_id <> id);

create index if not exists growth_plans_closeout_idx
on public.growth_development_plans(employee_id, closeout_status, end_date, updated_at desc);
create index if not exists growth_goal_collaboration_evidence_goal_idx
on public.growth_goal_collaboration_evidence(goal_id, linked_at desc);
create index if not exists growth_coaching_actions_proposal_idx
on public.growth_coaching_actions(proposed_for, proposal_status, updated_at desc)
where proposal_status = 'pending';
create index if not exists growth_coaching_agenda_rollover_idx
on public.growth_coaching_agenda_items(rolled_over_from_agenda_item_id)
where rolled_over_from_agenda_item_id is not null;

alter table public.collaboration_followers enable row level security;
alter table public.collaboration_dependencies enable row level security;
alter table public.collaboration_project_milestones enable row level security;
alter table public.collaboration_templates enable row level security;
alter table public.collaboration_template_items enable row level security;
alter table public.collaboration_template_events enable row level security;
alter table public.growth_goal_collaboration_evidence enable row level security;

revoke all on table public.collaboration_followers from public, anon, authenticated;
revoke all on table public.collaboration_dependencies from public, anon, authenticated;
revoke all on table public.collaboration_project_milestones from public, anon, authenticated;
revoke all on table public.collaboration_templates from public, anon, authenticated;
revoke all on table public.collaboration_template_items from public, anon, authenticated;
revoke all on table public.collaboration_template_events from public, anon, authenticated;
revoke all on table public.growth_goal_collaboration_evidence from public, anon, authenticated;

grant all on table public.collaboration_followers to service_role;
grant all on table public.collaboration_dependencies to service_role;
grant all on table public.collaboration_project_milestones to service_role;
grant all on table public.collaboration_templates to service_role;
grant all on table public.collaboration_template_items to service_role;
grant all on table public.collaboration_template_events to service_role;
grant all on table public.growth_goal_collaboration_evidence to service_role;

create or replace function public.collaboration_actor_can_manage(
  p_item public.collaboration_items,
  p_actor_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (p_item).owner_user_id = p_actor_id
    or public.collaboration_is_general_manager(p_actor_id);
$$;

create or replace function public.toggle_collaboration_follower(
  p_item_id uuid,
  p_follow boolean,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.collaboration_items%rowtype;
begin
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_id and profile.active = true
  ) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_item
  from public.collaboration_items item
  where item.id = p_item_id and item.archived_at is null;
  if not found then
    raise exception 'The work item is unavailable.';
  end if;

  if p_follow then
    insert into public.collaboration_followers (item_id, user_id, created_by)
    values (v_item.id, p_actor_id, p_actor_id)
    on conflict (item_id, user_id) do nothing;
  else
    delete from public.collaboration_followers
    where item_id = v_item.id and user_id = p_actor_id;
  end if;

  insert into public.collaboration_events (
    item_id, event_type, summary, metadata, actor_user_id
  ) values (
    v_item.id,
    case when p_follow then 'follower_added' else 'follower_removed' end,
    case when p_follow then 'Follower added.' else 'Follower removed.' end,
    jsonb_build_object('followerUserId', p_actor_id),
    p_actor_id
  );
  return jsonb_build_object('itemId', v_item.id, 'following', p_follow);
end;
$$;

create or replace function public.save_collaboration_dependency(
  p_blocked_item_id uuid,
  p_blocking_item_id uuid,
  p_operation text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_blocked public.collaboration_items%rowtype;
  v_blocking public.collaboration_items%rowtype;
  v_dependency public.collaboration_dependencies%rowtype;
begin
  if p_operation not in ('save', 'remove') then
    raise exception 'Select save or remove for a dependency.';
  end if;
  if p_blocked_item_id is null or p_blocking_item_id is null
     or p_blocked_item_id = p_blocking_item_id then
    raise exception 'Select two different work items.';
  end if;
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_id and profile.active = true
  ) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_blocked from public.collaboration_items item
  where item.id = p_blocked_item_id for update;
  if not found or v_blocked.archived_at is not null then
    raise exception 'The blocked work item is unavailable.';
  end if;
  if not public.collaboration_actor_can_manage(v_blocked, p_actor_id) then
    raise exception 'Only the owner or General Manager can manage dependencies.';
  end if;

  if p_operation = 'remove' then
    delete from public.collaboration_dependencies
    where blocked_item_id = p_blocked_item_id
      and blocking_item_id = p_blocking_item_id
    returning * into v_dependency;
    if not found then
      raise exception 'The dependency was already removed.';
    end if;
  else
    select * into v_blocking from public.collaboration_items item
    where item.id = p_blocking_item_id and item.archived_at is null;
    if not found then
      raise exception 'The blocking work item is unavailable.';
    end if;
    if exists (
      with recursive dependency_path(item_id) as (
        select p_blocking_item_id
        union
        select dependency.blocking_item_id
        from public.collaboration_dependencies dependency
        join dependency_path path on path.item_id = dependency.blocked_item_id
      )
      select 1 from dependency_path where item_id = p_blocked_item_id
    ) then
      raise exception 'This dependency would create a circular blocker.';
    end if;
    insert into public.collaboration_dependencies (
      blocked_item_id, blocking_item_id, created_by
    ) values (
      p_blocked_item_id, p_blocking_item_id, p_actor_id
    ) on conflict (blocked_item_id, blocking_item_id) do update
      set created_by = excluded.created_by
    returning * into v_dependency;
  end if;

  insert into public.collaboration_events (
    item_id, event_type, summary, metadata, actor_user_id
  ) values (
    v_blocked.id,
    case when p_operation = 'save' then 'dependency_saved' else 'dependency_removed' end,
    case when p_operation = 'save' then 'Dependency saved.' else 'Dependency removed.' end,
    jsonb_build_object('dependencyId', v_dependency.id, 'blockingItemId', p_blocking_item_id),
    p_actor_id
  );
  return jsonb_build_object('dependency', to_jsonb(v_dependency), 'operation', p_operation);
end;
$$;

create or replace function public.save_collaboration_project_milestone(
  p_project_id uuid,
  p_values jsonb,
  p_actor_id uuid,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.collaboration_items%rowtype;
  v_milestone public.collaboration_project_milestones%rowtype;
  v_existing public.collaboration_project_milestones%rowtype;
  v_id uuid := nullif(p_values->>'id', '')::uuid;
  v_status text := coalesce(nullif(p_values->>'status', ''), 'To Do');
  v_title text := btrim(coalesce(p_values->>'title', ''));
  v_due_date date := nullif(p_values->>'due_date', '')::date;
begin
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_project from public.collaboration_items item
  where item.id = p_project_id and item.item_type = 'project' and item.archived_at is null
  for update;
  if not found then raise exception 'The project is unavailable.'; end if;
  if not public.collaboration_actor_can_manage(v_project, p_actor_id) then
    raise exception 'Only the project owner or General Manager can manage milestones.';
  end if;
  if v_title = '' or v_due_date is null then
    raise exception 'A milestone title and due date are required.';
  end if;
  if v_status not in ('To Do', 'In Progress', 'At Risk', 'Done', 'Cancelled') then
    raise exception 'Select a valid milestone status.';
  end if;

  if v_id is null then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'The milestone changed after it was opened.';
    end if;
    insert into public.collaboration_project_milestones (
      project_id, title, description, due_date, status, completed_at, created_by, updated_by
    ) values (
      v_project.id, v_title, left(coalesce(p_values->>'description', ''), 5000), v_due_date,
      v_status, case when v_status = 'Done' then now() else null end, p_actor_id, p_actor_id
    ) returning * into v_milestone;
  else
    select * into v_existing from public.collaboration_project_milestones
    where id = v_id and project_id = v_project.id for update;
    if not found or v_existing.revision <> coalesce(p_expected_revision, 0) then
      raise exception 'The milestone changed after it was opened.';
    end if;
    update public.collaboration_project_milestones
    set title = v_title,
        description = left(coalesce(p_values->>'description', ''), 5000),
        due_date = v_due_date,
        status = v_status,
        completed_at = case when v_status = 'Done' then coalesce(completed_at, now()) else null end,
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_existing.id
    returning * into v_milestone;
  end if;
  insert into public.collaboration_events (
    item_id, event_type, summary, metadata, actor_user_id
  ) values (
    v_project.id, 'milestone_saved', 'Project milestone saved.',
    jsonb_build_object('milestoneId', v_milestone.id, 'status', v_milestone.status), p_actor_id
  );
  return jsonb_build_object('milestone', to_jsonb(v_milestone));
end;
$$;

create or replace function public.save_collaboration_template(
  p_template_id uuid,
  p_values jsonb,
  p_items jsonb,
  p_actor_id uuid,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.collaboration_templates%rowtype;
  v_existing public.collaboration_templates%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_parent_id uuid;
  v_item_type text;
  v_is_gm boolean := false;
begin
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Template work items must be an array.';
  end if;
  if btrim(coalesce(p_values->>'title', '')) = '' then
    raise exception 'A template title is required.';
  end if;
  v_is_gm := public.collaboration_is_general_manager(p_actor_id);

  if p_template_id is null then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'The template changed after it was opened.';
    end if;
    insert into public.collaboration_templates (title, description, created_by, updated_by)
    values (
      left(btrim(p_values->>'title'), 255), left(coalesce(p_values->>'description', ''), 5000),
      p_actor_id, p_actor_id
    ) returning * into v_template;
  else
    select * into v_existing from public.collaboration_templates
    where id = p_template_id for update;
    if not found or v_existing.revision <> coalesce(p_expected_revision, 0) then
      raise exception 'The template changed after it was opened.';
    end if;
    if v_existing.created_by <> p_actor_id and not v_is_gm then
      raise exception 'Only the template creator or General Manager can edit it.';
    end if;
    update public.collaboration_templates
    set title = left(btrim(p_values->>'title'), 255),
        description = left(coalesce(p_values->>'description', ''), 5000),
        archived_at = case when p_values ? 'archived' and (p_values->>'archived')::boolean then now() else null end,
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_existing.id
    returning * into v_template;
    delete from public.collaboration_template_items where template_id = v_template.id;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item_type := lower(coalesce(v_item->>'item_type', 'task'));
    if v_item_type = 'task' then
      v_item_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid());
      if btrim(coalesce(v_item->>'title', '')) = '' then raise exception 'Each template task needs a title.'; end if;
      insert into public.collaboration_template_items (
        id, template_id, item_type, item_order, title, description, priority, relative_due_days
      ) values (
        v_item_id, v_template.id, 'task', greatest(coalesce((v_item->>'item_order')::integer, 0), 0),
        left(btrim(v_item->>'title'), 255), left(coalesce(v_item->>'description', ''), 20000),
        coalesce(nullif(v_item->>'priority', ''), 'Medium'), nullif(v_item->>'relative_due_days', '')::integer
      );
    elsif v_item_type <> 'subtask' then
      raise exception 'Template items must be tasks or subtasks.';
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if lower(coalesce(v_item->>'item_type', 'task')) = 'subtask' then
      v_item_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid());
      v_parent_id := nullif(v_item->>'parent_template_item_id', '')::uuid;
      if v_parent_id is null or not exists (
        select 1 from public.collaboration_template_items item
        where item.id = v_parent_id and item.template_id = v_template.id and item.item_type = 'task'
      ) then
        raise exception 'Each template subtask needs a task from the same template.';
      end if;
      if btrim(coalesce(v_item->>'title', '')) = '' then raise exception 'Each template subtask needs a title.'; end if;
      insert into public.collaboration_template_items (
        id, template_id, parent_template_item_id, item_type, item_order, title, description, priority, relative_due_days
      ) values (
        v_item_id, v_template.id, v_parent_id, 'subtask', greatest(coalesce((v_item->>'item_order')::integer, 0), 0),
        left(btrim(v_item->>'title'), 255), left(coalesce(v_item->>'description', ''), 20000),
        coalesce(nullif(v_item->>'priority', ''), 'Medium'), nullif(v_item->>'relative_due_days', '')::integer
      );
    end if;
  end loop;
  insert into public.collaboration_template_events (template_id, event_type, actor_user_id, metadata)
  values (
    v_template.id,
    case when v_template.archived_at is null then 'template_saved' else 'template_archived' end,
    p_actor_id,
    jsonb_build_object('revision', v_template.revision, 'itemCount', jsonb_array_length(coalesce(p_items, '[]'::jsonb)))
  );
  return jsonb_build_object('template', to_jsonb(v_template));
end;
$$;

create or replace function public.use_collaboration_template(
  p_template_id uuid,
  p_project_values jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.collaboration_templates%rowtype;
  v_template_item public.collaboration_template_items%rowtype;
  v_created jsonb;
  v_project jsonb;
  v_created_item jsonb;
  v_target_id uuid;
  v_item_map jsonb := '{}'::jsonb;
  v_created_count integer := 0;
begin
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_id and profile.active and lower(profile.email) = lower(btrim(p_actor_email))
  ) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_template from public.collaboration_templates template
  where template.id = p_template_id and template.archived_at is null for update;
  if not found then raise exception 'The template is unavailable.'; end if;

  v_created := public.create_collaboration_item(
    coalesce(p_project_values, '{}'::jsonb) || jsonb_build_object('item_type', 'project'),
    p_actor_id,
    p_actor_email
  );
  v_project := v_created->'item';
  for v_template_item in
    select * from public.collaboration_template_items
    where template_id = v_template.id and item_type = 'task'
    order by item_order, created_at
  loop
    v_created_item := public.create_collaboration_item(
      jsonb_build_object(
        'item_type', 'task',
        'project_id', v_project->>'id',
        'title', v_template_item.title,
        'description', v_template_item.description,
        'priority', v_template_item.priority,
        'due_date', case when v_template_item.relative_due_days is null then null else
          (current_date + v_template_item.relative_due_days)::text end
      ), p_actor_id, p_actor_email
    );
    v_target_id := (v_created_item->'item'->>'id')::uuid;
    v_item_map := v_item_map || jsonb_build_object(v_template_item.id::text, v_target_id::text);
    v_created_count := v_created_count + 1;
  end loop;
  for v_template_item in
    select * from public.collaboration_template_items
    where template_id = v_template.id and item_type = 'subtask'
    order by item_order, created_at
  loop
    v_created_item := public.create_collaboration_item(
      jsonb_build_object(
        'item_type', 'subtask',
        'parent_id', v_item_map->>v_template_item.parent_template_item_id::text,
        'title', v_template_item.title,
        'description', v_template_item.description,
        'priority', v_template_item.priority,
        'due_date', case when v_template_item.relative_due_days is null then null else
          (current_date + v_template_item.relative_due_days)::text end
      ), p_actor_id, p_actor_email
    );
    v_created_count := v_created_count + 1;
  end loop;
  update public.collaboration_templates
  set usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
  where id = v_template.id;
  insert into public.collaboration_template_events (template_id, event_type, actor_user_id, metadata)
  values (v_template.id, 'template_used', p_actor_id,
    jsonb_build_object('projectId', v_project->>'id', 'createdItemCount', v_created_count));
  insert into public.collaboration_events (item_id, event_type, summary, metadata, actor_user_id)
  values ((v_project->>'id')::uuid, 'template_used', 'Project created from template.',
    jsonb_build_object('templateId', v_template.id, 'templateRevision', v_template.revision, 'createdItemCount', v_created_count),
    p_actor_id);
  return jsonb_build_object('project', v_project, 'createdItemCount', v_created_count, 'templateId', v_template.id);
end;
$$;

/* Superseded internal prototypes. The stable contracts below replace them. */
/*
create or replace function public.update_work_notification_state(
  p_source text,
  p_notification_id uuid,
  p_actor_id uuid,
  p_state jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_read_at timestamptz;
  v_handled_at timestamptz;
  v_snoozed_until timestamptz;
  v_updated jsonb;
begin
  if p_source not in ('collaboration', 'growth') then
    raise exception 'Select collaboration or growth notifications.';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  if jsonb_typeof(v_state) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(v_state) key
       where key not in ('read', 'handled', 'snoozed_until')
     ) then
    raise exception 'Notification state contains an unsupported value.';
  end if;
  if v_state ? 'read' and jsonb_typeof(v_state->'read') <> 'boolean' then
    raise exception 'Read state must be true or false.';
  end if;
  if v_state ? 'handled' and jsonb_typeof(v_state->'handled') <> 'boolean' then
    raise exception 'Handled state must be true or false.';
  end if;
  if v_state ? 'snoozed_until' and v_state->>'snoozed_until' is not null then
    v_snoozed_until := (v_state->>'snoozed_until')::timestamptz;
  end if;
  if p_source = 'collaboration' then
    update public.collaboration_notifications notification
    set read_at = case when v_state ? 'read' then case when (v_state->>'read')::boolean then now() else null end else notification.read_at end,
        handled_at = case when v_state ? 'handled' then case when (v_state->>'handled')::boolean then now() else null end else notification.handled_at end,
        snoozed_until = case when v_state ? 'snoozed_until' then v_snoozed_until else notification.snoozed_until end
    where notification.id = p_notification_id and notification.user_id = p_actor_id
    returning to_jsonb(notification) into v_updated;
  else
    update public.growth_notifications notification
    set read_at = case when v_state ? 'read' then case when (v_state->>'read')::boolean then now() else null end else notification.read_at end,
        handled_at = case when v_state ? 'handled' then case when (v_state->>'handled')::boolean then now() else notification.handled_at end else notification.handled_at end,
        snoozed_until = case when v_state ? 'snoozed_until' then v_snoozed_until else notification.snoozed_until end
    where notification.id = p_notification_id and notification.user_id = p_actor_id
    returning to_jsonb(notification) into v_updated;
  end if;
  if v_updated is null then
    raise exception 'The notification is unavailable.';
  end if;
  return jsonb_build_object('source', p_source, 'notification', v_updated);
end;
$$;

create or replace function public.closeout_growth_development_plan(
  p_plan_id uuid,
  p_operation text,
  p_summary text,
  p_actor_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.growth_development_plans%rowtype;
  v_primary_manager_id uuid;
begin
  if p_operation not in ('request', 'complete') then
    raise exception 'Select request or complete for plan closeout.';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_plan from public.growth_development_plans plan
  where plan.id = p_plan_id and plan.archived_at is null for update;
  if not found or v_plan.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The development plan changed after it was opened.';
  end if;
  select assignment.primary_manager_id into v_primary_manager_id
  from public.growth_reporting_assignments assignment where assignment.employee_id = v_plan.employee_id;
  if p_operation = 'request' then
    if p_actor_id <> v_plan.employee_id then
      raise exception 'Only the employee may request plan closeout.';
    end if;
    if v_plan.closeout_state not in ('Open', 'Carried Forward') then
      raise exception 'This plan is already being closed.';
    end if;
    update public.growth_development_plans
    set closeout_state = 'Closeout Requested', closeout_summary = left(coalesce(p_summary, ''), 10000),
        closeout_requested_at = now(), closeout_requested_by = p_actor_id,
        revision = revision + 1, updated_by = p_actor_id, updated_at = now()
    where id = v_plan.id returning * into v_plan;
  else
    if p_actor_id is distinct from v_primary_manager_id then
      raise exception 'Only the current primary manager may complete plan closeout.';
    end if;
    if v_plan.closeout_state <> 'Closeout Requested' then
      raise exception 'The employee must request closeout before the manager completes it.';
    end if;
    if exists (
      select 1 from public.growth_goals goal
      where goal.plan_id = v_plan.id
        and goal.status not in ('Completed', 'Not Achieved')
    ) then
      raise exception 'Complete, mark not achieved, or cancel every goal before closing the plan.';
    end if;
    update public.growth_development_plans
    set closeout_state = 'Closed', closeout_summary = left(coalesce(p_summary, ''), 10000),
        closed_at = now(), closed_by = p_actor_id,
        revision = revision + 1, updated_by = p_actor_id, updated_at = now()
    where id = v_plan.id returning * into v_plan;
  end if;
  insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
  values ('plan', v_plan.id, case when p_operation = 'request' then 'plan_closeout_requested' else 'plan_closed' end,
    p_actor_id, v_plan.employee_id, 'Development plan closeout updated.',
    jsonb_build_object('closeoutState', v_plan.closeout_state, 'revision', v_plan.revision));
  return jsonb_build_object('plan', to_jsonb(v_plan));
end;
$$;

create or replace function public.carry_forward_growth_development_plan(
  p_plan_id uuid,
  p_new_plan_values jsonb,
  p_goal_ids uuid[],
  p_actor_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.growth_development_plans%rowtype;
  v_new_plan public.growth_development_plans%rowtype;
  v_goal public.growth_goals%rowtype;
  v_version public.growth_goal_versions%rowtype;
  v_new_goal public.growth_goals%rowtype;
  v_checkpoint public.growth_goal_checkpoints%rowtype;
  v_goal_count integer := 0;
begin
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_source from public.growth_development_plans plan
  where plan.id = p_plan_id and plan.archived_at is null for update;
  if not found or v_source.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The development plan changed after it was opened.';
  end if;
  if v_source.employee_id <> p_actor_id then
    raise exception 'Only the employee may carry forward their development plan.';
  end if;
  if v_source.carried_forward_to_plan_id is not null then
    raise exception 'This plan has already been carried forward.';
  end if;
  if btrim(coalesce(p_new_plan_values->>'title', '')) = ''
     or nullif(p_new_plan_values->>'start_date', '') is null
     or nullif(p_new_plan_values->>'end_date', '') is null then
    raise exception 'A new plan title, start date, and end date are required.';
  end if;
  if (p_new_plan_values->>'start_date')::date > (p_new_plan_values->>'end_date')::date then
    raise exception 'Plan end date cannot be before the start date.';
  end if;
  insert into public.growth_development_plans (
    employee_id, title, description, period_type, start_date, end_date,
    carried_forward_from_plan_id, created_by, updated_by
  ) values (
    v_source.employee_id, left(btrim(p_new_plan_values->>'title'), 255),
    coalesce(p_new_plan_values->>'description', ''),
    coalesce(nullif(p_new_plan_values->>'period_type', ''), 'custom'),
    (p_new_plan_values->>'start_date')::date, (p_new_plan_values->>'end_date')::date,
    v_source.id, p_actor_id, p_actor_id
  ) returning * into v_new_plan;

  for v_goal in
    select goal.* from public.growth_goals goal
    where goal.plan_id = v_source.id
      and (cardinality(p_goal_ids) is null or cardinality(p_goal_ids) = 0 or goal.id = any(p_goal_ids))
      and goal.status not in ('Completed', 'Not Achieved')
    order by goal.created_at
  loop
    select * into v_version from public.growth_goal_versions version
    where version.goal_id = v_goal.id and version.version = v_goal.active_version;
    insert into public.growth_goals (
      plan_id, employee_id, status, title, description, active_version, progress,
      primary_manager_id, created_by, updated_by
    ) values (
      v_new_plan.id, v_goal.employee_id, 'Draft', v_goal.title, v_goal.description, 1, 0,
      v_goal.primary_manager_id, p_actor_id, p_actor_id
    ) returning * into v_new_goal;
    insert into public.growth_goal_versions (
      goal_id, version, title, description, measurement_type, measurement, deadline, created_by
    ) values (
      v_new_goal.id, 1, v_version.title, v_version.description, v_version.measurement_type,
      v_version.measurement, v_version.deadline, p_actor_id
    );
    for v_checkpoint in
      select * from public.growth_goal_checkpoints checkpoint
      where checkpoint.goal_id = v_goal.id and checkpoint.goal_version = v_goal.active_version
      order by checkpoint.due_date, checkpoint.created_at
    loop
      insert into public.growth_goal_checkpoints (
        goal_id, goal_version, due_date, expected_result, created_by, updated_by
      ) values (
        v_new_goal.id, 1, v_checkpoint.due_date, v_checkpoint.expected_result, p_actor_id, p_actor_id
      );
    end loop;
    v_goal_count := v_goal_count + 1;
  end loop;
  update public.growth_development_plans
  set carried_forward_to_plan_id = v_new_plan.id, closeout_state = 'Carried Forward',
      revision = revision + 1, updated_by = p_actor_id, updated_at = now()
  where id = v_source.id returning * into v_source;
  insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
  values ('plan', v_source.id, 'plan_carried_forward', p_actor_id, v_source.employee_id,
    'Development plan carried forward.',
    jsonb_build_object('newPlanId', v_new_plan.id, 'carriedGoalCount', v_goal_count));
  return jsonb_build_object('sourcePlan', to_jsonb(v_source), 'newPlan', to_jsonb(v_new_plan), 'carriedGoalCount', v_goal_count);
end;
$$;

create or replace function public.save_growth_goal_collaboration_evidence_link(
  p_goal_id uuid,
  p_collaboration_item_id uuid,
  p_evidence_type text,
  p_note text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal public.growth_goals%rowtype;
  v_item public.collaboration_items%rowtype;
  v_link public.growth_goal_collaboration_evidence%rowtype;
begin
  if p_evidence_type not in ('progress', 'completion') then
    raise exception 'Select progress or completion evidence.';
  end if;
  select * into v_goal from public.growth_goals goal where goal.id = p_goal_id;
  if not found or v_goal.employee_id <> p_actor_id then
    raise exception 'Only the employee may link private goal evidence.';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_item from public.collaboration_items item
  where item.id = p_collaboration_item_id and item.archived_at is null;
  if not found then raise exception 'The work item is unavailable.'; end if;
  insert into public.growth_goal_collaboration_evidence (
    goal_id, item_id, linked_by
  ) values (
    v_goal.id, v_item.id, p_actor_id
  ) on conflict (goal_id, item_id) do update
    set linked_by = excluded.linked_by, linked_at = now()
  returning * into v_link;
  insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
  values ('goal', v_goal.id, 'goal_evidence_linked', p_actor_id, v_goal.employee_id,
    'Goal evidence linked to Projects & Tasks.',
    jsonb_build_object('collaborationItemId', v_item.id, 'evidenceType', p_evidence_type));
  return jsonb_build_object('link', to_jsonb(v_link));
end;
$$;

create or replace function public.respond_growth_coaching_action_proposal(
  p_action_id uuid,
  p_expected_revision integer,
  p_response text,
  p_actor_id uuid,
  p_note text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action public.growth_coaching_actions%rowtype;
  v_session public.growth_coaching_sessions%rowtype;
  v_relationship public.growth_coaching_relationships%rowtype;
begin
  if p_response not in ('accept', 'decline') then
    raise exception 'Select accept or decline.';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_action from public.growth_coaching_actions action
  where action.id = p_action_id for update;
  if not found or v_action.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The coaching action changed after it was opened.';
  end if;
  if v_action.proposal_status <> 'pending' or v_action.proposed_for <> p_actor_id then
    raise exception 'Only the invited participant may respond to this action proposal.';
  end if;
  select * into v_session from public.growth_coaching_sessions session where session.id = v_action.session_id;
  select * into v_relationship from public.growth_coaching_relationships relationship where relationship.id = v_session.relationship_id;
  if v_relationship.status <> 'Active'
     or p_actor_id not in (v_relationship.participant_one_id, v_relationship.participant_two_id)
     or v_action.proposed_by not in (v_relationship.participant_one_id, v_relationship.participant_two_id) then
    raise exception 'The coaching relationship is unavailable.';
  end if;
  update public.growth_coaching_actions
  set owner_id = case when p_response = 'accept' then p_actor_id else owner_id end,
      status = case when p_response = 'decline' then 'Cancelled' else status end,
      proposal_status = case when p_response = 'accept' then 'accepted' else 'declined' end,
      proposal_note = left(coalesce(p_note, ''), 2000),
      proposal_responded_at = now(), proposal_responded_by = p_actor_id,
      revision = revision + 1, updated_by = p_actor_id, updated_at = now()
  where id = v_action.id returning * into v_action;
  insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
  values ('coaching_action', v_action.id,
    case when p_response = 'accept' then 'coaching_action_proposal_accepted' else 'coaching_action_proposal_declined' end,
    p_actor_id, v_action.proposed_by, 'Coaching action proposal response recorded.',
    jsonb_build_object('proposalStatus', v_action.proposal_status));
  return jsonb_build_object('action', to_jsonb(v_action));
end;
$$;
*/

-- Preserve the established item, template, and plan logic behind private
-- service-only helpers, then expose the stable integration contracts below.
alter function public.toggle_collaboration_follower(uuid, boolean, uuid)
  rename to save_collaboration_follower_core;
alter function public.save_collaboration_dependency(uuid, uuid, text, uuid)
  rename to save_collaboration_dependency_core;
alter function public.save_collaboration_project_milestone(uuid, jsonb, uuid, bigint)
  rename to save_collaboration_milestone_core;
alter function public.save_collaboration_template(uuid, jsonb, jsonb, uuid, bigint)
  rename to save_collaboration_template_core;
alter function public.use_collaboration_template(uuid, jsonb, uuid, text)
  rename to use_collaboration_template_core;

alter function public.save_collaboration_follower_core(uuid, boolean, uuid) set search_path = '';
alter function public.save_collaboration_dependency_core(uuid, uuid, text, uuid) set search_path = '';
alter function public.save_collaboration_milestone_core(uuid, jsonb, uuid, bigint) set search_path = '';
alter function public.save_collaboration_template_core(uuid, jsonb, jsonb, uuid, bigint) set search_path = '';
alter function public.use_collaboration_template_core(uuid, jsonb, uuid, text) set search_path = '';

create or replace function public.save_collaboration_follower(
  p_item_id uuid,
  p_follow boolean,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.active = true
      and lower(profile.email) = lower(btrim(p_actor_email))
  ) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  return public.save_collaboration_follower_core(p_item_id, p_follow, p_actor_id);
end;
$$;

create or replace function public.save_collaboration_dependency(
  p_item_id uuid,
  p_blocked_by_item_id uuid,
  p_remove boolean,
  p_actor_id uuid,
  p_actor_email text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.collaboration_items%rowtype;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.active = true
      and lower(profile.email) = lower(btrim(p_actor_email))
  ) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_item
  from public.collaboration_items item
  where item.id = p_item_id
  for update;
  if not found or v_item.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'This work item changed after it was opened.';
  end if;
  v_result := public.save_collaboration_dependency_core(
    p_item_id,
    p_blocked_by_item_id,
    case when p_remove then 'remove' else 'save' end,
    p_actor_id
  );
  update public.collaboration_items
  set revision = revision + 1,
      updated_by = p_actor_id,
      updated_by_email = p_actor_email,
      updated_at = now()
  where id = p_item_id;
  return v_result;
end;
$$;

create or replace function public.save_collaboration_milestone(
  p_values jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid := nullif(p_values->>'project_id', '')::uuid;
  v_expected_revision bigint := coalesce(nullif(p_values->>'expected_revision', '')::bigint, 0);
  v_expected_project_revision bigint := coalesce(nullif(p_values->>'expected_project_revision', '')::bigint, 0);
  v_project public.collaboration_items%rowtype;
  v_result jsonb;
begin
  if v_project_id is null then
    raise exception 'A project is required.';
  end if;
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.active = true
      and lower(profile.email) = lower(btrim(p_actor_email))
  ) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_project
  from public.collaboration_items item
  where item.id = v_project_id and item.item_type = 'project'
  for update;
  if not found or v_project.revision <> v_expected_project_revision then
    raise exception 'This work item changed after it was opened.';
  end if;
  v_result := public.save_collaboration_milestone_core(v_project_id, p_values, p_actor_id, v_expected_revision);
  update public.collaboration_items
  set revision = revision + 1,
      updated_by = p_actor_id,
      updated_by_email = p_actor_email,
      updated_at = now()
  where id = v_project_id;
  return v_result;
end;
$$;

create or replace function public.save_collaboration_template(
  p_values jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mode text := lower(coalesce(nullif(p_values->>'mode', ''), 'save'));
  v_template_id uuid := nullif(p_values->>'id', '')::uuid;
  v_expected_revision bigint := coalesce(nullif(p_values->>'expected_revision', '')::bigint, 0);
begin
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.active = true
      and lower(profile.email) = lower(btrim(p_actor_email))
  ) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  if v_mode = 'use' then
    if v_template_id is null then raise exception 'A template is required.'; end if;
    return public.use_collaboration_template_core(
      v_template_id,
      coalesce(p_values->'project', '{}'::jsonb),
      p_actor_id,
      p_actor_email
    );
  end if;
  if v_mode <> 'save' then
    raise exception 'Select save or use for a template.';
  end if;
  return public.save_collaboration_template_core(
    v_template_id,
    p_values,
    coalesce(p_values->'items', '[]'::jsonb),
    p_actor_id,
    v_expected_revision
  );
end;
$$;

create or replace function public.set_work_notification_state(
  p_source text,
  p_notification_ids uuid[],
  p_user_id uuid,
  p_state text,
  p_snoozed_until timestamptz default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  if p_source not in ('collaboration', 'growth') then
    raise exception 'Select collaboration or growth notifications.';
  end if;
  if p_state not in ('read', 'unread', 'handled', 'unhandled', 'snoozed') then
    raise exception 'Select read, unread, handled, unhandled, or snoozed.';
  end if;
  if p_notification_ids is null or cardinality(p_notification_ids) = 0 then
    return 0;
  end if;
  if not exists (select 1 from public.user_profiles profile where profile.id = p_user_id and profile.active) then
    raise exception 'An active FCOS user is required.';
  end if;
  if p_state = 'snoozed' and (p_snoozed_until is null or p_snoozed_until <= now()) then
    raise exception 'A future snooze time is required.';
  end if;
  if p_source = 'collaboration' then
    update public.collaboration_notifications notification
    set read_at = case when p_state = 'read' then now() when p_state = 'unread' then null else notification.read_at end,
        handled_at = case when p_state = 'handled' then now() when p_state = 'unhandled' then null else notification.handled_at end,
        snoozed_until = case when p_state = 'snoozed' then p_snoozed_until else notification.snoozed_until end
    where notification.id = any(p_notification_ids)
      and notification.user_id = p_user_id;
  else
    update public.growth_notifications notification
    set read_at = case when p_state = 'read' then now() when p_state = 'unread' then null else notification.read_at end,
        handled_at = case when p_state = 'handled' then now() when p_state = 'unhandled' then null else notification.handled_at end,
        snoozed_until = case when p_state = 'snoozed' then p_snoozed_until else notification.snoozed_until end
    where notification.id = any(p_notification_ids)
      and notification.user_id = p_user_id;
  end if;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.save_growth_plan_closeout(
  p_plan_id uuid,
  p_mode text,
  p_target_start_date date,
  p_target_end_date date,
  p_expected_revision integer,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.growth_development_plans%rowtype;
  v_new_plan public.growth_development_plans%rowtype;
  v_goal public.growth_goals%rowtype;
  v_version public.growth_goal_versions%rowtype;
  v_new_goal public.growth_goals%rowtype;
  v_checkpoint public.growth_goal_checkpoints%rowtype;
  v_goal_count integer := 0;
begin
  if p_mode not in ('close', 'carry_forward') then
    raise exception 'Select close or carry forward.';
  end if;
  if not exists (select 1 from public.user_profiles profile where profile.id = p_actor_id and profile.active) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_source from public.growth_development_plans plan
  where plan.id = p_plan_id and plan.archived_at is null for update;
  if not found or v_source.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The development plan changed after it was opened.';
  end if;

  if p_mode = 'close' then
    if p_actor_id <> v_source.employee_id then
      raise exception 'Only the employee may close their development plan.';
    end if;
    if v_source.closeout_status <> 'Open' then
      raise exception 'This development plan has already been closed or carried forward.';
    end if;
    if exists (
      select 1 from public.growth_goals goal
      where goal.plan_id = v_source.id
        and goal.status not in ('Completed', 'Not Achieved')
    ) then
      raise exception 'Complete, mark not achieved, or cancel every goal before closing the plan.';
    end if;
    update public.growth_development_plans
    set closeout_status = 'Closed', closed_at = now(),
        revision = revision + 1, updated_by = p_actor_id, updated_at = now()
    where id = v_source.id
    returning * into v_source;
    insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
    values ('plan', v_source.id, 'plan_closed', p_actor_id, v_source.employee_id,
      'Development plan closed.', jsonb_build_object('closeoutStatus', v_source.closeout_status));
    return jsonb_build_object('plan', to_jsonb(v_source));
  end if;

  if p_target_start_date is null or p_target_end_date is null or p_target_end_date <= p_target_start_date then
    raise exception 'A valid carry-forward period is required.';
  end if;
  if p_actor_id <> v_source.employee_id then
    raise exception 'Only the employee may carry forward their development plan.';
  end if;
  if v_source.closeout_status <> 'Open' or v_source.carried_forward_plan_id is not null then
    raise exception 'This development plan has already been closed or carried forward.';
  end if;
  insert into public.growth_development_plans (
    employee_id, title, description, period_type, start_date, end_date, created_by, updated_by
  ) values (
    v_source.employee_id, v_source.title, v_source.description, 'custom',
    p_target_start_date, p_target_end_date, p_actor_id, p_actor_id
  ) returning * into v_new_plan;
  for v_goal in
    select goal.* from public.growth_goals goal
    where goal.plan_id = v_source.id and goal.status not in ('Completed', 'Not Achieved')
    order by goal.created_at
  loop
    select * into v_version from public.growth_goal_versions version
    where version.goal_id = v_goal.id and version.version = v_goal.active_version;
    insert into public.growth_goals (
      plan_id, employee_id, status, title, description, active_version, progress,
      primary_manager_id, created_by, updated_by
    ) values (
      v_new_plan.id, v_goal.employee_id, 'Draft', v_goal.title, v_goal.description,
      1, 0, v_goal.primary_manager_id, p_actor_id, p_actor_id
    ) returning * into v_new_goal;
    insert into public.growth_goal_versions (
      goal_id, version, title, description, measurement_type, measurement, deadline, created_by
    ) values (
      v_new_goal.id, 1, v_version.title, v_version.description, v_version.measurement_type,
      v_version.measurement,
      least(p_target_end_date, p_target_start_date + greatest(v_version.deadline - v_source.start_date, 0)),
      p_actor_id
    );
    for v_checkpoint in
      select * from public.growth_goal_checkpoints checkpoint
      where checkpoint.goal_id = v_goal.id and checkpoint.goal_version = v_goal.active_version
      order by checkpoint.due_date, checkpoint.created_at
    loop
      insert into public.growth_goal_checkpoints (
        goal_id, goal_version, due_date, expected_result, created_by, updated_by
      ) values (
        v_new_goal.id, 1,
        least(
          p_target_end_date - 1,
          p_target_start_date + greatest(v_checkpoint.due_date - v_source.start_date, 0)
        ),
        v_checkpoint.expected_result, p_actor_id, p_actor_id
      );
    end loop;
    v_goal_count := v_goal_count + 1;
  end loop;
  update public.growth_development_plans
  set closeout_status = 'Carried Forward', carried_forward_plan_id = v_new_plan.id,
      revision = revision + 1, updated_by = p_actor_id, updated_at = now()
  where id = v_source.id
  returning * into v_source;
  insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
  values ('plan', v_source.id, 'plan_carried_forward', p_actor_id, v_source.employee_id,
    'Development plan carried forward.',
    jsonb_build_object('newPlanId', v_new_plan.id, 'carriedGoalCount', v_goal_count));
  return jsonb_build_object('sourcePlan', to_jsonb(v_source), 'newPlan', to_jsonb(v_new_plan), 'carriedGoalCount', v_goal_count);
end;
$$;

create or replace function public.save_growth_goal_evidence_link(
  p_goal_id uuid,
  p_item_id uuid,
  p_remove boolean,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal public.growth_goals%rowtype;
  v_removed integer := 0;
begin
  if p_remove then
    select * into v_goal from public.growth_goals goal
    where goal.id = p_goal_id and goal.employee_id = p_actor_id;
    if not found or not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
      raise exception 'Only the employee may manage private goal evidence.';
    end if;
    delete from public.growth_goal_collaboration_evidence link
    where link.goal_id = p_goal_id and link.item_id = p_item_id;
    get diagnostics v_removed = row_count;
    return jsonb_build_object('removed', v_removed = 1);
  end if;
  select * into v_goal from public.growth_goals goal
  where goal.id = p_goal_id and goal.employee_id = p_actor_id;
  if not found or not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'Only the employee may manage private goal evidence.';
  end if;
  if not exists (
    select 1 from public.collaboration_items item
    where item.id = p_item_id and item.archived_at is null and item.status = 'Done'
  ) then
    raise exception 'Only completed Projects & Tasks work may be linked as goal evidence.';
  end if;
  insert into public.growth_goal_collaboration_evidence (goal_id, item_id, linked_by)
  values (p_goal_id, p_item_id, p_actor_id)
  on conflict (goal_id, item_id) do update
    set linked_by = excluded.linked_by, linked_at = now();
  insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
  values ('goal', p_goal_id, 'goal_evidence_linked', p_actor_id, v_goal.employee_id,
    'Goal evidence linked to Projects & Tasks.', jsonb_build_object('collaborationItemId', p_item_id));
  return jsonb_build_object('linked', true, 'goalId', p_goal_id, 'itemId', p_item_id);
end;
$$;

create or replace function public.respond_growth_coaching_action_proposal(
  p_action_id uuid,
  p_response text,
  p_expected_revision integer,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action public.growth_coaching_actions%rowtype;
  v_session public.growth_coaching_sessions%rowtype;
  v_relationship public.growth_coaching_relationships%rowtype;
begin
  if p_response not in ('accept', 'decline') then
    raise exception 'Select accept or decline.';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_actor_id and active) then
    raise exception 'An active FCOS user is required.';
  end if;
  select * into v_action from public.growth_coaching_actions action
  where action.id = p_action_id for update;
  if not found or v_action.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The coaching action changed after it was opened.';
  end if;
  if v_action.proposal_status <> 'pending' or v_action.proposed_for <> p_actor_id then
    raise exception 'Only the invited participant may respond to this action proposal.';
  end if;
  select * into v_session from public.growth_coaching_sessions session where session.id = v_action.session_id;
  select * into v_relationship from public.growth_coaching_relationships relationship where relationship.id = v_session.relationship_id;
  if v_relationship.status <> 'Active'
     or p_actor_id not in (v_relationship.participant_one_id, v_relationship.participant_two_id)
     or v_action.proposed_by not in (v_relationship.participant_one_id, v_relationship.participant_two_id) then
    raise exception 'The coaching relationship is unavailable.';
  end if;
  update public.growth_coaching_actions
  set owner_id = case when p_response = 'accept' then p_actor_id else owner_id end,
      status = case when p_response = 'decline' then 'Cancelled' else status end,
      proposal_status = case when p_response = 'accept' then 'accepted' else 'declined' end,
      proposal_note = '', proposal_responded_at = now(), proposal_responded_by = p_actor_id,
      revision = revision + 1, updated_by = p_actor_id, updated_at = now()
  where id = v_action.id returning * into v_action;
  insert into public.growth_events (subject_type, subject_id, event_type, actor_id, target_user_id, summary, metadata)
  values ('coaching_action', v_action.id,
    case when p_response = 'accept' then 'coaching_action_proposal_accepted' else 'coaching_action_proposal_declined' end,
    p_actor_id, v_action.proposed_by, 'Coaching action proposal response recorded.',
    jsonb_build_object('proposalStatus', v_action.proposal_status));
  return jsonb_build_object('action', to_jsonb(v_action));
end;
$$;

-- Keep the existing item APIs and their behavioral contract, while validating
-- the new blocked and project-health properties in the same transaction.
alter function public.create_collaboration_item(jsonb, uuid, text)
  rename to create_collaboration_item_core;
alter function public.save_collaboration_item(uuid, jsonb, uuid, text, bigint)
  rename to save_collaboration_item_core;
alter function public.create_collaboration_item_core(jsonb, uuid, text) set search_path = '';
alter function public.save_collaboration_item_core(uuid, jsonb, uuid, text, bigint) set search_path = '';

create or replace function public.create_collaboration_item(
  p_values jsonb,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_item_type text := lower(coalesce(nullif(v_values->>'item_type', ''), 'task'));
  v_status text := coalesce(nullif(v_values->>'status', ''), 'To Do');
  v_blocked_reason text := btrim(coalesce(v_values->>'blocked_reason', ''));
  v_health_status text := nullif(v_values->>'health_status', '');
  v_health_note text := coalesce(v_values->>'health_note', '');
  v_result jsonb;
  v_item public.collaboration_items%rowtype;
begin
  if v_status = 'Blocked' and v_blocked_reason = '' then
    raise exception 'A blocked reason is required when status is Blocked.';
  end if;
  if char_length(v_blocked_reason) > 2000 or char_length(v_health_note) > 2000 then
    raise exception 'Blocked reason and health note must be 2,000 characters or fewer.';
  end if;
  if v_item_type <> 'project' and (v_health_status is not null or btrim(v_health_note) <> '') then
    raise exception 'Project health is available only for projects.';
  end if;
  if v_health_status is not null and v_health_status not in ('On track', 'At risk', 'Blocked') then
    raise exception 'Select a valid project health status.';
  end if;
  v_values := jsonb_set(v_values, '{blocked_reason}', to_jsonb(case when v_status = 'Blocked' then v_blocked_reason else '' end));
  v_result := public.create_collaboration_item_core(v_values, p_actor_user_id, p_actor_email);
  select * into v_item from public.collaboration_items item where item.id = (v_result->'item'->>'id')::uuid for update;
  update public.collaboration_items
  set blocked_reason = case when v_status = 'Blocked' then v_blocked_reason else '' end,
      health_status = case when v_item.item_type = 'project' then v_health_status else null end,
      health_note = case when v_item.item_type = 'project' then left(v_health_note, 2000) else '' end
  where id = v_item.id
  returning * into v_item;
  return jsonb_set(v_result, '{item}', to_jsonb(v_item));
end;
$$;

create or replace function public.save_collaboration_item(
  p_item_id uuid,
  p_values jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.collaboration_items%rowtype;
  v_result jsonb;
  v_item public.collaboration_items%rowtype;
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_status text;
  v_blocked_reason text;
  v_health_status text;
  v_health_note text;
  v_is_gm boolean;
begin
  if not exists (
    select 1 from public.user_profiles profile
    where profile.id = p_actor_user_id
      and profile.active = true
      and lower(profile.email) = lower(btrim(p_actor_email))
  ) then
    raise exception 'The authenticated user does not match the requested actor.';
  end if;
  select * into v_current from public.collaboration_items item where item.id = p_item_id;
  if not found then raise exception 'The selected work item was not found.'; end if;
  v_status := case when v_values ? 'status' then v_values->>'status' else v_current.status end;
  v_blocked_reason := btrim(case when v_values ? 'blocked_reason' then coalesce(v_values->>'blocked_reason', '') else v_current.blocked_reason end);
  if v_status = 'Blocked' and v_blocked_reason = '' then
    raise exception 'A blocked reason is required when status is Blocked.';
  end if;
  if char_length(v_blocked_reason) > 2000 then raise exception 'Blocked reason must be 2,000 characters or fewer.'; end if;
  v_is_gm := public.collaboration_is_general_manager(p_actor_user_id);
  if (v_values ? 'health_status' or v_values ? 'health_note') then
    if v_current.item_type <> 'project' then
      raise exception 'Project health is available only for projects.';
    end if;
    if not (v_current.owner_user_id = p_actor_user_id or v_is_gm) then
      raise exception 'Only the project owner or General Manager can update project health.';
    end if;
  end if;
  v_health_status := case when v_values ? 'health_status' then nullif(v_values->>'health_status', '') else v_current.health_status end;
  v_health_note := case when v_values ? 'health_note' then coalesce(v_values->>'health_note', '') else v_current.health_note end;
  if v_health_status is not null and v_health_status not in ('On track', 'At risk', 'Blocked') then
    raise exception 'Select a valid project health status.';
  end if;
  if char_length(v_health_note) > 2000 then raise exception 'Project health note must be 2,000 characters or fewer.'; end if;
  v_values := jsonb_set(v_values, '{blocked_reason}', to_jsonb(case when v_status = 'Blocked' then v_blocked_reason else '' end));
  v_result := public.save_collaboration_item_core(p_item_id, v_values, p_actor_user_id, p_actor_email, p_expected_revision);
  select * into v_item from public.collaboration_items item where item.id = p_item_id for update;
  update public.collaboration_items
  set blocked_reason = case when v_status = 'Blocked' then v_blocked_reason else '' end,
      health_status = case when v_item.item_type = 'project' then v_health_status else null end,
      health_note = case when v_item.item_type = 'project' then left(v_health_note, 2000) else '' end
  where id = v_item.id
  returning * into v_item;
  return jsonb_set(v_result, '{item}', to_jsonb(v_item));
end;
$$;

revoke all on function public.collaboration_actor_can_manage(public.collaboration_items, uuid) from public, anon, authenticated;
revoke all on function public.save_collaboration_follower_core(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.save_collaboration_dependency_core(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.save_collaboration_milestone_core(uuid, jsonb, uuid, bigint) from public, anon, authenticated;
revoke all on function public.save_collaboration_template_core(uuid, jsonb, jsonb, uuid, bigint) from public, anon, authenticated;
revoke all on function public.use_collaboration_template_core(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.create_collaboration_item_core(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.save_collaboration_item_core(uuid, jsonb, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.save_collaboration_follower(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.save_collaboration_dependency(uuid, uuid, boolean, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.save_collaboration_milestone(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.save_collaboration_template(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.set_work_notification_state(text, uuid[], uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.save_growth_plan_closeout(uuid, text, date, date, integer, uuid) from public, anon, authenticated;
revoke all on function public.save_growth_goal_evidence_link(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.respond_growth_coaching_action_proposal(uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.create_collaboration_item(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.save_collaboration_item(uuid, jsonb, uuid, text, bigint) from public, anon, authenticated;

grant execute on function public.collaboration_actor_can_manage(public.collaboration_items, uuid) to service_role;
grant execute on function public.save_collaboration_follower_core(uuid, boolean, uuid) to service_role;
grant execute on function public.save_collaboration_dependency_core(uuid, uuid, text, uuid) to service_role;
grant execute on function public.save_collaboration_milestone_core(uuid, jsonb, uuid, bigint) to service_role;
grant execute on function public.save_collaboration_template_core(uuid, jsonb, jsonb, uuid, bigint) to service_role;
grant execute on function public.use_collaboration_template_core(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.create_collaboration_item_core(jsonb, uuid, text) to service_role;
grant execute on function public.save_collaboration_item_core(uuid, jsonb, uuid, text, bigint) to service_role;
grant execute on function public.save_collaboration_follower(uuid, boolean, uuid, text) to service_role;
grant execute on function public.save_collaboration_dependency(uuid, uuid, boolean, uuid, text, bigint) to service_role;
grant execute on function public.save_collaboration_milestone(jsonb, uuid, text) to service_role;
grant execute on function public.save_collaboration_template(jsonb, uuid, text) to service_role;
grant execute on function public.set_work_notification_state(text, uuid[], uuid, text, timestamptz) to service_role;
grant execute on function public.save_growth_plan_closeout(uuid, text, date, date, integer, uuid) to service_role;
grant execute on function public.save_growth_goal_evidence_link(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.respond_growth_coaching_action_proposal(uuid, text, integer, uuid) to service_role;
grant execute on function public.create_collaboration_item(jsonb, uuid, text) to service_role;
grant execute on function public.save_collaboration_item(uuid, jsonb, uuid, text, bigint) to service_role;
