-- Growth & Coaching: formal development goals plus pair-private coaching.

create extension if not exists pgcrypto;

create table public.growth_reporting_assignments (
  employee_id uuid primary key references public.user_profiles(id) on delete restrict,
  primary_manager_id uuid null references public.user_profiles(id) on delete restrict,
  secondary_manager_id uuid null references public.user_profiles(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (employee_id is distinct from primary_manager_id),
  check (employee_id is distinct from secondary_manager_id),
  check (primary_manager_id is distinct from secondary_manager_id)
);

create table public.growth_development_plans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.user_profiles(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 255),
  description text not null default '',
  period_type text not null check (period_type in ('annual', 'half_yearly', 'custom')),
  start_date date not null,
  end_date date not null,
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.growth_goals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.growth_development_plans(id) on delete cascade,
  employee_id uuid not null references public.user_profiles(id) on delete restrict,
  status text not null default 'Draft' check (status in (
    'Draft', 'Pending Approval', 'Revision Requested', 'Active',
    'Completion Review', 'Completed', 'Not Achieved', 'Cancellation Requested'
  )),
  title text not null check (length(btrim(title)) between 1 and 255),
  description text not null default '',
  active_version integer not null default 1 check (active_version > 0),
  approved_version integer null check (approved_version is null or approved_version > 0),
  progress numeric(6,2) not null default 0 check (progress between 0 and 100),
  primary_manager_id uuid null references public.user_profiles(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  completion_evidence text not null default '',
  completion_note text not null default '',
  completed_at timestamptz null,
  completed_by uuid null references public.user_profiles(id) on delete restrict,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, employee_id)
);

create table public.growth_goal_versions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.growth_goals(id) on delete cascade,
  version integer not null check (version > 0),
  title text not null check (length(btrim(title)) between 1 and 255),
  description text not null default '',
  measurement_type text not null check (measurement_type in ('numeric', 'milestones', 'outcome_rubric')),
  measurement jsonb not null default '{}'::jsonb,
  deadline date not null,
  submitted_at timestamptz null,
  approved_at timestamptz null,
  approved_by uuid null references public.user_profiles(id) on delete restrict,
  superseded_at timestamptz null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (goal_id, version)
);

create table public.growth_goal_checkpoints (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.growth_goals(id) on delete cascade,
  goal_version integer not null,
  due_date date not null,
  expected_result text not null check (length(btrim(expected_result)) > 0),
  actual_result text not null default '',
  evidence text not null default '',
  tracking_state text null check (tracking_state in ('On Track', 'At Risk', 'Off Track')),
  completed_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (goal_id, goal_version)
    references public.growth_goal_versions(goal_id, version) on delete cascade
);

create table public.growth_goal_updates (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.growth_goals(id) on delete cascade,
  checkpoint_id uuid null references public.growth_goal_checkpoints(id) on delete set null,
  current_value numeric null,
  actual_result text not null default '',
  evidence text not null default '',
  tracking_state text null check (tracking_state in ('On Track', 'At Risk', 'Off Track')),
  comment text not null default '',
  submitted_by uuid not null references public.user_profiles(id) on delete restrict,
  submitted_at timestamptz not null default now()
);

create table public.growth_goal_decisions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.growth_goals(id) on delete cascade,
  goal_version integer null,
  decision_type text not null check (decision_type in (
    'approved', 'revision_requested', 'completion_requested', 'completed',
    'not_achieved', 'cancellation_requested', 'cancelled'
  )),
  note text not null default '',
  actor_id uuid not null references public.user_profiles(id) on delete restrict,
  actor_name text not null,
  created_at timestamptz not null default now()
);

