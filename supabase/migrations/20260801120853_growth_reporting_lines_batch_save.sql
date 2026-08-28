-- Save all edited reporting lines in one transaction. Temporarily clearing the
-- changed primary links permits an atomic hierarchy re-parenting without an
-- intermediate cycle; the final hierarchy is validated before any write.

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
  v_saved public.growth_reporting_assignments%rowtype;
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

  update public.growth_reporting_assignments
  set primary_manager_id = null
  where employee_id = any(v_employee_ids);

  for v_change in
    select *
    from jsonb_to_recordset(p_changes) as change(
      employee_id uuid,
      primary_manager_id uuid,
      secondary_manager_id uuid,
      expected_revision integer
    )
  loop
    select * into v_saved
    from public.save_growth_reporting_assignment(
      v_change.employee_id,
      v_change.primary_manager_id,
      v_change.secondary_manager_id,
      v_change.expected_revision,
      p_actor_id,
      p_actor_email
    );
    v_results := v_results || jsonb_build_array(to_jsonb(v_saved));
  end loop;

  return jsonb_build_object(
    'reportingLines', v_results,
    'savedCount', jsonb_array_length(v_results)
  );
end;
$$;

revoke all on function public.save_growth_reporting_assignments_batch(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_growth_reporting_assignments_batch(jsonb, uuid, text) to service_role;
