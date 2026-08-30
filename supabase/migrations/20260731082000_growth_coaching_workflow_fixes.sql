-- Growth & Coaching follow-up: serialize reporting changes and make progress/content writes atomic.

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

create or replace function public.save_growth_goal_progress(
  p_goal_id uuid,
  p_expected_revision integer,
  p_actor_id uuid,
  p_mode text,
  p_measurement jsonb,
  p_progress numeric,
  p_checkpoint_id uuid,
  p_actual_result text,
  p_evidence text,
  p_tracking_state text,
  p_comment text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal public.growth_goals%rowtype;
  v_version public.growth_goal_versions%rowtype;
  v_checkpoint public.growth_goal_checkpoints%rowtype;
  v_current_value numeric;
begin
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

  if p_mode = 'manager_comment' then
    if v_goal.primary_manager_id is distinct from p_actor_id then
      raise exception 'Only the current primary manager may comment on this goal.';
    end if;
    if v_goal.status not in ('Active', 'Completion Review') then
      raise exception 'Manager comments are available for active or completion-review goals.';
    end if;
    if btrim(coalesce(p_comment, '')) = '' then
      raise exception 'A manager comment is required.';
    end if;
    insert into public.growth_goal_updates (goal_id, comment, submitted_by)
    values (v_goal.id, left(p_comment, 10000), p_actor_id);
    return jsonb_build_object('goal', to_jsonb(v_goal), 'commentSaved', true);
  end if;

  if p_mode <> 'employee_progress' then
    raise exception 'Select a valid goal progress operation.';
  end if;
  if v_goal.employee_id is distinct from p_actor_id then
    raise exception 'Only the employee may update goal progress.';
  end if;
  if v_goal.status <> 'Active' then
    raise exception 'Only an active goal accepts progress updates.';
  end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    raise exception 'Calculated goal progress must be between 0 and 100.';
  end if;

  select * into v_version
  from public.growth_goal_versions
  where goal_id = v_goal.id
    and version = v_goal.active_version
  for update;
  if not found then
    raise exception 'The active goal measurement is unavailable.';
  end if;
  if coalesce(p_measurement->>'type', '') <> v_version.measurement_type then
    raise exception 'The goal measurement type cannot change through a progress update.';
  end if;

  if p_checkpoint_id is not null then
    select * into v_checkpoint
    from public.growth_goal_checkpoints
    where id = p_checkpoint_id
      and goal_id = v_goal.id
      and goal_version = v_goal.active_version
    for update;
    if not found then
      raise exception 'The selected checkpoint is unavailable.';
    end if;
    if p_tracking_state not in ('On Track', 'At Risk', 'Off Track') then
      raise exception 'Select a valid progress signal.';
    end if;
    update public.growth_goal_checkpoints
    set actual_result = left(coalesce(p_actual_result, ''), 20000),
        evidence = left(coalesce(p_evidence, ''), 10000),
        tracking_state = p_tracking_state,
        completed_at = case
          when btrim(coalesce(p_actual_result, '')) <> ''
            or btrim(coalesce(p_evidence, '')) <> ''
          then coalesce(completed_at, now())
          else null
        end,
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_checkpoint.id;
  end if;

  update public.growth_goal_versions
  set measurement = p_measurement
  where id = v_version.id;

  update public.growth_goals
  set progress = p_progress,
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where id = v_goal.id
  returning * into v_goal;

  if v_version.measurement_type = 'numeric' then
    v_current_value := nullif(p_measurement->>'current', '')::numeric;
  end if;
  insert into public.growth_goal_updates (
    goal_id, checkpoint_id, current_value, actual_result, evidence,
    tracking_state, comment, submitted_by
  ) values (
    v_goal.id, p_checkpoint_id, v_current_value,
    left(coalesce(p_actual_result, ''), 20000),
    left(coalesce(p_evidence, ''), 10000),
    p_tracking_state, left(coalesce(p_comment, ''), 10000), p_actor_id
  );

  return jsonb_build_object('goal', to_jsonb(v_goal));
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
  v_decision_type text;
  v_next_status text;
  v_now timestamptz := now();
begin
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

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'FCOS user')
  into v_actor_name
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
        when p_operation = 'approve' then active_version
        else approved_version
      end,
      completion_evidence = case
        when p_operation = 'request_completion' then left(coalesce(p_evidence, ''), 10000)
        else completion_evidence
      end,
      completion_note = case
        when p_operation in ('request_cancellation', 'complete', 'not_achieved', 'cancel')
          then left(coalesce(p_note, ''), 10000)
        else completion_note
      end,
      completed_at = case
        when p_operation in ('complete', 'not_achieved', 'cancel') then v_now
        else null
      end,
      completed_by = case
        when p_operation in ('complete', 'not_achieved', 'cancel') then p_actor_id
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

  return jsonb_build_object('goal', to_jsonb(v_goal), 'decisionType', v_decision_type);