create table public.growth_coaching_relationships (
  id uuid primary key default gen_random_uuid(),
  participant_one_id uuid not null references public.user_profiles(id) on delete restrict,
  participant_two_id uuid not null references public.user_profiles(id) on delete restrict,
  inviter_id uuid not null references public.user_profiles(id) on delete restrict,
  status text not null default 'Pending' check (status in ('Pending', 'Active', 'Declined', 'Ended', 'Cancelled')),
  cadence text not null default 'fortnightly' check (cadence in ('weekly', 'fortnightly', 'monthly', 'custom')),
  custom_cadence_days integer null check (custom_cadence_days is null or custom_cadence_days between 1 and 365),
  calendar_owner_id uuid not null references public.user_profiles(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  responded_at timestamptz null,
  ended_at timestamptz null,
  ended_by uuid null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (participant_one_id < participant_two_id),
  check (inviter_id in (participant_one_id, participant_two_id)),
  check (calendar_owner_id in (participant_one_id, participant_two_id))
);

create unique index growth_coaching_active_pair_uidx
on public.growth_coaching_relationships(participant_one_id, participant_two_id)
where status in ('Pending', 'Active');

create table public.growth_coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.growth_coaching_relationships(id) on delete cascade,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 240),
  status text not null default 'Scheduled' check (status in ('Scheduled', 'Awaiting Confirmation', 'Confirmed', 'Cancelled')),
  shared_notes text not null default '',
  decisions text not null default '',
  locked_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.growth_coaching_agenda_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.growth_coaching_sessions(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id) on delete restrict,
  item_order integer not null default 0,
  topic text not null check (length(btrim(topic)) between 1 and 2000),
  prompt_type text not null default 'free',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.growth_coaching_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.growth_coaching_sessions(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id) on delete restrict,
  note_type text not null check (note_type in ('private_preparation', 'addendum')),
  body text not null default '',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index growth_private_preparation_uidx
on public.growth_coaching_notes(session_id, author_id)
where note_type = 'private_preparation';

create table public.growth_coaching_confirmations (
  session_id uuid not null references public.growth_coaching_sessions(id) on delete cascade,
  participant_id uuid not null references public.user_profiles(id) on delete restrict,
  shared_revision integer not null check (shared_revision > 0),
  confirmed_at timestamptz not null default now(),
  primary key (session_id, participant_id)
);

create table public.growth_coaching_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.growth_coaching_sessions(id) on delete cascade,
  owner_id uuid not null references public.user_profiles(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 255),
  due_date date not null,
  status text not null default 'To Do' check (status in ('To Do', 'In Progress', 'Blocked', 'Done', 'Cancelled')),
  published_item_id uuid null references public.collaboration_items(id) on delete set null,
  published_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.growth_attachments (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid null references public.growth_goals(id) on delete cascade,
  session_id uuid null references public.growth_coaching_sessions(id) on delete cascade,
  uploaded_by uuid not null references public.user_profiles(id) on delete restrict,
  display_filename text not null check (length(btrim(display_filename)) between 1 and 255),
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  storage_path text not null unique,
  content_type text not null,
  content_size bigint not null check (content_size > 0 and content_size <= 20971520),
  upload_status text not null default 'pending' check (upload_status in ('pending', 'complete', 'failed', 'deleted')),
  upload_expires_at timestamptz null,
  completed_at timestamptz null,
  deleted_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  check (num_nonnulls(goal_id, session_id) = 1)
);

