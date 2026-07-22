create table if not exists public.account_manager_groups (
  account_name_key text primary key
    check (account_name_key ~ '^[a-f0-9]{64}$'),
  account_name text not null
    check (btrim(account_name) <> ''),
  salesforce_account_ids text[] not null,
  account_roles text[] not null,
  salesforce_manager_text text null
    check (char_length(salesforce_manager_text) <= 255),
  salesforce_sync_status text not null default 'pending'
    check (salesforce_sync_status in ('pending', 'synced', 'failed')),
  salesforce_sync_error text null,
  salesforce_synced_at timestamptz null,
  revision bigint not null default 1
    check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(salesforce_account_ids) > 0),
  check (cardinality(account_roles) > 0 and account_roles <@ array['buyer', 'buyer_supplier', 'broker']::text[])
);

create table if not exists public.account_manager_assignments (
  account_name_key text not null
    references public.account_manager_groups(account_name_key) on delete cascade,
  manager_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  assignment_order smallint not null
    check (assignment_order between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_name_key, manager_user_id),
  unique (account_name_key, assignment_order)
);

create index if not exists account_manager_assignments_user_idx
on public.account_manager_assignments(manager_user_id);

alter table public.account_manager_groups enable row level security;
alter table public.account_manager_assignments enable row level security;

revoke all on table public.account_manager_groups from public, anon, authenticated;
revoke all on table public.account_manager_assignments from public, anon, authenticated;
grant all on table public.account_manager_groups to service_role;
grant all on table public.account_manager_assignments to service_role;

insert into public.app_modules (id, label, path, sort_order) values
  ('buyers_administrator', 'Account Managers', '/account-managers', 85)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.save_account_manager_group(
  p_account_name_key text,
  p_account_name text,
  p_salesforce_account_ids text[],
  p_account_roles text[],
  p_salesforce_manager_text text,
  p_manager_user_ids uuid[],
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_name_key text := lower(btrim(coalesce(p_account_name_key, '')));
  v_account_name text := btrim(coalesce(p_account_name, ''));
  v_salesforce_account_ids text[] := coalesce(p_salesforce_account_ids, '{}'::text[]);
  v_account_roles text[] := coalesce(p_account_roles, '{}'::text[]);
  v_manager_user_ids uuid[] := coalesce(p_manager_user_ids, '{}'::uuid[]);
  v_manager_text text := nullif(btrim(coalesce(p_salesforce_manager_text, '')), '');
  v_current public.account_manager_groups%rowtype;
  v_group public.account_manager_groups%rowtype;
  v_previous_manager_user_ids uuid[] := '{}'::uuid[];
  v_active_user_count integer := 0;
  v_revision bigint := 1;
  v_now timestamptz := clock_timestamp();
begin
  if v_account_name_key !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid Account name key is required.';
  end if;
  if v_account_name = '' then
    raise exception 'Account name is required.';
  end if;
  if cardinality(v_salesforce_account_ids) = 0 then
    raise exception 'At least one active eligible Salesforce Account is required.';
  end if;
  if exists (
    select 1 from unnest(v_salesforce_account_ids) as account_id
    where account_id !~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
  ) then
    raise exception 'Every Salesforce Account ID must be valid.';
  end if;
  if cardinality(v_salesforce_account_ids) <> (
    select count(distinct account_id) from unnest(v_salesforce_account_ids) as account_id
  ) then
    raise exception 'Salesforce Account IDs cannot be repeated.';
  end if;
  if cardinality(v_account_roles) = 0
    or not v_account_roles <@ array['buyer', 'buyer_supplier', 'broker']::text[] then
    raise exception 'Every Account role must be eligible.';
  end if;
  if cardinality(v_manager_user_ids) > 3 then
    raise exception 'An Account can have at most three managers.';
  end if;
  if array_position(v_manager_user_ids, null) is not null then
    raise exception 'Manager user IDs cannot be empty.';
  end if;
  if cardinality(v_manager_user_ids) <> (
    select count(distinct manager_user_id) from unnest(v_manager_user_ids) as manager_user_id
  ) then
    raise exception 'The same manager cannot be assigned more than once.';
  end if;
  if char_length(coalesce(v_manager_text, '')) > 255 then
    raise exception 'Salesforce Account Manager text exceeds 255 characters.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_account_name_key, 0));

  select * into v_current
  from public.account_manager_groups
  where account_name_key = v_account_name_key
  for update;

  if found then
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
      raise exception 'This Account assignment changed after it was opened. Refresh and review the latest update before saving.';
    end if;
    v_revision := v_current.revision + 1;
  elsif coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'This Account assignment changed after it was opened. Refresh and review the latest update before saving.';
  end if;

  select coalesce(array_agg(manager_user_id order by assignment_order), '{}'::uuid[])
  into v_previous_manager_user_ids
  from public.account_manager_assignments
  where account_name_key = v_account_name_key;

  if cardinality(v_manager_user_ids) > 0 then
    select count(*) into v_active_user_count
    from public.user_profiles
    where id = any(v_manager_user_ids)
      and active = true;

    if v_active_user_count <> cardinality(v_manager_user_ids) then
      raise exception 'Every assigned manager must be an active FCOS user.';
    end if;
  end if;

  insert into public.account_manager_groups (
    account_name_key,
    account_name,
    salesforce_account_ids,
    account_roles,
    salesforce_manager_text,
    salesforce_sync_status,
    salesforce_sync_error,
    salesforce_synced_at,
    revision,
    updated_by,
    updated_by_email,
    updated_at
  ) values (
    v_account_name_key,
    v_account_name,
    v_salesforce_account_ids,
    v_account_roles,
    v_manager_text,
    'pending',
    null,
    null,
    v_revision,
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    v_now
  )
  on conflict (account_name_key) do update set
    account_name = excluded.account_name,
    salesforce_account_ids = excluded.salesforce_account_ids,
    account_roles = excluded.account_roles,
    salesforce_manager_text = excluded.salesforce_manager_text,
    salesforce_sync_status = excluded.salesforce_sync_status,
    salesforce_sync_error = excluded.salesforce_sync_error,
    salesforce_synced_at = excluded.salesforce_synced_at,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into v_group;

  delete from public.account_manager_assignments
  where account_name_key = v_account_name_key;

  insert into public.account_manager_assignments (
    account_name_key,
    manager_user_id,
    assignment_order,
    updated_at
  )
  select
    v_account_name_key,
    manager_user_id,
    assignment_order::smallint,
    v_now
  from unnest(v_manager_user_ids) with ordinality as selected(manager_user_id, assignment_order);

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_managers_updated',
    jsonb_build_object(
      'account_name_key', v_account_name_key,
      'account_name', v_account_name,
      'salesforce_account_ids', to_jsonb(v_salesforce_account_ids),
      'account_roles', to_jsonb(v_account_roles),
      'previous_manager_user_ids', to_jsonb(v_previous_manager_user_ids),
      'manager_user_ids', to_jsonb(v_manager_user_ids),
      'salesforce_manager_text', v_manager_text,
      'revision', v_revision
    )
  );

  return to_jsonb(v_group);
