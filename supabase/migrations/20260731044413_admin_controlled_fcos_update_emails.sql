create extension if not exists pgcrypto;

create table if not exists public.fcos_update_settings (
  id text primary key default 'default',
  initial_backfill_start date not null
    default date '2026-07-27',
  last_synced_at timestamptz null,
  last_synced_version text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.fcos_update_settings (id, initial_backfill_start)
values ('default', date '2026-07-27')
on conflict (id) do nothing;

create table if not exists public.fcos_update_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Draft'
    check (status in (
      'Draft',
      'Pending Approval',
      'Revision Requested',
      'Approved',
      'Sending',
      'Sent',
      'Partial Failure',
      'Cancelled'
    )),
  subject text not null default ''
    check (char_length(subject) <= 200),
  introduction text not null default ''
    check (char_length(introduction) <= 2000),
  closing text not null default ''
    check (char_length(closing) <= 1000),
  revision integer not null default 1
    check (revision > 0),
  approved_revision integer null,
  recipient_count integer not null default 0
    check (recipient_count >= 0),
  sent_count integer not null default 0
    check (sent_count >= 0),
  failed_count integer not null default 0
    check (failed_count >= 0),
  uncertain_count integer not null default 0
    check (uncertain_count >= 0),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_by_email text not null,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by_email text not null,
  submitted_by uuid null references public.user_profiles(id) on delete set null,
  submitted_by_email text null,
  submitted_at timestamptz null,
  approved_by uuid null references public.user_profiles(id) on delete set null,
  approved_by_email text null,
  approved_at timestamptz null,
  returned_by uuid null references public.user_profiles(id) on delete set null,
  returned_by_email text null,
  returned_at timestamptz null,
  return_reason text null
    check (return_reason is null or char_length(return_reason) between 8 and 255),
  cancelled_by uuid null references public.user_profiles(id) on delete set null,
  cancelled_by_email text null,
  cancelled_at timestamptz null,
  cancellation_reason text null
    check (cancellation_reason is null or char_length(cancellation_reason) between 8 and 255),
  send_started_by uuid null references public.user_profiles(id) on delete set null,
  send_started_by_email text null,
  send_started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fcos_update_items (
  id uuid primary key default gen_random_uuid(),
  source_version text not null,
  source_release_date date not null,
  source_change_index integer not null
    check (source_change_index >= 0),
  source_title text not null
    check (char_length(source_title) between 1 and 200),
  source_text text not null
    check (char_length(source_text) between 1 and 4000),
  source_hash text not null,
  source_changed boolean not null default false,
  category text null
    check (category in ('new_feature', 'improved_logic', 'major_bug_fix')),
  email_title text not null
    check (char_length(email_title) between 1 and 200),
  email_body text not null
    check (char_length(email_body) between 1 and 4000),
  copy_edited boolean not null default false,
  status text not null default 'Pending'
    check (status in ('Pending', 'Skipped', 'Sent')),
  assigned_batch_id uuid null references public.fcos_update_batches(id) on delete set null,
  revision integer not null default 1
    check (revision > 0),
  edited_by uuid null references public.user_profiles(id) on delete set null,
  edited_by_email text null,
  edited_at timestamptz null,
  skipped_by uuid null references public.user_profiles(id) on delete set null,
  skipped_by_email text null,
  skipped_at timestamptz null,
  skip_reason text null
    check (skip_reason is null or char_length(skip_reason) between 8 and 255),
  restored_by uuid null references public.user_profiles(id) on delete set null,
  restored_by_email text null,
  restored_at timestamptz null,
  restore_reason text null
    check (restore_reason is null or char_length(restore_reason) between 8 and 255),
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_version, source_change_index)
);

create table if not exists public.fcos_update_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fcos_update_batches(id) on delete cascade,
  item_id uuid not null references public.fcos_update_items(id) on delete restrict,
  sort_order integer not null default 0,
  category text not null
    check (category in ('new_feature', 'improved_logic', 'major_bug_fix')),
  email_title text not null
    check (char_length(email_title) between 1 and 200),
  email_body text not null
    check (char_length(email_body) between 1 and 4000),
  item_revision_snapshot integer not null
    check (item_revision_snapshot > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, item_id),
  unique (batch_id, sort_order)
);

