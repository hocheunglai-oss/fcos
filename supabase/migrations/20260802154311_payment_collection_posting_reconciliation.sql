alter table public.buyer_invoice_collection_items
  add column if not exists payment_reconciliation_snapshot jsonb null,
  add column if not exists posting_reminder_override_reason text null,
  add column if not exists posting_reminder_override_by uuid null references public.user_profiles(id) on delete set null,
  add column if not exists posting_reminder_override_by_email text null,
  add column if not exists posting_reminder_override_at timestamptz null,
  add column if not exists posting_reminder_override_issue_key text null;

alter table public.buyer_invoice_collection_items
  drop constraint if exists buyer_invoice_collection_items_reconciliation_state_check,
  drop constraint if exists buyer_invoice_collection_items_payment_reconciliation_snapshot_check,
  drop constraint if exists buyer_invoice_collection_items_posting_override_check;

update public.buyer_invoice_collection_items
set reconciliation_state = 'payment_posting_pending'
where reconciliation_state = 'payment_pending_posting';

alter table public.buyer_invoice_collection_items
  add constraint buyer_invoice_collection_items_reconciliation_state_check
    check (reconciliation_state in (
      'not_checked',
      'open',
      'partial_payment',
      'payment_posting_pending',
      'payment_partially_posted',
      'payment_posting_mismatch',
      'payment_posting_overdue',
      'advice_pending',
      'advice_overdue',
      'settled',
      'reopened',
      'balance_unavailable',
      'manual_closure_mismatch'
    )),
  add constraint buyer_invoice_collection_items_payment_reconciliation_snapshot_check
    check (payment_reconciliation_snapshot is null or jsonb_typeof(payment_reconciliation_snapshot) = 'object'),
  add constraint buyer_invoice_collection_items_posting_override_check
    check (
      (
        posting_reminder_override_issue_key is null
        and posting_reminder_override_reason is null
        and posting_reminder_override_by is null
        and posting_reminder_override_by_email is null
        and posting_reminder_override_at is null
      )
      or (
        posting_reminder_override_issue_key is not null
        and nullif(trim(posting_reminder_override_issue_key), '') is not null
        and posting_reminder_override_reason is not null
        and char_length(trim(posting_reminder_override_reason)) between 5 and 1000
        and posting_reminder_override_by is not null
        and posting_reminder_override_by_email is not null
        and nullif(trim(posting_reminder_override_by_email), '') is not null
        and posting_reminder_override_at is not null
      )
    );

create index if not exists buyer_invoice_collection_items_posting_override_actor_idx
on public.buyer_invoice_collection_items(posting_reminder_override_by)
where posting_reminder_override_by is not null;

alter table public.buyer_invoice_collection_events
  drop constraint if exists buyer_invoice_collection_events_event_type_check;

alter table public.buyer_invoice_collection_events
  add constraint buyer_invoice_collection_events_event_type_check
  check (event_type in (
    'update',
    'status_change',
    'note',
    'follow_up',
    'promise',
    'owner_change',
    'contact',
    'reminder_sent',
    'payment_advice',
    'payment_detected',
    'auto_closed',
    'auto_reopened',
    'reconciliation_warning',
    'reconciliation_resolved',
    'posting_reminder_override'
  ));