end;
$$;

create or replace function public.finalize_account_manager_sync(
  p_account_name_key text,
  p_revision bigint,
  p_sync_status text,
  p_sync_error text,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group public.account_manager_groups%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_sync_status not in ('synced', 'failed') then
    raise exception 'Account Manager sync status must be synced or failed.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_name_key, 0));

  select * into v_group
  from public.account_manager_groups
  where account_name_key = p_account_name_key
  for update;

  if not found or v_group.revision <> p_revision then
    raise exception 'This Account assignment changed before Salesforce synchronization completed.';
  end if;

  update public.account_manager_groups
  set
    salesforce_sync_status = p_sync_status,
    salesforce_sync_error = case when p_sync_status = 'failed' then nullif(btrim(coalesce(p_sync_error, '')), '') else null end,
    salesforce_synced_at = case when p_sync_status = 'synced' then v_now else salesforce_synced_at end
  where account_name_key = p_account_name_key
  returning * into v_group;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_managers_salesforce_sync',
    jsonb_build_object(
      'account_name_key', p_account_name_key,
      'account_name', v_group.account_name,
      'salesforce_account_ids', to_jsonb(v_group.salesforce_account_ids),
      'sync_status', p_sync_status,
      'sync_error', nullif(btrim(coalesce(p_sync_error, '')), ''),
      'revision', p_revision
    )
  );

  return to_jsonb(v_group);
end;
$$;

revoke all on function public.save_account_manager_group(text, text, text[], text[], text, uuid[], uuid, text, bigint)
from public, anon, authenticated;
grant execute on function public.save_account_manager_group(text, text, text[], text[], text, uuid[], uuid, text, bigint)
to service_role;

revoke all on function public.finalize_account_manager_sync(text, bigint, text, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.finalize_account_manager_sync(text, bigint, text, text, uuid, text)
to service_role;
