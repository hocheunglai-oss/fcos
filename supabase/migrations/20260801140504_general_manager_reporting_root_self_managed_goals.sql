-- Treat the one active General Manager as the reporting hierarchy root and
-- keep their formal development goals self-managed.

create or replace function public.growth_active_general_manager_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(role_row.user_id order by role_row.user_id)
  into v_ids
  from public.collaboration_roles role_row
  join public.user_profiles profile on profile.id = role_row.user_id
  where role_row.role = 'general_manager'
    and role_row.active
    and profile.active;

  if coalesce(cardinality(v_ids), 0) <> 1 then
    raise exception 'General Manager role validation failed. Exactly one active UUID-backed General Manager is required.';
  end if;

  return v_ids[1];
end;
$$;

alter table public.growth_goal_decisions
  drop constraint if exists growth_goal_decisions_decision_type_check;

alter table public.growth_goal_decisions
  add constraint growth_goal_decisions_decision_type_check
  check (decision_type in (
    'approved', 'revision_requested', 'completion_requested', 'completed',
    'not_achieved', 'cancellation_requested', 'cancelled',
    'self_activated', 'self_completed', 'self_not_achieved'
  ));

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
set search_path = ''
as $$
declare
  v_current public.growth_reporting_assignments%rowtype;
  v_saved public.growth_reporting_assignments%rowtype;
  v_general_manager_id uuid;
  v_event_revision integer;
begin
  perform pg_advisory_xact_lock(hashtext('growth_reporting_hierarchy'));
  v_general_manager_id := public.growth_active_general_manager_id();

  if p_employee_id is null or p_actor_id is null then
    raise exception 'Employee and actor are required.';
  end if;
  if p_employee_id = v_general_manager_id
     and (p_primary_manager_id is not null or p_secondary_manager_id is not null) then
    raise exception 'The active General Manager is the reporting root and cannot have a Primary or Advisory Manager.';
  end if;
  if p_employee_id in (p_primary_manager_id, p_secondary_manager_id) then
    raise exception 'A user cannot manage themselves.';
  end if;
  if p_primary_manager_id is not distinct from p_secondary_manager_id
     and p_primary_manager_id is not null then
    raise exception 'Primary and Advisory Managers must be different.';
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
    raise exception 'The Advisory Manager must be an active FCOS user.';
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

  if p_primary_manager_id is null and p_secondary_manager_id is null then
    delete from public.growth_reporting_assignments
    where employee_id = p_employee_id
    returning * into v_saved;
    v_event_revision := case when found then v_saved.revision + 1 else 0 end;
  else
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
    v_event_revision := v_saved.revision;
  end if;

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
      'isGeneralManager', p_employee_id = v_general_manager_id,
      'managerAssignmentRequired', p_employee_id <> v_general_manager_id,
      'revision', v_event_revision
    )
  );
  return v_saved;
end;
$$;

