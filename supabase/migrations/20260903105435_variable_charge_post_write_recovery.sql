-- Allow an interrupted post-Salesforce confirmation to finish after the
-- read-only synchronizer has already observed the verified Salesforce stage.
-- The recovery is accepted only for the immediately following revision, the
-- exact post-write fingerprint, and the exact Salesforce stage timestamp.
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
  v_expected_fingerprint text;
  v_expected_revision bigint;
  v_salesforce_modified_at timestamptz;
  v_already_synchronized boolean;
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
  if v_operation.status = 'succeeded' then
    return coalesce(v_operation.result, '{}'::jsonb);
  end if;
  if v_operation.status <> 'salesforce_written' then
    raise exception 'Salesforce confirmation must complete before the workflow audit is recorded.' using errcode = '40001';
  end if;

  for v_requested in select value from jsonb_array_elements(p_sides) loop
    v_side := nullif(btrim(v_requested->>'side'), '');
    v_fingerprint := nullif(btrim(v_requested->>'sourceFingerprint'), '');
    v_expected_fingerprint := coalesce(
      nullif(btrim(v_requested->>'expectedSourceFingerprint'), ''),
      v_fingerprint
    );
    v_expected_revision := coalesce((v_requested->>'expectedRevision')::bigint, -1);
    v_salesforce_modified_at := nullif(v_requested->>'salesforceStageLastModifiedAt', '')::timestamptz;
    if v_side not in ('cost', 'buyer_charge')
       or v_fingerprint is null
       or v_expected_fingerprint is null
       or v_expected_revision < 0
       or v_salesforce_modified_at is null
       or coalesce((v_requested->>'rowByRowReviewed')::boolean, false) is false
       or coalesce((v_requested->>'noteRecorded')::boolean, false) is false then
      raise exception 'Every confirmed Variable Charges side requires fingerprints, row review, note, revision, and Salesforce timestamp.' using errcode = '22023';
    end if;

    select * into v_state
    from public.variable_charge_side_states
    where stem_id = btrim(p_stem_id)
      and supplier_account_id = btrim(p_supplier_account_id)
      and side = v_side
    for update;
    if not found then
      raise exception 'The Variable Charges side is unavailable.' using errcode = 'P0002';
    end if;
    if v_state.assigned_user_id is distinct from v_actor.id and not v_override then
      raise exception 'Only the assigned trader may confirm this Variable Charges side.' using errcode = '42501';
    end if;

    v_already_synchronized := v_state.status = 'verified'
      and v_state.revision = v_expected_revision + 1
      and v_state.source_fingerprint = v_fingerprint
      and v_state.salesforce_stage_last_modified_at is not distinct from v_salesforce_modified_at;

    if v_state.status = 'verified' then
      if not v_already_synchronized then
        raise exception 'This Variable Charges side is already confirmed by a different revision.' using errcode = '23514';
      end if;
    else
      if v_state.revision <> v_expected_revision then
        raise exception 'This Variable Charges side changed after it was opened.' using errcode = '40001';
      end if;
      if v_state.source_fingerprint <> v_expected_fingerprint then
        raise exception 'Salesforce source data changed after this side was opened.' using errcode = '40001';
      end if;
      update public.variable_charge_side_states
      set status = 'verified',
          source_fingerprint = v_fingerprint,
          salesforce_stage_last_modified_at = v_salesforce_modified_at
      where id = v_state.id
      returning * into v_state;
    end if;

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
        'combinedConfirmation', jsonb_array_length(p_sides) > 1,
        'postWriteRecovery', v_already_synchronized
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

revoke all on function public.record_variable_charge_side_confirmations(uuid,text,text,jsonb,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_variable_charge_side_confirmations(uuid,text,text,jsonb,uuid,text,text) to service_role;
