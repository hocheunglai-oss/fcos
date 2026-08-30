-- Ship-Agent Final Charges is deliberately a service-only workflow ledger.
-- Salesforce remains the only financial-record system of record: this schema
-- stores identities, workflow state, dates and change fingerprints only.

create extension if not exists pgcrypto;

create table if not exists public.ship_agent_charge_cases (
  id uuid primary key default gen_random_uuid(),
  stem_id text not null unique check (btrim(stem_id) <> '' and char_length(stem_id) <= 18),
  stem_name text null check (stem_name is null or char_length(stem_name) <= 255),
  workflow_status text not null default 'needs_action'
    check (workflow_status in ('needs_action', 'awaiting_delivery', 'ready_for_invoice', 'post_invoice_change', 'completed')),
  confirmation_status text not null default 'pending'
    check (confirmation_status in ('pending', 'confirmed', 'invalidated')),
  delivery_date date null,
  due_date date null,
  assigned_buyer_user_id uuid null references public.user_profiles(id) on delete set null,
  assigned_buyer_name text null check (assigned_buyer_name is null or char_length(assigned_buyer_name) <= 255),
  assigned_buyer_email text null check (assigned_buyer_email is null or char_length(assigned_buyer_email) <= 320),
  assignment_source text null check (assignment_source is null or assignment_source in ('nomination_email', 'nomination_name', 'manual_gm_override', 'unresolved')),
  override_expires_at timestamptz null,
  source_fingerprint text not null default '' check (char_length(source_fingerprint) <= 256),
  supplier_fingerprint text not null default '' check (char_length(supplier_fingerprint) <= 256),
  salesforce_stem_last_modified_at timestamptz null,
  invoice_state text not null default 'not_invoiced' check (invoice_state in ('not_invoiced', 'invoiced')),
  post_invoice_detected_at timestamptz null,
  post_invoice_resolution text null check (post_invoice_resolution is null or post_invoice_resolution in ('no_adjustment', 'revised_invoice', 'credit_note')),
  post_invoice_reference text null check (post_invoice_reference is null or char_length(post_invoice_reference) between 1 and 300),
  post_invoice_note text null check (post_invoice_note is null or char_length(post_invoice_note) <= 1000),
  last_confirmation_id uuid null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((workflow_status <> 'ready_for_invoice') or confirmation_status = 'confirmed'),
  check ((workflow_status <> 'post_invoice_change') or invoice_state = 'invoiced')
);

create table if not exists public.ship_agent_charge_confirmations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ship_agent_charge_cases(id) on delete restrict,
  case_revision bigint not null check (case_revision > 0),
  reviewed_source_fingerprint text not null check (btrim(reviewed_source_fingerprint) <> '' and char_length(reviewed_source_fingerprint) <= 256),
  row_by_row_reviewed boolean not null,
  charge_to_buyer boolean not null,
  reference_or_note text null check (reference_or_note is null or char_length(reference_or_note) between 1 and 1000),
  evidence_present boolean not null default false,
  confirmed_by uuid not null references public.user_profiles(id) on delete restrict,
  confirmed_by_email text not null check (btrim(confirmed_by_email) <> '' and char_length(confirmed_by_email) <= 320),
  override_reason_recorded boolean not null default false,
  created_at timestamptz not null default now(),
  check (row_by_row_reviewed),
  check (evidence_present or reference_or_note is not null)
);

alter table public.ship_agent_charge_cases
  add constraint ship_agent_charge_cases_last_confirmation_fkey
  foreign key (last_confirmation_id) references public.ship_agent_charge_confirmations(id) on delete set null;

create table if not exists public.ship_agent_charge_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ship_agent_charge_cases(id) on delete restrict,
  event_type text not null check (event_type in ('synced', 'confirmation_invalidated', 'confirmed', 'gm_assignment_override', 'post_invoice_change_detected', 'post_invoice_resolved', 'notification_state_changed')),
  event_key text not null check (btrim(event_key) <> '' and char_length(event_key) <= 300),
  summary text not null default '' check (char_length(summary) <= 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null check (actor_email is null or char_length(actor_email) <= 320),
  created_at timestamptz not null default now(),
  unique (case_id, event_key)
);

