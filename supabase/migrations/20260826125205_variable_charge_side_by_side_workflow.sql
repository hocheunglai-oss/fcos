-- Side-by-side Variable Charges workflow. Salesforce remains the financial and
-- invoice-readiness authority; this schema stores workflow identities only.

begin;

alter table public.variable_charge_operations
  drop constraint if exists variable_charge_operations_operation_type_check;
alter table public.variable_charge_operations
  add constraint variable_charge_operations_operation_type_check
  check (operation_type in (
    'sync', 'confirm', 'buyer_confirm', 'supplier_verify', 'side_assign',
    'side_confirm', 'gm_override', 'post_invoice_resolution', 'salesforce_write'
  ));

create or replace function public.reserve_variable_charge_operation(
  p_operation_id uuid,
  p_operation_type text,
  p_stem_id text,
  p_request_fingerprint text,
  p_actor_user_id uuid
)
returns public.variable_charge_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.variable_charge_operations%rowtype;
begin
  perform public.variable_charge_active_actor(p_actor_user_id, null);
  if p_operation_id is null
     or p_operation_type not in (
       'sync', 'confirm', 'buyer_confirm', 'supplier_verify', 'side_assign',
       'side_confirm', 'gm_override', 'post_invoice_resolution', 'salesforce_write'
     )
     or nullif(btrim(p_stem_id), '') is null
     or nullif(btrim(p_request_fingerprint), '') is null then
    raise exception 'A valid Variable Charges operation identity, type, STEM, and request fingerprint are required.' using errcode = '22023';
  end if;
  insert into public.variable_charge_operations (
    operation_id, operation_type, stem_id, request_fingerprint, actor_user_id
  ) values (
    p_operation_id, p_operation_type, btrim(p_stem_id), btrim(p_request_fingerprint), p_actor_user_id
  ) on conflict (operation_id) do nothing
  returning * into v_operation;
  if found then return v_operation; end if;
  select * into v_operation
  from public.variable_charge_operations
  where operation_id = p_operation_id
  for update;
  if v_operation.request_fingerprint <> btrim(p_request_fingerprint)
     or v_operation.operation_type <> p_operation_type
     or v_operation.stem_id <> btrim(p_stem_id)
     or v_operation.actor_user_id <> p_actor_user_id then
    raise exception 'This Variable Charges operation identity was already used for a different request.' using errcode = '40001';
  end if;
  return v_operation;
end;
$$;

alter table public.variable_charge_events
  drop constraint if exists ship_agent_charge_events_event_type_check;
alter table public.variable_charge_events
  drop constraint if exists variable_charge_events_event_type_check;
alter table public.variable_charge_events
  add constraint variable_charge_events_event_type_check
  check (event_type in (
    'synced', 'confirmation_invalidated', 'confirmed', 'gm_assignment_override',
    'post_invoice_change_detected', 'post_invoice_resolved',
    'notification_state_changed', 'side_assigned', 'side_taken_back',
    'side_confirmed', 'side_invalidated'
  ));

create or replace function public.variable_charge_assert_event_metadata(p_metadata jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Variable Charges event metadata must be an object.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_metadata, '{}'::jsonb)) loop
    if v_key not in (
      'caseState', 'previousState', 'reasonProvided', 'evidencePresent',
      'chargeToBuyer', 'resolution', 'sourceChanged', 'assignmentChanged',
      'notificationState', 'operationStatus', 'side', 'supplierAccountId',
      'targetRole', 'combinedConfirmation'
    ) then
      raise exception 'Variable Charges event metadata may contain only redacted workflow fields.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- The renamed events table retains its original immutable trigger. Route that
-- compatibility trigger through the canonical redacted-metadata validator.
create or replace function public.ship_agent_charge_assert_event_metadata(p_metadata jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.variable_charge_assert_event_metadata(p_metadata);
end;
$$;

create table public.variable_charge_side_states (
  id uuid primary key default gen_random_uuid(),
  supplier_stage_id uuid not null references public.variable_charge_supplier_stages(id) on delete restrict,
  case_id uuid not null references public.variable_charge_cases(id) on delete restrict,
  stem_id text not null check (btrim(stem_id) <> '' and char_length(stem_id) <= 18),
  supplier_account_id text not null check (btrim(supplier_account_id) <> '' and char_length(supplier_account_id) <= 18),
  side text not null check (side in ('cost', 'buyer_charge')),
  default_assignee_user_id uuid null references public.user_profiles(id) on delete set null,
  assigned_user_id uuid null references public.user_profiles(id) on delete set null,
  assignment_source text not null default 'unresolved' check (assignment_source in (
    'supplier_nomination', 'delegated_to_buyer', 'taken_back',
    'manual_gm_override', 'unresolved'
  )),
  assigned_by_user_id uuid null references public.user_profiles(id) on delete set null,
  override_expires_at timestamptz null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'invalidated', 'not_required')),
  source_fingerprint text not null default '' check (char_length(source_fingerprint) <= 256),
  salesforce_stage_last_modified_at timestamptz null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_stage_id, side),
  unique (stem_id, supplier_account_id, side)
);

