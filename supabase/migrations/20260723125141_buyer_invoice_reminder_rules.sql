create table public.buyer_invoice_reminder_rules (
  salesforce_account_id text primary key
    check (salesforce_account_id ~ '^[A-Za-z0-9]{15}$'),
  account_name text not null,
  account_type text not null
    check (account_type in ('buyer', 'buyer_supplier', 'group')),
  parent_salesforce_account_id text null
    check (
      parent_salesforce_account_id is null
      or parent_salesforce_account_id ~ '^[A-Za-z0-9]{15}$'
    ),
  policy text not null default 'standard'
    check (policy in ('standard', 'overdue_only')),
  note text not null default ''
    check (char_length(note) <= 255),
  inherit_to_children boolean not null default false,
  revision bigint not null default 1
    check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (account_type = 'group' or inherit_to_children = false)
);

create index buyer_invoice_reminder_rules_parent_idx
on public.buyer_invoice_reminder_rules(parent_salesforce_account_id);

create index buyer_invoice_reminder_rules_policy_idx
on public.buyer_invoice_reminder_rules(policy);

alter table public.buyer_invoice_reminder_rules enable row level security;

revoke all on table public.buyer_invoice_reminder_rules
from public, anon, authenticated;
grant all on table public.buyer_invoice_reminder_rules to service_role;

