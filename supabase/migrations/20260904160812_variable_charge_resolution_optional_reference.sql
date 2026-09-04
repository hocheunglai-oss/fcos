-- Resolution no longer requires a reference. Retain the nullable argument and
-- stored historical values for compatibility with earlier API clients.
create or replace function public.resolve_variable_charge_post_invoice_change(
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
  v_case public.variable_charge_cases%rowtype;
  v_event public.variable_charge_events%rowtype;
  v_operation public.variable_charge_operations%rowtype;
  v_actor public.user_profiles%rowtype;
begin
  v_actor := public.variable_charge_active_actor(p_actor_user_id, p_actor_email);
  if nullif(btrim(p_stem_id), '') is null or p_resolution not in ('no_adjustment', 'revised_invoice', 'credit_note') or p_expected_revision is null then
    raise exception 'A STEM, post-invoice resolution and expected revision are required.' using errcode = '22023';
  end if;
  if char_length(btrim(p_reference)) > 300 or char_length(coalesce(p_note, '')) > 1000 then raise exception 'The post-invoice reference or note is too long.' using errcode = '22023'; end if;
  v_operation := public.reserve_variable_charge_operation(p_operation_id, 'post_invoice_resolution', p_stem_id, p_request_fingerprint, p_actor_user_id);
  select * into v_case from public.variable_charge_cases where stem_id = btrim(p_stem_id) for update;
  if not found then raise exception 'The Variable Charges case is unavailable.' using errcode = 'P0002'; end if;
  if v_operation.status = 'succeeded' then return jsonb_build_object('case', to_jsonb(v_case), 'duplicate', true); end if;
  if v_case.revision <> p_expected_revision then raise exception 'This Variable Charges case changed after it was opened. Refresh and review the latest case.' using errcode = '40001'; end if;
  if v_case.workflow_status <> 'post_invoice_change' or v_case.invoice_state <> 'invoiced' then raise exception 'Only an active post-invoice Variable Charges change may be resolved.' using errcode = '23514'; end if;
  if v_case.assigned_buyer_user_id is distinct from v_actor.id
     or lower(coalesce(v_actor.user_type, '')) in ('finance', 'administrator', 'general_manager') then
    perform public.variable_charge_require_general_manager(p_actor_user_id, p_actor_email);
    if char_length(btrim(coalesce(p_override_reason, ''))) < 5 then
      raise exception 'A General Manager post-invoice override requires a reason.' using errcode = '22023';
    end if;
  end if;
  update public.variable_charge_cases
  set workflow_status = 'completed', post_invoice_resolution = p_resolution, post_invoice_reference = nullif(btrim(p_reference), ''), post_invoice_note = nullif(btrim(p_note), '')
  where id = v_case.id
  returning * into v_case;
  insert into public.variable_charge_events (case_id, event_type, event_key, summary, metadata, actor_user_id, actor_email)
  values (v_case.id, 'post_invoice_resolved', 'post-invoice-resolution:' || p_operation_id::text, 'Post-invoice Variable Charges change resolved.', jsonb_build_object('resolution', p_resolution, 'caseState', v_case.workflow_status, 'reasonProvided', v_case.assigned_buyer_user_id is distinct from v_actor.id or lower(coalesce(v_actor.user_type, '')) = 'general_manager'), v_actor.id, v_actor.email)
  returning * into v_event;
  perform public.complete_variable_charge_operation(p_operation_id, jsonb_build_object('caseId', v_case.id, 'stemId', v_case.stem_id, 'revision', v_case.revision, 'status', v_case.workflow_status, 'eventId', v_event.id));
  return jsonb_build_object('case', to_jsonb(v_case), 'event', to_jsonb(v_event), 'duplicate', false);
end;
$$;

revoke all on function public.resolve_variable_charge_post_invoice_change(text,text,text,text,bigint,uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.resolve_variable_charge_post_invoice_change(text,text,text,text,bigint,uuid,text,uuid,text,text) to service_role;