create table public.variable_charge_side_confirmations (
  id uuid primary key default gen_random_uuid(),
  side_state_id uuid not null references public.variable_charge_side_states(id) on delete restrict,
  operation_id uuid null references public.variable_charge_operations(operation_id) on delete restrict,
  side_revision bigint not null check (side_revision > 0),
  reviewed_source_fingerprint text not null check (btrim(reviewed_source_fingerprint) <> '' and char_length(reviewed_source_fingerprint) <= 256),
  row_by_row_reviewed boolean not null check (row_by_row_reviewed),
  note_recorded boolean not null check (note_recorded),
  evidence_present boolean not null default false,
  confirmed_by uuid not null references public.user_profiles(id) on delete restrict,
  confirmed_by_email_hash text not null check (char_length(confirmed_by_email_hash) = 64),
  override_reason_recorded boolean not null default false,
  created_at timestamptz not null default now()
);

create index variable_charge_side_states_case_status_idx
  on public.variable_charge_side_states(case_id, side, status, updated_at desc);
create index variable_charge_side_states_assignee_idx
  on public.variable_charge_side_states(assigned_user_id, status, updated_at desc);
create index variable_charge_side_confirmations_state_idx
  on public.variable_charge_side_confirmations(side_state_id, created_at desc);
create unique index variable_charge_side_confirmations_operation_idx
  on public.variable_charge_side_confirmations(side_state_id, operation_id)
  where operation_id is not null;

create or replace function public.variable_charge_side_state_before_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id
     or new.supplier_stage_id <> old.supplier_stage_id
     or new.case_id <> old.case_id
     or new.stem_id <> old.stem_id
     or new.supplier_account_id <> old.supplier_account_id
     or new.side <> old.side
     or new.created_at <> old.created_at then
    raise exception 'Variable Charges side identity is immutable.' using errcode = '23514';
  end if;
  if new.revision <> old.revision then
    raise exception 'Variable Charges side revision is managed by the database.' using errcode = '23514';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.variable_charge_side_confirmation_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Variable Charges side confirmations are immutable.' using errcode = '23514';
end;
$$;

create trigger variable_charge_side_state_revision_guard
before update on public.variable_charge_side_states
for each row execute function public.variable_charge_side_state_before_update();

create trigger variable_charge_side_confirmation_guard
before update or delete on public.variable_charge_side_confirmations
for each row execute function public.variable_charge_side_confirmation_immutable();

