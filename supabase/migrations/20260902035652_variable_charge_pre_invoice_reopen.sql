-- Assigned traders may reopen an approved Variable Charges leg only while its
-- corresponding invoice has not been created. Salesforce remains authoritative
-- for the financial/invoice gate; Supabase records the workflow transition.

begin;

alter table public.variable_charge_operations
  drop constraint if exists variable_charge_operations_operation_type_check;
alter table public.variable_charge_operations
  add constraint variable_charge_operations_operation_type_check
  check (operation_type in (
    'sync', 'confirm', 'buyer_confirm', 'supplier_verify', 'side_assign',
    'side_confirm', 'side_reopen', 'gm_override', 'post_invoice_resolution',
    'salesforce_write'
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
       'side_confirm', 'side_reopen', 'gm_override', 'post_invoice_resolution',
       'salesforce_write'
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
  drop constraint if exists variable_charge_events_event_type_check;
alter table public.variable_charge_events
  add constraint variable_charge_events_event_type_check
  check (event_type in (
    'synced', 'confirmation_invalidated', 'confirmed', 'gm_assignment_override',
    'post_invoice_change_detected', 'post_invoice_resolved',
    'notification_state_changed', 'side_assigned', 'side_taken_back',
    'side_confirmed', 'side_invalidated', 'side_reopened'
  ));

create or replace function public.record_variable_charge_side_reopens(
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
    raise exception 'A valid supplier and reopened side array are required.' using errcode = '22023';
  end if;

  select * into v_operation
  from public.variable_charge_operations
  where operation_id = p_operation_id
  for update;
  if not found
     or v_operation.operation_type <> 'side_reopen'
     or v_operation.stem_id <> btrim(p_stem_id)
     or v_operation.actor_user_id <> v_actor.id then
    raise exception 'The Variable Charges side-reopen operation is unavailable.' using errcode = 'P0002';
  end if;
  if v_operation.status = 'succeeded' then return coalesce(v_operation.result, '{}'::jsonb); end if;
  if v_operation.status <> 'salesforce_written' then
    raise exception 'Salesforce reopening must complete before the workflow audit is recorded.' using errcode = '40001';
  end if;

  for v_requested in select value from jsonb_array_elements(p_sides) loop
    v_side := nullif(btrim(v_requested->>'side'), '');
    v_fingerprint := nullif(btrim(v_requested->>'sourceFingerprint'), '');
    v_expected_revision := coalesce((v_requested->>'expectedRevision')::bigint, -1);
    if v_side not in ('cost', 'buyer_charge') or v_fingerprint is null then
      raise exception 'Every reopened Variable Charges side requires a valid side and current fingerprint.' using errcode = '22023';
    end if;

    select * into v_state
    from public.variable_charge_side_states
    where stem_id = btrim(p_stem_id)
      and supplier_account_id = btrim(p_supplier_account_id)
      and side = v_side
    for update;
    if not found then raise exception 'The Variable Charges side is unavailable.' using errcode = 'P0002'; end if;
    if v_state.status not in ('verified', 'invalidated') then
      raise exception 'Only an approved Variable Charges side may be amended.' using errcode = '23514';
    end if;
    if not (
      (v_state.status = 'verified' and v_state.revision = v_expected_revision)
      or (v_state.status = 'invalidated' and v_state.revision in (v_expected_revision, v_expected_revision + 1))
    ) then
      raise exception 'This Variable Charges side changed after it was opened.' using errcode = '40001';
    end if;
    if v_state.assigned_user_id is distinct from v_actor.id and not v_override then
      raise exception 'Only the assigned trader may reopen this Variable Charges side.' using errcode = '42501';
    end if;

    if v_state.status <> 'invalidated'
       or v_state.source_fingerprint <> v_fingerprint
       or v_state.salesforce_stage_last_modified_at is distinct from nullif(v_requested->>'salesforceStageLastModifiedAt', '')::timestamptz then
      update public.variable_charge_side_states
      set status = 'invalidated',
          source_fingerprint = v_fingerprint,
          salesforce_stage_last_modified_at = nullif(v_requested->>'salesforceStageLastModifiedAt', '')::timestamptz
      where id = v_state.id
      returning * into v_state;
    end if;

    insert into public.variable_charge_events (
      case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email
    ) values (
      v_state.case_id,
      'side_reopened',
      'side-reopened:' || p_operation_id::text || ':' || v_side,
      'Variable Charges side reopened for pre-invoice amendment.',
      jsonb_build_object(
        'side', v_side,
        'supplierAccountId', v_state.supplier_account_id,
        'reasonProvided', true
      ),
      v_actor.id,
      v_actor.email
    ) on conflict (case_id, event_key) do nothing;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'side', v_side,
      'status', v_state.status,
      'revision', v_state.revision
    ));
  end loop;

  update public.variable_charge_operations
  set status = 'succeeded',
      result = jsonb_build_object(
        'stemId', btrim(p_stem_id),
        'supplierId', btrim(p_supplier_account_id),
        'status', 'reopened',
        'sides', v_results
      ),
      updated_at = clock_timestamp()
  where operation_id = p_operation_id
  returning * into v_operation;
  return v_operation.result;
end;
$$;

revoke all on function public.record_variable_charge_side_reopens(uuid,text,text,jsonb,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_variable_charge_side_reopens(uuid,text,text,jsonb,uuid,text,text) to service_role;

commit;
