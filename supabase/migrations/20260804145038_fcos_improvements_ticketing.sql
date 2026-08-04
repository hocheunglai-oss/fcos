create extension if not exists pgcrypto;

create sequence if not exists public.fcos_improvement_ticket_key_seq;

create table if not exists public.fcos_improvement_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_key text not null unique default ('FCOS-' || lpad(nextval('public.fcos_improvement_ticket_key_seq')::text, 6, '0')),
  ticket_type text not null check (ticket_type in ('bug', 'feature_request')),
  title text not null check (btrim(title) <> '' and char_length(title) <= 255),
  module_key text not null check (btrim(module_key) <> '' and char_length(module_key) <= 100),
  description text not null check (btrim(description) <> '' and char_length(description) <= 20000),
  actual_behavior text not null default '' check (char_length(actual_behavior) <= 10000),
  expected_behavior text not null default '' check (char_length(expected_behavior) <= 10000),
  reproduction_steps text not null default '' check (char_length(reproduction_steps) <= 15000),
  desired_outcome text not null default '' check (char_length(desired_outcome) <= 15000),
  business_value text not null default '' check (char_length(business_value) <= 10000),
  severity text null check (severity is null or severity in ('Low', 'Medium', 'High', 'Critical')),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  status text not null default 'Reported' check (status in ('Reported', 'Under Review', 'Accepted', 'In Progress', 'Ready for Verification', 'Closed', 'Reopened', 'Rejected')),
  reporter_user_id uuid null references public.user_profiles(id) on delete set null,
  reporter_name text not null,
  reporter_email text not null,
  assignee_user_id uuid null references public.user_profiles(id) on delete set null,
  assignee_name text null,
  assignee_email text null,
  revision bigint not null default 1 check (revision > 0),
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (ticket_type = 'bug' and severity is not null and btrim(actual_behavior) <> '' and btrim(expected_behavior) <> '' and btrim(reproduction_steps) <> '')
    or (ticket_type = 'feature_request' and btrim(desired_outcome) <> '' and btrim(business_value) <> '')
  )
);

create table if not exists public.fcos_improvement_proposals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.fcos_improvement_tickets(id) on delete cascade,
  change_type text not null check (change_type in ('comment', 'status', 'assignment', 'ticket_edit')),
  payload jsonb not null default '{}'::jsonb,
  base_revision bigint not null check (base_revision > 0),
  approval_state text not null default 'pending' check (approval_state in ('pending', 'approved', 'rejected')),
  proposer_source text not null default 'user' check (proposer_source in ('user', 'codex')),
  proposer_user_id uuid null references public.user_profiles(id) on delete set null,
  proposer_name text not null,
  proposer_email text null,
  operation_key text null unique,
  reviewed_by uuid null references public.user_profiles(id) on delete set null,
  reviewer_name text null,
  reviewer_email text null,
  review_reason text null check (review_reason is null or char_length(review_reason) <= 2000),
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((proposer_source = 'user' and proposer_user_id is not null) or proposer_source = 'codex'),
  check (change_type <> 'comment' or (btrim(coalesce(payload->>'body', '')) <> '' and char_length(payload->>'body') <= 10000))
);

create unique index if not exists fcos_improvement_one_pending_workflow_change_idx
on public.fcos_improvement_proposals(ticket_id, change_type)
where approval_state = 'pending' and change_type in ('status', 'assignment', 'ticket_edit');

create or replace function public.fcos_improvement_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_from
    when 'Reported' then p_to in ('Under Review', 'Rejected')
    when 'Under Review' then p_to in ('Accepted', 'Rejected')
    when 'Accepted' then p_to in ('In Progress', 'Rejected')
    when 'In Progress' then p_to in ('Ready for Verification', 'Rejected')
    when 'Ready for Verification' then p_to in ('Closed', 'Reopened')
    when 'Closed' then p_to = 'Reopened'
    when 'Reopened' then p_to in ('Accepted', 'In Progress', 'Rejected')
    when 'Rejected' then p_to = 'Reopened'
    else false
  end;
$$;

create table if not exists public.fcos_improvement_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.fcos_improvement_tickets(id) on delete cascade,
  storage_bucket text not null default 'fcos-improvement-files',
  storage_path text not null unique,
  original_filename text not null check (btrim(original_filename) <> '' and char_length(original_filename) <= 255),
  display_filename text not null check (btrim(display_filename) <> '' and char_length(display_filename) <= 255),
  content_type text not null,
  file_extension text not null,
  content_size bigint not null check (content_size > 0 and content_size <= 20971520),
  upload_status text not null default 'pending' check (upload_status in ('pending', 'complete', 'failed', 'deleted')),
  upload_expires_at timestamptz null,
  uploaded_by uuid null references public.user_profiles(id) on delete set null,
  uploaded_by_name text not null,
  uploaded_by_email text not null,
  completed_at timestamptz null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fcos_improvement_attachment_active_name_idx