create table if not exists public.fcos_update_deliveries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fcos_update_batches(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  recipient_name text not null default '',
  recipient_email text not null,
  status text not null default 'Pending'
    check (status in ('Pending', 'Sending', 'Sent', 'Failed', 'Uncertain')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  email_message_id text null,
  provider_result jsonb not null default '{}'::jsonb,
  last_error text null,
  sending_started_at timestamptz null,
  sent_at timestamptz null,
  last_attempt_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, user_id)
);

create table if not exists public.fcos_update_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid null references public.fcos_update_items(id) on delete set null,
  batch_id uuid null references public.fcos_update_batches(id) on delete set null,
  delivery_id uuid null references public.fcos_update_deliveries(id) on delete set null,
  event_type text not null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (item_id is not null or batch_id is not null or delivery_id is not null)
);

create index if not exists fcos_update_items_status_idx
on public.fcos_update_items(status, source_release_date desc);

create index if not exists fcos_update_items_batch_idx
on public.fcos_update_items(assigned_batch_id);

create index if not exists fcos_update_batches_status_idx
on public.fcos_update_batches(status, updated_at desc);

create index if not exists fcos_update_batch_items_order_idx
on public.fcos_update_batch_items(batch_id, sort_order);

create index if not exists fcos_update_deliveries_status_idx
on public.fcos_update_deliveries(batch_id, status, updated_at);

create index if not exists fcos_update_events_created_idx
on public.fcos_update_events(created_at desc);

create index if not exists fcos_update_events_batch_idx
on public.fcos_update_events(batch_id, created_at desc);

create unique index if not exists collaboration_roles_one_active_general_manager_idx
on public.collaboration_roles(role)
where active = true and role = 'general_manager';

create or replace function public.set_fcos_update_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fcos_update_settings_set_updated_at
on public.fcos_update_settings;
create trigger fcos_update_settings_set_updated_at
before update on public.fcos_update_settings
for each row execute function public.set_fcos_update_updated_at();

drop trigger if exists fcos_update_batches_set_updated_at
on public.fcos_update_batches;
create trigger fcos_update_batches_set_updated_at
before update on public.fcos_update_batches
for each row execute function public.set_fcos_update_updated_at();

drop trigger if exists fcos_update_items_set_updated_at
on public.fcos_update_items;
create trigger fcos_update_items_set_updated_at
before update on public.fcos_update_items
for each row execute function public.set_fcos_update_updated_at();

drop trigger if exists fcos_update_batch_items_set_updated_at
on public.fcos_update_batch_items;
create trigger fcos_update_batch_items_set_updated_at
before update on public.fcos_update_batch_items
for each row execute function public.set_fcos_update_updated_at();

drop trigger if exists fcos_update_deliveries_set_updated_at
on public.fcos_update_deliveries;
create trigger fcos_update_deliveries_set_updated_at
before update on public.fcos_update_deliveries
for each row execute function public.set_fcos_update_updated_at();

