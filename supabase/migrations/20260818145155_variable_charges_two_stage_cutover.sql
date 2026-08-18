-- Canonical Variable Charges cutover. Salesforce remains the financial source of truth.
-- This migration renames the existing service-only workflow ledger in place, retains
-- rollback compatibility views/functions, and adds identifier-only supplier stages.

begin;

alter table public.ship_agent_charge_notification_states rename to variable_charge_notification_states;
alter table public.ship_agent_charge_operations rename to variable_charge_operations;
alter table public.ship_agent_charge_events rename to variable_charge_events;
alter table public.ship_agent_charge_confirmations rename to variable_charge_confirmations;
alter table public.ship_agent_charge_cases rename to variable_charge_cases;

alter table public.variable_charge_operations drop constraint if exists ship_agent_charge_operations_operation_type_check;
alter table public.variable_charge_operations drop constraint if exists variable_charge_operations_operation_type_check;
alter table public.variable_charge_operations
  add constraint variable_charge_operations_operation_type_check
  check (operation_type in ('sync', 'confirm', 'buyer_confirm', 'supplier_verify', 'gm_override', 'post_invoice_resolution', 'salesforce_write'));

-- Clone the hardened functions under canonical names. Function bodies and messages are
-- renamed together; pg_get_functiondef preserves exact argument and return signatures.
do $migration$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '%ship_agent_charge%' or p.proname in (
        'sync_ship_agent_charge_case',
        'confirm_ship_agent_charge_case',
        'override_ship_agent_charge_assignment',
        'resolve_ship_agent_post_invoice_change',
        'set_ship_agent_charge_notification_state'
      ))
    order by p.proname
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    -- Replace the complete legacy domain first. Replacing only `ship_agent`
    -- would incorrectly create names such as `variable_charge_charge_cases`.
    v_definition := replace(v_definition, 'ship_agent_charge', 'variable_charge');
    v_definition := replace(v_definition, 'ship_agent', 'variable_charge');
    v_definition := replace(v_definition, 'Ship-Agent', 'Variable Charges');
    execute v_definition;
  end loop;
end
$migration$;

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
     or p_operation_type not in ('sync', 'confirm', 'buyer_confirm', 'supplier_verify', 'gm_override', 'post_invoice_resolution', 'salesforce_write')
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
  select * into v_operation from public.variable_charge_operations where operation_id = p_operation_id for update;
  if v_operation.request_fingerprint <> btrim(p_request_fingerprint)
     or v_operation.operation_type <> p_operation_type
     or v_operation.stem_id <> btrim(p_stem_id)
     or v_operation.actor_user_id <> p_actor_user_id then
    raise exception 'This Variable Charges operation identity was already used for a different request.' using errcode = '40001';
  end if;
  return v_operation;
end;
$$;

create or replace function public.complete_variable_charge_operation(
  p_operation_id uuid,
  p_result jsonb,
  p_status text default 'succeeded'
)
returns public.variable_charge_operations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_operation public.variable_charge_operations%rowtype;
  v_key text;
begin
  if p_operation_id is null or p_status not in ('salesforce_written', 'succeeded', 'failed', 'uncertain')
     or jsonb_typeof(coalesce(p_result, '{}'::jsonb)) <> 'object' then
    raise exception 'A valid completed Variable Charges operation result is required.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_result, '{}'::jsonb)) loop
    if v_key not in ('caseId', 'stemId', 'supplierId', 'revision', 'status', 'eventId', 'duplicate', 'errorCode', 'sourceFingerprint') then
      raise exception 'Variable Charges operation results may contain only redacted workflow fields.' using errcode = '22023';
    end if;
  end loop;
  select * into v_operation from public.variable_charge_operations where operation_id = p_operation_id for update;
  if not found then raise exception 'The Variable Charges operation is unavailable.' using errcode = 'P0002'; end if;
  if v_operation.status in ('succeeded', 'failed', 'uncertain') then return v_operation; end if;
  update public.variable_charge_operations
  set status = p_status, result = coalesce(p_result, '{}'::jsonb), completed_at = clock_timestamp()
  where operation_id = p_operation_id
  returning * into v_operation;
  return v_operation;
end;
$$;

create table public.variable_charge_supplier_stages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.variable_charge_cases(id) on delete restrict,
  stem_id text not null check (btrim(stem_id) <> '' and char_length(stem_id) <= 18),
  supplier_account_id text not null check (btrim(supplier_account_id) <> '' and char_length(supplier_account_id) <= 18),
  assigned_supplier_user_id uuid null references public.user_profiles(id) on delete set null,
  assignment_source text not null default 'unresolved' check (assignment_source in ('nomination_email', 'nomination_name', 'manual_gm_override', 'unresolved')),
  requirement_source text not null check (requirement_source in ('is_agent', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'invalidated', 'not_required')),
  source_fingerprint text not null default '' check (char_length(source_fingerprint) <= 256),
  salesforce_stage_last_modified_at timestamptz null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stem_id, supplier_account_id)
);

