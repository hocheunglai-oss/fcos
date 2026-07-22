create or replace function public.save_account_manager_group_family(
  p_account_name_key text,
  p_account_name text,
  p_salesforce_account_ids text[],
  p_account_roles text[],
  p_salesforce_manager_text text,
  p_manager_user_ids uuid[],
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint,
  p_child_account_name_keys text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parent_key text := lower(btrim(coalesce(p_account_name_key, '')));
  v_child_keys text[] := '{}'::text[];
  v_group jsonb;
  v_cleared_child_count integer := 0;
  v_lock_key text;
begin
  select coalesce(array_agg(distinct lower(btrim(child_key))), '{}'::text[])
  into v_child_keys
  from unnest(coalesce(p_child_account_name_keys, '{}'::text[])) as child_key
  where lower(btrim(child_key)) <> v_parent_key;

  if exists (
    select 1
    from unnest(v_child_keys) as child_key
    where child_key !~ '^[a-f0-9]{64}$'
  ) then
    raise exception 'Every child Account name key must be valid.';
  end if;

  for v_lock_key in
    select distinct lock_key
    from unnest(array_append(v_child_keys, v_parent_key)) as lock_key
    order by lock_key
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  end loop;

  select public.save_account_manager_group(
    p_account_name_key => v_parent_key,
    p_account_name => p_account_name,
    p_salesforce_account_ids => p_salesforce_account_ids,
    p_account_roles => p_account_roles,
    p_salesforce_manager_text => p_salesforce_manager_text,
    p_manager_user_ids => p_manager_user_ids,
    p_actor_user_id => p_actor_user_id,
    p_actor_email => p_actor_email,
    p_expected_revision => p_expected_revision
  ) into v_group;

  with cleared as (
    delete from public.account_manager_groups
    where account_name_key = any(v_child_keys)
    returning account_name_key
  )
  select count(*) into v_cleared_child_count from cleared;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_managers_group_propagated',
    jsonb_build_object(
      'group_account_name_key', v_parent_key,
      'group_account_name', btrim(coalesce(p_account_name, '')),
      'child_account_name_keys', to_jsonb(v_child_keys),
      'cleared_child_override_count', v_cleared_child_count,
      'salesforce_account_ids', to_jsonb(coalesce(p_salesforce_account_ids, '{}'::text[])),
      'manager_user_ids', to_jsonb(coalesce(p_manager_user_ids, '{}'::uuid[]))
    )
  );

  return v_group;
end;
$$;

revoke all on function public.save_account_manager_group_family(
  text, text, text[], text[], text, uuid[], uuid, text, bigint, text[]
) from public, anon, authenticated;

grant execute on function public.save_account_manager_group_family(
  text, text, text[], text[], text, uuid[], uuid, text, bigint, text[]
) to service_role;

notify pgrst, 'reload schema';