create or replace function public.fcos_update_is_general_manager(
  p_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.collaboration_roles role_row
    join public.user_profiles profile
      on profile.id = role_row.user_id
    where role_row.user_id = p_user_id
      and role_row.role = 'general_manager'
      and role_row.active = true
      and profile.active = true
  );
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
set search_path = public, pg_temp
as $$
declare
  v_batch public.fcos_update_batches;
  v_batch_id uuid := coalesce(p_batch_id, gen_random_uuid());
  v_item jsonb;
  v_item_row public.fcos_update_items;
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
      and profile.active = true
      and profile.user_type = 'administrator'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_subject, ''))) not between 1 and 200 then
    raise exception 'Enter an email subject between 1 and 200 characters.' using errcode = '23514';
  end if;
  if char_length(coalesce(p_introduction, '')) > 2000 then
    raise exception 'Email introduction must not exceed 2,000 characters.' using errcode = '23514';
  end if;
  if char_length(coalesce(p_closing, '')) > 1000 then
    raise exception 'Email closing must not exceed 1,000 characters.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one FCOS update.' using errcode = '23514';
  end if;

  if p_batch_id is null then
    insert into public.fcos_update_batches (
      id, status, subject, introduction, closing, revision,
      created_by, created_by_email, updated_by, updated_by_email
    )
    values (
      v_batch_id, 'Draft', trim(p_subject), coalesce(p_introduction, ''),
      coalesce(p_closing, ''), 1,
      p_actor_id, p_actor_email, p_actor_id, p_actor_email
    )
    returning * into v_batch;
  else
    select *
    into v_batch
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
        subject = trim(p_subject),
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
    select value
    from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item->>'itemId', '')::uuid;
    v_sort_order := coalesce((v_item->>'sortOrder')::integer, 0);
    v_category := nullif(trim(v_item->>'category'), '');
    v_title := trim(coalesce(v_item->>'emailTitle', ''));
    v_body := trim(coalesce(v_item->>'emailBody', ''));
    v_expected_item_revision := coalesce((v_item->>'expectedRevision')::integer, 0);

    if v_item_id is null or v_item_id = any(v_item_ids) then
      raise exception 'Each selected FCOS update must be unique.' using errcode = '23514';
    end if;
    if v_sort_order = any(v_sort_orders) then
      raise exception 'Each selected FCOS update must have a unique order.' using errcode = '23514';
    end if;
    if v_category is null
       or v_category not in ('new_feature', 'improved_logic', 'major_bug_fix') then
      raise exception 'Classify every update as New Feature, Improved Logic, or Major Bug Fix.' using errcode = '23514';
    end if;
    if char_length(v_title) not between 1 and 200 then
      raise exception 'Every update title must contain between 1 and 200 characters.' using errcode = '23514';
    end if;
    if char_length(v_body) not between 1 and 4000 then
      raise exception 'Every update description must contain between 1 and 4,000 characters.' using errcode = '23514';
    end if;

    select *
    into v_item_row
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
      raise exception 'A selected FCOS update is already assigned to another email batch.' using errcode = '23505';
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
    select value
    from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item->>'itemId')::uuid;
    select *
    into v_item_row
    from public.fcos_update_items
    where id = v_item_id;

    insert into public.fcos_update_batch_items (
      batch_id, item_id, sort_order, category, email_title, email_body,
      item_revision_snapshot
    )
    values (
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
  )
  values (
    v_batch_id,
    case when p_batch_id is null then 'batch_created' else 'batch_saved' end,
    p_actor_id,
    p_actor_email,
    case when p_batch_id is null then 'FCOS update email draft created.' else 'FCOS update email draft saved.' end,
    jsonb_build_object('itemCount', jsonb_array_length(p_items), 'revision', v_batch.revision)
  );

  select *
  into v_batch
  from public.fcos_update_batches
  where id = v_batch_id;

  return v_batch;
end;
$$;