end;
$$;

create or replace function public.save_growth_coaching_session_content(
  p_session_id uuid,
  p_expected_revision integer,
  p_actor_id uuid,
  p_content_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.growth_coaching_sessions%rowtype;
  v_relationship public.growth_coaching_relationships%rowtype;
  v_existing public.growth_coaching_agenda_items%rowtype;
  v_addendum public.growth_coaching_notes%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_order integer := 0;
  v_topic text;
  v_prompt_type text;
begin
  select * into v_session
  from public.growth_coaching_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'The coaching session is unavailable.';
  end if;
  select * into v_relationship
  from public.growth_coaching_relationships
  where id = v_session.relationship_id;
  if p_actor_id not in (v_relationship.participant_one_id, v_relationship.participant_two_id) then
    raise exception 'The coaching session is unavailable.';
  end if;
  if v_session.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The coaching session changed after it was opened.';
  end if;
  if v_session.status = 'Cancelled' then
    raise exception 'A cancelled coaching session is read-only.';
  end if;

  if p_content_type = 'addendum' then
    if v_session.locked_at is null then
      raise exception 'Addenda are available only after both participants confirm the session.';
    end if;
    if btrim(coalesce(p_payload->>'addendum', '')) = '' then
      raise exception 'An append-only correction is required.';
    end if;
    insert into public.growth_coaching_notes (
      session_id, author_id, note_type, body
    ) values (
      v_session.id, p_actor_id, 'addendum', left(p_payload->>'addendum', 20000)
    )
    returning * into v_addendum;
    return jsonb_build_object('addendum', to_jsonb(v_addendum));
  end if;

  if v_session.locked_at is not null then
    raise exception 'Confirmed session content is locked. Add an append-only correction instead.';
  end if;

  if p_content_type = 'agenda' then
    if jsonb_typeof(coalesce(p_payload->'agenda', '[]'::jsonb)) <> 'array' then
      raise exception 'Agenda items must be an array.';
    end if;
    for v_item in
      select value from jsonb_array_elements(coalesce(p_payload->'agenda', '[]'::jsonb))
    loop
      v_item_id := coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid());
      v_topic := btrim(coalesce(v_item->>'text', v_item->>'title', ''));
      if v_topic = '' then
        continue;
      end if;
      v_prompt_type := case
        when coalesce(v_item->>'mode', 'free') = 'guided' then 'guided'
        else 'free'
      end;
      select * into v_existing
      from public.growth_coaching_agenda_items
      where id = v_item_id;
      if found and v_existing.session_id is distinct from v_session.id then
        continue;
      end if;
      if found and v_existing.author_id is distinct from p_actor_id then
        update public.growth_coaching_agenda_items
        set item_order = v_order,
            revision = revision + 1,
            updated_at = now()
        where id = v_existing.id;
      elsif found then
        update public.growth_coaching_agenda_items
        set topic = left(v_topic, 2000),
            prompt_type = v_prompt_type,
            item_order = v_order,
            revision = revision + 1,
            updated_at = now()
        where id = v_existing.id;
      else
        insert into public.growth_coaching_agenda_items (
          id, session_id, author_id, item_order, topic, prompt_type
        ) values (
          v_item_id, v_session.id, p_actor_id, v_order, left(v_topic, 2000), v_prompt_type
        );
      end if;
      v_keep_ids := array_append(v_keep_ids, v_item_id);
      v_order := v_order + 1;
    end loop;
    delete from public.growth_coaching_agenda_items
    where session_id = v_session.id
      and author_id = p_actor_id
      and not (id = any(v_keep_ids));
  elsif p_content_type = 'shared' then
    update public.growth_coaching_sessions
    set shared_notes = left(coalesce(p_payload->>'sharedNotes', ''), 20000),
        decisions = left(coalesce(p_payload->>'decisions', ''), 20000)
    where id = v_session.id;
  else
    raise exception 'Select a valid session content type.';
  end if;

  update public.growth_coaching_sessions
  set status = 'Awaiting Confirmation',
      revision = revision + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  delete from public.growth_coaching_confirmations
  where session_id = v_session.id;

  return jsonb_build_object('session', to_jsonb(v_session), 'saved', true);
end;
$$;

