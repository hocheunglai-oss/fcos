begin;

lock table public.fcos_improvement_tickets in share row exclusive mode;
lock table public.fcos_improvement_proposals in share row exclusive mode;

-- Collapse only the current ticket state. Historical proposal payloads and events
-- intentionally retain the terminology that was valid when they were recorded.
update public.fcos_improvement_tickets as ticket
set
  status = case
    when ticket.status in ('Under Review', 'Accepted') then 'Reported'
    when ticket.status = 'Reopened' then coalesce(
      (
        select case proposal.payload->>'fromStatus'
          when 'Closed' then 'In Progress'
          when 'Rejected' then 'Reported'
          else 'Reported'
        end
        from public.fcos_improvement_proposals as proposal
        where proposal.ticket_id = ticket.id
          and proposal.change_type = 'status'
          and proposal.approval_state = 'approved'
          and proposal.payload->>'status' = 'Reopened'
        order by proposal.reviewed_at desc nulls last, proposal.created_at desc
        limit 1
      ),
      'Reported'
    )
    else ticket.status
  end,
  closed_at = case
    when ticket.status in ('Under Review', 'Accepted', 'Reopened') then null
    else ticket.closed_at
  end,
  updated_at = case
    when ticket.status in ('Under Review', 'Accepted', 'Reopened') then now()
    else ticket.updated_at
  end
where ticket.status in ('Under Review', 'Accepted', 'Reopened');

alter table public.fcos_improvement_tickets
  drop constraint if exists fcos_improvement_tickets_status_check;

alter table public.fcos_improvement_tickets
  add constraint fcos_improvement_tickets_status_check
  check (status in ('Reported', 'In Progress', 'Ready for Verification', 'Closed', 'Rejected'));

create or replace function public.fcos_improvement_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_from
    when 'Reported' then p_to in ('In Progress', 'Rejected')
    when 'In Progress' then p_to in ('Ready for Verification', 'Rejected')
    when 'Ready for Verification' then p_to in ('Closed', 'In Progress')
    when 'Closed' then p_to = 'In Progress'
    when 'Rejected' then p_to = 'Reported'
    else false
  end;
$$;