on public.fcos_improvement_attachments(ticket_id, lower(display_filename))
where upload_status in ('pending', 'complete');

create table if not exists public.fcos_improvement_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.fcos_improvement_tickets(id) on delete cascade,
  proposal_id uuid null references public.fcos_improvement_proposals(id) on delete set null,
  attachment_id uuid null references public.fcos_improvement_attachments(id) on delete set null,
  event_type text not null,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_name text null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create table if not exists public.fcos_improvement_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  ticket_id uuid not null references public.fcos_improvement_tickets(id) on delete cascade,
  proposal_id uuid null references public.fcos_improvement_proposals(id) on delete cascade,
  notification_type text not null check (notification_type in ('ticket_created', 'proposal_pending', 'proposal_approved', 'proposal_rejected', 'assigned', 'comment_approved', 'status_changed')),
  title text not null,
  message text not null default '',
  dedupe_key text not null,
  read_at timestamptz null,
  handled_at timestamptz null,
  snoozed_until timestamptz null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists fcos_improvement_ticket_queue_idx on public.fcos_improvement_tickets(status, priority, updated_at desc);
create index if not exists fcos_improvement_ticket_reporter_idx on public.fcos_improvement_tickets(reporter_user_id, updated_at desc);
create index if not exists fcos_improvement_ticket_assignee_idx on public.fcos_improvement_tickets(assignee_user_id, updated_at desc);
create index if not exists fcos_improvement_proposal_ticket_idx on public.fcos_improvement_proposals(ticket_id, created_at);
create index if not exists fcos_improvement_proposal_approval_idx on public.fcos_improvement_proposals(approval_state, created_at);
create index if not exists fcos_improvement_event_ticket_idx on public.fcos_improvement_events(ticket_id, created_at desc);
create index if not exists fcos_improvement_notification_user_idx on public.fcos_improvement_notifications(user_id, handled_at, snoozed_until, read_at, created_at desc);

alter table public.fcos_improvement_tickets enable row level security;
alter table public.fcos_improvement_proposals enable row level security;
alter table public.fcos_improvement_attachments enable row level security;
alter table public.fcos_improvement_events enable row level security;
alter table public.fcos_improvement_notifications enable row level security;

revoke all on table public.fcos_improvement_tickets from public, anon, authenticated;
revoke all on table public.fcos_improvement_proposals from public, anon, authenticated;
revoke all on table public.fcos_improvement_attachments from public, anon, authenticated;
revoke all on table public.fcos_improvement_events from public, anon, authenticated;
revoke all on table public.fcos_improvement_notifications from public, anon, authenticated;
grant all on table public.fcos_improvement_tickets to service_role;
grant all on table public.fcos_improvement_proposals to service_role;
grant all on table public.fcos_improvement_attachments to service_role;
grant all on table public.fcos_improvement_events to service_role;
grant all on table public.fcos_improvement_notifications to service_role;
grant usage, select on sequence public.fcos_improvement_ticket_key_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fcos-improvement-files', 'fcos-improvement-files', false, 20971520,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/rtf','text/rtf','application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet','application/vnd.oasis.opendocument.presentation','text/plain','text/markdown','text/csv','application/csv','message/rfc822','application/vnd.ms-outlook','image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

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
      if not public.fcos_improvement_status_transition_allowed(v_ticket.status, v_proposal.payload->>'status') then
        raise exception 'The proposed status transition is no longer allowed.';
      end if;
      update public.fcos_improvement_tickets set
        status = v_proposal.payload->>'status',
        closed_at = case when v_proposal.payload->>'status' = 'Closed' then now() else null end,
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

revoke all on function public.decide_fcos_improvement_proposal(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_fcos_improvement_proposal(uuid, text, text, uuid, text, text) to service_role;

revoke all on function public.fcos_improvement_status_transition_allowed(text, text) from public, anon, authenticated;
grant execute on function public.fcos_improvement_status_transition_allowed(text, text) to service_role;

comment on table public.fcos_improvement_tickets is 'Universal FCOS bug and feature-request queue; FCOS server APIs are the only browser access path.';
comment on table public.fcos_improvement_proposals is 'Moderated comments and workflow changes; only the active UUID-backed General Manager may approve or reject.';