create or replace function public.save_growth_reporting_assignments_batch(
  p_changes jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_change record;
  v_employee_ids uuid[] := array[]::uuid[];
  v_current public.growth_reporting_assignments%rowtype;
  v_saved public.growth_reporting_assignments%rowtype;
  v_had_current boolean;
  v_event_revision integer;
  v_results jsonb := '[]'::jsonb;
  v_general_manager_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('growth_reporting_hierarchy'));
  v_general_manager_id := public.growth_active_general_manager_id();

  if p_actor_id is null then
    raise exception 'Actor is required.';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Reporting-line changes must be an array.';
  end if;
  if jsonb_array_length(p_changes) = 0 then
    raise exception 'At least one reporting-line change is required.';
  end if;
  if jsonb_array_length(p_changes) > 500 then
    raise exception 'No more than 500 reporting lines may be saved together.';
  end if;

  -- Validate and revision-lock every requested row before making any change.
  for v_change in
    select *
    from jsonb_to_recordset(p_changes) as change(
      employee_id uuid,
      primary_manager_id uuid,
      secondary_manager_id uuid,
      expected_revision integer
    )
  loop
    if v_change.employee_id is null then
      raise exception 'Every reporting-line change requires an employee.';
    end if;
    if v_change.employee_id = any(v_employee_ids) then
      raise exception 'Each employee may appear only once in a reporting-line save.';
    end if;
    if coalesce(v_change.expected_revision, -1) < 0 then
      raise exception 'Every reporting-line change requires a valid expected revision.';
    end if;
    if v_change.employee_id = v_general_manager_id
       and (v_change.primary_manager_id is not null or v_change.secondary_manager_id is not null) then
      raise exception 'The active General Manager is the reporting root and cannot have a Primary or Advisory Manager.';
    end if;
    if v_change.employee_id in (v_change.primary_manager_id, v_change.secondary_manager_id) then
      raise exception 'A user cannot manage themselves.';
    end if;
    if v_change.primary_manager_id is not null
       and v_change.primary_manager_id is not distinct from v_change.secondary_manager_id then
      raise exception 'Primary and Advisory Managers must be different.';
    end if;
    if not exists (
      select 1 from public.user_profiles
      where id = v_change.employee_id and active
    ) then
      raise exception 'The employee must be an active FCOS user.';
    end if;
    if v_change.primary_manager_id is not null and not exists (
      select 1 from public.user_profiles
      where id = v_change.primary_manager_id and active
    ) then
      raise exception 'The primary manager must be an active FCOS user.';
    end if;
    if v_change.secondary_manager_id is not null and not exists (
      select 1 from public.user_profiles
      where id = v_change.secondary_manager_id and active
    ) then
      raise exception 'The Advisory Manager must be an active FCOS user.';
    end if;

    select * into v_current
    from public.growth_reporting_assignments
    where employee_id = v_change.employee_id
    for update;
    v_had_current := found;
    if v_had_current and v_current.revision <> v_change.expected_revision then
      raise exception 'A reporting line changed after it was opened.';
    end if;
    if not v_had_current and v_change.expected_revision <> 0 then
      raise exception 'A reporting line changed after it was opened.';
    end if;

    v_employee_ids := array_append(v_employee_ids, v_change.employee_id);
  end loop;

  if exists (
    with recursive requested as (
      select *
      from jsonb_to_recordset(p_changes) as change(
        employee_id uuid,
        primary_manager_id uuid,
        secondary_manager_id uuid,
        expected_revision integer
      )
    ), effective as (
      select
        profile.id as employee_id,
        case
          when requested.employee_id is not null then requested.primary_manager_id
          else assignment.primary_manager_id
        end as primary_manager_id
      from public.user_profiles profile
      left join public.growth_reporting_assignments assignment
        on assignment.employee_id = profile.id
      left join requested
        on requested.employee_id = profile.id
      where profile.active
    ), reporting_walk(origin_id, current_id, path, has_cycle) as (
      select
        effective.employee_id,
        effective.primary_manager_id,
        array[effective.employee_id]::uuid[],
        false
      from effective
      where effective.primary_manager_id is not null

      union all

      select
        reporting_walk.origin_id,
        effective.primary_manager_id,
        reporting_walk.path || reporting_walk.current_id,
        reporting_walk.current_id = any(reporting_walk.path)
      from reporting_walk
      join effective on effective.employee_id = reporting_walk.current_id
      where reporting_walk.current_id is not null
        and not reporting_walk.has_cycle
    )
    select 1 from reporting_walk where has_cycle limit 1
  ) then
    raise exception 'The reporting-line changes would create a primary reporting cycle.';
  end if;

  for v_change in
    select *
    from jsonb_to_recordset(p_changes) as change(
      employee_id uuid,
      primary_manager_id uuid,
      secondary_manager_id uuid,
      expected_revision integer
    )
  loop
    if v_change.primary_manager_id is null and v_change.secondary_manager_id is null then
      delete from public.growth_reporting_assignments
      where employee_id = v_change.employee_id
      returning * into v_saved;

      if not found then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'employee_id', v_change.employee_id,
          'primary_manager_id', null,
          'secondary_manager_id', null,
          'revision', 0,
          'deleted', false
        ));
        continue;
      end if;
      v_event_revision := v_saved.revision + 1;
    else
      insert into public.growth_reporting_assignments (
        employee_id, primary_manager_id, secondary_manager_id, revision,
        updated_by, updated_by_email
      ) values (
        v_change.employee_id, v_change.primary_manager_id,
        v_change.secondary_manager_id, 1,
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
      v_event_revision := v_saved.revision;
    end if;

    update public.growth_goals
    set primary_manager_id = v_change.primary_manager_id,
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
    where employee_id = v_change.employee_id
      and status in (
        'Draft', 'Pending Approval', 'Revision Requested', 'Active',
        'Completion Review', 'Cancellation Requested'
      )
      and primary_manager_id is distinct from v_change.primary_manager_id;

    insert into public.growth_events (
      subject_type, subject_id, event_type, actor_id, actor_email,
      target_user_id, summary, metadata
    ) values (
      'reporting_assignment', v_change.employee_id, 'reporting_line_saved',
      p_actor_id, lower(btrim(p_actor_email)), v_change.employee_id,
      'Reporting line updated.',
      jsonb_build_object(
        'hasPrimaryManager', v_change.primary_manager_id is not null,
        'hasSecondaryManager', v_change.secondary_manager_id is not null,
        'isGeneralManager', v_change.employee_id = v_general_manager_id,
        'managerAssignmentRequired', v_change.employee_id <> v_general_manager_id,
        'revision', v_event_revision
      )
    );

    if v_change.primary_manager_id is null and v_change.secondary_manager_id is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'employee_id', v_change.employee_id,
        'primary_manager_id', null,
        'secondary_manager_id', null,
        'revision', 0,
        'deleted', true
      ));
    else
      v_results := v_results || jsonb_build_array(to_jsonb(v_saved));
    end if;
  end loop;

  return jsonb_build_object(
    'reportingLines', v_results,
    'savedCount', jsonb_array_length(v_results)
  );