create or replace function public.fcos_improvement_status_note_required(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_to = 'Rejected'
    or (p_from = 'Ready for Verification' and p_to = 'In Progress')
    or (p_from = 'Closed' and p_to = 'In Progress')
    or (p_from = 'Rejected' and p_to = 'Reported');
$$;

create or replace function public.decide_fcos_improvement_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_reason text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_proposal public.fcos_improvement_proposals%rowtype;
  v_ticket public.fcos_improvement_tickets%rowtype;
  v_target_user public.user_profiles%rowtype;
  v_requested_status text;
  v_target_status text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Select Approve or Reject.';
  end if;
  if not public.collaboration_is_general_manager(p_actor_id) then
    raise exception 'Only the active General Manager may approve FCOS Improvement changes.';
  end if;
  if p_decision = 'rejected' and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A rejection reason is required.';
  end if;

  select * into v_proposal from public.fcos_improvement_proposals where id = p_proposal_id for update;
  if not found then raise exception 'The proposed change was not found.'; end if;
  if v_proposal.approval_state <> 'pending' then raise exception 'This proposed change has already been reviewed.'; end if;
  select * into v_ticket from public.fcos_improvement_tickets where id = v_proposal.ticket_id for update;
  if not found then raise exception 'The FCOS Improvement ticket was not found.'; end if;

  if p_decision = 'approved' and v_proposal.change_type <> 'comment' and v_ticket.revision <> v_proposal.base_revision then
    raise exception 'The ticket changed after this proposal was submitted. Reject it and submit a fresh change.';
  end if;

  if p_decision = 'approved' then
    if v_proposal.change_type = 'status' then
      v_requested_status := v_proposal.payload->>'status';

      -- Deployment compatibility only: proposals created by the former API are
      -- translated to the reduced lifecycle without making legacy values valid
      -- ticket statuses again.
      v_target_status := case
        when v_requested_status = 'Under Review' then 'Reported'
        when v_requested_status = 'Accepted' then 'In Progress'
        when v_requested_status = 'Reopened' and v_ticket.status = 'Closed' then 'In Progress'
        when v_requested_status = 'Reopened' and v_ticket.status = 'Rejected' then 'Reported'
        when v_requested_status = 'Reopened' and v_ticket.status = 'Ready for Verification' then 'In Progress'
        else v_requested_status
      end;

      if v_target_status = v_ticket.status then
        if v_requested_status not in ('Under Review', 'Accepted', 'Reopened') then
          raise exception 'The proposed status transition is no longer allowed.';
        end if;
      elsif not public.fcos_improvement_status_transition_allowed(v_ticket.status, v_target_status) then
        raise exception 'The proposed status transition is no longer allowed.';
      end if;

      if public.fcos_improvement_status_note_required(v_ticket.status, v_target_status)
        and btrim(coalesce(v_proposal.payload->>'note', '')) = '' then
        raise exception 'A workflow note is required for this status transition.';
      end if;

      update public.fcos_improvement_tickets set
        status = v_target_status,
        closed_at = case
          when v_target_status in ('Closed', 'Rejected') then coalesce(closed_at, now())
          else null
        end,
        revision = revision + 1,
        updated_at = now()
      where id = v_ticket.id;
    elsif v_proposal.change_type = 'assignment' then
      if nullif(v_proposal.payload->>'assigneeUserId', '') is not null then
        select * into v_target_user from public.user_profiles
        where id = (v_proposal.payload->>'assigneeUserId')::uuid and active = true;
        if not found then raise exception 'The proposed assignee is no longer active.'; end if;
      end if;
      update public.fcos_improvement_tickets set
        assignee_user_id = v_target_user.id,
        assignee_name = case when v_target_user.id is null then null else coalesce(nullif(v_target_user.full_name, ''), v_target_user.email) end,
        assignee_email = v_target_user.email,
        revision = revision + 1,
        updated_at = now()
      where id = v_ticket.id;
    elsif v_proposal.change_type = 'ticket_edit' then
      update public.fcos_improvement_tickets set
        title = coalesce(nullif(v_proposal.payload->>'title', ''), title),
        module_key = coalesce(nullif(v_proposal.payload->>'moduleKey', ''), module_key),
        description = coalesce(nullif(v_proposal.payload->>'description', ''), description),
        actual_behavior = case when v_proposal.payload ? 'actualBehavior' then coalesce(v_proposal.payload->>'actualBehavior', '') else actual_behavior end,
        expected_behavior = case when v_proposal.payload ? 'expectedBehavior' then coalesce(v_proposal.payload->>'expectedBehavior', '') else expected_behavior end,
        reproduction_steps = case when v_proposal.payload ? 'reproductionSteps' then coalesce(v_proposal.payload->>'reproductionSteps', '') else reproduction_steps end,
        desired_outcome = case when v_proposal.payload ? 'desiredOutcome' then coalesce(v_proposal.payload->>'desiredOutcome', '') else desired_outcome end,
        business_value = case when v_proposal.payload ? 'businessValue' then coalesce(v_proposal.payload->>'businessValue', '') else business_value end,
        priority = coalesce(nullif(v_proposal.payload->>'priority', ''), priority),
        severity = case when v_proposal.payload ? 'severity' then nullif(v_proposal.payload->>'severity', '') else severity end,
        revision = revision + 1,
        updated_at = now()
      where id = v_ticket.id;
    else
      update public.fcos_improvement_tickets set updated_at = now() where id = v_ticket.id;
    end if;
  end if;

  update public.fcos_improvement_proposals set
    approval_state = p_decision,
    reviewed_by = p_actor_id,
    reviewer_name = p_actor_name,
    reviewer_email = p_actor_email,
    review_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    reviewed_at = now(),
    updated_at = now()
  where id = v_proposal.id;

  insert into public.fcos_improvement_events (
    ticket_id, proposal_id, event_type, summary, metadata, actor_user_id, actor_name, actor_email
  ) values (
    v_ticket.id, v_proposal.id, 'proposal_' || p_decision,
    case when p_decision = 'approved' then 'Proposed ' || replace(v_proposal.change_type, '_', ' ') || ' approved' else 'Proposed ' || replace(v_proposal.change_type, '_', ' ') || ' rejected' end,
    jsonb_build_object('changeType', v_proposal.change_type, 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
    p_actor_id, p_actor_name, p_actor_email
  );

  return jsonb_build_object(
    'proposal', (select to_jsonb(p) from public.fcos_improvement_proposals p where p.id = v_proposal.id),
    'ticket', (select to_jsonb(t) from public.fcos_improvement_tickets t where t.id = v_ticket.id)
  );
end;
$$;

revoke all on function public.fcos_improvement_status_transition_allowed(text, text) from public, anon, authenticated;
grant execute on function public.fcos_improvement_status_transition_allowed(text, text) to service_role;
revoke all on function public.fcos_improvement_status_note_required(text, text) from public, anon, authenticated;
grant execute on function public.fcos_improvement_status_note_required(text, text) to service_role;
revoke all on function public.decide_fcos_improvement_proposal(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_fcos_improvement_proposal(uuid, text, text, uuid, text, text) to service_role;

comment on function public.fcos_improvement_status_transition_allowed(text, text) is
  'Five-state FCOS Improvement ticket transition guard. Legacy terminology remains only in immutable proposal/event history.';

commit;
