-- Make General Manager a protected, Administrator-equivalent user type while
-- retaining collaboration_roles as the UUID-backed authority record.

insert into public.user_types (
  id, label, description, is_system, sort_order
) values (
  'general_manager',
  'General Manager',
  'Full administration access and the single reporting-hierarchy root.',
  true,
  5
)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  is_system = true,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (
  user_type_id, module_id, can_view, updated_at
)
select
  'general_manager',
  permission.module_id,
  true,
  now()
from public.user_type_module_permissions permission
where permission.user_type_id = 'administrator'
on conflict (user_type_id, module_id) do update set
  can_view = true,
  updated_at = now();

create or replace function public.protect_last_active_administrator()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_removing_administrator boolean;
  v_remaining_count bigint;
begin
  if tg_op = 'DELETE' then
    v_removing_administrator := old.active
      and old.user_type in ('administrator', 'general_manager');
  else
    v_removing_administrator := old.active
      and old.user_type in ('administrator', 'general_manager')
      and (
        not new.active
        or new.user_type not in ('administrator', 'general_manager')
      );
  end if;

  if not v_removing_administrator then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('public:user_profiles:active-administrator', 0)
  );
  select count(*)
  into v_remaining_count
  from public.user_profiles profile
  where profile.id <> old.id
    and profile.active
    and profile.user_type in ('administrator', 'general_manager');

  if v_remaining_count = 0 then
    raise exception 'At least one active FCOS Administrator or General Manager is required.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  v_general_manager_ids uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('fcos_general_manager_assignment'));

  select array_agg(role_row.user_id order by role_row.user_id)
  into v_general_manager_ids
  from public.collaboration_roles role_row
  join public.user_profiles profile on profile.id = role_row.user_id
  where role_row.role = 'general_manager'
    and role_row.active
    and profile.active;

  -- A brand-new database has no FCOS identities yet. Leave the protected type
  -- ready for the first Administrator to provision; once any identity exists,
  -- the authority mapping must already be singular and UUID-backed.
  if coalesce(cardinality(v_general_manager_ids), 0) = 0
     and not exists (select 1 from public.user_profiles) then
    null;
  elsif coalesce(cardinality(v_general_manager_ids), 0) <> 1 then
    raise exception 'General Manager role validation failed. Exactly one active UUID-backed General Manager is required.';
  else
    update public.user_profiles
    set user_type = 'general_manager',
        use_type_defaults = true,
        updated_at = now()
    where id = v_general_manager_ids[1];
  end if;
end;
$$;

