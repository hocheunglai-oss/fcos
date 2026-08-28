begin;

-- Drafting is available to every active FCOS user. Approval remains a separate
-- General Manager/Administrator capability established by the prior migration.
insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id, 'special_terms_manage', true
from public.user_types
on conflict (user_type_id, module_id) do update set can_view = true, updated_at = now();

insert into public.user_module_permissions (user_id, module_id, can_view)
select id, 'special_terms_manage', true
from public.user_profiles
where use_type_defaults = false and active = true
on conflict (user_id, module_id) do update set can_view = true, updated_at = now();

-- Service-only operation ledger. Contractual wording, reviewer reasons, and AI
-- prompts/responses stay in Salesforce/the protected provider and are never copied
-- to Supabase.
alter table public.special_terms_operations
  add column if not exists audit_reason_hash text null
  check (audit_reason_hash is null or audit_reason_hash ~ '^[a-f0-9]{64}$');

-- Remove historic free-text reasons from this service ledger and enforce the
-- redaction invariant for all later writes. The Salesforce audit remains the
-- authoritative location for reviewer rationale.
update public.special_terms_operations set audit_reason = null where audit_reason is not null;

create or replace function public.redact_special_terms_operation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.audit_reason := null;
  new.error_message := case
    when new.error_message is null then null
    when new.error_message ilike '%timeout%' or new.error_message ilike '%network%' then 'Salesforce completion could not be confirmed.'
    else 'Salesforce rejected the Special Terms operation.'
  end;
  return new;
end;
$$;

drop trigger if exists special_terms_operations_redact on public.special_terms_operations;
create trigger special_terms_operations_redact
before insert or update on public.special_terms_operations
for each row execute function public.redact_special_terms_operation();

alter table public.special_terms_operations
  drop constraint if exists special_terms_operations_operation_type_check;

alter table public.special_terms_operations
  add constraint special_terms_operations_operation_type_check
  check (operation_type in (
    'term_create', 'term_update', 'term_delete', 'rule_create', 'rule_update', 'rule_delete',
    'composition_save', 'clause_draft_create', 'clause_draft_revise', 'clause_approve', 'clause_retire',
    'migration_review_save', 'migration_activate', 'migration_rollback',
    'revision_save', 'revision_approve', 'revision_rollback', 'migration_batch_review', 'clause_ai_draft'
  ));

create or replace function public.reserve_special_terms_operation(
  p_operation_id text,
  p_operation_type text,
  p_request_hash text,
  p_salesforce_object text,
  p_salesforce_record_id text,
  p_actor_user_id uuid,
  p_actor_email text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.special_terms_operations;
begin
  if char_length(coalesce(p_operation_id, '')) not between 1 and 100
    or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid Special Terms operation identity.';
  end if;

  select * into v_row
  from public.special_terms_operations
  where operation_id = p_operation_id
  for update;

  if found then
    if v_row.request_hash <> p_request_hash then
      raise exception 'This operation ID was already used for different data.' using errcode = 'P0001';
    end if;
    if v_row.operation_status = 'succeeded' then
      return jsonb_build_object('replay', true, 'result_snapshot', v_row.result_snapshot);
    end if;
    if v_row.operation_status in ('pending', 'uncertain') then
      raise exception 'This operation is already processing or requires review.' using errcode = 'P0001';
    end if;
    update public.special_terms_operations
    set operation_status = 'pending', salesforce_object = p_salesforce_object,
        salesforce_record_id = p_salesforce_record_id, actor_user_id = p_actor_user_id,
        actor_email = nullif(left(coalesce(p_actor_email, ''), 320), ''), audit_reason = null,
        audit_reason_hash = null, error_code = null, error_message = null,
        result_snapshot = '{}'::jsonb, updated_at = now(), completed_at = null
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.special_terms_operations (
      operation_id, operation_type, request_hash, operation_status, salesforce_object,
      salesforce_record_id, audit_reason, audit_reason_hash, result_snapshot, actor_user_id, actor_email
    ) values (
      p_operation_id, p_operation_type, p_request_hash, 'pending', p_salesforce_object,
      p_salesforce_record_id, null, null, '{}'::jsonb, p_actor_user_id, nullif(left(coalesce(p_actor_email, ''), 320), '')
    ) returning * into v_row;
  end if;
  return jsonb_build_object('operation', to_jsonb(v_row));
end;
$$;

create or replace function public.complete_special_terms_operation(
  p_operation_id text,
  p_operation_status text,
  p_result_snapshot jsonb,
  p_error_code text,
  p_error_message text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_operation_status not in ('succeeded', 'failed', 'uncertain') then
    raise exception 'Invalid Special Terms operation completion state.';
  end if;
  update public.special_terms_operations
  set operation_status = p_operation_status,
      result_snapshot = case when p_operation_status = 'succeeded' then coalesce(p_result_snapshot, '{}'::jsonb) else '{}'::jsonb end,
      error_code = case when p_operation_status = 'succeeded' then null else nullif(left(coalesce(p_error_code, ''), 100), '') end,
      error_message = case when p_operation_status = 'succeeded' then null else nullif(left(coalesce(p_error_message, ''), 500), '') end,
      updated_at = now(), completed_at = now()
  where operation_id = p_operation_id;
  if not found then raise exception 'Special Terms operation no longer exists.'; end if;
end;
$$;

-- Notification state is intentionally service-only. It is keyed by a redacted
-- workflow token and contains no clause/term wording.
create table if not exists public.special_terms_notification_states (
  notification_key text not null check (char_length(notification_key) between 1 and 200),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  read_at timestamptz null,
  handled_at timestamptz null,
  snoozed_until timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (notification_key, user_id)
);
alter table public.special_terms_notification_states enable row level security;
revoke all on table public.special_terms_notification_states from anon, authenticated;
grant all on table public.special_terms_notification_states to service_role;

create or replace function public.set_special_terms_notification_state(
  p_notification_key text,
  p_user_id uuid,
  p_state text,
  p_snoozed_until timestamptz default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if char_length(coalesce(p_notification_key, '')) not between 1 and 200
    or p_state not in ('read', 'unread', 'handled', 'unhandled', 'snoozed') then
    raise exception 'Invalid Special Terms notification state.';
  end if;
  insert into public.special_terms_notification_states(notification_key, user_id, read_at, handled_at, snoozed_until, updated_at)
  values (
    p_notification_key, p_user_id,
    case when p_state = 'read' then now() else null end,
    case when p_state = 'handled' then now() else null end,
    case when p_state = 'snoozed' then p_snoozed_until else null end, now()
  )
  on conflict (notification_key, user_id) do update set
    read_at = case when p_state = 'read' then now() when p_state = 'unread' then null else public.special_terms_notification_states.read_at end,
    handled_at = case when p_state = 'handled' then now() when p_state = 'unhandled' then null else public.special_terms_notification_states.handled_at end,
    snoozed_until = case when p_state = 'snoozed' then p_snoozed_until when p_state in ('read', 'unread', 'handled', 'unhandled') then null else public.special_terms_notification_states.snoozed_until end,
    updated_at = now();
end;
$$;

revoke all on function public.reserve_special_terms_operation(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_special_terms_operation(text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.set_special_terms_notification_state(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.redact_special_terms_operation() from public, anon, authenticated;
grant execute on function public.reserve_special_terms_operation(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.complete_special_terms_operation(text, text, jsonb, text, text) to service_role;
grant execute on function public.set_special_terms_notification_state(text, uuid, text, timestamptz) to service_role;

commit;
