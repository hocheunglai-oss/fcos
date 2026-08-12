-- Correct the default sync event key expression. PostgreSQL otherwise binds
-- the JSON extraction operator after text concatenation and attempts `text ->> unknown`.
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
  v_event_key := btrim(coalesce(p_event->>'eventKey', 'sync:' || v_stem_id || ':' || (p_case->>'sourceFingerprint')));
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

revoke all on function public.sync_ship_agent_charge_case(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_ship_agent_charge_case(jsonb, jsonb) to service_role;