create or replace function public.assign_general_manager_user_type(
  p_target_user_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_confirm_transfer boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_target public.user_profiles%rowtype;
  v_current public.user_profiles%rowtype;
  v_general_manager_ids uuid[];
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('fcos_general_manager_assignment'));

  select * into v_actor
  from public.user_profiles
  where id = p_actor_id
    and active
    and user_type in ('administrator', 'general_manager')
  for update;
  if not found then
    raise exception 'Active Administrator or General Manager access is required.';
  end if;
  if lower(coalesce(v_actor.email, '')) <> lower(btrim(coalesce(p_actor_email, ''))) then
    raise exception 'The authenticated administrator does not match the requested actor.';
  end if;

  select array_agg(role_row.user_id order by role_row.user_id)
  into v_general_manager_ids
  from public.collaboration_roles role_row
  join public.user_profiles profile on profile.id = role_row.user_id
  where role_row.role = 'general_manager'
    and role_row.active
    and profile.active;
  if coalesce(cardinality(v_general_manager_ids), 0) <> 1 then
    raise exception 'General Manager role validation failed. Exactly one active UUID-backed General Manager is required.';
  end if;

  select * into v_current
  from public.user_profiles
  where id = v_general_manager_ids[1]
  for update;
  if not found or v_current.user_type <> 'general_manager' then
    raise exception 'General Manager role validation failed. The authority role and user type are inconsistent.';
  end if;

  select * into v_target
  from public.user_profiles
  where id = p_target_user_id
    and active
  for update;
  if not found then
    raise exception 'The General Manager must be an active FCOS user.';
  end if;

  if v_target.id = v_current.id then
    return jsonb_build_object(
      'transferred', false,
      'generalManagerUserId', v_current.id,
      'generalManagerName', v_current.full_name,
      'generalManagerEmail', v_current.email
    );
  end if;
  if not p_confirm_transfer then
    raise exception 'Confirm the General Manager transfer before saving.';
  end if;

  update public.collaboration_roles
  set active = false,
      updated_at = v_now
  where user_id = v_current.id
    and role = 'general_manager';

  update public.user_profiles
  set user_type = 'administrator',
      use_type_defaults = true,
      updated_at = v_now
  where id = v_current.id;

  update public.user_profiles
  set user_type = 'general_manager',
      active = true,
      use_type_defaults = true,
      updated_at = v_now
  where id = v_target.id;

  insert into public.collaboration_roles (
    user_id, role, active, granted_by, granted_by_email, updated_at
  ) values (
    v_target.id, 'general_manager', true, v_actor.id,
    lower(btrim(v_actor.email)), v_now
  )
  on conflict (user_id) do update set
    role = 'general_manager',
    active = true,
    granted_by = excluded.granted_by,
    granted_by_email = excluded.granted_by_email,
    updated_at = excluded.updated_at;

  delete from public.growth_reporting_assignments
  where employee_id = v_target.id;

  update public.growth_goals
  set primary_manager_id = null,
      status = case
        when status = 'Pending Approval' then 'Revision Requested'
        when status in ('Completion Review', 'Cancellation Requested') then 'Active'
        else status
      end,
      revision = revision + 1,
      updated_by = v_actor.id,
      updated_at = v_now
  where employee_id = v_target.id
    and status in (
      'Draft', 'Pending Approval', 'Revision Requested', 'Active',
      'Completion Review', 'Cancellation Requested'
    );

  insert into public.growth_events (
    subject_type, subject_id, event_type, actor_id, actor_email,
    target_user_id, summary, metadata
  ) values (
    'reporting_assignment', v_target.id, 'general_manager_transferred',
    v_actor.id, lower(btrim(v_actor.email)), v_target.id,
    'General Manager authority transferred through Users & Access.',
    jsonb_build_object(
      'formerGeneralManagerUserId', v_current.id,
      'generalManagerUserId', v_target.id,
      'formerGeneralManagerNeedsManager', true,
      'reportingAssignmentCleared', true
    )
  );

  return jsonb_build_object(
    'transferred', true,
    'formerGeneralManagerUserId', v_current.id,
    'formerGeneralManagerName', v_current.full_name,
    'formerGeneralManagerEmail', v_current.email,
    'generalManagerUserId', v_target.id,
    'generalManagerName', v_target.full_name,
    'generalManagerEmail', v_target.email,
    'formerGeneralManagerNeedsManager', true
  );
end;
$$;

create or replace function public.growth_active_general_manager_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(role_row.user_id order by role_row.user_id)
  into v_ids
  from public.collaboration_roles role_row
  join public.user_profiles profile on profile.id = role_row.user_id
  where role_row.role = 'general_manager'
    and role_row.active
    and profile.active
    and profile.user_type = 'general_manager';

  if coalesce(cardinality(v_ids), 0) <> 1 then
    raise exception 'General Manager role validation failed. Exactly one active UUID-backed General Manager user type is required.';
  end if;

  return v_ids[1];
end;
$$;

create or replace function public.collaboration_is_general_manager(
  p_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.collaboration_roles role_row
    join public.user_profiles profile on profile.id = role_row.user_id
    where role_row.user_id = p_user_id
      and role_row.role = 'general_manager'
      and role_row.active
      and profile.active
      and profile.user_type = 'general_manager'
  );
$$;