create or replace function public.claim_fcos_update_deliveries(
  p_batch_id uuid,
  p_statuses text[],
  p_limit integer default 25
)
returns setof public.fcos_update_deliveries
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  with claimed as (
    select delivery.id
    from public.fcos_update_deliveries delivery
    where delivery.batch_id = p_batch_id
      and delivery.status = any(p_statuses)
    order by delivery.created_at, delivery.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.fcos_update_deliveries delivery
  set status = 'Sending',
      attempt_count = delivery.attempt_count + 1,
      sending_started_at = now(),
      last_attempt_at = now(),
      last_error = null
  from claimed
  where delivery.id = claimed.id
  returning delivery.*;
end;
$$;

create or replace function public.start_fcos_update_delivery(
  p_batch_id uuid,
  p_expected_revision integer,
  p_expected_recipient_count integer,
  p_recipients jsonb,
  p_actor_id uuid,
  p_actor_email text
)
returns public.fcos_update_batches
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.fcos_update_batches;
  v_recipient jsonb;
  v_recipient_id uuid;
  v_recipient_email text;
  v_recipient_name text;
  v_profile public.user_profiles;
  v_recipient_ids uuid[] := array[]::uuid[];
begin
  if not public.fcos_update_is_general_manager(p_actor_id) then
    raise exception 'Only the active General Manager can send FCOS update emails.'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_recipients) <> 'array'
     or jsonb_array_length(p_recipients) = 0
     or jsonb_array_length(p_recipients) <> p_expected_recipient_count then
    raise exception 'Refresh the active-recipient count before sending.'
      using errcode = '40001';
  end if;
  if (
    select count(*)
    from public.user_profiles profile
    where profile.active = true
  ) <> p_expected_recipient_count then
    raise exception 'The active-recipient count changed. Review the updated count before sending.'
      using errcode = '40001';
  end if;

  select *
  into v_batch
  from public.fcos_update_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'FCOS update email batch was not found.' using errcode = 'P0002';
  end if;
  if v_batch.status <> 'Approved'
     or v_batch.revision <> p_expected_revision
     or v_batch.approved_revision is distinct from v_batch.revision then
    raise exception 'Only the current approved revision can be sent.'
      using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.fcos_update_deliveries delivery
    where delivery.batch_id = p_batch_id
  ) then
    raise exception 'Recipient delivery rows already exist for this email.'
      using errcode = '40001';
  end if;

  for v_recipient in
    select value
    from jsonb_array_elements(p_recipients)
  loop
    v_recipient_id := nullif(v_recipient->>'userId', '')::uuid;
    v_recipient_email := lower(trim(coalesce(v_recipient->>'email', '')));
    v_recipient_name := trim(coalesce(v_recipient->>'name', v_recipient_email));

    if v_recipient_id is null
       or v_recipient_id = any(v_recipient_ids)
       or v_recipient_email = '' then
      raise exception 'The active-recipient snapshot is invalid.'
        using errcode = '23514';
    end if;

    select *
    into v_profile
    from public.user_profiles profile
    where profile.id = v_recipient_id
      and profile.active = true
    for share;

    if not found or lower(trim(coalesce(v_profile.email, ''))) <> v_recipient_email then
      raise exception 'The active-recipient snapshot changed. Review it before sending.'
        using errcode = '40001';
    end if;

    insert into public.fcos_update_deliveries (
      batch_id, user_id, recipient_name, recipient_email, status
    )
    values (
      p_batch_id,
      v_recipient_id,
      coalesce(nullif(v_recipient_name, ''), v_recipient_email),
      v_recipient_email,
      'Pending'
    );
    v_recipient_ids := array_append(v_recipient_ids, v_recipient_id);
  end loop;

  update public.fcos_update_batches
  set status = 'Sending',
      recipient_count = p_expected_recipient_count,
      send_started_by = p_actor_id,
      send_started_by_email = p_actor_email,
      send_started_at = now(),
      completed_at = null,
      updated_by = p_actor_id,
      updated_by_email = p_actor_email
  where id = p_batch_id
  returning * into v_batch;

  insert into public.fcos_update_events (
    batch_id, event_type, actor_user_id, actor_email, summary, metadata
  )
  values (
    p_batch_id,
    'delivery_started',
    p_actor_id,
    p_actor_email,
    'FCOS update email delivery started.',
    jsonb_build_object(
      'recipientCount', p_expected_recipient_count,
      'itemCount', (
        select count(*)
        from public.fcos_update_batch_items batch_item
        where batch_item.batch_id = p_batch_id
      )
    )
  );

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
set search_path = public, pg_temp
as $$
declare
  v_batch public.fcos_update_batches;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.active = true
      and profile.user_type = 'administrator'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 8 and 255 then
    raise exception 'Cancellation reason must contain between 8 and 255 characters.'
      using errcode = '23514';
  end if;

  select *
  into v_batch
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
  if v_batch.status not in ('Draft', 'Revision Requested', 'Pending Approval', 'Approved') then
    raise exception 'This FCOS update email can no longer be cancelled.'
      using errcode = '23514';
  end if;
  if v_batch.status in ('Pending Approval', 'Approved')
     and not public.fcos_update_is_general_manager(p_actor_id) then
    raise exception 'Only the active General Manager can cancel a submitted email.'
      using errcode = '42501';
  end if;

  update public.fcos_update_batches
  set status = 'Cancelled',
      revision = revision + 1,
      approved_revision = null,
      cancelled_by = p_actor_id,
      cancelled_by_email = p_actor_email,
      cancelled_at = now(),
      cancellation_reason = v_reason,
      updated_by = p_actor_id,
      updated_by_email = p_actor_email
  where id = p_batch_id
  returning * into v_batch;

  update public.fcos_update_items
  set assigned_batch_id = null,
      revision = revision + 1,
      edited_by = p_actor_id,
      edited_by_email = p_actor_email,
      edited_at = now()
  where assigned_batch_id = p_batch_id
    and status = 'Pending';

  insert into public.fcos_update_events (
    batch_id, event_type, actor_user_id, actor_email, summary, metadata
  )
  values (
    p_batch_id,
    'batch_cancelled',
    p_actor_id,
    p_actor_email,
    'FCOS update email cancelled.',
    jsonb_build_object('reason', v_reason)
  );

  return v_batch;
end;
$$;

