alter table public.account_pic_directories
  add column if not exists row_color_rules jsonb not null default '[]'::jsonb
    check (jsonb_typeof(row_color_rules) = 'array' and jsonb_array_length(row_color_rules) <= 50);

alter table public.account_pic_directory_operations
  drop constraint if exists account_pic_directory_operations_operation_check;

alter table public.account_pic_directory_operations
  add constraint account_pic_directory_operations_operation_check
    check (operation in ('save', 'import', 'row_colors'));

create or replace function public.save_account_pic_row_color_rules(
  p_salesforce_account_id text,
  p_rules jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_account_id text := btrim(coalesce(p_salesforce_account_id, ''));
  v_rules jsonb := coalesce(p_rules, '[]'::jsonb);
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_request_hash text := lower(btrim(coalesce(p_request_hash, '')));
  v_current public.account_pic_directories%rowtype;
  v_existing public.account_pic_directory_operations%rowtype;
  v_rule jsonb;
  v_rule_id uuid;
  v_column_id uuid;
  v_match_value text;
  v_match_label text;
  v_color text;
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
begin
  if v_account_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$' then
    raise exception 'A valid Salesforce Account ID is required.';
  end if;
  if jsonb_typeof(v_rules) <> 'array' or jsonb_array_length(v_rules) > 50 then
    raise exception 'Use no more than 50 row colour rules.';
  end if;
  if char_length(v_idempotency_key) not between 16 and 200 then
    raise exception 'A valid idempotency key is required.';
  end if;
  if v_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid request hash is required.';
  end if;

  for v_rule in select value from jsonb_array_elements(v_rules)
  loop
    if jsonb_typeof(v_rule) <> 'object' then
      raise exception 'Every row colour rule must be an object.';
    end if;
    begin
      v_rule_id := (v_rule->>'id')::uuid;
      v_column_id := (v_rule->>'columnId')::uuid;
    exception when others then
      raise exception 'Every row colour rule requires valid IDs.';
    end;
    v_match_value := btrim(coalesce(v_rule->>'matchValue', ''));
    v_match_label := btrim(coalesce(v_rule->>'matchLabel', ''));
    v_color := lower(btrim(coalesce(v_rule->>'color', '')));
    if v_match_value = '' or char_length(v_match_value) > 4100 then
      raise exception 'Every row colour rule requires a valid exact value.';
    end if;
    if char_length(v_match_label) > 300 then
      raise exception 'Row colour rule labels cannot exceed 300 characters.';
    end if;
    if v_color not in ('blue', 'emerald', 'amber', 'rose', 'violet', 'cyan', 'orange', 'slate') then
      raise exception 'Row colour is invalid.';
    end if;
    if not exists (
      select 1 from public.account_pic_directory_columns c
      where c.salesforce_account_id = v_account_id and c.id = v_column_id
    ) then
      raise exception 'A row colour rule references an unavailable column.';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(v_rules) rule
    group by rule->>'columnId', rule->>'matchValue'
    having count(*) > 1
  ) then
    raise exception 'Each column value can have only one row colour rule.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_account_id, 0));

  select * into v_existing
  from public.account_pic_directory_operations
  where idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing.operation <> 'row_colors'
      or v_existing.salesforce_account_id <> v_account_id
      or v_existing.request_hash <> v_request_hash then
      raise exception 'This idempotency key belongs to a different Buyer PIC operation.';
    end if;
    return jsonb_build_object('replay', true, 'revision', v_existing.result_revision);
  end if;

  select * into v_current
  from public.account_pic_directories
  where salesforce_account_id = v_account_id
  for update;

  if not found then
    raise exception 'This Buyer PIC Reference table no longer exists.';
  end if;
  if p_expected_revision is null or v_current.revision <> p_expected_revision then
    raise exception 'This Buyer PIC directory changed after it was opened. Refresh and review the latest update before saving.';
  end if;

  v_revision := v_current.revision + 1;
  update public.account_pic_directories
  set row_color_rules = v_rules,
      revision = v_revision,
      updated_by = p_actor_user_id,
      updated_by_email = nullif(btrim(coalesce(p_actor_email, '')), ''),
      updated_at = v_now
  where salesforce_account_id = v_account_id;

  insert into public.account_pic_directory_operations (
    idempotency_key, operation, salesforce_account_id, request_hash,
    result_revision, actor_user_id, actor_email
  ) values (
    v_idempotency_key, 'row_colors', v_account_id, v_request_hash,
    v_revision, p_actor_user_id, nullif(btrim(coalesce(p_actor_email, '')), '')
  );

  insert into public.admin_audit_logs (actor_user_id, actor_email, action, metadata)
  values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_pic_row_colors_saved',
    jsonb_build_object(
      'salesforce_account_id', v_account_id,
      'rule_count', jsonb_array_length(v_rules),
      'revision', v_revision,
      'request_hash', v_request_hash
    )
  );

  return jsonb_build_object('replay', false, 'revision', v_revision);
end;
$$;

revoke all on function public.save_account_pic_row_color_rules(text, jsonb, uuid, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.save_account_pic_row_color_rules(text, jsonb, uuid, text, bigint, text, text)
  to service_role;
