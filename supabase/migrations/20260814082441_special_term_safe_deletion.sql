begin;

alter table public.special_terms_operations
  drop constraint if exists special_terms_operations_operation_type_check;

alter table public.special_terms_operations
  add constraint special_terms_operations_operation_type_check
  check (operation_type in (
    'term_create', 'term_update', 'term_delete', 'rule_create', 'rule_update', 'rule_delete',
    'composition_save', 'clause_draft_create', 'clause_draft_revise',
    'clause_draft_delete', 'clause_version_discard', 'clause_approve', 'clause_retire',
    'clause_consolidation_start', 'clause_consolidation_relink',
    'clause_consolidation_cancel', 'clause_consolidation_complete',
    'migration_review_save', 'migration_activate', 'migration_rollback',
    'revision_save', 'revision_approve', 'revision_rollback',
    'migration_batch_review', 'clause_ai_draft'
  ));

-- Create operations originally learned their Salesforce id only after the write.
-- Backfill the redacted identifier and keep later creator checks indexed.
update public.special_terms_operations
set salesforce_record_id = coalesce(
  nullif(result_snapshot->>'id', ''),
  nullif(result_snapshot->>'clauseId', ''),
  nullif(result_snapshot->>'versionId', '')
)
where operation_status = 'succeeded'
  and salesforce_record_id is null
  and coalesce(
    nullif(result_snapshot->>'id', ''),
    nullif(result_snapshot->>'clauseId', ''),
    nullif(result_snapshot->>'versionId', '')
  ) ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$';

create index if not exists special_terms_operations_record_creator_idx
on public.special_terms_operations(salesforce_record_id, operation_type, operation_status, actor_user_id)
where salesforce_record_id is not null and operation_status = 'succeeded';

create or replace function public.reserve_special_terms_operation_v2(
  p_operation_id text,
  p_operation_type text,
  p_request_hash text,
  p_salesforce_object text,
  p_salesforce_record_id text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_audit_reason_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.special_terms_operations;
begin
  if char_length(coalesce(p_operation_id, '')) not between 1 and 100
    or p_request_hash !~ '^[a-f0-9]{64}$'
    or (p_audit_reason_hash is not null and p_audit_reason_hash !~ '^[a-f0-9]{64}$') then
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
        audit_reason_hash = p_audit_reason_hash, error_code = null, error_message = null,
        result_snapshot = '{}'::jsonb, updated_at = now(), completed_at = null
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.special_terms_operations (
      operation_id, operation_type, request_hash, operation_status, salesforce_object,
      salesforce_record_id, audit_reason, audit_reason_hash, result_snapshot, actor_user_id, actor_email
    ) values (
      p_operation_id, p_operation_type, p_request_hash, 'pending', p_salesforce_object,
      p_salesforce_record_id, null, p_audit_reason_hash, '{}'::jsonb, p_actor_user_id,
      nullif(left(coalesce(p_actor_email, ''), 320), '')
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
declare
  v_record_id text := coalesce(
    nullif(p_result_snapshot->>'id', ''),
    nullif(p_result_snapshot->>'clauseId', ''),
    nullif(p_result_snapshot->>'versionId', '')
  );
begin
  if p_operation_status not in ('succeeded', 'failed', 'uncertain') then
    raise exception 'Invalid Special Terms operation completion state.';
  end if;
  update public.special_terms_operations
  set operation_status = p_operation_status,
      salesforce_record_id = case
        when p_operation_status = 'succeeded' and v_record_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' then v_record_id
        else salesforce_record_id
      end,
      result_snapshot = case when p_operation_status = 'succeeded' then coalesce(p_result_snapshot, '{}'::jsonb) else '{}'::jsonb end,
      error_code = case when p_operation_status = 'succeeded' then null else nullif(left(coalesce(p_error_code, ''), 100), '') end,
      error_message = case when p_operation_status = 'succeeded' then null else nullif(left(coalesce(p_error_message, ''), 500), '') end,
      updated_at = now(), completed_at = now()
  where operation_id = p_operation_id;
  if not found then raise exception 'Special Terms operation no longer exists.'; end if;
end;
$$;

create or replace function public.special_terms_record_creator(
  p_salesforce_record_id text,
  p_operation_types text[],
  p_actor_user_id uuid,
  p_actor_email text
) returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_salesforce_record_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
    or coalesce(cardinality(p_operation_types), 0) not between 1 and 4
    or (p_operation_types <@ array['term_create','rule_create','rule_update','clause_draft_create','clause_draft_revise']::text[]) is not true
    or p_actor_user_id is null
    or nullif(lower(btrim(coalesce(p_actor_email, ''))), '') is null then
    return false;
  end if;
  return exists (
    select 1
    from public.special_terms_operations operation
    where operation.salesforce_record_id = p_salesforce_record_id
      and operation.operation_type = any(p_operation_types)
      and operation.operation_status = 'succeeded'
      and (
        operation.actor_user_id = p_actor_user_id
        or lower(btrim(coalesce(operation.actor_email, ''))) = lower(btrim(p_actor_email))
      )
  );
end;
$$;

create or replace function public.special_terms_records_created_by(
  p_salesforce_record_ids text[],
  p_operation_types text[],
  p_actor_user_id uuid,
  p_actor_email text
) returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids text[] := array(select distinct id from unnest(coalesce(p_salesforce_record_ids, '{}'::text[])) id);
begin
  if coalesce(cardinality(v_ids), 0) not between 1 and 5000
    or exists (select 1 from unnest(v_ids) id where id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$')
    or coalesce(cardinality(p_operation_types), 0) not between 1 and 4
    or (p_operation_types <@ array['term_create','rule_create','rule_update','clause_draft_create','clause_draft_revise']::text[]) is not true
    or p_actor_user_id is null
    or nullif(lower(btrim(coalesce(p_actor_email, ''))), '') is null then
    return false;
  end if;
  return not exists (
    select 1
    from unnest(v_ids) requested(id)
    where not exists (
      select 1
      from public.special_terms_operations operation
      where operation.salesforce_record_id = requested.id
        and operation.operation_type = any(p_operation_types)
        and operation.operation_status = 'succeeded'
        and (
          operation.actor_user_id = p_actor_user_id
          or lower(btrim(coalesce(operation.actor_email, ''))) = lower(btrim(p_actor_email))
        )
    )
  );
end;
$$;

alter table public.special_terms_operations enable row level security;
revoke all on table public.special_terms_operations from anon, authenticated;
grant all on table public.special_terms_operations to service_role;

revoke all on function public.reserve_special_terms_operation_v2(text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_special_terms_operation(text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.special_terms_record_creator(text, text[], uuid, text) from public, anon, authenticated;
revoke all on function public.special_terms_records_created_by(text[], text[], uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_special_terms_operation_v2(text, text, text, text, text, uuid, text, text) to service_role;
grant execute on function public.complete_special_terms_operation(text, text, jsonb, text, text) to service_role;
grant execute on function public.special_terms_record_creator(text, text[], uuid, text) to service_role;
grant execute on function public.special_terms_records_created_by(text[], text[], uuid, text) to service_role;

commit;