end;
$$;

create or replace function public.decide_growth_goal(
  p_goal_id uuid,
  p_expected_revision integer,
  p_actor_id uuid,
  p_operation text,
  p_note text,
  p_evidence text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal public.growth_goals%rowtype;
  v_actor_name text;
  v_actor_email text;
  v_decision_type text;
  v_next_status text;
  v_general_manager_id uuid;
  v_now timestamptz := now();
begin
  v_general_manager_id := public.growth_active_general_manager_id();

  select * into v_goal
  from public.growth_goals
  where id = p_goal_id
  for update;
  if not found then
    raise exception 'The development goal is unavailable.';
  end if;
  if v_goal.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The goal changed after it was opened.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'FCOS user'),
         lower(btrim(email))
  into v_actor_name, v_actor_email
  from public.user_profiles
  where id = p_actor_id
    and active;
  if v_actor_name is null then
    raise exception 'The acting user is inactive or unavailable.';
  end if;

  case p_operation
    when 'approve' then
      if v_goal.primary_manager_id is distinct from p_actor_id then
        raise exception 'Only the current primary manager may approve this goal.';
      end if;
      if v_goal.status <> 'Pending Approval' then
        raise exception 'This goal is not pending approval.';
      end if;
      v_next_status := 'Active';
      v_decision_type := 'approved';
      update public.growth_goal_versions
      set approved_at = v_now,
          approved_by = p_actor_id
      where goal_id = v_goal.id
        and version = v_goal.active_version;
      if not found then
        raise exception 'The active goal version is unavailable.';
      end if;
    when 'revision' then
      if v_goal.primary_manager_id is distinct from p_actor_id then
        raise exception 'Only the current primary manager may request a revision.';
      end if;
      if v_goal.status <> 'Pending Approval' then
        raise exception 'This goal is not pending approval.';
      end if;
      if btrim(coalesce(p_note, '')) = '' then
        raise exception 'A revision request needs a note.';
      end if;
      v_next_status := 'Revision Requested';
      v_decision_type := 'revision_requested';
    when 'self_activate' then
      if p_actor_id is distinct from v_general_manager_id
         or v_goal.employee_id is distinct from v_general_manager_id
         or v_goal.primary_manager_id is not null then
        raise exception 'Only the active General Manager may self-activate their own manager-free goal.';
      end if;
      if v_goal.status not in ('Draft', 'Revision Requested') then
        raise exception 'This self-managed goal is not ready for activation.';
      end if;
      v_next_status := 'Active';
      v_decision_type := 'self_activated';
      update public.growth_goal_versions
      set submitted_at = coalesce(submitted_at, v_now),
          approved_at = v_now,
          approved_by = p_actor_id
      where goal_id = v_goal.id
        and version = v_goal.active_version;
      if not found then
        raise exception 'The active goal version is unavailable.';
      end if;
    when 'request_completion' then
      if v_goal.employee_id is distinct from p_actor_id then
        raise exception 'Only the employee may request completion.';
      end if;
      if v_goal.status <> 'Active' then
        raise exception 'Only an active goal can enter completion review.';
      end if;
      if btrim(coalesce(p_evidence, '')) = '' then
        raise exception 'Final evidence is required.';
      end if;
      v_next_status := 'Completion Review';
      v_decision_type := 'completion_requested';
    when 'request_cancellation' then
      if v_goal.employee_id is distinct from p_actor_id then
        raise exception 'Only the employee may request cancellation.';
      end if;
      if v_goal.status not in ('Active', 'Revision Requested') then
        raise exception 'This goal cannot request cancellation in its current state.';
      end if;
      if btrim(coalesce(p_note, '')) = '' then
        raise exception 'A cancellation request needs a reason.';
      end if;
      v_next_status := 'Cancellation Requested';
      v_decision_type := 'cancellation_requested';
    when 'complete' then
      if v_goal.primary_manager_id is distinct from p_actor_id then
        raise exception 'Only the current primary manager may confirm completion.';
      end if;
      if v_goal.status <> 'Completion Review' then
        raise exception 'Completion may be confirmed only during completion review.';
      end if;
      if btrim(coalesce(v_goal.completion_evidence, '')) = '' then
        raise exception 'Employee completion evidence is required.';
      end if;
      v_next_status := 'Completed';
      v_decision_type := 'completed';
    when 'not_achieved' then
      if v_goal.primary_manager_id is distinct from p_actor_id then
        raise exception 'Only the current primary manager may record this outcome.';
      end if;
      if v_goal.status <> 'Completion Review' then
        raise exception 'Not achieved may be recorded only during completion review.';
      end if;
      if btrim(coalesce(p_note, '')) = '' then
        raise exception 'This outcome needs a note.';
      end if;
      v_next_status := 'Not Achieved';
      v_decision_type := 'not_achieved';
    when 'self_complete' then
      if p_actor_id is distinct from v_general_manager_id
         or v_goal.employee_id is distinct from v_general_manager_id
         or v_goal.primary_manager_id is not null then
        raise exception 'Only the active General Manager may complete their own manager-free goal.';
      end if;
      if v_goal.status <> 'Active' then
        raise exception 'Only an active self-managed goal can be completed.';
      end if;
      if btrim(coalesce(p_evidence, '')) = '' then
        raise exception 'Final evidence is required.';
      end if;
      v_next_status := 'Completed';
      v_decision_type := 'self_completed';
    when 'self_not_achieved' then
      if p_actor_id is distinct from v_general_manager_id
         or v_goal.employee_id is distinct from v_general_manager_id
         or v_goal.primary_manager_id is not null then
        raise exception 'Only the active General Manager may record their own manager-free goal outcome.';
      end if;
      if v_goal.status <> 'Active' then
        raise exception 'Only an active self-managed goal can be marked not achieved.';
      end if;
      if btrim(coalesce(p_note, '')) = '' then
        raise exception 'This outcome needs a note.';
      end if;
      v_next_status := 'Not Achieved';
      v_decision_type := 'self_not_achieved';
    when 'cancel' then
      if v_goal.primary_manager_id is distinct from p_actor_id then
        raise exception 'Only the current primary manager may approve cancellation.';
      end if;
      if v_goal.status <> 'Cancellation Requested' then
        raise exception 'Cancellation may be approved only after an employee request.';
      end if;
      v_next_status := 'Not Achieved';
      v_decision_type := 'cancelled';
    else
      raise exception 'Select a valid goal decision.';
  end case;

  update public.growth_goals
  set status = v_next_status,
      approved_version = case
        when p_operation in ('approve', 'self_activate') then active_version
        else approved_version
      end,
      completion_evidence = case
        when p_operation in ('request_completion', 'self_complete')
          then left(coalesce(p_evidence, ''), 10000)
        else completion_evidence
      end,
      completion_note = case
        when p_operation in (
          'request_cancellation', 'complete', 'not_achieved', 'cancel',
          'self_complete', 'self_not_achieved'
        ) then left(coalesce(p_note, ''), 10000)
        else completion_note
      end,
      completed_at = case
        when p_operation in (
          'complete', 'not_achieved', 'cancel', 'self_complete', 'self_not_achieved'
        ) then v_now
        else null
      end,
      completed_by = case
        when p_operation in (
          'complete', 'not_achieved', 'cancel', 'self_complete', 'self_not_achieved'
        ) then p_actor_id
        else null
      end,
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_at = v_now
  where id = v_goal.id
    and revision = v_goal.revision
  returning * into v_goal;
  if not found then
    raise exception 'The goal changed after it was opened.';
  end if;

  insert into public.growth_goal_decisions (
    goal_id, goal_version, decision_type, note, actor_id, actor_name
  ) values (
    v_goal.id, v_goal.active_version, v_decision_type,
    left(coalesce(p_note, ''), 10000), p_actor_id, v_actor_name
  );

  if p_operation in ('self_activate', 'self_complete', 'self_not_achieved') then
    insert into public.growth_events (
      subject_type, subject_id, event_type, actor_id, actor_email,
      target_user_id, summary, metadata
    ) values (
      'goal', v_goal.id, 'goal_' || v_decision_type,
      p_actor_id, v_actor_email, null,
      case
        when p_operation = 'self_activate' then 'General Manager self-managed goal activated.'
        when p_operation = 'self_complete' then 'General Manager self-managed goal completed.'
        else 'General Manager self-managed goal marked not achieved.'
      end,
      jsonb_build_object(
        'status', v_goal.status,
        'version', v_goal.active_version,
        'selfManaged', true,
        'hasEvidence', btrim(coalesce(p_evidence, '')) <> ''
      )
    );
  end if;

  return jsonb_build_object('goal', to_jsonb(v_goal), 'decisionType', v_decision_type);
end;
$$;

revoke all on function public.growth_active_general_manager_id() from public, anon, authenticated;
revoke all on function public.save_growth_reporting_assignment(uuid, uuid, uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.save_growth_reporting_assignments_batch(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.decide_growth_goal(uuid, integer, uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.growth_active_general_manager_id() to service_role;
grant execute on function public.save_growth_reporting_assignment(uuid, uuid, uuid, integer, uuid, text) to service_role;
grant execute on function public.save_growth_reporting_assignments_batch(jsonb, uuid, text) to service_role;
grant execute on function public.decide_growth_goal(uuid, integer, uuid, text, text, text) to service_role;
