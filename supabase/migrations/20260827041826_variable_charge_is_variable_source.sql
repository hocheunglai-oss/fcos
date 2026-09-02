begin;

alter table public.variable_charge_supplier_stages
  drop constraint if exists variable_charge_supplier_stages_requirement_source_check;

alter table public.variable_charge_supplier_stages
  add constraint variable_charge_supplier_stages_requirement_source_check
  check (requirement_source in ('is_agent', 'is_variable', 'manual'));

create or replace function public.sync_variable_charge_supplier_stages(
  p_stem_id text,
  p_stages jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.variable_charge_cases%rowtype;
  v_stage jsonb;
  v_supplier_id text;
  v_count integer := 0;
begin
  if nullif(btrim(p_stem_id), '') is null or jsonb_typeof(coalesce(p_stages, '[]'::jsonb)) <> 'array' then
    raise exception 'A STEM and redacted supplier-stage array are required.' using errcode = '22023';
  end if;
  select * into v_case from public.variable_charge_cases where stem_id = btrim(p_stem_id) for update;
  if not found then raise exception 'The Variable Charges case is unavailable.' using errcode = 'P0002'; end if;
  update public.variable_charge_supplier_stages
  set status = 'not_required', assigned_supplier_user_id = null, assignment_source = 'unresolved'
  where stem_id = btrim(p_stem_id)
    and status <> 'not_required'
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) candidate
      where nullif(btrim(candidate->>'supplierAccountId'), '') = variable_charge_supplier_stages.supplier_account_id
    );
  for v_stage in select value from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) loop
    v_supplier_id := nullif(btrim(v_stage->>'supplierAccountId'), '');
    if v_supplier_id is null
       or coalesce(v_stage->>'assignmentSource', '') not in ('nomination_email', 'nomination_name', 'manual_gm_override', 'unresolved')
       or coalesce(v_stage->>'requirementSource', '') not in ('is_agent', 'is_variable', 'manual')
       or coalesce(v_stage->>'status', '') not in ('pending', 'verified', 'invalidated')
       or nullif(btrim(v_stage->>'sourceFingerprint'), '') is null then
      raise exception 'A complete redacted Variable Charges supplier stage is required.' using errcode = '22023';
    end if;
    insert into public.variable_charge_supplier_stages (
      case_id, stem_id, supplier_account_id, assigned_supplier_user_id, assignment_source,
      requirement_source, status, source_fingerprint, salesforce_stage_last_modified_at
    ) values (
      v_case.id, btrim(p_stem_id), v_supplier_id, nullif(v_stage->>'assignedSupplierUserId', '')::uuid,
      v_stage->>'assignmentSource', v_stage->>'requirementSource', v_stage->>'status',
      btrim(v_stage->>'sourceFingerprint'), nullif(v_stage->>'salesforceStageLastModifiedAt', '')::timestamptz
    ) on conflict (stem_id, supplier_account_id) do update set
      assigned_supplier_user_id = excluded.assigned_supplier_user_id,
      assignment_source = excluded.assignment_source,
      requirement_source = excluded.requirement_source,
      status = excluded.status,
      source_fingerprint = excluded.source_fingerprint,
      salesforce_stage_last_modified_at = excluded.salesforce_stage_last_modified_at
    where (
      variable_charge_supplier_stages.assigned_supplier_user_id,
      variable_charge_supplier_stages.assignment_source,
      variable_charge_supplier_stages.requirement_source,
      variable_charge_supplier_stages.status,
      variable_charge_supplier_stages.source_fingerprint,
      variable_charge_supplier_stages.salesforce_stage_last_modified_at
    ) is distinct from (
      excluded.assigned_supplier_user_id,
      excluded.assignment_source,
      excluded.requirement_source,
      excluded.status,
      excluded.source_fingerprint,
      excluded.salesforce_stage_last_modified_at
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('stemId', btrim(p_stem_id), 'stageCount', v_count);
end;
$$;

create or replace function public.record_variable_charge_supplier_confirmation(
  p_stem_id text,
  p_supplier_account_id text,
  p_assigned_supplier_user_id uuid,
  p_assignment_source text,
  p_requirement_source text,
  p_source_fingerprint text,
  p_salesforce_stage_last_modified_at timestamptz,
  p_reference_recorded boolean,
  p_evidence_present boolean,
  p_actor_user_id uuid,
  p_actor_email text,
  p_override_reason_recorded boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.variable_charge_cases%rowtype;
  v_stage public.variable_charge_supplier_stages%rowtype;
  v_confirmation public.variable_charge_supplier_confirmations%rowtype;
  v_actor public.user_profiles%rowtype;
begin
  v_actor := public.variable_charge_active_actor(p_actor_user_id, p_actor_email);
  if nullif(btrim(p_stem_id), '') is null or nullif(btrim(p_supplier_account_id), '') is null
     or p_assignment_source not in ('nomination_email', 'nomination_name', 'manual_gm_override', 'unresolved')
     or p_requirement_source not in ('is_agent', 'is_variable', 'manual')
     or nullif(btrim(p_source_fingerprint), '') is null
     or coalesce(p_reference_recorded, false) is false then
    raise exception 'A complete redacted supplier confirmation is required.' using errcode = '22023';
  end if;
  select * into v_case from public.variable_charge_cases where stem_id = btrim(p_stem_id) for update;
  if not found then raise exception 'The Variable Charges case is unavailable.' using errcode = 'P0002'; end if;
  insert into public.variable_charge_supplier_stages (
    case_id, stem_id, supplier_account_id, assigned_supplier_user_id, assignment_source,
    requirement_source, status, source_fingerprint, salesforce_stage_last_modified_at
  ) values (
    v_case.id, btrim(p_stem_id), btrim(p_supplier_account_id), p_assigned_supplier_user_id, p_assignment_source,
    p_requirement_source, 'verified', btrim(p_source_fingerprint), p_salesforce_stage_last_modified_at
  ) on conflict (stem_id, supplier_account_id) do update set
    assigned_supplier_user_id = excluded.assigned_supplier_user_id,
    assignment_source = excluded.assignment_source,
    requirement_source = excluded.requirement_source,
    status = 'verified',
    source_fingerprint = excluded.source_fingerprint,
    salesforce_stage_last_modified_at = excluded.salesforce_stage_last_modified_at
  returning * into v_stage;
  insert into public.variable_charge_supplier_confirmations (
    supplier_stage_id, stage_revision, reviewed_source_fingerprint, row_by_row_reviewed,
    reference_recorded, evidence_present, confirmed_by, confirmed_by_email_hash, override_reason_recorded
  ) values (
    v_stage.id, v_stage.revision, btrim(p_source_fingerprint), true,
    p_reference_recorded, coalesce(p_evidence_present, false), v_actor.id,
    encode(digest(lower(btrim(v_actor.email)), 'sha256'), 'hex'), coalesce(p_override_reason_recorded, false)
  ) returning * into v_confirmation;
  return jsonb_build_object('stage', to_jsonb(v_stage), 'confirmationId', v_confirmation.id);
end;
$$;

revoke all on function public.sync_variable_charge_supplier_stages(text, jsonb) from public, anon, authenticated;
revoke all on function public.record_variable_charge_supplier_confirmation(text, text, uuid, text, text, text, timestamptz, boolean, boolean, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.sync_variable_charge_supplier_stages(text, jsonb) to service_role;
grant execute on function public.record_variable_charge_supplier_confirmation(text, text, uuid, text, text, text, timestamptz, boolean, boolean, uuid, text, boolean) to service_role;

commit;