create or replace function public.save_buyer_invoice_reminder_rule(
  p_salesforce_account_id text,
  p_account_name text,
  p_account_type text,
  p_parent_salesforce_account_id text,
  p_policy text,
  p_note text,
  p_inherit_to_children boolean,
  p_replace_child_overrides boolean,
  p_child_account_ids text[],
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id text := btrim(coalesce(p_salesforce_account_id, ''));
  v_account_name text := btrim(coalesce(p_account_name, ''));
  v_account_type text := btrim(coalesce(p_account_type, ''));
  v_parent_account_id text := nullif(btrim(coalesce(p_parent_salesforce_account_id, '')), '');
  v_policy text := btrim(coalesce(p_policy, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_inherit boolean := coalesce(p_inherit_to_children, false);
  v_current public.buyer_invoice_reminder_rules%rowtype;
  v_saved public.buyer_invoice_reminder_rules%rowtype;
  v_revision bigint := 1;
  v_replaced_child_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_account_id !~ '^[A-Za-z0-9]{15}$' then
    raise exception 'A valid Salesforce Account ID is required.';
  end if;
  if v_account_name = '' then
    raise exception 'Account name is required.';
  end if;
  if v_account_type not in ('buyer', 'buyer_supplier', 'group') then
    raise exception 'Account type is not eligible for Buyer Invoice reminder rules.';
  end if;
  if v_parent_account_id is not null and v_parent_account_id !~ '^[A-Za-z0-9]{15}$' then
    raise exception 'Parent Salesforce Account ID is invalid.';
  end if;
  if v_policy not in ('standard', 'overdue_only') then
    raise exception 'Reminder policy must be Standard or Overdue only.';
  end if;
  if char_length(v_note) > 255 then
    raise exception 'Reminder rule note cannot exceed 255 characters.';
  end if;
  if v_account_type <> 'group' and v_inherit then
    raise exception 'Only GROUP Accounts can continuously apply a rule to children.';
  end if;
  if coalesce(p_replace_child_overrides, false) and (v_account_type <> 'group' or not v_inherit) then
    raise exception 'Child overrides can be replaced only for GROUP + children updates.';
  end if;
  if not exists (
    select 1 from public.user_profiles
    where id = p_actor_user_id and active = true
  ) then
    raise exception 'The reminder rule editor must be an active FCOS user.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('buyer-reminder-rule:' || v_account_id, 0));

  select * into v_current
  from public.buyer_invoice_reminder_rules
  where salesforce_account_id = v_account_id
  for update;

  if found then
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
      raise exception 'This reminder rule changed after it was opened. Refresh and review the latest rule before saving.';
    end if;
    v_revision := v_current.revision + 1;
  elsif coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'This reminder rule changed after it was opened. Refresh and review the latest rule before saving.';
  end if;

  if coalesce(p_replace_child_overrides, false) then
    delete from public.buyer_invoice_reminder_rules
    where salesforce_account_id = any(coalesce(p_child_account_ids, '{}'::text[]))
      and salesforce_account_id <> v_account_id;
    get diagnostics v_replaced_child_count = row_count;
  end if;

  insert into public.buyer_invoice_reminder_rules (
    salesforce_account_id,
    account_name,
    account_type,
    parent_salesforce_account_id,
    policy,
    note,
    inherit_to_children,
    revision,
    updated_by,
    updated_by_email,
    created_at,
    updated_at
  ) values (
    v_account_id,
    v_account_name,
    v_account_type,
    v_parent_account_id,
    v_policy,
    v_note,
    v_inherit,
    v_revision,
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    v_now,
    v_now
  )
  on conflict (salesforce_account_id) do update set
    account_name = excluded.account_name,
    account_type = excluded.account_type,
    parent_salesforce_account_id = excluded.parent_salesforce_account_id,
    policy = excluded.policy,
    note = excluded.note,
    inherit_to_children = excluded.inherit_to_children,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    updated_at = excluded.updated_at
  returning * into v_saved;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'buyer_invoice_reminder_rule_saved',
    jsonb_build_object(
      'salesforce_account_id', v_account_id,
      'account_name', v_account_name,
      'account_type', v_account_type,
      'previous_policy', v_current.policy,
      'policy', v_policy,
      'inherit_to_children', v_inherit,
      'replaced_child_override_count', v_replaced_child_count,
      'revision', v_revision
    )
  );

  return to_jsonb(v_saved) || jsonb_build_object(
    'replaced_child_override_count', v_replaced_child_count
  );
end;
$$;

revoke all on function public.save_buyer_invoice_reminder_rule(
  text, text, text, text, text, text, boolean, boolean, text[], bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.save_buyer_invoice_reminder_rule(
  text, text, text, text, text, text, boolean, boolean, text[], bigint, uuid, text
) to service_role;

create or replace function public.remove_buyer_invoice_reminder_rule(
  p_salesforce_account_id text,
  p_expected_revision bigint,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id text := btrim(coalesce(p_salesforce_account_id, ''));
  v_current public.buyer_invoice_reminder_rules%rowtype;
begin
  if v_account_id !~ '^[A-Za-z0-9]{15}$' then
    raise exception 'A valid Salesforce Account ID is required.';
  end if;
  if not exists (
    select 1 from public.user_profiles
    where id = p_actor_user_id and active = true
  ) then
    raise exception 'The reminder rule editor must be an active FCOS user.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('buyer-reminder-rule:' || v_account_id, 0));

  select * into v_current
  from public.buyer_invoice_reminder_rules
  where salesforce_account_id = v_account_id
  for update;

  if not found or p_expected_revision is null or v_current.revision <> p_expected_revision then
    raise exception 'This reminder rule changed after it was opened. Refresh and review the latest rule before saving.';
  end if;

  delete from public.buyer_invoice_reminder_rules
  where salesforce_account_id = v_account_id;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'buyer_invoice_reminder_rule_removed',
    jsonb_build_object(
      'salesforce_account_id', v_account_id,
      'account_name', v_current.account_name,
      'policy', v_current.policy,
      'revision', v_current.revision
    )
  );

  return jsonb_build_object(
    'removed', true,
    'salesforce_account_id', v_account_id
  );
end;
$$;

revoke all on function public.remove_buyer_invoice_reminder_rule(
  text, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.remove_buyer_invoice_reminder_rule(
  text, bigint, uuid, text
) to service_role;

notify pgrst, 'reload schema';