create or replace function public.finalize_fcos_update_delivery(
  p_batch_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.fcos_update_batches;
  v_total integer;
  v_sent integer;
  v_failed integer;
  v_uncertain integer;
  v_pending integer;
  v_status text;
  v_completed_at timestamptz;
  v_summary text;
begin
  select *
  into v_batch
  from public.fcos_update_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'FCOS update email batch was not found.' using errcode = 'P0002';
  end if;

  select
    count(*),
    count(*) filter (where status = 'Sent'),
    count(*) filter (where status = 'Failed'),
    count(*) filter (where status = 'Uncertain'),
    count(*) filter (where status in ('Pending', 'Sending'))
  into v_total, v_sent, v_failed, v_uncertain, v_pending
  from public.fcos_update_deliveries delivery
  where delivery.batch_id = p_batch_id;

  v_status := case
    when v_pending > 0 then 'Sending'
    when v_total > 0 and v_sent = v_total then 'Sent'
    else 'Partial Failure'
  end;
  v_completed_at := case when v_status = 'Sending' then null else now() end;

  update public.fcos_update_batches
  set status = v_status,
      recipient_count = v_total,
      sent_count = v_sent,
      failed_count = v_failed,
      uncertain_count = v_uncertain,
      completed_at = v_completed_at,
      updated_by = p_actor_id,
      updated_by_email = p_actor_email
  where id = p_batch_id;

  if v_status = 'Sent' then
    update public.fcos_update_items
    set status = 'Sent',
        sent_at = v_completed_at
    where assigned_batch_id = p_batch_id
      and status = 'Pending';
    v_summary := 'FCOS update email delivered to all active users.';
  elsif v_status = 'Partial Failure' then
    v_summary := 'FCOS update email delivery completed with unresolved recipients.';
  else
    v_summary := 'FCOS update email delivery remains in progress.';
  end if;

  if v_status <> 'Sending' then
    insert into public.fcos_update_events (
      batch_id, event_type, actor_user_id, actor_email, summary, metadata
    )
    values (
      p_batch_id,
      case when v_status = 'Sent' then 'delivery_completed' else 'delivery_partial_failure' end,
      p_actor_id,
      p_actor_email,
      v_summary,
      jsonb_build_object(
        'total', v_total,
        'sent', v_sent,
        'failed', v_failed,
        'uncertain', v_uncertain,
        'pending', v_pending,
        'status', v_status
      )
    );
  end if;

  return jsonb_build_object(
    'total', v_total,
    'sent', v_sent,
    'failed', v_failed,
    'uncertain', v_uncertain,
    'pending', v_pending,
    'status', v_status
  );
end;
$$;

alter table public.fcos_update_settings enable row level security;
alter table public.fcos_update_items enable row level security;
alter table public.fcos_update_batches enable row level security;
alter table public.fcos_update_batch_items enable row level security;
alter table public.fcos_update_deliveries enable row level security;
alter table public.fcos_update_events enable row level security;

revoke all on table public.fcos_update_settings from public, anon, authenticated;
revoke all on table public.fcos_update_items from public, anon, authenticated;
revoke all on table public.fcos_update_batches from public, anon, authenticated;
revoke all on table public.fcos_update_batch_items from public, anon, authenticated;
revoke all on table public.fcos_update_deliveries from public, anon, authenticated;
revoke all on table public.fcos_update_events from public, anon, authenticated;

grant all on table public.fcos_update_settings to service_role;
grant all on table public.fcos_update_items to service_role;
grant all on table public.fcos_update_batches to service_role;
grant all on table public.fcos_update_batch_items to service_role;
grant all on table public.fcos_update_deliveries to service_role;
revoke all on table public.fcos_update_events from service_role;
grant select, insert on table public.fcos_update_events to service_role;

revoke all on function public.set_fcos_update_updated_at() from public, anon, authenticated;
revoke all on function public.fcos_update_is_general_manager(uuid) from public, anon, authenticated;
revoke all on function public.save_fcos_update_batch(uuid, integer, text, text, text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_fcos_update_deliveries(uuid, text[], integer) from public, anon, authenticated;
revoke all on function public.start_fcos_update_delivery(uuid, integer, integer, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_fcos_update_batch(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_fcos_update_delivery(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.set_fcos_update_updated_at() to service_role;
grant execute on function public.fcos_update_is_general_manager(uuid) to service_role;
grant execute on function public.save_fcos_update_batch(uuid, integer, text, text, text, jsonb, uuid, text) to service_role;
grant execute on function public.claim_fcos_update_deliveries(uuid, text[], integer) to service_role;
grant execute on function public.start_fcos_update_delivery(uuid, integer, integer, jsonb, uuid, text) to service_role;
grant execute on function public.cancel_fcos_update_batch(uuid, integer, text, uuid, text) to service_role;
grant execute on function public.finalize_fcos_update_delivery(uuid, uuid, text) to service_role;