create table public.growth_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid null,
  event_type text not null,
  actor_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  target_user_id uuid null references public.user_profiles(id) on delete set null,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.growth_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  source_type text not null,
  source_id uuid null,
  event_id uuid null references public.growth_events(id) on delete set null,
  notification_type text not null,
  title text not null check (length(btrim(title)) between 1 and 255),
  message text not null default '',
  link text not null default '/growth-coaching',
  dedupe_key text not null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.growth_email_preferences (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  invitations boolean not null default true,
  goal_decisions boolean not null default true,
  completion_requests boolean not null default true,
  session_confirmations boolean not null default true,
  routine_digest boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table public.growth_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  event_id uuid null references public.growth_events(id) on delete set null,
  delivery_type text not null,
  dedupe_key text not null unique,
  status text not null default 'reserved' check (status in ('reserved', 'sent', 'failed', 'uncertain', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.growth_calendar_sync (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.growth_coaching_relationships(id) on delete cascade,
  session_id uuid not null unique references public.growth_coaching_sessions(id) on delete cascade,
  organizer_user_id uuid not null references public.user_profiles(id) on delete restrict,
  organizer_email text not null,
  outlook_event_id text null,
  outlook_etag text null,
  transaction_id text not null unique,
  status text not null default 'Pending' check (status in ('Pending', 'Synced', 'Conflict', 'Failed', 'Unavailable')),
  fcos_schedule jsonb not null default '{}'::jsonb,
  outlook_schedule jsonb not null default '{}'::jsonb,
  last_error_code text null,
  last_attempt_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index growth_plans_employee_idx on public.growth_development_plans(employee_id, archived_at, updated_at desc);
create index growth_goals_employee_idx on public.growth_goals(employee_id, status, updated_at desc);
create index growth_goals_manager_idx on public.growth_goals(primary_manager_id, status, updated_at desc);
create index growth_checkpoints_due_idx on public.growth_goal_checkpoints(due_date, completed_at);
create index growth_relationship_participant_one_idx on public.growth_coaching_relationships(participant_one_id, status);
create index growth_relationship_participant_two_idx on public.growth_coaching_relationships(participant_two_id, status);
create index growth_sessions_relationship_idx on public.growth_coaching_sessions(relationship_id, scheduled_at desc);
create index growth_actions_owner_due_idx on public.growth_coaching_actions(owner_id, status, due_date);
create index growth_attachments_pending_idx on public.growth_attachments(upload_status, upload_expires_at);
create unique index growth_attachments_active_name_uidx
on public.growth_attachments(coalesce(goal_id, session_id), lower(display_filename))
where upload_status in ('pending', 'complete');
create index growth_events_created_idx on public.growth_events(created_at desc);
create index growth_notifications_user_idx on public.growth_notifications(user_id, read_at, created_at desc);
create index growth_calendar_status_idx on public.growth_calendar_sync(status, updated_at);

create or replace function public.growth_reporting_chain_has_cycle(
  p_employee_id uuid,
  p_primary_manager_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with recursive management_chain(employee_id, primary_manager_id, depth) as (
    select p_employee_id, p_primary_manager_id, 1
    union all
    select assignment.employee_id, assignment.primary_manager_id, chain.depth + 1
    from management_chain chain
    join public.growth_reporting_assignments assignment
      on assignment.employee_id = chain.primary_manager_id
    where chain.primary_manager_id is not null
      and chain.depth < 100
  )
  select exists (
    select 1
    from management_chain
    where primary_manager_id = p_employee_id
  );
$$;

create or replace function public.save_growth_reporting_assignment(
  p_employee_id uuid,
  p_primary_manager_id uuid,
  p_secondary_manager_id uuid,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns public.growth_reporting_assignments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.growth_reporting_assignments%rowtype;
  v_saved public.growth_reporting_assignments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('growth_reporting_hierarchy'));

  if p_employee_id is null or p_actor_id is null then
    raise exception 'Employee and actor are required.';
  end if;
  if p_employee_id in (p_primary_manager_id, p_secondary_manager_id) then
    raise exception 'A user cannot manage themselves.';
  end if;
  if p_primary_manager_id is not distinct from p_secondary_manager_id
     and p_primary_manager_id is not null then
    raise exception 'Primary and secondary managers must be different.';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_employee_id and active) then
    raise exception 'The employee must be an active FCOS user.';
  end if;
  if p_primary_manager_id is not null and not exists (
    select 1 from public.user_profiles where id = p_primary_manager_id and active
  ) then
    raise exception 'The primary manager must be an active FCOS user.';
  end if;
  if p_secondary_manager_id is not null and not exists (
    select 1 from public.user_profiles where id = p_secondary_manager_id and active
  ) then
    raise exception 'The secondary manager must be an active FCOS user.';
  end if;
  if public.growth_reporting_chain_has_cycle(p_employee_id, p_primary_manager_id) then
    raise exception 'This primary manager would create a reporting cycle.';
  end if;

  select * into v_current
  from public.growth_reporting_assignments
  where employee_id = p_employee_id
  for update;

  if found and v_current.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The reporting line changed after it was opened.';
  end if;
  if not found and coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'The reporting line changed after it was opened.';
  end if;

  insert into public.growth_reporting_assignments (
    employee_id, primary_manager_id, secondary_manager_id, revision,
    updated_by, updated_by_email
  ) values (
    p_employee_id, p_primary_manager_id, p_secondary_manager_id, 1,
    p_actor_id, lower(btrim(p_actor_email))
  )
  on conflict (employee_id) do update set
    primary_manager_id = excluded.primary_manager_id,
    secondary_manager_id = excluded.secondary_manager_id,
    revision = public.growth_reporting_assignments.revision + 1,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = now()
  returning * into v_saved;

  update public.growth_goals
  set primary_manager_id = p_primary_manager_id,
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where employee_id = p_employee_id
    and status in (
      'Draft', 'Pending Approval', 'Revision Requested', 'Active',
      'Completion Review', 'Cancellation Requested'
    )
    and primary_manager_id is distinct from p_primary_manager_id;

  insert into public.growth_events (
    subject_type, subject_id, event_type, actor_id, actor_email,
    target_user_id, summary, metadata
  ) values (
    'reporting_assignment', p_employee_id, 'reporting_line_saved',
    p_actor_id, lower(btrim(p_actor_email)), p_employee_id,
    'Reporting line updated.',
    jsonb_build_object(
      'hasPrimaryManager', p_primary_manager_id is not null,
      'hasSecondaryManager', p_secondary_manager_id is not null,
      'revision', v_saved.revision
    )
  );
  return v_saved;
end;
$$;

create or replace function public.publish_growth_coaching_action(
  p_action_id uuid,
  p_expected_revision integer,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action public.growth_coaching_actions%rowtype;
  v_session public.growth_coaching_sessions%rowtype;
  v_relationship public.growth_coaching_relationships%rowtype;
  v_owner public.user_profiles%rowtype;
  v_created jsonb;
  v_item_id uuid;
begin
  select * into v_action
  from public.growth_coaching_actions
  where id = p_action_id
  for update;
  if not found then raise exception 'The coaching action was not found.'; end if;
  if v_action.revision <> p_expected_revision then
    raise exception 'The coaching action changed after it was opened.';
  end if;
  if v_action.owner_id <> p_actor_id then
    raise exception 'Only the action owner may publish it.';
  end if;
  if v_action.published_item_id is not null then
    return jsonb_build_object('action', to_jsonb(v_action), 'itemId', v_action.published_item_id);
  end if;
  select * into v_session from public.growth_coaching_sessions where id = v_action.session_id;
  select * into v_relationship from public.growth_coaching_relationships where id = v_session.relationship_id;
  if p_actor_id not in (v_relationship.participant_one_id, v_relationship.participant_two_id) then
    raise exception 'Only a coaching participant may publish this action.';
  end if;
  select * into v_owner from public.user_profiles where id = v_action.owner_id and active;
  if not found then raise exception 'The action owner must be an active FCOS user.'; end if;

  v_created := public.create_collaboration_item(
    jsonb_build_object(
      'item_type', 'task',
      'title', v_action.title,
      'description', '',
      'status', 'To Do',
      'priority', 'Medium',
      'due_date', v_action.due_date,
      'assignee_user_id', v_owner.id
    ),
    p_actor_id,
    lower(btrim(p_actor_email))
  );
  v_item_id := (v_created->'item'->>'id')::uuid;

  update public.growth_coaching_actions
  set published_item_id = v_item_id,
      published_at = now(),
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where id = v_action.id
  returning * into v_action;

  insert into public.growth_events (
    subject_type, subject_id, event_type, actor_id, actor_email,
    summary, metadata
  ) values (
    'coaching_action', v_action.id, 'action_published',
    p_actor_id, lower(btrim(p_actor_email)),
    'Coaching action published to Projects & Tasks.',
    jsonb_build_object('collaborationItemId', v_item_id, 'privateContentCopied', false)
  );
  return jsonb_build_object('action', to_jsonb(v_action), 'itemId', v_item_id);
end;
$$;

create or replace function public.save_growth_goal_draft(
  p_values jsonb,
  p_checkpoints jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan public.growth_development_plans%rowtype;
  v_goal public.growth_goals%rowtype;
  v_version integer;
  v_version_row public.growth_goal_versions%rowtype;
  v_goal_id uuid := nullif(p_values->>'id', '')::uuid;
  v_expected_revision integer := coalesce(nullif(p_values->>'expectedRevision', '')::integer, 0);
  v_title text := btrim(coalesce(p_values->>'title', ''));
  v_description text := coalesce(p_values->>'description', '');
  v_deadline date := nullif(p_values->>'deadline', '')::date;
  v_measurement jsonb := coalesce(p_values->'measurement', '{}'::jsonb);
  v_measurement_type text := coalesce(v_measurement->>'type', '');
begin
  select * into v_plan
  from public.growth_development_plans
  where id = nullif(p_values->>'planId', '')::uuid
    and archived_at is null;
  if not found then raise exception 'The development plan is unavailable.'; end if;
  if v_plan.employee_id <> p_actor_id then
    raise exception 'Only the employee may author their development goal.';
  end if;
  if v_title = '' or char_length(v_title) > 255 then
    raise exception 'Goal title is required and must be 255 characters or fewer.';
  end if;
  if char_length(v_description) > 20000 then
    raise exception 'Goal description is too long.';
  end if;
  if v_deadline is null or v_deadline < v_plan.start_date or v_deadline > v_plan.end_date then
    raise exception 'Goal deadline must fall within the development plan.';
  end if;
  if v_measurement_type not in ('numeric', 'milestones', 'outcome_rubric') then
    raise exception 'Select a valid goal measurement.';
  end if;
  if jsonb_typeof(p_checkpoints) <> 'array' or jsonb_array_length(p_checkpoints) < 1 then
    raise exception 'At least one progress checkpoint is required.';
  end if;

  if v_goal_id is null then
    if v_expected_revision <> 0 then
      raise exception 'The goal changed after it was opened.';
    end if;
    insert into public.growth_goals (
      plan_id, employee_id, status, title, description, primary_manager_id,
      created_by, updated_by
    )
    select v_plan.id, v_plan.employee_id, 'Draft', v_title, v_description,
      assignment.primary_manager_id, p_actor_id, p_actor_id
    from (select 1) seed
    left join public.growth_reporting_assignments assignment
      on assignment.employee_id = v_plan.employee_id
    returning * into v_goal;
    v_version := 1;
  else
    select * into v_goal
    from public.growth_goals
    where id = v_goal_id
    for update;
    if not found or v_goal.employee_id <> p_actor_id then
      raise exception 'The goal is unavailable.';
    end if;
    if v_goal.revision <> v_expected_revision then
      raise exception 'The goal changed after it was opened.';
    end if;
    if v_goal.status in ('Completed', 'Not Achieved', 'Completion Review', 'Cancellation Requested') then
      raise exception 'This goal cannot be edited in its current state.';
    end if;
    if v_goal.approved_version = v_goal.active_version then
      v_version := v_goal.active_version + 1;
      update public.growth_goals set
        active_version = v_version,
        status = 'Revision Requested',
        title = v_title,
        description = v_description,
        progress = 0,
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
      where id = v_goal.id
      returning * into v_goal;
    else
      v_version := v_goal.active_version;
      update public.growth_goals set
        title = v_title,
        description = v_description,
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
      where id = v_goal.id
      returning * into v_goal;
      delete from public.growth_goal_checkpoints
      where goal_id = v_goal.id and goal_version = v_version;
      delete from public.growth_goal_versions
      where goal_id = v_goal.id and version = v_version;
    end if;
  end if;

  insert into public.growth_goal_versions (
    goal_id, version, title, description, measurement_type,
    measurement, deadline, created_by
  ) values (
    v_goal.id, v_version, v_title, v_description, v_measurement_type,
    v_measurement, v_deadline, p_actor_id
  )
  returning * into v_version_row;

  insert into public.growth_goal_checkpoints (
    id, goal_id, goal_version, due_date, expected_result,
    actual_result, evidence, tracking_state, created_by, updated_by
  )
  select
    coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()),
    v_goal.id,
    v_version,
    (item->>'dueDate')::date,
    btrim(item->>'expectedResult'),
    coalesce(item->>'actualResult', ''),
    coalesce(item->>'evidence', ''),
    nullif(item->>'state', ''),
    p_actor_id,
    p_actor_id
  from jsonb_array_elements(p_checkpoints) item;

  insert into public.growth_events (
    subject_type, subject_id, event_type, actor_id, target_user_id,
    summary, metadata
  ) values (
    'goal', v_goal.id, 'goal_draft_saved', p_actor_id, p_actor_id,
    'Development goal draft saved.',
    jsonb_build_object('status', v_goal.status, 'version', v_version, 'revision', v_goal.revision)
  );
  return jsonb_build_object('goal', to_jsonb(v_goal), 'version', to_jsonb(v_version_row));
end;
$$;

create or replace function public.create_growth_due_notifications(p_today date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
  v_added integer := 0;
begin
  insert into public.growth_notifications (
    user_id, source_type, source_id, notification_type,
    title, message, link, dedupe_key
  )
  select goal.employee_id, 'goal', goal.id, 'goal_due',
    'Development goal reminder',
    case
      when version.deadline < p_today then 'A development goal is overdue.'
      when version.deadline = p_today then 'A development goal is due today.'
      else 'A development goal deadline is approaching.'
    end,
    '/growth-coaching',
    concat('goal:', goal.id, ':', p_today)
  from public.growth_goals goal
  join public.growth_goal_versions version
    on version.goal_id = goal.id and version.version = goal.active_version
  where goal.status in ('Active', 'Completion Review')
    and (
      version.deadline in (p_today, p_today + 1, p_today + 7)
      or (version.deadline < p_today and mod(p_today - version.deadline, 7) = 0)
    )
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;

  insert into public.growth_notifications (
    user_id, source_type, source_id, notification_type,
    title, message, link, dedupe_key
  )
  select action.owner_id, 'coaching_action', action.id, 'coaching_action_due',
    'Coaching action reminder',
    case
      when action.due_date < p_today then 'A private coaching action is overdue.'
      when action.due_date = p_today then 'A private coaching action is due today.'
      else 'A private coaching action due date is approaching.'
    end,
    '/growth-coaching',
    concat('action:', action.id, ':', p_today)
  from public.growth_coaching_actions action
  where action.status not in ('Done', 'Cancelled')
    and (
      action.due_date in (p_today, p_today + 1, p_today + 7)
      or (action.due_date < p_today and mod(p_today - action.due_date, 7) = 0)
    )
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;
  return v_count;
end;
$$;

create or replace function public.cleanup_growth_pending_attachments()
returns setof text
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update public.growth_attachments
  set upload_status = 'failed',
      revision = revision + 1
  where upload_status = 'pending'
    and upload_expires_at < now()
  returning storage_path;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'growth_reporting_assignments',
    'growth_development_plans',
    'growth_goals',
    'growth_goal_versions',
    'growth_goal_checkpoints',
    'growth_goal_updates',
    'growth_goal_decisions',
    'growth_coaching_relationships',
    'growth_coaching_sessions',
    'growth_coaching_agenda_items',
    'growth_coaching_notes',
    'growth_coaching_confirmations',
    'growth_coaching_actions',
    'growth_attachments',
    'growth_events',
    'growth_notifications',
    'growth_email_preferences',
    'growth_email_deliveries',
    'growth_calendar_sync'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$$;

revoke all on function public.growth_reporting_chain_has_cycle(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_growth_reporting_assignment(uuid, uuid, uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.publish_growth_coaching_action(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.save_growth_goal_draft(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.create_growth_due_notifications(date) from public, anon, authenticated;
revoke all on function public.cleanup_growth_pending_attachments() from public, anon, authenticated;
grant execute on function public.growth_reporting_chain_has_cycle(uuid, uuid) to service_role;
grant execute on function public.save_growth_reporting_assignment(uuid, uuid, uuid, integer, uuid, text) to service_role;
grant execute on function public.publish_growth_coaching_action(uuid, integer, uuid, text) to service_role;
grant execute on function public.save_growth_goal_draft(jsonb, jsonb, uuid) to service_role;
grant execute on function public.create_growth_due_notifications(date) to service_role;
grant execute on function public.cleanup_growth_pending_attachments() to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('growth-coaching-files', 'growth-coaching-files', false, 20971520)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