create table public.variable_charge_supplier_confirmations (
  id uuid primary key default gen_random_uuid(),
  supplier_stage_id uuid not null references public.variable_charge_supplier_stages(id) on delete restrict,
  stage_revision bigint not null check (stage_revision > 0),
  reviewed_source_fingerprint text not null check (btrim(reviewed_source_fingerprint) <> '' and char_length(reviewed_source_fingerprint) <= 256),
  row_by_row_reviewed boolean not null check (row_by_row_reviewed),
  reference_recorded boolean not null,
  evidence_present boolean not null default false,
  confirmed_by uuid not null references public.user_profiles(id) on delete restrict,
  confirmed_by_email_hash text not null check (char_length(confirmed_by_email_hash) = 64),
  override_reason_recorded boolean not null default false,
  created_at timestamptz not null default now(),
  check (reference_recorded)
);

create table public.variable_charge_legacy_traffic (
  id bigint generated always as identity primary key,
  handler text not null check (handler in (
    'shipAgentChargesList', 'shipAgentChargesDetail', 'shipAgentChargesOptions',
    'shipAgentChargesSaveConfirm', 'shipAgentChargesGmOverride',
    'shipAgentChargesPostInvoiceResolve', 'shipAgentChargesSync'
  )),
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  invoked_at timestamptz not null default now()
);

create index variable_charge_supplier_stages_case_status_idx on public.variable_charge_supplier_stages(case_id, status, updated_at desc);
create index variable_charge_supplier_stages_assignee_idx on public.variable_charge_supplier_stages(assigned_supplier_user_id, status, updated_at desc);
create index variable_charge_supplier_confirmations_stage_idx on public.variable_charge_supplier_confirmations(supplier_stage_id, created_at desc);
create index variable_charge_legacy_traffic_time_idx on public.variable_charge_legacy_traffic(invoked_at desc);

create or replace function public.variable_charge_supplier_stage_before_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id or new.case_id <> old.case_id or new.stem_id <> old.stem_id or new.supplier_account_id <> old.supplier_account_id then
    raise exception 'Variable Charges supplier stage identity is immutable.' using errcode = '23514';
  end if;
  if new.revision <> old.revision then
    raise exception 'Variable Charges supplier stage revision is managed by the database.' using errcode = '23514';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.variable_charge_supplier_confirmation_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Variable Charges supplier confirmations are immutable.' using errcode = '23514';
end;
$$;

create trigger variable_charge_supplier_stage_revision_guard
before update on public.variable_charge_supplier_stages
for each row execute function public.variable_charge_supplier_stage_before_update();

create trigger variable_charge_supplier_confirmation_guard
before update or delete on public.variable_charge_supplier_confirmations
for each row execute function public.variable_charge_supplier_confirmation_immutable();

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
       or coalesce(v_stage->>'requirementSource', '') not in ('is_agent', 'manual')
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
     or p_requirement_source not in ('is_agent', 'manual')
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

alter table public.variable_charge_cases enable row level security;
alter table public.variable_charge_confirmations enable row level security;
alter table public.variable_charge_events enable row level security;
alter table public.variable_charge_operations enable row level security;
alter table public.variable_charge_notification_states enable row level security;
alter table public.variable_charge_supplier_stages enable row level security;
alter table public.variable_charge_supplier_confirmations enable row level security;
alter table public.variable_charge_legacy_traffic enable row level security;

revoke all on table public.variable_charge_cases, public.variable_charge_confirmations,
  public.variable_charge_events, public.variable_charge_operations,
  public.variable_charge_notification_states, public.variable_charge_supplier_stages,
  public.variable_charge_supplier_confirmations, public.variable_charge_legacy_traffic from public, anon, authenticated;
grant all on table public.variable_charge_cases, public.variable_charge_confirmations,
  public.variable_charge_events, public.variable_charge_operations,
  public.variable_charge_notification_states, public.variable_charge_supplier_stages,
  public.variable_charge_supplier_confirmations, public.variable_charge_legacy_traffic to service_role;

-- Read/write compatibility for the previous deployment. These views are removed only
-- after the explicit 24-hour no-legacy-traffic gate.
create view public.ship_agent_charge_cases with (security_invoker = true) as select * from public.variable_charge_cases;
create view public.ship_agent_charge_confirmations with (security_invoker = true) as select * from public.variable_charge_confirmations;
create view public.ship_agent_charge_events with (security_invoker = true) as select * from public.variable_charge_events;
create view public.ship_agent_charge_operations with (security_invoker = true) as select * from public.variable_charge_operations;
create view public.ship_agent_charge_notification_states with (security_invoker = true) as select * from public.variable_charge_notification_states;
revoke all on table public.ship_agent_charge_cases, public.ship_agent_charge_confirmations,
  public.ship_agent_charge_events, public.ship_agent_charge_operations,
  public.ship_agent_charge_notification_states from public, anon, authenticated;
