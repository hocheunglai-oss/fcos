create table if not exists public.user_navigation_preferences (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  section_orders jsonb not null default '{}'::jsonb
    check (jsonb_typeof(section_orders) = 'object'),
  hidden_item_ids text[] not null default '{}'::text[],
  revision integer not null default 1 check (revision > 0),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_navigation_preferences_updated_by_idx
on public.user_navigation_preferences(updated_by);

alter table public.user_navigation_preferences enable row level security;
revoke all on table public.user_navigation_preferences from anon, authenticated;
grant all on table public.user_navigation_preferences to service_role;

create or replace function public.save_user_navigation_preferences(
  p_user_id uuid,
  p_section_orders jsonb,
  p_hidden_item_ids text[],
  p_expected_revision integer,
  p_actor_user_id uuid
)
returns public.user_navigation_preferences
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.user_navigation_preferences%rowtype;
  v_result public.user_navigation_preferences%rowtype;
begin
  if p_user_id is null or p_actor_user_id is null or p_user_id <> p_actor_user_id then
    raise exception 'Navigation preferences may only be changed by their owner.';
  end if;
  if jsonb_typeof(coalesce(p_section_orders, '{}'::jsonb)) <> 'object' then
    raise exception 'Navigation section order must be an object.';
  end if;

  select * into v_current
  from public.user_navigation_preferences
  where user_id = p_user_id
  for update;

  if found then
    if p_expected_revision is null or p_expected_revision <> v_current.revision then
      raise exception 'Navigation preferences changed after they were opened. Refresh and try again.';
    end if;
    update public.user_navigation_preferences set
      section_orders = coalesce(p_section_orders, '{}'::jsonb),
      hidden_item_ids = coalesce(p_hidden_item_ids, '{}'::text[]),
      revision = revision + 1,
      updated_by = p_actor_user_id,
      updated_at = clock_timestamp()
    where user_id = p_user_id
    returning * into v_result;
  else
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'Navigation preferences changed after they were opened. Refresh and try again.';
    end if;
    insert into public.user_navigation_preferences (
      user_id, section_orders, hidden_item_ids, revision, updated_by
    ) values (
      p_user_id,
      coalesce(p_section_orders, '{}'::jsonb),
      coalesce(p_hidden_item_ids, '{}'::text[]),
      1,
      p_actor_user_id
    ) returning * into v_result;
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_user_navigation_preferences(uuid, jsonb, text[], integer, uuid) from public, anon, authenticated;
grant execute on function public.save_user_navigation_preferences(uuid, jsonb, text[], integer, uuid) to service_role;

alter table public.buyer_invoice_collection_items
  drop constraint if exists buyer_invoice_collection_items_status_check;

update public.buyer_invoice_collection_items
set status = case status
  when 'Not Started' then 'To Contact'
  when 'Reminder Sent' then 'Awaiting Buyer'
  when 'Awaiting Buyer Reply' then 'Awaiting Buyer'
  else status
end;

alter table public.buyer_invoice_collection_items
  add constraint buyer_invoice_collection_items_status_check
  check (status in (
    'To Contact',
    'Awaiting Buyer',
    'Promise to Pay',
    'Payment Advice Received',
    'Escalated',
    'On Hold',
    'Paid / Closed'
  ));

alter table public.buyer_invoice_collection_items
  alter column status set default 'To Contact',
  add column if not exists on_hold_reason text null,
  add column if not exists on_hold_review_date date null,
  add column if not exists advice_received_date date null,
  add column if not exists advice_amount numeric(18, 2) null,
  add column if not exists advice_reference text null,
  add column if not exists advice_verification_date date null,
  add column if not exists advice_document_ids jsonb not null default '[]'::jsonb,
  add column if not exists reconciliation_state text not null default 'not_checked',
  add column if not exists verified_receivable_balance numeric(18, 2) null,
  add column if not exists latest_payment_snapshot jsonb null,
  add column if not exists previous_active_status text null,
  add column if not exists closure_source text null,
  add column if not exists last_reconciled_at timestamptz null;

alter table public.buyer_invoice_collection_items
  drop constraint if exists buyer_invoice_collection_items_advice_amount_check,
  drop constraint if exists buyer_invoice_collection_items_advice_documents_check,
  drop constraint if exists buyer_invoice_collection_items_reconciliation_state_check,
  drop constraint if exists buyer_invoice_collection_items_previous_active_status_check,
  drop constraint if exists buyer_invoice_collection_items_closure_source_check;

alter table public.buyer_invoice_collection_items
  add constraint buyer_invoice_collection_items_advice_amount_check
    check (advice_amount is null or advice_amount > 0),
  add constraint buyer_invoice_collection_items_advice_documents_check
    check (jsonb_typeof(advice_document_ids) = 'array'),
  add constraint buyer_invoice_collection_items_reconciliation_state_check
    check (reconciliation_state in ('not_checked', 'open', 'partial_payment', 'payment_pending_posting', 'advice_pending', 'advice_overdue', 'settled', 'reopened', 'balance_unavailable', 'manual_closure_mismatch')),
  add constraint buyer_invoice_collection_items_previous_active_status_check
    check (previous_active_status is null or previous_active_status in ('To Contact', 'Awaiting Buyer', 'Promise to Pay', 'Payment Advice Received', 'Escalated', 'On Hold')),
  add constraint buyer_invoice_collection_items_closure_source_check
    check (closure_source is null or closure_source in ('manual', 'system'));

create index if not exists buyer_invoice_collection_items_advice_verification_idx
on public.buyer_invoice_collection_items(advice_verification_date)
where status = 'Payment Advice Received';

create index if not exists buyer_invoice_collection_items_reconciliation_idx
on public.buyer_invoice_collection_items(reconciliation_state, last_reconciled_at desc);

alter table public.buyer_invoice_collection_events
  drop constraint if exists buyer_invoice_collection_events_event_type_check;

alter table public.buyer_invoice_collection_events
  add column if not exists event_key text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

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
    'reconciliation_warning'
  ));

alter table public.buyer_invoice_collection_events
  drop constraint if exists buyer_invoice_collection_events_metadata_check;

alter table public.buyer_invoice_collection_events
  add constraint buyer_invoice_collection_events_metadata_check
    check (jsonb_typeof(metadata) = 'object');

create unique index if not exists buyer_invoice_collection_events_event_key_idx
on public.buyer_invoice_collection_events(stem_id, event_key)
where event_key is not null;

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

revoke all on function public.save_buyer_invoice_collection(text, jsonb, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_buyer_invoice_collection(text, jsonb, jsonb, uuid, text, timestamptz) to service_role;
