-- Administrators prepare saved drafts; only the active General Manager sends them.

update public.fcos_update_batches
set status = 'Draft',
    revision = revision + 1,
    approved_revision = null,
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
where status in ('Pending Approval', 'Revision Requested', 'Approved');

alter table public.fcos_update_batches
drop constraint if exists fcos_update_batches_status_check;

alter table public.fcos_update_batches
add constraint fcos_update_batches_status_check
check (status in (
  'Draft',
  'Sending',
  'Sent',
  'Partial Failure',
  'Cancelled'
));

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
  if v_batch.status <> 'Draft'
     or v_batch.revision <> p_expected_revision then
    raise exception 'Only the current saved Draft can be sent.'
      using errcode = '40001';
  end if;
  if not exists (
    select 1
    from public.fcos_update_batch_items batch_item
    where batch_item.batch_id = p_batch_id
  ) then
    raise exception 'Select at least one FCOS update.'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.fcos_update_batch_items batch_item
    left join public.fcos_update_items item
      on item.id = batch_item.item_id
    where batch_item.batch_id = p_batch_id
      and (
        item.id is null
        or item.status <> 'Pending'
        or item.assigned_batch_id is distinct from p_batch_id
        or item.revision is distinct from batch_item.item_revision_snapshot
      )
  ) then
    raise exception 'A selected update changed after the draft was saved. Review and save the draft again before sending.'
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
    'FCOS update email delivery started from a saved draft.',
    jsonb_build_object(
      'recipientCount', v_recipient_count,
      'itemCount', (
        select count(*)
        from public.fcos_update_batch_items batch_item
        where batch_item.batch_id = p_batch_id
      ),
      'revision', v_batch.revision
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
      and profile.active = true
      and profile.user_type = 'administrator'
  ) then
    raise exception 'Administrator access required.'
      using errcode = '42501';
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
    raise exception 'FCOS update email batch was not found.'
      using errcode = 'P0002';
  end if;
  if v_batch.revision <> p_expected_revision then
    raise exception 'This FCOS update email changed before it could be cancelled.'
      using errcode = '40001';
  end if;
  if v_batch.status <> 'Draft' then
    raise exception 'Only a Draft FCOS update email can be cancelled.'
      using errcode = '23514';
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

revoke all on function public.start_fcos_update_delivery(
  uuid, integer, integer, jsonb, uuid, text
) from service_role;
revoke all on function public.start_fcos_update_saved_delivery(
  uuid, integer, integer, uuid, text
) from public, anon, authenticated;
revoke all on function public.cancel_fcos_update_batch(
  uuid, integer, text, uuid, text
) from public, anon, authenticated;

grant execute on function public.start_fcos_update_saved_delivery(
  uuid, integer, integer, uuid, text
) to service_role;
grant execute on function public.cancel_fcos_update_batch(
  uuid, integer, text, uuid, text
) to service_role;