create or replace function public.fcos_update_is_general_manager(
  p_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.collaboration_is_general_manager(p_user_id);
$$;

create or replace function public.save_fcos_update_batch(
  p_batch_id uuid,
  p_expected_revision integer,
  p_subject text,
  p_introduction text,
  p_closing text,
  p_items jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns public.fcos_update_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.fcos_update_batches%rowtype;
  v_batch_id uuid := coalesce(p_batch_id, gen_random_uuid());
  v_item jsonb;
  v_item_row public.fcos_update_items%rowtype;
  v_item_ids uuid[] := array[]::uuid[];
  v_sort_orders integer[] := array[]::integer[];
  v_item_id uuid;
  v_sort_order integer;
  v_category text;
  v_title text;
  v_body text;
  v_expected_item_revision integer;
begin
  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.active
      and profile.user_type in ('administrator', 'general_manager')
  ) then
    raise exception 'Administrator or General Manager access required.'
      using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_subject, ''))) not between 1 and 200 then
    raise exception 'Enter an email subject between 1 and 200 characters.'
      using errcode = '23514';
  end if;
  if char_length(coalesce(p_introduction, '')) > 2000 then
    raise exception 'Email introduction must not exceed 2,000 characters.'
      using errcode = '23514';
  end if;
  if char_length(coalesce(p_closing, '')) > 1000 then
    raise exception 'Email closing must not exceed 1,000 characters.'
      using errcode = '23514';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one FCOS update.' using errcode = '23514';
  end if;

  if p_batch_id is null then
    insert into public.fcos_update_batches (
      id, status, subject, introduction, closing, revision,
      created_by, created_by_email, updated_by, updated_by_email
    ) values (
      v_batch_id, 'Draft', btrim(p_subject), coalesce(p_introduction, ''),
      coalesce(p_closing, ''), 1,
      p_actor_id, p_actor_email, p_actor_id, p_actor_email
    )
    returning * into v_batch;
  else
    select * into v_batch
    from public.fcos_update_batches
    where id = p_batch_id
    for update;
    if not found then
      raise exception 'FCOS update email batch was not found.' using errcode = 'P0002';
    end if;
    if v_batch.revision <> p_expected_revision then
      raise exception 'This FCOS update email was changed by another Administrator. Refresh and review the latest version.'
        using errcode = '40001';
    end if;
    if v_batch.status in ('Sending', 'Sent', 'Partial Failure', 'Cancelled') then
      raise exception 'This FCOS update email can no longer be edited.' using errcode = '23514';
    end if;

    update public.fcos_update_batches
    set status = 'Draft',
        subject = btrim(p_subject),
        introduction = coalesce(p_introduction, ''),
        closing = coalesce(p_closing, ''),
        revision = revision + 1,
        approved_revision = null,
        updated_by = p_actor_id,
        updated_by_email = p_actor_email,
        submitted_by = null,
        submitted_by_email = null,
        submitted_at = null,
        approved_by = null,
        approved_by_email = null,
        approved_at = null,
        returned_by = null,
        returned_by_email = null,
        returned_at = null,
        return_reason = null
    where id = v_batch_id
    returning * into v_batch;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item->>'itemId', '')::uuid;
    v_sort_order := coalesce((v_item->>'sortOrder')::integer, 0);
    v_category := nullif(btrim(v_item->>'category'), '');
    v_title := btrim(coalesce(v_item->>'emailTitle', ''));
    v_body := btrim(coalesce(v_item->>'emailBody', ''));
    v_expected_item_revision := coalesce((v_item->>'expectedRevision')::integer, 0);

    if v_item_id is null or v_item_id = any(v_item_ids) then
      raise exception 'Each selected FCOS update must be unique.' using errcode = '23514';
    end if;
    if v_sort_order = any(v_sort_orders) then
      raise exception 'Each selected FCOS update must have a unique order.' using errcode = '23514';
    end if;
    if v_category is null
       or v_category not in ('new_feature', 'improved_logic', 'major_bug_fix') then
      raise exception 'Classify every update as New Feature, Improved Logic, or Major Bug Fix.'
        using errcode = '23514';
    end if;
    if char_length(v_title) not between 1 and 200 then
      raise exception 'Every update title must contain between 1 and 200 characters.'
        using errcode = '23514';
    end if;
    if char_length(v_body) not between 1 and 4000 then
      raise exception 'Every update description must contain between 1 and 4,000 characters.'
        using errcode = '23514';
    end if;

    select * into v_item_row
    from public.fcos_update_items
    where id = v_item_id
    for update;
    if not found then
      raise exception 'A selected FCOS update no longer exists.' using errcode = 'P0002';
    end if;
    if v_item_row.revision <> v_expected_item_revision then
      raise exception 'A selected FCOS update was changed by another Administrator. Refresh and review it again.'
        using errcode = '40001';
    end if;
    if v_item_row.status <> 'Pending' then
      raise exception 'Skipped or sent FCOS updates cannot be added to an email.' using errcode = '23514';
    end if;
    if v_item_row.assigned_batch_id is not null
       and v_item_row.assigned_batch_id <> v_batch_id then
      raise exception 'A selected FCOS update is already assigned to another email batch.'
        using errcode = '23505';
    end if;

    update public.fcos_update_items
    set category = v_category,
        email_title = v_title,
        email_body = v_body,
        copy_edited = (
          v_title is distinct from source_title
          or v_body is distinct from source_text
        ),
        assigned_batch_id = v_batch_id,
        revision = revision + 1,
        edited_by = p_actor_id,
        edited_by_email = p_actor_email,
        edited_at = now()
    where id = v_item_id
    returning * into v_item_row;

    v_item_ids := array_append(v_item_ids, v_item_id);
    v_sort_orders := array_append(v_sort_orders, v_sort_order);
  end loop;

  update public.fcos_update_items
  set assigned_batch_id = null,
      revision = revision + 1,
      edited_by = p_actor_id,
      edited_by_email = p_actor_email,
      edited_at = now()
  where assigned_batch_id = v_batch_id
    and not (id = any(v_item_ids));

  delete from public.fcos_update_batch_items
  where batch_id = v_batch_id;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item->>'itemId')::uuid;
    select * into v_item_row
    from public.fcos_update_items
    where id = v_item_id;

    insert into public.fcos_update_batch_items (
      batch_id, item_id, sort_order, category, email_title, email_body,
      item_revision_snapshot
    ) values (
      v_batch_id,
      v_item_id,
      coalesce((v_item->>'sortOrder')::integer, 0),
      v_item_row.category,
      v_item_row.email_title,
      v_item_row.email_body,
      v_item_row.revision
    );
  end loop;

  insert into public.fcos_update_events (
    batch_id, event_type, actor_user_id, actor_email, summary, metadata
  ) values (
    v_batch_id,
    case when p_batch_id is null then 'batch_created' else 'batch_saved' end,
    p_actor_id,
    p_actor_email,
    case
      when p_batch_id is null then 'FCOS update email draft created.'
      else 'FCOS update email draft saved.'
    end,
    jsonb_build_object(
      'itemCount', jsonb_array_length(p_items),
      'revision', v_batch.revision
    )
  );

  select * into v_batch
  from public.fcos_update_batches
  where id = v_batch_id;
  return v_batch;