create table if not exists public.ship_agent_charge_operations (
  operation_id uuid primary key,
  operation_type text not null check (operation_type in ('sync', 'confirm', 'gm_override', 'post_invoice_resolution', 'salesforce_write')),
  stem_id text not null check (btrim(stem_id) <> '' and char_length(stem_id) <= 18),
  request_fingerprint text not null check (btrim(request_fingerprint) <> '' and char_length(request_fingerprint) <= 256),
  status text not null default 'reserved' check (status in ('reserved', 'salesforce_written', 'succeeded', 'failed', 'uncertain')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  check ((status in ('reserved', 'salesforce_written') and completed_at is null) or (status in ('succeeded', 'failed', 'uncertain') and completed_at is not null))
);

create table if not exists public.ship_agent_charge_notification_states (
  notification_key text not null check (btrim(notification_key) <> '' and char_length(notification_key) <= 300),
  case_id uuid not null references public.ship_agent_charge_cases(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  read_at timestamptz null,
  handled_at timestamptz null,
  snoozed_until timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (notification_key, user_id)
);

create index if not exists ship_agent_charge_cases_status_due_idx
  on public.ship_agent_charge_cases(workflow_status, due_date, updated_at desc);
create index if not exists ship_agent_charge_cases_assignee_idx
  on public.ship_agent_charge_cases(assigned_buyer_user_id, workflow_status, due_date);
create index if not exists ship_agent_charge_cases_invoice_change_idx
  on public.ship_agent_charge_cases(invoice_state, post_invoice_resolution, updated_at desc);
create index if not exists ship_agent_charge_confirmations_case_idx
  on public.ship_agent_charge_confirmations(case_id, created_at desc);
create index if not exists ship_agent_charge_events_case_idx
  on public.ship_agent_charge_events(case_id, created_at desc);
create index if not exists ship_agent_charge_operations_stem_idx
  on public.ship_agent_charge_operations(stem_id, created_at desc);
create index if not exists ship_agent_charge_notification_states_user_idx
  on public.ship_agent_charge_notification_states(user_id, handled_at, snoozed_until, read_at, updated_at desc);

create or replace function public.ship_agent_charge_active_actor(
  p_actor_user_id uuid,
  p_actor_email text default null
)
returns public.user_profiles
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor public.user_profiles%rowtype;
begin
  if p_actor_user_id is null then
    raise exception 'An active FCOS user is required.' using errcode = '42501';
  end if;
  select * into v_actor
  from public.user_profiles
  where id = p_actor_user_id and active
  for share;
  if not found then
    raise exception 'An active FCOS user is required.' using errcode = '42501';
  end if;
  if p_actor_email is not null and lower(btrim(p_actor_email)) is distinct from lower(v_actor.email) then
    raise exception 'The active FCOS user does not match the requested actor.' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.ship_agent_charge_require_general_manager(
  p_actor_user_id uuid,
  p_actor_email text
)
returns public.user_profiles
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_general_manager_ids uuid[];
begin
  v_actor := public.ship_agent_charge_active_actor(p_actor_user_id, p_actor_email);
  select array_agg(role_row.user_id order by role_row.user_id)
  into v_general_manager_ids
  from public.collaboration_roles role_row
  join public.user_profiles profile on profile.id = role_row.user_id
  where role_row.role = 'general_manager'
    and role_row.active
    and profile.active;
  if coalesce(cardinality(v_general_manager_ids), 0) <> 1
     or v_general_manager_ids[1] <> v_actor.id
     or v_actor.user_type <> 'general_manager' then
    raise exception 'Only the active UUID-backed General Manager may perform this override.' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.ship_agent_charge_assert_event_metadata(p_metadata jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Ship-Agent event metadata must be an object.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_metadata, '{}'::jsonb)) loop
    if v_key not in ('caseState', 'previousState', 'reasonProvided', 'evidencePresent', 'chargeToBuyer', 'resolution', 'sourceChanged', 'assignmentChanged', 'notificationState', 'operationStatus') then
      raise exception 'Ship-Agent event metadata may contain only redacted workflow fields.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.ship_agent_charge_case_before_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id or new.stem_id <> old.stem_id or new.created_at <> old.created_at then
    raise exception 'Ship-Agent case identity is immutable.' using errcode = '23514';
  end if;
  if new.revision <> old.revision then
    raise exception 'Ship-Agent case revision is managed by the database.' using errcode = '23514';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.ship_agent_charge_confirmation_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Ship-Agent confirmations are immutable.' using errcode = '23514';
end;
$$;

create or replace function public.ship_agent_charge_event_protect()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Ship-Agent events are immutable.' using errcode = '23514';
  end if;
  perform public.ship_agent_charge_assert_event_metadata(new.metadata);
  return new;
end;
$$;

create or replace function public.ship_agent_charge_operation_before_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.operation_id <> old.operation_id
     or new.operation_type <> old.operation_type
     or new.stem_id <> old.stem_id
     or new.request_fingerprint <> old.request_fingerprint
     or new.actor_user_id <> old.actor_user_id then
    raise exception 'Ship-Agent operation identity is immutable.' using errcode = '23514';
  end if;
  if old.status not in ('reserved', 'salesforce_written') then
    raise exception 'A completed Ship-Agent operation is immutable.' using errcode = '23514';
  end if;
  if new.status not in ('salesforce_written', 'succeeded', 'failed', 'uncertain')
     or (old.status = 'salesforce_written' and new.status = 'salesforce_written') then
    raise exception 'A Ship-Agent operation status transition is invalid.' using errcode = '23514';
  end if;
  if new.status = 'salesforce_written' then
    new.completed_at := null;
  elsif new.completed_at is null then
    new.completed_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function public.ship_agent_charge_notification_before_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.notification_key <> old.notification_key or new.user_id <> old.user_id or new.case_id <> old.case_id then
    raise exception 'Ship-Agent notification identity is immutable.' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists ship_agent_charge_cases_revision_guard on public.ship_agent_charge_cases;
create trigger ship_agent_charge_cases_revision_guard
before update on public.ship_agent_charge_cases
for each row execute function public.ship_agent_charge_case_before_update();

drop trigger if exists ship_agent_charge_confirmations_immutable on public.ship_agent_charge_confirmations;
create trigger ship_agent_charge_confirmations_immutable
before update or delete on public.ship_agent_charge_confirmations
for each row execute function public.ship_agent_charge_confirmation_immutable();

drop trigger if exists ship_agent_charge_events_protect on public.ship_agent_charge_events;
create trigger ship_agent_charge_events_protect
before insert or update or delete on public.ship_agent_charge_events
for each row execute function public.ship_agent_charge_event_protect();

drop trigger if exists ship_agent_charge_operations_protect on public.ship_agent_charge_operations;
create trigger ship_agent_charge_operations_protect
before update on public.ship_agent_charge_operations
for each row execute function public.ship_agent_charge_operation_before_update();

drop trigger if exists ship_agent_charge_notification_state_guard on public.ship_agent_charge_notification_states;
create trigger ship_agent_charge_notification_state_guard
before update on public.ship_agent_charge_notification_states
for each row execute function public.ship_agent_charge_notification_before_update();

create or replace function public.reserve_ship_agent_charge_operation(
  p_operation_id uuid,
  p_operation_type text,
  p_stem_id text,
  p_request_fingerprint text,
  p_actor_user_id uuid
)
returns public.ship_agent_charge_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.ship_agent_charge_operations%rowtype;
begin
  perform public.ship_agent_charge_active_actor(p_actor_user_id, null);
  if p_operation_id is null
     or p_operation_type not in ('sync', 'confirm', 'gm_override', 'post_invoice_resolution', 'salesforce_write')
     or nullif(btrim(p_stem_id), '') is null
     or nullif(btrim(p_request_fingerprint), '') is null then
    raise exception 'A valid Ship-Agent operation identity, type, STEM, and request fingerprint are required.' using errcode = '22023';
  end if;
  insert into public.ship_agent_charge_operations (
    operation_id, operation_type, stem_id, request_fingerprint, actor_user_id
  ) values (
    p_operation_id, p_operation_type, btrim(p_stem_id), btrim(p_request_fingerprint), p_actor_user_id
  ) on conflict (operation_id) do nothing
  returning * into v_operation;
  if found then return v_operation; end if;

  select * into v_operation
  from public.ship_agent_charge_operations
  where operation_id = p_operation_id
  for update;
  if v_operation.request_fingerprint <> btrim(p_request_fingerprint)
     or v_operation.operation_type <> p_operation_type
     or v_operation.stem_id <> btrim(p_stem_id)
     or v_operation.actor_user_id <> p_actor_user_id then
    raise exception 'This Ship-Agent operation identity was already used for a different request.' using errcode = '40001';
  end if;
  return v_operation;
end;
$$;

create or replace function public.complete_ship_agent_charge_operation(
  p_operation_id uuid,
  p_result jsonb,
  p_status text default 'succeeded'
)
returns public.ship_agent_charge_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.ship_agent_charge_operations%rowtype;
  v_key text;
begin
  if p_operation_id is null or p_status not in ('salesforce_written', 'succeeded', 'failed', 'uncertain') or jsonb_typeof(coalesce(p_result, '{}'::jsonb)) <> 'object' then
    raise exception 'A valid completed Ship-Agent operation result is required.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_result, '{}'::jsonb)) loop
    if v_key not in ('caseId', 'stemId', 'revision', 'status', 'eventId', 'duplicate', 'errorCode', 'sourceFingerprint') then
      raise exception 'Ship-Agent operation results may contain only redacted workflow fields.' using errcode = '22023';
    end if;
  end loop;
  select * into v_operation from public.ship_agent_charge_operations where operation_id = p_operation_id for update;
  if not found then raise exception 'The Ship-Agent operation is unavailable.' using errcode = 'P0002'; end if;
  if v_operation.status in ('succeeded', 'failed', 'uncertain') then return v_operation; end if;
  update public.ship_agent_charge_operations
  set status = p_status, result = coalesce(p_result, '{}'::jsonb), completed_at = clock_timestamp()
  where operation_id = p_operation_id
  returning * into v_operation;
  return v_operation;
end;
$$;

create or replace function public.sync_ship_agent_charge_case(
  p_case jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.ship_agent_charge_cases%rowtype;
  v_event public.ship_agent_charge_events%rowtype;
  v_existing public.ship_agent_charge_cases%rowtype;
  v_key text;
  v_stem_id text;
  v_source_changed boolean := false;
  v_event_key text;
  v_event_type text;
  v_metadata jsonb;
  v_expected_revision bigint;
  v_actor public.user_profiles%rowtype;
begin
  if jsonb_typeof(coalesce(p_case, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_event, '{}'::jsonb)) <> 'object' then
    raise exception 'Ship-Agent sync payloads must be objects.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_case) loop
    if v_key not in ('stemId', 'stemName', 'workflowStatus', 'deliveryDate', 'dueDate', 'assignedBuyerUserId', 'assignedBuyerName', 'assignedBuyerEmail', 'assignmentSource', 'sourceFingerprint', 'supplierFingerprint', 'salesforceStemLastModifiedAt', 'invoiceState', 'postInvoiceDetectedAt', 'expectedRevision', 'actorUserId', 'actorEmail') then
      raise exception 'Ship-Agent sync payload contains an unsupported field.' using errcode = '22023';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_event) loop
    if v_key not in ('eventType', 'eventKey', 'summary', 'metadata') then
      raise exception 'Ship-Agent event payload contains an unsupported field.' using errcode = '22023';
    end if;
  end loop;
  if nullif(p_case->>'actorUserId', '') is not null then
    v_actor := public.ship_agent_charge_active_actor((p_case->>'actorUserId')::uuid, p_case->>'actorEmail');
  end if;
  v_stem_id := btrim(coalesce(p_case->>'stemId', ''));
  if v_stem_id = '' or btrim(coalesce(p_case->>'sourceFingerprint', '')) = '' then
    raise exception 'A STEM identity and live source fingerprint are required.' using errcode = '22023';
  end if;
  v_expected_revision := nullif(p_case->>'expectedRevision', '')::bigint;
  v_event_key := btrim(coalesce(p_event->>'eventKey', 'sync:' || v_stem_id || ':' || p_case->>'sourceFingerprint'));
  v_event_type := coalesce(nullif(p_event->>'eventType', ''), 'synced');
  if v_event_type not in ('synced', 'confirmation_invalidated', 'post_invoice_change_detected') then
    raise exception 'Ship-Agent sync event type is invalid.' using errcode = '22023';
  end if;
  v_metadata := coalesce(p_event->'metadata', '{}'::jsonb);
  perform public.ship_agent_charge_assert_event_metadata(v_metadata);

  select * into v_existing from public.ship_agent_charge_cases where stem_id = v_stem_id for update;
  if found and v_expected_revision is not null and v_existing.revision <> v_expected_revision then
    raise exception 'This Ship-Agent case changed after it was opened. Refresh and review the latest case.' using errcode = '40001';
  end if;
  if found then
    v_source_changed := v_existing.source_fingerprint <> p_case->>'sourceFingerprint'
      or v_existing.supplier_fingerprint <> coalesce(p_case->>'supplierFingerprint', '');
    if v_source_changed
       or v_existing.stem_name is distinct from nullif(btrim(p_case->>'stemName'), '')
       or v_existing.delivery_date is distinct from nullif(p_case->>'deliveryDate', '')::date
       or v_existing.due_date is distinct from nullif(p_case->>'dueDate', '')::date
       or (not (v_existing.assignment_source = 'manual_gm_override' and v_existing.override_expires_at > clock_timestamp()) and (
         v_existing.assigned_buyer_user_id is distinct from nullif(p_case->>'assignedBuyerUserId', '')::uuid
         or v_existing.assigned_buyer_name is distinct from nullif(btrim(p_case->>'assignedBuyerName'), '')
         or v_existing.assigned_buyer_email is distinct from nullif(lower(btrim(p_case->>'assignedBuyerEmail')), '')
         or v_existing.assignment_source is distinct from nullif(p_case->>'assignmentSource', '')
       ))
       or v_existing.salesforce_stem_last_modified_at is distinct from nullif(p_case->>'salesforceStemLastModifiedAt', '')::timestamptz
       or v_existing.invoice_state is distinct from coalesce(nullif(p_case->>'invoiceState', ''), v_existing.invoice_state)
       or (not v_source_changed and v_existing.workflow_status is distinct from coalesce(nullif(p_case->>'workflowStatus', ''), v_existing.workflow_status)) then
      update public.ship_agent_charge_cases set
        stem_name = nullif(btrim(p_case->>'stemName'), ''),
        delivery_date = nullif(p_case->>'deliveryDate', '')::date,
        due_date = nullif(p_case->>'dueDate', '')::date,
        assigned_buyer_user_id = case when assignment_source = 'manual_gm_override' and override_expires_at > clock_timestamp() then assigned_buyer_user_id else nullif(p_case->>'assignedBuyerUserId', '')::uuid end,
        assigned_buyer_name = case when assignment_source = 'manual_gm_override' and override_expires_at > clock_timestamp() then assigned_buyer_name else nullif(btrim(p_case->>'assignedBuyerName'), '') end,
        assigned_buyer_email = case when assignment_source = 'manual_gm_override' and override_expires_at > clock_timestamp() then assigned_buyer_email else nullif(lower(btrim(p_case->>'assignedBuyerEmail')), '') end,
        assignment_source = case when assignment_source = 'manual_gm_override' and override_expires_at > clock_timestamp() then assignment_source else nullif(p_case->>'assignmentSource', '') end,
        override_expires_at = case when assignment_source = 'manual_gm_override' and override_expires_at > clock_timestamp() then override_expires_at else null end,
        source_fingerprint = p_case->>'sourceFingerprint',
        supplier_fingerprint = coalesce(p_case->>'supplierFingerprint', ''),
        salesforce_stem_last_modified_at = nullif(p_case->>'salesforceStemLastModifiedAt', '')::timestamptz,
        invoice_state = coalesce(nullif(p_case->>'invoiceState', ''), v_existing.invoice_state),
        post_invoice_detected_at = case when v_source_changed and coalesce(nullif(p_case->>'invoiceState', ''), v_existing.invoice_state) = 'invoiced' then coalesce(post_invoice_detected_at, clock_timestamp()) else post_invoice_detected_at end,
        post_invoice_resolution = case when v_source_changed then null else post_invoice_resolution end,
        post_invoice_reference = case when v_source_changed then null else post_invoice_reference end,
        post_invoice_note = case when v_source_changed then null else post_invoice_note end,
        confirmation_status = case when v_source_changed then 'invalidated' else confirmation_status end,
        workflow_status = case
          when v_source_changed and coalesce(nullif(p_case->>'invoiceState', ''), v_existing.invoice_state) = 'invoiced' then 'post_invoice_change'
          when v_source_changed then 'needs_action'
          else coalesce(nullif(p_case->>'workflowStatus', ''), workflow_status)
        end
      where id = v_existing.id
      returning * into v_case;
    else
      v_case := v_existing;
    end if;
  else
    insert into public.ship_agent_charge_cases (
      stem_id, stem_name, workflow_status, confirmation_status, delivery_date, due_date,
      assigned_buyer_user_id, assigned_buyer_name, assigned_buyer_email, assignment_source,
      source_fingerprint, supplier_fingerprint, salesforce_stem_last_modified_at, invoice_state, post_invoice_detected_at
    ) values (
      v_stem_id, nullif(btrim(p_case->>'stemName'), ''), coalesce(nullif(p_case->>'workflowStatus', ''), 'needs_action'), 'pending',
      nullif(p_case->>'deliveryDate', '')::date, nullif(p_case->>'dueDate', '')::date,
      nullif(p_case->>'assignedBuyerUserId', '')::uuid, nullif(btrim(p_case->>'assignedBuyerName'), ''), nullif(lower(btrim(p_case->>'assignedBuyerEmail')), ''), nullif(p_case->>'assignmentSource', ''),
      p_case->>'sourceFingerprint', coalesce(p_case->>'supplierFingerprint', ''), nullif(p_case->>'salesforceStemLastModifiedAt', '')::timestamptz,
      coalesce(nullif(p_case->>'invoiceState', ''), 'not_invoiced'), nullif(p_case->>'postInvoiceDetectedAt', '')::timestamptz
    ) returning * into v_case;
  end if;
  insert into public.ship_agent_charge_events (case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email)
  values (v_case.id, case when v_source_changed then case when v_case.invoice_state = 'invoiced' then 'post_invoice_change_detected' else 'confirmation_invalidated' end else v_event_type end,
    v_event_key, left(coalesce(nullif(p_event->>'summary', ''), 'Ship-Agent case synchronized.'), 500),
    v_metadata || jsonb_build_object('sourceChanged', v_source_changed, 'caseState', v_case.workflow_status),
    v_actor.id, v_actor.email)
  on conflict (case_id, event_key) do nothing
  returning * into v_event;
  return jsonb_build_object('case', to_jsonb(v_case), 'event', to_jsonb(v_event), 'sourceChanged', v_source_changed);
end;
$$;

create or replace function public.confirm_ship_agent_charge_case(
  p_stem_id text,
  p_expected_revision bigint,
  p_expected_fingerprint text,
  p_confirmation jsonb,
  p_event jsonb,
  p_operation_id uuid,
  p_request_fingerprint text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.ship_agent_charge_cases%rowtype;
  v_confirmation public.ship_agent_charge_confirmations%rowtype;
  v_event public.ship_agent_charge_events%rowtype;
  v_operation public.ship_agent_charge_operations%rowtype;
  v_actor public.user_profiles%rowtype;
  v_is_general_manager boolean := false;
  v_key text;
  v_reference text;
  v_event_key text;
begin
  v_actor := public.ship_agent_charge_active_actor(p_actor_user_id, p_actor_email);
  if nullif(btrim(p_stem_id), '') is null or p_expected_revision is null or nullif(btrim(p_expected_fingerprint), '') is null or jsonb_typeof(coalesce(p_confirmation, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_event, '{}'::jsonb)) <> 'object' then
    raise exception 'A STEM, expected case revision and fingerprint, confirmation, and event are required.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_confirmation) loop
    if v_key not in ('chargeToBuyer', 'rowByRowReviewed', 'reviewedSourceFingerprint', 'referenceOrNote', 'evidencePresent') then
      raise exception 'Ship-Agent confirmation contains an unsupported field.' using errcode = '22023';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_event) loop
    if v_key not in ('eventKey', 'summary', 'metadata') then raise exception 'Ship-Agent confirmation event contains an unsupported field.' using errcode = '22023'; end if;
  end loop;
  perform public.ship_agent_charge_assert_event_metadata(coalesce(p_event->'metadata', '{}'::jsonb));
  v_operation := public.reserve_ship_agent_charge_operation(p_operation_id, 'confirm', p_stem_id, p_request_fingerprint, p_actor_user_id);
  select * into v_case from public.ship_agent_charge_cases where stem_id = btrim(p_stem_id) for update;
  if not found then raise exception 'The Ship-Agent case is unavailable.' using errcode = 'P0002'; end if;
  if v_operation.status = 'succeeded' then return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', true); end if;
  if v_operation.status not in ('reserved', 'salesforce_written') then raise exception 'The Ship-Agent operation cannot be resumed safely.' using errcode = '40001'; end if;
  if v_operation.status = 'salesforce_written'
     and v_case.confirmation_status = 'confirmed'
     and v_case.source_fingerprint = p_confirmation->>'reviewedSourceFingerprint'
     and exists (
       select 1 from public.ship_agent_charge_events
       where case_id = v_case.id and event_key = 'confirm:' || p_operation_id::text
     ) then
    return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', true, 'databaseConfirmed', true);
  end if;
  if v_case.revision <> p_expected_revision or v_case.source_fingerprint <> p_expected_fingerprint then
    raise exception 'This Ship-Agent case changed after it was opened. Refresh and review every row again.' using errcode = '40001';
  end if;
  if v_case.invoice_state = 'invoiced' then raise exception 'An invoiced Ship-Agent case must be resolved as a post-invoice change.' using errcode = '23514'; end if;
  if v_case.assigned_buyer_user_id is distinct from v_actor.id
     or lower(coalesce(v_actor.user_type, '')) in ('finance', 'administrator', 'general_manager') then
    perform public.ship_agent_charge_require_general_manager(p_actor_user_id, p_actor_email);
    v_is_general_manager := true;
    if char_length(btrim(coalesce(p_override_reason, ''))) < 5 then raise exception 'A General Manager confirmation override requires a reason.' using errcode = '22023'; end if;
  end if;
  if coalesce((p_confirmation->>'rowByRowReviewed')::boolean, false) is not true
     or btrim(coalesce(p_confirmation->>'reviewedSourceFingerprint', '')) = ''
     or not (p_confirmation ? 'chargeToBuyer') then
    raise exception 'Review every current Ship-Agent row and make a buyer-charge decision before confirming.' using errcode = '22023';
  end if;
  v_reference := nullif(btrim(p_confirmation->>'referenceOrNote'), '');
  if v_reference is null and coalesce((p_confirmation->>'evidencePresent')::boolean, false) is not true then
    raise exception 'A Ship-Agent confirmation requires a reference or note, or Salesforce File evidence.' using errcode = '22023';
  end if;
  insert into public.ship_agent_charge_confirmations (case_id, case_revision, reviewed_source_fingerprint, row_by_row_reviewed, charge_to_buyer, reference_or_note, evidence_present, confirmed_by, confirmed_by_email, override_reason_recorded)
  values (v_case.id, v_case.revision, p_confirmation->>'reviewedSourceFingerprint', true, (p_confirmation->>'chargeToBuyer')::boolean, v_reference, coalesce((p_confirmation->>'evidencePresent')::boolean, false), v_actor.id, v_actor.email, v_is_general_manager)
  returning * into v_confirmation;
  update public.ship_agent_charge_cases
  set workflow_status = 'ready_for_invoice', confirmation_status = 'confirmed', source_fingerprint = p_confirmation->>'reviewedSourceFingerprint', last_confirmation_id = v_confirmation.id
  where id = v_case.id
  returning * into v_case;
  v_event_key := coalesce(nullif(btrim(p_event->>'eventKey'), ''), 'confirm:' || p_operation_id::text);
  insert into public.ship_agent_charge_events (case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email)
  values (v_case.id, 'confirmed', v_event_key, left(coalesce(nullif(p_event->>'summary', ''), 'Ship-Agent charges confirmed.'), 500),
    coalesce(p_event->'metadata', '{}'::jsonb) || jsonb_build_object('caseState', v_case.workflow_status, 'chargeToBuyer', (p_confirmation->>'chargeToBuyer')::boolean, 'evidencePresent', coalesce((p_confirmation->>'evidencePresent')::boolean, false), 'reasonProvided', v_is_general_manager),
    v_actor.id, v_actor.email)
  on conflict (case_id, event_key) do nothing
  returning * into v_event;
  return jsonb_build_object('case', to_jsonb(v_case), 'confirmation', to_jsonb(v_confirmation), 'event', to_jsonb(v_event), 'duplicate', false);
end;
$$;

create or replace function public.override_ship_agent_charge_assignment(
  p_stem_id text,
  p_assignee_user_id uuid,
  p_reason text,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_request_fingerprint text,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.ship_agent_charge_cases%rowtype;
  v_assignee public.user_profiles%rowtype;
  v_event public.ship_agent_charge_events%rowtype;
  v_operation public.ship_agent_charge_operations%rowtype;
  v_actor public.user_profiles%rowtype;
begin
  v_actor := public.ship_agent_charge_require_general_manager(p_actor_user_id, p_actor_email);
  if nullif(btrim(p_stem_id), '') is null or p_assignee_user_id is null or p_expected_revision is null or char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A STEM, active assignee, expected revision, and General Manager reason are required.' using errcode = '22023';
  end if;
  select * into v_assignee
  from public.user_profiles
  where id = p_assignee_user_id
    and active
    and lower(coalesce(user_type, '')) not in ('finance', 'administrator', 'general_manager')
  for share;
  if not found then raise exception 'The reassigned Buyer Trader must be an active FCOS user.' using errcode = '22023'; end if;
  v_operation := public.reserve_ship_agent_charge_operation(p_operation_id, 'gm_override', p_stem_id, p_request_fingerprint, p_actor_user_id);
  select * into v_case from public.ship_agent_charge_cases where stem_id = btrim(p_stem_id) for update;
  if not found then raise exception 'The Ship-Agent case is unavailable.' using errcode = 'P0002'; end if;
  if v_operation.status = 'succeeded' then return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', true); end if;
  if v_case.revision <> p_expected_revision then raise exception 'This Ship-Agent case changed after it was opened. Refresh and review the latest case.' using errcode = '40001'; end if;
  update public.ship_agent_charge_cases
  set assigned_buyer_user_id = v_assignee.id, assigned_buyer_name = v_assignee.full_name, assigned_buyer_email = v_assignee.email,
      assignment_source = 'manual_gm_override', override_expires_at = clock_timestamp() + interval '1 day', confirmation_status = 'invalidated',
      workflow_status = case when invoice_state = 'invoiced' then 'post_invoice_change' else 'needs_action' end
  where id = v_case.id
  returning * into v_case;
  insert into public.ship_agent_charge_events (case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email)
  values (v_case.id, 'gm_assignment_override', 'gm-override:' || p_operation_id::text, 'General Manager reassigned the Ship-Agent case.', jsonb_build_object('assignmentChanged', true, 'reasonProvided', true, 'caseState', v_case.workflow_status), v_actor.id, v_actor.email)
  returning * into v_event;
  perform public.complete_ship_agent_charge_operation(p_operation_id, jsonb_build_object('caseId', v_case.id, 'stemId', v_case.stem_id, 'revision', v_case.revision, 'status', v_case.workflow_status, 'eventId', v_event.id));
  return jsonb_build_object('case', to_jsonb(v_case), 'event', to_jsonb(v_event), 'duplicate', false);
end;
$$;

create or replace function public.resolve_ship_agent_post_invoice_change(
  p_stem_id text,
  p_resolution text,
  p_reference text,
  p_note text,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_request_fingerprint text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.ship_agent_charge_cases%rowtype;
  v_event public.ship_agent_charge_events%rowtype;
  v_operation public.ship_agent_charge_operations%rowtype;
  v_actor public.user_profiles%rowtype;
begin
  v_actor := public.ship_agent_charge_active_actor(p_actor_user_id, p_actor_email);
  if nullif(btrim(p_stem_id), '') is null or p_resolution not in ('no_adjustment', 'revised_invoice', 'credit_note') or nullif(btrim(p_reference), '') is null or p_expected_revision is null then
    raise exception 'A STEM, post-invoice resolution, reference, and expected revision are required.' using errcode = '22023';
  end if;
  if char_length(btrim(p_reference)) > 300 or char_length(coalesce(p_note, '')) > 1000 then raise exception 'The post-invoice reference or note is too long.' using errcode = '22023'; end if;
  v_operation := public.reserve_ship_agent_charge_operation(p_operation_id, 'post_invoice_resolution', p_stem_id, p_request_fingerprint, p_actor_user_id);
  select * into v_case from public.ship_agent_charge_cases where stem_id = btrim(p_stem_id) for update;
  if not found then raise exception 'The Ship-Agent case is unavailable.' using errcode = 'P0002'; end if;
  if v_operation.status = 'succeeded' then return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', true); end if;
  if v_case.revision <> p_expected_revision then raise exception 'This Ship-Agent case changed after it was opened. Refresh and review the latest case.' using errcode = '40001'; end if;
  if v_case.workflow_status <> 'post_invoice_change' or v_case.invoice_state <> 'invoiced' then raise exception 'Only an active post-invoice Ship-Agent change may be resolved.' using errcode = '23514'; end if;
  if v_case.assigned_buyer_user_id is distinct from v_actor.id
     or lower(coalesce(v_actor.user_type, '')) in ('finance', 'administrator', 'general_manager') then
    perform public.ship_agent_charge_require_general_manager(p_actor_user_id, p_actor_email);
    if char_length(btrim(coalesce(p_override_reason, ''))) < 5 then
      raise exception 'A General Manager post-invoice override requires a reason.' using errcode = '22023';
    end if;
  end if;
  update public.ship_agent_charge_cases
  set workflow_status = 'completed', post_invoice_resolution = p_resolution, post_invoice_reference = btrim(p_reference), post_invoice_note = nullif(btrim(p_note), '')
  where id = v_case.id
  returning * into v_case;
  insert into public.ship_agent_charge_events (case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email)
  values (v_case.id, 'post_invoice_resolved', 'post-invoice-resolution:' || p_operation_id::text, 'Post-invoice Ship-Agent change resolved.', jsonb_build_object('resolution', p_resolution, 'caseState', v_case.workflow_status, 'reasonProvided', v_case.assigned_buyer_user_id is distinct from v_actor.id or lower(coalesce(v_actor.user_type, '')) = 'general_manager'), v_actor.id, v_actor.email)
  returning * into v_event;
  perform public.complete_ship_agent_charge_operation(p_operation_id, jsonb_build_object('caseId', v_case.id, 'stemId', v_case.stem_id, 'revision', v_case.revision, 'status', v_case.workflow_status, 'eventId', v_event.id));
  return jsonb_build_object('case', to_jsonb(v_case), 'event', to_jsonb(v_event), 'duplicate', false);
end;
$$;

create or replace function public.set_ship_agent_charge_notification_state(
  p_notification_key text,
  p_case_id uuid,
  p_user_id uuid,
  p_state text,
  p_snoozed_until timestamptz default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated integer := 0;
begin
  perform public.ship_agent_charge_active_actor(p_user_id, null);
  if nullif(btrim(p_notification_key), '') is null or p_case_id is null or p_state not in ('read', 'unread', 'handled', 'unhandled', 'snoozed') then
    raise exception 'A valid Ship-Agent notification state is required.' using errcode = '22023';
  end if;
  if split_part(btrim(p_notification_key), ':', 1) <> p_case_id::text
     or not exists (select 1 from public.ship_agent_charge_cases where id = p_case_id) then
    raise exception 'The Ship-Agent notification does not match its case.' using errcode = '22023';
  end if;
  if p_state = 'snoozed' and (p_snoozed_until is null or p_snoozed_until <= clock_timestamp()) then
    raise exception 'A future snooze time is required.' using errcode = '22023';
  end if;
  insert into public.ship_agent_charge_notification_states (notification_key, case_id, user_id, read_at, handled_at, snoozed_until)
  values (btrim(p_notification_key), p_case_id, p_user_id,
    case when p_state = 'unread' then null else clock_timestamp() end,
    case when p_state = 'handled' then clock_timestamp() else null end,
    case when p_state = 'snoozed' then p_snoozed_until else null end)
  on conflict (notification_key, user_id) do update set
    read_at = case when p_state = 'read' then clock_timestamp() when p_state = 'unread' then null else ship_agent_charge_notification_states.read_at end,
    handled_at = case when p_state = 'handled' then clock_timestamp() when p_state = 'unhandled' then null else ship_agent_charge_notification_states.handled_at end,
    snoozed_until = case when p_state = 'snoozed' then p_snoozed_until else ship_agent_charge_notification_states.snoozed_until end;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

alter table public.ship_agent_charge_cases enable row level security;
alter table public.ship_agent_charge_confirmations enable row level security;
alter table public.ship_agent_charge_events enable row level security;
alter table public.ship_agent_charge_operations enable row level security;
alter table public.ship_agent_charge_notification_states enable row level security;

revoke all on table public.ship_agent_charge_cases from public, anon, authenticated;
revoke all on table public.ship_agent_charge_confirmations from public, anon, authenticated;
revoke all on table public.ship_agent_charge_events from public, anon, authenticated;
revoke all on table public.ship_agent_charge_operations from public, anon, authenticated;
revoke all on table public.ship_agent_charge_notification_states from public, anon, authenticated;
grant all on table public.ship_agent_charge_cases to service_role;
grant all on table public.ship_agent_charge_confirmations to service_role;
grant all on table public.ship_agent_charge_events to service_role;
grant all on table public.ship_agent_charge_operations to service_role;
grant all on table public.ship_agent_charge_notification_states to service_role;

revoke all on function public.ship_agent_charge_active_actor(uuid, text) from public, anon, authenticated;
revoke all on function public.ship_agent_charge_require_general_manager(uuid, text) from public, anon, authenticated;
revoke all on function public.ship_agent_charge_assert_event_metadata(jsonb) from public, anon, authenticated;
revoke all on function public.reserve_ship_agent_charge_operation(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_ship_agent_charge_operation(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.sync_ship_agent_charge_case(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_ship_agent_charge_case(text, bigint, text, jsonb, jsonb, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.override_ship_agent_charge_assignment(text, uuid, text, bigint, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_ship_agent_post_invoice_change(text, text, text, text, bigint, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_ship_agent_charge_notification_state(text, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ship_agent_charge_active_actor(uuid, text) to service_role;
grant execute on function public.ship_agent_charge_require_general_manager(uuid, text) to service_role;
grant execute on function public.ship_agent_charge_assert_event_metadata(jsonb) to service_role;
grant execute on function public.reserve_ship_agent_charge_operation(uuid, text, text, text, uuid) to service_role;
grant execute on function public.complete_ship_agent_charge_operation(uuid, jsonb, text) to service_role;
grant execute on function public.sync_ship_agent_charge_case(jsonb, jsonb) to service_role;
grant execute on function public.confirm_ship_agent_charge_case(text, bigint, text, jsonb, jsonb, uuid, text, uuid, text, text) to service_role;
grant execute on function public.override_ship_agent_charge_assignment(text, uuid, text, bigint, uuid, text, uuid, text) to service_role;
grant execute on function public.resolve_ship_agent_post_invoice_change(text, text, text, text, bigint, uuid, text, uuid, text, text) to service_role;
grant execute on function public.set_ship_agent_charge_notification_state(text, uuid, uuid, text, timestamptz) to service_role;
