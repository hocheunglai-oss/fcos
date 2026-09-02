-- Save and approve FCOS Update recipients with the email draft.

create table if not exists public.fcos_update_batch_recipients (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fcos_update_batches(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  recipient_name text not null
    check (char_length(btrim(recipient_name)) between 1 and 255),
  recipient_email text not null
    check (
      char_length(recipient_email) between 3 and 320
      and recipient_email = lower(btrim(recipient_email))
      and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  sort_order integer not null default 0
    check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, user_id),
  unique (batch_id, recipient_email),
  unique (batch_id, sort_order)
);

create index if not exists fcos_update_batch_recipients_batch_idx
on public.fcos_update_batch_recipients(batch_id, sort_order);

drop trigger if exists fcos_update_batch_recipients_set_updated_at
on public.fcos_update_batch_recipients;
create trigger fcos_update_batch_recipients_set_updated_at
before update on public.fcos_update_batch_recipients
for each row execute function public.set_fcos_update_updated_at();

insert into public.fcos_update_batch_recipients (
  batch_id, user_id, recipient_name, recipient_email, sort_order
)
select
  batch.id,
  profile.id,
  coalesce(nullif(btrim(profile.full_name), ''), lower(btrim(profile.email))),
  lower(btrim(profile.email)),
  row_number() over (
    partition by batch.id
    order by coalesce(nullif(btrim(profile.full_name), ''), lower(btrim(profile.email))), profile.id
  ) - 1
from public.fcos_update_batches batch
cross join public.user_profiles profile
where batch.status in ('Draft', 'Revision Requested', 'Pending Approval', 'Approved')
  and profile.active = true
  and btrim(coalesce(profile.email, '')) <> ''
  and not exists (
    select 1
    from public.fcos_update_batch_recipients recipient
    where recipient.batch_id = batch.id
  )
on conflict (batch_id, user_id) do nothing;

create or replace function public.save_fcos_update_batch_with_recipients(
  p_batch_id uuid,
  p_expected_revision integer,
  p_subject text,
  p_introduction text,
  p_closing text,
  p_items jsonb,
  p_recipients jsonb,
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
  v_recipient jsonb;
  v_profile public.user_profiles%rowtype;
  v_user_id uuid;
  v_name text;
  v_email text;
  v_sort_order integer;
  v_user_ids uuid[] := '{}'::uuid[];
  v_emails text[] := '{}'::text[];
  v_sort_orders integer[] := '{}'::integer[];
begin
  if jsonb_typeof(p_recipients) <> 'array'
     or jsonb_array_length(p_recipients) = 0 then
    raise exception 'Select at least one active FCOS recipient.'
      using errcode = '23514';
  end if;

  for v_recipient in
    select value
    from jsonb_array_elements(p_recipients)
  loop
    v_user_id := nullif(v_recipient->>'userId', '')::uuid;
    v_name := btrim(coalesce(v_recipient->>'name', ''));
    v_email := lower(btrim(coalesce(v_recipient->>'email', '')));
    v_sort_order := coalesce((v_recipient->>'sortOrder')::integer, 0);

    if v_user_id is null or v_user_id = any(v_user_ids) then
      raise exception 'Each FCOS recipient must be a unique active user.'
        using errcode = '23514';
    end if;
    if v_name = '' or char_length(v_name) > 255 then
      raise exception 'Each recipient name must contain between 1 and 255 characters.'
        using errcode = '23514';
    end if;
    if char_length(v_email) not between 3 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Enter a valid email address for every recipient.'
        using errcode = '23514';
    end if;
    if v_email = any(v_emails) then
      raise exception 'Each recipient email address must be unique.'
        using errcode = '23514';
    end if;
    if v_sort_order < 0 or v_sort_order = any(v_sort_orders) then
      raise exception 'Each recipient must have a unique order.'
        using errcode = '23514';
    end if;

    select *
    into v_profile
    from public.user_profiles profile
    where profile.id = v_user_id
      and profile.active = true
    for share;
    if not found then
      raise exception 'Every recipient must be an active FCOS user.'
        using errcode = '40001';
    end if;

    v_user_ids := array_append(v_user_ids, v_user_id);
    v_emails := array_append(v_emails, v_email);
    v_sort_orders := array_append(v_sort_orders, v_sort_order);
  end loop;

  v_batch := public.save_fcos_update_batch(
    p_batch_id,
    p_expected_revision,
    p_subject,
    p_introduction,
    p_closing,
    p_items,
    p_actor_id,
    p_actor_email
  );

  delete from public.fcos_update_batch_recipients
  where batch_id = v_batch.id;

  for v_recipient in
    select value
    from jsonb_array_elements(p_recipients)
    order by (value->>'sortOrder')::integer
  loop
    insert into public.fcos_update_batch_recipients (
      batch_id, user_id, recipient_name, recipient_email, sort_order
    ) values (
      v_batch.id,
      (v_recipient->>'userId')::uuid,
      btrim(v_recipient->>'name'),
      lower(btrim(v_recipient->>'email')),
      (v_recipient->>'sortOrder')::integer
    );
  end loop;

  insert into public.fcos_update_events (
    batch_id, event_type, actor_user_id, actor_email, summary, metadata
  ) values (
    v_batch.id,
    'batch_recipients_saved',
    p_actor_id,
    lower(btrim(p_actor_email)),
    'FCOS update email recipient list saved.',
    jsonb_build_object(
      'recipientCount', jsonb_array_length(p_recipients),
      'revision', v_batch.revision
    )
  );

  return v_batch;
end;
$$;

create or replace function public.start_fcos_update_saved_delivery(
  p_batch_id uuid,
  p_expected_revision integer,
  p_expected_recipient_count integer,
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
  v_recipient public.fcos_update_batch_recipients%rowtype;
  v_profile public.user_profiles%rowtype;
  v_recipient_count integer;
begin
  if not public.fcos_update_is_general_manager(p_actor_id) then
    raise exception 'Only the active General Manager can send FCOS update emails.'
      using errcode = '42501';
  end if;

  select *
  into v_batch
  from public.fcos_update_batches
  where id = p_batch_id
  for update;
  if not found then
    raise exception 'FCOS update email batch was not found.'
      using errcode = 'P0002';
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

  select count(*)
  into v_recipient_count
  from public.fcos_update_batch_recipients recipient
  where recipient.batch_id = p_batch_id;
  if p_expected_recipient_count < 1
     or v_recipient_count <> p_expected_recipient_count then
    raise exception 'The saved recipient list changed. Review it before sending.'
      using errcode = '40001';
  end if;

  for v_recipient in
    select *
    from public.fcos_update_batch_recipients recipient
    where recipient.batch_id = p_batch_id
    order by recipient.sort_order, recipient.id
    for share
  loop
    select *
    into v_profile
    from public.user_profiles profile
    where profile.id = v_recipient.user_id
      and profile.active = true
    for share;
    if not found then
      raise exception 'A saved recipient is no longer active. Amend and save the recipient list before sending.'
        using errcode = '40001';
    end if;

    insert into public.fcos_update_deliveries (
      batch_id, user_id, recipient_name, recipient_email, status
    ) values (
      p_batch_id,
      v_recipient.user_id,
      v_recipient.recipient_name,
      v_recipient.recipient_email,
      'Pending'
    );
  end loop;

  update public.fcos_update_batches
  set status = 'Sending',
      recipient_count = v_recipient_count,
      send_started_by = p_actor_id,
      send_started_by_email = lower(btrim(p_actor_email)),
      send_started_at = now(),
      completed_at = null,
      updated_by = p_actor_id,
      updated_by_email = lower(btrim(p_actor_email))
  where id = p_batch_id
  returning * into v_batch;

  insert into public.fcos_update_events (
    batch_id, event_type, actor_user_id, actor_email, summary, metadata
  ) values (
    p_batch_id,
    'delivery_started',
    p_actor_id,
    lower(btrim(p_actor_email)),
    'FCOS update email delivery started.',
    jsonb_build_object(
      'recipientCount', v_recipient_count,
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

alter table public.fcos_update_batch_recipients enable row level security;

revoke all on table public.fcos_update_batch_recipients from public, anon, authenticated;
grant all on table public.fcos_update_batch_recipients to service_role;

revoke all on function public.save_fcos_update_batch_with_recipients(
  uuid, integer, text, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function public.start_fcos_update_saved_delivery(
  uuid, integer, integer, uuid, text
) from public, anon, authenticated;

grant execute on function public.save_fcos_update_batch_with_recipients(
  uuid, integer, text, text, text, jsonb, jsonb, uuid, text
) to service_role;
grant execute on function public.start_fcos_update_saved_delivery(
  uuid, integer, integer, uuid, text
) to service_role;