end;
$$;

create or replace function public.cancel_fcos_update_batch(
  p_batch_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_actor_id uuid,
  p_actor_email text
)
returns public.fcos_update_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.fcos_update_batches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.active
      and profile.user_type in ('administrator', 'general_manager')
  ) then
    raise exception 'Administrator or General Manager access required.'
      using errcode = '42501';
  end if;
  if char_length(v_reason) not between 8 and 255 then
    raise exception 'Cancellation reason must contain between 8 and 255 characters.'
      using errcode = '23514';
  end if;

  select * into v_batch
  from public.fcos_update_batches
  where id = p_batch_id
  for update;
  if not found then
    raise exception 'FCOS update email batch was not found.' using errcode = 'P0002';
  end if;
  if v_batch.revision <> p_expected_revision then
    raise exception 'This FCOS update email changed before it could be cancelled.'
      using errcode = '40001';
  end if;
  if v_batch.status <> 'Draft' then
    raise exception 'Only a Draft FCOS update email can be cancelled.' using errcode = '23514';
  end if;

  update public.fcos_update_batches
  set status = 'Cancelled',
      revision = revision + 1,
      approved_revision = null,
      cancelled_by = p_actor_id,
      cancelled_by_email = lower(btrim(p_actor_email)),
      cancelled_at = now(),
      cancellation_reason = v_reason,
      updated_by = p_actor_id,
      updated_by_email = lower(btrim(p_actor_email))
  where id = p_batch_id
  returning * into v_batch;

  update public.fcos_update_items
  set assigned_batch_id = null,
      revision = revision + 1,
      edited_by = p_actor_id,
      edited_by_email = lower(btrim(p_actor_email)),
      edited_at = now()
  where assigned_batch_id = p_batch_id
    and status = 'Pending';

  insert into public.fcos_update_events (
    batch_id, event_type, actor_user_id, actor_email, summary, metadata
  ) values (
    p_batch_id,
    'batch_cancelled',
    p_actor_id,
    lower(btrim(p_actor_email)),
    'FCOS update email draft cancelled.',
    jsonb_build_object('reason', v_reason)
  );
  return v_batch;
end;
$$;

revoke all on function public.assign_general_manager_user_type(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.assign_general_manager_user_type(uuid, uuid, text, boolean) to service_role;