grant all on table public.ship_agent_charge_cases, public.ship_agent_charge_confirmations,
  public.ship_agent_charge_events, public.ship_agent_charge_operations,
  public.ship_agent_charge_notification_states to service_role;

create or replace function public.reserve_ship_agent_charge_operation(
  p_operation_id uuid,
  p_operation_type text,
  p_stem_id text,
  p_request_fingerprint text,
  p_actor_user_id uuid
)
returns public.variable_charge_operations language sql security invoker set search_path = public, pg_temp
as 'select public.reserve_variable_charge_operation(p_operation_id,p_operation_type,p_stem_id,p_request_fingerprint,p_actor_user_id)';
create or replace function public.complete_ship_agent_charge_operation(
  p_operation_id uuid,
  p_result jsonb,
  p_status text default 'succeeded'
)
returns public.variable_charge_operations language sql security invoker set search_path = public, pg_temp
as 'select public.complete_variable_charge_operation(p_operation_id,p_result,p_status)';
create or replace function public.sync_ship_agent_charge_case(p_case jsonb, p_event jsonb)
returns jsonb language sql security invoker set search_path = public, pg_temp
as 'select public.sync_variable_charge_case(p_case,p_event)';
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
returns jsonb language sql security invoker set search_path = public, pg_temp
as 'select public.confirm_variable_charge_case(p_stem_id,p_expected_revision,p_expected_fingerprint,p_confirmation,p_event,p_operation_id,p_request_fingerprint,p_actor_user_id,p_actor_email,p_override_reason)';
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
returns jsonb language sql security invoker set search_path = public, pg_temp
as 'select public.override_variable_charge_assignment(p_stem_id,p_assignee_user_id,p_reason,p_expected_revision,p_operation_id,p_request_fingerprint,p_actor_user_id,p_actor_email)';
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
returns jsonb language sql security invoker set search_path = public, pg_temp
as 'select public.resolve_variable_charge_post_invoice_change(p_stem_id,p_resolution,p_reference,p_note,p_expected_revision,p_operation_id,p_request_fingerprint,p_actor_user_id,p_actor_email,p_override_reason)';
create or replace function public.set_ship_agent_charge_notification_state(
  p_notification_key text,
  p_case_id uuid,
  p_user_id uuid,
  p_state text,
  p_snoozed_until timestamptz default null
)
returns integer language sql security invoker set search_path = public, pg_temp
as 'select public.set_variable_charge_notification_state(p_notification_key,p_case_id,p_user_id,p_state,p_snoozed_until)';

do $privileges$
declare
  v_function record;
begin
  for v_function in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%variable_charge%'
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated', v_function.nspname, v_function.proname, v_function.arguments);
    execute format('grant execute on function %I.%I(%s) to service_role', v_function.nspname, v_function.proname, v_function.arguments);
  end loop;
end
$privileges$;
grant execute on function public.reserve_variable_charge_operation(uuid,text,text,text,uuid) to service_role;
grant execute on function public.complete_variable_charge_operation(uuid,jsonb,text) to service_role;
grant execute on function public.sync_variable_charge_case(jsonb,jsonb) to service_role;
grant execute on function public.confirm_variable_charge_case(text,bigint,text,jsonb,jsonb,uuid,text,uuid,text,text) to service_role;
grant execute on function public.override_variable_charge_assignment(text,uuid,text,bigint,uuid,text,uuid,text) to service_role;
grant execute on function public.resolve_variable_charge_post_invoice_change(text,text,text,text,bigint,uuid,text,uuid,text,text) to service_role;
grant execute on function public.set_variable_charge_notification_state(text,uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.record_variable_charge_supplier_confirmation(text,text,uuid,text,text,text,timestamptz,boolean,boolean,uuid,text,boolean) to service_role;
grant execute on function public.sync_variable_charge_supplier_stages(text,jsonb) to service_role;
grant execute on function public.reserve_ship_agent_charge_operation(uuid,text,text,text,uuid) to service_role;
grant execute on function public.complete_ship_agent_charge_operation(uuid,jsonb,text) to service_role;
grant execute on function public.sync_ship_agent_charge_case(jsonb,jsonb) to service_role;
grant execute on function public.confirm_ship_agent_charge_case(text,bigint,text,jsonb,jsonb,uuid,text,uuid,text,text) to service_role;
grant execute on function public.override_ship_agent_charge_assignment(text,uuid,text,bigint,uuid,text,uuid,text) to service_role;
grant execute on function public.resolve_ship_agent_post_invoice_change(text,text,text,text,bigint,uuid,text,uuid,text,text) to service_role;
grant execute on function public.set_ship_agent_charge_notification_state(text,uuid,uuid,text,timestamptz) to service_role;

commit;
