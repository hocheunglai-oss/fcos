-- Apply reporting-line batches directly to their final validated state. The
-- reporting assignment table represents "no managers" with no row because its
-- manager-distinctness constraint rejects a row where both lookups are null.

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
begin
  perform pg_advisory_xact_lock(hashtext('growth_reporting_hierarchy'));

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
    if v_change.employee_id in (v_change.primary_manager_id, v_change.secondary_manager_id) then
      raise exception 'A user cannot manage themselves.';
    end if;
    if v_change.primary_manager_id is not null
       and v_change.primary_manager_id is not distinct from v_change.secondary_manager_id then
      raise exception 'Primary and advisory managers must be different.';
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

  -- Validate the complete requested hierarchy instead of each intermediate row.
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

revoke all on function public.save_growth_reporting_assignments_batch(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_growth_reporting_assignments_batch(jsonb, uuid, text) to service_role;