create or replace function public.save_growth_private_preparation(
  p_session_id uuid,
  p_expected_revision integer,
  p_actor_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.growth_coaching_sessions%rowtype;
  v_relationship public.growth_coaching_relationships%rowtype;
  v_note public.growth_coaching_notes%rowtype;
begin
  select * into v_session
  from public.growth_coaching_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'The coaching session is unavailable.';
  end if;
  select * into v_relationship
  from public.growth_coaching_relationships
  where id = v_session.relationship_id;
  if p_actor_id not in (v_relationship.participant_one_id, v_relationship.participant_two_id) then
    raise exception 'The coaching session is unavailable.';
  end if;
  if v_session.status = 'Cancelled' then
    raise exception 'A cancelled coaching session is read-only.';
  end if;
  if v_session.locked_at is not null or v_session.status = 'Confirmed' then
    raise exception 'Confirmed session content is locked.';
  end if;

  select * into v_note
  from public.growth_coaching_notes
  where session_id = v_session.id
    and author_id = p_actor_id
    and note_type = 'private_preparation'
  for update;

  if found then
    if v_note.revision <> coalesce(p_expected_revision, 0) then
      raise exception 'Private preparation changed after it was opened.';
    end if;
    update public.growth_coaching_notes
    set body = left(coalesce(p_body, ''), 20000),
        revision = revision + 1,
        updated_at = now()
    where id = v_note.id
    returning * into v_note;
  else
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'Private preparation changed after it was opened.';
    end if;
    insert into public.growth_coaching_notes (
      session_id, author_id, note_type, body
    ) values (
      v_session.id, p_actor_id, 'private_preparation', left(coalesce(p_body, ''), 20000)
    )
    returning * into v_note;
  end if;

  return jsonb_build_object(
    'saved', true,
    'private', true,
    'privatePrepRevision', v_note.revision
  );
end;
$$;

create or replace function public.confirm_growth_coaching_session(
  p_session_id uuid,
  p_expected_revision integer,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.growth_coaching_sessions%rowtype;
  v_relationship public.growth_coaching_relationships%rowtype;
  v_confirmation_count integer;
  v_locked boolean := false;
begin
  select * into v_session
  from public.growth_coaching_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'The coaching session is unavailable.';
  end if;
  select * into v_relationship
  from public.growth_coaching_relationships
  where id = v_session.relationship_id;
  if p_actor_id not in (v_relationship.participant_one_id, v_relationship.participant_two_id) then
    raise exception 'The coaching session is unavailable.';
  end if;
  if v_session.revision <> coalesce(p_expected_revision, 0) then
    raise exception 'The coaching session changed after it was opened.';
  end if;
  if v_session.status <> 'Awaiting Confirmation' then
    raise exception 'Only a session awaiting confirmation may be confirmed.';
  end if;
  if v_session.locked_at is not null then
    raise exception 'This session is already confirmed and locked.';
  end if;

  insert into public.growth_coaching_confirmations (
    session_id, participant_id, shared_revision, confirmed_at
  ) values (
    v_session.id, p_actor_id, v_session.revision, now()
  )
  on conflict (session_id, participant_id) do update set
    shared_revision = excluded.shared_revision,
    confirmed_at = excluded.confirmed_at;

  select count(*) into v_confirmation_count
  from public.growth_coaching_confirmations
  where session_id = v_session.id
    and shared_revision = v_session.revision
    and participant_id in (
      v_relationship.participant_one_id,
      v_relationship.participant_two_id
    );

  if v_confirmation_count = 2 then
    update public.growth_coaching_sessions
    set status = 'Confirmed',
        locked_at = now(),
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_session.id
    returning * into v_session;
    v_locked := true;
  end if;

  return jsonb_build_object(
    'confirmed', true,
    'locked', v_locked,
    'session', to_jsonb(v_session)
  );
end;
$$;

revoke all on function public.save_growth_reporting_assignment(uuid, uuid, uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.save_growth_goal_progress(uuid, integer, uuid, text, jsonb, numeric, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.decide_growth_goal(uuid, integer, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.save_growth_coaching_session_content(uuid, integer, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.save_growth_private_preparation(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_growth_coaching_session(uuid, integer, uuid) from public, anon, authenticated;

grant execute on function public.save_growth_reporting_assignment(uuid, uuid, uuid, integer, uuid, text) to service_role;
grant execute on function public.save_growth_goal_progress(uuid, integer, uuid, text, jsonb, numeric, uuid, text, text, text, text) to service_role;
grant execute on function public.decide_growth_goal(uuid, integer, uuid, text, text, text) to service_role;
grant execute on function public.save_growth_coaching_session_content(uuid, integer, uuid, text, jsonb) to service_role;
grant execute on function public.save_growth_private_preparation(uuid, integer, uuid, text) to service_role;
grant execute on function public.confirm_growth_coaching_session(uuid, integer, uuid) to service_role;