create or replace function public.sync_variable_charge_side_states(
  p_stem_id text,
  p_sides jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.variable_charge_cases%rowtype;
  v_stage public.variable_charge_supplier_stages%rowtype;
  v_side jsonb;
  v_existing public.variable_charge_side_states%rowtype;
  v_supplier_id text;
  v_side_name text;
  v_default_user uuid;
  v_buyer_user uuid;
  v_assigned_user uuid;
  v_assignment_source text;
  v_status text;
  v_invalidated boolean;
  v_count integer := 0;
begin
  if nullif(btrim(p_stem_id), '') is null
     or jsonb_typeof(coalesce(p_sides, '[]'::jsonb)) <> 'array' then
    raise exception 'A STEM and redacted Variable Charges side array are required.' using errcode = '22023';
  end if;
  select * into v_case from public.variable_charge_cases where stem_id = btrim(p_stem_id) for update;
  if not found then raise exception 'The Variable Charges case is unavailable.' using errcode = 'P0002'; end if;

  update public.variable_charge_side_states state
  set status = 'not_required', assigned_user_id = null, assignment_source = 'unresolved'
  where state.stem_id = btrim(p_stem_id)
    and state.status <> 'not_required'
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_sides, '[]'::jsonb)) candidate
      where nullif(btrim(candidate->>'supplierAccountId'), '') = state.supplier_account_id
        and candidate->>'side' = state.side
    );

  for v_side in select value from jsonb_array_elements(coalesce(p_sides, '[]'::jsonb)) loop
    v_supplier_id := nullif(btrim(v_side->>'supplierAccountId'), '');
    v_side_name := nullif(btrim(v_side->>'side'), '');
    v_status := nullif(btrim(v_side->>'status'), '');
    v_default_user := nullif(v_side->>'defaultAssigneeUserId', '')::uuid;
    v_buyer_user := nullif(v_side->>'buyerTraderUserId', '')::uuid;
    if v_supplier_id is null
       or v_side_name not in ('cost', 'buyer_charge')
       or v_status not in ('pending', 'verified', 'invalidated')
       or nullif(btrim(v_side->>'sourceFingerprint'), '') is null then
      raise exception 'A complete redacted Variable Charges side is required.' using errcode = '22023';
    end if;
    select * into v_stage
    from public.variable_charge_supplier_stages
    where stem_id = btrim(p_stem_id) and supplier_account_id = v_supplier_id;
    if not found then raise exception 'The exact supplier stage is unavailable.' using errcode = 'P0002'; end if;
    select * into v_existing
    from public.variable_charge_side_states
    where supplier_stage_id = v_stage.id and side = v_side_name;

    v_invalidated := found and v_existing.status = 'verified'
      and (v_status <> 'verified' or v_existing.source_fingerprint <> btrim(v_side->>'sourceFingerprint'));

    if found and v_existing.status = 'verified' then
      v_assigned_user := v_existing.assigned_user_id;
      v_assignment_source := v_existing.assignment_source;
    elsif found and v_existing.assignment_source = 'manual_gm_override'
       and v_existing.override_expires_at > clock_timestamp() then
      v_assigned_user := v_existing.assigned_user_id;
      v_assignment_source := 'manual_gm_override';
    elsif found and v_existing.assignment_source = 'delegated_to_buyer' then
      v_assigned_user := v_buyer_user;
      v_assignment_source := case when v_buyer_user is null then 'unresolved' else 'delegated_to_buyer' end;
    else
      v_assigned_user := v_default_user;
      v_assignment_source := case when v_default_user is null then 'unresolved' else 'supplier_nomination' end;
    end if;

    insert into public.variable_charge_side_states (
      supplier_stage_id, case_id, stem_id, supplier_account_id, side,
      default_assignee_user_id, assigned_user_id, assignment_source,
      status, source_fingerprint, salesforce_stage_last_modified_at
    ) values (
      v_stage.id, v_case.id, btrim(p_stem_id), v_supplier_id, v_side_name,
      v_default_user, v_assigned_user, v_assignment_source,
      v_status, btrim(v_side->>'sourceFingerprint'),
      nullif(v_side->>'salesforceStageLastModifiedAt', '')::timestamptz
    ) on conflict (supplier_stage_id, side) do update set
      default_assignee_user_id = excluded.default_assignee_user_id,
      assigned_user_id = v_assigned_user,
      assignment_source = v_assignment_source,
      override_expires_at = case when v_assignment_source = 'manual_gm_override' then variable_charge_side_states.override_expires_at else null end,
      status = excluded.status,
      source_fingerprint = excluded.source_fingerprint,
      salesforce_stage_last_modified_at = excluded.salesforce_stage_last_modified_at
    where (
      variable_charge_side_states.default_assignee_user_id,
      variable_charge_side_states.assigned_user_id,
      variable_charge_side_states.assignment_source,
      variable_charge_side_states.status,
      variable_charge_side_states.source_fingerprint,
      variable_charge_side_states.salesforce_stage_last_modified_at
    ) is distinct from (
      excluded.default_assignee_user_id,
      v_assigned_user,
      v_assignment_source,
      excluded.status,
      excluded.source_fingerprint,
      excluded.salesforce_stage_last_modified_at
    )
    returning * into v_existing;
    if v_invalidated then
      insert into public.variable_charge_events (
        case_id, event_type, event_key, summary, metadata
      ) values (
        v_case.id,
        'side_invalidated',
        'side-invalidated:' || v_existing.id::text || ':' || v_existing.revision::text,
        'Variable Charges side invalidated by a relevant Salesforce source change.',
        jsonb_build_object(
          'side', v_side_name,
          'supplierAccountId', v_supplier_id,
          'sourceChanged', true
        )
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('stemId', btrim(p_stem_id), 'sideCount', v_count);
end;
$$;

create or replace function public.assign_variable_charge_sides(
  p_operation_id uuid,
  p_stem_id text,
  p_supplier_account_id text,
  p_sides text[],
  p_target_role text,
  p_target_user_id uuid,
  p_expected_revisions jsonb,
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
  v_actor public.user_profiles%rowtype;
  v_operation public.variable_charge_operations%rowtype;
  v_state public.variable_charge_side_states%rowtype;
  v_side text;
  v_source text;
  v_event_type text;
  v_resolved_target_user_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  v_actor := public.variable_charge_active_actor(p_actor_user_id, p_actor_email);
  if p_operation_id is null
     or nullif(btrim(p_stem_id), '') is null
     or nullif(btrim(p_supplier_account_id), '') is null
     or coalesce(cardinality(p_sides), 0) = 0
     or p_target_role not in ('buyer_trader', 'supplier_trader', 'gm_override')
     or jsonb_typeof(coalesce(p_expected_revisions, '{}'::jsonb)) <> 'object' then
    raise exception 'A valid supplier, side selection, target role, and expected revisions are required.' using errcode = '22023';
  end if;
  select * into v_operation
  from public.variable_charge_operations
  where operation_id = p_operation_id
  for update;
  if not found
     or v_operation.operation_type <> 'side_assign'
     or v_operation.stem_id <> btrim(p_stem_id)
     or v_operation.actor_user_id <> v_actor.id then
    raise exception 'The Variable Charges side-assignment operation is unavailable.' using errcode = 'P0002';
  end if;
  if v_operation.status = 'succeeded' then return coalesce(v_operation.result, '{}'::jsonb); end if;
  if v_operation.status <> 'reserved' then raise exception 'The Variable Charges side-assignment operation cannot be resumed.' using errcode = '40001'; end if;
  if p_target_role = 'gm_override' and char_length(btrim(coalesce(p_override_reason, ''))) < 5 then
    raise exception 'A General Manager side override requires a reason.' using errcode = '22023';
  end if;
  foreach v_side in array p_sides loop
    if v_side not in ('cost', 'buyer_charge') then raise exception 'An unsupported Variable Charges side was selected.' using errcode = '22023'; end if;
    select * into v_state
    from public.variable_charge_side_states
    where stem_id = btrim(p_stem_id)
      and supplier_account_id = btrim(p_supplier_account_id)
      and side = v_side
    for update;
    if not found then raise exception 'The Variable Charges side is unavailable.' using errcode = 'P0002'; end if;
    if v_state.status = 'verified' then raise exception 'A confirmed Variable Charges side cannot be reassigned.' using errcode = '23514'; end if;
    if v_state.revision <> coalesce((p_expected_revisions->>v_side)::bigint, -1) then
      raise exception 'This Variable Charges side changed after it was opened.' using errcode = '40001';
    end if;
    if p_target_role = 'supplier_trader' then
      if v_state.default_assignee_user_id is null then raise exception 'The resolved Supplier Trader is unavailable.' using errcode = '23514'; end if;
      v_source := 'taken_back';
      v_resolved_target_user_id := v_state.default_assignee_user_id;
      v_event_type := 'side_taken_back';
    elsif p_target_role = 'buyer_trader' then
      if p_target_user_id is null then raise exception 'The resolved Buyer Trader is unavailable.' using errcode = '23514'; end if;
      v_source := 'delegated_to_buyer';
      v_resolved_target_user_id := p_target_user_id;
      v_event_type := 'side_assigned';
    else
      if p_target_user_id is null then raise exception 'An active General Manager override assignee is required.' using errcode = '23514'; end if;
      v_source := 'manual_gm_override';
      v_resolved_target_user_id := p_target_user_id;
      v_event_type := 'side_assigned';
    end if;
    update public.variable_charge_side_states
    set assigned_user_id = v_resolved_target_user_id,
        assignment_source = v_source,
        assigned_by_user_id = v_actor.id,
        override_expires_at = case when v_source = 'manual_gm_override' then clock_timestamp() + interval '1 day' else null end
    where id = v_state.id
    returning * into v_state;
    insert into public.variable_charge_events (
      case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email
    ) values (
      v_state.case_id,
      v_event_type,
      'side-assignment:' || v_state.id::text || ':' || v_state.revision::text,
      'Variable Charges side responsibility changed.',
      jsonb_build_object(
        'side', v_side,
        'supplierAccountId', v_state.supplier_account_id,
        'targetRole', p_target_role,
        'assignmentChanged', true,
        'reasonProvided', p_target_role = 'gm_override'
      ),
      v_actor.id,
      v_actor.email
    );
    v_results := v_results || jsonb_build_array(to_jsonb(v_state));
  end loop;
  update public.variable_charge_operations
  set status = 'succeeded',
      result = jsonb_build_object(
        'stemId', btrim(p_stem_id),
        'supplierId', btrim(p_supplier_account_id),
        'status', 'assigned'
      ),
      completed_at = clock_timestamp()
  where operation_id = p_operation_id;
  return jsonb_build_object('stemId', btrim(p_stem_id), 'sides', v_results);
end;
$$;

create or replace function public.record_variable_charge_side_confirmations(
  p_operation_id uuid,
  p_stem_id text,
  p_supplier_account_id text,
  p_sides jsonb,
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
  v_actor public.user_profiles%rowtype;
  v_operation public.variable_charge_operations%rowtype;
  v_requested jsonb;
  v_state public.variable_charge_side_states%rowtype;
  v_confirmation public.variable_charge_side_confirmations%rowtype;
  v_side text;
  v_fingerprint text;
  v_expected_revision bigint;
  v_override boolean := char_length(btrim(coalesce(p_override_reason, ''))) >= 5;
  v_results jsonb := '[]'::jsonb;
begin
  v_actor := public.variable_charge_active_actor(p_actor_user_id, p_actor_email);
  if p_operation_id is null
     or nullif(btrim(p_stem_id), '') is null
     or nullif(btrim(p_supplier_account_id), '') is null
     or jsonb_typeof(coalesce(p_sides, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_sides, '[]'::jsonb)) = 0 then
    raise exception 'A valid supplier and confirmed side array are required.' using errcode = '22023';
  end if;
  select * into v_operation
  from public.variable_charge_operations
  where operation_id = p_operation_id
  for update;
  if not found
     or v_operation.operation_type <> 'side_confirm'
     or v_operation.stem_id <> btrim(p_stem_id)
     or v_operation.actor_user_id <> v_actor.id then
    raise exception 'The Variable Charges side-confirmation operation is unavailable.' using errcode = 'P0002';
  end if;
  if v_operation.status = 'succeeded' then return coalesce(v_operation.result, '{}'::jsonb); end if;
  if v_operation.status <> 'salesforce_written' then raise exception 'Salesforce confirmation must complete before the workflow audit is recorded.' using errcode = '40001'; end if;
  for v_requested in select value from jsonb_array_elements(p_sides) loop
    v_side := nullif(btrim(v_requested->>'side'), '');
    v_fingerprint := nullif(btrim(v_requested->>'sourceFingerprint'), '');
    v_expected_revision := coalesce((v_requested->>'expectedRevision')::bigint, -1);
    if v_side not in ('cost', 'buyer_charge') or v_fingerprint is null
       or coalesce((v_requested->>'rowByRowReviewed')::boolean, false) is false
       or coalesce((v_requested->>'noteRecorded')::boolean, false) is false then
      raise exception 'Every confirmed Variable Charges side requires a fingerprint, row review, and note.' using errcode = '22023';
    end if;
    select * into v_state
    from public.variable_charge_side_states
    where stem_id = btrim(p_stem_id)
      and supplier_account_id = btrim(p_supplier_account_id)
      and side = v_side
    for update;
    if not found then raise exception 'The Variable Charges side is unavailable.' using errcode = 'P0002'; end if;
    if v_state.status = 'verified' then raise exception 'This Variable Charges side is already confirmed.' using errcode = '23514'; end if;
    if v_state.revision <> v_expected_revision then raise exception 'This Variable Charges side changed after it was opened.' using errcode = '40001'; end if;
    if v_state.source_fingerprint <> v_fingerprint then raise exception 'Salesforce source data changed after this side was opened.' using errcode = '40001'; end if;
    if v_state.assigned_user_id is distinct from v_actor.id and not v_override then
      raise exception 'Only the assigned trader may confirm this Variable Charges side.' using errcode = '42501';
    end if;
    update public.variable_charge_side_states
    set status = 'verified',
        source_fingerprint = v_fingerprint,
        salesforce_stage_last_modified_at = nullif(v_requested->>'salesforceStageLastModifiedAt', '')::timestamptz
    where id = v_state.id
    returning * into v_state;
    insert into public.variable_charge_side_confirmations (
      side_state_id, operation_id, side_revision, reviewed_source_fingerprint,
      row_by_row_reviewed, note_recorded, evidence_present,
      confirmed_by, confirmed_by_email_hash, override_reason_recorded
    ) values (
      v_state.id, p_operation_id, v_state.revision, v_fingerprint,
      true, true, coalesce((v_requested->>'evidencePresent')::boolean, false),
      v_actor.id, encode(extensions.digest(lower(btrim(v_actor.email)), 'sha256'), 'hex'), v_override
    ) returning * into v_confirmation;
    insert into public.variable_charge_events (
      case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email
    ) values (
      v_state.case_id,
      'side_confirmed',
      'side-confirmed:' || v_confirmation.id::text,
      'Variable Charges side confirmed.',
      jsonb_build_object(
        'side', v_side,
        'supplierAccountId', v_state.supplier_account_id,
        'evidencePresent', coalesce((v_requested->>'evidencePresent')::boolean, false),
        'reasonProvided', v_override,
        'combinedConfirmation', jsonb_array_length(p_sides) > 1
      ),
      v_actor.id,
      v_actor.email
    );
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'side', v_side,
      'status', v_state.status,
      'revision', v_state.revision,
      'confirmationId', v_confirmation.id
    ));
  end loop;
  update public.variable_charge_operations
  set status = 'succeeded',
      result = jsonb_build_object(
        'stemId', btrim(p_stem_id),
        'supplierId', btrim(p_supplier_account_id),
        'status', 'verified'
      ),
      completed_at = clock_timestamp()
  where operation_id = p_operation_id;
  return jsonb_build_object('stemId', btrim(p_stem_id), 'sides', v_results);
end;
$$;

-- Additive backfill: current supplier confirmations become cost-side state; a
-- still-confirmed case becomes confirmed buyer-side state. The deployment
-- backfill reconciles these projections against live Salesforce fingerprints.
insert into public.variable_charge_side_states (
  supplier_stage_id, case_id, stem_id, supplier_account_id, side,
  default_assignee_user_id, assigned_user_id, assignment_source,
  status, source_fingerprint, salesforce_stage_last_modified_at
)
select
  stage.id, stage.case_id, stage.stem_id, stage.supplier_account_id, side_name,
  stage.assigned_supplier_user_id, stage.assigned_supplier_user_id,
  case when stage.assigned_supplier_user_id is null then 'unresolved' else 'supplier_nomination' end,
  case
    when side_name = 'cost' then stage.status
    when charge_case.confirmation_status = 'confirmed' then 'verified'
    when charge_case.confirmation_status = 'invalidated' then 'invalidated'
    else 'pending'
  end,
  case
    when side_name = 'cost' then stage.source_fingerprint
    else charge_case.source_fingerprint
  end,
  stage.salesforce_stage_last_modified_at
from public.variable_charge_supplier_stages stage
join public.variable_charge_cases charge_case on charge_case.id = stage.case_id
cross join (values ('cost'::text), ('buyer_charge'::text)) sides(side_name)
on conflict (supplier_stage_id, side) do nothing;

insert into public.variable_charge_side_confirmations (
  side_state_id, side_revision, reviewed_source_fingerprint,
  row_by_row_reviewed, note_recorded, evidence_present,
  confirmed_by, confirmed_by_email_hash, override_reason_recorded, created_at
)
select
  side_state.id, side_state.revision, supplier_confirmation.reviewed_source_fingerprint,
  true, supplier_confirmation.reference_recorded, supplier_confirmation.evidence_present,
  supplier_confirmation.confirmed_by, supplier_confirmation.confirmed_by_email_hash,
  supplier_confirmation.override_reason_recorded, supplier_confirmation.created_at
from public.variable_charge_supplier_confirmations supplier_confirmation
join public.variable_charge_supplier_stages supplier_stage
  on supplier_stage.id = supplier_confirmation.supplier_stage_id
join public.variable_charge_side_states side_state
  on side_state.supplier_stage_id = supplier_stage.id and side_state.side = 'cost'
where not exists (
  select 1 from public.variable_charge_side_confirmations existing
  where existing.side_state_id = side_state.id
    and existing.reviewed_source_fingerprint = supplier_confirmation.reviewed_source_fingerprint
    and existing.created_at = supplier_confirmation.created_at
);

insert into public.variable_charge_side_confirmations (
  side_state_id, side_revision, reviewed_source_fingerprint,
  row_by_row_reviewed, note_recorded, evidence_present,
  confirmed_by, confirmed_by_email_hash, override_reason_recorded, created_at
)
select
  side_state.id, side_state.revision, confirmation.reviewed_source_fingerprint,
  true, confirmation.reference_or_note is not null, confirmation.evidence_present,
  confirmation.confirmed_by,
  encode(extensions.digest(lower(btrim(confirmation.confirmed_by_email)), 'sha256'), 'hex'),
  confirmation.override_reason_recorded, confirmation.created_at
from public.variable_charge_confirmations confirmation
join public.variable_charge_cases charge_case on charge_case.id = confirmation.case_id
join public.variable_charge_side_states side_state
  on side_state.case_id = charge_case.id and side_state.side = 'buyer_charge'
where charge_case.confirmation_status = 'confirmed'
  and not exists (
    select 1 from public.variable_charge_side_confirmations existing
    where existing.side_state_id = side_state.id
      and existing.reviewed_source_fingerprint = confirmation.reviewed_source_fingerprint
      and existing.created_at = confirmation.created_at
  );

create or replace function public.reconcile_variable_charge_paired_backfill(
  p_stem_id text,
  p_buyer_aggregate_fingerprint text,
  p_buyer_case_status text,
  p_salesforce_stem_last_modified_at timestamptz,
  p_sides jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.variable_charge_cases%rowtype;
  v_side jsonb;
  v_state public.variable_charge_side_states%rowtype;
  v_supplier_confirmation public.variable_charge_supplier_confirmations%rowtype;
  v_buyer_confirmation public.variable_charge_confirmations%rowtype;
  v_confirmation_count integer := 0;
  v_inserted integer := 0;
begin
  if nullif(btrim(p_stem_id), '') is null
     or p_buyer_aggregate_fingerprint !~ '^[0-9a-f]{64}$'
     or p_buyer_case_status not in ('pending', 'confirmed', 'invalidated')
     or jsonb_typeof(coalesce(p_sides, '[]'::jsonb)) <> 'array' then
    raise exception 'A complete redacted paired-workflow backfill projection is required.' using errcode = '22023';
  end if;

  select * into v_case
  from public.variable_charge_cases
  where stem_id = btrim(p_stem_id)
  for update;
  if not found then
    raise exception 'The Variable Charges case is unavailable.' using errcode = 'P0002';
  end if;

  perform public.sync_variable_charge_side_states(btrim(p_stem_id), p_sides);

  for v_side in select value from jsonb_array_elements(p_sides) loop
    if v_side->>'status' <> 'verified' then continue; end if;
    select * into v_state
    from public.variable_charge_side_states
    where stem_id = btrim(p_stem_id)
      and supplier_account_id = v_side->>'supplierAccountId'
      and side = v_side->>'side'
    for update;
    if not found or v_state.source_fingerprint <> v_side->>'sourceFingerprint' then
      raise exception 'The current paired side was not synchronized safely.' using errcode = '40001';
    end if;

    if v_state.side = 'cost' then
      select confirmation.* into v_supplier_confirmation
      from public.variable_charge_supplier_confirmations confirmation
      where confirmation.supplier_stage_id = v_state.supplier_stage_id
      order by confirmation.created_at desc, confirmation.id desc
      limit 1;
      if not found then
        raise exception 'A verified supplier-cost side has no historical confirmation actor.' using errcode = 'P0002';
      end if;
      insert into public.variable_charge_side_confirmations (
        side_state_id, side_revision, reviewed_source_fingerprint,
        row_by_row_reviewed, note_recorded, evidence_present,
        confirmed_by, confirmed_by_email_hash, override_reason_recorded, created_at
      )
      select
        v_state.id, v_state.revision, v_state.source_fingerprint,
        true, true, v_supplier_confirmation.evidence_present,
        v_supplier_confirmation.confirmed_by, v_supplier_confirmation.confirmed_by_email_hash,
        v_supplier_confirmation.override_reason_recorded, v_supplier_confirmation.created_at
      where not exists (
        select 1 from public.variable_charge_side_confirmations existing
        where existing.side_state_id = v_state.id
          and existing.reviewed_source_fingerprint = v_state.source_fingerprint
      );
    else
      select confirmation.* into v_buyer_confirmation
      from public.variable_charge_confirmations confirmation
      where confirmation.case_id = v_case.id
      order by (confirmation.id = v_case.last_confirmation_id) desc,
        confirmation.created_at desc, confirmation.id desc
      limit 1;
      if not found then
        raise exception 'A verified buyer-charge side has no historical confirmation actor.' using errcode = 'P0002';
      end if;
      insert into public.variable_charge_side_confirmations (
        side_state_id, side_revision, reviewed_source_fingerprint,
        row_by_row_reviewed, note_recorded, evidence_present,
        confirmed_by, confirmed_by_email_hash, override_reason_recorded, created_at
      )
      select
        v_state.id, v_state.revision, v_state.source_fingerprint,
        true, true, v_buyer_confirmation.evidence_present,
        v_buyer_confirmation.confirmed_by,
        encode(extensions.digest(lower(btrim(v_buyer_confirmation.confirmed_by_email)), 'sha256'), 'hex'),
        v_buyer_confirmation.override_reason_recorded, v_buyer_confirmation.created_at
      where not exists (
        select 1 from public.variable_charge_side_confirmations existing
        where existing.side_state_id = v_state.id
          and existing.reviewed_source_fingerprint = v_state.source_fingerprint
      );
    end if;
    get diagnostics v_inserted = row_count;
    v_confirmation_count := v_confirmation_count + v_inserted;
  end loop;

  update public.variable_charge_cases
  set source_fingerprint = p_buyer_aggregate_fingerprint,
      supplier_fingerprint = p_buyer_aggregate_fingerprint,
      salesforce_stem_last_modified_at = p_salesforce_stem_last_modified_at,
      confirmation_status = p_buyer_case_status,
      workflow_status = case
        when p_buyer_case_status = 'invalidated' and invoice_state = 'invoiced' then 'post_invoice_change'
        when p_buyer_case_status in ('invalidated', 'pending') and workflow_status in ('ready_for_invoice', 'completed') then 'needs_action'
        else workflow_status
      end,
      post_invoice_detected_at = case
        when p_buyer_case_status = 'invalidated' and invoice_state = 'invoiced'
          then coalesce(post_invoice_detected_at, clock_timestamp())
        else post_invoice_detected_at
      end
  where id = v_case.id;

  return jsonb_build_object(
    'stemId', btrim(p_stem_id),
    'sideCount', jsonb_array_length(p_sides),
    'confirmationCount', v_confirmation_count,
    'buyerCaseStatus', p_buyer_case_status
  );
end;
$$;

alter table public.variable_charge_side_states enable row level security;
alter table public.variable_charge_side_confirmations enable row level security;

revoke all on table public.variable_charge_side_states,
  public.variable_charge_side_confirmations from public, anon, authenticated;
grant all on table public.variable_charge_side_states,
  public.variable_charge_side_confirmations to service_role;

revoke all on function public.sync_variable_charge_side_states(text,jsonb) from public, anon, authenticated;
revoke all on function public.assign_variable_charge_sides(uuid,text,text,text[],text,uuid,jsonb,uuid,text,text) from public, anon, authenticated;
revoke all on function public.record_variable_charge_side_confirmations(uuid,text,text,jsonb,uuid,text,text) from public, anon, authenticated;
revoke all on function public.reconcile_variable_charge_paired_backfill(text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.sync_variable_charge_side_states(text,jsonb) to service_role;
grant execute on function public.assign_variable_charge_sides(uuid,text,text,text[],text,uuid,jsonb,uuid,text,text) to service_role;
grant execute on function public.record_variable_charge_side_confirmations(uuid,text,text,jsonb,uuid,text,text) to service_role;
grant execute on function public.reconcile_variable_charge_paired_backfill(text,text,text,timestamptz,jsonb) to service_role;

-- The retained one-release supplier-cost handler was created before pgcrypto
-- was isolated in the extensions schema. Keep that compatibility path working
-- without copying or weakening the existing function body.
do $legacy_supplier_hash_fix$
declare
  v_function_oid oid;
  v_definition text;
begin
  select p.oid into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'record_variable_charge_supplier_confirmation';
  if v_function_oid is null then
    raise exception 'The retained supplier-confirmation function is unavailable.' using errcode = 'P0002';
  end if;
  v_definition := pg_get_functiondef(v_function_oid);
  if position('encode(digest(' in v_definition) = 0 then
    raise exception 'The retained supplier-confirmation hash expression changed unexpectedly.' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, 'encode(digest(', 'encode(extensions.digest(');
  execute v_definition;
end
$legacy_supplier_hash_fix$;

commit;