create or replace function public.save_buyer_invoice_collection(
  p_stem_id text,
  p_updates jsonb,
  p_event jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.buyer_invoice_collection_items%rowtype;
  v_item public.buyer_invoice_collection_items%rowtype;
  v_event public.buyer_invoice_collection_events%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if nullif(trim(p_stem_id), '') is null then
    raise exception 'stemId is required.';
  end if;

  select * into v_current
  from public.buyer_invoice_collection_items
  where stem_id = p_stem_id
  for update;

  if found then
    if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
      raise exception 'This collection record changed after it was opened. Refresh and review the latest update before saving.';
    end if;

    update public.buyer_invoice_collection_items set
      status = case when p_updates ? 'status' then p_updates->>'status' else status end,
      owner_user_id = case when p_updates ? 'owner_user_id' then nullif(p_updates->>'owner_user_id', '')::uuid else owner_user_id end,
      owner_name = case when p_updates ? 'owner_name' then coalesce(p_updates->>'owner_name', '') else owner_name end,
      latest_note = case when p_updates ? 'latest_note' then coalesce(p_updates->>'latest_note', '') else latest_note end,
      next_follow_up_date = case when p_updates ? 'next_follow_up_date' then nullif(p_updates->>'next_follow_up_date', '')::date else next_follow_up_date end,
      promised_payment_date = case when p_updates ? 'promised_payment_date' then nullif(p_updates->>'promised_payment_date', '')::date else promised_payment_date end,
      promised_amount = case when p_updates ? 'promised_amount' then nullif(p_updates->>'promised_amount', '')::numeric else promised_amount end,
      on_hold_reason = case when p_updates ? 'on_hold_reason' then nullif(trim(p_updates->>'on_hold_reason'), '') else on_hold_reason end,
      on_hold_review_date = case when p_updates ? 'on_hold_review_date' then nullif(p_updates->>'on_hold_review_date', '')::date else on_hold_review_date end,
      advice_received_date = case when p_updates ? 'advice_received_date' then nullif(p_updates->>'advice_received_date', '')::date else advice_received_date end,
      advice_amount = case when p_updates ? 'advice_amount' then nullif(p_updates->>'advice_amount', '')::numeric else advice_amount end,
      advice_reference = case when p_updates ? 'advice_reference' then nullif(trim(p_updates->>'advice_reference'), '') else advice_reference end,
      advice_verification_date = case when p_updates ? 'advice_verification_date' then nullif(p_updates->>'advice_verification_date', '')::date else advice_verification_date end,
      advice_document_ids = case when p_updates ? 'advice_document_ids' then coalesce(p_updates->'advice_document_ids', '[]'::jsonb) else advice_document_ids end,
      reconciliation_state = case when p_updates ? 'reconciliation_state' then p_updates->>'reconciliation_state' else reconciliation_state end,
      verified_receivable_balance = case when p_updates ? 'verified_receivable_balance' then nullif(p_updates->>'verified_receivable_balance', '')::numeric else verified_receivable_balance end,
      latest_payment_snapshot = case when p_updates ? 'latest_payment_snapshot' then p_updates->'latest_payment_snapshot' else latest_payment_snapshot end,
      payment_reconciliation_snapshot = case when p_updates ? 'payment_reconciliation_snapshot' then p_updates->'payment_reconciliation_snapshot' else payment_reconciliation_snapshot end,
      posting_reminder_override_reason = case when p_updates ? 'posting_reminder_override_reason' then nullif(trim(p_updates->>'posting_reminder_override_reason'), '') else posting_reminder_override_reason end,
      posting_reminder_override_by = case when p_updates ? 'posting_reminder_override_by' then nullif(p_updates->>'posting_reminder_override_by', '')::uuid else posting_reminder_override_by end,
      posting_reminder_override_by_email = case when p_updates ? 'posting_reminder_override_by_email' then nullif(trim(p_updates->>'posting_reminder_override_by_email'), '') else posting_reminder_override_by_email end,
      posting_reminder_override_at = case when p_updates ? 'posting_reminder_override_at' then nullif(p_updates->>'posting_reminder_override_at', '')::timestamptz else posting_reminder_override_at end,
      posting_reminder_override_issue_key = case when p_updates ? 'posting_reminder_override_issue_key' then nullif(p_updates->>'posting_reminder_override_issue_key', '') else posting_reminder_override_issue_key end,
      previous_active_status = case when p_updates ? 'previous_active_status' then nullif(p_updates->>'previous_active_status', '') else previous_active_status end,
      closure_source = case when p_updates ? 'closure_source' then nullif(p_updates->>'closure_source', '') else closure_source end,
      last_reconciled_at = case when p_updates ? 'last_reconciled_at' then nullif(p_updates->>'last_reconciled_at', '')::timestamptz else last_reconciled_at end,
      last_event_at = v_now,
      last_updated_by = p_actor_user_id,
      last_updated_by_email = p_actor_email,
      updated_at = v_now
    where stem_id = p_stem_id
    returning * into v_item;
  else
    insert into public.buyer_invoice_collection_items (
      stem_id, status, owner_user_id, owner_name, latest_note,
      next_follow_up_date, promised_payment_date, promised_amount,
      on_hold_reason, on_hold_review_date,
      advice_received_date, advice_amount, advice_reference,
      advice_verification_date, advice_document_ids, closure_source,
      reconciliation_state, verified_receivable_balance, latest_payment_snapshot,
      payment_reconciliation_snapshot,
      posting_reminder_override_reason, posting_reminder_override_by,
      posting_reminder_override_by_email, posting_reminder_override_at,
      posting_reminder_override_issue_key,
      previous_active_status, last_reconciled_at,
      last_event_at, last_updated_by, last_updated_by_email, updated_at
    ) values (
      p_stem_id,
      coalesce(nullif(p_updates->>'status', ''), 'To Contact'),
      nullif(p_updates->>'owner_user_id', '')::uuid,
      coalesce(p_updates->>'owner_name', ''),
      coalesce(p_updates->>'latest_note', ''),
      nullif(p_updates->>'next_follow_up_date', '')::date,
      nullif(p_updates->>'promised_payment_date', '')::date,
      nullif(p_updates->>'promised_amount', '')::numeric,
      nullif(trim(p_updates->>'on_hold_reason'), ''),
      nullif(p_updates->>'on_hold_review_date', '')::date,
      nullif(p_updates->>'advice_received_date', '')::date,
      nullif(p_updates->>'advice_amount', '')::numeric,
      nullif(trim(p_updates->>'advice_reference'), ''),
      nullif(p_updates->>'advice_verification_date', '')::date,
      coalesce(p_updates->'advice_document_ids', '[]'::jsonb),
      nullif(p_updates->>'closure_source', ''),
      coalesce(nullif(p_updates->>'reconciliation_state', ''), 'not_checked'),
      nullif(p_updates->>'verified_receivable_balance', '')::numeric,
      p_updates->'latest_payment_snapshot',
      p_updates->'payment_reconciliation_snapshot',
      nullif(trim(p_updates->>'posting_reminder_override_reason'), ''),
      nullif(p_updates->>'posting_reminder_override_by', '')::uuid,
      nullif(trim(p_updates->>'posting_reminder_override_by_email'), ''),
      nullif(p_updates->>'posting_reminder_override_at', '')::timestamptz,
      nullif(p_updates->>'posting_reminder_override_issue_key', ''),
      nullif(p_updates->>'previous_active_status', ''),
      nullif(p_updates->>'last_reconciled_at', '')::timestamptz,
      v_now, p_actor_user_id, p_actor_email, v_now
    ) returning * into v_item;
  end if;

  insert into public.buyer_invoice_collection_events (
    stem_id, event_type, event_key, status, owner_name, note,
    next_follow_up_date, promised_payment_date, promised_amount,
    metadata, actor_user_id, actor_email
  ) values (
    p_stem_id,
    coalesce(nullif(p_event->>'event_type', ''), 'update'),
    nullif(p_event->>'event_key', ''),
    nullif(p_event->>'status', ''),
    nullif(p_event->>'owner_name', ''),
    nullif(p_event->>'note', ''),
    nullif(p_event->>'next_follow_up_date', '')::date,
    nullif(p_event->>'promised_payment_date', '')::date,
    nullif(p_event->>'promised_amount', '')::numeric,
    coalesce(p_event->'metadata', '{}'::jsonb),
    p_actor_user_id,
    p_actor_email
  ) returning * into v_event;

  return jsonb_build_object('item', to_jsonb(v_item), 'event', to_jsonb(v_event));
end;
$$;

alter table public.buyer_invoice_collection_items enable row level security;
alter table public.buyer_invoice_collection_events enable row level security;
revoke all on table public.buyer_invoice_collection_items from public, anon, authenticated;
revoke all on table public.buyer_invoice_collection_events from public, anon, authenticated;
grant all on table public.buyer_invoice_collection_items to service_role;
grant all on table public.buyer_invoice_collection_events to service_role;
revoke all on function public.save_buyer_invoice_collection(text, jsonb, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_buyer_invoice_collection(text, jsonb, jsonb, uuid, text, timestamptz) to service_role;
